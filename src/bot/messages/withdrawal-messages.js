const { MESSAGES } = require('../../config');
const {
    getBtcRubPrice,
    getOperatorContactUrl,
    getOperators,
    isValidChat
} = require('../../services');
const {
    loadJson,
    saveJson,
    loadStates,
    sendBitCheckPhoto
} = require('../../utils');

function registerWithdrawalMessages(bot) {
    bot.on('message', async (ctx, next) => {
        try {
            const config = loadJson('config') || {};
            const users = loadJson('users') || [];
            const states = loadStates() || {};
            const id = ctx.from.id;
            const user = users.find(u => u.id === id);
            if (user && user.isBlocked) return;

            if (!ctx.message || !ctx.message.text) {
                return next();
            }

            if (!users.find(u => u.id === id)) {
                return next();
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
            return next();
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
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
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
        return next();
            }

            const pendingWD = states.pendingWithdrawal?.[id];
            if ((pendingWD?.type === 'wd_cashback_amt' || pendingWD?.type === 'wd_referral_amt') && !pendingWD?.rubAmount) {
                const input = ctx.message.text.trim();
                const val = parseFloat(input);
                if (isNaN(val) || val <= 0) {
                    await ctx.reply('❌ Введите число');
            return next();
                }
                const rub = val;
                if (rub < 500 || rub > pendingWD.balance) {
                    await ctx.reply(`❌ Сумма должна быть от 500 до ${pendingWD.balance.toFixed(2)} RUB`);
            return next();
                }
                pendingWD.rubAmount = rub;
                pendingWD.type = pendingWD.type.replace('_amt', '_req');
                saveJson('states', states);
                await ctx.reply('📝 Введите реквизиты (кошелёк или карту)');
        return next();
            }

            if (pendingWD?.type === 'wd_cashback_req' || pendingWD?.type === 'wd_referral_req') {
                const wallet = ctx.message.text?.trim();
                if (!wallet || wallet.length < 5) {
                    await ctx.reply('❌ Введите корректные реквизиты');
            return next();
                }
                const isCashback = pendingWD.type === 'wd_cashback_req';
                const users = loadJson('users') || [];
                const user = users.find(u => u.id === id);
                const config = loadJson('config') || {};

                const dealType = isCashback ? 'withdraw_cashback' : 'withdraw_referral';
                const deal = {
                    id: Date.now().toString(),
                    userId: id,
                    username: user?.username || 'Нет',
                    type: dealType,
                    currency: 'RUB',
                    rubAmount: pendingWD.rubAmount,
                    cryptoAmount: 0,
                    commission: 0,
                    total: pendingWD.rubAmount,
                    walletAddress: wallet,
                    status: 'unpaid',
                    priority: 'normal',
                    timestamp: new Date().toISOString()
                };

                const deals = loadJson('deals') || [];
                deals.push(deal);
                saveJson('deals', deals);

                if (isCashback) {
                    user.cashback = (user.cashback || 0) - pendingWD.rubAmount;
                }
                saveJson('users', users);

                const actionText = isCashback ? 'Вывод кешбэка' : 'Вывод рефералов';
                const caption = `🆕 Новая заявка на ${actionText} № ${deal.id}\n` +
                    `@${user?.username || 'Нет'} (ID ${user?.id})\n` +
                    `Сумма: ${deal.rubAmount.toFixed(2)} RUB\n` +
                    `Реквизиты: ${wallet}\n` +
                    `Статус: Ожидает`;

                const operatorContactUrl = getOperatorContactUrl('BTC');
                const operatorReplyMarkup = {
                    inline_keyboard: [
                        [{ text: '✅ Подтвердить', callback_data: `operator_complete_deal_${deal.id}` }],
                        [{ text: '❌ Отклонить', callback_data: `operator_delete_deal_${deal.id}` }],
                        [{ text: '✍️ Написать', url: `tg://user?id=${deal.userId}` }]
                    ]
                };

                const userCaption = `✅ Заявка на ${actionText} создана!\n` +
                    `№ ${deal.id}\n` +
                    `Сумма: ${deal.rubAmount.toFixed(2)} RUB\n` +
                    `Реквизиты: ${wallet}\n\n` +
                    `📞 Ожидайте подтверждения оператора`;

                const userReplyMarkup = {
                    inline_keyboard: [
                        [{ text: '📞 Написать оператору', url: operatorContactUrl }]
                    ]
                };

                await sendBitCheckPhoto(ctx.chat.id, {
                    caption: userCaption,
                    reply_markup: userReplyMarkup,
                    parse_mode: 'HTML'
                });

                const operators = getOperators('BTC');
                for (const operator of operators) {
                    try {
                        const operatorId = users.find(u => u.username === operator.username)?.id;
                        if (operatorId && await isValidChat(operatorId)) {
                            await sendBitCheckPhoto(operatorId, {
                                caption: caption,
                                reply_markup: operatorReplyMarkup,
                                parse_mode: 'HTML'
                            });
                        }
                    } catch (error) {
                        console.error(`Error sending withdrawal to operator ${operator.username}:`, error.message);
                    }
                }

                delete states.pendingWithdrawal[id];
                saveJson('states', states);
        return next();
            }

            const userState = user?.state;
            if (!userState || !userState.action) {
        return next();
            }

            if (states.pendingWithdrawal[id]) {
                if (!ctx.message || !ctx.message.text) {
            return next();
                }

                const input = ctx.message.text.trim();
                const priceBTC = await getBtcRubPrice();
                const inputValue = parseFloat(input);
                let amount, rubAmount;

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === id);
                if (!user) {
                    console.error(`User not found: ${id}`);
            return next();
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
            return next();
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
                            inline_keyboard: [[{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]]
                        }
                    });
                    states.pendingWithdrawal[id].messageId = message.message_id;
                    saveJson('states', states);
            return next();
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
                        caption: MESSAGES.WALLET_INPUT_PROMPT,
                        reply_markup: {
                            inline_keyboard: [[{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]]
                        }
                    });
                    states.pendingWithdrawal[id].messageId = message.message_id;
                    states.pendingWithdrawal[id].newWallet = true;
                    saveJson('states', states);
            return next();
                }

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `💼 Выберите кошелёк:\n${wallets.map((wallet, index) => `${index + 1}) <code>${wallet}</code>`).join('\n')}`,
                    reply_markup: {
                        inline_keyboard: [
                            ...(wallets.length > 0 ? wallets.map((wallet, index) => [{ text: `${index + 1}`, callback_data: `select_withdrawal_wallet_${index}` }]) : []),
                            [{ text: '➕ Новый', callback_data: 'add_withdrawal_wallet' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    },
                    parse_mode: 'HTML'
                });
                states.pendingWithdrawal[id].messageId = message.message_id;
                states.pendingWithdrawal[id].action = 'select_withdrawal_wallet';
                states.pendingWithdrawal[id].walletType = 'defaultWalletsBTC';
                saveJson('states', states);
            }
            await next();
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
}

module.exports = { registerWithdrawalMessages };
