/**
 * sidebar.js — Shared Sidebar Component & Loader (Single Source of Truth)
 *
 * Synchronously injects the unified HR Flow sidebar (matching inbox.html / Image 1)
 * into <div id="sidebarContainer"></div> so that:
 *   1. Zero layout shift / flash on page load
 *   2. Page scripts (inbox.js, dashboard.js, etc.) find all .nav-item and badge IDs
 *      immediately during DOMContentLoaded
 *   3. All 5 pages share the exact same sidebar from one file
 */

(function () {
    "use strict";

    // Cross-tab session persistence: ensure target="_blank" tabs inherit active token & user identity
    try {
        const curToken = sessionStorage.getItem("hrflow_token");
        const curUser = sessionStorage.getItem("hrflow_user");
        if (curToken) {
            localStorage.setItem("hrflow_last_token", curToken);
        } else {
            const savedToken = localStorage.getItem("hrflow_last_token");
            if (savedToken) sessionStorage.setItem("hrflow_token", savedToken);
        }
        if (curUser) {
            localStorage.setItem("hrflow_last_user", curUser);
        } else {
            const savedUser = localStorage.getItem("hrflow_last_user");
            if (savedUser) sessionStorage.setItem("hrflow_user", savedUser);
        }
    } catch (_) {}

    const SIDEBAR_HTML = `
<aside class="sidebar" id="appSidebar">
    <div class="sidebar-brand">
        <div class="brand-logo" onclick="window.toggleSidebarRail && window.toggleSidebarRail()" style="cursor:pointer;" title="Expand / Collapse Sidebar (Ctrl+B)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="5" fill="none"></rect>
                <path d="M12 7v10M7 12h10" stroke-width="2.6" stroke="#FFFFFF"></path>
            </svg>
        </div>
        <div class="brand-text">
            <span class="brand-title">TATA <span class="brand-title-accent">1mg</span></span>
            <span class="brand-sub">PEOPLEDESK · ADMIN</span>
        </div>
        <button type="button" class="sidebar-rail-toggle" id="btnSidebarCollapseRail" onclick="window.toggleSidebarRail && window.toggleSidebarRail()" title="Collapse Sidebar (Ctrl+B)">
            <svg class="rail-chevron-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        </button>
    </div>

    <nav class="sidebar-nav">
        <!-- 1. Dashboard -->
        <a href="dashboard.html" class="nav-item" data-module="dashboard" data-page="dashboard.html" data-title="Dashboard" title="Dashboard">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1.5"></rect>
                <rect x="14" y="3" width="7" height="5" rx="1.5"></rect>
                <rect x="14" y="12" width="7" height="9" rx="1.5"></rect>
                <rect x="3" y="16" width="7" height="5" rx="1.5"></rect>
            </svg>
            <span>Dashboard</span>
        </a>

        <!-- 2. Inbox -->
        <a href="inbox.html#inbox" class="nav-item" data-module="inbox" data-page="inbox.html" data-title="Inbox" title="Mail Inbox">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2.5"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
            </svg>
            <span>Inbox</span>
            <span class="nav-badge" id="navInboxBadge">0</span>
        </a>

        <!-- 3. Cases -->
        <a href="inbox.html#cases" class="nav-item" data-module="cases" data-page="inbox.html" data-title="Cases" title="Cases">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2.5"></rect>
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"></path>
                <path d="M2 12h20"></path>
            </svg>
            <span>Cases</span>
            <span class="nav-badge" id="navCasesBadge">0</span>
        </a>

        <!-- 4. Departments -->
        <a href="inbox.html#departments" class="nav-item" data-module="departments" data-page="inbox.html" data-title="Departments" title="HR Departments">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                <rect x="8.5" y="14" width="7" height="7" rx="1.5"></rect>
                <path d="M6.5 10v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"></path>
            </svg>
            <span>Departments</span>
            <span class="nav-badge" id="navDepartmentsBadge">0</span>
        </a>

        <!-- 5. Actions -->
        <a href="inbox.html#actions" class="nav-item" data-module="actions" data-page="inbox.html" data-title="Actions" title="Actions & Escalations">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span>Actions</span>
            <span class="nav-badge" id="navActionsBadge">0</span>
        </a>

        <!-- 6. User Management -->
        <a href="inbox.html#users" class="nav-item" data-module="users" data-page="inbox.html" id="navUsersLink" data-title="User Management" title="User Management & Governance">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            </svg>
            <span>User Management</span>
        </a>

        <!-- 7. Reports -->
        <a href="inbox.html#reports" class="nav-item" data-module="reports" data-page="inbox.html" data-title="Reports" title="Reports & Analytics">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2.5"></rect>
                <line x1="8" y1="17" x2="8" y2="11"></line>
                <line x1="12" y1="17" x2="12" y2="7"></line>
                <line x1="16" y1="17" x2="16" y2="13"></line>
            </svg>
            <span>Reports</span>
            <span class="nav-badge" id="navReportsBadge">0</span>
        </a>

        <!-- 8. Audit -->
        <a href="inbox.html#audit" class="nav-item" data-module="audit" data-page="inbox.html" data-title="Audit" title="Audit & Forensic Logs">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4"></path>
            </svg>
            <span>Audit</span>
        </a>
    </nav>

    <div class="sidebar-footer">
        <!-- Dedicated Collapse / Expand Toggle Button -->
        <button type="button" class="sidebar-collapse-toggle-btn" id="btnSidebarCollapseBottom" onclick="window.toggleSidebarRail && window.toggleSidebarRail()" title="Collapse Sidebar (Ctrl+B)">
            <svg class="rail-chevron-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            <span class="collapse-toggle-label">Collapse Sidebar</span>
        </button>

        <button type="button" class="sidebar-signout-btn" onclick="window.hrflowSignOut && window.hrflowSignOut()" title="Sign Out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span class="signout-label">Sign Out</span>
        </button>

        <div class="engine-status" title="Tata 1mg PeopleDesk · Live">
            <span class="pulse-dot"></span>
            <span class="engine-status-text">Tata 1mg PeopleDesk · Live</span>
        </div>
    </div>
</aside>`;

    const AGENT_SIDEBAR_HTML = `
<aside class="sidebar" id="appSidebar">
    <div class="sidebar-brand">
        <div class="brand-logo" title="Tata 1mg Specialist Portal">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="5" fill="none"></rect>
                <path d="M12 7v10M7 12h10" stroke-width="2.6" stroke="#FFFFFF"></path>
            </svg>
        </div>
        <div class="brand-text">
            <span class="brand-title">TATA <span class="brand-title-accent">1mg</span></span>
            <span class="brand-sub">PEOPLEDESK · SPECIALIST</span>
        </div>
        <button type="button" class="sidebar-rail-toggle" id="btnSidebarCollapseRail" onclick="window.toggleSidebarRail && window.toggleSidebarRail()" title="Collapse / Expand Sidebar (Ctrl+B)">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" fill-opacity="0.14"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <polyline points="15 9 12 12 15 15"></polyline>
            </svg>
        </button>
    </div>

    <nav class="sidebar-nav">
        <div class="nav-group-label">WORKSPACE</div>

        <a href="agent.html#inbox" class="nav-item" data-module="inbox" data-page="agent.html" title="Mail Inbox">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="3" fill="currentColor" fill-opacity="0.18"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
            </svg>
            <span>Inbox</span>
            <span class="nav-badge" id="navInboxBadge">0</span>
        </a>

        <a href="agent.html#cases" class="nav-item" data-module="cases" data-page="agent.html" id="navAgentWorkbenchLink" title="Cases">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2.5" fill="currentColor" fill-opacity="0.18"></rect>
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"></path>
                <path d="M2 12h20"></path>
            </svg>
            <span>Cases</span>
            <span class="nav-badge" id="navCasesBadge">0</span>
        </a>

        <a href="agent.html#actions" class="nav-item" data-module="actions" data-page="agent.html" title="Actions & Replies">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fill-opacity="0.22"></polygon>
            </svg>
            <span>Actions</span>
            <span class="nav-badge" id="navActionsBadge">0</span>
        </a>
    </nav>

    <div class="sidebar-footer">
        <button type="button" class="sidebar-signout-btn" onclick="window.hrflowSignOut && window.hrflowSignOut()" title="Sign Out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6F61" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span class="signout-label">Sign Out</span>
        </button>
        <div class="engine-status">
            <span class="pulse-dot"></span>
            <span class="engine-status-text">Tata 1mg Specialist Desk</span>
        </div>
    </div>
</aside>`;

    const API_BASE =
        (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
        window.location.port &&
        window.location.port !== "5000"
            ? "http://127.0.0.1:5000"
            : "";

    window.hrflowSignOut = async function () {
        try {
            const token = sessionStorage.getItem("hrflow_token") || "";
            await fetch(`${API_BASE}/api/auth/logout`, {
                method: "POST",
                credentials: "same-origin",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
        } catch (_) {}
        sessionStorage.removeItem("hrflow_token");
        sessionStorage.removeItem("hrflow_user");
        localStorage.removeItem("hrflow_last_token");
        localStorage.removeItem("hrflow_last_user");
        window.location.replace("login.html");
    };

    const PAGE_MODULE_MAP = {
        "dashboard.html":         "dashboard",
        "agentworktracker.html":  "agents-status",
        "agent.html":             "agent-workbench",
        "casedetail.html":        "cases",
        "inbox.html":             null,
        "cases.html":             "cases",
        "builder.html":           "builder"
    };

    function getCurrentPage() {
        const path = window.location.pathname;
        return path.substring(path.lastIndexOf("/") + 1) || "dashboard.html";
    }

    function getActiveModule() {
        const page = getCurrentPage();
        if (page === "inbox.html") {
            const hash = window.location.hash.replace("#", "");
            return hash || "inbox";
        }
        if (page === "agent.html") {
            const hash = window.location.hash.replace("#", "");
            if (hash === "agent-workbench") return "cases";
            const validAgentMods = ["agent-workbench", "inbox", "cases", "approvals", "actions"];
            return validAgentMods.includes(hash) ? hash : "cases";
        }
        if (page === "casedetail.html") {
            return "cases";
        }
        return PAGE_MODULE_MAP[page] || null;
    }

    function highlightActiveModule() {
        const mod = getActiveModule();
        if (!mod) return;
        document.querySelectorAll("#appSidebar .sidebar-nav .nav-item").forEach(item => {
            item.classList.toggle("active", item.getAttribute("data-module") === mod);
        });
    }
    window.highlightSidebarActiveModule = highlightActiveModule;

    function applyRBAC(overrideRole) {
        try {
            const page = getCurrentPage();
            let role = overrideRole;
            if (!role) {
                const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
                if (userStr) {
                    const userObj = JSON.parse(userStr);
                    let dirty = false;
                    if (userObj.role && String(userObj.role).toUpperCase() === "SUPER_ADMIN") {
                        userObj.role = "ADMIN";
                        dirty = true;
                    }
                    if (userObj.name && String(userObj.name).toLowerCase() === "super admin") {
                        userObj.name = "Admin";
                        dirty = true;
                    }
                    if (userObj.designation && String(userObj.designation).toLowerCase() === "super admin") {
                        userObj.designation = "Admin";
                        dirty = true;
                    }
                    if (userObj.role_title && String(userObj.role_title).toLowerCase().includes("super admin")) {
                        userObj.role_title = "Admin";
                        dirty = true;
                    }
                    if (dirty) {
                        sessionStorage.setItem("hrflow_user", JSON.stringify(userObj));
                    }
                    role = userObj.role;
                }
            }
            if (!role) {
                role = page === "agent.html" ? "HR_AGENT" : "ADMIN";
            }
            role = String(role).toUpperCase();
            if (role === "SUPER_ADMIN") role = "ADMIN";

            // Enforce page-level access guard: HR_AGENT may ONLY access agent.html (and public track.html)
            if (role === "HR_AGENT") {
                const restrictedPages = ["dashboard.html", "agentworktracker.html", "inbox.html", "builder.html", "cases.html"];
                if (restrictedPages.includes(page)) {
                    window.location.replace("agent.html" + (window.location.hash || ""));
                    return;
                }
                // On agent.html, AGENT_SIDEBAR_HTML is already dedicated to HR_AGENT
                return;
            }

            // Reset all items to visible first
            document.querySelectorAll("#appSidebar .sidebar-nav .nav-item").forEach(el => {
                el.style.display = "flex";
            });
            document.querySelectorAll("#appSidebar .sidebar-nav .nav-group-label").forEach(lbl => {
                lbl.style.display = "block";
            });

            if (page === "agent.html" || page === "casedetail.html") {
                return;
            }

            if (role === "ADMIN") {
                const usersLink = document.getElementById("navUsersLink");
                if (usersLink) usersLink.style.display = "flex";
            } else if (role === "HR_LEAD" || role === "HR_MANAGER") {
                const hiddenModules = ["users", "audit"];
                hiddenModules.forEach(mod => {
                    const el = document.querySelector(`#appSidebar .sidebar-nav .nav-item[data-module="${mod}"]`);
                    if (el) el.style.display = "none";
                });
            }
        } catch (e) {
            // ignore session parse errors
        }
    }

    window.applySidebarRBAC = applyRBAC;

    function updateBadge(badgeId, count) {
        const el = document.getElementById(badgeId);
        if (!el) return;
        const n = parseInt(count, 10) || 0;
        if (n > 0) {
            el.textContent = n > 99 ? "99+" : String(n);
            el.setAttribute("data-count", String(n));
            el.style.display = "inline-flex";
        } else {
            el.textContent = "0";
            el.setAttribute("data-count", "0");
            el.style.display = "none";
        }
    }
    window.updateSidebarBadgeHelper = updateBadge;

    async function updateBadgeCounts() {
        const page = getCurrentPage();
        // inbox.js refreshes badges on inbox.html; agent.js refreshes department-scoped badges on agent.html
        if (page === "inbox.html" || page === "agent.html") return;

        const API = API_BASE;
        try {
            const [casesRes, gmailRes, actionsRes] = await Promise.all([
                fetch(`${API}/api/cases/metrics`).catch(() => null),
                fetch(`${API}/api/gmail/status`).catch(() => null),
                fetch(`${API}/api/actions?limit=100`).catch(() => null)
            ]);

            if (casesRes?.ok) {
                const mJson = await casesRes.json();
                const total = mJson.metrics?.total_cases ?? mJson.total_cases ?? mJson.open_cases ?? 0;
                updateBadge("navCasesBadge", total);
                updateBadge("navReportsBadge", total);
            }
            if (gmailRes?.ok) {
                const gJson = await gmailRes.json();
                const emailCount = gJson.stored_emails_count ?? gJson.unread_count ?? gJson.inbox_total ?? gJson.total_messages ?? 0;
                updateBadge("navInboxBadge", emailCount);
            }
            if (actionsRes?.ok) {
                const acJson = await actionsRes.json();
                updateBadge("navActionsBadge", acJson.count ?? 0);
            }
            updateBadge("navDepartmentsBadge", 0);

            // Pre-warm User Management cache so clicking User Management from Dashboard is 0ms instant
            fetch(`${API}/api/agent/employees`)
                .then(r => r.ok ? r.json() : null)
                .then(rj => {
                    const d = rj?.data || rj;
                    if (d && Array.isArray(d.employees)) {
                        sessionStorage.setItem("hrflow_um_cache_v2", JSON.stringify(d));
                    }
                })
                .catch(() => {});
        } catch (e) {
            // Best-effort badge refresh
        }
    }
    window.updateSidebarBadges = updateBadgeCounts;

    // =========================================================================
    // WORKSPACE SPACE & SPLIT-PANE CONTROLLER (Phase 1–4 Redesign)
    // =========================================================================
    function getLayoutPrefs() {
        try {
            const page = getCurrentPage();
            // Automatically clear legacy collapsed flag for admin dashboard & inbox so user gets full 240px expanded view
            if (!localStorage.getItem("hrflow_sidebar_expanded_reset_v4")) {
                localStorage.removeItem("hrflow_sidebar_collapsed");
                localStorage.setItem("hrflow_sidebar_expanded_reset_v4", "1");
            }

            const isStandaloneWorkspace = page === "agent.html" || page === "agentworktracker.html";
            const railKey = isStandaloneWorkspace ? "hrflow_standalone_rail_collapsed" : "hrflow_sidebar_collapsed";
            const savedRail = localStorage.getItem(railKey);
            // Admin cockpit pages (dashboard, inbox) default to expanded (false)
            const defaultRail = isStandaloneWorkspace || page === "builder.html";
            return {
                sidebarCollapsed: savedRail !== null ? savedRail === "1" : defaultRail,
                compactHeader: localStorage.getItem("hrflow_compact_header") === "1",
                hideZoneList: localStorage.getItem("hrflow_hide_zone_list") === "1",
                hideZoneRhs: localStorage.getItem("hrflow_hide_zone_rhs") === "1",
            };
        } catch (_) {
            return { sidebarCollapsed: false, compactHeader: false, hideZoneList: false, hideZoneRhs: false };
        }
    }

    function syncLayoutBodyClasses() {
        const page = getCurrentPage();
        const isAgent = page === "agent.html" || page === "casedetail.html";
        const pinKey = isAgent ? "hrflow_agent_sidebar_pinned" : "hrflow_sidebar_pinned";

        let isPinned = false;
        try {
            isPinned = localStorage.getItem(pinKey) === "1";
        } catch (_) {}
        document.body.classList.toggle("sidebar-pinned", isPinned);

        const prefs = getLayoutPrefs();
        document.body.classList.toggle("workspace-compact-header", Boolean(prefs.compactHeader));
        document.body.classList.toggle("hide-zone-list", Boolean(prefs.hideZoneList));
        document.body.classList.toggle("hide-zone-rhs", Boolean(prefs.hideZoneRhs));
        const isFocus = Boolean(!isPinned && prefs.hideZoneList && prefs.hideZoneRhs);
        document.body.classList.toggle("focus-reader-mode", isFocus);

        // Update rail toggle buttons and brand logo tooltips
        const railBtn = document.getElementById("btnSidebarCollapseRail");
        if (railBtn) {
            railBtn.title = isPinned
                ? "Sidebar is Pinned Open (Click or Ctrl+B for Hover-to-Open)"
                : "Hover-to-Open Active (Click or Ctrl+B to Pin Open)";
        }
        const bottomBtn = document.getElementById("btnSidebarCollapseBottom");
        if (bottomBtn) {
            bottomBtn.title = isPinned
                ? "Sidebar is Pinned Open (Click or Ctrl+B for Hover-to-Open)"
                : "Hover-to-Open Active (Click or Ctrl+B to Pin Open)";
            const label = bottomBtn.querySelector(".collapse-toggle-label");
            if (label) label.textContent = isPinned ? "Unpin (Hover-to-Open)" : "Pin Sidebar Open";
        }
        const brandLogo = document.querySelector("#appSidebar .brand-logo");
        if (brandLogo) {
            brandLogo.title = isPinned ? "Tata 1mg PeopleDesk (Pinned)" : "Tata 1mg PeopleDesk (Hover to Open)";
        }

        // Update active button states in topbar controller
        const btnRail = document.getElementById("wsBtnToggleRail");
        if (btnRail) btnRail.classList.toggle("active", isPinned);
        const btnCompact = document.getElementById("wsBtnCompactHeader");
        if (btnCompact) btnCompact.classList.toggle("active", Boolean(prefs.compactHeader));
        const btnList = document.getElementById("wsBtnToggleList");
        if (btnList) btnList.classList.toggle("active", !prefs.hideZoneList);
        document.querySelectorAll("#wsBtnToggleRhs, .ai-copilot-pill").forEach((btn) => {
            btn.classList.toggle("active", !prefs.hideZoneRhs);
        });
        const btnFocus = document.getElementById("wsBtnFocusMode");
        if (btnFocus) btnFocus.classList.toggle("active", isFocus);
    }
    window.syncLayoutBodyClasses = syncLayoutBodyClasses;

    window.toggleSidebarRail = function () {
        const page = getCurrentPage();
        const isAgent = page === "agent.html" || page === "casedetail.html";
        const pinKey = isAgent ? "hrflow_agent_sidebar_pinned" : "hrflow_sidebar_pinned";
        const isCurrentlyPinned = document.body.classList.contains("sidebar-pinned");
        const nextPinned = !isCurrentlyPinned;
        document.body.classList.toggle("sidebar-pinned", nextPinned);
        try {
            localStorage.setItem(pinKey, nextPinned ? "1" : "0");
        } catch (_) {}
        syncLayoutBodyClasses();
    };

    window.toggleWorkspaceCompactHeader = function () {
        const next = !document.body.classList.contains("workspace-compact-header");
        try { localStorage.setItem("hrflow_compact_header", next ? "1" : "0"); } catch (_) {}
        syncLayoutBodyClasses();
    };

    let _lastZoneListToggle = 0;
    window.toggleWorkspaceZoneList = function () {
        const now = Date.now();
        if (now - _lastZoneListToggle < 200) return;
        _lastZoneListToggle = now;
        const next = !document.body.classList.contains("hide-zone-list");
        try { localStorage.setItem("hrflow_hide_zone_list", next ? "1" : "0"); } catch (_) {}
        document.body.classList.toggle("hide-zone-list", next);
        syncLayoutBodyClasses();
    };

    let _lastZoneRhsToggle = 0;
    window.toggleWorkspaceZoneRhs = function () {
        const now = Date.now();
        if (now - _lastZoneRhsToggle < 200) return;
        _lastZoneRhsToggle = now;
        const next = !document.body.classList.contains("hide-zone-rhs");
        try { localStorage.setItem("hrflow_hide_zone_rhs", next ? "1" : "0"); } catch (_) {}
        document.body.classList.toggle("hide-zone-rhs", next);
        syncLayoutBodyClasses();
    };

    window.toggleWorkspaceFocusMode = function () {
        const isCurrentlyFocus =
            document.body.classList.contains("sidebar-collapsed") &&
            document.body.classList.contains("hide-zone-list") &&
            document.body.classList.contains("hide-zone-rhs");
        const next = !isCurrentlyFocus;
        try {
            localStorage.setItem("hrflow_sidebar_collapsed", next ? "1" : "0");
            localStorage.setItem("hrflow_compact_header", next ? "1" : "0");
            localStorage.setItem("hrflow_hide_zone_list", next ? "1" : "0");
            localStorage.setItem("hrflow_hide_zone_rhs", next ? "1" : "0");
        } catch (_) {}
        syncLayoutBodyClasses();
    };

    function mountWorkspaceLayoutToolbar() {
        const page = getCurrentPage();
        const hasSplitZones = page === "agent.html" || page === "cases.html";
        if (!hasSplitZones) return;

        const topbar = document.querySelector(".topbar");
        if (!topbar || document.getElementById("hrflowWorkspaceLayoutBar")) return;

        const bar = document.createElement("div");
        bar.id = "hrflowWorkspaceLayoutBar";
        bar.className = "ws-layout-bar";
        bar.innerHTML = `
            <button type="button" class="ws-layout-btn" id="wsBtnCompactHeader" onclick="window.toggleWorkspaceCompactHeader()" title="Compact Top Banner & KPI Cards (+110px Vertical Space)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                <span>Compact</span>
            </button>
            <span class="ws-layout-sep"></span>
            <button type="button" class="ws-layout-btn active" id="wsBtnToggleList" onclick="window.toggleWorkspaceZoneList()" title="Show / Hide Left Queue Pane (+300px Width)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                <span>Queue</span>
            </button>
            <button type="button" class="ws-layout-btn active" id="wsBtnToggleRhs" onclick="window.toggleWorkspaceZoneRhs()" title="Show / Hide Right AI & HR Panel (+340px Width)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                <span>AI Panel</span>
            </button>
            <button type="button" class="ws-layout-btn focus-btn" id="wsBtnFocusMode" onclick="window.toggleWorkspaceFocusMode()" title="Focus Reader Mode — Maximize Center Execution Canvas (Alt+F)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                <span>Focus</span>
            </button>
        `;

        const actionsContainer = topbar.querySelector(".topbar-actions");
        if (actionsContainer) {
            topbar.insertBefore(bar, actionsContainer);
        } else {
            topbar.appendChild(bar);
        }
        syncLayoutBodyClasses();
    }

    function mountSidebarSynchronously() {
        // Automatically ensure the Tata 1mg sidebar stylesheet is attached to <head>
        if (!document.querySelector('link[href*="sidebar.css"]')) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "css/sidebar.css?v=20261030_tata1mg_v14";
            document.head.appendChild(link);
        }

        const container = document.getElementById("sidebarContainer");
        if (!container) return false;
        const page = getCurrentPage();
        container.outerHTML = (page === "agent.html" || page === "casedetail.html")
            ? `<div class="sidebar-rail-wrapper" id="sidebarRailWrapper">${AGENT_SIDEBAR_HTML}</div>`
            : SIDEBAR_HTML;
        highlightActiveModule();
        applyRBAC();
        syncLayoutBodyClasses();
        return true;
    }

    // Mount immediately during HTML parsing if #sidebarContainer is already above this script tag
    const mounted = mountSidebarSynchronously();

    document.addEventListener("DOMContentLoaded", () => {
        if (!mounted) {
            mountSidebarSynchronously();
        }
        mountWorkspaceLayoutToolbar();
        updateBadgeCounts();
    });

    // Global keyboard shortcuts: Ctrl+B / Cmd+B (Sidebar Rail), Alt+F (Focus Mode)
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
            e.preventDefault();
            window.toggleSidebarRail();
        } else if (e.altKey && (e.key === "f" || e.key === "F")) {
            const tag = (e.target && e.target.tagName) || "";
            if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
                e.preventDefault();
                window.toggleWorkspaceFocusMode();
            }
        }
    });
})();
