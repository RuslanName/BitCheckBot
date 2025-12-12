const { Telegraf } = require('telegraf');
const { BIT_CHECK_IMAGE_PATH, MAIN_BOT_TOKEN } = require('../config/constants');

let cachedBitCheckFileId = null;
let mainBotInstance = null;

function setMainBotInstance(bot) {
    mainBotInstance = bot;
}

async function sendBitCheckPhoto(chatId, extra = {}) {
    if (!mainBotInstance) {
        const { Telegraf } = require('telegraf');
        const { MAIN_BOT_TOKEN } = require('../config/constants');
        mainBotInstance = new Telegraf(MAIN_BOT_TOKEN);
    }
    
    let msg;
    if (cachedBitCheckFileId) {
        msg = await mainBotInstance.telegram.sendPhoto(chatId, cachedBitCheckFileId, extra);
    } else {
        msg = await mainBotInstance.telegram.sendPhoto(chatId, { source: BIT_CHECK_IMAGE_PATH }, extra);
        cachedBitCheckFileId = msg.photo[msg.photo.length - 1].file_id;
    }
    return msg;
}

module.exports = {
    sendBitCheckPhoto,
    setMainBotInstance
};

