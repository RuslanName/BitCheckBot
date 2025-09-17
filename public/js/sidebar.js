const links = [
    { href: '/', page: 'config', label: 'Настройки', roles: ['mainAdmin'] },
    { href: '/users', page: 'users', label: 'Пользователи', roles: ['mainAdmin'] },
    { href: '/deals', page: 'deals', label: 'Сделки', roles: ['mainAdmin', 'admin'] },
    { href: '/withdrawals', page: 'withdrawals', label: 'Вывод рефералов', roles: ['mainAdmin'] },
    { href: '/raffles', page: 'raffles', label: 'Розыгрыши', roles: ['mainAdmin'] },
    { href: '/broadcasts', page: 'broadcasts', label: 'Рассылка', roles: ['mainAdmin'] },
    { href: '/analytics', page: 'analytics', label: 'Аналитика', roles: ['mainAdmin'] }
];

function initializeSidebar(userRole) {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        const sidebarLinks = sidebar.querySelectorAll('a:not(#logoutBtn)');
        sidebarLinks.forEach(a => {
            const link = links.find(l => l.href === a.getAttribute('href'));
            if (link) {
                if (!link.roles.includes(userRole)) {
                    a.remove();
                } else if (link.page === curr) {
                    a.classList.add('active');
                }
            }
        });
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