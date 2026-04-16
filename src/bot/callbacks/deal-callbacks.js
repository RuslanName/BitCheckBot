const { MESSAGES } = require('../../config');
const {
    getBtcRubPrice,
    getLtcRubPrice,
    getXmrRubPrice,
    getCommissionDiscount,
    getOperatorContactUrl,
    getOperators,
    isValidChat,
    getAvailablePaymentDetails,
    calculateDealTotals,
    createDealObject,
    buildDealCreatedMessage,
    buildDealReplyMarkup,
    buildDealConfirmationMessage,
    buildDealConfirmationReplyMarkup,
    buildOperatorDealMessage,
    buildOperatorDealReplyMarkup
} = require('../../services');
const { loadJson, saveJson, loadStates, sendBitCheckPhoto, formatDate, shouldLogSendError, clearPendingStates } = require('../../utils');
const { getPrice, getMinAmountRub, getMaxAmountRub } = require('../helpers');

function registerDealCallbacks(bot) {
    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        const from = ctx.from.id;

        try {
            if (!data) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return next();
            }

            const deals = loadJson('deals') || [];
            const withdrawals = loadJson('withdrawals') || [];

            if (data === 'buy_select_btc' || data === 'buy_select_ltc' || data === 'buy_select_xmr') {
                const states = loadStates();
                const currency = data === 'buy_select_btc' ? 'BTC' : data === 'buy_select_ltc' ? 'LTC' : 'XMR';
                states.pendingDeal[from] = states.pendingDeal[from] || {};
                states.pendingDeal[from].type = 'buy';
                states.pendingDeal[from].action = 'enter_amount';
                states.pendingDeal[from].previousStep = 'select_currency';
                states.pendingDeal[from].currency = currency;

                const config = loadJson('config') || {};
                const minAmountRub = getMinAmountRub(currency, true, config);
                const maxAmountRub = getMaxAmountRub(currency, true, config);
                const price = await getPrice(currency);
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
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingDeal[from].messageId = message.message_id;
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'sell_select_btc' || data === 'sell_select_ltc' || data === 'sell_select_xmr') {
                const states = loadStates();
                const currency = data === 'sell_select_btc' ? 'BTC' : data === 'sell_select_ltc' ? 'LTC' : 'XMR';
                states.pendingDeal[from] = states.pendingDeal[from] || {};
                states.pendingDeal[from].type = 'sell';
                states.pendingDeal[from].action = 'enter_amount';
                states.pendingDeal[from].previousStep = 'select_currency';
                states.pendingDeal[from].currency = currency;

                const config = loadJson('config') || {};
                const minAmountRub = getMinAmountRub(currency, false, config);
                const maxAmountRub = getMaxAmountRub(currency, false, config);
                const price = await getPrice(currency);
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
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingDeal[from].messageId = message.message_id;
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

                deals.push(deal);
                states.pendingDeal[from].dealId = deal.id;
                states.pendingDeal[from].priority = priority;
                delete dealData.action;
                delete dealData.walletType;
                delete dealData.newWallet;
                saveJson('deals', deals);
                saveJson('states', states);

                const priorityPriceVal = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                const paymentTarget = dealData.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
                const caption = buildDealConfirmationMessage(deal, discount, priorityPriceVal, '', paymentTarget, false);
                const replyMarkup = buildDealConfirmationReplyMarkup(deal.id, null, false, true);
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: replyMarkup,
                    parse_mode: 'HTML'
                });
                dealData.messageId = message.message_id;
                dealData.dealId = deal.id;
                dealData.action = 'deal_confirmation';
                dealData.previousStep = 'select_priority';
                delete dealData.walletType;
                delete dealData.newWallet;
                saveJson('states', states);
                saveJson('deals', deals);
                await ctx.answerCbQuery(`✅ Выбран приоритет: ${priority === 'elevated' ? 'Повышенный' : 'Обычный'}`, { show_alert: false });
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
                    await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                    return;
                }

                const deal = deals[dealIndex];
                deal.status = 'unpaid';
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

                const paymentSystemText = '';

                const caption = buildDealCreatedMessage(deal, discount, priorityPrice, paymentSystemText, paymentDetailsText, selectedPaymentDetails);
                const replyMarkup = buildDealReplyMarkup(deal, operatorContactUrl, selectedPaymentDetails);

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: replyMarkup,
                    parse_mode: 'HTML'
                });
                states.pendingDeal[deal.userId] = { messageId: message.message_id, dealId: deal.id };

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
                    await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                    return;
                }
                const deal = deals[dealIndex];
                deal.status = 'pending';
                deals[dealIndex] = deal;
                const users = loadJson('users') || [];
                const user = users.find(u => u.id === deal.userId);
                const config = loadJson('config') || {};
                const operatorContactUrl = getOperatorContactUrl(deal.currency);
                const discount = await getCommissionDiscount(deal.userId);
                const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
                const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
                let paymentDetailsText = '';

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
                        `${actionText} ${deal.currency}\n` +
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
                                [{ text: '📞 Написать пользователю', url: `tg://user?id=${deal.userId}` }]
                            ];
                            await sendBitCheckPhoto(operatorId, {
                                caption: `🆕 Новая заявка на сделку № ${deal.id}\n` +
                                    `${actionText} ${deal.currency}\n` +
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
                    await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                    return;
                }
                const deal = deals[dealIndex];
                states.pendingTransactionHash[ctx.from.id] = { dealId: deal.id };
                saveJson('states', states);
                await ctx.reply('🔗 Введите хеш транзакции', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
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
                        await ctx.answerCbQuery('❌ Нельзя отменить завершенную или просроченную заявку', { show_alert: true });
                        return;
                    }
                    await ctx.answerCbQuery('❌ Данные сделки не найдены', { show_alert: true });
                    return;
                }

                if (dealIndex !== -1) {
                    const deal = deals[dealIndex];
                    deals.splice(dealIndex, 1);
                    saveJson('deals', deals);

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
                        await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                        return;
                    }

                    const deal = deals[dealIndex];
                    const users = loadJson('users') || [];
                    const user = users.find(u => u.id === deal.userId);

                    if (deal.type === 'withdraw_cashback' && user) {
                        user.cashback = (user.cashback || 0) + deal.rubAmount;
                        saveJson('users', users);
                    }

                    deals = deals.filter(d => d.id !== dealId);
                    saveJson('deals', deals);

                    let messageText;
                    if (deal.type === 'withdraw_cashback') {
                        messageText = `❌ Вывод кешбэка № ${deal.id} отклонён`;
                    } else if (deal.type === 'withdraw_referral') {
                        messageText = `❌ Вывод рефералов № ${deal.id} отклонён`;
                    } else {
                        messageText = `❌ Сделка № ${deal.id} удалена`;
                    }

                    try {
                        await ctx.editMessageCaption(messageText, {
                            reply_markup: { inline_keyboard: [] }
                        });
                    } catch (error) {
                        await sendBitCheckPhoto(ctx.chat.id, {
                            caption: messageText
                        });
                    }

                    await ctx.answerCbQuery('✅ Заявка отклонена', { show_alert: false });
                } catch (error) {
                    console.error('Error deleting deal:', error.message);
                    await ctx.answerCbQuery('❌ Ошибка при удалении сделки', { show_alert: true });
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
                        await ctx.answerCbQuery('❌ Заявка не найдена или уже обработана', { show_alert: true });
                        return;
                    }

                    const deal = deals[dealIndex];
                    deals[dealIndex] = { ...deal, status: 'completed' };
                    saveJson('deals', deals);

                    const config = loadJson('config') || {};

                    try {
                        const cashbackPercent = config.cashbackPercent || 1;
                        const cashbackAmount = Math.round((deal.rubAmount || 0) * cashbackPercent / 100);
                        if (cashbackAmount > 0 && !deal.cashbackApplied) {
                            const users = loadJson('users') || [];
                            const user = users.find(u => u.id === deal.userId);
                            if (user) {
                                user.cashback = (user.cashback || 0) + cashbackAmount;
                                deal.cashbackApplied = true;
                                saveJson('users', users);
                                deals[dealIndex] = deal;
                                saveJson('deals', deals);
                            }
                        }
                    } catch (e) {
                    }

                    const users = loadJson('users') || [];
                    const user = users.find(u => u.id === deal.userId);
                    const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;

                    let caption;
                    if (deal.type === 'withdraw_cashback') {
                        caption = `✅ Вывод кешбэка №${deal.id} завершён!\n` +
                            `Сумма: ${deal.rubAmount} RUB\n` +
                            `Реквизиты: ${deal.walletAddress}`;
                    } else if (deal.type === 'withdraw_referral') {
                        caption = `✅ Вывод рефералов №${deal.id} завершён!\n` +
                            `Сумма: ${deal.rubAmount} RUB\n` +
                            `Реквизиты: ${deal.walletAddress}`;
                    } else {
                        const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
                        caption = `✅ Сделка №${deal.id} завершена!\n` +
                            `${actionText} ${deal.currency}\n` +
                            `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
                            `Сумма: ${deal.rubAmount} RUB\n` +
                            `Комиссия: ${deal.commission} RUB\n` +
                            `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
                            `Итог: ${deal.total} RUB\n` +
                            `Кошелёк: ${deal.walletAddress}`;
                    }

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
                    await ctx.answerCbQuery('❌ Ошибка при завершении сделки', { show_alert: true });
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
                        await ctx.answerCbQuery('❌ Заявка на вывод не найдена или уже обработана', { show_alert: true });
                        return;
                    }

                    const withdrawal = withdrawals[withdrawalIndex];
                    if (!withdrawal || !withdrawal.userId || typeof withdrawal.rubAmount !== 'number' || !withdrawal.wallet) {
                        await ctx.answerCbQuery('❌ Ошибка: данные для вывода не найдены', { show_alert: true });
                        return;
                    }
                    withdrawals[withdrawalIndex] = { ...withdrawal, status: 'completed' };
                    saveJson('withdrawals', withdrawals);

                    const userId = withdrawal.userId;
                    const operatorContactUrl = getOperatorContactUrl('BTC');

                    try {
                        const message = await sendBitCheckPhoto(userId, {
                            caption: `✅ Вывод ${withdrawal.type === 'wd_cashback_req' ? 'кешбэка' : 'рефералов'} завершен! № ${withdrawal.id}\nСумма: ${withdrawal.rubAmount.toFixed(2)} RUB\nРеквизиты: ${withdrawal.wallet}`,
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
                    await ctx.answerCbQuery('❌ Ошибка при завершении вывода', { show_alert: true });
                }
                return;
            }

            if (data === 'deal_back') {
                const states = loadStates() || {};
                const userId = String(ctx.from.id);
                const pendingDeal = states.pendingDeal?.[userId];
                const callbackMessageId = ctx.callbackQuery.message?.message_id;

                const currentStep = pendingDeal?.action;
                const dealType = pendingDeal?.type;
                const currency = pendingDeal?.currency;

                if (!pendingDeal || !currentStep) {
                    await ctx.answerCbQuery('Нет активного сценария', { show_alert: true });
                    return;
                }

                if (callbackMessageId) {
                    try { await ctx.deleteMessage(callbackMessageId); } catch(e) {}
                }

                if (currentStep === 'enter_amount') {
                    delete states.pendingDeal[userId];
                    saveJson('states', states);

                    const config = loadJson('config') || {};
                    const users = loadJson('users') || [];
                    const user = users.find(u => u.id === parseInt(userId));

                    if (user && user.isBlocked) {
                        await ctx.answerCbQuery('Вы заблокированы', { show_alert: true });
                        return;
                    }

                    if (dealType === 'buy') {
                        const {
                            buildBuyMenuMessage,
                            buildBuyMenuReplyMarkup
                        } = require('../../services');
                        const priceBTC = await getBtcRubPrice();
                        const priceLTC = await getLtcRubPrice();
                        const priceXMR = await getXmrRubPrice();
                        const { calculateMinMaxAmounts } = require('../../services');
                        const btcAmounts = calculateMinMaxAmounts('BTC', config, priceBTC, priceLTC, priceXMR, false);
                        const ltcAmounts = calculateMinMaxAmounts('LTC', config, priceBTC, priceLTC, priceXMR, false);
                        const xmrAmounts = calculateMinMaxAmounts('XMR', config, priceBTC, priceLTC, priceXMR, false);

                        states.pendingDeal[userId] = { type: 'buy', messageId: null };
                        const caption = buildBuyMenuMessage(config, priceBTC, priceLTC, priceXMR, btcAmounts, ltcAmounts, xmrAmounts, false);
                        const replyMarkup = buildBuyMenuReplyMarkup();

                        const message = await sendBitCheckPhoto(ctx.chat.id, { caption, reply_markup: replyMarkup });
                        states.pendingDeal[userId].messageId = message.message_id;
                        saveJson('states', states);
                    } else if (dealType === 'sell') {
                        const {
                            buildSellMenuMessage,
                            buildSellMenuReplyMarkup,
                            calculateSellMinMaxAmounts
                        } = require('../../services');
                        const priceBTC = await getBtcRubPrice();
                        const priceLTC = await getLtcRubPrice();
                        const priceXMR = await getXmrRubPrice();
                        const btcAmounts = calculateSellMinMaxAmounts('BTC', config, priceBTC, priceLTC, priceXMR);
                        const ltcAmounts = calculateSellMinMaxAmounts('LTC', config, priceBTC, priceLTC, priceXMR);
                        const xmrAmounts = calculateSellMinMaxAmounts('XMR', config, priceBTC, priceLTC, priceXMR);

                        states.pendingDeal[userId] = { type: 'sell', messageId: null };
                        const caption = buildSellMenuMessage(config, btcAmounts, ltcAmounts, xmrAmounts);
                        const replyMarkup = buildSellMenuReplyMarkup();

                        const message = await sendBitCheckPhoto(ctx.chat.id, { caption, reply_markup: replyMarkup });
                        states.pendingDeal[userId].messageId = message.message_id;
                        saveJson('states', states);
                    } else {
                        await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                        return;
                    }

                    await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                    return;
                }

                if (currentStep === 'select_wallet' || currentStep === 'enter_wallet') {
                    pendingDeal.action = 'enter_amount';
                    delete pendingDeal.wallet;
                    delete pendingDeal.pendingWallet;
                    delete pendingDeal.amount;
                    delete pendingDeal.rub;
                    delete pendingDeal.commission;
                    delete pendingDeal.total;
                    delete pendingDeal.rubBefore;
                    delete pendingDeal.newWallet;
                    delete pendingDeal.previousStep;

                    const config = loadJson('config') || {};
                    const price = await getPrice(currency);
                    const minAmountRub = dealType === 'buy' ? (currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC) : (currency === 'BTC' ? config.minSellAmountRubBTC : config.minSellAmountRubLTC);
                    const maxAmountRub = currency === 'BTC' ? (dealType === 'buy' ? config.maxBuyAmountRubBTC : config.maxSellAmountRubBTC) : (dealType === 'buy' ? config.maxBuyAmountRubLTC : config.maxSellAmountRubLTC);
                    const minAmountCrypto = (minAmountRub / price).toFixed(8);
                    const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: dealType === 'buy'
                            ? `💰 Введите сумму для покупки ${currency || 'BTC'} (в RUB или ${currency || 'BTC'})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency || 'BTC'})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency || 'BTC'})`
                            : `💸 Введите сумму для продажи ${currency || 'BTC'} (в RUB или ${currency || 'BTC'})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency || 'BTC'})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency || 'BTC'})`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                                [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                            ]
                        }
                    });
                    pendingDeal.messageId = message.message_id;
                    saveJson('states', states);
                    await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                    return;
                }

                if (currentStep === 'select_priority') {
                    pendingDeal.action = 'enter_wallet';
                    delete pendingDeal.priority;
                    delete pendingDeal.dealId;

                    const config = loadJson('config') || {};
                    const price = await getPrice(currency);
                    const minAmountRub = dealType === 'buy' ? (currency === 'BTC' ? config.minBuyAmountRubBTC : config.minBuyAmountRubLTC) : (currency === 'BTC' ? config.minSellAmountRubBTC : config.minSellAmountRubLTC);
                    const maxAmountRub = currency === 'BTC' ? (dealType === 'buy' ? config.maxBuyAmountRubBTC : config.maxSellAmountRubBTC) : (dealType === 'buy' ? config.maxBuyAmountRubLTC : config.maxSellAmountRubLTC);
                    const minAmountCrypto = (minAmountRub / price).toFixed(8);
                    const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: dealType === 'buy'
                            ? `💼 Введите адрес кошелька для ${currency || 'BTC'}`
                            : `💼 Введите реквизиты (СБП или номер карты)`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                                [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                            ]
                        }
                    });
                    pendingDeal.messageId = message.message_id;
                    pendingDeal.previousStep = 'enter_amount';
                    saveJson('states', states);
                    await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                    return;
                }

                if (currentStep === 'deal_confirmation') {
                    pendingDeal.action = 'select_priority';
                    delete pendingDeal.dealId;
                    delete pendingDeal.paymentVariant;
                    delete pendingDeal.paymentOption;
                    delete pendingDeal.paymentDetailsId;
                    delete pendingDeal.paymentInternalId;

                    const config = loadJson('config') || {};
                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `💎 Хотите ли вы, чтобы ваша сделка стала выше в очереди? (Цена ${config.priorityPriceRub} RUB)`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Нет', callback_data: 'priority_normal' }, { text: 'Да', callback_data: 'priority_elevated' }],
                                [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                                [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                            ]
                        }
                    });
                    pendingDeal.messageId = message.message_id;
                    saveJson('states', states);
                    await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                    return;
                }

                if (currentStep === 'save_wallet') {
                    pendingDeal.action = 'enter_wallet';
                    delete pendingDeal.pendingWallet;

                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: dealType === 'buy'
                            ? `💼 Введите адрес кошелька для ${currency || 'BTC'}`
                            : `💼 Введите реквизиты (СБП или номер карты)`,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                                [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                            ]
                        }
                    });
                    pendingDeal.messageId = message.message_id;
                    pendingDeal.newWallet = true;
                    pendingDeal.previousStep = 'enter_amount';
                    saveJson('states', states);
                    await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                    return;
                }

                await ctx.answerCbQuery(MESSAGES.CB_BACK, { show_alert: false });
                return;
            }
            await next();
        } catch (error) {
            console.error('Error processing callback query:', error.message);
            if (error.stack) {
                console.error('Stack:', error.stack);
            }
            try {
                await ctx.answerCbQuery('❌ Ошибка обработки', { show_alert: true });
            } catch (answerError) {
                console.error('Error answering callback query:', answerError.message);
            }
        }
    });
}

module.exports = { registerDealCallbacks };
