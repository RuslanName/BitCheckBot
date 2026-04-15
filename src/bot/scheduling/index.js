const cron = require('node-cron');
const async = require('async');
const { loadJson, saveJson, formatDate, sendBitCheckPhoto, shouldLogSendError, telegramWithRetry } = require('../../utils');
const { generateRaffleResults, isValidChat } = require('../../services');
const { getMainBotInstance } = require('../../utils/telegram-utils');
const { BIT_CHECK_IMAGE_PATH, DATA_PATH } = require('../../config');
const path = require('path');
const fs = require('fs-extra');

const cronTasks = new Map();
let isScheduling = false;

async function sendBroadcast(broadcast) {
    let success = true;
    let broadcasts = loadJson('broadcasts') || [];
    const broadcastIndex = broadcasts.findIndex(b => b.id === broadcast.id);

    if (broadcastIndex === -1) {
        console.error(`Broadcast ${broadcast.id} not found`);
        return false;
    }

    if (!broadcast.isDaily && broadcasts[broadcastIndex].status === 'sent') {
        return false;
    }

    if (broadcasts[broadcastIndex].status === 'sending') {
        const lastAttempt = broadcasts[broadcastIndex].lastAttemptTime;
        if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
            return false;
        }
    }

    let photoSource;
    let imagePath = null;
    if (broadcast.file_id) {
        photoSource = broadcast.file_id;
    } else {
        imagePath = broadcast.imageName
            ? path.join(DATA_PATH, 'uploads/broadcasts', broadcast.imageName)
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

    const bot = getMainBotInstance();
    let fileIdSaved = false;
    const queue = async.queue(async (user, callback) => {
        if (!user.id || !(await isValidChat(user.id))) {
            callback();
            return;
        }

        try {
            const options = { caption: `${broadcast.text}\n\n` };
            let msg = await telegramWithRetry(
                () => bot.telegram.sendPhoto(user.id, photoSource, options)
            );

            if (!fileIdSaved && !broadcast.file_id && typeof photoSource !== 'string' && msg.photo && msg.photo.length > 0) {
                const currentBroadcasts = loadJson('broadcasts') || [];
                const currentBroadcast = currentBroadcasts.find(b => b.id === broadcast.id);
                if (currentBroadcast) {
                    currentBroadcast.file_id = msg.photo[msg.photo.length - 1].file_id;
                    saveJson('broadcasts', currentBroadcasts);
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
        const scheduledDate = new Date(broadcast.scheduledTime);
        const mskOffset = 3 * 60 * 60 * 1000;
        const mskScheduledTimeMs = scheduledDate.getTime() + mskOffset;
        const mskScheduledTime = new Date(mskScheduledTimeMs);
        const mskHours = mskScheduledTime.getUTCHours();
        const mskMinutes = mskScheduledTime.getUTCMinutes();

        const now = new Date();
        const nowMskMs = now.getTime() + mskOffset;
        const nowMsk = new Date(nowMskMs);
        const mskYear = nowMsk.getUTCFullYear();
        const mskMonth = nowMsk.getUTCMonth();
        const mskDay = nowMsk.getUTCDate();

        const nextDayMskMs = Date.UTC(mskYear, mskMonth, mskDay + 1, mskHours, mskMinutes, 0, 0);
        const nextDayUTC = new Date(nextDayMskMs - mskOffset);
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
            return;
        }
    }

    if (raffles[raffleIndex].status !== 'pending') {
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
        `⏰ Результаты розыгрыша будут объявлены ${formatDate(raffle.endDate, true)}\n\n`;

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
        return;
    }

    if (raffles[raffleIndex].status === 'sending_results') {
        const lastAttempt = raffles[raffleIndex].lastAttemptTime;
        if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
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

    const batches = [
        users.filter(u => operatorIds.includes(u.id)),
        winners,
        otherUsers
    ];

    for (const userGroup of batches) {
        for (let i = 0; i < userGroup.length; i += BATCH_SIZE) {
            const batch = userGroup.slice(i, i + BATCH_SIZE);
            batch.forEach(user => queue.push(user));
            await queue.drain();
            await new Promise(resolve => setTimeout(resolve, batchDelay));
        }
    }

    raffles = loadJson('raffles') || [];
    const updatedRaffle = raffles.find(r => r.id === raffle.id);
    if (updatedRaffle) {
        updatedRaffle.status = 'completed';
        delete updatedRaffle.lastAttemptTime;
        saveJson('raffles', raffles);
    }
}

async function scheduleTasks() {
    if (isScheduling) {
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
                    continue;
                }

                if (broadcast.status === 'sending') {
                    const lastAttempt = broadcast.lastAttemptTime;
                    if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
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
                    continue;
                }

                if (cronTasks.has(broadcast.id)) {
                    continue;
                }

                if (scheduledTime <= now) {
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
                } else {
                    cronTime = `${mskSeconds} ${mskMinutes} ${mskHours} ${mskDate} ${mskMonth} *`;
                }

                const task = cron.schedule(cronTime, async () => {
                    await sendBroadcast(broadcast);
                    cronTasks.delete(broadcast.id);
                }, {
                    scheduled: true,
                    timezone: 'Europe/Moscow'
                });

                cronTasks.set(broadcast.id, task);
            }
        }

        const raffles = loadJson('raffles') || [];
        if (!Array.isArray(raffles)) {
            console.error('Invalid raffles data format');
        } else {
            for (let i = 0; i < raffles.length; i++) {
                let raffle = raffles[i];
                if (!raffle.id || !raffle.startDate || !raffle.endDate || raffle.status === 'completed') {
                    continue;
                }

                if (raffle.status === 'sending_notification' || raffle.status === 'sending_results') {
                    const lastAttempt = raffle.lastAttemptTime;
                    if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < 3600000) {
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
                    continue;
                }

                if (!cronTasks.has(`raffle_notification_${raffle.id}`) && raffle.status === 'pending') {
                    if (startDate <= now) {
                        await sendRaffleNotification(raffle);
                    } else {
                        const cronTime = `${startDate.getUTCSeconds()} ${startDate.getUTCMinutes()} ${startDate.getUTCHours()} ${startDate.getUTCDate()} ${startDate.getUTCMonth() + 1} *`;
                        const task = cron.schedule(cronTime, async () => {
                            await sendRaffleNotification(raffle);
                        }, {
                            scheduled: true,
                            timezone: 'UTC'
                        });
                        cronTasks.set(`raffle_notification_${raffle.id}`, task);
                    }
                }

                if (!cronTasks.has(`raffle_${raffle.id}`)) {
                    if (endDate <= now) {
                        await processRaffleEnd(raffle);
                    } else {
                        const cronTime = `${endDate.getUTCSeconds()} ${endDate.getUTCMinutes()} ${endDate.getUTCHours()} ${endDate.getUTCDate()} ${endDate.getUTCMonth() + 1} *`;
                        const task = cron.schedule(cronTime, async () => {
                            await processRaffleEnd(raffle);
                        }, {
                            scheduled: true,
                            timezone: 'UTC'
                        });
                        cronTasks.set(`raffle_${raffle.id}`, task);
                    }
                }
            }
        }

        const checkUnpaidDealsTaskId = 'check-unpaid-deals';
        if (!cronTasks.has(checkUnpaidDealsTaskId)) {
            const { checkUnpaidDeals } = require('../../services');
            const cronTime = '*/1 * * * *';
            const task = cron.schedule(cronTime, async () => {
                await checkUnpaidDeals();
            }, {
                scheduled: true,
                timezone: 'UTC'
            });
            cronTasks.set(checkUnpaidDealsTaskId, task);
        }
    } catch (error) {
        console.error('Error scheduling tasks:', error.message);
    } finally {
        isScheduling = false;
        console.log('Scheduling completed');
    }
}

let reloadTimeout = null;
function reloadTasks() {
    if (reloadTimeout) {
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

module.exports = {
    scheduleTasks,
    reloadTasks,
    sendBroadcast,
    sendRaffleNotification,
    processRaffleEnd,
    cronTasks
};
