// star-map PM2 配置(部署手册 §6)
// 服务器路径: 发布目录下的 deploy/ecosystem.config.cjs(由 deploy-app.sh 调用)
// 运行用户: starapp(非 root,清单 C 组)
module.exports = {
  apps: [
    {
      name: 'star-map',
      cwd: __dirname + '/..', // release 目录
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
      max_memory_restart: '500M',
      autorestart: true,
      restart_delay: 3000,
      out_file: '/var/log/star-map/out.log',
      error_file: '/var/log/star-map/err.log',
      merge_logs: true,
      time: true,
    },
  ],
}
