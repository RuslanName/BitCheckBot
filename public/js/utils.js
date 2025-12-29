const api = axios.create({
    baseURL: "/api"
});

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

function formatDateTime(isoDate, nullValue = '-') {
    if (!isoDate) return nullValue;
    const utcDate = new Date(isoDate);
    const mskOffset = 3 * 60 * 60 * 1000;
    const mskDate = new Date(utcDate.getTime() + mskOffset);
    return mskDate.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow'
    }).replace(',', '');
}

function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const numStr = parseFloat(num).toFixed(decimals);
    const parts = numStr.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '<span class="number-separator"> </span>');
    return parts.join('.');
}

function checkAuth(callback) {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    const token = localStorage.getItem('token');
    let userRole;
    let userCurrency;

    if (token) {
        api.get('/user')
            .then(response => {
                userRole = response.data.role || 'admin';
                document.body.classList.remove('hidden');
                userCurrency = response.data.currency;
                callback(userRole, userCurrency);
            })
            .catch(err => {
                console.error('Error retrieving user data:', err);
                localStorage.removeItem('token');
                window.location.href = '/login';
            });
    } else if (curr !== 'login') {
        window.location.href = '/login';
    }

    return { userRole, userCurrency };
}

export { api, formatDateTime, formatNumber, checkAuth };