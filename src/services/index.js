const { getBtcRubPrice, getLtcRubPrice, getLastPriceUpdate } = require('./price_service');
const { getCommissionDiscount, calculateCommission } = require('./commission_service');
const { calculateUserStats, getOperatorContactUrl, getOperators, isValidChat, checkIfBlocked } = require('./user_service');
const { getAvailablePaymentDetails } = require('./payment_service');
const { checkUnpaidDeals, checkInvoiceStatus } = require('./deal_service');
const { generateRaffleResults } = require('./raffle_service');
const dealCalculationService = require('./deal_calculation_service');
const dealCreationService = require('./deal_creation_service');
const messageService = require('./message_service');

module.exports = {
    getBtcRubPrice,
    getLtcRubPrice,
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
    ...dealCalculationService,
    ...dealCreationService,
    ...messageService
};

