const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const MAIN_BOT_TOKEN = process.env.MAIN_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.MAIN_BOT_TOKEN}`;
const SPAM_BOT_TOKEN = process.env.SPAM_BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET;
const COIN_PRICE_API_URL = process.env.COIN_PRICE_API_URL;
const DATA_PATH = process.env.DATA_PATH ? process.env.DATA_PATH.replace(/\/$/, '') + '/' : undefined;
const ASSETS_PATH = process.env.ASSETS_PATH ? process.env.ASSETS_PATH.replace(/\/$/, '') + '/' : undefined;
const BIT_CHECK_IMAGE_PATH = ASSETS_PATH ? path.join(ASSETS_PATH, 'images/bit-check-image.png') : undefined;
const REVIEW_IMAGE_PATH = ASSETS_PATH ? path.join(ASSETS_PATH, 'images/review-image.png') : undefined;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const BOT_MODE = (process.env.BOT_MODE || 'webhook').toLowerCase();
const PORT = process.env.PORT;
const API_URL = process.env.API_URL || `http://localhost:${PORT}`;

const CACHE_DURATION = 3 * 60 * 1000;

module.exports = {
    MAIN_BOT_TOKEN,
    TELEGRAM_API,
    SPAM_BOT_TOKEN,
    JWT_SECRET,
    COIN_PRICE_API_URL,
    DATA_PATH,
    ASSETS_PATH,
    BIT_CHECK_IMAGE_PATH,
    REVIEW_IMAGE_PATH,
    PORT,
    WEBHOOK_DOMAIN,
    BOT_MODE,
    API_URL,
    CACHE_DURATION
};


