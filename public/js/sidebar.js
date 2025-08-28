import { api } from './auth.js';

const links = [
    { href: '/', page: 'config', label: 'Настройки', roles: ['mainAdmin'] },
    { href: '/users', page: 'users', label: 'Пользователи', roles: ['mainAdmin'] },
    { href: '/deals', page: 'deals', label: 'Сделки', roles: ['mainAdmin', 'admin'] },
    { href: '/withdrawals', page: 'withdrawals', label: 'Вывод рефералов', roles: ['mainAdmin'] },
    { href: '/broadcasts', page: 'broadcasts', label: 'Рассылка', roles: ['mainAdmin'] },
    { href: '/analytics', page: 'analytics', label: 'Аналитика', roles: ['mainAdmin'] }
];

function initializeSidebar(userRole) {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.innerHTML = '';
        links.forEach(l => {
            if (l.roles.includes(userRole)) {
                const a = document.createElement('a');
                a.href = l.href;
                a.textContent = l.label;
                if (l.page === curr) a.classList.add('active');
                sidebar.appendChild(a);
            }
        });
        const logoutLink = document.createElement('a');
        logoutLink.href = '#';
        logoutLink.id = 'logoutBtn';
        logoutLink.textContent = 'Выйти';
        sidebar.appendChild(logoutLink);
        const logoutBtn = sidebar.querySelector('#logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('token');
                window.location.href = '/login';
            });
        }
    }
}

function checkAccess(userRole) {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    if (!localStorage.getItem('token') && curr !== 'login') {
        window.location.href = '/login';
        return false;
    }
    const currentLink = links.find(l => l.page === curr);
    if (currentLink && !currentLink.roles.includes(userRole)) {
        window.location.href = '/login';
        return false;
    }
    return true;
}

export { initializeSidebar, checkAccess };