const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const async = require('async');
require('dotenv').config();
const { broadcastEmitter, raffleEmitter } = require('./server');
const { generateRaffleResults } = require('./randomizer');

const main_bot = new Telegraf(process.env.MAIN_BOT_TOKEN);

const BIT_CHECK_IMAGE_PATH = path.join(process.env.DATA_PATH + 'images/bit-check-image.png');
let cachedBitCheckFileId = null;

main_bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота и открыть меню' }
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

function formatDate(date, includeTime = false) {
    const options = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    };

    if (includeTime) {
        options.hour = "2-digit";
        options.minute = "2-digit";
        return new Date(date).toLocaleString("ru-RU", options).replace(", ", " в ");
    }

    return new Date(date).toLocaleString("ru-RU", options).replace(",", "");
}

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
                pendingCaptcha: {},
                pendingUpdateProfile: {},
                pendingDeal: {},
                pendingWithdrawal: {},
                pendingSupport: {},
                pendingOperatorMessages: {}
            };
            fs.writeFileSync(filePath, JSON.stringify(defaultStates, null, 2));
            return defaultStates;
        }
        return JSON.parse(fs.readFileSync(filePath));
    } catch (err) {
        console.error('Error loading states.json:', err.message);
        return {
            pendingCaptcha: {},
            pendingUpdateProfile: {},
            pendingDeal: {},
            pendingWithdrawal: {},
            pendingSupport: {},
            pendingOperatorMessages: {}
        };
    }
}

function clearPendingStates(states, userId) {
    delete states.pendingDeal[userId];
    delete states.pendingWithdrawal[userId];
    delete states.pendingUpdateProfile[userId];
    delete states.pendingSupport[userId];

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

async function sendBitCheckPhoto(chatId, extra = {}) {
    let msg;
    if (cachedBitCheckFileId) {
        msg = await main_bot.telegram.sendPhoto(chatId, cachedBitCheckFileId, extra);
    } else {
        msg = await main_bot.telegram.sendPhoto(chatId, { source: BIT_CHECK_IMAGE_PATH }, extra);
        cachedBitCheckFileId = msg.photo[msg.photo.length - 1].file_id;
    }
    return msg;
}

async function scheduleTasks() {
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
        console.log('Cleared all cron tasks');

        const broadcasts = loadJson('broadcasts') || [];
        if (!Array.isArray(broadcasts)) {
            console.error('Invalid broadcasts data format');
        } else {
            for (const broadcast of broadcasts) {
                if (!broadcast.id || !broadcast.scheduledTime || broadcast.status === 'sent') {
                    console.log(`Broadcast ${broadcast.id || 'without ID'} has no scheduledTime, ID, or is already sent, skipping`);
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
                    console.log(`Scheduled daily broadcast ${broadcast.id} with cron: ${cronTime}`);
                } else {
                    cronTime = `${scheduledTime.getUTCSeconds()} ${scheduledTime.getUTCMinutes()} ${scheduledTime.getUTCHours()} ${scheduledTime.getUTCDate()} ${scheduledTime.getUTCMonth() + 1} *`;
                    console.log(`Scheduled one-time broadcast ${broadcast.id} with cron: ${cronTime}`);
                }

                const task = cron.schedule(cronTime, async () => {
                    console.log(`Executing broadcast ${broadcast.id} at ${new Date().toISOString()}`);
                    await sendBroadcast(broadcast);
                    cronTasks.delete(broadcast.id);
                }, {
                    scheduled: true,
                    timezone: 'UTC'
                });

                cronTasks.set(broadcast.id, task);
                console.log(`Broadcast ${broadcast.id} scheduled for ${scheduledTime.toISOString()}`);
            }
        }

        const raffles = loadJson('raffles') || [];
        if (!Array.isArray(raffles)) {
            console.error('Invalid raffles data format');
        } else {
            for (const raffle of raffles) {
                if (!raffle.id || !raffle.startDate || !raffle.endDate || raffle.status === 'completed') {
                    console.log(`Raffle ${raffle.id || 'without ID'} has no startDate, endDate, ID, or is already completed, skipping`);
                    continue;
                }

                const startDate = new Date(raffle.startDate);
                const endDate = new Date(raffle.endDate);
                const now = new Date();

                if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                    console.log(`Invalid startDate or endDate for raffle ${raffle.id}, skipping`);
                    continue;
                }

                if (!cronTasks.has(`raffle_notification_${raffle.id}`) && raffle.status === 'pending') {
                    if (startDate <= now) {
                        console.log(`Raffle ${raffle.id} start time is in the past, sending notification immediately`);
                        await sendRaffleNotification(raffle);
                    } else {
                        const cronTime = `${startDate.getUTCSeconds()} ${startDate.getUTCMinutes()} ${startDate.getUTCHours()} ${startDate.getUTCDate()} ${startDate.getUTCMonth() + 1} *`;
                        console.log(`Scheduled raffle notification ${raffle.id} with cron: ${cronTime}`);
                        const task = cron.schedule(cronTime, async () => {
                            console.log(`Sending raffle notification ${raffle.id} at ${new Date().toISOString()}`);
                            await sendRaffleNotification(raffle);
                        }, {
                            scheduled: true,
                            timezone: 'UTC'
                        });
                        cronTasks.set(`raffle_notification_${raffle.id}`, task);
                        console.log(`Raffle notification ${raffle.id} scheduled for ${startDate.toISOString()}`);
                    }
                } else {
                    console.log(`Task for raffle notification ${raffle.id} already scheduled or not pending, skipping`);
                }

                if (!cronTasks.has(`raffle_${raffle.id}`)) {
                    if (endDate <= now) {
                        console.log(`Raffle ${raffle.id} has ended, processing immediately`);
                        await processRaffleEnd(raffle);
                    } else {
                        const cronTime = `${endDate.getUTCSeconds()} ${endDate.getUTCMinutes()} ${endDate.getUTCHours()} ${endDate.getUTCDate()} ${endDate.getUTCMonth() + 1} *`;
                        console.log(`Scheduled raffle ${raffle.id} end with cron: ${cronTime}`);
                        const task = cron.schedule(cronTime, async () => {
                            console.log(`Processing raffle ${raffle.id} end at ${new Date().toISOString()}`);
                            await processRaffleEnd(raffle);
                        }, {
                            scheduled: true,
                            timezone: 'UTC'
                        });
                        cronTasks.set(`raffle_${raffle.id}`, task);
                        console.log(`Raffle ${raffle.id} scheduled to end at ${endDate.toISOString()}`);
                    }
                } else {
                    console.log(`Task for raffle ${raffle.id} already scheduled, skipping`);
                }
            }
        }

        const checkUnpaidDealsTaskId = 'check-unpaid-deals';
        if (!cronTasks.has(checkUnpaidDealsTaskId)) {
            const cronTime = '*/1 * * * *';
            console.log(`Scheduled unpaid deals check with cron: ${cronTime}`);
            const task = cron.schedule(cronTime, async () => {
                console.log(`Checking unpaid deals at ${new Date().toISOString()}`);
                await checkUnpaidDeals();
            }, {
                scheduled: true,
                timezone: 'UTC'
            });
            cronTasks.set(checkUnpaidDealsTaskId, task);
            console.log('Unpaid deals check scheduled');
        }
    } catch (error) {
        console.error('Error scheduling tasks:', error.message);
    } finally {
        isScheduling = false;
        console.log('Scheduling completed');
    }
}

async function sendBroadcast(broadcast) {
    let success = true;
    let broadcasts = loadJson('broadcasts') || [];
    const broadcastIndex = broadcasts.findIndex(b => b.id === broadcast.id);

    if (broadcastIndex === -1) {
        console.error(`Broadcast ${broadcast.id} not found`);
        return false;
    }

    if (!broadcast.isDaily && broadcasts[broadcastIndex].status === 'sent') {
        console.log(`Broadcast ${broadcast.id} already sent, skipping`);
        return false;
    }

    let photoSource;
    let imagePath = null;
    if (broadcast.file_id) {
        photoSource = broadcast.file_id;
    } else {
        imagePath = broadcast.imageName
            ? path.join(process.env.DATA_PATH, 'images/broadcasts', broadcast.imageName)
            : BIT_CHECK_IMAGE_PATH;
        if (!fs.existsSync(imagePath)) {
            photoSource = BIT_CHECK_IMAGE_PATH;
        } else {
            photoSource = { source: imagePath };
        }
    }

    broadcasts[broadcastIndex].status = 'sent';
    saveJson('broadcasts', broadcasts);

    const users = loadJson('users') || [];
    if (!Array.isArray(users)) {
        console.error('Invalid users data format');
        return false;
    }

    const BATCH_SIZE = 25;
    const batchDelay = 10000;
    const batches = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        batches.push(users.slice(i, i + BATCH_SIZE));
    }

    const queue = async.queue(async (user, callback) => {
        if (!user.id || !(await isValidChat(user.id))) {
            callback();
            return;
        }

        try {
            const options = {
                caption: `${broadcast.text}\n\n🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!`
            };
            let msg = await main_bot.telegram.sendPhoto(user.id, photoSource, options);

            if (!broadcast.file_id && typeof photoSource !== 'string') {
                broadcasts = loadJson('broadcasts') || [];
                const currentBroadcast = broadcasts.find(b => b.id === broadcast.id);
                if (currentBroadcast && msg.photo && msg.photo.length > 0) {
                    currentBroadcast.file_id = msg.photo[msg.photo.length - 1].file_id;
                    saveJson('broadcasts', broadcasts);
                    photoSource = currentBroadcast.file_id;
                }
            }
        } catch (error) {
            console.error(`Error sending broadcast ${broadcast.id} to user ${user.id}:`, error.message);
            success = false;
        }
        callback();
    }, 1);

    for (const batch of batches) {
        batch.forEach(user => queue.push(user));
        await queue.drain();
        await new Promise(resolve => setTimeout(resolve, batchDelay));
    }

    broadcasts = loadJson('broadcasts') || [];
    const updatedBroadcast = broadcasts.find(b => b.id === broadcast.id);
    if (!updatedBroadcast) {
        console.error(`Broadcast ${broadcast.id} not found after sending`);
        return false;
    }

    if (broadcast.isDaily) {
        const now = new Date();
        const nextDay = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
            new Date(broadcast.scheduledTime).getHours(),
            new Date(broadcast.scheduledTime).getMinutes()
        );
        updatedBroadcast.scheduledTime = nextDay.toISOString();
        updatedBroadcast.status = 'pending';
    } else {
        broadcasts = broadcasts.filter(b => b.id !== broadcast.id);
    }
    saveJson('broadcasts', broadcasts);

    if (imagePath && !updatedBroadcast.file_id && !broadcast.isDaily) {
        try {
            await fs.unlink(imagePath);
        } catch (err) {
            console.error(`Error deleting image ${imagePath}:`, err.message);
        }
    }

    return success;
}

async function sendRaffleNotification(raffle) {
    let raffles = loadJson('raffles') || [];
    const raffleIndex = raffles.findIndex(r => r.id === raffle.id);
    if (raffleIndex === -1) {
        console.error(`Raffle ${raffle.id} not found`);
        return;
    }

    if (raffles[raffleIndex].status !== 'pending') {
        console.log(`Raffle ${raffle.id} is not pending, skipping notification`);
        return;
    }

    const users = loadJson('users') || [];
    const conditionText = raffle.condition.type === 'dealCount'
        ? `Необходимо совершить не менее ${raffle.condition.value} сделок`
        : `Необходимо совершить сделок на сумму не менее ${raffle.condition.value}000 RUB`;

    const caption = `🎉 Новый розыгрыш!\n\n` +
        `📋 Условия:\n${conditionText}\n\n` +
        `🎁 Призы:\n${raffle.prizes.map((p, i) => `${i + 1}) ${p}`).join('\n')}\n\n` +
        `⏰ Результаты розыгрыша будут объявлены ${formatDate(raffle.endDate, true)}\n\n` +
        `🚀 Сделки с BitCheck — ключ к вашей победе!`;

    const BATCH_SIZE = 25;
    const batchDelay = 10000;
    const batches = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        batches.push(users.slice(i, i + BATCH_SIZE));
    }

    const queue = async.queue(async (user, callback) => {
        if (!user.id || !(await isValidChat(user.id))) {
            callback();
            return;
        }
        try {
            await sendBitCheckPhoto(user.id, { caption });
        } catch (error) {
            console.error(`Error sending raffle notification to user ${user.id}:`, error.message);
        }
        callback();
    }, 1);

    for (const batch of batches) {
        batch.forEach(user => queue.push(user));
        await queue.drain();
        await new Promise(resolve => setTimeout(resolve, batchDelay));
    }

    raffles = loadJson('raffles') || [];
    const updatedRaffle = raffles.find(r => r.id === raffle.id);
    if (updatedRaffle) {
        updatedRaffle.status = 'active';
        saveJson('raffles', raffles);
    }
}

async function processRaffleEnd(raffle) {
    let raffles = loadJson('raffles') || [];
    const raffleIndex = raffles.findIndex(r => r.id === raffle.id);
    if (raffleIndex === -1) {
        console.error(`Raffle ${raffle.id} not found`);
        return;
    }

    if (raffles[raffleIndex].status === 'completed') {
        console.log(`Raffle ${raffle.id} already completed, skipping`);
        return;
    }

    const { winners, outputPath } = generateRaffleResults(raffle);
    raffles[raffleIndex] = { ...raffles[raffleIndex], status: 'completed' };
    saveJson('raffles', raffles);
    cronTasks.delete(`raffle_${raffle.id}`);
    cronTasks.delete(`raffle_notification_${raffle.id}`);

    const winnersList = winners.length > 0
        ? winners.map((w, i) => `${i + 1}) @${w.username || 'ID' + w.id} - ${raffle.prizes[i]}`).join('\n')
        : 'Нет победителей';
    const baseCaption = `🏆 Розыгрыш от ${formatDate(raffle.startDate)} завершён!\n\n` +
        `🎉 Победители:\n${winnersList}\n\n` +
        `🚀 Сделки с BitCheck — ключ к вашей победе!`;
    const winnerCaption = `🏆 Розыгрыш от ${formatDate(raffle.startDate)} завершён!\n\n` +
        `🎖️ Вы стали победителем розыгрыша! Ваш приз - ${raffle.prizes[winners.findIndex(w => w.id === '{userId}')]}\n\n` +
        `🎉 Победители:\n${winnersList}\n\n` +
        `🚀 Сделки с BitCheck — ключ к вашей победе!`;

    const BATCH_SIZE = 25;
    const batchDelay = 10000;
    const users = loadJson('users') || [];
    const config = loadJson('config');
    const operators = config.multipleOperatorsData || [];
    const operatorUsernames = operators.map(op => op.username);
    const operatorIds = users.filter(u => operatorUsernames.includes(u.username)).map(u => u.id);
    const winnerIds = winners.map(w => w.id);
    const otherUsers = users.filter(u => !operatorIds.includes(u.id) && !winnerIds.includes(u.id));

    const queue = async.queue(async (user, callback) => {
        if (!user.id || !(await isValidChat(user.id))) {
            callback();
            return;
        }
        try {
            const isWinner = winnerIds.includes(user.id);
            const caption = isWinner ? winnerCaption.replace('{userId}', user.id) : baseCaption;
            await sendBitCheckPhoto(user.id, {
                caption,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔎 Проверить результаты', callback_data: `view_raffle_results_${raffle.id}` }]
                    ]
                }
            });
        } catch (error) {
            console.error(`Error sending raffle results to user ${user.id}:`, error.message);
        }
        callback();
    }, 1);

    const operatorBatches = [];
    for (let i = 0; i < operatorIds.length; i += BATCH_SIZE) {
        operatorBatches.push(users.filter(u => operatorIds.includes(u.id)).slice(i, i + BATCH_SIZE));
    }
    for (const batch of operatorBatches) {
        batch.forEach(user => queue.push(user));
        await queue.drain();
        await new Promise(resolve => setTimeout(resolve, batchDelay));
    }

    const winnerBatches = [];
    for (let i = 0; i < winners.length; i += BATCH_SIZE) {
        winnerBatches.push(winners.slice(i, i + BATCH_SIZE));
    }
    for (const batch of winnerBatches) {
        batch.forEach(user => queue.push(user));
        await queue.drain();
        await new Promise(resolve => setTimeout(resolve, batchDelay));
    }

    const otherBatches = [];
    for (let i = 0; i < otherUsers.length; i += BATCH_SIZE) {
        otherBatches.push(otherUsers.slice(i, i + BATCH_SIZE));
    }
    for (const batch of otherBatches) {
        batch.forEach(user => queue.push(user));
        await queue.drain();
        await new Promise(resolve => setTimeout(resolve, batchDelay));
    }
}

async function checkUnpaidDeals() {
    try {
        const deals = loadJson('deals') || [];
        const config = loadJson('config') || {};
        const users = loadJson('users') || [];
        const states = loadStates() || {};
        const now = new Date();
        const paymentTimeout = (config.paymentDetailsRecoveryTimeMinutes || 60) * 60 * 1000;

        for (const deal of deals) {
            if (deal.status !== 'unpaid') continue;

            const dealTime = new Date(deal.timestamp);
            if (now - dealTime > paymentTimeout) {
                deal.status = 'expired';
                const user = users.find(u => u.id === deal.userId);
                if (!user) continue;

                const contactUrl = getContactUrl(deal.currency);
                const caption = `❌ Время оплаты по заявке № ${deal.id} истекло!\n` +
                    `Покупка ${deal.currency}\n` +
                    `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                    `Сумма: ${deal.rubAmount} RUB\n\n` +
                    `‼️ Если произошла ошибка, пожалуйста, свяжитесь с оператором!`;

                try {
                    if (states.pendingDeal?.[deal.userId]?.messageId) {
                        await main_bot.telegram.deleteMessage(deal.userId, states.pendingDeal[deal.userId].messageId);
                    }

                    const message = await sendBitCheckPhoto(deal.userId, {
                        caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: contactUrl }]
                            ]
                        },
                        parse_mode: 'HTML'
                    });
                    states.pendingDeal = states.pendingDeal || {};
                    states.pendingDeal[deal.userId] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    console.error(`Error sending notification to user ${deal.userId}:`, error.message);
                }
            }
        }
        saveJson('deals', deals);
    } catch (error) {
        console.error('Error checking unpaid deals:', error.message);
    }
}

function reloadTasks() {
    if (reloadTimeout) {
        console.log('Reload already scheduled, skipping');
        return;
    }

    reloadTimeout = setTimeout(async () => {
        try {
            await scheduleTasks();
        } catch (err) {
            console.error('Error reloading tasks:', err.message);
        } finally {
            reloadTimeout = null;
        }
    }, 30000);
}

broadcastEmitter.on('newBroadcast', async () => {
    const broadcasts = loadJson('broadcasts') || [];
    const latestBroadcast = broadcasts[broadcasts.length - 1];
    if (latestBroadcast) {
        console.log(`New broadcast ${latestBroadcast.id} detected, scheduling tasks`);
        await scheduleTasks();
    }
});

broadcastEmitter.on('updateBroadcast', async () => {
    console.log('Broadcast updated, rescheduling tasks');
    await scheduleTasks();
});

fs.watch(path.join(process.env.DATA_PATH, 'database', 'broadcasts.json'), (eventType, filename) => {
    if (eventType === 'change') {
        console.log('Broadcasts file changed, reloading tasks');
        reloadTasks();
    }
});

raffleEmitter.on('newRaffle', async () => {
    const raffles = loadJson('raffles') || [];
    const latestRaffle = raffles[raffles.length - 1];
    if (latestRaffle) {
        console.log(`New raffle ${latestRaffle.id} detected, scheduling tasks`);
        await scheduleTasks();
    }
});

raffleEmitter.on('updateRaffle', async () => {
    console.log('Raffle updated, rescheduling tasks');
    await scheduleTasks();
});

fs.watch(path.join(process.env.DATA_PATH, 'database', 'raffles.json'), (eventType, filename) => {
    if (eventType === 'change') {
        console.log('Raffles file changed, reloading tasks');
        reloadTasks();
    }
});

reloadTasks();

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

function getBalancedPaymentDetails(buyPaymentDetails) {
    if (buyPaymentDetails.length === 0) {
        return null;
    }

    const maxUsages = Math.max(...buyPaymentDetails.map(d => d.confirmedUsages));

    const lagging = buyPaymentDetails.filter(d => d.confirmedUsages < maxUsages - 1);

    const selectOldest = (arr) => {
        if (arr.length === 0) return null;
        return arr.reduce((oldest, current) => {
            if (!oldest) return current;
            if (current.confirmedUsages < oldest.confirmedUsages) return current;
            if (current.confirmedUsages > oldest.confirmedUsages) return oldest;
            const oldestTime = new Date(oldest.timestamp);
            const currentTime = new Date(current.timestamp);
            return currentTime < oldestTime ? current : oldest;
        }, null);
    };

    if (lagging.length === 0) {
        return selectOldest(buyPaymentDetails);
    } else {
        const p = 0.5;
        if (Math.random() < p) {
            return selectOldest(lagging);
        } else {
            const nonLagging = buyPaymentDetails.filter(d => d.confirmedUsages >= maxUsages - 1);
            return selectOldest(nonLagging);
        }
    }
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
        await sendBitCheckPhoto(ctx.chat.id, { caption: '🚫 Заблокирован' });
        return true;
    }
    return false;
}

main_bot.use(async (ctx, next) => {
    const config = loadJson('config');
    if (config.botStatus === false) {
        await sendBitCheckPhoto(ctx.chat.id, {
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
        const commands = ['/start', '👤 Профиль', '💰 Купить', '💸 Продать', '💬 Отзывы', '💬 Чат', '🤝 Партнёрство', '🆘 Поддержка'];
        if (ctx.message && ctx.message.text && commands.includes(ctx.message.text)) {
            const states = loadStates();
            clearPendingStates(states, ctx.from.id);
            saveJson('states', states);

            if (ctx.message.text !== '/start') {
                const users = loadJson('users');
                const userId = ctx.from.id;
                const user = users.find(u => u.id === userId);
                if (!user) {
                    await sendBitCheckPhoto(ctx.chat.id, { caption: '❌ Вы не зарегистрированы. Используйте /start' });
                    return;
                }
            }
        }
        await next();
    } catch (error) {
        console.error('Error in middleware:', error.message);
        await sendBitCheckPhoto(ctx.chat.id, { caption: '❌ Произошла ошибка, попробуйте снова' });
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
        await sendBitCheckPhoto(ctx.chat.id, {
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

        await sendBitCheckPhoto(ctx.chat.id, {
            caption: profileText,
            reply_markup: {
                keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '🤝 Партнёрство'], ['💬 Чат', '💬 Отзывы'], ['🆘 Поддержка']],
                resize_keyboard: true
            }
        });
    }
    saveJson('states', states);
});

main_bot.hears('👤 Профиль', async ctx => {
    const users = loadJson('users');
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);
    console.log(user)
    const priceBTC = await getBtcRubPrice();
    const stats = calculateUserStats(userId);
    const earningsRub = user.balance * priceBTC;
    const username = user.username ? `@${user.username}` : 'Нет';
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
    const profileText = `👤 Твой профиль в BitCheck\n📛 Имя: ${username}\n🆔 ID: ${userId}\n\n📦 Статистика:\n🔄 Сделок совершено: ${stats.dealsCount}\n👥 Приведено рефералов: ${(user.referrals || []).length}\n💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~ ${earningsRub.toFixed(2)} RUB)\n\n📥 Куплено:\n₿ BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n📤 Продано:\n₿ BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\nŁ LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n🔗 Твоя ссылка:\n👉 ${referralLink}\n💰 Приглашайте друзей и получайте бонусы!\n\n🚀 BitCheck — твой надёжный обменник для покупки и продажи Bitcoin и Litecoin!`;

    await sendBitCheckPhoto(ctx.chat.id, {
        caption: profileText,
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Обновить реквизиты', callback_data: 'update_details' }]
            ]
        }
    });
});

main_bot.hears('💬 Отзывы', async ctx => {
    await sendBitCheckPhoto(ctx.chat.id, {
        caption: '📝 Отзывы BitCheck',
        reply_markup: { inline_keyboard: [[{ text: 'Группа 📣', url: 'https://t.me/bitcheck_ot' }]] }
    });
});

main_bot.hears('💬 Чат', async ctx => {
    await sendBitCheckPhoto(ctx.chat.id, {
        caption: '💬 Чат BitCheck',
        reply_markup: { inline_keyboard: [[{ text: 'Перейти в чат 🚪', url: 'https://t.me/BitCheck01' }]] }
    });
});

main_bot.hears('🤝 Партнёрство', async ctx => {
    const users = loadJson('users');
    const states = loadJson('states');
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
    const priceBTC = await getBtcRubPrice();
    const earningsRub = user.balance * priceBTC;
    const text = `🤝 Реферальная программа\n🔗 ${referralLink}\n👥 Приглашено: ${(user.referrals || []).length}\n💰 Заработано: ${earningsRub.toFixed(2)} RUB (~${(user.balance || 0).toFixed(8)} BTC)\n${Date.now() - lastPriceUpdate > CACHE_DURATION ? '⚠️ Курс может быть устаревшим' : ''}`;
    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption: text,
        reply_markup: {
            inline_keyboard: [
                [{ text: '📤 Поделиться', switch_inline_query: `Присоединяйся! ${referralLink}` }],
                [{ text: '💸 Вывести', callback_data: 'withdraw_referral' }]
            ]
        }
    });
    states.pendingWithdrawal[userId] = { messageId: message.message_id };
    saveJson('states', states);
});

main_bot.hears('💰 Купить', async ctx => {
    const config = loadJson('config');
    const states = loadStates();
    if (!config.minBuyAmountRubBTC || !config.maxBuyAmountRubBTC || !config.minBuyAmountRubLTC || !config.maxBuyAmountRubLTC) {
        await sendBitCheckPhoto(ctx.chat.id, {
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
    states.pendingDeal[ctx.from.id] = {type: "buy"}
    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption: `💰 Выберите валюту:\n💵 BTC\nМин: ${config.minBuyAmountRubBTC} RUB (~${minBTCAmount} BTC)\nМакс: ${config.maxBuyAmountRubBTC} RUB (~${maxBTCAmount} BTC)\n💵 LTC\nМин: ${config.minBuyAmountRubLTC} RUB (~${minLTCAmount} LTC)\nМакс: ${config.maxBuyAmountRubLTC} RUB (~${maxLTCAmount} LTC)\n${Date.now() - lastPriceUpdate > CACHE_DURATION ? '⚠️ Курс может быть устаревшим' : ''}`,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'BTC', callback_data: 'buy_select_btc' }],
                [{ text: 'LTC', callback_data: 'buy_select_ltc' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
            ]
        }
    });
    states.pendingDeal[ctx.from.id].messageId = message.message_id;
    saveJson('states', states);
});

main_bot.hears('💸 Продать', async ctx => {
    const config = loadJson('config');
    const states = loadStates();
    if (!config.minSellAmountRubBTC || !config.maxSellAmountRubBTC || !config.minSellAmountRubLTC || !config.maxSellAmountRubLTC) {
        await sendBitCheckPhoto(ctx.chat.id, {
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
    states.pendingDeal[ctx.from.id] = { type: 'sell' };
    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption: `💸 Выберите валюту:\n💵 BTC\nМин: ${config.minSellAmountRubBTC} RUB (~${minBTCAmount} BTC)\nМакс: ${config.maxSellAmountRubBTC} RUB (~${maxBTCAmount} BTC)\n💵 LTC\nМин: ${config.minSellAmountRubLTC} RUB (~${minLTCAmount} LTC)\nМакс: ${config.maxSellAmountRubLTC} RUB (~${maxLTCAmount} LTC)\n${Date.now() - lastPriceUpdate > CACHE_DURATION ? '⚠️ Курс может быть устаревшим' : ''}`,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'BTC', callback_data: 'sell_select_btc' }],
                [{ text: 'LTC', callback_data: 'sell_select_ltc' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
            ]
        }
    });
    states.pendingDeal[ctx.from.id].messageId = message.message_id;
    saveJson('states', states);
});

main_bot.hears('🆘 Поддержка', async ctx => {
    const states = loadJson('states');
    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption: '🆘 Напишите нам!',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✉️ Написать', callback_data: 'write_support' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
            ]
        }
    });
    states.pendingSupport[ctx.from.id] = { messageId: message.message_id };
    saveJson('states', states);
});

main_bot.on('message', async ctx => {
    const config = loadJson('config');
    const users = loadJson('users');
    const states = loadStates();
    const id = ctx.from.id;
    const user = users.find(u => u.id === id);
    if (user && user.isBlocked) return;

    if (users.find(u => u.id === id)) {
        if (states.pendingUpdateProfile[id] && states.pendingUpdateProfile[id].type.startsWith('add_')) {
            const type = states.pendingUpdateProfile[id].type.split('_')[1];
            const isSell = type === 'defaultRequisites';
            const wallet = ctx.message.text.trim();

            if (!wallet || !/^[a-zA-Z0-9+,:.'"()-]+$/.test(wallet)) {
                try {
                    await ctx.deleteMessage(states.pendingUpdateProfile[id].messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingUpdateProfile[id].messageId}:`, error.message);
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: isSell ? '❌ Введите корректные реквизиты' : `❌ Введите корректный адрес кошелька для ${type === 'defaultWalletsBTC' ? 'BTC' : 'LTC'}`
                });
                states.pendingUpdateProfile[id].messageId = message.message_id;
                saveJson('states', states);
                return;
            }

            user[type] = user[type] || [];
            user[type].push(wallet);
            saveJson('users', users);

            try {
                await ctx.deleteMessage(states.pendingUpdateProfile[id].messageId);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingUpdateProfile[id].messageId}:`, error.message);
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: isSell ? '✅ Реквизиты добавлены' : '✅ Кошелёк добавлен'
            });
            states.pendingUpdateProfile[id] = { messageId: message.message_id };
            delete states.pendingUpdateProfile[id].type;
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
                        await sendBitCheckPhoto(supportData.targetId, {
                            caption: `📩 Ответ от поддержки:\n${ctx.message.text}`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✉️ Продолжить переписку', callback_data: 'write_support' }],
                                    [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                                ]
                            }
                        });
                        await sendBitCheckPhoto(ctx.chat.id, { caption: `✅ Ответ отправлен пользователю ID ${supportData.targetId}` });
                    } catch (error) {
                        console.error(`Error sending response to user ${supportData.targetId}:`, error.message);
                        await sendBitCheckPhoto(ctx.chat.id, { caption: `❌ Ошибка отправки ответа пользователю ID ${supportData.targetId}` });
                    }
                } else {
                    await sendBitCheckPhoto(ctx.chat.id, { caption: `❌ Пользователь ID ${supportData.targetId} не найден или чат недоступен` });
                }
            } else {
                const u = users.find(u => u.id === id);
                const userDisplay = u && u.username ? `@${u.username}` : `ID ${id}`;

                try {
                    if (states.pendingSupport[id]?.messageId) {
                        await ctx.deleteMessage(states.pendingSupport[id].messageId);
                    }
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingSupport[id]?.messageId}:`, error.message);
                }

                const operatorMessageIds = [];
                states.pendingOperatorMessages[id] = operatorMessageIds;

                const operators = config.multipleOperatorsData || [];
                for (const operator of operators) {
                    try {
                        const operatorId = users.find(u => u.username === operator.username)?.id;
                        if (operatorId && await isValidChat(operatorId)) {
                            const message = await sendBitCheckPhoto(operatorId, {
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

                const message = await sendBitCheckPhoto(ctx.chat.id, { caption: '🚀 Отправлено!' });
                states.pendingSupport[id] = { messageId: message.message_id };
                saveJson('states', states);
            }

            saveJson('states', states);
            return;
        }

        if (states.pendingDeal[id] && states.pendingDeal[id].newWallet) {
            const dealData = states.pendingDeal[id]
            const isBuy = dealData.type === 'buy'
            const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites'
            const wallet = ctx.message.text.trim()

            if (!wallet) {
                try {
                    await ctx.deleteMessage(states.pendingDeal[id].messageId)
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: isBuy ? `❌ Введите корректный адрес кошелька для ${dealData.currency}` : `❌ Введите корректные реквизиты для ${dealData.currency}`
                })
                states.pendingDeal[id].messageId = message.message_id
                saveJson('states', states)
                return
            }

            dealData.wallet = wallet

            try {
                await ctx.deleteMessage(states.pendingDeal[id].messageId)
            } catch (error) {
                console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
            }

            const actionText = isBuy ? 'кошелёк' : 'реквизиты'
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `📝 Хотите ли добавить ${actionText} как постоянный?\n${wallet}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: `save_wallet_no_${wallet}` }, { text: 'Да', callback_data: `save_wallet_yes_${wallet}` }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            })
            states.pendingDeal[id].messageId = message.message_id
            states.pendingDeal[id].action = 'save_wallet'
            states.pendingDeal[id].walletType = walletType
            saveJson('states', states)
            return
        }

        if (states.pendingDeal[id] && states.pendingDeal[id].amount && !states.pendingDeal[id].wallet) {
            const dealData = states.pendingDeal[id]
            const isBuy = dealData.type === 'buy'
            const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites'
            const wallets = user[walletType] || []

            if (wallets.length > 0) {
                try {
                    await ctx.deleteMessage(states.pendingDeal[id].messageId)
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
                }

                const caption = isBuy ? `💼 Выберите кошелёк для <b>${dealData.currency}</b>:\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}` : `💼 Выберите реквизиты для продажи ${dealData.currency}:\n${wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n')}`
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: {
                        inline_keyboard: [
                            ...wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_wallet_${index}` }]),
                            [{ text: '➕ Новый', callback_data: `add_wallet` }],
                            [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                        ]
                    },
                    parse_mode: isBuy ? 'HTML' : undefined
                })
                states.pendingDeal[id].messageId = message.message_id
                states.pendingDeal[id].action = 'select_wallet'
                states.pendingDeal[id].walletType = walletType
                saveJson('states', states)
                return
            }

            const caption = isBuy ? `💼 Введите адрес кошелька для ${dealData.currency}` : `💼 Введите реквизиты (СБП или номер карты)`
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            })
            states.pendingDeal[id].messageId = message.message_id
            states.pendingDeal[id].newWallet = true
            saveJson('states', states)
            return
        }

        if (states.pendingDeal[id]) {
            let input = ctx.message.text.trim()
            let isCryptoInput = false, amount, rub, rubBefore
            const dealData = states.pendingDeal[id]
            const isBuy = dealData.type === 'buy'
            const currency = dealData.currency
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice()
            const minAmountRub = currency === 'BTC' ? (isBuy ? config.minBuyAmountRubBTC : config.minSellAmountRubBTC) : (isBuy ? config.minBuyAmountRubLTC : config.minSellAmountRubLTC)
            const maxAmountRub = currency === 'BTC' ? (isBuy ? config.maxBuyAmountRubBTC : config.maxSellAmountRubBTC) : (isBuy ? config.maxBuyAmountRubLTC : config.maxSellAmountRubLTC)
            const minBTCAmount = (currency === 'BTC' ? minAmountRub : config.minBuyAmountRubBTC / await getBtcRubPrice()).toFixed(8)
            const maxBTCAmount = (currency === 'BTC' ? maxAmountRub : config.maxBuyAmountRubBTC / await getBtcRubPrice()).toFixed(8)
            const minLTCAmount = (currency === 'LTC' ? minAmountRub : config.minBuyAmountRubLTC / await getLtcRubPrice()).toFixed(8)
            const maxLTCAmount = (currency === 'LTC' ? maxAmountRub : config.maxBuyAmountRubLTC / await getLtcRubPrice()).toFixed(8)

            const inputValue = parseFloat(input)
            if (isNaN(inputValue) || inputValue <= 0) {
                try {
                    await ctx.deleteMessage(states.pendingDeal[id].messageId)
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `❌ Введите корректную сумму в RUB или ${currency}`
                })
                states.pendingDeal[id].messageId = message.message_id
                saveJson('states', states)
                return
            }

            if (currency === 'BTC') {
                isCryptoInput = inputValue < 1
            } else if (currency === 'LTC') {
                isCryptoInput = inputValue < (isBuy ? 100 : 1000)
            }

            const discount = await getCommissionDiscount(id)
            const commission = await calculateCommission(isCryptoInput ? inputValue * price : inputValue, currency, dealData.type)
            const effectiveCommission = Math.round(commission * (1 - discount / 100))

            if (isCryptoInput) {
                amount = inputValue
                rubBefore = amount * price
                rub = isBuy ? rubBefore : rubBefore - effectiveCommission
            } else {
                rubBefore = inputValue
                amount = rubBefore / price
                rub = isBuy ? rubBefore : rubBefore - effectiveCommission
            }

            const total = isBuy ? rub + effectiveCommission : rub

            if (rubBefore < minAmountRub || rubBefore > maxAmountRub) {
                try {
                    await ctx.deleteMessage(states.pendingDeal[id].messageId)
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `Мин: ${minAmountRub} RUB (~${minBTCAmount} BTC, ~${minLTCAmount} LTC)\nМакс: ${maxAmountRub} RUB (~${maxBTCAmount} BTC, ~${maxLTCAmount} LTC)`
                })
                states.pendingDeal[id].messageId = message.message_id
                clearPendingStates(states, id)
                saveJson('states', states)
                return
            }

            const walletType = isBuy ? `defaultWallets${currency}` : 'defaultRequisites'
            const wallets = user[walletType] || []

            dealData.amount = amount
            dealData.rub = rub
            dealData.commission = effectiveCommission
            dealData.total = total
            dealData.rubBefore = rubBefore

            if (wallets.length > 0) {
                const caption = isBuy ? `💼 Выберите кошелёк для <b>${currency}</b>:\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}` : `💼 Выберите реквизиты для продажи ${currency}:\n${wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n')}`
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: {
                        inline_keyboard: [
                            ...wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_wallet_${index}` }]),
                            [{ text: '➕ Новый', callback_data: `add_wallet` }],
                            [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                        ]
                    },
                    parse_mode: isBuy ? 'HTML' : undefined
                })
                states.pendingDeal[id].messageId = message.message_id
                states.pendingDeal[id].action = 'select_wallet'
                states.pendingDeal[id].walletType = walletType
                saveJson('states', states)
                return
            }

            const caption = isBuy ? `💼 Введите адрес кошелька для ${currency}` : `💼 Введите реквизиты (СБП или номер карты)`
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            })
            states.pendingDeal[id].messageId = message.message_id
            states.pendingDeal[id].newWallet = true
            saveJson('states', states)
            return
        }

        if (states.pendingWithdrawal[id] && states.pendingWithdrawal[id].amount && !states.pendingWithdrawal[id].wallet) {
            const wallet = ctx.message.text.trim();
            if (!wallet || wallet.length < 10) {
                try {
                    await ctx.deleteMessage(states.pendingWithdrawal[id].messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingWithdrawal[id].messageId}:`, error.message);
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `❌ Введите корректный адрес кошелька для BTC`
                });
                states.pendingWithdrawal[id].messageId = message.message_id;
                saveJson('states', states);
                return;
            }

            states.pendingWithdrawal[id].wallet = wallet;

            try {
                await ctx.deleteMessage(states.pendingWithdrawal[id].messageId);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingWithdrawal[id].messageId}:`, error.message);
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `📝 Хотите ли добавить кошелёк как постоянный?\n${wallet}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: `save_withdrawal_wallet_no_${wallet}` }, { text: 'Да', callback_data: `save_withdrawal_wallet_yes_${wallet}` }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingWithdrawal[id].messageId = message.message_id;
            states.pendingWithdrawal[id].action = 'save_withdrawal_wallet';
            states.pendingWithdrawal[id].withdrawal = {
                id: Date.now().toString(),
                userId: user.id,
                username: user.username || 'Нет',
                rubAmount: Number(states.pendingWithdrawal[id].rubAmount.toFixed(2)),
                cryptoAmount: Number(states.pendingWithdrawal[id].amount.toFixed(8)),
                walletAddress: wallet,
                status: 'pending',
                timestamp: new Date().toISOString()
            };
            saveJson('states', states);
            return;
        }

        if (states.pendingWithdrawal[id]) {
            const input = ctx.message.text.trim();
            const priceBTC = await getBtcRubPrice();
            const inputValue = parseFloat(input);
            let amount, rubAmount;

            const users = loadJson('users');
            const user = users.find(u => u.id === id);
            const earningsRub = user.balance * priceBTC;
            const config = loadJson('config');
            const minWithdrawRub = config.minWithdrawAmountRub;

            if (isNaN(inputValue) || inputValue <= 0) {
                try {
                    await ctx.deleteMessage(states.pendingWithdrawal[id].messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingWithdrawal[id].messageId}:`, error.message);
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: '❌ Введите корректную сумму в RUB или BTC'
                });
                states.pendingWithdrawal[id].messageId = message.message_id;
                saveJson('states', states);
                return;
            }

            const isCryptoInput = inputValue < 1;

            if (isCryptoInput) {
                amount = inputValue;
                rubAmount = amount * priceBTC;
            } else {
                rubAmount = inputValue;
                amount = rubAmount / priceBTC;
            }

            if (amount > user.balance || rubAmount < minWithdrawRub) {
                try {
                    await ctx.deleteMessage(states.pendingWithdrawal[id].messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingWithdrawal[id].messageId}:`, error.message);
                }
                const missingRub = minWithdrawRub - rubAmount;
                const caption = rubAmount < minWithdrawRub
                    ? `❌ Введенная сумма слишком мала\n` +
                    `Мин: ${minWithdrawRub.toFixed(2)} RUB (~${(minWithdrawRub / priceBTC).toFixed(8)} BTC)\n` +
                    `Введено: ${rubAmount.toFixed(2)} RUB (~${amount.toFixed(8)} BTC)\n` +
                    `Не хватает: ${missingRub.toFixed(2)} RUB (~${(missingRub / priceBTC).toFixed(8)} BTC)`
                    : `❌ Введенная сумма превышает ваш баланс\n` +
                    `Макс: ${earningsRub.toFixed(2)} RUB (~${user.balance.toFixed(8)} BTC)\n` +
                    `Введено: ${rubAmount.toFixed(2)} RUB (~${amount.toFixed(8)} BTC)`;
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                    }
                });
                states.pendingWithdrawal[id].messageId = message.message_id;
                saveJson('states', states);
                return;
            }

            try {
                await ctx.deleteMessage(states.pendingWithdrawal[id].messageId);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingWithdrawal[id].messageId}:`, error.message);
            }

            states.pendingWithdrawal[id].amount = amount;
            states.pendingWithdrawal[id].rubAmount = rubAmount;

            const wallets = user.defaultWalletsBTC || [];

            if (!wallets.length) {
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: '💼 Введите адрес кошелька для BTC',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                    }
                });
                states.pendingWithdrawal[id].messageId = message.message_id;
                states.pendingWithdrawal[id].newWallet = true;
                saveJson('states', states);
                return;
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `💼 Выберите кошелёк:\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`,
                reply_markup: {
                    inline_keyboard: [
                        ...(wallets.length > 0 ? wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_withdrawal_wallet_${index}` }]) : []),
                        [{ text: '➕ Новый', callback_data: 'add_withdrawal_wallet' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                },
                parse_mode: 'HTML'
            });
            states.pendingWithdrawal[id].messageId = message.message_id;
            states.pendingWithdrawal[id].action = 'select_withdrawal_wallet';
            states.pendingWithdrawal[id].walletType = 'defaultWalletsBTC';
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

        const users = loadJson('users');
        const deals = loadJson('deals');
        const withdrawals = loadJson('withdrawals');

        if (data.startsWith('view_raffle_results_')) {
            const raffleId = data.split('_')[3];
            const raffles = loadJson('raffles') || [];
            const raffle = raffles.find(r => r.id === raffleId);
            if (!raffle) {
                await ctx.answerCbQuery('❌ Розыгрыш не найден', { show_alert: true });
                return;
            }

            const { outputPath } = generateRaffleResults(raffle);
            try {
                await ctx.telegram.sendDocument(from, {
                    source: outputPath,
                    filename: `raffle_results_${raffle.id}.txt`
                });
                await ctx.answerCbQuery('✅ Результаты отправлены', { show_alert: false });
            } catch (error) {
                console.error(`Error sending raffle results file to user ${from}:`, error.message);
                await ctx.answerCbQuery('❌ Ошибка при отправке файла', { show_alert: true });
            }
            return;
        }

        if (data.startsWith('select_wallet_')) {
            const states = loadStates();
            const index = parseInt(data.split('_')[2]);

            if (!states.pendingDeal[from] || states.pendingDeal[from].action !== 'select_wallet' || !states.pendingDeal[from].walletType) {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const walletType = states.pendingDeal[from].walletType;
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            const wallet = user[walletType]?.[index];

            if (!wallet) {
                console.error(`Wallet not found for walletType: ${walletType}, index: ${index}`);
                await ctx.answerCbQuery('❌ Кошелёк не найден', { show_alert: true });
                return;
            }

            await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
            });

            states.pendingDeal[from].wallet = wallet;
            const isSell = walletType === 'defaultRequisites';
            const config = loadJson('config');
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `💎 Хотите ли вы, чтобы ваша сделка стала выше в очереди? (Цена ${config.priorityPriceRub} RUB)`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: 'priority_normal' }, { text: 'Да', callback_data: 'priority_elevated' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingDeal[from].messageId = message.message_id;
            states.pendingDeal[from].action = 'select_priority';
            saveJson('states', states);
            await ctx.answerCbQuery(`✅ Выбран ${isSell ? 'реквизит' : 'кошелёк'}: ${wallet}`, { show_alert: false });
            return;
        }

        if (data === 'add_wallet') {
            const states = loadStates();

            if (!states.pendingDeal[from] || !states.pendingDeal[from].currency || !states.pendingDeal[from].walletType) {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const walletType = states.pendingDeal[from].walletType;
            const isSell = walletType === 'defaultRequisites';

            await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
            });

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: isSell ? '💼 Введите реквизиты (СБП или номер карты)' : `💼 Введите адрес кошелька для ${states.pendingDeal[from].currency}`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });

            states.pendingDeal[from].messageId = message.message_id;
            states.pendingDeal[from].newWallet = true;
            states.pendingDeal[from].action = 'select_wallet';
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('save_wallet_')) {
            const parts = data.split('_');
            const isYes = parts[2] === 'yes';
            const wallet = parts.slice(3).join('_');
            const states = loadStates();

            if (!states.pendingDeal[from] || !states.pendingDeal[from].walletType || states.pendingDeal[from].action !== 'save_wallet') {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const walletType = states.pendingDeal[from].walletType;
            const isSell = walletType === 'defaultRequisites';

            if (isYes) {
                const users = loadJson('users');
                const user = users.find(u => u.id === from);
                user[walletType] = user[walletType] || [];
                if (!user[walletType].includes(wallet)) {
                    user[walletType].push(wallet);
                    saveJson('users', users);
                }
            }

            await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
            });

            const config = loadJson('config');
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `💎 Хотите ли вы, чтобы ваша сделка стала выше в очереди? (Цена ${config.priorityPriceRub} RUB)`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: 'priority_normal' }, { text: 'Да', callback_data: 'priority_elevated' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingDeal[from].messageId = message.message_id;
            states.pendingDeal[from].action = 'select_priority';
            saveJson('states', states);
            await ctx.answerCbQuery(isYes ? `✅ ${isSell ? 'Реквизит' : 'Кошелёк'} сохранён как постоянный` : `✅ ${isSell ? 'Реквизит' : 'Кошелёк'} не сохранён`, { show_alert: false });
            return;
        }

        if (data === 'update_details') {
            const states = loadStates();
            const message = await sendBitCheckPhoto(ctx.chat.id, {
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
            states.pendingUpdateProfile[from] = { messageId: message.message_id };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'update_buy_btc' || data === 'update_buy_ltc' || data === 'update_sell') {
            const states = loadStates();
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            const type = data === 'update_buy_btc' ? 'defaultWalletsBTC' : data === 'update_buy_ltc' ? 'defaultWalletsLTC' : 'defaultRequisites';
            const isSell = data === 'update_sell';
            const wallets = user[type] || [];
            let caption = isSell ? 'Ваши постоянные реквизиты для продажи:\n' : `Ваши постоянные кошельки для покупки ${type === 'defaultWalletsBTC' ? 'BTC' : 'LTC'}:\n`;

            await ctx.deleteMessage(states.pendingUpdateProfile[from]?.messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingUpdateProfile[from]?.messageId}:`, error.message);
            });

            if (wallets.length === 0) {
                caption = isSell ? 'Вы ещё не добавляли постоянные реквизиты' : 'Вы ещё не добавляли постоянные кошельки';
            } else {
                caption += wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n');
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
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
            states.pendingUpdateProfile[from] = { messageId: message.message_id, action: 'select_delete', walletType: type };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('select_delete_')) {
            const states = loadStates();
            const updateProfileData = states.pendingUpdateProfile[from];
            if (!updateProfileData || !updateProfileData.walletType || updateProfileData.action !== 'select_delete') {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const users = loadJson('users');
            const user = users.find(u => u.id === from);

            const type = updateProfileData.walletType;
            const isSell = type === 'defaultRequisites';

            const wallets = user[type] || [];

            await ctx.deleteMessage(updateProfileData.messageId).catch(error => {
                console.error(`Error deleting message ${updateProfileData.messageId}:`, error.message);
            });

            let caption = isSell ? '📝 Какой реквизит вы хотите удалить?\n' : `📝 Какой кошелёк вы хотите удалить?\n`;
            caption += wallets.map((wallet, index) => `${index + 1}) ${wallet}`).join('\n');

            const inlineKeyboard = wallets.map((wallet, index) => [{
                text: `${index + 1}`,
                callback_data: `delete_wallet_${index}`
            }]);

            inlineKeyboard.push([{ text: '❌ Отменить', callback_data: 'cancel_action' }]);

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            });
            states.pendingUpdateProfile[from] = { messageId: message.message_id, action: 'delete_wallet', walletType: type };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('delete_wallet_')) {
            const states = loadStates();
            const updateProfileData = states.pendingUpdateProfile[from];
            if (!updateProfileData || !updateProfileData.walletType || updateProfileData.action !== 'delete_wallet') {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const index = parseInt(data.split('_')[2]);

            const users = loadJson('users');
            const user = users.find(u => u.id === from);

            const type = updateProfileData.walletType;
            const isSell = type === 'defaultRequisites';

            user[type].splice(index, 1);
            saveJson('users', users);

            await ctx.deleteMessage(updateProfileData.messageId).catch(error => {
                console.error(`Error deleting message ${updateProfileData.messageId}:`, error.message);
            });

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: isSell ? '✅ Реквизит удалён' : '✅ Кошелёк удалён'
            });
            states.pendingUpdateProfile[from] = { messageId: message.message_id };
            saveJson('states', states);
            await ctx.answerCbQuery(isSell ? '✅ Реквизит удалён' : '✅ Кошелёк удалён', { show_alert: false });
            return;
        }

        if (data.startsWith('add_detail_')) {
            const states = loadStates();
            const type = data.split('_')[2];
            const isSell = type === 'defaultRequisites';
            states.pendingUpdateProfile[from] = { type: `add_${type}` };

            await ctx.deleteMessage(states.pendingUpdateProfile[from]?.messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingUpdateProfile[from]?.messageId}:`, error.message);
            });

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: isSell ? 'Введите реквизиты (СБП или номер карты)' : `Введите адрес кошелька для ${type === 'defaultWalletsBTC' ? 'BTC' : 'LTC'}`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingUpdateProfile[from].messageId = message.message_id;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('select_withdrawal_wallet_')) {
            const states = loadStates();
            const index = parseInt(data.split('_')[3]);
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            const wallet = user.defaultWalletsBTC?.[index];

            if (!wallet) {
                console.error(`Wallet not found for index: ${index}`);
                await ctx.answerCbQuery('❌ Кошелёк не найден', { show_alert: true });
                return;
            }

            const withdrawData = states.pendingWithdrawal[from];
            if (!withdrawData || !withdrawData.amount || !withdrawData.rubAmount) {
                console.error(`Invalid or missing withdrawal data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            try {
                await ctx.deleteMessage(withdrawData.messageId);
            } catch (error) {
                console.error(`Error deleting message ${withdrawData.messageId}:`, error.message);
            }

            const withdrawal = {
                id: Date.now().toString(),
                userId: user.id,
                username: user.username || 'Нет',
                rubAmount: Number(withdrawData.rubAmount.toFixed(2)),
                cryptoAmount: Number(withdrawData.amount.toFixed(8)),
                walletAddress: wallet,
                status: 'pending',
                timestamp: new Date().toISOString()
            };

            withdrawals.push(withdrawal);
            saveJson('withdrawals', withdrawals);

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `✅ Заявка на вывод рефералов создана! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC (~${withdrawal.rubAmount.toFixed(2)} RUB)\nКошелёк: <code>${withdrawal.walletAddress}</code>`,
                parse_mode: 'HTML'
            });
            states.pendingWithdrawal[from] = { messageId: message.message_id };

            const operators = getOperators('BTC');
            for (const operator of operators) {
                try {
                    const operatorId = users.find(u => u.username === operator.username)?.id;
                    if (operatorId && await isValidChat(operatorId)) {
                        await sendBitCheckPhoto(operatorId, {
                            caption: `🆕 Новая заявка на вывод рефералов № ${withdrawal.id}\n@${user.username || 'Нет'} (ID ${user.id})\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nКошелёк: <code>${withdrawal.walletAddress}</code>`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✅ Завершить', callback_data: `operator_complete_withdrawal_${withdrawal.id}` }],
                                    [{ text: '📞 Написать пользователю', url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${user.id}` }]
                                ]
                            },
                            parse_mode: 'HTML'
                        });
                    }
                } catch (error) {
                    console.error(`Error sending to operator ${operator.username}:`, error.message);
                }
            }

            user.balance = Number((user.balance - withdrawal.cryptoAmount).toFixed(8));
            saveJson('users', users);

            delete states.pendingWithdrawal[from];
            saveJson('states', states);
            await ctx.answerCbQuery(`✅ Выбран кошелёк: ${wallet}`, { show_alert: false });
            return;
        }

        if (data === 'add_withdrawal_wallet') {
            const states = loadStates();
            const withdrawData = states.pendingWithdrawal[from];
            if (!withdrawData || !withdrawData.amount || !withdrawData.rubAmount) {
                console.error(`Invalid or missing withdrawal data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: данные для вывода не найдены', { show_alert: true });
                return;
            }

            try {
                await ctx.deleteMessage(withdrawData.messageId);
            } catch (error) {
                console.error(`Error deleting message ${withdrawData.messageId}:`, error.message);
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: '💼 Введите адрес кошелька для BTC',
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingWithdrawal[from] = {
                messageId: message.message_id,
                type: 'withdrawal',
                currency: 'BTC',
                amount: withdrawData.amount,
                rubAmount: withdrawData.rubAmount,
                newWallet: true
            };
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data.startsWith('save_withdrawal_wallet_')) {
            const parts = data.split('_');
            const isYes = parts[2] === 'yes';
            const wallet = parts.slice(3).join('_');
            const states = loadStates();
            const withdrawData = states.pendingWithdrawal[from];

            if (!withdrawData || withdrawData.action !== 'save_withdrawal_wallet' || !withdrawData.withdrawal) {
                console.error(`Invalid or missing withdrawal data for user ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const users = loadJson('users');
            const user = users.find(u => u.id === from);

            if (isYes) {
                user.defaultWalletsBTC = user.defaultWalletsBTC || [];
                if (!user.defaultWalletsBTC.includes(wallet)) {
                    user.defaultWalletsBTC.push(wallet);
                    saveJson('users', users);
                }
            }

            const withdrawal = withdrawData.withdrawal;
            withdrawals.push(withdrawal);

            user.balance = Number((user.balance - withdrawal.cryptoAmount).toFixed(8));

            try {
                await ctx.deleteMessage(withdrawData.messageId);
            } catch (error) {
                console.error(`Error deleting message ${withdrawData.messageId}:`, error.message);
            }

            const contactUrl = getContactUrl('BTC');
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `✅ Заявка на вывод рефералов создана! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC (~${withdrawal.rubAmount.toFixed(2)} RUB)\nКошелёк: <code>${withdrawal.walletAddress}</code>`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📞 Написать оператору', url: contactUrl }]
                    ]
                },
                parse_mode: 'HTML'
            });
            states.pendingWithdrawal[from] = { messageId: message.message_id };

            const operators = getOperators('BTC');
            for (const operator of operators) {
                try {
                    const operatorId = users.find(u => u.username === operator.username)?.id;
                    if (operatorId && await isValidChat(operatorId)) {
                        await sendBitCheckPhoto(operatorId, {
                            caption: `🆕 Новая заявка на вывод рефералов № ${withdrawal.id}\n@${user.username || 'Нет'} (ID ${user.id})\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nКошелёк: <code>${withdrawal.walletAddress}</code>`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '✅ Завершить', callback_data: `operator_complete_withdrawal_${withdrawal.id}` }],
                                    [{ text: '📞 Написать пользователю', url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${user.id}` }]
                                ]
                            },
                            parse_mode: 'HTML'
                        });
                    }
                } catch (error) {
                    console.error(`Error sending to operator ${operator.username}:`, error.message);
                }
            }

            delete states.pendingWithdrawal[from];
            saveJson('withdrawals', withdrawals);
            saveJson('states', states);
            saveJson('users', users);
            await ctx.answerCbQuery(isYes ? '✅ Кошелёк сохранён как постоянный' : '✅ Кошелёк не сохранён', { show_alert: false });
            return;
        }

        if (data.startsWith('captcha_')) {
            const states = loadStates();
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
                                await sendBitCheckPhoto(referrer.id, { caption: `👥 ${ctx.from.first_name || 'Пользователь'} приглашён!` });
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
                        defaultWalletsBTC: [],
                        defaultWalletsLTC: [],
                        defaultRequisites: []
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

                await sendBitCheckPhoto(ctx.chat.id, {
                    caption: profileText,
                    reply_markup: {
                        keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '🤝 Партнёрство'], ['💬 Чат', '💬 Отзывы'], ['🆘 Поддержка']],
                        resize_keyboard: true
                    }
                });
                await ctx.answerCbQuery('✅ Капча пройдена', { show_alert: false });

                saveJson('users', users);
                saveJson('states', states);
            } else {
                const correctFruit = ['🍒', '🍏', '🥕', '🍌', '🍋', '🍐'][Math.floor(Math.random() * 6)];
                states.pendingCaptcha[from] = { correct: correctFruit, invitedBy: captchaData.invitedBy };
                await sendBitCheckPhoto(ctx.chat.id, {
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
            return;
        }

        if (data === 'write_support') {
            const states = loadStates();
            try {
                await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
            } catch (error) {
                console.error(`Error deleting message ${ctx.callbackQuery.message.message_id}:`, error.message);
            }

            states.pendingSupport[from] = {};
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: '✉️ Напишите:',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
            states.pendingSupport[from].messageId = message.message_id;
            saveJson('states', states);
            return;
        }

        if (data.startsWith('operator_reply_')) {
            const states = loadStates();
            const targetId = parseInt(data.split('_')[2]);
            if (states.pendingOperatorMessages[targetId]) {
                for (const { operatorId, messageId } of states.pendingOperatorMessages[targetId]) {
                    await main_bot.telegram.deleteMessage(operatorId, messageId).catch(error => {
                        console.error(`Error deleting message ${messageId} for operator ${operatorId}:`, error.message);
                    });
                }
                delete states.pendingOperatorMessages[targetId];
            }
            const message = await sendBitCheckPhoto(ctx.chat.id, { caption: `✉️ Введите ответ для ID ${targetId}:` });
            states.pendingSupport[from] = { targetId, messageId: message.message_id };
            saveJson('states', states);
            return;
        }

        if (data === 'close_conv') {
            const states = loadStates();
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
            const states = loadStates();
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            const config = loadJson('config');
            if (!user || !user.balance) {
                await ctx.answerCbQuery('❌ Нет средств для вывода', { show_alert: false });
                saveJson('states', states);
                return;
            }

            const priceBTC = await getBtcRubPrice();
            const earningsRub = user.balance * priceBTC;
            const minWithdrawRub = config.minWithdrawAmountRub;

            if (earningsRub < minWithdrawRub) {
                const missingRub = minWithdrawRub - earningsRub;
                try {
                    if (states.pendingWithdrawal[from]?.messageId) {
                        await ctx.deleteMessage(states.pendingWithdrawal[from].messageId);
                    }
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingWithdrawal[from]?.messageId}:`, error.message);
                }

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `❌ Ваша сумма слишком мала для вывода\n` +
                        `Мин: ${minWithdrawRub.toFixed(2)} RUB (~${(minWithdrawRub / priceBTC).toFixed(8)} BTC)\n` +
                        `У вас: ${earningsRub.toFixed(2)} RUB (~${user.balance.toFixed(8)} BTC)\n` +
                        `Не хватает: ${missingRub.toFixed(2)} RUB (~${(missingRub / priceBTC).toFixed(8)} BTC)`
                });
                states.pendingWithdrawal[from] = { messageId: message.message_id };
                saveJson('states', states);
                return;
            }

            try {
                if (states.pendingWithdrawal[from]?.messageId) {
                    await ctx.deleteMessage(states.pendingWithdrawal[from].messageId);
                }
            } catch (error) {
                console.error(`Error deleting message ${states.pendingWithdrawal[from]?.messageId}:`, error.message);
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `💰 Введите сумму для вывода (в BTC или RUB)\n` +
                    `Мин: ${minWithdrawRub.toFixed(2)} RUB (~${(minWithdrawRub / priceBTC).toFixed(8)} BTC)\n` +
                    `Макс: ${earningsRub.toFixed(2)} RUB (~${user.balance.toFixed(8)} BTC)`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingWithdrawal[from] = { messageId: message.message_id };
            saveJson('states', states);
            return;
        }

        if (data === 'buy_select_btc' || data === 'buy_select_ltc') {
            const states = loadStates();
            const currency = data === 'buy_select_btc' ? 'BTC' : 'LTC';
            states.pendingDeal[from] = states.pendingDeal[from] || {};
            states.pendingDeal[from].currency = currency;

            const config = loadJson('config');
            const minAmountRub = currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC;
            const maxAmountRub = currency === 'BTC' ? config.maxBuyAmountRubBTC : config.maxBuyAmountRubLTC;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minAmountCrypto = (minAmountRub / price).toFixed(8);
            const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

            if (states.pendingDeal[from].messageId) {
                await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                    console.error(`Ошибка удаления сообщения ${states.pendingDeal[from].messageId}:`, error.message);
                });
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `💰 Введите сумму для покупки ${currency} (в RUB или ${currency})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });
            states.pendingDeal[from].messageId = message.message_id;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'add_wallet') {
            const states = loadStates();
            const dealData = states.pendingDeal[from];

            if (!dealData || !dealData.currency) {
                console.error(`Некорректные или отсутствующие данные для пользователя ${from}`);
                await ctx.answerCbQuery('❌ Ошибка: некорректные данные', { show_alert: true });
                return;
            }

            const isBuy = dealData.type === 'buy';
            const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites';

            await ctx.deleteMessage(dealData.messageId).catch(error => {
                console.error(`Ошибка удаления сообщения ${dealData.messageId}:`, error.message);
            });

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: isBuy ? `💼 Введите адрес кошелька для ${dealData.currency}` : `💼 Введите реквизиты (СБП или номер карты)`,
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                }
            });

            dealData.messageId = message.message_id;
            dealData.newWallet = true;
            dealData.action = 'select_wallet';
            dealData.walletType = walletType;
            saveJson('states', states);
            await ctx.answerCbQuery();
            return;
        }

        if (data === 'priority_normal' || data === 'priority_elevated') {
            const states = loadStates();
            const priority = data === 'priority_normal' ? 'normal' : 'elevated';
            const dealData = states.pendingDeal[from];

            if (!dealData) {
                await ctx.answerCbQuery('❌ Данные сделки не найдены', { show_alert: true });
                return;
            }

            const config = loadJson('config');
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            if (user && user.isBlocked) return;

            const rubBefore = dealData.rubBefore || 0;
            const rub = dealData.rub || 0;
            const commission = dealData.commission || 0;
            const amount = dealData.amount || 0;
            const discount = await getCommissionDiscount(from);
            const priorityPrice = priority === 'elevated' ? config.priorityPriceRub : 0;

            const deal = {
                id: Date.now().toString(),
                userId: user.id,
                username: user?.username ? `${user.username}` : 'Нет',
                type: dealData.type,
                currency: dealData.currency,
                rubAmount: dealData.type === 'sell' ? Number(rubBefore.toFixed(2)) : Number(rub.toFixed(2)),
                cryptoAmount: Number(amount.toFixed(8)),
                commission: Number(commission.toFixed(2)),
                total: dealData.type === 'sell'
                    ? Number((rubBefore - commission - (priority === 'elevated' ? priorityPrice : 0)).toFixed(2))
                    : Number((rub + commission + priorityPrice).toFixed(2)),
                walletAddress: dealData.wallet,
                status: 'draft',
                priority: priority,
                timestamp: new Date().toISOString(),
            };

            try {
                await ctx.deleteMessage(dealData.messageId);
            } catch (error) {
                console.error(`Ошибка удаления сообщения ${dealData.messageId}:`, error.message);
            }

            const actionText = dealData.type === 'buy' ? 'покупки' : 'продажи';
            const paymentTarget = dealData.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const message = await sendBitCheckPhoto(ctx.chat.id, {
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
            dealData.messageId = message.message_id;
            dealData.dealId = deal.id;
            deals.push(deal);
            delete dealData.action;
            delete dealData.walletType;
            delete dealData.newWallet;
            saveJson('states', states);
            saveJson('deals', deals);
            await ctx.answerCbQuery(`✅ Выбран приоритет: ${priority === 'elevated' ? 'Повышенный' : 'Обычный'}`, { show_alert: false });
            return;
        }

        if (data.startsWith('submit_')) {
            const states = loadStates();
            const dealId = data.split('_')[1];
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'draft');
            if (dealIndex === -1) {
                await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                return;
            }

            const deal = deals[dealIndex];
            deal.status = deal.type === 'buy' ? 'unpaid' : 'pending';
            deals[dealIndex] = deal;

            const users = loadJson('users');
            const user = users.find(u => u.id === deal.userId);
            const config = loadJson('config');
            const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const contactUrl = getContactUrl(deal.currency);
            const discount = await getCommissionDiscount(deal.userId);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;

            let paymentDetailsText;
            if (deal.type === 'buy') {
                paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                const selectedPaymentDetails = getBalancedPaymentDetails(config.buyPaymentDetails || []);
                if (selectedPaymentDetails) {
                    deal.selectedPaymentDetailsId = selectedPaymentDetails.id;
                    const paymentDetailsIndex = config.buyPaymentDetails.findIndex(detail => detail.id === selectedPaymentDetails.id);
                    if (paymentDetailsIndex !== -1) {
                        config.buyPaymentDetails[paymentDetailsIndex].timestamp = new Date().toISOString();
                        saveJson('config', config);
                    }
                    paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>Оплату переводите строго по реквизитам ниже ⚠️ Время на оплату — ${config.paymentDetailsRecoveryTimeMinutes} минут ⏱️ Затем пришлите заявку и чек оператору ⚠️\n${selectedPaymentDetails.description}</code>`;
                } else {
                    paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>Не удалось выбрать реквизиты, свяжитесь с оператором.</code>`;
                }
            } else {
                const bitCheckWallet = deal.currency === 'BTC' ? config.sellWalletBTC : config.sellWalletLTC;
                paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                paymentDetailsText += `\n\n${deal.currency} кошелёк BitCheck:\n<code>${bitCheckWallet}</code>`;
            }

            try {
                await ctx.deleteMessage(states.pendingDeal[deal.userId]?.messageId);
            } catch (error) {
                console.error(`Ошибка удаления сообщения ${states.pendingDeal[deal.userId]?.messageId}:`, error.message);
            }

            const caption = `✅ Заявка на сделку создана! № ${deal.id}\n` +
                `${actionText} ${deal.currency}\n` +
                `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                `Сумма: ${deal.rubAmount} RUB\n` +
                `Комиссия: ${deal.commission.toFixed(2)} RUB (скидка ${discount}%)\n` +
                `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                `Итог: ${deal.total.toFixed(2)} RUB\n` +
                `${paymentDetailsText}\n\n` +
                `${deal.type === 'buy'
                    ? 'Пожалуйста, произведите оплату по указанным реквизитам и подтвердите, нажав "Оплата выполнена".'
                    : 'Отправьте указанное количество на кошелёк BitCheck и свяжитесь с оператором для завершения сделки!'} ⬇️`;

            const replyMarkup = deal.type === 'buy' ? {
                inline_keyboard: [
                    [{ text: '✅ Оплата выполнена', callback_data: `payment_done_${deal.id}` }],
                    [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                ]
            } : {
                inline_keyboard: [
                    [{ text: '📞 Написать оператору', url: contactUrl }],
                    [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                ]
            };

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: replyMarkup,
                parse_mode: 'HTML'
            });
            states.pendingDeal[deal.userId] = { messageId: message.message_id, dealId: deal.id };

            if (deal.type !== 'buy') {
                const operators = getOperators(deal.currency);
                for (const operator of operators) {
                    try {
                        const operatorId = users.find(u => u.username === operator.username)?.id;
                        if (operatorId && await isValidChat(operatorId)) {
                            await sendBitCheckPhoto(operatorId, {
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
                        console.error(`Ошибка отправки оператору ${operator.username}:`, error.message);
                    }
                }
            }

            await ctx.answerCbQuery('✅ Заявка создана', { show_alert: false });
            saveJson('deals', deals);
            saveJson('states', states);
            return;
        }

        if (data.startsWith('payment_done_')) {
            const states = loadStates();
            const dealId = data.split('_')[2];
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'unpaid');
            if (dealIndex === -1) {
                await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                return;
            }

            const deal = deals[dealIndex];
            deal.status = 'pending';
            deals[dealIndex] = deal;

            const users = loadJson('users');
            const user = users.find(u => u.id === deal.userId);
            const config = loadJson('config');
            const contactUrl = getContactUrl(deal.currency);
            const discount = await getCommissionDiscount(deal.userId);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;

            if (deal.selectedPaymentDetailsId) {
                const paymentDetailsIndex = config.buyPaymentDetails.findIndex(detail => detail.id === deal.selectedPaymentDetailsId);
                if (paymentDetailsIndex !== -1) {
                    config.buyPaymentDetails[paymentDetailsIndex].confirmedUsages++;
                    saveJson('config', config);
                } else {
                    console.error('Реквизиты не найдены в config.buyPaymentDetails:', deal.selectedPaymentDetailsId);
                }
            } else {
                console.error('ID реквизитов не найден для сделки:', deal.id);
            }

            try {
                await ctx.deleteMessage(states.pendingDeal[deal.userId]?.messageId);
            } catch (error) {
                console.error(`Ошибка удаления сообщения ${states.pendingDeal[deal.userId]?.messageId}:`, error.message);
            }

            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `✅ Оплата по заявке № ${deal.id} подтверждена!\n` +
                    `Покупка ${deal.currency}\n` +
                    `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                    `Сумма: ${deal.rubAmount} RUB\n` +
                    `Комиссия: ${deal.commission.toFixed(2)} RUB (скидка ${discount}%)\n` +
                    `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                    `Итог: ${deal.total.toFixed(2)} RUB\n` +
                    `${paymentTarget}: <code>${deal.walletAddress}</code>\n\n` +
                    `Свяжитесь с оператором, чтобы завершить сделку! ⬇️`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📞 Написать оператору', url: contactUrl }],
                        [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                    ]
                },
                parse_mode: 'HTML'
            });
            states.pendingDeal[deal.userId] = { messageId: message.message_id, dealId: deal.id };

            const operators = getOperators(deal.currency);
            for (const operator of operators) {
                try {
                    const operatorId = users.find(u => u.username === operator.username)?.id;
                    if (operatorId && await isValidChat(operatorId)) {
                        await sendBitCheckPhoto(operatorId, {
                            caption: `🆕 Новая заявка на сделку № ${deal.id}\n` +
                                `Покупка ${deal.currency}\n` +
                                `@${user.username || 'Нет'} (ID ${deal.userId})\n` +
                                `Количество: ${deal.cryptoAmount}\n` +
                                `Сумма: ${deal.rubAmount} RUB\n` +
                                `Комиссия: ${deal.commission.toFixed(2)} RUB (скидка ${discount}%)\n` +
                                `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                                `Итог: ${deal.total.toFixed(2)} RUB\n` +
                                `${paymentTarget}: <code>${deal.walletAddress}</code>`,
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
                    console.error(`Ошибка отправки оператору ${operator.username}:`, error.message);
                }
            }

            await ctx.answerCbQuery('✅ Оплата подтверждена', { show_alert: false });
            saveJson('deals', deals);
            saveJson('states', states);
            return;
        }

        if (data.startsWith('cancel_deal_')) {
            const states = loadStates();
            const dealId = data.split('_')[2];
            const dealIndex = deals.findIndex(d => d.id === dealId && (d.status === 'draft' || d.status === 'pending'));

            if (dealIndex !== -1) {
                const deal = deals[dealIndex];
                deals.splice(dealIndex, 1);
                saveJson('deals', deals);

                try {
                    await ctx.deleteMessage(states.pendingDeal[from]?.messageId);
                } catch (error) {
                    console.error(`Ошибка удаления сообщения ${states.pendingDeal[from]?.messageId}:`, error.message);
                }

                const caption = deal.status === 'draft'
                    ? '❌ Заявка удалена'
                    : `❌ Заявка № ${dealId} удалена`;

                const message = await sendBitCheckPhoto(ctx.chat.id, { caption });
                states.pendingDeal[from] = { messageId: message.message_id };
                saveJson('states', states);
            }
            await ctx.answerCbQuery('❌ Заявка отменена', { show_alert: false });
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
                    await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `✅ Сделка № ${deal.id} успешно удалена`
                    });
                }

                await ctx.answerCbQuery('✅ Сделка удалена', { show_alert: false });
            } catch (error) {
                console.error('Ошибка удаления сделки:', error.message);
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

                const users = loadJson('users');
                const user = users.find(u => u.id === deal.userId);
                const config = loadJson('config');
                const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
                const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                const caption = `✅ Сделка завершена! №${deal.id}\n${actionText} ${deal.currency}\nКоличество: ${deal.cryptoAmount} ${deal.currency}\nСумма: ${deal.rubAmount} RUB\nКомиссия: ${deal.commission.toFixed(2)} RUB\nПриоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\nИтог: ${deal.total.toFixed(2)} RUB\nКошелёк: ${deal.walletAddress}`;

                const contactUrl = getContactUrl(deal.currency);

                try {
                    const message = await sendBitCheckPhoto(user.id, {
                        caption: caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: contactUrl }]
                            ]
                        }
                    });
                    const states = loadJson('states');
                    states.pendingDeal[user.id] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    console.error(`Ошибка отправки уведомления о завершении пользователю ${user.id}:`, error.message);
                }

                const referrer = users.find(u => u.referrals && u.referrals.includes(deal.userId));
                if (referrer) {
                    const referralRevenuePercent = config.referralRevenuePercent / 100;
                    const btcPrice = await getBtcRubPrice();
                    const commissionBTC = (deal.commission / btcPrice) * referralRevenuePercent;
                    const earningsRub = commissionBTC * btcPrice;

                    referrer.balance = (referrer.balance || 0) + Number(commissionBTC.toFixed(8));
                    saveJson('users', users);

                    try {
                        await sendBitCheckPhoto(referrer.id, {
                            caption: `🎉 Реферальный бонус! +${commissionBTC.toFixed(8)} BTC (~${earningsRub.toFixed(2)}) за сделку ID ${deal.id}`
                        });
                    } catch (error) {
                        console.error(`Ошибка отправки уведомления рефереру ${referrer.id}:`, error.message);
                    }
                }

                try {
                    await ctx.editMessageCaption(`✅ Сделка № ${deal.id} завершена`, {
                        reply_markup: { inline_keyboard: [] }
                    });
                } catch (error) {
                    await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `✅ Сделка № ${deal.id} успешно завершена`
                    });
                }

                await ctx.answerCbQuery('✅ Сделка завершена', { show_alert: false });
            } catch (error) {
                console.error('Ошибка завершения сделки:', error.message);
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
                    const message = await sendBitCheckPhoto(userId, {
                        caption: `✅ Вывод рефералов завершен! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nКошелёк: ${withdrawal.walletAddress}`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: contactUrl }]
                            ]
                        }
                    });
                    const states = loadJson('states');
                    states.pendingWithdrawal[userId] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    console.error(`Ошибка отправки уведомления о завершении вывода пользователю ${userId}:`, error.message);
                }

                try {
                    await ctx.editMessageCaption(`✅ Вывод рефералов № ${withdrawal.id} завершен`, {
                        reply_markup: { inline_keyboard: [] }
                    });
                } catch (error) {
                    await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `✅ Вывод рефералов № ${withdrawal.id} успешно завершен`
                    });
                }

                await ctx.answerCbQuery('✅ Вывод завершен', { show_alert: false });
            } catch (error) {
                console.error('Ошибка завершения вывода:', error.message);
                await ctx.answerCbQuery('❌ Ошибка при завершении вывода', { show_alert: true });
            }
            return;
        }

        if (data === 'cancel_action') {
            const states = loadJson('states');
            try {
                await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
            } catch (error) {
                console.error(`Ошибка удаления сообщения обратного вызова ${ctx.callbackQuery.message.message_id}:`, error.message);
            }

            const stateKeys = ['pendingDeal', 'pendingWithdrawal', 'pendingUpdateProfile', 'pendingSupport'];
            for (const key of stateKeys) {
                if (states[key][from]?.messageId) {
                    try {
                        await ctx.deleteMessage(states[key][from].messageId);
                    } catch (error) {
                        console.error(`Ошибка удаления сообщения ${states[key][from].messageId}:`, error.message);
                    }
                }
            }

            clearPendingStates(states, from);
            saveJson('states', states);
            await ctx.answerCbQuery('❌ Действие отменено', { show_alert: false });
        }
    } catch (error) {
        console.error('Error processing callback query:', error.message);
        await ctx.answerCbQuery('❌ Ошибка обработки', { show_alert: true });
    }
});

main_bot.catch((err, ctx) => {
    console.error(`Telegraf error for update ${ctx.update.update_id}:`, err);
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