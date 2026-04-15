import { api, formatDateTime, checkAuth } from './utils.js';
import { initializeSidebar, checkAccess } from './sidebar.js';

let broadcasts = [];
let currentPage = 1;
let perPage = 25;
let paginationInfo = { total: 0, totalPages: 0, page: 1, perPage: 25 };
let userCount = 0;
let autoRefreshInterval = null;
let progressModalInterval = null;
let editImageRemoved = false;

async function loadProgress(broadcastId) {
    try {
        const response = await api.get(`/broadcasts/${broadcastId}/progress`);
        return response.data;
    } catch (err) {
        console.error('Error loading progress:', err);
        return null;
    }
}

async function loadAllBroadcastProgress() {
    const sendingBroadcasts = broadcasts.filter(b => b.status === 'sending');
    for (const broadcast of sendingBroadcasts) {
        const progress = await loadProgress(broadcast.id);
        if (progress) {
            broadcast.sentCount = progress.sentCount;
            broadcast.failedCount = progress.failedCount;
            broadcast.totalUsers = progress.totalUsers;
        }
    }
    refreshBroadcasts(false);
}

function refreshBroadcasts(showLoading = false) {
    const tbody = document.querySelector('#broadcastsTable tbody');
    const search = document.getElementById('searchId')?.value.trim() || '';
    const activeTabBtn = document.querySelector('.tab-button.active');
    const status = activeTabBtn ? activeTabBtn.dataset.status : '';

    if (showLoading) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">
            <div class="loading-spinner"></div>
            <span>Загрузка...</span>
        </td></tr>`;
    }

    const params = { page: currentPage, perPage, search };
    if (status) params.status = status;

    api.get('/broadcasts', { params })
        .then(r => {
            const response = r.data;
            broadcasts = response.data || [];
            paginationInfo = response.pagination || { total: 0, totalPages: 0, page: 1, perPage: 25 };
            renderBroadcastsTable();
        })
        .catch(err => {
            console.error('Error refreshing broadcasts:', err);
            if (showLoading && (err.response?.status === 401 || err.response?.status === 403)) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            } else if (showLoading) {
                tbody.innerHTML = `<tr><td colspan="6" class="error-cell">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span>Ошибка загрузки данных</span>
                </td></tr>`;
            }
        });
}

function loadBroadcasts() {
    refreshBroadcasts(true);
}

function openProgressModal(broadcastId) {
    const modal = document.getElementById('progressModal');
    const broadcast = broadcasts.find(b => b.id === broadcastId);
    if (!modal || !broadcast) return;

    document.getElementById('progressBroadcastId').textContent = broadcast.id;
    document.getElementById('progressStatus').textContent = getStatusText(broadcast.status);
    document.getElementById('progressStatus').className = `status-badge ${getStatusClass(broadcast.status)}`;

    updateProgressDisplay(broadcast);

    modal.classList.add('active');

    if (progressModalInterval) {
        clearInterval(progressModalInterval);
    }

    progressModalInterval = setInterval(async () => {
        const progress = await loadProgress(broadcastId);
        if (progress) {
            broadcast.sentCount = progress.sentCount;
            broadcast.failedCount = progress.failedCount;
            broadcast.totalUsers = progress.totalUsers;
            updateProgressDisplay(broadcast);
            refreshBroadcasts(false);
        }

        if (progress.status !== 'sending') {
            clearInterval(progressModalInterval);
            progressModalInterval = null;
        }
    }, 2000);
}

function updateProgressDisplay(broadcast) {
    const sentCount = broadcast.sentCount || 0;
    const failedCount = broadcast.failedCount || 0;
    const totalUsers = broadcast.totalUsers || 0;
    const completed = sentCount + failedCount;
    const progress = totalUsers ? Math.min(100, Math.round(completed / totalUsers * 100)) : 0;

    document.getElementById('progressTotal').textContent = totalUsers.toLocaleString('ru-RU');
    document.getElementById('progressSent').textContent = sentCount.toLocaleString('ru-RU');
    document.getElementById('progressFailed').textContent = failedCount.toLocaleString('ru-RU');
    document.getElementById('progressPercent').textContent = progress + '%';

    const progressFill = document.getElementById('progressFill');
    const progressBar = document.getElementById('progressBar');
    if (progressFill) {
        progressFill.style.width = progress + '%';
    }
    if (progressBar) {
        if (progress >= 100) {
            progressBar.classList.add('complete');
        } else {
            progressBar.classList.remove('complete');
        }
    }
}

function closeProgressModal() {
    const modal = document.getElementById('progressModal');
    if (modal) {
        modal.classList.remove('active');
    }
    if (progressModalInterval) {
        clearInterval(progressModalInterval);
        progressModalInterval = null;
    }
}

function initializeBroadcasts() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (curr !== 'broadcasts') return;

    checkAuth((userRole) => {
        initializeSidebar(userRole);
        if (!checkAccess(userRole)) return;

        initEventListeners();
        loadBroadcasts();
        startAutoRefresh();
    });
}

function initEventListeners() {
    const searchInput = document.getElementById('searchId');
    const tabButtons = document.querySelectorAll('.tab-button');
    const perPageSelect = document.getElementById('perPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const imageInput = document.getElementById('image');
    const imageDropZone = document.getElementById('imageDropZone');
    const removeImageOverlay = document.getElementById('removeImageOverlay');
    const editModal = document.getElementById('editModal');

    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentPage = 1;
                loadBroadcasts();
            }, 300);
        });
    }

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPage = 1;
            loadBroadcasts();
        });
    });

    if (perPageSelect) {
        perPageSelect.addEventListener('change', (e) => {
            perPage = parseInt(e.target.value) || 25;
            currentPage = 1;
            loadBroadcasts();
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadBroadcasts();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentPage < paginationInfo.totalPages) {
                currentPage++;
                loadBroadcasts();
            }
        });
    }

    if (imageInput) {
        imageInput.addEventListener('change', handleImageSelect);
    }

    if (imageDropZone) {
        imageDropZone.addEventListener('click', (e) => {
            if (!e.target.closest('.image-remove-overlay')) {
                imageInput?.click();
            }
        });
        imageDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            imageDropZone.classList.add('dragover');
        });
        imageDropZone.addEventListener('dragleave', () => {
            imageDropZone.classList.remove('dragover');
        });
        imageDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            imageDropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('image/')) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    imageInput.files = dt.files;
                    handleImageSelect({ target: imageInput });
                }
            }
        });
    }

    if (removeImageOverlay) {
        removeImageOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            resetImagePreview();
        });
    }

    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                editModal.classList.remove('active');
            }
        });
    }

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetModalId = btn.dataset.closeTarget;
            if (targetModalId === 'progressModal') {
                closeProgressModal();
                return;
            }

            const targetModal = document.getElementById(targetModalId);
            if (targetModal) {
                targetModal.classList.remove('active');
            }

        });
    });

    const cancelEditBtn = document.getElementById('cancel-broadcast-btn');
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => {
            editModal?.classList.remove('active');
        });
    }

    const progressModal = document.getElementById('progressModal');
    if (progressModal) {
        progressModal.addEventListener('click', (e) => {
            if (e.target === progressModal) {
                closeProgressModal();
            }
        });
    }

    const editForm = document.getElementById('editForm');
    const saveEditBtn = document.getElementById('save-broadcast-btn');
    if (editForm) {
        editForm.addEventListener('submit', (e) => e.preventDefault());
    }
    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', handleEditSubmit);
    }

    const editImageInput = document.getElementById('editImage');
    const editImageDropZone = document.getElementById('editImageDropZone');
    const editRemoveOverlay = document.querySelector('#editImagePreviewContainer .image-remove-overlay');

    if (editImageInput && editImageDropZone) {
        editImageDropZone.addEventListener('click', (e) => {
            if (!e.target.closest('.image-remove-overlay')) {
                editImageInput.click();
            }
        });
        editImageInput.addEventListener('change', handleEditImageSelect);
    }

    if (editRemoveOverlay) {
        editRemoveOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            resetEditImagePreview(true);
        });
    }
}

function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('Размер файла превышает 5 МБ');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('imagePreview').src = e.target.result;
        document.getElementById('uploadPlaceholder').style.display = 'none';
        document.getElementById('imagePreviewContainer').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function resetImagePreview() {
    const imageInput = document.getElementById('image');
    if (imageInput) imageInput.value = '';
    document.getElementById('uploadPlaceholder').style.display = 'flex';
    document.getElementById('imagePreviewContainer').style.display = 'none';
    document.getElementById('imagePreview').src = '';
}

function handleEditImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('Размер файла превышает 5 МБ');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        editImageRemoved = false;
        document.getElementById('editImagePreview').src = e.target.result;
        document.getElementById('editUploadPlaceholder').style.display = 'none';
        document.getElementById('editImagePreviewContainer').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function resetEditImagePreview(markAsRemoved = false) {
    const editImageInput = document.getElementById('editImage');
    if (editImageInput) editImageInput.value = '';
    document.getElementById('editUploadPlaceholder').style.display = 'flex';
    document.getElementById('editImagePreviewContainer').style.display = 'none';
    document.getElementById('editImagePreview').src = '';
    editImageRemoved = markAsRemoved;
}


function renderBroadcastsTable() {
    const tbody = document.querySelector('#broadcastsTable tbody');
    const total = paginationInfo.total || broadcasts.length;

    tbody.innerHTML = '';

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: #999;">На данный момент информация отсутствует</td></tr>`;
        updatePaginationUI(0);
        return;
    }

    broadcasts.forEach(b => {
        const tr = document.createElement('tr');
        tr.dataset.id = b.id;

        const statusClass = getStatusClass(b.status);
        const statusText = getStatusText(b.status);
        const imageCellHtml = b.imageName
            ? `<a href="/images/broadcasts/${b.imageName}" target="_blank" rel="noopener noreferrer" class="broadcast-image-link">
                    <img src="/images/broadcasts/${b.imageName}" alt="Изображение рассылки" class="broadcast-image-thumb">
               </a>`
            : '<span class="no-image">-</span>';

        tr.innerHTML = `
            <td><span class="id-badge">${b.id}</span></td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="text-cell">
                <div class="text-preview" title="${b.text || ''}">${b.text || '-'}</div>
            </td>
            <td class="image-cell">${imageCellHtml}</td>
            <td class="time-cell">${formatDateTime(b.scheduledTime) || '-'}</td>
            <td class="actions-cell">
                <button class="action-btn progress" data-id="${b.id}" title="Прогресс" ${b.status !== 'sending' ? 'style="display:none"' : ''}>Прогресс</button>
                <button class="action-btn edit" data-id="${b.id}" title="Редактировать">Редактировать</button>
                <button class="action-btn delete" data-id="${b.id}" title="Удалить">Удалить</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updatePaginationUI(total);

    document.querySelectorAll('.action-btn.progress').forEach(btn => {
        btn.addEventListener('click', () => {
            openProgressModal(btn.dataset.id);
        });
    });

    document.querySelectorAll('.action-btn.edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const broadcast = broadcasts.find(item => item.id === btn.dataset.id);
            if (broadcast) openEditModal(broadcast);
        });
    });

    document.querySelectorAll('.action-btn.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const broadcastId = btn.dataset.id;
            try {
                await api.delete(`/broadcasts/${broadcastId}`);
                refreshBroadcasts(true);
            } catch (err) {
                console.error('Error deleting broadcast:', err);
                if (err.response?.status === 401 || err.response?.status === 403) {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                } else {
                    alert(err.response?.data?.error || 'Ошибка при удалении рассылки');
                }
            }
        });
    });
}

function getStatusClass(status) {
    switch (status) {
        case 'sending': return 'sending';
        case 'sent': return 'sent';
        case 'pending': return 'pending';
        default: return 'pending';
    }
}

function getStatusText(status) {
    switch (status) {
        case 'sending': return 'Отправляется';
        case 'sent': return 'Отправлено';
        case 'pending': return 'Ожидает';
        default: return 'Ожидает';
    }
}

function updatePaginationUI(total) {
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');

    const page = paginationInfo.page || currentPage;
    const totalPages = paginationInfo.totalPages || Math.ceil(total / perPage) || 1;

    if (pageInfo) {
        pageInfo.textContent = `Страница ${page} из ${totalPages}`;
    }

    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
}

function openEditModal(broadcast) {
    const modal = document.getElementById('editModal');
    if (!modal) return;

    let scheduledTime = '';
    if (broadcast.scheduledTime) {
        const utcDate = new Date(broadcast.scheduledTime);
        const mskOffset = 3 * 60 * 60 * 1000;
        const mskTime = new Date(utcDate.getTime() + mskOffset);
        const year = mskTime.getUTCFullYear();
        const month = String(mskTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(mskTime.getUTCDate()).padStart(2, '0');
        const hours = String(mskTime.getUTCHours()).padStart(2, '0');
        const minutes = String(mskTime.getUTCMinutes()).padStart(2, '0');
        scheduledTime = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    document.getElementById('editContent').value = broadcast.text || '';
    document.getElementById('editScheduledTime').value = scheduledTime;
    document.getElementById('editIsDaily').checked = broadcast.isDaily || false;

    editImageRemoved = false;
    resetEditImagePreview(false);

    if (broadcast.imageName) {
        document.getElementById('editUploadPlaceholder').style.display = 'none';
        document.getElementById('editImagePreviewContainer').style.display = 'block';
        document.getElementById('editImagePreview').src = `/images/broadcasts/${broadcast.imageName}`;
    }

    modal.dataset.broadcastId = broadcast.id;
    modal.classList.add('active');
}

async function handleEditSubmit(e) {
    e.preventDefault();
    const modal = document.getElementById('editModal');
    const broadcastId = modal.dataset.broadcastId;

    let editFormError = modal.querySelector('.error-message');
    if (!editFormError) {
        editFormError = document.createElement('div');
        editFormError.className = 'error-message';
        const lastFormGroup = modal.querySelector('#editForm > .form-group:last-child');
        if (lastFormGroup) {
            lastFormGroup.after(editFormError);
        } else {
            modal.querySelector('.modal-dialog').prepend(editFormError);
        }
    }
    editFormError.style.display = 'none';

    const content = document.getElementById('editContent').value;
    const scheduledTimeInput = document.getElementById('editScheduledTime').value;
    const isDaily = document.getElementById('editIsDaily').checked;
    const imageInput = document.getElementById('editImage');

    if (!content) {
        editFormError.textContent = 'Текст рассылки обязателен';
        editFormError.style.display = 'block';
        return;
    }

    const formData = new FormData();
    formData.append('content', content);
    if (scheduledTimeInput) {
        const [datePart, timePart] = scheduledTimeInput.split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hours, minutes] = timePart.split(':').map(Number);
        const mskOffset = 3 * 60 * 60 * 1000;
        const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes) - mskOffset);
        formData.append('scheduledTime', utcDate.toISOString());
    } else {
        formData.append('scheduledTime', '');
    }
    formData.append('isDaily', isDaily.toString());
    formData.append('removeImage', editImageRemoved.toString());
    if (imageInput.files[0]) {
        formData.append('image', imageInput.files[0]);
    }

    try {
        await api.put(`/broadcasts/${broadcastId}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        modal.classList.remove('active');
        loadBroadcasts();
    } catch (err) {
        console.error('Error updating broadcast:', err);
        const errorMsg = err.response?.data?.error || 'Ошибка при обновлении рассылки';
        editFormError.textContent = errorMsg;
        editFormError.style.display = 'block';
    }
}

function startAutoRefresh() {
    autoRefreshInterval = setInterval(() => {
        refreshBroadcasts(false);
        loadAllBroadcastProgress();
    }, 3000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

const form = document.getElementById('form');
if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formError = document.getElementById('formError');
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
            const [datePart, timePart] = scheduledTimeInput.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const [hours, minutes] = timePart.split(':').map(Number);
            const mskOffset = 3 * 60 * 60 * 1000;
            const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes) - mskOffset);
            formData.append('scheduledTime', utcDate.toISOString());
        } else {
            formData.append('scheduledTime', '');
        }
        formData.append('isDaily', isDaily);
        if (imageInput.files[0]) {
            formData.append('image', imageInput.files[0]);
        }

        try {
            await api.post('/broadcasts', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            form.reset();
            resetImagePreview();
            loadBroadcasts();
        } catch (err) {
            if (err.response?.status === 401 || err.response?.status === 403) {
                localStorage.removeItem('token');
                window.location.href = '/login';
            } else {
                console.error('Error creating broadcast:', err);
                const errorMsg = err.response?.data?.error || 'Ошибка при создании рассылки';
                formError.textContent = errorMsg;
                formError.style.display = 'block';
            }
        }
    });
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        startAutoRefresh();
        loadBroadcasts();
    }
});

initializeBroadcasts();
