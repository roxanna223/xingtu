# P0 acceptance: full user-path simulation (user identity only, via product endpoints)
# Target: http://localhost:3001 (production build, dual-mode engine, real DeepSeek key)
# Data source: sim-data.json (UTF-8). This script is ASCII-only to avoid host encoding issues.
# Path: register -> onboard -> Day1~6 quick records -> Day7 chat flow (with refresh restore)
#       -> star chat (with restore + flower quiz + energy) -> reports (today/history/week)
#       -> feedback -> star-map / tests / reports / status -> data summary
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$base = 'http://localhost:3001'
$log = 'E:\DeepseekHarness\4\simulation-log.txt'
$dataDir = 'E:\DeepseekHarness\4\star-map\data'
$cfg = Get-Content -Path 'E:\DeepseekHarness\4\star-map\scripts\sim-data.json' -Raw -Encoding UTF8 | ConvertFrom-Json
Set-Content -Path $log -Value '' -Encoding utf8

# PS 5.1-safe fullwidth punctuation: build via char codes, keep comments ASCII-only
# (host reads BOM-less scripts as GBK; a CJK comment can swallow the LF into a double-byte pair)
$LP = [string][char]0xFF08
$RP = [string][char]0xFF09
$DD = [string][char]0x3001
$PICK = [string][char]0x6211 + [string][char]0x9009 + [string][char]0xFF1A

function Log($m) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Output $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

# Decode response from raw bytes as UTF-8 (PS 5.1 otherwise decodes JSON responses as Latin-1)
function DecodeJson($response) {
  $stream = $response.RawContentStream
  if (-not $stream) { return $null }
  $bytes = New-Object byte[] $stream.Length
  $stream.Position = 0
  [void]$stream.Read($bytes, 0, $bytes.Length)
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  if (-not $text) { return $null }
  return ($text | ConvertFrom-Json)
}

function Post($path, $body, $timeoutSec = 90) {
  $json = if ($body -is [string]) { $body } else { $body | ConvertTo-Json -Depth 10 -Compress }
  $resp = Invoke-WebRequest -Uri ($base + $path) -Method Post -ContentType 'application/json; charset=utf-8' -Body $json -TimeoutSec $timeoutSec -UseBasicParsing
  return (DecodeJson $resp)
}

function GetJson($path, $timeoutSec = 120) {
  $resp = Invoke-WebRequest -Uri ($base + $path) -TimeoutSec $timeoutSec -UseBasicParsing
  return (DecodeJson $resp)
}

function Wait-Idle([int]$maxSec = 240) {
  $deadline = (Get-Date).AddSeconds($maxSec)
  while ((Get-Date) -lt $deadline) {
    $r = $null
    try { $r = Invoke-RestMethod -Uri "$base/api/report" -TimeoutSec 120 } catch { Start-Sleep -Seconds 5; continue }
    if ($null -ne $r -and $r.generating) { Start-Sleep -Seconds 5; continue }
    return
  }
  Log 'WARN: Wait-Idle timeout'
}

function Fail($m) {
  Log ('FAIL: ' + $m)
  throw $m
}

Log '===== USER-PATH SIMULATION START (target http://localhost:3001) ====='

# ---------- 1. register (login page path) ----------
# if a previous run left the same account, switch to a temp account first (full reset, user path)
try { Post '/api/auth' @{ action = 'register'; username = 'cleanup-switch'; password = 'cleanup123' } 60 | Out-Null; Log '1.pre-clean: switched to temp account (full reset)' } catch { Log '1.pre-clean: no previous account, skip' }
try {
  $r = Post '/api/auth' $cfg.register 60
  Log ('1.register: ok=' + $r.ok + ' user=' + $r.user.username + ' starSign=' + $r.user.starSign)
} catch { Fail ('register failed: ' + $_.Exception.Message) }

# ---------- 2. onboarding (record page first-time form) ----------
try {
  $r = Post '/api/onboard' $cfg.onboard 60
  Log ('2.onboard: ok=' + $r.ok + ' cohort=' + ($r.cohort | ConvertTo-Json -Compress))
} catch { Fail ('onboard failed: ' + $_.Exception.Message) }

# ---------- 3. Day 1~6 quick records (form path with explicit dates) ----------
$dayNo = 0
foreach ($d in $cfg.days) {
  $dayNo++
  try {
    $r = Post '/api/record' $d 150
    Log ('3.Day{0} record({1}): ok={2} topics={3} days={4} crisis={5}' -f $dayNo, $d.date, $r.ok, $r.topicCount, $r.dayCount, $r.crisis)
  } catch { Fail ('Day ' + $dayNo + ' record failed: ' + $_.Exception.Message) }
  Wait-Idle 240
}

# ---------- 4. Day 7 (today): record chat flow with refresh restore ----------
try {
  $r = Post '/api/chat' @{ message = ''; draft = $null; sessionId = $null; fresh = $false } 90
  $sid = $r.sessionId
  Log ('4.opener: reply="' + $r.reply + '" session=' + $sid)
  if (-not $sid) { Fail 'no sessionId from opener' }
} catch { Fail ('opener failed: ' + $_.Exception.Message) }

$sentUser = New-Object System.Collections.ArrayList
$i = 0
foreach ($m in $cfg.chatMsgs) {
  $i++
  try {
    $r = Post '/api/chat' @{ message = $m; draft = $null; sessionId = $sid; fresh = $false } 90
    $sid = $r.sessionId
    [void]$sentUser.Add($m)
    Log ('4.msg{0}: reply="{1}"' -f $i, $r.reply)
  } catch { Fail ('chat message failed: ' + $_.Exception.Message) }

  if ($i -eq 2) {
    # simulate a page refresh: request without sessionId, expect history restore
    try {
      $r2 = Post '/api/chat' @{ message = ''; draft = $null; sessionId = $null; fresh = $false } 90
      Log ('4.refresh-restore: restoredMsgs=' + $r2.history.Count + ' sameSession=' + ($r2.sessionId -eq $sid))
      $sid = $r2.sessionId
    } catch { Log ('4.refresh check failed (continue): ' + $_.Exception.Message) }
  }
}

# ask for summary -> editable draft
try {
  $r = Post '/api/chat' @{ message = $cfg.summarizeMsg; draft = $null; sessionId = $sid; fresh = $false } 120
  $sid = $r.sessionId
  $draft = $r.draft
  [void]$sentUser.Add($cfg.summarizeMsg)
  if (-not $draft) { Fail 'no draft returned' }
  Log ('4.summary: q1="' + $draft.q1 + '" trackItems=' + $draft.q2.Count + ' done=' + $r.done)
} catch { Fail ('summary failed: ' + $_.Exception.Message) }

# user edits draft q3, then saves
$draft.q3 = $cfg.draftQ3Edit
$trackText = (($draft.q2 | ForEach-Object { if ($_.event) { $_.event + $LP + ($_.emotions -join $DD) + $RP } }) -join $DD)
$transcript = ($sentUser -join "`n")
try {
  $r = Post '/api/record' @{ date = $cfg.today; freeText = $transcript; q1 = $draft.q1; q2 = $trackText; q3 = $draft.q3; sessionId = $sid } 150
  Log ('4.Day7-save: ok=' + $r.ok + ' topics=' + $r.topicCount + ' days=' + $r.dayCount)
} catch { Fail ('Day7 save failed: ' + $_.Exception.Message) }
Wait-Idle 240

# ---------- 5. star chat (suggestions + turns + restore + flower quiz + energy) ----------
try {
  $r = Post '/api/star' @{ mode = 'suggestions'; message = ''; quiz = $null; sessionId = $null } 90
  Log ('5.suggestions: ' + (($r.suggestions | ForEach-Object { '[' + $_ + ']' }) -join ' '))
  $first = $r.suggestions[0]
} catch { Fail ('suggestions failed: ' + $_.Exception.Message) }

$starMsgs = @($first) + @($cfg.starMsgs | Select-Object -Skip 1)
$ssid = $null
$j = 0
foreach ($m in $starMsgs) {
  $j++
  try {
    $r = Post '/api/star' @{ mode = 'chat'; message = $m; quiz = $null; sessionId = $ssid } 90
    $ssid = $r.sessionId
    Log ('5.star{0}: reply="{1}"' -f $j, $r.reply)
  } catch { Fail ('star chat failed: ' + $_.Exception.Message) }
  if ($j -eq 2) {
    try {
      $r2 = Post '/api/star' @{ mode = 'restore'; message = ''; quiz = $null; sessionId = $null } 60
      Log ('5.star-restore: restoredMsgs=' + $r2.history.Count + ' sameSession=' + ($r2.sessionId -eq $ssid))
      $ssid = $r2.sessionId
    } catch { Log ('5.star restore check failed (continue): ' + $_.Exception.Message) }
  }
}

# flower quiz: intent -> answer each question (pick first option) -> result
try {
  $r = Post '/api/star' @{ mode = 'chat'; message = $cfg.quizIntent; quiz = $null; sessionId = $ssid } 90
  $ssid = $r.sessionId
  $quiz = $r.quiz
  Log ('5.quiz-start: ' + $quiz.title + ' Q1="' + $quiz.question + '"')
} catch { Fail ('quiz start failed: ' + $_.Exception.Message) }
$guard = 0
while ($quiz -and $guard -lt 6) {
  $guard++
  $opt = $quiz.options[0]
  try {
    $r = Post '/api/star' @{ mode = 'chat'; message = ($PICK + $opt); quiz = $quiz; sessionId = $ssid } 90
    $ssid = $r.sessionId
    $quiz = $r.quiz
    if ($quiz) { Log ('5.quiz: answered "' + $opt + '" -> Q' + $quiz.index + ' "' + $quiz.question + '"') }
    elseif ($r.result) { Log ('5.quiz-result: ' + $r.result.emoji + ' ' + $r.result.title + ' / ' + $r.result.headline) }
  } catch { Log ('5.quiz answer failed (abort quiz): ' + $_.Exception.Message); break }
}

# energy hint (profile-based; deterministic fallback now guarantees a result card)
try {
  $r = Post '/api/star' @{ mode = 'chat'; message = $cfg.energyIntent; quiz = $null; sessionId = $ssid } 120
  $ssid = $r.sessionId
  if ($r.result) { Log ('5.energy: ' + $r.result.title + ' / ' + $r.result.headline) }
  else { Log ('5.energy: no result card (reply="' + $r.reply + '")') }
} catch { Log ('5.energy failed (continue): ' + $_.Exception.Message) }

# ---------- 6. view reports (today / historical / week) ----------
Wait-Idle 240
try {
  $rep = GetJson '/api/report' 180
  Log ('6.today-report: moodColor=' + $rep.moodColor + ' observations=' + $rep.observations.Count + ' suggestion=' + ($(if ($rep.suggestion) { 'yes' } else { 'no' })))
} catch { Fail ('today report failed: ' + $_.Exception.Message) }
try {
  $rep3 = GetJson '/api/report?date=2026-08-20' 180
  $pb = [string]$rep3.playback
  Log ('6.day3-report: playback="' + $pb.Substring(0, [Math]::Min(40, $pb.Length)) + '..."')
} catch { Log ('6.day3 report failed (continue): ' + $_.Exception.Message) }
try {
  $repW = GetJson '/api/report?range=week' 180
  $pbw = [string]$repW.playback
  Log ('6.week-report: playback="' + $pbw.Substring(0, [Math]::Min(60, $pbw.Length)) + '..."')
} catch { Log ('6.week report failed (continue): ' + $_.Exception.Message) }

# ---------- 7. feedback (helpful + observation) ----------
try {
  $r = Post '/api/feedback' @{ helpful = $true; comment = $cfg.feedbackComment } 60
  Log ('7.feedback: ok=' + $r.ok + ' adjusted=' + (($r.adjusted -join ',')))
} catch { Log ('7.feedback failed (continue): ' + $_.Exception.Message) }
try {
  if ($rep.observations.Count -gt 0) {
    $obs = $rep.observations[0]
    $r = Post '/api/feedback' @{ observation = $obs.text; ok = $true } 60
    $t = [string]$obs.text
    Log ('7.obs-feedback: ok=' + $r.ok + ' text="' + $t.Substring(0, [Math]::Min(30, $t.Length)) + '..."')
  }
} catch { Log ('7.obs feedback failed (continue): ' + $_.Exception.Message) }

# ---------- 8. final views: star-map / tests / reports / status ----------
try {
  $sm = GetJson '/api/star-map' 60
  Log ('8.star-map: nodes=' + $sm.nodes.Count + ' edges=' + $sm.edges.Count + ' domains=' + $sm.domains.Count)
} catch { Log ('8.star-map failed (continue): ' + $_.Exception.Message) }
try {
  $t = GetJson '/api/tests' 60
  Log ('8.tests: count=' + $t.tests.Count + ' titles=' + (($t.tests | ForEach-Object { $_.title }) -join ', '))
} catch { Log ('8.tests failed (continue): ' + $_.Exception.Message) }
try {
  $rps = GetJson '/api/reports' 60
  Log ('8.reports: count=' + $rps.reports.Count + ' dates=' + (($rps.reports | ForEach-Object { $_.date }) -join ','))
} catch { Log ('8.reports failed (continue): ' + $_.Exception.Message) }
try {
  $st = GetJson '/api/status' 60
  Log ('8.status: loggedIn=' + $st.loggedIn + ' user=' + $st.user.username + ' days=' + $st.dayCount + ' lastDate=' + $st.lastDate + ' engine=' + ($(if ($st.hasKey) { 'online' } else { 'mock' })))
} catch { Log ('8.status failed (continue): ' + $_.Exception.Message) }

# ---------- 9. data summary (read-only inspection, not an interaction) ----------
$prof = Get-Content (Join-Path $dataDir 'profile.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$daysArr = Get-Content (Join-Path $dataDir 'days.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$chatsArr = @()
if (Test-Path (Join-Path $dataDir 'chats.json')) {
  $chatsArr = Get-Content (Join-Path $dataDir 'chats.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
Log '===== DATA SUMMARY ====='
Log ('profile: topics=' + $prof.topics.Count + ' emotionSeries=' + $prof.emotionSeries.Count + ' edges=' + $prof.edges.Count + ' tests=' + $prof.tests.Count + ' feedbackLog=' + $prof.feedbackLog.Count)
Log ('days=' + $daysArr.Count + ' dates=' + (($daysArr | ForEach-Object { $_.date }) -join ','))
foreach ($c in $chatsArr) {
  $pend = @($c.messages | Where-Object { $_.role -eq 'user' -and -not $_.extracted }).Count
  Log ('session ' + $c.id + ' source=' + $c.source + ' msgs=' + $c.messages.Count + ' covered=' + $c.covered + ' unextracted=' + $pend)
}
Log ('topics: ' + (($prof.topics | ForEach-Object { $_.name + '(' + $_.domain + ')' }) -join ' | '))
Log '===== USER-PATH SIMULATION END ====='
