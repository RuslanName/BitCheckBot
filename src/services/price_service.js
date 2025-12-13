const axios = require('axios');
const { COIN_PRICE_API_URL, CACHE_DURATION } = require('../config/constants');

let cachedBtcRubPrice = 8200000;
let cachedLtcRubPrice = 6800;
let lastPriceUpdate = 0;

async function updatePrices() {
    const now = Date.now();
    if (now - lastPriceUpdate < CACHE_DURATION) {
        return;
    }

    try {
        const response = await axios.get(`${COIN_PRICE_API_URL}/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=rub`, { timeout: 10000 });
        cachedBtcRubPrice = response.data.bitcoin.rub || cachedBtcRubPrice;
        cachedLtcRubPrice = response.data.litecoin.rub || cachedLtcRubPrice;
        lastPriceUpdate = now;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                const retryResponse = await axios.get(`${COIN_PRICE_API_URL}/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=rub`, { timeout: 10000 });
                cachedBtcRubPrice = retryResponse.data.bitcoin.rub || cachedBtcRubPrice;
                cachedLtcRubPrice = retryResponse.data.litecoin.rub || cachedLtcRubPrice;
                lastPriceUpdate = now;
            } catch (retryError) {
                throw new Error(`Failed to update prices after retry: ${retryError.message}`);
            }
        } else {
            throw new Error(`Failed to update prices: ${error.message}`);
        }
    }
}

async function getBtcRubPrice() {
    await updatePrices();
    return cachedBtcRubPrice;
}

async function getLtcRubPrice() {
    await updatePrices();
    return cachedLtcRubPrice;
}

setInterval(updatePrices, CACHE_DURATION);

function getLastPriceUpdate() {
    return lastPriceUpdate;
}

module.exports = {
    getBtcRubPrice,
    getLtcRubPrice,
    getLastPriceUpdate
};

