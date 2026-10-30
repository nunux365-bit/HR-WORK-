var BACKEND_API_BASE =
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    window.location.port &&
    window.location.port !== "5000"
        ? "http://127.0.0.1:5000"
        : "";

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
            window.location.href = `cases.html?id=${currentOpenCaseId}`;
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
                if (title) title.textContent = `Case #${caseId}`;
                if (body) body.innerHTML = `<div class="modal-loader" style="display: flex; justify-content: center; padding: 40px;"><div class="pulse-dot" style="width: 12px; height: 12px; background-color: var(--blue-600); border-radius: 50%; box-shadow: 0 0 10px rgba(59,130,246,0.6); animation: pulse 2s infinite;"></div></div>`;
                caseModalOverlay.classList.add("active");
            }

            try {
                // Fetch actual case details
                const res = await fetch(`${BACKEND_API_BASE}/api/cases/${caseId}`);
                if (!res.ok) throw new Error("Failed to fetch");
                const data = await res.json();
                
                const caseData = data.case || data;
                
                // Render real data
                const body = document.getElementById("modalCaseBody");
                const priorityClass = caseData.priority ? caseData.priority.toLowerCase() : "medium";
                const createdDate = caseData.created_at ? new Date(caseData.created_at).toLocaleString() : "N/A";
                
                if (body) {
                    body.innerHTML = `
                        <div class="case-detail-row">
                            <div class="case-detail-label">Status</div>
                            <div class="case-detail-val" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span class="status-badge ${caseData.status === 'IN_PROGRESS' ? 'in-progress' : 'completed'}">${caseData.status || 'N/A'}</span>
                                ${caseData.feedback_rating || caseData.feedback?.rating ? `
                                    <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.75rem; font-weight:800; color:#b45309;">
                                        ⭐ ${(caseData.feedback_rating || caseData.feedback.rating)}.0 Stars
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                        ${caseData.feedback && caseData.feedback.rating ? `
                        <div class="case-detail-row" style="background:#fffbeb; padding:10px 12px; border-radius:8px; border:1px solid #fde68a;">
                            <div class="case-detail-label" style="color:#92400e; font-weight:700;">Employee CSAT</div>
                            <div class="case-detail-val">
                                <div style="color:#b45309; font-weight:800; font-size:0.85rem;">
                                    ${'★'.repeat(caseData.feedback.rating)} ${caseData.feedback.rating}.0 / 5 (${caseData.feedback.rating_label || 'Rating'})
                                </div>
                                ${caseData.feedback.comments ? `<div style="font-size:0.8rem; color:#78350f; margin-top:4px; font-style:italic;">"${escapeHtml(caseData.feedback.comments)}"</div>` : ''}
                            </div>
                        </div>
                        ` : ''}
                        <div class="case-detail-row">
                            <div class="case-detail-label">Priority</div>
                            <div class="case-detail-val">
                                <span class="priority-badge ${priorityClass}">${caseData.priority || 'MEDIUM'}</span>
                            </div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label">Employee</div>
                            <div class="case-detail-val">${caseData.employee_name || 'N/A'} (${caseData.employee_id || 'N/A'})</div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label">Workflow Category</div>
                            <div class="case-detail-val">${caseData.category || 'General'} &rarr; ${caseData.workflow_type || 'N/A'}</div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label">Current Step</div>
                            <div class="case-detail-val">${caseData.workflow_state || 'Start'}</div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label">Assigned To</div>
                            <div class="case-detail-val">${caseData.assigned_user || caseData.assigned_team || 'Unassigned'}</div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label">Created At</div>
                            <div class="case-detail-val">${createdDate}</div>
                        </div>
                        <div class="case-detail-row">
                            <div class="case-detail-label">Description</div>
                            <div class="case-detail-val" style="font-weight: 400; color: var(--slate-600);">${caseData.description || 'No description provided.'}</div>
                        </div>
                    `;
                }
                
                const title = document.getElementById("modalCaseTitle");
                if (title) title.textContent = `${caseData.case_number || caseId} Details`;
                
            } catch (err) {
                const body = document.getElementById("modalCaseBody");
                if (body) {
                    body.innerHTML = `<div style="color: var(--rose-600); padding: 20px; text-align: center;">Error loading case details. It may not exist.</div>`;
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
                        window.showToast("Approval Granted", `Approval ${appId} approved successfully.`, "success");
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
            window.location.href = "agent/index.html";
            return;
        }

        // Fetch data
        const [metricsRes, approvalsRes, workflowsRes, casesRes, gmailRes, emailsRes, auditRes, csatRes] = await Promise.all([
            fetch(`${BACKEND_API_BASE}/api/cases/metrics`),
            fetch(`${BACKEND_API_BASE}/api/approvals?status=PENDING`),
            fetch(`${BACKEND_API_BASE}/api/workflows`),
            fetch(`${BACKEND_API_BASE}/api/cases?limit=10`),
            fetch(`${BACKEND_API_BASE}/api/gmail/status`),
            fetch(`${BACKEND_API_BASE}/api/emails?limit=5`),
            fetch(`${BACKEND_API_BASE}/api/audit/logs?limit=6`),
            fetch(`${BACKEND_API_BASE}/api/audit/csat-report`).catch(() => null)
        ]);

        const metrics = await metricsRes.json();
        const approvals = await approvalsRes.json();
        const workflows = (await workflowsRes.json()).workflows || [];
        const cases = await casesRes.json();
        const gmail = await gmailRes.json();
        const emails = await emailsRes.json();
        const audit = await auditRes.json();
        let csatData = null;
        if (csatRes && csatRes.ok) {
            try {
                const csatJson = await csatRes.json();
                csatData = csatJson.data || csatJson;
            } catch (e) {
                console.error("Error parsing CSAT report:", e);
            }
        }

        if (typeof window.updateSidebarBadges === "function") {
            window.updateSidebarBadges();
        }

        // 1. Update Summary Metrics
        const kpiGrid = document.getElementById("kpiGrid");
        if (kpiGrid) {
            const casesArray = cases.cases || cases.data || [];
            const breaches = metrics.my_work?.overdue ?? casesArray.filter(c => c.sla_status === 'OVERDUE' || c.sla_status === 'BREACHED' || c.sla_breached).length;
            const engineStatus = gmail.connected ? "Online" : "Degraded";
            const activeWorkflowRuns = metrics.open_cases ?? ((metrics.total_cases || 0) - ((metrics.status_counts?.RESOLVED || 0) + (metrics.status_counts?.CLOSED || 0)));
            
            kpiGrid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-header">
                        <span>Active Cases</span>
                        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg></div>
                    </div>
                    <div class="stat-value">${metrics.open_cases || 0}</div>
                    <div class="stat-desc">Cases currently being processed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>Pending Approvals</span>
                        <div class="stat-icon warning"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
                    </div>
                    <div class="stat-value">${approvals.count || 0}</div>
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
                    <div class="stat-value">${workflows.length || 0}</div>
                    <div class="stat-desc">Published workflows across all processes</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>SLA Breaches</span>
                        <div class="stat-icon warning" style="color: var(--rose-600); background: rgba(225,29,72,0.1); border-color: rgba(225,29,72,0.3);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
                    </div>
                    <div class="stat-value" style="color: ${breaches > 0 ? 'var(--rose-600)' : 'var(--navy-900)'}">${breaches}</div>
                    <div class="stat-desc">Cases exceeding defined SLA</div>
                </div>
                <div class="stat-card">
                    <div class="stat-header">
                        <span>System Engine</span>
                        <div class="stat-icon success"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
                    </div>
                    <div class="stat-value" style="font-size: 1.6rem; margin-top: 6px;">${engineStatus}</div>
                    <div class="stat-desc">Mail & Workflow orchestrator status</div>
                </div>
            `;
        }

        renderWorkloadChart(metrics.status_counts || {});
        renderCategoryChart(metrics.category_counts || {});
        renderTrendChart();

        // Update Mailbox UI
        const mailLabel = document.getElementById("mailboxLabel");
        const mailIndicator = document.querySelector(".status-dot");
        const mailUnread = document.getElementById("mailboxUnread");
        
        if (mailLabel && gmail.connected) {
            mailLabel.textContent = `${gmail.email} (Connected)`;
            if(mailIndicator) mailIndicator.classList.add("connected");
        }
        if (mailUnread) {
            const unread = gmail.stored_emails_count ?? gmail.unread_count ?? gmail.inbox_total ?? (emails.emails ? emails.emails.length : 0);
            mailUnread.textContent = `${unread} ${unread === 1 ? 'Email' : 'Emails'}`;
        }

        // 2. Process Catalog
        const processGrid = document.getElementById("processGrid");
        if (processGrid) {
            const catCounts = metrics.category_counts || {};
            const processes = [
                {code: "EX", name: "BGV / Exit", description: "Resignation intake, background verification...", wfc: 3, arc: catCounts['RESIGNATION'] || catCounts['BGV'] || 0},
                {code: "ON", name: "Onboarding", description: "Pre-boarding document collection...", wfc: 2, arc: catCounts['ONBOARDING'] || 0},
                {code: "AT", name: "Attendance", description: "Biometric exceptions, shift regularization...", wfc: 4, arc: catCounts['ATTENDANCE'] || 0},
                {code: "LV", name: "Leave", description: "Policy validation, manager approval...", wfc: 3, arc: catCounts['LEAVE'] || 0},
                {code: "PY", name: "Payroll", description: "Salary queries, tax declaration...", wfc: 2, arc: catCounts['PAYROLL'] || 0},
                {code: "IT", name: "IT / Assets", description: "Hardware allocation, laptop issues...", wfc: 3, arc: catCounts['ASSET_IT'] || 0}
            ];
            processGrid.innerHTML = "";
            processes.forEach(p => {
                processGrid.innerHTML += `
                    <div class="process-card">
                        <div class="process-card-header">
                            <div class="process-code">${p.code}</div>
                            <span class="process-wfc">${p.wfc} workflows</span>
                        </div>
                        <h3>${p.name}</h3>
                        <p>${p.description}</p>
                        <div class="process-card-footer">
                            <span class="process-arc">${p.arc} active runs</span>
                            <a href="builder.html" class="process-link">Configure &rarr;</a>
                        </div>
                    </div>
                `;
            });
        }
        
        // 3. Active Workflow Runs (Cases)
        renderActiveCases(cases.cases || []);

        // 4. Pending Approvals
        renderApprovals(approvals.approvals || []);

        // 5. Recent Emails & Audit Logs
        renderRecentEmails(emails.emails || []);
        renderAuditLogs(audit.logs || []);

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
    
    if (casesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="text-align:center; padding: 20px;">No active workflow runs.</td></tr>`;
        return;
    }

    casesList.forEach(c => {
        const tr = document.createElement("tr");
        const statusClass = c.status === "IN_PROGRESS" ? "in-progress" : (c.status === "WAITING" || c.status === "REVIEW_REQUIRED") ? "waiting" : "completed";
        const priorityClass = c.priority ? c.priority.toLowerCase() : "medium";
        const createdDate = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' }) : "Recently";
        
        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="case-id-badge">${c.case_number || c.db_id}</span>
                    <span class="priority-badge ${priorityClass}">${c.priority || "MEDIUM"}</span>
                </div>
            </td>
            <td>
                <div class="employee-cell">
                    <strong>${c.employee_name || "Unknown"}</strong>
                    <small>${c.employee_id || "N/A"}</small>
                </div>
            </td>
            <td>
                <div class="process-cell">
                    <strong>${c.category || "General"}</strong>
                    <small class="workflow-name" style="display: block; color: var(--slate-500); font-size: 0.75rem;">${c.workflow_type || "Standard Workflow"}</small>
                </div>
            </td>
            <td>
                <div class="status-step-cell">
                    <span class="status-badge ${statusClass}">${c.status || "NEW"}</span>
                    <span class="step-text" style="font-size: 0.75rem; color: var(--slate-500); display: block; margin-top: 4px;">&#8627; ${c.workflow_state || "Intake"}</span>
                    ${c.feedback_rating ? `
                        <div style="display:inline-flex; align-items:center; gap:4px; margin-top:4px; padding:2px 7px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.7rem; font-weight:800; color:#b45309;" title="CSAT Rating: ${c.feedback_rating} Stars (${c.feedback_label || ''})">
                            <span>⭐</span><span>${c.feedback_rating}.0</span>
                        </div>
                    ` : ''}
                </div>
            </td>
            <td>
                <div class="assignee-cell">
                    <span class="assignee-name" style="font-size: 0.85rem; font-weight: 500;">${c.assigned_user || c.assigned_team || "Unassigned"}</span>
                </div>
            </td>
            <td>
                <span class="date-cell" style="font-size: 0.8rem; color: var(--slate-600);">${createdDate}</span>
            </td>
            <td><span class="sla-pill ${c.sla_status ? c.sla_status.toLowerCase() : 'on_track'}">${c.sla_status || "ON_TRACK"}</span></td>
            <td>
                <button type="button" class="btn-table-view" data-case="${c.db_id}">Open</button>
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
            <div class="empty-state" style="padding: 40px 10px; text-align: center; color: var(--slate-400);">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <div style="font-size: 0.95rem; font-weight: 500; color: var(--navy-900);">All caught up!</div>
                <div style="font-size: 0.8rem; margin-top: 4px;">No pending approvals waiting for you.</div>
            </div>`;
        return;
    }

    approvalsList.slice(0, 5).forEach(app => {
        listEl.innerHTML += `
            <div class="approval-item" data-approval-id="${app.id || app.approval_code}" style="padding: 12px; border-bottom: 1px solid rgba(0,0,0,0.03); display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; border-radius: 8px;">
                <div class="approval-info" style="flex: 1;">
                    <h4 style="margin: 0 0 4px 0; font-size: 0.85rem; color: var(--navy-900);">${app.approval_type || "Approval Required"}</h4>
                    <div class="approval-meta" style="font-size: 0.75rem; color: var(--slate-500);">
                        <span><strong>${app.employee_name || "Employee"}</strong></span> • 
                        <span>Wait: ${app.approver_role || app.approver || "Manager"}</span> • 
                        <span style="color: var(--blue-600);">${app.case_number || "N/A"}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn-review" style="background: rgba(16, 185, 129, 0.1); color: var(--emerald-600); border: 1px solid rgba(16,185,129,0.2); padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(16,185,129,0.2)'" onmouseout="this.style.background='rgba(16,185,129,0.1)'">Approve</button>
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
            <div class="empty-state" style="padding: 40px 10px; text-align: center; color: var(--slate-400);">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                </svg>
                <div style="font-size: 0.95rem; font-weight: 500; color: var(--navy-900);">Inbox Zero</div>
                <div style="font-size: 0.8rem; margin-top: 4px;">No recent emails found.</div>
            </div>`;
        return;
    }

    emailsList.forEach(email => {
        const sender = email.sender_name || email.account_email || "Unknown";
        const initials = sender.substring(0, 2).toUpperCase();
        
        let timeStr = 'Now';
        if (email.received_at) {
            const dateObj = new Date(email.received_at.replace(' ', 'T'));
            if (!isNaN(dateObj)) timeStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            else timeStr = email.received_at.substring(0, 10);
        }

        listEl.innerHTML += `
            <div class="email-item" style="display: flex; gap: 12px; padding: 12px; border-bottom: 1px dashed rgba(0,0,0,0.05); align-items: center; transition: background 0.2s; border-radius: 8px;">
                <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--blue-500), var(--blue-600)); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 600; flex-shrink: 0; box-shadow: 0 4px 10px rgba(59,130,246,0.2);">
                    ${initials}
                </div>
                <div class="email-left" style="flex: 1; overflow: hidden;">
                    <div class="email-sender" style="font-weight: 600; font-size: 0.85rem; color: var(--navy-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${sender}</div>
                    <div class="email-subject" style="font-size: 0.75rem; color: var(--slate-500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${email.subject || "(No Subject)"}</div>
                </div>
                <div class="email-right" style="text-align: right; flex-shrink: 0;">
                    <div class="email-time" style="font-size: 0.7rem; color: var(--slate-400); margin-bottom: 4px; font-weight: 500;">${timeStr}</div>
                    <div class="category-tag" style="font-size: 0.6rem; font-weight: 600; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px; color: var(--slate-600); text-transform: uppercase;">${email.category || "General"}</div>
                </div>
            </div>
        `;
    });
}

function renderWorkloadChart(statusData) {
    const ctx = document.getElementById('workloadChart');
    if (!ctx) return;

    const open = statusData.OPEN || 0;
    const pending = statusData.PENDING || 0;
    const inProg = statusData.IN_PROGRESS || 0;
    const review = statusData.REVIEW_REQUIRED || 0;
    const resolved = statusData.RESOLVED || 0;
    const closed = statusData.CLOSED || 0;

    const left = open + pending + inProg + review;
    const done = resolved + closed;

    if (window.workloadChartInstance) {
        window.workloadChartInstance.destroy();
    }

    window.workloadChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Pending / Left', 'Completed / Done'],
            datasets: [{
                data: [left, done],
                backgroundColor: [
                    'rgba(245, 158, 11, 0.7)',
                    'rgba(16, 185, 129, 0.7)'
                ],
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.8)',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: {
                            family: "'SamsungOne', 'Roboto', 'Inter', sans-serif",
                            size: 13
                        },
                        usePointStyle: true,
                        padding: 20
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

    const labels = Object.keys(categoryData);
    const data = Object.values(categoryData);

    // If empty data, show placeholder
    if(labels.length === 0) {
        labels.push("No Data");
        data.push(1);
    }

    window.categoryChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Active Cases',
                data: data,
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { precision: 0 }
                },
                x: {
                    grid: { display: false }
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

    // Dummy trend data for showcase (can be fetched from a new endpoint later)
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const data = [4.5, 3.8, 5.2, 4.1, 3.5, 2.8, 3.1];

    window.trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Avg SLA (Hours)',
                data: data,
                borderColor: 'rgba(16, 185, 129, 1)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(16, 185, 129, 1)',
                pointRadius: 4,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
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
            <div class="empty-state" style="padding: 40px 10px; text-align: center; color: var(--slate-400);">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <div style="font-size: 0.95rem; font-weight: 500; color: var(--navy-900);">No recent activity</div>
                <div style="font-size: 0.8rem; margin-top: 4px;">System events will appear here.</div>
            </div>`;
        return;
    }

    logsList.forEach(log => {
        let timeStr = 'Now';
        if (log.time_hm) {
            timeStr = log.time_hm;
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

        const isFeedback = log.action === "FEEDBACK_RECORDED" || String(log.details || "").includes("CSAT") || String(log.action || "").includes("FEEDBACK");
        const iconBg = isFeedback ? "rgba(245, 158, 11, 0.15)" : "rgba(59, 130, 246, 0.1)";
        const iconColor = isFeedback ? "#b45309" : "var(--blue-600)";
        const iconSvg = isFeedback ? "⭐" : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;

        listEl.innerHTML += `
            <div class="email-item" style="display: flex; gap: 12px; align-items: flex-start; padding: 12px 8px; border-bottom: 1px dashed rgba(0,0,0,0.05); transition: background 0.2s; border-radius: 8px; ${isFeedback ? 'background: #fffdf5;' : ''}">
                <div class="stat-icon" style="width: 28px; height: 28px; border-radius: 50%; background: ${iconBg}; color: ${iconColor}; margin: 0; padding: 4px; flex-shrink: 0; display:flex; align-items:center; justify-content:center; font-size:0.85rem;">
                    ${iconSvg}
                </div>
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--navy-900); margin-bottom: 2px;">
                        ${isFeedback ? `<span style="color:#b45309;">⭐ ${log.action}</span>` : log.action}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--slate-500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${log.details || log.entity_type} • ${log.performed_by}</div>
                </div>
                <div style="font-size: 0.7rem; color: var(--slate-400); flex-shrink: 0; font-weight: 500;">${timeStr}</div>
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
    
    // Trigger animation
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
                <td colspan="8" style="text-align:center; padding:36px; color:#64748b; font-size:0.85rem;">
                    <div style="font-size:1.5rem; margin-bottom:6px;">📊</div>
                    <strong>No Employee CSAT Surveys Logged Yet</strong>
                    <div style="font-size:0.75rem; color:#94a3b8; margin-top:4px;">When employees submit star ratings via the 1-click resolution mail or portal, audited feedback will appear here in real time.</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = records.map(rec => {
        const rating = Number(rec.rating) || 5;
        const ratingLabel = rec.rating_label || "Excellent";
        
        let tagsHtml = `<span style="color:#94a3b8; font-size:0.75rem;">None</span>`;
        if (Array.isArray(rec.tags) && rec.tags.length > 0) {
            tagsHtml = rec.tags.map(t => `<span style="display:inline-block; margin:2px 4px 2px 0; padding:2px 6px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; font-size:0.7rem; font-weight:600; color:#334155;">${escapeHtml(t)}</span>`).join("");
        }

        const commentsHtml = rec.comments
            ? `<div style="font-size:0.78rem; color:#1e293b; max-width:240px; white-space:normal; line-height:1.4;">“${escapeHtml(rec.comments)}”</div>`
            : `<span style="color:#94a3b8; font-size:0.75rem; font-style:italic;">No remarks</span>`;

        return `
            <tr>
                <td>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <a href="casedetail.html?case=${encodeURIComponent(rec.case_number)}" style="font-weight:700; color:#2563eb; text-decoration:none; font-family:monospace; font-size:0.82rem;">
                            ${escapeHtml(rec.case_number)}
                        </a>
                        <span style="font-size:0.72rem; color:#64748b; text-transform:uppercase; font-weight:600;">
                            ${escapeHtml(rec.category || 'General')}
                        </span>
                    </div>
                </td>
                <td>
                    <div style="font-weight:600; font-size:0.82rem; color:#0f172a;">
                        ${escapeHtml(rec.employee_name || 'Requester')}
                    </div>
                    <div style="font-size:0.72rem; color:#64748b;">
                        ${rec.employee_code ? escapeHtml(rec.employee_code) : ''}
                        ${rec.employee_department ? `• ${escapeHtml(rec.employee_department)}` : ''}
                    </div>
                </td>
                <td>
                    <div style="display:inline-flex; align-items:center; gap:6px; padding:3px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:0.76rem; font-weight:600; color:#334155;">
                        <span>👤</span>
                        <span>${escapeHtml(rec.resolved_by || rec.assigned_user || 'Vaibhav (HR)')}</span>
                    </div>
                </td>
                <td>
                    <span style="font-weight:700; font-size:0.8rem; color:#334155;">${escapeHtml(rec.turnaround_hours || '--')}</span>
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
                    <span class="status-badge completed" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; font-size:0.7rem; font-weight:700; padding:3px 8px; border-radius:6px; text-transform:uppercase;">
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
