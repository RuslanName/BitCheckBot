import { api, formatDateTime, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeDeals() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'deals') return;

    checkAuth((userRole, userCurrency) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

        const tbody = document.querySelector('#dealsTable tbody');
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
            <button class="tab-button" data-status="expired">Просроченные</button>
        `;
        const filterGroup = searchInput.closest('.filter-group') || searchInput.parentElement;
        filterGroup.parentNode.insertBefore(tabContainer, filterGroup.nextSibling);

        const bulkActionContainer = document.createElement('div');
        bulkActionContainer.className = 'bulk-action-container';
        bulkActionContainer.style.display = 'none';
        bulkActionContainer.innerHTML = `
            <button id="completeSelected">Завершить выбранные</button>
            <button id="deleteSelected">Удалить выбранные</button>
            <button id="cancelSelection">Отменить</button>
        `;
        filterGroup.appendChild(bulkActionContainer);

        const users = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 50;
        let activeTab = 'open';
        let selectedDeals = new Set();
        let lastSelectedDealId = null;
        let paginationInfo = { total: 0, totalPages: 0 };

        function loadDeals() {
            const params = {
                page,
                perPage,
                status: activeTab
            };
            const search = searchInput.value.trim();
            if (search) {
                params.search = search;
            }

            tbody.innerHTML = '<tr><td colspan="12">Загрузка...</td></tr>';

            Promise.all([
                api.get('/deals', { params }),
                api.get('/users')
            ]).then(([dealRes, userRes]) => {
                const response = dealRes.data;
                const deals = response.data || [];
                paginationInfo = response.pagination || { total: 0, totalPages: 0, page: 1, perPage: 50 };
                
                users.length = 0;
                users.push(...(Array.isArray(userRes.data) ? userRes.data : []));
                
                renderDealsTable(deals);
            }).catch(err => {
                console.error('Error loading deals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    tbody.innerHTML = '<tr><td colspan="12">Ошибка загрузки информации</td></tr>';
                }
            });
        }

        loadDeals();

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                page = 1;
                loadDeals();
            }, 300);
        });

        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 50;
            page = 1;
            loadDeals();
        });

        prevBtn.onclick = () => {
            if (page > 1) {
                page--;
                loadDeals();
            }
        };

        nextBtn.onclick = () => {
            if (page < paginationInfo.totalPages) {
                page++;
                loadDeals();
            }
        };

        tabContainer.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                tabContainer.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                activeTab = button.dataset.status;
                page = 1;
                loadDeals();
            });
        });

        bulkActionContainer.querySelector('#completeSelected').onclick = async () => {
            try {
                await Promise.all([...selectedDeals].map(dealId =>
                    api.patch(`/deals/${dealId}/complete`)
                ));
                selectedDeals.clear();
                bulkActionContainer.style.display = 'none';
                loadDeals();
            } catch (err) {
                console.error('Error completing selected deals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    alert(err.response?.data?.error || 'Ошибка при завершении выбранных заявок');
                }
            }
        };

        bulkActionContainer.querySelector('#deleteSelected').onclick = async () => {
            try {
                await Promise.all([...selectedDeals].map(dealId =>
                    api.delete(`/deals/${dealId}`)
                ));
                selectedDeals.clear();
                bulkActionContainer.style.display = 'none';
                loadDeals();
            } catch (err) {
                console.error('Error deleting selected deals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    alert(err.response?.data?.error || 'Ошибка при удалении выбранных заявок');
                }
            }
        };

        bulkActionContainer.querySelector('#cancelSelection').onclick = () => {
            selectedDeals.clear();
            bulkActionContainer.style.display = 'none';
            loadDeals();
        };

        function renderDealsTable(deals) {
            tbody.innerHTML = '';
            if (!deals || deals.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12">На данный момент информация отсутствует</td></tr>';
                bulkActionContainer.style.display = 'none';
                const table = document.querySelector('table');
                table.style.userSelect = 'auto';
                pageInfo.textContent = `Страница 0 из 0`;
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                return;
            }

            deals.forEach(d => {
                const user = users.find(u => u.id === d.userId) || {};
                const tr = document.createElement('tr');
                const isSelected = selectedDeals.has(d.id);
                const isElevated = d.priority === 'elevated';
                tr.className = isSelected ? 'selected' : isElevated ? 'priority-elevated' : '';
                tr.dataset.id = d.id;
                tr.innerHTML = `
                    <td>${d.id || '-'}</td>
                    <td><a href="https://t.me/${user.username}" target="_blank">${user.username || d.username}</a></td>
                    <td>${d.type === 'buy' ? 'Покупка' : 'Продажа'}</td>
                    <td>${d.currency}</td>
                    <td>${d.rubAmount.toFixed(2)}</td>
                    <td>${d.cryptoAmount.toFixed(8)}</td>
                    <td>${d.commission.toFixed(2)}</td>
                    <td>${d.priority === 'elevated' ? 'Повышенный' : 'Обычный'}</td>
                    <td>${d.total.toFixed(2)}</td>
                    <td>${d.walletAddress}</td>
                    <td>${formatDateTime(d.timestamp)}</td>
                    <td>
                        ${d.status === 'completed' || d.status === 'expired'
                    ? `<button class="complete-deal" data-id="${d.id}" disabled>Завершено</button>`
                    : `
                                <button class="delete-deal" data-id="${d.id}">Удалить</button>
                                <button class="complete-deal" data-id="${d.id}">Завершить</button>
                            `}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${paginationInfo.page || page} из ${paginationInfo.totalPages || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= paginationInfo.totalPages;

            bulkActionContainer.style.display = selectedDeals.size > 0 ? 'flex' : 'none';

            const allRows = document.querySelectorAll('tr[data-id]');
            allRows.forEach(tr => {
                const dealId = tr.dataset.id;
                const deal = deals.find(d => d.id === dealId);
                if (!deal) return;
                const isSelected = selectedDeals.has(dealId);
                const isElevated = deal.priority === 'elevated';

                if (isSelected) {
                    tr.classList.add('selected');
                } else {
                    tr.classList.remove('selected');
                }

                if (isElevated) {
                    tr.classList.add('priority-elevated');
                } else {
                    tr.classList.remove('priority-elevated');
                }

                tr.onclick = (e) => {
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
                    e.preventDefault();
                    if (deal.status === 'completed' || deal.status === 'expired') return;

                    if ((e.ctrlKey || e.metaKey) || e.shiftKey) {
                        if (e.shiftKey && lastSelectedDealId) {
                            const currentIndex = Array.from(allRows).findIndex(row => row.dataset.id === dealId);
                            const lastIndex = Array.from(allRows).findIndex(row => row.dataset.id === lastSelectedDealId);
                            const startIndex = Math.min(currentIndex, lastIndex);
                            const endIndex = Math.max(currentIndex, lastIndex);

                            for (let i = startIndex; i <= endIndex; i++) {
                                const rowDealId = allRows[i].dataset.id;
                                const rowDeal = deals.find(d => d.id === rowDealId);
                                if (rowDeal && rowDeal.status !== 'completed' && rowDeal.status !== 'expired' && !selectedDeals.has(rowDealId)) {
                                    selectedDeals.add(rowDealId);
                                    allRows[i].classList.add('selected');
                                }
                            }
                        } else if (e.ctrlKey || e.metaKey) {
                            if (selectedDeals.has(dealId)) {
                                selectedDeals.delete(dealId);
                                tr.classList.remove('selected');
                                lastSelectedDealId = Array.from(selectedDeals).pop() || null;
                            } else {
                                selectedDeals.add(dealId);
                                tr.classList.add('selected');
                                lastSelectedDealId = dealId;
                            }
                        }
                    }

                    const table = document.querySelector('table');
                    table.style.userSelect = selectedDeals.size > 0 ? 'none' : 'auto';
                    bulkActionContainer.style.display = selectedDeals.size > 0 ? 'flex' : 'none';
                };
            });

            document.querySelectorAll('.delete-deal').forEach(btn => {
                btn.onclick = () => {
                    const dealId = btn.dataset.id;
                    api.delete(`/deals/${dealId}`).then(() => {
                        selectedDeals.delete(dealId);
                        loadDeals();
                    }).catch(err => {
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            console.error('Error deleting deal:', err);
                            alert(err.response?.data?.error || 'Ошибка при удалении заявки');
                        }
                    });
                };
            });

            document.querySelectorAll('.complete-deal:not(:disabled)').forEach(btn => {
                btn.onclick = () => {
                    const dealId = btn.dataset.id;
                    api.patch(`/deals/${dealId}/complete`).then(() => {
                        selectedDeals.delete(dealId);
                        loadDeals();
                    }).catch(err => {
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            console.error('Error completing deal:', err);
                            alert(err.response?.data?.error || 'Ошибка при завершении заявки');
                        }
                    });
                };
            });
        }
    });
}

initializeDeals();