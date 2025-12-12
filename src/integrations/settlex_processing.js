const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class SettlexProcessing {
    constructor(merchantApiUrl, merchantApiKey) {
        this.merchantApiUrl = merchantApiUrl;
        this.merchantApiKey = merchantApiKey;
    }

    async getMethods() {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/methods`;

            const response = await axios.get(
                url,
                {
                    headers: {
                        'x-merchant-api-key': this.merchantApiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[SettlexProcessing] Error fetching methods:`, error.message);
            if (error.response) {
                console.error(`[SettlexProcessing] Status: ${error.response.status}`);
                console.error(`[SettlexProcessing] Data:`, error.response.data);
            }
            throw error;
        }
    }

    async createTransaction(amount, rate, methodId, expired_at) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/transactions/in`;
            const orderId = uuidv4();

            const bodyContent = JSON.stringify({
                amount: amount,
                rate: rate,
                orderId: orderId,
                methodId: methodId,
                expired_at: expired_at
            });

            const response = await axios.post(
                url,
                bodyContent,
                {
                    headers: {
                        'x-merchant-api-key': this.merchantApiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return { ...response.data, orderId: orderId };
        } catch (error) {
            console.error(`[SettlexProcessing] Error creating transaction:`, error.message);
            if (error.response) {
                console.error(`[SettlexProcessing] Status: ${error.response.status}`);
                console.error(`[SettlexProcessing] Data:`, error.response.data);
            }
            throw error;
        }
    }

    async cancelTransaction(orderId) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/transactions/by-order-id/${orderId}/cancel`;

            const response = await axios.patch(
                url,
                null,
                {
                    headers: {
                        'x-merchant-api-key': this.merchantApiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[SettlexProcessing] Error canceling transaction:`, error.message);
            if (error.response) {
                console.error(`[SettlexProcessing] Status: ${error.response.status}`);
                console.error(`[SettlexProcessing] Data:`, error.response.data);
            }
            throw error;
        }
    }

    async getTransactionStatus(id) {
        try {
            const url = `${this.merchantApiUrl}/api/merchant/transactions/status/${id}`;

            const response = await axios.get(
                url,
                {
                    headers: {
                        'x-merchant-api-key': this.merchantApiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[SettlexProcessing] Error fetching transaction status:`, error.message);
            if (error.response) {
                console.error(`[SettlexProcessing] Status: ${error.response.status}`);
                console.error(`[SettlexProcessing] Data:`, error.response.data);
            }
            throw error;
        }
    }

    async getPaymentDetails(amount, userId) {
        const methods = await this.getMethods();
        if (!methods || methods.length === 0) {
            throw new Error('No payment methods available');
        }
        
        const method = methods[0];
        const expiredAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        
        const transaction = await this.createTransaction(
            amount,
            100,
            method.id,
            expiredAt
        );
        
        return {
            id: transaction.id,
            internalId: transaction.orderId,
            ...transaction
        };
    }

    async getAvailablePaymentVariants(id) {
        const methods = await this.getMethods();
        return methods.map(method => ({
            method: method.id,
            option: method.name || method.id
        }));
    }

    async startDeal(id, paymentMethod) {
        const status = await this.getTransactionStatus(id);
        return {
            id: id,
            deals: [{
                method: paymentMethod,
                ...status
            }]
        };
    }

    async getInvoice(id) {
        return await this.getTransactionStatus(id);
    }

    async cancelInvoice(id) {
        return await this.cancelTransaction(id);
    }

    async getPaymentMethodName(code) {
        try {
            const methods = await this.getMethods();
            const method = methods.find(m => m.id === code || m.code === code);
            return method ? (method.name || method.id) : code;
        } catch (error) {
            console.error(`[SettlexProcessing] Error fetching payment method name:`, error.message);
            return code;
        }
    }
}

module.exports = SettlexProcessing;

