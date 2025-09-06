import { api, formatDateTime, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeWithdrawals() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'withdrawals') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

        const tbody = document.querySelector('#referralsTable tbody');
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
            <span class="toggle-label">Открытые выводы</span>
        `;
        const filterGroup = searchInput.closest('.filter-group') || searchInput.parentElement;
        filterGroup.parentNode.insertBefore(statusToggle, filterGroup.nextSibling);

        const bulkActionContainer = document.createElement('div');
        bulkActionContainer.className = 'bulk-action-container';
        bulkActionContainer.style.display = 'none';
        bulkActionContainer.innerHTML = `
            <button id="completeSelected">Завершить выбранные</button>
            <button id="cancelSelection">Отменить</button>
        `;
        filterGroup.appendChild(bulkActionContainer);

        if (!tbody || !searchInput || !perPageSelect || !prevBtn || !nextBtn || !pageInfo) {
            console.error('Отсутствуют необходимые элементы для страницы выводов');
            return;
        }

        let withdrawals = [];
        let users = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 25;
        let showCompleted = false;
        let selectedWithdrawals = new Set();

        Promise.all([
            api.get('/withdrawals'),
            api.get('/users')
        ]).then(([withdrawalRes, userRes]) => {
            withdrawals = Array.isArray(withdrawalRes.data) ? withdrawalRes.data : Object.values(withdrawalRes.data);
            users = Array.isArray(userRes.data) ? userRes.data : [];
            renderWithdrawalsTable();
        }).catch(err => {
            console.error('Ошибка загрузки данных:', err);
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

        statusToggle.querySelector('#statusToggle').addEventListener('change', (e) => {
            showCompleted = e.target.checked;
            page = 1;
            statusToggle.querySelector('.toggle-label').textContent = showCompleted
                ? 'Завершенные выводы'
                : 'Открытые выводы';
            renderWithdrawalsTable();
        });

        bulkActionContainer.querySelector('#completeSelected').onclick = async () => {
            try {
                await Promise.all([...selectedWithdrawals].map(withdrawalId =>
                    api.patch(`/withdrawals/${withdrawalId}/complete`)
                ));
                withdrawals = withdrawals.map(w => selectedWithdrawals.has(w.id) ? { ...w, status: 'completed' } : w);
                selectedWithdrawals.clear();
                bulkActionContainer.style.display = 'none';
                renderWithdrawalsTable();
            } catch (err) {
                console.error('Ошибка завершения выбранных выводов:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    alert('Ошибка при завершении выводов');
                }
            }
        };

        bulkActionContainer.querySelector('#cancelSelection').onclick = () => {
            selectedWithdrawals.clear();
            bulkActionContainer.style.display = 'none';
            renderWithdrawalsTable();
        };

        function filterWithdrawals() {
            const term = searchInput.value.trim().toLowerCase();
            return withdrawals.filter(w => {
                if (!w || w.status === 'draft') return false;
                if (showCompleted && w.status !== 'completed') return false;
                if (!showCompleted && w.status === 'completed') return false;
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
                bulkActionContainer.style.display = 'none';
                return;
            }

            slice.forEach(w => {
                const user = users.find(u => u.id === w.userId) || {};
                const tr = document.createElement('tr');
                tr.className = selectedWithdrawals.has(w.id) ? 'selected' : '';
                tr.dataset.id = w.id;
                tr.innerHTML = `
                    <td>${w.id || '-'}</td>
                    <td><a href="https://t.me/${user.username}" target="_blank">${user.username || '-'}</a></td>
                    <td>${w.rubAmount.toFixed(2)}</td>
                    <td>${w.cryptoAmount.toFixed(8)}</td>
                    <td>${w.walletAddress}</td>
                    <td>${formatDateTime(w.timestamp)}</td>
                    <td>
                        ${w.status === 'completed'
                    ? '<button class="complete-withdrawal" data-id="${w.id}" disabled>Завершено</button>'
                    : '<button class="complete-withdrawal" data-id="${w.id}">Завершить</button>'}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= Math.ceil(total / perPage);

            bulkActionContainer.style.display = selectedWithdrawals.size > 0 ? 'flex' : 'none';

            document.querySelectorAll('tr[data-id]').forEach(tr => {
                tr.onclick = (e) => {
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
                    const withdrawalId = tr.dataset.id;
                    const withdrawal = withdrawals.find(w => w.id === withdrawalId);
                    if (withdrawal.status === 'completed') return;
                    if (selectedWithdrawals.has(withdrawalId)) {
                        selectedWithdrawals.delete(withdrawalId);
                        tr.classList.remove('selected');
                    } else {
                        selectedWithdrawals.add(withdrawalId);
                        tr.classList.add('selected');
                    }
                    bulkActionContainer.style.display = selectedWithdrawals.size > 0 ? 'flex' : 'none';
                };
            });

            document.querySelectorAll('.complete-withdrawal:not(:disabled)').forEach(btn => {
                btn.onclick = () => {
                    const withdrawalId = btn.dataset.id;
                    api.patch(`/withdrawals/${withdrawalId}/complete`).then(() => {
                        withdrawals = withdrawals.map(w => w.id === withdrawalId ? { ...w, status: 'completed' } : w);
                        selectedWithdrawals.delete(withdrawalId);
                        renderWithdrawalsTable();
                    }).catch(err => {
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            console.error('Ошибка завершения вывода:', err);
                        }
                    });
                };
            });
        }
    });
}

initializeWithdrawals();