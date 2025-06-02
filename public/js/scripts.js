const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';

function formatDateTime(isoDate, nullValue = '-') {
    if (!isoDate) return nullValue;
    const date = new Date(isoDate);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).replace(',', '');
}

document.addEventListener('DOMContentLoaded', () => {
    const api = axios.create({
        baseURL: '/api',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });

    const links = [
        { href: '/', page: 'config', label: 'Настройки' },
        { href: '/users', page: 'users', label: 'Пользователи' },
        { href: '/deals', page: 'deals', label: 'Сделки' },
        { href: '/referrals', page: 'referrals', label: 'Вывод рефералов' },
        { href: '/broadcasts', page: 'broadcasts', label: 'Рассылка' },
        { href: '/analytics', page: 'analytics', label: 'Аналитика' }
    ];
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.innerHTML = '';
        links.forEach(l => {
            const a = document.createElement('a');
            a.href = l.href;
            a.textContent = l.label;
            if (l.page === curr) a.classList.add('active');
            sidebar.appendChild(a);
        });
    }

    // Проверка авторизации
    if (!localStorage.getItem('token') && curr !== 'login') {
        window.location.href = '/login';
        return;
    }

    // Обработчик выхода из системы
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            window.location.href = '/login';
        });
    }

    if (curr === 'config') {
        const tbody = document.querySelector('#configTable tbody');
        const searchInput = document.getElementById('searchId');
        const perPageSelect = document.getElementById('perPage');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');
        const credentialsForm = document.getElementById('credentialsForm');
        const adminLoginInput = document.getElementById('adminLogin');
        const adminPasswordInput = document.getElementById('adminPassword');

        let config = {};
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 5;

        const arrayKeys = ['adminIds', 'operatorUsernames', 'commissionDiscounts'];

        const paramTranslations = {
            adminIds: 'ID администраторов',
            operatorUsernames: 'Имена операторов',
            minBuyAmountRubLTC: 'Минимальная покупка LTC (в RUB)',
            maxBuyAmountRubLTC: 'Максимальная покупка в LTC (в RUB)',
            minSellAmountRubLTC: 'Минимальная продажа в LTC (в RUB)',
            maxSellAmountRubLTC: 'Максимальная продажа в LTC (в RUB)',
            minBuyAmountRubBTC: 'Минимальная покупка в BTC (в RUB)',
            maxBuyAmountRubBTC: 'Максимальная покупка в BTC (в RUB)',
            minSellAmountRubBTC: 'Минимальная продажа в BTC (в RUB)',
            maxSellAmountRubBTC: 'Максимальная продажа в BTC (в RUB)',
            commissionBuyRateLTC: 'Комиссия при покупке LTC (в RUB)',
            commissionBuyRateBTC: 'Комиссия при покупке BTC (в RUB)',
            commissionSellRateLTC: 'Комиссия при продаже LTC',
            commissionSellRateBTC: 'Комиссия при продаже BTC',
            referralCommissionRate: "Процент рефералам",
            commissionDiscounts: 'Скидки на комиссию'
        };

        // Загрузка конфигурации
        api.get('/config').then(r => {
            config = r.data;
            renderConfigTable();
        }).catch(err => {
            console.error('Error loading config:', err);
            if (err.response?.status === 401 || err.response?.status === 403) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            } else {
                tbody.innerHTML = '<tr><td colspan="2">Ошибка загрузки информации</td></tr>';
            }
        });

        // Загрузка текущих учетных данных
        api.get('/config/credentials').then(r => {
            const credentials = r.data;
            if (adminLoginInput && adminPasswordInput) {
                adminLoginInput.value = credentials.login || '';
                adminPasswordInput.value = credentials.password || '';
            }
        }).catch(err => {
            console.error('Error loading credentials:', err);
            if (err.response?.status === 401 || err.response?.status === 403) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            }
        });

        searchInput.addEventListener('input', () => {
            page = 1;
            renderConfigTable();
        });
        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 10;
            page = 1;
            renderConfigTable();
        });
        prevBtn.onclick = () => {
            if (page > 1) {
                page--;
                renderConfigTable();
            }
        };
        nextBtn.onclick = () => {
            if (page < Math.ceil(filterConfig().length / perPage)) {
                page++;
                renderConfigTable();
            }
        };

        if (credentialsForm) {
            credentialsForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const login = document.getElementById('adminLogin').value;
                const password = document.getElementById('adminPassword').value;
                try {
                    await api.put('/config/credentials', { login, password });
                } catch (err) {
                    console.error('Error updating credentials:', err);
                }
            });
        }

        function filterConfig() {
            const term = searchInput.value.trim().toLowerCase();
            return Object.entries(config).filter(([key]) => {
                if (!paramTranslations[key]) {
                    console.warn(`key "${key}" not found in paramTranslations`);
                    return false;
                }
                return paramTranslations[key].toLowerCase().includes(term);
            });
        }

        function renderConfigTable() {
            const list = filterConfig();
            const total = list.length;
            const start = (page - 1) * perPage;
            const slice = list.slice(start, start + perPage);

            tbody.innerHTML = '';
            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="2">На данный момент информация отсутствует</td></tr>';
                return;
            }

            slice.forEach(([key, value]) => {
                const tr = document.createElement('tr');
                let displayValue;
                if (Array.isArray(value)) {
                    const formattedItems = value.map(item => item.amount ? `${item.amount}: ${item.discount}` : item);
                    displayValue = '';
                    for (let i = 0; i < formattedItems.length; i += 2) {
                        const pair = [formattedItems[i]];
                        if (i + 1 < formattedItems.length) pair.push(formattedItems[i + 1]);
                        displayValue += pair.join(' | ');
                        if (i + 2 < formattedItems.length) displayValue += '<br>';
                    }
                } else {
                    displayValue = value;
                }
                tr.innerHTML = `
                    <td>${paramTranslations[key]}</td>
                    <td class="${arrayKeys.includes(key) ? 'array-cell' : ''}">
                        ${arrayKeys.includes(key) ? `
                            <span class="array-display">${displayValue}</span>
                            <button class="edit-array-btn" data-key="${key}">Редактировать</button>
                        ` : `
                            <input type="text" value="${value}" data-key="${key}" class="config-input" />
                        `}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= Math.ceil(total / perPage);

            document.querySelectorAll('.edit-array-btn').forEach(btn => {
                btn.onclick = () => openArrayEditor(btn.dataset.key);
            });

            document.querySelectorAll('.config-input').forEach(input => {
                input.onblur = () => {
                    const key = input.dataset.key;
                    const newValue = input.value;
                    let parsedValue;
                    if (!isNaN(newValue)) {
                        parsedValue = parseFloat(newValue);
                    } else {
                        parsedValue = newValue;
                    }
                    const updatedConfig = { ...config, [key]: parsedValue };
                    api.put('/config', updatedConfig).then(() => {
                        config = updatedConfig;
                    }).catch(err => console.error('Error updating config:', err.message));
                };
            });
        }

        function openArrayEditor(key) {
            const currentValue = config[key] || [];
            const modal = document.createElement('div');
            modal.className = 'modal';
            let itemsHtml = '';
            if (key === 'commissionDiscounts') {
                itemsHtml = currentValue.map((item, idx) => `
                    <div class="array-item">
                        <input type="number" value="${item.amount}" data-idx="${idx}" class="array-input amount" placeholder="Количество (в RUB)" />
                        <input type="number" value="${item.discount}" data-idx="${idx}" class="array-input discount" placeholder="Скидка (в %)" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    </div>
                `).join('');
            } else {
                itemsHtml = currentValue.map((item, idx) => `
                    <div class="array-item">
                        <input type="text" value="${item}" data-idx="${idx}" class="array-input" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    </div>
                `).join('');
            }
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Редактировать ${paramTranslations[key]}</h3>
                    <div id="array-items">
                        ${itemsHtml}
                    </div>
                    <div class="modal-actions">
                        <button id="add-item">Добавить</button>
                    </div>
                    <div class="modal-buttons">
                        <button id="save-array-btn">Сохранить</button>
                        <button id="cancel-array-btn">Отменить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#add-item').onclick = () => {
                const itemsDiv = modal.querySelector('#array-items');
                const idx = itemsDiv.children.length;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'array-item';
                if (key === 'commissionDiscounts') {
                    itemDiv.innerHTML = `
                        <input type="number" value="" data-idx="${idx}" class="array-input amount" placeholder="Количество (в RUB)" />
                        <input type="number" value="" data-idx="${idx}" class="array-input discount" placeholder="Скидка (в %)" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                } else {
                    itemDiv.innerHTML = `
                        <input type="text" value="" data-idx="${idx}" class="array-input" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                }
                itemsDiv.appendChild(itemDiv);
                bindRemoveButtons(modal);
            };

            modal.querySelector('#save-array-btn').onclick = () => {
                if (key === 'commissionDiscounts') {
                    const items = modal.querySelectorAll('.array-item');
                    let newValue = [];
                    items.forEach(item => {
                        const amount = item.querySelector('.amount').value;
                        const discount = item.querySelector('.discount').value;
                        if (amount && discount) {
                            newValue.push({ amount: parseFloat(amount), discount: parseFloat(discount) });
                        }
                    });
                    const updatedConfig = { ...config, [key]: newValue };
                    api.put('/config', updatedConfig).then(() => {
                        config = updatedConfig;
                        renderConfigTable();
                        modal.remove();
                    }).catch(err => console.error('Error updating config:', err.message));
                } else {
                    const inputs = modal.querySelectorAll('.array-input');
                    let newValue = Array.from(inputs).map(input => input.value.trim()).filter(val => val);
                    if (key === 'adminIds') {
                        newValue = newValue.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
                    }
                    const updatedConfig = { ...config, [key]: newValue };
                    api.put('/config', updatedConfig).then(() => {
                        config = updatedConfig;
                        renderConfigTable();
                        modal.remove();
                    }).catch(err => console.error('Error updating config:', err.message));
                }
            };

            modal.querySelector('#cancel-array-btn').onclick = () => modal.remove();
            bindRemoveButtons(modal);

            function bindRemoveButtons(modal) {
                modal.querySelectorAll('.remove-item').forEach(btn => {
                    btn.onclick = () => btn.parentElement.remove();
                });
            }
        }
    }

    if (curr === 'users') {
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
            const config = await load('config');
            const discounts = config.commissionDiscounts || [];
            let discount = 0;
            for (let i = discounts.length - 1; i >= 0; i--) {
                if (turnover >= discounts[i].amount) {
                    discount = discounts[i].discount;
                    break;
                }
            }
            return discount;
        }

        async function load(name) {
            try {
                const response = await api.get(`/${name}`);
                return response.data;
            } catch (err) {
                console.error(`Error loading ${name}:`, err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }
                return [];
            }
        }

        async function renderUsersTable() {
            const list = filterUsers();
            const total = list.length;
            const start = (page - 1) * perPage;
            const slice = list.slice(start, start + perPage);

            tbody.innerHTML = '';
            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="9">На данный момент информация отсутствует</td></tr>';
                return;
            }

            for (const u of slice) {
                const userDeals = deals.filter(d =>
                    (d.userId === u.id || String(d.userId) === String(u.id)) &&
                    d.status === 'completed' &&
                    (d.rubAmount || d.amount)
                );
                const turnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
                const dealsCount = userDeals.length;
                const buyCount = userDeals.filter(d => d.type === 'buy').length;
                const sellCount = userDeals.filter(d => d.type === 'sell').length;
                const referralsCount = Array.isArray(u.referrals) ? u.referrals.length : 0;
                const discount = await getCommissionDiscount(turnover);

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${u.id}</td>
                    <td><a href="https://t.me/${u.username}" target="_blank">${u.username || '-'}</a></td>
                    <td>${formatDateTime(u.registrationDate)}</td>
                    <td>${referralsCount}</td>
                    <td>${dealsCount} (${buyCount} | ${sellCount})</td>
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

    if (curr === 'deals') {
        const tbody = document.querySelector('#dealsTable tbody');
        const searchInput = document.getElementById('searchId');
        const perPageSelect = document.getElementById('perPage');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');

        if (!tbody || !searchInput || !perPageSelect || !prevBtn || !nextBtn || !pageInfo) {
            console.error('Missing required elements for deals page');
            return;
        }

        let deals = [];
        let users = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 25;

        Promise.all([
            api.get('/deals'),
            api.get('/users')
        ]).then(([dealRes, userRes]) => {
            deals = Array.isArray(dealRes.data) ? dealRes.data : Object.values(dealRes.data);
            users = Array.isArray(userRes.data) ? userRes.data : [];
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

        function filterDeals() {
            const term = searchInput.value.trim().toLowerCase();
            return deals.filter(d => {
                if (!d || d.status !== 'pending') return false;
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
                    <td><button class="complete-deal" data-id="${d.id}">Завершить</button></td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= Math.ceil(total / perPage);

            document.querySelectorAll('.complete-deal').forEach(btn => {
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

    if (curr === 'referrals') {
        const tbody = document.querySelector('#referralsTable tbody');
        const searchInput = document.getElementById('searchId');
        const perPageSelect = document.getElementById('perPage');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');

        if (!tbody || !searchInput || !perPageSelect || !prevBtn || !nextBtn || !pageInfo) {
            console.error('Missing required elements for referrals page');
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

    if (curr === 'broadcasts') {
        const tbody = document.querySelector('#broadcastsTable tbody');
        const searchInput = document.getElementById('searchId');
        const perPageSelect = document.getElementById('perPage');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');
        const form = document.getElementById('form');
        const formError = document.getElementById('formError');

        let broadcasts = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 50;

        function loadBroadcasts() {
            api.get('/broadcasts').then(r => {
                broadcasts = r.data;
                renderBroadcastsTable();
            }).catch(err => {
                console.error('Error loading broadcasts:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    tbody.innerHTML = '<tr><td colspan="6">Ошибка просмотра информации</td></tr>';
                }
            });
        }

        searchInput.addEventListener('input', () => {
            page = 1;
            renderBroadcastsTable();
        });
        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 25;
            page = 1;
            renderBroadcastsTable();
        });
        prevBtn.onclick = () => {
            if (page > 1) {
                page--;
                renderBroadcastsTable();
            }
        };
        nextBtn.onclick = () => {
            if (page < Math.ceil(filterBroadcasts().length / perPage)) {
                page++;
                renderBroadcastsTable();
            }
        };

        function filterBroadcasts() {
            const term = searchInput.value.trim().toLowerCase();
            return broadcasts.filter(b => b.id.includes(term) || b.text.toLowerCase().includes(term));
        }

        function renderBroadcastsTable() {
            const list = filterBroadcasts();
            const total = list.length;
            const start = (page - 1) * perPage;
            const slice = list.slice(start, start + perPage);

            tbody.innerHTML = '';
            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="6">На данный момент информация отсутствует</td></tr>';
                return;
            }

            slice.forEach(b => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${b.id}</td>
                    <td>${b.text}</td>
                    <td>${b.imageName || 'Нет'}</td>
                    <td>${formatDateTime(b.scheduledTime)}</td>
                    <td>${b.isDaily ? 'Да' : 'Нет'}</td>
                    <td><button class="delete-with-broadcasts" data-id="${b.id}">Удалить</button></td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= Math.ceil(total / perPage);

            document.querySelectorAll('.delete-with-broadcasts').forEach(b => {
                b.onclick = () => {
                    api.delete(`/broadcasts/${b.dataset.id}`).then(() => {
                        broadcasts = broadcasts.filter(item => item.id !== b.dataset.id);
                        renderBroadcastsTable();
                    }).catch(err => {
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        } else {
                            console.error('Error deleting broadcast:', err);
                            broadcasts = broadcasts.filter(item => item.id !== b.dataset.id);
                            renderBroadcastsTable();
                        }
                    });
                };
            });
        }

        if (form) {
            form.addEventListener('submit', e => {
                e.preventDefault();
                formError.style.display = 'none';
                const content = document.getElementById('content').value;
                const scheduledTimeInput = document.getElementById('scheduledTime').value;
                const isDaily = document.getElementById('isDaily').checked;
                const imageInput = document.getElementById('image');

                let scheduledTime = null;
                if (scheduledTimeInput) {
                    const [date, time] = scheduledTimeInput.split(' ');
                    const [day, month, year] = date.split('.');
                    const [hours, minutes] = time.split(':');
                    const dt = new Date(year, month - 1, day, hours, minutes);
                    if (isNaN(dt.getTime())) {
                        formError.textContent = 'Неверный формат даты (ДД.ММ.ГГГГ чч:мм)';
                        formError.style.display = 'block';
                        return;
                    }
                    scheduledTime = dt.toISOString();
                }

                const formData = new FormData();
                formData.append('content', content);
                formData.append('scheduledTime', scheduledTime || '');
                formData.append('isDaily', isDaily);
                if (imageInput.files[0]) {
                    formData.append('image', imageInput.files[0]);
                }

                api.post('/broadcasts', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                }).then(() => {
                    form.reset();
                    loadBroadcasts();
                }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    } else {
                        console.error('Error creating broadcast:', err);
                        formError.textContent = 'Ошибка при создании рассылки';
                        formError.style.display = 'block';
                    }
                });
            });
        }

        loadBroadcasts();
    }

    if (curr === 'analytics') {
        const dealsTable = document.querySelector('#dealsAnalyticsTable tbody');
        const commissionTable = document.querySelector('#commissionAnalyticsTable tbody');
        const usersTable = document.querySelector('#usersAnalyticsTable tbody');

        if (!dealsTable || !commissionTable || !usersTable) {
            console.error('Missing required elements for analytics page');
            return;
        }

        let deals = [];
        let users = [];

        Promise.all([
            api.get('/deals'),
            api.get('/users')
        ]).then(([dealRes, userRes]) => {
            deals = Array.isArray(dealRes.data) ? dealRes.data : Object.values(dealRes.data);
            users = Array.isArray(userRes.data) ? userRes.data : [];
            renderAnalytics();
        }).catch(err => {
            console.error('Error loading analytics data:', err);
            if (err.response?.status === 401 || err.response?.status === 403) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            } else {
                dealsTable.innerHTML = '<tr><td colspan="3">Ошибка загрузки информации</td></tr>';
                commissionTable.innerHTML = '<tr><td colspan="2">Ошибка загрузки информации</td></tr>';
                usersTable.innerHTML = '<tr><td colspan="2">Ошибка загрузки информации</td></tr>';
            }
        });

        function getPeriodFilter(period) {
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
                default:
                    startDate = new Date(0);
            }
            return item => new Date(item.timestamp) >= startDate;
        }

        function renderAnalytics() {
            const periods = ['day', 'week', 'month', 'year'];
            periods.forEach(period => {
                const completedDeals = deals.filter(d => d.status === 'completed' && getPeriodFilter(period)(d));
                const dealCount = completedDeals.length;
                const dealAmount = completedDeals.reduce((sum, d) => sum + (d.rubAmount || 0), 0);
                document.getElementById(`deals${period.charAt(0).toUpperCase() + period.slice(1)}Count`).textContent = dealCount;
                document.getElementById(`deals${period.charAt(0).toUpperCase() + period.slice(1)}Amount`).textContent = dealAmount.toFixed(2);
            });

            periods.forEach(period => {
                const completedDeals = deals.filter(d => d.status === 'completed' && getPeriodFilter(period)(d));
                const commissionTotal = completedDeals.reduce((sum, d) => sum + (d.commission || 0), 0);
                document.getElementById(`commission${period.charAt(0).toUpperCase() + period.slice(1)}`).textContent = commissionTotal.toFixed(2);
            });

            periods.forEach(period => {
                const registeredUsers = users.filter(u => getPeriodFilter(period)({ timestamp: u.registrationDate }));
                document.getElementById(`users${period.charAt(0).toUpperCase() + period.slice(1)}`).textContent = registeredUsers.length;
            });
        }
    }
});