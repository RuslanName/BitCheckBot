const cron = require('node-cron');
const { loadJson, saveJson } = require('../utils/storage_utils');
const { loadStates } = require('../utils/state_utils');
const { getProcessing, isProcessingEnabled } = require('../integrations');
const { getOperatorContactUrl } = require('./user_service');
const { getCommissionDiscount } = require('./commission_service');
const { sendBitCheckPhoto } = require('../utils/telegram_utils');

const cronTasks = new Map();

function setCronTasks(cronTasksMap) {
    Object.assign(cronTasks, cronTasksMap);
}

async function checkUnpaidDeals() {
    try {
        if (!isProcessingEnabled()) {
            return;
        }
        
        const deals = loadJson('deals') || [];
        const config = loadJson('config') || {};
        const users = loadJson('users') || [];
        const states = loadStates() || {};
        const now = new Date();
        const paymentTimeout = (config.dealPaymentDeadlineMinutes || 15) * 60 * 1000;

        for (let i = deals.length - 1; i >= 0; i--) {
            const deal = deals[i];
            if (deal.status !== 'unpaid') continue;

            let isExpired = false;
            if (!deal.selectedPaymentDetailsId) {
                const dealTime = new Date(deal.timestamp);
                if (now - dealTime > paymentTimeout) {
                    deals.splice(i, 1);
                    continue;
                }
            } else if (deal.processingStatus) {
                try {
                    const invoiceId = deal.selectedPaymentDetailsId || deal.paymentDetailsId;
                    
                    if (!invoiceId) {
                        continue;
                    }
                    
                    const processing = getProcessing();
                    if (!processing) {
                        continue;
                    }
                    
                    const transaction = await processing.getInvoice(invoiceId);
                    if (transaction.expires_at) {
                        const expiresAt = new Date(transaction.expires_at);
                        if (now > expiresAt) {
                            isExpired = true;
                        }
                    }
                } catch (error) {
                    if (!error.message.includes('Processing is not enabled')) {
                        console.error(`Error checking transaction ${deal.selectedPaymentDetailsId} for deal ${deal.id}:`, error.message);
                    }
                }
            }

            if (isExpired) {
                deal.status = 'expired';
                const user = users.find(u => u.id === deal.userId);
                if (!user) continue;

                const operatorContactUrl = getOperatorContactUrl(deal.currency);
                const caption = `❌ Время оплаты по заявке № ${deal.id} истекло!\n` +
                    `Покупка ${deal.currency}\n` +
                    `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                    `Сумма: ${deal.rubAmount} RUB\n\n` +
                    `‼️ Если произошла ошибка, пожалуйста, свяжитесь с оператором!`;

                try {
                    const message = await sendBitCheckPhoto(deal.userId, {
                        caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: operatorContactUrl }]
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

async function checkInvoiceStatus(dealId, userId, invoiceId, merchantApiKey, maxAttempts = 4) {
    const states = loadStates();
    const deals = loadJson('deals');
    const dealIndex = deals.findIndex(d => d.id === dealId && d.status === 'pending');
    if (dealIndex === -1) {
        console.log(`Deal ${dealId} not found or already processed, stopping status check`);
        return;
    }

    let attempts = 0;
    const checkTask = cron.schedule('*/5 * * * *', async () => {
        try {
            const processing = getProcessing();
            if (!processing) {
                cronTasks.delete(`check_invoice_${dealId}`);
                checkTask.stop();
                return;
            }
            const invoice = await processing.getInvoice(invoiceId);
            const dealStatus = invoice.deals && invoice.deals.length > 0 ? invoice.deals[0].status : null;
            if (dealStatus === 'completed') {
                deals[dealIndex].status = 'completed';
                saveJson('deals', deals);

                const config = loadJson('config');
                const operatorContactUrl = getOperatorContactUrl(deals[dealIndex].currency);
                const priorityPrice = deals[dealIndex].priority === 'elevated' ? config.priorityPriceRub : 0;
                const discount = await getCommissionDiscount(userId);

                const caption = `✅ Сделка №${dealId} завершена!\n` +
                    `Покупка ${deals[dealIndex].currency}\n` +
                    `Количество: ${deals[dealIndex].cryptoAmount} ${deals[dealIndex].currency}\n` +
                    `Сумма: ${deals[dealIndex].rubAmount} RUB\n` +
                    `Комиссия: ${deals[dealIndex].commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                    `Приоритет: ${deals[dealIndex].priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                    `Итог: ${deals[dealIndex].total} RUB\n` +
                    `Кошелёк: ${deals[dealIndex].walletAddress}`;

                try {
                    const message = await sendBitCheckPhoto(userId, {
                        caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: operatorContactUrl }]
                            ]
                        },
                        parse_mode: 'HTML'
                    });
                    states.pendingDeal[userId] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    console.error(`Error sending completion notification to user ${userId}:`, error.message);
                }

                cronTasks.delete(`check_invoice_${dealId}`);
                checkTask.stop();
            } else if (attempts >= maxAttempts) {
                deals[dealIndex].status = 'expired';
                saveJson('deals', deals);

                const operatorContactUrl = getOperatorContactUrl(deals[dealIndex].currency);
                const caption = `❌ Время подтверждения по заявке № ${dealId} истекло!\n` +
                    `Покупка ${deals[dealIndex].currency}\n` +
                    `Количество: ${deals[dealIndex].cryptoAmount} ${deals[dealIndex].currency}\n` +
                    `Сумма: ${deals[dealIndex].rubAmount} RUB\n\n` +
                    `‼️ Если произошла ошибка, пожалуйста, свяжитесь с оператором!`;

                try {
                    const message = await sendBitCheckPhoto(userId, {
                        caption,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📞 Написать оператору', url: operatorContactUrl }]
                            ]
                        },
                        parse_mode: 'HTML'
                    });
                    states.pendingDeal[userId] = { messageId: message.message_id };
                    saveJson('states', states);
                } catch (error) {
                    console.error(`Error sending expiration notification to user ${userId}:`, error.message);
                }

                cronTasks.delete(`check_invoice_${dealId}`);
                checkTask.stop();
            }
            attempts++;
        } catch (error) {
            console.error(`Error checking invoice status for deal ${dealId}:`, error.message);
            if (attempts >= maxAttempts) {
                cronTasks.delete(`check_invoice_${dealId}`);
                checkTask.stop();
            }
            attempts++;
        }
    }, {
        scheduled: true,
        timezone: 'UTC'
    });

    cronTasks.set(`check_invoice_${dealId}`, checkTask);
    console.log(`Scheduled invoice status check for deal ${dealId}`);
}

module.exports = {
    checkUnpaidDeals,
    checkInvoiceStatus,
    setCronTasks
};

