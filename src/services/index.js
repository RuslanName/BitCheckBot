const { getBtcRubPrice, getLtcRubPrice, getXmrRubPrice, getLastPriceUpdate } = require('./price-service');
const { getCommissionDiscount, calculateCommission } = require('./commission-service');
const { calculateUserStats, getOperatorContactUrl, getOperators, isValidChat, checkIfBlocked } = require('./user-service');
const { getAvailablePaymentDetails } = require('./payment-service');
const { checkUnpaidDeals, checkInvoiceStatus } = require('./deal-service');
const { generateRaffleResults } = require('./raffle-service');
const { calculateCashback, addCashback } = require('./cashback-service');
const dealCalculationService = require('./deal-calculation-service');
const dealCreationService = require('./deal-creation-service');
const messageService = require('./message-service');

module.exports = {
    getBtcRubPrice,
    getLtcRubPrice,
    getXmrRubPrice,
    getLastPriceUpdate,
    getCommissionDiscount,
    calculateCommission,
    calculateUserStats,
    getOperatorContactUrl,
    getOperators,
    isValidChat,
    checkIfBlocked,
    getAvailablePaymentDetails,
    checkUnpaidDeals,
    checkInvoiceStatus,
    generateRaffleResults,
    calculateCashback,
    addCashback,
    ...dealCalculationService,
    ...dealCreationService,
    ...messageService
};

