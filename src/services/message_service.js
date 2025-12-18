const { POST_SCRIPT, MESSAGES } = require('../config/messages');
const { CACHE_DURATION } = require('../config/constants');
const { getLastPriceUpdate } = require('./price_service');
const { PAYMENT_OPTION_NAMES } = require('../config/constants');

function buildProfileMessage(user, stats, priceBTC, referralLink) {
    const earningsRub = user.balance * priceBTC;
    const username = user.username ? `@${user.username}` : 'Нет';
    
    return `👤 Твой профиль в BitCheck\n` +
        `📛 Имя: ${username}\n` +
        `🆔 ID: ${user.id}\n\n` +
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
        `💰 Приглашайте друзей и получайте бонусы!\n\n` +
        `${POST_SCRIPT}`;
}

function buildProfileReplyMarkup() {
    return {
        inline_keyboard: [
            [{ text: MESSAGES.UPDATE_DETAILS, callback_data: 'update_details' }]
        ]
    };
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
            [{ text: '💸 Вывести', callback_data: 'withdraw_referral' }]
        ]
    };
}

function buildBuyMenuMessage(config, priceBTC, priceLTC, btcAmounts, ltcAmounts, isProcessingEnabled) {
    const minBuyAmountRubBTC = isProcessingEnabled ? 1000 : config.minBuyAmountRubBTC;
    const minBuyAmountRubLTC = isProcessingEnabled ? 1000 : config.minBuyAmountRubLTC;
    const cacheWarning = Date.now() - getLastPriceUpdate() > CACHE_DURATION ? MESSAGES.CACHE_WARNING : '';
    
    return `💰 Выберите валюту:\n💵 BTC\nМин: ${minBuyAmountRubBTC} RUB (~${btcAmounts.minCrypto} BTC)\nМакс: ${config.maxBuyAmountRubBTC} RUB (~${btcAmounts.maxCrypto} BTC)\n💵 LTC\nМин: ${minBuyAmountRubLTC} RUB (~${ltcAmounts.minCrypto} LTC)\nМакс: ${config.maxBuyAmountRubLTC} RUB (~${ltcAmounts.maxCrypto} LTC)\n${cacheWarning}`;
}

function buildBuyMenuReplyMarkup() {
    return {
        inline_keyboard: [
            [{ text: 'BTC', callback_data: 'buy_select_btc' }],
            [{ text: 'LTC', callback_data: 'buy_select_ltc' }],
            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
        ]
    };
}

function buildSellMenuMessage(config, btcAmounts, ltcAmounts) {
    const cacheWarning = Date.now() - getLastPriceUpdate() > CACHE_DURATION ? MESSAGES.CACHE_WARNING : '';
    
    return `💸 Выберите валюту:\n💵 BTC\nМин: ${config.minSellAmountRubBTC} RUB (~${btcAmounts.minCrypto} BTC)\nМакс: ${config.maxSellAmountRubBTC} RUB (~${btcAmounts.maxCrypto} BTC)\n💵 LTC\nМин: ${config.minSellAmountRubLTC} RUB (~${ltcAmounts.minCrypto} LTC)\nМакс: ${config.maxSellAmountRubLTC} RUB (~${ltcAmounts.maxCrypto} LTC)\n${cacheWarning}`;
}

function buildSellMenuReplyMarkup() {
    return {
        inline_keyboard: [
            [{ text: 'BTC', callback_data: 'sell_select_btc' }],
            [{ text: 'LTC', callback_data: 'sell_select_ltc' }],
            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
        ]
    };
}

function buildSellAmountInputMessage(currency, minRub, maxRub, minCrypto, maxCrypto) {
    return `💸 Введите сумму для продажи ${currency} (в RUB или ${currency})\nМин: ${minRub} RUB (~${minCrypto} ${currency})\nМакс: ${maxRub} RUB (~${maxCrypto} ${currency})`;
}

function buildDealCreatedMessage(deal, discount, priorityPrice, paymentSystemText, paymentDetailsText, selectedPaymentDetails) {
    const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
    const paymentInstructions = deal.type === 'buy'
        ? MESSAGES.DEAL_PAYMENT_INSTRUCTIONS_BUY(!!selectedPaymentDetails)
        : MESSAGES.DEAL_PAYMENT_INSTRUCTIONS_SELL;
    
    return `${MESSAGES.DEAL_CREATED(deal.id)}\n` +
        `${actionText} ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
        `${paymentSystemText}` +
        `Итог: ${deal.total} RUB\n` +
        `${paymentDetailsText}\n\n` +
        `${paymentInstructions} ⬇️`;
}

function buildDealReplyMarkup(deal, operatorContactUrl, selectedPaymentDetails) {
    if (deal.type === 'buy') {
        return {
            inline_keyboard: [
                selectedPaymentDetails
                    ? [{ text: MESSAGES.PAYMENT_DONE(deal.id), callback_data: `payment_done_${deal.id}` }]
                    : [{ text: MESSAGES.CONTACT_OPERATOR, url: operatorContactUrl }],
                [{ text: MESSAGES.CANCEL_DEAL(deal.id), callback_data: `cancel_deal_${deal.id}` }]
            ]
        };
    } else {
        return {
            inline_keyboard: [
                [{ text: MESSAGES.CONTACT_OPERATOR_ALT, url: operatorContactUrl }],
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
            [{ text: MESSAGES.OPERATOR_WRITE_USER, url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${user.id}` }]
        ]
    };
}

function buildSupportMessage(userDisplay, id, text) {
    return MESSAGES.SUPPORT_OPERATOR_MESSAGE(userDisplay, id, text);
}

function buildSupportReplyMarkup(userId) {
    return {
        inline_keyboard: [
            [{ text: MESSAGES.OPERATOR_REPLY(userId), callback_data: `operator_reply_${userId}` }],
            [{ text: MESSAGES.OPERATOR_CLOSE, callback_data: 'close_conv' }]
        ]
    };
}

function buildWithdrawalMessage(withdrawal) {
    return `${MESSAGES.WITHDRAWAL_CREATED(withdrawal.id)}\n` +
        `Количество: ${withdrawal.cryptoAmount.toFixed(8)} BTC (~${withdrawal.rubAmount.toFixed(2)} RUB)\n` +
        `Кошелёк: <code>${withdrawal.walletAddress}</code>`;
}

function buildOperatorWithdrawalMessage(withdrawal, user) {
    return MESSAGES.WITHDRAWAL_OPERATOR_MESSAGE(
        withdrawal.id,
        user.username,
        user.id,
        withdrawal.cryptoAmount,
        withdrawal.rubAmount,
        withdrawal.walletAddress
    );
}

function buildOperatorWithdrawalReplyMarkup(withdrawal, user) {
    return {
        inline_keyboard: [
            [{ text: MESSAGES.OPERATOR_COMPLETE_WITHDRAWAL(withdrawal.id), callback_data: `operator_complete_withdrawal_${withdrawal.id}` }],
            [{ text: MESSAGES.OPERATOR_WRITE_USER, url: user.username ? `https://t.me/${user.username}` : `https://t.me/id${user.id}` }]
        ]
    };
}

function buildSupportReplyUserMessage(text) {
    return MESSAGES.SUPPORT_REPLY_MESSAGE(text);
}

function buildSupportReplyUserReplyMarkup(userId) {
    return {
        inline_keyboard: [
            [{ text: MESSAGES.CONTACT_OPERATOR_ALT, url: `https://t.me/id${userId}` }]
        ]
    };
}

function buildDealConfirmationMessage(deal, discount, priorityPrice, paymentSystemText, paymentTarget, isTenthDeal = false) {
    const actionText = deal.type === 'buy' ? 'покупки' : 'продажи';
    const paymentSystemLine = paymentSystemText || '';
    const commissionText = isTenthDeal 
        ? `Комиссия: ${deal.commission} RUB (бесплатная сделка, 10-я по счёту!)`
        : `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)`;
    
    return `✅ Подтверждение ${actionText} ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `${commissionText}\n` +
        `Приоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\n` +
        `${paymentSystemLine}` +
        `Итог: ${deal.total} RUB\n` +
        `${paymentTarget}: <code>${deal.walletAddress}</code>`;
}

function buildDealConfirmationReplyMarkup(dealId, paymentVariant = null, showPaymentSelection = false) {
    if (showPaymentSelection) {
        return {
            inline_keyboard: [
                [{ text: '✅ Создать заявку', callback_data: `submit_${dealId}${paymentVariant ? `_${paymentVariant}` : ''}` }],
                [{ text: MESSAGES.CANCEL_DEAL(dealId), callback_data: `cancel_deal_${dealId}` }]
            ]
        };
    }
    
    return {
        inline_keyboard: [
            [{ text: '✅ Создать заявку', callback_data: `submit_${dealId}${paymentVariant ? `_${paymentVariant}` : ''}` }],
            [{ text: MESSAGES.CANCEL_DEAL(dealId), callback_data: `cancel_deal_${dealId}` }]
        ]
    };
}

function buildDealCompletedMessage(deal, discount, priorityPrice) {
    return `✅ Сделка №${deal.id} завершена!\n` +
        `Покупка ${deal.currency}\n` +
        `Количество: ${deal.cryptoAmount} ${deal.currency}\n` +
        `Сумма: ${deal.rubAmount} RUB\n` +
        `Комиссия: ${deal.commission} RUB (скидка ${discount.toFixed(2)}%)\n` +
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

function buildDealCompletedReplyMarkup(operatorContactUrl) {
    return {
        inline_keyboard: [
            [{ text: MESSAGES.CONTACT_OPERATOR_ALT, url: operatorContactUrl }]
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

