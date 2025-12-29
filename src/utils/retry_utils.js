function isRetryableError(error) {
    if (!error) return false;
    
    const errorCode = error.code || error.errno || '';
    const errorMessage = (error.message || '').toLowerCase();
    
    if (errorCode === 'EAI_AGAIN' || 
        errorCode === 'ENOTFOUND' || 
        errorCode === 'ECONNREFUSED' ||
        errorMessage.includes('eai_again') ||
        errorMessage.includes('getaddrinfo') ||
        errorMessage.includes('enotfound')) {
        return true;
    }
    
    if (errorCode === 'ECONNABORTED' || 
        errorCode === 'ETIMEDOUT' ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('exceeded')) {
        return true;
    }
    
    if (errorCode === 'ECONNRESET' || 
        errorCode === 'EPIPE' ||
        errorCode === 'ENETUNREACH') {
        return true;
    }
    
    if (error.response && error.response.status === 429) {
        return true;
    }
    
    if (error.response && [502, 503, 504].includes(error.response.status)) {
        return true;
    }
    
    return false;
}

async function retryWithBackoff(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        multiplier = 2,
        shouldRetry = isRetryableError,
        onRetry = null
    } = options;
    
    let lastError;
    let delay = initialDelay;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxRetries || !shouldRetry(error)) {
                throw error;
            }
            
            if (onRetry) {
                onRetry(error, attempt + 1, maxRetries, delay);
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            delay = Math.min(delay * multiplier, maxDelay);
        }
    }
    
    throw lastError;
}

async function axiosWithRetry(axiosRequest, retryOptions = {}) {
    return retryWithBackoff(axiosRequest, {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 10000,
        multiplier: 2,
        onRetry: (error, attempt, maxRetries, delay) => {
            const errorType = error.code || error.message?.substring(0, 50) || 'Unknown';
            console.log(`Retrying request (attempt ${attempt}/${maxRetries}) after ${delay}ms. Error: ${errorType}`);
        },
        ...retryOptions
    });
}

async function telegramWithRetry(telegramRequest, retryOptions = {}) {
    return retryWithBackoff(telegramRequest, {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 10000,
        multiplier: 2,
        onRetry: (error, attempt, maxRetries, delay) => {
            const errorType = error.code || error.message?.substring(0, 50) || 'Unknown';
            console.log(`Retrying Telegram request (attempt ${attempt}/${maxRetries}) after ${delay}ms. Error: ${errorType}`);
        },
        ...retryOptions
    });
}

module.exports = {
    isRetryableError,
    retryWithBackoff,
    axiosWithRetry,
    telegramWithRetry
};

