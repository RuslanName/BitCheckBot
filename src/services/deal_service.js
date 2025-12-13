const cron = require('node-cron');
const { loadJson, saveJson } = require('../utils/storage_utils');
const { loadStates } = require('../utils/state_utils');
const { getProcessing, isProcessingEnabled } = require('../integrations');
const { getOperatorContactUrl, getOperators, isValidChat } = require('./user_service');
const { getCommissionDiscount } = require('./commission_service');
const { sendBitCheckPhoto } = require('../utils/telegram_utils');
const { buildOperatorDealMessage, buildOperatorDealReplyMarkup, buildPaymentSystemText } = require('./message_service');

const cronTasks = new Map();

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
                    isExpired = true;
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
                const deal = deals[dealIndex];
                const config = loadJson('config');
                const users = loadJson('users') || [];
                const user = users.find(u => u.id === userId);
                
                if (!user) {
                    cronTasks.delete(`check_invoice_${dealId}`);
                    checkTask.stop();
                    return;
                }

                const operators = getOperators(deal.currency);
                let operatorNotified = false;
                
                for (const operator of operators) {
                    try {
                        const operatorId = users.find(u => u.username === operator.username)?.id;
                        if (operatorId && await isValidChat(operatorId)) {
                            const operatorCaption = `✅ Оплата подтверждена API!\n\n` +
                                `🆕 Заявка на сделку № ${deal.id}\n` +
                                `@${user.username || 'Нет'} (ID ${user.id})\n` +
                                `Покупка ${deal.currency}\n` +
                                `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                                `Сумма: ${deal.rubAmount} RUB\n` +
                                `Комиссия: ${deal.commission} RUB\n` +
                                `Приоритет: ${deal.priority === 'elevated' ? 'Повышенный' : 'Обычный'}\n` +
                                `Итог: ${deal.total} RUB\n` +
                                `Кошелёк: ${deal.walletAddress}\n\n` +
                                `💳 Оплата подтверждена платежной системой. Требуется завершение сделки.`;

                            const operatorReplyMarkup = buildOperatorDealReplyMarkup(deal, user);
                            await sendBitCheckPhoto(operatorId, {
                                caption: operatorCaption,
                                reply_markup: operatorReplyMarkup,
                                parse_mode: 'HTML'
                            });
                            operatorNotified = true;
                        }
                    } catch (error) {
                        console.error(`Error sending notification to operator ${operator.username}:`, error.message);
                    }
                }

                if (operatorNotified) {
                    const operatorContactUrl = getOperatorContactUrl(deal.currency);
                    const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                    const discount = await getCommissionDiscount(userId);

                    const caption = `✅ Оплата по заявке № ${deal.id} подтверждена платежной системой!\n` +
                        `Покупка ${deal.currency}\n` +
                        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                        `Сумма: ${deal.rubAmount} RUB\n` +
                        `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
                        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                        `Итог: ${deal.total} RUB\n` +
                        `Кошелёк: ${deal.walletAddress}\n\n` +
                        `⏳ Ожидайте завершения сделки оператором.`;

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
                        console.error(`Error sending notification to user ${userId}:`, error.message);
                    }
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
    checkInvoiceStatus
};

