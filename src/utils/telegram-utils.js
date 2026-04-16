const https = require('https');
const fs = require('fs');
const path = require('path');

const ipv4HttpsAgent = new https.Agent({ family: 4 });

const { BIT_CHECK_IMAGE_PATH, REVIEW_IMAGE_PATH, MAIN_BOT_TOKEN, DATA_PATH } = require('../config');
const { telegramWithRetry } = require('./retry-utils');

let cachedBitCheckFileId = null;
let cachedReviewFileId = null;
let mainBotInstance = null;

const FILE_ID_CACHE_PATH = DATA_PATH ? path.join(DATA_PATH, 'cache', 'telegram-file-ids.json') : null;

function initFileIdCache() {
    if (FILE_ID_CACHE_PATH) {
        ensureCacheDir();
        const cache = loadFileIdCache();
        if (cache.bitCheckImage) {
            cachedBitCheckFileId = cache.bitCheckImage;
        }
        if (cache.reviewImage) {
            cachedReviewFileId = cache.reviewImage;
        }
    }
}

initFileIdCache();

function ensureCacheDir() {
    if (FILE_ID_CACHE_PATH) {
        const cacheDir = path.dirname(FILE_ID_CACHE_PATH);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
    }
}

function loadFileIdCache() {
    if (!FILE_ID_CACHE_PATH) return {};
    ensureCacheDir();
    try {
        if (fs.existsSync(FILE_ID_CACHE_PATH)) {
            return JSON.parse(fs.readFileSync(FILE_ID_CACHE_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('[IMG] Error loading file_id cache:', e.message);
    }
    return {};
}

function saveFileIdCache(cache) {
    if (!FILE_ID_CACHE_PATH) return;
    ensureCacheDir();
    try {
        fs.writeFileSync(FILE_ID_CACHE_PATH, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error('[IMG] Error saving file_id cache:', e.message);
    }
}

function setMainBotInstance(bot) {
    mainBotInstance = bot;
}

function getMainBotInstance() {
    if (!mainBotInstance) {
        const { Telegraf } = require('telegraf');
        const { MAIN_BOT_TOKEN } = require('../config');
        mainBotInstance = new Telegraf(MAIN_BOT_TOKEN, {
            telegram: {
                agent: ipv4HttpsAgent
            }
        });
        mainBotInstance.botApi._agent = ipv4HttpsAgent;
        mainBotInstance.botApi._webAgent = ipv4HttpsAgent;
    }
    return mainBotInstance;
}

function processCustomEmojis(text) {
    const entities = [];
    const emojiRegex = /<tg-emoji emoji-id="(\d+)">([^<]*)<\/tg-emoji>/g;
    
    let result = text;
    let offsetCorrection = 0;
    
    let match;
    while ((match = emojiRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const emojiId = match[1];
        const emojiChar = match[2] || '🟡';
        const originalOffset = match.index + offsetCorrection;
        
        entities.push({
            type: 'custom_emoji',
            offset: originalOffset,
            length: emojiChar.length,
            custom_emoji_id: emojiId
        });
        
        result = result.replace(fullMatch, emojiChar);
        offsetCorrection += emojiChar.length - fullMatch.length;
    }
    
    return { text: result, entities };
}

async function sendBitCheckPhoto(chatId, extra = {}, imagePath = BIT_CHECK_IMAGE_PATH) {
    const bot = getMainBotInstance();

    if (extra.caption) {
        const { text, entities } = processCustomEmojis(extra.caption);
        extra.caption = text;
        if (entities.length > 0) {
            extra.caption_entities = entities;
        }
    }

    let msg;
    if (imagePath === BIT_CHECK_IMAGE_PATH && cachedBitCheckFileId) {
        try {
            msg = await telegramWithRetry(
                () => bot.telegram.sendPhoto(chatId, cachedBitCheckFileId, extra)
            );
        } catch (error) {
            if (error.description && (error.description.includes('wrong file_id') || error.description.includes('file_id invalid') || error.description.includes('Bad Request'))) {
                cachedBitCheckFileId = null;
                msg = await telegramWithRetry(
                    () => bot.telegram.sendPhoto(chatId, { source: imagePath }, extra)
                );
                if (msg.photo && msg.photo.length > 0) {
                    cachedBitCheckFileId = msg.photo[msg.photo.length - 1].file_id;
                    ensureCacheDir();
                    const fileIdCache = loadFileIdCache();
                    fileIdCache.bitCheckImage = cachedBitCheckFileId;
                    saveFileIdCache(fileIdCache);
                }
            } else {
                throw error;
            }
        }
    } else {
        msg = await telegramWithRetry(
            () => bot.telegram.sendPhoto(chatId, { source: imagePath }, extra)
        );
        if (imagePath === BIT_CHECK_IMAGE_PATH) {
            cachedBitCheckFileId = msg.photo[msg.photo.length - 1].file_id;
            ensureCacheDir();
            const fileIdCache = loadFileIdCache();
            fileIdCache.bitCheckImage = cachedBitCheckFileId;
            saveFileIdCache(fileIdCache);
        }
    }
    return msg;
}

async function sendReviewPhoto(chatId, extra = {}) {
    const bot = getMainBotInstance();
    const imagePath = REVIEW_IMAGE_PATH;

    if (!imagePath || !fs.existsSync(imagePath)) {
        return sendBitCheckPhoto(chatId, extra);
    }

    if (extra.caption) {
        const { text, entities } = processCustomEmojis(extra.caption);
        extra.caption = text;
        if (entities.length > 0) {
            extra.caption_entities = entities;
        }
    }

    let msg;
    if (cachedReviewFileId) {
        try {
            msg = await telegramWithRetry(
                () => bot.telegram.sendPhoto(chatId, cachedReviewFileId, extra)
            );
        } catch (error) {
            if (error.description && (error.description.includes('wrong file_id') || error.description.includes('file_id invalid') || error.description.includes('Bad Request'))) {
                cachedReviewFileId = null;
                msg = await telegramWithRetry(
                    () => bot.telegram.sendPhoto(chatId, { source: imagePath }, extra)
                );
                if (msg.photo && msg.photo.length > 0) {
                    cachedReviewFileId = msg.photo[msg.photo.length - 1].file_id;
                    ensureCacheDir();
                    const fileIdCache = loadFileIdCache();
                    fileIdCache.reviewImage = cachedReviewFileId;
                    saveFileIdCache(fileIdCache);
                }
            } else {
                throw error;
            }
        }
    }

    if (!msg) {
        msg = await telegramWithRetry(
            () => bot.telegram.sendPhoto(chatId, { source: imagePath }, extra)
        );
        if (msg.photo && msg.photo.length > 0) {
            cachedReviewFileId = msg.photo[msg.photo.length - 1].file_id;
            ensureCacheDir();
            const fileIdCache = loadFileIdCache();
            fileIdCache.reviewImage = cachedReviewFileId;
            saveFileIdCache(fileIdCache);
        }
    }
    return msg;
}

module.exports = {
    sendBitCheckPhoto,
    sendReviewPhoto,
    setMainBotInstance,
    getMainBotInstance,
    processCustomEmojis
};

