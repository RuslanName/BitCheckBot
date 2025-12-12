const { isProcessingEnabled } = require('../integrations');

function createDealObject(dealData, user, calculationResult) {
    const { total, adjustedCommission, isTenthDeal } = calculationResult;
    const rubBefore = dealData.rubBefore || 0;
    const rub = dealData.rub || 0;
    const amount = dealData.amount || 0;
    
    return {
        id: Date.now().toString(),
        userId: user.id,
        username: user?.username ? `${user.username}` : 'Нет',
        type: dealData.type,
        currency: dealData.currency,
        rubAmount: dealData.type === 'sell' ? Number(rubBefore.toFixed(2)) : Number(rub.toFixed(2)),
        cryptoAmount: Number(amount.toFixed(8)),
        commission: Number(adjustedCommission.toFixed(2)),
        total: Number(total.toFixed(2)),
        walletAddress: dealData.wallet,
        status: 'draft',
        priority: dealData.priority || 'normal',
        processingStatus: isProcessingEnabled(),
        timestamp: new Date().toISOString(),
        isTenthDeal: isTenthDeal
    };
}

function createDealFromExisting(dealData, dealId, userId) {
    return {
        id: dealId,
        userId: userId,
        type: dealData.type,
        currency: dealData.currency,
        rubAmount: dealData.rub || 0,
        cryptoAmount: dealData.amount || 0,
        commission: dealData.commission || 0,
        total: dealData.total || 0,
        walletAddress: dealData.wallet,
        priority: dealData.priority || 'normal',
        processingStatus: dealData.processingStatus !== undefined ? dealData.processingStatus : isProcessingEnabled()
    };
}

module.exports = {
    createDealObject,
    createDealFromExisting
};

