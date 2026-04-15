async function getPrice(currency) {
    const { getBtcRubPrice, getLtcRubPrice, getXmrRubPrice } = require('../../services');
    switch (currency) {
        case 'BTC': return await getBtcRubPrice();
        case 'LTC': return await getLtcRubPrice();
        case 'XMR': return await getXmrRubPrice();
        default: throw new Error(`Unsupported currency: ${currency}`);
    }
}

function getMinAmountRub(currency, isBuy, config) {
    switch (currency) {
        case 'BTC': return isBuy ? config.minBuyAmountRubBTC : config.minSellAmountRubBTC;
        case 'LTC': return isBuy ? config.minBuyAmountRubLTC : config.minSellAmountRubLTC;
        case 'XMR': return isBuy ? config.minBuyAmountRubXMR : config.minSellAmountRubXMR;
        default: throw new Error(`Unsupported currency: ${currency}`);
    }
}

function getMaxAmountRub(currency, isBuy, config) {
    switch (currency) {
        case 'BTC': return isBuy ? config.maxBuyAmountRubBTC : config.maxSellAmountRubBTC;
        case 'LTC': return isBuy ? config.maxBuyAmountRubLTC : config.maxSellAmountRubLTC;
        case 'XMR': return isBuy ? config.maxBuyAmountRubXMR : config.maxSellAmountRubXMR;
        default: throw new Error(`Unsupported currency: ${currency}`);
    }
}

module.exports = {
    getPrice,
    getMinAmountRub,
    getMaxAmountRub
};
