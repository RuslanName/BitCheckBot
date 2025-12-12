import { api, formatDateTime, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeUsers() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'users') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

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

        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 50;
        let paginationInfo = { total: 0, totalPages: 0 };

        function loadUsers() {
            const params = {
                page,
                perPage
            };
            const search = searchInput.value.trim();
            if (search) {
                params.search = search;
            }
            if (filterRegistrationDate.value) {
                params.registrationDate = filterRegistrationDate.value;
            }
            if (filterDealsCount.value) {
                params.dealsCount = filterDealsCount.value;
            }
            if (filterTurnover.value) {
                params.turnover = filterTurnover.value;
            }
            if (filterActivity.value) {
                params.activity = filterActivity.value;
            }

            tbody.innerHTML = '<tr><td colspan="10">Загрузка...</td></tr>';

            api.get('/users', { params }).then(response => {
                const users = response.data.data || [];
                paginationInfo = response.data.pagination || { total: 0, totalPages: 0, page: 1, perPage: 50 };
                renderUsersTable(users);
            }).catch(err => {
                console.error('Error loading user data:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    tbody.innerHTML = '<tr><td colspan="10">Ошибка загрузки информации</td></tr>';
                }
            });
        }

        loadUsers();

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                page = 1;
                loadUsers();
            }, 300);
        });
        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 50;
            page = 1;
            loadUsers();
        });
        filterRegistrationDate.addEventListener('input', () => {
            page = 1;
            loadUsers();
        });
        filterDealsCount.addEventListener('input', () => {
            page = 1;
            loadUsers();
        });
        filterTurnover.addEventListener('input', () => {
            page = 1;
            loadUsers();
        });
        filterActivity.addEventListener('input', () => {
            page = 1;
            loadUsers();
        });
        prevBtn.onclick = () => {
            if (page > 1) {
                page--;
                loadUsers();
            }
        };
        nextBtn.onclick = () => {
            if (page < paginationInfo.totalPages) {
                page++;
                loadUsers();
            }
        };


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

        async function renderUsersTable(users) {
            tbody.innerHTML = '';
            if (!users || users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10">На данный момент информация отсутствует</td></tr>';
                pageInfo.textContent = `Страница 0 из 0`;
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                return;
            }

            for (const u of users) {
                const userDeals = u._stats?.userDeals || [];
                const turnover = u._stats?.turnover || 0;
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

            pageInfo.textContent = `Страница ${paginationInfo.page || page} из ${paginationInfo.totalPages || 1} (Всего: ${paginationInfo.total || 0})`;
            prevBtn.disabled = page <= 1;
            nextBtn.disabled = page >= paginationInfo.totalPages;

            document.querySelectorAll('.delete-user').forEach(b => b.onclick = () => {
                api.delete(`/users/${b.dataset.id}`).then(() => {
                    loadUsers();
                }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    }
                });
            });
            document.querySelectorAll('.block-toggle').forEach(cb => cb.onchange = () => {
                api.put(`/users/${cb.dataset.id}`, { isBlocked: cb.checked }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    }
                });
            });
            document.querySelectorAll('.balance-input').forEach(inp => inp.onblur = () => {
                const id = inp.dataset.id;
                const val = parseFloat(inp.value) || 0;
                api.put(`/users/${id}`, { balance: val }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    }
                });
            });
        }
    });
}

initializeUsers();