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

function handleLogin() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    const loginForm = document.getElementById('loginForm');

    if (curr === 'login' && loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const login = document.getElementById('login').value;
            const password = document.getElementById('password').value;
            try {
                const response = await api.post('/login', { login, password });
                const { role } = response.data;
                localStorage.setItem('token', response.data.token);
                if (role === 'mainAdmin') {
                    window.location.href = '/';
                } else if (role === 'admin') {
                    window.location.href = '/deals';
                }
            } catch (err) {
                console.error('Error during login:', err);
                const errorElement = document.getElementById('loginError');
                if (errorElement) {
                    errorElement.textContent = err.response?.data?.error || 'Ошибка входа';
                    errorElement.style.display = 'block';
                }
            }
        });
    }
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
                userCurrency = response.data.currency;
                callback(userRole, userCurrency);
            })
            .catch(err => {
                console.error('Ошибка получения данных пользователя:', err);
                localStorage.removeItem('token');
                window.location.href = '/login';
            });
    } else if (curr !== 'login') {
        window.location.href = '/login';
    }

    return { userRole, userCurrency };
}

export { handleLogin, checkAuth, api };