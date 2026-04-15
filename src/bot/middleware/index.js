const RateLimit = require('telegraf-ratelimit');
const { sendBitCheckPhoto } = require('../../utils');
const { checkIfBlocked } = require('../../services');
const { loadJson } = require('../../utils');
const { MESSAGES } = require('../../config');

const rateLimit = RateLimit({
    window: 1000,
    limit: 5,
    onLimitExceeded: async (ctx) => {
        try {
            await sendBitCheckPhoto(ctx.chat.id, {
                caption: '🚫 Слишком много запросов! Пожалуйста, попробуйте снова через несколько секунд.'
            });
        } catch (error) {
            console.error('Error sending rate limit message:', error.message);
        }
    }
});

const botStatusMiddleware = async (ctx, next) => {
    const config = loadJson('config') || {};
    if (config.botStatus === false) {
        await sendBitCheckPhoto(ctx.chat.id, {
            caption: '🚫 Бот временно отключен. Пожалуйста, попробуйте позже.'
        });
        return;
    }
    await next();
};

const blockCheckMiddleware = async (ctx, next) => {
    if (ctx.from && await checkIfBlocked(ctx)) return;
    await next();
};

const setupMiddleware = (bot) => {
    bot.use(botStatusMiddleware);
    bot.use(blockCheckMiddleware);
    bot.use(rateLimit);

    bot.use(async (ctx, next) => {
        try {
            const commands = ['/start', '👤 Профиль', '💰 Купить', '💸 Продать', '💬 Отзывы', '💬 Чат', '🤝 Партнёрство', '🆘 Поддержка'];
            if (ctx.message && ctx.message.text && commands.includes(ctx.message.text)) {
                const { loadStates, clearPendingStates } = require('../../utils');
                const states = loadStates();
                clearPendingStates(states, ctx.from.id);
                const { saveJson } = require('../../utils');
                saveJson('states', states);

                if (ctx.message.text !== '/start') {
                    const users = loadJson('users') || [];
                    const userId = ctx.from.id;
                    const user = users.find(u => u.id === userId);
                    if (!user) {
                        await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_NOT_REGISTERED });
                        return;
                    }
                }
            }
            await next();
        } catch (error) {
            console.error('Error in middleware:', error.message);
            await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_GENERAL });
        }
    });
};

module.exports = {
    rateLimit,
    botStatusMiddleware,
    blockCheckMiddleware,
    setupMiddleware
};
