const API_BASE_URL =
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
    window.location.port &&
    window.location.port !== '5000'
        ? 'http://127.0.0.1:5000'
        : '';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('appPassword');
    const eyeIcon = document.getElementById('eyeIcon');
    const authAlert = document.getElementById('authAlert');

    // Pre-fill email if opened from Welcome Email link (?email=...)
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = (urlParams.get('email') || '').trim();
    const emailInputEl = document.getElementById('email');
    if (emailParam && emailInputEl && !emailInputEl.value) {
        emailInputEl.value = emailParam;
    }

    function showAlert(type, message) {
        if (!authAlert) return;
        authAlert.className = `auth-alert ${type}`;
        authAlert.textContent = message;
        authAlert.style.display = 'block';
    }

    // Password show/hide toggle
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            eyeIcon.innerHTML = isPassword
                ? '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" x2="22" y1="2" y2="22"></line>'
                : '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>';
        });
    }

    // App Password Help Modal Logic
    const openHelpBtn = document.getElementById('openHelpModal');
    const closeHelpBtn = document.getElementById('closeHelpModal');
    const dismissHelpBtn = document.getElementById('dismissHelpModal');
    const helpModal = document.getElementById('helpModal');
    const tabZoho = document.querySelector('.help-tab[data-tab="zoho"]');
    const tabGmail = document.querySelector('.help-tab[data-tab="gmail"]');
    const contentZoho = document.getElementById('tabContentZoho');
    const contentGmail = document.getElementById('tabContentGmail');

    function showModal() {
        if (!helpModal) return;
        helpModal.style.display = 'flex';
        helpModal.setAttribute('aria-hidden', 'false');
    }

    function hideModal() {
        if (!helpModal) return;
        helpModal.style.display = 'none';
        helpModal.setAttribute('aria-hidden', 'true');
    }

    if (openHelpBtn) openHelpBtn.addEventListener('click', showModal);
    if (closeHelpBtn) closeHelpBtn.addEventListener('click', hideModal);
    if (dismissHelpBtn) dismissHelpBtn.addEventListener('click', hideModal);

    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) hideModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && helpModal && helpModal.style.display === 'flex') {
            hideModal();
        }
    });

    if (tabZoho && tabGmail && contentZoho && contentGmail) {
        tabZoho.addEventListener('click', () => {
            tabZoho.classList.add('active');
            tabGmail.classList.remove('active');
            contentZoho.style.display = 'block';
            contentGmail.style.display = 'none';
        });

        tabGmail.addEventListener('click', () => {
            tabGmail.classList.add('active');
            tabZoho.classList.remove('active');
            contentGmail.style.display = 'block';
            contentZoho.style.display = 'none';
        });
    }

    // Form submit -> Connect to Python Backend
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const appPassword = passwordInput.value.trim();
            const btn = loginForm.querySelector('.submit-btn');
            const originalBtnHTML = btn.innerHTML;

            if (!email || !appPassword) {
                showAlert('error', 'Please enter both your Work Email and 16-digit App Password.');
                return;
            }

            if (authAlert) authAlert.style.display = 'none';
            btn.innerHTML = '<span>Connecting &amp; Verifying Credentials...</span>';
            btn.style.opacity = '0.85';
            btn.disabled = true;

            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: email,
                        app_password: appPassword
                    })
                });

                const data = await response.json();

                if (!response.ok || data.status !== 'success') {
                    showAlert('error', data.message || 'Authentication failed. Please check your App Password.');
                    btn.innerHTML = originalBtnHTML;
                    btn.style.opacity = '1';
                    btn.disabled = false;
                    return;
                }

                // Normalize SUPER_ADMIN -> ADMIN so only ADMIN exists across the app
                if (data.user && String(data.user.role || '').toUpperCase() === 'SUPER_ADMIN') {
                    data.user.role = 'ADMIN';
                }

                // Store ONLY the safe session token & user metadata for this browser
                sessionStorage.setItem('hrflow_token', data.token);
                sessionStorage.setItem('hrflow_user', JSON.stringify(data.user));
                localStorage.setItem('hrflow_last_token', data.token);
                localStorage.setItem('hrflow_last_user', JSON.stringify(data.user));

                const isAgentRole = String(data.user?.role || '').toUpperCase() === 'HR_AGENT';
                const targetPage = isAgentRole ? 'agent.html#agent-workbench' : 'inbox.html';
                const targetLabel = isAgentRole ? 'HR Specialist Portal' : 'Admin Command Portal';

                showAlert(
                    'success',
                    `Authenticated as ${data.user?.name || email} (${data.user?.role || 'HR'})! Opening ${targetLabel}...`
                );

                setTimeout(() => {
                    window.location.href = targetPage;
                }, 600);
            } catch (err) {
                showAlert(
                    'error',
                    'Cannot reach HR Flow Backend Server. Please check your connection.'
                );
                btn.innerHTML = originalBtnHTML;
                btn.style.opacity = '1';
                btn.disabled = false;
            }
        });
    }
});
