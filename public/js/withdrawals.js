import { api, formatDateTime, formatNumber, checkAuth } from './utils.js';
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

        const tabContainer = document.createElement('div');
        tabContainer.className = 'tab-container';
        tabContainer.innerHTML = `
            <button class="tab-button active" data-status="open">Открытые</button>
            <button class="tab-button" data-status="completed">Завершенные</button>
        `;
        const filterGroup = searchInput.closest('.filter-group') || searchInput.parentElement;
        filterGroup.parentNode.insertBefore(tabContainer, filterGroup.nextSibling);

        const bulkActionContainer = document.createElement('div');
        bulkActionContainer.className = 'bulk-action-container';
        bulkActionContainer.style.display = 'none';
        bulkActionContainer.innerHTML = `
            <button id="completeSelected">Завершить выбранные</button>
            <button id="cancelSelection">Отменить</button>
        `;
        filterGroup.appendChild(bulkActionContainer);

        let withdrawals = [];
        let users = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 50;
        let activeTab = 'open';
        let selectedWithdrawals = new Set();
        let lastSelectedWithdrawalId = null;
        let paginationInfo = { total: 0, totalPages: 0 };

        function loadWithdrawals() {
            const params = {
                page,
                perPage,
                status: activeTab
            };
            const search = searchInput.value.trim();
            if (search) {
                params.search = search;
            }

            tbody.innerHTML = '<tr><td colspan="7">Загрузка...</td></tr>';

            Promise.all([
                api.get('/withdrawals', { params }),
                api.get('/users')
            ]).then(([withdrawalRes, userRes]) => {
                const response = withdrawalRes.data;
                withdrawals = response.data || [];
                paginationInfo = response.pagination || { total: 0, totalPages: 0, page: 1, perPage: 50 };
                users = Array.isArray(userRes.data) ? userRes.data : [];
                page = paginationInfo.page || page;
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
        }

        loadWithdrawals();

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                page = 1;
                loadWithdrawals();
            }, 300);
        });

        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 50;
            page = 1;
            loadWithdrawals();
        });

        prevBtn.onclick = () => {
            if (page > 1) {
                page--;
                loadWithdrawals();
            }
        };

        nextBtn.onclick = () => {
            if (page < paginationInfo.totalPages) {
                page++;
                loadWithdrawals();
            }
        };

        tabContainer.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                tabContainer.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                activeTab = button.dataset.status;
                page = 1;
                loadWithdrawals();
            });
        });

        bulkActionContainer.querySelector('#completeSelected').onclick = async () => {
            try {
                await Promise.all([...selectedWithdrawals].map(withdrawalId =>
                    api.patch(`/withdrawals/${withdrawalId}/complete`)
                ));
                selectedWithdrawals.clear();
                loadWithdrawals();
            } catch (err) {
                console.error('Error completing selected withdrawals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    alert(err.response?.data?.error || 'Ошибка при завершении выбранных выводов');
                }
            }
        };

        bulkActionContainer.querySelector('#cancelSelection').onclick = () => {
            selectedWithdrawals.clear();
            lastSelectedWithdrawalId = null;
            loadWithdrawals();
        };

        function renderWithdrawalsTable() {
            const list = withdrawals;
            const total = paginationInfo.total || list.length;

            tbody.innerHTML = '';
            if (total === 0 || list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7">На данный момент информация отсутствует</td></tr>';
                return;
            }

            list.forEach(w => {
                const buttonId = w.id;
                const user = users.find(u => u.id === w.userId);
                const username = user ? user.username : w.userId;
                const tr = document.createElement('tr');
                tr.dataset.id = buttonId;
                if (selectedWithdrawals.has(buttonId)) {
                    tr.classList.add('selected');
                }
                tr.innerHTML = `
                    <td>${buttonId}</td>
                    <td>${username}</td>
                    <td>${formatNumber(w.rubAmount, 2)}</td>
                    <td>${formatNumber(w.cryptoAmount, 8)}</td>
                    <td>${w.walletAddress}</td>
                    <td>${formatDateTime(w.timestamp)}</td>
                    <td>
                        ${w.status === 'completed'
                    ? `<button class="complete-withdrawal" data-id="${buttonId}" disabled>Завершено</button>`
                    : `<button class="complete-withdrawal" data-id="${buttonId}">Завершить</button>`}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${paginationInfo.page || page} из ${paginationInfo.totalPages || 1}`;
            prevBtn.disabled = (paginationInfo.page || page) === 1;
            nextBtn.disabled = (paginationInfo.page || page) >= (paginationInfo.totalPages || 1);

            bulkActionContainer.style.display = selectedWithdrawals.size > 0 ? 'flex' : 'none';

            document.querySelectorAll('tr[data-id]').forEach(tr => {
                tr.addEventListener('click', (e) => {
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
                    e.preventDefault();
                    e.stopPropagation();
                    const withdrawalId = tr.dataset.id;
                    const withdrawal = withdrawals.find(w => w.id === withdrawalId);
                    if (withdrawal.status === 'completed') return;

                    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                    const isMultiSelect = isMac ? e.metaKey : e.ctrlKey;
                    const isRangeSelect = e.shiftKey;

                    if (isRangeSelect && lastSelectedWithdrawalId) {
                        const allRows = Array.from(document.querySelectorAll('tr[data-id]'));
                        const currentIndex = allRows.findIndex(row => row.dataset.id === withdrawalId);
                        const lastIndex = allRows.findIndex(row => row.dataset.id === lastSelectedWithdrawalId);
                        const startIndex = Math.min(currentIndex, lastIndex);
                        const endIndex = Math.max(currentIndex, lastIndex);

                        for (let i = startIndex; i <= endIndex; i++) {
                            const rowWithdrawalId = allRows[i].dataset.id;
                            const rowWithdrawal = withdrawals.find(w => w.id === rowWithdrawalId);
                            if (rowWithdrawal.status !== 'completed' && !selectedWithdrawals.has(rowWithdrawalId)) {
                                selectedWithdrawals.add(rowWithdrawalId);
                                allRows[i].classList.add('selected');
                            }
                        }
                        lastSelectedWithdrawalId = withdrawalId;
                    } else if (isMultiSelect) {
                        if (selectedWithdrawals.has(withdrawalId)) {
                            selectedWithdrawals.delete(withdrawalId);
                            tr.classList.remove('selected');
                            lastSelectedWithdrawalId = Array.from(selectedWithdrawals).pop() || null;
                        } else {
                            selectedWithdrawals.add(withdrawalId);
                            tr.classList.add('selected');
                            lastSelectedWithdrawalId = withdrawalId;
                        }
                    } else {
                        selectedWithdrawals.clear();
                        document.querySelectorAll('tr[data-id]').forEach(row => row.classList.remove('selected'));
                        selectedWithdrawals.add(withdrawalId);
                        tr.classList.add('selected');
                        lastSelectedWithdrawalId = withdrawalId;
                    }

                    const table = document.querySelector('table');
                    table.style.userSelect = selectedWithdrawals.size > 0 ? 'none' : 'auto';
                    bulkActionContainer.style.display = selectedWithdrawals.size > 0 ? 'flex' : 'none';
                });
            });

            document.querySelectorAll('.complete-withdrawal:not(:disabled)').forEach(btn => {
                btn.onclick = () => {
                    const withdrawalId = btn.dataset.id;
                    api.patch(`/withdrawals/${withdrawalId}/complete`).then(() => {
                        selectedWithdrawals.delete(withdrawalId);
                        loadWithdrawals();
                    }).catch(err => {
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            console.error('Error completing withdrawals:', err);
                            alert(err.response?.data?.error || 'Ошибка при завершении вывода');
                        }
                    });
                };
            });
        }
    });
}

initializeWithdrawals();