import { api, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

const arrayKeys = [
    'multipleOperatorsData',
    'vipUsersData',
    'buyPaymentDetailsBTC',
    'buyPaymentDetailsLTC',
    'commissionDiscounts',
    'buyCommissionScalePercentBTC',
    'sellCommissionScalePercentBTC',
    'buyCommissionScalePercentLTC',
    'sellCommissionScalePercentLTC'
];

const paramTranslations = {
    multipleOperatorsData: 'Данные операторов',
    vipUsersData: 'Данные VIP-пользователей',
    buyPaymentDetailsBTC: 'Реквизиты при покупке BTC',
    buyPaymentDetailsLTC: 'Реквизиты при покупке LTC',
    dealCreationRecoveryMinutes: "Время восстановления реквизитов при покупке (в минутах)",
    limitReachedRecoveryHours: "Время восстановления реквизитов при достижении лимита (в часах)",
    dealPaymentDeadlineMinutes: "Время на оплату и подтверждение сделки пользователем (в минутах)",
    sellWalletBTC: 'Адрес BTC кошелька при продаже',
    sellWalletLTC: 'Адрес LTC кошелька при продаже',
    minWithdrawAmountRub: 'Минимальная сумма для вывода средств (в RUB)',
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
    priorityPriceRub: 'Цена приоритетной сделки (в RUB)',
    referralRevenuePercent: "Процент выручки рефералов",
    commissionDiscounts: 'Процент скидки на комиссию'
};

function initializeConfig() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'config') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

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

        const processingSelect = document.createElement('div');
        processingSelect.className = 'toggle-container';
        processingSelect.innerHTML = `
            <label for="processingTypeSelect" class="toggle-label">Тип процессинга:</label>
            <select id="processingTypeSelect" class="config-select">
                <option value="none">Без процессинга</option>
                <option value="ros_trust_processing">Ros Trust Processing</option>
                <option value="settlex_processing">Settlex Processing</option>
            </select>
        `;
        if (credentialsForm) {
            credentialsForm.parentNode.insertBefore(processingSelect, credentialsForm.nextSibling);
            credentialsForm.parentNode.insertBefore(statusToggle, processingSelect);
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

        async function updateProcessingStatus() {
            try {
                const response = await api.get('/processing/status');
                const select = document.getElementById('processingTypeSelect');
                if (select) {
                    select.value = response.data.processingType || 'none';
                }
            } catch (err) {
                console.error('Error fetching processing status:', err);
            }
        }

        const toggle = document.getElementById('botStatusToggle');
        if (toggle) {
            toggle.addEventListener('change', async (e) => {
                try {
                    const newStatus = e.target.checked;
                    await api.post('/bot/toggle', {enabled: newStatus});
                } catch (err) {
                    console.error('Error updating bot status:', err);
                    await updateBotStatus();
                }
            });
        }

        const processingTypeSelect = document.getElementById('processingTypeSelect');
        if (processingTypeSelect) {
            processingTypeSelect.addEventListener('change', async (e) => {
                try {
                    const newType = e.target.value;
                    await api.post('/processing/type', { type: newType });
                } catch (err) {
                    console.error('Error updating processing type:', err);
                    await updateProcessingStatus();
                }
            });
        }

        const checkBtn = document.getElementById('checkBotStatus');
        if (checkBtn) {
            checkBtn.addEventListener('click', () => {
                updateBotStatus();
                updateProcessingStatus();
            });
        }

        updateBotStatus();
        updateProcessingStatus();

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
                    await api.put('/config/credentials', {login, password});
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
            }

            currentValue.forEach((item, idx) => {
                if (key === 'vipUsersData') {
                    itemsHtml += `
                        <div class="array-item">
                            <input type="text" value="${item.username || ''}" data-idx="${idx}" class="array-input username" placeholder="Имя пользователя" />
                            <input type="number" value="${item.discount || ''}" data-idx="${idx}" class="array-input discount" placeholder="Скидка (в %)" />
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        </div>
                    `;
                } else if (key === 'buyPaymentDetailsBTC' || key === 'buyPaymentDetailsLTC') {
                    itemsHtml += `
                        <div class="array-item">
                            <textarea data-idx="${idx}" class="array-input description" placeholder="Описание">${item.description || ''}</textarea>
                            <input type="number" value="${item.limitReachedRub || ''}" data-idx="${idx}" class="array-input limitReachedRub" placeholder="Лимит (в RUB)" />
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        </div>
                    `;
                } else if (key.includes('CommissionScalePercent')) {
                    itemsHtml += `
                        <div class="array-item">
                            <input type="number" value="${item.amount || ''}" data-idx="${idx}" class="array-input amount" placeholder="Сумма" />
                            <input type="number" value="${item.commission || ''}" data-idx="${idx}" class="array-input commission" placeholder="Комиссия (в %)" />
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        </div>
                    `;
                } else if (key === 'commissionDiscounts') {
                    itemsHtml += `
                        <div class="array-item">
                            <input type="number" value="${item.amount || ''}" data-idx="${idx}" class="array-input amount" placeholder="Сумма" />
                            <input type="number" value="${item.discount || ''}" data-idx="${idx}" class="array-input discount" placeholder="Скидка (в %)" />
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        </div>
                    `;
                } else {
                    itemsHtml += `
                        <div class="array-item">
                            <input type="text" value="${item.username || ''}" data-idx="${idx}" class="array-input operator-username" placeholder="Имя оператора" />
                            <input type="text" value="${item.password || ''}" data-idx="${idx}" class="array-input operator-password" placeholder="Пароль" />
                            <select data-idx="${idx}" class="array-input currency-select">
                                <option value="BTC" ${item.currency === 'BTC' ? 'selected' : ''}>BTC</option>
                                <option value="LTC" ${item.currency === 'LTC' ? 'selected' : ''}>LTC</option>
                            </select>
                            <button class="remove-item" data-idx="${idx}">Удалить</button>
                        </div>
                    `;
                }
            });

            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Редактировать ${paramTranslations[key]}</h3>
                    ${singleOperatorModeHtml}
                    <div id="array-items">${itemsHtml}</div>
                    <div class="prizes-container">
                        <button type="button" id="addItem" class="add-button">Добавить</button>
                    </div>
                    <div class="modal-buttons">
                        <button id="cancel-array-btn">Отменить</button>
                        <button id="save-array-btn">Сохранить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const addBtn = modal.querySelector('#addItem');
            addBtn.onclick = () => {
                const idx = currentValue.length + modal.querySelectorAll('.array-item').length;
                const itemDiv = document.createElement('div');
                itemDiv.className = 'array-item';
                if (key === 'vipUsersData') {
                    itemDiv.innerHTML = `
                        <input type="text" value="" data-idx="${idx}" class="array-input username" placeholder="Имя пользователя" />
                        <input type="number" value="" data-idx="${idx}" class="array-input discount" placeholder="Скидка (в %)" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                } else if (key === 'buyPaymentDetailsBTC' || key === 'buyPaymentDetailsLTC') {
                    itemDiv.innerHTML = `
                        <textarea data-idx="${idx}" class="array-input description" placeholder="Описание"></textarea>
                        <input type="number" value="" data-idx="${idx}" class="array-input limitReachedRub" placeholder="Лимит (в RUB)" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                } else if (key.includes('CommissionScalePercent')) {
                    itemDiv.innerHTML = `
                        <input type="number" value="" data-idx="${idx}" class="array-input amount" placeholder="Сумма" />
                        <input type="number" value="" data-idx="${idx}" class="array-input commission" placeholder="Комиссия (в %)" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                } else if (key === 'commissionDiscounts') {
                    itemDiv.innerHTML = `
                        <input type="number" value="" data-idx="${idx}" class="array-input amount" placeholder="Сумма" />
                        <input type="number" value="" data-idx="${idx}" class="array-input discount" placeholder="Скидка (в %)" />
                        <button class="remove-item" data-idx="${idx}">Удалить</button>
                    `;
                } else {
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
                modal.querySelector('#array-items').appendChild(itemDiv);
                bindRemoveButtons(modal);
            };

            function bindRemoveButtons(modal) {
                modal.querySelectorAll('.remove-item').forEach(btn => {
                    btn.onclick = () => btn.parentElement.remove();
                });
            }

            modal.querySelector('#cancel-array-btn').onclick = () => modal.remove();

            modal.querySelector('#save-array-btn').onclick = async () => {
                let newValue = [];
                if (key === 'multipleOperatorsData' && !modal.querySelector('#singleOperatorToggle').checked) {
                    const username = modal.querySelector('.array-input.operator-username')?.value;
                    const password = modal.querySelector('.array-input.operator-password')?.value;
                    const currency = modal.querySelector('.array-input.currency-select')?.value;
                    if (username && password && currency) {
                        newValue = [{username, password, currency}];
                        config.singleOperatorUsername = username;
                    }
                    config.multipleOperatorsMode = false;
                } else {
                    modal.querySelectorAll('.array-item').forEach(item => {
                        if (key === 'vipUsersData') {
                            const username = item.querySelector('.username').value;
                            const discount = parseFloat(item.querySelector('.discount').value);
                            if (username && !isNaN(discount)) {
                                newValue.push({username, discount});
                            }
                        } else if (key === 'buyPaymentDetailsBTC' || key === 'buyPaymentDetailsLTC') {
                            const description = item.querySelector('.description').value;
                            const limitReachedRub = parseFloat(item.querySelector('.limitReachedRub').value);
                            if (description && !isNaN(limitReachedRub)) {
                                newValue.push({
                                    id: item.querySelector('.description').dataset.idx < currentValue.length ?
                                        currentValue[item.querySelector('.description').dataset.idx]?.id || uuid.v4() :
                                        uuid.v4(),
                                    description,
                                    limitReachedRub,
                                    lastResetTimestamp: item.querySelector('.description').dataset.idx < currentValue.length ?
                                        currentValue[item.querySelector('.description').dataset.idx]?.lastResetTimestamp ||
                                        new Date(Date.now() - (config.limitReachedRecoveryHours || 0) * 60 * 60 * 1000).toISOString() :
                                        new Date(Date.now() - (config.limitReachedRecoveryHours || 0) * 60 * 60 * 1000).toISOString(),
                                    timestamp: item.querySelector('.description').dataset.idx < currentValue.length ?
                                        currentValue[item.querySelector('.description').dataset.idx]?.timestamp ||
                                        new Date(Date.now() - (config.dealCreationRecoveryMinutes || 0) * 60 * 1000).toISOString() :
                                        new Date(Date.now() - (config.dealCreationRecoveryMinutes || 0) * 60 * 1000).toISOString(),
                                    confirmedUsages: item.querySelector('.description').dataset.idx < currentValue.length ?
                                        currentValue[item.querySelector('.description').dataset.idx]?.confirmedUsages || 0 :
                                        0
                                });
                            }
                        } else if (key.includes('CommissionScalePercent')) {
                            const amount = parseFloat(item.querySelector('.amount').value);
                            const commission = parseFloat(item.querySelector('.commission').value);
                            if (!isNaN(amount) && !isNaN(commission)) {
                                newValue.push({amount, commission});
                            }
                        } else if (key === 'commissionDiscounts') {
                            const amount = parseFloat(item.querySelector('.amount').value);
                            const discount = parseFloat(item.querySelector('.discount').value);
                            if (!isNaN(amount) && !isNaN(discount)) {
                                newValue.push({amount, discount});
                            }
                        } else {
                            const username = item.querySelector('.operator-username').value;
                            const password = item.querySelector('.operator-password').value;
                            const currency = item.querySelector('.currency-select').value;
                            if (username && password && currency) {
                                newValue.push({username, password, currency});
                            }
                        }
                    });
                    if (key === 'multipleOperatorsData') {
                        config.multipleOperatorsMode = true;
                    }
                }

                try {
                    await api.put('/config', {...config, [key]: newValue});
                    config[key] = newValue;
                    if (key === 'multipleOperatorsData') {
                        config.multipleOperatorsMode = modal.querySelector('#singleOperatorToggle').checked;
                    }
                    modal.remove();
                    renderConfigTable();
                } catch (err) {
                    console.error('Error saving array:', err);
                }
            };

            if (key === 'multipleOperatorsData') {
                modal.querySelector('#singleOperatorToggle').addEventListener('change', (e) => {
                    const itemsContainer = modal.querySelector('#array-items');
                    itemsContainer.innerHTML = '';
                    if (!e.target.checked) {
                        itemsContainer.innerHTML = `
                            <div class="array-item">
                                <input type="text" value="${config.singleOperatorUsername || ''}" data-idx="0" class="array-input operator-username" placeholder="Имя оператора" />
                                <input type="text" value="" data-idx="0" class="array-input operator-password" placeholder="Пароль" />
                                <select data-idx="0" class="array-input currency-select">
                                    <option value="BTC">BTC</option>
                                    <option value="LTC">LTC</option>
                                </select>
                                <button class="remove-item" data-idx="0">Удалить</button>
                            </div>
                        `;
                    } else {
                        itemsHtml = '';
                        (config[key] || []).forEach((item, idx) => {
                            itemsHtml += `
                                <div class="array-item">
                                    <input type="text" value="${item.username || ''}" data-idx="${idx}" class="array-input operator-username" placeholder="Имя оператора" />
                                    <input type="text" value="${item.password || ''}" data-idx="${idx}" class="array-input operator-password" placeholder="Пароль" />
                                    <select data-idx="${idx}" class="array-input currency-select">
                                        <option value="BTC" ${item.currency === 'BTC' ? 'selected' : ''}>BTC</option>
                                        <option value="LTC" ${item.currency === 'LTC' ? 'selected' : ''}>LTC</option>
                                    </select>
                                    <button class="remove-item" data-idx="${idx}">Удалить</button>
                                </div>
                            `;
                        });
                        itemsContainer.innerHTML = itemsHtml;
                    }
                    bindRemoveButtons(modal);
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
                    } else if (key === 'vipUsersData') {
                        const formattedItems = value.map(item => `${item.username}: ${item.discount}`);
                        displayValue = '';
                        for (let i = 0; i < formattedItems.length; i += 2) {
                            const pair = [formattedItems[i]];
                            if (i + 1 < formattedItems.length) pair.push(formattedItems[i + 1]);
                            displayValue += pair.join(' | ');
                            if (i + 2 < formattedItems.length) displayValue += '<br>';
                        }
                        displayValue = displayValue || '-';
                    } else if (key === 'buyPaymentDetailsLTC' || 'buyPaymentDetailsBTC') {
                        const formattedItems = value.map(item => item.description);
                        displayValue = formattedItems.length > 0 ? formattedItems.join('<br>') : '-';
                    }
                } else {
                    displayValue = value === null || value === undefined ? '-' : value;
                }
                let inputHtml;
                if (arrayKeys.includes(key)) {
                    inputHtml = `
                        <span class="array-display">${displayValue}</span>
                        <button class="edit-array-btn" data-key="${key}">Редактировать</button>
                    `;
                } else if (key === 'sellWalletBTC' || key === 'sellWalletLTC') {
                    inputHtml = `
                        <textarea data-key="${key}" class="config-input">${value === null || value === undefined ? '' : value}</textarea>
                    `;
                } else {
                    inputHtml = `
                        <input type="text" value="${value === null || value === undefined ? '' : value}" data-key="${key}" class="config-input" />
                    `;
                }
                tr.innerHTML = `
                    <td>${paramTranslations[key]}</td>
                    <td class="${arrayKeys.includes(key) ? 'array-cell' : ''}">
                        ${inputHtml}
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
                    const updatedConfig = {...config, [key]: parsedValue};
                    api.put('/config', updatedConfig).then(() => {
                        config = updatedConfig;
                        renderConfigTable();
                    }).catch(err => console.error('Error updating config:', err.message));
                };
            });
        }
    });
}

initializeConfig();