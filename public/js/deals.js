import { api } from './auth.js';
import { formatDateTime } from './index.js';

function initializeDeals(userRole, userCurrency) {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'deals') return;

    const tbody = document.querySelector('#dealsTable tbody');
    const searchInput = document.getElementById('searchId');
    const perPageSelect = document.getElementById('perPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');

    const statusToggle = document.createElement('div');
    statusToggle.className = 'toggle-container';
    statusToggle.innerHTML = `
        <label class="switch">
            <input type="checkbox" id="statusToggle" />
            <span class="slider round"></span>
        </label>
        <span class="toggle-label">Открытые сделки</span>
    `;
    const filterGroup = searchInput.closest('.filter-group') || searchInput.parentElement;
    filterGroup.parentNode.insertBefore(statusToggle, filterGroup.nextSibling);

    if (!tbody || !searchInput || !perPageSelect || !prevBtn || !nextBtn || !pageInfo) {
        console.error('Missing required elements for deals page');
        return;
    }

    let deals = [];
    const users = [];
    let page = 1;
    let perPage = parseInt(perPageSelect.value) || 25;
    let showCompleted = false;

    Promise.all([
        api.get('/deals'),
        api.get('/users')
    ]).then(([dealRes, userRes]) => {
        const fetchedDeals = Array.isArray(dealRes.data) ? dealRes.data : Object.values(dealRes.data);
        users.push(...(Array.isArray(userRes.data) ? userRes.data : []));
        if (userRole === 'admin' && userCurrency) {
            deals.push(...fetchedDeals.filter(d => d.currency === userCurrency));
        } else {
            deals.push(...fetchedDeals);
        }
        renderDealsTable();
    }).catch(err => {
        console.error('Error loading data:', err);
        if (err.response?.status === 401 || err.response?.status === 403) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        } else {
            tbody.innerHTML = '<tr><td colspan="11">Ошибка загрузки информации</td></tr>';
        }
    });

    searchInput.addEventListener('input', () => {
        page = 1;
        renderDealsTable();
    });

    perPageSelect.addEventListener('change', (e) => {
        perPage = parseInt(e.target.value) || 25;
        page = 1;
        renderDealsTable();
    });

    prevBtn.onclick = () => {
        if (page > 1) {
            page--;
            renderDealsTable();
        }
    };

    nextBtn.onclick = () => {
        if (page < Math.ceil(filterDeals().length / perPage)) {
            page++;
            renderDealsTable();
        }
    };

    statusToggle.querySelector('#statusToggle').addEventListener('change', (e) => {
        showCompleted = e.target.checked;
        page = 1;
        statusToggle.querySelector('.toggle-label').textContent = showCompleted
            ? 'Завершенные сделки'
            : 'Открытые сделки';
        renderDealsTable();
    });

    function filterDeals() {
        const term = searchInput.value.trim().toLowerCase();
        return deals.filter(d => {
            if (!d || d.status === 'draft') return false;
            if (showCompleted && d.status !== 'completed') return false;
            if (!showCompleted && d.status === 'completed') return false;
            const user = users.find(u => u.id === d.userId) || {};
            return (
                (d.id && d.id.toString().includes(term)) ||
                (d.userId && d.userId.toString().includes(term)) ||
                (user.username && user.username.toLowerCase().includes(term))
            );
        });
    }

    function renderDealsTable() {
        const list = filterDeals();
        list.sort((a, b) => {
            if (a.status === 'pending' && b.status === 'completed') return -1;
            if (a.status === 'completed' && b.status === 'pending') return 1;
            return 0;
        });

        const total = list.length;
        const start = (page - 1) * perPage;
        const slice = list.slice(start, start + perPage);

        tbody.innerHTML = '';
        if (total === 0) {
            tbody.innerHTML = '<tr><td colspan="11">На данный момент информация отсутствует</td></tr>';
            return;
        }

        slice.forEach(d => {
            const user = users.find(u => u.id === d.userId) || {};
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${d.id || '-'}</td>
                <td><a href="https://t.me/${user.username}" target="_blank">${user.username || d.username}</a></td>
                <td>${d.type === 'buy' ? 'Покупка' : 'Продажа'}</td>
                <td>${d.currency}</td>
                <td>${d.rubAmount.toFixed(2)}</td>
                <td>${d.cryptoAmount.toFixed(8)}</td>
                <td>${d.commission.toFixed(2)}</td>
                <td>${d.total.toFixed(2)}</td>
                <td>${d.walletAddress}</td>
                <td>${formatDateTime(d.timestamp)}</td>
                <td>
                    ${d.status === 'completed'
                ? '<button class="complete-deal" data-id="${d.id}" disabled>Завершено</button>'
                : `
                            <button class="delete-deal" data-id="${d.id}">Удалить</button>
                            <button class="complete-deal" data-id="${d.id}">Завершить</button>
                        `}
                </td>
            `;
            tbody.appendChild(tr);
        });

        pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
        prevBtn.disabled = page === 1;
        nextBtn.disabled = page >= Math.ceil(total / perPage);

        document.querySelectorAll('.delete-deal').forEach(btn => {
            btn.onclick = () => {
                const dealId = btn.dataset.id;
                api.delete(`/deals/${dealId}`).then(() => {
                    deals = deals.filter(d => d.id !== dealId);
                    renderDealsTable();
                }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    } else {
                        console.error('Error deleting deal:', err);
                    }
                });
            };
        });

        document.querySelectorAll('.complete-deal:not(:disabled)').forEach(btn => {
            btn.onclick = () => {
                const dealId = btn.dataset.id;
                api.patch(`/deals/${dealId}/complete`).then(() => {
                    deals = deals.map(d => d.id === dealId ? { ...d, status: 'completed' } : d);
                    renderDealsTable();
                }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    } else {
                        console.error('Error completing deal:', err);
                    }
                });
            };
        });
    }
}

export { initializeDeals };