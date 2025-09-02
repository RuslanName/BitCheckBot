import { api, formatDateTime } from './index.js';

async function initializeUsers() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'users') return;

    const tbody = document.querySelector('#usersTable tbody');
    const searchInput = document.getElementById('searchId');
    const perPageSelect = document.getElementById('perPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    const filterRegistrationDate = document.getElementById('filterRegistrationDate');
    const filterDealsCount = document.getElementById('filterDealsCount');
    const filterTurnover = document.getElementById('filterTurnover');
    const filterActivity = document.getElementById('filterActivity');

    if (!tbody || !searchInput || !perPageSelect || !prevBtn || !nextBtn || !pageInfo ||
        !filterRegistrationDate || !filterDealsCount || !filterTurnover || !filterActivity) {
        console.error('Missing required elements for users page');
        return;
    }

    let users = [];
    let deals = [];
    let withdrawals = [];
    let page = 1;
    let perPage = parseInt(perPageSelect.value) || 25;

    Promise.all([
        api.get('/users'),
        api.get('/deals'),
        api.get('/withdrawals')
    ]).then(([uRes, dRes, wRes]) => {
        users = Array.isArray(uRes.data) ? uRes.data : [];
        deals = Array.isArray(dRes.data) ? dRes.data : Object.values(dRes.data);
        withdrawals = Array.isArray(wRes.data) ? wRes.data : Object.values(wRes.data);
        renderUsersTable();
    }).catch(err => {
        console.error('Error loading user data:', err);
        if (err.response?.status === 401 || err.response?.status === 403) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        } else {
            tbody.innerHTML = '<tr><td colspan="9">Ошибка загрузки информации</td></tr>';
        }
    });

    searchInput.addEventListener('input', () => {
        page = 1;
        renderUsersTable();
    });
    perPageSelect.addEventListener('change', (e) => {
        perPage = parseInt(e.target.value) || 25;
        page = 1;
        renderUsersTable();
    });
    filterRegistrationDate.addEventListener('input', () => {
        page = 1;
        renderUsersTable();
    });
    filterDealsCount.addEventListener('input', () => {
        page = 1;
        renderUsersTable();
    });
    filterTurnover.addEventListener('input', () => {
        page = 1;
        renderUsersTable();
    });
    filterActivity.addEventListener('input', () => {
        page = 1;
        renderUsersTable();
    });
    prevBtn.onclick = () => {
        if (page > 1) {
            page--;
            renderUsersTable();
        }
    };
    nextBtn.onclick = () => {
        if (page < Math.ceil(filterUsers().length / perPage)) {
            page++;
            renderUsersTable();
        }
    };

    function filterUsers() {
        const term = searchInput.value.trim().toLowerCase();
        const regDateFilter = filterRegistrationDate.value ? new Date(filterRegistrationDate.value).toISOString().split('T')[0] : null;
        const dealsCountFilter = filterDealsCount.value ? parseInt(filterDealsCount.value, 10) : null;
        const turnoverFilter = filterTurnover.value ? parseFloat(filterTurnover.value) : null;
        const activityFilter = filterActivity.value ? new Date(filterActivity.value).toISOString().split('T')[0] : null;

        return users.filter(u => {
            const matchesSearch = term ? (
                u.id.toString().includes(term) ||
                (u.username && u.username.toLowerCase().includes(term))
            ) : true;

            const matchesRegDate = regDateFilter ? (
                u.registrationDate && u.registrationDate.split('T')[0] === regDateFilter
            ) : true;

            const userDeals = deals.filter(d =>
                (d.userId === u.id || String(d.userId) === String(u.id)) &&
                d.status === 'completed' &&
                (d.rubAmount || d.amount)
            );
            const dealsCount = userDeals.length;
            const matchesDealsCount = dealsCountFilter !== null ? dealsCount >= dealsCountFilter : true;

            const turnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
            const matchesTurnover = turnoverFilter !== null ? turnover >= turnoverFilter : true;

            const userWithdrawals = withdrawals.filter(w => w.userId === u.id && w.status === 'completed');
            const latestActivity = [...userDeals, ...userWithdrawals]
                .map(item => new Date(item.timestamp))
                .sort((a, b) => b - a)[0];
            const matchesActivity = activityFilter ? (
                latestActivity && latestActivity.toISOString().split('T')[0] >= activityFilter
            ) : true;

            return matchesSearch && matchesRegDate && matchesDealsCount && matchesTurnover && matchesActivity;
        });
    }

    async function getCommissionDiscount(turnover) {
        try {
            const config = await api.get('/config');
            const discounts = config.data.commissionDiscounts || [];
            let discount = 0;
            for (let i = discounts.length - 1; i >= 0; i--) {
                if (turnover >= discounts[i].amount) {
                    discount = discounts[i].discount;
                    break;
                }
            }
            return discount;
        } catch (err) {
            console.error('Error loading config for commission discount:', err);
            if (err.response?.status === 401 || err.response?.status === 403) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            }
            return 0;
        }
    }

    async function renderUsersTable() {
        const list = filterUsers();
        const total = list.length;
        const start = (page - 1) * perPage;
        const slice = list.slice(start, start + perPage);

        tbody.innerHTML = '';
        if (total === 0) {
            tbody.innerHTML = '<tr><td colspan="10">На данный момент информация отсутствует</td></tr>';
            return;
        }

        for (const u of slice) {
            const userDeals = deals.filter(d =>
                (d.userId === u.id || String(d.userId) === String(u.id)) &&
                d.status === 'completed' &&
                (d.rubAmount || d.amount)
            );
            const turnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
            const periods = ['day', 'week', 'month', 'year'];
            const getPeriodFilter = (period) => {
                const now = new Date();
                let startDate;
                switch (period) {
                    case 'day':
                        startDate = new Date(now.setHours(0, 0, 0, 0));
                        break;
                    case 'week':
                        startDate = new Date(now.setDate(now.getDate() - now.getDay()));
                        startDate.setHours(0, 0, 0, 0);
                        break;
                    case 'month':
                        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                        break;
                    case 'year':
                        startDate = new Date(now.getFullYear(), 0, 1);
                        break;
                }
                return deal => new Date(deal.timestamp) >= startDate;
            };
            const totalCounts = periods.map(period => userDeals.filter(getPeriodFilter(period)).length);
            const buyCounts = periods.map(period => userDeals.filter(d => d.type === 'buy' && getPeriodFilter(period)(d)).length);
            const sellCounts = periods.map(period => userDeals.filter(d => d.type === 'sell' && getPeriodFilter(period)(d)).length);
            const referralsCount = Array.isArray(u.referrals) ? u.referrals.length : 0;
            const discount = await getCommissionDiscount(turnover);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.id}</td>
                <td><a href="https://t.me/${u.username}" target="_blank">${u.username || '-'}</a></td>
                <td>${formatDateTime(u.registrationDate)}</td>
                <td>${referralsCount}</td>
                <td>
                    Сделки: ${totalCounts.join(' | ')}<br>
                    Покупка: ${buyCounts.join(' | ')}<br>
                    Продажа: ${sellCounts.join(' | ')}
                </td>
                <td>${turnover.toFixed(2)}</td>
                <td><input type="number" value="${(u.balance || 0).toFixed(8)}" data-id="${u.id}" class="balance-input" step="0.00000001" /></td>
                <td>
                    <label class="switch">
                        <input type="checkbox" class="block-toggle" data-id="${u.id}" ${u.isBlocked ? 'checked' : ''} />
                        <span class="slider round"></span>
                    </label>
                </td>
                <td>${discount}%</td>
                <td><button class="delete-user" data-id="${u.id}">Удалить</button></td>
            `;
            tbody.appendChild(tr);
        }

        pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
        prevBtn.disabled = page === 1;
        nextBtn.disabled = page >= Math.ceil(total / perPage);

        document.querySelectorAll('.delete-user').forEach(b => b.onclick = () => {
            api.delete(`/users/${b.dataset.id}`).then(() => {
                users = users.filter(u => u.id !== +b.dataset.id);
                renderUsersTable();
            }).catch(err => {
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }
            });
        });
        document.querySelectorAll('.block-toggle').forEach(cb => cb.onchange = () => {
            api.put(`/users/${cb.dataset.id}`, { isBlocked: cb.checked }).then(() => {
                const user = users.find(u => u.id === +cb.dataset.id);
                if (user) user.isBlocked = cb.checked;
            }).catch(err => {
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }
            });
        });
        document.querySelectorAll('.balance-input').forEach(inp => inp.onblur = () => {
            const id = inp.dataset.id;
            const val = parseFloat(inp.value) || 0;
            api.put(`/users/${id}`, { balance: val }).then(() => {
                const user = users.find(u => u.id === +id);
                if (user) user.balance = val;
            }).catch(err => {
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }
            });
        });
    }
}

export { initializeUsers };