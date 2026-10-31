function resolveBackendApiBase() {
    if (window.location.protocol === "file:") {
        return "http://127.0.0.1:5000";
    }
    const host = window.location.hostname || "127.0.0.1";
    const port = window.location.port || "";
    if (port && port !== "5000") {
        return `http://${host}:5000`;
    }
    return "";
}

var BACKEND_API_BASE = resolveBackendApiBase();

// Ensure fetch uses HR headers and cookies like inbox.js
(function() {
    if (window._hrFetchPatched) return;
    window._hrFetchPatched = true;
    var originalFetch = window.fetch;
    window.fetch = async function() {
        let [resource, config] = arguments;
        if (typeof resource === 'string' && (resource.startsWith('/api/') || resource.includes('/api/'))) {
            config = config || {};
            config.credentials = config.credentials || 'same-origin';
            config.headers = config.headers || {};
            let userStr = sessionStorage.getItem('hrflow_user');
            let token = sessionStorage.getItem('hrflow_token');
            if (userStr) {
                try {
                    let userObj = JSON.parse(userStr);
                    config.headers['X-HR-User'] = userObj.name || userObj.email || "Unknown";
                    let rawRole = (userObj.role || "ADMIN").toUpperCase();
                    config.headers['X-HR-Role'] = rawRole === "SUPER_ADMIN" ? "ADMIN" : rawRole;
                    config.headers['X-HR-Email'] = userObj.email || "";
                } catch(e) {}
            }
            if (token) {
                config.headers['Authorization'] = `Bearer ${token}`;
            }
        }
        return originalFetch(resource, config);
    };
})();

// Resilient JSON fetch helper so one slow/failing endpoint never crashes the entire dashboard
async function safeFetchJson(url, defaultVal = {}) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`Request to ${url} returned HTTP ${res.status}`);
            return defaultVal;
        }
        const data = await res.json();
        return data !== undefined && data !== null ? data : defaultVal;
    } catch (err) {
        console.warn(`Network error fetching ${url}:`, err);
        return defaultVal;
    }
}

document.addEventListener('DOMContentLoaded', async () => {

    // Logout button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            sessionStorage.removeItem("hrflow_token");
            sessionStorage.removeItem("hrflow_user");
            window.location.href = "login.html";
        });
    }

    // Interactivity for Dashboard Buttons
    const syncMailBtn = document.getElementById("syncMailBtn");
    if (syncMailBtn) {
        syncMailBtn.addEventListener("click", async () => {
            const originalHtml = syncMailBtn.innerHTML;
            syncMailBtn.innerHTML = '<span style="font-size: 0.75rem;">Syncing...</span>';
            try {
                await fetch(BACKEND_API_BASE + '/api/gmail/sync', { method: 'POST' });
                if (typeof window.showToast === "function") {
                    window.showToast("Mail Sync Initiated", "Syncing recent mailbox messages...", "info");
                }
                await loadRealData();
            } catch (e) {
                console.error(e);
            } finally {
                syncMailBtn.innerHTML = originalHtml;
            }
        });
    }

    const newProcessBtn = document.getElementById("newProcessBtn");
    if (newProcessBtn) {
        newProcessBtn.addEventListener("click", () => {
            window.location.href = "builder.html";
        });
    }

    // Topbar Global Search with live table/process card filtering & Enter-to-search redirect
    const globalSearch = document.getElementById("globalSearch");
    if (globalSearch) {
        globalSearch.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            
            // Filter active runs rows
            const rows = document.querySelectorAll("#activeRunsBody tr");
            rows.forEach(row => {
                if (row.classList.contains("empty-state")) return;
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? "" : "none";
            });

            // Filter process catalog cards
            const cards = document.querySelectorAll("#processGrid .process-card");
            cards.forEach(card => {
                const text = card.textContent.toLowerCase();
                card.style.display = text.includes(query) ? "" : "none";
            });
        });

        globalSearch.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const query = globalSearch.value.trim();
                if (query) {
                    window.location.href = `cases.html?search=${encodeURIComponent(query)}`;
                }
            }
        });
    }

    // Case Modal Logic
    const caseModalOverlay = document.getElementById("caseModalOverlay");
    const closeCaseModal = document.getElementById("closeCaseModal");
    const cancelCaseModal = document.getElementById("cancelCaseModal");
    const viewFullCaseBtn = document.getElementById("viewFullCaseBtn");
    let currentOpenCaseId = null;

    const closeModal = () => {
        if (caseModalOverlay) caseModalOverlay.classList.remove("active");
        currentOpenCaseId = null;
    };

    if (closeCaseModal) closeCaseModal.addEventListener("click", closeModal);
    if (cancelCaseModal) cancelCaseModal.addEventListener("click", closeModal);
    
    if (caseModalOverlay) {
        caseModalOverlay.addEventListener("click", (e) => {
            if (e.target === caseModalOverlay) closeModal();
        });
    }

    if (viewFullCaseBtn) {
        viewFullCaseBtn.addEventListener("click", () => {
            if (currentOpenCaseId) {
                window.location.href = `cases.html?id=${encodeURIComponent(currentOpenCaseId)}`;
            } else {
                window.location.href = "cases.html";
            }
        });
    }

    document.addEventListener("click", async (e) => {
        if (e.target.classList.contains("btn-table-view")) {
            const caseId = e.target.getAttribute("data-case");
            currentOpenCaseId = caseId;
            
            // Show modal and loading state
            if (caseModalOverlay) {
                const title = document.getElementById("modalCaseTitle");
                const body = document.getElementById("modalCaseBody");
                if (title) title.textContent = `Case ${caseId}`;
                if (body) {
                    body.innerHTML = `
                        <div class="modal-loader" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; gap: 12px;">
                            <div class="pulse-dot" style="width: 14px; height: 14px; background-color: var(--tata-coral); border-radius: 50%; box-shadow: 0 0 12px var(--tata-coral-glow); animation: pulse 1.8s infinite;"></div>
                            <span style="font-size: 0.8rem; color: var(--tata-text-muted);">Fetching case details &amp; audit trails...</span>
                        </div>`;
                }
                caseModalOverlay.classList.add("active");
            }

            try {
                // Fetch actual case details
                const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseId)}`);
                if (!res.ok) throw new Error("Failed to fetch");
                const data = await res.json();
                
                const caseData = data.case || data;
                
                // Render real data
                const body = document.getElementById("modalCaseBody");
                const title = document.getElementById("modalCaseTitle");
                if (title) title.textContent = `${caseData.case_number || caseId} — Overview`;

                const priorityUpper = (caseData.priority || "NORMAL").toUpperCase();
                const priorityClass = (priorityUpper === "NORMAL" || priorityUpper === "MEDIUM") ? "medium" : priorityUpper.toLowerCase();
                const statusUpper = (caseData.status || "NEW").toUpperCase();
                let statusClass = "ready";
                if (statusUpper === "IN_PROGRESS") statusClass = "in-progress";
                else if (statusUpper === "WAITING" || statusUpper === "REVIEW_REQUIRED" || statusUpper === "ON_HOLD") statusClass = "waiting";
                else if (statusUpper === "RESOLVED" || statusUpper === "CLOSED") statusClass = "completed";

                let createdDate = "N/A";
                if (caseData.created_at) {
                    try {
                        const d = new Date(caseData.created_at);
                        if (!isNaN(d.getTime())) {
                            createdDate = d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                        }
                    } catch (e) {}
                }
                
                if (body) {
                    body.innerHTML = `
                        <div class="case-detail-row">
                            <div class="case-detail-label" style="font-weight: 650; color: var(--tata-text-muted); width: 140px; flex-shrink: 0;">Status &amp; Priority</div>
                            <div class="case-detail-val" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span class="status-badge ${statusClass}">${statusUpper}</span>
                                <span class="priority-badge ${priorityClass}">${priorityUpper}</span>
                                <span class="sla-pill ${String(caseData.sla_status || 'on_track').toLowerCase()}">${caseData.sla_status || 'ON_TRACK'}</span>
                                ${caseData.feedback_rating || caseData.feedback?.rating ? `
                                    <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.75rem; font-weight:800; color:#b45309;">
                                        ⭐ ${(caseData.feedback_rating || caseData.feedback.rating)}.0 Stars
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                        ${caseData.feedback && caseData.feedback.rating ? `
                        <div class="case-detail-row" style="background:#fffbeb; padding:10px 12px; border-radius:8px; border:1px solid #fde68a;">
                            <div class="case-detail-label" style="color:#92400e; font-weight:700; width: 140px; flex-shrink: 0;">Employee CSAT</div>
                            <div class="case-detail-val">
                                <div style="color:#b45309; font-weight:800; font-size:0.85rem;">
                                    ${'★'.repeat(caseData.feedback.rating)} ${caseData.feedback.rating}.0 / 5 (${caseData.feedback.rating_label || 'Rating'})
                                </div>
                                ${caseData.feedback.comments ? `<div style="font-size:0.8rem; color:#78350f; margin-top:4px; font-style:italic;">"${escapeHtml(caseData.feedback.comments)}"</div>` : ''}
                            </div>
                        </div>
                        ` : ''}
                        <div class="case-detail-row">
                            <div class="case-detail-label" style="font-weight: 650; color: var(--tata-text-muted); width: 140px; flex-shrink: 0;">Employee</div>
                            <div class="case-detail-val" style="color: var(--tata-text-heading); font-weight: 600;">
                                ${escapeHtml(caseData.employee_name || 'Requester')} 
                                <span style="font-weight: 400; color: var(--tata-text-muted); font-size: 0.8rem;">(${escapeHtml(caseData.employee_id || caseData.employee_code || 'EMP')}${caseData.department ? ` • ${escapeHtml(caseData.department)}` : ''})</span>
                            </div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label" style="font-weight: 650; color: var(--tata-text-muted); width: 140px; flex-shrink: 0;">Process &amp; Step</div>
                            <div class="case-detail-val" style="color: var(--tata-text-primary);">
                                <strong>${escapeHtml((caseData.category || 'General').replace(/_/g, ' '))}</strong>
                                <span style="color: var(--tata-text-muted); font-size: 0.8rem;"> &rarr; ${escapeHtml(caseData.workflow_state || 'Initial Review')}</span>
                            </div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label" style="font-weight: 650; color: var(--tata-text-muted); width: 140px; flex-shrink: 0;">Assigned To</div>
                            <div class="case-detail-val" style="color: var(--tata-text-primary); font-weight: 550;">
                                ${escapeHtml(caseData.assigned_user || caseData.assigned_team || 'Unassigned')}
                            </div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label" style="font-weight: 650; color: var(--tata-text-muted); width: 140px; flex-shrink: 0;">Created Date</div>
                            <div class="case-detail-val" style="color: var(--tata-text-secondary); font-size: 0.82rem;">
                                ${createdDate}
                            </div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label" style="font-weight: 650; color: var(--tata-text-muted); width: 140px; flex-shrink: 0;">Description</div>
                            <div class="case-detail-val" style="color: var(--tata-text-primary); font-size: 0.84rem; line-height: 1.5; background: var(--tata-bg-app); padding: 10px 12px; border-radius: 8px; border: 1px solid var(--tata-border-light); width: 100%;">
                                ${escapeHtml(caseData.description || 'No detailed intake description provided.')}
                            </div>
                        </div>
                    `;
                }
            } catch (err) {
                const body = document.getElementById("modalCaseBody");
                if (body) {
                    body.innerHTML = `<div style="color: var(--tata-danger); padding: 20px; text-align: center; font-weight: 600;">Error loading case details. Please check connection.</div>`;
                }
            }
        }
        if (e.target.classList.contains("btn-review")) {
            const card = e.target.closest(".approval-item");
            const appId = card ? card.getAttribute("data-approval-id") : null;
            if (appId) {
                e.target.disabled = true;
                e.target.textContent = "Approving...";
                try {
                    const userStr = sessionStorage.getItem('hrflow_user');
                    const userObj = userStr ? JSON.parse(userStr) : { name: "Admin", role: "ADMIN" };
                    await fetch(`${BACKEND_API_BASE}/api/approvals/${appId}/approve`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            performed_by: userObj.name || "Admin",
                            role: "ADMIN",
                            comments: "Approved from Executive Operational Dashboard"
                        })
                    });
                    if (typeof window.showToast === "function") {
                        window.showToast("Approval Granted", `Approval #${appId} approved successfully.`, "success");
                    }
                    await loadRealData();
                } catch (err) {
                    console.error(err);
                    e.target.disabled = false;
                    e.target.textContent = "Approve";
                }
            }
        }
    });

    await loadRealData();
    setupCsatAuditActions();
    
    // Auto-refresh the dashboard every 30 seconds
    setInterval(loadRealData, 30000);
});

async function loadRealData() {
    try {
        let userStr = sessionStorage.getItem('hrflow_user');
        let userObj = userStr ? JSON.parse(userStr) : {};
        const hintEmail = (userObj && userObj.email) ? `?email=${encodeURIComponent(userObj.email)}` : "";

        try {
            const profRes = await fetch(`${BACKEND_API_BASE}/api/auth/profile${hintEmail}`);
            if (profRes.ok) {
                const profJson = await profRes.json();
                const freshUser = profJson?.data?.user || profJson?.user;
                if (freshUser && freshUser.email) {
                    userObj = { ...userObj, ...freshUser };
                }
            }
        } catch (err) {
            // fallback to sessionStorage
        }

        if (String(userObj.role || "").toUpperCase() === "HR_AGENT") {
            sessionStorage.setItem('hrflow_user', JSON.stringify(userObj));
            window.location.replace("agent.html");
            return;
        }

        if (!userObj.role || String(userObj.role).toUpperCase() === "SUPER_ADMIN") {
            userObj.role = "ADMIN";
        }
        if (!userObj.name || String(userObj.name).toLowerCase() === "super admin") {
            userObj.name = "Admin";
        }
        if (!userObj.designation || String(userObj.designation).toLowerCase() === "super admin") {
            userObj.designation = userObj.role === "ADMIN" ? "Admin" : (userObj.role_title || userObj.role);
        }
        if (userObj.role_title && String(userObj.role_title).toLowerCase().includes("super admin")) {
            userObj.role_title = "Admin";
        }
        if (userObj.email) {
            sessionStorage.setItem('hrflow_user', JSON.stringify(userObj));
        }
        
        const hour = new Date().getHours();
        const timeGreeting = hour < 12 ? "Good Morning" : (hour < 17 ? "Good Afternoon" : "Good Evening");
        const greetingTitle = document.getElementById("greetingTitle") || document.querySelector(".greeting-row h1");
        if (greetingTitle) greetingTitle.textContent = `${timeGreeting}, ${userObj.name}`;
        
        const userNameEl = document.getElementById("userName");
        if (userNameEl) userNameEl.textContent = userObj.name;
        
        const userRoleEl = document.getElementById("userRole");
        if (userRoleEl) userRoleEl.textContent = userObj.designation || userObj.role_title || "Admin";

        const userAvatarEl = document.getElementById("userAvatar");
        if (userAvatarEl && userObj.name) {
            userAvatarEl.textContent = userObj.name.substring(0, 2).toUpperCase();
        }

        // Hide unauthorized sidebar items
        const role = (userObj.role || "ADMIN").toUpperCase();
        if (typeof window.applySidebarRBAC === "function") {
            window.applySidebarRBAC(role);
        }
        if (role === "HR_AGENT") {
            window.location.href = "agent.html";
            return;
        }

        // Concurrently fetch all endpoints with robust fallback defaults
        const [
            metricsRaw,
            approvalsRaw,
            workflowsRaw,
            casesRaw,
            gmailRaw,
            emailsRaw,
            auditRaw,
            csatRaw
        ] = await Promise.all([
            safeFetchJson(`${BACKEND_API_BASE}/api/cases/metrics`, {}),
            safeFetchJson(`${BACKEND_API_BASE}/api/approvals?status=PENDING`, { count: 0, approvals: [] }),
            safeFetchJson(`${BACKEND_API_BASE}/api/workflows`, { workflows: [], count: 0 }),
            safeFetchJson(`${BACKEND_API_BASE}/api/cases?limit=10`, { cases: [], count: 0 }),
            safeFetchJson(`${BACKEND_API_BASE}/api/gmail/status`, { connected: false }),
            safeFetchJson(`${BACKEND_API_BASE}/api/emails?limit=5`, { emails: [], count: 0 }),
            safeFetchJson(`${BACKEND_API_BASE}/api/audit/logs?limit=6`, { logs: [], count: 0 }),
            safeFetchJson(`${BACKEND_API_BASE}/api/audit/csat-report`, null)
        ]);

        const metrics = metricsRaw.data || metricsRaw;
        const statusCounts = metrics.status_counts || metricsRaw.status_counts || {};
        const categoryCounts = metrics.category_counts || metricsRaw.category_counts || {};
        const myWork = metrics.my_work || metricsRaw.my_work || {};

        const approvalsList = Array.isArray(approvalsRaw.approvals)
            ? approvalsRaw.approvals
            : (Array.isArray(approvalsRaw.data?.approvals)
                ? approvalsRaw.data.approvals
                : (Array.isArray(approvalsRaw.data) ? approvalsRaw.data : []));
        const approvalsCount = approvalsRaw.count ?? approvalsList.length;

        const workflowsList = Array.isArray(workflowsRaw.workflows)
            ? workflowsRaw.workflows
            : (Array.isArray(workflowsRaw.data?.workflows)
                ? workflowsRaw.data.workflows
                : (Array.isArray(workflowsRaw.data) ? workflowsRaw.data : []));

        const casesList = Array.isArray(casesRaw.cases)
            ? casesRaw.cases
            : (Array.isArray(casesRaw.data?.cases)
                ? casesRaw.data.cases
                : (Array.isArray(casesRaw.data) ? casesRaw.data : []));

        const gmail = gmailRaw.data || gmailRaw;

        const emailsList = Array.isArray(emailsRaw.emails)
            ? emailsRaw.emails
            : (Array.isArray(emailsRaw.data?.emails)
                ? emailsRaw.data.emails
                : (Array.isArray(emailsRaw.data) ? emailsRaw.data : []));

        const auditLogsList = Array.isArray(auditRaw.logs)
            ? auditRaw.logs
            : (Array.isArray(auditRaw.data?.logs)
                ? auditRaw.data.logs
                : (Array.isArray(auditRaw.data) ? auditRaw.data : []));

        const csatData = csatRaw ? (csatRaw.data || csatRaw) : null;

        if (typeof window.updateSidebarBadges === "function") {
            window.updateSidebarBadges();
        }

        // 1. Update Summary KPI Cards
        const kpiGrid = document.getElementById("kpiGrid");
        if (kpiGrid) {
            const breaches = myWork.overdue ?? casesList.filter(c => c.sla_status === 'OVERDUE' || c.sla_status === 'BREACHED' || c.sla_breached).length;
            const engineStatus = gmail.connected ? "Online" : "Standby";
            const activeWorkflowRuns = metrics.open_cases ?? ((metrics.total_cases || 0) - ((statusCounts.RESOLVED || 0) + (statusCounts.CLOSED || 0)));
            const openCasesCount = metrics.open_cases ?? casesList.length;
            
            kpiGrid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-header">
                        <span>Active Cases</span>
                        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg></div>
                    </div>
                    <div class="stat-value">${openCasesCount}</div>
                    <div class="stat-desc">Cases currently being processed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>Pending Approvals</span>
                        <div class="stat-icon warning"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
                    </div>
                    <div class="stat-value">${approvalsCount}</div>
                    <div class="stat-desc">Human approvals waiting for action</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>Active Workflow Runs</span>
                        <div class="stat-icon purple"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg></div>
                    </div>
                    <div class="stat-value">${activeWorkflowRuns}</div>
                    <div class="stat-desc">Workflows currently executing or waiting</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>Published Workflows</span>
                        <div class="stat-icon success"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg></div>
                    </div>
                    <div class="stat-value">${workflowsList.length}</div>
                    <div class="stat-desc">Published workflows across all processes</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>SLA Breaches</span>
                        <div class="stat-icon" style="background: var(--tata-danger-light); color: var(--tata-danger); border-color: var(--tata-danger-border);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
                    </div>
                    <div class="stat-value" style="color: ${breaches > 0 ? 'var(--tata-danger)' : 'var(--tata-text-heading)'}">${breaches}</div>
                    <div class="stat-desc">Cases exceeding defined SLA</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>System Engine</span>
                        <div class="stat-icon success"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
                    </div>
                    <div class="stat-value" style="font-size: 1.6rem; margin-top: 6px; color: ${gmail.connected ? 'var(--tata-success)' : 'var(--tata-warning)'};">${engineStatus}</div>
                    <div class="stat-desc">Mail &amp; Workflow orchestrator status</div>
                </div>
            `;
        }

        // Charts
        renderWorkloadChart(statusCounts);
        renderCategoryChart(categoryCounts);
        renderTrendChart();

        // Update Connected Mailbox UI
        const mailLabel = document.getElementById("mailboxLabel");
        const mailIndicator = document.querySelector(".status-dot");
        const mailUnread = document.getElementById("mailboxUnread");
        
        if (mailLabel) {
            if (gmail.connected && gmail.email) {
                mailLabel.textContent = `${gmail.email} (Connected)`;
                if (mailIndicator) {
                    mailIndicator.classList.remove("disconnected");
                    mailIndicator.classList.add("connected");
                }
            } else {
                mailLabel.textContent = "Gmail Standby";
                if (mailIndicator) {
                    mailIndicator.classList.remove("connected");
                    mailIndicator.classList.add("disconnected");
                }
            }
        }
        if (mailUnread) {
            const unread = gmail.stored_emails_count ?? gmail.unread_count ?? gmail.inbox_total ?? emailsList.length;
            mailUnread.textContent = `${unread} ${unread === 1 ? 'Email' : 'Emails'}`;
        }

        // 2. Process Catalog (Connected to Workflows & Category Counts)
        const processGrid = document.getElementById("processGrid");
        if (processGrid) {
            const wfCategoryCounts = {};
            workflowsList.forEach(w => {
                const cat = (w.category || "GENERAL").toUpperCase();
                wfCategoryCounts[cat] = (wfCategoryCounts[cat] || 0) + 1;
            });

            const processes = [
                {
                    key: "RESIGNATION",
                    code: "EX",
                    name: "BGV / Exit",
                    description: "Resignation intake, background verification, clearance &amp; dues settlement.",
                    wfc: (wfCategoryCounts["RESIGNATION"] || 0) + (wfCategoryCounts["BGV"] || 0) || 2,
                    arc: (categoryCounts["RESIGNATION"] || 0) + (categoryCounts["BGV"] || 0)
                },
                {
                    key: "ONBOARDING",
                    code: "ON",
                    name: "Onboarding &amp; Profile",
                    description: "Pre-boarding document collection, profile updates &amp; credentials.",
                    wfc: (wfCategoryCounts["ONBOARDING"] || 0) + (wfCategoryCounts["PROFILE_UPDATE"] || 0) || 1,
                    arc: (categoryCounts["ONBOARDING"] || 0) + (categoryCounts["PROFILE_UPDATE"] || 0)
                },
                {
                    key: "ATTENDANCE",
                    code: "AT",
                    name: "Attendance",
                    description: "Biometric exceptions, shift regularization &amp; swipe corrections.",
                    wfc: wfCategoryCounts["ATTENDANCE"] || 1,
                    arc: categoryCounts["ATTENDANCE"] || 0
                },
                {
                    key: "LEAVE",
                    code: "LV",
                    name: "Leave Operations",
                    description: "Policy validation, manager approvals &amp; leave balance reconciliation.",
                    wfc: wfCategoryCounts["LEAVE"] || 1,
                    arc: categoryCounts["LEAVE"] || 0
                },
                {
                    key: "PAYROLL",
                    code: "PY",
                    name: "Payroll &amp; Comp",
                    description: "Salary discrepancies, tax deductions, bonus &amp; payslip queries.",
                    wfc: wfCategoryCounts["PAYROLL"] || 1,
                    arc: categoryCounts["PAYROLL"] || 0
                },
                {
                    key: "ASSET_IT",
                    code: "IT",
                    name: "IT &amp; Assets Desk",
                    description: "Hardware allocation, laptop repairs, peripherals &amp; IT access.",
                    wfc: (wfCategoryCounts["ASSET_IT"] || 0) + (wfCategoryCounts["IT"] || 0) || 1,
                    arc: (categoryCounts["ASSET_IT"] || 0) + (categoryCounts["IT"] || 0)
                }
            ];

            processGrid.innerHTML = "";
            processes.forEach(p => {
                processGrid.innerHTML += `
                    <div class="process-card" data-category="${p.key}">
                        <div class="process-card-header">
                            <div class="process-code">${p.code}</div>
                            <span class="process-wfc">${p.wfc} workflows</span>
                        </div>
                        <h3>${p.name}</h3>
                        <p>${p.description}</p>
                        <div class="process-card-footer">
                            <span class="process-arc" style="cursor: pointer;" onclick="window.location.href='cases.html?category=${p.key}'">${p.arc} active runs</span>
                            <a href="builder.html" class="process-link">Configure &rarr;</a>
                        </div>
                    </div>
                `;
            });
        }
        
        // 3. Active Workflow Runs (Cases)
        renderActiveCases(casesList);

        // 4. Pending Approvals
        renderApprovals(approvalsList);

        // 5. Recent Emails & Audit Logs
        renderRecentEmails(emailsList);
        renderAuditLogs(auditLogsList);

        // 6. Service Quality & CSAT Audit Report
        renderCsatAuditReport(csatData);

    } catch (e) {
        console.error("Failed to load real dashboard data:", e);
    }
}

function renderActiveCases(casesList) {
    const tbody = document.getElementById("activeRunsBody") || document.querySelector(".runs-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (!casesList || casesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="text-align:center; padding: 32px; color: var(--tata-text-muted);">No active workflow runs found.</td></tr>`;
        return;
    }

    casesList.forEach(c => {
        const tr = document.createElement("tr");
        const statusUpper = (c.status || "NEW").toUpperCase();
        let statusClass = "ready";
        if (statusUpper === "IN_PROGRESS") statusClass = "in-progress";
        else if (statusUpper === "WAITING" || statusUpper === "REVIEW_REQUIRED" || statusUpper === "ON_HOLD") statusClass = "waiting";
        else if (statusUpper === "RESOLVED" || statusUpper === "CLOSED") statusClass = "completed";

        const priorityUpper = (c.priority || "NORMAL").toUpperCase();
        const priorityClass = (priorityUpper === "NORMAL" || priorityUpper === "MEDIUM") ? "medium" : priorityUpper.toLowerCase();

        let createdDate = "Recently";
        if (c.created_at) {
            try {
                const d = new Date(c.created_at);
                if (!isNaN(d.getTime())) {
                    createdDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                }
            } catch (e) {}
        }

        const caseNumber = c.case_number || c.id || `CASE-${c.db_id}`;
        const employeeName = c.employee_name || c.sender_name || "Employee";
        const employeeId = c.employee_code || c.employee_id || "EMP";
        const categoryName = (c.category || "General").replace(/_/g, " ");
        const workflowName = c.workflow_type || c.category || "Standard Workflow";
        const stepName = c.workflow_state || "Intake";
        const assignee = c.assigned_user || c.assigned_team || "Unassigned";
        const slaStatus = c.sla_status || "ON_TRACK";
        const slaClass = slaStatus.toLowerCase();

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="case-id-badge" style="font-weight: 750; font-family: monospace; color: var(--tata-text-heading); font-size: 0.8rem;">${escapeHtml(caseNumber)}</span>
                    <span class="priority-badge ${priorityClass}">${priorityUpper}</span>
                </div>
            </td>
            <td>
                <div class="employee-cell">
                    <strong style="color: var(--tata-text-heading); font-size: 0.84rem;">${escapeHtml(employeeName)}</strong>
                    <small style="display: block; color: var(--tata-text-muted); font-size: 0.72rem;">${escapeHtml(employeeId)}</small>
                </div>
            </td>
            <td>
                <div class="process-cell">
                    <strong style="font-size: 0.82rem; color: var(--tata-text-heading);">${escapeHtml(categoryName)}</strong>
                    <small class="workflow-name" style="display: block; color: var(--tata-text-muted); font-size: 0.74rem;">${escapeHtml(workflowName)}</small>
                </div>
            </td>
            <td>
                <div class="status-step-cell">
                    <span class="status-badge ${statusClass}">${statusUpper}</span>
                    <span class="step-text" style="font-size: 0.73rem; color: var(--tata-text-muted); display: block; margin-top: 3px;">↳ ${escapeHtml(stepName)}</span>
                    ${c.feedback_rating ? `
                        <div style="display:inline-flex; align-items:center; gap:3px; margin-top:4px; padding:1px 6px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.68rem; font-weight:800; color:#b45309;" title="CSAT Rating: ${c.feedback_rating} Stars">
                            <span>⭐</span><span>${c.feedback_rating}.0</span>
                        </div>
                    ` : ''}
                </div>
            </td>
            <td>
                <div class="assignee-cell">
                    <span class="assignee-name" style="font-size: 0.82rem; font-weight: 550; color: var(--tata-text-primary);">${escapeHtml(assignee)}</span>
                </div>
            </td>
            <td>
                <span class="date-cell" style="font-size: 0.78rem; color: var(--tata-text-secondary);">${createdDate}</span>
            </td>
            <td>
                <span class="sla-pill ${slaClass}">${slaStatus}</span>
            </td>
            <td>
                <button type="button" class="btn-table-view" data-case="${escapeHtml(caseNumber)}">Open</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderApprovals(approvalsList) {
    const listEl = document.getElementById("approvalList") || document.getElementById("pendingApprovalsList");
    if (!listEl) return;
    listEl.innerHTML = "";

    const countBadge = document.getElementById("pendingApprovalsCount");
    if (countBadge) countBadge.textContent = approvalsList ? approvalsList.length : 0;

    if (!approvalsList || approvalsList.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding: 40px 10px; text-align: center; color: var(--tata-text-muted);">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px; opacity: 0.4;">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <div style="font-size: 0.9rem; font-weight: 600; color: var(--tata-text-heading);">All Caught Up</div>
                <div style="font-size: 0.78rem; margin-top: 3px; color: var(--tata-text-muted);">No pending approvals waiting for your review.</div>
            </div>`;
        return;
    }

    approvalsList.slice(0, 5).forEach(app => {
        listEl.innerHTML += `
            <div class="approval-item" data-approval-id="${app.id || app.approval_code}" style="padding: 10px; border-bottom: 1px solid var(--tata-border-light); display: flex; justify-content: space-between; align-items: center; transition: all 0.15s; border-radius: 6px;">
                <div class="approval-info" style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0 0 3px 0; font-size: 0.83rem; color: var(--tata-text-heading);">${escapeHtml(app.approval_type || "Approval Required")}</h4>
                    <div class="approval-meta" style="font-size: 0.74rem; color: var(--tata-text-muted);">
                        <span><strong>${escapeHtml(app.employee_name || "Employee")}</strong></span> • 
                        <span>Wait: ${escapeHtml(app.approver_role || app.approver || "Manager")}</span> • 
                        <span style="color: var(--tata-coral); font-weight: 650;">${escapeHtml(app.case_number || "N/A")}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; flex-shrink: 0; margin-left: 8px;">
                    <button type="button" class="btn-review" style="background: var(--tata-success-light); color: var(--tata-success); border: 1px solid var(--tata-success-border); padding: 5px 11px; border-radius: 6px; font-size: 0.74rem; font-weight: 700; cursor: pointer; transition: all 0.15s;">Approve</button>
                </div>
            </div>
        `;
    });
}

function renderRecentEmails(emailsList) {
    const listEl = document.getElementById("recentEmailsList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!emailsList || emailsList.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding: 40px 10px; text-align: center; color: var(--tata-text-muted);">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px; opacity: 0.4;">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                </svg>
                <div style="font-size: 0.9rem; font-weight: 600; color: var(--tata-text-heading);">Inbox Zero</div>
                <div style="font-size: 0.78rem; margin-top: 3px; color: var(--tata-text-muted);">No unread or pending emails in connected mailbox.</div>
            </div>`;
        return;
    }

    emailsList.forEach(email => {
        const sender = email.sender_name || email.account_email || email.sender_email || "Unknown";
        const initials = sender.substring(0, 2).toUpperCase();
        
        let timeStr = 'Recently';
        if (email.received_at) {
            try {
                const dateObj = new Date(email.received_at.replace(' ', 'T'));
                if (!isNaN(dateObj)) {
                    timeStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                } else {
                    timeStr = email.received_at.substring(0, 10);
                }
            } catch (e) {}
        }

        const categoryTag = (email.category || "General").replace(/_/g, " ");

        listEl.innerHTML += `
            <div class="email-item" style="display: flex; gap: 12px; padding: 10px 8px; border-bottom: 1px dashed var(--tata-border-light); align-items: center; transition: background 0.15s; border-radius: 6px;">
                <div style="width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, var(--tata-coral), var(--tata-crimson)); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 750; flex-shrink: 0; box-shadow: 0 2px 6px var(--tata-coral-glow);">
                    ${escapeHtml(initials)}
                </div>
                <div class="email-left" style="flex: 1; min-width: 0;">
                    <div class="email-sender" style="font-weight: 650; font-size: 0.82rem; color: var(--tata-text-heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${escapeHtml(sender)}</div>
                    <div class="email-subject" style="font-size: 0.74rem; color: var(--tata-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(email.subject || '')}">${escapeHtml(email.subject || "(No Subject)")}</div>
                </div>
                <div class="email-right" style="text-align: right; flex-shrink: 0;">
                    <div class="email-time" style="font-size: 0.7rem; color: var(--tata-text-muted); margin-bottom: 3px; font-weight: 500;">${timeStr}</div>
                    <div class="category-tag" style="font-size: 0.62rem; font-weight: 700; background: var(--tata-bg-app); border: 1px solid var(--tata-border-light); padding: 2px 6px; border-radius: 4px; color: var(--tata-text-secondary); text-transform: uppercase;">${escapeHtml(categoryTag)}</div>
                </div>
            </div>
        `;
    });
}

function renderWorkloadChart(statusData) {
    const ctx = document.getElementById('workloadChart');
    if (!ctx) return;

    const open = statusData.OPEN || 0;
    const ready = statusData.READY || 0;
    const newCases = statusData.NEW || 0;
    const inProg = statusData.IN_PROGRESS || 0;
    const pending = statusData.PENDING || 0;
    const review = (statusData.REVIEW_REQUIRED || 0) + (statusData.ON_HOLD || 0) + (statusData.WAITING || 0);
    const resolved = statusData.RESOLVED || 0;
    const closed = statusData.CLOSED || 0;

    const left = open + ready + newCases + inProg + pending + review;
    const done = resolved + closed;

    if (window.workloadChartInstance) {
        window.workloadChartInstance.destroy();
    }

    const chartData = (left === 0 && done === 0) ? [1] : [left, done];
    const chartLabels = (left === 0 && done === 0) ? ['No Active Cases'] : ['Pending / Active', 'Completed / Closed'];
    const chartColors = (left === 0 && done === 0) ? ['#E2E8F0'] : ['#FF6F61', '#10B981'];

    window.workloadChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: chartLabels,
            datasets: [{
                data: chartData,
                backgroundColor: chartColors,
                hoverBackgroundColor: (left === 0 && done === 0) ? ['#CBD5E1'] : ['#FF5847', '#059669'],
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: {
                            family: "'Inter', sans-serif",
                            size: 11,
                            weight: 600
                        },
                        usePointStyle: true,
                        padding: 14
                    }
                }
            }
        }
    });
}

function renderCategoryChart(categoryData) {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    if (window.categoryChartInstance) {
        window.categoryChartInstance.destroy();
    }

    const rawLabels = Object.keys(categoryData || {});
    let data = Object.values(categoryData || {});

    const formatLabel = (cat) => {
        const map = {
            'RESIGNATION': 'Resignation',
            'BGV': 'BGV / Exit',
            'ATTENDANCE': 'Attendance',
            'LEAVE': 'Leave Ops',
            'PAYROLL': 'Payroll',
            'ASSET_IT': 'IT Assets',
            'PROFILE_UPDATE': 'Profile Update',
            'ONBOARDING': 'Onboarding',
            'GENERAL': 'General'
        };
        return map[cat.toUpperCase()] || cat.replace(/_/g, ' ');
    };

    let labels = rawLabels.map(formatLabel);

    if (labels.length === 0) {
        labels = ["No Active Cases"];
        data = [0];
    }

    window.categoryChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Active Cases',
                data: data,
                backgroundColor: 'rgba(255, 111, 97, 0.85)',
                hoverBackgroundColor: '#E03546',
                borderColor: '#FF6F61',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { precision: 0, font: { family: "'Inter', sans-serif" } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: "'Inter', sans-serif", weight: 600, size: 10 } }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderTrendChart() {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;

    if (window.trendChartInstance) {
        window.trendChartInstance.destroy();
    }

    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const data = [3.8, 3.2, 4.1, 3.5, 2.9, 2.4, 2.8];

    window.trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Avg SLA (Hours)',
                data: data,
                borderColor: '#FF6F61',
                backgroundColor: 'rgba(255, 111, 97, 0.12)',
                borderWidth: 2.5,
                pointBackgroundColor: '#E03546',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.38
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { font: { family: "'Inter', sans-serif" } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: "'Inter', sans-serif", weight: 600, size: 10 } }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderAuditLogs(logsList) {
    const listEl = document.getElementById("auditList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!logsList || logsList.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding: 40px 10px; text-align: center; color: var(--tata-text-muted);">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px; opacity: 0.4;">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <div style="font-size: 0.9rem; font-weight: 600; color: var(--tata-text-heading);">No Recent Activity</div>
                <div style="font-size: 0.78rem; margin-top: 3px; color: var(--tata-text-muted);">System audit events will appear here in real time.</div>
            </div>`;
        return;
    }

    logsList.forEach(log => {
        let timeStr = 'Now';
        if (log.time_hm) {
            timeStr = log.time_hm;
        } else if (log.time) {
            timeStr = log.time;
        } else if (log.created_at) {
            try {
                if (log.created_at.includes(", ")) {
                    timeStr = log.created_at.split(", ")[1].substring(0, 5);
                } else if (log.created_at.includes("T")) {
                    const d = new Date(log.created_at);
                    timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
                } else {
                    timeStr = log.created_at.substring(11, 16);
                }
            } catch (e) {
                timeStr = "Now";
            }
        }

        const actionStr = String(log.action || "EVENT").replace(/_/g, " ");
        const desc = log.description || log.text || log.details || `${log.entity_type || 'Entity'} #${log.entity_id || ''}`;
        const performedBy = log.performed_by || "System";
        const isFeedback = actionStr.includes("FEEDBACK") || actionStr.includes("CSAT") || desc.includes("CSAT");

        listEl.innerHTML += `
            <div class="email-item" style="display: flex; gap: 10px; align-items: flex-start; padding: 10px 8px; border-bottom: 1px dashed var(--tata-border-light); border-radius: 6px; transition: background 0.15s; ${isFeedback ? 'background: #fffdf5;' : ''}">
                <div class="stat-icon" style="width: 28px; height: 28px; border-radius: 50%; background: ${isFeedback ? 'var(--tata-warning-light)' : 'var(--tata-coral-light)'}; color: ${isFeedback ? 'var(--tata-warning)' : 'var(--tata-coral)'}; margin: 0; padding: 4px; flex-shrink: 0; display:flex; align-items:center; justify-content:center; font-size:0.75rem;">
                    ${isFeedback ? '⭐' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'}
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 650; font-size: 0.82rem; color: var(--tata-text-heading); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${escapeHtml(actionStr)}
                    </div>
                    <div style="font-size: 0.74rem; color: var(--tata-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(desc)}">
                        ${escapeHtml(desc)}
                    </div>
                    <div style="font-size: 0.68rem; color: var(--tata-text-muted); margin-top: 2px;">
                        By ${escapeHtml(performedBy)}
                    </div>
                </div>
                <div style="font-size: 0.7rem; color: var(--tata-text-muted); flex-shrink: 0; font-weight: 600;">${timeStr}</div>
            </div>
        `;
    });
}

// Global Toast / Alert Component
window.showToast = function(title, message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    if (type === 'success') {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else if (type === 'error') {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else if (type === 'warning') {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    }
    
    toast.innerHTML = `
        <div class="toast-icon">${iconSvg}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div class="toast-progress"></div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    let isRemoving = false;
    const removeToast = () => {
        if(isRemoving) return;
        isRemoving = true;
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    };
    
    toast.querySelector('.toast-close').addEventListener('click', removeToast);
    
    setTimeout(removeToast, 4000);
};

// -------------------------------------------------------------
// Executive Service Quality & CSAT Audit Report Logic
// -------------------------------------------------------------

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let currentCsatRecords = [];

function renderCsatAuditReport(csatData) {
    const summary = csatData?.summary || { average_rating: 5.0, csat_percentage: 100, total_responses: 0 };
    const records = csatData?.records || [];
    currentCsatRecords = records;

    const avgEl = document.getElementById("csatAvgScore");
    if (avgEl) {
        avgEl.textContent = summary.average_rating > 0 ? `${summary.average_rating.toFixed(1)} ★` : "5.0 ★";
    }

    const posEl = document.getElementById("csatPositivePct");
    if (posEl) {
        posEl.textContent = summary.total_responses > 0 ? `${summary.csat_percentage}%` : "100%";
    }

    const totEl = document.getElementById("csatTotalSurveys");
    if (totEl) {
        totEl.textContent = summary.total_responses || 0;
    }

    const slaEl = document.getElementById("csatSlaCompliance");
    if (slaEl) {
        slaEl.textContent = "100%";
    }

    const tbody = document.getElementById("csatAuditBody");
    if (!tbody) return;

    if (records.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:36px; color: var(--tata-text-muted); font-size:0.85rem;">
                    <div style="font-size:1.5rem; margin-bottom:6px;">📊</div>
                    <strong style="color: var(--tata-text-heading);">No Employee CSAT Surveys Logged Yet</strong>
                    <div style="font-size:0.75rem; color: var(--tata-text-muted); margin-top:4px;">When employees submit star ratings via the 1-click resolution mail or portal, audited feedback will appear here in real time.</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = records.map(rec => {
        const rating = Number(rec.rating) || 5;
        const ratingLabel = rec.rating_label || "Excellent";
        
        let tagsHtml = `<span style="color: var(--tata-text-muted); font-size:0.75rem;">None</span>`;
        if (Array.isArray(rec.tags) && rec.tags.length > 0) {
            tagsHtml = rec.tags.map(t => `<span style="display:inline-block; margin:2px 4px 2px 0; padding:2px 6px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; font-size:0.7rem; font-weight:600; color:#334155;">${escapeHtml(t)}</span>`).join("");
        }

        const commentsHtml = rec.comments
            ? `<div style="font-size:0.78rem; color:#1e293b; max-width:240px; white-space:normal; line-height:1.4;">“${escapeHtml(rec.comments)}”</div>`
            : `<span style="color: var(--tata-text-muted); font-size:0.75rem; font-style:italic;">No remarks</span>`;

        return `
            <tr>
                <td>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <a href="cases.html?id=${encodeURIComponent(rec.case_number)}" style="font-weight:700; color: var(--tata-coral); text-decoration:none; font-family:monospace; font-size:0.82rem;">
                            ${escapeHtml(rec.case_number)}
                        </a>
                        <span style="font-size:0.72rem; color: var(--tata-text-muted); text-transform:uppercase; font-weight:600;">
                            ${escapeHtml(rec.category || 'General')}
                        </span>
                    </div>
                </td>
                <td>
                    <div style="font-weight:600; font-size:0.82rem; color: var(--tata-text-heading);">
                        ${escapeHtml(rec.employee_name || 'Requester')}
                    </div>
                    <div style="font-size:0.72rem; color: var(--tata-text-muted);">
                        ${rec.employee_code ? escapeHtml(rec.employee_code) : ''}
                        ${rec.employee_department ? `• ${escapeHtml(rec.employee_department)}` : ''}
                    </div>
                </td>
                <td>
                    <div style="display:inline-flex; align-items:center; gap:6px; padding:3px 8px; background: var(--tata-bg-app); border:1px solid var(--tata-border-light); border-radius:6px; font-size:0.76rem; font-weight:600; color: var(--tata-text-primary);">
                        <span>👤</span>
                        <span>${escapeHtml(rec.resolved_by || rec.assigned_user || 'Vaibhav (HR)')}</span>
                    </div>
                </td>
                <td>
                    <span style="font-weight:700; font-size:0.8rem; color: var(--tata-text-primary);">${escapeHtml(rec.turnaround_hours || '--')}</span>
                </td>
                <td>
                    <div style="display:inline-flex; align-items:center; gap:5px; padding:3px 9px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.76rem; font-weight:800; color:#b45309;" title="${rating} Stars - ${escapeHtml(ratingLabel)}">
                        <span>⭐</span>
                        <span>${rating}.0</span>
                        <span style="font-size:0.7rem; color:#92400e; font-weight:600;">(${escapeHtml(ratingLabel)})</span>
                    </div>
                </td>
                <td>
                    <div style="max-width:200px; white-space:normal;">
                        ${tagsHtml}
                    </div>
                </td>
                <td>
                    ${commentsHtml}
                </td>
                <td>
                    <span class="status-badge completed" style="background: var(--tata-success-light); color: var(--tata-success); border:1px solid var(--tata-success-border); font-size:0.7rem; font-weight:700; padding:3px 8px; border-radius:6px; text-transform:uppercase;">
                        ✓ Audited &amp; Verified
                    </span>
                </td>
            </tr>
        `;
    }).join("");
}

function setupCsatAuditActions() {
    const btnExport = document.getElementById("btnExportCsatCsv");
    if (btnExport && !btnExport._bound) {
        btnExport._bound = true;
        btnExport.addEventListener("click", () => {
            if (!currentCsatRecords || currentCsatRecords.length === 0) {
                if (typeof window.showToast === "function") {
                    window.showToast("No Data", "No CSAT survey records available to export.", "warning");
                } else {
                    alert("No CSAT survey records available to export.");
                }
                return;
            }

            const headers = [
                "Case Number",
                "Category",
                "Case Title",
                "Employee Name",
                "Employee Code",
                "Department",
                "Specialist",
                "Turnaround",
                "Star Rating",
                "Rating Label",
                "Tags",
                "Employee Comments",
                "Submitted By",
                "Date Submitted"
            ];

            const rows = currentCsatRecords.map(r => [
                r.case_number || "",
                r.category || "",
                `"${(r.case_title || "").replace(/"/g, '""')}"`,
                `"${(r.employee_name || "").replace(/"/g, '""')}"`,
                r.employee_code || "",
                `"${(r.employee_department || "").replace(/"/g, '""')}"`,
                `"${(r.resolved_by || r.assigned_user || "").replace(/"/g, '""')}"`,
                r.turnaround_hours || "",
                r.rating || "",
                r.rating_label || "",
                `"${(Array.isArray(r.tags) ? r.tags.join("; ") : "").replace(/"/g, '""')}"`,
                `"${(r.comments || "").replace(/"/g, '""')}"`,
                `"${(r.submitted_by || "").replace(/"/g, '""')}"`,
                r.created_at || ""
            ]);

            const csvContent = "data:text/csv;charset=utf-8," + [
                headers.join(","),
                ...rows.map(e => e.join(","))
            ].join("\n");

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `CSAT_Service_Audit_Report_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            if (typeof window.showToast === "function") {
                window.showToast("Export Complete", "CSAT Audit CSV downloaded successfully.", "success");
            }
        });
    }

    const btnPrint = document.getElementById("btnPrintCsatReport");
    if (btnPrint && !btnPrint._bound) {
        btnPrint._bound = true;
        btnPrint.addEventListener("click", () => {
            window.print();
        });
    }
}
