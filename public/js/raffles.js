import { api, formatDateTime, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeRaffles() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'raffles') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

        const tbody = document.querySelector('#rafflesTable tbody');
        const searchInput = document.getElementById('searchId');
        const perPageSelect = document.getElementById('perPage');
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        const pageInfo = document.getElementById('pageInfo');
        const form = document.getElementById('form');
        const formError = document.getElementById('formError');
        const conditionTypeSelect = document.getElementById('conditionType');
        const dealCountField = document.getElementById('dealCountField');
        const dealSumField = document.getElementById('dealSumField');
        const conditionFields = document.getElementById('conditionFields');

        let raffles = [];
        let page = 1;
        let perPage = parseInt(perPageSelect.value) || 50;
        let showCompleted = false;

        const tabContainer = document.createElement('div');
        tabContainer.className = 'tab-container';
        tabContainer.innerHTML = `
            <button class="tab-button active" data-status="open">Открытые</button>
            <button class="tab-button" data-status="completed">Завершенные</button>
        `;
        const filterGroup = searchInput.closest('.filter-group') || searchInput.parentElement;
        filterGroup.parentNode.insertBefore(tabContainer, filterGroup.nextSibling);

        function updateConditionFields() {
            const conditionType = conditionTypeSelect.value;
            conditionFields.style.display = conditionType ? 'block' : 'none';
            dealCountField.style.display = conditionType === 'dealCount' ? 'block' : 'none';
            dealSumField.style.display = conditionType === 'dealSum' ? 'block' : 'none';
        }

        conditionTypeSelect.addEventListener('change', updateConditionFields);

        function loadRaffles() {
            const term = searchInput.value.trim().toLowerCase();
            api.get(`/raffles?search=${encodeURIComponent(term)}`).then(r => {
                raffles = Array.isArray(r.data) ? r.data : Object.values(r.data);
                renderRafflesTable();
            }).catch(err => {
                console.error('Error loading raffles:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    tbody.innerHTML = '<tr><td colspan="5">Ошибка просмотра информации</td></tr>';
                }
            });
        }

        function openEditModal(raffle) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            const startDate = raffle.startDate ? new Date(raffle.startDate).toISOString().slice(0, 16) : '';
            const endDate = raffle.endDate ? new Date(raffle.endDate).toISOString().slice(0, 16) : '';
            let prizesHtml = raffle.prizes.map((prize, index) => `
                <div class="array-item prize-item">
                    <input type="text" value="${prize}" placeholder="Приз для ${index + 1} места" required>
                    <button type="button" class="remove-prize">Удалить</button>
                </div>
            `).join('');
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Редактировать розыгрыш</h3>
                    <div class="form-group-horizontal">
                        <div class="form-subgroup">
                            <label for="editStartDate">Дата и время начала:</label>
                            <input type="datetime-local" id="editStartDate" value="${startDate}" required>
                        </div>
                        <div class="form-subgroup">
                            <label for="editEndDate">Дата и время окончания:</label>
                            <input type="datetime-local" id="editEndDate" value="${endDate}" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="editConditionType">Условие:</label>
                        <select id="editConditionType">
                            <option value="">Выберите условие</option>
                            <option value="dealCount" ${raffle.condition.type === 'dealCount' ? 'selected' : ''}>Количество завершённых сделок</option>
                            <option value="dealSum" ${raffle.condition.type === 'dealSum' ? 'selected' : ''}>Сумма завершённых сделок</option>
                        </select>
                    </div>
                    <div id="editConditionFields" style="display: ${raffle.condition.type ? 'block' : 'none'};">
                        <div class="condition-container">
                            <div id="editDealCountField" style="display: ${raffle.condition.type === 'dealCount' ? 'block' : 'none'};">
                                <label for="editDealCount">Количество сделок:</label>
                                <input type="number" id="editDealCount" value="${raffle.condition.type === 'dealCount' ? raffle.condition.value : ''}">
                            </div>
                            <div id="editDealSumField" style="display: ${raffle.condition.type === 'dealSum' ? 'block' : 'none'};">
                                <label for="editDealSum">Сумма сделок (RUB):</label>
                                <input type="number" id="editDealSum" value="${raffle.condition.type === 'dealSum' ? raffle.condition.value : ''}">
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Призы:</label>
                        <div id="editPrizesContainer" class="prizes-container">
                            ${prizesHtml}
                            <button type="button" id="editAddPrize" class="add-button">Добавить</button>
                        </div>
                    </div>
                    <p id="editFormError" class="error" style="display: none;"></p>
                    <div class="modal-buttons">
                        <button id="cancel-raffle-btn">Отменить</button>
                        <button id="save-raffle-btn">Сохранить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const editConditionTypeSelect = modal.querySelector('#editConditionType');
            const editConditionFields = modal.querySelector('#editConditionFields');
            const editDealCountField = modal.querySelector('#editDealCountField');
            const editDealSumField = modal.querySelector('#editDealSumField');

            editConditionTypeSelect.addEventListener('change', () => {
                const conditionType = editConditionTypeSelect.value;
                editConditionFields.style.display = conditionType ? 'block' : 'none';
                editDealCountField.style.display = conditionType === 'dealCount' ? 'block' : 'none';
                editDealSumField.style.display = conditionType === 'dealSum' ? 'block' : 'none';
            });

            modal.querySelector('#editAddPrize').addEventListener('click', () => {
                const container = modal.querySelector('#editPrizesContainer');
                const div = document.createElement('div');
                div.className = 'array-item prize-item';
                div.innerHTML = `
                    <input type="text" placeholder="Приз для ${container.querySelectorAll('.prize-item').length + 1} места" required>
                    <button type="button" class="remove-prize">Удалить</button>
                `;
                container.insertBefore(div, container.querySelector('.add-button'));
            });

            modal.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-prize')) {
                    if (e.target.parentElement.parentElement.querySelectorAll('.prize-item').length > 1) {
                        e.target.parentElement.remove();
                    }
                }
            });

            modal.querySelector('#save-raffle-btn').addEventListener('click', () => {
                const editFormError = modal.querySelector('#editFormError');
                editFormError.style.display = 'none';

                const startDate = modal.querySelector('#editStartDate').value;
                const endDate = modal.querySelector('#editEndDate').value;
                const conditionType = editConditionTypeSelect.value;
                const dealCount = modal.querySelector('#editDealCount').value;
                const dealSum = modal.querySelector('#editDealSum').value;
                const prizes = Array.from(modal.querySelectorAll('#editPrizesContainer input')).map(input => input.value);

                if (!startDate || !endDate) {
                    editFormError.textContent = 'Укажите даты и время начала и окончания';
                    editFormError.style.display = 'block';
                    return;
                }

                if (!conditionType) {
                    editFormError.textContent = 'Выберите условие';
                    editFormError.style.display = 'block';
                    return;
                }

                if (conditionType === 'dealCount' && !dealCount) {
                    editFormError.textContent = 'Укажите количество сделок';
                    editFormError.style.display = 'block';
                    return;
                }

                if (conditionType === 'dealSum' && !dealSum) {
                    editFormError.textContent = 'Укажите сумму сделок';
                    editFormError.style.display = 'block';
                    return;
                }

                const raffleData = {
                    startDate: new Date(startDate).toISOString(),
                    endDate: new Date(endDate).toISOString(),
                    conditionType,
                    dealCount: conditionType === 'dealCount' ? parseInt(dealCount) : null,
                    dealSum: conditionType === 'dealSum' ? parseFloat(dealSum) : null,
                    prizes
                };

                api.put(`/raffles/${raffle.id}`, raffleData).then(() => {
                    modal.remove();
                    loadRaffles();
                }).catch(err => {
                    if (err.response?.status === 401 || err.response?.status === 403) {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    } else {
                        console.error('Error updating raffle:', err);
                        editFormError.textContent = 'Ошибка при обновлении розыгрыша';
                        editFormError.style.display = 'block';
                    }
                });
            });

            modal.querySelector('#cancel-raffle-btn').addEventListener('click', () => {
                modal.remove();
            });
        }

        searchInput.addEventListener('input', () => {
            page = 1;
            loadRaffles();
        });

        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 25;
            page = 1;
            renderRafflesTable();
        });

        prevBtn.onclick = () => {
            if (page > 1) {
                page--;
                renderRafflesTable();
            }
        };

        nextBtn.onclick = () => {
            if (page < Math.ceil(filterRaffles().length / perPage)) {
                page++;
                renderRafflesTable();
            }
        };

        tabContainer.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => {
                tabContainer.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showCompleted = button.dataset.status === 'completed';
                page = 1;
                loadRaffles();
            });
        });

        function filterRaffles() {
            return raffles.filter(r => r.status === (showCompleted ? 'completed' : 'pending'));
        }

        function renderRafflesTable() {
            const list = filterRaffles();
            const total = list.length;
            const start = (page - 1) * perPage;
            const slice = list.slice(start, start + perPage);

            tbody.innerHTML = '';
            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="5">На данный момент информация отсутствует</td></tr>';
                return;
            }

            slice.forEach(r => {
                const tr = document.createElement('tr');
                const isCompleted = r.status === 'completed';
                const conditionText = r.condition.type === 'dealCount' ? `Количество сделок: ${r.condition.value || '-'}` :
                    `Сумма сделок: ${r.condition.value || '-'} RUB`;
                tr.innerHTML = `
                    <td>${r.id}</td>
                    <td>${formatDateTime(r.startDate)} - ${formatDateTime(r.endDate)}</td>
                    <td>${conditionText}</td>
                    <td>${r.prizes.map((p, i) => `${i + 1}) ${p}`).join('<br>')}</td>
                    <td>
                        ${isCompleted
                    ? `<button class="complete-raffle" data-id="${r.id}" disabled>Завершено</button>`
                    : `
                                <button class="edit-raffle" data-id="${r.id}">Редактировать</button>
                                <button class="delete-raffle" data-id="${r.id}">Удалить</button>
                            `}
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= Math.ceil(total / perPage);

            document.querySelectorAll('.edit-raffle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const raffle = raffles.find(r => r.id === btn.dataset.id);
                    if (raffle) {
                        openEditModal(raffle);
                    }
                });
            });

            document.querySelectorAll('.delete-raffle').forEach(btn => {
                btn.addEventListener('click', () => {
                    api.delete(`/raffles/${btn.dataset.id}`).then(() => {
                        raffles = raffles.filter(r => r.id !== btn.dataset.id);
                        renderRafflesTable();
                    }).catch(err => {
                        console.error('Error deleting raffle:', err);
                        if (err.response?.status === 401 || err.response?.status === 403) {
                            localStorage.removeItem('token');
                            window.location.href = '/login';
                        }
                    });
                });
            });
        }

        document.getElementById('addPrize').addEventListener('click', () => {
            const container = document.getElementById('prizesContainer');
            const div = document.createElement('div');
            div.className = 'array-item prize-item';
            div.innerHTML = `
                <input type="text" placeholder="Приз для ${container.querySelectorAll('.prize-item').length + 1} места" required>
                <button type="button" class="remove-prize">Удалить</button>
            `;
            container.insertBefore(div, container.querySelector('.add-button'));
        });

        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-prize')) {
                if (e.target.parentElement.parentElement.querySelectorAll('.prize-item').length > 1) {
                    e.target.parentElement.remove();
                }
            }
        });

        form.addEventListener('submit', e => {
            e.preventDefault();
            formError.style.display = 'none';

            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            const conditionType = conditionTypeSelect.value;
            const dealCount = document.getElementById('dealCount').value;
            const dealSum = document.getElementById('dealSum').value;
            const prizes = Array.from(document.querySelectorAll('#prizesContainer input')).map(input => input.value);

            if (!startDate || !endDate) {
                formError.textContent = 'Укажите даты и время начала и окончания';
                formError.style.display = 'block';
                return;
            }

            if (!conditionType) {
                formError.textContent = 'Выберите условие';
                formError.style.display = 'block';
                return;
            }

            if (conditionType === 'dealCount' && !dealCount) {
                formError.textContent = 'Укажите количество сделок';
                formError.style.display = 'block';
                return;
            }

            if (conditionType === 'dealSum' && !dealSum) {
                formError.textContent = 'Укажите сумму сделок';
                formError.style.display = 'block';
                return;
            }

            const raffleData = {
                startDate: new Date(startDate).toISOString(),
                endDate: new Date(endDate).toISOString(),
                conditionType,
                dealCount: conditionType === 'dealCount' ? parseInt(dealCount) : null,
                dealSum: conditionType === 'dealSum' ? parseFloat(dealSum) : null,
                prizes
            };

            api.post('/raffles', raffleData).then(() => {
                form.reset();
                conditionTypeSelect.value = '';
                updateConditionFields();
                loadRaffles();
            }).catch(err => {
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    console.error('Error creating raffle:', err);
                    formError.textContent = 'Ошибка при создании розыгрыша';
                    formError.style.display = 'block';
                }
            });
        });

        updateConditionFields();
        loadRaffles();
    });
}

initializeRaffles();