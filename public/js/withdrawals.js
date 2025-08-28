import { api } from './auth.js';
import { formatDateTime } from './index.js';

function initializeWithdrawals() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'withdrawals') return;

    const tbody = document.querySelector('#referralsTable tbody');
    const searchInput = document.getElementById('searchId');
    const perPageSelect = document.getElementById('perPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');

    if (!tbody || !searchInput || !perPageSelect || !prevBtn || !nextBtn || !pageInfo) {
        console.error('Missing required elements for withdrawals page');
        return;
    }

    let withdrawals = [];
    let users = [];
    let page = 1;
    let perPage = parseInt(perPageSelect.value) || 25;

    Promise.all([
        api.get('/withdrawals'),
        api.get('/users')
    ]).then(([withdrawalRes, userRes]) => {
        withdrawals = Array.isArray(withdrawalRes.data) ? withdrawalRes.data : Object.values(withdrawalRes.data);
        users = Array.isArray(userRes.data) ? userRes.data : [];
        renderWithdrawalsTable();
    }).catch(err => {
        console.error('Error loading data:', err);
        if (err.response?.status === 401 || err.response?.status === 403) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        } else {
            tbody.innerHTML = '<tr><td colspan="7">Ошибка загрузки информации</td></tr>';
        }
    });

    searchInput.addEventListener('input', () => {
        page = 1;
        renderWithdrawalsTable();
    });
    perPageSelect.addEventListener('change', (e) => {
        perPage = parseInt(e.target.value) || 25;
        page = 1;
        renderWithdrawalsTable();
    });
    prevBtn.onclick = () => {
        if (page > 1) {
            page--;
            renderWithdrawalsTable();
        }
    };
    nextBtn.onclick = () => {
        if (page < Math.ceil(filterWithdrawals().length / perPage)) {
            page++;
            renderWithdrawalsTable();
        }
    };

    function filterWithdrawals() {
        const term = searchInput.value.trim().toLowerCase();
        return withdrawals.filter(w => {
            if (!w || w.status === 'completed') return false;
            const user = users.find(u => u.id === w.userId) || {};
            return (
                (w.id && w.id.toString().includes(term)) ||
                (w.userId && w.userId.toString().includes(term)) ||
                (user.username && user.username.toLowerCase().includes(term))
            );
        });
    }

    function renderWithdrawalsTable() {
        const list = filterWithdrawals();
        const total = list.length;
        const start = (page - 1) * perPage;
        const slice = list.slice(start, start + perPage);

        tbody.innerHTML = '';
        if (total === 0) {
            tbody.innerHTML = '<tr><td colspan="7">На данный момент информация отсутствует</td></tr>';
            return;
        }

        slice.forEach(w => {
            const user = users.find(u => u.id === w.userId) || {};
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${w.id || '-'}</td>
                <td><a href="https://t.me/${user.username}" target="_blank">${user.username || '-'}</a></td>
                <td>${w.rubAmount.toFixed(2)}</td>
                <td>${w.cryptoAmount.toFixed(8)}</td>
                <td>${w.walletAddress}</td>
                <td>${formatDateTime(w.timestamp)}</td>
                <td><button class="complete-withdrawal" data-id="${w.id}">Завершить</button></td>
            `;
            tbody.appendChild(tr);
        });

        pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
        prevBtn.disabled = page === 1;
        nextBtn.disabled = page >= Math.ceil(total / perPage);

        document.querySelectorAll('.complete-withdrawal').forEach(btn => {
            btn.onclick = () => {
                const withdrawalId = btn.dataset.id;
                api.patch(`/withdrawals/${withdrawalId}/complete`).then(() => {
                    withdrawals = withdrawals.map(w => w.id === withdrawalId ? { ...w, status: 'completed' } : w);
                    renderWithdrawalsTable();
                }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    } else {
                        console.error('Error completing withdrawal:', err);
                    }
                });
            };
        });
    }
}

export { initializeWithdrawals };