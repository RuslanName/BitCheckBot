const { Telegraf } = require('telegraf');
const { BIT_CHECK_IMAGE_PATH, MAIN_BOT_TOKEN } = require('../config/constants');

let cachedBitCheckFileId = null;
let mainBotInstance = null;

function setMainBotInstance(bot) {
    mainBotInstance = bot;
}

function getMainBotInstance() {
    if (!mainBotInstance) {
        const { Telegraf } = require('telegraf');
        const { MAIN_BOT_TOKEN } = require('../config/constants');
        mainBotInstance = new Telegraf(MAIN_BOT_TOKEN);
    }
    return mainBotInstance;
}

async function sendBitCheckPhoto(chatId, extra = {}) {
    const bot = getMainBotInstance();
    
    let msg;
    if (cachedBitCheckFileId) {
        msg = await bot.telegram.sendPhoto(chatId, cachedBitCheckFileId, extra);
    } else {
        msg = await bot.telegram.sendPhoto(chatId, { source: BIT_CHECK_IMAGE_PATH }, extra);
        cachedBitCheckFileId = msg.photo[msg.photo.length - 1].file_id;
    }
    return msg;
}

module.exports = {
    sendBitCheckPhoto,
    setMainBotInstance,
    getMainBotInstance
};

