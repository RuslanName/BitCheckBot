import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const MERCHANT_API_URL = "https://api.rostrast.com";
const MERCHANT_EXCHANGE_API_KEY = "ca5bb4b325d68e2a7b9d4d2ea95dfdf1dd8c8602";
const MERCHANT_MOBILE_API_KEY = "eb5d33f0282a9d26e8471b1ce1a33c8c11fc042f";
const MERCHANT_SECRET = "s9Fqc2VFNlTIe9MqcOsCbuS9biQMs5Svw7XNGkM9";

function calculateSignature(method, url, bodyContent, secret) {
    const stringToSign = method + url + bodyContent;
    return crypto.createHmac('sha1', secret).update(stringToSign).digest('base64');
}

async function getMerchantPaymentDetails(type, amount, userId, merchantApiKey) {
    try {
        const merchantInternalId = uuidv4();
        const url = `${MERCHANT_API_URL}/api/merchant/invoices`;
        const bodyContent = JSON.stringify({
            type: type,
            amount: amount.toString(),
            currency: 'RUB',
            notificationUrl: "",
            notificationToken: "",
            internalId: merchantInternalId,
            userId: userId.toString(),
        });
        const signature = calculateSignature('POST', url, bodyContent, MERCHANT_SECRET);

        const response = await axios.post(
            url,
            bodyContent,
            {
                headers: {
                    'X-Identity': merchantApiKey,
                    'X-Signature': signature,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error(`Error fetching payment details:`, error.message);
        throw error;
    }
}

async function getAvailablePaymentVariants(id, merchantApiKey) {
    try {
        const url = `${MERCHANT_API_URL}/api/merchant/invoices/${id}/available-payment-variants`;
        const signature = calculateSignature('GET', url, "", MERCHANT_SECRET);

        const response = await axios.get(
            url,
            {
                headers: {
                    'X-Identity': merchantApiKey,
                    'X-Signature': signature,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error(`Error fetching payment variants:`, error.message);
        throw error;
    }
}

async function startMerchantDeal(id, paymentMethod, merchantApiKey) {
    try {
        const url = `${MERCHANT_API_URL}/api/merchant/invoices/${id}/start-deal`;
        const bodyContent = JSON.stringify({
            paymentMethod: paymentMethod,
        });
        const signature = calculateSignature('POST', url, bodyContent, MERCHANT_SECRET);

        const response = await axios.post(
            url,
            bodyContent,
            {
                headers: {
                    'X-Identity': merchantApiKey,
                    'X-Signature': signature,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error(`Error start merchant deal:`, error.message);
        throw error;
    }
}

async function getMerchantInvoice(id, merchantApiKey) {
    try {
        const url = `${MERCHANT_API_URL}/api/merchant/internal-id/${id}`;
        const signature = calculateSignature('GET', url, "", MERCHANT_SECRET);

        const response = await axios.get(
            url,
            {
                headers: {
                    'X-Identity': merchantApiKey,
                    'X-Signature': signature,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error(`Error fetching merchant invoice:`, error.message);
        throw error;
    }
}

async function confirmTransfer(id, file, merchantApiKey) {
    try {
        const url = `${MERCHANT_API_URL}/api/merchant/invoices/${id}/confirm-transfer`;
        const formData = new FormData();
        formData.append('attachment', file);

        const signature = calculateSignature('POST', url, "", MERCHANT_SECRET);

        const response = await axios.post(
            url,
            formData,
            {
                headers: {
                    'X-Identity': merchantApiKey,
                    'X-Signature': signature,
                    'Content-Type': 'multipart/form-data'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error(`Error confirming transfer:`, error.message);
        throw error;
    }
}

async function cancelInvoice(id, merchantApiKey) {
    try {
        const url = `${MERCHANT_API_URL}/api/merchant/invoices/${id}/cancel`;
        const signature = calculateSignature('POST', url, "", MERCHANT_SECRET);

        const response = await axios.post(
            url,
            null,
            {
                headers: {
                    'X-Identity': merchantApiKey,
                    'X-Signature': signature,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error(`Error canceling invoice:`, error.message);
        throw error;
    }
}

const response = await getMerchantPaymentDetails("in", 1000, 1, MERCHANT_EXCHANGE_API_KEY)
console.log("RESPONSE:\n", response);
const response_2 = await getAvailablePaymentVariants(response.id, MERCHANT_EXCHANGE_API_KEY);
console.log("RESPONSE 2:\n", response_2);
if (response_2[0]) {
    const response_3 = await startMerchantDeal(response.id, response_2[0].method, MERCHANT_EXCHANGE_API_KEY);
    console.log("RESPONSE 3:\n", response_3, response_3.deals);
} else {
    console.log("No available payment variants");
}

// const response = await getMerchantPaymentDetails("in", 1000, 1, MERCHANT_EXCHANGE_API_KEY)
// console.log(response);

// let currentAmount = 1000;
// const maxAmount = 10000;
// const step = 500;
//
// while (currentAmount <= maxAmount) {
//     const response = await getMerchantPaymentDetails("in", currentAmount, 1, MERCHANT_EXCHANGE_API_KEY);
//     const response_2 = await getAvailablePaymentVariants(response.id, MERCHANT_EXCHANGE_API_KEY);
//
//     if (response_2[0]) {
//         console.log(`Found payment variant for amount: ${currentAmount}`);
//         console.log("RESPONSE:\n", response);
//         console.log("RESPONSE 2:\n", response_2);
//         const response_3 = await startMerchantDeal(response.id, response_2[0].method, MERCHANT_EXCHANGE_API_KEY);
//         console.log("RESPONSE 3:\n", response_3);
//         break;
//     }
//     currentAmount += step;
// }
//
// if (currentAmount > maxAmount) {
//     console.log("No payment variants found within the specified amount range");
// }