const cron = require('node-cron');
const { loadJson, saveJson } = require('../utils/storage-utils');
const { loadStates } = require('../utils/state-utils');
const { getOperatorContactUrl, getOperators, isValidChat } = require('./user-service');
const { getCommissionDiscount } = require('./commission-service');
const { sendBitCheckPhoto, getMainBotInstance } = require('../utils/telegram-utils');
const { buildOperatorDealMessage, buildOperatorDealReplyMarkup, buildPaymentSystemText } = require('./message-service');
const { shouldLogSendError } = require('../utils');

const cronTasks = new Map();

async function checkUnpaidDeals() {
    try {
        const deals = loadJson('deals') || [];
        const config = loadJson('config') || {};
        const users = loadJson('users') || [];
        const states = loadStates() || {};
        const now = new Date();
        const paymentTimeout = (config.dealPaymentDeadlineMinutes || 25) * 60 * 1000;
        const reminderTimeout = 10 * 60 * 1000;
        
        const draftDeals = deals.filter(d => d.status === 'draft');
        const nowTime = now.getTime();
        
        for (let i = 0; i < draftDeals.length; i++) {
            const deal = draftDeals[i];
            
            if (!deal.selectedPaymentDetailsId) {
                const dealTime = new Date(deal.timestamp);
                const timePassed = nowTime - dealTime.getTime();
                
                if (timePassed > paymentTimeout) {
                    const dealIndex = deals.findIndex(d => d.id === deal.id);
                    if (dealIndex === -1) continue;
                    
                    deals[dealIndex].status = 'expired';
                    const user = users.find(u => u.id === deal.userId);
                    if (!user) continue;

                    const messageText = `⏰ Время действия вашей заявки истекло.\nЗаявка была автоматически отменена.`;

                    try {
                        const bot = getMainBotInstance();
                        await bot.telegram.sendMessage(deal.userId, messageText, { parse_mode: 'HTML' });
                    } catch (error) {
                        if (shouldLogSendError(error)) {
                            console.error(`Error sending expiration to user ${deal.userId}:`, error.message);
                        }
                    }
                } else if (timePassed > reminderTimeout && !deal.reminderSent) {
                    const dealIndex = deals.findIndex(d => d.id === deal.id);
                    if (dealIndex !== -1) {
                        deals[dealIndex].reminderSent = true;
                        
                        const user = users.find(u => u.id === deal.userId);
                        if (!user) continue;

                        const messageText = `⏰ У вас есть активная заявка, которая ожидает вашего решения.\nПожалуйста, проверьте статус оплаты.`;

                        try {
                            const bot = getMainBotInstance();
                            await bot.telegram.sendMessage(deal.userId, messageText, { parse_mode: 'HTML' });
                        } catch (error) {
                            if (shouldLogSendError(error)) {
                                console.error(`Error sending reminder to user ${deal.userId}:`, error.message);
                            }
                        }
                    }
                }
                continue;
            }
            
            let isExpired = false;

            if (isExpired) {
                const dealIndex = deals.findIndex(d => d.id === deal.id);
                if (dealIndex === -1) continue;
                
                deals[dealIndex].status = 'expired';
                const user = users.find(u => u.id === deal.userId);
                if (!user) continue;

                const messageText = `⏰ Время действия вашей заявки истекло.\nЗаявка была автоматически отменена.`;

                try {
                    const bot = getMainBotInstance();
                    await bot.telegram.sendMessage(deal.userId, messageText, { parse_mode: 'HTML' });
                } catch (error) {
                    if (shouldLogSendError(error)) {
                        console.error(`Error sending expiration to user ${deal.userId}:`, error.message);
                    }
                }
            }
        }
        saveJson('deals', deals);
        saveJson('states', states);
    } catch (error) {
        console.error('Error checking unpaid deals:', error.message);
    }
}

async function checkInvoiceStatus(dealId, userId, invoiceId, merchantApiKey, maxAttempts = 4) {
    return;
}

module.exports = {
    checkUnpaidDeals,
    checkInvoiceStatus
};

