import { handleLogin, checkAuth } from './auth.js';
import { initializeSidebar, checkAccess } from './sidebar.js';
import { initializeConfig } from './config.js';
import { initializeUsers } from './users.js';
import { initializeDeals } from './deals.js';
import { initializeWithdrawals } from './withdrawals.js';
import { initializeBroadcasts } from './broadcasts.js';
import { initializeAnalytics } from './analytics.js';

function formatDateTime(isoDate, nullValue = '-') {
    if (!isoDate) return nullValue;
    const date = new Date(isoDate);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).replace(',', '');
}

document.addEventListener('DOMContentLoaded', () => {
    handleLogin();
    checkAuth((userRole, userCurrency) => {
        initializeSidebar(userRole);
        if (checkAccess(userRole)) {
            initializeConfig();
            initializeUsers();
            initializeDeals(userRole, userCurrency);
            initializeWithdrawals();
            initializeBroadcasts();
            initializeAnalytics();
        }
    });
});

export { formatDateTime };