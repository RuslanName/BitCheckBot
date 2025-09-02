const api = axios.create({
    baseURL: "/api"
});

function handleLogin() {
    const curr = window.location.pathname.replace(/\/$/, '').slice(1) || 'config';
    const loginForm = document.getElementById('loginForm');

    if (curr === 'login' && loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const login = document.getElementById('login').value;
            const password = document.getElementById('password').value;
            const errorElement = document.getElementById('formError') || document.getElementById('loginError');

            try {
                const response = await api.post('/login', { login, password });
                const { role, token } = response.data;
                localStorage.setItem('token', token);
                if (role === 'mainAdmin') {
                    window.location.href = '/';
                } else if (role === 'admin') {
                    window.location.href = '/deals';
                } else {
                    window.location.href = '/';
                }
            } catch (err) {
                console.error('Error during login:', err);
                if (errorElement) {
                    errorElement.textContent = err.response?.data?.error || 'Ошибка входа';
                    errorElement.style.display = 'block';
                }
            }
        });
    }
}

export { handleLogin };