const path = require('path');
require('dotenv').config();

const MAIN_BOT_TOKEN = process.env.MAIN_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.MAIN_BOT_TOKEN}`;
const SPAM_BOT_TOKEN = process.env.SPAM_BOT_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET;
const COIN_PRICE_API_URL = process.env.COIN_PRICE_API_URL;
const BIT_CHECK_GROUP_URL = process.env.BIT_CHECK_GROUP_URL;
const BIT_CHECK_CHAT_URL = process.env.BIT_CHECK_CHAT_URL;
const MERCHANT_API_URL = process.env.MERCHANT_API_URL;
const MERCHANT_API_KEY = process.env.MERCHANT_API_KEY;
const MERCHANT_SECRET = process.env.MERCHANT_SECRET;
const DATA_PATH = process.env.DATA_PATH;
const BIT_CHECK_IMAGE_PATH = path.join(process.env.DATA_PATH + 'images/bit-check-image.png');
const PORT = process.env.PORT;

const PAYMENT_OPTION_NAMES = {
    SBP: 'Система быстрых платежей (СБП)',
    TO_CARD: 'Перевод на банковскую карту',
    TO_ACCOUNT: 'Перевод на банковский счет',
    CROSS_BORDER: 'Трансграничный перевод'
};

const POST_SCRIPT = '🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!';
const CACHE_DURATION = 3 * 60 * 1000;

module.exports = { MAIN_BOT_TOKEN, TELEGRAM_API, SPAM_BOT_TOKEN, JWT_SECRET, COIN_PRICE_API_URL,
    BIT_CHECK_GROUP_URL, BIT_CHECK_CHAT_URL, MERCHANT_API_URL, MERCHANT_API_KEY, MERCHANT_SECRET,
    DATA_PATH, BIT_CHECK_IMAGE_PATH, PORT, POST_SCRIPT, CACHE_DURATION, PAYMENT_OPTION_NAMES };