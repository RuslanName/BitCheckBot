import { handleLogin } from './login.js';
import { initializeSidebar, checkAccess } from './sidebar.js';
import { initializeConfig } from './config.js';
import { initializeUsers } from './users.js';
import { initializeDeals } from './deals.js';
import { initializeWithdrawals } from './withdrawals.js';
import { initializeBroadcasts } from './broadcasts.js';
import { initializeAnalytics } from './analytics.js';

const api = axios.create({
    baseURL: "/api"
});

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

function checkAuth(callback) {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    const token = localStorage.getItem('token');
    let userRole;
    let userCurrency;

    if (token) {
        api.get('/user')
            .then(response => {
                userRole = response.data.role || 'admin';
                userCurrency = response.data.currency;
                callback(userRole, userCurrency);
            })
            .catch(err => {
                console.error('Ошибка получения данных пользователя:', err);
                localStorage.removeItem('token');
                window.location.href = '/login';
            });
    } else if (curr !== 'login') {
        window.location.href = '/login';
    }

    return { userRole, userCurrency };
}

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

export { api, formatDateTime };