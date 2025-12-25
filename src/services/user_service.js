const { loadJson } = require('../utils/storage_utils');

function calculateUserStats(userId) {
    const deals = loadJson('deals');
    const userDeals = deals.filter(d => d.userId === userId && d.status === 'completed');
    const stats = {
        dealsCount: userDeals.length,
        boughtBTC: { rub: 0, crypto: 0 },
        boughtLTC: { rub: 0, crypto: 0 },
        soldBTC: { rub: 0, crypto: 0 },
        soldLTC: { rub: 0, crypto: 0 }
    };

    userDeals.forEach(deal => {
        if (deal.type === 'buy') {
            if (deal.currency === 'BTC') {
                stats.boughtBTC.rub += deal.rubAmount || 0;
                stats.boughtBTC.crypto += deal.cryptoAmount || 0;
            } else if (deal.currency === 'LTC') {
                stats.boughtLTC.rub += deal.rubAmount || 0;
                stats.boughtLTC.crypto += deal.cryptoAmount || 0;
            }
        } else if (deal.type === 'sell') {
            if (deal.currency === 'BTC') {
                stats.soldBTC.rub += deal.rubAmount || 0;
                stats.soldBTC.crypto += deal.cryptoAmount || 0;
            } else if (deal.currency === 'LTC') {
                stats.soldLTC.rub += deal.rubAmount || 0;
                stats.soldLTC.crypto += deal.cryptoAmount || 0;
            }
        }
    });

    return stats;
}

function getOperatorContactUrl(currency) {
    const config = loadJson('config');
    if (config.multipleOperatorsMode && config.multipleOperatorsData.length > 0) {
        const operator = config.multipleOperatorsData.find(op => op.currency === currency) || config.multipleOperatorsData[0];
        return `https://t.me/${operator.username}`;
    }
    return `https://t.me/${config.singleOperatorUsername}`;
}

function getOperators(currency) {
    const config = loadJson('config');
    if (config.multipleOperatorsMode && config.multipleOperatorsData.length > 0) {
        return config.multipleOperatorsData.filter(op => op.currency === currency);
    } else {
        return [{ username: config.singleOperatorUsername, currency }];
    }
}

async function isValidChat(chatId) {
    const { getMainBotInstance } = require('../utils/telegram_utils');
    const bot = getMainBotInstance();
    
    try {
        await bot.telegram.getChat(chatId);
        return true;
    } catch (error) {
        console.error(`Invalid chat ${chatId}:`, error.message);
        return false;
    }
}

async function checkIfBlocked(ctx) {
    const users = loadJson('users');
    const user = users.find(u => u.id === ctx.from.id);
    if (user && user.isBlocked) {
        const { sendBitCheckPhoto } = require('../utils/telegram_utils');
        await sendBitCheckPhoto(ctx.chat.id, { caption: '🚫 Заблокирован' });
        return true;
    }
    return false;
}

module.exports = {
    calculateUserStats,
    getOperatorContactUrl,
    getOperators,
    isValidChat,
    checkIfBlocked
};

