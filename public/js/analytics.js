import { api, checkAuth } from './utils.js';
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

        let deals = [];
        let users = [];

        async function loadAllData() {
            try {
                const [dealRes, userRes] = await Promise.all([
                    api.get('/deals/analytics'),
                    api.get('/users/analytics')
                ]);
                
                deals = Array.isArray(dealRes.data) ? dealRes.data : [];
                users = Array.isArray(userRes.data) ? userRes.data : [];
                
                renderAnalytics();
            } catch (err) {
                console.error('Error loading analytics data:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    dealsTable.innerHTML = '<tr><td colspan="3">Ошибка загрузки информации</td></tr>';
                    commissionTable.innerHTML = '<tr><td colspan="2">Ошибка загрузки информации</td></tr>';
                    usersTable.innerHTML = '<tr><td colspan="2">Ошибка загрузки информации</td></tr>';
                }
            }
        }
        
        loadAllData();

        function getPeriodFilter(period) {
            const now = new Date();
            let startDate = new Date(now);

            switch (period) {
                case 'day':
                    startDate.setDate(now.getDate() - 1);
                    break;
                case 'week':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'month':
                    startDate.setDate(now.getDate() - 30);
                    break;
                case 'year':
                    startDate.setDate(now.getDate() - 365);
                    break;
                default:
                    startDate = new Date(0);
            }

            return item => new Date(item.timestamp) >= startDate;
        }

        function renderAnalytics() {
            const periods = ['day', 'week', 'month', 'year'];
            periods.forEach(period => {
                const completedDeals = deals.filter(d => d.status === 'completed' && getPeriodFilter(period)(d));
                const dealCount = completedDeals.length;
                const dealAmount = completedDeals.reduce((sum, d) => sum + (d.rubAmount || 0), 0);
                document.getElementById(`deals${period.charAt(0).toUpperCase() + period.slice(1)}Count`).textContent = dealCount;
                document.getElementById(`deals${period.charAt(0).toUpperCase() + period.slice(1)}Amount`).textContent = dealAmount.toFixed(2);
            });

            periods.forEach(period => {
                const completedDeals = deals.filter(d => d.status === 'completed' && getPeriodFilter(period)(d));
                const commissionTotal = completedDeals.reduce((sum, d) => sum + (d.commission || 0), 0);
                document.getElementById(`commission${period.charAt(0).toUpperCase() + period.slice(1)}`).textContent = commissionTotal.toFixed(2);
            });

            periods.forEach(period => {
                const registeredUsers = users.filter(u => getPeriodFilter(period)({ timestamp: u.registrationDate }));
                document.getElementById(`users${period.charAt(0).toUpperCase() + period.slice(1)}`).textContent = registeredUsers.length;
            });
        }
    });
}

initializeAnalytics();