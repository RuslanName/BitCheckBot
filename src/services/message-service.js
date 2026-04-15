const { MESSAGES } = require('../config');
const { CACHE_DURATION, PAYMENT_OPTION_NAMES } = require('../config');
const { getLastPriceUpdate } = require('./price-service');

function buildProfileMessage(user, stats, priceBTC, referralLink) {
    const earningsRub = user.balance * priceBTC;
    const cashbackRub = user.cashback ?? 0;
    const totalRub = earningsRub + cashbackRub;
    const username = user.username ? `@${user.username}` : 'Нет';
    
    return `👤 Твой профиль в BitCheck\n` +
        `👁️ Имя: ${username}\n` +
        `🆔 ID: ${user.id}\n\n` +
        `📦 Статистика:\n` +
        `🔄 Сделок совершено: ${stats.dealsCount}\n` +
        `👥 Приведено рефералов: ${(user.referrals || []).length}\n\n` +
        `💸 Реферальный заработок: ${earningsRub.toFixed(2)} RUB\n` +
        `🎯 Кешбэк заработок: ${cashbackRub.toFixed(2)} RUB\n\n` +
        `📤 Куплено:\n` +
        `<tg-emoji emoji-id="5229079445444238000"></tg-emoji> BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\n` +
        `<tg-emoji emoji-id="5235599283108979084"></tg-emoji> LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n` +
        `<tg-emoji emoji-id="5238197699668353049"></tg-emoji> XMR: ${stats.boughtXMR.rub.toFixed(2)} RUB (${stats.boughtXMR.crypto.toFixed(8)} XMR)\n\n` +
        `📥 Продано:\n` +
        `<tg-emoji emoji-id="5229079445444238000"></tg-emoji> BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\n` +
        `<tg-emoji emoji-id="5235599283108979084"></tg-emoji> LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n` +
        `<tg-emoji emoji-id="5238197699668353049"></tg-emoji> XMR: ${stats.soldXMR.rub.toFixed(2)} RUB (${stats.soldXMR.crypto.toFixed(8)} XMR)`;
}

function buildProfileReplyMarkup() {
    const buttons = [
        [{ text: '💰 Вывести кешбек', callback_data: 'cashback_withdraw' }],
        [{ text: '💸 Вывести реферальные', callback_data: 'withdraw_referral' }]
    ];
    
    return { inline_keyboard: buttons };
}

function buildReferralMessage(referralLink, referralsCount, earningsRub, balance) {
    const cacheWarning = Date.now() - getLastPriceUpdate() > CACHE_DURATION ? MESSAGES.CACHE_WARNING : '';
    
    return `🤝 Реферальная программа\n` +
        `🔗 ${referralLink}\n` +
        `👥 Приглашено: ${referralsCount}\n` +
        `💰 Заработано: ${earningsRub.toFixed(2)} RUB (~${balance.toFixed(8)} BTC)\n` +
        `${cacheWarning}`;
}

function buildReferralReplyMarkup(referralLink) {
    return {
        inline_keyboard: [
            [{ text: '📤 Поделиться', switch_inline_query: `\n\n💎 Присоединяйся к BitCheck по ссылке ниже! ⬇️\n${referralLink}` }],
            [{ text: '💰 Вывести баланс', callback_data: 'withdraw_balance' }]
        ]
    };
}

function buildBuyMenuMessage(config, priceBTC, priceLTC, priceXMR, btcAmounts, ltcAmounts, xmrAmounts) {
    const cacheWarning = Date.now() - getLastPriceUpdate() > CACHE_DURATION ? MESSAGES.CACHE_WARNING : '';
    
    return `💰 Выберите валюту:
<tg-emoji emoji-id="5229079445444238000"></tg-emoji> BTC
Мин: ${config.minBuyAmountRubBTC} RUB (~${btcAmounts.minCrypto} BTC)
Макс: ${config.maxBuyAmountRubBTC} RUB (~${btcAmounts.maxCrypto} BTC)
<tg-emoji emoji-id="5235599283108979084"></tg-emoji> LTC
Мин: ${config.minBuyAmountRubLTC} RUB (~${ltcAmounts.minCrypto} LTC)
Макс: ${config.maxBuyAmountRubLTC} RUB (~${ltcAmounts.maxCrypto} LTC)
<tg-emoji emoji-id="5238197699668353049"></tg-emoji> XMR
Мин: ${config.minBuyAmountRubXMR} RUB (~${xmrAmounts.minCrypto} XMR)
Макс: ${config.maxBuyAmountRubXMR} RUB (~${xmrAmounts.maxCrypto} XMR)
${cacheWarning}`;
}

function buildSellMenuReplyMarkup() {
    return {
        inline_keyboard: [
            [{ text: 'BTC', callback_data: 'sell_select_btc' }],
            [{ text: 'LTC', callback_data: 'sell_select_ltc' }],
            [{ text: 'XMR', callback_data: 'sell_select_xmr' }],
            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
        ]
    };
}

function buildBuyMenuReplyMarkup() {
    return {
        inline_keyboard: [
            [{ text: 'BTC', callback_data: 'buy_select_btc' }],
            [{ text: 'LTC', callback_data: 'buy_select_ltc' }],
            [{ text: 'XMR', callback_data: 'buy_select_xmr' }],
            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
        ]
    };
}

function buildSellMenuReplyMarkup() {
    return {
        inline_keyboard: [
            [{ text: 'BTC', callback_data: 'sell_select_btc' }],
            [{ text: 'LTC', callback_data: 'sell_select_ltc' }],
            [{ text: 'XMR', callback_data: 'sell_select_xmr' }],
            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
        ]
    };
}

function buildSellMenuMessage(config, btcAmounts, ltcAmounts, xmrAmounts) {
    const cacheWarning = Date.now() - getLastPriceUpdate() > CACHE_DURATION ? MESSAGES.CACHE_WARNING : '';
    
    return `💸 Выберите валюту:
<tg-emoji emoji-id="5229079445444238000"></tg-emoji> BTC
Мин: ${config.minSellAmountRubBTC} RUB (~${btcAmounts.minCrypto} BTC)
Макс: ${config.maxSellAmountRubBTC} RUB (~${btcAmounts.maxCrypto} BTC)
<tg-emoji emoji-id="5235599283108979084"></tg-emoji> LTC
Мин: ${config.minSellAmountRubLTC} RUB (~${ltcAmounts.minCrypto} LTC)
Макс: ${config.maxSellAmountRubLTC} RUB (~${ltcAmounts.maxCrypto} LTC)
<tg-emoji emoji-id="5238197699668353049"></tg-emoji> XMR
Мин: ${config.minSellAmountRubXMR} RUB (~${xmrAmounts.minCrypto} XMR)
Макс: ${config.maxSellAmountRubXMR} RUB (~${xmrAmounts.maxCrypto} XMR)
${cacheWarning}`;
}

function buildSellAmountInputMessage(currency, minRub, maxRub, minCrypto, maxCrypto) {
    return `💸 Введите сумму для продажи ${currency} (в RUB или ${currency})\nМин: ${minRub} RUB (~${minCrypto} ${currency})\nМакс: ${maxRub} RUB (~${maxCrypto} ${currency})`;
}

function buildDealCreatedMessage(deal, discount, priorityPrice, paymentSystemText, paymentDetailsText, selectedPaymentDetails, isOperator = false) {
    const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
    const paymentInstructions = deal.type === 'buy'
        ? (selectedPaymentDetails ? '‼️ Пожалуйста, произведите оплату по указанным реквизитам и подтвердите, нажав "Оплата выполнена"' : '‼️ Свяжитесь с оператором для получения реквизитов')
        : '‼️ Отправьте указанное количество на кошелёк BitCheck и свяжитесь с оператором для завершения сделки';

    const commissionText = isOperator
        ? `Комиссия: ${deal.commission} RUB\n`
        : '';

    const cashbackAmount = Math.round((deal.commission * (deal.cashbackPercent || 3)) / 100);

    return `✅ Заявка на сделку создана! № ${deal.id}\n` +
        `${actionText} ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `Комиссия: ${deal.commission} RUB (Кешбек ${cashbackAmount} руб)\n` +
        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
        `Итог: ${deal.total} RUB\n` +
        `Кошелёк: <code>${deal.walletAddress}</code>\n\n` +
        `📞 Для получения реквизитов свяжитесь с оператором\n\n` +
        `✅ После оплаты нажмите "Оплата выполнена"`;
}

function buildDealReplyMarkup(deal, operatorContactUrl, selectedPaymentDetails) {
    if (deal.type === 'buy') {
        return {
            inline_keyboard: [
                [{ text: '📞 Связаться с оператором', url: operatorContactUrl }],
                [{ text: MESSAGES.PAYMENT_DONE(deal.id), callback_data: `payment_done_${deal.id}` }],
                [{ text: MESSAGES.CANCEL_DEAL(deal.id), callback_data: `cancel_deal_${deal.id}` }]
            ]
        };
    } else {
        return {
            inline_keyboard: [
                [{ text: MESSAGES.CONTACT_OPERATOR_ALT, url: operatorContactUrl }],
                [{ text: MESSAGES.PAYMENT_DONE(deal.id), callback_data: `payment_done_${deal.id}` }],
                [{ text: MESSAGES.CANCEL_DEAL(deal.id), callback_data: `cancel_deal_${deal.id}` }]
            ]
        };
    }
}

function buildPaymentSystemText(paymentVariant, paymentOption, paymentMethodName) {
    if (!paymentVariant) return '';
    
    return `Платёжная система: Карта - ${paymentMethodName}\n`;
}

function buildOperatorDealMessage(deal, user, paymentSystemText, paymentDetailsText) {
    const actionText = deal.type === 'buy' ? 'покупки' : 'продажи';
    const paymentTarget = deal.type === 'buy' ? 'Кошелёк' : 'Реквизиты';
    
    return `🆕 Новая заявка на сделку № ${deal.id}\n` +
        `@${user.username || 'Нет'} (ID ${user.id})\n` +
        `${actionText} ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `Комиссия: ${deal.commission} RUB\n` +
        `Приоритет: ${deal.priority === 'elevated' ? 'Повышенный' : 'Обычный'}\n` +
        `${paymentSystemText}` +
        `Итог: ${deal.total} RUB\n` +
        `${paymentTarget}: ${deal.walletAddress}`;
}

function buildOperatorDealReplyMarkup(deal, user) {
    return {
        inline_keyboard: [
            [{ text: '✅ Завершить', callback_data: `operator_complete_deal_${deal.id}` }],
            [{ text: MESSAGES.OPERATOR_WRITE_USER, url: user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}` }]
        ]
    };
}

function buildSupportMessage(userDisplay, id, text) {
    return `🆘 От ${userDisplay} (ID ${id})\n${text}`;
}

function buildSupportReplyMarkup(userId) {
    return {
        inline_keyboard: [
            [{ text: `📝 Ответить`, callback_data: `operator_reply_${userId}` }],
            [{ text: '🔒 Закрыть', callback_data: 'close_conv' }]
        ]
    };
}

function buildWithdrawalMessage(withdrawal) {
    return `✅ Заявка на вывод рефералов создана! № ${withdrawal.id}\n` +
        `Количество: ${withdrawal.cryptoAmount.toFixed(8)} BTC (~${withdrawal.rubAmount.toFixed(2)} RUB)\n` +
        `Кошелёк: <code>${withdrawal.walletAddress}</code>`;
}

function buildOperatorWithdrawalMessage(withdrawal, user) {
    return `🆕 Новая заявка на вывод рефералов № ${withdrawal.id}\n` +
        `@${user.username || 'Нет'} (ID ${user.id})\n` +
        `Количество: ${withdrawal.cryptoAmount.toFixed(8)} BTC\n` +
        `Сумма: ${withdrawal.rubAmount.toFixed(2)} RUB\n` +
        `Кошелёк: <code>${withdrawal.walletAddress}</code>`;
}

function buildOperatorWithdrawalReplyMarkup(withdrawal, user) {
    return {
        inline_keyboard: [
            [{ text: `✅ Завершить`, callback_data: `operator_complete_withdrawal_${withdrawal.id}` }],
            [{ text: MESSAGES.OPERATOR_WRITE_USER, url: user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}` }]
        ]
    };
}

function buildSupportReplyUserMessage(text) {
    return `📩 Ответ от поддержки:\n${text}`;
}

function buildSupportReplyUserReplyMarkup(userId) {
    return {
        inline_keyboard: [
            [{ text: MESSAGES.CONTACT_OPERATOR_ALT, url: `tg://user?id=${userId}` }]
        ]
    };
}

function buildDealConfirmationMessage(deal, discount, priorityPrice, paymentSystemText, paymentTarget, isTenthDeal = false, isOperator = false) {
    const actionText = deal.type === 'buy' ? 'покупки' : 'продажи';
    const paymentSystemLine = paymentSystemText || '';
    
    const commissionText = isOperator
        ? (isTenthDeal
            ? `Комиссия: ${deal.commission} RUB (бесплатная сделка, 10-я по счёту!)`
            : `Комиссия: ${deal.commission} RUB`)
        : '';
    
    return `✅ Подтверждение ${actionText} ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `${commissionText}\n` +
        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
        `${paymentSystemLine}` +
        `Итог: ${deal.total} RUB\n` +
        `${paymentTarget}: <code>${deal.walletAddress}</code>`;
}

function buildDealConfirmationReplyMarkup(dealId, paymentVariant = null, showPaymentSelection = false, showBack = false) {
    const keyboard = [
        [{ text: '✅ Создать заявку', callback_data: `submit_${dealId}${paymentVariant ? `_${paymentVariant}` : ''}` }],
        [{ text: MESSAGES.CANCEL_DEAL(dealId), callback_data: `cancel_deal_${dealId}` }]
    ];

    if (showBack) {
        const { MESSAGES } = require('../config');
        keyboard.splice(1, 0, [{ text: MESSAGES.CB_BACK, callback_data: 'deal_back' }]);
    }

    return {
        inline_keyboard: keyboard
    };
}

function buildDealCompletedMessage(deal, discount, priorityPrice, isOperator = false) {
    const commissionText = isOperator
        ? `Комиссия: ${deal.commission} RUB\n`
        : '';
    
    return `✅ Сделка №${deal.id} завершена!\n` +
        `Покупка ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `${commissionText}` +
        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
        `Итог: ${deal.total} RUB\n` +
        `Кошелёк: ${deal.walletAddress}`;
}

function buildDealExpiredMessage(dealId, deal) {
    return `❌ Время подтверждения по заявке № ${dealId} истекло!\n` +
        `Покупка ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n\n` +
        `‼️ Если произошла ошибка, пожалуйста, свяжитесь с оператором!`;
}

function buildDealCompletedReplyMarkup(reviewChatUrl) {
    return {
        inline_keyboard: [
            [{ text: '⭐️ Оставить отзыв', url: reviewChatUrl }]
        ]
    };
}

module.exports = {
    buildProfileMessage,
    buildProfileReplyMarkup,
    buildReferralMessage,
    buildReferralReplyMarkup,
    buildBuyMenuMessage,
    buildBuyMenuReplyMarkup,
    buildSellMenuMessage,
    buildSellMenuReplyMarkup,
    buildSellAmountInputMessage,
    buildDealCreatedMessage,
    buildDealReplyMarkup,
    buildPaymentSystemText,
    buildOperatorDealMessage,
    buildOperatorDealReplyMarkup,
    buildSupportMessage,
    buildSupportReplyMarkup,
    buildWithdrawalMessage,
    buildOperatorWithdrawalMessage,
    buildOperatorWithdrawalReplyMarkup,
    buildSupportReplyUserMessage,
    buildSupportReplyUserReplyMarkup,
    buildDealConfirmationMessage,
    buildDealConfirmationReplyMarkup,
    buildDealCompletedMessage,
    buildDealExpiredMessage,
    buildDealCompletedReplyMarkup
};

