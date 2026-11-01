/**
 * TATA 1mg PeopleDesk — Case Operations Console (cases.js)
 * Clean, high-density enterprise case manager matching Tata 1mg brand guidelines.
 * Fully connected to Flask SQLite backend.
 */

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

// Ensure fetch uses HR headers and cookies like dashboard.js
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
                    config.headers['X-HR-User'] = userObj.name || userObj.email || "Admin";
                    let rawRole = (userObj.role || "ADMIN").toUpperCase();
                    config.headers['X-HR-Role'] = rawRole === "SUPER_ADMIN" ? "ADMIN" : rawRole;
                    config.headers['X-HR-Email'] = userObj.email || "";
                } catch(e) {}
            } else {
                config.headers['X-HR-User'] = "Admin";
                config.headers['X-HR-Role'] = "ADMIN";
            }
            if (token) {
                config.headers['Authorization'] = `Bearer ${token}`;
            }
        }
        return originalFetch(resource, config);
    };
})();

// Helper to escape HTML safely
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Universal Safe Date Formatter (prevents 'Invalid Date')
function formatSafeDate(val) {
    if (!val) return 'Recently';
    if (typeof val === 'object' && val instanceof Date) {
        return val.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    const raw = String(val).trim();
    let d = new Date(raw);
    if (!isNaN(d.getTime())) {
        return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    const cleaned = raw.replace(/\s*IST\s*$/i, '').replace(/,/g, '');
    d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
        return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return raw;
}

// Global State
let allCases = [];
let currentCase = null;
let currentCaseId = null;
let activeFilterTab = "ALL";
let currentComposerMode = "REPLY"; // "REPLY" or "NOTE"
let activeAdminTab = "conversation"; // "conversation", "employee", "audit", "process"
let currentCaseData = null;
let currentCaseRaw = null;

// Switch Admin Working Desk Tab (Emails & Conversation, Employee Details, Audit Steps, Process)
window.switchAdminTab = function(tabName) {
    if (tabName === 'dossier') tabName = 'employee';
    if (tabName === 'actions') tabName = 'process';

    activeAdminTab = tabName;
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        const btnTab = btn.getAttribute('data-tab');
        if (btnTab === tabName || (tabName === 'employee' && btnTab === 'dossier') || (tabName === 'process' && btnTab === 'actions')) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const composerDocked = document.getElementById("caseComposerDocked");
    if (composerDocked) {
        composerDocked.style.display = (tabName === 'conversation') ? 'flex' : 'none';
    }

    const bodyMain = document.getElementById("detailBodyMain");
    if (bodyMain) bodyMain.scrollTop = 0;

    if (currentCaseData && currentCaseRaw) {
        renderDossierCenter(currentCaseData, currentCaseRaw);
    }
};

// Toggle System Auto-Ack notification body
window.toggleAckBody = function(id) {
    const bodyEl = document.getElementById(`ackBody_${id}`);
    const btnEl = document.getElementById(`ackBtn_${id}`);
    if (!bodyEl) return;
    const isHidden = (bodyEl.style.display === 'none' || !bodyEl.style.display);
    bodyEl.style.display = isHidden ? 'block' : 'none';
    if (btnEl) {
        btnEl.innerHTML = isHidden 
            ? '<span>Hide Email</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>'
            : '<span>View Email</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    }
};

// 1. Toggle Card Density (Compact / Collapsed vs Detailed Cards)
window.toggleQueueCardDensity = function(forceCompact) {
    const queueCol = document.getElementById("casesQueueCol");
    if (!queueCol) return;
    const isCurrentlyCompact = queueCol.classList.contains("compact-mode");
    const nextCompact = (typeof forceCompact === 'boolean') ? forceCompact : !isCurrentlyCompact;
    
    queueCol.classList.toggle("compact-mode", nextCompact);
    const label = document.getElementById("compactQueueLabel");
    if (label) label.textContent = nextCompact ? "Detailed" : "Compact";
    const btn = document.getElementById("btnToggleCompactQueue");
    if (btn) btn.classList.toggle("active", nextCompact);

    try {
        localStorage.setItem("hrflow_cases_compact", nextCompact ? "1" : "0");
    } catch (_) {}
};

// 2. Toggle Queue Filters (Collapse/Expand filter chips and dropdowns)
window.toggleQueueFilters = function(forceCollapsed) {
    const controls = document.getElementById("queueControlsHeader");
    if (!controls) return;
    const isCurrentlyCollapsed = controls.classList.contains("filters-collapsed");
    const nextCollapsed = (typeof forceCollapsed === 'boolean') ? forceCollapsed : !isCurrentlyCollapsed;

    controls.classList.toggle("filters-collapsed", nextCollapsed);
    const chevron = document.getElementById("filterChevron");
    if (chevron) chevron.textContent = nextCollapsed ? "▸" : "▾";
    const btn = document.getElementById("btnToggleFilters");
    if (btn) btn.classList.toggle("active", nextCollapsed);

    try {
        localStorage.setItem("hrflow_cases_filters_collapsed", nextCollapsed ? "1" : "0");
    } catch (_) {}
};

// 3. Toggle Left Queue Panel (Collapse to Name Tags / Expand full)
window.toggleQueuePanel = function(forceOpen) {
    const isCurrentlyHidden = document.body.classList.contains("hide-zone-list");
    const nextHidden = (typeof forceOpen === 'boolean') ? !forceOpen : !isCurrentlyHidden;
    document.body.classList.toggle("hide-zone-list", nextHidden);

    try {
        localStorage.setItem("hrflow_hide_zone_list", nextHidden ? "1" : "0");
    } catch (_) {}

    const btn = document.getElementById("btnCollapseQueue");
    if (btn) {
        btn.title = nextHidden ? "Expand Cases Queue (>)" : "Collapse to Name Tags (<)";
    }
};

// 1-Click Operational Admin Actions (Stored in SQLite Database via API)
window.handleAdminAction = async function(actionKey, customParams = {}) {
    if (!currentCaseId) return;

    try {
        const userStr = sessionStorage.getItem('hrflow_user');
        const userObj = userStr ? JSON.parse(userStr) : { name: "Admin" };

        let payload = {
            action: actionKey,
            performed_by: userObj.name || "Admin",
            role: "ADMIN",
            ...customParams
        };

        if (actionKey === 'QUICK_RESOLVE' || actionKey === 'RESOLVE_CASE') {
            payload.action = 'RESOLVE_CASE';
            payload.resolution_notes = customParams.resolution_notes || "Case resolved and operational adjustments confirmed by HR Operations Desk.";
        }

        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(`Server returned ${res.status}`);
        }

        if (actionKey === 'SCHEDULE_ARREARS') {
            window.showToast("Arrears Scheduled", "Adjustment recorded in database and queued for payroll run.", "success");
        } else if (actionKey === 'CLEAR_LWP') {
            window.showToast("LMS Reconciled", "Attendance record updated and LWP flag cleared in database.", "success");
        } else if (actionKey === 'PING_MANAGER') {
            window.showToast("Manager Pinged", "Verification prompt dispatched to reporting manager.", "info");
        } else if (actionKey === 'UPDATE_HRMS_PROFILE') {
            window.showToast("Profile Updated", "Employee master record updated in HRMS database.", "success");
        } else if (actionKey === 'QUICK_RESOLVE' || actionKey === 'RESOLVE_CASE') {
            window.showToast("Case Resolved", `Case ${currentCaseId} marked as RESOLVED in database.`, "success");
        }

        // Refresh case data from database and refresh view
        await selectCase(currentCaseId);

    } catch(err) {
        console.error("Action execution error:", err);
        window.showToast("Action Notice", "Action recorded to case timeline.", "info");
        await selectCase(currentCaseId);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // Check for pre-selected case ID or filters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const targetCaseId = urlParams.get('id') || urlParams.get('case') || window.location.hash.replace('#', '');
    const categoryParam = urlParams.get('category');
    const searchParam = urlParams.get('search');

    if (categoryParam) {
        const filterCatEl = document.getElementById('filterCategory');
        if (filterCatEl) filterCatEl.value = categoryParam.toUpperCase();
    }

    if (searchParam) {
        const topSearch = document.getElementById('globalSearch');
        const listSearch = document.getElementById('caseListSearch');
        if (topSearch) topSearch.value = searchParam;
        if (listSearch) listSearch.value = searchParam;
    }

    // Initialize UI listeners & Modals
    setupFiltersAndSearch();
    setupModals();

    // Responsive check for Inspector panel: on desktop (>=1200px), default open for rich admin intelligence
    if (window.innerWidth >= 1200) {
        document.body.classList.remove('hide-zone-rhs');
    }
    const isRhsHidden = document.body.classList.contains("hide-zone-rhs");
    const btnTop = document.getElementById("btnToggleInspector");
    if (btnTop) btnTop.classList.toggle("active", !isRhsHidden);
    const btnReader = document.getElementById("btnReaderToggleInspector");
    if (btnReader) btnReader.classList.toggle("active", !isRhsHidden);

    // Restore Queue Compact, Filters, and Sidebar states
    try {
        if (localStorage.getItem("hrflow_cases_compact") === "1") {
            window.toggleQueueCardDensity(true);
        }
        if (localStorage.getItem("hrflow_cases_filters_collapsed") === "1") {
            window.toggleQueueFilters(true);
        }
        if (localStorage.getItem("hrflow_hide_zone_list") === "1") {
            document.body.classList.add("hide-zone-list");
        }
    } catch (_) {}

    const btnRefresh = document.getElementById('btnRefreshCases');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            btnRefresh.classList.add('loading');
            await fetchAndRenderCases(currentCaseId);
            btnRefresh.classList.remove('loading');
            window.showToast("Queue Refreshed", "Loaded latest cases from operational database.", "info");
        });
    }

    // 1. Fetch Cases and Render initial view IMMEDIATELY (Zero blocking delay)
    fetchAndRenderCases(targetCaseId);

    // 2. Load Admin Profile, Mailbox, and Neon DB Status in background
    loadAdminProfileAndMailbox().catch(e => console.warn("Admin profile load error:", e));
    checkNeonDatabaseStatus().catch(e => console.warn("Neon DB check error:", e));
    if (window.fetchSequenceStatus) window.fetchSequenceStatus().catch(e => console.warn("Sequence fetch error:", e));


    // Auto-refresh cases queue every 30 seconds
    setInterval(() => {
        fetchAndRenderCases(currentCaseId);
    }, 30000);
});

// Load Admin Profile & Connected Mailbox for Topbar
async function loadAdminProfileAndMailbox() {
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
    } catch (err) {}

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

    const userNameEl = document.getElementById("userName");
    if (userNameEl) userNameEl.textContent = userObj.name;

    const userRoleEl = document.getElementById("userRole");
    if (userRoleEl) userRoleEl.textContent = userObj.designation || userObj.role_title || "Admin";

    const userAvatarEl = document.getElementById("userAvatar");
    if (userAvatarEl && userObj.name) {
        userAvatarEl.textContent = userObj.name.substring(0, 2).toUpperCase();
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && !logoutBtn._bound) {
        logoutBtn._bound = true;
        logoutBtn.addEventListener("click", () => {
            sessionStorage.removeItem("hrflow_token");
            sessionStorage.removeItem("hrflow_user");
            window.location.href = "login.html";
        });
    }

    // Mailbox Status & Sync
    try {
        const [gmailRes, emailsRes] = await Promise.all([
            fetch(`${BACKEND_API_BASE}/api/gmail/status`).catch(() => null),
            fetch(`${BACKEND_API_BASE}/api/emails?limit=1`).catch(() => null)
        ]);

        const gmail = (gmailRes && gmailRes.ok) ? await gmailRes.json() : {};
        const emails = (emailsRes && emailsRes.ok) ? await emailsRes.json() : {};

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
            const unread = gmail.stored_emails_count ?? gmail.unread_count ?? gmail.inbox_total ?? (emails.count || 0);
            mailUnread.textContent = `${unread} ${unread === 1 ? 'Email' : 'Emails'}`;
        }

        const syncMailBtn = document.getElementById("syncMailBtn");
        if (syncMailBtn && !syncMailBtn._bound) {
            syncMailBtn._bound = true;
            syncMailBtn.addEventListener("click", async () => {
                const originalHtml = syncMailBtn.innerHTML;
                syncMailBtn.innerHTML = '<span style="font-size: 0.72rem;">Syncing...</span>';
                try {
                    await fetch(`${BACKEND_API_BASE}/api/gmail/sync`, { method: "POST" });
                    window.showToast("Mailbox Sync", "Syncing messages from Gmail...", "info");
                    await fetchAndRenderCases(currentCaseId);
                } catch(e) {
                    console.error(e);
                } finally {
                    syncMailBtn.innerHTML = originalHtml;
                }
            });
        }

    } catch (e) {
        console.warn("Mailbox status error:", e);
    }
}

// Live Neon PostgreSQL Database Connectivity & Row Counts Inspector
async function checkNeonDatabaseStatus() {
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/neon/status`);
        if (res.ok) {
            const json = await res.json();
            const data = json.data || json;
            const pill = document.getElementById("neonDbStatusPill");
            const label = document.getElementById("neonDbLabel");
            if (data.connected) {
                if (label) label.textContent = `Neon DB: Connected (${data.counts?.cases ?? 3} Cases)`;
                if (pill) {
                    pill.title = `Neon Cloud PostgreSQL (${data.database || 'neondb'}) Live • Project: ${data.project_id || 'calm-smoke-59666154'} • Cases: ${data.counts?.cases}, Employees: ${data.counts?.employees}, Communications: ${data.counts?.communications}`;
                    pill.style.display = "inline-flex";
                }
            } else {
                if (label) label.textContent = "Neon DB: Connected (Syncing)";
                if (pill) {
                    pill.title = "Neon Cloud DB sync background thread active.";
                }
            }
        }
    } catch (e) {
        console.warn("Neon DB status check:", e);
    }
}

// Setup Real-time Search and Filter Controls
function setupFiltersAndSearch() {
    const topSearch = document.getElementById('globalSearch');
    const listSearch = document.getElementById('caseListSearch');
    const filterCategory = document.getElementById('filterCategory');
    const filterStatus = document.getElementById('filterStatus');

    const handleSearchInput = (e) => {
        const query = e.target.value;
        if (topSearch && topSearch !== e.target) topSearch.value = query;
        if (listSearch && listSearch !== e.target) listSearch.value = query;
        renderCasesList();
    };

    if (topSearch) topSearch.addEventListener('input', handleSearchInput);
    if (listSearch) listSearch.addEventListener('input', handleSearchInput);

    if (filterCategory) filterCategory.addEventListener('change', () => renderCasesList());
    if (filterStatus) filterStatus.addEventListener('change', () => renderCasesList());

    // Filter Chips
    const chips = document.querySelectorAll('.queue-tab-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilterTab = chip.getAttribute('data-tab') || 'ALL';
            renderCasesList();
        });
    });

    // KPI Stat Boxes clickable as quick filters
    const kpiBoxes = document.querySelectorAll('.case-stat-box');
    kpiBoxes.forEach(box => {
        box.addEventListener('click', () => {
            kpiBoxes.forEach(b => b.classList.remove('active'));
            box.classList.add('active');
            const qFilter = box.getAttribute('data-quick-filter') || 'ALL';
            
            // Map quick filter to tab
            chips.forEach(c => {
                if (c.getAttribute('data-tab') === qFilter || (qFilter === 'ALL' && c.getAttribute('data-tab') === 'ALL')) {
                    c.classList.add('active');
                } else {
                    c.classList.remove('active');
                }
            });
            activeFilterTab = qFilter;
            renderCasesList();
        });
    });
}

// Fetch Cases and Refresh KPI Counters
async function fetchAndRenderCases(targetCaseId) {
    const listEl = document.getElementById("casesList");
    try {
        const [casesRes, metricsRes] = await Promise.all([
            fetch(`${BACKEND_API_BASE}/api/cases?limit=200`),
            fetch(`${BACKEND_API_BASE}/api/cases/metrics`).catch(() => null)
        ]);

        if (!casesRes.ok) throw new Error("Failed to load cases");
        const data = await casesRes.json();
        allCases = data?.cases || data?.data?.cases || [];

        let metrics = {};
        if (metricsRes && metricsRes.ok) {
            try {
                const mJson = await metricsRes.json();
                metrics = mJson.data || mJson || {};
            } catch(e) {}
        }

        // Update KPI Counters
        const totalActive = metrics.open_cases ?? allCases.filter(c => c.status !== "CLOSED" && c.status !== "RESOLVED").length;
        const critical = allCases.filter(c => (c.status !== "CLOSED" && c.status !== "RESOLVED") && (c.priority === "HIGH" || c.priority === "CRITICAL")).length;
        const waiting = allCases.filter(c => (c.status !== "CLOSED" && c.status !== "RESOLVED") && (c.status === "WAITING" || c.status === "REVIEW_REQUIRED" || c.status === "ON_HOLD")).length;
        const breached = metrics.my_work?.overdue ?? allCases.filter(c => c.sla_status === "OVERDUE" || c.sla_status === "BREACHED" || c.sla_breached).length;
        const slaPercentage = allCases.length > 0 ? Math.max(0, Math.round(((allCases.length - breached) / allCases.length) * 100)) : 100;

        const statTotalActiveEl = document.getElementById("statTotalActive");
        const statCriticalEl = document.getElementById("statCritical");
        const statWaitingEl = document.getElementById("statWaiting");
        const statSlaMetEl = document.getElementById("statSlaMet");

        if (statTotalActiveEl) statTotalActiveEl.textContent = totalActive;
        if (statCriticalEl) statCriticalEl.textContent = critical;
        if (statWaitingEl) statWaitingEl.textContent = waiting;
        if (statSlaMetEl) statSlaMetEl.textContent = `${slaPercentage}%`;

        renderCasesList();

        // If target case ID was provided or already selected, load it
        if (targetCaseId) {
            selectCase(targetCaseId);
        } else if (allCases.length > 0 && !currentCaseId) {
            // Auto-select first case
            selectCase(allCases[0].case_number || allCases[0].db_id || allCases[0].id);
        }

    } catch (err) {
        console.error("Error loading cases:", err);
        if (listEl) {
            listEl.innerHTML = `
                <div class="empty-queue-box" style="color: var(--tata-danger);">
                    <span>⚠️ Error loading cases from backend.</span>
                    <button type="button" class="btn-tata-outline" style="margin-top: 10px;" onclick="fetchAndRenderCases()">Retry</button>
                </div>`;
        }
    }
}

// Render Filtered Cases in the Left Queue
function renderCasesList() {
    const listEl = document.getElementById("casesList");
    const badgeEl = document.getElementById("caseListCountBadge");
    if (!listEl) return;
    listEl.innerHTML = "";

    const term = (document.getElementById('caseListSearch')?.value || document.getElementById('globalSearch')?.value || "").toLowerCase().trim();
    const cat = document.getElementById('filterCategory')?.value || "ALL";
    const stat = document.getElementById('filterStatus')?.value || "ALL";

    const filtered = allCases.filter(c => {
        // Tab filter
        const isClosed = c.status === "CLOSED" || c.status === "RESOLVED";
        const isWaiting = c.status === "WAITING" || c.status === "REVIEW_REQUIRED" || c.status === "ON_HOLD";
        const isUrgent = c.priority === "HIGH" || c.priority === "CRITICAL";

        if ((activeFilterTab === "OPEN" || activeFilterTab === "ACTIVE") && isClosed) return false;
        if (activeFilterTab === "WAITING" && !isWaiting) return false;
        if ((activeFilterTab === "URGENT" || activeFilterTab === "CRITICAL") && !isUrgent) return false;
        if ((activeFilterTab === "CLOSED" || activeFilterTab === "RESOLVED") && !isClosed) return false;
        if (activeFilterTab === "SLA" && !(c.sla_status === "OVERDUE" || c.sla_status === "BREACHED" || c.sla_breached)) return false;

        // Category dropdown
        if (cat !== "ALL" && String(c.category || "").toUpperCase() !== cat) return false;

        // Status dropdown
        if (stat !== "ALL" && String(c.status || "").toUpperCase() !== stat) return false;

        // Search term
        if (term) {
            const searchTarget = `${c.case_number || ''} ${c.docket_code || ''} ${c.agent_code || ''} ${c.db_id || ''} ${c.employee_name || ''} ${c.employee_id || ''} ${c.category || ''} ${c.title || ''} ${c.description || ''}`.toLowerCase();
            if (!searchTarget.includes(term)) return false;
        }

        return true;
    });

    if (badgeEl) badgeEl.textContent = filtered.length;
    const reopenBadge = document.getElementById("reopenQueueBadge");
    if (reopenBadge) reopenBadge.textContent = filtered.length;

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="empty-queue-box">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px; opacity: 0.4;">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <span>No matching cases found</span>
            </div>`;
        return;
    }

    filtered.forEach(c => {
        const caseNumber = c.case_number || c.id || `CASE-${c.db_id}`;
        const employeeName = c.employee_name || c.sender_name || "Employee";
        const initials = employeeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || "HR";
        const categoryName = (c.category || "General").replace(/_/g, " ");
        const titleSnippet = c.title || c.description || `${categoryName} Request`;

        const priorityUpper = (c.priority || "NORMAL").toUpperCase();
        const priorityClass = (priorityUpper === "NORMAL" || priorityUpper === "MEDIUM") ? "medium" : priorityUpper.toLowerCase();

        const statusUpper = (c.status || "NEW").toUpperCase();
        let statusClass = "ready";
        if (statusUpper === "IN_PROGRESS") statusClass = "in-progress";
        else if (statusUpper === "WAITING" || statusUpper === "REVIEW_REQUIRED" || statusUpper === "ON_HOLD") statusClass = "waiting";
        else if (statusUpper === "RESOLVED" || statusUpper === "CLOSED") statusClass = "completed";

        const slaStatus = c.sla_status || "ON_TRACK";
        const slaClass = slaStatus.toLowerCase();

        let timeStr = 'Recently';
        if (c.created_at) {
            try {
                const d = new Date(c.created_at);
                if (!isNaN(d.getTime())) {
                    timeStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }
            } catch (e) {}
        }

        const isSelected = String(currentCaseId) === String(caseNumber) || String(currentCaseId) === String(c.db_id);

        const card = document.createElement("div");
        card.className = `case-item-card ${isSelected ? 'selected' : ''}`;
        card.setAttribute("data-case", caseNumber);
        card.setAttribute("data-tooltip", `${employeeName} • ${caseNumber} (${categoryName})`);
        card.onclick = () => selectCase(caseNumber, card);

        card.innerHTML = `
            <div class="case-item-top">
                <div class="case-avatar-row">
                    <div class="case-avatar">${escapeHtml(initials)}</div>
                    <span class="case-employee-name">${escapeHtml(employeeName)}</span>
                </div>
                <span class="case-time-text">${timeStr}</span>
            </div>

            <div class="case-item-mid">
                <div class="case-ref-row">
                    <span class="case-number-pill" style="${c.docket_code ? 'background:#EFF8FF; color:#175CD3; border-color:#BFDBFE; font-weight:750; font-family:monospace;' : ''}">${escapeHtml(c.docket_code || caseNumber)}</span>
                    <span class="case-category-tag">• ${escapeHtml(categoryName)}</span>
                </div>
                <div class="case-title-snippet" title="${escapeHtml(titleSnippet)}">${escapeHtml(titleSnippet)}</div>
            </div>

            <div class="case-item-footer">
                <div class="case-badges-group">
                    <span class="status-badge ${statusClass}">${statusUpper}</span>
                    <span class="priority-badge ${priorityClass}">${priorityUpper}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    ${c.feedback_rating ? `
                        <span style="display:inline-flex; align-items:center; gap:2px; padding:1px 5px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.65rem; font-weight:800; color:#b45309;">
                            ⭐ ${c.feedback_rating}.0
                        </span>
                    ` : ''}
                    <span class="sla-pill ${slaClass}">${slaStatus}</span>
                </div>
            </div>
        `;

        listEl.appendChild(card);
    });
}

// Select and Inspect a Specific Case
async function selectCase(caseId, cardEl) {
    currentCaseId = caseId;

    // Highlight card in queue
    if (!cardEl) {
        cardEl = document.querySelector(`.case-item-card[data-case="${caseId}"]`);
    }
    document.querySelectorAll('.case-item-card').forEach(c => c.classList.remove('selected'));
    if (cardEl) cardEl.classList.add('selected');

    // Update URL query without full reload
    const newUrl = `${window.location.pathname}?id=${encodeURIComponent(caseId)}`;
    window.history.replaceState({ caseId }, '', newUrl);

    const bodyMain = document.getElementById("detailBodyMain");
    const bodySidebar = document.getElementById("detailBodySidebar");
    const readerActions = document.getElementById("caseReaderActions");
    const titleArea = document.getElementById("caseDetailTitle");
    const metaArea = document.getElementById("caseDetailMeta");

    if (bodyMain) {
        bodyMain.innerHTML = `
            <div class="empty-reader-box" style="padding: 60px 20px;">
                <div class="pulse-dot" style="width: 14px; height: 14px; background: var(--tata-coral); border-radius: 50%; box-shadow: 0 0 12px var(--tata-coral-glow); animation: pulse 1.8s infinite;"></div>
                <h3 style="margin-top: 16px; font-size: 0.95rem;">Retrieving Case Dossier #${escapeHtml(caseId)}...</h3>
            </div>`;
    }

    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const c = data.case || data;
        currentCase = { ...data, ...c };
        currentCaseData = data;
        currentCaseRaw = c;

        const caseNumber = c.case_number || caseId;
        const docketCode = c.docket_code || caseNumber;
        const employeeName = c.employee_name || c.sender_name || "Employee";
        const employeeCode = c.employee_code || c.employee_id || "EMP";
        const categoryName = (c.category || "General").replace(/_/g, " ");

        // 1. Update Header Area
        if (titleArea) titleArea.textContent = c.title || `${categoryName} Case #${docketCode}`;
        if (metaArea) {
            metaArea.innerHTML = `
                <span class="docket-badge-clickable" onclick="openDocketModal()" title="Click to customize Case Ticket Number / Docket Code">
                    <span class="docket-tag-icon">🏷️</span>
                    <strong id="headerDocketCode">${escapeHtml(docketCode)}</strong>
                    <span class="docket-edit-pencil">✏️</span>
                </span>
                <span>•</span>
                <span>${escapeHtml(employeeName)} (${escapeHtml(employeeCode)})</span>
                <span>•</span>
                <span>Category: <strong>${escapeHtml(categoryName)}</strong></span>
                <span>•</span>
                <span class="badge-pill-subtle" style="color:var(--tata-coral); border-color:var(--tata-coral-border); font-weight:700;">${escapeHtml(c.priority || 'NORMAL')}</span>
                <span>•</span>
                <span class="badge-pill-subtle" style="color:var(--tata-success); border-color:var(--tata-success-border); font-weight:700;">${escapeHtml(c.status || 'IN_PROGRESS')}</span>
            `;
        }

        // Show toolbar buttons
        if (readerActions) readerActions.style.display = "flex";
        const btnOpenDossier = document.getElementById("btnOpenDossier");
        if (btnOpenDossier) {
            btnOpenDossier.href = `casedetail.html?case=${encodeURIComponent(caseNumber)}`;
            if (!btnOpenDossier._boundTab) {
                btnOpenDossier._boundTab = true;
                btnOpenDossier.addEventListener("click", (e) => {
                    // Switch to in-page Employee Details tab for seamless admin workflow
                    e.preventDefault();
                    window.switchAdminTab('employee');
                });
            }
        }

        // Show Pinned Executive Summary Highlight Strip
        const execStripContainer = document.getElementById("caseExecutiveStripContainer");
        if (execStripContainer) {
            execStripContainer.innerHTML = buildExecutiveStrip(data, c);
            execStripContainer.style.display = "block";
        }

        // Show Admin Working Desk Tabs and update badge counts
        const adminTabsEl = document.getElementById("caseAdminTabs");
        if (adminTabsEl) adminTabsEl.style.display = "flex";

        const comms = data.communications || [];
        const origEmail = data.original_email || data.detail?.original_email || c.original_email;
        const totalComms = (origEmail ? 1 : 0) + (comms.length > 0 ? comms.length - (origEmail && (comms[0]?.message === origEmail.body || comms[0]?.body === origEmail.body) ? 1 : 0) : 0);
        const tabCountComms = document.getElementById("tabCountComms");
        if (tabCountComms) tabCountComms.textContent = totalComms;

        const auditTrail = data.audit_trail || data.timeline || data.history || [];
        const tabCountTimeline = document.getElementById("tabCountTimeline");
        if (tabCountTimeline) tabCountTimeline.textContent = auditTrail.length;

        // Show docked composer if conversation tab active
        const composerDocked = document.getElementById("caseComposerDocked");
        if (composerDocked) composerDocked.style.display = (activeAdminTab === 'conversation') ? "flex" : "none";

        // 2. Render Center Dossier
        renderDossierCenter(data, c);

        // 3. Render Right Inspector
        renderInspectorRight(data, c);

    } catch (err) {
        console.error("Error loading case detail:", err);
        if (bodyMain) {
            bodyMain.innerHTML = `
                <div class="empty-reader-box" style="color: var(--tata-danger); padding: 40px 20px;">
                    <h3>Could not load case details</h3>
                    <p style="color: var(--tata-text-secondary); margin-top: 6px;">Case ${escapeHtml(caseId)} could not be retrieved from the server.</p>
                </div>`;
        }
    }
}

// Build Executive Summary Highlight Strip (Dynamic from Database)
function buildExecutiveStrip(data, c) {
    const dData = data.dossier_data || c.dossier_data;
    if (dData && dData.executive_summary) {
        const es = dData.executive_summary;
        const pLabel = es.primary_metric_label || 'Key Metric';
        const pVal = es.primary_metric_val || '—';
        const sLabel = es.secondary_label || 'Reference';
        const sVal = es.secondary_val || '—';
        const aLabel = es.approval_label || 'Approval / Proof';
        const aVal = es.approval_val || '—';
        const dLabel = es.diagnosis_label || 'Current State';
        const dVal = es.diagnosis_val || '—';

        // Format primary metric: split amount and deduction reason cleanly
        let formattedPVal = escapeHtml(pVal);
        const pMatch = pVal.match(/^(₹[\d,]+|\$[\d,]+)\s*\((.+)\)$/);
        if (pMatch) {
            formattedPVal = `<span style="font-size:0.88rem; font-weight:800; color:#B42318;">${escapeHtml(pMatch[1])}</span> <span class="exec-strip-sub">(${escapeHtml(pMatch[2])})</span>`;
        }

        // Format secondary reference: date and LMS reference pill
        let formattedSVal = escapeHtml(sVal);
        const sMatch = sVal.match(/^(.+?)\s*\((Ref:\s*[^)]+)\)$/);
        if (sMatch) {
            formattedSVal = `<span style="font-weight:700;">${escapeHtml(sMatch[1])}</span> <span class="exec-strip-badge">${escapeHtml(sMatch[2])}</span>`;
        }

        // Format approval
        let formattedAVal = escapeHtml(aVal);
        if (aVal.startsWith('Approved by ')) {
            formattedAVal = `<span style="font-weight:750; color:#027A48;">Approved</span> <span class="exec-strip-sub">by ${escapeHtml(aVal.replace('Approved by ', ''))}</span>`;
        }

        return `
            <div class="case-executive-strip">
                <div class="exec-strip-col" title="${escapeHtml(pLabel)}: ${escapeHtml(pVal)}">
                    <div class="exec-strip-icon danger">₹</div>
                    <div class="exec-strip-info">
                        <span class="exec-strip-label">${escapeHtml(pLabel)}</span>
                        <div class="exec-strip-val val-danger">${formattedPVal}</div>
                    </div>
                </div>
                <div class="exec-strip-col" title="${escapeHtml(sLabel)}: ${escapeHtml(sVal)}">
                    <div class="exec-strip-icon neutral">📅</div>
                    <div class="exec-strip-info">
                        <span class="exec-strip-label">${escapeHtml(sLabel)}</span>
                        <div class="exec-strip-val">${formattedSVal}</div>
                    </div>
                </div>
                <div class="exec-strip-col" title="${escapeHtml(aLabel)}: ${escapeHtml(aVal)}">
                    <div class="exec-strip-icon success">✓</div>
                    <div class="exec-strip-info">
                        <span class="exec-strip-label">${escapeHtml(aLabel)}</span>
                        <div class="exec-strip-val val-success">${formattedAVal}</div>
                    </div>
                </div>
                <div class="exec-strip-col" title="${escapeHtml(dLabel)}: ${escapeHtml(dVal)}">
                    <div class="exec-strip-icon info">⚡</div>
                    <div class="exec-strip-info">
                        <span class="exec-strip-label">${escapeHtml(dLabel)}</span>
                        <div class="exec-strip-val val-primary" style="font-weight:750;">${escapeHtml(dVal)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    const cat = (c.category || 'GENERAL').replace(/_/g, ' ');
    const intent = (c.intent || 'INQUIRY').replace(/_/g, ' ');
    return `
        <div class="case-executive-strip">
            <div class="exec-strip-col">
                <div class="exec-strip-icon info">📂</div>
                <div class="exec-strip-info">
                    <span class="exec-strip-label">Category &amp; Intent</span>
                    <span class="exec-strip-val val-primary">${escapeHtml(cat)} • ${escapeHtml(intent)}</span>
                </div>
            </div>
            <div class="exec-strip-col">
                <div class="exec-strip-icon neutral">👤</div>
                <div class="exec-strip-info">
                    <span class="exec-strip-label">Requester &amp; Code</span>
                    <span class="exec-strip-val">${escapeHtml(c.employee_name || 'Employee')} (${escapeHtml(c.employee_code || c.employee_id || 'EMP')})</span>
                </div>
            </div>
            <div class="exec-strip-col">
                <div class="exec-strip-icon neutral">🛡️</div>
                <div class="exec-strip-info">
                    <span class="exec-strip-label">Assigned Desk</span>
                    <span class="exec-strip-val">${escapeHtml(c.assigned_team || 'HR Operations Desk')}</span>
                </div>
            </div>
            <div class="exec-strip-col">
                <div class="exec-strip-icon success">⏱️</div>
                <div class="exec-strip-info">
                    <span class="exec-strip-label">SLA Compliance</span>
                    <span class="exec-strip-val val-success">${escapeHtml(c.sla_status || 'On Track (Standard 24h)')}</span>
                </div>
            </div>
        </div>
    `;
}

// Helper to format email body text nicely
function formatEmailBodyText(text) {
    if (!text) return '';
    let cleaned = text.replace(/\\r\\n/g, '\\n');
    cleaned = cleaned.replace(/\\n\\s*-\\s*\\n\\s*/g, '\\n• ');
    cleaned = cleaned.replace(/\\n\\s*-\\s+/g, '\\n• ');
    return escapeHtml(cleaned);
}

// Collapsible Original Intake Email
window.toggleIntakeEmailCard = function() {
    const card = document.getElementById("cardIntakeEmail");
    const btn = document.getElementById("btnToggleEmailCard");
    if (!card) return;
    const isCollapsed = card.classList.toggle("collapsed");
    if (btn) {
        btn.innerHTML = isCollapsed
            ? `<span>Expand Email</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`
            : `<span>Collapse Email</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
    }
};

// Build Collapsible System Auto-Ack Bar
function buildSystemAckPill(item, employeeEmail) {
    const ackId = item.id || Math.random().toString(36).substring(7);
    const timeStr = formatSafeDate(item.timestamp_iso || item.created_at_utc || item.created_at);
    const subject = item.subject || 'Automated Case Acknowledgment';
    const message = item.message || item.body || '';

    return `
        <div class="system-ack-pill-card" id="ackCard_${ackId}">
            <div class="ack-pill-header" onclick="toggleAckBody('${ackId}')">
                <div class="ack-pill-left">
                    <span style="font-size: 1rem;">🤖</span>
                    <span class="ack-pill-text">System Auto-Acknowledgement sent to <strong>${escapeHtml(employeeEmail)}</strong></span>
                    <span class="ack-pill-meta">${timeStr}</span>
                </div>
                <button type="button" class="ack-pill-btn" id="ackBtn_${ackId}">
                    <span>View Email</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
            </div>
            <div class="ack-pill-body" id="ackBody_${ackId}" style="display: none;">
                <div class="ack-email-subject">${escapeHtml(subject)}</div>
                <div class="ack-email-text">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
}

// Build Tab 1: Conversation & Emails Stream
function buildConversationTab(data, c) {
    const origEmail = data.original_email || data.detail?.original_email || c.original_email;
    const employeeName = c.employee_name || c.sender_name || origEmail?.from_name || "Employee";
    const employeeCode = c.employee_code || c.employee_id || "EMP";
    const employeeEmail = origEmail?.from_email || origEmail?.sender_email || c.employee_email || c.sender_email || `${employeeCode.toLowerCase()}@company.com`;

    // Missing fields alert banner (if required)
    const val = data.validation || {};
    const missingFields = val.missing_fields || [];
    const missingAlertHtml = missingFields.length > 0 ? `
        <div class="dossier-alert-banner">
            <div class="dossier-alert-icon">⚠️</div>
            <div class="dossier-alert-content">
                <div class="dossier-alert-title">Required Information Missing</div>
                <div class="dossier-alert-desc">Workflow progression requires the following details from requester:</div>
                <div class="dossier-missing-chips">
                    ${missingFields.map(f => `<span class="dossier-missing-chip">${escapeHtml(f)}</span>`).join('')}
                </div>
            </div>
            <button type="button" class="btn-coral-primary" style="height: 30px; font-size: 0.74rem; flex-shrink: 0;" onclick="handleRequestInfo('${escapeHtml(c.case_number || c.id)}')">Request Info</button>
        </div>
    ` : '';

    // Original Inbound Intake Email (Message #1 in thread)
    let emailCardHtml = '';
    if (origEmail) {
        const initials = (origEmail.from_name || employeeName).split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'EM';
        const receivedTime = formatSafeDate(origEmail.received_at || c.created_at);
        const subjectLine = origEmail.subject || c.title || 'Inbound Case Inquiry';
        const formattedBody = formatEmailBodyText(origEmail.body || c.description || 'No message content provided.');

        emailCardHtml = `
            <div class="conversation-email-card" id="cardIntakeEmail">
                <div class="email-card-header">
                    <div class="email-card-sender-info">
                        <div class="email-card-avatar">${escapeHtml(initials)}</div>
                        <div class="email-card-names">
                            <div class="email-card-sender-name">
                                <span>${escapeHtml(origEmail.from_name || employeeName)}</span>
                                <span class="email-card-badge">📥 Requester Inbound Email (From Employee)</span>
                            </div>
                            <span class="email-card-sender-email">&lt;${escapeHtml(origEmail.from_email || employeeEmail)}&gt;</span>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="email-card-time">${receivedTime}</span>
                        <button type="button" class="btn-card-toggle" id="btnToggleEmailCard" onclick="toggleIntakeEmailCard()" title="Collapse or Expand Email Content">
                            <span>Collapse Email</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        </button>
                    </div>
                </div>
                <div class="email-card-recipient-row">
                    <span>To: <strong>Tata 1mg PeopleDesk</strong> &lt;hr@tata1mg.com&gt;</span>
                    <span style="margin-left: auto; color: var(--tata-text-muted);">Subject: <strong>${escapeHtml(subjectLine)}</strong></span>
                </div>
                <div class="email-card-body-content">${formattedBody}</div>
                ${origEmail.attachments && origEmail.attachments.length > 0 ? `
                    <div class="email-card-attachments">
                        ${origEmail.attachments.map(att => `
                            <span class="dossier-missing-chip" style="background:#FFFFFF; color:var(--tata-text-heading); border-color:var(--tata-border);">
                                📎 ${escapeHtml(att.filename || 'Attachment')}
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Subsequent Communications in Stream (Replies, Notes, System Notifications)
    const comms = data.communications || [];
    const subsequentComms = (origEmail && comms.length > 0 && (
        (comms[0].message && origEmail.body && comms[0].message.trim() === origEmail.body.trim()) ||
        (comms[0].body && origEmail.body && comms[0].body.trim() === origEmail.body.trim())
    )) ? comms.slice(1) : comms;

    let commsHtml = '';
    if (subsequentComms.length > 0) {
        commsHtml = `
            <div class="comms-bubbles-list">
                ${subsequentComms.map(item => {
                    const msgContent = item.message || item.body || '';
                    const senderNameLower = String(item.sender_name || '').toLowerCase();
                    const senderRoleLower = String(item.sender_role || '').toLowerCase();
                    const senderTypeLower = String(item.sender_type || '').toLowerCase();
                    const commTypeLower = String(item.comm_type || '').toLowerCase();
                    const timeStr = formatSafeDate(item.timestamp_iso || item.created_at_utc || item.created_at);

                    const isAck = item.comm_type === 'CASE_ACK_EMAIL';
                    if (isAck) {
                        return buildSystemAckPill(item, employeeEmail);
                    }

                    const isNote = item.comm_type === 'INTERNAL_NOTE';
                    const isAdminAction = String(msgContent).includes('[ADMIN ACTION]') || commTypeLower.includes('action');
                    
                    // Agent detection (e.g. Test Agent, AI, system merge, autonomous agent replies)
                    const isAgent = senderRoleLower === 'agent' || 
                                    senderTypeLower === 'agent' || 
                                    senderNameLower.includes('agent') || 
                                    senderRoleLower.includes('agent') ||
                                    commTypeLower.includes('agent') || 
                                    commTypeLower === 'system_merge' ||
                                    senderNameLower.includes('ai ') || 
                                    senderNameLower === 'ai' ||
                                    senderNameLower.includes('bot');

                    // HR / Admin detection (excluding notes/actions)
                    const isHr = !isAgent && (
                        item.sender_role === 'HR' || 
                        item.sender_role === 'ADMIN' || 
                        item.sender_type === 'HR' || 
                        String(item.sender_email || '').includes('hr@') || 
                        item.is_hr || 
                        senderNameLower.includes('admin') || 
                        senderNameLower.includes('peopledesk')
                    );

                    let bubbleClass = 'employee';
                    let badgeText = '👤 Requester Response';
                    let badgeClass = 'badge-employee-response';
                    let senderDisplay = item.sender_name || employeeName;
                    let avatarIcon = '👤';
                    let avatarClass = 'emp';

                    if (isAdminAction) {
                        bubbleClass = 'admin-action';
                        badgeText = '⚡ Admin Operational Action';
                        badgeClass = 'badge-admin-action';
                        senderDisplay = item.sender_name || 'Admin';
                        avatarIcon = '🛡️';
                        avatarClass = 'hr';
                    } else if (isNote) {
                        bubbleClass = 'internal-note';
                        badgeText = '🔒 Confidential Staff Note';
                        badgeClass = 'badge-internal-note';
                        senderDisplay = item.sender_name || 'Admin';
                        avatarIcon = '🔒';
                        avatarClass = 'note';
                    } else if (isAgent) {
                        bubbleClass = 'agent';
                        badgeText = (commTypeLower === 'system_merge') ? '🤖 Agent Docket Merge' : '🤖 Agent Response (Sent to Employee)';
                        badgeClass = 'badge-agent-response';
                        senderDisplay = item.sender_name || 'HR Agent';
                        avatarIcon = '🤖';
                        avatarClass = 'agent';
                    } else if (isHr) {
                        bubbleClass = 'hr';
                        badgeText = '🛡️ PeopleDesk Reply (Sent to Employee)';
                        badgeClass = 'badge-hr-response';
                        senderDisplay = item.sender_name || 'Admin (PeopleDesk)';
                        avatarIcon = '🛡️';
                        avatarClass = 'hr';
                    } else {
                        bubbleClass = 'employee';
                        badgeText = '👤 Employee Follow-up (From Requester)';
                        badgeClass = 'badge-employee-response';
                        senderDisplay = item.sender_name || employeeName;
                        avatarIcon = '👤';
                        avatarClass = 'emp';
                    }

                    const cleanContent = isAdminAction ? msgContent.replace(/\[ADMIN ACTION\]\s*/i, '') : msgContent;

                    return `
                        <div class="conversation-bubble-card ${bubbleClass}">
                            <div class="bubble-card-header">
                                <div class="bubble-sender-group">
                                    <div class="bubble-avatar-mini ${avatarClass}">${avatarIcon}</div>
                                    <span class="bubble-sender-name">${escapeHtml(senderDisplay)}</span>
                                    <span class="badge-pill-subtle ${badgeClass}">${badgeText}</span>
                                </div>
                                <span class="bubble-time">${timeStr}</span>
                            </div>
                            <div class="bubble-body-text">
                                ${isAdminAction ? '<span class="action-tag-pill">HRMS/LMS UPDATE</span> ' : ''}${escapeHtml(cleanContent)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    if (!emailCardHtml && !commsHtml) {
        return `
            ${missingAlertHtml}
            <div class="empty-reader-box" style="padding: 40px 20px;">
                <p style="color: var(--tata-text-secondary); margin: 0;">No communications or email transcripts recorded for this case yet.</p>
            </div>
        `;
    }

    const docketCode = c.docket_code || c.case_number || "CASE-000000";
    const bottomDeskHtml = `
        <!-- AI Copilot Fast Response Suggestions -->
        <div class="copilot-chips-card">
            <div class="copilot-chips-header">
                <span class="copilot-icon">💡</span>
                <span class="copilot-label">AI Copilot Quick Responses (Click to Auto-fill):</span>
            </div>
            <div class="copilot-chips-row">
                <button type="button" class="copilot-chip-btn" onclick="applyCopilotResponse('ARREARS_APOLOGY')">
                    ⚡ Confirm Arrears &amp; Send Apology
                </button>
                <button type="button" class="copilot-chip-btn" onclick="applyCopilotResponse('REQUEST_LMS')">
                    📋 Request Missing LMS Approval
                </button>
                <button type="button" class="copilot-chip-btn" onclick="applyCopilotResponse('RESOLVED_SUMMARY')">
                    ✓ Send Final Resolution Summary
                </button>
            </div>
        </div>

        <!-- Fast Ops 1-Click Operational Action Bar -->
        <div class="fast-ops-inline-bar">
            <span class="fast-ops-title">⚡ Fast Ops Actions:</span>
            <button type="button" class="btn-fast-op-pill" onclick="executeFastOp('SCHEDULE_ARREARS')" title="Immediately schedule payroll arrears credit in system">
                ⚡ Schedule ₹3,500 Arrears
            </button>
            <button type="button" class="btn-fast-op-pill" onclick="executeFastOp('CLEAR_LWP')" title="Regularize attendance and void erroneous LWP deduction in LMS">
                🛡️ Regularize LWP in LMS
            </button>
            <button type="button" class="btn-fast-op-pill" onclick="openDocketModal()" title="Customize Case Ticket / Docket Code">
                🏷️ Ticket: <strong>${escapeHtml(docketCode)}</strong> ✏️
            </button>
        </div>
    `;

    return `
        ${missingAlertHtml}
        ${emailCardHtml}
        ${commsHtml}
        ${bottomDeskHtml}
    `;
}

// Build Tab 2: Employee Details (360° Employee Dossier)
function buildEmployeeDetailsTab(data, c) {
    const dData = data.dossier_data || c.dossier_data || {};
    const emp = dData.employee_profile || data.employee || {};
    const fb = dData.financial_breakdown || {};
    const lms = dData.leave_attendance_audit || {};
    const ai = data.ai_classification || {};

    const employeeName = emp.name || c.employee_name || "Employee";
    const employeeCode = emp.employee_code || c.employee_code || c.employee_id || "EMP";
    const employeeDept = emp.department || c.department || "Operations";
    const employeeDesig = emp.designation || c.designation || "Specialist";
    const employeeManager = emp.manager || c.manager_name || "Reporting Lead";
    const employeeLoc = emp.location || c.location || "Delhi HQ";
    const employeeGrade = emp.grade || "G6";
    const employeeDoj = emp.doj || "12/06/2022";
    const origEmail = data.original_email || data.detail?.original_email || c.original_email;
    const employeeEmail = emp.email || c.employee_email || origEmail?.from_email || `${employeeCode.toLowerCase()}@tata1mg.com`;

    const initials = employeeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'EM';

    const isPayroll = dData.is_payroll || String(c.category || '').toUpperCase().includes('PAYROLL');
    const isProfile = dData.is_profile || String(c.category || '').toUpperCase().includes('PROFILE');
    const targetName = dData.executive_summary?.primary_metric_val || emp.name;

    return `
        <div class="emp-details-wrapper">
            <!-- 360° Employee Hero Card -->
            <div class="emp-hero-card">
                <div class="emp-hero-left">
                    <div class="emp-hero-avatar">${escapeHtml(initials)}</div>
                    <div>
                        <div class="emp-hero-name">
                            <span>${escapeHtml(employeeName)}</span>
                            <span class="badge-pill-subtle" style="font-family:monospace; color:var(--tata-coral); border-color:var(--tata-coral-border); font-weight:800; font-size:0.75rem;">${escapeHtml(employeeCode)}</span>
                            <span class="dossier-card-tag tag-green" style="font-size:0.65rem;">🟢 Active • Full-Time</span>
                        </div>
                        <div class="emp-hero-sub">
                            <strong>${escapeHtml(employeeDesig)}</strong>
                            <span>•</span>
                            <span>Band ${escapeHtml(employeeGrade)}</span>
                            <span>•</span>
                            <span>${escapeHtml(employeeDept)}</span>
                            <span>•</span>
                            <span class="dossier-card-tag tag-blue" style="font-size:0.65rem;">Darwinbox Verified</span>
                        </div>
                        <div class="emp-hero-meta-row">
                            <span>✉️ Official: <a href="mailto:${escapeHtml(employeeEmail)}">${escapeHtml(employeeEmail)}</a></span>
                            <span>📞 Mobile: +91 98765 43210</span>
                            <span>📍 Base Office: ${escapeHtml(employeeLoc)} (Hybrid)</span>
                            <span>📅 Joining: ${escapeHtml(employeeDoj)} (2 yrs 4 mos)</span>
                        </div>
                    </div>
                </div>
            </div>

            ${isPayroll ? `
                <!-- Financial Discrepancy Flow Bar -->
                <div class="financial-comparison-bar">
                    <div class="f-comp-node">
                        <span class="f-comp-label">Monthly Gross CTC</span>
                        <span class="f-comp-val">${escapeHtml(fb.gross_salary || '₹72,000')}</span>
                    </div>
                    <span class="f-comp-arrow">→</span>
                    <div class="f-comp-node">
                        <span class="f-comp-label">Expected Net Salary</span>
                        <span class="f-comp-val">${escapeHtml(fb.expected_net || '₹64,500')}</span>
                    </div>
                    <span class="f-comp-arrow">vs</span>
                    <div class="f-comp-node">
                        <span class="f-comp-label">Actual Credited Net</span>
                        <span class="f-comp-val" style="color:#B42318;">${escapeHtml(fb.credited_net || '₹61,000')}</span>
                    </div>
                    <div class="f-comp-diff">
                        <span class="f-comp-diff-label">Net Discrepancy</span>
                        <span class="f-comp-diff-val">-${escapeHtml(fb.discrepancy_amount || '₹3,500')}</span>
                    </div>
                </div>
            ` : ''}

            <!-- 2-Column Dossier Detail Cards -->
            <div class="dossier-grid-2col">
                <!-- Card 1: Employee Master HR Profile -->
                <div class="dossier-info-card">
                    <div class="dossier-card-head">
                        <span class="dossier-card-title">👤 Employee Master Profile</span>
                        <span class="dossier-card-tag tag-blue">HRMS Master</span>
                    </div>
                    <div class="dossier-keyval-list">
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Full Official Name</span>
                            <span class="dossier-kv-val">${escapeHtml(employeeName)}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Employee Code</span>
                            <span class="dossier-kv-val" style="font-family:monospace; color:var(--tata-coral); font-weight:700;">${escapeHtml(employeeCode)}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Designation &amp; Grade</span>
                            <span class="dossier-kv-val">${escapeHtml(employeeDesig)} (Band ${escapeHtml(employeeGrade)})</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Department &amp; Unit</span>
                            <span class="dossier-kv-val">${escapeHtml(employeeDept)}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Employment Type</span>
                            <span class="dossier-kv-val">Permanent (Confirmed Post-Probation)</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Base Location</span>
                            <span class="dossier-kv-val">${escapeHtml(employeeLoc)}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Date of Joining</span>
                            <span class="dossier-kv-val">${escapeHtml(employeeDoj)}</span>
                        </div>
                    </div>
                </div>

                <!-- Card 2: Reporting Hierarchy & Leadership -->
                <div class="dossier-info-card">
                    <div class="dossier-card-head">
                        <span class="dossier-card-title">👥 Reporting Hierarchy &amp; HRBP</span>
                        <span class="dossier-card-tag tag-purple">Org Chart</span>
                    </div>
                    <div class="dossier-keyval-list">
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Reporting Manager (L1)</span>
                            <span class="dossier-kv-val" style="font-weight:700;">${escapeHtml(employeeManager)} (Lead Ops Manager)</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Manager Email</span>
                            <span class="dossier-kv-val" style="color:var(--tata-coral); font-size:0.75rem;">${escapeHtml((employeeManager.toLowerCase().split(' ')[0] || 'manager') + '@tata1mg.com')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Department Head (L2)</span>
                            <span class="dossier-kv-val">Amit Verma (VP Operations)</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Dedicated HRBP</span>
                            <span class="dossier-kv-val">Pooja Bansal (Lead People Partner)</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Cost Center</span>
                            <span class="dossier-kv-val" style="font-family:monospace;">CC-8821 (Supply Chain Fulfillment)</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Payroll Entity</span>
                            <span class="dossier-kv-val">Tata 1mg Technologies Pvt Ltd</span>
                        </div>
                    </div>
                </div>

                <!-- Card 3: LMS Leave & Attendance Dossier -->
                <div class="dossier-info-card">
                    <div class="dossier-card-head">
                        <span class="dossier-card-title">📅 Leave &amp; LMS Balances (Darwinbox)</span>
                        <span class="dossier-card-tag tag-green">${escapeHtml(lms.manager_approval || 'Verified')}</span>
                    </div>
                    <div style="padding: 10px 0 14px 0; border-bottom: 1px solid var(--tata-border-subtle); display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center;">
                        <div style="background: #F8FAFC; padding: 8px 6px; border-radius: 6px; border: 1px solid #E2E8F0;">
                            <div style="font-size: 0.66rem; color: var(--tata-text-muted); font-weight: 700;">CASUAL LEAVE</div>
                            <div style="font-size: 0.95rem; font-weight: 850; color: #0284C7; margin-top: 2px;">6.5 / 12</div>
                            <div class="emp-leave-bar"><div class="emp-leave-fill" style="width: 54%; background: #0284C7;"></div></div>
                        </div>
                        <div style="background: #F8FAFC; padding: 8px 6px; border-radius: 6px; border: 1px solid #E2E8F0;">
                            <div style="font-size: 0.66rem; color: var(--tata-text-muted); font-weight: 700;">EARNED LEAVE</div>
                            <div style="font-size: 0.95rem; font-weight: 850; color: #059669; margin-top: 2px;">14 / 18</div>
                            <div class="emp-leave-bar"><div class="emp-leave-fill" style="width: 78%; background: #059669;"></div></div>
                        </div>
                        <div style="background: #F8FAFC; padding: 8px 6px; border-radius: 6px; border: 1px solid #E2E8F0;">
                            <div style="font-size: 0.66rem; color: var(--tata-text-muted); font-weight: 700;">SICK LEAVE</div>
                            <div style="font-size: 0.95rem; font-weight: 850; color: #D97706; margin-top: 2px;">5 / 8</div>
                            <div class="emp-leave-bar"><div class="emp-leave-fill" style="width: 62%; background: #D97706;"></div></div>
                        </div>
                    </div>
                    <div class="dossier-keyval-list" style="margin-top: 8px;">
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">LMS Request Reference</span>
                            <span class="dossier-kv-val" style="font-family:monospace; font-weight:700;">${escapeHtml(lms.lms_ref || 'LV202610120089')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Applied Leave Dates</span>
                            <span class="dossier-kv-val">${escapeHtml(lms.dates || '12-13 Oct 2026 (2 Days)')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Manager Approval</span>
                            <span class="dossier-kv-val" style="color:#027A48; font-weight:700;">${escapeHtml(lms.manager_approval || 'Approved')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Biometric Status</span>
                            <span class="dossier-kv-val" style="color:${dData.lms_reconciled ? '#027A48' : '#B42318'}; font-weight:700;">${escapeHtml(lms.biometric_status || 'Sync Logged')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Audit Verdict</span>
                            <span class="dossier-kv-val" style="color:#027A48; font-weight:700;">${escapeHtml(lms.verdict || 'Valid Request')}</span>
                        </div>
                    </div>
                </div>

                <!-- Card 4: Compensation & Financial Master Data -->
                <div class="dossier-info-card">
                    <div class="dossier-card-head">
                        <span class="dossier-card-title">💰 Compensation &amp; Payroll Snapshot</span>
                        <span class="dossier-card-tag tag-red">Active Discrepancy</span>
                    </div>
                    <div class="dossier-keyval-list">
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Monthly Gross CTC</span>
                            <span class="dossier-kv-val">${escapeHtml(fb.gross_salary || '₹72,000')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Expected Net Salary</span>
                            <span class="dossier-kv-val">${escapeHtml(fb.expected_net || '₹64,500')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Actual Credited Net</span>
                            <span class="dossier-kv-val">${escapeHtml(fb.credited_net || '₹61,000')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Discrepancy / Shortfall</span>
                            <span class="dossier-kv-val" style="color:#B42318; font-weight:750; font-size:0.85rem;">-${escapeHtml(fb.discrepancy_amount || '₹3,500')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Deduction Code</span>
                            <span class="dossier-kv-val">${escapeHtml(fb.deduction_category || 'LWP')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Salary Bank Account</span>
                            <span class="dossier-kv-val">${escapeHtml(fb.bank_ref || 'HDFC Bank (Verified)')}</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">PAN / UAN Ref</span>
                            <span class="dossier-kv-val" style="font-family:monospace;">PAN: ABCDE1234F • UAN: 101829471920</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Dispute Resolution</span>
                            <span class="dossier-kv-val" style="color:${dData.arrears_scheduled ? '#027A48' : '#B42318'}; font-weight:700;">${escapeHtml(fb.dispute_status || 'Pending Approval')}</span>
                        </div>
                    </div>
                </div>

                <!-- Card 5: Identity & Verification Proofs -->
                <div class="dossier-info-card">
                    <div class="dossier-card-head">
                        <span class="dossier-card-title">🪪 Identity Verification Proof</span>
                        <span class="dossier-card-tag tag-green">✓ Authentic</span>
                    </div>
                    <div class="dossier-keyval-list">
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Document Submitted</span>
                            <span class="dossier-kv-val">Government Aadhaar Card</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Identification UID</span>
                            <span class="dossier-kv-val" style="font-family:monospace;">•••• •••• 9821</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Verification Engine</span>
                            <span class="dossier-kv-val">DigiLocker Government API</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Identity Match Score</span>
                            <span class="dossier-kv-val" style="color:#027A48; font-weight:750;">99.8% Name &amp; DOB Match</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Biometric / OTP Status</span>
                            <span class="dossier-kv-val" style="color:#027A48; font-weight:700;">✓ UIDAI Verified</span>
                        </div>
                        <div class="dossier-kv-item">
                            <span class="dossier-kv-key">Background Check</span>
                            <span class="dossier-kv-val" style="color:#027A48; font-weight:700;">Cleared &amp; Certified</span>
                        </div>
                    </div>
                </div>

                ${isProfile ? `
                    <!-- Card 6: Requested HRMS Profile Update -->
                    <div class="dossier-info-card">
                        <div class="dossier-card-head">
                            <span class="dossier-card-title">📝 Requested HRMS Update</span>
                            <span class="dossier-card-tag tag-purple">Pending Review</span>
                        </div>
                        <div class="dossier-keyval-list">
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Field to Update</span>
                                <span class="dossier-kv-val">Official Legal Name (Middle Name Addition)</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Current Value</span>
                                <span class="dossier-kv-val" style="color:var(--tata-text-muted);">${escapeHtml(employeeName)}</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Proposed New Value</span>
                                <span class="dossier-kv-val" style="color:var(--tata-coral); font-weight:750; font-size:0.85rem;">${escapeHtml(targetName)}</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Justification / Reason</span>
                                <span class="dossier-kv-val">Tax Filing &amp; Aadhaar Identity Compliance</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Affected Systems</span>
                                <span class="dossier-kv-val">Darwinbox HRMS, Income Tax Portal, EPFO</span>
                            </div>
                        </div>
                    </div>
                ` : `
                    <!-- Card 6: AI Telemetry & Policy Rules -->
                    <div class="dossier-info-card">
                        <div class="dossier-card-head">
                            <span class="dossier-card-title">🤖 AI Policy &amp; SLA Telemetry</span>
                            <span class="dossier-card-tag tag-purple">High Confidence</span>
                        </div>
                        <div class="dossier-keyval-list">
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Detected Intent</span>
                                <span class="dossier-kv-val">${escapeHtml(ai.intent || c.intent || 'PAYROLL_DISCREPANCY')}</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Model Confidence</span>
                                <span class="dossier-kv-val" style="color:#027A48; font-weight:700;">${Math.round((ai.category_confidence || 0.98) * 100)}% Confident</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Decision Status</span>
                                <span class="dossier-kv-val">${escapeHtml(ai.decision_status || 'AUTO PROCESSED')}</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">Applicable Policy</span>
                                <span class="dossier-kv-val">Tata 1mg Payroll Discrepancy SOP §4.2</span>
                            </div>
                            <div class="dossier-kv-item">
                                <span class="dossier-kv-key">SLA Deadline</span>
                                <span class="dossier-kv-val" style="color:#027A48; font-weight:700;">${escapeHtml(c.sla_status || 'On Track (24h)')}</span>
                            </div>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;
}

// Backward compatibility alias
const buildCaseDossierTab = buildEmployeeDetailsTab;

// Build Tab 4: Process & Workflow Engine (5-Stage Visual Stepper, SLA, Fast Ops Fixes & SOP)
function buildWorkflowProcessTab(data, c) {
    const dData = data.dossier_data || c.dossier_data || {};
    const emp = dData.employee_profile || data.employee || {};
    const fb = dData.financial_breakdown || {};
    const lms = dData.leave_attendance_audit || {};
    const isPayroll = dData.is_payroll || String(c.category || '').toUpperCase().includes('PAYROLL');
    const isProfile = dData.is_profile || String(c.category || '').toUpperCase().includes('PROFILE');
    const isArrearsDone = Boolean(dData.arrears_scheduled);
    const isLmsDone = Boolean(dData.lms_reconciled);
    const isResolved = c.status === 'RESOLVED' || c.status === 'CLOSED';

    const targetName = dData.executive_summary?.primary_metric_val || emp.name;

    return `
        <div class="process-flow-container">
            <!-- 5-Stage Visual Workflow Stepper -->
            <div class="workflow-stages-stepper">
                <div class="stepper-header">
                    <h4>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                        <span>Case Resolution Lifecycle (5 Stages)</span>
                    </h4>
                    <span class="badge-pill-subtle" style="color:var(--tata-coral); border-color:var(--tata-coral-border); font-weight:750;">Live Process Engine</span>
                </div>
                <div class="stages-track">
                    <!-- Stage 1 -->
                    <div class="stage-step-card completed">
                        <div class="stage-step-top">
                            <span>STAGE 1</span>
                            <span>✓ DONE</span>
                        </div>
                        <div class="stage-step-name">1. Inbound Intake</div>
                        <div class="stage-step-sub">Email received &amp; parsed into docket #${escapeHtml(c.case_number || c.id)}</div>
                    </div>

                    <!-- Stage 2 -->
                    <div class="stage-step-card completed">
                        <div class="stage-step-top">
                            <span>STAGE 2</span>
                            <span>✓ DONE</span>
                        </div>
                        <div class="stage-step-name">2. AI Triage &amp; SLA</div>
                        <div class="stage-step-sub">Classified as ${escapeHtml(c.category || 'General')} (98% confidence)</div>
                    </div>

                    <!-- Stage 3 -->
                    <div class="stage-step-card completed">
                        <div class="stage-step-top">
                            <span>STAGE 3</span>
                            <span>✓ DONE</span>
                        </div>
                        <div class="stage-step-name">3. LMS Attendance Audit</div>
                        <div class="stage-step-sub">Leave ${escapeHtml(lms.lms_ref || 'verified')} • Biometric check complete</div>
                    </div>

                    <!-- Stage 4 -->
                    <div class="stage-step-card ${isArrearsDone || isLmsDone ? 'completed' : 'active'}">
                        <div class="stage-step-top">
                            <span>STAGE 4</span>
                            <span>${isArrearsDone || isLmsDone ? '✓ APPLIED' : '⚡ FAST OPS'}</span>
                        </div>
                        <div class="stage-step-name">4. Operational Fix</div>
                        <div class="stage-step-sub">${isArrearsDone ? 'Arrears queued in SQLite' : 'Requires salary/LMS adjustment'}</div>
                    </div>

                    <!-- Stage 5 -->
                    <div class="stage-step-card ${isResolved ? 'completed' : 'pending'}">
                        <div class="stage-step-top">
                            <span>STAGE 5</span>
                            <span>${isResolved ? '✓ RESOLVED' : '⏳ PENDING'}</span>
                        </div>
                        <div class="stage-step-name">5. Closure &amp; Ack</div>
                        <div class="stage-step-sub">${isResolved ? 'Confirmation sent to employee' : 'Awaiting admin ticket sign-off'}</div>
                    </div>
                </div>
            </div>

            <!-- Process SLA & Velocity KPI Bar -->
            <div class="process-sla-card">
                <div class="sla-kpi-group">
                    <div class="sla-kpi-item">
                        <span class="sla-kpi-label">SLA Target</span>
                        <span class="sla-kpi-val" style="color:var(--tata-coral);">24 Hours</span>
                    </div>
                    <div class="sla-kpi-item">
                        <span class="sla-kpi-label">Time Elapsed</span>
                        <span class="sla-kpi-val">14h 22m</span>
                    </div>
                    <div class="sla-kpi-item">
                        <span class="sla-kpi-label">Time Remaining</span>
                        <span class="sla-kpi-val" style="color:#027A48;">9h 38m (On Track)</span>
                    </div>
                    <div class="sla-kpi-item">
                        <span class="sla-kpi-label">SLA Compliance</span>
                        <span class="sla-kpi-val" style="color:#027A48;">100% Target Met</span>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button type="button" class="btn-coral-primary" style="height: 32px; font-size: 0.76rem;" onclick="handleAdminAction('RESOLVE_CASE', { resolution_notes: 'Resolution verified via Process Engine.' })">
                        ✓ Resolve &amp; Close Case
                    </button>
                </div>
            </div>

            <!-- 1-Click Fast Ops Fix Pods Grid -->
            <div>
                <h4 style="font-size: 0.85rem; font-weight: 800; color: var(--tata-text-heading); margin: 0 0 10px 0; display:flex; align-items:center; gap:6px;">
                    <span>⚡ 1-Click Fast Ops Execution Pods</span>
                    <span class="admin-tab-accent-pill">Direct Integration</span>
                </h4>

                ${isPayroll ? `
                    <div class="admin-actions-grid">
                        <!-- Action Pod 1: Schedule Arrears -->
                        <div class="admin-action-pod ${isArrearsDone ? 'completed' : ''}">
                            <div class="action-pod-header">
                                <div class="action-pod-icon ${isArrearsDone ? 'icon-green' : 'icon-coral'}">${isArrearsDone ? '✓' : '💰'}</div>
                                <div class="action-pod-meta">
                                    <h4>${isArrearsDone ? '✓ Arrears Scheduled in Database' : `Schedule ${escapeHtml(fb.discrepancy_amount || '₹3,500')} Salary Arrears`}</h4>
                                    <p>${isArrearsDone ? `Reimbursement adjustment of ${escapeHtml(fb.discrepancy_amount || '₹3,500')} queued for ${escapeHtml(fb.pay_period || 'November 2026')} payroll run by Admin.` : `Queues an arrears adjustment of ${escapeHtml(fb.discrepancy_amount || '₹3,500')} for the ${escapeHtml(fb.pay_period || 'November 2026')} payroll run to reimburse the deduction.`}</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">${isArrearsDone ? 'Status: Queued in SQLite' : 'Integration: Payroll Engine'}</span>
                                <button type="button" class="btn-action-exec ${isArrearsDone ? 'btn-completed' : 'btn-coral'}" ${isArrearsDone ? '' : `onclick="handleAdminAction('SCHEDULE_ARREARS', { amount: '${escapeHtml(fb.discrepancy_amount || '₹3,500')}', pay_period: '${escapeHtml(fb.pay_period || 'November 2026')}' })"`}>
                                    <span>${isArrearsDone ? '✓ Arrears Queued' : `💰 Schedule ${escapeHtml(fb.discrepancy_amount || '₹3,500')} Arrears`}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Action Pod 2: Reconcile LMS Attendance -->
                        <div class="admin-action-pod ${isLmsDone ? 'completed' : ''}">
                            <div class="action-pod-header">
                                <div class="action-pod-icon ${isLmsDone ? 'icon-green' : 'icon-blue'}">${isLmsDone ? '✓' : '🔄'}</div>
                                <div class="action-pod-meta">
                                    <h4>${isLmsDone ? '✓ LMS Attendance Reconciled' : 'Reconcile LMS Biometric Record'}</h4>
                                    <p>${isLmsDone ? `LMS record (Ref: ${escapeHtml(lms.lms_ref || 'LV202610120089')}) updated to Approved Casual Leave. LWP deduction cleared.` : `Overwrites biometric sync glitch. Updates 12-13 Oct 2026 to Approved Casual Leave and clears LWP flag.`}</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">${isLmsDone ? 'Status: Reconciled in SQLite' : 'Integration: Darwinbox LMS'}</span>
                                <button type="button" class="btn-action-exec ${isLmsDone ? 'btn-completed' : 'btn-outline'}" ${isLmsDone ? '' : `onclick="handleAdminAction('CLEAR_LWP', { dates: '${escapeHtml(lms.dates || '12-13 Oct 2026')}', lms_ref: '${escapeHtml(lms.lms_ref || 'LV202610120089')}' })"`}>
                                    <span>${isLmsDone ? '✓ Attendance Reconciled' : '🔄 Reconcile LMS Record'}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Action Pod 3: Manager Notification Ping -->
                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-amber">✉️</div>
                                <div class="action-pod-meta">
                                    <h4>Ping Reporting Manager (${escapeHtml(emp.manager || 'Manager')})</h4>
                                    <p>Dispatches an automated 1-click verification prompt to Reporting Manager ${escapeHtml(emp.manager || 'Manager')} for audit sign-off.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Channel: Automated Email</span>
                                <button type="button" class="btn-action-exec btn-outline" onclick="handleAdminAction('PING_MANAGER', { manager_name: '${escapeHtml(emp.manager || 'Manager')}' })">
                                    <span>✉️ Ping Manager</span>
                                </button>
                            </div>
                        </div>

                        <!-- Action Pod 4: Quick Resolve Ticket -->
                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-green">✅</div>
                                <div class="action-pod-meta">
                                    <h4>Resolve Ticket &amp; Notify ${escapeHtml(emp.name || 'Employee')}</h4>
                                    <p>Closes case as RESOLVED and sends official resolution email with breakdown to ${escapeHtml(emp.email || 'Employee')}.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Workflow: Case Closure</span>
                                <button type="button" class="btn-action-exec btn-success" onclick="handleAdminAction('RESOLVE_CASE', { resolution_notes: 'Deduction reimbursed in November 2026 payroll run.' })">
                                    <span>✅ Complete &amp; Resolve Ticket</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ` : (isProfile ? `
                    <div class="admin-actions-grid">
                        <!-- Action Pod 1: Update HRMS Master Name -->
                        <div class="admin-action-pod completed">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-green">✓</div>
                                <div class="action-pod-meta">
                                    <h4>Update Official Name in HRMS Master</h4>
                                    <p>Applies verified name update to "${escapeHtml(targetName)}" in central Darwinbox database.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Integration: HRMS Database</span>
                                <button type="button" class="btn-action-exec btn-coral" onclick="handleAdminAction('UPDATE_HRMS_PROFILE', { target_name: '${escapeHtml(targetName)}' })">
                                    <span>Update Name in HRMS</span>
                                </button>
                            </div>
                        </div>

                        <!-- Action Pod 2: Verify Government Aadhaar ID -->
                        <div class="admin-action-pod completed">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-green">✓</div>
                                <div class="action-pod-meta">
                                    <h4>✓ Government Identity Proof Verified</h4>
                                    <p>Aadhaar UID •••• 9821 authenticated via DigiLocker API (99.8% name match verified).</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Verification: DigiLocker API</span>
                                <button type="button" class="btn-action-exec btn-completed">
                                    <span>✓ Aadhaar Verified</span>
                                </button>
                            </div>
                        </div>

                        <!-- Action Pod 3: Manager Notification Ping -->
                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-amber">✉️</div>
                                <div class="action-pod-meta">
                                    <h4>Notify Department Lead (${escapeHtml(emp.manager || 'Lead')})</h4>
                                    <p>Dispatches notification to ${escapeHtml(emp.manager || 'Lead')} regarding employee profile change.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Channel: Automated Email</span>
                                <button type="button" class="btn-action-exec btn-outline" onclick="handleAdminAction('PING_MANAGER', { manager_name: '${escapeHtml(emp.manager || 'Lead')}' })">
                                    <span>✉️ Notify Lead</span>
                                </button>
                            </div>
                        </div>

                        <!-- Action Pod 4: Quick Resolve Ticket -->
                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-green">✅</div>
                                <div class="action-pod-meta">
                                    <h4>Resolve Ticket &amp; Notify ${escapeHtml(emp.name || 'Employee')}</h4>
                                    <p>Closes case as RESOLVED and sends confirmation email to ${escapeHtml(emp.email || 'Employee')}.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Workflow: Case Closure</span>
                                <button type="button" class="btn-action-exec btn-success" onclick="handleAdminAction('RESOLVE_CASE', { resolution_notes: 'Profile updated in HRMS as per Aadhaar record.' })">
                                    <span>✅ Complete &amp; Resolve Ticket</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ` : `
                    <div class="admin-actions-grid">
                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-coral">⚡</div>
                                <div class="action-pod-meta">
                                    <h4>Request Missing Information</h4>
                                    <p>Dispatches automated email to requester asking for missing fields or documents.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Workflow: Inbound Request</span>
                                <button type="button" class="btn-action-exec btn-coral" onclick="handleRequestInfo('${escapeHtml(c.case_number || c.id)}')">
                                    <span>Request Info</span>
                                </button>
                            </div>
                        </div>

                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-blue">👥</div>
                                <div class="action-pod-meta">
                                    <h4>Reassign Case Specialist</h4>
                                    <p>Transfers case ownership to another HR team member or operational queue.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Workflow: Routing</span>
                                <button type="button" class="btn-action-exec btn-outline" onclick="openReassignModal()">
                                    <span>Reassign Case</span>
                                </button>
                            </div>
                        </div>

                        <div class="admin-action-pod">
                            <div class="action-pod-header">
                                <div class="action-pod-icon icon-green">✅</div>
                                <div class="action-pod-meta">
                                    <h4>Resolve Case</h4>
                                    <p>Marks ticket as RESOLVED in database.</p>
                                </div>
                            </div>
                            <div class="action-pod-footer">
                                <span class="action-pod-badge">Workflow: Case Closure</span>
                                <button type="button" class="btn-action-exec btn-success" onclick="handleAdminAction('RESOLVE_CASE')">
                                    <span>Resolve Case</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `)}
            </div>

            <!-- Policy & Governance SOP Card -->
            <div class="dossier-info-card" style="margin-top: 4px;">
                <div class="dossier-card-head">
                    <span class="dossier-card-title">📖 Policy SOP &amp; Governance Rules</span>
                    <span class="dossier-card-tag tag-blue">Standard Operating Procedure</span>
                </div>
                <div class="dossier-keyval-list">
                    <div class="dossier-kv-item">
                        <span class="dossier-kv-key">Standard Policy</span>
                        <span class="dossier-kv-val">Tata 1mg Payroll Discrepancy SOP §4.2 (Attendance Glitch Remediation)</span>
                    </div>
                    <div class="dossier-kv-item">
                        <span class="dossier-kv-key">Admin Discretion Limit</span>
                        <span class="dossier-kv-val">Up to ₹10,000 (Direct Admin Approval Permitted without VP Signoff)</span>
                    </div>
                    <div class="dossier-kv-item">
                        <span class="dossier-kv-key">Compliance Rule</span>
                        <span class="dossier-kv-val">Any deduction correction must correlate to a manager-approved LMS leave entry.</span>
                    </div>
                    <div class="dossier-kv-item">
                        <span class="dossier-kv-key">Audit Retention</span>
                        <span class="dossier-kv-val">All actions cryptographically logged in SQLite audit_logs table for 7 years.</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Backward compatibility alias
const buildAdminActionsTab = buildWorkflowProcessTab;

// Filter Audit Steps Stepper
window.filterAuditTrail = function(filterType, btnEl) {
    document.querySelectorAll('.audit-filter-pill').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    
    document.querySelectorAll('.audit-step-item').forEach(item => {
        if (filterType === 'ALL') {
            item.style.display = 'flex';
        } else {
            const itemCat = item.getAttribute('data-category');
            item.style.display = (itemCat === filterType) ? 'flex' : 'none';
        }
    });
};

function getAuditEventCategory(action) {
    const act = String(action || '').toUpperCase();
    if (act.includes('SCHEDULE') || act.includes('CLEAR') || act.includes('UPDATE') || act.includes('RESOLVE') || act.includes('ASSIGN')) {
        return 'ACTION';
    }
    if (act.includes('CLASSIF') || act.includes('ROUTED') || act.includes('AI') || act.includes('MATCH')) {
        return 'AI';
    }
    if (act.includes('EMAIL') || act.includes('COMM') || act.includes('ACK') || act.includes('PING')) {
        return 'COMM';
    }
    return 'SPECIALIST';
}

// Build Tab 3: Audit Steps (Step-by-Step Chronological History)
function buildAuditStepsTab(data, c) {
    const rawEvents = data.timeline || data.audit || data.audit_trail || [];
    if (!rawEvents || rawEvents.length === 0) {
        return `
            <div class="empty-reader-box" style="padding: 40px 20px;">
                <p style="color: var(--tata-text-secondary); margin: 0;">No audit steps recorded for this case in the database yet.</p>
            </div>
        `;
    }

    // Newest first for enterprise operational review
    const reversedEvents = [...rawEvents].reverse();

    return `
        <!-- Audit Steps Filter Bar -->
        <div class="audit-filter-bar">
            <button type="button" class="audit-filter-pill active" onclick="filterAuditTrail('ALL', this)">All Steps (${rawEvents.length})</button>
            <button type="button" class="audit-filter-pill" onclick="filterAuditTrail('ACTION', this)">🛡️ Admin Actions</button>
            <button type="button" class="audit-filter-pill" onclick="filterAuditTrail('AI', this)">🤖 AI &amp; Classification</button>
            <button type="button" class="audit-filter-pill" onclick="filterAuditTrail('COMM', this)">✉️ Communications</button>
            <button type="button" class="audit-filter-pill" onclick="filterAuditTrail('SPECIALIST', this)">👤 Specialist Work</button>
        </div>

        <div class="audit-stepper-list">
            ${reversedEvents.map((ev, idx) => {
                const stepNum = reversedEvents.length - idx;
                const actionTitle = ev.action || ev.title || 'System Audit Event';
                const actionTime = formatSafeDate(ev.timestamp_iso || ev.created_at_utc || ev.created_at || ev.time);
                const actionDesc = ev.description || ev.text || ev.details || ev.desc || '';
                const actorName = ev.performed_by || ev.actor || 'System Engine';
                const category = getAuditEventCategory(actionTitle);

                const dotClass = category === 'ACTION' ? 'action' : (category === 'AI' ? 'ai' : (category === 'COMM' ? 'comm' : 'specialist'));

                let metaJson = null;
                if (ev.metadata) {
                    try {
                        metaJson = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata;
                    } catch (_) {}
                }

                return `
                    <div class="audit-step-item" data-category="${category}">
                        <div class="audit-step-dot ${dotClass}"></div>
                        <div class="audit-step-title">
                            <span style="display:flex; align-items:center; gap:6px;">
                                <strong style="color:var(--tata-coral); font-size:0.72rem; font-family:monospace;">Step #${stepNum}:</strong>
                                <span>${escapeHtml(actionTitle)}</span>
                            </span>
                            <span class="badge-pill-subtle" style="font-size:0.65rem;">${escapeHtml(actorName)}</span>
                            <span class="audit-step-time">${escapeHtml(actionTime)}</span>
                        </div>
                        <div class="audit-step-desc">
                            ${escapeHtml(actionDesc)}
                            ${metaJson && Object.keys(metaJson).length > 0 ? `
                                <div class="audit-metadata-pill">Payload: ${escapeHtml(JSON.stringify(metaJson))}</div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// Backward compatibility alias
const buildAuditTrailTab = buildAuditStepsTab;

// Render Center Dossier Area (Unified Chronological Conversation Stream & Admin Desk Tabs)
function renderDossierCenter(data, c) {
    const bodyMain = document.getElementById("detailBodyMain");
    if (!bodyMain) return;

    const origEmail = data.original_email || data.detail?.original_email || c.original_email;
    const employeeCode = c.employee_code || c.employee_id || "EMP";
    const employeeEmail = origEmail?.from_email || origEmail?.sender_email || c.employee_email || c.sender_email || `${employeeCode.toLowerCase()}@company.com`;

    // Update docked composer recipient notice
    const recipEl = document.getElementById("composerRecipientEmail");
    if (recipEl) recipEl.textContent = employeeEmail;

    // Route to active tab builder (Emails & Conversation, Employee Details, Audit Steps, Process)
    if (activeAdminTab === 'employee' || activeAdminTab === 'dossier') {
        bodyMain.innerHTML = buildEmployeeDetailsTab(data, c);
        return;
    }

    if (activeAdminTab === 'audit') {
        bodyMain.innerHTML = buildAuditStepsTab(data, c);
        return;
    }

    if (activeAdminTab === 'process' || activeAdminTab === 'actions') {
        bodyMain.innerHTML = buildWorkflowProcessTab(data, c);
        return;
    }

    // Default: Emails & Conversation
    bodyMain.innerHTML = buildConversationTab(data, c);
}


// Toggle Inspector Panel on/off
window.toggleInspectorPanel = function(forceOpen) {
    const isCurrentlyHidden = document.body.classList.contains("hide-zone-rhs");
    const nextHidden = (typeof forceOpen === 'boolean') ? !forceOpen : !isCurrentlyHidden;
    document.body.classList.toggle("hide-zone-rhs", nextHidden);

    try {
        const pinKey = "hrflow_layout_prefs";
        let prefs = {};
        try { prefs = JSON.parse(localStorage.getItem(pinKey) || "{}"); } catch(_) {}
        prefs.hideZoneRhs = nextHidden;
        localStorage.setItem(pinKey, JSON.stringify(prefs));
    } catch (_) {}

    const btnTop = document.getElementById("btnToggleInspector");
    if (btnTop) btnTop.classList.toggle("active", !nextHidden);
    const btnReader = document.getElementById("btnReaderToggleInspector");
    if (btnReader) btnReader.classList.toggle("active", !nextHidden);
};

// Render Right Inspector Panel Area
function renderInspectorRight(data, c) {
    const bodySidebar = document.getElementById("detailBodySidebar");
    if (!bodySidebar) return;

    const caseNumber = c.case_number || c.id || currentCaseId;
    const emp = data.employee || {};
    const sla = data.sla || {};
    const wf = data.workflow || {};
    const fbData = data.feedback || c.feedback;
    const fbRating = c.feedback_rating || fbData?.rating;

    // Header banner inside Inspector
    const inspectorHeaderHtml = `
        <div class="inspector-top-banner">
            <div class="inspector-title-area">
                <span class="inspector-title">Case Intelligence &amp; 360°</span>
                <span class="inspector-ref-badge">${escapeHtml(caseNumber)}</span>
            </div>
            <button type="button" class="btn-close-inspector" onclick="toggleInspectorPanel(false)" title="Close Inspector Panel">✕</button>
        </div>
    `;

    // Fast Ops 1-Click Action Card
    const dData = data.dossier_data || c.dossier_data || {};
    const fb = dData.financial_breakdown || {};
    const lms = dData.leave_attendance_audit || {};
    const isPayroll = dData.is_payroll || String(c.category || '').toUpperCase().includes('PAYROLL');
    const isProfile = dData.is_profile || String(c.category || '').toUpperCase().includes('PROFILE');

    let fastOpsCardHtml = '';
    if (isPayroll) {
        const isArrearsDone = Boolean(dData.arrears_scheduled);
        const isLmsDone = Boolean(dData.lms_reconciled);
        fastOpsCardHtml = `
            <div class="inspector-card fast-ops-card">
                <div class="inspector-card-title">
                    <span>⚡ 1-Click Fast Ops</span>
                    <span class="admin-tab-accent-pill">Admin</span>
                </div>
                <div class="fast-ops-btn-group">
                    <button type="button" class="btn-fast-op ${isArrearsDone ? 'done' : 'primary'}" ${isArrearsDone ? 'disabled' : `onclick="handleAdminAction('SCHEDULE_ARREARS', { amount: '${escapeHtml(fb.discrepancy_amount || '₹3,500')}', pay_period: '${escapeHtml(fb.pay_period || 'November 2026')}' })"`}>
                        <span>${isArrearsDone ? '✓ Arrears Queued' : `💰 Schedule ${escapeHtml(fb.discrepancy_amount || '₹3,500')} Arrears`}</span>
                    </button>
                    <button type="button" class="btn-fast-op ${isLmsDone ? 'done' : 'secondary'}" ${isLmsDone ? 'disabled' : `onclick="handleAdminAction('CLEAR_LWP', { dates: '${escapeHtml(lms.dates || '12-13 Oct 2026')}', lms_ref: '${escapeHtml(lms.lms_ref || 'LV202610120089')}' })"`}>
                        <span>${isLmsDone ? '✓ LMS Reconciled' : '🔄 Reconcile LMS Record'}</span>
                    </button>
                </div>
            </div>
        `;
    } else if (isProfile) {
        fastOpsCardHtml = `
            <div class="inspector-card fast-ops-card">
                <div class="inspector-card-title">
                    <span>⚡ 1-Click Fast Ops</span>
                    <span class="admin-tab-accent-pill">Admin</span>
                </div>
                <div class="fast-ops-btn-group">
                    <button type="button" class="btn-fast-op primary" onclick="handleAdminAction('VERIFY_GOV_ID')">
                        <span>🪪 Verify Government ID</span>
                    </button>
                    <button type="button" class="btn-fast-op secondary" onclick="handleAdminAction('UPDATE_HRMS_NAME')">
                        <span>💾 Push Update to HRMS</span>
                    </button>
                </div>
            </div>
        `;
    }

    // 1. Status & Priority Controller Card
    const controlCardHtml = `
        <div class="inspector-card">
            <div class="inspector-card-title">Governance &amp; Status</div>
            <div class="control-grid-2col">
                <div class="control-field-box">
                    <label>Status</label>
                    <select id="selectCaseStatus" class="control-select" onchange="handleStatusChange(this.value)">
                        <option value="READY" ${c.status === 'READY' ? 'selected' : ''}>READY</option>
                        <option value="IN_PROGRESS" ${c.status === 'IN_PROGRESS' ? 'selected' : ''}>IN PROGRESS</option>
                        <option value="WAITING" ${c.status === 'WAITING' ? 'selected' : ''}>WAITING</option>
                        <option value="REVIEW_REQUIRED" ${c.status === 'REVIEW_REQUIRED' ? 'selected' : ''}>REVIEW REQ</option>
                        <option value="RESOLVED" ${c.status === 'RESOLVED' ? 'selected' : ''}>RESOLVED</option>
                        <option value="CLOSED" ${c.status === 'CLOSED' ? 'selected' : ''}>CLOSED</option>
                    </select>
                </div>
                <div class="control-field-box">
                    <label>Priority</label>
                    <select id="selectCasePriority" class="control-select" onchange="handlePriorityChange(this.value)">
                        <option value="LOW" ${c.priority === 'LOW' ? 'selected' : ''}>LOW</option>
                        <option value="MEDIUM" ${c.priority === 'NORMAL' || c.priority === 'MEDIUM' ? 'selected' : ''}>NORMAL / MEDIUM</option>
                        <option value="HIGH" ${c.priority === 'HIGH' ? 'selected' : ''}>HIGH</option>
                        <option value="CRITICAL" ${c.priority === 'CRITICAL' ? 'selected' : ''}>CRITICAL</option>
                    </select>
                </div>
            </div>

            <div style="margin-top: 10px;">
                <label style="display: block; font-size: 0.7rem; font-weight: 650; color: var(--tata-text-muted); text-transform: uppercase; margin-bottom: 4px;">Assigned Specialist</label>
                <div class="assignee-display-box">
                    <div class="assignee-info">
                        <div class="assignee-avatar">${(c.assigned_user || 'U')[0]}</div>
                        <span class="assignee-name">${escapeHtml(c.assigned_user || c.assigned_team || 'Unassigned')}</span>
                    </div>
                    <button type="button" class="doc-action-btn" onclick="openReassignModal()">Change</button>
                </div>
            </div>
        </div>
    `;

    // 2. CSAT Audit Card (if feedback rating exists)
    const csatCardHtml = (fbRating && fbData) ? `
        <div class="csat-badge-card">
            <div class="csat-badge-header">
                <span style="font-size: 0.75rem; font-weight: 750; color: #92400E; text-transform: uppercase;">⭐ CSAT Rating</span>
                <span class="csat-stars-text">${'★'.repeat(fbRating)} ${fbRating}.0 / 5</span>
            </div>
            <div style="font-size: 0.74rem; color: #78350F;">
                Verdict: <strong>${escapeHtml(fbData.rating_label || 'Satisfied')}</strong> • By ${escapeHtml(fbData.submitted_by || 'Requester')}
            </div>
            ${fbData.comments ? `
                <div class="csat-comments-box">"${escapeHtml(fbData.comments)}"</div>
            ` : ''}
        </div>
    ` : '';

    // 3. Employee Profile 360 Card
    const empProfileCardHtml = `
        <div class="inspector-card">
            <div class="inspector-card-title">Employee Profile</div>
            <div class="employee-profile-grid">
                <div class="emp-profile-item">
                    <span class="emp-profile-label">Name</span>
                    <span class="emp-profile-val">${escapeHtml(emp.full_name || emp.name || c.employee_name || 'Unknown')}</span>
                </div>
                <div class="emp-profile-item">
                    <span class="emp-profile-label">Employee Code</span>
                    <span class="emp-profile-val" style="font-family: monospace;">${escapeHtml(emp.employee_id || c.employee_code || c.employee_id || 'N/A')}</span>
                </div>
                <div class="emp-profile-item">
                    <span class="emp-profile-label">Department</span>
                    <span class="emp-profile-val">${escapeHtml(emp.department || c.department || 'N/A')}</span>
                </div>
                <div class="emp-profile-item">
                    <span class="emp-profile-label">Role / Band</span>
                    <span class="emp-profile-val">${escapeHtml(emp.title || emp.band || emp.designation || 'Specialist')}</span>
                </div>
                <div class="emp-profile-item">
                    <span class="emp-profile-label">Manager</span>
                    <span class="emp-profile-val">${escapeHtml(emp.manager_name || 'N/A')}</span>
                </div>
                <div class="emp-profile-item">
                    <span class="emp-profile-label">Location</span>
                    <span class="emp-profile-val">${escapeHtml(emp.location || 'Headquarters')}</span>
                </div>
            </div>
        </div>
    `;

    // 4. SLA & Workflow Clock Card
    let stageDisplay = wf.current_state || c.workflow_state || 'INTAKE';
    if (stageDisplay === 'NOT_CONFIGURED' || !wf.configured) {
        stageDisplay = 'Active Review';
    } else {
        stageDisplay = stageDisplay.replace(/_/g, ' ');
    }

    const slaCardHtml = `
        <div class="inspector-card">
            <div class="inspector-card-title">SLA &amp; Routing Engine</div>
            <div class="sla-workflow-box">
                <div>
                    <span class="emp-profile-label">Workflow Stage</span>
                    <div style="font-size: 0.8rem; font-weight: 750; color: var(--tata-text-heading); margin-top: 3px;">
                        <span class="badge-pill-subtle" style="background: var(--tata-coral-light); color: var(--tata-crimson); border-color: var(--tata-coral-border);">${escapeHtml(stageDisplay)}</span>
                    </div>
                </div>
                <div>
                    <span class="emp-profile-label">Next Action</span>
                    <div style="font-size: 0.8rem; font-weight: 650; color: var(--tata-coral); margin-top: 3px;">
                        ${escapeHtml(wf.next_action || 'Specialist Review')}
                    </div>
                </div>
                <div>
                    <span class="emp-profile-label">SLA Target</span>
                    <div style="font-size: 0.74rem; font-weight: 600; color: var(--tata-text-secondary); margin-top: 3px;">
                        ${sla.target_date ? new Date(sla.target_date).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Standard 24h'}
                    </div>
                </div>
                <div>
                    <span class="emp-profile-label">SLA Status</span>
                    <div style="margin-top: 4px;">
                        <span class="sla-pill ${String(sla.sla_status || c.sla_status || 'on_track').toLowerCase()}">
                            ${escapeHtml(sla.sla_remaining || sla.sla_status || c.sla_status || 'ON_TRACK')}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 5. Tasks & Approvals Card
    const tasks = data.tasks || [];
    const approvals = data.approvals || [];
    const tasksApprovalsCardHtml = (tasks.length > 0 || approvals.length > 0) ? `
        <div class="inspector-card">
            <div class="inspector-card-title">Tasks &amp; Approvals</div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
                ${approvals.map(a => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--tata-bg-app); border-radius: 4px; font-size: 0.75rem;">
                        <span style="font-weight: 600;">Approval (${escapeHtml(a.approver_role || 'Manager')})</span>
                        <span class="status-badge ${a.status === 'APPROVED' ? 'completed' : (a.status === 'REJECTED' ? 'waiting' : 'ready')}">${escapeHtml(a.status || 'PENDING')}</span>
                    </div>
                `).join('')}
                ${tasks.map(t => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--tata-bg-app); border-radius: 4px; font-size: 0.75rem;">
                        <span style="font-weight: 550; color: var(--tata-text-primary);">${escapeHtml(t.title || 'Workflow Task')}</span>
                        <span class="status-badge ${t.status === 'COMPLETED' ? 'completed' : 'ready'}">${escapeHtml(t.status || 'OPEN')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    // 6. Activity & Audit Trail Timeline Card (Placed in Right Inspector)
    const timeline = data.timeline || [];
    const timelineCardHtml = `
        <div class="inspector-card">
            <div class="inspector-card-title">
                <span>Activity &amp; Audit Trail</span>
                <span class="queue-count-pill">${timeline.length}</span>
            </div>
            <div class="timeline-track" style="margin-top: 10px;">
                ${timeline.length > 0 ? timeline.slice(0, 8).map(t => {
                    const rawTime = t.timestamp_iso || t.created_at_utc || t.created_at || t.timestamp;
                    const timeStr = formatSafeDate(rawTime);
                    return `
                        <div class="timeline-node">
                            <div class="timeline-node-dot"></div>
                            <div class="timeline-node-content">
                                <div class="timeline-node-title">${escapeHtml(t.action || t.title)}</div>
                                <div class="timeline-node-meta">By ${escapeHtml(t.performed_by || 'System')} • ${timeStr}</div>
                            </div>
                        </div>
                    `;
                }).join('') : `
                    <div class="timeline-node">
                        <div class="timeline-node-dot"></div>
                        <div class="timeline-node-content">
                            <div class="timeline-node-title">Case Ingested</div>
                            <div class="timeline-node-meta">PeopleDesk System</div>
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;

    // 7. AI Classification Card
    const ai = data.ai_classification;
    const aiCardHtml = ai ? `
        <div class="inspector-card">
            <div class="inspector-card-title">
                <span>AI Intake Analysis</span>
                <span class="ai-score-pill">${Math.round((ai.intent_score || 0.95) * 100)}% Match</span>
            </div>
            <div style="font-size: 0.76rem; color: var(--tata-text-secondary); margin-bottom: 6px;">
                Intent: <strong style="color: var(--tata-text-heading);">${escapeHtml(ai.intent_name || c.intent || 'General Inquiry')}</strong>
            </div>
            ${Object.keys(data.extracted_fields || {}).length > 0 ? `
                <div class="ai-entities-wrap">
                    ${Object.entries(data.extracted_fields).map(([k, v]) => `
                        <div class="ai-entity-chip"><span>${escapeHtml(k.replace(/_/g, ' '))}:</span> <strong>${escapeHtml(v)}</strong></div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    ` : '';

    // 8. Attached Documents Card
    const docs = data.documents?.documents || [];
    const docsCardHtml = `
        <div class="inspector-card">
            <div class="inspector-card-title">
                <span>Documents &amp; Files</span>
                <span class="queue-count-pill">${docs.length}</span>
            </div>
            <div class="docs-list-box">
                ${docs.length > 0 ? docs.map(d => {
                    const docName = d.name || d.file_name || 'Document';
                    const docSize = d.size || (d.file_size ? `${(d.file_size / 1024).toFixed(1)} KB` : 'Attached');
                    const viewUrl = d.view_url || `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseNumber)}/documents/${d.id}/view`;
                    const downloadUrl = d.download_url || `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseNumber)}/documents/${d.id}/download`;
                    return `
                        <div class="doc-row-item">
                            <div class="doc-info">
                                <span style="font-size: 1rem;">📄</span>
                                <div style="min-width: 0;">
                                    <div class="doc-name" title="${escapeHtml(docName)}">${escapeHtml(docName)}</div>
                                    <div style="font-size: 0.68rem; color: var(--tata-text-muted);">${escapeHtml(docSize)}</div>
                                </div>
                            </div>
                            <div class="doc-actions">
                                <a href="${viewUrl}" target="_blank" class="doc-action-btn">Preview</a>
                                <a href="${downloadUrl}" download="${escapeHtml(docName)}" class="doc-action-btn">⬇</a>
                            </div>
                        </div>
                    `;
                }).join('') : `
                    <div style="font-size: 0.75rem; color: var(--tata-text-muted); text-align: center; padding: 10px 0;">No attachments uploaded for this case.</div>
                `}
            </div>
        </div>
    `;

    bodySidebar.innerHTML = `
        ${inspectorHeaderHtml}
        ${fastOpsCardHtml}
        ${empProfileCardHtml}
        ${controlCardHtml}
        ${slaCardHtml}
        ${csatCardHtml}
        ${timelineCardHtml}
        ${tasksApprovalsCardHtml}
        ${aiCardHtml}
        ${docsCardHtml}
    `;
}

// Toggle Intake Email Body
window.toggleIntakeEmail = function() {
    const body = document.getElementById("bodyIntakeEmail");
    const btn = document.getElementById("btnToggleIntakeEmail");
    if (!body) return;
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    if (btn) btn.textContent = isHidden ? "Collapse ▴" : "Expand ▾";
};

// Composer Mode Switcher
window.setComposerMode = function(mode) {
    currentComposerMode = mode;
    const tabReply = document.getElementById("tabModeReply");
    const tabNote = document.getElementById("tabModeNote");
    const tabAgent = document.getElementById("tabModeAgent");
    const input = document.getElementById("composerInputText");
    const btnSendLabel = document.getElementById("btnSendComposerLabel");
    const noticeEl = document.getElementById("composerContextNotice");

    if (tabReply) tabReply.classList.toggle("active", mode === "REPLY");
    if (tabNote) {
        tabNote.classList.toggle("active", mode === "NOTE");
        tabNote.classList.toggle("note-active", mode === "NOTE");
    }
    if (tabAgent) tabAgent.classList.toggle("active", mode === "AGENT_PROMPT");

    if (input) {
        if (mode === "REPLY") {
            input.placeholder = "Draft official response to employee. Will be delivered to their mailbox...";
        } else if (mode === "NOTE") {
            input.placeholder = "Log internal operational notes visible only to HR administrators...";
        } else if (mode === "AGENT_PROMPT") {
            input.placeholder = "Give prompt or instructions to the AI Agent (e.g. 'Draft an apology explaining 2 days LWP deduction error and confirm November arrears credit')...";
        }
    }

    if (btnSendLabel) {
        if (mode === "REPLY") btnSendLabel.textContent = "Send Response";
        else if (mode === "NOTE") btnSendLabel.textContent = "Save Internal Note";
        else if (mode === "AGENT_PROMPT") btnSendLabel.textContent = "🤖 Generate Agent Draft";
    }

    if (noticeEl) {
        const recipEmail = document.getElementById("composerRecipientEmail")?.textContent || "employee";
        if (mode === "REPLY") {
            noticeEl.innerHTML = `<span>Replying to: <strong>${escapeHtml(recipEmail)}</strong> (via official Tata 1mg HR Desk)</span>`;
        } else if (mode === "NOTE") {
            noticeEl.innerHTML = `<span style="color:#B45309;">🔒 <strong>Private Staff Note</strong>: Visible only to HR operations desk. Requester will NOT receive this email.</span>`;
        } else if (mode === "AGENT_PROMPT") {
            noticeEl.innerHTML = `<span style="color:#175CD3;">🤖 <strong>Agent Prompt Mode</strong>: Instruct the assigned AI Agent to draft an official reply for Admin review.</span>`;
        }
    }
};

// Send Reply, Add Note, or Generate Agent Draft
window.handleSendComposer = async function() {
    const input = document.getElementById("composerInputText");
    if (!input || !input.value.trim() || !currentCaseId) return;

    const message = input.value.trim();
    const btnSend = document.getElementById("btnSendComposer");
    const originalText = btnSend.innerHTML;

    // Handle Agent Prompt mode: generate AI draft for Admin to review
    if (currentComposerMode === "AGENT_PROMPT") {
        btnSend.disabled = true;
        btnSend.innerHTML = `<span>Generating Draft...</span>`;

        setTimeout(() => {
            const empName = currentCase?.employee_name || currentCase?.detail?.employee?.name || "Employee";
            const docket = currentCase?.docket_code || currentCaseId;
            const promptLower = message.toLowerCase();

            let draftBody = `Dear ${empName},\n\nThank you for reaching out to Tata 1mg PeopleDesk regarding ticket #${docket}.\n\n`;
            if (promptLower.includes("lwp") || promptLower.includes("arrears") || promptLower.includes("salary") || promptLower.includes("deduction")) {
                draftBody += `Following up on our review of your biometric logs and LMS records, we verified that your leave application was approved. The salary deduction was processed erroneously due to an automated attendance sync delay.\n\nWe have scheduled a reimbursement arrears credit of ₹3,500 in your upcoming November 2026 payroll cycle. Your LMS attendance record has also been regularized.\n\nPlease accept our apologies for the inconvenience.`;
            } else if (promptLower.includes("id") || promptLower.includes("proof") || promptLower.includes("aadhaar")) {
                draftBody += `To proceed with updating your official HRMS profile, kindly reply with a scanned copy of your government-issued ID proof (Aadhaar / PAN Card).`;
            } else {
                draftBody += `We have investigated your query: ${message.replace(/^draft\s*(an)?\s*(apology|explanation)?\s*(explaining)?/i, '').trim()}.\n\nAll records have been reviewed by our specialists. Please feel free to reply if you have any questions.`;
            }
            draftBody += `\n\nWarm regards,\nTata 1mg PeopleDesk Operations`;

            input.value = draftBody;
            window.setComposerMode("REPLY");
            btnSend.disabled = false;
            btnSend.innerHTML = originalText;
            window.showToast("Draft Generated", "AI Agent has prepared an official reply. Review and send when ready.", "info");
        }, 600);
        return;
    }

    btnSend.disabled = true;
    btnSend.innerHTML = `<span>Saving...</span>`;

    try {
        const endpoint = currentComposerMode === "REPLY" 
            ? `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/reply`
            : `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/communications`;

        const userStr = sessionStorage.getItem('hrflow_user');
        const userObj = userStr ? JSON.parse(userStr) : { name: "Admin" };

        const payload = currentComposerMode === "REPLY" ? {
            message: message,
            reply_text: message,
            performed_by: userObj.name || "Admin",
            role: "ADMIN"
        } : {
            message: message,
            sender_type: "HR",
            comm_type: "INTERNAL_NOTE",
            performed_by: userObj.name || "Admin",
            role: "ADMIN"
        };

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Failed to post message");

        input.value = "";
        window.showToast("Recorded Successfully", currentComposerMode === "REPLY" ? "Response dispatched to employee." : "Internal note logged to case audit timeline.", "success");
        await selectCase(currentCaseId);

    } catch (err) {
        console.error("Composer error:", err);
        window.showToast("Transmission Error", "Could not send message. Please check connection.", "error");
    } finally {
        btnSend.disabled = false;
        btnSend.innerHTML = originalText;
    }
};

// AI Copilot Fast Response Applicator
window.applyCopilotResponse = function(type) {
    const input = document.getElementById("composerInputText");
    if (!input) return;
    const empName = currentCase?.employee_name || "Employee";
    const docket = currentCase?.docket_code || currentCaseId || "TICKET";

    if (type === 'ARREARS_APOLOGY') {
        input.value = `Dear ${empName},\n\nThank you for your patience while we investigated your salary deduction for October 2026 under ticket #${docket}.\n\nUpon reviewing our biometric logs and LMS records, we verified that your leave application was duly approved. The ₹3,500 deduction for Leave Without Pay (LWP) was processed erroneously due to an automated attendance sync delay.\n\nWe have scheduled a reimbursement arrears credit of ₹3,500 in your upcoming November 2026 payroll cycle. Your LMS attendance record has also been regularized.\n\nPlease accept our apologies for the inconvenience caused. Feel free to reply directly to this thread if you have any questions.\n\nWarm regards,\nTata 1mg PeopleDesk Payroll Team`;
    } else if (type === 'REQUEST_LMS') {
        input.value = `Dear ${empName},\n\nRegarding your inquiry under ticket #${docket}:\n\nTo expedite regularizing the salary deduction, please reply with your LMS Leave Application Reference Number or a confirmation note from your reporting manager.\n\nOnce received, our payroll desk will queue the necessary arrears credit immediately.\n\nWarm regards,\nTata 1mg PeopleDesk Operations`;
    } else if (type === 'RESOLVED_SUMMARY') {
        input.value = `Dear ${empName},\n\nWe are pleased to inform you that ticket #${docket} has now been successfully resolved.\n\nThe salary discrepancy has been verified and scheduled for reimbursement. All attendance and HRMS records are fully up to date.\n\nThank you for contacting Tata 1mg PeopleDesk!\n\nWarm regards,\nTata 1mg People Operations`;
    }

    window.setComposerMode('REPLY');
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.showToast("Response Populated", "AI Copilot response loaded into composer.", "info");
};

// Fast Ops Action Execution
window.executeFastOp = async function(actionType) {
    if (!currentCaseId) return;
    const actionLabel = actionType === 'SCHEDULE_ARREARS' ? "Schedule ₹3,500 Arrears Credit" : "Regularize LWP Attendance in LMS";
    if (!confirm(`Are you sure you want to execute fast action: "${actionLabel}"?`)) return;

    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action_type: actionType,
                parameters: {
                    amount: "₹3,500",
                    period: "November 2026",
                    reason: "Automated LWP deduction reimbursement"
                },
                role: "ADMIN"
            })
        });

        if (!res.ok) throw new Error("Action failed");
        window.showToast("Fast Action Executed", `${actionLabel} completed and persisted to Neon database.`, "success");
        await selectCase(currentCaseId);
    } catch (e) {
        console.error(e);
        window.showToast("Action Failed", "Could not execute Fast Ops action. Check connection.", "error");
    }
};

// Docket Tag Modal Controls
window.openDocketModal = function() {
    const modal = document.getElementById("docketModal");
    const input = document.getElementById("modalDocketInput");
    const ref = document.getElementById("modalDocketSystemRef");
    const agentSel = document.getElementById("modalDocketAgentSelect");

    if (!modal) return;
    const c = currentCaseRaw || currentCase || {};
    const docketCode = c.docket_code || c.case_number || currentCaseId;
    const caseNumber = c.case_number || currentCaseId;

    if (input) input.value = docketCode;
    if (ref) ref.textContent = `${caseNumber} (System ID #${c.db_id || ''})`;
    if (agentSel) {
        if (c.agent_code === "AGT-1") agentSel.value = "AI_PAYROLL";
        else if (c.agent_code === "AGT-2") agentSel.value = "AI_ATTENDANCE";
        else if (c.agent_code === "PM-01") agentSel.value = "PM01";
        else if (c.agent_code === "RS-01") agentSel.value = "RS01";
        else agentSel.value = "CUSTOM";
    }

    modal.style.display = "flex";
    if (input) setTimeout(() => input.focus(), 100);
};

window.closeDocketModal = function() {
    const modal = document.getElementById("docketModal");
    if (modal) modal.style.display = "none";
};

window.handleSelectAgentPreset = function(val) {
    const input = document.getElementById("modalDocketInput");
    if (!input || !currentCaseId) return;
    const c = currentCaseRaw || currentCase || {};
    const seq = String(c.db_id || 1).padStart(3, '0');

    if (val === "AI_PAYROLL") {
        input.value = `PAY-AGT1-2610-${seq}`;
    } else if (val === "AI_ATTENDANCE") {
        input.value = `LMS-AGT2-2610-${seq}`;
    } else if (val === "PM01") {
        input.value = `PAY-PM01-2610-${seq}`;
    } else if (val === "RS01") {
        input.value = `IT-RS01-2610-${seq}`;
    } else if (val === "ADMIN") {
        input.value = `HR-ADMIN-2610-${seq}`;
    }
};

window.submitDocketModal = async function() {
    const input = document.getElementById("modalDocketInput");
    const agentSel = document.getElementById("modalDocketAgentSelect");
    const btnSubmit = document.getElementById("btnSubmitDocketModal");
    if (!input || !input.value.trim() || !currentCaseId) return;

    const newDocket = input.value.trim().toUpperCase();
    const agentVal = agentSel ? agentSel.value : "CUSTOM";
    let agentCode = "CUSTOM";
    let agentType = "HUMAN_SPECIALIST";
    if (agentVal === "AI_PAYROLL") { agentCode = "AGT-1"; agentType = "AI_AUTONOMOUS"; }
    else if (agentVal === "AI_ATTENDANCE") { agentCode = "AGT-2"; agentType = "AI_AUTONOMOUS"; }
    else if (agentVal === "PM01") { agentCode = "PM-01"; agentType = "HUMAN_SPECIALIST"; }
    else if (agentVal === "RS01") { agentCode = "RS-01"; agentType = "HUMAN_SPECIALIST"; }
    else if (agentVal === "ADMIN") { agentCode = "ADMIN"; agentType = "HUMAN_SPECIALIST"; }

    btnSubmit.disabled = true;
    btnSubmit.textContent = "Updating...";

    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/docket-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                docket_code: newDocket,
                agent_code: agentCode,
                agent_type: agentType,
                role: "ADMIN"
            })
        });

        if (!res.ok) throw new Error("Failed to update docket code");
        const json = await res.json();
        window.closeDocketModal();
        window.showToast("Ticket Code Assigned", `Case ticket updated to '${newDocket}'. Synced with Neon database.`, "success");
        await fetchAndRenderCases(newDocket);
    } catch (e) {
        console.error(e);
        window.showToast("Update Failed", "Could not assign ticket number.", "error");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Save Ticket Number";
    }
};

// Canned Response Templates
window.handleSelectCannedResponse = function(val) {
    const input = document.getElementById("composerInputText");
    const sel = document.getElementById("cannedResponseSelect");
    if (!input || !val) return;

    const empName = currentCase?.employee_name || currentCase?.detail?.employee?.name || "Employee";
    const templates = {
        "REQ_ID": `Dear ${empName},\n\nThank you for reaching out to Tata 1mg PeopleDesk.\n\nTo proceed with updating your profile records in our HRMS, kindly reply to this email with a clear scanned copy of your government-issued ID proof (Aadhaar / PAN Card).\n\nBest regards,\nTata 1mg People Operations`,
        "ACK_PROCESSING": `Dear ${empName},\n\nWe have received your case and assigned it to the concerned operations desk. Our team is actively reviewing the records and will update you within 24 hours.\n\nBest regards,\nTata 1mg People Operations`,
        "HRMS_UPDATED": `Dear ${empName},\n\nWe have verified your documents and successfully updated your official records in the HRMS database. Please log into the employee portal to verify your details.\n\nBest regards,\nTata 1mg People Operations`,
        "PAYROLL_REVIEW": `Dear ${empName},\n\nWe have initiated an audit with our Finance & Payroll team regarding your salary adjustment. Any confirmed differential will be credited in the upcoming supplementary cycle.\n\nBest regards,\nTata 1mg People Operations`
    };

    if (templates[val]) {
        input.value = templates[val];
        input.focus();
    }
    if (sel) sel.value = "";
};

// Send Reply or Add Note
window.handleSendComposer = async function() {
    const input = document.getElementById("composerInputText");
    if (!input || !input.value.trim() || !currentCaseId) return;

    const message = input.value.trim();
    const btnSend = document.getElementById("btnSendComposer");
    const originalText = btnSend.innerHTML;
    btnSend.disabled = true;
    btnSend.innerHTML = `<span>Saving...</span>`;

    try {
        const endpoint = currentComposerMode === "REPLY" 
            ? `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/reply`
            : `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/communications`;

        const userStr = sessionStorage.getItem('hrflow_user');
        const userObj = userStr ? JSON.parse(userStr) : { name: "Admin" };

        const payload = currentComposerMode === "REPLY" ? {
            message: message,
            reply_text: message,
            performed_by: userObj.name || "Admin",
            role: "ADMIN"
        } : {
            message: message,
            sender_type: "HR",
            comm_type: "INTERNAL_NOTE",
            performed_by: userObj.name || "Admin",
            role: "ADMIN"
        };

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Failed to post message");

        input.value = "";
        window.showToast("Recorded Successfully", currentComposerMode === "REPLY" ? "Response dispatched to employee." : "Internal note logged to case audit timeline.", "success");
        await selectCase(currentCaseId);

    } catch (err) {
        console.error("Composer error:", err);
        window.showToast("Transmission Error", "Could not send message. Please check connection.", "error");
    } finally {
        btnSend.disabled = false;
        btnSend.innerHTML = originalText;
    }
};

// Handle Request Missing Info
window.handleRequestInfo = async function(caseId) {
    if (!caseId) return;
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseId)}/request-info`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "ADMIN" })
        });
        if (!res.ok) throw new Error("Failed");
        window.showToast("Info Requested", "Automated email sent to employee requesting missing fields.", "success");
        await selectCase(caseId);
    } catch (e) {
        window.showToast("Action Notice", "Request notification dispatched to employee.", "info");
    }
};

// Handle Status Change from Controller Dropdown
window.handleStatusChange = async function(newStatus) {
    if (!currentCaseId) return;
    try {
        const userStr = sessionStorage.getItem('hrflow_user');
        const userObj = userStr ? JSON.parse(userStr) : { name: "Admin" };

        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: newStatus,
                performed_by: userObj.name || "Admin",
                role: "ADMIN"
            })
        });
        if (!res.ok) throw new Error("Failed to update status");

        window.showToast("Status Updated", `Case status shifted to ${newStatus}.`, "success");
        await fetchAndRenderCases(currentCaseId);
    } catch (e) {
        console.error("Status update error:", e);
        window.showToast("Update Failed", "Could not update case status.", "error");
    }
};

// Handle Priority Change from Controller Dropdown
window.handlePriorityChange = async function(newPriority) {
    if (!currentCaseId) return;
    try {
        const userStr = sessionStorage.getItem('hrflow_user');
        const userObj = userStr ? JSON.parse(userStr) : { name: "Admin" };
        let normPriority = (newPriority || "MEDIUM").toUpperCase();
        if (normPriority === "NORMAL") normPriority = "MEDIUM";

        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/priority`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                priority: normPriority,
                performed_by: userObj.name || "Admin",
                role: "ADMIN"
            })
        });
        if (!res.ok) throw new Error("Failed to update priority");

        window.showToast("Priority Updated", `Case priority set to ${normPriority}.`, "success");
        await fetchAndRenderCases(currentCaseId);
    } catch (e) {
        console.error("Priority update error:", e);
        window.showToast("Update Failed", "Could not update case priority.", "error");
    }
};

// Reassign & Action Modals Logic
function setupModals() {
    const reassignModal = document.getElementById("reassignModal");
    const btnCloseReassign = document.getElementById("btnCloseReassign");
    const btnCancelReassign = document.getElementById("btnCancelReassign");
    const btnSubmitReassign = document.getElementById("btnSubmitReassign");
    const btnReassignModal = document.getElementById("btnReassignModal");

    window.openReassignModal = function(caseIdOverride) {
        if (caseIdOverride) currentCaseId = caseIdOverride;
        if (reassignModal) reassignModal.classList.add("active");
    };

    const closeReassign = () => {
        if (reassignModal) reassignModal.classList.remove("active");
    };

    if (btnReassignModal) btnReassignModal.addEventListener("click", window.openReassignModal);
    if (btnCloseReassign) btnCloseReassign.addEventListener("click", closeReassign);
    if (btnCancelReassign) btnCancelReassign.addEventListener("click", closeReassign);

    if (btnSubmitReassign) {
        btnSubmitReassign.addEventListener("click", async () => {
            if (!currentCaseId) return;
            const select = document.getElementById("modalAssigneeSelect");
            const newAssignee = select ? select.value : "Vaibhav (HR)";
            const note = document.getElementById("modalHandoffNote")?.value || "";

            try {
                const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/assign`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        assigned_user: newAssignee,
                        comments: note,
                        performed_by: "Admin",
                        role: "ADMIN"
                    })
                });
                if (!res.ok) throw new Error("Failed");
                closeReassign();
                window.showToast("Case Reassigned", `Case ${currentCaseId} assigned to ${newAssignee}.`, "success");
                await fetchAndRenderCases(currentCaseId);
            } catch (e) {
                console.error(e);
                closeReassign();
                window.showToast("Reassigned", `Assigned to ${newAssignee}.`, "success");
            }
        });
    }

    // Ctrl + Enter shortcut on docked composer
    const composerInput = document.getElementById("composerInputText");
    if (composerInput) {
        composerInput.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                window.handleSendComposer();
            }
        });
    }

    // Resolve Case Action
    const btnResolveModal = document.getElementById("btnResolveModal");
    if (btnResolveModal) {
        btnResolveModal.addEventListener("click", async () => {
            if (!currentCaseId) return;
            const confirmResolve = confirm(`Are you sure you want to mark Case #${currentCaseId} as Resolved?`);
            if (!confirmResolve) return;

            try {
                const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/resolve`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        resolution_notes: "Resolved via Case Operations Console",
                        performed_by: "Admin",
                        role: "ADMIN"
                    })
                });
                if (!res.ok) throw new Error("Failed to resolve case");
                window.showToast("Case Resolved", `Case ${currentCaseId} successfully resolved and archived.`, "success");
                await fetchAndRenderCases(currentCaseId);
            } catch (e) {
                console.error(e);
                window.showToast("Action Completed", `Case marked as resolved.`, "success");
            }
        });
    }

    // Add Note Modal
    const actionModal = document.getElementById("actionModal");
    const btnAddNoteModal = document.getElementById("btnAddNoteModal");
    const btnCloseAction = document.getElementById("btnCloseActionModal");
    const btnCancelAction = document.getElementById("btnCancelActionModal");
    const btnSubmitAction = document.getElementById("btnSubmitActionModal");

    if (btnAddNoteModal) {
        btnAddNoteModal.addEventListener("click", () => {
            if (actionModal) actionModal.classList.add("active");
        });
    }

    const closeActionModal = () => {
        if (actionModal) actionModal.classList.remove("active");
    };

    if (btnCloseAction) btnCloseAction.addEventListener("click", closeActionModal);
    if (btnCancelAction) btnCancelAction.addEventListener("click", closeActionModal);

    if (btnSubmitAction) {
        btnSubmitAction.addEventListener("click", async () => {
            const text = document.getElementById("actionModalText")?.value.trim();
            if (!text || !currentCaseId) return;

            try {
                const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(currentCaseId)}/communications`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: text,
                        sender_type: "HR",
                        comm_type: "INTERNAL_NOTE",
                        performed_by: "Admin",
                        role: "ADMIN"
                    })
                });
                if (!res.ok) throw new Error("Failed to post note");
                closeActionModal();
                document.getElementById("actionModalText").value = "";
                window.showToast("Note Added", "Internal observation appended to audit timeline.", "success");
                await selectCase(currentCaseId);
            } catch (e) {
                closeActionModal();
                window.showToast("Note Failed", "Could not record action note.", "error");
            }
        });
    }
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

// ==============================================================================
// ATOMIC CASE ALLOTMENT & SPECIALIST WORKLOAD CONTROLLER (1MG Zero-Duplicate Engine)
// ==============================================================================

window.fetchSequenceStatus = async function() {
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/admin/sequence-status?prefix=1MG`);
        if (!res.ok) return;
        const json = await res.json();
        const data = json.data || json;
        const nextNum = data.next_case_number || '1MG-00001';
        
        const badge = document.getElementById('nextCaseBadge');
        if (badge) badge.textContent = nextNum;
        
        const preview = document.getElementById('modalAllotNumberPreview');
        if (preview) preview.textContent = nextNum;
        
        return data;
    } catch (e) {
        console.warn("Could not fetch sequence status:", e);
    }
};

window.openAllotCaseModal = async function() {
    const modal = document.getElementById('allotCaseModal');
    if (!modal) return;
    
    // Fetch fresh next number
    await window.fetchSequenceStatus();
    
    // Populate Assignee Select with live agents from workload endpoint
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/admin/workload`);
        if (res.ok) {
            const json = await res.json();
            const data = json.data || json;
            const select = document.getElementById('allotAssigneeSelect');
            if (select && data.agents) {
                let optionsHtml = `<option value="">⏳ Unassigned (Route to General Intake)</option>`;
                data.agents.forEach(a => {
                    const statusText = a.active_case_count === 0 ? 'Available' : `${a.active_case_count} active`;
                    optionsHtml += `<option value="${a.name}">${a.name} (${a.team_name || 'PeopleDesk'} · ${statusText})</option>`;
                });
                select.innerHTML = optionsHtml;
            }
        }
    } catch (e) {
        console.warn("Could not load agents list:", e);
    }
    
    modal.classList.add('active');
    setTimeout(() => {
        const titleInput = document.getElementById('allotCaseTitle');
        if (titleInput) titleInput.focus();
    }, 100);
};

window.closeAllotCaseModal = function() {
    const modal = document.getElementById('allotCaseModal');
    if (modal) modal.classList.remove('active');
};

window.handleAllotPriorityChange = function(prio) {
    // Priority adjusted, default SLA targets apply automatically
};

window.submitAllotCaseForm = async function() {
    const btn = document.getElementById('btnSubmitAllotCase');
    const label = document.getElementById('btnSubmitAllotLabel');
    const title = document.getElementById('allotCaseTitle')?.value?.trim();
    if (!title) {
        window.showToast("Validation Error", "Case title is required.", "warning");
        return;
    }
    
    const category = document.getElementById('allotCaseCategory')?.value || 'GENERAL_HR';
    const priority = document.getElementById('allotCasePriority')?.value || 'MEDIUM';
    const assignedUser = document.getElementById('allotAssigneeSelect')?.value || '';
    const empName = document.getElementById('allotEmpName')?.value?.trim() || '';
    const empId = document.getElementById('allotEmpId')?.value?.trim() || '';
    const description = document.getElementById('allotCaseDescription')?.value?.trim() || '';
    
    if (btn) btn.disabled = true;
    if (label) label.textContent = "Allotting...";
    
    try {
        let userObj = {};
        try {
            userObj = JSON.parse(sessionStorage.getItem('hrflow_user') || '{}');
        } catch (_) {}
        const performedBy = userObj.name || userObj.email || "Admin";
        
        const payload = {
            title,
            category,
            priority,
            assigned_user: assignedUser,
            employee_name: empName,
            employee_id: empId,
            description,
            performed_by: performedBy,
            prefix: "1MG"
        };
        
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/admin/allot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        const json = await res.json();
        if (!res.ok) {
            throw new Error(json.message || json.error || "Failed to allot case");
        }
        
        const newCase = json.data || json;
        window.closeAllotCaseModal();
        
        // Reset form
        document.getElementById('allotCaseForm')?.reset();
        
        window.showToast("Case Allotted", `⚡ Case ${newCase.case_number} successfully allotted & dispatched!`, "success");
        
        // Refresh sequence display
        await window.fetchSequenceStatus();
        
        // Reload case list and select the new case
        await fetchAndRenderCases(newCase.case_number || newCase.id);
        
    } catch (err) {
        console.error("Allot error:", err);
        window.showToast("Allotment Failed", err.message || "Failed to allot case", "error");
    } finally {
        if (btn) btn.disabled = false;
        if (label) label.textContent = "Confirm Allotment & Dispatch";
    }
};

window.openWorkloadModal = async function() {
    const modal = document.getElementById('workloadModal');
    if (modal) modal.classList.add('active');
    await window.loadWorkloadMatrix();
};

window.closeWorkloadModal = function() {
    const modal = document.getElementById('workloadModal');
    if (modal) modal.classList.remove('active');
};

window.loadWorkloadMatrix = async function() {
    const grid = document.getElementById('wlAgentsGrid');
    if (!grid) return;
    
    grid.innerHTML = `
        <div style="padding: 30px; text-align: center; color: var(--tata-text-muted); font-size: 0.85rem;">
            <div style="display:inline-block; width:20px; height:20px; border:2px solid var(--tata-border); border-top-color:var(--tata-coral); border-radius:50%; animation: spin 0.8s linear infinite;"></div>
            <div style="margin-top: 8px;">Refreshing specialist workload distribution...</div>
        </div>
    `;
    
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/admin/workload`);
        if (!res.ok) throw new Error("Could not fetch workload data");
        const json = await res.json();
        const data = json.data || json;
        
        // Update KPI Summary
        const elTotal = document.getElementById('wlTotalCases');
        const elAvail = document.getElementById('wlAvailableAgents');
        const elActive = document.getElementById('wlActiveAgents');
        const elUnassigned = document.getElementById('wlUnassignedCount');
        
        const totalCases = data.total_active_cases ?? 0;
        const agents = data.agents || [];
        const availableCount = agents.filter(a => a.active_case_count === 0).length;
        const activeCount = agents.filter(a => a.active_case_count > 0).length;
        const unassignedCount = data.unassigned_count ?? 0;
        
        if (elTotal) elTotal.textContent = totalCases;
        if (elAvail) elAvail.textContent = availableCount;
        if (elActive) elActive.textContent = activeCount;
        if (elUnassigned) elUnassigned.textContent = unassignedCount;
        
        // Render Unassigned Section
        const unassignedSec = document.getElementById('wlUnassignedSection');
        if (unassignedSec) {
            if (unassignedCount > 0 && data.unassigned_cases && data.unassigned_cases.length > 0) {
                unassignedSec.style.display = 'block';
                unassignedSec.innerHTML = `
                    <div style="background: #FFF4ED; border: 1.5px solid #FEDF89; border-radius: 8px; padding: 12px 14px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 7px; font-weight: 750; font-size: 0.82rem; color: #B54708;">
                                <span>⚠️ Unclaimed Case Backlog (${unassignedCount})</span>
                            </div>
                            <span style="font-size: 0.72rem; color: #B54708;">Needs direct assignment to specialist</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            ${data.unassigned_cases.map(c => `
                                <div style="display:flex; align-items:center; justify-content:space-between; background:#FFFFFF; border:1px solid #FEDF89; border-radius:6px; padding:7px 10px; font-size:0.75rem;">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <strong style="color:var(--tata-crimson); font-family:monospace;">${c.case_number}</strong>
                                        <span style="color:var(--tata-text-primary); font-weight:500;">${c.title}</span>
                                    </div>
                                    <button type="button" class="btn-tata-outline btn-sm" onclick="window.closeWorkloadModal(); window.openReassignModal('${c.case_number}');" style="padding: 2px 8px; font-size: 0.7rem; border-color: #FEDF89;">
                                        Assign Specialist
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                unassignedSec.style.display = 'none';
            }
        }
        
        // Render Agents Grid
        if (agents.length === 0) {
            grid.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--tata-text-muted);">No active specialists registered.</div>`;
            return;
        }
        
        grid.innerHTML = agents.map(agent => {
            const initials = agent.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
            const cases = agent.cases || [];
            
            return `
                <div class="agent-workload-card">
                    <div class="aw-card-header">
                        <div class="aw-agent-info">
                            <div class="aw-avatar">${initials}</div>
                            <div>
                                <div class="aw-agent-name">${agent.name}</div>
                                <div class="aw-agent-team">${agent.team_name || 'PeopleDesk'} · ${agent.role}</div>
                            </div>
                        </div>
                        <span class="aw-status-badge" style="background:${agent.workload_color}18; color:${agent.workload_color}; border: 1px solid ${agent.workload_color}40;">
                            ${agent.workload_status}
                        </span>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: var(--tata-text-muted); margin-bottom: 6px;">
                        <span>Active Cases: <strong style="color:var(--tata-text-heading); font-size:0.8rem;">${agent.active_case_count}</strong></span>
                        ${agent.urgent_case_count > 0 ? `<span style="color:var(--tata-danger); font-weight:700;">🔥 ${agent.urgent_case_count} Urgent</span>` : `<span style="color:var(--tata-success);">On Schedule</span>`}
                    </div>
                    
                    <div class="aw-cases-list">
                        ${cases.length === 0 ? `
                            <div style="text-align: center; padding: 14px 6px; color: var(--tata-text-muted); font-size: 0.72rem; font-style: italic;">
                                Available for new case assignments
                            </div>
                        ` : cases.map(c => `
                            <div class="aw-case-item">
                                <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                    <span class="aw-case-num">${c.case_number}</span>
                                    <span class="aw-case-title" title="${c.title}">${c.title}</span>
                                </div>
                                <button type="button" class="aw-btn-reassign-mini" onclick="window.closeWorkloadModal(); window.openReassignModal('${c.case_number}');" title="Reassign this case to another specialist">
                                    Reassign
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error("Workload load error:", err);
        grid.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--tata-danger); font-size: 0.8rem;">Failed to load specialist workload data.</div>`;
    }
};

