import { api, formatNumber, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeAnalytics() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'analytics') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

        const dealsTable = document.querySelector('#dealsAnalyticsTable tbody');
        const commissionTable = document.querySelector('#commissionAnalyticsTable tbody');
        const usersTable = document.querySelector('#usersAnalyticsTable tbody');

        function showLoading() {
            const periods = ['day', 'week', 'month', 'year'];
            periods.forEach(period => {
                const periodName = period.charAt(0).toUpperCase() + period.slice(1);
                const countEl = document.getElementById(`deals${periodName}Count`);
                const amountEl = document.getElementById(`deals${periodName}Amount`);
                const commissionEl = document.getElementById(`commission${periodName}`);
                const usersEl = document.getElementById(`users${periodName}`);
                
                if (countEl) countEl.textContent = '...';
                if (amountEl) amountEl.textContent = '...';
                if (commissionEl) commissionEl.textContent = '...';
                if (usersEl) usersEl.textContent = '...';
            });
        }

        async function loadAnalytics() {
            showLoading();
            try {
                const response = await api.get('/analytics/stats', { timeout: 30000 });
                const stats = response.data;
                console.log('Analytics stats received:', stats);
                
                if (!stats || !stats.deals || !stats.commission || !stats.users) {
                    console.error('Invalid stats format:', stats);
                    throw new Error('Неверный формат данных');
                }
                
                renderAnalytics(stats);
            } catch (err) {
                console.error('Error loading analytics data:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
                    const errorMsg = 'Превышено время ожидания. Попробуйте обновить страницу.';
                    if (dealsTable) dealsTable.innerHTML = `<tr><td colspan="3">${errorMsg}</td></tr>`;
                    if (commissionTable) commissionTable.innerHTML = `<tr><td colspan="2">${errorMsg}</td></tr>`;
                    if (usersTable) usersTable.innerHTML = `<tr><td colspan="2">${errorMsg}</td></tr>`;
                } else {
                    const errorMsg = 'Ошибка загрузки информации';
                    if (dealsTable) dealsTable.innerHTML = `<tr><td colspan="3">${errorMsg}</td></tr>`;
                    if (commissionTable) commissionTable.innerHTML = `<tr><td colspan="2">${errorMsg}</td></tr>`;
                    if (usersTable) usersTable.innerHTML = `<tr><td colspan="2">${errorMsg}</td></tr>`;
                }
            }
        }
        
        loadAnalytics();

        function renderAnalytics(stats) {
            const periods = ['day', 'week', 'month', 'year'];
            periods.forEach(period => {
                const periodName = period.charAt(0).toUpperCase() + period.slice(1);
                const periodStats = stats.deals[period] || { count: 0, amount: 0 };
                
                const countEl = document.getElementById(`deals${periodName}Count`);
                const amountEl = document.getElementById(`deals${periodName}Amount`);
                
                if (!countEl) console.warn(`Element deals${periodName}Count not found`);
                if (!amountEl) console.warn(`Element deals${periodName}Amount not found`);
                
                if (countEl) countEl.textContent = periodStats.count || 0;
                if (amountEl) amountEl.innerHTML = formatNumber(periodStats.amount || 0, 2);
            });

            periods.forEach(period => {
                const periodName = period.charAt(0).toUpperCase() + period.slice(1);
                const commissionTotal = stats.commission[period] || 0;
                const commissionEl = document.getElementById(`commission${periodName}`);
                
                if (!commissionEl) console.warn(`Element commission${periodName} not found`);
                
                if (commissionEl) commissionEl.innerHTML = formatNumber(commissionTotal, 2);
            });

            periods.forEach(period => {
                const periodName = period.charAt(0).toUpperCase() + period.slice(1);
                const usersCount = stats.users[period] || 0;
                const usersEl = document.getElementById(`users${periodName}`);
                
                if (!usersEl) console.warn(`Element users${periodName} not found`);
                
                if (usersEl) usersEl.textContent = usersCount;
            });
        }
    });
}

initializeAnalytics();