const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();
const { broadcastEmitter } = require('./server');

const main_bot = new Telegraf(process.env.MAIN_BOT_TOKEN);

const BIT_CHECK_IMAGE_PATH = path.join(process.env.DATA_PATH + 'images/bit-check-image.png');

main_bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота и открыть меню' },
    { command: 'profile', description: 'Посмотреть профиль и статистику' }
]).then(() => {
    console.log('Bot commands set successfully');
}).catch(err => {
    console.error('Error setting bot commands:', err.message);
});

let cachedBtcRubPrice = 8200000;
let cachedLtcRubPrice = 6800;
let lastPriceUpdate = 0;
const CACHE_DURATION = 3 * 60 * 1000;

const cronTasks = new Map();

let isScheduling = false;
let reloadTimeout = null;

function loadJson(name) {
    const filePath = path.join(process.env.DATA_PATH, 'database', `${name}.json`);
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        return fs.readJsonSync(filePath);
    } catch (err) {
        console.error(`Error loading ${name}.json:`, err.message);
        return [];
    }
}

function saveJson(name, data) {
    try {
        const filePath = path.join(process.env.DATA_PATH, 'database', `${name}.json`);
        fs.writeJsonSync(filePath, data, { spaces: 2 });
    } catch (err) {
        console.error(`Error saving ${name}.json:`, err.message);
    }
}

function loadStates() {
    const filePath = path.join(process.env.DATA_PATH, 'database', 'states.json');
    try {
        if (!fs.existsSync(filePath)) {
            const defaultStates = {
                pendingBuy: {},
                pendingSell: {},
                pendingWallet: {},
                pendingCaptcha: {},
                pendingWithdrawReferralAmount: {},
                pendingMessageIds: {},
                pendingSupport: {},
                pendingOperatorMessages: {},
                pendingProfileUpdate: {},
                pendingCallbackData: {}
            };
            fs.writeFileSync(filePath, JSON.stringify(defaultStates, null, 2));
            return defaultStates;
        }
        return JSON.parse(fs.readFileSync(filePath));
    } catch (err) {
        console.error('Error loading states.json:', err.message);
        return {
            pendingBuy: {},
            pendingSell: {},
            pendingWallet: {},
            pendingCaptcha: {},
            pendingWithdrawReferralAmount: {},
            pendingMessageIds: {},
            pendingSupport: {},
            pendingOperatorMessages: {},
            pendingProfileUpdate: {},
            pendingCallbackData: {}
        };
    }
}

function clearPendingStates(states, userId) {
    delete states.pendingBuy[userId];
    delete states.pendingSell[userId];
    delete states.pendingWallet[userId];
    delete states.pendingCaptcha[userId];
    delete states.pendingWithdrawReferralAmount[userId];
    delete states.pendingMessageIds[userId];
    delete states.pendingSupport[userId];
    delete states.pendingOperatorMessages[userId];
    delete states.pendingProfileUpdate[userId];
    delete states.pendingCallbackData[userId];
    saveJson('states', states);
}

async function isValidChat(chatId) {
    try {
        await main_bot.telegram.getChat(chatId);
        return true;
    } catch (error) {
        console.error(`Invalid chat ${chatId}:`, error.message);
        return false;
    }
}

async function scheduleBroadcasts() {
    if (isScheduling) {
        console.log('Scheduling already in progress, skipping');
        return;
    }
    isScheduling = true;

    try {
        for (const task of cronTasks.values()) {
            task.stop();
        }
        cronTasks.clear();
        console.log('Cleared all existing cron tasks');

        const broadcasts = loadJson('broadcasts') || [];
        if (!Array.isArray(broadcasts)) {
            console.error('Invalid broadcasts data format');
            return;
        }

        for (const broadcast of broadcasts) {
            if (!broadcast.id || !broadcast.scheduledTime) {
                console.log(`Broadcast ${broadcast.id || 'without ID'} has no scheduledTime or ID, skipping`);
                continue;
            }

            const scheduledTime = new Date(broadcast.scheduledTime);
            const now = new Date();

            if (isNaN(scheduledTime.getTime())) {
                console.log(`Invalid scheduledTime for broadcast ${broadcast.id}, skipping`);
                continue;
            }

            if (cronTasks.has(broadcast.id)) {
                console.log(`Task for broadcast ${broadcast.id} already scheduled, skipping`);
                continue;
            }

            if (scheduledTime <= now) {
                console.log(`Broadcast ${broadcast.id} is in the past, sending immediately`);
                await sendBroadcast(broadcast);
                continue;
            }

            let cronTime;
            if (broadcast.isDaily) {
                cronTime = `0 ${scheduledTime.getUTCMinutes()} ${scheduledTime.getUTCHours()} * * *`;
                console.log(`Scheduling daily broadcast ${broadcast.id} with cronTime: ${cronTime}`);
            } else {
                cronTime = `${scheduledTime.getUTCSeconds()} ${scheduledTime.getUTCMinutes()} ${scheduledTime.getUTCHours()} ${scheduledTime.getUTCDate()} ${scheduledTime.getUTCMonth() + 1} *`;
                console.log(`Scheduling one-time broadcast ${broadcast.id} with cronTime: ${cronTime}`);
            }

            const task = cron.schedule(cronTime, async () => {
                console.log(`Executing broadcast ${broadcast.id} at ${new Date().toISOString()}`);
                await sendBroadcast(broadcast);
            }, {
                scheduled: true,
                timezone: 'UTC'
            });

            cronTasks.set(broadcast.id, task);
            console.log(`Successfully scheduled broadcast ${broadcast.id} for ${scheduledTime.toISOString()}`);
        }
    } catch (error) {
        console.error('Error scheduling broadcasts:', error.message);
    } finally {
        isScheduling = false;
    }
}

async function sendBroadcast(broadcast) {
    let success = true;
    let broadcasts = loadJson('broadcasts') || [];
    const broadcastIndex = broadcasts.findIndex(b => b.id === broadcast.id);

    if (broadcastIndex === -1) {
        console.error(`Broadcast ${broadcast.id} not found in broadcasts array`);
        return;
    }

    if (!broadcast.isDaily && broadcasts[broadcastIndex].status === 'sent') {
        console.log(`Broadcast ${broadcast.id} already sent, skipping`);
        return;
    }

    if (!broadcast.isDaily) {
        broadcasts[broadcastIndex].status = 'sending';
        saveJson('broadcasts', broadcasts);
    }

    const users = loadJson('users') || [];
    if (!Array.isArray(users)) {
        console.error('Invalid users data format');
        return;
    }

    let imagePath = null;
    if (broadcast.imageName) {
        imagePath = path.join(process.env.DATA_PATH, 'images/broadcasts-images', broadcast.imageName);
        console.log(`Broadcast image ${imagePath}`);
        if (!fs.existsSync(imagePath)) {
            console.error(`Image not found for broadcast ${broadcast.id}: ${imagePath}`);
            imagePath = null;
        }
    }

    for (const user of users) {
        if (!user.id || !(await isValidChat(user.id))) {
            console.log(`Skipping user ${user.id || 'without ID'}, invalid chat`);
            continue;
        }

        try {
            const options = {
                caption: `${broadcast.text}\n\n🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!`
            };
            let msg;
            if (imagePath) {
                msg = await main_bot.telegram.sendPhoto(user.id, { source: imagePath }, options);
            } else {
                msg = await main_bot.telegram.sendPhoto(user.id, { source: BIT_CHECK_IMAGE_PATH }, options);
            }
        } catch (error) {
            console.error(`Error sending broadcast ${broadcast.id} to user ${user.id}:`, error.message);
            success = false;
        }
    }

    broadcasts = loadJson('broadcasts') || [];
    const updatedBroadcast = broadcasts.find(b => b.id === broadcast.id);
    if (!updatedBroadcast) {
        console.error(`Broadcast ${broadcast.id} not found after sending`);
        return;
    }

    if (broadcast.isDaily) {
        const nextDay = new Date(updatedBroadcast.scheduledTime);
        nextDay.setDate(nextDay.getDate() + 1);
        updatedBroadcast.scheduledTime = nextDay.toISOString();
        console.log(`Updated scheduledTime for daily broadcast ${broadcast.id} to ${nextDay.toISOString()}`);
        saveJson('broadcasts', broadcasts);
    } else {
        updatedBroadcast.status = 'sent';
        saveJson('broadcasts', broadcasts);
        console.log(`Marked one-time broadcast ${broadcast.id} as sent`);

        if (imagePath) {
            try {
                fs.unlinkSync(imagePath);
                console.log(`Deleted image for broadcast ${broadcast.id}: ${imagePath}`);
            } catch (err) {
                console.error(`Error deleting image ${imagePath}:`, err.message);
            }
        }
        broadcasts = broadcasts.filter(b => b.id !== broadcast.id);
        cronTasks.delete(broadcast.id);
        saveJson('broadcasts', broadcasts);
        console.log(`Removed one-time broadcast ${broadcast.id} from broadcasts and cron tasks`);
    }

    return success;
}

function reloadBroadcasts() {
    if (reloadTimeout) {
        console.log('Reload already scheduled, skipping');
        return;
    }

    reloadTimeout = setTimeout(async () => {
        try {
            const broadcasts = loadJson('broadcasts') || [];
            console.log('Broadcasts reloaded:', broadcasts.length);
            await scheduleBroadcasts();
        } catch (err) {
            console.error('Error reloading broadcasts:', err.message);
        } finally {
            reloadTimeout = null;
        }
    }, 10000);
}

fs.watch(path.join(process.env.DATA_PATH, 'database/broadcasts.json'), (eventType, filename) => {
    if (eventType === 'change') {
        console.log(`Detected change in ${filename}, reloading broadcasts...`);
        reloadBroadcasts();
    }
});

broadcastEmitter.on('newBroadcast', () => {
    console.log('New broadcast detected, reloading...');
    reloadBroadcasts();
});

reloadBroadcasts();

async function getCommissionDiscount(userId) {
    try {
        const config = loadJson('config');
        const users = loadJson('users');
        const deals = loadJson('deals');

        let totalDiscount = 0;

        const vipUser = config.vipUsersData?.find(vip => vip.username === users.find(u => u.id === userId)?.username);
        if (vipUser && vipUser.discount) {
            totalDiscount += vipUser.discount;
        }

        const userDeals = deals.filter(d => d.userId === userId && d.status === 'completed');
        const turnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
        const discounts = config.commissionDiscounts || [];
        for (let i = discounts.length - 1; i >= 0; i--) {
            if (turnover >= discounts[i].amount) {
                totalDiscount += discounts[i].discount;
                break;
            }
        }

        return totalDiscount;
    } catch (err) {
        console.error('Error calculating commission discount:', err.message);
        return 0;
    }
}

async function calculateCommission(amount, currency, type) {
    const config = loadJson('config');
    const commissionScale = type === 'buy'
        ? (currency === 'BTC' ? config.buyCommissionScalePercentBTC : config.buyCommissionScalePercentLTC)
        : (currency === 'BTC' ? config.sellCommissionScalePercentBTC : config.sellCommissionScalePercentLTC);

    let commissionPercent = commissionScale[0].commission;
    for (const scale of commissionScale) {
        if (amount >= scale.amount) {
            commissionPercent = scale.commission;
        } else {
            break;
        }
    }

    return (amount * commissionPercent) / 100;
}

function getAvailablePaymentDetails(config, minCooldown) {
    const now = new Date();
    const buyPaymentDetails = config.buyPaymentDetails || [];

    const availableDetails = buyPaymentDetails.filter(detail => {
        const timestamp = new Date(detail.timestamp);
        const diffMs = now - timestamp;
        return diffMs >= minCooldown * 60 * 1000;
    });

    if (availableDetails.length > 0) {
        return availableDetails[0];
    }

    if (buyPaymentDetails.length > 0) {
        return buyPaymentDetails.reduce((oldest, current) => {
            const oldestTime = new Date(oldest.timestamp);
            const currentTime = new Date(current.timestamp);
            return currentTime < oldestTime ? current : oldest;
        });
    }

    return null;
}

function getContactUrl(currency) {
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

async function updatePrices() {
    const now = Date.now();
    if (now - lastPriceUpdate < CACHE_DURATION) {
        return;
    }

    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=rub', { timeout: 10000 });
        cachedBtcRubPrice = response.data.bitcoin.rub || cachedBtcRubPrice;
        cachedLtcRubPrice = response.data.litecoin.rub || cachedLtcRubPrice;
        lastPriceUpdate = now;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                const retryResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=rub', { timeout: 10000 });
                cachedBtcRubPrice = retryResponse.data.bitcoin.rub || cachedBtcRubPrice;
                cachedLtcRubPrice = retryResponse.data.litecoin.rub || cachedLtcRubPrice;
                lastPriceUpdate = now;
            } catch (retryError) {}
        }
    }
}

async function getBtcRubPrice() {
    await updatePrices();
    return cachedBtcRubPrice;
}

async function getLtcRubPrice() {
    await updatePrices();
    return cachedLtcRubPrice;
}

setInterval(updatePrices, CACHE_DURATION);

async function checkIfBlocked(ctx) {
    const users = loadJson('users');
    const user = users.find(u => u.id === ctx.from.id);
    if (user && user.isBlocked) {
        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: '🚫 Заблокирован' });
        return true;
    }
    return false;
}

main_bot.use(async (ctx, next) => {
    const config = loadJson('config');
    if (config.botStatus === false) {
        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
            caption: '🚫 Бот временно отключен. Пожалуйста, попробуйте позже.'
        });
        return;
    }
    await next();
});

main_bot.use(async (ctx, next) => {
    if (ctx.from && await checkIfBlocked(ctx)) return;
    await next();
});

main_bot.use(async (ctx, next) => {
    try {
        const commands = ['/start', '/profile', '💰 Купить', '💸 Продать', '💬 Отзывы', '💬 Чат', '🤝 Партнёрство', '🆘 Поддержка'];
        if (ctx.message && ctx.message.text && commands.includes(ctx.message.text)) {
            const states = loadStates();
            clearPendingStates(states, ctx.from.id);
            saveJson('states', states);

            if (ctx.message.text !== '/start') {
                const users = loadJson('users');
                const userId = ctx.from.id;
                const user = users.find(u => u.id === userId);
                if (!user) {
                    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: '❌ Вы не зарегистрированы. Используйте /start' });
                    return;
                }
            }
        }
        await next();
    } catch (error) {
        console.error('Error in middleware:', error.message);
        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: '❌ Произошла ошибка, попробуйте снова' });
    }
});

main_bot.command('start', async ctx => {
    const users = loadJson('users');
    const states = loadStates('states');
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ');
    let invitedBy = null;

    if (args.length > 1 && args[1].startsWith('ref_')) {
        const referralId = args[1].split('_')[1];
        const referrer = users.find(u => u.referralId === referralId);
        if (referrer && referrer.id !== userId) invitedBy = referrer.id;
    }

    let user = users.find(u => u.id === userId);
    if (!user) {
        const correctFruit = ['🍒', '🍏', '🥕', '🍌', '🍋', '🍐'][Math.floor(Math.random() * 6)];
        states.pendingCaptcha[userId] = { correct: correctFruit, invitedBy, messageId: ctx.message.message_id };
        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
            caption: `👋 ${ctx.from.first_name}!\nВыбери ${correctFruit}:`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🍒', callback_data: `captcha_🍒` }, { text: '🍏', callback_data: `captcha_🍏` }, { text: '🥕', callback_data: `captcha_🥕` }],
                    [{ text: '🍌', callback_data: `captcha_🍌` }, { text: '🍋', callback_data: `captcha_🍋` }, { text: '🍐', callback_data: `captcha_🍐` }]
                ]
            }
        });
    } else {
        const priceBTC = await getBtcRubPrice();
        const stats = calculateUserStats(userId);
        const earningsRub = user.balance * priceBTC;
        const username = user.username ? `@${user.username}` : 'Нет';
        const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
        const profileText = `👤 Твой профиль в BitCheck\n📛 Имя: ${username}\n🆔 ID: ${userId}\n\n📦 Статистика:\n🔄 Сделок совершено: ${stats.dealsCount}\n👥 Приведено рефералов: ${(user.referrals || []).length}\n💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~ ${earningsRub.toFixed(2)} RUB)\n\n📥 Куплено:\n₿ BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n📤 Продано:\n₿ BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n🔗 Твоя ссылка:\n👉 ${referralLink}\n💰 Приглашайте друзей и получайте бонусы!\n\n🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!`;

        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
            caption: profileText,
            reply_markup: {
                keyboard: [['💰 Купить', '💸 Продать'], ['💬 Чат'], ['💬 Отзывы', '🆘 Поддержка'], ['🤝 Партнёрство']],
                resize_keyboard: true
            }
        });
    }
    saveJson('states', states);
});

main_bot.command('profile', async ctx => {
    const users = loadJson('users');
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);
    const priceBTC = await getBtcRubPrice();
    const stats = calculateUserStats(userId);
    const earningsRub = user.balance * priceBTC;
    const username = user.username ? `@${user.username}` : 'Нет';
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
    const profileText = `👤 Твой профиль в BitCheck\n📛 Имя: ${username}\n🆔 ID: ${userId}\n\n📦 Статистика:\n🔄 Сделок совершено: ${stats.dealsCount}\n👥 Приведено рефералов: ${(user.referrals || []).length}\n💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~ ${earningsRub.toFixed(2)} RUB)\n\n📥 Куплено:\n₿ BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n📤 Продано:\n₿ BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n🔗 Твоя ссылка:\n👉 ${referralLink}\n💰 Приглашайте друзей и получайте бонусы!\n\n🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!`;

    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: profileText,
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Обновить реквизиты', callback_data: 'update_details' }]
            ]
        }
    });
});

main_bot.hears('💬 Отзывы', async ctx => {
    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: '📝 Отзывы BitCheck',
        reply_markup: { inline_keyboard: [[{ text: 'Группа 📣', url: 'https://t.me/bitcheck_ot' }]] }
    });
});

main_bot.hears('💬 Чат', async ctx => {
    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: '💬 Чат BitCheck',
        reply_markup: { inline_keyboard: [[{ text: 'Перейти в чат 🚪', url: 'https://t.me/BitCheck01' }]] }
    });
});

main_bot.hears('🤝 Партнёрство', async ctx => {
    const users = loadJson('users');
    const states = loadStates();
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
    const priceBTC = await getBtcRubPrice();
    const earningsRub = user.balance * priceBTC;
    const text = `🤝 Реферальная программа\n🔗 ${referralLink}\n👥 Приглашено: ${(user.referrals || []).length}\n💰 Заработано: ${(user.balance || 0).toFixed(8)} BTC (~${earningsRub.toFixed(2)} RUB)\n${Date.now() - lastPriceUpdate > CACHE_DURATION ? '⚠️ Курс может быть устаревшим' : ''}`;
    const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: text,
        reply_markup: {
            inline_keyboard: [
                [{ text: '📤 Поделиться', switch_inline_query: `Присоединяйся! ${referralLink}` }],
                [{ text: '💸 Вывести', callback_data: 'withdraw_referral' }]
            ]
        }
    });
    states.pendingMessageIds[userId] = message.message_id;
    saveJson('states', states);
});

main_bot.hears('💰 Купить', async ctx => {
    const config = loadJson('config');
    const states = loadStates();
    if (!config.minBuyAmountRubBTC || !config.maxBuyAmountRubBTC || !config.minBuyAmountRubLTC || !config.maxBuyAmountRubLTC) {
        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
            caption: '❌ Ошибка: конфигурация не загружена. Обратитесь в поддержку.'
        });
        return;
    }
    const priceBTC = await getBtcRubPrice();
    const priceLTC = await getLtcRubPrice();
    const minBTCAmount = (config.minBuyAmountRubBTC / priceBTC).toFixed(8);
    const maxBTCAmount = (config.maxBuyAmountRubBTC / priceBTC).toFixed(8);
    const minLTCAmount = (config.minBuyAmountRubLTC / priceLTC).toFixed(8);
    const maxLTCAmount = (config.maxBuyAmountRubLTC / priceLTC).toFixed(8);
    states.pendingBuy[ctx.from.id] = { currency: null, messageId: null };
    const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: `💰 Выберите валюту:\n💵 BTC\nМин: ${config.minBuyAmountRubBTC} RUB (~${minBTCAmount} BTC)\nМакс: ${config.maxBuyAmountRubBTC} RUB (~${maxBTCAmount} BTC)\n💵 LTC\nМин: ${config.minBuyAmountRubLTC} RUB (~${minLTCAmount} LTC)\nМакс: ${config.maxBuyAmountRubLTC} RUB (~${maxLTCAmount} LTC)\n${Date.now() - lastPriceUpdate > CACHE_DURATION ? '⚠️ Курс может быть устаревшим' : ''}`,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'BTC', callback_data: 'buy_select_btc' }],
                [{ text: 'LTC', callback_data: 'buy_select_ltc' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
            ]
        }
    });
    states.pendingMessageIds[ctx.from.id] = message.message_id;
    saveJson('states', states);
});

main_bot.hears('💸 Продать', async ctx => {
    const config = loadJson('config');

    const states = loadStates();
    if (!config.minSellAmountRubBTC || !config.maxSellAmountRubBTC || !config.minSellAmountRubLTC || !config.maxSellAmountRubLTC) {
        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
            caption: '❌ Ошибка: конфигурация не загружена. Обратитесь в поддержку.'
        });
        return;
    }
    const priceBTC = await getBtcRubPrice();
    const priceLTC = await getLtcRubPrice();
    const minBTCAmount = (config.minSellAmountRubBTC / priceBTC).toFixed(8);
    const maxBTCAmount = (config.maxSellAmountRubBTC / priceBTC).toFixed(8);
    const minLTCAmount = (config.minSellAmountRubLTC / priceLTC).toFixed(8);
    const maxLTCAmount = (config.maxSellAmountRubLTC / priceLTC).toFixed(8);
    states.pendingSell[ctx.from.id] = { currency: null, messageId: null };
    const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: `💸 Выберите валюту:\n💵 BTC\nМин: ${config.minSellAmountRubBTC} RUB (~${minBTCAmount} BTC)\nМакс: ${config.maxSellAmountRubBTC} RUB (~${maxBTCAmount} BTC)\n💵 LTC\nМин: ${config.minSellAmountRubLTC} RUB (~${minLTCAmount} LTC)\nМакс: ${config.maxSellAmountRubLTC} RUB (~${maxLTCAmount} LTC)\n${Date.now() - lastPriceUpdate > CACHE_DURATION ? '⚠️ Курс может быть устаревшим' : ''}`,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'BTC', callback_data: 'sell_select_btc' }],
                [{ text: 'LTC', callback_data: 'sell_select_ltc' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
            ]
        }
    });
    states.pendingMessageIds[ctx.from.id] = message.message_id;
    saveJson('states', states);
});

main_bot.hears('🆘 Поддержка', async ctx => {
    const states = loadStates();
    const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
        caption: '🆘 Напишите нам!',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✉️ Написать', callback_data: 'write_support' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
            ]
        }
    });
    states.pendingMessageIds[ctx.from.id] = message.message_id;
    saveJson('states', states);
});

main_bot.on('message', async ctx => {
    const config = loadJson('config');
    const users = loadJson('users');
    const states = loadStates();
    const withdrawals = loadJson('withdrawals');
    const id = ctx.from.id;
    const user = users.find(u => u.id === id);
    if (user && user.isBlocked) return;

    if (users.find(u => u.id === id)) {
        if (states.pendingProfileUpdate[id] && states.pendingProfileUpdate[id].type.startsWith('add_')) {
            const type = states.pendingProfileUpdate[id].type.split('_')[1];
            const isSell = type === 'defaultSellPaymentDetails';
            const wallet = ctx.message.text.trim();

            if (!wallet || wallet.length < 8) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: isSell ? '❌ Введите корректные реквизиты' : `❌ Введите корректный адрес кошелька для ${type === 'defaultBuyWalletsBTC' ? 'BTC' : 'LTC'}`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('states', states);
                return;
            }

            user[type] = user[type] || [];
            user[type].push(wallet);
            saveJson('users', users);

            try {
                await ctx.deleteMessage(states.pendingMessageIds[id]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            }

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: isSell ? '✅ Реквизиты добавлены' : '✅ Кошелёк добавлен',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔄 Обновить реквизиты', callback_data: 'update_details' }]]
                }
            });
            states.pendingMessageIds[id] = message.message_id;
            delete states.pendingProfileUpdate[id];
            saveJson('states', states);
            return;
        }

        if (states.pendingSupport[id]) {
            const supportData = states.pendingSupport[id];
            delete states.pendingSupport[id];

            if (supportData.targetId) {
                const targetUser = users.find(u => u.id === supportData.targetId);
                if (targetUser && await isValidChat(supportData.targetId)) {
                    try {
                        await main_bot.telegram.sendPhoto(supportData.targetId, { source: BIT_CHECK_IMAGE_PATH }, {
                            caption: `📩 Ответ от поддержки:\n${ctx.message.text}`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✉️ Продолжить переписку', callback_data: 'write_support' }],
                                    [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                                ]
                            }
                        });
                        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: `✅ Ответ отправлен пользователю ID ${supportData.targetId}` });
                    } catch (error) {
                        console.error(`Error sending response to user ${supportData.targetId}:`, error.message);
                        await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: `❌ Ошибка отправки ответа пользователю ID ${supportData.targetId}` });
                    }
                } else {
                    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: `❌ Пользователь ID ${supportData.targetId} не найден или чат недоступен` });
                }
            } else {
                const u = users.find(u => u.id === id);
                const userDisplay = u && u.username ? `@${u.username}` : `ID ${id}`;

                try {
                    if (states.pendingMessageIds[id]) {
                        await ctx.deleteMessage(states.pendingMessageIds[id]);
                        delete states.pendingMessageIds[id];
                    }
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]} for user:`, error.message);
                }

                const operatorMessageIds = [];
                states.pendingOperatorMessages[id] = operatorMessageIds;

                const operators = config.multipleOperatorsData || [];
                for (const operator of operators) {
                    try {
                        const operatorId = users.find(u => u.username === operator.username)?.id;
                        if (operatorId && await isValidChat(operatorId)) {
                            const message = await main_bot.telegram.sendPhoto(operatorId, { source: BIT_CHECK_IMAGE_PATH }, {
                                caption: `🆘 От ${userDisplay} (ID ${id})\n${ctx.message.text}`,
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '📝 Ответить', callback_data: `operator_reply_${id}` }],
                                        [{ text: '🔒 Закрыть', callback_data: 'close_conv' }]
                                    ]
                                }
                            });
                            operatorMessageIds.push({ operatorId, messageId: message.message_id });
                        }
                    } catch (error) {
                        console.error(`Error sending message to operator ${operator.username}:`, error.message);
                    }
                }

                await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: '🚀 Отправлено!' });
            }

            saveJson('states', states);
            return;
        }

        if (states.pendingWallet[id] && !states.pendingWallet[id].newWallet) {
            const walletData = states.pendingWallet[id];
            const isSell = walletData.type === 'sell';
            const walletType = isSell ? 'defaultSellPaymentDetails' : `defaultBuyWallets${walletData.currency}`;
            const users = loadJson('users');
            const user = users.find(u => u.id === id);
            const wallets = user[walletType] || [];

            let caption = isSell ? '💼 Введите реквизиты (СБП или номер карты)' : '💼 Введите адрес кошелька';
            states.pendingWallet[id].newWallet = true;

            const inlineKeyboard = wallets.length > 0
                ? wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_wallet` }])
                : [];
            inlineKeyboard.push([{ text: '❌ Отменить', callback_data: 'cancel_action' }]);

            await ctx.deleteMessage(states.pendingMessageIds[id]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            });

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption,
                reply_markup: { inline_keyboard: inlineKeyboard }
            });

            states.pendingMessageIds[id] = message.message_id;
            states.pendingCallbackData[id] = { action: 'select_wallet', walletType };
            saveJson('states', states);
            return;
        }

        if (states.pendingWallet[id] && states.pendingWallet[id].newWallet) {
            const walletData = states.pendingWallet[id];
            const isSell = walletData.type === 'sell';
            const walletType = isSell ? 'defaultSellPaymentDetails' : `defaultBuyWallets${walletData.currency}`;
            const wallet = ctx.message.text.trim();

            if (!wallet || wallet.length < 8) {
                await ctx.deleteMessage(states.pendingMessageIds[id]).catch(error => {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                });
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `❌ Введите корректные ${isSell ? 'реквизиты' : 'адрес кошелька'} для ${walletData.currency}`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('states', states);
                return;
            }

            walletData.wallet = wallet;

            await ctx.deleteMessage(states.pendingMessageIds[id]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            });

            const actionText = isSell ? 'реквизиты' : 'кошелёк';
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `📝 Хотите ли добавить ${actionText} как постоянный?`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: `save_wallet_no` }, { text: 'Да', callback_data: `save_wallet_yes` }]
                    ]
                }
            });
            states.pendingMessageIds[id] = message.message_id;
            states.pendingCallbackData[id] = { action: 'save_wallet', walletType, wallet };
            saveJson('states', states);
            return;
        }

        if (states.pendingBuy[id]) {
            let input = ctx.message.text.trim();
            let isCryptoInput = false, amount, rub;
            const currency = states.pendingBuy[id].currency;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minBuyAmountRub = currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC;
            const maxBuyAmountRub = currency === 'BTC' ? config.maxBuyAmountRubBTC : config.maxBuyAmountRubLTC;
            const minLTCAmount = (config.minBuyAmountRubLTC / await getLtcRubPrice()).toFixed(8);
            const maxLTCAmount = (config.maxBuyAmountRubLTC / await getLtcRubPrice()).toFixed(8);
            const minBTCAmount = (config.minBuyAmountRubBTC / await getBtcRubPrice()).toFixed(8);
            const maxBTCAmount = (config.maxBuyAmountRubBTC / await getBtcRubPrice()).toFixed(8);

            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || inputValue <= 0) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `❌ Введите корректную сумму в RUB или ${currency}`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('states', states);
                return;
            }

            if (currency === 'BTC') {
                isCryptoInput = inputValue < 1;
            } else if (currency === 'LTC') {
                isCryptoInput = inputValue < 100;
            }

            const discount = await getCommissionDiscount(id);
            const commission = await calculateCommission(isCryptoInput ? inputValue * price : inputValue, currency, 'buy');
            const effectiveCommission = Math.round(commission * (1 - discount / 100));

            if (isCryptoInput) {
                amount = inputValue;
                rub = amount * price;
                const total = rub + effectiveCommission;
                if (rub < minBuyAmountRub || rub > maxBuyAmountRub) {
                    try {
                        await ctx.deleteMessage(states.pendingMessageIds[id]);
                    } catch (error) {
                        console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                    }
                    const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                        caption: `Мин: ${minBuyAmountRub} RUB (~${minBTCAmount} BTC, ~${minLTCAmount} LTC)\nМакс: ${maxBuyAmountRub} RUB (~${maxBTCAmount} BTC, ~${maxLTCAmount} LTC)`
                    });
                    states.pendingMessageIds[id] = message.message_id;
                    clearPendingStates(states, id);
                    saveJson('states', states);
                    return;
                }
                states.pendingBuy[id].amount = amount;
                states.pendingBuy[id].rub = rub;
                states.pendingBuy[id].commission = effectiveCommission;
                states.pendingBuy[id].total = total;
            } else {
                rub = inputValue;
                const total = rub + effectiveCommission;
                if (rub < minBuyAmountRub || rub > maxBuyAmountRub) {
                    try {
                        await ctx.deleteMessage(states.pendingMessageIds[id]);
                    } catch (error) {
                        console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                    }
                    const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                        caption: `Мин: ${minBuyAmountRub} RUB (~${minBTCAmount} BTC, ~${minLTCAmount} LTC)\nМакс: ${maxBuyAmountRub} RUB (~${maxBTCAmount} BTC, ~${maxLTCAmount} LTC)`
                    });
                    states.pendingMessageIds[id] = message.message_id;
                    clearPendingStates(states, id);
                    saveJson('states', states);
                    return;
                }
                amount = rub / price;
                states.pendingBuy[id].amount = amount;
                states.pendingBuy[id].rub = rub;
                states.pendingBuy[id].commission = effectiveCommission;
                states.pendingBuy[id].total = total;
            }

            const walletType = `defaultBuyWallets${currency}`;
            const wallets = user[walletType] || [];

            try {
                await ctx.deleteMessage(states.pendingMessageIds[id]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            }

            if (wallets.length > 0) {
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `💼 Выберите кошелёк для ${currency}:\n${wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n')}`,
                    reply_markup: {
                        inline_keyboard: [
                            ...wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_wallet_${index}` }]),
                            [{ text: '➕ Новый', callback_data: `add_wallet` }],
                            [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingMessageIds[id] = message.message_id;
                states.pendingWallet[id] = {
                    type: 'buy',
                    currency,
                    amount,
                    rub: states.pendingBuy[id].rub,
                    commission: states.pendingBuy[id].commission,
                    total: states.pendingBuy[id].total
                };
                states.pendingCallbackData[id] = { action: 'select_wallet', walletType };
                delete states.pendingBuy[id];
                saveJson('states', states);
                return;
            }

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💼 Введите адрес кошелька для ${currency}`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[id] = message.message_id;
            states.pendingWallet[id] = {
                type: 'buy',
                currency,
                amount,
                rub: states.pendingBuy[id].rub,
                commission: states.pendingBuy[id].commission,
                total: states.pendingBuy[id].total,
                newWallet: true
            };
            delete states.pendingBuy[id];
            saveJson('states', states);
            return;
        }

        if (states.pendingSell[id]) {
            let input = ctx.message.text.trim();
            let isCryptoInput = false, amount, rubBefore;
            const currency = states.pendingSell[id].currency;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minSellAmountRub = currency === 'BTC' ? config.minSellAmountRubBTC : config.minSellAmountRubLTC;
            const maxSellAmountRub = currency === 'BTC' ? config.maxSellAmountRubBTC : config.maxSellAmountRubLTC;
            const minLTCAmount = (config.minSellAmountRubLTC / await getLtcRubPrice()).toFixed(8);
            const maxLTCAmount = (config.maxSellAmountRubLTC / await getLtcRubPrice()).toFixed(8);
            const minBTCAmount = (config.minSellAmountRubBTC / await getBtcRubPrice()).toFixed(8);
            const maxBTCAmount = (config.maxSellAmountRubBTC / await getBtcRubPrice()).toFixed(8);

            const inputValue = parseFloat(input);
            if (isNaN(inputValue) || inputValue <= 0) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `❌ Введите корректную сумму в RUB или ${currency}`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('states', states);
                return;
            }

            if (currency === 'BTC') {
                isCryptoInput = inputValue < 1;
            } else if (currency === 'LTC') {
                isCryptoInput = inputValue < 1000;
            }

            const discount = await getCommissionDiscount(id);
            const commission = await calculateCommission(isCryptoInput ? inputValue * price : inputValue, currency, 'sell');
            const effectiveCommission = Math.round(commission * (1 - discount / 100));

            if (isCryptoInput) {
                amount = inputValue;
                rubBefore = amount * price;
            } else {
                rubBefore = inputValue;
                amount = rubBefore / price;
            }

            const rubAfter = rubBefore - effectiveCommission;

            if (rubBefore < minSellAmountRub || rubBefore > maxSellAmountRub) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `Мин: ${minSellAmountRub} RUB (~${minBTCAmount} BTC, ~${minLTCAmount} LTC)\nМакс: ${maxSellAmountRub} RUB (~${maxBTCAmount} BTC, ~${maxLTCAmount} LTC)`
                });
                states.pendingMessageIds[id] = message.message_id;
                clearPendingStates(states, id);
                saveJson('states', states);
                return;
            }

            const walletType = 'defaultSellPaymentDetails';
            const wallets = user[walletType] || [];

            try {
                await ctx.deleteMessage(states.pendingMessageIds[id]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            }

            if (wallets.length > 0) {
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `💼 Выберите реквизиты для продажи ${currency}:\n${wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n')}`,
                    reply_markup: {
                        inline_keyboard: [
                            ...wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_wallet_${index}` }]),
                            [{ text: '➕ Новый', callback_data: `add_wallet` }],
                            [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingMessageIds[id] = message.message_id;
                states.pendingWallet[id] = {
                    type: 'sell',
                    currency,
                    amount,
                    rub: rubAfter,
                    commission: effectiveCommission,
                    rubBefore
                };
                states.pendingCallbackData[id] = { action: 'select_wallet', walletType };
                delete states.pendingSell[id];
                saveJson('states', states);
                return;
            }

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💼 Введите реквизиты (СБП или номер карты)`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[id] = message.message_id;
            states.pendingWallet[id] = {
                type: 'sell',
                currency,
                amount,
                rub: rubAfter,
                commission: effectiveCommission,
                rubBefore,
                newWallet: true
            };
            delete states.pendingSell[id];
            saveJson('states', states);
            return;
        }

        if (states.pendingWallet[id] && states.pendingWallet[id].type === 'withdrawal') {
            const wallet = ctx.message.text.trim();
            if (!wallet || wallet.length < 10) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `❌ Введите корректный адрес кошелька для BTC`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('users', users);
                saveJson('withdrawals', withdrawals);
                saveJson('states', states);
                return;
            }

            const withdrawal = {
                id: Date.now().toString(),
                userId: user.id,
                username: user.username || 'Нет',
                rubAmount: Number(states.pendingWallet[id].rubAmount.toFixed(2)),
                cryptoAmount: Number(states.pendingWallet[id].amount.toFixed(8)),
                walletAddress: wallet,
                status: 'pending',
                timestamp: new Date().toISOString()
            };

            try {
                await ctx.deleteMessage(states.pendingMessageIds[id]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            }

            const contactUrl = getContactUrl('BTC');

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `✅ Заявка на вывод рефералов создана! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC (~${withdrawal.rubAmount.toFixed(2)} RUB)\nКошелёк: ${withdrawal.walletAddress}\n\nСамостоятельно свяжитесь с оператором для получения реквизитов! ⬇️`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📞 Написать оператору', url: contactUrl }]
                    ]
                }
            });
            states.pendingMessageIds[id] = message.message_id;

            withdrawals.push(withdrawal);

            user.balance = Number((user.balance - withdrawal.cryptoAmount).toFixed(8));

            const operators = getOperators('BTC');
            for (const operator of operators) {
                try {
                    const operatorId = users.find(u => u.username === operator.username)?.id;
                    if (operatorId && await isValidChat(operatorId)) {
                        await main_bot.telegram.sendPhoto(operatorId, { source: BIT_CHECK_IMAGE_PATH }, {
                            caption: `🆕 Новая заявка на вывод рефералов № ${withdrawal.id}\n@${user.username || 'Нет'} (ID ${user.id})\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nКошелёк: ${withdrawal.walletAddress}`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✅ Завершить', callback_data: `operator_complete_withdrawal_${withdrawal.id}` }],
                                    [{ text: '📞 Написать пользователю', url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${user.id}` }]
                                ]
                            }
                        });
                    }
                } catch (error) {
                    console.error(`Error sending to operator ${operator.username}:`, error.message);
                }
            }

            delete states.pendingWallet[id];
            saveJson('withdrawals', withdrawals);
            saveJson('states', states);
            saveJson('users', users);
            return;
        }

        if (states.pendingWallet[id]) {
            const walletData = states.pendingWallet[id];
            const isSell = walletData.type === 'sell';
            const walletType = isSell ? 'defaultSellPaymentDetails' : `defaultBuyWallets${walletData.currency}`;
            const wallet = ctx.message.text.trim();

            if (!wallet || wallet.length < 8) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `❌ Введите корректные ${isSell ? 'реквизиты' : 'адрес кошелька'} для ${walletData.currency}`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('states', states);
                return;
            }

            walletData.wallet = wallet;

            try {
                await ctx.deleteMessage(states.pendingMessageIds[id]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            }

            const actionText = isSell ? 'реквизит' : 'кошелёк';
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `📝 Хотите ли добавить ${actionText} как постоянный?\n${wallet}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: `save_wallet_no_${walletType}_${wallet}` }, { text: 'Да', callback_data: `save_wallet_yes_${walletType}_${wallet}` }]
                    ]
                }
            });
            states.pendingMessageIds[id] = message.message_id;
            saveJson('states', states);
            return;
        }

        if (states.pendingWithdrawReferralAmount[id]) {
            const input = ctx.message.text.trim();
            const amount = parseFloat(input);
            const priceBTC = await getBtcRubPrice();
            const rubAmount = amount * priceBTC;

            if (!user.balance) {
                user.balance = 0;
            }

            if (isNaN(amount) || amount <= 0 || amount > user.balance) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[id]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
                }
                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `❌ Введите корректное количество BTC (макс: ${user.balance.toFixed(8)} BTC)`
                });
                states.pendingMessageIds[id] = message.message_id;
                saveJson('states', states);
                return;
            }

            try {
                await ctx.deleteMessage(states.pendingMessageIds[id]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[id]}:`, error.message);
            }
            states.pendingWallet[id] = {
                type: 'withdrawal',
                currency: 'BTC',
                amount,
                rubAmount
            };
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💼 Введите адрес кошелька для BTC`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[id] = message.message_id;
            delete states.pendingWithdrawReferralAmount[id];
            saveJson('states', states);
        }
    }
});

main_bot.on('callback_query', async ctx => {
    const data = ctx.callbackQuery.data;
    const from = ctx.from.id;

    try {
        if (!data) {
            await ctx.answerCbQuery('❌ Данные не получены', { show_alert: true });
            return;
        }

        const config = loadJson('config');
        const users = loadJson('users');
        const deals = loadJson('deals');
        const states = loadStates();

        if (data.startsWith('select_wallet_')) {
            const states = loadStates();
            const callbackData = states.pendingCallbackData[from];
            if (!callbackData || !callbackData.walletType || callbackData.action !== 'select_wallet') {
                console.error(`Invalid or missing callback data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const index = parseInt(data.split('_')[2]);
            const { walletType } = callbackData;
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            const wallet = user[walletType]?.[index];

            if (!wallet) {
                console.error(`Wallet not found for walletType: ${walletType}, index: ${index}`);
                await ctx.answerCbQuery('❌ Кошелёк не найден', { show_alert: true });
                return;
            }

            if (!states.pendingWallet[from]) {
                console.error(`No pending wallet data for user ${from}`);
                await ctx.answerCbQuery('❌ Данные сделки не найдены', { show_alert: true });
                return;
            }

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            states.pendingWallet[from].wallet = wallet;
            const isSell = walletType === 'defaultSellPaymentDetails';
            const config = loadJson('config');
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💎 Хотите ли вы, чтобы ваша сделка стала выше в очереди? (Цена ${config.priorityPriceRub} RUB)`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: 'priority_normal' }, { text: 'Да', callback_data: 'priority_elevated' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            delete states.pendingCallbackData[from];
            saveJson('states', states);
            await ctx.answerCbQuery(`✅ Выбран ${isSell ? 'реквизит' : 'кошелёк'}: ${wallet}`, { show_alert: false });
            return;
        }

        if (data === 'add_wallet') {
            const states = loadStates();
            const walletData = states.pendingWallet[from];
            if (!walletData || !walletData.currency || !walletData.type) {
                console.error(`Invalid or missing wallet data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const walletType = walletData.type === 'sell' ? 'defaultSellPaymentDetails' : `defaultBuyWallets${walletData.currency}`;
            const isSell = walletData.type === 'sell';

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: isSell ? '💼 Введите реквизиты (СБП или номер карты)' : `💼 Введите адрес кошелька для ${walletData.currency}`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            states.pendingWallet[from].newWallet = true;
            states.pendingCallbackData[from] = { action: 'select_wallet', walletType };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'save_wallet_yes' || data === 'save_wallet_no') {
            const isYes = data === 'save_wallet_yes';
            const states = loadStates();
            const callbackData = states.pendingCallbackData[from];
            if (!callbackData || !callbackData.walletType || !callbackData.wallet || callbackData.action !== 'save_wallet') {
                console.error(`Invalid or missing callback data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const { walletType, wallet } = callbackData;
            const isSell = walletType === 'defaultSellPaymentDetails';

            if (!states.pendingWallet[from]) {
                console.error(`No pending wallet data for user ${from}`);
                await ctx.answerCbQuery('❌ Данные сделки не найдены', { show_alert: true });
                return;
            }

            if (isYes) {
                const users = loadJson('users');
                const user = users.find(u => u.id === from);
                user[walletType] = user[walletType] || [];
                if (!user[walletType].includes(wallet)) {
                    user[walletType].push(wallet);
                    saveJson('users', users);
                }
            }

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            const config = loadJson('config');
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💎 Хотите ли вы, чтобы ваша сделка стала выше в очереди? (Цена ${config.priorityPriceRub} RUB)`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: 'priority_normal' }, { text: 'Да', callback_data: 'priority_elevated' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            delete states.pendingCallbackData[from];
            saveJson('states', states);
            await ctx.answerCbQuery(isYes ? `✅ ${isSell ? 'Реквизит' : 'Кошелёк'} сохранён как постоянный` : `✅ ${isSell ? 'Реквизит' : 'Кошелёк'} не сохранён`, { show_alert: false });
            return;
        }

        if (data === 'update_details') {
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: '📝 Какие реквизиты вы хотите обновить?',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Для покупки BTC', callback_data: 'update_buy_btc' }],
                        [{ text: 'Для покупки LTC', callback_data: 'update_buy_ltc' }],
                        [{ text: 'Для продажи', callback_data: 'update_sell' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'update_buy_btc' || data === 'update_buy_ltc' || data === 'update_sell') {
            const user = users.find(u => u.id === from);
            const type = data === 'update_buy_btc' ? 'defaultBuyWalletsBTC' : data === 'update_buy_ltc' ? 'defaultBuyWalletsLTC' : 'defaultSellPaymentDetails';
            const isSell = data === 'update_sell';
            const wallets = user[type] || [];
            let caption = isSell ? 'Ваши постоянные реквизиты для продажи:\n' : `Ваши постоянные кошельки для покупки ${type === 'defaultBuyWalletsBTC' ? 'BTC' : 'LTC'}:\n`;

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            if (wallets.length === 0) {
                caption = isSell ? 'Вы ещё не добавляли постоянные реквизиты' : 'Вы ещё не добавляли постоянные кошельки';
            } else {
                caption += wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n');
            }

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🗑 Удалить', callback_data: `select_delete_${type}` },
                            { text: '➕ Добавить', callback_data: `add_detail_${type}` }
                        ],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            states.pendingCallbackData[from] = { action: 'select_delete', walletType: type };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('select_delete_')) {
            const states = loadStates();
            const callbackData = states.pendingCallbackData[from];
            if (!callbackData || !callbackData.walletType || callbackData.action !== 'select_delete') {
                console.error(`Invalid or missing callback data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const type = callbackData.walletType;
            const user = users.find(u => u.id === from);
            const isSell = type === 'defaultSellPaymentDetails';
            const wallets = user[type] || [];

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            let caption = isSell ? '📝 Какой реквизит вы хотите удалить?\n' : `📝 Какой кошелёк вы хотите удалить?\n`;
            caption += wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n');

            const inlineKeyboard = wallets.map((wallet, index) => [{
                text: `${index + 1}`,
                callback_data: `delete_wallet_${index}`
            }]);

            inlineKeyboard.push([{ text: '❌ Отменить', callback_data: 'cancel_action' }]);

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption,
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            states.pendingCallbackData[from] = { action: 'delete_wallet', walletType: type };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('delete_wallet_')) {
            const states = loadStates();
            const callbackData = states.pendingCallbackData[from];
            if (!callbackData || !callbackData.walletType || callbackData.action !== 'delete_wallet') {
                console.error(`Invalid or missing callback data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const index = parseInt(data.split('_')[2]);
            const type = callbackData.walletType;
            const user = users.find(u => u.id === from);
            const isSell = type === 'defaultSellPaymentDetails';
            user[type].splice(index, 1);
            saveJson('users', users);

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: isSell ? '✅ Реквизит удалён' : '✅ Кошелёк удалён',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔄 Обновить реквизиты', callback_data: 'update_details' }]]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            delete states.pendingCallbackData[from];
            saveJson('states', states);
            await ctx.answerCbQuery(isSell ? '✅ Реквизит удалён' : '✅ Кошелёк удалён', { show_alert: false });
            return;
        }

        if (data.startsWith('add_detail_')) {
            const type = data.split('_')[2];
            const isSell = type === 'defaultSellPaymentDetails';
            states.pendingProfileUpdate[from] = { type: `add_${type}` };

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: isSell ? 'Введите реквизиты (СБП или номер карты)' : `Введите адрес кошелька для ${type === 'defaultBuyWalletsBTC' ? 'BTC' : 'LTC'}`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('captcha_')) {
            const selectedFruit = data.split('_')[1];
            const captchaData = states.pendingCaptcha[from];

            try {
                await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
            } catch (error) {
                console.error(`Error deleting captcha message:`, error.message);
            }

            if (!captchaData) {
                await ctx.answerCbQuery('❌ Капча истекла. Используйте /start', { show_alert: false });
                return;
            }

            if (selectedFruit === captchaData.correct) {
                const invitedBy = captchaData.invitedBy;
                let user = users.find(u => u.id === from);

                if (!user) {
                    if (invitedBy) {
                        const referrer = users.find(u => u.id === invitedBy);
                        if (referrer && !referrer.referrals.includes(from)) {
                            referrer.referrals = referrer.referrals || [];
                            referrer.referrals.push(from);
                            try {
                                await main_bot.telegram.sendPhoto(referrer.id, { source: BIT_CHECK_IMAGE_PATH }, { caption: `👥 ${ctx.from.first_name || 'Пользователь'} приглашён!` });
                            } catch (error) {
                                console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                            }
                        }
                    }

                    user = {
                        id: from,
                        username: ctx.from.username || '',
                        first_name: ctx.from.first_name || '',
                        last_name: ctx.from.last_name || '',
                        referralId: Date.now().toString(),
                        referrals: [],
                        balance: 0,
                        isBlocked: false,
                        registrationDate: new Date().toISOString(),
                        defaultBuyWalletsBTC: [],
                        defaultBuyWalletsLTC: [],
                        defaultSellPaymentDetails: []
                    };
                    users.push(user);
                }

                delete states.pendingCaptcha[from];

                const priceBTC = await getBtcRubPrice();
                const stats = calculateUserStats(from);
                const earningsRub = user.balance * priceBTC;
                const username = user.username ? `@${user.username}` : 'Нет';
                const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
                const profileText = `👤 Твой профиль в BitCheck\n📛 Имя: ${username}\n🆔 ID: ${from}\n\n📦 Статистика:\n🔄 Сделок совершено: ${stats.dealsCount}\n👥 Приведено рефералов: ${(user.referrals || []).length}\n💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~ ${earningsRub.toFixed(2)} RUB)\n\n📥 Куплено:\n💵 BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n📤 Продано:\n💵 BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n🔗 Твоя ссылка:\n👉 ${referralLink}\n💰 Приглашайте друзей и получайте бонусы!\n\n🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!`;

                await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: profileText,
                    reply_markup: {
                        keyboard: [['💰 Купить', '💸 Продать'], ['💬 Чат'], ['💬 Отзывы', '🆘 Поддержка'], ['🤝 Партнёрство']],
                        resize_keyboard: true
                    }
                });
                await ctx.answerCbQuery('✅ Капча пройдена', { show_alert: false });

                saveJson('users', users);
                saveJson('states', states);
            } else {
                const correctFruit = ['🍒', '🍏', '🥕', '🍌', '🍋', '🍐'][Math.floor(Math.random() * 6)];
                states.pendingCaptcha[from] = { correct: correctFruit, invitedBy: captchaData.invitedBy };
                await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                    caption: `👋 ${ctx.from.first_name}!\nВыбери ${correctFruit}:`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🍒', callback_data: `captcha_🍒` }, { text: '🍏', callback_data: `captcha_🍏` }, { text: '🥕', callback_data: `captcha_🥕` }],
                            [{ text: '🍌', callback_data: `captcha_🍌` }, { text: '🍋', callback_data: `captcha_🍋` }, { text: '🍐', callback_data: `captcha_🍐` }]
                        ]
                    }
                });
                await ctx.answerCbQuery('❌ Неверный выбор, попробуйте снова', { show_alert: false });
            }
            saveJson('states', states);
        }

        if (data === 'write_support') {
            try {
                await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
            } catch (error) {
                console.error(`Error deleting message ${ctx.callbackQuery.message.message_id}:`, error.message);
            }

            states.pendingSupport[from] = true;
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: '✉️ Напишите:',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            saveJson('states', states);
            return;
        }

        if (data.startsWith('operator_reply_')) {
            const targetId = parseInt(data.split('_')[2]);
            if (states.pendingOperatorMessages[targetId]) {
                for (const { operatorId, messageId } of states.pendingOperatorMessages[targetId]) {
                    await main_bot.telegram.deleteMessage(operatorId, messageId).catch(error => {
                        console.error(`Error deleting message ${messageId} for operator ${operatorId}:`, error.message);
                    });
                }
                delete states.pendingOperatorMessages[targetId];
            }
            states.pendingSupport[from] = { targetId };
            await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption: `✉️ Введите ответ для ID ${targetId}:` });
            saveJson('states', states);
            return;
        }

        if (data === 'close_conv') {
            const targetIdMatch = ctx.callbackQuery.message.caption.match(/ID (\d+)/);
            const targetId = targetIdMatch ? parseInt(targetIdMatch[1]) : null;
            if (targetId && states.pendingOperatorMessages[targetId]) {
                for (const { operatorId, messageId } of states.pendingOperatorMessages[targetId]) {
                    try {
                        await main_bot.telegram.deleteMessage(operatorId, messageId);
                    } catch (error) {
                        console.error(`Error deleting message ${messageId} for operator ${operatorId}:`, error.message);
                    }
                }
                delete states.pendingOperatorMessages[targetId];
            }
            await ctx.answerCbQuery('✅ Обращение закрыто', { show_alert: false });
            saveJson('states', states);
            return;
        }

        if (data === 'withdraw_referral') {
            const user = users.find(u => u.id === from);
            if (!user || !user.balance) {
                await ctx.answerCbQuery('❌ Нет средств для вывода', { show_alert: false });
                saveJson('states', states);
                return;
            }

            const priceBTC = await getBtcRubPrice();
            const earningsRub = user.balance * priceBTC;

            try {
                if (states.pendingMessageIds[from]) {
                    await ctx.deleteMessage(states.pendingMessageIds[from]);
                    delete states.pendingMessageIds[from];
                }
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            }

            states.pendingWithdrawReferralAmount[from] = true;
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💸 Введите количество BTC\nМакс: ${user.balance.toFixed(8)} BTC (~${earningsRub.toFixed(2)} RUB)`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            saveJson('states', states);
            return;
        }

        if (data === 'buy_select_btc' || data === 'buy_select_ltc') {
            const currency = data === 'buy_select_btc' ? 'BTC' : 'LTC';
            states.pendingBuy[from].currency = currency;

            const minAmountRub = currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC;
            const maxAmountRub = currency === 'BTC' ? config.maxBuyAmountRubBTC : config.maxBuyAmountRubLTC;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minAmountCrypto = (minAmountRub / price).toFixed(8);
            const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💰 Введите сумму для покупки ${currency} (в RUB или ${currency})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'sell_select_btc' || data === 'sell_select_ltc') {
            const currency = data === 'sell_select_btc' ? 'BTC' : 'LTC';
            states.pendingSell[from].currency = currency;

            const minAmountRub = currency === 'BTC' ? config.minSellAmountRubBTC : config.minSellAmountRubLTC;
            const maxAmountRub = currency === 'BTC' ? config.maxSellAmountRubBTC : config.maxSellAmountRubLTC;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minAmountCrypto = (minAmountRub / price).toFixed(8);
            const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

            await ctx.deleteMessage(states.pendingMessageIds[from]).catch(error => {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            });

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `💸 Введите сумму для продажи ${currency} (в RUB или ${currency})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingMessageIds[from] = message.message_id;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'priority_normal' || data === 'priority_elevated') {
            const priority = data === 'priority_normal' ? 'normal' : 'elevated';
            const walletData = states.pendingWallet[from];
            if (!walletData) {
                await ctx.answerCbQuery('❌ Данные сделки не найдены', { show_alert: true });
                return;
            }

            const config = loadJson('config');
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            if (user && user.isBlocked) return;

            const rubBefore = walletData.rubBefore || 0;
            const rub = walletData.rub || 0;
            const commission = walletData.commission || 0;
            const amount = walletData.amount || 0;
            const discount = await getCommissionDiscount(from);
            const priorityPrice = priority === 'elevated' ? config.priorityPriceRub : 0;

            const deal = {
                id: Date.now().toString(),
                userId: user.id,
                username: user?.username ? `${user.username}` : 'Нет',
                type: walletData.type,
                currency: walletData.currency,
                rubAmount: walletData.type === 'sell' ? Number(rubBefore.toFixed(2)) : Number(rub.toFixed(2)),
                cryptoAmount: Number(amount.toFixed(8)),
                commission: Number(commission.toFixed(2)),
                total: walletData.type === 'sell'
                    ? Number((rubBefore - commission - (priority === 'elevated' ? priorityPrice : 0)).toFixed(2))
                    : Number((rub + commission + priorityPrice).toFixed(2)),
                walletAddress: walletData.wallet,
                status: 'draft',
                priority: priority,
                timestamp: new Date().toISOString(),
            };

            try {
                await ctx.deleteMessage(states.pendingMessageIds[from]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
            }

            const actionText = walletData.type === 'buy' ? 'покупки' : 'продажи';
            const paymentTarget = walletData.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `✅ Подтверждение ${actionText} ${deal.currency}\n` +
                    `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                    `Сумма: ${deal.rubAmount} RUB\n` +
                    `Комиссия: ${deal.commission} RUB (скидка ${discount}%)\n` +
                    `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                    `Итог: ${deal.total} RUB\n` +
                    `${paymentTarget}: <code>${deal.walletAddress}</code>`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Создать заявку', callback_data: `submit_${deal.id}` }],
                        [{ text: '❌ Отменить', callback_data: `cancel_deal_${deal.id}` }]
                    ]
                },
                parse_mode: 'HTML'
            });
            states.pendingMessageIds[from] = message.message_id;
            deals.push(deal);
            delete states.pendingWallet[from];
            saveJson('states', states);
            saveJson('deals', deals);
            await ctx.answerCbQuery(`✅ Выбран приоритет: ${priority === 'elevated' ? 'Повышенный' : 'Обычный'}`, { show_alert: false });
            return;
        }

        if (data.startsWith('submit_')) {
            const dealId = data.split('_')[1];
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'draft');
            if (dealIndex === -1) {
                await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                return;
            }

            const deal = deals[dealIndex];
            deal.status = 'pending';
            deals[dealIndex] = deal;

            const user = users.find(u => u.id === deal.userId);
            const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const contactUrl = getContactUrl(deal.currency);
            const discount = await getCommissionDiscount(deal.userId);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;

            let paymentDetailsText;
            if (deal.type === 'buy') {
                paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                const selectedPaymentDetails = getAvailablePaymentDetails(config, config.paymentDetailsMinCooldown);
                if (selectedPaymentDetails) {
                    paymentDetailsText += `\n\nРеквизиты BitCheck: <code>${selectedPaymentDetails.description}</code>`;
                    const paymentDetailsIndex = config.buyPaymentDetails.findIndex(detail => detail.description === selectedPaymentDetails.description);
                    if (paymentDetailsIndex !== -1) {
                        config.buyPaymentDetails[paymentDetailsIndex].timestamp = new Date().toISOString();
                        saveJson('config', config);
                    }
                } else {
                    paymentDetailsText += `\n\nРеквизиты BitCheck: Не удалось выбрать реквизиты, свяжитесь с оператором.`;
                }
            } else {
                const bitCheckWallet = deal.currency === 'BTC' ? config.sellWalletBTC : config.sellWalletLTC;
                paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                paymentDetailsText += `\n\n${deal.currency} кошелёк BitCheck: <code>${bitCheckWallet}</code>`;
            }

            try {
                await ctx.deleteMessage(states.pendingMessageIds[deal.userId]);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingMessageIds[deal.userId]}:`, error.message);
            }

            const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                caption: `✅ Заявка на сделку создана! № ${deal.id}\n` +
                    `${actionText} ${deal.currency}\n` +
                    `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                    `Сумма: ${deal.rubAmount} RUB\n` +
                    `Комиссия: ${deal.commission.toFixed(2)} RUB (скидка ${discount}%)\n` +
                    `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                    `Итог: ${deal.total.toFixed(2)} RUB\n` +
                    `${paymentDetailsText}\n\n` +
                    `${deal.type === 'buy'
                        ? 'Оплатите по реквизитам и свяжитесь с оператором, чтобы завершить сделку!'
                        : 'Отправьте указанное количество на кошелёк BitCheck и свяжитесь с оператором для завершения сделки!'} ⬇️`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📞 Написать оператору', url: contactUrl }],
                        [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                    ]
                },
                parse_mode: 'HTML'
            });
            states.pendingMessageIds[deal.userId] = message.message_id;

            const operators = getOperators(deal.currency);
            for (const operator of operators) {
                try {
                    const operatorId = users.find(u => u.username === operator.username)?.id;
                    if (operatorId && await isValidChat(operatorId)) {
                        await main_bot.telegram.sendPhoto(operatorId, { source: BIT_CHECK_IMAGE_PATH }, {
                            caption: `🆕 Новая заявка на сделку № ${deal.id}\n` +
                                `${actionText} ${deal.currency}\n` +
                                `@${user.username || 'Нет'} (ID ${deal.userId})\n` +
                                `Количество: ${deal.cryptoAmount}\n` +
                                `Сумма: ${deal.rubAmount} RUB\n` +
                                `Комиссия: ${deal.commission.toFixed(2)} RUB (скидка ${discount}%)\n` +
                                `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                                `Итог: ${deal.total.toFixed(2)} RUB\n` +
                                `${paymentDetailsText}`,
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '🗑️ Удалить', callback_data: `operator_delete_deal_${deal.id}` },
                                        { text: '✅ Завершить', callback_data: `operator_complete_deal_${deal.id}` }
                                    ],
                                    [{ text: '📞 Написать пользователю', url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${deal.userId}` }]
                                ]
                            },
                            parse_mode: 'HTML'
                        });
                    }
                } catch (error) {
                    console.error(`Error sending to operator ${operator.username}:`, error.message);
                }
            }

            await ctx.answerCbQuery('✅ Заявка создана', { show_alert: false });
            saveJson('deals', deals);
            saveJson('states', states);
            return;
        }

        if (data.startsWith('cancel_deal_')) {
            const dealId = data.split('_')[2];
            const dealIndex = deals.findIndex(d => d.id === dealId && (d.status === 'draft' || d.status === 'pending'));

            if (dealIndex !== -1) {
                const deal = deals[dealIndex];
                deals.splice(dealIndex, 1);
                saveJson('deals', deals);

                try {
                    await ctx.deleteMessage(states.pendingMessageIds[from]);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingMessageIds[from]}:`, error.message);
                }

                const caption = deal.status === 'draft'
                    ? '❌ Заявка удалена'
                    : `❌ Заявка № ${dealId} удалена`;

                const message = await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, { caption });
                states.pendingMessageIds[from] = message.message_id;
                saveJson('states', states);
            }
        }

        if (data.startsWith('operator_delete_deal_')) {
            const dealId = data.split('_')[3];
            try {
                let deals = loadJson('deals');
                const dealIndex = deals.findIndex(d => d.id === dealId);

                if (dealIndex === -1) {
                    await ctx.answerCbQuery('❌ Сделка не найдена или уже обработана', { show_alert: true });
                    return;
                }

                const deal = deals[dealIndex];
                deals = deals.filter(d => d.id !== dealId);
                saveJson('deals', deals);

                try {
                    await ctx.editMessageCaption(`❌ Сделка № ${deal.id} удалена`, {
                        reply_markup: { inline_keyboard: [] }
                    });
                } catch (error) {
                    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                        caption: `✅ Сделка № ${deal.id} успешно удалена`
                    });
                }

                await ctx.answerCbQuery('✅ Сделка удалена', { show_alert: false });
            } catch (error) {
                console.error('Error deleting deal:', error.message);
                await ctx.answerCbQuery('❌ Ошибка при удалении сделки', { show_alert: true });
            }
            return;
        }

        if (data.startsWith('operator_complete_deal_')) {
            const dealId = data.split('_')[3];
            try {
                let deals = loadJson('deals');
                const dealIndex = deals.findIndex(d => d.id === dealId);

                if (dealIndex === -1) {
                    await ctx.answerCbQuery('❌ Сделка не найдена или уже обработана', { show_alert: true });
                    return;
                }

                const deal = deals[dealIndex];
                deals[dealIndex] = { ...deal, status: 'completed' };
                saveJson('deals', deals);

                const userId = deal.userId;
                const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
                const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                const caption = `✅ Сделка завершена! №${deal.id}\n${actionText} ${deal.currency}\nКоличество: ${deal.cryptoAmount} ${deal.currency}\nСумма: ${deal.rubAmount} RUB\nКомиссия: ${deal.commission.toFixed(2)} RUB\nПриоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\nИтог: ${deal.total.toFixed(2)} RUB\nКошелёк: ${deal.walletAddress}`;

                const contactUrl = getContactUrl(deal.currency);

                try {
                    await main_bot.telegram.sendPhoto(userId, { source: BIT_CHECK_IMAGE_PATH }, {
                        caption: caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: contactUrl }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error(`Error sending completion notification to user ${userId}:`, error.message);
                }

                const referrer = users.find(u => u.referrals && u.referrals.includes(deal.userId));
                if (referrer) {
                    const referralRevenuePercent = config.referralRevenuePercent / 100;
                    const btcPrice = getBtcRubPrice();
                    const commissionBTC = (deal.commission / btcPrice) * referralRevenuePercent;
                    const earningsRub = commissionBTC * btcPrice;

                    referrer.balance = (referrer.balance || 0) + Number(commissionBTC.toFixed(8));
                    saveJson('users', users);

                    try {
                        await main_bot.telegram.sendPhoto(referrer.id, { source: BIT_CHECK_IMAGE_PATH }, {
                            caption: `🎉 Реферальный бонус! +${commissionBTC.toFixed(8)} BTC (~${earningsRub.toFixed(2)}) за сделку ID ${deal.id}`
                        });
                    } catch (error) {
                        console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                    }
                }

                try {
                    await ctx.editMessageCaption(`✅ Сделка № ${deal.id} завершена`, {
                        reply_markup: { inline_keyboard: [] }
                    });
                } catch (error) {
                    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                        caption: `✅ Сделка № ${deal.id} успешно завершена`
                    });
                }
            } catch (error) {
                console.error('Error completing deal:', error.message);
                await ctx.answerCbQuery('❌ Ошибка при завершении сделки', { show_alert: true });
            }
            return;
        }

        if (data.startsWith('operator_complete_withdrawal_')) {
            const withdrawalId = data.split('_')[3];
            try {
                let withdrawals = loadJson('withdrawals');
                const withdrawalIndex = withdrawals.findIndex(w => w.id === withdrawalId);

                if (withdrawalIndex === -1) {
                    await ctx.answerCbQuery('❌ Заявка на вывод не найдена или уже обработана', { show_alert: true });
                    return;
                }

                const withdrawal = withdrawals[withdrawalIndex];
                withdrawals[withdrawalIndex] = { ...withdrawal, status: 'completed' };
                saveJson('withdrawals', withdrawals);

                const userId = withdrawal.userId;
                const contactUrl = getContactUrl('BTC');

                try {
                    await main_bot.telegram.sendPhoto(userId, { source: BIT_CHECK_IMAGE_PATH }, {
                        caption: `✅ Вывод рефералов завершен! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nКошелёк: ${withdrawal.walletAddress}`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: contactUrl }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error(`Error sending withdrawal completion notification to user ${userId}:`, error.message);
                }

                try {
                    await ctx.editMessageCaption(`✅ Вывод рефералов № ${withdrawal.id} завершен`, {
                        reply_markup: { inline_keyboard: [] }
                    });


                } catch (error) {
                    await ctx.replyWithPhoto({ source: BIT_CHECK_IMAGE_PATH }, {
                        caption: `✅ Вывод рефералов № ${withdrawal.id} успешно завершен`
                    });
                }
            } catch (error) {
                console.error('Error completing withdrawal:', error.message);
                await ctx.answerCbQuery('❌ Ошибка при завершении вывода', { show_alert: true });
            }
            return;
        }

        if (data === 'cancel_action') {
            try {
                await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
            } catch (error) {
                console.error(`Error deleting callback message ${ctx.callbackQuery.message.message_id}:`, error.message);
            }

            if (states.pendingMessageIds[from] && states.pendingMessageIds[from] !== ctx.callbackQuery.message.message_id) {
                try {
                    await ctx.deleteMessage(states.pendingMessageIds[from]);
                } catch (error) {
                    console.error(`Error deleting pending message ${states.pendingMessageIds[from]}:`, error.message);
                }
            }

            delete states.pendingMessageIds[from];
            clearPendingStates(states, from);
            saveJson('states', states);

            await ctx.answerCbQuery('❌ Действие отменено', {show_alert: false});
        }
    } catch (error) {
        console.error('Error processing callback query:', error.message);
        await ctx.answerCbQuery('❌ Ошибка обработки', { show_alert: true });
    }
});

main_bot.launch().then(() => {
    console.log('Bot started');
}).catch(err => {
    console.error('Error launching bot:', err.message);
});

process.once('SIGINT', () => {
    main_bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    main_bot.stop('SIGTERM');
});