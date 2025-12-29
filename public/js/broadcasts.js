import { api, formatDateTime, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

function initializeBroadcasts() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'broadcasts') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

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

        function openEditModal(broadcast) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            let scheduledTime = '';
            if (broadcast.scheduledTime) {
                const utcDate = new Date(broadcast.scheduledTime);
                const mskOffset = 3 * 60 * 60 * 1000;
                const mskDate = new Date(utcDate.getTime() + mskOffset);
                scheduledTime = mskDate.toISOString().slice(0, 16);
            }
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Редактировать рассылку</h3>
                    <div class="form-group">
                        <label for="editContent">Текст рассылки:</label>
                        <textarea id="editContent" required>${broadcast.text}</textarea>
                    </div>
                    <div class="form-group">
                        <label for="editImage">Фото:</label>
                        <input type="file" id="editImage" accept="image/*">
                        <p>Текущее: ${broadcast.imageName || 'Нет'}</p>
                    </div>
                    <div class="form-group">
                        <label for="editScheduledTime">Запланированное время:</label>
                        <input type="datetime-local" id="editScheduledTime" value="${scheduledTime}">
                    </div>
                    <div class="form-group">
                        <div class="toggle-container">
                            <label class="switch">
                                <input type="checkbox" id="editIsDaily" ${broadcast.isDaily ? 'checked' : ''} />
                                <span class="slider round"></span>
                            </label>
                            <span class="toggle-label">Ежедневная рассылка</span>
                        </div>
                    </div>
                    <div class="modal-buttons">
                        <button id="cancel-broadcast-btn">Отменить</button>
                        <button id="save-broadcast-btn">Сохранить</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#cancel-broadcast-btn').onclick = () => modal.remove();

            modal.querySelector('#save-broadcast-btn').onclick = async () => {
                const content = modal.querySelector('#editContent').value;
                const scheduledTimeInput = modal.querySelector('#editScheduledTime').value;
                const isDaily = modal.querySelector('#editIsDaily').checked;
                const imageInput = modal.querySelector('#editImage');

                if (!content) {
                    return;
                }

                const formData = new FormData();
                formData.append('content', content);
                if (scheduledTimeInput) {
                    const mskDate = new Date(scheduledTimeInput);
                    const mskOffset = 3 * 60 * 60 * 1000;
                    const utcDate = new Date(mskDate.getTime() - mskOffset);
                    formData.append('scheduledTime', utcDate.toISOString());
                } else {
                    formData.append('scheduledTime', '');
                }
                formData.append('isDaily', isDaily.toString());
                if (imageInput.files[0]) {
                    formData.append('image', imageInput.files[0]);
                }

                try {
                    await api.put(`/broadcasts/${broadcast.id}`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    modal.remove();
                    loadBroadcasts();
                } catch (err) {
                    console.error('Error updating broadcast:', err);
                }
            };
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
                    <td>
                        <button class="edit-broadcast" data-id="${b.id}">Редактировать</button>
                        <button class="delete-with-broadcasts" data-id="${b.id}">Удалить</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            pageInfo.textContent = `Страница ${page} из ${Math.ceil(total / perPage) || 1}`;
            prevBtn.disabled = page === 1;
            nextBtn.disabled = page >= Math.ceil(total / perPage);

            document.querySelectorAll('.edit-broadcast').forEach(b => {
                b.onclick = () => {
                    const broadcast = broadcasts.find(item => item.id === b.dataset.id);
                    if (broadcast) {
                        openEditModal(broadcast);
                    }
                };
            });

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

                if (!content) {
                    formError.textContent = 'Текст рассылки обязателен';
                    formError.style.display = 'block';
                    return;
                }

                const formData = new FormData();
                formData.append('content', content);
                if (scheduledTimeInput) {
                    const mskDate = new Date(scheduledTimeInput);
                    const mskOffset = 3 * 60 * 60 * 1000;
                    const utcDate = new Date(mskDate.getTime() - mskOffset);
                    formData.append('scheduledTime', utcDate.toISOString());
                } else {
                    formData.append('scheduledTime', '');
                }
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
    });
}

initializeBroadcasts();