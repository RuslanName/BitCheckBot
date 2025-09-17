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

        let deals = [];
        const users = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 25;
        let activeTab = 'open';
        let selectedDeals = new Set();
        let lastSelectedDealId = null;

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
            console.error('Error loading deals:', err);
            if (err.response?.status === 401 || err.response?.status === 403) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            } else {
                tbody.innerHTML = '<tr><td colspan="12">Ошибка загрузки информации</td></tr>';
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

        tabContainer.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                tabContainer.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                activeTab = button.dataset.status;
                page = 1;
                renderDealsTable();
            });
        });

        bulkActionContainer.querySelector('#completeSelected').onclick = async () => {
            try {
                await Promise.all([...selectedDeals].map(dealId =>
                    api.patch(`/deals/${dealId}/complete`)
                ));
                deals = deals.map(d => selectedDeals.has(d.id) ? { ...d, status: 'completed' } : d);
                selectedDeals.clear();
                bulkActionContainer.style.display = 'none';
                renderDealsTable();
            } catch (err) {
                console.error('Error completing selected deals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }
            }
        };

        bulkActionContainer.querySelector('#deleteSelected').onclick = async () => {
            try {
                await Promise.all([...selectedDeals].map(dealId =>
                    api.delete(`/deals/${dealId}`)
                ));
                deals = deals.filter(d => !selectedDeals.has(d.id));
                selectedDeals.clear();
                bulkActionContainer.style.display = 'none';
                renderDealsTable();
            } catch (err) {
                console.error('Error deleting selected deals:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }
            }
        };

        bulkActionContainer.querySelector('#cancelSelection').onclick = () => {
            selectedDeals.clear();
            bulkActionContainer.style.display = 'none';
            renderDealsTable();
        };

        function filterDeals() {
            const term = searchInput.value.trim().toLowerCase();
            return deals.filter(d => {
                if (!d || d.status === 'draft') return false;
                if (activeTab === 'open' && d.status !== 'pending') return false;
                if (activeTab === 'completed' && d.status !== 'completed') return false;
                if (activeTab === 'expired' && d.status !== 'expired') return false;
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
                if (a.priority === 'elevated' && b.priority !== 'elevated') return -1;
                if (a.priority !== 'elevated' && b.priority === 'elevated') return 1;
                return 0;
            });

            const total = list.length;
            const start = (page - 1) * perPage;
            const slice = list.slice(start, start + perPage);

            tbody.innerHTML = '';
            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="12">На данный момент информация отсутствует</td></tr>';
                bulkActionContainer.style.display = 'none';
                const table = document.querySelector('table');
                table.style.userSelect = 'auto';
                return;
            }

            slice.forEach(d => {
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

            bulkActionContainer.style.display = selectedDeals.size > 0 ? 'flex' : 'none';

            const allRows = document.querySelectorAll('tr[data-id]');
            allRows.forEach(tr => {
                const dealId = tr.dataset.id;
                const deal = deals.find(d => d.id === dealId);
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

                    if (e.ctrlKey || e.shiftKey) {
                        if (e.shiftKey && lastSelectedDealId) {
                            const currentIndex = Array.from(allRows).findIndex(row => row.dataset.id === dealId);
                            const lastIndex = Array.from(allRows).findIndex(row => row.dataset.id === lastSelectedDealId);
                            const startIndex = Math.min(currentIndex, lastIndex);
                            const endIndex = Math.max(currentIndex, lastIndex);

                            for (let i = startIndex; i <= endIndex; i++) {
                                const rowDealId = allRows[i].dataset.id;
                                const rowDeal = deals.find(d => d.id === rowDealId);
                                if (rowDeal.status !== 'completed' && rowDeal.status !== 'expired' && !selectedDeals.has(rowDealId)) {
                                    selectedDeals.add(rowDealId);
                                    allRows[i].classList.add('selected');
                                }
                            }
                        } else if (e.ctrlKey) {
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
                        deals = deals.filter(d => d.id !== dealId);
                        selectedDeals.delete(dealId);
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
                        selectedDeals.delete(dealId);
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
    });
}

initializeDeals();