const { Telegraf } = require('telegraf');
const RateLimit = require('telegraf-ratelimit');
const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const async = require('async');
const { broadcastEmitter, raffleEmitter } = require('./server');
const { BIT_CHECK_IMAGE_PATH, DATA_PATH, MAIN_BOT_TOKEN,
    PAYMENT_OPTION_NAMES, BIT_CHECK_GROUP_URL, BIT_CHECK_CHAT_URL, POST_SCRIPT
} = require('./src/config/constants');
const { MESSAGES } = require('./src/config/messages');
const {
    getBtcRubPrice,
    getLtcRubPrice,
    getCommissionDiscount,
    calculateCommission,
    calculateUserStats,
    getOperatorContactUrl,
    getOperators,
    isValidChat,
    checkIfBlocked,
    getAvailablePaymentDetails,
    checkUnpaidDeals,
    checkInvoiceStatus,
    generateRaffleResults,
    calculateDealTotals,
    calculateMinMaxAmounts,
    calculateSellMinMaxAmounts,
    buildProfileMessage,
    buildProfileReplyMarkup,
    buildReferralMessage,
    buildReferralReplyMarkup,
    buildBuyMenuMessage,
    buildBuyMenuReplyMarkup,
    buildSellMenuMessage,
    buildSellMenuReplyMarkup,
    buildDealCreatedMessage,
    buildDealReplyMarkup,
    buildPaymentSystemText,
    buildOperatorDealMessage,
    buildOperatorDealReplyMarkup,
    createDealObject,
    buildDealConfirmationMessage,
    buildDealConfirmationReplyMarkup
} = require('./src/services');
const {
    loadJson,
    saveJson,
    formatDate,
    loadStates,
    clearPendingStates,
    sendBitCheckPhoto,
    setMainBotInstance,
    generateCaptcha,
    shouldLogSendError,
    telegramWithRetry
} = require('./src/utils');
const { getProcessing, isProcessingEnabled } = require('./src/integrations');

const cronTasks = new Map();

let isScheduling = false;
let reloadTimeout = null;

const main_bot = new Telegraf(MAIN_BOT_TOKEN);
setMainBotInstance(main_bot);

main_bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота и открыть меню' }
]).then(() => {
    console.log('Bot commands set successfully');
}).catch(err => {
    console.error('Error setting bot commands:', err.message);
});


async function getMerchantPaymentDetails(amount, userId) {
    const processing = getProcessing();
    if (!processing) {
        throw new Error('Processing is not enabled');
    }
    return await processing.getPaymentDetails(amount, userId);
}

async function getAvailablePaymentVariants(id) {
    const processing = getProcessing();
    if (!processing) {
        throw new Error('Processing is not enabled');
    }
    return await processing.getAvailablePaymentVariants(id);
}

async function startMerchantDeal(id, paymentMethod) {
    const processing = getProcessing();
    if (!processing) {
        throw new Error('Processing is not enabled');
    }
    return await processing.startDeal(id, paymentMethod);
}

async function getMerchantInvoice(id) {
    const processing = getProcessing();
    if (!processing) {
        throw new Error('Processing is not enabled');
    }
    return await processing.getInvoice(id);
}

async function getPaymentMethodName(code) {
    const processing = getProcessing();
    if (!processing) {
        return code;
    }
    return await processing.getPaymentMethodName(code);
}

async function cancelInvoice(id) {
    const processing = getProcessing();
    if (!processing) {
        throw new Error('Processing is not enabled');
    }
    return await processing.cancelInvoice(id);
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
            for (let i = 0; i < broadcasts.length; i++) {
                const broadcast = broadcasts[i];
                if (!broadcast.id || !broadcast.scheduledTime || broadcast.status === 'sent') {
                    console.log(`Broadcast ${broadcast.id || 'without ID'} has no scheduledTime, ID, or is already sent, skipping`);
                    continue;
                }

                if (broadcast.status === 'sending') {
                    const lastAttempt = broadcast.lastAttemptTime;
                    if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
                        console.log(`Broadcast ${broadcast.id} is already being sent, skipping`);
                        continue;
                    } else {
                        broadcasts[i].status = 'pending';
                        delete broadcasts[i].lastAttemptTime;
                        saveJson('broadcasts', broadcasts);
                    }
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

                const mskOffset = 3 * 60 * 60 * 1000;
                const mskTimeMs = scheduledTime.getTime() + mskOffset;
                const mskTime = new Date(mskTimeMs);
                const mskHours = mskTime.getUTCHours();
                const mskMinutes = mskTime.getUTCMinutes();
                const mskSeconds = mskTime.getUTCSeconds();
                const mskDate = mskTime.getUTCDate();
                const mskMonth = mskTime.getUTCMonth() + 1;
                
                let cronTime;
                if (broadcast.isDaily) {
                    cronTime = `0 ${mskMinutes} ${mskHours} * * *`;
                    console.log(`Scheduled daily broadcast ${broadcast.id} with cron: ${cronTime}`);
                } else {
                    cronTime = `${mskSeconds} ${mskMinutes} ${mskHours} ${mskDate} ${mskMonth} *`;
                    console.log(`Scheduled one-time broadcast ${broadcast.id} with cron: ${cronTime}`);
                }

                const task = cron.schedule(cronTime, async () => {
                    console.log(`Executing broadcast ${broadcast.id} at ${new Date().toISOString()}`);
                    await sendBroadcast(broadcast);
                    cronTasks.delete(broadcast.id);
                }, {
                    scheduled: true,
                    timezone: 'Europe/Moscow'
                });

                cronTasks.set(broadcast.id, task);
                console.log(`Broadcast ${broadcast.id} scheduled for ${scheduledTime.toISOString()}`);
            }
        }

        const raffles = loadJson('raffles') || [];
        if (!Array.isArray(raffles)) {
            console.error('Invalid raffles data format');
        } else {
            for (let i = 0; i < raffles.length; i++) {
                let raffle = raffles[i];
                if (!raffle.id || !raffle.startDate || !raffle.endDate || raffle.status === 'completed') {
                    console.log(`Raffle ${raffle.id || 'without ID'} has no startDate, endDate, ID, or is already completed, skipping`);
                    continue;
                }

                if (raffle.status === 'sending_notification' || raffle.status === 'sending_results') {
                    const lastAttempt = raffle.lastAttemptTime;
                    if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
                        console.log(`Raffle ${raffle.id} is already being processed, skipping`);
                        continue;
                    } else {
                        if (raffle.status === 'sending_notification') {
                            raffles[i].status = 'pending';
                        } else {
                            raffles[i].status = 'active';
                        }
                        delete raffles[i].lastAttemptTime;
                        saveJson('raffles', raffles);
                        raffle = raffles[i];
                    }
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
    if (broadcasts.length === 0) {
        return;
    }
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

fs.watch(path.join(DATA_PATH, 'database', 'broadcasts.json'), (eventType, filename) => {
    if (eventType === 'change') {
        console.log('Broadcasts file changed, reloading tasks');
        reloadTasks();
    }
});

raffleEmitter.on('newRaffle', async () => {
    const raffles = loadJson('raffles') || [];
    if (raffles.length === 0) {
        return;
    }
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

fs.watch(path.join(DATA_PATH, 'database', 'raffles.json'), (eventType, filename) => {
    if (eventType === 'change') {
        console.log('Raffles file changed, reloading tasks');
        reloadTasks();
    }
});

reloadTasks();

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

    if (broadcasts[broadcastIndex].status === 'sending') {
        const lastAttempt = broadcasts[broadcastIndex].lastAttemptTime;
        if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
            console.log(`Broadcast ${broadcast.id} is already being sent, skipping`);
            return false;
        }
    }

    let photoSource;
    let imagePath = null;
    if (broadcast.file_id) {
        photoSource = broadcast.file_id;
    } else {
        imagePath = broadcast.imageName
            ? path.join(DATA_PATH, 'images/broadcasts', broadcast.imageName)
            : BIT_CHECK_IMAGE_PATH;
        if (!fs.existsSync(imagePath)) {
            photoSource = BIT_CHECK_IMAGE_PATH;
        } else {
            photoSource = { source: imagePath };
        }
    }

    broadcasts[broadcastIndex].status = 'sending';
    broadcasts[broadcastIndex].lastAttemptTime = new Date().toISOString();
    saveJson('broadcasts', broadcasts);

    const users = loadJson('users') || [];
    if (!Array.isArray(users)) {
        console.error('Invalid users data format');
        broadcasts[broadcastIndex].status = 'pending';
        delete broadcasts[broadcastIndex].lastAttemptTime;
        saveJson('broadcasts', broadcasts);
        return false;
    }

    const BATCH_SIZE = 25;
    const batchDelay = 10000;
    const batches = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        batches.push(users.slice(i, i + BATCH_SIZE));
    }

    let fileIdSaved = false;
    const queue = async.queue(async (user, callback) => {
        if (!user.id || !(await isValidChat(user.id))) {
            callback();
            return;
        }

        try {
            const options = {
                caption: `${broadcast.text}\n\n${POST_SCRIPT}`
            };
            let msg = await telegramWithRetry(
                () => main_bot.telegram.sendPhoto(user.id, photoSource, options)
            );

            if (!fileIdSaved && !broadcast.file_id && typeof photoSource !== 'string' && msg.photo && msg.photo.length > 0) {
                broadcasts = loadJson('broadcasts') || [];
                const currentBroadcast = broadcasts.find(b => b.id === broadcast.id);
                if (currentBroadcast) {
                    currentBroadcast.file_id = msg.photo[msg.photo.length - 1].file_id;
                    saveJson('broadcasts', broadcasts);
                    photoSource = currentBroadcast.file_id;
                    fileIdSaved = true;
                }
            }
        } catch (error) {
            if (shouldLogSendError(error)) {
                console.error(`Error sending broadcast ${broadcast.id} to user ${user.id}:`, error.message);
            }
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

    delete updatedBroadcast.lastAttemptTime;

    if (broadcast.isDaily) {
        const now = new Date();
        const scheduledDate = new Date(broadcast.scheduledTime);
        const mskOffset = 3 * 60 * 60 * 1000;
        const mskScheduledTimeMs = scheduledDate.getTime() + mskOffset;
        const mskScheduledTime = new Date(mskScheduledTimeMs);
        const mskHours = mskScheduledTime.getUTCHours();
        const mskMinutes = mskScheduledTime.getUTCMinutes();
        
        const nextDayMs = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
            mskHours,
            mskMinutes
        ).getTime();
        const nextDayUTC = new Date(nextDayMs - mskOffset);
        updatedBroadcast.scheduledTime = nextDayUTC.toISOString();
        updatedBroadcast.status = 'pending';
    } else {
        if (success) {
            broadcasts = broadcasts.filter(b => b.id !== broadcast.id);
        } else {
            updatedBroadcast.status = 'pending';
        }
    }
    saveJson('broadcasts', broadcasts);

    if (imagePath && !updatedBroadcast.file_id && !broadcast.isDaily && success) {
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

    if (raffles[raffleIndex].status === 'sending_notification') {
        const lastAttempt = raffles[raffleIndex].lastAttemptTime;
        if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
            console.log(`Raffle notification ${raffle.id} is already being sent, skipping`);
            return;
        }
    }

    if (raffles[raffleIndex].status !== 'pending') {
        console.log(`Raffle ${raffle.id} is not pending, skipping notification`);
        return;
    }

    const users = loadJson('users') || [];
    if (!Array.isArray(users) || users.length === 0) {
        console.error('Invalid users data format or empty users list');
        return;
    }

    raffles[raffleIndex].status = 'sending_notification';
    raffles[raffleIndex].lastAttemptTime = new Date().toISOString();
    saveJson('raffles', raffles);

    const conditionText = raffle.condition.type === 'dealCount'
        ? `Необходимо совершить не менее ${raffle.condition.value} сделок`
        : `Необходимо совершить сделок на сумму не менее ${raffle.condition.value} RUB`;

    const caption = `🎉 Новый розыгрыш!\n\n` +
        `📋 Условия:\n${conditionText}\n\n` +
        `🎁 Призы:\n${raffle.prizes.map((p, i) => `${i + 1}) ${p}`).join('\n')}\n\n` +
        `⏰ Результаты розыгрыша будут объявлены ${formatDate(raffle.endDate, true)}\n\n` +
        `${POST_SCRIPT}`;

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
            if (shouldLogSendError(error)) {
                console.error(`Error sending raffle notification to user ${user.id}:`, error.message);
            }
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
        delete updatedRaffle.lastAttemptTime;
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

    if (raffles[raffleIndex].status === 'sending_results') {
        const lastAttempt = raffles[raffleIndex].lastAttemptTime;
        if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
            console.log(`Raffle results ${raffle.id} is already being sent, skipping`);
            return;
        }
    }

    raffles[raffleIndex].status = 'sending_results';
    raffles[raffleIndex].lastAttemptTime = new Date().toISOString();
    saveJson('raffles', raffles);

    const { winners } = generateRaffleResults(raffle);
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
    if (!Array.isArray(users) || users.length === 0) {
        console.error('Invalid users data format or empty users list');
        raffles[raffleIndex].status = 'active';
        delete raffles[raffleIndex].lastAttemptTime;
        saveJson('raffles', raffles);
        return;
    }

    const config = loadJson('config') || {};
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
            if (shouldLogSendError(error)) {
                console.error(`Error sending raffle results to user ${user.id}:`, error.message);
            }
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

    raffles = loadJson('raffles') || [];
    const updatedRaffle = raffles.find(r => r.id === raffle.id);
    if (updatedRaffle) {
        updatedRaffle.status = 'completed';
        delete updatedRaffle.lastAttemptTime;
        saveJson('raffles', raffles);
    }
}




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

main_bot.use(async (ctx, next) => {
    const config = loadJson('config') || {};
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

main_bot.use(rateLimit);

main_bot.use(async (ctx, next) => {
    try {
        const commands = ['/start', '👤 Профиль', '💰 Купить', '💸 Продать', '💬 Отзывы', '💬 Чат', '🤝 Партнёрство', '🆘 Поддержка'];
        if (ctx.message && ctx.message.text && commands.includes(ctx.message.text)) {
            const states = loadStates();
            clearPendingStates(states, ctx.from.id);
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

main_bot.command('start', async ctx => {
    const users = loadJson('users') || [];
    const states = loadStates() || {};
    const userId = ctx.from.id;
    if (!ctx.message || !ctx.message.text) {
        return;
    }
    const args = ctx.message.text.split(' ');
    let invitedBy = null;

    if (args.length > 1 && args[1].startsWith('ref_')) {
        const refParts = args[1].split('_');
        const referralId = refParts.length > 1 ? refParts[1] : null;
        if (referralId) {
            const referrer = users.find(u => u.referralId === referralId);
            if (referrer && referrer.id !== userId) invitedBy = referrer.id;
        }
    }

    let user = users.find(u => u.id === userId);
    if (!user) {
        const captcha = await generateCaptcha();
        const captchaMessage = await ctx.replyWithPhoto(
            { source: Buffer.from(captcha.data) },
            { caption: MESSAGES.CAPTCHA_INPUT }
        );
        states.pendingCaptcha[userId] = {
            correct: captcha.text,
            invitedBy,
            messageId: captchaMessage.message_id
        };
    } else {
        const priceBTC = await getBtcRubPrice();
        const stats = calculateUserStats(userId);
        const earningsRub = (user.balance || 0) * priceBTC;
        const username = user.username ? `@${user.username}` : 'Нет';
        const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
        const profileText = `👤 Твой профиль в BitCheck\n` +
            `📛 Имя: ${username}\n` +
            `🆔 ID: ${userId}\n\n` +
            `📦 Статистика:\n` +
            `🔄 Сделок совершено: ${stats.dealsCount}\n` +
            `👥 Приведено рефералов: ${(user.referrals || []).length}\n` +
            `💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~${earningsRub.toFixed(2)} RUB)\n\n` +
            `📥 Куплено:\n` +
            `₿ BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\n` +
            `Ł LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n` +
            `📤 Продано:\n` +
            `₿ BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\n` +
            `Ł LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n` +
            `🔗 Твоя ссылка:\n` +
            `👉 ${referralLink}\n` +
            `💰 Приглашайте друзей и получайте бонусы!\n\n` +
            `${POST_SCRIPT}`;

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
    const users = loadJson('users') || [];
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);
    if (!user) {
        await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_NOT_REGISTERED });
        return;
    }
    const priceBTC = await getBtcRubPrice();
    const stats = calculateUserStats(userId);
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
    const profileText = buildProfileMessage(user, stats, priceBTC, referralLink);
    const replyMarkup = buildProfileReplyMarkup();

    await sendBitCheckPhoto(ctx.chat.id, {
        caption: profileText,
        reply_markup: replyMarkup
    });
});

main_bot.hears('💬 Отзывы', async ctx => {
    await sendBitCheckPhoto(ctx.chat.id, {
        caption: MESSAGES.REVIEWS,
        reply_markup: { inline_keyboard: [[{ text: 'Группа 📣', url: `${BIT_CHECK_GROUP_URL}` }]] }
    });
});

main_bot.hears('💬 Чат', async ctx => {
    await sendBitCheckPhoto(ctx.chat.id, {
        caption: MESSAGES.CHAT,
        reply_markup: { inline_keyboard: [[{ text: 'Перейти в чат 🚪', url: `${BIT_CHECK_CHAT_URL}` }]] }
    });
});

main_bot.hears('🤝 Партнёрство', async ctx => {
    const users = loadJson('users') || [];
    const states = loadJson('states') || {};
    const userId = ctx.from.id;
    const user = users.find(u => u.id === userId);
    if (!user) {
        await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_NOT_REGISTERED });
        return;
    }
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
    const priceBTC = await getBtcRubPrice();
    const earningsRub = (user.balance || 0) * priceBTC;
    const text = buildReferralMessage(referralLink, (user.referrals || []).length, earningsRub, user.balance || 0);
    const replyMarkup = buildReferralReplyMarkup(referralLink);

    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption: text,
        reply_markup: replyMarkup
    });
    states.pendingWithdrawal[userId] = { messageId: message.message_id };
    saveJson('states', states);
});

main_bot.hears('💰 Купить', async ctx => {
    const config = loadJson('config') || {};
    const states = loadStates() || {};
    if (!config.minBuyAmountRubBTC || !config.maxBuyAmountRubBTC || !config.minBuyAmountRubLTC || !config.maxBuyAmountRubLTC) {
        await sendBitCheckPhoto(ctx.chat.id, {
            caption: MESSAGES.ERROR_CONFIG
        });
        return;
    }
    const priceBTC = await getBtcRubPrice();
    const priceLTC = await getLtcRubPrice();
    const btcAmounts = calculateMinMaxAmounts('BTC', config, priceBTC, priceLTC, isProcessingEnabled());
    const ltcAmounts = calculateMinMaxAmounts('LTC', config, priceBTC, priceLTC, isProcessingEnabled());
    states.pendingDeal[ctx.from.id] = {type: "buy"}
    const caption = buildBuyMenuMessage(config, priceBTC, priceLTC, btcAmounts, ltcAmounts, isProcessingEnabled());
    const replyMarkup = buildBuyMenuReplyMarkup();
    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption,
        reply_markup: replyMarkup
    });
    states.pendingDeal[ctx.from.id].messageId = message.message_id;
    saveJson('states', states);
});

main_bot.hears('💸 Продать', async ctx => {
    const config = loadJson('config') || {};
    const states = loadStates() || {};
    if (!config.minSellAmountRubBTC || !config.maxSellAmountRubBTC || !config.minSellAmountRubLTC || !config.maxSellAmountRubLTC) {
        await sendBitCheckPhoto(ctx.chat.id, {
            caption: MESSAGES.ERROR_CONFIG
        });
        return;
    }
    const priceBTC = await getBtcRubPrice();
    const priceLTC = await getLtcRubPrice();
    const btcAmounts = calculateSellMinMaxAmounts('BTC', config, priceBTC, priceLTC);
    const ltcAmounts = calculateSellMinMaxAmounts('LTC', config, priceBTC, priceLTC);
    states.pendingDeal[ctx.from.id] = { type: 'sell' };
    const caption = buildSellMenuMessage(config, btcAmounts, ltcAmounts);
    const replyMarkup = buildSellMenuReplyMarkup();
    const message = await sendBitCheckPhoto(ctx.chat.id, {
        caption,
        reply_markup: replyMarkup
    });
    states.pendingDeal[ctx.from.id].messageId = message.message_id;
    saveJson('states', states);
});

main_bot.hears('🆘 Поддержка', async ctx => {
    const states = loadJson('states') || {};
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
    try {
        const config = loadJson('config') || {};
        const users = loadJson('users') || [];
        const states = loadStates() || {};
        const id = ctx.from.id;
        const user = users.find(u => u.id === id);
        if (user && user.isBlocked) return;

    if (states.pendingCaptcha[id] && ctx.message && ctx.message.text) {
        const captchaData = states.pendingCaptcha[id];
        const userInput = ctx.message.text.trim().toUpperCase();
        const correctCaptcha = captchaData.correct.toUpperCase();

        try {
            await ctx.deleteMessage(captchaData.messageId);
        } catch (error) {
            console.error(`Error deleting CAPTCHA message:`, error.message);
        }

        if (userInput === correctCaptcha) {
            const invitedBy = captchaData.invitedBy;
            let user = users.find(u => u.id === id);
            if (!user) {
                if (invitedBy) {
                    const referrer = users.find(u => u.id === invitedBy);
                    if (referrer && !referrer.referrals.includes(id)) {
                        referrer.referrals = referrer.referrals || [];
                        referrer.referrals.push(id);
                        try {
                            await sendBitCheckPhoto(referrer.id, { caption: `👥 ${ctx.from.first_name || 'Пользователь'} приглашён!` });
                        } catch (error) {
                            if (shouldLogSendError(error)) {
                                console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                            }
                        }
                    }
                }
                user = {
                    id: id,
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
            delete states.pendingCaptcha[id];
            await ctx.reply('✅ Капча пройдена!');

            const priceBTC = await getBtcRubPrice();
            const stats = calculateUserStats(id);
            const earningsRub = (user.balance || 0) * priceBTC;
            const username = user.username ? `@${user.username}` : 'Нет';
            const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
            const profileText = `👤 Твой профиль в BitCheck\n` +
                `📛 Имя: ${username}\n` +
                `🆔 ID: ${id}\n\n` +
                `📦 Статистика:\n` +
                `🔄 Сделок совершено: ${stats.dealsCount}\n` +
                `👥 Приведено рефералов: ${(user.referrals || []).length}\n` +
                `💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~${earningsRub.toFixed(2)} RUB)\n\n` +
                `📥 Куплено:\n` +
                `₿ BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\n` +
                `Ł LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n` +
                `📤 Продано:\n` +
                `₿ BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\n` +
                `Ł LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n` +
                `🔗 Твоя ссылка:\n` +
                `👉 ${referralLink}\n` +
                `💰 Приглашайте друзей и получайте бонусы!\n\n` +
                `${POST_SCRIPT}`;
            await sendBitCheckPhoto(ctx.chat.id, {
                caption: profileText,
                reply_markup: {
                    keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '🤝 Партнёрство'], ['💬 Чат', '💬 Отзывы'], ['🆘 Поддержка']],
                    resize_keyboard: true
                }
            });
            saveJson('users', users);
            saveJson('states', states);
        } else {
            const captcha = await generateCaptcha();
            const captchaMessage = await ctx.replyWithPhoto(
                { source: Buffer.from(captcha.data) },
                { caption: MESSAGES.ERROR_INVALID_CAPTCHA }
            );
            states.pendingCaptcha[id] = {
                correct: captcha.text,
                invitedBy: captchaData.invitedBy,
                messageId: captchaMessage.message_id
            };
            saveJson('states', states);
        }
        return;
    }

    if (users.find(u => u.id === id)) {
        if (!ctx.message || !ctx.message.text) {
            return;
        }

        if (states.pendingUpdateProfile[id] && states.pendingUpdateProfile[id].type && states.pendingUpdateProfile[id].type.startsWith('add_')) {
            const typeParts = states.pendingUpdateProfile[id].type.split('_');
            if (typeParts.length < 2) {
                return;
            }
            const type = typeParts[1];
            const isSell = type === 'defaultRequisites';
            const wallet = ctx.message.text.trim();

            if (!wallet || !/^[a-zA-Z0-9+,:.'"()-]+$/.test(wallet)) {
                try {
                    await ctx.deleteMessage(states.pendingUpdateProfile[id].messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingUpdateProfile[id].messageId}:`, error.message);
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: isSell ? MESSAGES.ERROR_INVALID_REQUISITES : MESSAGES.ERROR_INVALID_WALLET_ADDRESS(type === 'defaultWalletsBTC' ? 'BTC' : 'LTC')
                });
                states.pendingUpdateProfile[id].messageId = message.message_id;
                saveJson('states', states);
                return;
            }

            if (!user) {
                console.error(`User not found: ${id}`);
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
                        await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.SUPPORT_REPLY_SENT(supportData.targetId) });
                    } catch (error) {
                        if (shouldLogSendError(error)) {
                            console.error(`Error sending response to user ${supportData.targetId}:`, error.message);
                        }
                        await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_SUPPORT_SEND_FAILED(supportData.targetId) });
                    }
                } else {
                    await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_USER_NOT_FOUND_OR_CHAT_INVALID(supportData.targetId) });
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

                const message = await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.SUPPORT_SENT });
                states.pendingSupport[id] = { messageId: message.message_id };
                saveJson('states', states);
            }

            saveJson('states', states);
            return;
        }

        if (states.pendingTransactionHash[ctx.from.id]) {
            const transactionHash = ctx.message.text;
            const dealId = states.pendingTransactionHash[ctx.from.id].dealId;
            const deals = loadJson('deals') || [];
            const dealIndex = deals.findIndex(d => d.id === dealId);
            if (dealIndex === -1) {
                await ctx.reply(MESSAGES.ERROR_DEAL_NOT_FOUND_OR_PROCESSED);
                delete states.pendingTransactionHash[ctx.from.id];
                saveJson('states', states);
                return;
            }
            const deal = deals[dealIndex];
            try {
                await sendBitCheckPhoto(deal.userId, {
                    caption: `✅ Сделка № ${deal.id} завершена!\n` +
                        `Покупка ${deal.currency}\n` +
                        `Количество: ${deal.cryptoAmount} ${deal.currency}\n\n` +
                        `🔗 Хеш транзакции:\n${transactionHash}`,
                    parse_mode: 'HTML'
                });
                deal.status = 'completed';
                deal.transactionHash = transactionHash;
                deals[dealIndex] = deal;
                delete states.pendingTransactionHash[ctx.from.id];
                saveJson('deals', deals);
                saveJson('states', states);
                await ctx.reply('✅ Хеш транзакции успешно отправлен пользователю');
            } catch (error) {
                console.error('Error sending transaction hash:', error.message);
                await ctx.reply(MESSAGES.ERROR_GENERAL);
            }
        }

        if (!ctx.message || !ctx.message.text) {
            return;
        }

        if (states.pendingDeal[id] && states.pendingDeal[id].newWallet) {
            const dealData = states.pendingDeal[id]
            if (!dealData || !dealData.type || !dealData.currency) {
                console.error(`Invalid dealData for user ${id}`);
                return;
            }
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
                    caption: isBuy ? MESSAGES.ERROR_INVALID_WALLET_ADDRESS(dealData.currency) : MESSAGES.ERROR_INVALID_REQUISITES
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
            states.pendingDeal[id].pendingWallet = wallet
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `📝 Хотите ли добавить ${actionText} как постоянный?\n${wallet}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: 'save_wallet_no' }, { text: 'Да', callback_data: 'save_wallet_yes' }],
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
            if (!dealData || !dealData.type || !dealData.currency) {
                console.error(`Invalid dealData for user ${id}`);
                return;
            }
            const isBuy = dealData.type === 'buy'
            const currency = dealData.currency
            const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites'
            const wallets = user[walletType] || []

            if (wallets.length > 0) {
                try {
                    await ctx.deleteMessage(states.pendingDeal[id].messageId)
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
                }

                const caption = isBuy
                    ? `💼 Выберите кошелёк для покупки <b>${currency}</b>:\n\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`
                    : `💼 Выберите реквизиты для продажи <b>${currency}</b>:\n\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`;
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
            if (!ctx.message || !ctx.message.text) {
                return;
            }

            let input = ctx.message.text.trim()
            let isCryptoInput = false, amount, rub, rubBefore
            const dealData = states.pendingDeal[id]
            if (!dealData || !dealData.type || !dealData.currency) {
                console.error(`Invalid dealData for user ${id}`);
                return;
            }
            const isBuy = dealData.type === 'buy'
            const currency = dealData.currency
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice()
            const minAmountRub = isBuy ? (isProcessingEnabled() ? 1000 : (currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC)) : (currency === 'BTC' ? config.minSellAmountRubBTC : config.minSellAmountRubLTC)
            const maxAmountRub = currency === 'BTC' ? (isBuy ? config.maxBuyAmountRubBTC : config.maxSellAmountRubBTC) : (isBuy ? config.maxBuyAmountRubLTC : config.maxSellAmountRubLTC)
            const minAmountCrypto = (minAmountRub / price).toFixed(8)
            const maxAmountCrypto = (maxAmountRub / price).toFixed(8)

            const inputValue = parseFloat(input)
            if (isNaN(inputValue) || inputValue <= 0) {
                try {
                    await ctx.deleteMessage(states.pendingDeal[id].messageId)
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message)
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `${MESSAGES.ERROR_INVALID_AMOUNT(currency)}\n\n💰 Введите сумму для ${isBuy ? 'покупки' : 'продажи'} ${currency} (в RUB или ${currency})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                    }
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
                    caption: MESSAGES.ERROR_AMOUNT_OUT_OF_RANGE(isBuy, currency, minAmountRub, minAmountCrypto, maxAmountRub, maxAmountCrypto),
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'cancel_action' }]]
                    }
                })
                states.pendingDeal[id].messageId = message.message_id
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
                const caption = isBuy
                    ? `💼 Выберите кошелёк для покупки <b>${currency}</b>:\n\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`
                    : `💼 Выберите реквизиты для продажи <b>${currency}</b>:\n\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`;
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

        if (!ctx.message || !ctx.message.text) {
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
                    caption: MESSAGES.ERROR_INVALID_WALLET_ADDRESS('BTC')
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

            states.pendingWithdrawal[id].pendingWallet = wallet;
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `📝 Хотите ли добавить кошелёк как постоянный?\n${wallet}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Нет', callback_data: 'save_withdrawal_wallet_no' }, { text: 'Да', callback_data: 'save_withdrawal_wallet_yes' }],
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
            if (!ctx.message || !ctx.message.text) {
                return;
            }

            const input = ctx.message.text.trim();
            const priceBTC = await getBtcRubPrice();
            const inputValue = parseFloat(input);
            let amount, rubAmount;

            const users = loadJson('users') || [];
            const user = users.find(u => u.id === id);
            if (!user) {
                console.error(`User not found: ${id}`);
                return;
            }
            const earningsRub = (user.balance || 0) * priceBTC;
            const config = loadJson('config') || {};
            const minWithdrawRub = config.minWithdrawAmountRub;

            if (isNaN(inputValue) || inputValue <= 0) {
                try {
                    await ctx.deleteMessage(states.pendingWithdrawal[id].messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingWithdrawal[id].messageId}:`, error.message);
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: MESSAGES.ERROR_INVALID_AMOUNT('BTC')
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

            if (!user || amount > (user.balance || 0) || rubAmount < minWithdrawRub) {
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
                    `Макс: ${earningsRub.toFixed(2)} RUB (~${(user.balance || 0).toFixed(8)} BTC)\n` +
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
    } catch (error) {
        console.error('Error processing message:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
        try {
            await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_GENERAL });
        } catch (sendError) {
            console.error('Error sending error message:', sendError.message);
        }
    }
});

main_bot.on('callback_query', async ctx => {
    const data = ctx.callbackQuery.data;
    const from = ctx.from.id;

    try {
        if (!data) {
            await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
            return;
        }

        const deals = loadJson('deals') || [];
        const withdrawals = loadJson('withdrawals') || [];

        if (data.startsWith('view_raffle_results_')) {
            const parts = data.split('_');
            const raffleId = parts.length > 3 ? parts[3] : null;
            if (!raffleId) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const raffles = loadJson('raffles') || [];
            const raffle = raffles.find(r => r.id === raffleId);
            if (!raffle) {
                await ctx.answerCbQuery(MESSAGES.ERROR_RAFFLE_NOT_FOUND, { show_alert: true });
                return;
            }

            const { outputPath } = generateRaffleResults(raffle);
            try {
                await ctx.telegram.sendDocument(from, {
                    source: outputPath,
                    filename: `Результаты розыгрыша №${raffle.id}.txt`
                });
                await ctx.answerCbQuery('✅ Результаты отправлены', { show_alert: false });
            } catch (error) {
                if (shouldLogSendError(error)) {
                    console.error(`Error sending raffle results file to user ${from}:`, error.message);
                }
                await ctx.answerCbQuery(MESSAGES.ERROR_FILE_SEND_FAILED, { show_alert: true });
            }
            return;
        }

        if (data.startsWith('select_wallet_')) {
            const states = loadStates();
            const parts = data.split('_');
            if (parts.length < 3) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const index = parseInt(parts[2]);

            if (!states.pendingDeal[from] || states.pendingDeal[from].action !== 'select_wallet' || !states.pendingDeal[from].walletType) {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const walletType = states.pendingDeal[from].walletType;
            const users = loadJson('users') || [];
            const user = users.find(u => u.id === from);
            if (!user) {
                console.error(`User not found: ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const wallet = user[walletType]?.[index];

            if (!wallet) {
                console.error(`Wallet not found for walletType: ${walletType}, index: ${index}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_WALLET_NOT_FOUND, { show_alert: true });
                return;
            }

            await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
            });

            states.pendingDeal[from].wallet = wallet;
            const isSell = walletType === 'defaultRequisites';
            const config = loadJson('config') || {};
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
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const walletType = states.pendingDeal[from].walletType;
            const isSell = walletType === 'defaultRequisites';
            
            if (!states.pendingDeal[from].currency && !isSell) {
                console.error(`Invalid or missing currency for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

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

        if (data === 'save_wallet_yes' || data === 'save_wallet_no') {
            const states = loadStates();
            const isYes = data === 'save_wallet_yes';

            if (!states.pendingDeal[from] || !states.pendingDeal[from].walletType || states.pendingDeal[from].action !== 'save_wallet' || !states.pendingDeal[from].pendingWallet) {
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const wallet = states.pendingDeal[from].pendingWallet;

            const walletType = states.pendingDeal[from].walletType;
            const isSell = walletType === 'defaultRequisites';

            if (isYes) {
                const users = loadJson('users') || [];
                const user = users.find(u => u.id === from);
                if (!user) {
                    console.error(`User not found: ${from}`);
                    await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                    return;
                }
                user[walletType] = user[walletType] || [];
                if (!user[walletType].includes(wallet)) {
                    user[walletType].push(wallet);
                    saveJson('users', users);
                }
            }

            await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
            });

            const config = loadJson('config') || {};
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
            const states = loadStates() || {};
            const users = loadJson('users') || [];
            const user = users.find(u => u.id === from);
            if (!user) {
                console.error(`User not found: ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
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
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const users = loadJson('users') || [];
            const user = users.find(u => u.id === from);
            if (!user) {
                console.error(`User not found: ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

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
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const parts = data.split('_');
            if (parts.length < 3) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const index = parseInt(parts[2]);

            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            if (!user) {
                console.error(`User not found: ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const type = updateProfileData.walletType;
            const isSell = type === 'defaultRequisites';

            if (!user[type] || !Array.isArray(user[type]) || index < 0 || index >= user[type].length) {
                console.error(`Invalid wallet index or type for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

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
            const parts = data.split('_');
            if (parts.length < 3) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const type = parts[2];
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
            const parts = data.split('_');
            if (parts.length < 4) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const index = parseInt(parts[3]);
            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            if (!user) {
                console.error(`User not found: ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const wallet = user.defaultWalletsBTC?.[index];

            if (!wallet) {
                console.error(`Wallet not found for index: ${index}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_WALLET_NOT_FOUND, { show_alert: true });
                return;
            }

            const withdrawData = states.pendingWithdrawal[from];
            if (!withdrawData || !withdrawData.amount || !withdrawData.rubAmount) {
                console.error(`Invalid or missing withdrawal data for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
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
                await ctx.answerCbQuery(MESSAGES.ERROR_WITHDRAWAL_DATA_NOT_FOUND, { show_alert: true });
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

        if (data === 'save_withdrawal_wallet_yes' || data === 'save_withdrawal_wallet_no') {
            const states = loadStates();
            const isYes = data === 'save_withdrawal_wallet_yes';
            const withdrawData = states.pendingWithdrawal[from];

            if (!withdrawData || withdrawData.action !== 'save_withdrawal_wallet' || !withdrawData.withdrawal || !withdrawData.pendingWallet) {
                console.error(`Invalid or missing withdrawal data for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const wallet = withdrawData.pendingWallet;

            const users = loadJson('users');
            const user = users.find(u => u.id === from);
            if (!user) {
                console.error(`User not found: ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

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

            const operatorContactUrl = getOperatorContactUrl('BTC');
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `✅ Заявка на вывод рефералов создана! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC (~${withdrawal.rubAmount.toFixed(2)} RUB)\nКошелёк: <code>${withdrawal.walletAddress}</code>`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📞 Написать оператору', url: operatorContactUrl }]
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
            const parts = data.split('_');
            if (parts.length < 3) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const targetId = parseInt(parts[2]);
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
            const users = loadJson('users') || [];
            const user = users.find(u => u.id === from);
            const config = loadJson('config') || {};
            if (!user || !user.balance) {
                await ctx.answerCbQuery(MESSAGES.ERROR_NO_FUNDS, { show_alert: false });
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

            const config = loadJson('config') || {};
            const minAmountRub = isProcessingEnabled() ? 1000 : (currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC);
            const maxAmountRub = currency === 'BTC' ? config.maxBuyAmountRubBTC : config.maxBuyAmountRubLTC;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minAmountCrypto = (minAmountRub / price).toFixed(8);
            const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

            if (states.pendingDeal[from].messageId) {
                await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                    console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
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

        if (data === 'sell_select_btc' || data === 'sell_select_ltc') {
            const states = loadStates();
            const currency = data === 'sell_select_btc' ? 'BTC' : 'LTC';
            states.pendingDeal[from] = states.pendingDeal[from] || {};
            states.pendingDeal[from].currency = currency;

            const config = loadJson('config') || {};
            const minAmountRub = currency === 'BTC' ? config.minSellAmountRubBTC : config.minSellAmountRubLTC;
            const maxAmountRub = currency === 'BTC' ? config.maxSellAmountRubBTC : config.maxSellAmountRubLTC;
            const price = currency === 'BTC' ? await getBtcRubPrice() : await getLtcRubPrice();
            const minAmountCrypto = (minAmountRub / price).toFixed(8);
            const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

            if (states.pendingDeal[from].messageId) {
                await ctx.deleteMessage(states.pendingDeal[from].messageId).catch(error => {
                    console.error(`Error deleting message ${states.pendingDeal[from].messageId}:`, error.message);
                });
            }

            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption: `💸 Введите сумму для продажи ${currency} (в RUB или ${currency})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
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
                console.error(`Invalid or missing data for user ${from}`);
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }

            const isBuy = dealData.type === 'buy';
            const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites';

            await ctx.deleteMessage(dealData.messageId).catch(error => {
                console.error(`Error deleting message ${dealData.messageId}:`, error.message);
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
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND, { show_alert: true });
                return;
            }

            const config = loadJson('config') || {};
            const users = loadJson('users') || [];
            const deals = loadJson('deals') || [];
            const user = users.find(u => u.id === from);
            if (user && user.isBlocked) return;

            dealData.priority = priority;
            const calculationResult = await calculateDealTotals(dealData, priority, from, deals);
            const { priorityPrice, discount, isTenthDeal } = calculationResult;
            const deal = createDealObject(dealData, user, calculationResult);

            try {
                await ctx.deleteMessage(dealData.messageId);
            } catch (error) {
                console.error(`Error deleting message ${dealData.messageId}:`, error.message);
            }

            if (isProcessingEnabled()) {
                deals.push(deal);
                states.pendingDeal[from].dealId = deal.id;
                states.pendingDeal[from].priority = priority;
                delete dealData.action;
                delete dealData.walletType;
                delete dealData.newWallet;
                saveJson('deals', deals);
                saveJson('states', states);

                const discount = await getCommissionDiscount(from);
                const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';

                try {
                    const paymentDetails = await getMerchantPaymentDetails(
                        deal.total,
                        from
                    );

                    const paymentVariants = await getAvailablePaymentVariants(
                        paymentDetails.id
                    );

                    if (!paymentVariants || paymentVariants.length === 0) {
                        try {
                            await ctx.deleteMessage(dealData.messageId);
                        } catch (error) {
                            console.error(`Error deleting message ${dealData.messageId}:`, error.message);
                        }

                        const operatorContactUrl = getOperatorContactUrl(deal.currency);
                        const message = await sendBitCheckPhoto(ctx.chat.id, {
                            caption: `❌ Не удалось найти доступные варианты оплаты!\n` +
                                `Заявка № ${deal.id}\n` +
                                `Покупка ${deal.currency}\n` +
                                `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                                `Сумма: ${deal.rubAmount} RUB\n` +
                                `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                                `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                                `Итог: ${deal.total} RUB\n` +
                                `${paymentTarget}: <code>${deal.walletAddress}</code>\n\n` +
                                `‼️ Пожалуйста, свяжитесь с оператором для решения проблемы.`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📞 Написать оператору', url: operatorContactUrl }],
                                    [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                                ]
                            },
                            parse_mode: 'HTML'
                        });

                        states.pendingDeal[from].messageId = message.message_id;
                        saveJson('states', states);
                        await ctx.answerCbQuery(MESSAGES.ERROR_PAYMENT_VARIANTS_NOT_FOUND, { show_alert: true });
                        return;
                    }

                    const paymentButtons = await Promise.all(paymentVariants.map(async variant => {
                        const paymentMethodName = await getPaymentMethodName(variant.method);
                        return [{
                            text: paymentMethodName,
                            callback_data: `select_payment_variant_${variant.method}_${variant.option || ''}_${deal.id}`
                        }];
                    }));

                    paymentButtons.push([{ text: '❌ Отменить', callback_data: `cancel_deal_${deal.id}` }]);

                    try {
                        await ctx.deleteMessage(dealData.messageId);
                    } catch (error) {
                        console.error(`Error deleting message ${dealData.messageId}:`, error.message);
                    }

                    const caption = buildDealConfirmationMessage(deal, discount, priorityPrice, 'Платёжная система: Карта\n', paymentTarget) + '\n\nВыберите вариант оплаты:';
                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption,
                        reply_markup: {
                            inline_keyboard: paymentButtons
                        },
                        parse_mode: 'HTML'
                    });

                    states.pendingDeal[from].messageId = message.message_id;
                    states.pendingDeal[from].paymentDetailsId = paymentDetails.id;
                    states.pendingDeal[from].paymentInternalId = paymentDetails.internalId;
                    saveJson('states', states);
                    await ctx.answerCbQuery(`✅ Выбран приоритет: ${priority === 'elevated' ? 'Повышенный' : 'Обычный'}`, { show_alert: false });
                    return;
                } catch (error) {
                    console.error(`Error processing payment variants:`, error.message);
                    const errorMessage = error.message.includes('Processing is not enabled') 
                        ? '❌ Платёжная система недоступна. Обратитесь в поддержку.'
                        : MESSAGES.ERROR_PAYMENT_VARIANTS_FETCH_FAILED;
                    await ctx.answerCbQuery(errorMessage, { show_alert: true });
                    return;
                }
            }

            const paymentTarget = dealData.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const caption = buildDealConfirmationMessage(deal, discount, priorityPrice, '', paymentTarget, isTenthDeal);
            const replyMarkup = buildDealConfirmationReplyMarkup(deal.id);
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: replyMarkup,
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

        if (data === 'select_payment_method_card') {
            const states = loadJson('states');

            const dealData = states.pendingDeal[from];
            const deal = deals.find(d => d.id === dealData.dealId);
            const config = loadJson('config');
            const discount = await getCommissionDiscount(from);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';

            try {
                const paymentDetails = await getMerchantPaymentDetails(
                    deal.total,
                    from
                );

                const paymentVariants = await getAvailablePaymentVariants(
                    paymentDetails.id
                );

                if (!paymentVariants || paymentVariants.length === 0) {
                    try {
                        await ctx.deleteMessage(dealData.messageId);
                    } catch (error) {
                        console.error(`Error deleting message ${dealData.messageId}:`, error.message);
                    }

                    const operatorContactUrl = getOperatorContactUrl(deal.currency);
                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `❌ Не удалось найти доступные варианты оплаты для карты!\n` +
                            `Заявка № ${deal.id}\n` +
                            `Покупка ${deal.currency}\n` +
                            `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                            `Сумма: ${deal.rubAmount} RUB\n` +
                            `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                            `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                            `Итог: ${deal.total} RUB\n` +
                            `${paymentTarget}: <code>${deal.walletAddress}</code>\n\n` +
                            `‼️ Пожалуйста, свяжитесь с оператором для решения проблемы.`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: operatorContactUrl }],
                                [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                            ]
                        },
                        parse_mode: 'HTML'
                    });

                    states.pendingDeal[from].messageId = message.message_id;
                    saveJson('states', states);
                    await ctx.answerCbQuery(MESSAGES.ERROR_PAYMENT_VARIANTS_NOT_FOUND, { show_alert: true });
                    return;
                }

                const paymentButtons = await Promise.all(paymentVariants.map(async variant => {
                    const paymentMethodName = await getPaymentMethodName(variant.method);
                    return [{
                        text: paymentMethodName,
                        callback_data: `select_payment_variant_${variant.method}_${variant.option || ''}_${deal.id}`
                    }];
                }));

                paymentButtons.push([{ text: '❌ Отменить', callback_data: `cancel_deal_${deal.id}` }]);

                try {
                    await ctx.deleteMessage(dealData.messageId);
                } catch (error) {
                    console.error(`Error deleting message ${dealData.messageId}:`, error.message);
                }

                const caption = buildDealConfirmationMessage(deal, discount, priorityPrice, 'Платёжная система: Карта\n', paymentTarget) + '\n\nВыберите вариант оплаты:';
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: {
                        inline_keyboard: paymentButtons
                    },
                    parse_mode: 'HTML'
                });

                states.pendingDeal[from].messageId = message.message_id;
                states.pendingDeal[from].paymentDetailsId = paymentDetails.id;
                states.pendingDeal[from].paymentInternalId = paymentDetails.internalId;
                saveJson('states', states);
                await ctx.answerCbQuery('✅ Выбрана платёжная система: Карта', { show_alert: false });
                return;
            } catch (error) {
                console.error(`Error processing payment variants:`, error.message);
                const errorMessage = error.message.includes('Processing is not enabled') 
                    ? '❌ Платёжная система недоступна. Обратитесь в поддержку.'
                    : MESSAGES.ERROR_PAYMENT_VARIANTS_FETCH_FAILED;
                await ctx.answerCbQuery(errorMessage, { show_alert: true });
                return;
            }
        }

        if (data.startsWith('select_payment_variant_')) {
            const parts = data.split('_');
            if (parts.length < 5) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const variantMethod = parts[3];
            const dealId = parts[parts.length - 1];
            const variantOption = parts.length >= 6 ? (parts[4] || '') : '';
            
            if (!dealId || !variantMethod) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            
            const states = loadJson('states');
            const deals = loadJson('deals');
            let deal = deals.find(d => d.id === dealId);
            const dealData = states.pendingDeal[from];
            
            if (!deal && dealData && dealData.dealId === dealId) {
                deal = {
                    id: dealId,
                    userId: from,
                    type: dealData.type,
                    currency: dealData.currency,
                    rubAmount: dealData.rub,
                    cryptoAmount: dealData.amount,
                    commission: dealData.commission,
                    total: dealData.total,
                    walletAddress: dealData.wallet,
                    priority: dealData.priority || 'normal',
                    processingStatus: true
                };
            }
            
            if (!deal) {
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND, { show_alert: true });
                return;
            }
            
            const config = loadJson('config') || {};
            const discount = await getCommissionDiscount(from);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';

            try {
                await ctx.deleteMessage(dealData.messageId);
            } catch (error) {
                console.error(`Error deleting message ${dealData.messageId}:`, error.message);
            }

            const paymentMethodName = await getPaymentMethodName(variantMethod);

            const paymentSystemText = `Платёжная система: Карта - ${paymentMethodName || variantMethod}\n`;
            const caption = buildDealConfirmationMessage(deal, discount, priorityPrice, paymentSystemText, paymentTarget);
            const replyMarkup = buildDealConfirmationReplyMarkup(deal.id, variantMethod);
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: replyMarkup,
                parse_mode: 'HTML'
            });

            states.pendingDeal[from].messageId = message.message_id;
            states.pendingDeal[from].paymentVariant = variantMethod;
            states.pendingDeal[from].paymentOption = variantOption;
            saveJson('states', states);
            await ctx.answerCbQuery(`✅ Выбран вариант оплаты: ${paymentMethodName || variantMethod}`, { show_alert: false });
            return;
        }

        if (data === 'select_bitcheck-requisites') {
            const states = loadJson('states') || {};
            const dealData = states.pendingDeal[from];
            const deal = deals.find(d => d.id === dealData.dealId);
            const config = loadJson('config') || {};
            const discount = await getCommissionDiscount(from);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';

            deal.processingStatus = false;
            deals[deals.findIndex(d => d.id === deal.id)] = deal;

            try {
                await ctx.deleteMessage(dealData.messageId);
            } catch (error) {
                console.error(`Error deleting message ${dealData.messageId}:`, error.message);
            }

            const caption = buildDealConfirmationMessage(deal, discount, priorityPrice, '', paymentTarget);
            const replyMarkup = buildDealConfirmationReplyMarkup(deal.id);
            const message = await sendBitCheckPhoto(ctx.chat.id, {
                caption,
                reply_markup: replyMarkup,
                parse_mode: 'HTML'
            });
            states.pendingDeal[from].messageId = message.message_id;
            saveJson('states', states);
            saveJson('deals', deals);
            await ctx.answerCbQuery('✅ Выбраны реквизиты BitCheck', { show_alert: false });
            return;
        }

        if (data.startsWith('submit_')) {
            const states = loadStates();
            const parts = data.split('_').slice(1);
            if (parts.length < 1) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const [dealId, paymentVariant] = parts;
            if (!dealId) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'draft');
            if (dealIndex === -1) {
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND_OR_PROCESSED, { show_alert: true });
                return;
            }

            const deal = deals[dealIndex];
            deal.status = deal.type === 'buy' ? 'unpaid' : 'pending';
            deals[dealIndex] = deal;

            const users = loadJson('users') || [];
            const user = users.find(u => u.id === deal.userId);
            const config = loadJson('config') || {};
            const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
            const operatorContactUrl = getOperatorContactUrl(deal.currency);
            const discount = await getCommissionDiscount(deal.userId);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;

            let paymentDetailsText;
            let selectedPaymentDetails;
            if (deal.type === 'buy') {
                paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                if (deal.processingStatus) {
                    try {
                        const merchantDeal = await startMerchantDeal(
                            states.pendingDeal[deal.userId].paymentDetailsId,
                            paymentVariant
                        );
                        deal.selectedPaymentDetailsId = merchantDeal.id;
                        deal.paymentDetailsId = states.pendingDeal[deal.userId].paymentDetailsId;
                        deal.paymentInternalId = states.pendingDeal[deal.userId].paymentInternalId || merchantDeal.internalId;
                        deal.paymentVariant = paymentVariant;
                        deal.paymentOption = states.pendingDeal[deal.userId].paymentOption;
                        selectedPaymentDetails = merchantDeal.deals[0];
                        const expiresAt = new Date(merchantDeal.expireAt);
                        const now = new Date();
                        const deadlineMinutes = Math.ceil((expiresAt - now) / (60 * 1000));
                        const formattedDeadline = formatDate(expiresAt, true);

                        paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>Оплату переводите строго по реквизитам ниже ⚠️ Время на оплату — ${deadlineMinutes} минут (крайнее время - ${formattedDeadline}) ⏱️ Затем пришлите заявку и чек оператору ⚠️\nКарта: ${selectedPaymentDetails.requisites.requisites}\nФИО: ${selectedPaymentDetails.requisites.holder}</code>\n\nP.S. Перевести можно из любого банка - главное, правильно указать номер карты получателя`;
                    } catch (error) {
                        console.error(`Error starting merchant deal for deal ${deal.id}:`, error.message);
                        paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>‼️ Ошибка. Для вашей суммы в данный момент нет подходящих реквизитов</code>`;
                        selectedPaymentDetails = null;
                    }
                } else {
                    selectedPaymentDetails = getAvailablePaymentDetails(deal.currency, deal.rubAmount);
                    if (selectedPaymentDetails) {
                        deal.selectedPaymentDetailsId = selectedPaymentDetails.id;
                        let targetPaymentDetails;
                        if (deal.currency === 'BTC') {
                            targetPaymentDetails = config.buyPaymentDetailsBTC;
                        } else if (deal.currency === 'LTC') {
                            targetPaymentDetails = config.buyPaymentDetailsLTC;
                        }
                        const paymentDetailsIndex = targetPaymentDetails.findIndex(detail => detail.id === selectedPaymentDetails.id);
                        if (paymentDetailsIndex !== -1) {
                            targetPaymentDetails[paymentDetailsIndex].timestamp = new Date().toISOString();
                            const currentRubAmount = deals
                                .filter(d =>
                                    d.selectedPaymentDetailsId === selectedPaymentDetails.id &&
                                    ['pending', 'completed'].includes(d.status) &&
                                    new Date(d.timestamp) >= new Date(targetPaymentDetails[paymentDetailsIndex].lastResetTimestamp || 0)
                                )
                                .reduce((sum, d) => sum + (d.rubAmount || 0), 0);
                            if (currentRubAmount >= targetPaymentDetails[paymentDetailsIndex].limitReachedRub) {
                                targetPaymentDetails[paymentDetailsIndex].lastResetTimestamp = new Date().toISOString();
                            }
                            saveJson('config', config);
                        }
                        const deadlineMinutes = config.dealPaymentDeadlineMinutes;
                        const deadlineTime = new Date(Date.now() + deadlineMinutes * 60 * 1000);
                        const formattedDeadline = formatDate(deadlineTime, true);
                        paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>Оплату переводите строго по реквизитам ниже ⚠️ Время на оплату — ${config.dealPaymentDeadlineMinutes} минут (крайнее время - ${formattedDeadline}) ⏱️ Затем пришлите заявку и чек оператору ⚠️\n${selectedPaymentDetails.description}</code>`;
                    } else {
                        paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>‼️ Свяжитесь с оператором для получения реквизитов или попробуйте создать заявку через ${config.dealCreationRecoveryMinutes} минут</code>`;
                    }
                }
            } else {
                const bitCheckWallet = deal.currency === 'BTC' ? config.sellWalletBTC : config.sellWalletLTC;
                paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                paymentDetailsText += `\n\n${deal.currency} кошелёк BitCheck:\n<code>${bitCheckWallet}</code>`;
            }

            try {
                await ctx.deleteMessage(states.pendingDeal[deal.userId]?.messageId);
            } catch (error) {
                console.error(`Error deleting message ${states.pendingDeal[deal.userId]?.messageId}:`, error.message);
            }

            let paymentSystemText = '';
            if (deal.processingStatus && states.pendingDeal[deal.userId]) {
                const paymentVariant = states.pendingDeal[deal.userId].paymentVariant;
                const paymentOption = states.pendingDeal[deal.userId].paymentOption;
                if (paymentVariant) {
                    const paymentMethodName = await getPaymentMethodName(paymentVariant);
                    paymentSystemText = buildPaymentSystemText(paymentVariant, paymentOption, paymentMethodName);
                }
            }

            const caption = buildDealCreatedMessage(deal, discount, priorityPrice, paymentSystemText, paymentDetailsText, selectedPaymentDetails);
            const replyMarkup = buildDealReplyMarkup(deal, operatorContactUrl, selectedPaymentDetails);

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
                            let operatorPaymentSystemText = '';
                            if (deal.processingStatus && states.pendingDeal[deal.userId]) {
                                const paymentVariant = states.pendingDeal[deal.userId].paymentVariant;
                                const paymentOption = states.pendingDeal[deal.userId].paymentOption;
                                if (paymentVariant) {
                                    const paymentMethodName = await getPaymentMethodName(paymentVariant);
                                    operatorPaymentSystemText = buildPaymentSystemText(paymentVariant, paymentOption, paymentMethodName);
                                }
                            }
                            
                            const operatorCaption = buildOperatorDealMessage(deal, user, operatorPaymentSystemText, paymentDetailsText);
                            const operatorReplyMarkup = buildOperatorDealReplyMarkup(deal, user);
                            await sendBitCheckPhoto(operatorId, {
                                caption: operatorCaption,
                                reply_markup: operatorReplyMarkup,
                                parse_mode: 'HTML'
                            });
                        }
                    } catch (error) {
                        console.error(`Error sending to operator ${operator.username}:`, error.message);
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
            const parts = data.split('_');
            if (parts.length < 3) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const dealId = parts[2];
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'unpaid');
            if (dealIndex === -1) {
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND_OR_PROCESSED, { show_alert: true });
                return;
            }
            const deal = deals[dealIndex];
            const users = loadJson('users') || [];
            const user = users.find(u => u.id === deal.userId);
            const config = loadJson('config') || {};
            const operatorContactUrl = getOperatorContactUrl(deal.currency);
            const discount = await getCommissionDiscount(deal.userId);
            const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
            let paymentDetailsText = '';

            if (deal.processingStatus) {
                try {
                    const invoiceId = deal.selectedPaymentDetailsId || deal.paymentDetailsId || states.pendingDeal[deal.userId]?.paymentDetailsId;
                    
                    if (!invoiceId) {
                        console.error(`Error processing payment for deal ${deal.id}: invoiceId not found`);
                        await ctx.answerCbQuery(MESSAGES.ERROR_PAYMENT_INVOICE_ID_NOT_FOUND, { show_alert: true });
                        return;
                    }
                    
                    const invoice = await getMerchantInvoice(invoiceId);
                    
                    if (!invoice.deals || invoice.deals.length === 0) {
                        console.error(`Error processing payment for deal ${deal.id}: No deals found in invoice`);
                        await ctx.answerCbQuery(MESSAGES.ERROR_PAYMENT_INVOICE_DATA_NOT_FOUND, { show_alert: true });
                        return;
                    }
                    
                    const selectedPaymentDetails = invoice.deals[0];
                    deal.selectedPaymentDetailsId = invoice.id;
                    
                    const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
                    paymentDetailsText = `${paymentTarget}: <code>${deal.walletAddress}</code>`;
                    
                    if (selectedPaymentDetails.requisites) {
                        paymentDetailsText += `\n\nРеквизиты BitCheck:\n<code>Карта: ${selectedPaymentDetails.requisites.requisites}\nФИО: ${selectedPaymentDetails.requisites.holder}</code>\n\nP.S. Перевести можно из любого банка - главное, правильно указать номер карты получателя`;
                    }
                    
                    const dealStatusFromAPI = selectedPaymentDetails.status;
                    
                    if (dealStatusFromAPI === 'completed') {
                        deal.status = 'pending';
                        deals[dealIndex] = deal;
                        saveJson('deals', deals);
                        
                        try {
                            await ctx.deleteMessage(states.pendingDeal[deal.userId]?.messageId);
                        } catch (error) {
                            console.error(`Error deleting message ${states.pendingDeal[deal.userId]?.messageId}:`, error.message);
                        }
                        
                        const message = await sendBitCheckPhoto(ctx.chat.id, {
                            caption: `✅ Оплата по заявке № ${deal.id} подтверждена!\n` +
                                `Покупка ${deal.currency}\n` +
                                `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                                `Сумма: ${deal.rubAmount} RUB\n` +
                                `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                                `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                                `Итог: ${deal.total} RUB\n` +
                                `Кошелёк: ${deal.walletAddress}\n\n` +
                                `Свяжитесь с оператором, чтобы завершить сделку! ⬇️`,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📞 Написать оператору', url: operatorContactUrl }],
                                    [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                                ]
                            },
                            parse_mode: 'HTML'
                        });
                        
                        states.pendingDeal[deal.userId] = { messageId: message.message_id, dealId: deal.id };
                        saveJson('states', states);
                    } else {
                        deals[dealIndex] = deal;
                        saveJson('deals', deals);
                        
                        await ctx.answerCbQuery('⏳ Проверка статуса оплаты запущена. Ожидаем подтверждения от API...', { show_alert: false });
                        
                        await checkInvoiceStatus(deal.id, deal.userId, deal.selectedPaymentDetailsId || deal.paymentDetailsId);
                        return;
                    }
                } catch (error) {
                    console.error(`Error processing payment for deal ${deal.id}:`, error.message);
                    const errorMessage = error.message.includes('Processing is not enabled') 
                        ? '❌ Платёжная система недоступна. Обратитесь в поддержку.'
                        : MESSAGES.ERROR_PAYMENT_PROCESSING_FAILED;
                    await ctx.answerCbQuery(errorMessage, { show_alert: true });
                    return;
                }
            } else {
                if (deal.selectedPaymentDetailsId) {
                    let targetPaymentDetails;
                    if (deal.currency === 'BTC') {
                        targetPaymentDetails = config.buyPaymentDetailsBTC;
                    } else if (deal.currency === 'LTC') {
                        targetPaymentDetails = config.buyPaymentDetailsLTC;
                    }
                    const paymentDetailsIndex = targetPaymentDetails.findIndex(detail => detail.id === deal.selectedPaymentDetailsId);
                    if (paymentDetailsIndex !== -1) {
                        targetPaymentDetails[paymentDetailsIndex].confirmedUsages++;
                        targetPaymentDetails[paymentDetailsIndex].timestamp = new Date().toISOString();
                        saveJson('config', config);
                        paymentDetailsText += `Реквизиты BitCheck:\n<code>${targetPaymentDetails[paymentDetailsIndex].description}</code>`;
                    } else {
                        paymentDetailsText += `Реквизиты BitCheck:\n<code>‼️ Не удалось выбрать реквизиты</code>`;
                    }
                }

                try {
                    await ctx.deleteMessage(states.pendingDeal[deal.userId]?.messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[deal.userId]?.messageId}:`, error.message);
                }

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `✅ Оплата по заявке № ${deal.id} подтверждена!\n` +
                        `Покупка ${deal.currency}\n` +
                        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                        `Сумма: ${deal.rubAmount} RUB\n` +
                        `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                        `Итог: ${deal.total} RUB\n` +
                        `Кошелёк: ${deal.walletAddress}\n\n` +
                        `${paymentDetailsText}\n\n` +
                        `Свяжитесь с оператором, чтобы завершить сделку! ⬇️`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📞 Написать оператору', url: operatorContactUrl }],
                            [{ text: '❌ Отменить заявку', callback_data: `cancel_deal_${deal.id}` }]
                        ]
                    },
                    parse_mode: 'HTML'
                });

                states.pendingDeal[deal.userId] = { messageId: message.message_id, dealId: deal.id };
                saveJson('states', states);
                saveJson('deals', deals);
            }

            const operators = getOperators(deal.currency);
            for (const operator of operators) {
                try {
                    const operatorId = users.find(u => u.username === operator.username)?.id;
                    if (operatorId && await isValidChat(operatorId)) {
                        const operatorKeyboard = [
                            [
                                { text: '🗑️ Удалить', callback_data: `operator_delete_deal_${deal.id}` },
                                { text: '✅ Завершить', callback_data: `operator_complete_deal_${deal.id}` }
                            ],
                            [{ text: '📞 Написать пользователю', url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${deal.userId}` }]
                        ];
                        if (deal.processingStatus) {
                            operatorKeyboard.unshift([
                                { text: '🔗 Приложить хеш транзакции', callback_data: `attach_tx_hash_${deal.id}` }
                            ]);
                        }
                        await sendBitCheckPhoto(operatorId, {
                            caption: `🆕 Новая заявка на сделку № ${deal.id}\n` +
                                `Покупка ${deal.currency}\n` +
                                `@${user.username || 'Нет'} (ID ${deal.userId})\n` +
                                `Количество: ${deal.cryptoAmount}\n` +
                                `Сумма: ${deal.rubAmount} RUB\n` +
                                `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                                `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                                `Итог: ${deal.total} RUB\n` +
                                `Кошелёк: ${deal.walletAddress}\n\n` +
                                `${paymentDetailsText}`,
                            reply_markup: {
                                inline_keyboard: operatorKeyboard
                            },
                            parse_mode: 'HTML'
                        });
                    }
                } catch (error) {
                    console.error(`Error sending to operator ${operator.username}:`, error.message);
                }
            }

            await ctx.answerCbQuery('✅ Оплата подтверждена', { show_alert: false });
        }

        if (data.startsWith('attach_tx_hash_')) {
            const states = loadStates();
            clearPendingStates(states, from);
            const parts = data.split('_');
            if (parts.length < 4) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const dealId = parts[3];
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'pending');
            if (dealIndex === -1) {
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND_OR_PROCESSED, { show_alert: true });
                return;
            }
            const deal = deals[dealIndex];
            states.pendingTransactionHash[ctx.from.id] = { dealId: deal.id };
            saveJson('states', states);
            await ctx.reply('🔗 Введите хеш транзакции', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: 'cancel_action' }]
                    ]
                }
            });
        }

        if (data.startsWith('cancel_deal_')) {
            const states = loadStates();
            const parts = data.split('_');
            if (parts.length < 3) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const dealId = parts[2];
            const dealIndex = deals.findIndex(d => d.id === dealId && d.status !== 'completed' && d.status !== 'expired');
            
            if (dealIndex === -1) {
                const deal = deals.find(d => d.id === dealId);
                if (deal && (deal.status === 'completed' || deal.status === 'expired')) {
                    await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_CANNOT_CANCEL, { show_alert: true });
                    return;
                }
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND, { show_alert: true });
                return;
            }

            if (dealIndex !== -1) {
                const deal = deals[dealIndex];
                deals.splice(dealIndex, 1);
                saveJson('deals', deals);

                if (deal.processingStatus && deal.selectedPaymentDetailsId) {
                    try {
                        const config = loadJson('config') || {};
                        const cancelId = (config.processingType === 'settlex_processing' && deal.paymentInternalId) 
                            ? deal.paymentInternalId 
                            : deal.selectedPaymentDetailsId;
                        await cancelInvoice(cancelId);
                    } catch (error) {
                        console.error(`Error canceling invoice for deal ${dealId}:`, error.message);
                        if (error.message.includes('Processing is not enabled')) {
                            console.error(`Processing is not enabled, skipping invoice cancellation for deal ${dealId}`);
                        }
                    }
                }

                try {
                    await ctx.deleteMessage(states.pendingDeal[from]?.messageId);
                } catch (error) {
                    console.error(`Error deleting message ${states.pendingDeal[from]?.messageId}:`, error.message);
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
            const parts = data.split('_');
            if (parts.length < 4) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const dealId = parts[3];
            try {
                let deals = loadJson('deals');
                const dealIndex = deals.findIndex(d => d.id === dealId);

                if (dealIndex === -1) {
                    await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND_OR_PROCESSED, { show_alert: true });
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
                console.error('Error deleting deal:', error.message);
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_DELETE_FAILED, { show_alert: true });
            }
            return;
        }

        if (data.startsWith('operator_complete_deal_')) {
            const parts = data.split('_');
            if (parts.length < 4) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const dealId = parts[3];
            try {
                let deals = loadJson('deals');
                const dealIndex = deals.findIndex(d => d.id === dealId);

                if (dealIndex === -1) {
                    await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_NOT_FOUND_OR_PROCESSED, { show_alert: true });
                    return;
                }

                const deal = deals[dealIndex];
                deals[dealIndex] = { ...deal, status: 'completed' };
                saveJson('deals', deals);

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === deal.userId);
                const config = loadJson('config') || {};
                const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
                const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                const caption = `✅ Сделка №${deal.id} завершена!\n` +
                    `${actionText} ${deal.currency}\n` +
                    `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                    `Сумма: ${deal.rubAmount} RUB\n` +
                    `Комиссия: ${deal.commission} RUB\n` +
                    `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                    `Итог: ${deal.total} RUB\n` +
                    `Кошелёк: ${deal.walletAddress}`;

                const operatorContactUrl = getOperatorContactUrl(deal.currency);

                try {
                    const message = await sendBitCheckPhoto(user.id, {
                        caption: caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: operatorContactUrl }]
                            ]
                        }
                    });
                    const states = loadJson('states');
                    states.pendingDeal[user.id] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    if (shouldLogSendError(error)) {
                        console.error(`Error sending completion notification to user ${user.id}:`, error.message);
                    }
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
                        if (shouldLogSendError(error)) {
                            console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                        }
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
                console.error('Error completing deal:', error.message);
                await ctx.answerCbQuery(MESSAGES.ERROR_DEAL_COMPLETE_FAILED, { show_alert: true });
            }
            return;
        }

        if (data.startsWith('operator_complete_withdrawal_')) {
            const parts = data.split('_');
            if (parts.length < 4) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return;
            }
            const withdrawalId = parts[3];
            try {
                let withdrawals = loadJson('withdrawals');
                const withdrawalIndex = withdrawals.findIndex(w => w.id === withdrawalId);

                if (withdrawalIndex === -1) {
                    await ctx.answerCbQuery(MESSAGES.ERROR_WITHDRAWAL_NOT_FOUND_OR_PROCESSED, { show_alert: true });
                    return;
                }

                const withdrawal = withdrawals[withdrawalIndex];
                if (!withdrawal || !withdrawal.userId || typeof withdrawal.cryptoAmount !== 'number' || typeof withdrawal.rubAmount !== 'number' || !withdrawal.walletAddress) {
                    await ctx.answerCbQuery(MESSAGES.ERROR_WITHDRAWAL_DATA_NOT_FOUND, { show_alert: true });
                    return;
                }
                withdrawals[withdrawalIndex] = { ...withdrawal, status: 'completed' };
                saveJson('withdrawals', withdrawals);

                const userId = withdrawal.userId;
                const operatorContactUrl = getOperatorContactUrl('BTC');

                try {
                    const message = await sendBitCheckPhoto(userId, {
                        caption: `✅ Вывод рефералов завершен! № ${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nКошелёк: ${withdrawal.walletAddress}`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: operatorContactUrl }]
                            ]
                        }
                    });
                    const states = loadJson('states');
                    states.pendingWithdrawal[userId] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    if (shouldLogSendError(error)) {
                        console.error(`Error sending withdrawal completion notification to user ${userId}:`, error.message);
                    }
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
                console.error('Error completing withdrawal:', error.message);
                await ctx.answerCbQuery(MESSAGES.ERROR_WITHDRAWAL_COMPLETE_FAILED, { show_alert: true });
            }
            return;
        }

        if (data === 'cancel_action') {
            const states = loadStates();
            const callbackMessageId = ctx.callbackQuery.message?.message_id;
            
            if (callbackMessageId) {
                try {
                    await ctx.deleteMessage(callbackMessageId);
                } catch (error) {
                    if (!error.message.includes('not found')) {
                        console.error(`Error deleting callback message ${callbackMessageId}:`, error.message);
                    }
                }
            }

            const stateKeys = ['pendingDeal', 'pendingWithdrawal', 'pendingUpdateProfile', 'pendingSupport', 'pendingTransactionHash'];
            for (const key of stateKeys) {
                if (states[key] && states[key][from] && states[key][from].messageId) {
                    const messageId = states[key][from].messageId;
                    if (messageId && messageId !== callbackMessageId) {
                        try {
                            await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
                        } catch (error) {
                            if (!error.message.includes('not found') && !error.message.includes('Bad Request')) {
                                console.error(`Error deleting message ${messageId}:`, error.message);
                            }
                        }
                    }
                }
            }

            clearPendingStates(states, from);
            saveJson('states', states);
            await ctx.answerCbQuery('❌ Действие отменено', { show_alert: false });
        }
    } catch (error) {
        console.error('Error processing callback query:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
        try {
            await ctx.answerCbQuery(MESSAGES.ERROR_CALLBACK_PROCESSING, { show_alert: true });
        } catch (answerError) {
            console.error('Error answering callback query:', answerError.message);
        }
    }
});

main_bot.catch((err, ctx) => {
    console.error(`Telegraf error for update ${ctx?.update?.update_id || 'unknown'}:`, err);
    if (err.stack) {
        console.error('Error stack:', err.stack);
    }
});

function getBot() {
    return main_bot;
}

async function stopBot() {
    try {
        await main_bot.telegram.deleteWebhook();
        console.log('Webhook удален, бот остановлен');
    } catch (error) {
        console.error('Ошибка при остановке бота:', error.message);
    }
}

process.once('SIGINT', async () => {
    await stopBot();
    process.exit(0);
});

process.once('SIGTERM', async () => {
    await stopBot();
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    if (reason && reason.stack) {
        console.error('Stack:', reason.stack);
    }
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (error.stack) {
        console.error('Stack:', error.stack);
    }
    process.exit(1);
});

module.exports = { getBot, stopBot };