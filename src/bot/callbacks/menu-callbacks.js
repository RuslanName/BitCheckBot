const { MESSAGES } = require('../../config');
const { loadJson, saveJson, sendBitCheckPhoto, sendReviewPhoto } = require('../../utils');

function registerMenuCallbacks(bot) {
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

            if (data === 'back_to_menu') {
                const states = loadJson('states') || {};
                if (states.pendingOther?.[from]) {
                    delete states.pendingOther[from];
                }
                saveJson('states', states);

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === from);
                if (!user) {
                    await ctx.answerCbQuery('❌ Вы не зарегистрированы. Используйте /start', { show_alert: true });
                    return;
                }
                await sendBitCheckPhoto(ctx.chat.id, {
                    caption: 'BitCheck - Обменник',
                    reply_markup: {
                        keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '📞 Контакты'], ['📋 Прочее']],
                        resize_keyboard: true
                    }
                });
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'show_rules') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const rulesText = `📜 Правила BitCheck

1. Запрещено создавать несколько аккаунтов
2. Запрещено использовать бота для мошеннических операций
3. При возникновении спорных решений обращайтесь в поддержку
4. Администрация оставляет за собой право блокировки аккаунтов нарушителей
5. Все сделки окончательны и не подлежат возврату
6. Запрещено использовать бота для отмывания средств
7. Пользователь обязуется предоставить достоверные данные
8. Администрация не несёт ответственности за ошибки, вызванные неверными данными пользователя`;

                const message = await ctx.reply(rulesText, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'back_to_other_menu' }]
                        ]
                    }
                });
                states.pendingOther = states.pendingOther || {};
                states.pendingOther[from] = { messageId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'back_to_other_menu') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: MESSAGES.OTHER_MENU_TEXT,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '♻️ Обновить реквизиты', callback_data: 'update_requisites' }],
                            [{ text: '💸 Зарабатывай с нами', callback_data: 'earn_money' }],
                            [{ text: '📜 Правила', callback_data: 'show_rules' }]
                        ]
                    }
                });
                states.pendingOther = states.pendingOther || {};
                states.pendingOther[from] = { messageId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'earn_money') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const message = await ctx.reply(`💸 Зарабатывай с BitCheck!

🔗 Приглашай друзей по реферальной ссылке
💰 Получай бонусы за каждую их сделку
⭐ Оставляй отзывы и получай дополнительные награды

Выбери раздел ниже, чтобы узнать больше!`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔗 Ваша реферальная ссылка', callback_data: 'referral_link' }],
                            [{ text: '⭐ Заработок на отзывах', callback_data: 'earn_reviews' }],
                            [{ text: MESSAGES.CB_BACK, callback_data: 'back_to_other_menu' }]
                        ]
                    }
                });
                states.pendingOther = states.pendingOther || {};
                states.pendingOther[from] = { messageId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'referral_link') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === from);
                if (!user) {
                    await ctx.answerCbQuery(MESSAGES.CB_USER_NOT_FOUND, { show_alert: true });
                    return;
                }
                const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
                const shareLink = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Присоединяйся к BitCheck через мою реферальную ссылку!')}`;

                const copyButton = {
                    text: '📋 Скопировать рефссылку',
                    copy_text: { text: referralLink }
                };

                const message = await ctx.reply(`🔗 Ваша реферальная ссылка:
${referralLink}

👥 Приглашено: ${(user.referrals || []).length}
💰 Заработано: ${(user.balance || 0).toFixed(8)} BTC

💎 Делитесь ссылкой и зарабатывайте!`, {
                    reply_markup: {
                        inline_keyboard: [
                            [copyButton],
                            [{ text: '📤 Поделиться рефссылкой', url: shareLink }],
                            [{ text: MESSAGES.CB_BACK, callback_data: 'earn_money' }]
                        ]
                    }
                });
                states.pendingOther = states.pendingOther || {};
                states.pendingOther[from] = { messageId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'earn_reviews') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const message = await sendReviewPhoto(ctx.chat.id, {
                    caption: `⭐ Заработок на отзывах!

Оставляйте отзывы о BitCheck и получайте бонусы!
Каждый честный отзыв помогает нам становиться лучше.

Нажмите "Примеры отзывов", чтобы увидеть образцы.`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📝 Пример отзывов', callback_data: 'show_review_examples' }],
                            [{ text: MESSAGES.CB_BACK, callback_data: 'earn_money' }]
                        ]
                    }
                });
                states.pendingOther = states.pendingOther || {};
                states.pendingOther[from] = { messageId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'show_review_examples') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const message = await ctx.reply(`📝 Примеры отзывов:

"Отличный обменник! Быстро и надёжно."
"Пользуюсь давно, ни разу не подвели."
"Поддержка помогла решить вопрос за 5 минут."
"Курс выгодный, комиссия адекватная."

Оставляйте свои отзывы и получайте бонусы!`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'earn_reviews' }]
                        ]
                    }
                });
                states.pendingOther = states.pendingOther || {};
                states.pendingOther[from] = { messageId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
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

module.exports = { registerMenuCallbacks };
