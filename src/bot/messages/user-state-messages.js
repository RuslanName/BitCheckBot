const { MESSAGES } = require('../../config');
const {
    getBtcRubPrice,
    calculateUserStats,
    getOperatorContactUrl,
    getOperators,
    isValidChat
} = require('../../services');
const {
    loadJson,
    saveJson,
    loadStates,
    sendBitCheckPhoto,
    generateCaptcha,
    shouldLogSendError
} = require('../../utils');

function registerUserStateMessages(bot) {
    bot.on('message', async (ctx, next) => {
        const id = ctx.from.id;
        try {
            const config = loadJson('config') || {};
            const users = loadJson('users') || [];
            const states = loadStates() || {};
            const user = users.find(u => u.id === id);
            if (user && user.isBlocked) return;

            const userState = user?.state;

            if (userState?.action === 'edit_requisites' && userState?.step === 'enter_value') {
                if (!ctx.message || !ctx.message.text) {
                    return next();
                }
                const newValue = ctx.message.text.trim();
                if (newValue.length < 5) {
                    await ctx.reply('❌ Слишком короткое значение (минимум 5 символов)');
                    return next();
                }
                const type = userState.type;
                const userIndex = users.findIndex(u => u.id === id);
                const userObj = users[userIndex];
                if (type === 'btc') {
                    userObj.btcWallet = newValue;
                    userObj.defaultWalletsBTC = userObj.defaultWalletsBTC || [];
                    if (!userObj.defaultWalletsBTC.includes(newValue)) {
                        userObj.defaultWalletsBTC.push(newValue);
                    }
                } else if (type === 'ltc') {
                    userObj.ltcWallet = newValue;
                    userObj.defaultWalletsLTC = userObj.defaultWalletsLTC || [];
                    if (!userObj.defaultWalletsLTC.includes(newValue)) {
                        userObj.defaultWalletsLTC.push(newValue);
                    }
                } else if (type === 'xmr') {
                    userObj.xmrWallet = newValue;
                } else if (type === 'sbp') {
                    userObj.sbp = newValue;
                } else if (type === 'card') {
                    userObj.cardNumber = newValue;
                }
                saveJson('users', users);
                userObj.state = null;
                saveJson('users', users);
                await ctx.reply('✅ Реквизиты сохранены');
                return next();
            }

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
                    await ctx.reply(MESSAGES.CAPTCHA_SUCCESS);

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
                        `💰 Приглашайте друзей и получайте бонусы!\n\n`;
                    await sendBitCheckPhoto(ctx.chat.id, {
                        caption: profileText,
                        reply_markup: {
                            keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '📞 Контакты'], ['📋 Прочее']],
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
        return next();
            }

            if (users.find(u => u.id === id)) {
                if (!ctx.message || !ctx.message.text) {
            return next();
                }

                if (states.pendingUpdateProfile[id] && states.pendingUpdateProfile[id].type && states.pendingUpdateProfile[id].type.startsWith('add_')) {
                    const typeParts = states.pendingUpdateProfile[id].type.split('_');
                    if (typeParts.length < 2) {
                return next();
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
                            caption: isSell ? '❌ Введите корректные реквизиты' : MESSAGES.ERROR_INVALID_WALLET_ADDRESS(type === 'defaultWalletsBTC' ? 'BTC' : 'LTC')
                        });
                        states.pendingUpdateProfile[id].messageId = message.message_id;
                        saveJson('states', states);
                return next();
                    }

                    if (!user) {
                        console.error(`User not found: ${id}`);
                return next();
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
            return next();
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
                                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                                        ]
                                    }
                                });
                                await sendBitCheckPhoto(ctx.chat.id, { caption: `✅ Ответ отправлен пользователю ID ${supportData.targetId}` });
                            } catch (error) {
                                if (shouldLogSendError(error)) {
                                    console.error(`Error sending response to user ${supportData.targetId}:`, error.message);
                                }
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

                        const message = await sendBitCheckPhoto(ctx.chat.id, { caption: '✅ Сообщение отправлено в поддержку' });
                        states.pendingSupport[id] = { messageId: message.message_id };
                        saveJson('states', states);
                    }

                    saveJson('states', states);
            return next();
                }

                if (states.pendingTransactionHash[ctx.from.id]) {
                    const transactionHash = ctx.message.text;
                    const dealId = states.pendingTransactionHash[ctx.from.id].dealId;
                    const deals = loadJson('deals') || [];
                    const dealIndex = deals.findIndex(d => d.id === dealId);
                    if (dealIndex === -1) {
                        await ctx.reply('❌ Заявка не найдена или уже обработана');
                        delete states.pendingTransactionHash[ctx.from.id];
                        saveJson('states', states);
                return next();
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

module.exports = { registerUserStateMessages };
