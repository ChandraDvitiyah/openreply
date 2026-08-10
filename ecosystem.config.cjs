module.exports = {
  apps: [
    {
      name: "kult-web",
      cwd: __dirname,
      script: "npm",
      args: "run start -- -p 3000",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "1G",
    },
    {
      name: "kult-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "1G",
    },
  ],
};
