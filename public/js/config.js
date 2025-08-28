import { api } from './auth.js';

const arrayKeys = [
    'multipleOperatorsData',
    'commissionDiscounts',
    'buyCommissionScalePercentBTC',
    'sellCommissionScalePercentBTC',
    'buyCommissionScalePercentLTC',
    'sellCommissionScalePercentLTC'
];

const paramTranslations = {
    multipleOperatorsData: 'Данные операторов',
    minBuyAmountRubBTC: 'Минимальная покупка в BTC (в RUB)',
    maxBuyAmountRubBTC: 'Максимальная покупка в BTC (в RUB)',
    minSellAmountRubBTC: 'Минимальная продажа в BTC (в RUB)',
    maxSellAmountRubBTC: 'Максимальная продажа в BTC (в RUB)',
    minBuyAmountRubLTC: 'Минимальная покупка LTC (в RUB)',
    maxBuyAmountRubLTC: 'Максимальная покупка в LTC (в RUB)',
    minSellAmountRubLTC: 'Минимальная продажа в LTC (в RUB)',
    maxSellAmountRubLTC: 'Максимальная продажа в LTC (в RUB)',
    buyCommissionScalePercentBTC: 'Процент комиссия при покупке BTC',
    sellCommissionScalePercentBTC: 'Процент комиссии при продаже BTC',
    buyCommissionScalePercentLTC: 'Процент комиссии при покупке LTC',
    sellCommissionScalePercentLTC: 'Процент комиссии при продаже LTC',
    referralRevenuePercent: "Процент выручки рефералов",
    commissionDiscounts: 'Процент скидки на комиссию'
};

function initializeConfig() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'config') return;

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

    const statusToggle = document.createElement('div');
    statusToggle.className = 'toggle-container';
    statusToggle.innerHTML = `
        <label class="switch">
            <input type="checkbox" id="botStatusToggle" />
            <span class="slider round"></span>
        </label>
        <span class="toggle-label">Статус бота</span>
    `;
    if (credentialsForm) {
        credentialsForm.parentNode.insertBefore(statusToggle, credentialsForm.nextSibling);
    }

    async function updateBotStatus() {
        try {
            const response = await api.get('/bot/status');
            const toggle = document.getElementById('botStatusToggle');
            if (toggle) {
                toggle.checked = response.data.botEnabled;
            }
        } catch (err) {
            console.error('Error fetching bot status:', err);
        }
    }

    const toggle = document.getElementById('botStatusToggle');
    if (toggle) {
        toggle.addEventListener('change', async (e) => {
            try {
                const newStatus = e.target.checked;
                await api.post('/bot/toggle', { enabled: newStatus });
            } catch (err) {
                console.error('Error updating bot status:', err);
                await updateBotStatus();
            }
        });
    }

    const checkBtn = document.getElementById('checkBotStatus');
    if (checkBtn) {
        checkBtn.addEventListener('click', updateBotStatus);
    }

    updateBotStatus();

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

    function openArrayEditor(key) {
        const currentValue = config[key] || [];
        const modal = document.createElement('div');
        modal.className = 'modal';
        let itemsHtml = '';
        let singleOperatorModeHtml = '';

        if (key === 'multipleOperatorsData') {
            const isMultipleOperatorMode = config.multipleOperatorsMode;
            singleOperatorModeHtml = `
                <div class="toggle-container single-operator-toggle">
                    <label class="switch">
                        <input type="checkbox" id="singleOperatorToggle" ${isMultipleOperatorMode ? 'checked' : ''} />
                        <span class="slider round"></span>
                    </label>
                    <span class="toggle-label">Множественное управление операторами</span>
                </div>
            `;
            if (!isMultipleOperatorMode) {
                itemsHtml = `
                    <div class="array-item">
                        <input type="text" value="${config.singleOperatorUsername || ''}" data-idx="0" class="array-input operator-username" placeholder="Имя оператора" />
                    </div>
                `;
            } else {
                itemsHtml = currentValue.length > 0 ? currentValue.map((item, idx) => `
                    <div class="array-item">
                        <input type="text" value="${item.username}" data-idx="${idx}" class="array-input operator-username" placeholder="Имя оператора" />
                        <input type="text" value="${item.password || ''}" data-idx="${idx}" class="array-input operator-password" placeholder="Пароль" />
                        <select data-idx="${idx}" class="array-input currency-select">
                            <option value="BTC" ${item.currency === 'BTC' ? 'selected' : ''}>BTC</option>
                            <option value="LTC" ${item.currency === 'LTC' ? 'selected' : ''}>LTC</option>
                        </select>
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    </div>
                `).join('') : `
                    <div class="array-item">
                        <input type="text" value="" data-idx="0" class="array-input operator-username" placeholder="Имя оператора" />
                        <input type="text" value="" data-idx="0" class="array-input operator-password" placeholder="Пароль" />
                        <select data-idx="0" class="array-input currency-select">
                            <option value="BTC">BTC</option>
                            <option value="LTC">LTC</option>
                        </select>
                        <button class="remove-item" data-idx="0">Удалить</button>
                    </div>
                `;
            }
        } else if (key === 'commissionDiscounts' ||
            key === 'buyCommissionScalePercentBTC' ||
            key === 'sellCommissionScalePercentBTC' ||
            key === 'buyCommissionScalePercentLTC' ||
            key === 'sellCommissionScalePercentLTC') {
            itemsHtml = currentValue.length > 0 ? currentValue.map((item, idx) => `
                <div class="array-item">
                    <input type="number" value="${item.amount}" data-idx="${idx}" class="array-input amount" placeholder="Количество (в RUB)" />
                    <input type="number" value="${item[key.includes('Commission') ? 'commission' : 'discount']}" data-idx="${idx}" class="array-input ${key.includes('Commission') ? 'commission' : 'discount'}" placeholder="${key.includes('Commission') ? 'Комиссия (в %)' : 'Скидка (в %)'}"/>
                    <button class="remove-item" data-idx="${idx}">Удалить</button>
                </div>
            `).join('') : `
                <div class="array-item">
                    <input type="number" value="" data-idx="0" class="array-input amount" placeholder="Количество (в RUB)" />
                    <input type="number" value="" data-idx="0" class="array-input ${key.includes('Commission') ? 'commission' : 'discount'}" placeholder="${key.includes('Commission') ? 'Комиссия (в %)' : 'Скидка (в %)'}"/>
                    <button class="remove-item" data-idx="0">Удалить</button>
                </div>
            `;
        }

        modal.innerHTML = `
            <div class="modal-content">
                <h3>Редактировать ${paramTranslations[key]}</h3>
                ${key === 'multipleOperatorsData' ? singleOperatorModeHtml : ''}
                <div id="array-items">
                    ${itemsHtml}
                </div>
                <div class="modal-actions">
                    ${key === 'multipleOperatorsData' && !config.multipleOperatorsMode ? '' : '<button id="add-item">Добавить</button>'}
                </div>
                <div class="modal-buttons">
                    <button id="save-array-btn">Сохранить</button>
                    <button id="cancel-array-btn">Отменить</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        if (key === 'multipleOperatorsData') {
            const singleOperatorToggle = modal.querySelector('#singleOperatorToggle');
            const itemsDiv = modal.querySelector('#array-items');
            const addItemBtn = modal.querySelector('#add-item');

            const updateSingleOperatorMode = () => {
                const isMultipleOperator = singleOperatorToggle.checked;
                itemsDiv.innerHTML = '';
                if (!isMultipleOperator) {
                    itemsDiv.innerHTML = `
                        <div class="array-item">
                            <input type="text" value="${config.singleOperatorUsername || ''}" data-idx="0" class="array-input operator-username" placeholder="Имя оператора" />
                        </div>
                    `;
                    if (addItemBtn) addItemBtn.style.display = 'none';
                } else {
                    const items = config.multipleOperatorsData || [];
                    itemsDiv.innerHTML = items.length > 0 ? items.map((item, idx) => `
                        <div class="array-item">
                            <input type="text" value="${item.username}" data-idx="${idx}" class="array-input operator-username" placeholder="Имя оператора" />
                            <input type="text" value="${item.password || ''}" data-idx="${idx}" class="array-input operator-password" placeholder="Пароль" />
                            <select data-idx="${idx}" class="array-input currency-select">
                                <option value="BTC" ${item.currency === 'BTC' ? 'selected' : ''}>BTC</option>
                                <option value="LTC" ${item.currency === 'LTC' ? 'selected' : ''}>LTC</option>
                            </select>
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        </div>
                    `).join('') : `
                        <div class="array-item">
                            <input type="text" value="" data-idx="0" class="array-input operator-username" placeholder="Имя оператора" />
                            <input type="text" value="" data-idx="0" class="array-input operator-password" placeholder="Пароль" />
                            <select data-idx="0" class="array-input currency-select">
                                <option value="BTC">BTC</option>
                                <option value="LTC">LTC</option>
                            </select>
                            <button class="remove-item" data-idx="0">Удалить</button>
                        </div>
                    `;
                    if (addItemBtn) addItemBtn.style.display = 'block';
                }
                bindRemoveButtons(modal);
            };

            singleOperatorToggle.addEventListener('change', () => {
                updateSingleOperatorMode();
            });
            updateSingleOperatorMode();
        }

        const addItemButton = modal.querySelector('#add-item');
        if (addItemButton) {
            addItemButton.onclick = () => {
                const itemsDiv = modal.querySelector('#array-items');
                const idx = itemsDiv.children.length;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'array-item';
                if (key === 'commissionDiscounts' ||
                    key === 'buyCommissionScalePercentBTC' ||
                    key === 'sellCommissionScalePercentBTC' ||
                    key === 'buyCommissionScalePercentLTC' ||
                    key === 'sellCommissionScalePercentLTC') {
                    itemDiv.innerHTML = `
                        <input type="number" value="" data-idx="${idx}" class="array-input amount" placeholder="Количество (в RUB)" />
                        <input type="number" value="" data-idx="${idx}" class="array-input ${key.includes('Commission') ? 'commission' : 'discount'}" placeholder="${key.includes('Commission') ? 'Комиссия (в %)' : 'Скидка (в %)'}"/>
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                } else if (key === 'multipleOperatorsData') {
                    itemDiv.innerHTML = `
                        <input type="text" value="" data-idx="${idx}" class="array-input operator-username" placeholder="Имя оператора" />
                        <input type="text" value="" data-idx="${idx}" class="array-input operator-password" placeholder="Пароль" />
                        <select data-idx="${idx}" class="array-input currency-select">
                            <option value="BTC">BTC</option>
                            <option value="LTC">LTC</option>
                        </select>
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                }
                itemsDiv.appendChild(itemDiv);
                bindRemoveButtons(modal);
            };
        }

        modal.querySelector('#save-array-btn').onclick = async () => {
            const itemsDiv = modal.querySelector('#array-items');
            const singleOperatorToggle = modal.querySelector('#singleOperatorToggle');
            const updatedConfig = { ...config };

            if (key === 'multipleOperatorsData') {
                const isMultipleOperator = singleOperatorToggle ? singleOperatorToggle.checked : config.multipleOperatorsMode;
                updatedConfig.multipleOperatorsMode = isMultipleOperator;
                if (!isMultipleOperator) {
                    const username = itemsDiv.querySelector('.array-input.operator-username')?.value.trim();
                    if (username) {
                        updatedConfig.singleOperatorUsername = username;
                        updatedConfig.multipleOperatorsData = [];
                    } else {
                        console.error('No operator username provided in single operator mode');
                        return;
                    }
                } else {
                    const items = Array.from(itemsDiv.children).map(item => {
                        const username = item.querySelector('.operator-username').value.trim();
                        const password = item.querySelector('.operator-password')?.value.trim() || '';
                        const currency = item.querySelector('.currency-select')?.value || 'BTC';
                        return { username, password, currency };
                    });
                    updatedConfig.multipleOperatorsData = items.filter(item => item.username);
                }
            } else if (key === 'commissionDiscounts' ||
                key === 'buyCommissionScalePercentBTC' ||
                key === 'sellCommissionScalePercentBTC' ||
                key === 'buyCommissionScalePercentLTC' ||
                key === 'sellCommissionScalePercentLTC') {
                const items = Array.from(itemsDiv.children).map(item => {
                    const amount = parseFloat(item.querySelector('.amount').value);
                    const value = parseFloat(item.querySelector(key.includes('Commission') ? '.commission' : '.discount').value);
                    return {
                        amount: isNaN(amount) ? 0 : amount,
                        [key.includes('Commission') ? 'commission' : 'discount']: isNaN(value) ? 0 : value
                    };
                });
                updatedConfig[key] = items.filter(item => item.amount && (item[key.includes('Commission') ? 'commission' : 'discount']));
            }

            try {
                await api.put('/config', updatedConfig);
                config = updatedConfig;
                await api.get('/config').then(r => {
                    config = r.data;
                    renderConfigTable();
                });
                modal.remove();
            } catch (err) {
                console.error('Error updating config:', err.message);
            }
        };

        modal.querySelector('#cancel-array-btn').onclick = () => modal.remove();

        function bindRemoveButtons(modal) {
            modal.querySelectorAll('.remove-item').forEach(btn => {
                btn.onclick = () => {
                    btn.parentElement.remove();
                    if (key === 'multipleOperatorsData' && modal.querySelector('#singleOperatorToggle')?.checked && modal.querySelectorAll('.array-item').length === 0) {
                        const idx = 0;
                        const itemDiv = document.createElement('div');
                        itemDiv.className = 'array-item';
                        itemDiv.innerHTML = `
                            <input type="text" value="" data-idx="${idx}" class="array-input operator-username" placeholder="Имя оператора" />
                            <input type="text" value="" data-idx="${idx}" class="array-input operator-password" placeholder="Пароль" />
                            <select data-idx="${idx}" class="array-input currency-select">
                                <option value="BTC">BTC</option>
                                <option value="LTC">LTC</option>
                            </select>
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        `;
                        modal.querySelector('#array-items').appendChild(itemDiv);
                        bindRemoveButtons(modal);
                    }
                };
            });
        }

        bindRemoveButtons(modal);
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
                if (key === 'multipleOperatorsData') {
                    if (config.multipleOperatorsMode === false) {
                        displayValue = config.singleOperatorUsername || '-';
                    } else {
                        const formattedItems = value.map(item => `${item.username} (${item.currency})`);
                        displayValue = '';
                        for (let i = 0; i < formattedItems.length; i += 2) {
                            const pair = [formattedItems[i]];
                            if (i + 1 < formattedItems.length) pair.push(formattedItems[i + 1]);
                            displayValue += pair.join(' | ');
                            if (i + 2 < formattedItems.length) displayValue += '<br>';
                        }
                        displayValue = displayValue || '-';
                    }
                } else if (key === 'commissionDiscounts' ||
                    key === 'buyCommissionScalePercentBTC' ||
                    key === 'sellCommissionScalePercentBTC' ||
                    key === 'buyCommissionScalePercentLTC' ||
                    key === 'sellCommissionScalePercentLTC') {
                    const formattedItems = value.map(item => `${item.amount}: ${item[key.includes('Commission') ? 'commission' : 'discount']}`);
                    displayValue = '';
                    for (let i = 0; i < formattedItems.length; i += 2) {
                        const pair = [formattedItems[i]];
                        if (i + 1 < formattedItems.length) pair.push(formattedItems[i + 1]);
                        displayValue += pair.join(' | ');
                        if (i + 2 < formattedItems.length) displayValue += '<br>';
                    }
                    displayValue = displayValue || '-';
                }
            } else {
                displayValue = value === null || value === undefined ? '-' : value;
            }
            tr.innerHTML = `
                <td>${paramTranslations[key]}</td>
                <td class="${arrayKeys.includes(key) ? 'array-cell' : ''}">
                    ${arrayKeys.includes(key) ? `
                        <span class="array-display">${displayValue}</span>
                        <button class="edit-array-btn" data-key="${key}">Редактировать</button>
                    ` : `
                        <input type="text" value="${value === null || value === undefined ? '' : value}" data-key="${key}" class="config-input" />
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
                    renderConfigTable();
                }).catch(err => console.error('Error updating config:', err.message));
            };
        });
    }
}

export { initializeConfig };