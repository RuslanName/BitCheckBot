const { loadJson } = require('../utils/storage_utils');

function getAvailablePaymentDetails(currency, dealRubAmount) {
    const config = loadJson('config') || {};
    const deals = loadJson('deals') || [];
    let paymentDetails;

    if (currency === 'BTC') {
        paymentDetails = config.buyPaymentDetailsBTC || [];
    } else if (currency === 'LTC') {
        paymentDetails = config.buyPaymentDetailsLTC || [];
    }

    const paymentTimeout = (config.dealCreationRecoveryMinutes || 60) * 60 * 1000;
    const limitReachedTimeout = (config.limitReachedRecoveryHours || 24) * 60 * 60 * 1000;
    const now = new Date();

    if (paymentDetails.length === 0) {
        return null;
    }

    const calculateRubAmount = (paymentDetailId) => {
        return deals
            .filter(d =>
                d.selectedPaymentDetailsId === paymentDetailId &&
                ['unpaid', 'pending', 'completed'].includes(d.status) &&
                new Date(d.timestamp) >= new Date(paymentDetails.find(pd => pd.id === paymentDetailId)?.lastResetTimestamp || 0)
            )
            .reduce((sum, d) => sum + (d.rubAmount || 0), 0);
    };

    const availableCards = paymentDetails.filter(d => {
        const currentRubAmount = calculateRubAmount(d.id);
        const totalRubAmount = currentRubAmount + dealRubAmount;
        const recoveryEndTime = new Date(d.lastResetTimestamp || 0).getTime() + limitReachedTimeout;
        const paymentDeadline = new Date(d.timestamp).getTime() + paymentTimeout;
        return (totalRubAmount <= d.limitReachedRub) && (recoveryEndTime < now.getTime()) &&
            (paymentDeadline < now.getTime());
    });

    if (availableCards.length === 0) {
        return null;
    }

    const maxUsages = Math.max(...availableCards.map(d => d.confirmedUsages));
    const lagging = availableCards.filter(d => d.confirmedUsages < maxUsages - 1);

    const selectOldest = (arr) => {
        if (arr.length === 0) return null;
        return arr.reduce((oldest, current) => {
            if (!oldest) return current;
            if (current.confirmedUsages < oldest.confirmedUsages) return current;
            if (current.confirmedUsages > oldest.confirmedUsages) return oldest;
            const oldestTime = new Date(oldest.timestamp);
            const currentTime = new Date(current.timestamp);
            return currentTime < oldestTime ? current : oldest;
        }, null);
    };

    if (lagging.length === 0) {
        return selectOldest(availableCards);
    } else {
        const p = 0.5;
        if (Math.random() < p) {
            return selectOldest(lagging);
        } else {
            const nonLagging = availableCards.filter(d => d.confirmedUsages >= maxUsages - 1);
            return selectOldest(nonLagging);
        }
    }
}

module.exports = {
    getAvailablePaymentDetails
};

