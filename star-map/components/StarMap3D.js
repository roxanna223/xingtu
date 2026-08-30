'use client'

import dynamic from 'next/dynamic'
import { EMO_COLORS } from '@/lib/colors'

const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false })

export default function StarMap3D({ graphData, onNodeClick, width = 680, height = 460 }) {
  if (!graphData?.nodes?.length) {
    return (
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>
        还没有足够的星星来点亮 3D 视图
      </div>
    )
  }

  return (
    <ForceGraph3D
      width={width}
      height={height}
      backgroundColor="#0e1130"
      graphData={graphData}
      nodeId="id"
      nodeLabel="name"
      nodeColor={(n) => EMO_COLORS[n.emotion] || '#9aa3b2'}
      nodeVal={(n) => Math.max(1, Math.sqrt((n.freq || 1) * 2))}
      nodeRelSize={5}
      linkColor={() => '#6bb8ff'}
      linkOpacity={0.28}
      linkWidth={(l) => Math.max(0.5, (l.weight || 0.3) * 2)}
      onNodeClick={onNodeClick}
      showNavInfo={false}
      warmupTicks={40}
      cooldownTicks={80}
    />
  )
}
