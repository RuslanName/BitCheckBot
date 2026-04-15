import { api, formatDateTime, formatNumber, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeCashback() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'cashback') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

        const settingsForm = document.getElementById('cashbackSettingsForm');
        const cashbackPercentInput = document.getElementById('cashbackPercent');
        const minCashbackWithdrawAmountInput = document.getElementById('minCashbackWithdrawAmount');

        const tbody = document.querySelector('#cashbackTable tbody');
        const searchInput = document.getElementById('searchId');
        const perPageSelect = document.getElementById('perPage');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');

        const tabContainer = document.createElement('div');
        tabContainer.className = 'tab-container';
        tabContainer.innerHTML = `
            <button class="tab-button active" data-status="pending">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>Ожидающие
            </button>
            <button class="tab-button" data-status="completed">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>Завершенные
            </button>
            <button class="tab-button" data-status="rejected">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>Отклоненные
            </button>
        `;
        const filterGroup = searchInput.closest('.filter-group') || searchInput.parentElement;
        filterGroup.parentNode.insertBefore(tabContainer, filterGroup.nextSibling);

        const bulkActionContainer = document.createElement('div');
        bulkActionContainer.className = 'bulk-action-container';
        bulkActionContainer.style.display = 'none';
        bulkActionContainer.innerHTML = `
            <button id="completeSelected">Завершить выбранные</button>
            <button id="rejectSelected">Отклонить выбранные</button>
            <button id="cancelSelection">Отменить</button>
        `;
        filterGroup.appendChild(bulkActionContainer);

        let cashbackWithdrawals = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 50;
        let activeTab = 'pending';
        let selectedWithdrawals = new Set();
        let paginationInfo = { total: 0, totalPages: 0 };

        function loadConfig() {
            api.get('/config')
                .then(res => {
                    const config = res.data;
                    cashbackPercentInput.value = config.cashbackPercent || 0;
                    minCashbackWithdrawAmountInput.value = config.minCashbackWithdrawAmount || 0;
                })
                .catch(err => {
                    console.error('Error loading config:', err);
                });
        }

        loadConfig();

        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const data = {
                cashbackPercent: parseFloat(cashbackPercentInput.value) || 0,
                minCashbackWithdrawAmount: parseFloat(minCashbackWithdrawAmountInput.value) || 0
            };
            api.put('/config', data)
                .then(() => {
                    alert('Настройки сохранены');
                })
                .catch(err => {
                    console.error('Error saving config:', err);
                    alert(err.response?.data?.error || 'Ошибка сохранения');
                });
        });

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

            tbody.innerHTML = '<tr><td colspan="8">Загрузка...</td></tr>';

            api.get('/cashback/withdrawals', { params }).then(withdrawalRes => {
                const response = withdrawalRes.data;
                cashbackWithdrawals = response.data || [];
                paginationInfo = response.pagination || { total: 0, totalPages: 0, page: 1, perPage: 50 };
                page = paginationInfo.page || page;
                renderWithdrawalsTable();
            }).catch(err => {
                console.error('Ошибка загрузки данных:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    tbody.innerHTML = '<tr><td colspan="8">Ошибка загрузки информации</td></tr>';
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
                const toComplete = [...selectedWithdrawals];
                await Promise.all(toComplete.map(withdrawalId =>
                    api.patch(`/cashback/withdrawals/${withdrawalId}/complete`)
                ));
                toComplete.forEach(withdrawalId => {
                    const row = document.querySelector(`tr[data-id="${withdrawalId}"]`);
                    if (row) {
                        const completeBtn = row.querySelector('.complete-withdrawal');
                        const rejectBtn = row.querySelector('.reject-withdrawal');
                        if (completeBtn) {
                            completeBtn.disabled = true;
                            completeBtn.textContent = 'Завершено';
                        }
                        if (rejectBtn) rejectBtn.remove();
                        const checkbox = row.querySelector('.withdrawal-checkbox');
                        if (checkbox) checkbox.disabled = true;
                    }
                });
                selectedWithdrawals.clear();
                bulkActionContainer.style.display = 'none';
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

        bulkActionContainer.querySelector('#rejectSelected').onclick = async () => {
            try {
                const toReject = [...selectedWithdrawals];
                await Promise.all(toReject.map(withdrawalId =>
                    api.patch(`/cashback/withdrawals/${withdrawalId}/reject`)
                ));
                toReject.forEach(withdrawalId => {
                    const row = document.querySelector(`tr[data-id="${withdrawalId}"]`);
                    if (row) {
                        const completeBtn = row.querySelector('.complete-withdrawal');
                        const rejectBtn = row.querySelector('.reject-withdrawal');
                        if (rejectBtn) {
                            rejectBtn.disabled = true;
                            rejectBtn.textContent = 'Отклонено';
                        }
                        if (completeBtn) completeBtn.remove();
                        const checkbox = row.querySelector('.withdrawal-checkbox');
                        if (checkbox) checkbox.disabled = true;
                    }
                });
                selectedWithdrawals.clear();
                bulkActionContainer.style.display = 'none';
            } catch (err) {
                console.error('Error rejecting selected withdrawals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    alert(err.response?.data?.error || 'Ошибка при отклонении выбранных выводов');
                }
            }
        };

        bulkActionContainer.querySelector('#cancelSelection').onclick = () => {
            selectedWithdrawals.clear();
            bulkActionContainer.style.display = 'none';
        };

        function renderWithdrawalsTable() {
            const list = cashbackWithdrawals;
            const total = paginationInfo.total || list.length;

            tbody.innerHTML = '';
            if (total === 0 || list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #999;">На данный момент информация отсутствует</td></tr>';
                bulkActionContainer.style.display = 'none';
                pageInfo.textContent = 'Страница 1 из 1';
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                return;
            }

            list.forEach(w => {
                const buttonId = w.id;
                const username = w.userId;
                const tr = document.createElement('tr');
                tr.dataset.id = buttonId;
                const isSelected = selectedWithdrawals.has(buttonId);
                if (isSelected) {
                    tr.classList.add('selected');
                }
                tr.innerHTML = `
                    <td><input type="checkbox" class="withdrawal-checkbox" data-id="${buttonId}" ${w.status === 'completed' || w.status === 'rejected' ? 'disabled' : ''} ${isSelected ? 'checked' : ''}></td>
                    <td>${buttonId}</td>
                    <td><a href="https://t.me/cashbackbot?start=${w.userId}" target="_blank">Получить бонус</a></td>
                    <td>${formatNumber(w.amount, 2)}</td>
                    <td>${w.walletAddress || '-'}</td>
                    <td>${formatDateTime(w.timestamp)}</td>
                    <td>${w.status === 'pending' ? 'Ожидает' : w.status === 'completed' ? 'Завершено' : 'Отклонено'}</td>
                    <td>
                        ${w.status === 'completed' ? '<button disabled>Завершено</button>' :
                         w.status === 'rejected' ? '<button disabled>Отклонено</button>' :
                         `<button class="complete-withdrawal" data-id="${buttonId}">Завершить</button>
                          <button class="reject-withdrawal" data-id="${buttonId}">Отклонить</button>`}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${paginationInfo.page || page} из ${paginationInfo.totalPages || 1}`;
            prevBtn.disabled = (paginationInfo.page || page) === 1;
            nextBtn.disabled = (paginationInfo.page || page) >= (paginationInfo.totalPages || 1);

            bulkActionContainer.style.display = selectedWithdrawals.size > 0 ? 'flex' : 'none';

            document.querySelectorAll('.withdrawal-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const withdrawalId = e.target.dataset.id;
                    const withdrawal = cashbackWithdrawals.find(w => w.id === withdrawalId);
                    
                    if (e.target.checked) {
                        selectedWithdrawals.add(withdrawalId);
                        e.target.closest('tr').classList.add('selected');
                    } else {
                        selectedWithdrawals.delete(withdrawalId);
                        e.target.closest('tr').classList.remove('selected');
                    }
                    
                    bulkActionContainer.style.display = selectedWithdrawals.size > 0 ? 'flex' : 'none';
                });
                
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            });

            document.querySelectorAll('.complete-withdrawal:not(:disabled)').forEach(btn => {
                btn.onclick = () => {
                    const withdrawalId = btn.dataset.id;
                    api.patch(`/cashback/withdrawals/${withdrawalId}/complete`).then(() => {
                        selectedWithdrawals.delete(withdrawalId);
                        const row = document.querySelector(`tr[data-id="${withdrawalId}"]`);
                        if (row) {
                            const completeBtn = row.querySelector('.complete-withdrawal');
                            const rejectBtn = row.querySelector('.reject-withdrawal');
                            if (completeBtn) {
                                completeBtn.disabled = true;
                                completeBtn.textContent = 'Завершено';
                            }
                            if (rejectBtn) rejectBtn.remove();
                            const checkbox = row.querySelector('.withdrawal-checkbox');
                            if (checkbox) checkbox.disabled = true;
                        }
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

            document.querySelectorAll('.reject-withdrawal:not(:disabled)').forEach(btn => {
                btn.onclick = () => {
                    const withdrawalId = btn.dataset.id;
                    api.patch(`/cashback/withdrawals/${withdrawalId}/reject`).then(() => {
                        selectedWithdrawals.delete(withdrawalId);
                        const row = document.querySelector(`tr[data-id="${withdrawalId}"]`);
                        if (row) {
                            const completeBtn = row.querySelector('.complete-withdrawal');
                            const rejectBtn = row.querySelector('.reject-withdrawal');
                            if (rejectBtn) {
                                rejectBtn.disabled = true;
                                rejectBtn.textContent = 'Отклонено';
                            }
                            if (completeBtn) completeBtn.remove();
                            const checkbox = row.querySelector('.withdrawal-checkbox');
                            if (checkbox) checkbox.disabled = true;
                        }
                    }).catch(err => {
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            console.error('Error rejecting withdrawals:', err);
                            alert(err.response?.data?.error || 'Ошибка при отклонении вывода');
                        }
                    });
                };
            });
        }
    });
}

initializeCashback();
