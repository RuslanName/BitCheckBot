const { MESSAGES } = require('../../config');
const {
    getBtcRubPrice,
    getLtcRubPrice,
    getXmrRubPrice,
    getCommissionDiscount,
    calculateCommission
} = require('../../services');
const {
    loadJson,
    saveJson,
    loadStates,
    sendBitCheckPhoto
} = require('../../utils');

async function getPrice(currency) {
    switch (currency) {
        case 'BTC': return await getBtcRubPrice();
        case 'LTC': return await getLtcRubPrice();
        case 'XMR': return await getXmrRubPrice();
        default: throw new Error(`Unsupported currency: ${currency}`);
    }
}

function getMinAmountRub(currency, isBuy, config) {
    switch (currency) {
        case 'BTC': return isBuy ? config.minBuyAmountRubBTC : config.minSellAmountRubBTC;
        case 'LTC': return isBuy ? config.minBuyAmountRubLTC : config.minSellAmountRubLTC;
        case 'XMR': return isBuy ? config.minBuyAmountRubXMR : config.minSellAmountRubXMR;
        default: throw new Error(`Unsupported currency: ${currency}`);
    }
}

function getMaxAmountRub(currency, isBuy, config) {
    switch (currency) {
        case 'BTC': return isBuy ? config.maxBuyAmountRubBTC : config.maxSellAmountRubBTC;
        case 'LTC': return isBuy ? config.maxBuyAmountRubLTC : config.maxSellAmountRubLTC;
        case 'XMR': return isBuy ? config.maxBuyAmountRubXMR : config.maxSellAmountRubXMR;
        default: throw new Error(`Unsupported currency: ${currency}`);
    }
}

function registerDealFlowMessages(bot) {
    bot.on('message', async (ctx, next) => {
        try {
            const config = loadJson('config') || {};
            const users = loadJson('users') || [];
            const states = loadStates() || {};
            const id = ctx.from.id;
            const user = users.find(u => u.id === id);
            if (user && user.isBlocked) return next();

            if (!ctx.message || !ctx.message.text) {
                return next();
            }

            if (!users.find(u => u.id === id)) {
                return next();
            }

            if (states.pendingDeal[id] && states.pendingDeal[id].newWallet) {
                const dealData = states.pendingDeal[id];
                if (!dealData || !dealData.type || !dealData.currency) {
                    console.error(`Invalid dealData for user ${id}`);
                    return next();
                }
                const isBuy = dealData.type === 'buy';
                const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites';
                const wallet = ctx.message.text.trim();

                if (!wallet) {
                    try { await ctx.deleteMessage(states.pendingDeal[id].messageId); } catch (error) { console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message); }
                    const message = await sendBitCheckPhoto(ctx.chat.id, { caption: isBuy ? MESSAGES.ERROR_INVALID_WALLET_ADDRESS(dealData.currency) : '❌ Введите корректные реквизиты' });
                    states.pendingDeal[id].messageId = message.message_id;
                    saveJson('states', states);
                    return next();
                }

                dealData.wallet = wallet;
                try { await ctx.deleteMessage(states.pendingDeal[id].messageId); } catch (error) { console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message); }

                const actionText = isBuy ? 'кошелёк' : 'реквизиты';
                states.pendingDeal[id].pendingWallet = wallet;
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `📝 Хотите ли добавить ${actionText} как постоянный?\n${wallet}`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Нет', callback_data: 'save_wallet_no' }, { text: 'Да', callback_data: 'save_wallet_yes' }],
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingDeal[id].messageId = message.message_id;
                states.pendingDeal[id].previousStep = 'enter_wallet';
                states.pendingDeal[id].action = 'save_wallet';
                states.pendingDeal[id].walletType = walletType;
                saveJson('states', states);
                return next();
            }

            if (states.pendingDeal[id] && states.pendingDeal[id].amount && !states.pendingDeal[id].wallet) {
                const dealData = states.pendingDeal[id];
                if (!dealData || !dealData.type || !dealData.currency) {
                    console.error(`Invalid dealData for user ${id}`);
                    return next();
                }
                const isBuy = dealData.type === 'buy';
                const currency = dealData.currency;
                const walletType = isBuy ? `defaultWallets${dealData.currency}` : 'defaultRequisites';
                const wallets = user[walletType] || [];

                if (wallets.length > 0) {
                    try { await ctx.deleteMessage(states.pendingDeal[id]?.messageId); } catch (error) { console.error(`Error deleting message ${states.pendingDeal[id]?.messageId}:`, error.message); }

                    const caption = isBuy
                        ? `💼 Выберите кошелёк для покупки <b>${currency}</b>:\n\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`
                        : `💼 Выберите реквизиты для продажи <b>${currency}</b>:\n\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`;
                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption,
                        reply_markup: {
                            inline_keyboard: [
                                ...wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_wallet_${index}` }]),
                                [{ text: '➕ Новый', callback_data: `add_wallet` }],
                                [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                                [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                            ]
                        },
                        parse_mode: isBuy ? 'HTML' : undefined
                    });
                    states.pendingDeal[id].messageId = message.message_id;
                    states.pendingDeal[id].action = 'select_wallet';
                    states.pendingDeal[id].previousStep = 'enter_amount';
                    states.pendingDeal[id].walletType = walletType;
                    saveJson('states', states);
                    return next();
                }

                const caption = isBuy ? `💼 Введите адрес кошелька для ${dealData.currency}` : `💼 Введите реквизиты (СБП или номер карты)`;
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingDeal[id].messageId = message.message_id;
                states.pendingDeal[id].newWallet = true;
                saveJson('states', states);
                return next();
            }

            if (states.pendingDeal[id]) {
                if (!ctx.message || !ctx.message.text) {
                    return next();
                }

                let input = ctx.message.text.trim();
                let isCryptoInput = false, amount, rub, rubBefore;
                const dealData = states.pendingDeal[id];
                if (!dealData || !dealData.type || !dealData.currency) {
                    console.error(`Invalid dealData for user ${id}`);
                    return next();
                }
                const isBuy = dealData.type === 'buy';
                const currency = dealData.currency;
                const price = await getPrice(currency);
                const minAmountRub = getMinAmountRub(currency, isBuy, config);
                const maxAmountRub = getMaxAmountRub(currency, isBuy, config);
                const minAmountCrypto = (minAmountRub / price).toFixed(8);
                const maxAmountCrypto = (maxAmountRub / price).toFixed(8);

                const inputValue = parseFloat(input);
                if (isNaN(inputValue) || inputValue <= 0) {
                    try { await ctx.deleteMessage(states.pendingDeal[id].messageId); } catch (error) { console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message); }
                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `${MESSAGES.ERROR_INVALID_AMOUNT(currency)}\n\n💰 Введите сумму для ${isBuy ? 'покупки' : 'продажи'} ${currency} (в RUB или ${currency})\nМин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency})\nМакс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
                        reply_markup: { inline_keyboard: [[{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]] }
                    });
                    states.pendingDeal[id].messageId = message.message_id;
                    saveJson('states', states);
                    return next();
                }

                if (currency === 'BTC') {
                    isCryptoInput = inputValue < 1;
                } else if (currency === 'LTC') {
                    isCryptoInput = inputValue < (isBuy ? 100 : 1000);
                }

                const discount = await getCommissionDiscount(id);
                const commission = await calculateCommission(isCryptoInput ? inputValue * price : inputValue, currency, dealData.type);
                const effectiveCommission = Math.round(commission * (1 - discount / 100));

                if (isCryptoInput) {
                    amount = inputValue;
                    rubBefore = amount * price;
                    rub = isBuy ? rubBefore : rubBefore - effectiveCommission;
                } else {
                    rubBefore = inputValue;
                    amount = rubBefore / price;
                    rub = isBuy ? rubBefore : rubBefore - effectiveCommission;
                }

                const total = isBuy ? rub + effectiveCommission : rub;

                if (rubBefore < minAmountRub || rubBefore > maxAmountRub) {
                    try { await ctx.deleteMessage(states.pendingDeal[id].messageId); } catch (error) { console.error(`Error deleting message ${states.pendingDeal[id].messageId}:`, error.message); }
                    const message = await sendBitCheckPhoto(ctx.chat.id, {
                        caption: `${isBuy ? "❌ Сумма покупки" : "❌ Сумма продажи"} ${currency} вне диапазона. Мин: ${minAmountRub} RUB (~${minAmountCrypto} ${currency}), Макс: ${maxAmountRub} RUB (~${maxAmountCrypto} ${currency})`,
                        reply_markup: { inline_keyboard: [[{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]] }
                    });
                    states.pendingDeal[id].messageId = message.message_id;
                    saveJson('states', states);
                    return next();
                }

                const walletType = isBuy ? `defaultWallets${currency}` : 'defaultRequisites';
                const wallets = user[walletType] || [];

                dealData.amount = amount;
                dealData.rub = rub;
                dealData.commission = effectiveCommission;
                dealData.total = total;
                dealData.rubBefore = rubBefore;

                try { await ctx.deleteMessage(states.pendingDeal[id].messageId); } catch (error) { console.error(`Error deleting bot message:`, error.message); }

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
                                [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                                [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                            ]
                        },
                        parse_mode: isBuy ? 'HTML' : undefined
                    });
                    states.pendingDeal[id].messageId = message.message_id;
                    states.pendingDeal[id].action = 'select_wallet';
                    states.pendingDeal[id].previousStep = 'enter_amount';
                    states.pendingDeal[id].walletType = walletType;
                    saveJson('states', states);
                    return next();
                }

                const caption = isBuy ? `💼 Введите адрес кошелька для ${currency}` : `💼 Введите реквизиты (СБП или номер карты)`;
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingDeal[id].messageId = message.message_id;
                states.pendingDeal[id].newWallet = true;
                states.pendingDeal[id].action = 'enter_wallet';
                states.pendingDeal[id].previousStep = 'enter_amount';
                saveJson('states', states);
                return next();
            }

            return next();
        } catch (error) {
            console.error('Error processing message:', error.message);
            if (error.stack) { console.error('Stack:', error.stack); }
            try { await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_GENERAL }); } catch (sendError) { console.error('Error sending error message:', sendError.message); }
        }
    });
}

module.exports = { registerDealFlowMessages };
