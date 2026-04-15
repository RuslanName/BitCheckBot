const { MESSAGES } = require('../../config');
const { getBtcRubPrice, getOperators, isValidChat, getAvailablePaymentDetails, generateRaffleResults } = require('../../services');
const { loadJson, saveJson, loadStates, sendBitCheckPhoto, shouldLogSendError } = require('../../utils');

function registerRequisitesCallbacks(bot) {
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

            if (data === 'update_requisites') {
                const states = loadJson('states') || {};
                const pendingOther = states.pendingOther?.[from];
                if (pendingOther?.messageId) {
                    try { await ctx.deleteMessage(pendingOther.messageId); } catch(e) {}
                }

                const users = loadJson('users') || [];
                const userIndex = users.findIndex(u => u.id === from);
                if (userIndex !== -1) {
                    users[userIndex].state = null;
                    saveJson('users', users);
                }

                if (states.pendingDeal[from]) {
                    delete states.pendingDeal[from];
                }
                if (states.pendingWithdrawal[from]) {
                    delete states.pendingWithdrawal[from];
                }

                states.pendingWithdrawal = states.pendingWithdrawal || {};

                const message = await ctx.reply(`📝 Управление реквизитами

Выберите кошелёк для редактирования:
• BTC — Bitcoin кошельки
• LTC — Litecoin кошельки
• XMR — Monero кошелёк
• СБП — реквизиты СБП
• Карта — банковская карта

Вы также можете удалить все или отдельные реквизиты.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '₿ BTC', callback_data: 'edit_requisites_btc' }, { text: 'Ł LTC', callback_data: 'edit_requisites_ltc' }],
                            [{ text: 'ɱ XMR', callback_data: 'edit_requisites_xmr' }, { text: '🏦 СБП', callback_data: 'edit_requisites_sbp' }],
                            [{ text: '💳 Карта', callback_data: 'edit_requisites_card' }],
                            [{ text: '🗑 Удалить реквизиты', callback_data: 'delete_requisites_menu' }],
                            [{ text: MESSAGES.CB_BACK, callback_data: 'back_to_other_menu' }]
                        ]
                    }
                });
                states.pendingWithdrawal[from] = { ...states.pendingWithdrawal[from], requisitesMenuMsgId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data.startsWith('edit_requisites_')) {
                const type = data.replace('edit_requisites_', '');
                const typeNames = { btc: 'BTC', ltc: 'LTC', xmr: 'XMR', sbp: 'СБП', card: 'карту' };

                const states = loadJson('states') || {};
                const users = loadJson('users') || [];
                const userIndex = users.findIndex(u => u.id === from);
                if (userIndex === -1) {
                    await ctx.answerCbQuery(MESSAGES.CB_USER_NOT_FOUND, { show_alert: true });
                    return;
                }
                const user = users[userIndex];
                user.state = { action: 'edit_requisites', step: 'enter_value', type: type };
                saveJson('users', users);

                let currentValue = '';
                if (type === 'btc') {
                    if (user?.defaultWalletsBTC?.length) {
                        currentValue = user.defaultWalletsBTC.map((w, i) => `${i+1}) ${w}`).join('\n');
                    } else {
                        currentValue = user?.btcWallet || 'не указан';
                    }
                } else if (type === 'ltc') {
                    if (user?.defaultWalletsLTC?.length) {
                        currentValue = user.defaultWalletsLTC.map((w, i) => `${i+1}) ${w}`).join('\n');
                    } else {
                        currentValue = user?.ltcWallet || 'не указан';
                    }
                } else if (type === 'xmr') currentValue = user?.xmrWallet || 'не указан';
                else if (type === 'sbp') currentValue = user?.sbp || 'не указан';
                else if (type === 'card') currentValue = user?.cardNumber || 'не указан';

                const displayValue = currentValue || 'не указан';

                if (states.pendingWithdrawal[from]?.requisitesMenuMsgId) {
                    try { await ctx.deleteMessage(states.pendingWithdrawal[from].requisitesMenuMsgId); } catch(e) {}
                }
                if (states.pendingWithdrawal[from]?.deleteMenuMsgId) {
                    try { await ctx.deleteMessage(states.pendingWithdrawal[from].deleteMenuMsgId); } catch(e) {}
                }

                const message = await ctx.reply(`Текущий ${typeNames[type]} кошелёк:\n${displayValue}\n\nВведите новый ${typeNames[type]} кошелёк:`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Отмена', callback_data: 'update_requisites' }]
                        ]
                    }
                });
                states.pendingWithdrawal[from] = { ...states.pendingWithdrawal[from], editRequisitesMsgId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'delete_requisites_menu') {
                const states = loadJson('states') || {};
                if (states.pendingWithdrawal[from]?.requisitesMenuMsgId) {
                    try { await ctx.deleteMessage(states.pendingWithdrawal[from].requisitesMenuMsgId); } catch(e) {}
                }
                if (states.pendingWithdrawal[from]?.editRequisitesMsgId) {
                    try { await ctx.deleteMessage(states.pendingWithdrawal[from].editRequisitesMsgId); } catch(e) {}
                }

                const message = await ctx.reply(`🗑 Удаление реквизитов

Выберите какие реквизиты удалить:
• BTC — Bitcoin кошельки
• LTC — Litecoin кошельки
• XMR — Monero кошелёк
• СБП — реквизиты СБП
• Карта — банковская карта
• Удалить всё — удалить все реквизиты`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '₿ Удалить BTC', callback_data: 'delete_requisites_btc' }, { text: 'Ł Удалить LTC', callback_data: 'delete_requisites_ltc' }],
                            [{ text: 'ɱ Удалить XMR', callback_data: 'delete_requisites_xmr' }, { text: '🏦 Удалить СБП', callback_data: 'delete_requisites_sbp' }],
                            [{ text: '💳 Удалить карту', callback_data: 'delete_requisites_card' }],
                            [{ text: '🧹 Удалить всё', callback_data: 'delete_requisites_all' }],
                            [{ text: MESSAGES.CB_BACK, callback_data: 'update_requisites' }]
                        ]
                    }
                });
                states.pendingWithdrawal[from] = { ...states.pendingWithdrawal[from], deleteMenuMsgId: message.message_id };
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data.startsWith('delete_requisites_')) {
                const deleteType = data.replace('delete_requisites_', '');
                const users = loadJson('users') || [];
                const userIndex = users.findIndex(u => u.id === from);
                if (userIndex === -1) {
                    await ctx.answerCbQuery(MESSAGES.CB_USER_NOT_FOUND, { show_alert: true });
                    return;
                }
                const user = users[userIndex];

                const states = loadJson('states') || {};
                if (states.pendingWithdrawal[from]?.deleteMenuMsgId) {
                    try { await ctx.deleteMessage(states.pendingWithdrawal[from].deleteMenuMsgId); } catch(e) {}
                }

                if (deleteType === 'all') {
                    user.btcWallet = '';
                    user.ltcWallet = '';
                    user.xmrWallet = '';
                    user.sbp = '';
                    user.cardNumber = '';
                    user.defaultWalletsBTC = [];
                    user.defaultWalletsLTC = [];
                    saveJson('users', users);
                    await ctx.reply('✅ Все реквизиты удалены');
                } else if (deleteType === 'btc') {
                    const wallets = user.defaultWalletsBTC || [];
                    if (wallets.length === 0) {
                        user.btcWallet = '';
                        saveJson('users', users);
                        await ctx.reply(MESSAGES.REQUISITES_DELETE_BTC);
                    } else if (wallets.length === 1) {
                        user.defaultWalletsBTC = [];
                        user.btcWallet = '';
                        saveJson('users', users);
                        await ctx.reply(MESSAGES.REQUISITES_DELETE_BTC);
                    } else {
                        const keyboard = wallets.map((w, i) => [{ text: `${i+1}) ${w.substring(0, 20)}...`, callback_data: `delete_btc_index_${i}` }]);
                        keyboard.push([{ text: MESSAGES.CB_BACK, callback_data: 'delete_requisites_menu' }]);
                        await ctx.reply(`Выберите какой BTC кошелёк удалить:\n\n${wallets.map((w, i) => `${i+1}) ${w}`).join('\n')}`, {
                            reply_markup: { inline_keyboard: keyboard }
                        });
                    }
                } else if (deleteType === 'ltc') {
                    const wallets = user.defaultWalletsLTC || [];
                    if (wallets.length === 0) {
                        user.ltcWallet = '';
                        saveJson('users', users);
                        await ctx.reply(MESSAGES.REQUISITES_DELETE_LTC);
                    } else if (wallets.length === 1) {
                        user.defaultWalletsLTC = [];
                        user.ltcWallet = '';
                        saveJson('users', users);
                        await ctx.reply(MESSAGES.REQUISITES_DELETE_LTC);
                    } else {
                        const keyboard = wallets.map((w, i) => [{ text: `${i+1}) ${w.substring(0, 20)}...`, callback_data: `delete_ltc_index_${i}` }]);
                        keyboard.push([{ text: MESSAGES.CB_BACK, callback_data: 'delete_requisites_menu' }]);
                        await ctx.reply(`Выберите какой LTC кошелёк удалить:\n\n${wallets.map((w, i) => `${i+1}) ${w}`).join('\n')}`, {
                            reply_markup: { inline_keyboard: keyboard }
                        });
                    }
                } else if (deleteType === 'xmr') {
                    user.xmrWallet = '';
                    saveJson('users', users);
                    await ctx.reply('✅ XMR кошелёк удалён');
                } else if (deleteType === 'sbp') {
                    user.sbp = '';
                    saveJson('users', users);
                    await ctx.reply('✅ СБП реквизиты удалены');
                } else if (deleteType === 'card') {
                    user.cardNumber = '';
                    saveJson('users', users);
                    await ctx.reply('✅ Карта удалена');
                }
                await ctx.answerCbQuery();
                return;
            }

            if (data.startsWith('delete_btc_index_')) {
                const index = parseInt(data.replace('delete_btc_index_', ''));
                const users = loadJson('users') || [];
                const userIndex = users.findIndex(u => u.id === from);
                if (userIndex === -1) return;
                const user = users[userIndex];
                const wallets = user.defaultWalletsBTC || [];
                if (index >= 0 && index < wallets.length) {
                    wallets.splice(index, 1);
                    user.defaultWalletsBTC = wallets;
                    saveJson('users', users);
                    await ctx.reply('✅ BTC кошелёк удалён');
                }
                await ctx.answerCbQuery();
                return;
            }

            if (data.startsWith('delete_ltc_index_')) {
                const index = parseInt(data.replace('delete_ltc_index_', ''));
                const users = loadJson('users') || [];
                const userIndex = users.findIndex(u => u.id === from);
                if (userIndex === -1) return;
                const user = users[userIndex];
                const wallets = user.defaultWalletsLTC || [];
                if (index >= 0 && index < wallets.length) {
                    wallets.splice(index, 1);
                    user.defaultWalletsLTC = wallets;
                    saveJson('users', users);
                    await ctx.reply('✅ LTC кошелёк удалён');
                }
                await ctx.answerCbQuery();
                return;
            }

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
                    await ctx.answerCbQuery('❌ Розыгрыш не найден', { show_alert: true });
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
                    await ctx.answerCbQuery('❌ Ошибка при отправке файла', { show_alert: true });
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
                    await ctx.answerCbQuery('❌ Кошелёк не найден', { show_alert: true });
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
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
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
                        inline_keyboard: [
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });

                states.pendingDeal[from].messageId = message.message_id;
                states.pendingDeal[from].newWallet = true;
                states.pendingDeal[from].action = 'enter_wallet';
                states.pendingDeal[from].previousStep = 'enter_amount';
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
                            [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }],
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
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
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
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
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
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

                inlineKeyboard.push([{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]);

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
                        inline_keyboard: [[{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]]
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
                    await ctx.answerCbQuery('❌ Кошелёк не найден', { show_alert: true });
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

                if (!withdrawData || withdrawData.action !== 'enter_withdrawal_wallet' || !withdrawData.amount || !withdrawData.rubAmount) {
                    console.error(`Invalid or missing withdrawal data for user ${from}`);
                    await ctx.answerCbQuery('❌ Ошибка: данные для вывода не найдены', { show_alert: true });
                    return;
                }

                try {
                    await ctx.deleteMessage(withdrawData.messageId);
                } catch (error) {
                    console.error(`Error deleting message ${withdrawData.messageId}:`, error.message);
                }

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: MESSAGES.WALLET_INPUT_PROMPT,
                    reply_markup: {
                        inline_keyboard: [[{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]]
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
                withdrawal.walletAddress = wallet;

                withdrawals.push(withdrawal);
                saveJson('withdrawals', withdrawals);

                user.balance = Number((user.balance - withdrawal.cryptoAmount).toFixed(8));

                try {
                    await ctx.deleteMessage(withdrawData.messageId);
                } catch (error) {
                    console.error(`Error deleting message ${withdrawData.messageId}:`, error.message);
                }

                const { getOperatorContactUrl } = require('../../services');
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

module.exports = { registerRequisitesCallbacks };
