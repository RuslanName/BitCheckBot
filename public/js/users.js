import { api, formatDateTime, formatNumber, checkAuth, setupModalCloseOnOverlayClick } from './utils.js';
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
        let currentBtcPrice = 8200000;

        async function loadBtcPrice() {
            try {
                const response = await api.get('/btc-price');
                currentBtcPrice = response.data.price;
            } catch (error) {
            }
        }

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

            tbody.innerHTML = '<tr><td colspan="12">Загрузка...</td></tr>';

            Promise.all([
                loadBtcPrice(),
                api.get('/users', { params })
            ]).then(([, response]) => {
                const users = response.data.data || [];
                paginationInfo = response.data.pagination || { total: 0, totalPages: 0, page: 1, perPage: 50 };
                renderUsersTable(users);
            }).catch(err => {
                console.error('Error loading user data:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    tbody.innerHTML = '<tr><td colspan="12">Ошибка загрузки информации</td></tr>';
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
                tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 40px; color: #999;">На данный момент информация отсутствует</td></tr>';
                pageInfo.textContent = `Страница 0 из 0`;
                prevBtn.disabled = true;
                nextBtn.disabled = true;
                return;
            }

            for (const u of users) {
                const userDeals = u._stats?.userDeals || [];
                const turnover = u._stats?.turnover || 0;
                const totalDeals = userDeals.length;
                const buyDeals = userDeals.filter(d => d.type === 'buy').length;
                const sellDeals = userDeals.filter(d => d.type === 'sell').length;
                const referralsCount = Array.isArray(u.referrals) ? u.referrals.length : 0;
                const discount = await getCommissionDiscount(turnover);

                const tr = document.createElement('tr');
                const lastActivityDate = u._stats?.lastActivityDate || null;
                tr.innerHTML = `
                    <td>${u.id}</td>
                    <td><a href="${u.username ? 'https://t.me/' + u.username : 'https://t.me/id' + u.id}" target="_blank">${u.username || 'ID ' + u.id}</a></td>
                    <td>${formatDateTime(u.registrationDate)}</td>
                    <td>${lastActivityDate ? formatDateTime(lastActivityDate) : '<span style="color: #adb5bd;">Нет сделок</span>'}</td>
                     <td><button class="edit-referrals-btn" data-id="${u.id}" data-referrals="${JSON.stringify(u.referrals || [])}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                        </svg>
                        ${referralsCount}
                    </button></td>
                    <td>
                        Всего: ${totalDeals}<br>
                        Покупка: ${buyDeals}<br>
                        Продажа: ${sellDeals}
                    </td>
                    <td>${formatNumber(turnover, 2)}</td>
                     <td><input type="number" value="${((u.balance || 0) * currentBtcPrice).toFixed(2)}" data-id="${u.id}" class="balance-input" step="0.01" data-btc-balance="${(u.balance || 0).toFixed(8)}" /></td>
                     <td><input type="number" value="${(u.cashback || 0).toFixed(2)}" data-id="${u.id}" class="cashback-input" step="0.01" /></td>
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
            prevBtn.disabled = (paginationInfo.page || page) <= 1;
            nextBtn.disabled = (paginationInfo.page || page) >= (paginationInfo.totalPages || 1);

            document.querySelectorAll('.delete-user').forEach(b => b.onclick = () => {
                const userId = b.dataset.id;
                api.delete(`/users/${userId}`).then(() => {
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
            document.querySelectorAll('.balance-input').forEach(inp => {
                let originalValue = inp.value;
                
                inp.addEventListener('input', (e) => {
                    if (e.target.value !== originalValue) {
                        e.target.style.backgroundColor = '#fff3cd';
                        e.target.style.border = '2px solid #ffc107';
                    }
                });
                
                inp.onblur = () => {
                    const id = inp.dataset.id;
                    const valRub = parseFloat(inp.value) || 0;
                    const valBtc = valRub / currentBtcPrice;
                    
                    if (inp.value === originalValue) {
                        inp.style.backgroundColor = '';
                        inp.style.border = '';
                        return;
                    }
                    
                    inp.style.backgroundColor = '#d1ecf1';
                    inp.style.border = '2px solid #17a2b8';
                    
                    api.put(`/users/${id}`, { balance: valBtc }).then(() => {
                        originalValue = inp.value;
                        inp.dataset.btcBalance = valBtc.toFixed(8);
                        inp.style.backgroundColor = '#d4edda';
                        inp.style.border = '2px solid #28a745';
                        setTimeout(() => {
                            inp.style.backgroundColor = '';
                            inp.style.border = '';
                        }, 1500);
                    }).catch(err => {
                        inp.style.backgroundColor = '#f8d7da';
                        inp.style.border = '2px solid #dc3545';
                        inp.value = originalValue;
                        setTimeout(() => {
                            inp.style.backgroundColor = '';
                            inp.style.border = '';
                        }, 2000);
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            alert(err.response?.data?.error || 'Ошибка при обновлении реферального баланса');
                        }
                    });
                };
            });
            document.querySelectorAll('.cashback-input').forEach(inp => {
                let originalValue = inp.value;
                
                inp.addEventListener('input', (e) => {
                    if (e.target.value !== originalValue) {
                        e.target.style.backgroundColor = '#fff3cd';
                        e.target.style.border = '2px solid #ffc107';
                    }
                });
                
                inp.onblur = () => {
                    const id = inp.dataset.id;
                    const val = parseFloat(inp.value) || 0;
                    
                    if (inp.value === originalValue) {
                        inp.style.backgroundColor = '';
                        inp.style.border = '';
                        return;
                    }
                    
                    inp.style.backgroundColor = '#d1ecf1';
                    inp.style.border = '2px solid #17a2b8';
                    
                    api.put(`/users/${id}`, { cashback: val }).then(() => {
                        originalValue = inp.value;
                        inp.style.backgroundColor = '#d4edda';
                        inp.style.border = '2px solid #28a745';
                        setTimeout(() => {
                            inp.style.backgroundColor = '';
                            inp.style.border = '';
                        }, 1500);
                    }).catch(err => {
                        inp.style.backgroundColor = '#f8d7da';
                        inp.style.border = '2px solid #dc3545';
                        inp.value = originalValue;
                        setTimeout(() => {
                            inp.style.backgroundColor = '';
                            inp.style.border = '';
                        }, 2000);
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            alert(err.response?.data?.error || 'Ошибка при обновлении кешбэка');
                        }
                    });
                };
            });
            document.querySelectorAll('.edit-referrals-btn').forEach(btn => {
                btn.onclick = () => {
                    const userId = parseInt(btn.dataset.id);
                    let referrals = JSON.parse(btn.dataset.referrals);

                    const modal = document.createElement('div');
                    modal.className = 'modal';

                    function renderItems() {
                        const itemsContainer = modal.querySelector('#referrals-items');
                        itemsContainer.innerHTML = '';
                        referrals.forEach((refId, idx) => {
                            const itemDiv = document.createElement('div');
                            itemDiv.className = 'array-item';
                            itemDiv.innerHTML = `
                                <input type="number" value="${refId}" data-idx="${idx}" class="array-input referral-id" placeholder="ID пользователя" />
                                <button class="remove-item" data-idx="${idx}">Удалить</button>
                            `;
                            itemsContainer.appendChild(itemDiv);
                        });
                        bindRemoveButtons(modal);
                    }

                    modal.innerHTML = `
                        <div class="modal-content">
                            <button class="close-modal" type="button" aria-label="Закрыть">×</button>
                            <h3>Редактировать рефералов</h3>
                            <div id="referrals-items"></div>
                            <div class="prizes-container">
                                <button type="button" id="add-referral" class="add-button">Добавить</button>
                            </div>
                            <div class="modal-buttons">
                                <button id="cancel-referrals-btn">Отменить</button>
                                <button id="save-referrals-btn">Сохранить</button>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);
                    setupModalCloseOnOverlayClick(modal);
                    const closeBtn = modal.querySelector('.close-modal');
                    if (closeBtn) {
                        closeBtn.onclick = () => modal.remove();
                    }
                    renderItems();

                    modal.querySelector('#add-referral').onclick = () => {
                        referrals.push(0);
                        renderItems();
                        const lastInput = modal.querySelector('.referral-id:last-of-type');
                        if (lastInput) lastInput.focus();
                    };

                    modal.querySelector('#cancel-referrals-btn').onclick = () => modal.remove();

                    modal.querySelector('#save-referrals-btn').onclick = async () => {
                        const newReferrals = [];
                        modal.querySelectorAll('.referral-id').forEach(inp => {
                            const val = parseInt(inp.value);
                            if (!isNaN(val) && val > 0) {
                                newReferrals.push(val);
                            }
                        });

                        try {
                            await api.put(`/users/${userId}`, { referrals: newReferrals });
                            btn.dataset.referrals = JSON.stringify(newReferrals);
                            btn.innerHTML = `
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                                    <circle cx="9" cy="7" r="4"/>
                                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                                </svg>
                                ${newReferrals.length}
                            `;
                            modal.remove();
                        } catch (err) {
                            console.error('Error saving referrals:', err);
                            alert(err.response?.data?.error || 'Ошибка при сохранении рефералов');
                        }
                    };

                    function bindRemoveButtons(modal) {
                        modal.querySelectorAll('.remove-item').forEach(removeBtn => {
                            removeBtn.onclick = () => {
                                const idx = parseInt(removeBtn.dataset.idx);
                                referrals.splice(idx, 1);
                                renderItems();
                            };
                        });
                    }
                };
            });
        }
    });
}

initializeUsers();