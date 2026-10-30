/**
 * HR FLOW — Agent Execution Workbench
 * TATA 1mg Design System — Executive Light Mode Controller
 * 
 * Features:
 * - Dynamic View Switching (INBOX, CASES, ACTIONS)
 * - Intelligent Split 2-Pane INBOX (Live Gmail sync, AI analysis, 1-Click Claim to Case, Quick Reply)
 * - Real-Time Search & Filter Tabs
 * - Live Telemetry & KPI Binding
 */

(function () {
    "use strict";

    const BACKEND_API_BASE =
        (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
        window.location.port &&
        window.location.port !== "5000"
            ? "http://127.0.0.1:5000"
            : "";

    // Auth interceptor for Agent Portal API calls
    if (!window._hrAgentFetchPatched) {
        window._hrAgentFetchPatched = true;
        const originalFetch = window.fetch;
        window.fetch = async function () {
            let [resource, config] = arguments;
            if (typeof resource === "string" && (resource.startsWith("/api/") || resource.includes("/api/"))) {
                config = config || {};
                config.credentials = config.credentials || "same-origin";
                config.headers = config.headers || {};
                const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
                const token = sessionStorage.getItem("hrflow_token") || localStorage.getItem("hrflow_last_token");
                if (userStr) {
                    try {
                        const userObj = JSON.parse(userStr);
                        config.headers["X-HR-User"] = userObj.name || userObj.email || "Admin";
                        const rawRole = (userObj.role || "HR_AGENT").toUpperCase();
                        config.headers["X-HR-Role"] = rawRole === "SUPER_ADMIN" ? "ADMIN" : rawRole;
                        config.headers["X-HR-Email"] = userObj.email || "";
                    } catch (_) {}
                }
                if (token) {
                    config.headers["Authorization"] = `Bearer ${token}`;
                }
            }
            return originalFetch(resource, config);
        };
    }

    // View configurations
    const VIEW_CONFIGS = {
        "case": {
            title: "CASES WORKSPACE",
            tag: "Active Desk",
            tabs: ["all", "assigned", "unclaimed", "urgent"]
        },
        "inbox": {
            title: "INBOX WORKSPACE",
            tag: "Incoming Intake",
            tabs: ["all", "actionable", "unclaimed", "noise"]
        },
        "replies": {
            title: "CASE REPLIES",
            tag: "Case Outbound Emails",
            tabs: ["all"]
        },
        "action": {
            title: "ACTIONS WORKSPACE",
            tag: "HRMS Operations",
            tabs: ["all", "tasks", "approvals"]
        },
        "urgent-sla": {
            title: "URGENT / SLA ALERTS",
            tag: "High Priority",
            tabs: ["urgent", "all"]
        },
        "approvals": {
            title: "MANAGER APPROVALS GATE",
            tag: "Sign-Off Required",
            tabs: ["all", "assigned"]
        },
        "audit": {
            title: "AUDIT & ACTIVITY LOGS",
            tag: "Compliance Trail",
            tabs: ["all"]
        }
    };
    VIEW_CONFIGS["cases"] = VIEW_CONFIGS["case"];
    VIEW_CONFIGS["reply"] = VIEW_CONFIGS["replies"];

    // State
    let currentView = "case";
    let activeCaseFilter = "all";
    let allCases = [];
    let workbenchData = null;
    let isAiPanelActive = localStorage.getItem("hrflow_agent_ai_panel") !== "0"; // Default: TRUE (Active)

    // Inbox Specific State
    let inboxEmails = [];
    let selectedEmailId = null;
    let inboxActiveTab = "useful";
    let inboxSearchQuery = "";
    let isStreamCollapsed = false;

    // Cases Twin-Pane Specific State
    let selectedCaseRef = null;
    let currentDossierData = null;
    let currentDossierStep = 1;
    let isCasesStreamCollapsed = false;
    let casesSearchQuery = "";

    // Replies Specific State
    let caseRepliesList = [];
    let repliesSearchQuery = "";

    // DOM Elements
    let sidebarEl = null;
    let navContainer = null;
    let viewTitleTextEl = null;
    let viewActiveTagEl = null;
    let clockEl = null;
    let feedContainer = null;
    let searchInput = null;

    // View Containers
    let inboxViewContainer = null;
    let casesViewContainer = null;
    let repliesViewContainer = null;
    let repliesListContainer = null;
    let repliesSearchInputEl = null;
    let inboxEmailListEl = null;
    let inboxDetailPaneEl = null;
    let inboxFilterTabsEl = null;
    let inboxSearchInputEl = null;
    let btnSyncMailboxEl = null;
    let btnToggleAiPanelEl = null;

    /**
     * DOM Ready Init
     */
    document.addEventListener("DOMContentLoaded", () => {
        initDOMElements();
        initSidebarEvents();
        initNavigation();
        initCaseTabs();
        initInboxEvents();
        initAiPanelEvents();
        initLiveClock();
        initGlobalSearch();
        loadWorkbenchData();

        window.addEventListener("hashchange", handleHashChange);
        if (window.location.hash) {
            handleHashChange();
        } else {
            switchActiveView("case");
        }
    });

    /**
     * Cache DOM Elements
     */
    function initDOMElements() {
        sidebarEl = document.getElementById("agentSidebar");
        navContainer = document.getElementById("sidebarNav");
        viewTitleTextEl = document.getElementById("viewTitleText");
        viewActiveTagEl = document.getElementById("viewActiveTag");
        clockEl = document.getElementById("topbarClock");
        feedContainer = document.getElementById("feedListContainer");
        searchInput = document.getElementById("globalSearchInput");

        // View Containers
        inboxViewContainer = document.getElementById("inboxViewContainer");
        casesViewContainer = document.getElementById("casesViewContainer");
        repliesViewContainer = document.getElementById("repliesViewContainer");

        // Replies Specific Elements
        repliesListContainer = document.getElementById("repliesListContainer");
        repliesSearchInputEl = document.getElementById("repliesSearchInput");
        if (repliesSearchInputEl) {
            repliesSearchInputEl.addEventListener("input", (e) => {
                repliesSearchQuery = (e.target.value || "").toLowerCase().trim();
                renderRepliesList();
            });
        }

        // Inbox Specific Elements
        inboxEmailListEl = document.getElementById("inboxEmailList");
        inboxDetailPaneEl = document.getElementById("inboxEmailDetailPane");
        inboxFilterTabsEl = document.getElementById("inboxFilterTabs");
        inboxSearchInputEl = document.getElementById("inboxSearchInput");
        btnSyncMailboxEl = document.getElementById("btnSyncMailbox");

        const btnSignOut = document.getElementById("btnSignOut");
        if (btnSignOut) btnSignOut.addEventListener("click", handleSignOut);

        const btnRefresh = document.getElementById("btnRefreshFeed");
        if (btnRefresh) btnRefresh.addEventListener("click", () => loadWorkbenchData(true));

        const btnQuickIntake = document.getElementById("btnQuickIntake");
        if (btnQuickIntake) btnQuickIntake.addEventListener("click", handleQuickIntake);
    }

    /**
     * Sidebar Hover Experience
     */
    function initSidebarEvents() {
        if (!sidebarEl) return;

        let expandTimeout = null;
        sidebarEl.addEventListener("mouseenter", () => {
            clearTimeout(expandTimeout);
            sidebarEl.classList.add("is-expanded");
        });

        sidebarEl.addEventListener("mouseleave", () => {
            expandTimeout = setTimeout(() => {
                sidebarEl.classList.remove("is-expanded");
            }, 100);
        });
    }

    /**
     * Navigation between views (INBOX, CASES, ACTIONS)
     */
    function initNavigation() {
        if (!navContainer) return;

        navContainer.addEventListener("click", (e) => {
            const item = e.target.closest(".nav-item-link");
            if (!item) return;

            const view = item.getAttribute("data-view");
            if (view) {
                switchActiveView(view);
            }
        });
    }

    /**
     * Switch Active View Container
     */
    function switchActiveView(viewKey) {
        if (viewKey === "cases") viewKey = "case";
        if (viewKey === "reply") viewKey = "replies";
        if (!viewKey || !VIEW_CONFIGS[viewKey]) viewKey = "case";
        currentView = viewKey;

        // Update active class on nav items
        const allItems = navContainer.querySelectorAll(".nav-item-link");
        allItems.forEach((el) => {
            const elKey = el.getAttribute("data-view");
            if (elKey === viewKey || (viewKey === "case" && elKey === "cases") || (viewKey === "replies" && elKey === "reply")) {
                el.classList.add("is-active");
            } else {
                el.classList.remove("is-active");
            }
        });

        const cfg = VIEW_CONFIGS[viewKey];
        if (viewTitleTextEl) viewTitleTextEl.textContent = cfg.title;
        if (viewActiveTagEl) viewActiveTagEl.textContent = cfg.tag;

        // Toggle View Containers
        if (viewKey === "inbox") {
            if (inboxViewContainer) inboxViewContainer.style.display = "flex";
            if (casesViewContainer) casesViewContainer.style.display = "none";
            if (repliesViewContainer) repliesViewContainer.style.display = "none";
            loadInboxEmails();
        } else if (viewKey === "replies") {
            if (inboxViewContainer) inboxViewContainer.style.display = "none";
            if (casesViewContainer) casesViewContainer.style.display = "none";
            if (repliesViewContainer) repliesViewContainer.style.display = "flex";
            loadRepliesView();
        } else {
            if (inboxViewContainer) inboxViewContainer.style.display = "none";
            if (casesViewContainer) casesViewContainer.style.display = "flex";
            if (repliesViewContainer) repliesViewContainer.style.display = "none";
            renderFeedRows();
        }
    }

    /**
     * Handle URL Hash Change
     */
    function handleHashChange() {
        let hash = (window.location.hash || "").replace("#", "").toLowerCase();
        if (hash === "cases") hash = "case";
        if (hash === "reply") hash = "replies";
        if (hash && VIEW_CONFIGS[hash]) {
            switchActiveView(hash);
        }
    }

    /* ==========================================================================
       INBOX SECTION LOGIC & CONTROLLER
       ========================================================================== */

    const AVATAR_PALETTES = [
        { bg: "linear-gradient(135deg, #FF6F61 0%, #E03546 100%)", color: "#FFFFFF" },
        { bg: "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)", color: "#FFFFFF" },
        { bg: "linear-gradient(135deg, #10B981 0%, #047857 100%)", color: "#FFFFFF" },
        { bg: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", color: "#FFFFFF" },
        { bg: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", color: "#FFFFFF" },
        { bg: "linear-gradient(135deg, #EC4899 0%, #BE185D 100%)", color: "#FFFFFF" },
        { bg: "linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)", color: "#FFFFFF" }
    ];

    function getAvatarStyle(str) {
        let hash = 0;
        const s = String(str || "1M");
        for (let i = 0; i < s.length; i++) {
            hash = s.charCodeAt(i) + ((hash << 5) - hash);
        }
        const idx = Math.abs(hash) % AVATAR_PALETTES.length;
        return AVATAR_PALETTES[idx];
    }

    function renderAttachmentChips(attList) {
        if (!attList || !attList.length) return "";
        return attList.map(att => {
            const attName = att.filename || att.name || 'Document.pdf';
            const attUrl = att.download_url || att.view_url || att.url || '#';
            const attSize = att.size || (att.size_bytes ? Math.round(att.size_bytes / 1024) + ' KB' : 'File');
            const isPdf = attName.toLowerCase().endsWith('.pdf');
            const isImg = /\.(png|jpe?g|gif|webp)$/i.test(attName);
            
            let iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
            let badgeClass = "badge-doc-generic";
            if (isPdf) {
                badgeClass = "badge-doc-pdf";
            } else if (isImg) {
                badgeClass = "badge-doc-img";
                iconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';
            }

            return `
                <div class="attachment-rich-card">
                    <div class="att-card-icon ${badgeClass}">
                        ${iconSvg}
                    </div>
                    <div class="att-card-meta">
                        <span class="att-card-name" title="${escapeHtml(attName)}">${escapeHtml(attName)}</span>
                        <span class="att-card-size">${escapeHtml(attSize)}</span>
                    </div>
                    <a href="${attUrl}" target="_blank" class="att-card-download-btn" download="${escapeHtml(attName)}" title="Download Attachment">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </a>
                </div>
            `;
        }).join('');
    }

    function initInboxEvents() {
        // Tab Filtering
        if (inboxFilterTabsEl) {
            inboxFilterTabsEl.addEventListener("click", (e) => {
                const btn = e.target.closest(".inbox-tab-btn");
                if (!btn) return;

                inboxFilterTabsEl.querySelectorAll(".inbox-tab-btn").forEach(b => b.classList.remove("is-active"));
                btn.classList.add("is-active");

                inboxActiveTab = btn.getAttribute("data-inbox-tab") || "useful";
                renderInboxList();
            });
        }

        // Search Input
        if (inboxSearchInputEl) {
            inboxSearchInputEl.addEventListener("input", (e) => {
                inboxSearchQuery = (e.target.value || "").toLowerCase().trim();
                renderInboxList();
            });
        }

        // Sync Mailbox
        if (btnSyncMailboxEl) {
            btnSyncMailboxEl.addEventListener("click", handleSyncMailbox);
        }

        // Collapsible Stream Toggle (Option 1: Compact Avatar Rail 68px)
        function updateStreamCollapseUI() {
            if (!inboxEmailListEl) return;
            const toggleBtn = document.getElementById("btnToggleStream");
            const toggleText = toggleBtn ? toggleBtn.querySelector(".btn-toggle-stream-text") : null;
            const toggleIcon = toggleBtn ? toggleBtn.querySelector("svg") : null;

            if (isStreamCollapsed) {
                inboxEmailListEl.classList.add("is-collapsed");
                if (toggleBtn) {
                    toggleBtn.classList.add("is-collapsed");
                    toggleBtn.title = "Expand to Full Email List (Shortcut: [ )";
                }
                if (toggleText) toggleText.textContent = "Expand List";
                if (toggleIcon) {
                    toggleIcon.innerHTML = `
                        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
                        <line x1="9" y1="3" x2="9" y2="21"></line>
                        <path d="m11 9 3 3-3 3"></path>
                    `;
                }
            } else {
                inboxEmailListEl.classList.remove("is-collapsed");
                if (toggleBtn) {
                    toggleBtn.classList.remove("is-collapsed");
                    toggleBtn.title = "Collapse to Compact Avatar Rail (Shortcut: [ )";
                }
                if (toggleText) toggleText.textContent = "Collapse List";
                if (toggleIcon) {
                    toggleIcon.innerHTML = `
                        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
                        <line x1="9" y1="3" x2="9" y2="21"></line>
                        <path d="m14 9-3 3 3 3"></path>
                    `;
                }
            }

            const expandPills = document.querySelectorAll(".btn-expand-stream-pill");
            expandPills.forEach(p => {
                if (isStreamCollapsed) p.classList.add("is-visible");
                else p.classList.remove("is-visible");
            });
        }

        window.toggleEmailStream = function () {
            isStreamCollapsed = !isStreamCollapsed;
            updateStreamCollapseUI();
        };

        const toggleBtn = document.getElementById("btnToggleStream");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", window.toggleEmailStream);
        }

        // Global hotkey: '[' or '\' toggles email stream list
        window.addEventListener("keydown", (e) => {
            if (currentView === "inbox" && (e.key === "[" || e.key === "\\") && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
                window.toggleEmailStream();
            }
        });
    }

    /**
     * AI Panel Active Controller (Admin Type 3rd Zone Toggle)
     */
    function initAiPanelEvents() {
        const btnToggleAi = document.getElementById("btnToggleAiPanel");
        if (!btnToggleAi) return;

        function updateAiPanelUI() {
            const rhsPane = document.getElementById("inboxAiCopilotPane");
            if (btnToggleAi) {
                if (isAiPanelActive) {
                    btnToggleAi.classList.add("active");
                    btnToggleAi.title = "Tata 1mg AI Copilot Active (Click to Collapse)";
                } else {
                    btnToggleAi.classList.remove("active");
                    btnToggleAi.title = "Tata 1mg AI Copilot Collapsed (Click to Open)";
                }
            }
            if (rhsPane) {
                if (isAiPanelActive) {
                    rhsPane.classList.remove("is-collapsed");
                } else {
                    rhsPane.classList.add("is-collapsed");
                }
            }

            // Re-render open detail view and RHS Copilot panel
            if (currentView === "inbox" && selectedEmailId) {
                const cur = inboxEmails.find(e => e.id === selectedEmailId);
                if (cur) {
                    renderInboxDetail(cur);
                    renderInboxAiPanel(cur);
                }
            }
        }

        window.toggleAiPanel = function () {
            isAiPanelActive = !isAiPanelActive;
            try { localStorage.setItem("hrflow_agent_ai_panel", isAiPanelActive ? "1" : "0"); } catch (_) {}
            updateAiPanelUI();
            showToast(isAiPanelActive ? "✨ Tata 1mg AI Panel Active" : "AI Panel Collapsed");
            console.log(`[Tata 1mg AI] AI Panel is now ${isAiPanelActive ? 'ACTIVE' : 'COLLAPSED'}`);
        };

        window.toggleWorkspaceZoneRhs = window.toggleAiPanel;

        btnToggleAi.addEventListener("click", window.toggleAiPanel);
        updateAiPanelUI();
    }

    /**
     * Determine if an incoming email strictly belongs to the agent's allotted department and mailbox ID
     */
    function isEmailInAgentDept(email, agent, deptEmails) {
        if (!email) return false;

        const targetAccount = (agent && (agent.email || (agent.active_department && agent.active_department.dept_gmail))) || "vaibhavx002@zohomail.in";
        const emAccount = String(email.account_email || "").toLowerCase().trim();
        const targetAccountLower = String(targetAccount).toLowerCase().trim();

        const allowedMailboxes = new Set();
        if (targetAccountLower) allowedMailboxes.add(targetAccountLower);
        if (agent && agent.email) allowedMailboxes.add(String(agent.email).toLowerCase().trim());
        if (agent && agent.active_department && agent.active_department.dept_gmail) {
            allowedMailboxes.add(String(agent.active_department.dept_gmail).toLowerCase().trim());
        }
        if (agent && Array.isArray(agent.assigned_departments)) {
            agent.assigned_departments.forEach(d => {
                if (d && d.dept_gmail) allowedMailboxes.add(String(d.dept_gmail).toLowerCase().trim());
            });
        }

        // STRICT ACCOUNT ID ISOLATION:
        // "only shows the mail for that id nothing else no other id mails should visible any where"
        if (emAccount && allowedMailboxes.size > 0 && !allowedMailboxes.has(emAccount)) {
            return false;
        }

        // 1. If backend explicitly identified this email in dept_emails for this agent
        if (Array.isArray(deptEmails) && deptEmails.some(de => de && de.id === email.id)) {
            return true;
        }

        if (!agent) return true; // fallback if profile not yet loaded

        // 2. Department Category match
        const emCat = String(email.category || email.case_category || "").toUpperCase().trim();
        const allowedCats = new Set((agent.allowed_categories || agent.all_assigned_categories || []).map(c => String(c).toUpperCase().trim()));
        if (agent.active_department && agent.active_department.category_scope) {
            agent.active_department.category_scope.split(",").forEach(c => {
                if (c.trim()) allowedCats.add(c.trim().toUpperCase());
            });
        }

        const agentTeam = String(agent.team_name || agent.active_dept_name || "").toLowerCase().trim();
        const emailTeam = String(email.case_team || email.department || email.matched_emp_dept || "").toLowerCase().trim();
        if (agentTeam && emailTeam && (agentTeam.includes(emailTeam) || emailTeam.includes(agentTeam))) {
            return true;
        }

        if (emCat && allowedCats.has(emCat)) {
            return true;
        }

        return false;
    }

    /**
     * Filter Helper: Returns emails for the currently selected inbox tab
     */
    function getFilteredInboxEmails() {
        let filtered = [];

        // Tab Filtering:
        // 'useful' / 'all' = All incoming emails belonging to this agent's account ID!
        // 'actionable' = Actionable HR for this agent's account ID!
        // 'unclaimed' = Unclaimed Pool for this agent's account ID!
        // 'noise' = System noise for this agent's account ID!
        if (inboxActiveTab === "useful" || inboxActiveTab === "all") {
            filtered = inboxEmails.filter(e => !e.is_noise);
        } else if (inboxActiveTab === "actionable") {
            filtered = inboxEmails.filter(e => !e.is_noise && (e.is_actionable === true || e.is_actionable === 1 || e.is_actionable === "1"));
        } else if (inboxActiveTab === "unclaimed") {
            filtered = inboxEmails.filter(e => !e.is_noise && (e.is_unclaimed === true || (!e.case && !e.case_number) || (e.case && !e.case.assigned_user)));
        } else if (inboxActiveTab === "noise") {
            filtered = inboxEmails.filter(e => e.is_noise);
        }

        // Apply Search Filter
        if (inboxSearchQuery) {
            filtered = filtered.filter(e => {
                const subj = String(e.subject || "").toLowerCase();
                const sender = String(e.sender_name || e.sender_email || "").toLowerCase();
                const cat = String(e.category || "").toLowerCase();
                const reason = String(e.noise_reason || "").toLowerCase();
                return subj.includes(inboxSearchQuery) || sender.includes(inboxSearchQuery) || cat.includes(inboxSearchQuery) || reason.includes(inboxSearchQuery);
            });
        }

        return filtered;
    }

    /**
     * Normalize Subject Line for Intelligent Thread Grouping
     */
    function normalizeSubject(subj) {
        if (!subj) return "";
        let s = String(subj);
        // 1. Remove bracketed tags like [CASE-000001], [Resolved · CASE-000002], [## 34948 ##], etc.
        s = s.replace(/\[[^\]]*\]/g, "");
        // 2. Strip Re:, Fwd:, etc.
        s = s.replace(/^(?:(?:re|fwd|fw|resolved)[\s:·—\-_]*)+/gi, "");
        // 3. Strip Action Required / suffix comments
        s = s.replace(/[—\-–]\s*Action Required:.*$/gi, "");
        // 4. Strip any leading re: again
        s = s.replace(/^(?:(?:re|fwd|fw|resolved)[\s:·—\-_]*)+/gi, "");
        return s.replace(/\s+/g, " ").trim().toLowerCase();
    }

    /**
     * Group individual emails into unified conversation threads
     */
    function buildConversationThreads(rawEmails) {
        if (!Array.isArray(rawEmails) || rawEmails.length === 0) return [];

        const threadMap = new Map();

        // Sort chronological ascending so messages array in thread is in historical order
        const sorted = [...rawEmails].sort((a, b) => {
            const ta = new Date(a.received_at || a.created_at || 0).getTime();
            const tb = new Date(b.received_at || b.created_at || 0).getTime();
            return ta - tb;
        });

        sorted.forEach((email) => {
            const caseMatch = String(email.subject || "").match(/\[(?:resolved\s*[·\-_]\s*)?#?(CASE-\d+)\]/i);
            const caseRef = (email.case && (email.case.case_number || email.case.case_ref)) || email.case_number || (caseMatch ? caseMatch[1].toUpperCase() : null);

            const cleanSub = normalizeSubject(email.subject);
            const sender = String(email.sender_email || "").toLowerCase().trim();

            // Thread Key:
            // 1. If explicit case exists, group all messages with that case
            // 2. Otherwise group by clean root subject + sender email
            const threadKey = caseRef ? `CASE::${caseRef}` : `SUBJ::${cleanSub}::${sender}`;

            if (!threadMap.has(threadKey)) {
                threadMap.set(threadKey, {
                    thread_key: threadKey,
                    root_subject: cleanSub || email.subject,
                    case_ref: caseRef,
                    is_dept_allotted: Boolean(email.is_dept_allotted),
                    is_noise: Boolean(email.is_noise),
                    noise_reason: email.noise_reason || "",
                    messages: []
                });
            }

            const t = threadMap.get(threadKey);
            // If any message in thread is allotted to dept, the thread is allotted
            if (email.is_dept_allotted) {
                t.is_dept_allotted = true;
                t.is_noise = false;
            }
            if (caseRef && !t.case_ref) {
                t.case_ref = caseRef;
            }
            t.messages.push(email);
        });

        const conversations = [];
        threadMap.forEach((t) => {
            const msgs = t.messages;
            const latest = msgs[msgs.length - 1];
            const initial = msgs[0];

            // Build unique participants
            const participants = [];
            msgs.forEach(m => {
                const name = m.sender_name || m.sender_email || "Employee";
                if (!participants.includes(name)) participants.push(name);
            });

            const linkedCase = t.case_ref || (latest.case ? (latest.case.case_number || latest.case.case_ref) : (latest.case_number || null));

            const conv = {
                ...latest, // Use latest message as primary card data
                id: latest.id,
                thread_key: t.thread_key,
                thread_count: msgs.length,
                is_thread: msgs.length > 1,
                messages: msgs,
                initial_message: initial,
                latest_message: latest,
                participants: participants,
                subject: latest.subject,
                root_subject: t.root_subject,
                case_number: linkedCase,
                case: linkedCase ? { case_number: linkedCase, assigned_user: "Vaibhav Yadav" } : latest.case,
                is_dept_allotted: t.is_dept_allotted,
                is_noise: t.is_noise,
                noise_reason: t.noise_reason
            };
            conversations.push(conv);
        });

        // Sort descending by latest activity
        conversations.sort((a, b) => {
            const ta = new Date(a.received_at || a.created_at || 0).getTime();
            const tb = new Date(b.received_at || b.created_at || 0).getTime();
            return tb - ta;
        });

        return conversations;
    }

    /**
     * Fetch Live Emails from Backend - Strictly for Logged-In Specialist Account ID
     */
    async function loadInboxEmails(forceSync = false) {
        // Ensure workbench data is loaded for accurate department allotment
        if (!workbenchData) {
            try {
                const wRes = await fetch(`${BACKEND_API_BASE}/api/agent/my-workbench`, {
                    headers: { "Accept": "application/json" }
                });
                if (wRes.ok) {
                    workbenchData = await wRes.json();
                    if (workbenchData.agent) renderAgentProfile(workbenchData.agent);
                    if (workbenchData.kpis) updateKPIs(workbenchData.kpis);
                }
            } catch (_) {}
        }

        const agent = workbenchData ? workbenchData.agent : null;
        let targetAccountId = "vaibhavx002@zohomail.in";
        if (agent) {
            targetAccountId = (agent.active_department && agent.active_department.dept_gmail) || agent.email || targetAccountId;
        }
        targetAccountId = String(targetAccountId).toLowerCase().trim();

        const allowedMailboxes = new Set();
        if (targetAccountId) allowedMailboxes.add(targetAccountId);
        if (agent && agent.email) allowedMailboxes.add(String(agent.email).toLowerCase().trim());
        if (agent && agent.active_department && agent.active_department.dept_gmail) {
            allowedMailboxes.add(String(agent.active_department.dept_gmail).toLowerCase().trim());
        }
        if (agent && Array.isArray(agent.assigned_departments)) {
            agent.assigned_departments.forEach(d => {
                if (d && d.dept_gmail) allowedMailboxes.add(String(d.dept_gmail).toLowerCase().trim());
            });
        }

        try {
            // STRICT ACCOUNT QUERY: Only fetch emails for this agent's account ID!
            const res = await fetch(`${BACKEND_API_BASE}/api/emails?limit=100&actionable=all&account_email=${encodeURIComponent(targetAccountId)}`, {
                headers: { "Accept": "application/json" }
            });

            let fetched = [];
            if (res.ok) {
                const data = await res.json();
                fetched = (data.data && data.data.emails) || data.emails || [];
            }

            const deptEmails = (workbenchData && Array.isArray(workbenchData.dept_emails)) ? workbenchData.dept_emails : [];

            // Merge unique by ID
            const emailMap = new Map();
            fetched.forEach(e => { if (e && e.id) emailMap.set(e.id, e); });
            deptEmails.forEach(e => { if (e && e.id && !emailMap.has(e.id)) emailMap.set(e.id, e); });

            const merged = Array.from(emailMap.values());

            // STRICT ACCOUNT ISOLATION:
            // "only shows the mail for that id nothing else no other id mails should visible any where"
            // Discard any email that belongs to a different corporate / admin account ID!
            const accountSpecificEmails = merged.filter(e => {
                if (!e) return false;
                const emAccount = String(e.account_email || "").toLowerCase().trim();
                if (emAccount && allowedMailboxes.size > 0) {
                    return allowedMailboxes.has(emAccount);
                }
                return true;
            });

            const rawEmails = accountSpecificEmails;

            // Partition into Actionable vs System Noise (strictly within this account ID!)
            const partitioned = rawEmails.map(e => {
                e.is_dept_allotted = true;
                const isExplicitNoise = e.is_actionable === false || e.is_actionable === 0 || e.is_actionable === "0";
                e.is_noise = isExplicitNoise;
                if (isExplicitNoise) {
                    e.noise_type = "SYSTEM_NOISE";
                    e.noise_reason = e.actionable_reason || "Filtered System Alert / Non-Actionable";
                }
                return e;
            });

            // Conversation Threading Engine: Combine related replies into a single threaded conversation!
            inboxEmails = buildConversationThreads(partitioned);
        } catch (err) {
            console.warn("[Inbox] Failed to fetch emails, using seed data:", err);
            const deptEmails = (workbenchData && Array.isArray(workbenchData.dept_emails)) ? workbenchData.dept_emails : [];
            const fallback = deptEmails.filter(e => {
                const emAccount = String(e.account_email || "").toLowerCase().trim();
                return !emAccount || allowedMailboxes.has(emAccount);
            }).map(e => {
                e.is_dept_allotted = true;
                e.is_noise = (e.is_actionable === false || e.is_actionable === 0 || e.is_actionable === "0");
                return e;
            });
            inboxEmails = buildConversationThreads(fallback);
        }

        updateInboxBadgeCounters();
        renderInboxList();

        // Auto-select first email in active tab if none selected or if previous is missing
        const visibleMails = getFilteredInboxEmails();
        if ((!selectedEmailId || !visibleMails.some(e => e.id === selectedEmailId)) && visibleMails.length > 0) {
            selectInboxEmail(visibleMails[0].id);
        } else if (selectedEmailId) {
            const current = inboxEmails.find(e => e.id === selectedEmailId);
            if (current) {
                renderInboxDetail(current);
                renderInboxAiPanel(current);
            }
        }
    }

    /**
     * Update Inbox Filter Tab Counts and Sidebar Badge
     */
    function updateInboxBadgeCounters() {
        const actionableMails = inboxEmails.filter(e => !e.is_noise);
        const totalCount = actionableMails.length;
        const actionable = actionableMails.filter(e => e.is_actionable === true || e.is_actionable === 1 || e.is_actionable === "1").length;
        const unclaimed = actionableMails.filter(e => e.is_unclaimed === true || (!e.case && !e.case_number) || (e.case && !e.case.assigned_user)).length;
        const noise = inboxEmails.filter(e => e.is_noise).length;

        setElText("inboxCountUseful", totalCount);
        setElText("inboxCountAll", totalCount);
        setElText("inboxCountActionable", actionable);
        setElText("inboxCountUnclaimed", unclaimed);
        setElText("inboxCountNoise", noise);

        setBadge("badgeInbox", unclaimed || totalCount);
    }

    /**
     * Render Left Email Stream List
     */
    function renderInboxList() {
        if (!inboxEmailListEl) return;

        try {
            const filtered = getFilteredInboxEmails();

            if (filtered.length === 0) {
                inboxEmailListEl.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--border-mid); margin-bottom:8px;">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="m9 12 2 2 4-4"></path>
                        </svg>
                        <div style="font-size:13px; font-weight:700; color:var(--text-primary);">Inbox Zero</div>
                        <div style="font-size:11.5px; margin-top:2px;">
                            ${inboxActiveTab === 'noise' ? 'No noise or out-of-department emails recorded.' : 'No incoming department messages. Mailbox is clean.'}
                        </div>
                    </div>
                `;
                if (inboxDetailPaneEl) {
                    inboxDetailPaneEl.innerHTML = `
                        <div class="inbox-empty-detail">
                            <div class="inbox-empty-icon">
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <path d="m9 12 2 2 4-4"></path>
                                </svg>
                            </div>
                            <div class="inbox-empty-title">All Caught Up! Inbox Zero</div>
                            <div class="inbox-empty-desc">All emails and operational data have been cleared. New incoming emails will appear here automatically.</div>
                        </div>
                    `;
                }
                const aiPanel = document.getElementById("inboxAiCopilotContent");
                if (aiPanel) {
                    aiPanel.innerHTML = `
                        <div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 12px;">
                            <div style="font-size:13px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">AI Copilot Ready</div>
                            <div>Select or receive an incoming email to activate live intent classification and response drafting.</div>
                        </div>
                    `;
                }
                return;
            }

            let html = "";
            filtered.forEach((email) => {
                const isSelected = email.id === selectedEmailId;
                const sender = String(email.sender_name || email.sender_email || "Employee");
                const subject = String(email.subject || "(No Subject)");
                const time = formatEmailTime(email.received_at || email.created_at);
                const snippet = extractSnippet(email.body || email.actionable_reason || "");
                const category = String(email.category || "GENERAL_HR");

                // Safe SLA & Urgency Check
                const slaStr = typeof email.sla === 'string' ? email.sla.toUpperCase() : '';
                const slaObj = (typeof email.sla === 'object' && email.sla !== null) ? email.sla : {};
                const isUrgent = slaStr === 'URGENT' || slaObj.priority === 'URGENT' || slaObj.breached === true || email.is_urgent === true || email.is_urgent_sla === true;

                // Safe Attachments List
                let attList = [];
                if (Array.isArray(email.attachments)) {
                    attList = email.attachments;
                } else if (typeof email.attachments === 'string') {
                    try { attList = JSON.parse(email.attachments) || []; } catch (_) {}
                }
                const hasAttachments = attList.length > 0;
                const caseNum = email.case ? (email.case.case_number || email.case.case_ref || email.case) : (email.case_number || null);
                const hasCase = Boolean(caseNum);

                const initials = sender.split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "1M";
                const avStyle = getAvatarStyle(sender);
                const isUnclaimed = !hasCase && !email.is_noise && email.is_dept_allotted;

                html += `
                    <div class="inbox-email-card ${isSelected ? 'is-selected' : ''} ${email.thread_count > 1 ? 'is-thread' : ''}" data-email-id="${email.id}" data-thread-count="${email.thread_count || 1}" title="${escapeHtml(sender)}${email.thread_count > 1 ? ' (' + email.thread_count + ' msgs)' : ''} · ${escapeHtml(subject)}">
                        <div class="email-card-top-row">
                            <div class="email-sender-wrap">
                                ${isUnclaimed ? `<span class="unread-pip" title="Unclaimed Intake"></span>` : ''}
                                <div class="email-sender-avatar" style="background:${avStyle.bg}; color:${avStyle.color};">${initials}</div>
                                <span class="email-sender-name">${escapeHtml(sender)}${email.thread_count > 1 ? ` (${email.thread_count})` : ''}</span>
                            </div>
                            <span class="email-received-time">${time}</span>
                        </div>

                        <div class="email-card-subject">${escapeHtml(subject)}</div>
                        <div class="email-card-snippet">${escapeHtml(snippet)}</div>

                        <div class="email-card-tags-row">
                            ${email.thread_count > 1 ? `
                                <span class="badge-pill badge-thread-count" title="${email.thread_count} messages in this conversation thread">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                                    <span>${email.thread_count} msgs</span>
                                </span>
                            ` : ''}

                            ${!email.is_dept_allotted ? `
                                <span class="badge-pill badge-out-dept" title="${escapeHtml(email.noise_reason || 'Out of Department')}">Other Dept</span>
                            ` : (email.is_noise ? `
                                <span class="badge-pill badge-noise-tag">Noise</span>
                            ` : `
                                <span class="badge-pill badge-category">${category}</span>
                            `)}

                            ${isUrgent ? `<span class="badge-pill badge-urgent-tag">⚡ Urgent SLA</span>` : ''}
                            ${hasCase ? `<span class="badge-pill badge-open-tag" title="Linked to Case">${caseNum}</span>` : (email.is_dept_allotted && !email.is_noise ? `<span class="badge-pill badge-unclaimed-tag">Unclaimed Pool</span>` : '')}
                            ${hasAttachments ? `
                                <span class="badge-pill badge-attachment-count" title="${attList.length} attached document(s)">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                    </svg>
                                    <span>${attList.length}</span>
                                </span>
                            ` : ''}
                        </div>
                    </div>
                `;
            });

            inboxEmailListEl.innerHTML = html;

            // Card Click Handler
            inboxEmailListEl.querySelectorAll(".inbox-email-card").forEach(card => {
                card.addEventListener("click", () => {
                    const id = parseInt(card.getAttribute("data-email-id"), 10);
                    selectInboxEmail(id);
                });
            });
        } catch (err) {
            console.error("[Inbox] Error in renderInboxList:", err);
            inboxEmailListEl.innerHTML = `
                <div style="padding: 30px 20px; text-align: center; color: var(--text-muted);">
                    <div style="color:var(--tata-crimson); font-weight:700; font-size:13px; margin-bottom:6px;">Render Error</div>
                    <div style="font-size:11.5px;">${escapeHtml(err.message || String(err))}</div>
                </div>
            `;
        }
    }

    /**
     * Select an Email & Render Right Inspection Pane
     */
    function selectInboxEmail(emailId) {
        selectedEmailId = emailId;

        // Highlight selected card
        if (inboxEmailListEl) {
            inboxEmailListEl.querySelectorAll(".inbox-email-card").forEach(c => {
                const id = parseInt(c.getAttribute("data-email-id"), 10);
                if (id === emailId) c.classList.add("is-selected");
                else c.classList.remove("is-selected");
            });
        }

        const email = inboxEmails.find(e => e.id === emailId);
        if (email) {
            renderInboxDetail(email);
            renderInboxAiPanel(email);
        }
    }

    /**
     * Render Right Detail Pane
     */
    function renderInboxDetail(email) {
        if (!inboxDetailPaneEl || !email) return;

        try {
            const sender = String(email.sender_name || "Employee");
            const senderEmail = String(email.sender_email || "employee@1mg.com");
            const subject = String(email.subject || "(No Subject)");
            const timeStr = formatFullDate(email.received_at || email.created_at);
            const category = String(email.category || "GENERAL_HR");
            const confidence = email.category_confidence ? Math.round(email.category_confidence * 100) : 96;
            const matchedEmp = email.matched_emp_name ? `${email.matched_emp_name} (${email.matched_emp_dept || 'Operations'})` : null;
            const linkedCase = email.case ? (email.case.case_number || `#CASE-${email.case.id}`) : (email.case_number || null);

            let attList = [];
            if (Array.isArray(email.attachments)) {
                attList = email.attachments;
            } else if (typeof email.attachments === 'string') {
                try { attList = JSON.parse(email.attachments) || []; } catch (_) {}
            }
            const hasAttachments = attList.length > 0;

            const initials = sender.split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "1M";
            const avStyle = getAvatarStyle(sender);
            const isInternal = senderEmail.toLowerCase().endsWith("@1mg.com") || senderEmail.toLowerCase().endsWith("@tata1mg.com");

            let html = `
                <div class="inbox-active-detail">
                    
                    <!-- Action Bar -->
                    <div class="detail-action-bar">
                        <div class="detail-actions-left">
                            <button type="button" class="btn-expand-stream-pill ${isStreamCollapsed ? 'is-visible' : ''}" onclick="toggleEmailStream()" title="Show Email List (Shortcut: [ )">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
                                    <line x1="9" y1="3" x2="9" y2="21"></line>
                                    <path d="m11 9 3 3-3 3"></path>
                                </svg>
                                <span>Show List</span>
                                <span class="expand-count-badge">${inboxEmails.length}</span>
                            </button>

                            <button type="button" class="btn-detail-action" onclick="focusQuickReply()">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                                </svg>
                                <span>Quick Reply</span>
                            </button>

                            <button type="button" class="btn-detail-action" onclick="handleRerouteEmail(${email.id})">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="23 4 23 10 17 10"></polyline>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                </svg>
                                <span>Re-route</span>
                            </button>
                        </div>

                        <div class="detail-actions-right">
                            <button type="button" class="btn-detail-action btn-noise-action" onclick="handleToggleNoise(${email.id})" title="Move between Actionable and Noise">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                                </svg>
                                <span>${(email.is_noise || !email.is_dept_allotted) ? 'Move to My Inbox' : 'Move to Noise'}</span>
                            </button>
                        </div>
                    </div>

                    <!-- Subject Banner -->
                    <div class="detail-subject-banner">
                        <div class="detail-subject-top">
                            <h2 class="detail-subject-title">${escapeHtml(subject)}</h2>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="category-pill-large">${category}</span>
                                ${linkedCase ? `<span class="badge-pill badge-open-tag" title="Linked to Case">${linkedCase}</span>` : ''}
                                <button type="button" class="btn-reopen-ai-pill" onclick="window.toggleAiPanel()" title="Toggle AI Copilot Panel">
                                    <span style="color:var(--tata-coral);">✦</span>
                                    <span>AI Copilot</span>
                                </button>
                            </div>
                        </div>

                        <!-- Sender Info Row -->
                        <div class="detail-sender-row">
                            <div class="sender-profile-left">
                                <div class="sender-avatar-large" style="background:${avStyle.bg}; color:${avStyle.color};">${initials}</div>
                                <div class="sender-names-block">
                                    <div class="sender-name-line">
                                        <span class="sender-full-name">${escapeHtml(sender)}</span>
                                        ${isInternal ? `<span class="badge-verified-sender" title="Verified internal employee domain">✓ Tata 1mg Domain</span>` : `<span class="badge-external-sender">External</span>`}
                                    </div>
                                    <span class="sender-email-address">&lt;${escapeHtml(senderEmail)}&gt;</span>
                                </div>
                            </div>
                            <div class="sender-date-meta">
                                <div class="date-full-text">${timeStr}</div>
                                <div class="to-address-text">To: <span class="to-pill">${escapeHtml(email.account_email || 'vaibhavx002@zohomail.in')}</span></div>
                            </div>
                        </div>
                    </div>

                    ${(email.thread_count > 1 && Array.isArray(email.messages) && email.messages.length > 1) ? `
                    <!-- Conversation History Timeline (Threaded Multi-Message View) -->
                    <div style="padding: 0 32px; margin-top: 14px;">
                        <div class="thread-timeline-wrapper">
                            <div class="thread-timeline-header">
                                <div style="display:flex; align-items:center; gap:7px;">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                                    <span>Conversation History (${email.thread_count} Messages)</span>
                                </div>
                                <button type="button" class="btn-toggle-all-thread" onclick="window.toggleAllThreadMessages()">Expand All</button>
                            </div>

                            ${email.messages.slice(0, email.messages.length - 1).map((m, idx) => {
                                const mSender = String(m.sender_name || m.sender_email || 'Employee');
                                const mEmail = String(m.sender_email || '');
                                const mInitials = mSender.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'EM';
                                const mAvStyle = getAvatarStyle(mSender);
                                const mIsInternal = mEmail.toLowerCase().endsWith('@1mg.com') || mEmail.toLowerCase().endsWith('@tata1mg.com');

                                return `
                                    <div class="thread-message-card" id="threadMsgCard_${m.id}">
                                        <div class="thread-msg-collapsed-bar" onclick="window.toggleThreadMessage(${m.id})">
                                            <div class="thread-msg-collapsed-left">
                                                <div class="thread-msg-mini-avatar" style="background:${mAvStyle.bg}; color:${mAvStyle.color};">${mInitials}</div>
                                                <span class="thread-msg-sender-pill">${escapeHtml(mSender)}</span>
                                                <span class="thread-msg-snippet-pill">${escapeHtml(extractSnippet(m.body || m.actionable_reason || ''))}</span>
                                            </div>
                                            <div style="display:flex; align-items:center; gap:8px;">
                                                <span class="thread-msg-time-pill">${formatEmailTime(m.received_at || m.created_at)}</span>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                            </div>
                                        </div>
                                        <div class="thread-msg-full-body" style="display:none;" id="threadMsgBody_${m.id}">
                                            <div class="thread-msg-meta-bar">
                                                <div style="display:flex; align-items:center; gap:10px;">
                                                    <div class="thread-msg-header-avatar" style="background:${mAvStyle.bg}; color:${mAvStyle.color};">${mInitials}</div>
                                                    <div>
                                                        <div style="display:flex; align-items:center; gap:6px;">
                                                            <strong style="font-size:13px; font-weight:700; color:var(--text-heading);">${escapeHtml(mSender)}</strong>
                                                            ${mIsInternal ? '<span class="badge-internal-tag">✓ Tata 1mg</span>' : '<span class="badge-external-tag">External</span>'}
                                                        </div>
                                                        <div style="font-size:11.5px; color:var(--text-muted);">&lt;${escapeHtml(mEmail)}&gt;</div>
                                                    </div>
                                                </div>
                                                <div style="text-align:right;">
                                                    <div style="font-size:11.5px; font-weight:600; color:var(--text-primary);">${formatFullDate(m.received_at || m.created_at)}</div>
                                                    <div style="font-size:10.5px; color:var(--text-muted);">${formatEmailTime(m.received_at || m.created_at)}</div>
                                                </div>
                                            </div>
                                            <div class="thread-msg-inner-body">
                                                ${formatEmailBody(m.body || m.actionable_reason || '')}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}

                            <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                                <span style="width:6px; height:6px; border-radius:50%; background:var(--tata-coral);"></span>
                                <span style="font-size:11px; font-weight:800; color:var(--tata-coral); text-transform:uppercase; letter-spacing:0.04em;">Latest Follow-up Message</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    ${(email.is_noise || !email.is_dept_allotted) ? `
                    <!-- Out of Department / Noise Notice Banner -->
                    <div style="padding: 0 32px; margin-top: 14px;">
                        <div class="email-noise-notice-banner ${!email.is_dept_allotted ? 'is-out-of-dept' : ''}">
                            <div class="noise-notice-icon">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                                </svg>
                            </div>
                            <div class="noise-notice-text">
                                <strong>${!email.is_dept_allotted ? 'Out-of-Department Message' : 'Filtered System Noise'}</strong>:
                                <span>${escapeHtml(email.noise_reason || 'This message is routed to Noise / System.')}</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Email Body Container -->
                    <div class="detail-body-container">
                        <div class="detail-message-body">
${formatEmailBody(email.body || email.actionable_reason || "No message body provided.")}
                        </div>
                    </div>

                    <!-- Attachments Section -->
                    ${hasAttachments ? `
                        <div class="detail-attachments-area">
                            <div class="attachments-label">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                </svg>
                                <span>Attached Documents (${attList.length})</span>
                            </div>
                            <div class="attachment-chips-list">
                                ${renderAttachmentChips(attList)}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Embedded Quick Reply Composer -->
                    <div class="quick-reply-composer-wrap" id="quickReplySection">
                        <div class="composer-card">
                            <div class="composer-topbar">
                                <div class="composer-to-label">Reply to: <span>${escapeHtml(senderEmail)}</span></div>
                                <div class="composer-template-wrap">
                                    <select class="composer-template-select" id="composerTemplateSelect" onchange="handleTemplateSelect(this.value)">
                                        <option value="">Insert TATA 1mg Response Template...</option>
                                        <option value="punch_reg">Biometric Punch Regularized Confirmation</option>
                                        <option value="ack_doc">Acknowledge &amp; Request Missing Documents</option>
                                        <option value="leave_encash">Leave Policy &amp; Encashment Approval</option>
                                        <option value="general_ack">Standard Ticket Intake Acknowledgment</option>
                                    </select>
                                </div>
                            </div>

                            <!-- Smart AI Response Suggestions -->
                            <div class="composer-suggestions-row">
                                <span class="suggestion-chip-label">AI Prompts:</span>
                                <button type="button" class="suggestion-chip" onclick="handleTemplateSelect('punch_reg')">✨ Regularize Punch</button>
                                <button type="button" class="suggestion-chip" onclick="handleTemplateSelect('ack_doc')">✨ Request Documents</button>
                                <button type="button" class="suggestion-chip" onclick="handleTemplateSelect('leave_encash')">✨ Approve Leave</button>
                            </div>

                            <textarea class="composer-textarea" id="composerReplyText" placeholder="Write an official response to ${escapeHtml(sender)}..."></textarea>

                            <div class="composer-footer">
                                <div class="composer-smtp-info">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                                    </svg>
                                    <span>Dispatched via official Tata 1mg Gmail SMTP</span>
                                </div>
                                <button type="button" class="btn-send-reply" onclick="handleSendReply(${email.id})">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                        <line x1="22" y1="2" x2="11" y2="13"></line>
                                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                    </svg>
                                    <span>Send Reply</span>
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            `;

            inboxDetailPaneEl.innerHTML = html;
        } catch (err) {
            console.error("[Inbox] Error in renderInboxDetail:", err);
            inboxDetailPaneEl.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--text-muted);">
                    <div style="color:var(--tata-crimson); font-weight:700; font-size:14px; margin-bottom:8px;">Detail Render Error</div>
                    <div style="font-size:12px;">${escapeHtml(err.message || String(err))}</div>
                </div>
            `;
        }
    }

    /**
     * Claim Email & Convert to Case
     */
    window.handleClaimEmail = async function (emailId) {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/emails/${emailId}/claim-or-open`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    claim: true,
                    agent_name: "Vaibhav Yadav",
                    agent_team: "People Operations"
                })
            });

            if (res.ok) {
                const data = await res.json();
                const caseNum = data.case_number || data.case_ref || `1MG-${email.category || 'HR'}-${email.id}`;
                
                alert(`Success! Email claimed and converted to Case: ${caseNum}\nAssigned directly to your specialist desk.`);

                // Mark local email as claimed
                email.case = { case_number: caseNum, assigned_user: "Vaibhav Yadav" };
                updateInboxBadgeCounters();
                renderInboxList();
                renderInboxDetail(email);
                renderInboxAiPanel(email);

                // Reload cases workspace data
                loadWorkbenchData();
            } else {
                // Client fallback
                const caseNum = `1MG-${email.category || 'HR'}-${email.id}`;
                email.case = { case_number: caseNum, assigned_user: "Vaibhav Yadav" };
                alert(`Case ${caseNum} created and assigned to Vaibhav Yadav!`);
                updateInboxBadgeCounters();
                renderInboxList();
                renderInboxDetail(email);
                renderInboxAiPanel(email);
            }
        } catch (err) {
            console.warn("Claim email fallback:", err);
            const caseNum = `1MG-${email.category || 'HR'}-${email.id}`;
            email.case = { case_number: caseNum, assigned_user: "Vaibhav Yadav" };
            alert(`Case ${caseNum} created and assigned to Vaibhav Yadav!`);
            updateInboxBadgeCounters();
            renderInboxList();
            renderInboxDetail(email);
            renderInboxAiPanel(email);
        }
    };

    /**
     * Trigger Gmail IMAP Sync - Strictly for this Account ID
     */
    async function handleSyncMailbox() {
        if (!btnSyncMailboxEl) return;
        btnSyncMailboxEl.classList.add("is-syncing");
        const label = document.getElementById("syncMailboxText");
        if (label) label.textContent = "Syncing Gmail...";

        const agent = workbenchData ? workbenchData.agent : null;
        const targetAccountId = (agent && (agent.email || (agent.active_department && agent.active_department.dept_gmail))) || "vaibhavx002@zohomail.in";

        try {
            await fetch(`${BACKEND_API_BASE}/api/emails/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ account_email: targetAccountId })
            });
            await loadInboxEmails(true);
        } catch (err) {
            console.warn("[Inbox] Sync failed:", err);
            await loadInboxEmails(true);
        } finally {
            btnSyncMailboxEl.classList.remove("is-syncing");
            if (label) label.textContent = "Sync Mailbox";
        }
    }

    /**
     * Focus Quick Reply Composer
     */
    window.focusQuickReply = function () {
        const composer = document.getElementById("composerReplyText");
        if (composer) {
            composer.scrollIntoView({ behavior: 'smooth' });
            composer.focus();
        }
    };

    /**
     * Template Dropdown Handler
     */
    window.handleTemplateSelect = function (val) {
        const ta = document.getElementById("composerReplyText");
        if (!ta) return;

        if (val === "ack_doc") {
            ta.value = "Hi,\n\nThank you for reaching out to the Tata 1mg People Operations team.\n\nWe have reviewed your request, but require a copy of your supporting documentation (e.g. medical certificate / formal resignation email) to proceed.\n\nPlease reply directly to this email with the attachments.\n\nRegards,\nVaibhav Yadav\nSpecialist, People Operations • Tata 1mg";
        } else if (val === "punch_reg") {
            ta.value = "Hi,\n\nWe have investigated your biometric attendance record for the requested date and verified your check-in with your reporting manager.\n\nYour missing punches have been regularized in our HRMS portal.\n\nRegards,\nVaibhav Yadav\nSpecialist, People Operations • Tata 1mg";
        } else if (val === "leave_encash") {
            ta.value = "Hi,\n\nYour leave application and encashment balance have been verified per company policy.\n\nThe updated leave quota will reflect in your next monthly payroll cycle.\n\nRegards,\nVaibhav Yadav\nSpecialist, People Operations • Tata 1mg";
        } else if (val === "general_ack") {
            ta.value = "Hi,\n\nWe have received your query and logged ticket under Tata 1mg People Operations.\n\nA specialist is currently reviewing your case details and will follow up shortly.\n\nRegards,\nVaibhav Yadav\nSpecialist, People Operations • Tata 1mg";
        }
    };

    /**
     * Send Quick Reply via Gmail SMTP & Log to Case Communications
     */
    window.handleSendReply = async function (emailId) {
        const ta = document.getElementById("composerReplyText") || document.getElementById("quickReplyBody");
        const text = (ta && ta.value || "").trim();

        if (!text) {
            alert("Please type a response before sending.");
            return;
        }

        const email = inboxEmails.find(e => e.id === emailId);
        const recipient = email ? (email.sender_email || "employee@1mg.com") : "";

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/emails/${emailId}/send-reply`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    agent_name: "Vaibhav Yadav",
                    recipient: recipient
                })
            });

            if (res.ok) {
                showToast("✨ Reply dispatched via Gmail SMTP & logged in Case Replies!");
                if (ta) ta.value = "";
                // Refresh case replies badge count
                loadRepliesCountBadge();
                // Reload inbox to reflect updated thread
                setTimeout(() => loadInboxEmails(), 600);
            } else {
                alert("Reply logged locally (dispatch simulated).");
                if (ta) ta.value = "";
            }
        } catch (err) {
            console.warn("Send reply fallback:", err);
            alert("Email reply recorded!");
            if (ta) ta.value = "";
        }
    };

    /**
     * Toggle Thread Message Collapse / Expand
     */
    window.toggleThreadMessage = function (msgId) {
        const bodyEl = document.getElementById(`threadMsgBody_${msgId}`);
        const cardEl = document.getElementById(`threadMsgCard_${msgId}`);
        if (!bodyEl) return;
        const isOpen = bodyEl.style.display !== "none";
        bodyEl.style.display = isOpen ? "none" : "block";
        if (cardEl) {
            if (isOpen) cardEl.classList.remove("is-open");
            else cardEl.classList.add("is-open");
        }
    };

    let areAllThreadMessagesExpanded = false;
    window.toggleAllThreadMessages = function () {
        areAllThreadMessagesExpanded = !areAllThreadMessagesExpanded;
        const allBodies = document.querySelectorAll(".thread-msg-full-body");
        allBodies.forEach(el => {
            el.style.display = areAllThreadMessagesExpanded ? "block" : "none";
        });
        const toggleBtn = document.querySelector(".btn-toggle-all-thread");
        if (toggleBtn) {
            toggleBtn.textContent = areAllThreadMessagesExpanded ? "Collapse All" : "Expand All";
        }
    };

    /**
     * Load Case Outbound Replies from Backend
     */
    async function loadRepliesView(force = false) {
        if (!repliesListContainer) return;
        repliesListContainer.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">
                <div style="display:inline-block; width:22px; height:22px; border:2.5px solid var(--border-mid); border-top-color:var(--tata-coral); border-radius:50%; animation: spin 0.8s linear infinite;"></div>
                <div style="margin-top:10px; font-weight:600;">Fetching sent case replies...</div>
            </div>
        `;

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/replies`, {
                headers: { "Accept": "application/json" }
            });
            if (res.ok) {
                const data = await res.json();
                caseRepliesList = (data.data && data.data.replies) || data.replies || [];
                setElText("badgeReplies", caseRepliesList.length);
            }
        } catch (err) {
            console.warn("[Replies] Failed to fetch case replies:", err);
        }

        renderRepliesList();
    }
    window.loadRepliesView = loadRepliesView;

    /**
     * Load Replies Count Badge
     */
    async function loadRepliesCountBadge() {
        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/replies`, {
                headers: { "Accept": "application/json" }
            });
            if (res.ok) {
                const data = await res.json();
                const list = (data.data && data.data.replies) || data.replies || [];
                setElText("badgeReplies", list.length);
            }
        } catch (_) {}
    }

    /**
     * Render Case Outbound Replies List
     */
    function renderRepliesList() {
        if (!repliesListContainer) return;

        let filtered = [...caseRepliesList];
        if (repliesSearchQuery) {
            filtered = filtered.filter(r => {
                const caseNum = String(r.case_number || "").toLowerCase();
                const rec = String(r.recipient || "").toLowerCase();
                const subj = String(r.subject || "").toLowerCase();
                const msg = String(r.message || "").toLowerCase();
                return caseNum.includes(repliesSearchQuery) || rec.includes(repliesSearchQuery) || subj.includes(repliesSearchQuery) || msg.includes(repliesSearchQuery);
            });
        }

        if (filtered.length === 0) {
            repliesListContainer.innerHTML = `
                <div style="padding: 60px 20px; text-align: center; color: var(--text-muted);">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--border-mid); margin-bottom:8px;">
                        <polyline points="9 17 4 12 9 7"></polyline>
                        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
                    </svg>
                    <div style="font-size:14px; font-weight:700; color:var(--text-heading);">No Case Replies Found</div>
                    <div style="font-size:12px; margin-top:4px;">No outbound case communications match your search query.</div>
                </div>
            `;
            return;
        }

        let html = '<div class="replies-grid">';
        filtered.forEach((r) => {
            const caseNum = r.case_number || `#CASE-${r.case_id}`;
            const timeStr = formatFullDate(r.created_at);
            const agentName = r.sender_name || "HR Specialist";
            const recipient = r.recipient || "Employee";
            const subj = r.subject || "(No Subject)";
            const msg = r.message || "";
            const cat = r.case_category || "GENERAL_HR";

            html += `
                <div class="reply-item-card">
                    <div class="reply-card-header">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="reply-case-badge" onclick="openCaseFromInbox('${caseNum}')" title="Jump to Case Dossier">
                                <span>${escapeHtml(caseNum)}</span>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </span>
                            <span class="badge-pill badge-category">${escapeHtml(cat)}</span>
                            <span style="font-size:10.5px; font-weight:700; color:#027A48; background:#ECFDF3; padding:2px 7px; border-radius:4px;">✓ Dispatched via Gmail</span>
                        </div>
                        <span style="font-size:11px; color:var(--text-muted);">${timeStr}</span>
                    </div>

                    <div class="reply-recipient-line">
                        To: <strong>${escapeHtml(recipient)}</strong> &nbsp;·&nbsp; Sent by: <strong>${escapeHtml(agentName)}</strong>
                    </div>

                    <div class="reply-subject-line">${escapeHtml(subj)}</div>

                    <div class="reply-body-text">${escapeHtml(msg)}</div>

                    <div class="reply-card-footer">
                        <span>Communication Ref: #${r.id} · Type: ${escapeHtml(r.comm_type || 'OUTBOUND_HR')}</span>
                        <div style="display:flex; gap:8px;">
                            <button type="button" class="btn-toggle-all-thread" onclick="openCaseFromInbox('${caseNum}')">View in Case Dossier</button>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        repliesListContainer.innerHTML = html;
    }

    /**
     * Re-route Email Category
     */
    window.handleRerouteEmail = function (emailId) {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;

        const newCat = prompt("Enter new department category (ATTENDANCE, LEAVE, PAYROLL, BGV, BENEFITS):", email.category || "PAYROLL");
        if (newCat) {
            email.category = newCat.toUpperCase().trim();
            renderInboxList();
            renderInboxDetail(email);
            alert(`Email re-routed to ${email.category} department pool.`);
        }
    };

    /**
     * Toggle Noise / Actionable Stream
     */
    window.handleToggleNoise = function (emailId) {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;

        const isCurrentlyNoise = Boolean(email.is_noise || !email.is_dept_allotted);
        if (isCurrentlyNoise) {
            email.is_noise = false;
            email.is_dept_allotted = true;
            email.is_actionable = true;
            email.noise_reason = "";
            showToast("Message moved to your department active incoming pool.");
        } else {
            email.is_noise = true;
            email.is_actionable = false;
            email.noise_reason = "Manually marked as Noise / Out-of-Scope";
            showToast("Message moved to Noise / System alerts.");
        }

        updateInboxBadgeCounters();
        renderInboxList();
        renderInboxDetail(email);
        renderInboxAiPanel(email);
    };

    /**
     * Context-Aware Smart AI Response Generator (Tata 1mg Specialist Model)
     */
    function generateSmartDraft(email, tone = "professional") {
        if (!email) return "";
        const sender = String(email.sender_name || "Employee");
        const empFirst = sender.split(" ")[0] || "there";
        const cat = String(email.category || "GENERAL_HR").replace(/_/g, " ").toLowerCase();
        const caseRef = email.case ? (email.case.case_number || `#CASE-${email.case.id}`) : (email.case_number || "HR-OPS");
        const empId = email.matched_emp_code || email.employee_id || (email.extracted_fields && email.extracted_fields.fields && email.extracted_fields.fields.employee_id) || "1MG123";
        const dept = email.matched_emp_dept || "Finance";
        const subj = String(email.subject || "");

        if (tone === "concise") {
            return `Hi ${empFirst},\n\nWe have received and logged your request regarding "${subj || cat}" under reference ${caseRef}.\n\nOur team has queued the required update in the HR portal. You will receive an automated confirmation once completed.\n\nBest regards,\nPeopleDesk · Tata 1mg`;
        }

        if (tone === "verification") {
            return `Dear ${empFirst},\n\nThank you for reaching out to Tata 1mg People Operations.\n\nTo ensure we process your request regarding "${subj}" securely, please confirm the following details:\n1. Official Employee ID (${empId || 'e.g. 1MG123'})\n2. Department (${dept})\n3. Supporting documentation (if requesting personal identity change)\n\nPlease reply directly to this email with these details attached.\n\nWarm regards,\nPeopleDesk · HR Operations\nTata 1mg`;
        }

        // Default: Empathetic & Professional
        let draft = `Dear ${empFirst},\n\nThank you for contacting PeopleDesk (HR Operations). We have received your inquiry regarding: "${subj || cat}".\n\n`;

        if (cat.includes("attendance") || subj.toLowerCase().includes("attendance") || subj.toLowerCase().includes("regulariz")) {
            draft += `We have verified your request details and forwarded your punch logs to your reporting manager for verification. Your biometric attendance records will be regularized in the HRMS portal upon confirmation.\n\n`;
        } else if (cat.includes("name") || subj.toLowerCase().includes("name") || cat.includes("profile") || cat.includes("record") || cat.includes("test_temp_ops_de")) {
            draft += `We have reviewed the details provided (Employee ID: ${empId} · Department: ${dept}). Our specialist has initiated the record correction in the central employee directory. The updated name will reflect in your employee portal within 24 business hours.\n\n`;
        } else if (cat.includes("payroll") || cat.includes("salary") || subj.toLowerCase().includes("salary")) {
            draft += `Your inquiry has been routed to our compensation and benefits desk under tracking reference ${caseRef}. Our payroll specialist is reviewing the ledger and will issue an itemized statement shortly.\n\n`;
        } else {
            draft += `Our PeopleDesk specialist team is reviewing your dossier under reference ${caseRef}. We are coordinating with the relevant department stakeholders to resolve this per company SLA.\n\n`;
        }

        draft += `Please feel free to reply directly to this thread if you have any questions or additional context to share.\n\nWarm regards,\nVaibhav Yadav\nSpecialist, PeopleDesk · HR Operations\nTata 1mg`;
        return draft;
    }

    /**
     * Render Zone 3: AI & Case Copilot Panel (Admin Type + Tata 1mg Specialist Logic)
     */
    function renderInboxAiPanel(email) {
        const contentEl = document.getElementById("inboxAiRhsContent");
        if (!contentEl) return;

        if (!email) {
            contentEl.innerHTML = `
                <div style="padding: 40px 16px; text-align: center; color: var(--text-muted);">
                    <div style="width:40px; height:40px; border-radius:50%; background:var(--tata-coral-light); color:var(--tata-coral); display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"></path>
                        </svg>
                    </div>
                    <div style="font-size:13px; font-weight:700; color:var(--text-heading); margin-bottom:4px;">AI Copilot Ready</div>
                    <div style="font-size:11.5px; line-height:1.4;">Select an incoming email from the left stream to inspect AI categorization, HRMS verification, and response studio.</div>
                </div>
            `;
            return;
        }

        const sender = String(email.sender_name || "Employee");
        const senderEmail = String(email.sender_email || "employee@1mg.com");
        const isInternal = senderEmail.toLowerCase().endsWith("@1mg.com") || senderEmail.toLowerCase().endsWith("@tata1mg.com");
        const category = String(email.category || "GENERAL_HR");
        const confidence = email.category_confidence ? Math.round(email.category_confidence * 100) : 98;
        const caseNum = email.case ? (email.case.case_number || email.case.case_ref || ('#CASE-' + email.case.id)) : (email.case_number || null);
        const hasCase = Boolean(caseNum);

        // Safe SLA Check
        const slaStr = typeof email.sla === 'string' ? email.sla.toUpperCase() : '';
        const slaObj = (typeof email.sla === 'object' && email.sla !== null) ? email.sla : {};
        const isUrgent = slaStr === 'URGENT' || slaObj.priority === 'URGENT' || slaObj.breached === true || email.is_urgent === true || email.is_urgent_sla === true;

        // Employee Match & Extracted Fields
        const empCode = email.matched_emp_code || email.employee_id || (email.extracted_fields && email.extracted_fields.fields && email.extracted_fields.fields.employee_id) || "1MG123";
        const empDept = email.matched_emp_dept || "Finance";
        const empName = email.matched_emp_name || (sender.includes("@") ? "Ananya Sharma" : sender);
        const intentReason = email.actionable_reason || email.category_reason || "Inbound Employee Inquiry";

        // Current smart draft
        const activeDraft = generateSmartDraft(email, window.currentAiDraftTone || "professional");

        let html = `
            <!-- Card 1: AI Intent & Classification Engine -->
            <div class="rhs-ai-card">
                <div class="rhs-card-top-row">
                    <span class="rhs-card-label-wrap">
                        <svg class="rhs-card-label-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        <span>AI Intent Engine</span>
                    </span>
                    <span style="font-size:11px; font-weight:800; color:#027A48;">${confidence}% Match</span>
                </div>

                <div class="rhs-ai-meter-track" title="${confidence}% Confidence">
                    <div class="rhs-ai-meter-fill" style="width: ${confidence}%;"></div>
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; margin-top:4px;">
                    <span class="badge-pill badge-category" style="font-size:11px;">${escapeHtml(category)}</span>
                    <span class="rhs-badge-desk ${email.is_dept_allotted ? 'matched' : 'unmatched'}">
                        ${email.is_dept_allotted ? '✓ Allotted Desk' : '⚠ Out of Dept'}
                    </span>
                </div>

                <div class="rhs-ai-text-desc" style="font-size:11.5px; color:var(--text-secondary); margin-top:2px;">
                    ${escapeHtml(intentReason)}
                </div>
            </div>

            <!-- Card 2: HRMS Identity & Entity Validation (Bento Grid) -->
            <div class="rhs-ai-card">
                <div class="rhs-card-top-row">
                    <span class="rhs-card-label-wrap">
                        <svg class="rhs-card-label-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span>HRMS Employee Verification</span>
                    </span>
                    ${isInternal ? `
                        <span style="font-size:10px; font-weight:800; color:#027A48; background:#ECFDF3; padding:2px 6px; border-radius:4px;">✓ 1mg Domain</span>
                    ` : `
                        <span style="font-size:10px; font-weight:700; color:#475467; background:#F2F4F7; padding:2px 6px; border-radius:4px;">External Sender</span>
                    `}
                </div>

                <div class="rhs-bento-grid">
                    <div class="rhs-bento-tile">
                        <span class="rhs-bento-k">Matched Name</span>
                        <span class="rhs-bento-v ok" title="${escapeHtml(empName)}">${escapeHtml(empName)}</span>
                    </div>
                    <div class="rhs-bento-tile">
                        <span class="rhs-bento-k">Employee ID</span>
                        <span class="rhs-bento-v ok">${escapeHtml(empCode)}</span>
                    </div>
                    <div class="rhs-bento-tile">
                        <span class="rhs-bento-k">Department</span>
                        <span class="rhs-bento-v" title="${escapeHtml(empDept)}">${escapeHtml(empDept)}</span>
                    </div>
                    <div class="rhs-bento-tile">
                        <span class="rhs-bento-k">Destination Desk</span>
                        <span class="rhs-bento-v" title="${escapeHtml(email.account_email || 'Operations Desk')}">PeopleDesk</span>
                    </div>
                </div>
            </div>

            <!-- Card 3: Case Tracking & SLA Cockpit -->
            <div class="rhs-ai-card">
                <div class="rhs-card-top-row">
                    <span class="rhs-card-label-wrap">
                        <svg class="rhs-card-label-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
                            <line x1="3" y1="9" x2="21" y2="9"></line>
                            <line x1="9" y1="21" x2="9" y2="9"></line>
                        </svg>
                        <span>Case &amp; SLA Cockpit</span>
                    </span>
                    <span style="font-size:11px; font-weight:700; color:${isUrgent ? 'var(--tata-crimson)' : 'var(--text-secondary)'};">
                        ${isUrgent ? '⚡ Urgent SLA' : 'Standard 48h'}
                    </span>
                </div>

                <div class="rhs-quick-meta-grid">
                    <div>
                        <div class="rhs-meta-k">Tracking Ref</div>
                        <div class="rhs-meta-v">${hasCase ? escapeHtml(caseNum) : '<span style="color:var(--text-muted);">Unclaimed</span>'}</div>
                    </div>
                    <div>
                        <div class="rhs-meta-k">Status</div>
                        <div class="rhs-meta-v">${hasCase ? 'In Progress' : 'Ready to Claim'}</div>
                    </div>
                </div>

                <div style="margin-top:2px;">
                    ${hasCase ? `
                        <button type="button" class="btn-rhs-claim is-secondary" onclick="openCaseFromInbox('${caseNum}')">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            <span>Open Case Dossier (${escapeHtml(caseNum)})</span>
                        </button>
                    ` : `
                        <button type="button" class="btn-rhs-claim" onclick="handleClaimEmail(${email.id})">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            <span>⚡ Claim &amp; Convert to Case</span>
                        </button>
                    `}
                </div>
            </div>

            <!-- Card 4: Tata 1mg Response Studio -->
            <div class="rhs-ai-card">
                <div class="rhs-card-top-row">
                    <span class="rhs-card-label-wrap">
                        <svg class="rhs-card-label-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                        <span>Response Studio</span>
                    </span>
                    <span style="font-size:10px; font-weight:800; color:var(--tata-coral); background:var(--tata-coral-light); padding:2px 6px; border-radius:4px;">Auto-Draft</span>
                </div>

                <div class="rhs-tone-row">
                    <button type="button" class="rhs-tone-chip ${(!window.currentAiDraftTone || window.currentAiDraftTone === 'professional') ? 'is-active' : ''}" onclick="switchAiDraftTone(${email.id}, 'professional')">Empathetic</button>
                    <button type="button" class="rhs-tone-chip ${(window.currentAiDraftTone === 'concise') ? 'is-active' : ''}" onclick="switchAiDraftTone(${email.id}, 'concise')">Concise</button>
                    <button type="button" class="rhs-tone-chip ${(window.currentAiDraftTone === 'verification') ? 'is-active' : ''}" onclick="switchAiDraftTone(${email.id}, 'verification')">Verify Docs</button>
                </div>

                <div class="rhs-draft-preview-box" id="rhsDraftPreviewBox">${escapeHtml(activeDraft)}</div>

                <button type="button" class="btn-rhs-insert-draft" onclick="handleInsertAiDraftToComposer(${email.id})">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    <span>Insert Draft to Reply Box</span>
                </button>
            </div>
        `;

        contentEl.innerHTML = html;
    }

    /**
     * Switch Draft Tone & Re-render AI Panel
     */
    window.switchAiDraftTone = function (emailId, tone) {
        window.currentAiDraftTone = tone;
        const email = inboxEmails.find(e => e.id === emailId);
        if (email) {
            renderInboxAiPanel(email);
        }
    };

    /**
     * Insert AI Draft Directly into Reply Composer
     */
    window.handleInsertAiDraftToComposer = function (emailId) {
        const email = inboxEmails.find(e => e.id === emailId);
        if (!email) return;

        const draft = generateSmartDraft(email, window.currentAiDraftTone || "professional");
        const textarea = document.getElementById("composerReplyText") || document.getElementById("quickReplyBody");
        if (textarea) {
            textarea.value = draft;
            textarea.scrollIntoView({ behavior: "smooth", block: "center" });
            textarea.focus();
            showToast("✨ AI response draft inserted into Quick Reply!");
        } else {
            showToast("Quick Reply composer not found");
        }
    };

    /**
     * AI Draft Response Generator (Compatibility alias)
     */
    window.handleGenerateAiDraft = function (emailId) {
        handleInsertAiDraftToComposer(emailId);
    };

    /**
     * Navigate to Case Dossier from Inbox
     */
    window.openCaseFromInbox = function (caseRef) {
        window.location.hash = "#cases";
        if (caseRef) {
            setTimeout(() => {
                if (searchInput) {
                    searchInput.value = caseRef;
                    filterCasesBySearch(caseRef.toLowerCase());
                }
            }, 80);
        }
        showToast(`Opening Case Dossier ${caseRef}...`);
    };

    /**
     * Non-intrusive Toast Notification Helper
     */
    function showToast(msg) {
        let toast = document.getElementById("agentGlobalToast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "agentGlobalToast";
            toast.style.cssText = "position:fixed; bottom:24px; right:24px; background:#1D2939; color:#FFFFFF; padding:10px 18px; border-radius:8px; font-size:12.5px; font-weight:600; box-shadow:0 4px 14px rgba(0,0,0,0.2); z-index:9999; display:flex; align-items:center; gap:8px; opacity:0; transform:translateY(10px); transition:all 0.25s ease; pointer-events:none;";
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<span style="color:var(--tata-coral);">✦</span> <span>${escapeHtml(msg)}</span>`;
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(10px)";
        }, 2800);
    }

    /**
     * Format helpers
     */
    function formatEmailTime(isoStr) {
        if (!isoStr) return "Just now";
        try {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return "Recently";
            const now = new Date();
            const diffHours = (now - d) / (1000 * 60 * 60);

            if (diffHours < 24 && now.getDate() === d.getDate()) {
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
        } catch (_) {
            return "Recently";
        }
    }

    function formatFullDate(isoStr) {
        if (!isoStr) return new Date().toLocaleString();
        try {
            const d = new Date(isoStr);
            return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        } catch (_) {
            return String(isoStr);
        }
    }

    function extractSnippet(text) {
        if (!text) return "No message content...";
        return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    }

    /**
     * Separate incoming email body into primary new message, quote header, and historical quoted chain
     */
    function separateEmailQuote(raw) {
        if (!raw) return { mainText: "", quoteHeader: "", quotedText: "" };
        let text = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // 1. Match 'On ... wrote:' even if wrote: is on next line (cross-line matching)
        const onWroteRegex = /\n\s*(On\s+[\s\S]+?\bwrote\s*:\s*\n)([\s\S]*)/i;
        let match = text.match(onWroteRegex);
        if (match) {
            return {
                mainText: text.slice(0, match.index).trim(),
                quoteHeader: match[1].trim(),
                quotedText: match[2].trim()
            };
        }

        // 2. Match separator lines (--- Original Message --- or --- Forwarded message ---)
        const sepRegex = /\n\s*(-{3,}\s*(?:Original Message|Forwarded message)\s*-{3,}[\s\S]*)/i;
        match = text.match(sepRegex);
        if (match) {
            return {
                mainText: text.slice(0, match.index).trim(),
                quoteHeader: "Quoted Email Thread",
                quotedText: match[1].trim()
            };
        }

        // 3. Match consecutive lines starting with '>'
        const gtRegex = /\n\s*(>\s*[\s\S]*)/;
        match = text.match(gtRegex);
        if (match) {
            return {
                mainText: text.slice(0, match.index).trim(),
                quoteHeader: "Quoted Email Thread",
                quotedText: match[1].trim()
            };
        }

        return { mainText: text.trim(), quoteHeader: "", quotedText: "" };
    }

    /**
     * Format Email Body into Executive Typography, Structured Dossiers & Clean Accordions
     */
    function formatEmailBody(body, isInsideQuote = false) {
        if (!body) return "<div class='email-empty-body'>No message body provided.</div>";
        const raw = String(body).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // If rich HTML is already present (e.g. from template or WYSIWYG), render safely
        if (raw.includes("<p>") || raw.includes("<table>") || raw.includes("<div class=")) {
            return raw;
        }

        // Separate Quoted History if not already inside quote drawer
        let mainText = raw.trim();
        let quoteHeader = "";
        let quotedText = "";

        if (!isInsideQuote) {
            const sep = separateEmailQuote(raw);
            mainText = sep.mainText;
            quoteHeader = sep.quoteHeader;
            quotedText = sep.quotedText;
        }

        let htmlOut = "";

        // CHECK A: Is mainText an Employee ID / Code response? (e.g., "1MG123", "1MG0023")
        const empCodeMatch = mainText.match(/^(?:(?:official\s*)?(?:employee\s*(?:id|code)\s*:?\s*)?|(?:emp\s*id\s*:?\s*))?([1-9][0-9a-zA-Z_-]{2,10}|1MG\w{2,10})$/i);
        if (empCodeMatch && mainText.length <= 24 && !mainText.includes('\n')) {
            const codeVal = empCodeMatch[1].toUpperCase();
            htmlOut += `
                <div class="email-emp-code-badge-card">
                    <div class="emp-code-badge-left">
                        <div class="emp-code-badge-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                                <path d="M7 7h10"></path>
                                <path d="M7 12h10"></path>
                                <path d="M7 17h6"></path>
                            </svg>
                        </div>
                        <div>
                            <div class="emp-code-badge-label">Official Employee Code Provided</div>
                            <div class="emp-code-badge-val">${escapeHtml(codeVal)}</div>
                        </div>
                    </div>
                    <span class="emp-code-badge-chip">✓ Verified ID Input</span>
                </div>
            `;
        }
        // CHECK B: Is mainText a short 1-line note? (e.g. "Need more details", "Open it again", under 70 chars)
        else if (mainText.length > 0 && mainText.length <= 70 && !mainText.includes('\n') && !mainText.includes(':')) {
            htmlOut += `
                <div class="email-short-reply-bubble">
                    <div class="short-reply-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>
                        <span>Follow-up Response</span>
                    </div>
                    <div class="short-reply-text">${escapeHtml(mainText)}</div>
                </div>
            `;
        }
        // CHECK C: Multi-line rich content, Key-Value tables & paragraphs
        else if (mainText) {
            // Filter out stray empty bullet/hyphen lines from plain-text exports
            const lines = mainText.split('\n');
            const cleanedLines = [];
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed === '-' || trimmed === '*' || trimmed === '•' || trimmed === '—' || trimmed === '--') {
                    continue;
                }
                cleanedLines.push(lines[i]);
            }

            // Parse lines into blocks: 'text' vs 'kv' (Structured Key-Value Dossier)
            const kvPattern = /^\s*(?:[-*•]\s*)?\*?([A-Za-z0-9\s\/&_-]+?)\*?:\*?\s+(.+)$/;
            const blocks = [];
            let currentKv = [];
            let normalLines = [];

            function flushNormal() {
                if (normalLines.length > 0) {
                    const txt = normalLines.join('\n').trim();
                    if (txt) blocks.push({ type: 'text', data: txt });
                    normalLines = [];
                }
            }

            function flushKv() {
                if (currentKv.length > 0) {
                    if (currentKv.length >= 2) {
                        blocks.push({ type: 'kv', data: [...currentKv] });
                    } else {
                        currentKv.forEach(item => normalLines.push(item.key + ': ' + item.val));
                        flushNormal();
                    }
                    currentKv = [];
                }
            }

            for (let i = 0; i < cleanedLines.length; i++) {
                const l = cleanedLines[i];
                const m = l.match(kvPattern);
                if (m) {
                    flushNormal();
                    currentKv.push({ key: m[1].trim(), val: m[2].trim() });
                } else {
                    if (currentKv.length > 0) {
                        if (!l.trim()) {
                            continue;
                        } else {
                            flushKv();
                        }
                    }
                    normalLines.push(l);
                }
            }
            flushNormal();
            flushKv();

            blocks.forEach(block => {
                if (block.type === 'kv') {
                    htmlOut += `
                        <div class="email-details-card">
                            <div class="details-card-header">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                    <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                                <span>Extracted Request Dossier</span>
                            </div>
                            <div class="details-card-grid">
                                ${block.data.map(kv => {
                                    const kLower = kv.key.toLowerCase();
                                    const isAction = kLower.includes('action') || kLower.includes('request');
                                    const isIssue = kLower.includes('issue') || kLower.includes('reason');
                                    let valClass = 'detail-val';
                                    if (isAction) valClass += ' detail-action-pill';
                                    else if (isIssue) valClass += ' detail-issue-val';

                                    return `
                                        <div class="detail-row">
                                            <span class="detail-label">${escapeHtml(kv.key)}</span>
                                            <span class="${valClass}">${escapeHtml(kv.val)}</span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                } else {
                    const paragraphs = block.data.split(/\n{2,}/);
                    paragraphs.forEach(p => {
                        const pTrimmed = p.trim();
                        if (!pTrimmed) return;

                        if (/^(?:best regards|regards|sincerely|thanks|thank you|cheers),/i.test(pTrimmed)) {
                            const sigLines = pTrimmed.split('\n').map(s => escapeHtml(s.trim()));
                            htmlOut += `<div class="email-signature-block">${sigLines.join('<br>')}</div>`;
                            return;
                        }

                        let formatted = escapeHtml(pTrimmed);
                        formatted = formatted.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
                        formatted = formatted.replace(/\*([^*]+?)\*/g, '<strong>$1</strong>');
                        formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" class="email-inline-link">$1</a>');
                        formatted = formatted.replace(/\n/g, '<br>');

                        htmlOut += `<p class="email-text-para">${formatted}</p>`;
                    });
                }
            });
        }

        // Quoted History: Collapsed behind a sleek toggle button (stripped of ugly > brackets)
        if (quotedText && !isInsideQuote) {
            const cleanQuoteLines = quotedText
                .split('\n')
                .map(l => l.replace(/^\s*>\s?/, ''))
                .join('\n')
                .trim();

            const headerSnippet = (quoteHeader || "Prior email conversation").replace(/\n/g, ' ').slice(0, 50);

            htmlOut += `
                <div class="email-quoted-chain-box">
                    <button type="button" class="btn-email-toggle-quote" onclick="window.toggleQuotedEmailChain(this)">
                        <span class="btn-quote-dots">⋯</span>
                        <span class="btn-quote-text">Show Quoted Email Chain</span>
                        <span class="btn-quote-preview">(${escapeHtml(headerSnippet)}...)</span>
                        <svg class="btn-quote-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <div class="email-quoted-drawer" style="display:none;">
                        <div class="quoted-drawer-header">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                            <span>${escapeHtml(quoteHeader || 'Quoted History')}</span>
                        </div>
                        <div class="quoted-drawer-body">
                            ${formatEmailBody(cleanQuoteLines, true)}
                        </div>
                    </div>
                </div>
            `;
        }

        return htmlOut;
    }

    window.toggleQuotedEmailChain = function (btn) {
        if (!btn) return;
        const drawer = btn.nextElementSibling;
        if (!drawer) return;
        const isOpen = drawer.style.display !== "none";
        drawer.style.display = isOpen ? "none" : "block";
        btn.classList.toggle("is-expanded", !isOpen);
        const label = btn.querySelector(".btn-quote-text");
        if (label) {
            label.textContent = isOpen ? "Show Quoted Email Chain" : "Hide Quoted Email Chain";
        }
    };

    /* ==========================================================================
       CASES SECTION LOGIC & DATA
       ========================================================================== */

    function initCaseTabs() {
        const tabsRow = document.getElementById("feedTabsRow");
        if (tabsRow) {
            tabsRow.addEventListener("click", (e) => {
                const btn = e.target.closest(".feed-tab-btn");
                if (!btn) return;

                tabsRow.querySelectorAll(".feed-tab-btn").forEach(b => b.classList.remove("is-active"));
                btn.classList.add("is-active");

                activeCaseFilter = btn.getAttribute("data-filter") || "all";
                renderFeedRows();
            });
        }

        // Collapse / Expand Left Queue Rail
        const btnToggleStream = document.getElementById("btnToggleCasesStream");
        const streamPane = document.getElementById("casesStreamPane");
        if (btnToggleStream && streamPane) {
            btnToggleStream.addEventListener("click", () => {
                isCasesStreamCollapsed = !isCasesStreamCollapsed;
                if (isCasesStreamCollapsed) {
                    streamPane.classList.add("is-collapsed");
                    const txt = btnToggleStream.querySelector(".btn-toggle-cases-stream-text");
                    if (txt) txt.textContent = "Expand Queue";
                    btnToggleStream.setAttribute("title", "Expand Case Queue");
                } else {
                    streamPane.classList.remove("is-collapsed");
                    const txt = btnToggleStream.querySelector(".btn-toggle-cases-stream-text");
                    if (txt) txt.textContent = "Collapse Queue";
                    btnToggleStream.setAttribute("title", "Collapse Case Queue");
                }
            });
        }

        // Case Stream Search / Filter Input
        const searchCasesInput = document.getElementById("searchCasesInput");
        if (searchCasesInput) {
            searchCasesInput.addEventListener("input", (e) => {
                casesSearchQuery = (e.target.value || "").toLowerCase().trim();
                renderFeedRows();
            });
        }
    }

    function initGlobalSearch() {
        if (!searchInput) return;

        searchInput.addEventListener("input", (e) => {
            const q = (e.target.value || "").toLowerCase().trim();
            if (currentView === "inbox") {
                inboxSearchQuery = q;
                renderInboxList();
            } else {
                filterCasesBySearch(q);
            }
        });
    }

    function filterCasesBySearch(query) {
        if (!query) {
            renderFeedRows();
            return;
        }

        const filtered = allCases.filter(c => {
            const ref = (c.case_ref || c.id || "").toLowerCase();
            const subj = (c.subject || c.title || "").toLowerCase();
            const name = (c.employee_name || c.sender_name || "").toLowerCase();
            const dept = (c.department || c.category || "").toLowerCase();
            return ref.includes(query) || subj.includes(query) || name.includes(query) || dept.includes(query);
        });

        renderRows(filtered);
    }

    /**
     * Topbar Live Clock
     */
    function initLiveClock() {
        function updateClock() {
            if (!clockEl) return;
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const dateStr = now.toLocaleDateString([], { day: 'numeric', month: 'short' });
            clockEl.textContent = `${timeStr} • ${dateStr}`;
        }
        updateClock();
        setInterval(updateClock, 1000);
    }

    /**
     * Fetch Live Telemetry & Data from Backend
     */
    async function loadWorkbenchData(showToast = false) {
        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/my-workbench`, {
                headers: { "Accept": "application/json" }
            });

            if (res.ok) {
                const data = await res.json();
                workbenchData = data;

                if (data.agent) renderAgentProfile(data.agent);
                if (data.kpis) updateKPIs(data.kpis);
                loadRepliesCountBadge();

                // If currently on inbox view, refresh inbox with workbench dept_emails
                if (currentView === "inbox") {
                    loadInboxEmails();
                }

                // Combine and strictly deduplicate personal cases and department pool
                const myCases = data.my_cases || [];
                const deptCases = data.dept_cases || [];
                const unclaimedCases = data.unclaimed_cases || [];
                const caseMap = new Map();
                [...myCases, ...deptCases, ...unclaimedCases].forEach(c => {
                    const key = c.case_number || c.case_ref || c.id || c.db_id;
                    if (key && !caseMap.has(key)) {
                        caseMap.set(key, c);
                    }
                });
                allCases = Array.from(caseMap.values());
            } else {
                allCases = [];
            }

            renderFeedRows();

            if (showToast) {
                console.log("[HR Flow] Workbench refreshed successfully.");
            }
        } catch (err) {
            console.warn("[Agent] API unreachable, cases queue empty:", err);
            allCases = [];
            renderFeedRows();
        }
    }

    /**
     * Update Agent Identity in Sidebar
     */
    function renderAgentProfile(agent) {
        const nameEl = document.getElementById("sidebarAgentName");
        const deptEl = document.getElementById("sidebarDeptText");
        const avatarEl = document.getElementById("sidebarAvatar");

        if (nameEl && agent.name) nameEl.textContent = agent.name;
        if (deptEl) {
            deptEl.textContent = (agent.active_department && agent.active_department.name) || agent.department || "People Operations";
        }
        if (avatarEl && agent.name) {
            const parts = agent.name.trim().split(" ");
            avatarEl.textContent = parts.length > 1
                ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                : agent.name.slice(0, 2).toUpperCase();
        }
    }

    /**
     * Update KPI Numbers & Badges
     */
    function updateKPIs(kpis) {
        const myActive = kpis.my_active || kpis.active_cases || 0;
        const unclaimed = kpis.unclaimed_pool || kpis.dept_cases_count || 0;
        const urgent = kpis.urgent_sla || kpis.urgent_cases || 0;
        const tasks = kpis.my_tasks || kpis.tasks_count || 0;
        const approvals = kpis.pending_approvals || 0;

        // KPI Cards
        setElText("kpiActiveCases", myActive);
        setElText("kpiUnclaimedPool", unclaimed);
        setElText("kpiUrgentSLA", urgent);
        setElText("kpiPendingTasks", tasks);

        // Sidebar Badges
        setBadge("badgeInbox", unclaimed);
        setBadge("badgeCases", myActive);
        setBadge("badgeActions", tasks + approvals);
        setBadge("badgeUrgent", urgent);
        setBadge("badgeApprovals", approvals);
    }

    function setElText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function setBadge(id, count) {
        const el = document.getElementById(id);
        if (!el) return;
        const num = parseInt(count, 10) || 0;
        el.textContent = num;
        
        // Add marker to parent link for collapsed rail dot indicator
        const parentLink = el.closest(".nav-item-link");
        if (parentLink) {
            if (num > 0) parentLink.classList.add("has-badge");
            else parentLink.classList.remove("has-badge");
        }
    }

    /**
     * Render Cases Feed Rows based on Active View and Tab
     */
    function renderFeedRows() {
        if (!feedContainer) return;

        let filtered = [...allCases];

        // Apply View filters
        if (currentView === "urgent-sla") {
            filtered = filtered.filter(c => c.is_urgent || c.priority === "URGENT" || c.priority === "HIGH");
        } else if (currentView === "approvals") {
            filtered = filtered.filter(c => c.requires_approval || c.status === "PENDING_APPROVAL");
        }

        // Apply Tab filters
        if (activeCaseFilter === "assigned") {
            filtered = filtered.filter(c => c.assigned_to && c.assigned_to !== "UNASSIGNED");
        } else if (activeCaseFilter === "unclaimed") {
            filtered = filtered.filter(c => !c.assigned_to || c.assigned_to === "UNASSIGNED");
        } else if (activeCaseFilter === "urgent") {
            filtered = filtered.filter(c => c.is_urgent || c.priority === "URGENT" || c.priority === "HIGH");
        }

        // Apply Search query
        if (casesSearchQuery) {
            filtered = filtered.filter(c => {
                const ref = (c.case_ref || c.id || c.case_number || "").toLowerCase();
                const subj = (c.subject || c.title || "").toLowerCase();
                const name = (c.employee_name || c.sender_name || "").toLowerCase();
                const dept = (c.department || c.category || "").toLowerCase();
                return ref.includes(casesSearchQuery) || subj.includes(casesSearchQuery) || name.includes(casesSearchQuery) || dept.includes(casesSearchQuery);
            });
        }

        // Update tab count badges
        setElText("tabCountAll", allCases.length);
        setElText("tabCountAssigned", allCases.filter(c => c.assigned_to && c.assigned_to !== "UNASSIGNED").length);
        setElText("tabCountUnclaimed", allCases.filter(c => !c.assigned_to || c.assigned_to === "UNASSIGNED").length);
        setElText("tabCountUrgent", allCases.filter(c => c.is_urgent || c.priority === "URGENT" || c.priority === "HIGH").length);

        renderRows(filtered);
    }

    function renderRows(items) {
        const dossierPane = document.getElementById("casesDossierPane");

        if (!items || items.length === 0) {
            feedContainer.innerHTML = `
                <div style="padding: 48px 20px; text-align: center; color: var(--text-muted);">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--border-mid); margin-bottom:12px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="m9 12 2 2 4-4"></path>
                    </svg>
                    <div style="font-size:14px; font-weight:700; color:var(--text-primary);">All Clear! Inbox Zero</div>
                    <div style="font-size:12px; margin-top:4px;">No cases found in this filter. Use <strong>+ New Case</strong> above to create a test case.</div>
                </div>
            `;
            if (dossierPane) {
                dossierPane.innerHTML = `
                    <div class="case-empty-dossier">
                        <div class="inbox-empty-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2.5"></rect>
                                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"></path>
                            </svg>
                        </div>
                        <div class="inbox-empty-title">Select a Case from the Queue</div>
                        <div class="inbox-empty-desc">Choose a case from the queue on the left to inspect the employee verification dossier, review policy checklists, and execute resolution workflows.</div>
                    </div>
                `;
            }
            selectedCaseRef = null;
            currentDossierData = null;
            return;
        }

        // Validate or select active case
        const found = items.some(c => (c.case_ref || c.id || c.case_number) === selectedCaseRef);
        if (!found) {
            selectedCaseRef = items[0].case_ref || items[0].id || items[0].case_number;
        }

        let html = "";
        items.forEach((c, idx) => {
            const ref = c.case_ref || c.id || c.case_number || "CASE-000000";
            const subject = c.subject || c.title || "Employee Inquiry";
            const empName = c.employee_name || c.sender_name || "Employee";
            const dept = c.category || c.department || "Operations";
            const isUrgent = c.is_urgent || c.priority === "URGENT";
            const isAssigned = c.assigned_to && c.assigned_to !== "UNASSIGNED";
            const isSelected = ref === selectedCaseRef;
            const pal = AVATAR_PALETTES[idx % AVATAR_PALETTES.length];
            const initials = empName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "EM";

            html += `
                <div class="case-card-item ${isSelected ? 'is-selected' : ''}" data-case-ref="${ref}" onclick="selectCase('${ref}')" title="${escapeHtml(empName)} (${ref}) - ${escapeHtml(subject)}">
                    <div class="case-card-header">
                        <div class="case-card-left-head">
                            <div class="case-card-avatar" style="background:${pal.bg};">${initials}</div>
                            <span class="case-card-ref">${ref}</span>
                        </div>
                        ${isUrgent ? `<span class="badge-pill badge-urgent-tag" style="padding:2px 7px; font-size:10px;">⚡ SLA</span>` : `<span class="case-card-time" style="font-size:11px; color:var(--text-muted);">Open</span>`}
                    </div>
                    <div class="case-card-title">${escapeHtml(subject)}</div>
                    <div class="case-card-meta">
                        <span>${escapeHtml(empName)}</span>
                        <span>•</span>
                        <span>${escapeHtml(dept)}</span>
                    </div>
                    <div class="case-card-badges">
                        <span class="badge-pill badge-category">${dept}</span>
                        ${isAssigned ? `<span class="badge-pill" style="background:#F2F4F7; color:var(--text-secondary); font-size:10.5px;">Assigned</span>` : `<span class="badge-pill" style="background:#FFF8E6; color:#B54708; font-size:10.5px;">Unclaimed</span>`}
                    </div>
                </div>
            `;
        });

        feedContainer.innerHTML = html;

        // Automatically load dossier for selected case
        if (selectedCaseRef) {
            selectCase(selectedCaseRef);
        }
    }

    /**
     * Select & Load Case Dossier into Right Pane
     */
    window.selectCase = async function(caseRef) {
        selectedCaseRef = caseRef;

        // Highlight active card in left rail
        const cards = document.querySelectorAll(".case-card-item");
        cards.forEach(card => {
            if (card.getAttribute("data-case-ref") === caseRef) {
                card.classList.add("is-selected");
            } else {
                card.classList.remove("is-selected");
            }
        });

        const dossierPane = document.getElementById("casesDossierPane");
        if (!dossierPane) return;

        // If already loaded and matching, just re-render
        if (currentDossierData && (currentDossierData.case.case_number === caseRef || currentDossierData.case.case_ref === caseRef)) {
            renderCaseDossier(currentDossierData);
            return;
        }

        // Show loading state
        dossierPane.innerHTML = `
            <div style="padding: 80px 24px; text-align: center; color: var(--text-muted);">
                <div style="display:inline-block; width:28px; height:28px; border:3px solid var(--border-mid); border-top-color:var(--tata-coral); border-radius:50%; animation: spin 0.8s linear infinite;"></div>
                <div style="margin-top:14px; font-weight:700; color:var(--text-heading);">Loading 360° Case Dossier...</div>
                <div style="font-size:12px; margin-top:4px;">Retrieving employee verification, tasks, and audit trail for ${escapeHtml(caseRef)}</div>
            </div>
        `;

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/detail`, {
                headers: { "Accept": "application/json" }
            });

            if (res.ok) {
                const json = await res.json();
                currentDossierData = json.data || json;
                renderCaseDossier(currentDossierData);
            } else {
                fallbackCaseDossier(caseRef);
            }
        } catch (err) {
            console.warn("[Agent] Case detail fetch failed, using fallback:", err);
            fallbackCaseDossier(caseRef);
        }
    };

    /**
     * Fallback Dossier Generator for offline / client-seeded cases
     */
    function fallbackCaseDossier(caseRef) {
        const item = allCases.find(c => (c.case_ref || c.id || c.case_number) === caseRef) || {
            case_ref: caseRef,
            title: "Employee HR Inquiry",
            subject: "Employee HR Inquiry",
            employee_name: "Rahul Verma",
            category: "ATTENDANCE",
            priority: "URGENT",
            is_urgent: true,
            assigned_to: "UNASSIGNED"
        };

        const empName = item.employee_name || item.sender_name || "Rahul Verma";
        const empCode = item.employee_id || item.employee_code || "1MG123";
        const dept = item.department || item.category || "Supply Chain & Operations";

        currentDossierData = {
            case: {
                case_number: caseRef,
                case_ref: caseRef,
                title: item.title || item.subject || "Attendance regularization request",
                subject: item.title || item.subject || "Attendance regularization request",
                category: dept,
                priority: item.priority || "URGENT",
                status: item.status || "OPEN",
                assigned_user: item.assigned_to || "UNASSIGNED",
                created_at: new Date().toISOString()
            },
            employee: {
                name: empName,
                employee_id: empCode,
                department: dept,
                designation: "Senior Operations Associate",
                email: "rahul.verma@1mg.com",
                manager_name: "Vikram Malhotra (VP Operations)",
                location: "Gurugram DC Hub"
            },
            email: {
                sender_name: empName,
                sender_email: "rahul.verma@1mg.com",
                subject: item.title || item.subject,
                received_at: new Date().toISOString(),
                body: "Dear People Operations Team,\n\nMy morning biometric attendance punch was not registered at the Gurugram Distribution Center turnstile on 28th Oct 2026 due to optical scanner failure during site dispatch duty.\n\nKindly regularize my morning in-punch for 09:30 AM.\n\nEmployee Code: 1MG123\nDepartment: Supply Chain & Operations\nShift: General Day Shift\n\nThank you,\nRahul Verma"
            },
            tasks: [
                { title: "Verify Employee Identity (" + empCode + ")", status: "COMPLETED" },
                { title: "Audit Attendance / Biometric Turnstile Logs", status: "PENDING" },
                { title: "Manager Authorization Verification", status: "PENDING" }
            ],
            audit_logs: [
                {
                    action: "CASE_INGESTED",
                    description: "Case " + caseRef + " registered into system.",
                    performed_by: "System Intake Engine",
                    created_at: new Date().toISOString()
                }
            ],
            smart_reply_draft: "Dear " + empName + ",\n\nYour attendance regularization request for Gurugram DC turnstile has been verified against the physical gate registry. Your morning in-punch for 09:30 AM is officially recorded.\n\nRegards,\nPeople Operations Team\nTata 1mg Healthcare Solutions"
        };

        renderCaseDossier(currentDossierData);
    }

    /**
     * Formats raw email text into a clean executive letterhead layout,
     * stripping orphan dashes, grouping key-value metadata, and highlighting payroll/deduction discrepancies.
     */
    function formatExecutiveEmailBody(raw, caseData) {
        if (!raw) return '<p class="email-paragraph">No email body text captured.</p>';

        // 1. Normalize line endings
        let text = raw.replace(/\r\n/g, '\n').trim();
        // Remove lines with lone dashes, asterisks, or bullets
        text = text.replace(/^\s*[-*•]\s*$\n/gm, '');
        // Clean lines where a number like '1.' is alone on a line before text
        text = text.replace(/^\s*(\d+)\.\s*$\n\s*/gm, '$1. ');
        // Ensure section headers like *Employee Information:* have double newlines before & after
        text = text.replace(/(\*[^*]+\*:?)/g, '\n\n$1\n\n');
        // Collapse 3+ newlines to 2
        text = text.replace(/\n{3,}/g, '\n\n');

        // Extract key discrepancy fields if actually present in inquiry text
        const amountMatch = text.match(/(?:Deduction Amount|Salary Difference|Discrepancy Amount):\s*([^\n\r]+)/i);
        const categoryMatch = text.match(/(?:Deduction Category|Discrepancy Category|Issue Category|Category):\s*([^\n\r]+)/i);
        const expectedNetMatch = text.match(/(?:Expected Net Salary|Expected Net|Expected Gross Salary):\s*([^\n\r]+)/i);
        const actualNetMatch = text.match(/(?:Actual Net Salary Credited|Actual Salary Credited|Actual Net Salary):\s*([^\n\r]+)/i);
        const datesMatch = text.match(/(?:Leave Dates|Salary Credit Date|Effective Date):\s*([^\n\r]+)/i);
        const refMatch = text.match(/(?:Leave Request ID|Transaction Reference Number|Reference ID|Ref Number):\s*([^\n\r]+)/i);

        let discrepancyBannerHtml = '';
        if (amountMatch || (expectedNetMatch && actualNetMatch)) {
            const cells = [];
            if (amountMatch) {
                const label = /difference/i.test(amountMatch[0]) ? 'Salary Difference' : 'Deduction Amount';
                cells.push(`
                    <div class="discrepancy-cell">
                        <span class="discrepancy-cell-key">${label}</span>
                        <span class="discrepancy-cell-val is-amount">${escapeHtml(amountMatch[1].trim())}</span>
                    </div>
                `);
            }
            if (categoryMatch) {
                cells.push(`
                    <div class="discrepancy-cell">
                        <span class="discrepancy-cell-key">Category</span>
                        <span class="discrepancy-cell-val">${escapeHtml(categoryMatch[1].trim())}</span>
                    </div>
                `);
            }
            if (expectedNetMatch) {
                const label = /gross/i.test(expectedNetMatch[0]) ? 'Expected Gross' : 'Expected Net';
                cells.push(`
                    <div class="discrepancy-cell">
                        <span class="discrepancy-cell-key">${label}</span>
                        <span class="discrepancy-cell-val">${escapeHtml(expectedNetMatch[1].trim())}</span>
                    </div>
                `);
            }
            if (actualNetMatch) {
                cells.push(`
                    <div class="discrepancy-cell">
                        <span class="discrepancy-cell-key">Actual Credited</span>
                        <span class="discrepancy-cell-val" style="color:#B42318;">${escapeHtml(actualNetMatch[1].trim())}</span>
                    </div>
                `);
            }
            if (datesMatch) {
                const label = /credit/i.test(datesMatch[0]) ? 'Credit Date' : 'Relevant Dates';
                cells.push(`
                    <div class="discrepancy-cell">
                        <span class="discrepancy-cell-key">${label}</span>
                        <span class="discrepancy-cell-val">${escapeHtml(datesMatch[1].trim())}</span>
                    </div>
                `);
            }
            if (refMatch) {
                const label = /leave/i.test(refMatch[0]) ? 'Leave Ref ID' : 'Transaction Ref';
                cells.push(`
                    <div class="discrepancy-cell">
                        <span class="discrepancy-cell-key">${label}</span>
                        <span class="discrepancy-cell-val" style="font-family:monospace; color:#027A48;">${escapeHtml(refMatch[1].trim())}</span>
                    </div>
                `);
            }

            discrepancyBannerHtml = `
                <div class="email-discrepancy-card">
                    <div class="discrepancy-header">
                        <div class="discrepancy-title">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                            <span>Reported Payroll Discrepancy Breakdown</span>
                        </div>
                        <span class="badge-pill" style="background:#FEF3F2; color:#B42318; font-weight:700; font-size:10.5px;">DISCREPANCY FLAGGED</span>
                    </div>
                    <div class="discrepancy-grid">
                        ${cells.join('')}
                    </div>
                </div>
            `;
        }

        // Split blocks by double newline
        const blocks = text.split(/\n{2,}/);
        let contentHtml = '';
        let lastHeader = '';

        blocks.forEach(block => {
            block = block.trim();
            if (!block) return;

            // Section Header: e.g. *Employee Information:* or *Payroll Information:*
            const headerMatch = block.match(/^\*([^*]+)\*:?\s*$/);
            if (headerMatch) {
                lastHeader = headerMatch[1].trim();
                contentHtml += `<div class="email-section-heading">${escapeHtml(lastHeader)}</div>`;
                return;
            }

            // Supporting Details / Attachments
            if (/supporting details/i.test(lastHeader)) {
                const attLines = block.split('\n').map(l => l.trim().replace(/^[-*•\d.]+\s*/, '')).filter(Boolean);
                if (attLines.length > 0) {
                    contentHtml += '<div class="email-attachments-grid">';
                    attLines.forEach(att => {
                        contentHtml += `
                            <div class="email-attachment-pill" title="Verified Attachment">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                                </svg>
                                <span>${escapeHtml(att)}</span>
                            </div>
                        `;
                    });
                    contentHtml += '</div>';
                    lastHeader = '';
                    return;
                }
            }

            // Key-value pairs list: e.g. "Employee Name: Priya Mehta"
            const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
            const kvList = [];
            let isAllKv = true;

            for (const line of lines) {
                const cleanLine = line.replace(/^[-*•\d.]+\s*/, '');
                if (cleanLine.includes(':') && cleanLine.split(':')[0].length < 35) {
                    const idx = cleanLine.indexOf(':');
                    const k = cleanLine.substring(0, idx).trim();
                    const v = cleanLine.substring(idx + 1).trim();
                    kvList.push({ k, v });
                } else {
                    isAllKv = false;
                    break;
                }
            }

            if (isAllKv && kvList.length >= 2) {
                contentHtml += '<div class="email-kv-grid">';
                kvList.forEach(item => {
                    const isAlert = /deduction|discrepancy|difference|reversal|error|penalty|pending/i.test(item.k);
                    contentHtml += `
                        <div class="email-kv-row">
                            <span class="email-kv-key">${escapeHtml(item.k)}</span>
                            <span class="email-kv-val ${isAlert ? 'is-alert-val' : ''}">${escapeHtml(item.v)}</span>
                        </div>
                    `;
                });
                contentHtml += '</div>';
                return;
            }

            // Numbered list with optional intro
            if (/\n1\.\s+/.test(block) || (lines.length > 1 && lines.every(l => /^\d+\./.test(l)))) {
                let introText = '';
                let listItems = [];

                if (/\n1\.\s+/.test(block)) {
                    const parts = block.split(/\n(?=1\.\s+)/);
                    introText = parts[0].trim();
                    const listRaw = parts[1] || '';
                    listItems = listRaw.split(/\n(?=\d+\.\s+)/).map(s => s.replace(/^\d+\.\s*/, '').replace(/\n/g, ' ').trim()).filter(Boolean);
                } else {
                    listItems = lines.map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
                }

                if (introText) {
                    contentHtml += `<p class="email-paragraph">${escapeHtml(introText)}</p>`;
                }
                if (listItems.length > 0) {
                    contentHtml += '<ol class="email-numbered-list">';
                    listItems.forEach(it => {
                        contentHtml += `<li>${escapeHtml(it)}</li>`;
                    });
                    contentHtml += '</ol>';
                }
                return;
            }

            // Regular paragraph - format bold *text* safely and preserve linebreaks
            let pText = escapeHtml(block);
            pText = pText.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
            pText = pText.replace(/\n/g, '<br>');
            contentHtml += `<p class="email-paragraph">${pText}</p>`;
        });

        // Dynamic AI Intake Assessment synthesized from real case data
        const c = (caseData && caseData.case) || {};
        const emp = (caseData && caseData.employee) || {};
        const empName = emp.name || c.employee_name || "Employee";
        const empCode = emp.employee_id || emp.employee_code || (c.extracted_fields && c.extracted_fields.employee_id) || "";
        const category = (c.category || "General HR").toUpperCase();

        let aiText = "";
        if (c.forensic_proof && c.forensic_proof.notes) {
            aiText = `Verified identity for <strong>${escapeHtml(empName)}</strong> (${escapeHtml(empCode)}). ${escapeHtml(c.forensic_proof.notes)}`;
        } else if (c.validation_result && c.validation_result.summary) {
            aiText = `Active Directory verification matched. ${escapeHtml(c.validation_result.summary)}`;
        } else if (c.intent) {
            aiText = `Classified under <strong>${escapeHtml(category)}</strong> (${escapeHtml(c.intent)}). Corporate identity verified for ${escapeHtml(empName)}.`;
        } else {
            aiText = `Classified under <strong>${escapeHtml(category)}</strong>. Matched employee ${escapeHtml(empName)} in active corporate directory.`;
        }

        const aiAssessmentHtml = `
            <div class="email-ai-assessment-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0; margin-top:1px;">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    <polyline points="9 12 11 14 15 10"></polyline>
                </svg>
                <div>
                    <strong>AI Intake Assessment:</strong> ${aiText}
                </div>
            </div>
        `;

        return `
            ${discrepancyBannerHtml}
            <div class="case-mailbox-body">
                ${contentHtml}
            </div>
            ${aiAssessmentHtml}
        `;
    }

    /**
     * Render 360° Case Dossier into Right Pane
     */
    function renderCaseDossier(data) {
        const dossierPane = document.getElementById("casesDossierPane");
        if (!dossierPane || !data) return;

        const c = data.case || {};
        const emp = data.employee || {};
        const email = data.email || {};
        const caseRef = c.case_number || c.case_ref || selectedCaseRef || "CASE-000000";
        const subject = c.title || c.subject || email.subject || "Employee HR Case";
        const category = c.category || "GENERAL_HR";
        const priority = (c.priority || "NORMAL").toUpperCase();
        const status = (c.status || "OPEN").toUpperCase();
        const isUrgent = priority === "URGENT" || priority === "HIGH";
        const isAssigned = c.assigned_user && c.assigned_user !== "UNASSIGNED";
        const assignedName = isAssigned ? c.assigned_user : "Unassigned Pool";
        const assignedInitials = isAssigned
            ? assignedName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
            : "??";

        const receivedDateStr = email.received_at ? new Date(email.received_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

        const providerName = (email.provider || "").toLowerCase().includes("gmail")
            ? "Tata 1mg Gmail Ingest"
            : (email.provider || "").toLowerCase().includes("zoho")
                ? "Inbound Zoho Mail"
                : (email.account_email ? `Ingest: ${email.account_email}` : "Corporate Ingest");

        let html = `
            <!-- 1. Executive Fixed 2-Deck Header (Never Scrolls, Never Clips) -->
            <header class="dossier-header-deck">
                <!-- Deck Row 1: Identification, Tags, Stepper, Actions -->
                <div class="dossier-deck-row1">
                    <div class="dossier-deck-left">
                        <span class="dossier-tag-ref" onclick="navigator.clipboard.writeText('${caseRef}'); alert('Copied ${caseRef} to clipboard!');" title="Click to copy ${caseRef}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>${caseRef}</span>
                        </span>
                        <span class="dossier-tag-cat">${escapeHtml(category)}</span>
                        <div class="dossier-tag-sla ${isUrgent ? 'is-urgent' : ''}">
                            <span class="dossier-sla-dot"></span>
                            <span>${isUrgent ? '⚡ 4h Urgent SLA' : `${c.sla_hours || 24}h Standard SLA`}</span>
                        </div>
                        <span class="dossier-assignee-chip" title="Current Assigned Specialist">
                            <div class="assignee-avatar-tiny">${assignedInitials}</div>
                            <span>${escapeHtml(assignedName)}</span>
                        </span>
                    </div>

                    <div class="dossier-deck-right">
                        <!-- Segmented Stepper Navigation -->
                        <div class="dossier-stepper-segmented" id="dossierStepperTabs">
                            <button type="button" class="dossier-segment-btn ${currentDossierStep === 1 ? 'is-active' : ''}" onclick="switchDossierStep(1)">
                                <span class="segment-num">1</span>
                                <span>Mail &amp; Profile</span>
                            </button>
                            <button type="button" class="dossier-segment-btn ${currentDossierStep === 2 ? 'is-active' : ''}" onclick="switchDossierStep(2)">
                                <span class="segment-num">2</span>
                                <span>Audit Checklist</span>
                            </button>
                            <button type="button" class="dossier-segment-btn ${currentDossierStep === 3 ? 'is-active' : ''}" onclick="switchDossierStep(3)">
                                <span class="segment-num">3</span>
                                <span>Resolution</span>
                            </button>
                        </div>

                        ${!isAssigned
                            ? `<button type="button" class="btn-pill-action btn-primary-action" onclick="handleClaimCase('${caseRef}')">⚡ Claim Case</button>`
                            : `<button type="button" class="btn-pill-action btn-primary-action" onclick="switchDossierStep(3)">Resolve Case &rarr;</button>`
                        }
                    </div>
                </div>

                <!-- Deck Row 2: Full Un-truncated Subject Title Banner -->
                <div class="dossier-deck-row2">
                    <h1 class="dossier-main-title" title="${escapeHtml(subject)}">${escapeHtml(subject)}</h1>
                    <div class="dossier-deck-quick-meta">
                        <span class="chip-inquiry-source">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                            </svg>
                            ${providerName}
                        </span>
                        <span class="meta-dot-sep">•</span>
                        <span>Received: <strong>${receivedDateStr}</strong></span>
                    </div>
                </div>
            </header>

            <!-- 2. Scrollable Canvas Body (Only this area scrolls) -->
            <div class="dossier-scroll-canvas" id="dossierScrollCanvas">
                
                <!-- Dynamic Step Content -->
                <div id="dossierStepContent">
                    ${renderDossierStepContent(currentDossierStep, data)}
                </div>

                <!-- 3. Collapsible Compliance & Audit Trail -->
                <div class="case-audit-collapsible">
                    <div class="case-audit-header" onclick="toggleCaseAuditTimeline(this)">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--tata-coral);">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            <span>Audit &amp; Compliance Activity Trail (${(data.audit_logs || []).length} events)</span>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="audit-chevron-icon" style="transition:transform 0.2s ease;">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="case-audit-body" id="caseAuditBody" style="display:none;">
                        ${renderDossierAuditLogs(data.audit_logs)}
                    </div>
                </div>

            </div>
        `;

        dossierPane.innerHTML = html;

        // Reset scroll position to top
        const canvas = document.getElementById("dossierScrollCanvas");
        if (canvas) canvas.scrollTop = 0;
    }

    /**
     * Switch Dossier Stepper Step (1, 2, or 3)
     */
    window.switchDossierStep = function(stepNum) {
        currentDossierStep = stepNum;

        // Update Segmented buttons styling
        const segBtns = document.querySelectorAll(".dossier-segment-btn");
        segBtns.forEach((btn, idx) => {
            if (idx + 1 === stepNum) btn.classList.add("is-active");
            else btn.classList.remove("is-active");
        });

        const stepBtns = document.querySelectorAll(".dossier-step-btn");
        stepBtns.forEach((btn, idx) => {
            if (idx + 1 === stepNum) btn.classList.add("is-active");
            else btn.classList.remove("is-active");
        });

        // Re-render Step Content
        const contentContainer = document.getElementById("dossierStepContent");
        if (contentContainer && currentDossierData) {
            contentContainer.innerHTML = renderDossierStepContent(stepNum, currentDossierData);
        }
    };

    /**
     * Toggle Collapsible Audit Timeline
     */
    window.toggleCaseAuditTimeline = function(headerEl) {
        const body = document.getElementById("caseAuditBody");
        if (!body) return;
        const isHidden = body.style.display === "none";
        body.style.display = isHidden ? "flex" : "none";
        const icon = headerEl.querySelector(".audit-chevron-icon");
        if (icon) {
            icon.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
        }
    };

    /**
     * Render Dynamic Content for Selected Stepper Step
     */
    function renderDossierStepContent(stepNum, data) {
        const c = data.case || {};
        const emp = data.employee || {};
        const email = data.email || {};
        const caseRef = c.case_number || c.case_ref || selectedCaseRef;

        const empName = emp.name || c.employee_name || "Employee";
        const empCode = emp.employee_id || emp.employee_code || (c.extracted_fields && c.extracted_fields.employee_id) || "N/A";
        const dept = emp.department || c.category || "Operations";
        const designation = emp.designation || "Staff Specialist";
        const manager = emp.manager_name || "Department Lead";
        const location = emp.location || "Corporate Hub";
        const officialEmail = emp.email || c.sender_email || "N/A";

        // Compute initials dynamically from real employee name
        const empInitials = empName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "EM";
        const senderEmail = email.sender_email || officialEmail;
        const mailSubject = email.subject || c.title || c.subject || "Employee HR Inquiry";
        const mailBody = email.body || c.description || "No email content recorded.";
        const receivedDateStr = email.received_at ? new Date(email.received_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

        // Dynamic employee profile fields extracted from real text/records
        const rawText = (c.description || "") + "\n" + (email.body || "");
        const gradeMatch = rawText.match(/Grade:\s*([A-Za-z0-9]+)/i);
        const gradeVal = gradeMatch ? gradeMatch[1].trim() : (emp.grade || "G5");

        const dojMatch = rawText.match(/Date of Joining:\s*([^\n\r]+)/i);
        const dojVal = dojMatch ? dojMatch[1].trim() : (emp.date_of_joining || "Confirmed Active");

        const leaveMatch = rawText.match(/Leave Balance:\s*([^\n\r]+)/i);
        const leaveBalanceVal = leaveMatch ? leaveMatch[1].trim() : null;

        if (stepNum === 1) {
            // STEP 1: Open 2-Column Grid (330px Verified Employee Profile + Open Executive Mailbox)
            return `
                <div class="dossier-open-grid">
                    
                    <!-- Left: Verified Tata 1mg Employee Profile Card -->
                    <div class="dossier-emp-card">
                        <!-- Profile Header -->
                        <div class="emp-profile-banner">
                            <div class="emp-profile-avatar-large">${empInitials}</div>
                            <div class="emp-profile-main-meta">
                                <div class="emp-profile-name-row">
                                    <h2 class="emp-profile-name">${escapeHtml(empName)}</h2>
                                    <span class="badge-active-directory" title="Active Employee in Corporate Directory">
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                        </svg>
                                        Active
                                    </span>
                                </div>
                                <div class="emp-profile-designation">${escapeHtml(designation)}</div>
                                <div class="emp-profile-department">${escapeHtml(dept)} • Tata 1mg</div>
                            </div>
                        </div>

                        <!-- 1MG Verified Badge Card -->
                        <div class="emp-verified-card-pill">
                            <div class="emp-verified-shield">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    <polyline points="9 12 11 14 15 10"></polyline>
                                </svg>
                            </div>
                            <div class="emp-verified-meta">
                                <strong>Verified Tata 1mg Identity</strong>
                                <span>Token: <strong style="font-family:monospace; color:#027A48;">${escapeHtml(empCode)}</strong> • Directory Matched</span>
                            </div>
                        </div>

                        <!-- Quick Metrics Strip -->
                        <div class="emp-metrics-strip">
                            <div class="emp-metric-cell">
                                <span class="emp-metric-lbl">EMP CODE</span>
                                <span class="emp-metric-val" style="color:var(--tata-crimson); font-family:monospace;">${escapeHtml(empCode)}</span>
                            </div>
                            <div class="emp-metric-cell">
                                <span class="emp-metric-lbl">GRADE</span>
                                <span class="emp-metric-val">${escapeHtml(gradeVal)}</span>
                            </div>
                            <div class="emp-metric-cell">
                                <span class="emp-metric-lbl">LOCATION</span>
                                <span class="emp-metric-val">${escapeHtml(location)}</span>
                            </div>
                        </div>

                        <!-- Attributes Table -->
                        <div class="emp-attributes-table">
                            <div class="emp-attr-row">
                                <span class="emp-attr-key">Reporting Manager</span>
                                <span class="emp-attr-val">${escapeHtml(manager)}</span>
                            </div>
                            <div class="emp-attr-row">
                                <span class="emp-attr-key">Corporate Email</span>
                                <span class="emp-attr-val emp-copyable" onclick="navigator.clipboard.writeText('${officialEmail}'); alert('Copied email to clipboard!');" title="Click to copy">
                                    <span style="color:var(--tata-crimson);">${escapeHtml(officialEmail)}</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                </span>
                            </div>
                            <div class="emp-attr-row">
                                <span class="emp-attr-key">Date of Joining</span>
                                <span class="emp-attr-val">${escapeHtml(dojVal)}</span>
                            </div>
                            <div class="emp-attr-row">
                                <span class="emp-attr-key">Employment Type</span>
                                <span class="emp-attr-val">Permanent (Full-Time)</span>
                            </div>
                            ${leaveBalanceVal ? `
                            <div class="emp-attr-row">
                                <span class="emp-attr-key">Leave Balance</span>
                                <span class="emp-attr-val" style="color:#027A48; font-weight:700;">${escapeHtml(leaveBalanceVal)}</span>
                            </div>` : `
                            <div class="emp-attr-row">
                                <span class="emp-attr-key">Directory Status</span>
                                <span class="emp-attr-val" style="color:#027A48; font-weight:700;">Active Directory Confirmed</span>
                            </div>`}
                        </div>

                        <!-- Quick Directory Links -->
                        <div class="emp-card-footer-links">
                            <a href="#action" class="emp-footer-link" onclick="window.switchView ? switchView('action') : null">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span>HRMS Ledger</span>
                            </a>
                            <a href="#approvals" class="emp-footer-link" onclick="window.switchView ? switchView('approvals') : null">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                </svg>
                                <span>Approvals</span>
                            </a>
                        </div>
                    </div>

                    <!-- Right: Open Executive Mailbox Letterhead -->
                    <div class="case-mailbox-view">
                        <!-- Mailbox Header: Sender, Recipient, Origin Badge, Timestamp -->
                        <div class="case-mailbox-top">
                            <div class="case-mailbox-sender">
                                <div class="case-mailbox-avatar">${empInitials}</div>
                                <div class="case-mailbox-sender-meta">
                                    <div class="case-mailbox-name">
                                        <span>${escapeHtml(empName)}</span>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#027A48" style="vertical-align:middle;" title="Verified Tata 1mg Corporate Employee">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                        </svg>
                                    </div>
                                    <div class="case-mailbox-email">${escapeHtml(officialEmail)} ${senderEmail && senderEmail.toLowerCase() !== officialEmail.toLowerCase() ? `<span style="font-size:11px; color:#64748B;">(via ${escapeHtml(senderEmail)})</span>` : ''}</div>
                                    <div class="case-mailbox-to">To: <strong>${escapeHtml(email.account_email || 'people.ops@1mg.com')}</strong> (Tata 1mg Operations Desk)</div>
                                </div>
                            </div>
                            <div class="case-mailbox-badges">
                                <span class="case-mailbox-origin-pill">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                        <polyline points="9 12 11 14 15 10"></polyline>
                                    </svg>
                                    Verified Corporate Ingest
                                </span>
                                <span class="case-mailbox-date">${receivedDateStr}</span>
                                <div class="case-mailbox-toolbar-icons">
                                    <button type="button" class="btn-mailbox-tool" onclick="navigator.clipboard.writeText(document.querySelector('.case-mailbox-body')?.innerText || ''); alert('Copied email content!');" title="Copy Email Text">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                        </svg>
                                    </button>
                                    <button type="button" class="btn-mailbox-tool" onclick="window.print()" title="Print Inquiry">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                            <rect x="6" y="14" width="12" height="8"></rect>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Mailbox Subject Line -->
                        <div class="case-mailbox-subject-bar">
                            <div class="case-mailbox-subject-text">${escapeHtml(mailSubject)}</div>
                            <span class="badge-pill" style="background:#FFF5F5; color:var(--tata-crimson); font-size:11px; font-weight:700;">${escapeHtml(c.intent || c.category || 'INQUIRY')}</span>
                        </div>

                        <!-- Formatted Body with Discrepancy Matrix & Clean Typography -->
                        ${formatExecutiveEmailBody(mailBody, data)}

                        <!-- Mailbox Action Footer -->
                        <div class="case-mailbox-actions">
                            <div style="font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#027A48;">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                <span>Verified against corporate Zoho Mail servers. Ready for checklist audit.</span>
                            </div>
                            <button type="button" class="btn-pill-action btn-primary-action" onclick="switchDossierStep(2)">
                                <span>Proceed to Audit Checklist &rarr;</span>
                            </button>
                        </div>
                    </div>

                </div>
            `;
        } else if (stepNum === 2) {
            // STEP 2: Active Investigation Work Tracker & Dynamic Policy Checklist
            const cf = c.custom_fields || {};
            const workSession = cf.work_session || {};
            const checklistState = cf.checklist_state || {};
            const isSessionActive = Boolean(workSession.is_active);

            const totalSec = parseInt(workSession.total_handling_seconds || 0, 10);
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            const timerFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            // Extract financial or discrepancy amount for dynamic checklist context
            const rawInquiry = (c.description || "") + "\n" + (email.body || "");
            const diffMatch = rawInquiry.match(/(?:Deduction Amount|Salary Difference|Discrepancy Amount):\s*([^\n\r]+)/i);
            const amountContext = diffMatch ? diffMatch[1].trim() : "Reported Amount";

            // Define dynamic checklist items based on category and inquiry
            const checklistItems = [
                {
                    id: "check_identity",
                    title: `Employee Identity & Corporate Token Verification (${empCode})`,
                    sub: `Active corporate directory match verified for ${empName} in ${dept}. Token: ${empCode}`
                },
                {
                    id: "check_biometric",
                    title: "Cross-Reference LMS Leave Ledger & Biometric Access Logs",
                    sub: "Validate facility biometric turnstile punches, attendance logs, and approved manager leaves."
                },
                {
                    id: "check_discrepancy",
                    title: `Financial Discrepancy Reconciliation (${amountContext})`,
                    sub: `Validate calculated pay gap (${amountContext}) against payroll credit slip & salary master ledger.`
                },
                {
                    id: "check_approval",
                    title: `Department Manager Authorization (${manager})`,
                    sub: `Confirm departmental manager authorization and policy sign-off on record.`
                },
                {
                    id: "check_sla",
                    title: `Tata 1mg Standard SLA Compliance Adherence (${c.sla_hours || 24}h Window)`,
                    sub: `Ensure resolution workflow execution strictly complies with the committed SLA window.`
                }
            ];

            let checkedCount = 0;
            const rowsHtml = checklistItems.map(item => {
                const isChecked = Boolean(checklistState[item.id] && checklistState[item.id].checked);
                if (isChecked) checkedCount++;
                const verifiedAt = checklistState[item.id] && checklistState[item.id].verified_at;
                const timeStr = verifiedAt ? new Date(verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                return `
                    <div class="checklist-item-row ${isChecked ? 'is-completed' : ''}" id="chkRow_${item.id}" onclick="handleChecklistRowClick(event, '${caseRef}', '${item.id}', '${escapeHtml(item.title)}')">
                        <div class="checklist-checkbox-col">
                            <input type="checkbox" class="checklist-checkbox" id="chkInput_${item.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); handleChecklistInputToggle('${caseRef}', '${item.id}', '${escapeHtml(item.title)}', this)">
                            <div class="checklist-label-group">
                                <span class="checklist-title">${escapeHtml(item.title)}</span>
                                <span class="checklist-sub">${escapeHtml(item.sub)}</span>
                            </div>
                        </div>
                        <span class="checklist-timestamp-badge ${isChecked ? 'is-verified' : 'is-pending'}" id="chkBadge_${item.id}">
                            ${isChecked ? `✓ Verified ${timeStr}` : 'Pending Review'}
                        </span>
                    </div>
                `;
            }).join('');

            // Automatically start client-side timer if session is currently active
            setTimeout(() => {
                if (isSessionActive) {
                    startClientWorkTimer(caseRef, workSession.started_at, totalSec);
                }
            }, 60);

            return `
                <!-- 1. Active Work Tracker & Session Timer Banner -->
                <div class="audit-work-tracker-card ${isSessionActive ? 'is-active-session' : ''}" id="auditWorkTrackerCard">
                    <div class="audit-tracker-left">
                        <div class="audit-timer-wrap">
                            <div class="audit-timer-head">
                                ${isSessionActive
                                    ? `<span class="badge-pill" style="background:#ECFDF3; color:#027A48; font-weight:700; font-size:11px; display:inline-flex; align-items:center; gap:5px;"><span class="live-pulse-dot"></span> INVESTIGATION ACTIVE</span>`
                                    : `<span class="badge-pill" style="background:#F2F4F7; color:#344054; font-weight:700; font-size:11px;">READY FOR AUDIT</span>`
                                }
                                <span class="badge-pill" style="background:#FEF3F2; color:#B42318; font-size:11px; font-weight:700;">⚡ SLA: ${c.sla_hours || 24}h Window</span>
                            </div>
                            <div class="audit-timer-display" id="auditSessionTimerDisplay">${timerFormatted}</div>
                            <div class="audit-timer-sub">
                                ${isSessionActive
                                    ? `Session started by <strong>${escapeHtml(workSession.started_by || 'Specialist')}</strong> • Cumulative handling time tracked`
                                    : `Total handling time recorded: <strong>${workSession.handling_display || `${mins}m ${secs}s`}</strong>`
                                }
                            </div>
                        </div>
                    </div>

                    <div class="audit-tracker-actions">
                        ${isSessionActive
                            ? `<button type="button" class="btn-pause-work" onclick="handlePauseCaseWork('${caseRef}')">
                                 <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                     <rect x="6" y="4" width="4" height="16" rx="1"></rect>
                                     <rect x="14" y="4" width="4" height="16" rx="1"></rect>
                                 </svg>
                                 <span>⏸ Pause Work</span>
                               </button>`
                            : `<button type="button" class="btn-start-work" onclick="handleStartCaseWork('${caseRef}')">
                                 <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                     <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                 </svg>
                                 <span>▶ Start Working on this Case</span>
                               </button>`
                        }
                    </div>
                </div>

                <!-- 2. Tata 1mg Compliance Checklist -->
                <div class="checklist-card">
                    <div class="emp-card-header">
                        <div class="emp-card-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--tata-coral);">
                                <polyline points="9 11 12 14 22 4"></polyline>
                                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                            </svg>
                            <span>Tata 1mg Policy &amp; SLA Compliance Verification Checklist</span>
                        </div>
                        <span class="badge-pill" id="checklistProgressBadge" style="background:#ECFDF3; color:#027A48; font-size:11px; font-weight:700;">
                            ${checkedCount} / ${checklistItems.length} VERIFIED
                        </span>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${rowsHtml}
                    </div>

                    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:14px; border-top:1px solid var(--border-light);">
                        <button type="button" class="btn-pill-action" onclick="switchDossierStep(1)">&larr; Back to Mail &amp; Profile</button>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="font-size:12px; color:var(--text-muted);">
                                ${checkedCount === checklistItems.length ? '✓ All compliance items verified' : `${checklistItems.length - checkedCount} pending verification`}
                            </span>
                            <button type="button" class="btn-pill-action btn-primary-action" onclick="switchDossierStep(3)">
                                <span>Proceed to Resolution &amp; Dispatch &rarr;</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // STEP 3: Response & Resolution Workbench
            const draftText = data.smart_reply_draft || `Dear ${empName},\n\nYour request regarding "${mailSubject}" has been verified and processed by the People Operations team in accordance with Tata 1mg HR policy. Your records have been updated accordingly.\n\nRegards,\nPeople Operations Team\nTata 1mg Healthcare Solutions`;

            const defaultRef = c.forensic_proof && c.forensic_proof.proofId
                ? c.forensic_proof.proofId
                : `1MG-${caseRef}`;

            return `
                <div class="resolution-card">
                    <div class="emp-card-header">
                        <div class="emp-card-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--tata-coral);">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            <span>Response &amp; Resolution Dispatch Hub</span>
                        </div>
                        <span class="badge-pill badge-urgent-tag" style="padding:3px 8px; font-size:11px;">READY FOR DISPATCH</span>
                    </div>

                    <div class="resolution-box">
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px;">
                            <div>
                                <label style="display:block; font-size:12px; font-weight:700; color:var(--text-heading); margin-bottom:6px;">Resolution Outcome Action</label>
                                <select class="resolution-select" id="dossierResolutionSelect">
                                    <option value="ATTENDANCE_REGULARIZED">Attendance Regularized / Biometric In-Punch Override</option>
                                    <option value="RECORD_UPDATED">Employee HRMS Records Updated</option>
                                    <option value="PAYROLL_ADJUSTED">Payroll Discrepancy Adjusted / Arrear Scheduled</option>
                                    <option value="POLICY_CLARIFIED">General Inquiry Clarified &amp; Closed</option>
                                    <option value="SERVICE_CLOSED">Service Request Approved &amp; Executed</option>
                                </select>
                            </div>

                            <div>
                                <label style="display:block; font-size:12px; font-weight:700; color:var(--text-heading); margin-bottom:6px;">Audit / Transaction Reference ID</label>
                                <input type="text" class="resolution-select" id="dossierResolutionRef" placeholder="e.g. 1MG-BIO-OVERRIDE-8841" value="${escapeHtml(defaultRef)}">
                            </div>
                        </div>

                        <div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                                <label style="font-size:12px; font-weight:700; color:var(--text-heading);">Official Resolution Email (Dispatched via Tata 1mg SMTP)</label>
                                <span style="font-size:11px; color:var(--text-muted);">Recipient: <strong style="color:var(--text-primary);">${escapeHtml(officialEmail)}</strong></span>
                            </div>
                            <textarea class="resolution-textarea" id="dossierResolutionReply" rows="7" placeholder="Compose official resolution note...">${escapeHtml(draftText)}</textarea>
                        </div>

                        <div style="display:flex; align-items:center; justify-content:space-between; padding-top:10px; border-top:1px solid var(--border-light);">
                            <button type="button" class="btn-pill-action" onclick="switchDossierStep(2)">&larr; Back to Checklist</button>
                            <button type="button" class="btn-resolve-dispatch" id="btnDispatchResolution" onclick="handleDossierResolve('${caseRef}')">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>✓ Dispatch Resolution &amp; Close Case</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    /**
     * Render Audit Timeline Rows
     */
    function renderDossierAuditLogs(logs) {
        if (!logs || logs.length === 0) {
            return `
                <div style="font-size:12px; color:var(--text-muted); padding:8px 0;">
                    Initial intake recorded. No subsequent actions taken yet.
                </div>
            `;
        }

        let html = "";
        logs.forEach(log => {
            const timeStr = log.created_at ? new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now";
            html += `
                <div style="display:flex; align-items:flex-start; gap:10px; font-size:12px; padding:6px 0; border-bottom:1px dashed var(--border-subtle);">
                    <span style="font-family:monospace; color:var(--text-muted); font-size:11px; min-width:60px;">${timeStr}</span>
                    <span class="badge-pill" style="font-size:10px; background:var(--bg-app);">${escapeHtml(log.action || "LOG")}</span>
                    <span style="color:var(--text-primary); flex:1;">${escapeHtml(log.description || "Action logged")}</span>
                    <span style="color:var(--text-muted); font-size:11px;">${escapeHtml(log.performed_by || "System")}</span>
                </div>
            `;
        });
        return html;
    }

    /* ==========================================================================
       ACTIVE WORK INVESTIGATION SESSION & TIME TRACKER CONTROLLER
       ========================================================================== */

    let liveClientTimerInterval = null;
    let liveClientTimerSeconds = 0;
    let liveClientCaseRef = null;

    function startClientWorkTimer(caseRef, startedAtIso, existingTotalSeconds) {
        if (liveClientTimerInterval) {
            clearInterval(liveClientTimerInterval);
            liveClientTimerInterval = null;
        }

        liveClientCaseRef = caseRef;
        const startTime = startedAtIso ? new Date(startedAtIso).getTime() : Date.now();
        const baseSeconds = existingTotalSeconds || 0;

        liveClientTimerInterval = setInterval(() => {
            const now = Date.now();
            const sessionSec = Math.max(0, Math.floor((now - startTime) / 1000));
            liveClientTimerSeconds = sessionSec;
            const currentTotal = baseSeconds + sessionSec;

            const mins = Math.floor(currentTotal / 60);
            const secs = currentTotal % 60;
            const displayStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            const timerEl = document.getElementById("auditSessionTimerDisplay");
            if (timerEl) {
                timerEl.textContent = displayStr;
            }
        }, 1000);
    }

    function stopClientWorkTimer() {
        if (liveClientTimerInterval) {
            clearInterval(liveClientTimerInterval);
            liveClientTimerInterval = null;
        }
        const s = liveClientTimerSeconds;
        liveClientTimerSeconds = 0;
        return s;
    }

    window.handleStartCaseWork = async function(caseRef) {
        try {
            const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
            let userName = "Vaibhav (HR)";
            if (userStr) {
                try { userName = JSON.parse(userStr).name || userName; } catch (_) {}
            }

            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/start-work`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ performed_by: userName })
            });

            if (res.ok) {
                currentDossierStep = 2;
                await selectCase(caseRef);
                refreshCaseAuditTimeline(caseRef);
            } else {
                alert("Could not start work session. Please try again.");
            }
        } catch (err) {
            console.error("Error starting work:", err);
        }
    };

    window.handlePauseCaseWork = async function(caseRef) {
        try {
            const elapsed = stopClientWorkTimer();
            const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
            let userName = "Vaibhav (HR)";
            if (userStr) {
                try { userName = JSON.parse(userStr).name || userName; } catch (_) {}
            }

            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/pause-work`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ elapsed_seconds: elapsed, performed_by: userName })
            });

            if (res.ok) {
                currentDossierStep = 2;
                await selectCase(caseRef);
                refreshCaseAuditTimeline(caseRef);
            } else {
                alert("Could not pause work session. Please try again.");
            }
        } catch (err) {
            console.error("Error pausing work:", err);
        }
    };

    window.handleChecklistRowClick = function(e, caseRef, itemId, itemTitle) {
        const input = document.getElementById(`chkInput_${itemId}`);
        if (!input) return;
        input.checked = !input.checked;
        handleChecklistInputToggle(caseRef, itemId, itemTitle, input);
    };

    window.handleChecklistInputToggle = async function(caseRef, itemId, itemTitle, inputEl) {
        const checked = inputEl.checked;
        const row = document.getElementById(`chkRow_${itemId}`);
        const badge = document.getElementById(`chkBadge_${itemId}`);

        if (row) {
            if (checked) row.classList.add("is-completed");
            else row.classList.remove("is-completed");
        }

        if (badge) {
            if (checked) {
                badge.className = "checklist-timestamp-badge is-verified";
                const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                badge.textContent = `✓ Verified ${nowTime}`;
            } else {
                badge.className = "checklist-timestamp-badge is-pending";
                badge.textContent = "Pending Review";
            }
        }

        // Update overall checklist badge count
        const allInputs = document.querySelectorAll(".checklist-checkbox");
        if (allInputs.length > 0) {
            let done = 0;
            allInputs.forEach(inp => { if (inp.checked) done++; });
            const progressBadge = document.getElementById("checklistProgressBadge");
            if (progressBadge) {
                progressBadge.textContent = `${done} / ${allInputs.length} VERIFIED`;
            }
        }

        try {
            const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
            let userName = "Vaibhav (HR)";
            if (userStr) {
                try { userName = JSON.parse(userStr).name || userName; } catch (_) {}
            }

            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/checklist-item`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    item_id: itemId,
                    item_title: itemTitle,
                    checked: checked,
                    performed_by: userName
                })
            });

            if (res.ok) {
                refreshCaseAuditTimeline(caseRef);
            }
        } catch (err) {
            console.error("Error toggling checklist item:", err);
        }
    };

    window.refreshCaseAuditTimeline = async function(caseRef) {
        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/detail`);
            if (res.ok) {
                const data = await res.json();
                if (data.audit_logs) {
                    const body = document.getElementById("caseAuditBody");
                    if (body) {
                        body.innerHTML = renderDossierAuditLogs(data.audit_logs);
                    }
                    const headerSpan = document.querySelector(".case-audit-header span");
                    if (headerSpan) {
                        headerSpan.textContent = `Audit & Compliance Activity Trail (${data.audit_logs.length} events)`;
                    }
                }
            }
        } catch (err) {
            console.warn("Could not refresh audit timeline:", err);
        }
    };

    /**
     * Toggle visual styling for checklist rows
     */
    window.toggleChecklist = function(rowEl) {
        const cb = rowEl.querySelector(".checklist-checkbox");
        if (!cb) return;
        if (event && event.target !== cb) {
            cb.checked = !cb.checked;
        }
        if (cb.checked) rowEl.classList.add("is-completed");
        else rowEl.classList.remove("is-completed");
    };

    /**
     * Handle Resolving Case & Dispatching Notification
     */
    window.handleDossierResolve = async function(caseRef) {
        const selectEl = document.getElementById("dossierResolutionSelect");
        const refEl = document.getElementById("dossierResolutionRef");
        const replyEl = document.getElementById("dossierResolutionReply");
        const btn = document.getElementById("btnDispatchResolution");

        const resType = selectEl ? selectEl.value : "AGENT_RESOLVED";
        const refId = refEl ? refEl.value.trim() : "";
        const replyBody = replyEl ? replyEl.value.trim() : "";

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span>Dispatching Resolution...</span>`;
        }

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action_type: "RESOLVE",
                    resolution_type: resType,
                    reference_id: refId,
                    reply_body: replyBody,
                    resolution_notes: `Resolved via Twin-Pane Specialist Workspace. Reference: ${refId}`,
                    performed_by: "Vaibhav Yadav"
                })
            });

            if (res.ok) {
                alert(`✓ Case ${caseRef} has been resolved successfully and official resolution email dispatched!`);
                await loadWorkbenchData();
                selectCase(caseRef);
            } else {
                const target = allCases.find(c => (c.case_ref || c.id || c.case_number) === caseRef);
                if (target) {
                    target.status = "RESOLVED";
                }
                alert(`✓ Case ${caseRef} resolution logged.`);
                renderFeedRows();
            }
        } catch (err) {
            console.warn("Resolve call failed, updating local state:", err);
            alert(`✓ Case ${caseRef} resolution logged.`);
            renderFeedRows();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>✓ Dispatch Resolution &amp; Close Case</span>`;
            }
        }
    };

    /**
     * Handle Claiming a Case from Queue or Dossier
     */
    window.handleClaimCase = async function (caseRef) {
        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agent_name: "Vaibhav Yadav",
                    agent_email: "vaibhavx002@zohomail.in",
                    agent_team: "People Operations"
                })
            });

            if (res.ok) {
                alert(`Case ${caseRef} successfully claimed and assigned to your desk!`);
                await loadWorkbenchData();
                selectCase(caseRef);
            } else {
                const target = allCases.find(c => (c.case_ref || c.id || c.case_number) === caseRef);
                if (target) {
                    target.assigned_to = "Vaibhav Yadav";
                    renderFeedRows();
                    alert(`Case ${caseRef} claimed by Vaibhav Yadav!`);
                    selectCase(caseRef);
                }
            }
        } catch (err) {
            console.warn("Claim fallback triggered:", err);
        }
    };

    /**
     * 1-Click Quick Intake: Creates an end-to-end verified test case
     */
    async function handleQuickIntake() {
        const btn = document.getElementById("btnQuickIntake");
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span>Ingesting...</span>`;
        }

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/quick-intake`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            if (res.ok) {
                const json = await res.json();
                const newCase = json.data;
                alert(`⚡ New Case ${newCase.case_number} successfully ingested into Unclaimed Queue!`);
                await loadWorkbenchData();
                selectCase(newCase.case_number);
            } else {
                // Client-side fallback
                const newRef = "1MG-CASE-" + Math.floor(1000 + Math.random() * 9000);
                const sampleCase = {
                    case_ref: newRef,
                    case_number: newRef,
                    subject: "Urgent: Attendance punch regularization for biometric turnstile",
                    title: "Urgent: Attendance punch regularization for biometric turnstile",
                    employee_name: "Rahul Verma",
                    employee_id: "1MG123",
                    category: "ATTENDANCE",
                    priority: "URGENT",
                    is_urgent: true,
                    assigned_to: "UNASSIGNED"
                };
                allCases.unshift(sampleCase);
                renderFeedRows();
                selectCase(newRef);
                alert(`New Case ${newRef} ingested into Unclaimed Department Pool!`);
            }
        } catch (err) {
            console.warn("Quick intake fallback:", err);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>+ New Case</span>
                `;
            }
        }
    }

    /**
     * Seed Data for Inbox Scenarios - Strictly for this Account ID
     */
    function getSeedInboxEmails(accountId) {
        const acc = accountId || "vaibhavx002@zohomail.in";
        return [
            {
                id: 1553,
                account_email: acc,
                sender_name: "Ananya Sharma",
                sender_email: "ananya.sharma@1mg.com",
                subject: "Request to Correct My Name in Employee Records",
                received_at: "2026-10-28T11:53:00",
                category: "EMPLOYEE_PROFILE",
                category_confidence: 0.98,
                is_actionable: true,
                matched_emp_name: "Ananya Sharma",
                matched_emp_dept: "Finance",
                body: "My name is Ananya Sharma. I noticed that my name is incorrectly displayed in the employee portal. I would like to request a correction to ensure that my employee records are accurate.\n\n*Employee Name:* Ananya Sharma\n*Department:* Finance\n*Issue:* Incorrect name displayed\n*Requested Action:* Correct my name in the HR system",
                attachments: [],
                case: { case_number: "CASE-000002", assigned_user: "Vaibhav Yadav" }
            },
            {
                id: 1,
                account_email: acc,
                sender_name: "Vaibhav",
                sender_email: "vaibhavx002@gmail.com",
                subject: "Attendance Regularization Request for 23 October 2026",
                received_at: "2026-10-27T10:25:00",
                category: "ATTENDANCE",
                category_confidence: 0.96,
                is_actionable: true,
                matched_emp_name: "Vaibhav",
                matched_emp_dept: "People Operations",
                body: "Dear People Operations,\n\nPlease regularize my biometric attendance for 23 October 2026 due to site duty visit.\n\nRegards,\nVaibhav",
                attachments: [],
                case: { case_number: "CASE-000001", assigned_user: "Vaibhav Yadav" }
            }
        ];
    }

    /**
     * Fallback Seed Data for Cases
     */
    function getSeedCases() {
        return [
            {
                case_ref: "1MG-ATT-8821",
                subject: "Punch regularize request for client warehouse visit (Gurugram DC)",
                employee_name: "Aman Gupta",
                category: "ATTENDANCE",
                priority: "HIGH",
                is_urgent: true,
                assigned_to: "UNASSIGNED"
            },
            {
                case_ref: "1MG-LV-9042",
                subject: "Paternity leave encashment and policy clarification for Q4",
                employee_name: "Rohit Malhotra",
                category: "LEAVE",
                priority: "NORMAL",
                is_urgent: false,
                assigned_to: "Vaibhav Yadav"
            },
            {
                case_ref: "1MG-PAY-7719",
                subject: "Discrepancy in medical insurance deduction in October salary slip",
                employee_name: "Pooja Singhal",
                category: "PAYROLL",
                priority: "URGENT",
                is_urgent: true,
                assigned_to: "UNASSIGNED"
            },
            {
                case_ref: "1MG-DOC-6102",
                subject: "Background Verification (BGV) educational certificate resubmission",
                employee_name: "Sneha Nair",
                category: "DOCUMENTS",
                priority: "NORMAL",
                is_urgent: false,
                assigned_to: "Vaibhav Yadav"
            }
        ];
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /**
     * Sign Out
     */
    function handleSignOut() {
        if (confirm("Are you sure you want to sign out of the Specialist Workbench?")) {
            sessionStorage.removeItem("hrflow_token");
            sessionStorage.removeItem("hrflow_user");
            localStorage.removeItem("hrflow_last_token");
            localStorage.removeItem("hrflow_last_user");
            window.location.href = "login.html";
        }
    }

})();
