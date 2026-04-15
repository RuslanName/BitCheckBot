const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const { MAIN_BOT_TOKEN, DATA_PATH } = require('./src/config');
const { setMainBotInstance } = require('./src/utils');
const { setupMiddleware } = require('./src/bot/middleware');
const { scheduleTasks, reloadTasks } = require('./src/bot/scheduling');
const { registerAllMessages } = require('./src/bot/messages');
const { registerAllCallbacks } = require('./src/bot/callbacks');
const { registerStartCommand } = require('./src/bot/commands/start');
const { registerSimpleCommands } = require('./src/bot/commands/simple');
const { registerBuyCommand, registerSellCommand } = require('./src/bot/commands/trade');
const { broadcastEmitter, raffleEmitter } = require('./src/core');

const main_bot = new Telegraf(MAIN_BOT_TOKEN);
setMainBotInstance(main_bot);

setupMiddleware(main_bot);

main_bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота и открыть меню' }
]).then(() => {
    console.log('Bot commands set successfully');
}).catch(err => {
    console.error('Error setting bot commands:', err.message);
});

registerStartCommand(main_bot);
registerSimpleCommands(main_bot);
registerBuyCommand(main_bot);
registerSellCommand(main_bot);
registerAllMessages(main_bot);
registerAllCallbacks(main_bot);
scheduleTasks();

fs.watch(path.join(DATA_PATH, 'database', 'broadcasts.json'), (eventType, filename) => {
    if (eventType === 'change') {
        reloadTasks();
    }
});

fs.watch(path.join(DATA_PATH, 'database', 'raffles.json'), (eventType, filename) => {
    if (eventType === 'change') {
        reloadTasks();
    }
});

broadcastEmitter.on('newBroadcast', async () => {
    const { loadJson } = require('./src/utils');
    const broadcasts = loadJson('broadcasts') || [];
    if (broadcasts.length === 0) return;

    const latestBroadcast = broadcasts[broadcasts.length - 1];
    if (latestBroadcast) {
        console.log('New broadcast');
        await scheduleTasks();
    }
});

broadcastEmitter.on('updateBroadcast', async () => {
    console.log('Broadcast updated');
    await scheduleTasks();
});

raffleEmitter.on('newRaffle', async () => {
    const { loadJson } = require('./src/utils');
    const raffles = loadJson('raffles') || [];
    if (raffles.length === 0) return;

    const latestRaffle = raffles[raffles.length - 1];
    if (latestRaffle) {
        console.log('New raffle');
        await scheduleTasks();
    }
});

raffleEmitter.on('updateRaffle', async () => {
    console.log('Raffle updated');
    await scheduleTasks();
});

main_bot.catch((err, ctx) => {
    console.error('Bot error:', err.message);
    if (err.stack) {
        console.error('Stack:', err.stack);
    }
});

let isStopping = false;
async function stopBot() {
    if (isStopping) return;
    isStopping = true;
    console.log('Stopping bot...');

    for (const task of require('./src/bot/scheduling').cronTasks.values()) {
        task.stop();
    }

    main_bot.stop();
    console.log('Bot stopped');
}

process.on('SIGINT', stopBot);
process.on('SIGTERM', stopBot);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
    if (error.stack) {
        console.error('Stack:', error.stack);
    }
});

module.exports = {
    main_bot,
    getBot: () => main_bot,
    stopBot,
    scheduleTasks,
    reloadTasks
};
