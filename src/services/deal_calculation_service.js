const { getCommissionDiscount } = require('./commission_service');
const { loadJson } = require('../utils/storage_utils');

function roundToNearest50(amount) {
    return Math.ceil(amount / 50) * 50;
}

function calculatePriorityPrice(priority, config) {
    return priority === 'elevated' ? (config.priorityPriceRub || 0) : 0;
}

function checkIsTenthDeal(userId, deals, currentDate = new Date()) {
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    const monthlyCompletedDeals = deals.filter(deal =>
        deal.userId === userId &&
        deal.status === 'completed' &&
        new Date(deal.timestamp).getMonth() === currentMonth &&
        new Date(deal.timestamp).getFullYear() === currentYear
    ).length;
    
    return monthlyCompletedDeals % 10 === 9;
}

async function calculateDealTotals(dealData, priority, userId, deals = null) {
    const config = loadJson('config') || {};
    const allDeals = deals || loadJson('deals') || [];
    const discount = await getCommissionDiscount(userId);
    
    const rubBefore = dealData.rubBefore || 0;
    const rub = dealData.rub || 0;
    const baseCommission = dealData.commission || 0;
    const priorityPrice = calculatePriorityPrice(priority, config);
    
    const isTenthDeal = checkIsTenthDeal(userId, allDeals);
    
    let total;
    let adjustedCommission;
    
    if (isTenthDeal) {
        adjustedCommission = 0;
        if (dealData.type === 'sell') {
            const rawTotal = rubBefore - priorityPrice;
            total = roundToNearest50(rawTotal);
        } else {
            const rawTotal = rub + priorityPrice;
            total = roundToNearest50(rawTotal);
        }
    } else {
        if (dealData.type === 'sell') {
            const rawTotal = rubBefore - baseCommission - priorityPrice;
            total = Math.max(0, roundToNearest50(rawTotal));
            adjustedCommission = Math.max(0, Number((rubBefore - total - priorityPrice).toFixed(2)));
        } else {
            const rawTotal = rub + baseCommission + priorityPrice;
            total = roundToNearest50(rawTotal);
            adjustedCommission = Math.max(0, Number((total - rub - priorityPrice).toFixed(2)));
        }
    }
    
    return {
        total: Number(total.toFixed(2)),
        adjustedCommission: Number(adjustedCommission.toFixed(2)),
        priorityPrice,
        discount,
        isTenthDeal
    };
}

function convertRubToCrypto(amountRub, currency, priceBTC, priceLTC) {
    const price = currency === 'BTC' ? priceBTC : priceLTC;
    return (amountRub / price).toFixed(8);
}

function convertCryptoToRub(amountCrypto, currency, priceBTC, priceLTC) {
    const price = currency === 'BTC' ? priceBTC : priceLTC;
    return Number((amountCrypto * price).toFixed(2));
}

function calculateMinMaxAmounts(currency, config, priceBTC, priceLTC, isProcessingEnabled = false) {
    const minRub = currency === 'BTC' 
        ? (isProcessingEnabled ? 1000 : config.minBuyAmountRubBTC || 0)
        : (isProcessingEnabled ? 1000 : config.minBuyAmountRubLTC || 0);
    const maxRub = currency === 'BTC' 
        ? (config.maxBuyAmountRubBTC || 0)
        : (config.maxBuyAmountRubLTC || 0);
    
    const price = currency === 'BTC' ? priceBTC : priceLTC;
    const minCrypto = convertRubToCrypto(minRub, currency, priceBTC, priceLTC);
    const maxCrypto = convertRubToCrypto(maxRub, currency, priceBTC, priceLTC);
    
    return {
        minRub,
        maxRub,
        minCrypto,
        maxCrypto
    };
}

function calculateSellMinMaxAmounts(currency, config, priceBTC, priceLTC) {
    const minRub = currency === 'BTC' 
        ? (config.minSellAmountRubBTC || 0)
        : (config.minSellAmountRubLTC || 0);
    const maxRub = currency === 'BTC' 
        ? (config.maxSellAmountRubBTC || 0)
        : (config.maxSellAmountRubLTC || 0);
    
    const price = currency === 'BTC' ? priceBTC : priceLTC;
    const minCrypto = convertRubToCrypto(minRub, currency, priceBTC, priceLTC);
    const maxCrypto = convertRubToCrypto(maxRub, currency, priceBTC, priceLTC);
    
    return {
        minRub,
        maxRub,
        minCrypto,
        maxCrypto
    };
}

module.exports = {
    calculateDealTotals,
    calculateMinMaxAmounts,
    calculateSellMinMaxAmounts
};



