module.exports = {
  apps: [
    {
      name: 'BitCheckBot',
      script: './main-main-bot.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      restart_delay: 1000,
      max_memory_restart: '1G',
      out_file: './logs/main_bot.log',
      error_file: './logs/main_bot_error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'AntiSpamBot',
      script: './anti-spam-bot.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      restart_delay: 1000,
      max_memory_restart: '250M',
      out_file: './logs/spam_bot.log',
      error_file: './logs/spam_bot_error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }
  ],
};