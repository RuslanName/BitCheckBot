import { api, formatDateTime } from './index.js';

function initializeBroadcasts() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'broadcasts') return;

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

export { initializeBroadcasts };