const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class RosTrustProcessing {
    constructor(merchantApiUrl, merchantApiKey, merchantSecret) {
        this.merchantApiUrl = merchantApiUrl;
        this.merchantApiKey = merchantApiKey;
        this.merchantSecret = merchantSecret;
    }

    calculateSignature(method, url, bodyContent = "") {
        const stringToSign = method + url + bodyContent;
        return crypto.createHmac('sha1', this.merchantSecret).update(stringToSign).digest('base64');
    }

    async getPaymentDetails(amount, userId) {
        try {
            const merchantInternalId = uuidv4();
            const url = `${this.merchantApiUrl}/api/merchant/invoices`;
            const bodyContent = JSON.stringify({
                type: "in",
                amount: amount.toString(),
                currency: 'RUB',
                notificationUrl: "",
                notificationToken: "",
                internalId: merchantInternalId,
                userId: userId.toString(),
            });
            const signature = this.calculateSignature('POST', url, bodyContent);

            const response = await axios.post(
                url,
                bodyContent,
                {
                    headers: {
                        'X-Identity': this.merchantApiKey,
                        'X-Signature': signature,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[RosTrustProcessing] Error fetching payment details:`, error.message);
            throw error;
        }
    }

    async getAvailablePaymentVariants(id) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/invoices/${id}/available-payment-variants`;
            const signature = this.calculateSignature('GET', url);

            const response = await axios.get(
                url,
                {
                    headers: {
                        'X-Identity': this.merchantApiKey,
                        'X-Signature': signature,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[RosTrustProcessing] Error fetching payment variants:`, error.message);
            throw error;
        }
    }

    async startDeal(id, paymentMethod) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/invoices/${id}/start-deal`;
            const bodyContent = JSON.stringify({
                paymentMethod: paymentMethod,
            });
            const signature = this.calculateSignature('POST', url, bodyContent);

            const response = await axios.post(
                url,
                bodyContent,
                {
                    headers: {
                        'X-Identity': this.merchantApiKey,
                        'X-Signature': signature,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[RosTrustProcessing] Error starting deal:`, error.message);
            throw error;
        }
    }

    async getInvoice(id) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/invoices/${id}`;
            const signature = this.calculateSignature('GET', url);

            const response = await axios.get(
                url,
                {
                    headers: {
                        'X-Identity': this.merchantApiKey,
                        'X-Signature': signature,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[RosTrustProcessing] Error fetching invoice:`, error.message);
            throw error;
        }
    }

    async cancelInvoice(id) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/invoices/${id}/cancel`;
            const bodyContent = "";
            const signature = this.calculateSignature('POST', url, bodyContent);

            const response = await axios.post(
                url,
                bodyContent,
                {
                    headers: {
                        'X-Identity': this.merchantApiKey,
                        'X-Signature': signature,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[RosTrustProcessing] Error canceling invoice:`, error.message);
            throw error;
        }
    }

    async getPaymentMethodName(code) {
        try {
            const response = await axios.get(`${this.merchantApiUrl}/api/public/payment-methods/RUB`);
            const paymentMethods = response.data.reduce((acc, method) => {
                acc[method.code] = method.name;
                return acc;
            }, {});
            return paymentMethods[code] || code;
        } catch (error) {
            console.error(`[RosTrustProcessing] Error fetching payment method name for code ${code}:`, error.message);
            return code;
        }
    }
}

module.exports = RosTrustProcessing;

