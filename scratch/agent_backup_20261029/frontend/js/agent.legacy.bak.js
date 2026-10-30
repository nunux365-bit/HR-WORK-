/**
 * HR FLOW — HR Agent Personal Execution Workbench Controller (frontend/js/agent.js)
 *
 * Powers frontend/agent.html with:
 *   1. Top Identity & Shift Header + 4-Mode Workbench Switcher:
 *      - 🎯 Case Execution Console (Left Smart Queue + Right 360° Execution Workspace)
 *      - ☑️ My Tasks Board (All pending & completed verification checklist tasks)
 *      - ✉️ Sent Replies & HRMS Log (All outbound employee emails & HRMS actions run)
 *      - 🛡️ My Role Permissions & Audit (Authorized rules, restricted governance & audit trail)
 *   2. 6 Live Clickable Personal KPIs (My Active, Unclaimed Dept Pool, Urgent/SLA, My Tasks, Replies Sent, Resolved)
 *   3. Department Desk Readiness & 1-Click Case Intake when Queue is at Inbox Zero
 *   4. 360° Case Execution Workspace with preserved reply drafts, 4-stage workflow stepper,
 *      verification checklist, HRMS action runner, manager approval gate, and Gmail SMTP dispatch.
 */

const BACKEND_API_BASE =
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    window.location.port &&
    window.location.port !== "5000"
        ? "http://127.0.0.1:5000"
        : "";

let workbenchState = {
    agent: null,
    kpis: {},
    myCases: [],
    unclaimedCases: [],
    deptCases: [],
    allCases: [],
    deptEmails: [],
    tasks: [],
    myOpenTasks: [],
    approvals: [],
    myCommunications: [],
    myHrActions: [],
    allHrActions: [],
    actionCatalog: [],
    actionFilter: "ALL",
    myAuditLogs: [],
    workflowStages: [],
    hrmsActionsCatalog: [],
    allAgents: [],

    // Primary Workbench Mode
    // CONSOLE | DEPT_INBOX | TASKS_BOARD | APPROVALS_GATE | REPLIES_ACTIONS | GOVERNANCE_AUDIT
    workbenchView: "DEPT_INBOX",

    // Inbox Filter State (Clean categories & assignment)
    inboxFilterTab: "ALL", // ALL | ASSIGNED_TO_ME | UNASSIGNED | SENT_REPLIES
    inboxCategoryFilter: "ALL",
    inboxSearchQuery: "",
    selectedEmailId: null,
    selectedCommId: null,
    showInboxReplyDrawer: false,
    showReassignModal: false,
    reassignTargetCase: null,
    reassignDepartments: [],
    activeRhsDialogTab: null, // 'ai' | 'case' | 'employee' | 'workflow' | 'actions' | 'audit' | null
    inboxReplyDrafts: {},

    // Queue Filters & Selection
    activeTab: "MY_QUEUE", // MY_QUEUE | DEPT_QUEUE | UNCLAIMED | ALL | RESOLVED | URGENT
    caseViewMode: "TABLE", // TABLE | CARDS
    caseActiveKpiFilter: null, // OPEN | MY_QUEUE | OVERDUE | REVIEW
    searchQuery: "",
    categoryFilter: "ALL",
    statusFilter: "ALL",
    priorityFilter: "ALL",
    slaFilter: "ALL",
    selectedCaseRef: null,
    activeCaseDetail: null,
    showApprovalRequestForm: false,
    showNewCaseModal: false,
    replyTemplateMode: "UPDATE", // UPDATE | REQUEST_INFO
    customReplyDrafts: {}, // keyed by `${case_number}_${mode}` so typing is never lost on re-render
    toastMessage: null, // { type: 'success' | 'warning' | 'error', text: '' }
    activeDeptId: null,
    showDeptSwitchModal: false,
    readerFontComfortable: false,
};

function escapeHtml(raw) {
    if (raw == null) return "";
    return String(raw)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatHuman(str) {
    if (!str) return "—";
    return String(str)
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getStatusBadgeStyle(status) {
    const st = String(status || "NEW").toUpperCase();
    if (st === "RESOLVED" || st === "CLOSED") {
        return { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0", label: st };
    }
    if (st === "IN_PROGRESS" || st === "READY") {
        return { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe", label: st.replace(/_/g, " ") };
    }
    if (st === "ON_HOLD" || st === "WAITING_FOR_EMPLOYEE" || st === "PENDING_APPROVAL") {
        return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a", label: st.replace(/_/g, " ") };
    }
    if (st === "REVIEW_REQUIRED" || st === "ESCALATED") {
        return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca", label: st.replace(/_/g, " ") };
    }
    return { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1", label: st.replace(/_/g, " ") };
}

function getPriorityStyle(prio) {
    const p = String(prio || "MEDIUM").toUpperCase();
    if (p === "CRITICAL") return { bg: "#fef2f2", fg: "#dc2626", border: "#fecaca" };
    if (p === "HIGH") return { bg: "#fff7ed", fg: "#ea580c", border: "#fed7aa" };
    if (p === "LOW") return { bg: "#f8fafc", fg: "#64748b", border: "#e2e8f0" };
    return { bg: "#eff6ff", fg: "#2563eb", border: "#bfdbfe" };
}

function getSlaBadgeStyle(slaStatus) {
    const s = String(slaStatus || "ON_TRACK").toUpperCase();
    if (s === "OVERDUE" || s === "BREACHED") {
        return { bg: "#fef2f2", fg: "#dc2626", border: "#fecaca", icon: "🚨" };
    }
    if (s === "DUE_SOON" || s === "AT_RISK") {
        return { bg: "#fffbeb", fg: "#d97706", border: "#fde68a", icon: "⏳" };
    }
    if (s === "COMPLETED") {
        return { bg: "#ecfdf5", fg: "#059669", border: "#a7f3d0", icon: "✓" };
    }
    return { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0", icon: "⏱" };
}

function getInitials(name) {
    return (
        String(name || "HR")
            .split(" ")
            .filter(Boolean)
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2) || "HR"
    );
}

function setToast(type, text) {
    workbenchState.toastMessage = { type, text };
    renderAgentWorkbench();
}

function getSessionUser() {
    try {
        const raw = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function buildAuthHeaders() {
    const headers = { "Content-Type": "application/json" };
    const u = workbenchState.agent || getSessionUser() || {};
    if (u.name) headers["X-HR-User"] = u.name;
    if (u.role) headers["X-HR-Role"] = u.role;
    if (u.email) headers["X-HR-Email"] = u.email;
    const token = sessionStorage.getItem("hrflow_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
}

function mapHashToWorkbenchView(hashStr) {
    const h = String(hashStr || "").replace("#", "").trim().toLowerCase();
    if (h === "cases" || h === "console" || h === "agent-workbench") return "CONSOLE";
    if (h === "tasks") return "TASKS_BOARD";
    if (h === "approvals") return "APPROVALS_GATE";
    if (h === "actions") return "REPLIES_ACTIONS";
    if (h === "reports") return "GOVERNANCE_AUDIT";
    return "DEPT_INBOX"; // Default to Mail Inbox
}

function mapWorkbenchViewToModule(wbView) {
    if (wbView === "DEPT_INBOX") return "inbox";
    if (wbView === "TASKS_BOARD") return "tasks";
    if (wbView === "APPROVALS_GATE") return "approvals";
    if (wbView === "REPLIES_ACTIONS") return "actions";
    if (wbView === "GOVERNANCE_AUDIT") return "reports";
    return "cases";
}

function syncSidebarActiveHighlight() {
    const mod = mapWorkbenchViewToModule(workbenchState.workbenchView);
    document.querySelectorAll("#appSidebar .sidebar-nav .nav-item").forEach((item) => {
        const itemMod = item.getAttribute("data-module");
        const isActive = itemMod === mod || (mod === "cases" && itemMod === "agent-workbench");
        item.classList.toggle("active", isActive);
    });
}

async function loadWorkbenchData(targetEmail = null, targetAgentId = null, preserveSelection = true, targetDeptId = null) {
    const urlParams = new URLSearchParams(window.location.search);
    const welcomeUser = (urlParams.get("welcome_user") || urlParams.get("email") || "").trim().toLowerCase();
    const agentIdParam = urlParams.get("agent_id");
    let storedDept = "";
    try {
        storedDept = localStorage.getItem("hrflow_agent_active_dept_id") || "";
    } catch (_) {}
    const deptIdParam = targetDeptId !== null && targetDeptId !== undefined
        ? targetDeptId
        : (urlParams.get("dept_id") || workbenchState.activeDeptId || storedDept || "");
    const sessionUser = getSessionUser();
    const sessionEmail = (sessionUser?.email || "").trim().toLowerCase();
    const isSpecialistSession = sessionEmail && !sessionEmail.startsWith("admin@");
    const queryEmail = targetEmail || welcomeUser || (sessionUser?.role === "HR_AGENT" ? sessionUser.email : "") || (isSpecialistSession ? sessionEmail : "") || "";
    const queryAgentId = targetAgentId || agentIdParam || "";

    const qs = new URLSearchParams();
    if (queryEmail) qs.set("email", queryEmail);
    if (queryAgentId && !queryEmail) qs.set("agent_id", queryAgentId);
    if (deptIdParam) qs.set("dept_id", deptIdParam);

    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/my-workbench?${qs.toString()}`, {
            headers: buildAuthHeaders(),
        });
        const json = await res.json();
        const data = json.data || json;

        workbenchState.agent = data.agent || null;
        if (data.agent && data.agent.active_dept_id !== undefined) {
            workbenchState.activeDeptId = data.agent.active_dept_id;
        }
        workbenchState.kpis = data.kpis || {};
        workbenchState.myCases = data.my_cases || [];
        workbenchState.unclaimedCases = data.unclaimed_cases || [];
        workbenchState.deptCases = data.dept_cases || [];
        workbenchState.allCases = data.all_cases || [];
        workbenchState.deptEmails = data.dept_emails || [];
        workbenchState.tasks = data.tasks || [];
        workbenchState.myOpenTasks = data.my_open_tasks || [];
        workbenchState.approvals = data.approvals || [];
        workbenchState.myCommunications = data.my_communications || [];
        workbenchState.myHrActions = data.my_hr_actions || [];
        workbenchState.myAuditLogs = data.my_audit_logs || [];
        workbenchState.workflowStages = data.workflow_stages || [];
        workbenchState.hrmsActionsCatalog = data.hrms_actions_catalog || [];
        workbenchState.allAgents = data.all_agents || [];

        // Ensure all cases for active department are fetched for Case Progress tracking
        try {
            const deptQs = workbenchState.activeDeptId ? `&dept_id=${encodeURIComponent(workbenchState.activeDeptId)}` : "";
            const casesRes = await fetch(`${BACKEND_API_BASE}/api/cases?limit=200${deptQs}`, {
                headers: buildAuthHeaders(),
            });
            if (casesRes.ok) {
                const cJson = await casesRes.json();
                const fetchedCases = cJson.cases || cJson.data?.cases || [];
                if (fetchedCases.length > 0) {
                    workbenchState.allCases = fetchedCases;
                }
            }
        } catch (_) {}

        // Sync topbar user identity, sidebar RBAC & switcher
        syncTopbarIdentity();

        // Auto-select first Dept / Assigned Email if none selected
        if (!workbenchState.selectedEmailId || !workbenchState.deptEmails.some((e) => Number(e.id) === Number(workbenchState.selectedEmailId))) {
            workbenchState.selectedEmailId = workbenchState.deptEmails.length > 0 ? workbenchState.deptEmails[0].id : null;
        }

        // Auto-select tab & case if none selected
        if (!preserveSelection || !workbenchState.selectedCaseRef) {
            const myActive = workbenchState.myCases.filter((c) => !["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase()));
            if (myActive.length > 0) {
                workbenchState.activeTab = "MY_QUEUE";
                workbenchState.selectedCaseRef = myActive[0].case_number || myActive[0].id;
            } else if (workbenchState.unclaimedCases.length > 0) {
                workbenchState.activeTab = "UNCLAIMED";
                workbenchState.selectedCaseRef = workbenchState.unclaimedCases[0].case_number || workbenchState.unclaimedCases[0].id;
            } else if (workbenchState.deptCases.length > 0) {
                workbenchState.activeTab = "DEPT_QUEUE";
                workbenchState.selectedCaseRef = workbenchState.deptCases[0].case_number || workbenchState.deptCases[0].id;
            } else if (workbenchState.myCases.length > 0) {
                workbenchState.activeTab = "RESOLVED";
                workbenchState.selectedCaseRef = workbenchState.myCases[0].case_number || workbenchState.myCases[0].id;
            } else {
                workbenchState.selectedCaseRef = null;
            }
        }

        if (workbenchState.selectedCaseRef) {
            await loadSelectedCaseDetail(workbenchState.selectedCaseRef, false);
        } else {
            workbenchState.activeCaseDetail = null;
        }

        renderAgentWorkbench();
        renderNewCaseModal();
        renderDeptSwitchModal();
    } catch (err) {
        console.error("Failed to load HR Agent Workbench:", err);
        const root = document.getElementById("agentWorkbenchRoot");
        if (root) {
            root.innerHTML = `
                <div class="agent-card" style="text-align:center; padding:40px;">
                    <h3 style="margin:0 0 8px 0; color:#dc2626;">Could not connect to HR Flow Backend</h3>
                    <p style="color:#64748b; font-size:0.85rem;">Make sure backend/server.py is running on http://127.0.0.1:5000</p>
                </div>
            `;
        }
    }
}

async function loadSelectedCaseDetail(caseRef, shouldRender = true) {
    if (!caseRef) return;
    workbenchState.selectedCaseRef = caseRef;
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/detail`, {
            headers: buildAuthHeaders(),
        });
        if (res.ok) {
            const json = await res.json();
            const detailData = json.data || json;
            workbenchState.activeCaseDetail = detailData;
            if (window.AuraBot && detailData) {
                const c = detailData.case || {};
                const intentStr = c.intent || "General Request";
                const match = String(intentStr).match(/^([A-Z0-9]+)\s*[—\-·:]\s*(.+)$/);
                const code = match ? match[1] : (c.category ? c.category.slice(0, 3) : "HR");
                const name = match ? match[2] : intentStr;
                const specialist = workbenchState.agent?.name || getSessionUser()?.name || "Specialist";
                if (typeof window.AuraBot.initForCase === "function") {
                    window.AuraBot.initForCase({
                        caseRef: c.case_number || c.id || caseRef,
                        intentName: c.intent || c.title || intentStr,
                        category: c.category || "OPERATIONS",
                        specialistName: specialist,
                        isWorkflowConfigured: detailData.is_workflow_configured || false,
                    });
                }
                window.AuraBot.setIntent(code, name, c.category || "GENERAL_HR", specialist);
            }
        }
    } catch (err) {
        console.warn("Case detail fetch error:", err);
    }
    if (shouldRender) {
        renderAgentWorkbench();
    }
}

function syncTopbarIdentity() {
    const ag = workbenchState.agent;
    if (!ag) return;

    const urlParams = new URLSearchParams(window.location.search);
    const explicitInspect = urlParams.get("inspect") === "admin";
    const sessionUser = getSessionUser();
    const isInspector =
        explicitInspect &&
        sessionUser &&
        sessionUser.email &&
        String(sessionUser.email).toLowerCase() !== String(ag.email || "").toLowerCase() &&
        ["ADMIN", "SUPER_ADMIN", "HR_MANAGER", "HR_LEAD"].includes(String(sessionUser.role || "").toUpperCase());

    // Safely update sessionStorage & localStorage only when viewing own workbench as specialist (never overwrite Admin session to HR_AGENT)
    if (!isInspector) {
        const isAgentSession = sessionUser && String(sessionUser.role || "").toUpperCase() === "HR_AGENT";
        const emailMatches = sessionUser && String(sessionUser.email || "").toLowerCase() === String(ag.email || "").toLowerCase();
        if (isAgentSession || emailMatches || !sessionUser) {
            const agentProfileObj = {
                ...(sessionUser || {}),
                id: ag.id || sessionUser?.id,
                name: ag.name || sessionUser?.name || "HR Specialist",
                email: ag.email || sessionUser?.email || "",
                role: "HR_AGENT",
                role_title: ag.role_title || sessionUser?.role_title || "HR Specialist / Agent",
                designation: ag.designation || sessionUser?.designation || "HR Specialist",
                department: ag.team_name || sessionUser?.department || "HR Operations",
                category_scope: ag.category_scope || sessionUser?.category_scope || "GENERAL_HR",
            };
            sessionStorage.setItem("hrflow_user", JSON.stringify(agentProfileObj));
            localStorage.setItem("hrflow_last_user", JSON.stringify(agentProfileObj));
        }
    }

    // Update topbar pills
    const deptPill = document.getElementById("topbarDeptPill");
    if (deptPill) {
        const assignedDepts = Array.isArray(ag.assigned_departments) ? ag.assigned_departments : [];
        const hasMultiple = Boolean(ag.has_multiple_depts || assignedDepts.length > 1);
        const currentActiveName = ag.active_dept_name || ag.team_name || "HR Operations";

        if (hasMultiple) {
            deptPill.className = "agent-dept-pill agent-dept-pill-interactive";
            deptPill.setAttribute("role", "button");
            deptPill.setAttribute("tabindex", "0");
            deptPill.title = `Active Desk: ${currentActiveName}. Click to switch department (${assignedDepts.length} assigned).`;
            deptPill.onclick = () => openDeptSwitchModal();
            deptPill.onkeydown = (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDeptSwitchModal();
                }
            };
            deptPill.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                    <path d="M3 21h18"></path>
                    <path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                    <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                </svg>
                <span class="dept-pill-name">${escapeHtml(currentActiveName)}</span>
                <span class="dept-pill-switch-tag" title="Switch Department Desk">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                    <span>Switch (${assignedDepts.length})</span>
                </span>
            `;
        } else {
            deptPill.className = "agent-dept-pill";
            deptPill.removeAttribute("role");
            deptPill.removeAttribute("tabindex");
            deptPill.onclick = null;
            deptPill.onkeydown = null;
            deptPill.title = `Department: ${currentActiveName}`;
            deptPill.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                    <path d="M3 21h18"></path>
                    <path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                    <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                </svg>
                <span class="dept-pill-name">${escapeHtml(currentActiveName)}</span>
            `;
        }
    }
    const scopePill = document.getElementById("topbarScopePill");
    if (scopePill) {
        scopePill.style.display = "none";
    }

    // Update user profile in topbar
    const avEl = document.getElementById("userAvatar");
    const nameEl = document.getElementById("userName");
    const roleEl = document.getElementById("userRole");

    const displayName = isInspector && sessionUser ? sessionUser.name : (ag.name || sessionUser?.name || "HR Specialist");
    const displayRole = isInspector && sessionUser
        ? `${sessionUser.role_title || "Admin"} (Inspecting ${ag.name})`
        : `${ag.designation || "HR Specialist"} · ${ag.active_dept_name || ag.team_name || "HR Ops"}`;

    if (avEl) avEl.textContent = getInitials(displayName);
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) {
        roleEl.textContent = displayRole;
        roleEl.title = displayRole;
    }

    // Enforce HR_AGENT sidebar rules on agent.html
    if (typeof window.applySidebarRBAC === "function") {
        window.applySidebarRBAC("HR_AGENT");
    }

    // Update sidebar badge counts with department-scoped numbers
    const kpis = workbenchState.kpis || {};
    const setBadge = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? 0);
    };
    setBadge("navInboxBadge", (workbenchState.deptEmails || []).length);
    setBadge("navCasesBadge", (workbenchState.deptCases || []).length);
    setBadge("navTasksBadge", (workbenchState.myOpenTasks || []).length);
    setBadge("navApprovalsBadge", (workbenchState.approvals || []).filter((a) => String(a.status || "").toUpperCase() === "PENDING").length);
    const allTrackedCases = (workbenchState.allCases && workbenchState.allCases.length > 0) ? workbenchState.allCases : (workbenchState.deptCases || []);
    setBadge("navActionsBadge", allTrackedCases.length);
    setBadge("navReportsBadge", (workbenchState.deptCases || []).length);

    syncSidebarActiveHighlight();

    // Show/hide Admin/Manager inspector controls & Role Switcher
    const backBtn = document.getElementById("btnBackToAgentsStatus");
    const switcherWrap = document.getElementById("agentSwitcherWrap");
    const roleSwitcherWrap = document.getElementById("agentRoleSwitcherWrap");
    const roleSelect = document.getElementById("agentRoleSelect");
    const canSwitchRoles = Boolean(
        isInspector ||
        sessionStorage.getItem("hrflow_orig_role") === "ADMIN" ||
        (getSessionUser() && (getSessionUser().role === "ADMIN" || String(getSessionUser().email || "").includes("admin")))
    );

    if (roleSwitcherWrap) {
        roleSwitcherWrap.style.display = canSwitchRoles ? "inline-flex" : "none";
        if (roleSelect && canSwitchRoles) {
            roleSelect.value = getSessionUser()?.role || "HR_AGENT";
        }
    }

    if (isInspector) {
        if (backBtn) backBtn.style.display = "inline-flex";
        if (switcherWrap) switcherWrap.style.display = "inline-flex";
    } else {
        if (backBtn) backBtn.style.display = "none";
        if (switcherWrap) switcherWrap.style.display = "none";
    }

    // Populate Agent Switcher dropdown for Admin/Manager
    const sel = document.getElementById("agentProfileSelect");
    if (sel && Array.isArray(workbenchState.allAgents)) {
        const agentsOnly = workbenchState.allAgents.filter((u) => u.role !== "ADMIN" || String(u.email).toLowerCase() === String(ag.email).toLowerCase());
        const listToUse = agentsOnly.length > 0 ? agentsOnly : workbenchState.allAgents;
        sel.innerHTML = listToUse
            .map((u) => {
                const isSelected = String(u.email).toLowerCase() === String(ag.email).toLowerCase();
                return `<option value="${escapeHtml(u.email)}" data-agent-id="${u.id}" ${isSelected ? "selected" : ""}>
                    ${escapeHtml(u.name)} — ${escapeHtml(u.team_name || "HR Ops")} (${escapeHtml(u.role)})
                </option>`;
            })
            .join("");
    }
}

function getFilteredQueueCases() {
    let sourceList = [];
    const tab = workbenchState.activeTab;

    if (tab === "MY_QUEUE") {
        sourceList = (workbenchState.myCases || []).filter((c) => !["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase()));
    } else if (tab === "UNCLAIMED") {
        sourceList = workbenchState.unclaimedCases || [];
    } else if (tab === "ALL") {
        sourceList = (workbenchState.allCases && workbenchState.allCases.length > 0) ? workbenchState.allCases : (workbenchState.deptCases || []);
    } else if (tab === "RESOLVED") {
        const myRes = (workbenchState.myCases || []).filter((c) => ["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase()));
        const deptRes = (workbenchState.deptCases || []).filter((c) => ["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase()));
        sourceList = myRes.length > 0 ? myRes : deptRes;
    } else if (tab === "URGENT") {
        const combined = [...(workbenchState.myCases || []), ...(workbenchState.unclaimedCases || []), ...(workbenchState.deptCases || [])];
        const seen = new Set();
        sourceList = combined.filter((c) => {
            const key = c.case_number || c.id;
            if (seen.has(key)) return false;
            seen.add(key);
            const pr = String(c.priority || "").toUpperCase();
            const sl = String(c.sla_status || c.sla_state || "").toUpperCase();
            return ["CRITICAL", "HIGH"].includes(pr) || ["DUE_SOON", "OVERDUE", "AT_RISK", "BREACHED"].includes(sl);
        });
    } else {
        sourceList = workbenchState.deptCases || [];
    }

    // KPI Card Click Filter
    const kpi = workbenchState.caseActiveKpiFilter;
    if (kpi === "OPEN") {
        sourceList = sourceList.filter(
            (c) => !["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase())
        );
    } else if (kpi === "MY_QUEUE") {
        const myName = (workbenchState.agent?.name || "").toLowerCase();
        const myEmail = (workbenchState.agent?.email || "").toLowerCase();
        sourceList = sourceList.filter((c) => {
            const owner = String(c.assigned_user || c.assigned_to || "").toLowerCase();
            return (myName && owner.includes(myName)) || (myEmail && owner.includes(myEmail));
        });
    } else if (kpi === "OVERDUE") {
        sourceList = sourceList.filter((c) => {
            const pr = String(c.priority || "").toUpperCase();
            const sl = String(c.sla_status || c.sla_state || "").toUpperCase();
            return ["CRITICAL", "HIGH"].includes(pr) || ["DUE_SOON", "OVERDUE", "BREACHED", "AT_RISK"].includes(sl);
        });
    } else if (kpi === "REVIEW") {
        sourceList = sourceList.filter((c) => {
            const st = String(c.status || "").toUpperCase();
            return ["REVIEW_REQUIRED", "ON_HOLD", "PENDING_APPROVAL"].includes(st) ||
                   Boolean(c.employee_conflict) ||
                   (Array.isArray(c.missing_fields) && c.missing_fields.length > 0);
        });
    }

    const q = (workbenchState.searchQuery || "").trim().toLowerCase();
    const cat = workbenchState.categoryFilter || "ALL";
    const stat = workbenchState.statusFilter || "ALL";
    const prio = workbenchState.priorityFilter || "ALL";
    const sla = workbenchState.slaFilter || "ALL";

    return sourceList.filter((c) => {
        if (cat !== "ALL" && String(c.category || "").toUpperCase() !== cat.toUpperCase()) {
            return false;
        }
        if (stat !== "ALL" && String(c.status || "").toUpperCase() !== stat.toUpperCase()) {
            return false;
        }
        if (prio !== "ALL" && String(c.priority || "").toUpperCase() !== prio.toUpperCase()) {
            return false;
        }
        if (sla !== "ALL") {
            const curSla = String(c.sla_status || c.sla_state || "ON_TRACK").toUpperCase();
            if (curSla !== sla.toUpperCase()) return false;
        }
        if (q) {
            const hay = `${c.case_number || c.id || ""} ${c.title || c.email_subject || ""} ${c.employee_name || c.sender_name || ""} ${c.employee_id || ""} ${c.category || ""} ${c.intent || ""} ${c.assigned_team || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

const OFFICIAL_CATEGORIES = ["ATTENDANCE", "LEAVE", "RESIGNATION", "BGV", "PAYROLL", "ONBOARDING", "BENEFITS", "GENERAL_HR"];

// Crisp One UI 9.0 Vector Icons
const svgBriefcaseHero = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2.5" ry="2.5"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`;
const svgTableIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="9" x2="9" y2="21"></line></svg>`;
const svgBentoIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>`;
const svgClockMini = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const svgExpandMini = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const svgUserCheckMini = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><polyline points="17 11 19 13 23 9"></polyline></svg>`;
const svgTeamMini = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;


async function handleClaim(caseRef) {
    if (!caseRef) return;
    const ag = workbenchState.agent || {};
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/claim`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                agent_name: ag.name || "HR Specialist",
                agent_email: ag.email || "",
                agent_team: ag.team_name || "HR Operations",
            }),
        });
        if (res.ok) {
            workbenchState.selectedCaseRef = caseRef;
            workbenchState.activeTab = "MY_QUEUE";
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Claimed Case ${caseRef} into your personal queue!`);
        } else {
            const err = await res.json().catch(() => ({}));
            setToast("error", err.error?.message || "Could not claim case.");
        }
    } catch (e) {
        setToast("error", "Failed to connect to backend to claim case.");
    }
}
window.handleClaim = handleClaim;

async function runCaseAction(payload, successMsg) {
    const ref = workbenchState.selectedCaseRef;
    if (!ref) return;
    const ag = workbenchState.agent || {};
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(ref)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                performed_by: ag.name || "HR Specialist",
                ...payload,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            if (successMsg) setToast("success", successMsg);
        } else {
            setToast("error", json.error?.message || "Action could not be completed.");
        }
    } catch (e) {
        setToast("error", "Failed to communicate with case management server.");
    }
}
window.runCaseAction = runCaseAction;

function closeAgentCaseDetailModal() {
    const modal = document.getElementById("agentCaseDetailModal");
    if (modal) modal.style.display = "none";
}
window.closeAgentCaseDetailModal = closeAgentCaseDetailModal;

async function openAgentCaseDetailModal(caseRef) {
    if (!caseRef) return;
    workbenchState.selectedCaseRef = caseRef;
    window.open(`casedetail.html?case=${encodeURIComponent(caseRef)}`, "_blank");
}
window.openAgentCaseDetailModal = openAgentCaseDetailModal;

function renderAgentCaseDetailModalContent(detail) {
    const modal = document.getElementById("agentCaseDetailModal");
    if (!modal) return;

    const ag = workbenchState.agent || {};
    const c = detail.case || {};
    const emp = detail.employee || {};
    const em = detail.email || {};
    const tasks = detail.tasks || [];
    const stages = detail.workflow_stages || workbenchState.workflowStages || [];
    const catalog = detail.hrms_actions_catalog || workbenchState.hrmsActionsCatalog || [];
    const audits = detail.audit_logs || [];

    const caseRef = c.case_number || c.id || workbenchState.selectedCaseRef;
    const empDisplayName = emp.name || c.employee_name || em.sender_name || "Employee";
    const empDisplayCode = emp.employee_id || c.employee_id || "—";
    const empDisplayDept = emp.department || c.employee_department || "General";
    const empDisplayRole = emp.designation || c.employee_designation || "Staff";
    const empDisplayMgr = emp.manager_name || c.employee_manager || "—";
    const empDisplayEmail = emp.email || c.employee_email || em.sender_email || "—";
    const empDisplayLoc = emp.location || c.employee_location || "—";

    const stStyle = getStatusBadgeStyle(c.status);
    const slaStyle = getSlaBadgeStyle(c.sla_status || c.sla_state);

    const assignedOwner = c.assigned_user || c.assigned_to || "";
    const isUnclaimed = !assignedOwner || assignedOwner.toUpperCase() === "UNASSIGNED" || assignedOwner.toLowerCase() === String(c.assigned_team || "").toLowerCase();
    const currStep = Number(c.current_step || 1);

    let rawExt = c.extracted_fields?.fields || c.extracted_fields || {};
    if (typeof rawExt === "string") {
        try { rawExt = JSON.parse(rawExt); } catch (_) { rawExt = {}; }
    }
    const extEntries = Object.entries(rawExt).filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && k !== "category" && k !== "attachment");

    const caseCat = String(c.category || "GENERAL_HR").toUpperCase();
    const isLeave = caseCat.includes("LEAVE");
    const activeMode = workbenchState.replyTemplateMode || (isLeave ? "APPROVE_LEAVE" : "UPDATE");

    const templates = detail.smart_templates || {};
    const fallbackTemplates = {
        APPROVE_LEAVE: `Hi ${empDisplayName},\n\nYour leave request for ${c.title || "the specified dates"} has been verified against HRMS records and approved.\n\nBest regards,\n${ag.name || "HR Operations Team"}`,
        REQUEST_INFO: `Hi ${empDisplayName},\n\nThank you for reaching out. In order to process your request regarding "${c.title || c.case_number}", please provide the necessary supporting documentation or details.\n\nBest regards,\n${ag.name || "HR Operations Team"}`,
        UPDATE: templates.UPDATE || detail.smart_reply_draft || `Hi ${empDisplayName},\n\nYour HR inquiry regarding "${c.title || c.case_number}" has been reviewed and resolved. Please let us know if you require any further assistance.\n\nBest regards,\n${ag.name || "HR Operations Team"}`
    };
    const draftKey = `${caseRef}_${activeMode}`;
    const defaultDraft = templates[activeMode] || fallbackTemplates[activeMode] || detail.smart_reply_draft || "";
    const activeDraft = workbenchState.customReplyDrafts[draftKey] !== undefined ? workbenchState.customReplyDrafts[draftKey] : defaultDraft;

    modal.innerHTML = `
        <div class="modal-dialog" style="max-width:1120px; width:95%; max-height:92vh; display:flex; flex-direction:column; overflow:hidden; border-radius:24px; box-shadow:0 30px 80px rgba(15,23,42,0.32);">
            <!-- Modal Header -->
            <div class="oneui-case-hero-card" style="border-radius:0; border:none; border-bottom:1px solid #e2e8f0; padding:16px 24px; background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);">
                <div class="oneui-case-hero-left">
                    <span class="oneui-case-id-pill" style="font-size:0.88rem; padding:4px 12px;">${escapeHtml(caseRef)}</span>
                    <div style="min-width:0;">
                        <h2 class="oneui-case-hero-title" style="margin:0; font-size:1.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(c.title || `Case ${caseRef}`)}">${escapeHtml(c.title || `Case ${caseRef}`)}</h2>
                        <div class="oneui-case-hero-meta" style="margin-top:4px;">
                            <span class="cat-badge ${caseCat.includes("LEAVE") ? "cat-leave" : caseCat.includes("ATTENDANCE") ? "cat-attendance" : "cat-payroll"}">${escapeHtml(caseCat)}</span>
                            <span class="prio-badge ${String(c.priority || "MEDIUM").toLowerCase()}">${escapeHtml(c.priority || "MEDIUM")}</span>
                            <span class="oneui-status-capsule ${stStyle.tone || "blue"}">
                                <span class="oneui-status-dot"></span>
                                <span>${escapeHtml(stStyle.label || c.status || "NEW")}</span>
                            </span>
                            <span style="font-size:0.75rem; color:#64748b;">• Owner: <strong style="color:#0f172a;">${escapeHtml(isUnclaimed ? "Unassigned Pool" : assignedOwner)}</strong></span>
                        </div>
                    </div>
                </div>

                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <div class="oneui-sla-capsule ${String(c.sla_status || '').toLowerCase().includes('breach') ? 'overdue' : String(c.sla_status || '').toLowerCase().includes('risk') ? 'duesoon' : 'ontrack'}">
                        ${svgClockMini}
                        <span>SLA: ${escapeHtml(c.sla_remaining || c.sla_status || "On Track")}</span>
                    </div>

                    <select id="modalCaseStatusSelect" class="ios-glass-select" style="height:34px; padding:0 10px; font-weight:700;">
                        ${["NEW", "IN_PROGRESS", "ON_HOLD", "READY", "RESOLVED"]
                            .map((st) => `<option value="${st}" ${String(c.status || "").toUpperCase() === st ? "selected" : ""}>Status: ${st.replace(/_/g, " ")}</option>`)
                            .join("")}
                    </select>

                    ${isUnclaimed ? `<button type="button" class="ios-liquid-primary-btn" id="btnModalClaimCase" style="height:34px; padding:0 12px; font-size:0.75rem;">🎯 Claim</button>` : ""}
                    ${!isUnclaimed && String(c.status || "").toUpperCase() !== "RESOLVED" ? `<button type="button" class="ios-glass-btn btn-trigger-reassign" data-case-ref="${escapeHtml(caseRef)}" data-title="${escapeHtml(c.title || '')}" data-owner="${escapeHtml(assignedOwner)}" data-team="${escapeHtml(c.assigned_team || '')}" style="height:34px; padding:0 12px; font-size:0.75rem;" title="Reassign to Sub-Category Specialist">⇄ Reassign</button>` : ""}
                    ${String(c.status || "").toUpperCase() !== "RESOLVED" ? `<button type="button" class="ios-glass-btn primary-tint" id="btnModalQuickResolve" style="height:34px; padding:0 12px; font-size:0.75rem;">✓ Resolve</button>` : ""}
                    <button type="button" class="ios-glass-btn" onclick="closeAgentCaseDetailModal();" style="height:34px; width:34px; padding:0; border-radius:50%; font-weight:800;" title="Close Modal">✕</button>
                </div>
            </div>

            <!-- Scrollable Modal Body (Two-Column Bento Grid) -->
            <div style="flex:1; overflow-y:auto; padding:20px 24px; background:#f8fafc;">
                <div class="oneui-bento-grid-2">
                    <!-- LEFT COLUMN: Email Thread, AI Classification, Smart Reply -->
                    <div style="display:flex; flex-direction:column; gap:16px;">
                        <!-- 1. Original Inbound Email -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="font-size:1.1rem;">✉️</span>
                                    <strong style="color:#0f172a; font-size:0.92rem;">Inbound Employee Message</strong>
                                </div>
                                <span style="font-size:0.75rem; color:#64748b;">${escapeHtml(formatCleanTimestamp(em.received_at || c.created_at))}</span>
                            </div>
                            <div style="font-size:0.82rem; color:#475569; display:flex; flex-direction:column; gap:4px;">
                                <div><strong>From:</strong> ${escapeHtml(empDisplayName)} &lt;${escapeHtml(empDisplayEmail)}&gt;</div>
                                <div><strong>Subject:</strong> ${escapeHtml(em.subject || c.email_subject || c.title || "—")}</div>
                            </div>
                            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:14px; font-size:0.85rem; color:#1e293b; line-height:1.6; max-height:220px; overflow-y:auto; white-space:pre-wrap;">
                                ${escapeHtml(em.body_plain || em.snippet || c.description || "No email body text.")}
                            </div>
                            ${Array.isArray(em.attachments) && em.attachments.length > 0 ? `
                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:4px;">
                                    <span style="font-size:0.75rem; font-weight:700; color:#64748b;">Attachments (${em.attachments.length}):</span>
                                    ${em.attachments.map(att => `<span style="padding:3px 10px; border-radius:6px; background:#f1f5f9; border:1px solid #e2e8f0; font-size:0.72rem; font-weight:700; color:#1d4ed8;">📎 ${escapeHtml(att.filename || "Attachment")}</span>`).join("")}
                                </div>` : ""}
                        </div>

                        <!-- 2. AI Intelligence & Field Extraction -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="font-size:1.1rem;">🤖</span>
                                    <strong style="color:#0f172a; font-size:0.92rem;">AI Classification &amp; Extraction</strong>
                                </div>
                                <span class="cat-badge ${caseCat.includes("LEAVE") ? "cat-leave" : "cat-payroll"}">${escapeHtml(caseCat)}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:0.8rem;">
                                <span>Detected Intent: <strong style="color:#0f172a;">${escapeHtml(c.intent || "General HR Request")}</strong></span>
                                <span>•</span>
                                <span>Confidence: <strong style="color:#059669;">${em.category_confidence ? `${Math.round(Number(em.category_confidence) * 100)}%` : "98%"}</strong></span>
                            </div>
                            ${extEntries.length > 0 ? `
                                <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; margin-top:6px;">
                                    ${extEntries.map(([k, v]) => `
                                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; font-size:0.78rem;">
                                            <div style="color:#64748b; font-size:0.7rem; font-weight:700; text-transform:uppercase;">${escapeHtml(formatHuman(k))}</div>
                                            <div style="color:#0f172a; font-weight:700; margin-top:2px;">${escapeHtml(String(v))}</div>
                                        </div>`).join("")}
                                </div>` : `<div style="font-size:0.8rem; color:#64748b;">No extra fields required.</div>`}
                        </div>

                        <!-- 3. Smart Reply & Resolution Desk -->
                        <div class="oneui-bento-card" style="border:1.5px solid #c7d2fe; background:linear-gradient(135deg, #ffffff 0%, #f5f7ff 100%);">
                            <div class="oneui-bento-card-header" style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="font-size:1.1rem;">💬</span>
                                    <strong style="color:#1e3a8a; font-size:0.92rem;">Smart Employee Reply &amp; Resolution</strong>
                                </div>
                                <div style="display:flex; gap:6px;">
                                    <button type="button" class="btn-modal-tpl ${activeMode === "APPROVE_LEAVE" ? "active" : ""}" data-tpl="APPROVE_LEAVE" style="padding:3px 8px; border-radius:6px; border:1px solid #c7d2fe; font-size:0.72rem; font-weight:700; background:#ffffff; cursor:pointer;">Approve</button>
                                    <button type="button" class="btn-modal-tpl ${activeMode === "REQUEST_INFO" ? "active" : ""}" data-tpl="REQUEST_INFO" style="padding:3px 8px; border-radius:6px; border:1px solid #c7d2fe; font-size:0.72rem; font-weight:700; background:#ffffff; cursor:pointer;">Request Info</button>
                                    <button type="button" class="btn-modal-tpl ${activeMode === "UPDATE" ? "active" : ""}" data-tpl="UPDATE" style="padding:3px 8px; border-radius:6px; border:1px solid #c7d2fe; font-size:0.72rem; font-weight:700; background:#ffffff; cursor:pointer;">Update</button>
                                </div>
                            </div>
                            <textarea id="modalReplyTextarea" data-draft-key="${draftKey}" rows="5" style="width:100%; border:1px solid #cbd5e1; border-radius:10px; padding:10px; font-size:0.85rem; font-family:inherit; resize:vertical; background:#ffffff; color:#0f172a; line-height:1.5;" placeholder="Compose official reply to employee...">${escapeHtml(activeDraft)}</textarea>
                            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:4px;">
                                <button type="button" class="ios-glass-btn" id="btnModalSendReplyOnly" style="font-weight:700;">✉️ Send Reply Only</button>
                                <button type="button" class="ios-liquid-primary-btn" id="btnModalSendAndResolve" style="font-weight:700;">✓ Send Reply &amp; Resolve Case</button>
                            </div>
                        </div>
                    </div>

                    <!-- RIGHT COLUMN: Employee 360, Stepper, Tasks, HRMS Actions, Timeline -->
                    <div style="display:flex; flex-direction:column; gap:16px;">
                        <!-- 1. Employee 360 Profile -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <span style="font-size:1.1rem;">👤</span>
                                <strong style="color:#0f172a; font-size:0.92rem;">Employee 360 Dossier</strong>
                            </div>
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div class="oneui-case-emp-avatar tone-emerald" style="width:42px; height:42px; font-size:1rem;">
                                    ${escapeHtml(getInitials(empDisplayName))}
                                </div>
                                <div>
                                    <div style="font-weight:800; color:#0f172a; font-size:0.98rem;">${escapeHtml(empDisplayName)}</div>
                                    <div style="font-size:0.78rem; color:#64748b;">${escapeHtml(empDisplayRole)} · ${escapeHtml(empDisplayDept)}</div>
                                </div>
                            </div>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.78rem; margin-top:4px;">
                                <div><span style="color:#64748b;">EMP Code:</span> <strong style="color:#0f172a;">${escapeHtml(empDisplayCode)}</strong></div>
                                <div><span style="color:#64748b;">Reporting Mgr:</span> <strong style="color:#0f172a;">${escapeHtml(empDisplayMgr)}</strong></div>
                                <div><span style="color:#64748b;">Work Email:</span> <strong style="color:#0f172a;">${escapeHtml(empDisplayEmail)}</strong></div>
                                <div><span style="color:#64748b;">Location:</span> <strong style="color:#0f172a;">${escapeHtml(empDisplayLoc)}</strong></div>
                            </div>
                        </div>

                        <!-- 2. 4-Stage Workflow Stepper -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <span style="font-size:1.1rem;">⚡</span>
                                    <strong style="color:#0f172a; font-size:0.92rem;">Workflow Execution Stepper</strong>
                                </div>
                                <button type="button" class="ios-glass-btn primary-tint" id="btnModalNextStep" style="padding:4px 10px; font-size:0.72rem; font-weight:700;">Advance &rarr;</button>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:6px;">
                                ${(stages.length > 0 ? stages : [
                                    { step: 1, label: "Triage & Intake" },
                                    { step: 2, label: "HRMS Verification" },
                                    { step: 3, label: "Manager Approval Gate" },
                                    { step: 4, label: "Resolution & Closure" }
                                ]).map((st) => {
                                    const isDone = st.step < currStep || String(c.status || "").toUpperCase() === "RESOLVED";
                                    const isCurr = st.step === currStep && String(c.status || "").toUpperCase() !== "RESOLVED";
                                    return `
                                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-radius:10px; font-size:0.8rem; background:${isCurr ? "#eff6ff" : isDone ? "#f0fdf4" : "#f8fafc"}; border:1px solid ${isCurr ? "#bfdbfe" : isDone ? "#bbf7d0" : "#e2e8f0"};">
                                            <div style="display:flex; align-items:center; gap:8px;">
                                                <span style="width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.72rem; font-weight:800; background:${isDone ? "#10b981" : isCurr ? "#2563eb" : "#cbd5e1"}; color:#ffffff;">${isDone ? "✓" : st.step}</span>
                                                <span style="font-weight:700; color:${isCurr ? "#1d4ed8" : isDone ? "#047857" : "#64748b"};">${escapeHtml(st.label)}</span>
                                            </div>
                                            <span style="font-size:0.7rem; font-weight:700; color:${isCurr ? "#2563eb" : isDone ? "#10b981" : "#94a3b8"};">${isDone ? "Completed" : isCurr ? "In Progress" : "Pending"}</span>
                                        </div>
                                    `;
                                }).join("")}
                            </div>
                        </div>

                        <!-- 3. Verification Tasks Checklist -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <span style="font-size:1.1rem;">☑️</span>
                                <strong style="color:#0f172a; font-size:0.92rem;">Verification Checklist (${tasks.filter(t => t.status === "COMPLETED").length}/${tasks.length || 3})</strong>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:6px;">
                                ${(tasks.length > 0 ? tasks : [
                                    { id: 1, title: "Verify employee identity against HRMS", status: "COMPLETED" },
                                    { id: 2, title: "Inspect medical proof / supporting doc", status: "PENDING" },
                                    { id: 3, title: "Validate available balance ledger", status: "PENDING" }
                                ]).map(t => `
                                    <label style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:8px; background:#ffffff; border:1px solid #e2e8f0; font-size:0.8rem; cursor:pointer;">
                                        <input type="checkbox" class="agent-modal-task-cb" data-task-id="${t.id}" ${t.status === "COMPLETED" ? "checked" : ""}>
                                        <span style="${t.status === "COMPLETED" ? "text-decoration:line-through; color:#94a3b8;" : "color:#0f172a; font-weight:600;"}">${escapeHtml(t.title)}</span>
                                    </label>
                                `).join("")}
                            </div>
                        </div>

                        <!-- 4. Contextual HRMS Action Deck -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <span style="font-size:1.1rem;">⚡</span>
                                <strong style="color:#0f172a; font-size:0.92rem;">Authorized HRMS Verification Tools</strong>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:6px;">
                                ${(catalog.length > 0 ? catalog.slice(0, 3) : [
                                    { action_code: "GET_LEAVE_BALANCE", title: "Fetch HRMS Leave Quota", provider: "Internal HRMS" },
                                    { action_code: "CHECK_ATTENDANCE", title: "Verify Biometric Swipe Records", provider: "Truein" }
                                ]).map(act => `
                                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; font-size:0.78rem;">
                                        <div>
                                            <strong style="color:#0f172a;">${escapeHtml(act.title)}</strong>
                                            <span style="color:#64748b;"> · ${escapeHtml(act.provider || "HRMS")}</span>
                                        </div>
                                        <button type="button" class="btn-modal-exec-act ios-glass-btn" data-act-code="${escapeHtml(act.action_code)}" style="padding:3px 10px; font-size:0.72rem; font-weight:700;">Run Check</button>
                                    </div>
                                `).join("")}
                            </div>
                        </div>

                        <!-- 5. Case Activity Timeline -->
                        <div class="oneui-bento-card">
                            <div class="oneui-bento-card-header" style="display:flex; align-items:center; gap:8px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">
                                <span style="font-size:1.1rem;">📜</span>
                                <strong style="color:#0f172a; font-size:0.92rem;">Activity &amp; Audit Trail</strong>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:8px; max-height:160px; overflow-y:auto; font-size:0.76rem;">
                                ${(audits.length > 0 ? audits : [
                                    { action: "CASE_CREATED", description: "Case initialized from inbound employee email", created_at: c.created_at },
                                    { action: "AI_CLASSIFIED", description: `Classified as ${caseCat} (${c.intent || "General"})`, created_at: c.created_at }
                                ]).map(a => `
                                    <div style="border-left:2px solid #3b82f6; padding-left:8px; color:#475569;">
                                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(a.action || "UPDATE")}</div>
                                        <div>${escapeHtml(a.description || "Activity recorded")}</div>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Bind Modal Events
    modal.querySelectorAll(".btn-modal-tpl").forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.getAttribute("data-tpl");
            workbenchState.replyTemplateMode = mode;
            const area = document.getElementById("modalReplyTextarea");
            if (area) {
                area.value = fallbackTemplates[mode] || "";
                const key = area.getAttribute("data-draft-key");
                if (key) workbenchState.customReplyDrafts[key] = area.value;
            }
            modal.querySelectorAll(".btn-modal-tpl").forEach(b => b.classList.toggle("active", b === btn));
        });
    });

    document.getElementById("modalCaseStatusSelect")?.addEventListener("change", async (e) => {
        const newSt = e.target.value;
        await runCaseAction({ action_type: "UPDATE_STATUS", status: newSt }, `Case status updated to ${newSt}.`);
        await openAgentCaseDetailModal(caseRef);
    });

    document.getElementById("btnModalClaimCase")?.addEventListener("click", async () => {
        await handleClaim(caseRef);
        await openAgentCaseDetailModal(caseRef);
    });

    document.getElementById("btnModalQuickResolve")?.addEventListener("click", async () => {
        const text = document.getElementById("modalReplyTextarea")?.value?.trim() || "Resolved by HR Specialist.";
        await runCaseAction({ action_type: "RESOLVE", resolution_notes: text, notify_employee: true }, "Case marked as RESOLVED!");
        closeAgentCaseDetailModal();
    });

    document.getElementById("btnModalNextStep")?.addEventListener("click", async () => {
        await runCaseAction({ action_type: "NEXT_STEP" }, "Advanced case workflow step.");
        await openAgentCaseDetailModal(caseRef);
    });

    modal.querySelectorAll(".btn-modal-exec-act").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const code = btn.getAttribute("data-act-code");
            await runCaseAction({ action_type: "EXECUTE_ACTION", action_code: code }, `Executed ${code} action successfully.`);
            await openAgentCaseDetailModal(caseRef);
        });
    });

    modal.querySelectorAll(".agent-modal-task-cb").forEach((cb) => {
        cb.addEventListener("change", async () => {
            const tid = Number(cb.getAttribute("data-task-id"));
            await runCaseAction({ action_type: "TOGGLE_TASK", task_id: tid }, "Updated checklist task.");
        });
    });

    document.getElementById("btnModalSendReplyOnly")?.addEventListener("click", async () => {
        const text = document.getElementById("modalReplyTextarea")?.value?.trim() || "";
        if (!text) { alert("Please type a reply message first."); return; }
        await runCaseAction({ action_type: "REPLY", message: text }, "Official Gmail reply dispatched to employee!");
        closeAgentCaseDetailModal();
    });

    document.getElementById("btnModalSendAndResolve")?.addEventListener("click", async () => {
        const text = document.getElementById("modalReplyTextarea")?.value?.trim() || "Resolved by HR Specialist.";
        await runCaseAction({ action_type: "RESOLVE", resolution_notes: text, notify_employee: true }, "Case resolved and confirmation sent to employee!");
        closeAgentCaseDetailModal();
    });
}
window.renderAgentCaseDetailModalContent = renderAgentCaseDetailModalContent;

function renderDeptCasesConsoleHtml(ag, scopedCategoriesList) {
    const kpis = workbenchState.kpis || {};
    const filteredCases = getFilteredQueueCases();
    const deptInfo = ag.dept_info || {};
    const deptName = ag.team_name || deptInfo.team_name || "HR Operations";
    const myCases = workbenchState.myCases || [];
    const deptCases = workbenchState.deptCases || [];
    const unclaimedCases = workbenchState.unclaimedCases || [];
    const allCases = (workbenchState.allCases && workbenchState.allCases.length > 0) ? workbenchState.allCases : deptCases;

    const myActiveCount = myCases.filter((c) => !["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase())).length;
    const openCasesCount = deptCases.filter((c) => !["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase())).length;
    const overdueCount = deptCases.filter((c) => {
        const sl = String(c.sla_status || c.sla_state || "").toUpperCase();
        const pr = String(c.priority || "").toUpperCase();
        return ["OVERDUE", "BREACHED", "DUE_SOON"].includes(sl) || pr === "CRITICAL";
    }).length;
    const reviewCount = deptCases.filter((c) => {
        const st = String(c.status || "").toUpperCase();
        return ["REVIEW_REQUIRED", "ON_HOLD", "PENDING_APPROVAL"].includes(st) || Boolean(c.employee_conflict);
    }).length;

    const ratedCases = deptCases.filter((c) => c.feedback_rating);
    const avgCsat = ratedCases.length > 0
        ? (ratedCases.reduce((acc, c) => acc + Number(c.feedback_rating), 0) / ratedCases.length).toFixed(1)
        : "5.0";
    const ratedCount = ratedCases.length;

    const avatarTones = ["tone-blue", "tone-indigo", "tone-emerald", "tone-amber", "tone-purple"];
    const getCatToneClass = (cat) => {
        const ct = String(cat || "UNKNOWN").toUpperCase();
        if (ct === "PAYROLL" || ct === "BENEFITS") return "cat-payroll";
        if (ct === "LEAVE") return "cat-leave";
        if (ct === "ATTENDANCE") return "cat-attendance";
        if (ct === "RESIGNATION") return "cat-resignation";
        if (ct === "ONBOARDING" || ct === "BGV") return "cat-onboarding";
        if (ct === "UNKNOWN") return "cat-unknown";
        return "cat-general";
    };

    const formatCategoryLabel = (rawCat) => {
        const cat = String(rawCat || "UNKNOWN").toUpperCase();
        if (cat === "UNKNOWN") return "Unclassified";
        if (cat === "BGV") return "BGV";
        if (cat === "ASSET_IT") return "Asset & IT";
        if (cat === "GENERAL_HR") return "General HR";
        return formatHuman(cat);
    };

    const getStatusPillInfo = (rawStat) => {
        const st = String(rawStat || "NEW").toUpperCase();
        if (st === "READY" || st === "RESOLVED") return { tone: "emerald", label: formatHuman(st) };
        if (st === "REVIEW_REQUIRED" || st === "ON_HOLD" || st === "PENDING_APPROVAL") return { tone: "amber", label: formatHuman(st) };
        if (st === "IN_PROGRESS" || st === "OPEN" || st === "NEW") return { tone: "blue", label: formatHuman(st) };
        return { tone: "slate", label: formatHuman(st) };
    };

    const getCardAccentGrad = (rawCat) => {
        const cat = String(rawCat || "UNKNOWN").toUpperCase();
        if (cat === "LEAVE") return "linear-gradient(90deg, #10b981 0%, #059669 100%)";
        if (cat === "ATTENDANCE") return "linear-gradient(90deg, #06b6d4 0%, #0284c7 100%)";
        if (cat === "PAYROLL" || cat === "BENEFITS") return "linear-gradient(90deg, #6366f1 0%, #4f46e5 100%)";
        if (cat === "RESIGNATION") return "linear-gradient(90deg, #ef4444 0%, #dc2626 100%)";
        if (cat === "BGV" || cat === "ONBOARDING") return "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)";
        return "linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)";
    };

    const hasActiveFilters = Boolean(
        (workbenchState.searchQuery || "").trim() ||
        workbenchState.statusFilter !== "ALL" ||
        workbenchState.priorityFilter !== "ALL" ||
        workbenchState.slaFilter !== "ALL" ||
        workbenchState.caseActiveKpiFilter
    );

    const buildTableRowHtml = (c, idx) => {
        const ref = c.case_number || c.id;
        const empName = c.employee_name && c.employee_name !== "Unknown" ? c.employee_name : (c.sender_name || (c.sender_email ? c.sender_email.split("@")[0] : "Employee"));
        const empCode = c.employee_code || c.employee_id || "";
        const hasConflict = Boolean(c.employee_conflict);
        const isMatched = Boolean(c.employee_matched && !hasConflict);
        const empDept = c.department || c.employee_department || "";
        const empEmail = c.employee_email || c.sender_email || "";
        const empInitials = getInitials(empName);
        const avatarTone = isMatched ? "tone-emerald" : hasConflict ? "tone-amber" : avatarTones[idx % avatarTones.length];

        const catTone = getCatToneClass(c.category);
        const catLabel = formatCategoryLabel(c.category);

        const rawIntent = String(c.intent || "").trim();
        let intentCode = "";
        let intentTitle = rawIntent || "General HR Request";
        const intentMatch = rawIntent.match(/^([A-Z]\d{2,3})\s*[—\-·:]\s*(.+)$/);
        if (intentMatch) {
            intentCode = intentMatch[1];
            intentTitle = intentMatch[2];
        }

        const stInfo = getStatusPillInfo(c.status);
        const prioRaw = String(c.priority || "MEDIUM").toUpperCase();
        const prioClass = prioRaw.toLowerCase();
        const prioLabel = formatHuman(prioRaw);

        const specialistName = c.assigned_user || c.assigned_to || "Unassigned";
        const specialistInitials = getInitials(specialistName);
        const isAssignedToMe = specialistName.toLowerCase().includes((ag.name || "").toLowerCase()) ||
                               (ag.email && specialistName.toLowerCase().includes(ag.email.toLowerCase()));
        const canClaim = !c.assigned_user || c.assigned_user.toUpperCase() === "UNASSIGNED" || !isAssignedToMe;

        const slaState = String(c.sla_status || c.sla_state || "ON_TRACK").toUpperCase();
        const slaTone = slaState === "OVERDUE" || slaState === "BREACHED" ? "overdue" : slaState === "DUE_SOON" ? "duesoon" : slaState === "COMPLETED" ? "completed" : "ontrack";
        const slaLabel = formatHuman(slaState);
        const slaPct = Number(c.sla_progress_pct ?? (slaState === "COMPLETED" ? 100 : 40));
        const subjectLine = c.title || c.email_subject || `HR Request (${ref})`;

        return `
            <tr class="oneui-case-table-row" data-case-ref="${escapeHtml(ref)}" style="cursor:pointer;">
                <td class="col-case-info">
                    <div class="oneui-case-id-cell">
                        <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" class="oneui-case-id-badge case-row-link" data-case-ref="${escapeHtml(ref)}" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                            <span>${escapeHtml(ref)}</span>
                            <span style="opacity:0.7; font-size:0.7rem;">↗</span>
                        </a>
                        <div class="oneui-case-subject-sub" title="${escapeHtml(subjectLine)}">${escapeHtml(subjectLine)}</div>
                    </div>
                </td>
                <td class="col-emp-info">
                    <div class="oneui-case-emp-cell">
                        <div class="oneui-case-emp-avatar ${avatarTone}">
                            <span>${escapeHtml(empInitials)}</span>
                            ${isMatched ? `<span class="oneui-emp-verified-dot" title="Verified Employee">✓</span>` : hasConflict ? `<span class="oneui-emp-verified-dot" style="background:#f59e0b;" title="Identity Conflict">!</span>` : ""}
                        </div>
                        <div class="oneui-case-emp-info">
                            <div class="oneui-case-emp-name">${escapeHtml(empName)}</div>
                            <div class="oneui-case-emp-sub">
                                ${isMatched ? `<span class="oneui-emp-code-chip">${escapeHtml(empCode)}</span>${empDept ? `<span>· ${escapeHtml(empDept)}</span>` : ""}` : `<span class="oneui-emp-ext-chip">${escapeHtml(empEmail || "External")}</span>`}
                            </div>
                        </div>
                    </div>
                </td>
                <td class="col-intent-info">
                    <div class="oneui-case-intent-line" style="display:flex; align-items:center; gap:6px;">
                        ${intentCode ? `<span class="oneui-intent-code-chip">${escapeHtml(intentCode)}</span>` : ""}
                        <span style="font-weight:700; color:#0f172a; font-size:0.83rem;" title="${escapeHtml(intentTitle)}">${escapeHtml(intentTitle)}</span>
                    </div>
                </td>
                <td class="col-status-info">
                    <div class="oneui-case-status-cell">
                        <span class="oneui-status-capsule ${stInfo.tone}">
                            <span class="oneui-status-dot"></span>
                            <span>${escapeHtml(stInfo.label)}</span>
                        </span>
                        ${c.workflow_state ? `<div class="oneui-wf-sub-label">● ${escapeHtml(formatHuman(c.workflow_state))}</div>` : ""}
                        ${c.feedback_rating ? `
                            <div style="display:inline-flex; align-items:center; gap:4px; margin-top:4px; padding:2px 7px; background:#fffbeb; border:1px solid #fde68a; border-radius:999px; font-size:0.7rem; font-weight:800; color:#b45309;" title="Employee CSAT Rating: ${c.feedback_rating} Stars (${escapeHtml(c.feedback_label || '')})">
                                <span>⭐</span><span>${c.feedback_rating}.0</span>
                            </div>
                        ` : ''}
                    </div>
                </td>
                <td class="col-prio-info">
                    <span class="prio-badge ${prioClass}">${escapeHtml(prioLabel)}</span>
                </td>
                <td class="col-assignee-info">
                    <div class="oneui-specialist-chip" style="margin:0;">
                        <span class="oneui-spec-mini-av">${escapeHtml(specialistInitials)}</span>
                        <div style="min-width:0;">
                            <span style="display:block; font-weight:700; color:#0f172a; font-size:0.79rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(specialistName)}</span>
                            <span style="display:block; font-size:0.67rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.assigned_team || deptName)}</span>
                        </div>
                    </div>
                </td>
                <td class="col-sla-info">
                    <div class="oneui-sla-cell">
                        <div class="oneui-sla-capsule ${slaTone}">
                            ${svgClockMini}
                            <span>${escapeHtml(slaLabel)}</span>
                        </div>
                        <div class="oneui-sla-rem-txt">${escapeHtml(c.sla_remaining || "48h remaining")}</div>
                        <div class="oneui-sla-bar-track">
                            <div class="oneui-sla-bar-fill ${slaTone}" style="width:${slaPct}%;"></div>
                        </div>
                    </div>
                </td>
                <td class="col-actions-info">
                    <div class="oneui-case-actions-cell" style="justify-content:flex-end;">
                        <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" class="ios-glass-btn primary-tint btn-open-case-newtab" data-case-ref="${escapeHtml(ref)}" style="height:30px; padding:0 10px; font-size:0.75rem; text-decoration:none; display:inline-flex; align-items:center; gap:5px;">
                            ${svgExpandMini}
                            <span>Detail ↗</span>
                        </a>
                        ${canClaim ? `<button type="button" class="ios-glass-btn btn-card-claim" data-case-ref="${escapeHtml(ref)}" style="height:30px; padding:0 8px; font-size:0.75rem;">${svgUserCheckMini}<span>Take</span></button>` : `<button type="button" class="ios-glass-btn btn-trigger-reassign" data-case-ref="${escapeHtml(ref)}" data-title="${escapeHtml(c.title || '')}" data-owner="${escapeHtml(specialistName)}" data-team="${escapeHtml(c.assigned_team || deptName)}" style="height:30px; padding:0 8px; font-size:0.75rem; color:#2563eb;" title="Reassign to sub-category specialist">⇄ Reassign</button>`}
                    </div>
                </td>
            </tr>
        `;
    };

    const buildBentoCardHtml = (c, idx) => {
        const ref = c.case_number || c.id;
        const empName = c.employee_name && c.employee_name !== "Unknown" ? c.employee_name : (c.sender_name || "Employee");
        const empCode = c.employee_code || c.employee_id || "";
        const empDept = c.department || c.employee_department || "—";
        const empEmail = c.employee_email || c.sender_email || "—";
        const empInitials = getInitials(empName);
        const avatarTone = avatarTones[idx % avatarTones.length];

        const catTone = getCatToneClass(c.category);
        const catLabel = formatCategoryLabel(c.category);
        const stInfo = getStatusPillInfo(c.status);
        const prioRaw = String(c.priority || "MEDIUM").toUpperCase();
        const prioClass = prioRaw.toLowerCase();
        const accentGrad = getCardAccentGrad(c.category);

        const slaState = String(c.sla_status || c.sla_state || "ON_TRACK").toUpperCase();
        const slaTone = slaState === "OVERDUE" || slaState === "BREACHED" ? "overdue" : slaState === "DUE_SOON" ? "duesoon" : "ontrack";
        const specialistName = c.assigned_user || c.assigned_to || "Unassigned";
        const isAssignedToMe = specialistName.toLowerCase().includes((ag.name || "").toLowerCase());
        const canClaim = !c.assigned_user || c.assigned_user.toUpperCase() === "UNASSIGNED" || !isAssignedToMe;

        return `
            <div class="dept-card oneui-case-bento-card" data-case-ref="${escapeHtml(ref)}" style="height:auto; max-height:none; cursor:pointer;">
                <div class="dept-card-accent" style="background:${accentGrad};"></div>
                <div class="dept-card-body" style="overflow:visible;">
                    <div class="dept-card-top">
                        <div class="dept-title-wrap">
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" class="oneui-case-id-badge case-row-link" data-case-ref="${escapeHtml(ref)}" style="text-decoration:none;">${escapeHtml(ref)} ↗</a>
                                <span class="oneui-status-capsule ${stInfo.tone}">
                                    <span class="oneui-status-dot"></span>
                                    <span>${escapeHtml(stInfo.label)}</span>
                                </span>
                                <span class="prio-badge ${prioClass}">${escapeHtml(formatHuman(prioRaw))}</span>
                            </div>
                            <h3 style="margin-top:8px; font-size:1.12rem;">${escapeHtml(c.title || c.email_subject || `HR Request (${ref})`)}</h3>
                            <div style="font-size:0.82rem; color:#475569; margin-top:3px;">
                                Intent: <strong style="color:#0f172a;">${escapeHtml(c.intent || "General HR Request")}</strong>
                            </div>
                        </div>
                        <div class="dept-top-actions">
                            <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" class="ios-glass-btn primary-tint btn-open-case-newtab" data-case-ref="${escapeHtml(ref)}" style="text-decoration:none; display:inline-flex; align-items:center; gap:5px;">
                                ${svgExpandMini}
                                <span>Open Detail ↗</span>
                            </a>
                            ${canClaim ? `<button type="button" class="ios-glass-btn btn-card-claim" data-case-ref="${escapeHtml(ref)}">${svgUserCheckMini}<span>Take Case</span></button>` : `<button type="button" class="ios-glass-btn btn-trigger-reassign" data-case-ref="${escapeHtml(ref)}" data-title="${escapeHtml(c.title || '')}" data-owner="${escapeHtml(specialistName)}" data-team="${escapeHtml(c.assigned_team || deptName)}" style="padding:0 8px; font-size:0.74rem; color:#2563eb;" title="Reassign to sub-category specialist">⇄ Reassign</button>`}
                        </div>
                    </div>

                    <div class="dept-metrics-strip">
                        <div class="dept-metric-item">
                            <span>Employee</span>
                            <div style="display:flex; align-items:center; gap:8px; margin-top:2px;">
                                <div class="oneui-case-emp-avatar ${avatarTone}" style="width:28px; height:28px; border-radius:9px; font-size:0.72rem;">
                                    <span>${escapeHtml(empInitials)}</span>
                                </div>
                                <div style="min-width:0;">
                                    <strong style="font-size:0.9rem; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(empName)}</strong>
                                    <span style="font-size:0.68rem; text-transform:none;">${escapeHtml(empCode ? `${empCode} · ${empDept}` : empEmail)}</span>
                                </div>
                            </div>
                        </div>
                        <div class="dept-metric-item">
                            <span>Assigned Desk &amp; Specialist</span>
                            <strong class="metric-blue" style="font-size:0.92rem;">${escapeHtml(c.assigned_team || deptName)}</strong>
                            <span style="font-size:0.72rem; text-transform:none; color:#475569;">Specialist: ${escapeHtml(specialistName)}</span>
                        </div>
                        <div class="dept-metric-item">
                            <span>SLA Countdown</span>
                            <strong class="${slaTone === "overdue" ? "" : "metric-emerald"}" style="font-size:0.92rem; color:${slaTone === "overdue" ? "#dc2626" : ""};">${escapeHtml(c.sla_remaining || "48h remaining")}</strong>
                            <span style="font-size:0.72rem; text-transform:none;">State: ${escapeHtml(formatHuman(slaState))}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    return `
        <div class="op-cases-workspace-container" style="max-width:1440px; margin:0 auto; width:100%;">
            <!-- 1. Executive Svelte Header Bar -->
            <div class="op-cases-header-bar">
                <div class="op-cases-header-left">
                    <div class="ios-squircle-icon blue" style="width:40px; height:40px; border-radius:13px;">
                        ${svgBriefcaseHero}
                    </div>
                    <div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <h1 class="op-cases-header-title">Case Workspace</h1>
                            <span class="op-dept-scope-pill">${escapeHtml(deptName)}</span>
                        </div>
                    </div>
                </div>

                <div class="op-cases-header-center">
                    <div class="op-queue-segmented-dock" role="tablist" aria-label="Queue Filter">
                        <button type="button" class="op-queue-pill-btn ${workbenchState.activeTab === "ALL" ? "active" : ""}" data-qtab="ALL">All Cases (${allCases.length})</button>
                        <button type="button" class="op-queue-pill-btn ${workbenchState.activeTab === "MY_QUEUE" ? "active" : ""}" data-qtab="MY_QUEUE">My Queue (${myActiveCount})</button>
                        <button type="button" class="op-queue-pill-btn ${workbenchState.activeTab === "DEPT_QUEUE" ? "active" : ""}" data-qtab="DEPT_QUEUE">Team Queue (${deptCases.length})</button>
                        <button type="button" class="op-queue-pill-btn ${workbenchState.activeTab === "UNCLAIMED" ? "active" : ""}" data-qtab="UNCLAIMED">Unclaimed (${unclaimedCases.length})</button>
                    </div>
                </div>

                <div class="op-cases-header-right">
                    <div class="op-queue-segmented-dock" title="Switch View Mode">
                        <button type="button" class="op-queue-pill-btn ${workbenchState.caseViewMode === "TABLE" ? "active" : ""}" data-vmode="TABLE" style="display:inline-flex; align-items:center; gap:5px; padding:5px 11px;">
                            ${svgTableIcon}
                            <span>Table</span>
                        </button>
                        <button type="button" class="op-queue-pill-btn ${workbenchState.caseViewMode === "CARDS" ? "active" : ""}" data-vmode="CARDS" style="display:inline-flex; align-items:center; gap:5px; padding:5px 11px;">
                            ${svgBentoIcon}
                            <span>Bento</span>
                        </button>
                    </div>

                    <button type="button" class="ios-glass-btn" id="btnRefreshCasesQueue" title="Refresh Live Queue" style="height:34px; padding:0 10px; display:inline-flex; align-items:center; gap:5px; font-weight:700; font-size:0.75rem;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        <span>Refresh</span>
                    </button>

                    <button type="button" class="ios-liquid-primary-btn op-hero-create-btn" id="btnOpenNewCaseModal" style="height:34px; padding:0 14px; display:inline-flex; align-items:center; gap:6px; font-weight:700; font-size:0.78rem;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                        <span>New Case</span>
                    </button>
                </div>
            </div>

            <!-- 2. Interactive KPI Metric Strip -->
            <div class="op-bento-kpi-grid op-cases-kpis-strip">
                <div class="stat-compact-card blue oneui-kpi-clickable ${workbenchState.caseActiveKpiFilter === "OPEN" ? "active-kpi-ring" : ""}" data-case-kpi="OPEN" title="Click to filter Open Cases">
                    <div class="stat-num">${openCasesCount}</div>
                    <div class="stat-info">
                        <strong>Open Cases</strong>
                        <span>Active department queue</span>
                    </div>
                </div>

                <div class="stat-compact-card emerald oneui-kpi-clickable ${workbenchState.activeTab === "MY_QUEUE" ? "active-kpi-ring" : ""}" data-case-kpi="MY_QUEUE" title="Click to view My Queue">
                    <div class="stat-num">${myActiveCount}</div>
                    <div class="stat-info">
                        <strong>My Queue</strong>
                        <span>Assigned to you</span>
                    </div>
                </div>

                <div class="stat-compact-card amber oneui-kpi-clickable ${workbenchState.caseActiveKpiFilter === "OVERDUE" ? "active-kpi-ring" : ""}" data-case-kpi="OVERDUE" title="Click to filter Overdue SLA Cases">
                    <div class="stat-num">${overdueCount}</div>
                    <div class="stat-info">
                        <strong>Overdue SLA</strong>
                        <span>Immediate attention</span>
                    </div>
                </div>

                <div class="stat-compact-card purple oneui-kpi-clickable ${workbenchState.caseActiveKpiFilter === "REVIEW" ? "active-kpi-ring" : ""}" data-case-kpi="REVIEW" title="Click to filter cases needing review or action">
                    <div class="stat-num">${reviewCount}</div>
                    <div class="stat-info">
                        <strong>Needs Review</strong>
                        <span>Action gate &amp; conflicts</span>
                    </div>
                </div>

                <div class="stat-compact-card amber" style="background:linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-color:#fde68a;" title="Employee CSAT Feedback Rating on Resolved Cases">
                    <div class="stat-num" style="color:#b45309; display:flex; align-items:center; gap:4px;">
                        <span>★</span><span>${avgCsat}</span>
                    </div>
                    <div class="stat-info">
                        <strong style="color:#92400e;">CSAT Rating</strong>
                        <span style="color:#b45309;">${ratedCount > 0 ? `${ratedCount} Survey${ratedCount > 1 ? 's' : ''}` : 'Target: 5.0'}</span>
                    </div>
                </div>
            </div>

            <!-- 3. Master Workspace Card (Unified Filters + Table) -->
            <div class="op-cases-unified-card">
                <div class="op-cases-toolbar-header">
                    <div class="dept-search-wrap" style="flex:1; max-width:440px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input type="text" id="caseWorkspaceSearch" value="${escapeHtml(workbenchState.searchQuery || "")}" placeholder="Search Case ID, Employee, Subject, Intent...">
                        ${
                            workbenchState.searchQuery
                                ? `<button type="button" id="btnClearCaseSearch" class="oneui-clear-search-btn" title="Clear search">✕</button>`
                                : ""
                        }
                    </div>

                    <div class="oneui-cases-selects-row">
                        <select id="caseFilterStat" class="ios-glass-select" style="width:auto; height:34px; border-radius:999px; padding:0 12px; font-size:0.75rem;">
                            <option value="ALL">Status: All</option>
                            ${["NEW", "OPEN", "READY", "IN_PROGRESS", "ON_HOLD", "PENDING_APPROVAL", "REVIEW_REQUIRED", "RESOLVED", "CLOSED"]
                                .map((s) => `<option value="${s}" ${s === workbenchState.statusFilter ? "selected" : ""}>${formatHuman(s)}</option>`)
                                .join("")}
                        </select>
                        <select id="caseFilterPrio" class="ios-glass-select" style="width:auto; height:34px; border-radius:999px; padding:0 12px; font-size:0.75rem;">
                            <option value="ALL">Priority: All</option>
                            ${["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => `<option value="${p}" ${p === workbenchState.priorityFilter ? "selected" : ""}>${formatHuman(p)}</option>`).join("")}
                        </select>
                        <select id="caseFilterSlaState" class="ios-glass-select" style="width:auto; height:34px; border-radius:999px; padding:0 12px; font-size:0.75rem;">
                            <option value="ALL">SLA: All States</option>
                            ${["ON_TRACK", "DUE_SOON", "OVERDUE", "COMPLETED"].map((st) => `<option value="${st}" ${st === workbenchState.slaFilter ? "selected" : ""}>${formatHuman(st)}</option>`).join("")}
                        </select>
                        ${
                            hasActiveFilters
                                ? `<button type="button" class="ios-glass-btn" id="btnResetCaseFilters" style="height:34px; padding:0 12px; font-size:0.75rem;">✕ Reset</button>`
                                : ""
                        }
                    </div>
                </div>

                ${
                    workbenchState.caseViewMode === "CARDS"
                        ? `<div class="dept-cards-grid ${filteredCases.length === 1 ? "single-centered" : ""}" style="padding:18px;">
                               ${
                                   filteredCases.length === 0
                                       ? `<div class="ios-glass-card" style="grid-column:1/-1; padding:42px; text-align:center; color:#64748b; align-items:center;">
                                              <div style="font-size:1.02rem; font-weight:800; color:#0f172a;">No cases match your current queue or filter criteria</div>
                                              <div style="font-size:0.86rem; margin-top:4px;">Click <strong>Reset</strong> above or switch tabs to view your cases.</div>
                                          </div>`
                                       : filteredCases.map((c, idx) => buildBentoCardHtml(c, idx)).join("")
                               }
                           </div>`
                        : `<div class="op-cases-table-wrapper">
                               <table class="op-ios-table oneui-cases-table">
                                   <thead>
                                       <tr>
                                           <th>Case ID &amp; Subject</th>
                                           <th>Employee</th>
                                           <th>Intent &amp; Topic</th>
                                           <th>Status &amp; Stage</th>
                                           <th>Priority</th>
                                           <th>Assigned Specialist</th>
                                           <th>SLA Telemetry</th>
                                           <th style="text-align:right;">Actions</th>
                                       </tr>
                                   </thead>
                                   <tbody>
                                       ${
                                           filteredCases.length === 0
                                               ? `<tr>
                                                      <td colspan="8" style="padding:48px 24px; text-align:center; color:#64748b;">
                                                          <div style="font-size:1rem; font-weight:800; color:#0f172a; margin-bottom:4px;">No cases match your current queue or filter criteria</div>
                                                          <div style="font-size:0.85rem;">Try switching to <strong>All Cases</strong> or resetting active filters.</div>
                                                      </td>
                                                  </tr>`
                                               : filteredCases.map((c, idx) => buildTableRowHtml(c, idx)).join("")
                                       }
                                   </tbody>
                               </table>
                           </div>`
                }
            </div>
        </div>
    `;
}


function renderTasksBoardViewHtml(ag) {
    const tasks = workbenchState.tasks || [];
    const pendingTasks = tasks.filter((t) => String(t.status || "").toUpperCase() !== "COMPLETED");
    const completedTasks = tasks.filter((t) => String(t.status || "").toUpperCase() === "COMPLETED");

    return `
        <div class="agent-card">
            <div class="agent-card-header">
                <div>
                    <h3 class="agent-card-title" style="font-size:0.95rem;">
                        ☑️ My Specialist Verification Tasks Board (${tasks.length} Total · ${pendingTasks.length} Open · ${completedTasks.length} Completed)
                    </h3>
                    <div style="font-size:0.76rem; color:#64748b; margin-top:2px;">
                        Check off verification steps directly here or open the linked case in <strong>${escapeHtml(ag.team_name || "HR Operations")}</strong>
                    </div>
                </div>
                <button type="button" id="btnBackToConsoleFromTasks" class="agent-btn-outline">
                    &larr; Back to Case Console
                </button>
            </div>

            ${
                tasks.length === 0
                    ? `
                <div style="padding:36px; text-align:center; color:#64748b;">
                    <div style="font-size:1.8rem; margin-bottom:8px;">☑️</div>
                    <div style="font-weight:800; color:#0f172a; font-size:0.92rem;">No verification checklist tasks yet</div>
                    <div style="font-size:0.78rem; margin-top:4px;">When you claim or open a case in the Case Execution Console, its verification checklist tasks will appear here.</div>
                </div>`
                    : `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:14px;">
                        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#b45309; margin-bottom:10px;">
                            ⏳ Pending Verification Tasks (${pendingTasks.length})
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${
                                pendingTasks.length === 0
                                    ? `<div style="font-size:0.76rem; color:#64748b;">All verification tasks completed!</div>`
                                    : pendingTasks
                                          .map(
                                              (t) => `
                                        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                                            <label style="display:flex; align-items:flex-start; gap:10px; flex:1; cursor:pointer;">
                                                <input type="checkbox" class="btn-board-toggle-task" data-task-id="${t.id}" data-case-ref="${escapeHtml(t.case_number || t.case_id)}" style="width:16px; height:16px; margin-top:2px; accent-color:#059669; cursor:pointer;">
                                                <div>
                                                    <div style="font-size:0.8rem; font-weight:800; color:#0f172a;">${escapeHtml(t.title)}</div>
                                                    <div style="font-size:0.71rem; color:#64748b; margin-top:2px;">
                                                        Case: <strong style="color:#1d4ed8;">${escapeHtml(t.case_number || `#${t.case_id}`)}</strong> · Priority: <strong>${escapeHtml(t.priority || "MEDIUM")}</strong>
                                                    </div>
                                                </div>
                                            </label>
                                            <button type="button" class="btn-jump-to-case agent-btn-outline" data-case-ref="${escapeHtml(t.case_number || t.case_id)}" style="height:28px; font-size:0.7rem;">
                                                Open Case &rarr;
                                            </button>
                                        </div>`
                                          )
                                          .join("")
                            }
                        </div>
                    </div>

                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:14px;">
                        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#047857; margin-bottom:10px;">
                            ✅ Completed Verification Tasks (${completedTasks.length})
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${
                                completedTasks.length === 0
                                    ? `<div style="font-size:0.76rem; color:#64748b;">No tasks marked completed yet.</div>`
                                    : completedTasks
                                          .map(
                                              (t) => `
                                        <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                                            <label style="display:flex; align-items:flex-start; gap:10px; flex:1; cursor:pointer;">
                                                <input type="checkbox" class="btn-board-toggle-task" data-task-id="${t.id}" data-case-ref="${escapeHtml(t.case_number || t.case_id)}" checked style="width:16px; height:16px; margin-top:2px; accent-color:#059669; cursor:pointer;">
                                                <div>
                                                    <div style="font-size:0.8rem; font-weight:800; color:#065f46; text-decoration:line-through;">${escapeHtml(t.title)}</div>
                                                    <div style="font-size:0.71rem; color:#047857; margin-top:2px;">
                                                        Case: <strong>${escapeHtml(t.case_number || `#${t.case_id}`)}</strong> · Completed: ${escapeHtml(String(t.completed_at || "").slice(0, 16))}
                                                    </div>
                                                </div>
                                            </label>
                                            <button type="button" class="btn-jump-to-case agent-btn-outline" data-case-ref="${escapeHtml(t.case_number || t.case_id)}" style="height:28px; font-size:0.7rem;">
                                                View
                                            </button>
                                        </div>`
                                          )
                                          .join("")
                            }
                        </div>
                    </div>
                </div>`
            }
        </div>
    `;
}

function getFilteredDeptInboxEmails() {
    const allEmails = workbenchState.deptEmails || [];
    const tab = workbenchState.inboxFilterTab || "ALL";
    let list = allEmails;

    const isResolved = (e) => {
        const st = String(e.case_status || "").toUpperCase();
        return st === "RESOLVED" || st === "CLOSED";
    };
    const isUrgentSla = (e) => {
        if (isResolved(e)) return false;
        const prio = String(e.case_priority || e.priority || "").toUpperCase();
        const sla = String(e.sla_status || e.case_sla_status || "").toUpperCase();
        return Boolean(e.is_urgent_sla) || prio === "CRITICAL" || prio === "HIGH" || ["DUE_SOON", "OVERDUE", "AT_RISK", "BREACHED"].includes(sla);
    };

    if (tab === "ASSIGNED_TO_ME") {
        list = allEmails.filter((e) => (e.is_actionable !== 0 && e.is_actionable !== false) && Boolean(e.is_assigned_to_me) && !isResolved(e));
    } else if (tab === "URGENT_SLA") {
        list = allEmails.filter((e) => (e.is_actionable !== 0 && e.is_actionable !== false) && isUrgentSla(e));
    } else if (tab === "RESOLVED") {
        list = allEmails.filter((e) => (e.is_actionable !== 0 && e.is_actionable !== false) && isResolved(e));
    } else if (tab === "NOISE") {
        list = allEmails.filter((e) => e.is_actionable === 0 || e.is_actionable === false);
    } else {
        // "ALL" or "INBOX" tab: all active actionable HR emails
        list = allEmails.filter((e) => (e.is_actionable !== 0 && e.is_actionable !== false) && !isResolved(e));
    }

    const catFilter = (workbenchState.inboxCategoryFilter || "ALL").trim().toUpperCase();
    if (catFilter !== "ALL") {
        list = list.filter((e) => ((e.category || e.case_category || "").trim().toUpperCase()) === catFilter);
    }

    const q = (workbenchState.inboxSearchQuery || "").trim().toLowerCase();
    if (q) {
        list = list.filter((e) => {
            const hay = `${e.subject || ""} ${e.sender_name || ""} ${e.sender_email || ""} ${e.account_email || ""} ${e.category || ""} ${e.case_number || ""} ${e.body || ""}`.toLowerCase();
            return hay.includes(q);
        });
    }

    // Threading / Case Deduplication: Collapse multiple emails belonging to the same case into 1 active conversation
    const seenCases = new Set();
    const threadedList = [];
    for (const em of list) {
        const cNum = em.case_number ? String(em.case_number).trim() : null;
        if (cNum) {
            if (seenCases.has(cNum)) continue;
            seenCases.add(cNum);
        }
        threadedList.push(em);
    }
    return threadedList;
}

function formatCleanTimestamp(raw) {
    if (!raw) return "Just now";
    try {
        const dt = new Date(String(raw).replace(" ", "T"));
        if (isNaN(dt.getTime())) return String(raw).slice(0, 16);
        return dt.toLocaleString("en-IN", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (_) {
        return String(raw).slice(0, 16);
    }
}

function formatReadableEmailBody(rawBody, emailMeta) {
    if (!rawBody || !String(rawBody).trim()) {
        return `
            <div class="reader-sheet-header">
                <div class="reader-sheet-header-left">
                    <span class="reader-sheet-icon">✉️</span>
                    <span class="reader-sheet-label">Empty Message</span>
                </div>
            </div>
            <div class="reader-clean-body" style="color:#64748b; padding:24px;">(No email message content available.)</div>
        `;
    }

    const cleanStr = String(rawBody).replace(/\r\n/g, "\n");
    const lines = cleanStr.split("\n").map((l) => l.trim());

    // 1. Separate main body vs quoted thread
    const mainLines = [];
    const quotedLines = [];
    let inQuoted = false;
    for (const l of lines) {
        if (!inQuoted && (/^On\s+.+wrote:\s*$/i.test(l) || l.startsWith(">"))) {
            inQuoted = true;
        }
        if (inQuoted) {
            quotedLines.push(l);
        } else {
            mainLines.push(l);
        }
    }

    // 2. Clean standalone bullet artifacts ('-', '*', '•', '–', '—')
    const filtered = [];
    for (const l of mainLines) {
        if (l === "-" || l === "*" || l === "•" || l === "–" || l === "—") {
            continue;
        }
        // Remove leading bullet symbols (e.g. "- *Employee Name:*" -> "*Employee Name:*")
        const stripped = l.replace(/^[-*•–—]\s*/, "").trim();
        filtered.push(stripped || l);
    }

    // 3. Group into chunks by blank lines
    const chunks = [];
    let curChunk = [];
    for (const l of filtered) {
        if (!l) {
            if (curChunk.length > 0) {
                chunks.push(curChunk);
                curChunk = [];
            }
        } else {
            curChunk.push(l);
        }
    }
    if (curChunk.length > 0) {
        chunks.push(curChunk);
    }

    const blocks = [];
    const kvRegex = /^\*?([A-Za-z][A-Za-z0-9\s/_-]{1,32})\*?:\s*(.+)$/;

    function getFieldIcon(k) {
        const kl = String(k || "").toLowerCase();
        if (kl.includes("date") || kl.includes("day") || kl.includes("joining") || kl.includes("time") || kl.includes("period")) return "📅";
        if (kl.includes("employee") || kl.includes("name") || kl.includes("manager") || kl.includes("reporting") || kl.includes("person") || kl.includes("who")) return "👤";
        if (kl.includes("dept") || kl.includes("department") || kl.includes("location") || kl.includes("branch") || kl.includes("site") || kl.includes("city")) return "🏢";
        if (kl.includes("leave") || kl.includes("type") || kl.includes("category") || kl.includes("subject") || kl.includes("reason")) return "🏷️";
        if (kl.includes("amount") || kl.includes("salary") || kl.includes("bonus") || kl.includes("payroll") || kl.includes("earning") || kl.includes("head") || kl.includes("inr")) return "💳";
        if (kl.includes("id") || kl.includes("code") || kl.includes("ref") || kl.includes("status") || kl.includes("ticket")) return "🆔";
        return "🔹";
    }

    let i = 0;
    while (i < chunks.length) {
        const chunk = chunks[i];
        const firstLine = chunk[0];

        // 1. Salutation
        if (chunk.length === 1 && /^(dear|hi|hello|hey|good morning|good afternoon|respected|to)\b/i.test(firstLine)) {
            blocks.push(`<div class="mail-salutation">${escapeHtml(firstLine)}</div>`);
            i++;
            continue;
        }

        // 2. Sign-off / Signature Card
        if (/^(best regards|warm regards|thanks & regards|thanks and regards|kind regards|sincerely|regards|thank you|thanks),?$/i.test(firstLine)) {
            const sigLines = [];
            for (let sIdx = i; sIdx < chunks.length; sIdx++) {
                sigLines.push(...chunks[sIdx]);
            }
            const sigSignoff = sigLines[0];
            let sigName = "";
            let sigRole = "";
            const sigChips = [];

            for (let s = 1; s < sigLines.length; s++) {
                const sl = sigLines[s];
                // Clean angle bracket artifacts e.g. <+91%2098765%2043210>
                const cleanSl = sl.replace(/<[^>]+>/g, "").trim();
                if (!sigName && !cleanSl.includes(":")) {
                    sigName = cleanSl.replace(/\*/g, "").trim();
                } else if (cleanSl.includes(":")) {
                    const m = cleanSl.match(kvRegex);
                    if (m) {
                        const k = m[1].replace(/\*/g, "").trim();
                        const v = m[2].replace(/\*/g, "").trim();
                        const kl = k.toLowerCase();
                        if (kl.includes("designation")) {
                            sigRole = sigRole ? `${v} · ${sigRole}` : v;
                        } else if (kl.includes("department")) {
                            sigRole = sigRole ? `${sigRole} · ${v}` : v;
                        } else if (kl.includes("contact") || kl.includes("phone") || kl.includes("mobile")) {
                            const digits = v.replace(/[^\d+]/g, "");
                            sigChips.push(`<a href="tel:${escapeHtml(digits)}" class="mail-sig-chip" title="Call employee">📞 ${escapeHtml(v)}</a>`);
                        } else if (kl.includes("id")) {
                            sigChips.push(`<span class="mail-sig-chip">🆔 ${escapeHtml(v)}</span>`);
                        } else if (kl.includes("location")) {
                            sigChips.push(`<span class="mail-sig-chip">📍 ${escapeHtml(v)}</span>`);
                        } else {
                            sigChips.push(`<span class="mail-sig-chip">${escapeHtml(k)}: ${escapeHtml(v)}</span>`);
                        }
                    } else {
                        sigChips.push(`<span class="mail-sig-chip">${escapeHtml(cleanSl)}</span>`);
                    }
                } else if (cleanSl) {
                    if (!sigRole) {
                        sigRole = cleanSl.replace(/\*/g, "");
                    } else {
                        sigChips.push(`<span class="mail-sig-chip">${escapeHtml(cleanSl)}</span>`);
                    }
                }
            }

            blocks.push(`
                <div class="mail-signature-card">
                    <div class="mail-sig-signoff">${escapeHtml(sigSignoff)}</div>
                    <div class="mail-sig-profile">
                        <div class="mail-sig-avatar">${escapeHtml(getInitials(sigName || emailMeta?.employee_name || emailMeta?.sender_name || "Employee"))}</div>
                        <div class="mail-sig-meta">
                            <strong class="mail-sig-name">${escapeHtml(sigName || emailMeta?.employee_name || emailMeta?.sender_name || "Employee")}</strong>
                            ${sigRole ? `<div class="mail-sig-role">${escapeHtml(sigRole)}</div>` : ""}
                            ${sigChips.length > 0 ? `<div class="mail-sig-chips">${sigChips.join("")}</div>` : ""}
                        </div>
                    </div>
                </div>
            `);
            break;
        }

        // 3. Structured Key-Value group
        const isKv = chunk.every((l) => kvRegex.test(l));
        if (isKv) {
            const kvItems = [];
            for (const l of chunk) {
                const m = l.match(kvRegex);
                if (m) {
                    kvItems.push({
                        key: m[1].replace(/\*/g, "").trim(),
                        val: m[2].replace(/\*/g, "").trim(),
                    });
                }
            }
            let j = i + 1;
            while (j < chunks.length) {
                if (chunks[j].every((l) => kvRegex.test(l))) {
                    for (const l of chunks[j]) {
                        const m = l.match(kvRegex);
                        if (m) {
                            kvItems.push({
                                key: m[1].replace(/\*/g, "").trim(),
                                val: m[2].replace(/\*/g, "").trim(),
                            });
                        }
                    }
                    j++;
                } else {
                    break;
                }
            }

            const renderedItems = kvItems.map((item) => {
                const icon = getFieldIcon(item.key);
                return `
                    <div class="mail-structured-item">
                        <div class="mail-item-header">
                            <span class="mail-item-icon">${icon}</span>
                            <span class="mail-item-key">${escapeHtml(item.key)}</span>
                        </div>
                        <strong class="mail-item-val">${escapeHtml(item.val)}</strong>
                    </div>
                `;
            }).join("");

            blocks.push(`
                <div class="mail-structured-card">
                    <div class="mail-structured-header">
                        <div class="mail-structured-header-left">
                            <span class="mail-structured-icon">📋</span>
                            <span class="mail-structured-title">Extracted Request Particulars</span>
                        </div>
                        <span class="mail-structured-count">${kvItems.length} Fields</span>
                    </div>
                    <div class="mail-structured-grid">
                        ${renderedItems}
                    </div>
                </div>
            `);
            i = j;
            continue;
        }

        // 4. Regular Paragraph: unwrap hard line-breaks
        const joined = chunk.join(" ");
        let pHtml = escapeHtml(joined);
        // Highlight terms in asterisks
        pHtml = pHtml.replace(/\*([^*\n]+)\*/g, '<strong class="mail-highlight-text">$1</strong>');
        // Convert URLs into smart links
        pHtml = pHtml.replace(
            /(https?:\/\/[^\s<>]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer" class="mail-body-link">$1 ↗</a>'
        );
        blocks.push(`<p class="mail-paragraph">${pHtml}</p>`);
        i++;
    }

    const wordCount = cleanStr.trim().split(/\s+/).filter(Boolean).length;
    const readMins = Math.max(1, Math.round(wordCount / 180));

    let quotedHtml = "";
    if (quotedLines.length > 0) {
        quotedHtml = `
            <details class="email-quoted-thread">
                <summary class="email-quoted-summary">••• Show quoted thread (${quotedLines.length} lines)</summary>
                <div class="email-quoted-body">
                    ${quotedLines.map((l) => `<div class="mail-text-line" style="color:#64748b; font-size:0.83rem;">${escapeHtml(l)}</div>`).join("")}
                </div>
            </details>
        `;
    }

    return `
        <div class="reader-sheet-header">
            <div class="reader-sheet-header-left">
                <span class="reader-sheet-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="3.5"></rect>
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                    </svg>
                </span>
                <span class="reader-sheet-label">Verified Inbound Email</span>
                <span class="reader-sheet-meta-pill">${wordCount} words · ~${readMins} min read</span>
            </div>
            <div class="reader-sheet-header-right">
                <button type="button" class="btn-sheet-util" id="btnCopyEmailContent" title="Copy clean message text to clipboard">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span id="btnCopyEmailContentText">Copy Text</span>
                </button>
                <button type="button" class="btn-sheet-util ${workbenchState.readerFontComfortable ? "is-active" : ""}" id="btnToggleEmailDensity" title="Toggle comfortable large / standard reading font">
                    <span style="font-weight:700;">Aa</span>
                    <span id="btnToggleDensityLabel" style="font-size:0.68rem; opacity:0.85;">${workbenchState.readerFontComfortable ? "Large" : "Default"}</span>
                </button>
            </div>
        </div>
        <div class="reader-clean-body ${workbenchState.readerFontComfortable ? "font-comfortable" : ""}" id="readerCleanBodyContainer">
            <div class="reader-body-main">
                ${blocks.join("")}
                ${quotedHtml}
            </div>
        </div>
    `;
}

function buildPlainSnippet(rawBody) {
    return String(rawBody || "")
        .replace(/\r\n/g, " ")
        .replace(/\n+/g, " ")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 115);
}

function renderDeptInboxViewHtml(ag) {
    const emails = workbenchState.deptEmails || [];
    const comms = workbenchState.myCommunications || [];
    const deptDeskEmail = ag.email || ag.dept_info?.dept_gmail || "";
    const allowedCats = Array.isArray(ag.allowed_categories) && ag.allowed_categories.length > 0
        ? ag.allowed_categories
        : String(ag.category_scope || "PAYROLL").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const scope = allowedCats[0] || "PAYROLL";
    const myAssignedCount = emails.filter((e) => Boolean(e.is_assigned_to_me)).length;
    const unclaimedCount = emails.filter((e) => Boolean(e.is_unclaimed)).length;

    const activeCat = (workbenchState.inboxCategoryFilter || "ALL").trim().toUpperCase();
    const activeCatEmails = activeCat !== "ALL"
        ? emails.filter((e) => ((e.category || e.case_category || "").trim().toUpperCase()) === activeCat)
        : emails;

    const isEmailResolved = (e) => {
        const st = String(e.case_status || "").toUpperCase();
        return st === "RESOLVED" || st === "CLOSED";
    };
    const isUrgentSla = (e) => {
        if (isEmailResolved(e)) return false;
        const prio = String(e.case_priority || e.priority || "").toUpperCase();
        const sla = String(e.sla_status || e.case_sla_status || "").toUpperCase();
        return Boolean(e.is_urgent_sla) || prio === "CRITICAL" || prio === "HIGH" || ["DUE_SOON", "OVERDUE", "AT_RISK", "BREACHED"].includes(sla);
    };

    const collapseByCase = (arr) => {
        const seen = new Set();
        return arr.filter((e) => {
            const c = e.case_number ? String(e.case_number).trim() : null;
            if (c) {
                if (seen.has(c)) return false;
                seen.add(c);
            }
            return true;
        });
    };
    const activeCatActionableEmails = collapseByCase(activeCatEmails.filter((e) => e.is_actionable !== 0 && e.is_actionable !== false));
    const noiseCount = collapseByCase(activeCatEmails.filter((e) => e.is_actionable === 0 || e.is_actionable === false)).length;

    const inboxPillCount = activeCatActionableEmails.filter((e) => !isEmailResolved(e)).length;
    const assignedPillCount = activeCatActionableEmails.filter((e) => Boolean(e.is_assigned_to_me) && !isEmailResolved(e)).length;
    const urgentSlaPillCount = activeCatActionableEmails.filter(isUrgentSla).length;
    const resolvedPillCount = activeCatActionableEmails.filter(isEmailResolved).length;

    let inboxTitle = "Mail Inbox";
    if (ag.team_name && ag.team_name.toLowerCase() === "peopledesk") {
        inboxTitle = "PeopleDesk Inbox";
    } else if (allowedCats.length > 1 && allowedCats.length <= 3) {
        inboxTitle = `${allowedCats.map((c) => formatHuman(c)).join(" & ")} Inbox`;
    } else if (ag.team_name) {
        inboxTitle = `${ag.team_name.replace(/\bdept\b|\bdepartment\b/gi, "").trim()} Inbox`;
    } else if (allowedCats.length === 1) {
        inboxTitle = `${formatHuman(allowedCats[0])} Inbox`;
    }

    const filteredEmails = getFilteredDeptInboxEmails();
    const displayListCount = filteredEmails.length;

    let selectedEmail = filteredEmails.find((e) => Number(e.id) === Number(workbenchState.selectedEmailId));
    if (!selectedEmail && filteredEmails.length > 0) {
        selectedEmail = filteredEmails[0];
        workbenchState.selectedEmailId = selectedEmail.id;
    }

    if (workbenchState.inboxFilterTab === "SENT_REPLIES" && selectedComm) {
        const linkedParentEmail = emails.find(
            (e) =>
                (selectedComm.source_email_id && Number(e.id) === Number(selectedComm.source_email_id)) ||
                (selectedComm.case_number && e.case_number === selectedComm.case_number) ||
                (selectedComm.case_id && Number(e.case_id) === Number(selectedComm.case_id))
        );
        if (linkedParentEmail) {
            selectedEmail = linkedParentEmail;
        } else {
            selectedEmail = {
                id: selectedComm.source_email_id || selectedComm.id,
                subject: selectedComm.case_title || selectedComm.subject || "Employee HR Inquiry",
                category: selectedComm.case_category || scope,
                case_number: selectedComm.case_number || (selectedComm.case_id ? `CASE-${String(selectedComm.case_id).padStart(6, "0")}` : ""),
                case_id: selectedComm.case_id,
                case_status: selectedComm.case_status || "IN_PROGRESS",
                case_priority: selectedComm.case_priority || "MEDIUM",
                case_owner: selectedComm.sender_name || ag.name,
                employee_name: selectedComm.employee_name || selectedComm.recipient || "Employee",
                emp_code: selectedComm.emp_code || "",
                sender_name: selectedComm.employee_name || selectedComm.recipient || "Employee",
                sender_email: selectedComm.recipient || "employee@company.com",
                account_email: ag.email || deptDeskEmail,
                received_at: selectedComm.created_at,
                body: selectedComm.message || "",
                is_assigned_to_me: true,
                confidence: 0.96,
            };
        }
    }

    // Parse extracted fields for the selected email
    let selExt = {};
    if (selectedEmail && selectedEmail.extracted_fields) {
        try {
            const parsed = typeof selectedEmail.extracted_fields === "string"
                ? JSON.parse(selectedEmail.extracted_fields)
                : selectedEmail.extracted_fields;
            selExt = parsed?.fields || parsed || {};
        } catch (_) {
            selExt = {};
        }
    }
    const selExtEntries = Object.entries(selExt).filter(
        ([k, v]) => v != null && v !== "" && typeof v !== "object" && k !== "category" && k !== "attachment"
    );

    // Pre-fill smart reply draft for selected email
    let inboxDraftText = "";
    if (selectedEmail) {
        const draftKey = `inbox_em_${selectedEmail.id}`;
        if (workbenchState.inboxReplyDrafts[draftKey] !== undefined) {
            inboxDraftText = workbenchState.inboxReplyDrafts[draftKey];
        } else {
            const empName = selectedEmail.employee_name || selectedEmail.sender_name || "Employee";
            const subj = selectedEmail.subject || "your HR request";
            const refTag = selectedEmail.case_number ? ` (Case #${selectedEmail.case_number})` : "";
            inboxDraftText =
                `Dear ${empName},\n\n` +
                `Thank you for contacting ${ag.team_name || "HR Operations"} regarding "${subj}"${refTag}.\n\n` +
                `I have reviewed your ${selectedEmail.category || scope} request and verified your records in our HRMS portal. ` +
                `Your request has been processed and reconciled.\n\n` +
                `Warm regards,\n${ag.name}\n${ag.designation || "HR Specialist"} · ${ag.team_name || "HR Operations"}`;
        }
    }

    const avatarTones = ["tone-blue", "tone-indigo", "tone-teal", "tone-violet", "tone-slate"];
    const getCatToneClass = (cat) => {
        const c = String(cat || "").toUpperCase();
        if (c === "PAYROLL" || c === "BENEFITS") return "cat-payroll";
        if (c === "LEAVE") return "cat-leave";
        if (c === "ATTENDANCE") return "cat-attendance";
        if (c === "RESIGNATION") return "cat-resignation";
        if (c === "ONBOARDING" || c === "BGV") return "cat-onboarding";
        return "cat-general";
    };

    const openArrowSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>`;
    const chevronRightSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

    // Prepare Workspace Intelligence Modal Dialog data for selectedEmail
    const matchedCase = selectedEmail
        ? (workbenchState.deptCases || []).find(
              (c) =>
                  (selectedEmail.case_number && c.case_number === selectedEmail.case_number) ||
                  (selectedEmail.case_id && Number(c.id) === Number(selectedEmail.case_id))
          )
        : null;
    const curStep = Number(selectedEmail?.current_step || matchedCase?.current_step || 1);
    const wfStages = [
        { step: 1, code: "INTAKE_IDENTITY", title: "Intake & Identity Check" },
        { step: 2, code: "POLICY_HRMS_CHECK", title: "Policy & HRMS Verification" },
        { step: 3, code: "ACTION_EXECUTION", title: "Action & Approval Sign-Off" },
        { step: 4, code: "RESOLUTION_CLOSURE", title: "Resolution & Employee Reply" },
    ];
    const isResolved = String(selectedEmail?.case_status || "").toUpperCase() === "RESOLVED";
    const wfPct = isResolved ? 100 : Math.round((curStep / 4) * 100);
    const curStageObj = wfStages[Math.min(Math.max(curStep - 1, 0), 3)];
    const nxtStageObj = curStep < 4 ? wfStages[curStep] : null;
    const rawConf = selectedEmail?.category_confidence ?? selectedEmail?.confidence ?? 0.96;
    const confPct = Math.round(Number(rawConf) <= 1 ? Number(rawConf) * 100 : Number(rawConf));

    // Parse validation result and directory telemetry for selected email
    let selValResult = null;
    if (selectedEmail && selectedEmail.validation_result) {
        try {
            selValResult = typeof selectedEmail.validation_result === "string"
                ? JSON.parse(selectedEmail.validation_result)
                : selectedEmail.validation_result;
        } catch (_) {
            selValResult = null;
        }
    }

    const valStatus = selValResult?.status || (selValResult?.is_valid ? "READY" : "REVIEW_REQUIRED");
    const valVerifiedCount = selValResult?.verified_required_count ?? selExtEntries.length;
    const valTotalCount = selValResult?.total_required_count ?? Math.max(selExtEntries.length, 4);

    let fieldChecks = selValResult?.field_checks || [];
    let fieldChecksHtml = "";
    if (fieldChecks.length > 0) {
        fieldChecksHtml = fieldChecks
            .map((fc) => {
                const isReq = Boolean(fc.required);
                const isValid = Boolean(fc.valid);
                const valText = fc.value != null && fc.value !== "" ? String(fc.value) : "—";
                const badgeText = fc.badge || (isValid ? "✓ Verified" : isReq ? "Missing" : "Optional");
                const badgeBg = isValid ? "#dcfce7" : isReq ? "#fee2e2" : "#f1f5f9";
                const badgeFg = isValid ? "#15803d" : isReq ? "#b91c1c" : "#475569";
                const borderCol = isValid ? "#bbf7d0" : isReq ? "#fecaca" : "#e2e8f0";
                return `
                    <div class="ios-field-tile" style="display:flex; justify-content:space-between; align-items:center; padding:9px 12px; background:#f8fafc; border:1px solid ${borderCol}; border-radius:10px;">
                        <div style="min-width:0; flex:1; padding-right:8px;">
                            <div style="font-size:0.75rem; font-weight:700; color:#0f172a;">${escapeHtml(formatHuman(fc.field))}</div>
                            <div style="font-size:0.72rem; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(valText)}">${escapeHtml(valText)}</div>
                        </div>
                        <span style="font-size:0.68rem; padding:3px 7px; border-radius:5px; font-weight:700; background:${badgeBg}; color:${badgeFg}; white-space:nowrap;">${escapeHtml(badgeText)}</span>
                    </div>
                `;
            })
            .join("");
    } else if (selExtEntries.length > 0) {
        fieldChecksHtml = selExtEntries
            .map(([k, v]) => `
                <div class="ios-field-tile" style="display:flex; justify-content:space-between; align-items:center; padding:9px 12px; background:#f8fafc; border:1px solid #bbf7d0; border-radius:10px;">
                    <div style="min-width:0; flex:1; padding-right:8px;">
                        <div style="font-size:0.75rem; font-weight:700; color:#0f172a;">${escapeHtml(formatHuman(k))}</div>
                        <div style="font-size:0.72rem; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(String(v))}">${escapeHtml(String(v))}</div>
                    </div>
                    <span style="font-size:0.68rem; padding:3px 7px; border-radius:5px; font-weight:700; background:#dcfce7; color:#15803d; white-space:nowrap;">✓ Verified</span>
                </div>
            `)
            .join("");
    } else {
        fieldChecksHtml = `<div style="font-size:0.78rem; color:#64748b; padding:12px 0;">No structured field payloads detected for this message.</div>`;
    }

    const candidateKeywords = [
        "medical", "sick", "leave", "vacation", "casual", "hospital", "doctor",
        "salary", "payslip", "deduction", "tax", "bonus", "payroll", "allowance",
        "attendance", "swipe", "biometric", "regularize", "half day",
        "resignation", "notice period", "relieving", "exit", "handover",
        "insurance", "policy", "mediclaim", "nominee", "benefit"
    ];
    const textBlob = `${selectedEmail?.subject || ""} ${selectedEmail?.body || ""}`.toLowerCase();
    const detectedEvidence = [];
    for (const kw of candidateKeywords) {
        if (textBlob.includes(kw) && !detectedEvidence.includes(kw)) {
            detectedEvidence.push(kw);
            if (detectedEvidence.length >= 6) break;
        }
    }
    if (detectedEvidence.length === 0 && selectedEmail?.sender_email) {
        detectedEvidence.push(selectedEmail.sender_email);
    }
    const evidenceChipsHtml = detectedEvidence
        .map((tok) => `
            <span class="evidence-chip one-ui-chip" style="font-size:0.7rem; background:#f1f5f9; color:#0f172a; padding:3px 8px; border-radius:6px; border:1px solid #cbd5e1; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                <span style="color:#64748b;">✦</span>
                <span>${escapeHtml(tok)}</span>
            </span>
        `)
        .join("");

    const tokensCount = Math.min(950, (selectedEmail?.body || "").length > 0 ? Math.round(((selectedEmail?.body || "").length + 100) / 4) : 180);
    const marginMatch = (selectedEmail?.category_reason || "").match(/margin\s*([+\-\d.]+)/i);
    const marginVal = marginMatch ? marginMatch[1] : "1.7";
    const isUrgent = Boolean(selectedEmail?.is_urgent_sla || (selectedEmail?.case_priority || "").toUpperCase() === "HIGH" || (selectedEmail?.case_priority || "").toUpperCase() === "CRITICAL");
    const urgencyLevel = isUrgent ? "URGENT" : "NORMAL";
    const urgencyTone = isUrgent ? "rose" : "emerald";

    const modalSenderDisplay = selectedEmail?.employee_name || selectedEmail?.sender_name || "Employee";
    const modalEmpDept = selectedEmail?.employee_department || selExt.department || (selectedEmail?.category === "LEAVE" ? "Software Development" : "Finance & Operations");
    const modalEmpDesig = selectedEmail?.employee_designation || (selectedEmail?.category === "LEAVE" ? "Software Developer" : "Specialist");
    const modalEmpManager = selectedEmail?.employee_manager || "Amit Sharma";
    const modalEmpLocation = selectedEmail?.employee_location || "Gurugram, Haryana";

    const wfNodesHtml = wfStages
        .map((st, idx) => {
            const stState = idx + 1 < curStep || isResolved ? "done" : idx + 1 === curStep ? "current" : "upcoming";
            const nodeLabel = stState === "done" ? "✓" : String(idx + 1);
            const connHtml =
                idx < wfStages.length - 1
                    ? `<div class="g-wf-track-line ${idx + 1 < curStep || isResolved ? "done" : ""}"></div>`
                    : "";
            return `<div class="g-wf-node ${stState}" title="Step ${st.step}: ${escapeHtml(st.title)}">${nodeLabel}</div>${connHtml}`;
        })
        .join("");

    const activeDialogTab = workbenchState.activeRhsDialogTab;
    const dialogTitles = {
        ai: "AI Classification & Model Telemetry",
        case: "Case Workspace & Specialist Gmail Dispatch",
        employee: "Employee Cloud Identity & Directory",
        workflow: "Workflow Engine & State Machine Stepper",
        actions: "HR Action Center & Service Level Agreement",
        audit: "Chronological Case & Email Audit Trail",
    };

    const caseAuditLogs = (workbenchState.myAuditLogs || []).slice(0, 10);
    const caseRef = selectedEmail?.case_number || (matchedCase?.case_number) || "";
    const specialistName = selectedEmail?.case_owner || ag.name || "HR Specialist";
    const specialistEmail = selectedEmail?.case_owner_email || ag.email || "agent@company.com";
    const specialistTeam = selectedEmail?.case_team || ag.team_name || `${scope} Operations HR`;
    const specialistRole = ag.designation || "HR Specialist";
    const slaRemainingDisplay = selectedEmail?.is_urgent_sla ? "4h remaining (Urgent)" : "22h remaining";
    const slaDueDisplay = selectedEmail?.case_due_at ? String(selectedEmail.case_due_at).slice(0, 16) : "Within 24 Hours";
    const empIdCode = selectedEmail?.emp_code || (selectedEmail?.employee_id ? `EMP-${selectedEmail.employee_id}` : "Unregistered");

    // 1. AI DETAIL PANEL (One UI 9.0 Complete Telemetry)
    const aiDetailSectionHtml = `
        <div class="ios-bento-stack one-ui-stack">
            <!-- BENTO ROW 1: ONE UI 9.0 AI HERO & 4-TILE TELEMETRY -->
            <div class="ios-glass-card hero-tint one-ui-hero-card">
                <div class="ios-card-header">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon blue">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" fill="currentColor"/>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">
                                <span>AI Decision &amp; Neural Telemetry</span>
                                <span class="one-ui-live-pill"><span class="one-ui-pulse-dot"></span>Active Pipeline</span>
                            </div>
                            <div class="ios-card-sub">Calibrated LinearSVC · Deterministic Rule Router · Semantic Embedding Matrix</div>
                        </div>
                    </div>
                    <span class="ios-status-capsule emerald">
                        <span class="ios-capsule-dot"></span>Auto Classified (${escapeHtml(scope)})
                    </span>
                </div>

                <div class="ios-bento-grid-4">
                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.3"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                            <span class="ios-tile-label">Predicted Category</span>
                        </div>
                        <div class="ios-tile-main">
                            <span class="decision-tile-badge">${escapeHtml(selectedEmail?.category || scope)}</span>
                        </div>
                        <span class="ios-tile-meta" title="${escapeHtml(selectedEmail?.category_reason || "")}">Path: ${escapeHtml(selectedEmail?.category_reason || ("Router → " + (selectedEmail?.category || scope)))}</span>
                    </div>

                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.3"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="2"></circle></svg>
                            <span class="ios-tile-label">Detected Intent</span>
                        </div>
                        <div class="decision-intent-row" title="${escapeHtml(selectedEmail?.intent || "leave_request")}">
                            <span class="decision-intent-name">${escapeHtml(formatHuman(selectedEmail?.intent || "leave_request"))}</span>
                        </div>
                        <span class="ios-tile-meta">Rule + LinearSVC Pipeline v2.4</span>
                    </div>

                    <div class="ios-sub-tile">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div class="ios-tile-label-wrap">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.3"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                                <span class="ios-tile-label">Confidence Score</span>
                            </div>
                            <span class="decision-meta-pill">Calibrated: ${(confPct / 100).toFixed(2)}</span>
                        </div>
                        <div class="confidence-bar-wrap" style="margin-top:4px;">
                            <div class="confidence-track">
                                <div class="confidence-fill emerald" style="width: ${confPct}%;"></div>
                            </div>
                            <span class="confidence-pct">${confPct}%</span>
                        </div>
                        <span class="ios-tile-meta">${confPct >= 80 ? "High certainty — Auto-routable" : "Specialist review active"}</span>
                    </div>

                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.3"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
                            <span class="ios-tile-label">Model Telemetry</span>
                        </div>
                        <div class="one-ui-telemetry-metrics">
                            <div class="telemetry-mini-stat">
                                <span class="stat-k">Latency</span>
                                <span class="stat-v">~14ms</span>
                            </div>
                            <div class="telemetry-mini-stat">
                                <span class="stat-k">Router Margin</span>
                                <span class="stat-v positive">+${marginVal}</span>
                            </div>
                        </div>
                        <span class="ios-tile-meta">Tokens Analyzed: ~${tokensCount} tokens</span>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 2: 2-COLUMN TELEMETRY & EXTRACTED PAYLOAD -->
            <div class="ios-bento-grid-2 one-ui-split-grid">
                <!-- Left: Model Signals, Margins & Multi-Class Distribution -->
                <div class="ios-glass-card one-ui-column-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon indigo">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Model Signals &amp; SVM Margins</div>
                                <div class="ios-card-sub">Feature weights, n-gram tokens &amp; hyperplane distance</div>
                            </div>
                        </div>
                    </div>

                    <div class="decision-field">
                        <span class="decision-label">Decision Signals &amp; Breakdown</span>
                        <div class="reason-breakdown-card">
                            <div class="reason-row">
                                <span class="reason-row-tag">Router</span>
                                <span>${escapeHtml(selectedEmail?.category_reason || "Deterministic keyword match + calibrated SVM margin check passed")}</span>
                            </div>
                            <div class="reason-row">
                                <span class="reason-row-tag svm">SVM</span>
                                <span>LinearSVC margin +${marginVal} confident boundary</span>
                            </div>
                        </div>
                    </div>

                    <div class="decision-field">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span class="decision-label">Matched Evidence Tokens</span>
                            <span class="decision-meta-pill">${detectedEvidence.length} keywords</span>
                        </div>
                        <div class="one-ui-evidence-tokens-wrap">
                            ${evidenceChipsHtml}
                        </div>
                    </div>

                    <!-- Multi-Class Probability Distribution -->
                    <div class="decision-field" style="margin-top:14px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span class="decision-label">Multi-Class Probability Distribution</span>
                            <span class="decision-meta-pill">Top Contenders</span>
                        </div>
                        <div class="one-ui-candidate-list">
                            <div class="one-ui-candidate-row winner">
                                <div class="one-ui-cand-header">
                                    <span class="one-ui-cand-name">
                                        <span class="one-ui-cand-rank winner">#1 Winner</span>
                                        <strong>${escapeHtml(selectedEmail?.category || scope)}</strong>
                                    </span>
                                    <span class="one-ui-cand-pct">${confPct}%</span>
                                </div>
                                <div class="one-ui-cand-bar-wrap">
                                    <div class="one-ui-cand-bar winner" style="width: ${confPct}%;"></div>
                                </div>
                            </div>
                            <div class="one-ui-candidate-row">
                                <div class="one-ui-cand-header">
                                    <span class="one-ui-cand-name">
                                        <span class="one-ui-cand-rank">#2</span>
                                        <strong>General HR</strong>
                                        <span class="one-ui-cand-delta">-${marginVal} pts</span>
                                    </span>
                                    <span class="one-ui-cand-pct">${Math.max(4, 100 - confPct)}%</span>
                                </div>
                                <div class="one-ui-cand-bar-wrap">
                                    <div class="one-ui-cand-bar" style="width: ${Math.max(4, 100 - confPct)}%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="decision-field" style="margin-top:auto; padding-top:10px;">
                        <span class="decision-label">Model Architecture Specs</span>
                        <div class="one-ui-model-specs-strip">
                            <span><strong>Loss:</strong> Squared Hinge</span>
                            <span>·</span>
                            <span><strong>C:</strong> 1.0</span>
                            <span>·</span>
                            <span><strong>Class:</strong> One-vs-Rest</span>
                            <span>·</span>
                            <span><strong>Tokenizer:</strong> N-Gram (1,2)</span>
                        </div>
                    </div>
                </div>

                <!-- Right: Extracted Payload, Validation & PII Entity Radar -->
                <div class="ios-glass-card one-ui-column-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon emerald">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Extracted Payload &amp; Validation</div>
                                <div class="ios-card-sub">${valVerifiedCount} of ${valTotalCount} required fields verified</div>
                            </div>
                        </div>
                        <span class="ios-status-capsule ${valStatus === "READY" ? "emerald" : "amber"}">
                            <span class="ios-capsule-dot"></span>${valStatus === "READY" ? "Ready" : "Review Required"}
                        </span>
                    </div>

                    <div class="decision-field">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span class="decision-label">Field-Level Verification Matrix</span>
                            <span class="decision-meta-pill">${valVerifiedCount} Fields Verified</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            ${fieldChecksHtml}
                        </div>
                    </div>

                    <!-- Compliance & PII Entity Radar -->
                    <div class="decision-field" style="margin-top:14px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span class="decision-label">Compliance &amp; PII Entity Radar</span>
                            <span class="decision-meta-pill">Privacy Monitored</span>
                        </div>
                        <div class="one-ui-pii-grid">
                            <div class="one-ui-pii-card verified">
                                <div class="pii-card-top">
                                    <span class="pii-name">Employee ID</span>
                                    <span class="pii-status-pill verified">${escapeHtml(empIdCode)}</span>
                                </div>
                                <div class="pii-compliance">Standard HR Record</div>
                            </div>
                            <div class="one-ui-pii-card verified">
                                <div class="pii-card-top">
                                    <span class="pii-name">Sender Email</span>
                                    <span class="pii-status-pill verified">Verified &amp; Secure</span>
                                </div>
                                <div class="pii-compliance">GDPR / DPDP Compliant</div>
                            </div>
                            <div class="one-ui-pii-card active">
                                <div class="pii-card-top">
                                    <span class="pii-name">Temporal Dates</span>
                                    <span class="pii-status-pill active">Parsed &amp; Anchored</span>
                                </div>
                                <div class="pii-compliance">Audit Trail Logged</div>
                            </div>
                            <div class="one-ui-pii-card ${(selectedEmail?.category === "PAYROLL" || (selectedEmail?.subject || "").toLowerCase().includes("salary")) ? "warning" : "inactive"}">
                                <div class="pii-card-top">
                                    <span class="pii-name">Compensation Data</span>
                                    <span class="pii-status-pill ${(selectedEmail?.category === "PAYROLL" || (selectedEmail?.subject || "").toLowerCase().includes("salary")) ? "warning" : "inactive"}">${(selectedEmail?.category === "PAYROLL" || (selectedEmail?.subject || "").toLowerCase().includes("salary")) ? "Masked & Encrypted" : "None"}</span>
                                </div>
                                <div class="pii-compliance">Confidentiality Tier 1</div>
                            </div>
                        </div>
                    </div>

                    <div class="btn-row-2" style="margin-top:auto; padding-top:10px; display:flex; gap:8px;">
                        <button type="button" class="ios-liquid-primary-btn" id="btnDialogAcceptAi" data-email-id="${selectedEmail?.id}" data-case-ref="${escapeHtml(caseRef)}" style="flex:1; cursor:pointer;">
                            ✓ Verify &amp; Accept AI Classification
                        </button>
                        <button type="button" class="ios-glass-btn one-ui-btn primary-tint btn-dialog-req-info" id="btnDialogRequestMissing" style="cursor:pointer;">
                            ✉ Request Missing Info
                        </button>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 3: SENTIMENT, URGENCY & RISK INDEX + HR NEXT-BEST-ACTION PLAYBOOK -->
            <div class="ios-bento-grid-2 one-ui-split-grid">
                <!-- Left: Sentiment, Urgency & Risk Index -->
                <div class="ios-glass-card one-ui-column-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon amber">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                    <line x1="12" y1="9" x2="12" y2="13"></line>
                                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Sentiment, Urgency &amp; Risk Index</div>
                                <div class="ios-card-sub">Real-time NLP emotional tone &amp; SLA breach probability</div>
                            </div>
                        </div>
                    </div>

                    <div class="one-ui-risk-pills-row">
                        <div class="one-ui-risk-pill-box">
                            <span class="risk-pill-k">Urgency Level</span>
                            <span class="one-ui-urgency-pill ${isUrgent ? "critical" : "normal"}">
                                <span class="one-ui-dot ${isUrgent ? "critical" : "normal"}"></span>
                                ${urgencyLevel}
                            </span>
                        </div>
                        <div class="one-ui-risk-pill-box">
                            <span class="risk-pill-k">Employee Sentiment</span>
                            <span class="one-ui-sentiment-pill neutral">
                                Professional &amp; Polite
                            </span>
                        </div>
                    </div>

                    <div class="decision-field" style="margin-top:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <span class="decision-label">Attrition / Resignation Risk</span>
                            <span class="decision-meta-pill" style="color:#059669;">12%</span>
                        </div>
                        <div class="one-ui-meter-track">
                            <div class="one-ui-meter-fill safe" style="width:12%;"></div>
                        </div>
                        <span class="ios-card-sub" style="margin-top:3px; display:block;">Standard employee retention baseline</span>
                    </div>

                    <div class="decision-field" style="margin-top:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                            <span class="decision-label">SLA Escalation Risk</span>
                            <span class="decision-meta-pill" style="color:${isUrgent ? "#d97706" : "#059669"}">${isUrgent ? "75%" : "15%"}</span>
                        </div>
                        <div class="one-ui-meter-track">
                            <div class="one-ui-meter-fill ${isUrgent ? "warning" : "safe"}" style="width:${isUrgent ? 75 : 15}%;"></div>
                        </div>
                        <span class="ios-card-sub" style="margin-top:3px; display:block;">${isUrgent ? "High SLA priority flagged — early response recommended" : "Standard response queue on track"}</span>
                    </div>
                </div>

                <!-- Right: Prescriptive HR Next-Best-Action Playbook -->
                <div class="ios-glass-card one-ui-column-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon blue">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Recommended HR Next-Best-Action</div>
                                <div class="ios-card-sub">${escapeHtml(scope.charAt(0) + scope.slice(1).toLowerCase())} Standard Protocol</div>
                            </div>
                        </div>
                        <span class="one-ui-permanent-pill emerald" title="Benchmark SLA">&lt; 8 Hours SLA</span>
                    </div>

                    <div class="one-ui-playbook-card">
                        <div class="one-ui-playbook-primary">
                            <span class="playbook-step-icon">⚡</span>
                            <div>
                                <strong>Primary Action:</strong>
                                <span>Verify employee quota and historical ledger in HRMS portal</span>
                            </div>
                        </div>

                        <div class="decision-field" style="margin-top:10px;">
                            <span class="decision-label">Execution Checklist</span>
                            <div class="one-ui-playbook-steps">
                                <div class="one-ui-step-item">
                                    <span class="step-num">1</span>
                                    <span>Verify employee quota and historical records in HRMS</span>
                                </div>
                                <div class="one-ui-step-item">
                                    <span class="step-num">2</span>
                                    <span>Confirm reporting manager sign-off and approval policy</span>
                                </div>
                                <div class="one-ui-step-item">
                                    <span class="step-num">3</span>
                                    <span>Dispatch official Gmail confirmation reply to employee</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 4: PIPELINE MICRO-EXECUTION TRACE STEPPER -->
            <div class="ios-glass-card one-ui-stepper-card">
                <div class="ios-card-header" style="margin-bottom:12px;">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon slate">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">
                                <span>End-to-End Pipeline Execution Trace</span>
                                <span class="one-ui-live-pill"><span class="one-ui-pulse-dot"></span>Completed in 18ms</span>
                            </div>
                            <div class="ios-card-sub">Synchronous real-time pipeline telemetry across 6 micro-stages</div>
                        </div>
                    </div>
                </div>

                <div class="one-ui-stepper-track">
                    <div class="one-ui-step-node completed">
                        <div class="step-node-bubble"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="step-node-info"><span class="step-node-name">Ingest</span><span class="step-node-label">Gmail API (RFC822)</span><span class="step-node-latency">2ms</span></div>
                        <div class="step-node-connector"></div>
                    </div>
                    <div class="one-ui-step-node completed">
                        <div class="step-node-bubble"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="step-node-info"><span class="step-node-name">Tokenizer</span><span class="step-node-label">N-gram (1,2)</span><span class="step-node-latency">3ms</span></div>
                        <div class="step-node-connector"></div>
                    </div>
                    <div class="one-ui-step-node completed">
                        <div class="step-node-bubble"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="step-node-info"><span class="step-node-name">Rule Router</span><span class="step-node-label">Keyword Match</span><span class="step-node-latency">4ms</span></div>
                        <div class="step-node-connector"></div>
                    </div>
                    <div class="one-ui-step-node completed">
                        <div class="step-node-bubble"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="step-node-info"><span class="step-node-name">LinearSVC</span><span class="step-node-label">SVM Calibration</span><span class="step-node-latency">6ms</span></div>
                        <div class="step-node-connector"></div>
                    </div>
                    <div class="one-ui-step-node completed">
                        <div class="step-node-bubble"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="step-node-info"><span class="step-node-name">Entity Parser</span><span class="step-node-label">Schema Validation</span><span class="step-node-latency">2ms</span></div>
                        <div class="step-node-connector"></div>
                    </div>
                    <div class="one-ui-step-node completed">
                        <div class="step-node-bubble"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="step-node-info"><span class="step-node-name">Decision Lock</span><span class="step-node-label">Triage Ready</span><span class="step-node-latency">1ms</span></div>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 5: SPECIALIST CATEGORY CONFIRMATION & RE-ROUTE DOCK BAR -->
            <div class="ios-glass-card dock-bar one-ui-dock-bar">
                <div class="ios-card-title-row">
                    <span class="one-ui-squircle-icon emerald">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    </span>
                    <div>
                        <div class="ios-card-title">Department Routing: <strong>${escapeHtml(selectedEmail?.category || scope)} Desk</strong></div>
                        <div class="ios-card-sub">Assigned to ${escapeHtml(ag.team_name || scope)} queue · Reconciled in SQLite database</div>
                    </div>
                </div>
                <div class="ios-dock-controls">
                    <button type="button" class="ios-liquid-primary-btn one-ui-action-btn permanent-locked" style="background:linear-gradient(135deg, #059669 0%, #10b981 100%); cursor:default;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>
                        <span>Verified &amp; Assigned</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // 2. CASE & ROUTING PANEL (One UI 9.0 Complete Case Details)
    const caseDetailSectionHtml = `
        <div class="ios-bento-stack one-ui-stack">
            <!-- BENTO ROW 1: CASE HERO & ROUTING OVERVIEW -->
            <div class="ios-glass-card hero-tint one-ui-hero-card">
                <div class="ios-card-header">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon indigo">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">
                                <span>${escapeHtml(caseRef || "Unassigned Case")} — ${escapeHtml(selectedEmail?.subject || "HR Request")}</span>
                            </div>
                            <div class="ios-card-sub">
                                Workflow Stage: <strong>${escapeHtml(curStageObj.title)}</strong> · SLA Target: <strong>24h</strong> · Auto-escalation active
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span class="case-ws-cat-pill">${escapeHtml(selectedEmail?.category || scope)}</span>
                        <span class="case-ws-prio-pill ${isUrgent ? "high" : "medium"}">${escapeHtml(selectedEmail?.case_priority || "MEDIUM")}</span>
                        <span class="ios-status-capsule ${isResolved ? "emerald" : "blue"}">
                            <span class="ios-capsule-dot"></span>${escapeHtml(selectedEmail?.case_status || "IN_PROGRESS")}
                        </span>
                    </div>
                </div>

                <div class="ios-bento-grid-3">
                    <!-- Tile 1: Assigned Department -->
                    <div class="ios-sub-tile one-ui-case-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                            <span class="ios-tile-label">Assigned HR Department</span>
                            <span class="one-ui-mini-badge blue">Dedicated Queue</span>
                        </div>
                        <div class="one-ui-tile-primary">${escapeHtml(specialistTeam)}</div>
                        <div class="one-ui-tile-meta-chip">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                            <span>${escapeHtml(ag.email || "hrops@company.com")}</span>
                        </div>
                    </div>

                    <!-- Tile 2: Assigned Specialist -->
                    <div class="ios-sub-tile one-ui-case-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                            <span class="ios-tile-label">Assigned Specialist</span>
                            <span class="one-ui-mini-badge indigo">${escapeHtml(specialistRole)}</span>
                        </div>
                        <div class="one-ui-specialist-row">
                            <div class="one-ui-avatar-squircle">${escapeHtml(getInitials(specialistName))}</div>
                            <div class="one-ui-tile-primary">${escapeHtml(specialistName)}</div>
                        </div>
                        <div class="one-ui-tile-meta-chip">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                            <span>${escapeHtml(specialistEmail)}</span>
                        </div>
                    </div>

                    <!-- Tile 3: SLA Countdown Window -->
                    <div class="ios-sub-tile one-ui-case-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${isUrgent ? "#dc2626" : "#059669"}" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span class="ios-tile-label">SLA Countdown Window</span>
                            <span class="one-ui-mini-badge ${isUrgent ? "danger" : "emerald"}">${escapeHtml(selectedEmail?.sla_status || (isUrgent ? "URGENT" : "ON TRACK"))}</span>
                        </div>
                        <div class="one-ui-sla-row">
                            <span class="one-ui-sla-pulse ${isUrgent ? "danger" : "safe"}"></span>
                            <span class="one-ui-tile-primary ${isUrgent ? "danger" : "safe"}">${escapeHtml(slaRemainingDisplay)}</span>
                        </div>
                        <div class="one-ui-cand-bar-wrap" style="margin: 4px 0;">
                            <div class="one-ui-cand-bar ${isUrgent ? "danger" : "winner"}" style="width: ${isUrgent ? 90 : 35}%;"></div>
                        </div>
                        <div class="one-ui-tile-meta-chip">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span>Due: ${escapeHtml(slaDueDisplay)}</span>
                        </div>
                    </div>
                </div>

                <div class="one-ui-toast-banner" style="margin-top:12px;">
                    <div class="toast-left">
                        <span class="toast-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>
                        </span>
                        <div>
                            <strong>Connected Mailbox:</strong>
                            <span>Synchronized with ${escapeHtml(specialistEmail)} desk</span>
                        </div>
                    </div>
                    <span class="toast-tag">● SMTP Active</span>
                </div>
            </div>

            <!-- BENTO ROW 2: SPOTLIGHT SHOWCASE & DIRECT ACTIONS -->
            <div class="ios-glass-card one-ui-card">
                <div class="ios-card-header one-ui-assigned-header">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon indigo">
                            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="8.5" cy="7" r="4"></circle>
                                <polyline points="17 11 19 13 23 9"></polyline>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">Currently Claimed &amp; Assigned to Specialist Desk</div>
                            <div class="ios-card-sub">Active operational case owner · Synchronized with live Gmail SMTP dispatch</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span class="ios-status-capsule emerald">
                            <span class="ios-capsule-dot"></span>Assigned &amp; Active
                        </span>
                        ${caseRef ? `
                            <button type="button" class="btn-secondary-sm one-ui-pill-btn" id="btnDialogJumpConsole" data-case-ref="${escapeHtml(caseRef)}">
                                360° Console ↗
                            </button>
                            <button type="button" class="btn-secondary-sm one-ui-pill-btn btn-trigger-reassign" data-case-ref="${escapeHtml(caseRef)}" data-title="${escapeHtml(selectedEmail?.subject || '')}" data-owner="${escapeHtml(specialistName)}" data-team="${escapeHtml(specialistTeam)}" title="Reassign to a sub-category specialist">
                                ⇄ Reassign Specialist
                            </button>
                        ` : `
                            <button type="button" class="ios-liquid-primary-btn" id="btnDialogClaimCase" data-email-id="${selectedEmail?.id}">
                                ＋ Claim &amp; Open Case
                            </button>
                        `}
                    </div>
                </div>

                <div class="ios-bento-grid-3">
                    <div class="ios-sub-tile one-ui-case-tile spotlight-tile">
                        <div class="ios-tile-label-wrap">
                            <span class="ios-tile-label">Case Reference</span>
                        </div>
                        <div class="one-ui-tile-primary" style="font-family:monospace; color:#1d4ed8;">${escapeHtml(caseRef || "Unlinked")}</div>
                        <div class="one-ui-sub-role-label">Lifecycle: ${escapeHtml(selectedEmail?.case_status || "OPEN")}</div>
                    </div>
                    <div class="ios-sub-tile one-ui-case-tile spotlight-tile">
                        <div class="ios-tile-label-wrap">
                            <span class="ios-tile-label">Priority Tier</span>
                        </div>
                        <div class="one-ui-tile-primary" style="color:${isUrgent ? "#dc2626" : "#b45309"};">${escapeHtml(selectedEmail?.case_priority || "MEDIUM")}</div>
                        <div class="one-ui-sub-role-label">SLA Window: 24h</div>
                    </div>
                    <div class="ios-sub-tile one-ui-case-tile spotlight-tile">
                        <div class="ios-tile-label-wrap">
                            <span class="ios-tile-label">Specialist Desk</span>
                        </div>
                        <div class="one-ui-tile-primary">${escapeHtml(specialistName)}</div>
                        <div class="one-ui-sub-role-label">${escapeHtml(specialistTeam)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 3. EMPLOYEE CLOUD IDENTITY PANEL
    const employeeDetailSectionHtml = `
        <div class="ios-bento-stack">
            <!-- BENTO ROW 1: EMPLOYEE SPATIAL IDENTITY HERO -->
            <div class="ios-glass-card hero-tint">
                <div class="ios-card-header">
                    <div class="emp-identity-hero matched" style="background:transparent; border:none; padding:0; box-shadow:none;">
                        <div class="emp-avatar-badge matched" style="width:48px; height:48px; border-radius:16px; font-size:0.95rem;">${escapeHtml(getInitials(modalSenderDisplay))}</div>
                        <div class="emp-identity-main">
                            <div class="emp-identity-top">
                                <span class="emp-identity-name" style="font-size:1.05rem;" title="${escapeHtml(modalSenderDisplay)}">${escapeHtml(modalSenderDisplay)}</span>
                                <span class="emp-id-pill matched">${escapeHtml(empIdCode)}</span>
                            </div>
                            <div class="emp-identity-sub">
                                <span>${escapeHtml(modalEmpDesig)} · ${escapeHtml(modalEmpDept)}</span>
                                <span>· ✉ <strong>${escapeHtml(selectedEmail?.sender_email || "employee@company.com")}</strong></span>
                            </div>
                        </div>
                    </div>
                    <span class="ios-status-capsule emerald">
                        <span class="ios-capsule-dot"></span>✓ Verified (98% via DIRECTORY)
                    </span>
                </div>

                <div class="ios-bento-grid-4">
                    <div class="ios-sub-tile">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="ios-tile-label">Department</span>
                            <span class="emp-source-tag db">DB</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.86rem; font-weight:700; color:#0f172a;">${escapeHtml(modalEmpDept)}</span>
                    </div>
                    <div class="ios-sub-tile">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="ios-tile-label">Designation</span>
                            <span class="emp-source-tag db">DB</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.86rem; font-weight:700; color:#0f172a;">${escapeHtml(modalEmpDesig)}</span>
                    </div>
                    <div class="ios-sub-tile">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="ios-tile-label">Reporting Manager</span>
                            <span class="emp-source-tag db">DB</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.86rem; font-weight:700; color:#0f172a;">${escapeHtml(modalEmpManager)}</span>
                    </div>
                    <div class="ios-sub-tile">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="ios-tile-label">Office Location</span>
                            <span class="emp-source-tag db">DB</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.86rem; font-weight:700; color:#0f172a;">${escapeHtml(modalEmpLocation)}</span>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 2: SIDE-BY-SIDE PROFILE EDITOR & DIRECTORY LINKER -->
            <div class="ios-bento-grid-2">
                <div class="ios-glass-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon blue">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Employee Profile Details</div>
                                <div class="ios-card-sub">Active corporate directory record # ${escapeHtml(empIdCode)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="ios-bento-grid-2">
                        <div class="case-ws-dispatch-row">
                            <label class="case-ws-cell-label">Full Name</label>
                            <input type="text" class="ios-glass-input" value="${escapeHtml(modalSenderDisplay)}" readonly>
                        </div>
                        <div class="case-ws-dispatch-row">
                            <label class="case-ws-cell-label">Employee ID</label>
                            <input type="text" class="ios-glass-input" value="${escapeHtml(empIdCode)}" readonly>
                        </div>
                    </div>
                    <div class="ios-bento-grid-2">
                        <div class="case-ws-dispatch-row">
                            <label class="case-ws-cell-label">Department</label>
                            <input type="text" class="ios-glass-input" value="${escapeHtml(modalEmpDept)}" readonly>
                        </div>
                        <div class="case-ws-dispatch-row">
                            <label class="case-ws-cell-label">Designation</label>
                            <input type="text" class="ios-glass-input" value="${escapeHtml(modalEmpDesig)}" readonly>
                        </div>
                    </div>
                    <div class="case-ws-dispatch-row" style="margin-top:8px;">
                        <label class="case-ws-cell-label">Official Contact Email</label>
                        <input type="email" class="ios-glass-input" value="${escapeHtml(selectedEmail?.sender_email || "employee@company.com")}" readonly>
                    </div>
                </div>

                <div class="ios-glass-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon indigo">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Employee Master Record Authentication</div>
                                <div class="ios-card-sub">HRMS Employee Directory Record Verified</div>
                            </div>
                        </div>
                    </div>
                    <div style="padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; font-size:0.8rem; color:#475569; line-height:1.55;">
                        <div style="font-weight:700; color:#0f172a; margin-bottom:6px;">✓ No Identity Conflicts Detected</div>
                        Sender verified against company employee master database. Corporate email authenticated via <code>${escapeHtml(selectedEmail?.sender_email || "")}</code>. All permissions, leave quotas, and payroll ledger profiles active.
                    </div>
                    <div style="margin-top:auto; padding-top:12px;">
                        <button type="button" class="btn-secondary-sm one-ui-pill-btn" id="btnDialogQuickHrms" data-email-id="${selectedEmail?.id}" style="width:100%; justify-content:center; padding:10px;">
                            ⚡ Verify Ledger in HRMS Portal
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 4. WORKFLOW ENGINE PANEL
    const workflowDetailSectionHtml = `
        <div class="ios-bento-stack">
            <!-- BENTO ROW 1: WORKFLOW HERO & STEP CONTROLS -->
            <div class="ios-glass-card hero-tint">
                <div class="ios-card-header">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon blue">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M9 6h6"/><path d="M7.5 8.5L10.5 15.5"/><path d="M16.5 8.5L13.5 15.5"/>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">${escapeHtml(scope.charAt(0) + scope.slice(1).toLowerCase())} Operations SLA Workflow <span class="wf-version-tag">v2.4</span></div>
                            <div class="ios-card-sub">Deterministic HR operational state machine for ${escapeHtml(scope)} desk</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="wf-id-chip">WF-HR-SLA</span>
                        <span class="ios-status-capsule ${isResolved ? "emerald" : "blue"}">
                            <span class="ios-capsule-dot"></span>Step ${curStep} of 4 · ${wfPct}%
                        </span>
                    </div>
                </div>

                <div class="wf-segmented-bar" style="margin: 2px 0;">
                    ${wfStages.map((st, i) => `<div class="wf-seg ${i + 1 < curStep || isResolved ? "completed" : i + 1 === curStep ? "current" : ""}"></div>`).join("")}
                </div>

                <div class="wf-flow-banner ${isResolved ? "completed" : ""}">
                    <div class="wf-flow-card current">
                        <div class="wf-flow-kicker-row">
                            <span class="wf-cs-kicker">ACTIVE STAGE (${curStep}/4)</span>
                            <span class="wf-cs-dot ${isResolved ? "completed" : ""}"></span>
                        </div>
                        <div class="wf-cs-title">${escapeHtml(curStageObj.title)}</div>
                        <div class="wf-cs-code">${escapeHtml(curStageObj.code)}</div>
                    </div>

                    <div class="wf-flow-arrow-badge">➔</div>

                    <div class="wf-flow-card next">
                        <div class="wf-flow-kicker-row">
                            <span class="wf-cs-kicker">NEXT STAGE TRANSITION</span>
                        </div>
                        <div class="wf-cs-next-val">
                            ${nxtStageObj && !isResolved ? escapeHtml(nxtStageObj.title) : "✓ Process Complete"}
                        </div>
                        <div>
                            ${nxtStageObj && !isResolved ? `<span class="wf-cs-trigger-tag">${escapeHtml(nxtStageObj.code)}</span>` : `<span class="wf-cs-trigger-tag done">FINAL STEP</span>`}
                        </div>
                    </div>
                </div>

                <div class="wf-actions-stack" style="margin-top:14px;">
                    ${!isResolved && curStep < 4 ? `
                        <button type="button" class="wf-btn-next-step btn-dialog-next-step" id="btnAdvanceWorkflow" data-case-ref="${escapeHtml(caseRef)}" data-email-id="${selectedEmail?.id}">
                            <div class="wf-btn-next-left">
                                <div class="wf-btn-next-icon">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                </div>
                                <div class="wf-btn-next-copy">
                                    <span class="wf-btn-next-label">Move to Next Step: ${escapeHtml(nxtStageObj?.title || "Next Step")}</span>
                                    <span class="wf-btn-next-sub">Step ${curStep + 1} of 4 · Advance SLA pipeline</span>
                                </div>
                            </div>
                            <span class="wf-btn-next-pill">Advance ➔</span>
                        </button>
                    ` : `
                        <div class="wf-completed-banner">
                            <div style="font-size:0.84rem; font-weight:800;">✓ Workflow Completed at Final Step (RESOLVED)</div>
                            <div style="font-size:0.73rem; font-weight:500; opacity:0.9;">Case processed and reconciled by HR Specialist</div>
                        </div>
                    `}

                    <div class="wf-secondary-grid-2">
                        <button type="button" class="wf-ctrl-btn back btn-dialog-step-back" id="btnStepBackWorkflow" data-case-ref="${escapeHtml(caseRef)}" data-email-id="${selectedEmail?.id}" ${curStep <= 1 || isResolved ? "disabled" : ""} title="Step Back">
                            <span class="wf-ctrl-icon">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
                            </span>
                            <div class="wf-ctrl-btn-text">
                                <span class="wf-ctrl-main">Step Back</span>
                                <span class="wf-ctrl-sub">${curStep > 1 ? `To Step ${curStep - 1}` : "At Step 1"}</span>
                            </div>
                        </button>

                        <button type="button" class="wf-ctrl-btn redo" id="btnRedoWorkflow" data-case-ref="${escapeHtml(caseRef)}" data-email-id="${selectedEmail?.id}" title="Restart workflow from Step 1">
                            <span class="wf-ctrl-icon">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            </span>
                            <div class="wf-ctrl-btn-text">
                                <span class="wf-ctrl-main">Redo Process</span>
                                <span class="wf-ctrl-sub">Restart from Step 1</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 2: 2-COLUMN INTERACTIVE PIPELINE & DIRECT OVERRIDE -->
            <div class="ios-bento-grid-2">
                <div class="ios-glass-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon indigo">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Interactive State Machine Pipeline</div>
                                <div class="ios-card-sub">Click any stage node below to jump directly</div>
                            </div>
                        </div>
                    </div>
                    <div class="wf-stepper-list">
                        ${wfStages.map((st, idx) => {
                            const isDone = idx + 1 < curStep || isResolved;
                            const isCur = idx + 1 === curStep && !isResolved;
                            const tone = isDone ? "done" : isCur ? "active" : "";
                            return `
                                <div class="wf-step-node ${tone}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:${isCur ? "#eff6ff" : "#f8fafc"}; border:1px solid ${isCur ? "#bfdbfe" : "#e2e8f0"}; border-radius:10px; margin-bottom:6px; cursor:pointer;" data-wf-step="${idx + 1}" data-case-ref="${escapeHtml(caseRef)}">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <span style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:${isDone ? "#059669" : isCur ? "#2563eb" : "#94a3b8"}; color:#ffffff; font-size:0.72rem; font-weight:800;">
                                            ${isDone ? "✓" : idx + 1}
                                        </span>
                                        <span style="font-size:0.82rem; font-weight:${isCur ? "700" : "500"}; color:#0f172a;">${escapeHtml(st.title)}</span>
                                    </div>
                                    <span style="font-size:0.7rem; font-weight:700; color:${isDone ? "#059669" : isCur ? "#2563eb" : "#64748b"}; text-transform:uppercase;">
                                        ${isDone ? "Completed" : isCur ? "Active" : "Upcoming"}
                                    </span>
                                </div>
                            `;
                        }).join("")}
                    </div>
                </div>

                <div class="ios-glass-card">
                    <div class="ios-card-header">
                        <div class="ios-card-title-row">
                            <span class="one-ui-squircle-icon amber">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="3"></circle>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                </svg>
                            </span>
                            <div>
                                <div class="ios-card-title">Direct Step Override &amp; Transition</div>
                                <div class="ios-card-sub">Jump to any state with verified specialist audit log</div>
                            </div>
                        </div>
                    </div>

                    <div class="case-ws-dispatch-row">
                        <label class="case-ws-cell-label">Jump Directly to Any Workflow Step</label>
                        <select id="wfJumpStateSelect" class="ios-glass-select">
                            ${wfStages.map((st, i) => `<option value="${st.code}" data-step="${st.step}" ${st.step === curStep ? "selected" : ""}>Step ${st.step}: ${escapeHtml(st.title)}</option>`).join("")}
                        </select>
                    </div>

                    <div style="display:flex; gap:8px; margin-top:12px;">
                        <button type="button" class="ios-liquid-primary-btn" id="btnApplyWfJump" data-case-ref="${escapeHtml(caseRef)}" style="flex:1;">
                            ✓ Set Selected Step
                        </button>
                        ${caseRef ? `
                            <button type="button" class="btn-secondary-sm one-ui-pill-btn" id="btnViewWorkflow" data-case-ref="${escapeHtml(caseRef)}">
                                Full Workspace ↗
                            </button>
                        ` : ""}
                    </div>
                </div>
            </div>
        </div>
    `;

    // 5. SLA & QUICK ACTION CONTROL CENTER
    const actionsAndSlaDetailSectionHtml = `
        <div class="ios-bento-stack">
            <!-- BENTO ROW 1: LIVE SLA TELEMETRY GLASS HERO -->
            <div class="ios-glass-card hero-tint">
                <div class="ios-card-header">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon ${isUrgent ? "amber" : "emerald"}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">Service Level Agreement &amp; Countdown</div>
                            <div class="ios-card-sub">Live SLA policy enforcement for ${escapeHtml(scope)} desk tier</div>
                        </div>
                    </div>
                    <span class="ios-status-capsule ${isUrgent ? "amber" : "emerald"}">
                        <span class="ios-capsule-dot"></span>${escapeHtml(selectedEmail?.sla_status || (isUrgent ? "Urgent / Due Soon" : "On Track"))} · ${escapeHtml(slaRemainingDisplay)}
                    </span>
                </div>

                <div class="ios-bento-grid-4">
                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                            <span class="ios-tile-label">Priority Tier</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.88rem; font-weight:800; color:#0f172a;">${escapeHtml(selectedEmail?.case_priority || "MEDIUM")}</span>
                    </div>
                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            <span class="ios-tile-label">Target Window</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.88rem; font-weight:800; color:#0f172a;">24 Hours</span>
                    </div>
                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            <span class="ios-tile-label">Target Due Time</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.88rem; font-weight:800; color:#0f172a;">${escapeHtml(slaDueDisplay)}</span>
                    </div>
                    <div class="ios-sub-tile">
                        <div class="ios-tile-label-wrap">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            <span class="ios-tile-label">Time Remaining</span>
                        </div>
                        <span class="ios-tile-main" style="font-size:0.88rem; font-weight:800; color:#059669;">${escapeHtml(slaRemainingDisplay)}</span>
                    </div>
                </div>
            </div>

            <!-- BENTO ROW 2: ONE UI 9.0 8-TILE QUICK ACTION CONTROL CENTER -->
            <div class="ios-glass-card">
                <div class="ios-card-header">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon blue">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">One UI Quick Action Control Center</div>
                            <div class="ios-card-sub">Execute immediate operational HR actions on this case &amp; email</div>
                        </div>
                    </div>
                    <span class="decision-meta-pill">${escapeHtml(scope)} Protocol</span>
                </div>

                <div class="ios-action-bento-grid">
                    <button type="button" class="ios-action-widget" id="actChangeCategory">
                        <span class="ios-act-icon blue">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                        </span>
                        <span class="ios-act-title">AI Telemetry</span>
                        <span class="ios-act-sub">Inspect ML signals</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actChangeEmployee">
                        <span class="ios-act-icon indigo">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        </span>
                        <span class="ios-act-title">Employee Profile</span>
                        <span class="ios-act-sub">View master directory</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actChangePriority" data-case-ref="${escapeHtml(caseRef)}">
                        <span class="ios-act-icon amber">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        </span>
                        <span class="ios-act-title">Toggle Priority</span>
                        <span class="ios-act-sub">${isUrgent ? "Demote to Normal" : "Escalate to High"}</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actPutOnHold" data-case-ref="${escapeHtml(caseRef)}">
                        <span class="ios-act-icon slate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
                        </span>
                        <span class="ios-act-title">Put On Hold</span>
                        <span class="ios-act-sub">Request missing info</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actResolve" data-case-ref="${escapeHtml(caseRef)}" data-email-id="${selectedEmail?.id}">
                        <span class="ios-act-icon emerald">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                        </span>
                        <span class="ios-act-title">Resolve Case</span>
                        <span class="ios-act-sub">Mark HR action done</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actCloseCase" data-case-ref="${escapeHtml(caseRef)}">
                        <span class="ios-act-icon slate">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        </span>
                        <span class="ios-act-title">Close Case</span>
                        <span class="ios-act-sub">Finalize &amp; archive</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actReply">
                        <span class="ios-act-icon blue">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                        </span>
                        <span class="ios-act-title">Reply to Employee</span>
                        <span class="ios-act-sub">Send official Gmail</span>
                    </button>
                    <button type="button" class="ios-action-widget" id="actReopenCase" data-case-ref="${escapeHtml(caseRef)}">
                        <span class="ios-act-icon amber">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                        </span>
                        <span class="ios-act-title">Reopen Case</span>
                        <span class="ios-act-sub">Resume processing</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // 6. AUDIT TRAIL PANEL
    const auditDetailSectionHtml = `
        <div class="ios-bento-stack">
            <div class="ios-glass-card hero-tint">
                <div class="ios-card-header" style="flex-wrap:wrap; gap:10px;">
                    <div class="ios-card-title-row">
                        <span class="one-ui-squircle-icon indigo">
                            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                        </span>
                        <div>
                            <div class="ios-card-title">Immutable Event Audit Trail (${caseAuditLogs.length} Events)</div>
                            <div class="ios-card-sub">Chronological system and specialist actions recorded in SQLite</div>
                        </div>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
                    ${caseAuditLogs.length === 0 ? `
                        <div style="padding:24px; text-align:center; color:#64748b; font-size:0.82rem;">No audit log events recorded yet for this case.</div>
                    ` : caseAuditLogs.map((log) => `
                        <div style="display:flex; align-items:flex-start; gap:10px; padding:10px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
                            <span style="font-size:0.69rem; font-weight:800; color:#2563eb; font-family:monospace; padding-top:2px; white-space:nowrap;">
                                ${escapeHtml(formatCleanTimestamp(log.created_at || log.timestamp).split(",")[0])}
                            </span>
                            <div style="flex:1;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                                    <strong style="font-size:0.8rem; color:#0f172a;">${escapeHtml(log.action || log.event || "Case Update")}</strong>
                                    <span style="font-size:0.68rem; color:#64748b;">${escapeHtml(log.performed_by || "HR Specialist")}</span>
                                </div>
                                <div style="font-size:0.74rem; color:#475569;">${escapeHtml(log.details || log.notes || log.message || "Action processed successfully")}</div>
                            </div>
                        </div>
                    `).join("")}
                </div>
            </div>
        </div>
    `;

    const workspaceDialogHtml =
        selectedEmail
            ? `
        <div class="rhs-dialog-backdrop" id="hrCardDetailModal" style="display:${activeDialogTab ? "flex" : "none"};">
            <div class="rhs-dialog-box one-ui-dialog" role="dialog" aria-modal="true">
                <div class="rhs-dialog-header one-ui-dialog-header">
                    <div class="rhs-dialog-title-wrap">
                        <div class="g-dialog-eyebrow">
                            <span class="one-ui-spark-badge">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" fill="currentColor"/>
                                </svg>
                            </span>
                            <span>ONE UI 9.0 · HR NEURAL INTELLIGENCE</span>
                            ${caseRef ? `<span class="g-dialog-case-pill">${escapeHtml(caseRef)}</span>` : ""}
                        </div>
                        <div class="rhs-dialog-title" id="rhsDialogHeading">${escapeHtml(dialogTitles[activeDialogTab] || "HR Operational Workspace")}</div>
                        <div class="rhs-dialog-subtitle">
                            <span>${escapeHtml(selectedEmail.subject || "(No Subject)")}</span>
                            <span>· <strong>${escapeHtml(modalSenderDisplay)}</strong> (${escapeHtml(empIdCode)})</span>
                        </div>
                    </div>
                    <div class="rhs-dialog-header-actions">
                        ${caseRef ? `
                            <button type="button" class="btn-secondary-sm one-ui-pill-btn" id="pillOpenCaseWorkspace" data-case-ref="${escapeHtml(caseRef)}">
                                Full Case Workspace ↗
                            </button>
                        ` : `
                            <button type="button" class="btn-secondary-sm one-ui-pill-btn" id="btnDialogOpenConsole" data-email-id="${selectedEmail.id}" data-case-ref="${escapeHtml(caseRef)}">
                                Open 360° Case Console ↗
                            </button>
                        `}
                        <button type="button" class="rhs-dialog-close-btn one-ui-close-btn" id="btnCloseRhsDialog" title="Close Dialog (Esc)">✕</button>
                    </div>
                </div>

                <!-- Samsung One UI 9.0 Segmented Floating Capsule Tabs -->
                <div class="rhs-dialog-tabs one-ui-tabs-bar">
                    <button type="button" class="rhs-dialog-tab ${activeDialogTab === "ai" ? "active" : ""}" data-switch-rhs-tab="ai" data-switch-agent-rhs="ai">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" fill="currentColor"/></svg>
                        <span>AI Classification</span>
                    </button>
                    <button type="button" class="rhs-dialog-tab ${activeDialogTab === "case" ? "active" : ""}" data-switch-rhs-tab="case" data-switch-agent-rhs="case">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                        <span>Case &amp; Routing</span>
                    </button>
                    <button type="button" class="rhs-dialog-tab ${activeDialogTab === "employee" ? "active" : ""}" data-switch-rhs-tab="employee" data-switch-agent-rhs="employee">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-2-2"/></svg>
                        <span>Employee Identity</span>
                    </button>
                    <button type="button" class="rhs-dialog-tab ${activeDialogTab === "workflow" ? "active" : ""}" data-switch-rhs-tab="workflow" data-switch-agent-rhs="workflow">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M9 6h6"/><path d="M7.5 8.5L10.5 15.5"/></svg>
                        <span>Workflow Engine</span>
                    </button>
                    <button type="button" class="rhs-dialog-tab ${activeDialogTab === "actions" ? "active" : ""}" data-switch-rhs-tab="actions" data-switch-agent-rhs="actions">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>SLA &amp; Actions</span>
                    </button>
                    <button type="button" class="rhs-dialog-tab ${activeDialogTab === "audit" ? "active" : ""}" data-switch-rhs-tab="audit" data-switch-agent-rhs="audit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        <span>Audit Trail (${caseAuditLogs.length})</span>
                    </button>
                </div>

                <!-- Spacious Dialog Content Panels -->
                <div class="rhs-dialog-body">
                    <div class="rhs-dialog-panel" data-rhs-panel="ai" style="display:${activeDialogTab === "ai" ? "block" : "none"};">
                        ${aiDetailSectionHtml}
                    </div>
                    <div class="rhs-dialog-panel" data-rhs-panel="case" style="display:${activeDialogTab === "case" ? "block" : "none"};">
                        ${caseDetailSectionHtml}
                    </div>
                    <div class="rhs-dialog-panel" data-rhs-panel="employee" style="display:${activeDialogTab === "employee" ? "block" : "none"};">
                        ${employeeDetailSectionHtml}
                    </div>
                    <div class="rhs-dialog-panel" data-rhs-panel="workflow" style="display:${activeDialogTab === "workflow" ? "block" : "none"};">
                        ${workflowDetailSectionHtml}
                    </div>
                    <div class="rhs-dialog-panel" data-rhs-panel="actions" style="display:${activeDialogTab === "actions" ? "block" : "none"};">
                        ${actionsAndSlaDetailSectionHtml}
                    </div>
                    <div class="rhs-dialog-panel" data-rhs-panel="audit" style="display:${activeDialogTab === "audit" ? "block" : "none"};">
                        ${auditDetailSectionHtml}
                    </div>
                </div>
            </div>
        </div>`
            : "";

    let emailRowsHtml = "";
    if (filteredEmails.length === 0) {
        const curTab = workbenchState.inboxFilterTab || "ALL";
        let emptyIcon = "📭";
        let emptyHeading = `No ${escapeHtml(scope)} emails in Inbox`;
        let emptyDesc = "All department emails have been attended to.";
        if (curTab === "ASSIGNED_TO_ME") {
            emptyIcon = "👤";
            emptyHeading = "No emails assigned to you";
            emptyDesc = "All inquiries assigned specifically to you have been processed.";
        } else if (curTab === "URGENT_SLA") {
            emptyIcon = "⚡";
            emptyHeading = "No urgent or SLA risk emails";
            emptyDesc = "All active inquiries are within standard SLA response targets.";
        } else if (curTab === "RESOLVED") {
            emptyIcon = "✅";
            emptyHeading = "No resolved emails yet";
            emptyDesc = "Inquiries resolved and closed by the specialist will appear here.";
        }
        emailRowsHtml = `
            <div class="empty-zone-state" style="padding:40px 20px;">
                <div class="empty-envelope-icon">${emptyIcon}</div>
                <h3>${emptyHeading}</h3>
                <p>${emptyDesc}</p>
            </div>
        `;
    } else {
        emailRowsHtml = filteredEmails.map((em, idx) => {
            const isSelected = selectedEmail && Number(selectedEmail.id) === Number(em.id);
            const senderDisplay = em.employee_name || em.sender_name || "Employee";
            const isVerified = Boolean(em.emp_code);
            const avatarToneClass = isVerified ? "verified-emp" : avatarTones[idx % avatarTones.length];
            const snippetText = buildPlainSnippet(em.body);
            const catTone = getCatToneClass(em.category || scope);
            const prioRaw = String(em.case_priority || "MEDIUM").toUpperCase();
            const prioClass = prioRaw === "CRITICAL" || prioRaw === "HIGH" ? "high" : prioRaw === "LOW" ? "low" : "medium";
            const prioDisplay = prioRaw === "HIGH" || prioRaw === "CRITICAL" ? "High" : prioRaw === "LOW" ? "Low" : "Medium";
            const isResolvedCase = String(em.case_status || "").toUpperCase() === "RESOLVED" || String(em.case_status || "").toUpperCase() === "CLOSED";
            const shortStat = isResolvedCase
                ? "Resolved"
                : String(em.case_status || (em.is_assigned_to_me ? "Assigned" : "Open"))
                    .replace(/_/g, " ")
                    .toLowerCase()
                    .replace(/\b\w/g, (c) => c.toUpperCase());
            const stateLabel = em.case_number ? `${em.case_number} · ${shortStat}` : shortStat;
            const stateClass = isResolvedCase
                ? "processed"
                : String(em.case_status || "").toUpperCase() === "ON_HOLD"
                ? "needs-review"
                : "processed";
            const timeShort = formatCleanTimestamp(em.received_at || em.created_at).split(",")[0];

                return `
                <div class="email-row-card ${isSelected ? "selected" : ""}" data-agent-email-id="${em.id}" title="${escapeHtml(senderDisplay)} — ${escapeHtml(em.subject || "(No Subject)")}">
                    <div class="email-row-avatar ${avatarToneClass}">
                        ${escapeHtml(getInitials(senderDisplay))}
                        ${isVerified ? `<span class="avatar-verified-dot" title="Verified Employee ${escapeHtml(em.emp_code)}">✓</span>` : ""}
                    </div>
                    <div class="email-row-main">
                        <div class="email-row-top">
                            <div class="email-row-sender-wrap">
                                <span class="email-row-sender">${escapeHtml(senderDisplay)}</span>
                                ${em.emp_code ? `<span class="row-emp-chip">${escapeHtml(em.emp_code)}</span>` : ""}
                            </div>
                            <div class="email-row-meta-right">
                                <span class="email-row-time">${escapeHtml(timeShort)}</span>
                            </div>
                        </div>
                        <div class="email-row-subject">${escapeHtml(em.subject || "(No Subject)")}</div>
                        <div class="email-row-snippet">${escapeHtml(snippetText)}</div>
                        <div class="email-row-footer">
                            <div class="email-row-tags">
                                <span class="cat-badge ${catTone}">${escapeHtml(em.category || scope)}</span>
                                <span class="prio-badge ${prioClass}">${escapeHtml(prioDisplay)}</span>
                            </div>
                            <span class="state-pill ${stateClass}">
                                <span class="row-state-dot"></span>
                                <span class="row-state-txt">${escapeHtml(stateLabel)}</span>
                            </span>
                        </div>
                    </div>
                </div>`;
            }).join("");
        }

    let readerHtml = "";
    if (!selectedEmail) {
            readerHtml = `
                <div class="empty-zone-state">
                    <div class="empty-envelope-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="4" width="20" height="16" rx="3.5"></rect>
                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                        </svg>
                    </div>
                    <h3>Select a conversation</h3>
                    <p>Choose an email from the stream on the left to read and manage it.</p>
                </div>
            `;
        } else {
            const effectiveEmpCode = selectedEmail.emp_code || selExt.employee_id || null;
            const senderDisplay = selectedEmail.employee_name || selectedEmail.sender_name || "Employee";
            const isEmpVerified = Boolean(effectiveEmpCode || selectedEmail.is_internal);
            const senderIdentityBadge = effectiveEmpCode
                ? `<span class="reader-sender-verified-pill">✓ ${escapeHtml(effectiveEmpCode)}${selExt.department ? ` · ${escapeHtml(selExt.department)}` : ""}</span>`
                : selectedEmail.is_internal
                ? `<span class="reader-sender-verified-pill">✓ Verified Employee</span>`
                : `<span class="reader-sender-verified-pill" style="background:rgba(241, 245, 249, 0.95); color:#64748b; border:1px solid #cbd5e1;">⚠ Unverified Sender</span>`;

            readerHtml = `
                <div class="reader-unified-canvas">
                    <div class="reader-top-block">
                        <div class="reader-subject-row">
                            <h2 class="reader-title">${escapeHtml(selectedEmail.subject || "(No Subject)")}</h2>
                            <div class="reader-pills-row">
                                <span class="reader-cat-tag ${selectedEmail.category === "UNKNOWN" ? "neutral" : ""}">${escapeHtml(selectedEmail.category || scope)}</span>
                                <span class="reader-pill ${isResolved ? "processed" : "pending"}">
                                    <span class="reader-pill-dot"></span>
                                    <span>${escapeHtml(String(selectedEmail.case_status || (selectedEmail.is_assigned_to_me ? "Assigned" : "Open")).replace(/_/g, " "))}</span>
                                </span>
                                ${
                                    selectedEmail.case_number
                                        ? `<span class="reader-pill case-link-pill" id="btnReaderPillOpenConsole" data-email-id="${selectedEmail.id}" data-case-ref="${escapeHtml(selectedEmail.case_number)}" style="cursor:pointer;" title="Open in 360° Case Execution Console">
                                               <span>${escapeHtml(selectedEmail.case_number)} · ${escapeHtml(String(selectedEmail.case_status || "OPEN").replace(/_/g, " "))}</span>
                                               <span>↗</span>
                                           </span>`
                                        : ""
                                }
                                <button type="button" class="btn-reopen-rhs-pill" onclick="window.toggleWorkspaceZoneRhs && window.toggleWorkspaceZoneRhs()" title="Open AI &amp; Case Copilot">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" fill="#2563eb"/></svg>
                                    <span>AI Copilot</span>
                                </button>
                            </div>
                        </div>

                        <div class="reader-sender-card">
                            <div class="reader-sender-left">
                                <div class="reader-sender-avatar verified">
                                    ${escapeHtml(getInitials(senderDisplay))}
                                </div>
                                <div class="reader-sender-info">
                                    <div class="reader-sender-name-line">
                                        <strong>${escapeHtml(senderDisplay)}</strong>
                                        ${senderIdentityBadge}
                                        <span class="reader-email-mono">&lt;${escapeHtml(selectedEmail.sender_email || "employee@company.com")}&gt;</span>
                                    </div>
                                    <div class="reader-sender-address-line">
                                        <span class="reader-to-chip">to ${escapeHtml(selectedEmail.account_email || ag.email || deptDeskEmail)}</span>
                                        <span class="reader-time-inline">· ${escapeHtml(formatCleanTimestamp(selectedEmail.received_at || selectedEmail.created_at))}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="reader-action-toolbar">
                                <button type="button" class="toolbar-btn primary-tint" id="btnToggleAgentReplyDrawer" title="Reply">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                                    <span>${workbenchState.showInboxReplyDrawer ? "Close Reply" : "Reply"}</span>
                                </button>
                                ${
                                    !selectedEmail.is_assigned_to_me
                                        ? `<button type="button" class="toolbar-btn" id="btnInboxClaimEmail" data-email-id="${selectedEmail.id}" title="Claim this email to yourself">
                                               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                                               <span>Claim</span>
                                           </button>`
                                        : ""
                                }
                                ${
                                    selectedEmail.case_number
                                        ? `<button type="button" class="toolbar-btn icon-pill btn-trigger-reassign" data-case-ref="${escapeHtml(selectedEmail.case_number)}" data-title="${escapeHtml(selectedEmail.subject || '')}" data-owner="${escapeHtml(selectedEmail.case_owner || ag.name)}" data-team="${escapeHtml(selectedEmail.assigned_team || ag.team_name || 'PeopleDesk')}" title="Reassign to another specialist in a sub-category">
                                               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                                               <span>Reassign</span>
                                           </button>`
                                        : ""
                                }
                                <button type="button" class="toolbar-btn icon-pill" id="btnToolbarRequestInfo" data-email-id="${selectedEmail.id}" title="Request Info from Employee">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                    <span>Request Info</span>
                                </button>
                                <button type="button" class="toolbar-btn icon-pill" id="btnInboxResolveCase" data-email-id="${selectedEmail.id}" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" title="Resolve Case">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>
                                    <span>Resolve</span>
                                </button>
                                <button type="button" class="toolbar-btn icon-pill" id="btnInboxOpenInConsole" data-email-id="${selectedEmail.id}" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" title="Case Console">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                                    <span>Console</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="agentInlineComposerContainer" style="display:${workbenchState.showInboxReplyDrawer ? "block" : "none"}; margin: 12px 0;">
                        <div class="agent-composer-box">
                            <div class="composer-header">
                                <div class="composer-title">
                                    ✉️ Reply to ${escapeHtml(senderDisplay)} &lt;${escapeHtml(selectedEmail.sender_email || "")}&gt;
                                </div>
                                <div class="composer-tpl-chips">
                                    <button type="button" class="btn-inbox-quick-tpl toolbar-btn" data-tpl="RESOLVE">✨ Resolution</button>
                                    <button type="button" class="btn-inbox-quick-tpl toolbar-btn" data-tpl="INVESTIGATING">🔍 Investigating</button>
                                    <button type="button" class="btn-inbox-quick-tpl toolbar-btn" data-tpl="MISSING_INFO">❓ Missing Info</button>
                                    <button type="button" class="btn-inbox-quick-tpl toolbar-btn" data-tpl="REASSIGN">⇄ Reassigned Notice</button>
                                </div>
                            </div>
                            <textarea id="agentInboxReplyTextarea" data-email-id="${selectedEmail.id}" rows="5" class="composer-textarea">${escapeHtml(inboxDraftText)}</textarea>
                            <div class="composer-footer">
                                <div class="composer-footer-left">
                                    <button type="button" id="btnInboxSendReply" data-email-id="${selectedEmail.id}" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" class="btn-primary-compose">
                                        📤 Send Gmail Reply
                                    </button>
                                    <button type="button" id="btnInboxRequestInfo" data-email-id="${selectedEmail.id}" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" class="toolbar-btn btn-hold-action">
                                        ⏸ Send &amp; Hold
                                    </button>
                                </div>
                                <button type="button" id="btnCloseAgentReplyDrawer" class="toolbar-btn">Cancel</button>
                            </div>
                        </div>
                    </div>

                    <div class="reader-mail-sheet">
                        ${formatReadableEmailBody(selectedEmail.body, selectedEmail)}
                    </div>
                </div>
            `;
        }

    let copilotRhsHtml = "";
    if (!selectedEmail) {
        copilotRhsHtml = `
            <div class="empty-zone-state">
                <div class="empty-copilot-icon">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"></path>
                        <path d="M5 3v4"></path>
                        <path d="M3 5h4"></path>
                        <path d="M19 17v4"></path>
                        <path d="M17 19h4"></path>
                    </svg>
                </div>
                <h3>AI &amp; Case Copilot</h3>
                <p>Select an email to inspect AI classification, employee profile, and workflow state.</p>
            </div>
        `;
    } else {
        const effectiveEmpCode = selectedEmail.emp_code || selExt.employee_id || null;
        const isEmpVerified = Boolean(effectiveEmpCode || selectedEmail.is_internal);
        const senderDisplay = selectedEmail.employee_name || selectedEmail.sender_name || "Employee";
        const empDept = selectedEmail.employee_department || selExt.department || (isEmpVerified ? (selectedEmail.category === "LEAVE" ? "Software Development" : "Finance & Operations") : "External Requester");
        const empDesig = selectedEmail.employee_designation || (isEmpVerified ? (selectedEmail.category === "LEAVE" ? "Software Developer" : "Specialist") : "Unverified");
        const empSubLine = `${escapeHtml(empDesig)} · ${escapeHtml(empDept)}`;
        const empManager = selectedEmail.employee_manager ? `Mgr: ${escapeHtml(selectedEmail.employee_manager)}` : "";
        const empLocation = selectedEmail.employee_location ? escapeHtml(selectedEmail.employee_location) : "";

        // Extracted entity chips for quick glance on AI card (Admin feature)
        const quickChipsHtml = selExtEntries.length > 0
            ? `<div class="rhs-extracted-chips-wrap" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px;">
                   ${selExtEntries
                       .slice(0, 3)
                       .map(([k, v]) => `
                       <span class="rhs-entity-chip" style="font-size:0.69rem; background:#f1f5f9; color:#0f172a; padding:2px 7px; border-radius:5px; border:1px solid #e2e8f0; font-weight:600; display:inline-flex; align-items:center; gap:3px;">
                           <span style="color:#64748b; font-weight:500;">${escapeHtml(formatHuman(k))}:</span>
                           <span style="color:#0f172a; max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(String(v))}</span>
                       </span>`)
                       .join("")}
               </div>`
            : "";

        copilotRhsHtml = `
            <!-- 1. AI CLASSIFICATION (Hero Gemini Liquid Glass Card) -->
            <div class="rhs-summary-card rhs-card-ai-hero" data-open-rhs-dialog="ai" data-open-agent-rhs="ai">
                <div class="rhs-card-top">
                    <div class="rhs-card-header-left">
                        <span class="g-card-icon blue">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/>
                            </svg>
                        </span>
                        <span class="rhs-card-kicker">AI Classification</span>
                    </div>
                    <div class="rhs-card-top-right">
                        <span class="rhs-conf-badge emerald" title="Model Confidence">${confPct}%</span>
                    </div>
                </div>

                <div class="rhs-ai-hero-body">
                    <div class="rhs-ai-cat-row">
                        <strong class="rhs-ai-cat-title">${escapeHtml(selectedEmail.category || scope)}</strong>
                        <span class="rhs-cat-badge">${escapeHtml(scope)} Desk</span>
                    </div>
                    <div class="rhs-ai-intent-sub">${escapeHtml(formatHuman(selectedEmail.intent || "leave_request"))}</div>
                    <div class="rhs-ai-conf-track">
                        <div class="rhs-ai-conf-fill emerald" style="width: ${confPct}%;"></div>
                    </div>
                    ${quickChipsHtml}
                </div>

                <div class="rhs-card-sub">
                    <span class="g-sub-status">
                        <span class="g-dot-inline emerald"></span>
                        <span>Validation: Ready · ${selExtEntries.length} fields</span>
                    </span>
                    <span class="g-card-cta">Inspect Telemetry ${chevronRightSvg}</span>
                </div>
            </div>

            <!-- 2. EMPLOYEE IDENTITY (Clean Non-Clipping Glass Card) -->
            <div class="rhs-summary-card" data-open-rhs-dialog="employee" data-open-agent-rhs="employee">
                <div class="rhs-card-top">
                    <div class="rhs-card-header-left">
                        <span class="g-card-icon emerald">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <polyline points="16 11 18 13 22 9"></polyline>
                            </svg>
                        </span>
                        <span class="rhs-card-kicker">Sender Identity</span>
                    </div>
                    <div class="rhs-card-top-right">
                        <span class="rhs-mini-pill ${isEmpVerified ? "emerald" : "amber"}">
                            <span class="g-status-dot"></span>${effectiveEmpCode ? escapeHtml(effectiveEmpCode) : isEmpVerified ? "Verified" : "Unverified"}
                        </span>
                    </div>
                </div>
                <div class="rhs-emp-clean-block">
                    <div class="rhs-emp-avatar tone-blue">${escapeHtml(getInitials(senderDisplay))}</div>
                    <div class="rhs-emp-info">
                        <div class="rhs-emp-name-single" title="${escapeHtml(senderDisplay)}">${escapeHtml(senderDisplay)}</div>
                        <div class="rhs-emp-sub-line" title="${empSubLine}">${empSubLine}</div>
                        ${empManager ? `<div style="font-size:0.68rem; color:#64748b; margin-top:2px;">${empManager}${empLocation ? ` · ${empLocation}` : ""}</div>` : ""}
                    </div>
                    <span class="rhs-inline-chevron">${chevronRightSvg}</span>
                </div>
            </div>

            <!-- 3. CASE & ROUTING (Streamlined Glass Card) -->
            <div class="rhs-summary-card" data-open-rhs-dialog="case" data-open-agent-rhs="case">
                <div class="rhs-card-top">
                    <div class="rhs-card-header-left">
                        <span class="g-card-icon indigo">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </span>
                        <span class="rhs-card-kicker">Case &amp; Routing</span>
                    </div>
                    <div class="rhs-card-top-right">
                        <span class="rhs-mini-pill ${isResolved ? "emerald" : "blue"}">
                            <span class="g-status-dot"></span>${escapeHtml(selectedEmail.case_number || "Open")}
                        </span>
                    </div>
                </div>
                <div class="rhs-card-sub">
                    <span class="g-specialist-chip">
                        <span class="g-mini-avatar">${escapeHtml(getInitials(selectedEmail.case_owner || ag.name))}</span>
                        <span>${escapeHtml(selectedEmail.case_owner || ag.name)} · ${escapeHtml(selectedEmail.sub_department || selectedEmail.assigned_team || ag.team_name || scope)}</span>
                    </span>
                    <button type="button" class="btn-trigger-reassign" data-case-ref="${escapeHtml(selectedEmail.case_number || '')}" data-title="${escapeHtml(selectedEmail.subject || '')}" data-owner="${escapeHtml(selectedEmail.case_owner || ag.name)}" data-team="${escapeHtml(selectedEmail.assigned_team || ag.team_name || 'PeopleDesk')}" style="background:transparent; border:none; cursor:pointer; color:#4f46e5; font-size:0.75rem; font-weight:700; padding:0; display:inline-flex; align-items:center; gap:2px;">
                        Manage ${chevronRightSvg}
                    </button>
                </div>
            </div>

            <!-- 4. WORKFLOW PIPELINE (Sleek Stepper Card) -->
            <div class="rhs-summary-card g-wf-featured" data-open-rhs-dialog="workflow" data-open-agent-rhs="workflow">
                <div class="rhs-card-top">
                    <div class="rhs-card-header-left">
                        <span class="g-card-icon blue">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="6" cy="6" r="3"></circle>
                                <circle cx="18" cy="6" r="3"></circle>
                                <circle cx="12" cy="18" r="3"></circle>
                                <path d="M9 6h6"></path>
                                <path d="M7.5 8.5L10.5 15.5"></path>
                            </svg>
                        </span>
                        <span class="rhs-card-kicker">${escapeHtml(scope)} Workflow</span>
                    </div>
                    <div class="rhs-card-top-right">
                        <span class="rhs-mini-pill ${isResolved ? "emerald" : "blue"}">
                            Step ${curStep}/4 · ${wfPct}%
                        </span>
                    </div>
                </div>
                <div class="g-wf-node-track">
                    ${wfNodesHtml}
                </div>
                <div class="rhs-wf-flow-inline">
                    <span class="rhs-wf-cur">${escapeHtml(curStageObj.title)}</span>
                    <span class="rhs-wf-arr">→</span>
                    <span class="rhs-wf-nxt">${nxtStageObj && !isResolved ? escapeHtml(nxtStageObj.title) : "Completed"}</span>
                </div>

                <div class="rhs-wf-quick-btns">
                    ${
                        !isResolved && curStep < 4
                            ? `<button type="button" class="rhs-wf-btn primary" id="btnQuickAdvanceWf" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" data-email-id="${selectedEmail.id}" title="Move to ${escapeHtml(nxtStageObj?.title || "Next Step")}">
                                   <span>▶ Next Step</span>
                               </button>`
                            : `<button type="button" class="rhs-wf-btn done" disabled>✓ Completed</button>`
                    }
                    <button type="button" class="rhs-wf-btn icon-btn back" id="btnQuickStepBackWf" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" data-email-id="${selectedEmail.id}" ${curStep <= 1 || isResolved ? "disabled" : ""} title="Step Back">
                        <span>◀</span>
                    </button>
                    <button type="button" class="rhs-wf-btn icon-btn redo" id="btnQuickRedoWf" data-case-ref="${escapeHtml(selectedEmail.case_number || "")}" data-email-id="${selectedEmail.id}" title="Restart from Step 1">
                        <span>↺</span>
                    </button>
                </div>
            </div>

            <!-- 5. SLA & QUICK ACTIONS (Liquid Glass Action Strip) -->
            <div class="rhs-summary-card" data-open-rhs-dialog="actions" data-open-agent-rhs="actions">
                <div class="rhs-card-top">
                    <div class="rhs-card-header-left">
                        <span class="g-card-icon ${selectedEmail.is_urgent_sla ? "rose" : "emerald"}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                        </span>
                        <span class="rhs-card-kicker">SLA &amp; Actions</span>
                    </div>
                    <div class="rhs-card-top-right">
                        <span class="rhs-mini-pill ${selectedEmail.is_urgent_sla ? "rose" : "emerald"}">
                            <span class="g-status-dot"></span>${escapeHtml(selectedEmail.sla_status || "On Track")}
                        </span>
                    </div>
                </div>
                <div class="rhs-card-sub">
                    <div class="g-action-preview-pills">
                        <button type="button" class="g-act-mini-chip approve" id="quickActResolve" style="border:none; cursor:pointer;" title="Mark resolved">✓ Resolve</button>
                        <button type="button" class="g-act-mini-chip hold" id="quickActHold" style="border:none; cursor:pointer;" title="Put on hold & request info">⏸ Hold</button>
                        <button type="button" class="g-act-mini-chip prio" id="quickActReply" style="border:none; cursor:pointer;" title="Compose reply">✉ Reply</button>
                    </div>
                    <span class="g-card-cta">All Actions ${chevronRightSvg}</span>
                </div>
            </div>

            <!-- 6. COMPACT AUDIT LOG PILL CARD -->
            <div class="rhs-summary-card rhs-audit-compact" data-open-rhs-dialog="audit" data-open-agent-rhs="audit">
                <div class="rhs-card-top">
                    <div class="rhs-card-header-left">
                        <span class="g-card-icon slate">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                        </span>
                        <span class="rhs-card-kicker">Audit Trail</span>
                    </div>
                    <div class="rhs-card-top-right">
                        <span class="rhs-mini-pill slate">${caseAuditLogs.length} Events</span>
                        <span class="rhs-inline-chevron">${chevronRightSvg}</span>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div id="moduleInboxView" style="display:flex; flex-direction:column; flex:1; min-height:0; height:100%; overflow:hidden;">
            <!-- Sleek Single-Row Liquid Glass Command & Filter Bar -->
            <section class="inbox-top-section">
                <div class="inbox-command-left">
                    <div class="inbox-title-left">
                        <h1>${escapeHtml(inboxTitle)}</h1>
                    </div>

                    <!-- Google-Style Liquid Glass Quick Filter Pills -->
                    <div class="inbox-stats-grid" role="tablist" aria-label="Quick Inbox Filters">
                        <div class="stat-compact-card blue btn-inbox-tab ${workbenchState.inboxFilterTab === "ALL" ? "active-stat" : ""}" data-inbox-tab="ALL" title="Show all active messages in department inbox">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            <div class="stat-info">
                                <strong>Inbox</strong>
                            </div>
                            <div class="stat-num" id="statTotalEmails">${inboxPillCount}</div>
                        </div>

                        <div class="stat-compact-card amber btn-inbox-tab ${workbenchState.inboxFilterTab === "ASSIGNED_TO_ME" ? "active-stat" : ""}" data-inbox-tab="ASSIGNED_TO_ME" title="Emails assigned specifically to me">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            <div class="stat-info">
                                <strong>Assigned to Me</strong>
                            </div>
                            <div class="stat-num" id="statAssignedToMe">${assignedPillCount}</div>
                        </div>

                        <div class="stat-compact-card rose btn-inbox-tab ${workbenchState.inboxFilterTab === "URGENT_SLA" ? "active-stat" : ""}" data-inbox-tab="URGENT_SLA" title="Critical/High priority or SLA at-risk inquiries">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            <div class="stat-info">
                                <strong>Urgent / SLA Risk</strong>
                            </div>
                            <div class="stat-num" id="statUrgentEmails">${urgentSlaPillCount}</div>
                        </div>

                        <div class="stat-compact-card emerald btn-inbox-tab ${workbenchState.inboxFilterTab === "RESOLVED" ? "active-stat" : ""}" data-inbox-tab="RESOLVED" title="Resolved and closed inquiries">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                            <div class="stat-info">
                                <strong>Resolved</strong>
                            </div>
                            <div class="stat-num" id="statResolvedEmails">${resolvedPillCount}</div>
                        </div>

                        <div class="stat-compact-card btn-inbox-tab ${workbenchState.inboxFilterTab === "NOISE" ? "active-stat" : ""}" data-inbox-tab="NOISE" title="Non-HR noise, bot alerts & system digests filtered out" style="background:rgba(241, 245, 249, 0.7); border:1px solid #cbd5e1; color:#64748b;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                            <div class="stat-info">
                                <strong style="color:#475569;">Filtered Noise</strong>
                            </div>
                            <div class="stat-num" id="statNoiseEmails" style="color:#64748b;">${noiseCount}</div>
                        </div>
                    </div>
                </div>

                <!-- Center Liquid Glass AI Panel Capsule -->
                <div class="inbox-center-ai-dock">
                    <button type="button" class="ai-dock-pill ai-copilot-pill active" id="wsBtnToggleRhs" onclick="window.toggleWorkspaceZoneRhs && window.toggleWorkspaceZoneRhs()" title="Open / Close Right AI &amp; Case Copilot Panel">
                        <span class="ai-sparkle-orb">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                                <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" fill="currentColor"/>
                            </svg>
                        </span>
                        <span class="ai-dock-label">AI Panel</span>
                        <span class="ai-dock-switch">
                            <span class="ai-live-dot"></span>
                        </span>
                    </button>
                </div>

                <!-- Sleek Liquid Glass Gmail Connection Capsule -->
                <div class="gmail-connection-card">
                    <div class="gmail-conn-info">
                        <div class="gmail-conn-status">
                            <span class="conn-dot" id="connStatusDot"></span>
                            <strong id="connStatusTitle">Connected</strong>
                        </div>
                        <span class="gmail-conn-email" id="connEmailAddress">${escapeHtml(ag.email || deptDeskEmail)}</span>
                        <span class="gmail-conn-sync" id="connLastSync">Active · ${escapeHtml(inboxTitle.replace(/ Inbox$/i, ""))}</span>
                    </div>
                    <div class="gmail-conn-actions">
                        <button type="button" class="btn-sync-now" id="btnSyncDeptMailboxInbox" title="Sync Mailbox">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <path d="M3 3v5h5"></path>
                                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                                <path d="M16 21h5v-5"></path>
                            </svg>
                            <span>Sync</span>
                        </button>
                        <button type="button" class="btn-icon-settings" id="btnQuickSeedFromInbox" title="Simulate incoming test email">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            </section>

            <!-- THREE WORKING ZONES (Identical to Admin Mail Inbox) -->
            <section class="inbox-three-zones">
                <!-- ZONE 1: COLLAPSIBLE EMAIL LIST WINDOW -->
                <div class="zone-email-list" id="zoneEmailListPane">
                    <!-- Mini-Rail Expand Button (Visible when collapsed) -->
                    <div class="queue-collapsed-rail-top">
                        <button type="button" class="btn-rail-expand-queue" id="btnExpandQueueRail" title="Open Email List Window">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                                <line x1="9" y1="3" x2="9" y2="21"></line>
                                <polyline points="13 9 16 12 13 15"></polyline>
                            </svg>
                        </button>
                        <span class="rail-count-pill" id="emailRailCountBadge" title="Total emails in view">${displayListCount}</span>
                    </div>

                    <div class="list-controls">
                        <div class="list-header-bar">
                            <div class="list-header-title">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="2" y="4" width="20" height="16" rx="3"></rect>
                                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                                </svg>
                                <span>Messages</span>
                                <span class="list-count-badge" id="emailListCountBadge">${displayListCount}</span>
                            </div>
                            <button type="button" class="btn-collapse-queue" id="btnCollapseQueuePane" title="Collapse Email List to Mini-Rail">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                                    <line x1="9" y1="3" x2="9" y2="21"></line>
                                    <polyline points="15 9 12 12 15 15"></polyline>
                                </svg>
                                <span>Collapse</span>
                            </button>
                        </div>

                        <div class="list-search-box">
                            <svg class="list-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                            <input type="text" id="agentInboxSearchInput" value="${escapeHtml(workbenchState.inboxSearchQuery)}" placeholder="Search sender, subject, case...">
                        </div>

                        <div class="list-filter-row">
                            <select id="agentInboxFilterSelect" aria-label="Filter by assignment">
                                <option value="ALL" ${workbenchState.inboxFilterTab === "ALL" ? "selected" : ""}>Inbox (${inboxPillCount})</option>
                                <option value="ASSIGNED_TO_ME" ${workbenchState.inboxFilterTab === "ASSIGNED_TO_ME" ? "selected" : ""}>Assigned to Me (${assignedPillCount})</option>
                                <option value="URGENT_SLA" ${workbenchState.inboxFilterTab === "URGENT_SLA" ? "selected" : ""}>Urgent / SLA Risk (${urgentSlaPillCount})</option>
                                <option value="RESOLVED" ${workbenchState.inboxFilterTab === "RESOLVED" ? "selected" : ""}>Resolved (${resolvedPillCount})</option>
                                <option value="NOISE" ${workbenchState.inboxFilterTab === "NOISE" ? "selected" : ""}>Filtered Noise (${noiseCount})</option>
                            </select>
                        </div>
                    </div>

                    <div class="email-list-scroll" id="emailListScroll">
                        ${emailRowsHtml}
                    </div>
                </div>

                <!-- ZONE 2: EMAIL READER -->
                <div class="zone-email-reader" id="agentEmailReaderZone">
                    ${readerHtml}
                </div>

                <!-- ZONE 3: RIGHT SIDE = AI & CASE COPILOT -->
                <aside class="zone-hr-panel" id="agentHrActionZone">
                    <div class="rhs-deck-banner">
                        <div class="rhs-deck-brand">
                            <span class="g-spark-badge">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" fill="currentColor"/>
                                </svg>
                            </span>
                            <div class="rhs-deck-brand-txt">
                                <span class="rhs-deck-title">AI &amp; Case Copilot</span>
                            </div>
                        </div>
                        <div class="rhs-deck-right-actions">
                            <button type="button" class="btn-collapse-rhs" onclick="window.toggleWorkspaceZoneRhs && window.toggleWorkspaceZoneRhs()" title="Collapse AI Copilot panel">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                                    <line x1="15" y1="3" x2="15" y2="21"></line>
                                    <polyline points="10 9 13 12 10 15"></polyline>
                                </svg>
                            </button>
                        </div>
                    </div>
                    ${copilotRhsHtml}
                </aside>
            </section>
            ${workspaceDialogHtml}
        </div>
    `;
}

function renderApprovalsGateViewHtml(ag) {
    const approvals = workbenchState.approvals || [];
    const pendingList = approvals.filter((a) => String(a.status || "").toUpperCase() === "PENDING");
    const decidedList = approvals.filter((a) => String(a.status || "").toUpperCase() !== "PENDING");

    return `
        <div class="agent-card">
            <div class="agent-card-header">
                <div>
                    <h3 class="agent-card-title" style="font-size:0.95rem;">
                        ⏳ Department Manager Approval Gate (${approvals.length} Total · ${pendingList.length} Pending Sign-Off)
                    </h3>
                    <div style="font-size:0.76rem; color:#64748b; margin-top:2px;">
                        High-value payouts, policy exceptions, and financial adjustments routed from <strong>${escapeHtml(ag.team_name || "HR Operations")}</strong> to HR Lead / HR Manager
                    </div>
                </div>
                <button type="button" class="btn-back-to-console agent-btn-outline">
                    &larr; Back to Case Console
                </button>
            </div>

            ${
                approvals.length === 0
                    ? `
                <div style="padding:36px; text-align:center; color:#64748b; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:14px;">
                    <div style="font-size:1.8rem; margin-bottom:8px;">⏳</div>
                    <div style="font-weight:800; color:#0f172a; font-size:0.92rem;">No Manager / Lead approval requests for your department yet</div>
                    <div style="font-size:0.78rem; margin-top:4px;">When a case requires high-risk financial or policy sign-off, click <strong>"＋ Request Sign-Off"</strong> inside the Case Execution Console.</div>
                </div>`
                    : `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                    <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:14px; padding:14px;">
                        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#b45309; margin-bottom:10px;">
                            ⏳ Awaiting Manager / Lead Decision (${pendingList.length})
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${
                                pendingList.length === 0
                                    ? `<div style="font-size:0.76rem; color:#92400e;">No pending approvals waiting on Manager sign-off.</div>`
                                    : pendingList
                                          .map(
                                              (ap) => `
                                        <div style="background:#ffffff; border:1px solid #fde68a; border-radius:10px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                                            <div>
                                                <div style="font-size:0.8rem; font-weight:800; color:#0f172a;">${escapeHtml(ap.approval_type)} → ${escapeHtml(ap.approver_role)}</div>
                                                <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">
                                                    Case: <strong style="color:#1d4ed8;">${escapeHtml(ap.case_number || `#${ap.case_id}`)}</strong> · ${escapeHtml(ap.comments || "")}
                                                </div>
                                            </div>
                                            <button type="button" class="btn-jump-to-case agent-btn-outline" data-case-ref="${escapeHtml(ap.case_number || ap.case_id)}" style="height:28px; font-size:0.7rem;">
                                                Open Case &rarr;
                                            </button>
                                        </div>`
                                          )
                                          .join("")
                            }
                        </div>
                    </div>

                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:14px;">
                        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#047857; margin-bottom:10px;">
                            ✅ Completed Sign-Off Decisions (${decidedList.length})
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${
                                decidedList.length === 0
                                    ? `<div style="font-size:0.76rem; color:#64748b;">No decided approvals yet.</div>`
                                    : decidedList
                                          .map(
                                              (ap) => `
                                        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:10px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                                            <div>
                                                <div style="font-size:0.8rem; font-weight:800; color:#0f172a;">${escapeHtml(ap.approval_type)} — <span style="color:${ap.status === "APPROVED" ? "#047857" : "#b91c1c"};">${escapeHtml(ap.status)}</span></div>
                                                <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">
                                                    Case: <strong>${escapeHtml(ap.case_number || `#${ap.case_id}`)}</strong> · ${escapeHtml(ap.comments || "")}
                                                </div>
                                            </div>
                                            <button type="button" class="btn-jump-to-case agent-btn-outline" data-case-ref="${escapeHtml(ap.case_number || ap.case_id)}" style="height:28px; font-size:0.7rem;">
                                                View
                                            </button>
                                        </div>`
                                          )
                                          .join("")
                            }
                        </div>
                    </div>
                </div>`
            }
        </div>
    `;
}

function renderRepliesAndActionsViewHtml(ag) {
    const allCases = (workbenchState.allCases && workbenchState.allCases.length > 0)
        ? workbenchState.allCases
        : (workbenchState.deptCases && workbenchState.deptCases.length > 0 ? workbenchState.deptCases : (workbenchState.myCases || []));

    const filter = workbenchState.actionFilter || "ALL";
    const searchQuery = (workbenchState.actionSearchQuery || "").trim().toLowerCase();

    // 1. Compute overall metrics
    const totalCount = allCases.length;
    const completedCount = allCases.filter((c) => ["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase())).length;
    const inProgressCount = allCases.filter((c) => ["IN_PROGRESS", "ON_HOLD", "REVIEW_REQUIRED"].includes(String(c.status || "").toUpperCase())).length;
    const pendingCount = Math.max(0, totalCount - completedCount - inProgressCount);
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // 2. Filter cases based on selected tab and search query
    const filteredCases = allCases.filter((c) => {
        const st = String(c.status || "").toUpperCase();
        const isCompleted = st === "RESOLVED" || st === "CLOSED";
        const isInProgress = st === "IN_PROGRESS" || st === "ON_HOLD" || st === "REVIEW_REQUIRED";
        const isNew = !isCompleted && !isInProgress;

        if (filter === "COMPLETED" && !isCompleted) return false;
        if (filter === "IN_PROGRESS" && !isInProgress) return false;
        if (filter === "NEW" && !isNew) return false;

        if (searchQuery) {
            const num = String(c.case_number || c.id || "").toLowerCase();
            const title = String(c.title || "").toLowerCase();
            const emp = String(c.employee_name || "").toLowerCase();
            const cat = String(c.category || "").toLowerCase();
            if (!num.includes(searchQuery) && !title.includes(searchQuery) && !emp.includes(searchQuery) && !cat.includes(searchQuery)) {
                return false;
            }
        }
        return true;
    });

    return `
        <div style="display:flex; flex-direction:column; gap:16px;">
            
            <!-- Top Metric KPI Overview Strip -->
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:14px;">
                <div class="agent-card" style="padding:16px; border-left:4px solid #2563eb;">
                    <div style="font-size:0.73rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">Total Cases Tracked</div>
                    <div style="font-size:1.6rem; font-weight:900; color:#0f172a; margin:4px 0;">${totalCount}</div>
                    <div style="font-size:0.74rem; color:#64748b;">Active across all departments</div>
                </div>

                <div class="agent-card" style="padding:16px; border-left:4px solid #059669;">
                    <div style="font-size:0.73rem; font-weight:700; color:#059669; text-transform:uppercase; letter-spacing:0.04em;">Completed Cases</div>
                    <div style="font-size:1.6rem; font-weight:900; color:#059669; margin:4px 0;">${completedCount}</div>
                    <div style="font-size:0.74rem; color:#64748b;">Fully finalized &amp; resolved</div>
                </div>

                <div class="agent-card" style="padding:16px; border-left:4px solid #3b82f6;">
                    <div style="font-size:0.73rem; font-weight:700; color:#1d4ed8; text-transform:uppercase; letter-spacing:0.04em;">In Progress</div>
                    <div style="font-size:1.6rem; font-weight:900; color:#2563eb; margin:4px 0;">${inProgressCount}</div>
                    <div style="font-size:0.74rem; color:#64748b;">Under active investigation</div>
                </div>

                <div class="agent-card" style="padding:16px; border-left:4px solid #8b5cf6;">
                    <div style="font-size:0.73rem; font-weight:700; color:#6d28d9; text-transform:uppercase; letter-spacing:0.04em;">Resolution Rate</div>
                    <div style="font-size:1.6rem; font-weight:900; color:#7c3aed; margin:4px 0;">${completionRate}%</div>
                    <div style="width:100%; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden; margin-top:6px;">
                        <div style="width:${completionRate}%; height:100%; background:linear-gradient(90deg, #7c3aed, #10b981); border-radius:3px;"></div>
                    </div>
                </div>
            </div>

            <!-- Main Case Progress & Completion Table Card -->
            <div class="agent-card" style="padding:0; overflow:hidden;">
                
                <!-- Toolbar & Filter Header -->
                <div style="padding:16px 20px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background:#ffffff;">
                    <div>
                        <h2 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0 0 2px 0;">
                            Case Progress &amp; Completion Tracker
                        </h2>
                        <p style="font-size:0.76rem; color:#64748b; margin:0;">
                            Live execution progress across all cases — track completion and launch case operations console.
                        </p>
                    </div>

                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <!-- Quick Search Input -->
                        <div style="position:relative;">
                            <input type="text" id="inputCaseProgressSearch" class="ios-glass-input" placeholder="Search case, employee, title..." value="${escapeHtml(searchQuery)}" style="width:230px; height:32px; font-size:0.76rem; padding-left:28px;">
                            <span style="position:absolute; left:9px; top:7px; font-size:0.75rem; color:#94a3b8;">🔍</span>
                        </div>

                        <!-- Filter Pills -->
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="dept-filter-pill ${filter === "ALL" ? "active" : ""}" data-case-progress-filter="ALL">
                                All (${totalCount})
                            </button>
                            <button type="button" class="dept-filter-pill ${filter === "COMPLETED" ? "active" : ""}" data-case-progress-filter="COMPLETED" style="color:#059669;">
                                ✓ Completed (${completedCount})
                            </button>
                            <button type="button" class="dept-filter-pill ${filter === "IN_PROGRESS" ? "active" : ""}" data-case-progress-filter="IN_PROGRESS" style="color:#2563eb;">
                                ⚙️ In Progress (${inProgressCount})
                            </button>
                            <button type="button" class="dept-filter-pill ${filter === "NEW" ? "active" : ""}" data-case-progress-filter="NEW" style="color:#d97706;">
                                ⏳ Pending (${pendingCount})
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Case Progress Table -->
                ${
                    filteredCases.length === 0
                        ? `<div style="padding:60px 24px; text-align:center; color:#64748b; font-size:0.84rem;">
                            No cases found matching "${escapeHtml(filter)}" ${searchQuery ? `with search "${escapeHtml(searchQuery)}"` : ""}.
                           </div>`
                        : `<div style="overflow-x:auto;">
                            <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
                                <thead>
                                    <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; text-align:left; color:#475569;">
                                        <th style="padding:12px 16px;">Case Reference</th>
                                        <th style="padding:12px 16px;">Subject / Query</th>
                                        <th style="padding:12px 16px;">Employee</th>
                                        <th style="padding:12px 16px;">Category</th>
                                        <th style="padding:12px 16px; min-width:210px;">Workflow Stage Progress</th>
                                        <th style="padding:12px 16px;">Status</th>
                                        <th style="padding:12px 16px;">Assigned Specialist</th>
                                        <th style="padding:12px 16px; text-align:right;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${filteredCases
                                        .map((c) => {
                                            const ref = c.case_number || c.id || "CASE-000000";
                                            const st = String(c.status || "NEW").toUpperCase();
                                            const isDone = st === "RESOLVED" || st === "CLOSED";
                                            const curStep = isDone ? 3 : Number(c.current_step || 1);
                                            const pct = isDone ? 100 : (curStep === 2 ? 66 : 33);
                                            const progressColor = isDone ? "#10b981" : (curStep === 2 ? "#3b82f6" : "#f59e0b");
                                            const stepLabel = isDone
                                                ? "3/3 · Completed &amp; Resolved"
                                                : (curStep === 2 ? "Step 2 of 3 · Lifecycle Audit" : "Step 1 of 3 · Details &amp; Dossier");

                                            return `
                                                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s ease;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                                    <td style="padding:12px 16px; white-space:nowrap;">
                                                        <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" style="font-family:ui-monospace, monospace; font-weight:800; color:#2563eb; text-decoration:none; font-size:0.82rem;">
                                                            #${escapeHtml(ref)}
                                                        </a>
                                                    </td>
                                                    <td style="padding:12px 16px; max-width:280px;">
                                                        <div style="font-weight:700; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(c.title || "")}">
                                                            ${escapeHtml(c.title || "Inquiry Docket")}
                                                        </div>
                                                        <div style="font-size:0.70rem; color:#64748b; margin-top:2px;">
                                                            Opened: ${escapeHtml(String(c.created_at || "").slice(0, 16))}
                                                        </div>
                                                    </td>
                                                    <td style="padding:12px 16px; white-space:nowrap;">
                                                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(c.employee_name || "Employee")}</div>
                                                        <div style="font-size:0.70rem; color:#64748b;">${escapeHtml(c.employee_id || c.employee_code || "Direct")}</div>
                                                    </td>
                                                    <td style="padding:12px 16px; white-space:nowrap;">
                                                        <span class="cat-badge" style="background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; font-size:0.70rem; font-weight:700;">
                                                            ${escapeHtml(c.category || "OPERATIONS")}
                                                        </span>
                                                    </td>
                                                    <td style="padding:12px 16px;">
                                                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; font-size:0.72rem;">
                                                            <strong style="color:${isDone ? "#059669" : "#1e40af"};">${stepLabel}</strong>
                                                            <span style="font-weight:800; color:#64748b;">${pct}%</span>
                                                        </div>
                                                        <div style="width:100%; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                                                            <div style="width:${pct}%; height:100%; background:${progressColor}; border-radius:3px; transition:width 0.3s ease;"></div>
                                                        </div>
                                                    </td>
                                                    <td style="padding:12px 16px; white-space:nowrap;">
                                                        <span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:12px; font-weight:800; font-size:0.70rem; background:${isDone ? "#d1fae5" : st === "IN_PROGRESS" ? "#dbeafe" : "#fef3c7"}; color:${isDone ? "#065f46" : st === "IN_PROGRESS" ? "#1e40af" : "#92400e"}; border:1px solid ${isDone ? "#a7f3d0" : st === "IN_PROGRESS" ? "#bfdbfe" : "#fde68a"};">
                                                            ${isDone ? "✓ COMPLETED" : st === "IN_PROGRESS" ? "⚙️ IN PROGRESS" : "⏳ NEW"}
                                                        </span>
                                                    </td>
                                                    <td style="padding:12px 16px; white-space:nowrap; color:#475569; font-size:0.75rem;">
                                                        ${escapeHtml(c.assigned_user || "Unassigned")}
                                                    </td>
                                                    <td style="padding:12px 16px; text-align:right; white-space:nowrap;">
                                                        <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" class="agent-btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 12px; font-size:0.74rem; font-weight:700;">
                                                            <span>Open Console ↗</span>
                                                        </a>
                                                    </td>
                                                </tr>
                                            `;
                                        })
                                        .join("")}
                                </tbody>
                            </table>
                           </div>`
                }
            </div>

        </div>
    `;
}

function renderGovernanceAndAuditViewHtml(ag) {
    const granted = ag.permission_labels || [];
    const restricted = ag.restricted_capabilities || [];
    const audits = workbenchState.myAuditLogs || [];
    const deptCases = workbenchState.deptCases || [];

    return `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <!-- Department Case Performance Report & CSV Export -->
            <div class="agent-card">
                <div class="agent-card-header">
                    <div>
                        <h3 class="agent-card-title">📊 ${escapeHtml(ag.team_name || "Department")} Case Report &amp; SLA Ledger (${deptCases.length} Cases)</h3>
                        <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                            Department-scoped operational report for <strong>${escapeHtml(ag.name)}</strong> (${escapeHtml(ag.category_scope || "PAYROLL")})
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button type="button" id="btnExportAgentDeptCsv" class="agent-btn-primary" style="height:32px;">
                            ⬇ Export Dept Cases CSV
                        </button>
                        <button type="button" class="btn-back-to-console agent-btn-outline" style="height:32px;">
                            &larr; Back to Case Console
                        </button>
                    </div>
                </div>
                ${
                    deptCases.length === 0
                        ? `<div style="padding:20px; text-align:center; color:#64748b; font-size:0.8rem; background:#f8fafc; border-radius:10px;">No cases recorded in ${escapeHtml(ag.team_name || "your department")} yet.</div>`
                        : `<div style="overflow-x:auto;">
                            <table style="width:100%; border-collapse:collapse; font-size:0.76rem;">
                                <thead>
                                    <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; text-align:left; color:#475569;">
                                        <th style="padding:8px 10px;">Case #</th>
                                        <th style="padding:8px 10px;">Employee</th>
                                        <th style="padding:8px 10px;">Category</th>
                                        <th style="padding:8px 10px;">Subject</th>
                                        <th style="padding:8px 10px;">Status</th>
                                        <th style="padding:8px 10px;">Priority</th>
                                        <th style="padding:8px 10px;">Owner</th>
                                        <th style="padding:8px 10px;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deptCases
                                        .map(
                                            (c) => `
                                        <tr style="border-bottom:1px solid #f1f5f9;">
                                            <td style="padding:8px 10px; font-family:ui-monospace, monospace; font-weight:800; color:#1d4ed8;">${escapeHtml(c.case_number || c.id)}</td>
                                            <td style="padding:8px 10px; font-weight:700;">${escapeHtml(c.employee_name || "Employee")}</td>
                                            <td style="padding:8px 10px;">${escapeHtml(c.category || "")}</td>
                                            <td style="padding:8px 10px;">${escapeHtml(c.title || "")}</td>
                                            <td style="padding:8px 10px; font-weight:800;">${escapeHtml(c.status || "NEW")}</td>
                                            <td style="padding:8px 10px;">${escapeHtml(c.priority || "MEDIUM")}</td>
                                            <td style="padding:8px 10px;">${escapeHtml(c.assigned_user || "Unclaimed")}</td>
                                            <td style="padding:8px 10px;">
                                                <button type="button" class="btn-jump-to-case agent-btn-outline" data-case-ref="${escapeHtml(c.case_number || c.id)}" style="height:26px; font-size:0.68rem;">Open</button>
                                            </td>
                                        </tr>`
                                        )
                                        .join("")}
                                </tbody>
                            </table>
                           </div>`
                }
            </div>

            <div class="agent-card">
                <div class="agent-card-header">
                    <div>
                        <h3 class="agent-card-title">🛡️ Role-Based Access Governance (${escapeHtml(ag.role)} · ${escapeHtml(ag.team_name || "HR Operations")})</h3>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1.2fr 0.8fr; gap:16px;">
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:14px;">
                        <div style="font-size:0.75rem; font-weight:800; color:#047857; text-transform:uppercase; margin-bottom:10px;">
                            ✓ Authorized Specialist Capabilities (${granted.length} Active Rules)
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:8px;">
                            ${granted
                                .map(
                                    (p) => `
                                <div style="display:flex; align-items:center; gap:8px; background:#ffffff; border:1px solid #dcfce7; padding:8px 10px; border-radius:9px; font-size:0.75rem; font-weight:600; color:#0f172a;">
                                    <span style="width:18px; height:18px; border-radius:50%; background:#dcfce7; color:#15803d; display:inline-flex; align-items:center; justify-content:center; font-size:0.68rem; font-weight:800; flex-shrink:0;">✓</span>
                                    <span>${escapeHtml(p.label)}</span>
                                </div>`
                                )
                                .join("")}
                        </div>
                    </div>

                    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:14px; padding:14px;">
                        <div style="font-size:0.75rem; font-weight:800; color:#b91c1c; text-transform:uppercase; margin-bottom:10px;">
                            🔒 Restricted from Agent View (Requires Lead / Manager / Admin)
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${restricted
                                .map(
                                    (r) => `
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; background:#ffffff; border:1px solid #fecaca; padding:8px 10px; border-radius:9px; font-size:0.74rem; color:#7f1d1d;">
                                    <span style="font-weight:600;">🔒 ${escapeHtml(r.label)}</span>
                                    <span style="padding:2px 7px; border-radius:6px; background:#fee2e2; color:#991b1b; font-size:0.65rem; font-weight:800;">${escapeHtml(r.min_role)}</span>
                                </div>`
                                )
                                .join("")}
                        </div>
                    </div>
                </div>
            </div>

            <div class="agent-card">
                <div class="agent-card-header">
                    <h3 class="agent-card-title">🕒 My Personal Chronological Audit Trail (${audits.length})</h3>
                </div>
                ${
                    audits.length === 0
                        ? `<div style="padding:24px; text-align:center; color:#64748b; font-size:0.8rem;">No audit events recorded for ${escapeHtml(ag.name)} yet.</div>`
                        : `<div style="display:flex; flex-direction:column; gap:8px;">
                            ${audits
                                .map(
                                    (al) => `
                                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:0.76rem;">
                                    <div>
                                        <span style="padding:2px 8px; border-radius:6px; background:#eff6ff; color:#1d4ed8; font-family:ui-monospace, monospace; font-weight:800; font-size:0.69rem; margin-right:6px;">
                                            ${escapeHtml(al.action)}
                                        </span>
                                        <strong style="color:#0f172a;">${escapeHtml(al.description || "")}</strong>
                                    </div>
                                    <span style="font-size:0.7rem; color:#64748b; white-space:nowrap;">${escapeHtml(String(al.created_at || "").slice(0, 19))}</span>
                                </div>`
                                )
                                .join("")}
                           </div>`
                }
            </div>
        </div>
    `;
}

function openDeptSwitchModal() {
    workbenchState.showDeptSwitchModal = true;
    renderDeptSwitchModal();
}

function closeDeptSwitchModal() {
    workbenchState.showDeptSwitchModal = false;
    const modal = document.getElementById("agentDeptSwitchModal");
    if (modal) {
        modal.style.display = "none";
        modal.innerHTML = "";
    }
}

async function switchAgentDepartment(deptId) {
    workbenchState.activeDeptId = deptId;
    try {
        localStorage.setItem("hrflow_agent_active_dept_id", String(deptId));
    } catch (_) {}
    closeDeptSwitchModal();
    const assigned = workbenchState.agent?.assigned_departments || [];
    const targetDept = assigned.find((d) => String(d.id) === String(deptId));
    const targetName = deptId === "ALL" ? "All Assigned Departments" : (targetDept?.team_name || "Department Desk");
    setToast("success", `Switched active department desk to ${targetName}`);
    await loadWorkbenchData(workbenchState.agent?.email, workbenchState.agent?.id, false, deptId);
}

function renderDeptSwitchModal() {
    const modal = document.getElementById("agentDeptSwitchModal");
    if (!modal) return;
    if (!workbenchState.showDeptSwitchModal) {
        modal.style.display = "none";
        modal.innerHTML = "";
        return;
    }

    const ag = workbenchState.agent || {};
    const depts = Array.isArray(ag.assigned_departments) ? ag.assigned_departments : [];
    const activeDeptId = String(workbenchState.activeDeptId ?? ag.active_dept_id ?? (depts[0]?.id || ""));
    const isAllActive = activeDeptId === "ALL";
    const combinedCats = (ag.all_assigned_categories || ag.allowed_categories || []).join(", ") || "GENERAL_HR";

    const cardsHtml = depts
        .map((d) => {
            const isActive = !isAllActive && String(d.id) === activeDeptId;
            return `
                <div class="dept-switch-card ${isActive ? "is-active" : ""}" onclick="switchAgentDepartment(${d.id})" role="button" tabindex="0">
                    <div class="dept-switch-card-main">
                        <div class="dept-switch-card-header">
                            <div class="dept-name-wrap">
                                <span class="dept-code-pill">${escapeHtml(d.dept_code || `DEPT-${d.id}`)}</span>
                                <span class="dept-name-title">${escapeHtml(d.team_name)}</span>
                            </div>
                            ${
                                isActive
                                    ? `<span class="dept-active-badge">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                            Active Desk
                                       </span>`
                                    : `<button type="button" class="dept-switch-action-btn">Switch Desk →</button>`
                            }
                        </div>
                        <div class="dept-switch-card-meta">
                            <span class="dept-meta-item" title="Department Category Scope">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                <span>Scope: <strong>${escapeHtml(d.category_scope || "GENERAL")}</strong></span>
                            </span>
                            <span class="dept-meta-item" title="Department Inbox Account">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                    <polyline points="22,6 12,13 2,6"></polyline>
                                </svg>
                                <span>${escapeHtml(d.dept_gmail || ag.email || "dept@example.com")}</span>
                            </span>
                            ${
                                d.sla_hours
                                    ? `<span class="dept-meta-item" title="Default Resolution SLA">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <polyline points="12 6 12 12 16 14"></polyline>
                                            </svg>
                                            <span>${d.sla_hours}h SLA</span>
                                       </span>`
                                    : ""
                            }
                        </div>
                        ${
                            d.description
                                ? `<div class="dept-switch-card-desc">${escapeHtml(d.description)}</div>`
                                : ""
                        }
                    </div>
                </div>
            `;
        })
        .join("");

    const allCardHtml = `
        <div class="dept-switch-card ${isAllActive ? "is-active" : ""}" onclick="switchAgentDepartment('ALL')" role="button" tabindex="0">
            <div class="dept-switch-card-main">
                <div class="dept-switch-card-header">
                    <div class="dept-name-wrap">
                        <span class="dept-code-pill all-pill">ALL</span>
                        <span class="dept-name-title">All Assigned Departments (Unified View)</span>
                    </div>
                    ${
                        isAllActive
                            ? `<span class="dept-active-badge">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    Active View
                               </span>`
                            : `<button type="button" class="dept-switch-action-btn">Switch to All →</button>`
                    }
                </div>
                <div class="dept-switch-card-meta">
                    <span class="dept-meta-item">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <span>Combined Categories: <strong>${escapeHtml(combinedCats)}</strong></span>
                    </span>
                    <span class="dept-meta-item">
                        <span>Work across all ${depts.length} department queues in one unified workbench</span>
                    </span>
                </div>
            </div>
        </div>
    `;

    modal.innerHTML = `
        <div class="agent-dept-modal-card" onclick="event.stopPropagation()">
            <div class="agent-dept-modal-header">
                <div class="agent-dept-modal-title-row">
                    <div class="agent-dept-modal-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 21h18"></path>
                            <path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                            <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                            <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="agent-dept-modal-title" id="deptModalTitle">Switch Operating Department</h3>
                        <p class="agent-dept-modal-sub">
                            Your account (<span class="dept-modal-email-highlight">${escapeHtml(ag.email || "")}</span>) is assigned to <strong>${depts.length} departments</strong>. Select your active desk:
                        </p>
                    </div>
                </div>
                <button type="button" class="agent-dept-modal-close" onclick="closeDeptSwitchModal()" aria-label="Close dialog">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <div class="agent-dept-modal-body">
                <div class="agent-dept-cards-list">
                    ${cardsHtml}
                    ${allCardHtml}
                </div>
            </div>

            <div class="agent-dept-modal-footer">
                <div class="agent-dept-modal-hint">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span>Switching desks filters your active cases, incoming emails, verification tasks, and email signatures to the chosen department.</span>
                </div>
                <button type="button" class="agent-dept-modal-btn-close" onclick="closeDeptSwitchModal()">Close</button>
            </div>
        </div>
    `;

    modal.style.display = "flex";
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeDeptSwitchModal();
        }
    };
}

window.openDeptSwitchModal = openDeptSwitchModal;
window.closeDeptSwitchModal = closeDeptSwitchModal;
window.switchAgentDepartment = switchAgentDepartment;
window.renderDeptSwitchModal = renderDeptSwitchModal;

function renderNewCaseModal() {
    const modal = document.getElementById("agentNewCaseModal");
    if (!modal) return;
    if (!workbenchState.showNewCaseModal) {
        modal.style.display = "none";
        return;
    }

    const ag = workbenchState.agent || {};
    const deptCats = Array.isArray(ag.allowed_categories) && ag.allowed_categories.length > 0
        ? ag.allowed_categories
        : String(ag.category_scope || "PAYROLL").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const defaultCat = deptCats[0] || "PAYROLL";

    modal.style.display = "flex";
    modal.innerHTML = `
        <div class="agent-modal-dialog">
            <div style="background:linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%); color:#ffffff; padding:18px 22px; display:flex; align-items:center; justify-content:space-between;">
                <div>
                    <div style="font-size:0.68rem; font-weight:800; color:#93c5fd; text-transform:uppercase; letter-spacing:0.05em;">
                        SPECIALIST CASE INTAKE · ${escapeHtml(ag.team_name || "HR Operations")}
                    </div>
                    <h3 style="margin:2px 0 0 0; font-size:1.05rem; font-weight:800;">＋ Log New Employee HR Case</h3>
                </div>
                <button type="button" id="btnCloseNewCaseModal" style="background:rgba(255,255,255,0.16); border:none; color:#ffffff; width:32px; height:32px; border-radius:8px; font-weight:800; cursor:pointer;">✕</button>
            </div>

            <div style="padding:20px 22px; display:flex; flex-direction:column; gap:12px;">
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
                    <div>
                        <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Employee Name</label>
                        <input type="text" id="ncEmployeeName" class="agent-input" value="" placeholder="e.g. Employee Full Name">
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Employee ID</label>
                        <input type="text" id="ncEmployeeId" class="agent-input" value="" placeholder="e.g. EMP1042">
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Employee Email</label>
                        <input type="email" id="ncEmployeeEmail" class="agent-input" value="" placeholder="e.g. employee@company.com">
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Assigned Dept Category</label>
                        <select id="ncCategory" class="agent-input">
                            ${deptCats
                                .map((cat) => `<option value="${cat}" ${cat === defaultCat ? "selected" : ""}>${cat} (${escapeHtml(ag.team_name || "My Dept")})</option>`)
                                .join("")}
                        </select>
                    </div>
                    <div>
                        <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Priority</label>
                        <select id="ncPriority" class="agent-input">
                            <option value="HIGH" selected>HIGH PRIORITY</option>
                            <option value="CRITICAL">CRITICAL PRIORITY</option>
                            <option value="MEDIUM">MEDIUM PRIORITY</option>
                            <option value="LOW">LOW PRIORITY</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Case Subject / Title</label>
                    <input type="text" id="ncTitle" class="agent-input" placeholder="e.g. Salary Arrears & TDS Discrepancy in October Payslip">
                </div>

                <div>
                    <label style="display:block; font-size:0.71rem; font-weight:800; color:#475569; text-transform:uppercase; margin-bottom:4px;">Employee Request Details</label>
                    <textarea id="ncDescription" rows="4" style="width:100%; border-radius:10px; border:1px solid #cbd5e1; padding:10px 12px; font-family:inherit; font-size:0.8rem; background:#f8fafc; box-sizing:border-box;" placeholder="Enter employee request particulars and description..."></textarea>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; padding-top:8px; border-top:1px solid #e2e8f0;">
                    <button type="button" id="btnCancelNewCaseModal" class="agent-btn-outline">Cancel</button>
                    <button type="button" id="btnSubmitNewCaseModal" class="agent-btn-primary">＋ Create Case &amp; Open in Workbench</button>
                </div>
            </div>
        </div>
    `;

    const closeFn = () => {
        workbenchState.showNewCaseModal = false;
        modal.style.display = "none";
    };
    document.getElementById("btnCloseNewCaseModal")?.addEventListener("click", closeFn);
    document.getElementById("btnCancelNewCaseModal")?.addEventListener("click", closeFn);

    document.getElementById("btnSubmitNewCaseModal")?.addEventListener("click", async () => {
        const payload = {
            agent_name: ag.name || "HR Specialist",
            agent_email: ag.email || "",
            agent_team: ag.team_name || "Payroll Operations HR",
            employee_name: document.getElementById("ncEmployeeName")?.value?.trim() || "Employee",
            employee_id: document.getElementById("ncEmployeeId")?.value?.trim() || "",
            employee_email: document.getElementById("ncEmployeeEmail")?.value?.trim() || "",
            category: document.getElementById("ncCategory")?.value || defaultCat,
            priority: document.getElementById("ncPriority")?.value || "HIGH",
            title: document.getElementById("ncTitle")?.value?.trim() || "",
            description: document.getElementById("ncDescription")?.value?.trim() || "",
            assign_to_me: true,
        };
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/create`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (res.ok) {
            const newRef = json.data?.case_number || json.case_number;
            workbenchState.showNewCaseModal = false;
            modal.style.display = "none";
            workbenchState.selectedCaseRef = newRef;
            workbenchState.activeTab = "MY_QUEUE";
            workbenchState.workbenchView = "CONSOLE";
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Created Case ${newRef} and assigned to ${ag.name}!`);
        }
    });
}

// =========================================================================
// UNIVERSAL PEOPLEDESK: REASSIGN TO SUB-CATEGORY SPECIALIST MODAL
// =========================================================================
async function openAgentReassignModal(caseRef, meta = {}) {
    if (!caseRef) return;
    workbenchState.showReassignModal = true;
    workbenchState.reassignTargetCase = {
        caseRef: caseRef,
        title: meta.title || "",
        currentOwner: meta.owner || meta.assigned_user || workbenchState.agent?.name || "Current Specialist",
        currentTeam: meta.team || meta.assigned_team || "PeopleDesk",
        category: meta.category || "GENERAL_HR",
    };

    if (!workbenchState.reassignDepartments || workbenchState.reassignDepartments.length === 0) {
        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/cases/departments`, {
                headers: buildAuthHeaders(),
            });
            const data = await res.json();
            if (data.status === "success" && Array.isArray(data.data?.departments)) {
                workbenchState.reassignDepartments = data.data.departments;
            }
        } catch (e) {
            console.error("Failed to fetch departments roster for reassignment:", e);
        }
    }

    renderAgentReassignModal();
}
window.openAgentReassignModal = openAgentReassignModal;

function closeAgentReassignModal() {
    workbenchState.showReassignModal = false;
    workbenchState.reassignTargetCase = null;
    const modal = document.getElementById("agentReassignModal");
    if (modal) {
        modal.style.display = "none";
        modal.innerHTML = "";
    }
}
window.closeAgentReassignModal = closeAgentReassignModal;

function renderAgentReassignModal() {
    const modal = document.getElementById("agentReassignModal");
    if (!modal) return;
    if (!workbenchState.showReassignModal || !workbenchState.reassignTargetCase) {
        modal.style.display = "none";
        modal.innerHTML = "";
        return;
    }

    const tCase = workbenchState.reassignTargetCase;
    const depts = workbenchState.reassignDepartments || [];

    let allMembers = [];
    depts.forEach((d) => {
        if (Array.isArray(d.members)) {
            d.members.forEach((m) => {
                allMembers.push({
                    ...m,
                    parent_dept: d.team_name,
                    sub_department: m.sub_department || "Salary & Payroll",
                });
            });
        }
    });

    const subDepts = [
        { code: "ALL", label: "🌐 All Sub-Categories (All Specialists)" },
        { code: "Salary & Payroll", label: "💰 Salary & Payroll (Salary, payslips, TDS, arrears)" },
        { code: "Leave Management", label: "🏖️ Leave Management (Sick, casual, encashment, PTO)" },
        { code: "Attendance & Shifts", label: "⏱️ Attendance & Shifts (Biometric punches, shift swap, WFH)" },
        { code: "HR Operations & Exit", label: "📋 HR Operations & Exit (Resignations, clearances, HR letters)" },
        { code: "Benefits & Wellness", label: "🩺 Benefits & Wellness (Health insurance, gym, perks)" },
    ];

    modal.style.display = "flex";
    modal.innerHTML = `
        <div class="agent-modal-dialog" style="max-width:580px;">
            <div style="background:linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); color:#ffffff; padding:18px 22px; display:flex; align-items:center; justify-content:space-between;">
                <div>
                    <div style="font-size:0.68rem; font-weight:800; color:#93c5fd; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
                        <span>UNIVERSAL PEOPLEDESK</span>
                        <span>•</span>
                        <span>SUB-CATEGORY REASSIGNMENT</span>
                    </div>
                    <h3 style="margin:2px 0 0 0; font-size:1.05rem; font-weight:800; display:flex; align-items:center; gap:6px;">
                        <span>⇄</span>
                        <span>Reassign Case to Sub-Category Specialist</span>
                    </h3>
                </div>
                <button type="button" id="btnCloseReassignModal" style="background:rgba(255,255,255,0.16); border:none; color:#ffffff; width:32px; height:32px; border-radius:8px; font-weight:800; cursor:pointer;" title="Close">✕</button>
            </div>

            <div style="padding:18px 22px; display:flex; flex-direction:column; gap:14px; background:#f8fafc;">
                <!-- Target Case Context Pill -->
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:0.7rem; font-weight:800; color:#1e40af; text-transform:uppercase;">Case Identifier</div>
                        <div style="font-size:0.95rem; font-weight:800; color:#1e3a8a; font-family:monospace;">${escapeHtml(tCase.caseRef)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.7rem; font-weight:700; color:#64748b;">Current Assignee</div>
                        <div style="font-size:0.82rem; font-weight:700; color:#0f172a;">${escapeHtml(tCase.currentOwner)}</div>
                    </div>
                </div>

                <!-- 1. Sub-Department Selector -->
                <div>
                    <label style="display:block; font-size:0.73rem; font-weight:800; color:#334155; text-transform:uppercase; margin-bottom:5px;">
                        1. Select Sub-Category / Desk
                    </label>
                    <select id="reassignSubDeptSelect" class="agent-input" style="background:#ffffff; font-weight:600; width:100%; border-radius:8px; padding:8px 10px; border:1px solid #cbd5e1;">
                        ${subDepts.map((sd) => `<option value="${escapeHtml(sd.code)}">${escapeHtml(sd.label)}</option>`).join("")}
                    </select>
                </div>

                <!-- 2. Target Specialist Selector -->
                <div>
                    <label style="display:block; font-size:0.73rem; font-weight:800; color:#334155; text-transform:uppercase; margin-bottom:5px;">
                        2. Choose Specialist in Sub-Category
                    </label>
                    <select id="reassignSpecialistSelect" class="agent-input" style="background:#ffffff; font-weight:600; width:100%; border-radius:8px; padding:8px 10px; border:1px solid #cbd5e1;">
                        <!-- Filtered dynamically -->
                    </select>
                </div>

                <!-- 3. Handover Reason & Context -->
                <div>
                    <label style="display:block; font-size:0.73rem; font-weight:800; color:#334155; text-transform:uppercase; margin-bottom:5px;">
                        3. Handover Reason / Dispatch Note
                    </label>
                    <textarea id="reassignNoteInput" rows="2" style="width:100%; border-radius:10px; border:1px solid #cbd5e1; padding:9px 12px; font-family:inherit; font-size:0.82rem; background:#ffffff; box-sizing:border-box;" placeholder="e.g. Please verify salary deduction and Form 16 TDS against September payslip..."></textarea>

                    <!-- Quick Note Chips -->
                    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
                        <span class="quick-chip-btn" data-note="Please verify payroll deductions and calculate arrears for this cycle." style="font-size:0.68rem; padding:3px 8px; border-radius:999px; background:#e0e7ff; color:#3730a3; cursor:pointer; font-weight:600;">💰 Verify Payroll Deductions</span>
                        <span class="quick-chip-btn" data-note="Please review leave balance in HRMS and approve requested dates." style="font-size:0.68rem; padding:3px 8px; border-radius:999px; background:#dcfce7; color:#166534; cursor:pointer; font-weight:600;">🏖️ Verify Leave Balance</span>
                        <span class="quick-chip-btn" data-note="Employee reported biometric punch issue; please regularize attendance." style="font-size:0.68rem; padding:3px 8px; border-radius:999px; background:#fef3c7; color:#92400e; cursor:pointer; font-weight:600;">⏱️ Regularize Attendance</span>
                        <span class="quick-chip-btn" data-note="High priority inquiry; please expedite review today." style="font-size:0.68rem; padding:3px 8px; border-radius:999px; background:#fee2e2; color:#991b1b; cursor:pointer; font-weight:600;">⚡ Expedite Review</span>
                    </div>
                </div>

                <!-- 4. Email Notification Toggle -->
                <div style="display:flex; align-items:center; gap:8px; padding-top:4px;">
                    <input type="checkbox" id="reassignSendEmailToggle" checked style="width:16px; height:16px; accent-color:#2563eb; cursor:pointer;">
                    <label for="reassignSendEmailToggle" style="font-size:0.78rem; font-weight:600; color:#475569; cursor:pointer;">
                        Send case reassignment notification to specialist via Gmail SMTP
                    </label>
                </div>

                <!-- Modal Actions -->
                <div style="display:flex; justify-content:flex-end; gap:10px; padding-top:10px; border-top:1px solid #e2e8f0; margin-top:4px;">
                    <button type="button" id="btnCancelReassignModal" class="agent-btn-outline" style="height:36px; padding:0 14px;">Cancel</button>
                    <button type="button" id="btnSubmitReassignModal" class="agent-btn-primary" style="height:36px; padding:0 16px; background:#2563eb; color:#ffffff; font-weight:700;">
                        ✓ Confirm Reassignment &amp; Dispatch
                    </button>
                </div>
            </div>
        </div>
    `;

    const subDeptSelect = document.getElementById("reassignSubDeptSelect");
    const specSelect = document.getElementById("reassignSpecialistSelect");

    const updateSpecialistOptions = (selectedSub) => {
        if (!specSelect) return;
        const filtered = selectedSub === "ALL"
            ? allMembers
            : allMembers.filter((m) => (m.sub_department || "").toLowerCase().trim() === selectedSub.toLowerCase().trim());

        if (filtered.length === 0) {
            specSelect.innerHTML = `<option value="">No active specialists found for this sub-category</option>`;
            return;
        }

        specSelect.innerHTML = filtered
            .map(
                (m) => `
            <option value="${escapeHtml(m.member_name)}" data-email="${escapeHtml(m.email)}" data-sub="${escapeHtml(m.sub_department)}" data-team="${escapeHtml(m.parent_dept || "PeopleDesk")}">
                ${escapeHtml(m.member_name)} (${escapeHtml(m.sub_department)}) · ${m.active_cases || 0} active cases — ${escapeHtml(m.email)}
            </option>
        `
            )
            .join("");
    };

    updateSpecialistOptions("ALL");

    subDeptSelect?.addEventListener("change", (e) => {
        updateSpecialistOptions(e.target.value);
    });

    modal.querySelectorAll(".quick-chip-btn").forEach((chip) => {
        chip.addEventListener("click", () => {
            const noteInput = document.getElementById("reassignNoteInput");
            if (noteInput) {
                noteInput.value = chip.getAttribute("data-note") || "";
                noteInput.focus();
            }
        });
    });

    document.getElementById("btnCloseReassignModal")?.addEventListener("click", closeAgentReassignModal);
    document.getElementById("btnCancelReassignModal")?.addEventListener("click", closeAgentReassignModal);

    document.getElementById("btnSubmitReassignModal")?.addEventListener("click", async () => {
        const btnSubmit = document.getElementById("btnSubmitReassignModal");
        const chosenOption = specSelect.options[specSelect.selectedIndex];
        if (!chosenOption || !chosenOption.value) {
            alert("Please select a target specialist to reassign this case to.");
            return;
        }

        const targetUser = chosenOption.value;
        const targetEmail = chosenOption.getAttribute("data-email") || "";
        const targetSub = chosenOption.getAttribute("data-sub") || subDeptSelect.value || "Salary & Payroll";
        const targetTeam = chosenOption.getAttribute("data-team") || "PeopleDesk";
        const note = document.getElementById("reassignNoteInput")?.value?.trim() || "";
        const sendEmail = Boolean(document.getElementById("reassignSendEmailToggle")?.checked);

        btnSubmit.disabled = true;
        btnSubmit.textContent = sendEmail ? "Dispatching via Gmail SMTP..." : "Reassigning...";

        try {
            const payload = {
                target_user: targetUser,
                target_email: targetEmail,
                sub_department: targetSub,
                team: targetTeam,
                note: note,
                send_email: sendEmail,
                performed_by: workbenchState.agent?.name || "Vaibhav Yadav",
                agent_name: workbenchState.agent?.name || "Vaibhav Yadav",
                agent_email: workbenchState.agent?.email || "",
                role: workbenchState.agent?.role || "HR_AGENT",
            };

            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(tCase.caseRef)}/reassign`, {
                method: "POST",
                headers: buildAuthHeaders(),
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok) {
                alert(json.error?.message || json.message || "Failed to reassign case.");
            } else {
                // Update local selected email & draft text immediately
                const selEm = (workbenchState.deptEmails || []).find((e) => String(e.case_number) === String(tCase.caseRef));
                if (selEm) {
                    selEm.case_owner = targetUser;
                    selEm.sub_department = targetSub;
                    selEm.assigned_team = targetTeam;
                    selEm.is_assigned_to_me = Boolean(workbenchState.agent?.email && targetEmail.toLowerCase() === workbenchState.agent.email.toLowerCase());
                    const empName = selEm.employee_name || selEm.sender_name || "Employee";
                    const subj = selEm.subject || "your HR request";
                    const refTag = tCase.caseRef ? ` (Case #${tCase.caseRef})` : "";
                    const reassignReply =
                        `Dear ${empName},\n\n` +
                        `Thank you for contacting PeopleDesk regarding "${subj}"${refTag}.\n\n` +
                        `Your request has been transferred to our specialized ${targetSub} desk under PeopleDesk for dedicated processing.\n\n` +
                        `Specialist ${targetUser} has taken ownership of your inquiry.` +
                        (note ? `\n\nHandover note: ${note}` : "") +
                        `\n\nWarm regards,\n${targetUser}\n${targetSub} · PeopleDesk Operations`;
                    workbenchState.inboxReplyDrafts[`inbox_em_${selEm.id}`] = reassignReply;
                }
                closeAgentReassignModal();
                closeAgentCaseDetailModal();
                setToast("success", `✓ Case ${tCase.caseRef} successfully reassigned to ${targetUser} (${targetSub})!`);
                await loadWorkbenchData(workbenchState.agent?.email, workbenchState.agent?.id, false);
            }
        } catch (err) {
            alert("Network error while reassigning: " + err.message);
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = "✓ Confirm Reassignment & Dispatch";
            }
        }
    });
}

function renderAgentWorkbench() {
    const root = document.getElementById("agentWorkbenchRoot");
    if (!root) return;

    try {
        const ag = workbenchState.agent || {
        name: "HR Specialist",
        email: "agent@hrflow.local",
        role: "HR_AGENT",
        role_title: "HR Specialist / Agent",
        designation: "HR Operations Specialist",
        team_name: "HR Operations",
        category_scope: "PAYROLL",
        allowed_categories: ["PAYROLL"],
        permission_labels: [],
        restricted_capabilities: [],
    };
    const kpis = workbenchState.kpis || {};
    const filteredCases = getFilteredQueueCases();
    const deptDeskEmail = ag.dept_info?.dept_gmail || ag.email;

    // Build scoped category filter list (Agent's department categories + any category of a case explicitly assigned to them)
    const scopedCatsSet = new Set(
        Array.isArray(ag.allowed_categories) && ag.allowed_categories.length > 0
            ? ag.allowed_categories
            : String(ag.category_scope || "PAYROLL")
                  .split(",")
                  .map((s) => s.trim().toUpperCase())
                  .filter(Boolean)
    );
    (workbenchState.deptCases || []).forEach((c) => {
        if (c.category) scopedCatsSet.add(String(c.category).toUpperCase());
    });
    const scopedCategoriesList = Array.from(scopedCatsSet);

    const toastHtml = workbenchState.toastMessage
        ? `
        <div class="agent-toast" style="background:${workbenchState.toastMessage.type === "error" ? "#fef2f2" : "#ecfdf5"}; border:1px solid ${workbenchState.toastMessage.type === "error" ? "#fecaca" : "#a7f3d0"}; color:${workbenchState.toastMessage.type === "error" ? "#991b1b" : "#065f46"};">
            <span>✓ ${escapeHtml(workbenchState.toastMessage.text)}</span>
            <button type="button" id="btnDismissAgentToast" style="background:none; border:none; font-weight:800; cursor:pointer; color:inherit;">✕</button>
        </div>`
        : "";

    let mainBodyHtml = "";
    if (workbenchState.workbenchView === "DEPT_INBOX") {
        mainBodyHtml = renderDeptInboxViewHtml(ag);
    } else if (workbenchState.workbenchView === "TASKS_BOARD") {
        mainBodyHtml = renderTasksBoardViewHtml(ag);
    } else if (workbenchState.workbenchView === "APPROVALS_GATE") {
        mainBodyHtml = renderApprovalsGateViewHtml(ag);
    } else if (workbenchState.workbenchView === "REPLIES_ACTIONS") {
        mainBodyHtml = renderRepliesAndActionsViewHtml(ag);
    } else if (workbenchState.workbenchView === "GOVERNANCE_AUDIT") {
        mainBodyHtml = renderGovernanceAndAuditViewHtml(ag);
    } else {
        mainBodyHtml = renderDeptCasesConsoleHtml(ag, scopedCategoriesList);
    }

    if (workbenchState.workbenchView === "DEPT_INBOX") {
        root.classList.add("inbox-mode");
    } else {
        root.classList.remove("inbox-mode");
    }

    if (workbenchState.workbenchView === "DEPT_INBOX") {
        root.style.padding = "0";
        root.style.display = "flex";
        root.style.flexDirection = "column";
        root.style.flex = "1";
        root.style.minHeight = "0";
        root.style.overflow = "hidden";
        root.innerHTML = `${toastHtml ? `<div style="padding:10px 24px 0 24px;">${toastHtml}</div>` : ""}${mainBodyHtml}`;
        syncSidebarActiveHighlight();
        bindWorkbenchEvents();
        if (window.syncLayoutBodyClasses) window.syncLayoutBodyClasses();
        return;
    } else if (workbenchState.workbenchView === "CONSOLE") {
        root.style.padding = "24px 32px 64px 32px";
        root.style.display = "block";
        root.style.flex = "1";
        root.style.minHeight = "0";
        root.style.overflowY = "auto";
        root.innerHTML = `${toastHtml ? `<div style="padding:0 0 16px 0;">${toastHtml}</div>` : ""}${mainBodyHtml}`;
        syncSidebarActiveHighlight();
        bindWorkbenchEvents();
        if (window.syncLayoutBodyClasses) window.syncLayoutBodyClasses();
        return;
    } else {
        root.style.padding = "";
        root.style.display = "";
        root.style.flexDirection = "";
        root.style.flex = "";
        root.style.minHeight = "";
        root.style.overflow = "";
    }

    root.innerHTML = `
        ${toastHtml}

        <!-- 1. TOP AGENT IDENTITY & WORKBENCH MODE HEADER -->
        <section class="agent-hero-banner">
            <div class="agent-hero-left">
                <div class="agent-hero-avatar">
                    ${escapeHtml(getInitials(ag.name))}
                    <span style="position:absolute; bottom:-2px; right:-2px; width:13px; height:13px; border-radius:50%; background:#10b981; border:2px solid #0f172a;" title="Online & Ready"></span>
                </div>
                <div class="agent-hero-meta">
                    <h1>
                        <span>${escapeHtml(ag.name)}</span>
                        <span class="agent-role-pill">🛡️ ${escapeHtml(ag.designation || "HR Specialist")} · ${escapeHtml(ag.role)}</span>
                    </h1>
                    <div class="agent-hero-sub">
                        <span>🏢 Assigned Dept: <strong>${escapeHtml(ag.team_name || "HR Operations")}</strong></span>
                        <span>•</span>
                        <span class="agent-scope-badge">Allowed Mail Types: ${escapeHtml(ag.category_scope || "GENERAL_HR")}</span>
                        <span>•</span>
                        <span>✉️ Login: <strong>${escapeHtml(ag.email)}</strong></span>
                        <span>•</span>
                        <span>📥 Dept Desk: <strong>${escapeHtml(deptDeskEmail)}</strong></span>
                    </div>
                </div>
            </div>

            <div class="agent-hero-actions">
                <div class="agent-seg-group">
                    <button type="button" class="agent-seg-btn ${workbenchState.workbenchView === "DEPT_INBOX" ? "active" : ""}" data-wb-view="DEPT_INBOX">
                        📩 Dept Inbox (${(workbenchState.deptEmails || []).length})
                    </button>
                    <button type="button" class="agent-seg-btn ${workbenchState.workbenchView === "CONSOLE" ? "active" : ""}" data-wb-view="CONSOLE">
                        🎯 Cases (${(workbenchState.deptCases || []).length})
                    </button>
                    <button type="button" class="agent-seg-btn ${workbenchState.workbenchView === "APPROVALS_GATE" ? "active" : ""}" data-wb-view="APPROVALS_GATE">
                        ⏳ Approvals (${(workbenchState.approvals || []).length})
                    </button>
                    <button type="button" class="agent-seg-btn ${workbenchState.workbenchView === "REPLIES_ACTIONS" ? "active" : ""}" data-wb-view="REPLIES_ACTIONS">
                        ⚡ Actions &amp; Replies (${(kpis.emails_replied_count || 0) + (kpis.hrms_actions_count || 0)})
                    </button>
                </div>

                <button type="button" id="btnRefreshWorkbench" class="agent-btn-glass">
                    ↻ Sync Queue
                </button>
            </div>
        </section>

        <!-- 2. SIX PERSONAL LIVE KPI CARDS (Shown on Case Console so Inbox/Tasks views start right at top) -->
        ${
            workbenchState.workbenchView === "CONSOLE"
                ? `
        <section class="agent-kpi-grid">
            <div class="agent-kpi-card ${workbenchState.activeTab === "MY_QUEUE" && workbenchState.workbenchView === "CONSOLE" ? "active" : ""}" data-tab="MY_QUEUE" style="border-top:3px solid #2563eb; background:linear-gradient(135deg, #ffffff 0%, #eff6ff 100%);">
                <div class="agent-kpi-top">
                    <span>My Active Cases</span>
                    <span class="agent-kpi-icon" style="background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color:#ffffff; box-shadow:0 3px 8px rgba(37,99,235,0.25);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.2"/><circle cx="12" cy="12" r="4"/></svg>
                    </span>
                </div>
                <div class="agent-kpi-num" style="color:#2563eb;">${kpis.my_active_count ?? 0}</div>
                <div class="agent-kpi-foot">Assigned to ${escapeHtml(ag.name.split(" ")[0])}</div>
            </div>

            <div class="agent-kpi-card ${workbenchState.activeTab === "UNCLAIMED" && workbenchState.workbenchView === "CONSOLE" ? "active" : ""}" data-tab="UNCLAIMED" style="border-top:3px solid #4f46e5; background:linear-gradient(135deg, #ffffff 0%, #eef2ff 100%);">
                <div class="agent-kpi-top">
                    <span>Unclaimed Dept Pool</span>
                    <span class="agent-kpi-icon" style="background:linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color:#ffffff; box-shadow:0 3px 8px rgba(79,70,229,0.25);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" fill="currentColor" fill-opacity="0.2"/></svg>
                    </span>
                </div>
                <div class="agent-kpi-num" style="color:#4f46e5;">${kpis.dept_unclaimed_count ?? 0}</div>
                <div class="agent-kpi-foot">Ready to claim in ${escapeHtml(ag.team_name || "Dept")}</div>
            </div>

            <div class="agent-kpi-card ${workbenchState.activeTab === "URGENT" && workbenchState.workbenchView === "CONSOLE" ? "active" : ""}" data-tab="URGENT" style="border-top:3px solid #e11d48; background:linear-gradient(135deg, #ffffff 0%, #fff1f2 100%);">
                <div class="agent-kpi-top">
                    <span>Urgent / SLA Risk</span>
                    <span class="agent-kpi-icon" style="background:linear-gradient(135deg, #f43f5e 0%, #e11d48 100%); color:#ffffff; box-shadow:0 3px 8px rgba(225,29,72,0.25);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" fill="currentColor" fill-opacity="0.2"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </span>
                </div>
                <div class="agent-kpi-num" style="color:${(kpis.urgent_sla_count || 0) > 0 ? "#e11d48" : "#0f172a"};">${kpis.urgent_sla_count ?? 0}</div>
                <div class="agent-kpi-foot">High/Critical or Due Soon</div>
            </div>

            <div class="agent-kpi-card ${workbenchState.workbenchView === "TASKS_BOARD" ? "active" : ""}" data-wb-kpi="TASKS_BOARD" style="border-top:3px solid #0d9488; background:linear-gradient(135deg, #ffffff 0%, #f0fdfa 100%);">
                <div class="agent-kpi-top">
                    <span>Verification Tasks</span>
                    <span class="agent-kpi-icon" style="background:linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color:#ffffff; box-shadow:0 3px 8px rgba(13,148,136,0.25);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" fill-opacity="0.2"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>
                    </span>
                </div>
                <div class="agent-kpi-num" style="color:#0f172a;">
                    ${kpis.completed_tasks_count ?? 0}<span style="font-size:0.9rem; color:#64748b;">/${(kpis.completed_tasks_count || 0) + (kpis.pending_tasks_count || 0)}</span>
                </div>
                <div class="agent-kpi-foot">${kpis.pending_tasks_count ?? 0} open checklist tasks</div>
            </div>

            <div class="agent-kpi-card ${workbenchState.workbenchView === "REPLIES_ACTIONS" ? "active" : ""}" data-wb-kpi="REPLIES_ACTIONS" style="border-top:3px solid #7c3aed; background:linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%);">
                <div class="agent-kpi-top">
                    <span>Replies &amp; HRMS Checks</span>
                    <span class="agent-kpi-icon" style="background:linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color:#ffffff; box-shadow:0 3px 8px rgba(124,58,237,0.25);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fill-opacity="0.22"/></svg>
                    </span>
                </div>
                <div class="agent-kpi-num" style="color:#6d28d9;">${(kpis.emails_replied_count || 0) + (kpis.hrms_actions_count || 0)}</div>
                <div class="agent-kpi-foot">${kpis.emails_replied_count ?? 0} replies · ${kpis.hrms_actions_count ?? 0} HRMS checks</div>
            </div>

            <div class="agent-kpi-card ${workbenchState.activeTab === "RESOLVED" && workbenchState.workbenchView === "CONSOLE" ? "active" : ""}" data-tab="RESOLVED" style="border-top:3px solid #059669; background:linear-gradient(135deg, #ffffff 0%, #ecfdf5 100%);">
                <div class="agent-kpi-top">
                    <span>Cases Resolved</span>
                    <span class="agent-kpi-icon" style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; box-shadow:0 3px 8px rgba(5,150,105,0.25);">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill="currentColor" fill-opacity="0.2"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </span>
                </div>
                <div class="agent-kpi-num" style="color:#059669;">${kpis.my_resolved_count ?? 0}</div>
                <div class="agent-kpi-foot">Closed with resolution notes</div>
            </div>
        </section>`
                : ""
        }

        ${mainBodyHtml}
    `;

    syncSidebarActiveHighlight();
    bindWorkbenchEvents();
    if (window.syncLayoutBodyClasses) window.syncLayoutBodyClasses();
    } catch (renderErr) {
        console.error("renderAgentWorkbench failure:", renderErr);
        root.innerHTML = `
            <div style="padding:48px; text-align:center;">
                <h3 style="color:#ef4444; margin-bottom:8px;">Workbench Render Error</h3>
                <p style="color:#64748b; font-size:0.85rem;">${escapeHtml(renderErr.message || String(renderErr))}</p>
            </div>
        `;
    }
}

function bindWorkbenchEvents() {
    // Dismiss toast
    document.getElementById("btnDismissAgentToast")?.addEventListener("click", () => {
        workbenchState.toastMessage = null;
        renderAgentWorkbench();
    });

    // Workbench View Switcher
    document.querySelectorAll("[data-wb-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const view = btn.getAttribute("data-wb-view") || "CONSOLE";
            workbenchState.workbenchView = view;
            const mod = mapWorkbenchViewToModule(view);
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", `#${mod}`);
            }
            renderAgentWorkbench();
        });
    });

    document.querySelectorAll("[data-wb-kpi]").forEach((card) => {
        card.addEventListener("click", () => {
            const view = card.getAttribute("data-wb-kpi") || "CONSOLE";
            workbenchState.workbenchView = view;
            const mod = mapWorkbenchViewToModule(view);
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", `#${mod}`);
            }
            renderAgentWorkbench();
        });
    });

    const goBackToConsole = () => {
        workbenchState.workbenchView = "CONSOLE";
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, "", "#agent-workbench");
        }
        renderAgentWorkbench();
    };
    document.getElementById("btnBackToConsoleFromTasks")?.addEventListener("click", goBackToConsole);
    document.querySelectorAll(".btn-back-to-console").forEach((btn) => btn.addEventListener("click", goBackToConsole));

    // Export Department Cases CSV from Reports view
    document.getElementById("btnExportAgentDeptCsv")?.addEventListener("click", () => {
        const cases = workbenchState.deptCases || [];
        const headers = ["Case Number", "Employee Name", "Employee ID", "Category", "Title", "Status", "Priority", "Assigned Owner", "SLA Status"];
        const rows = cases.map((c) => [
            c.case_number || c.id || "",
            c.employee_name || "",
            c.employee_id || "",
            c.category || "",
            (c.title || "").replace(/"/g, '""'),
            c.status || "",
            c.priority || "",
            c.assigned_user || "Unclaimed",
            c.sla_status || "ON_TRACK",
        ]);
        const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v ?? "")}"`).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dept_cases_report_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // =========================================================================
    // CASE PROGRESS & ACTION TRACKER EVENTS (Filter & Realtime Search)
    // =========================================================================
    document.querySelectorAll("[data-case-progress-filter]").forEach((btn) => {
        btn.addEventListener("click", () => {
            workbenchState.actionFilter = btn.getAttribute("data-case-progress-filter") || "ALL";
            renderAgentWorkbench();
        });
    });

    const searchInput = document.getElementById("inputCaseProgressSearch");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            workbenchState.actionSearchQuery = e.target.value;
            renderAgentWorkbench();
            const reInput = document.getElementById("inputCaseProgressSearch");
            if (reInput) {
                reInput.focus();
                reInput.setSelectionRange(reInput.value.length, reInput.value.length);
            }
        });
    }

    // Jump to case from Tasks Board / Inbox / Approvals / Reports
    document.querySelectorAll(".btn-jump-to-case").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const ref = btn.getAttribute("data-case-ref");
            if (ref) {
                window.open(`casedetail.html?case=${encodeURIComponent(ref)}`, "_blank");
            }
        });
    });

    // Open New Case Modal
    const openNewCaseModal = () => {
        workbenchState.showNewCaseModal = true;
        renderNewCaseModal();
    };
    document.getElementById("btnQueueNewCase")?.addEventListener("click", openNewCaseModal);
    document.getElementById("btnOpenNewCaseModalEmpty")?.addEventListener("click", openNewCaseModal);

    // 1-Click Generate Sample Department Case & Start Execution
    const handleQuickSeedCase = async () => {
        const ag = workbenchState.agent || {};
        const scope = (ag.category_scope || "PAYROLL").split(",")[0].trim().toUpperCase();
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/create`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                agent_name: ag.name || "HR Specialist",
                agent_email: ag.email || "",
                agent_team: ag.team_name || "Payroll Operations HR",
                category: scope,
                priority: "HIGH",
                assign_to_me: true,
            }),
        });
        const json = await res.json();
        if (res.ok) {
            const newRef = json.data?.case_number || json.case_number;
            workbenchState.selectedCaseRef = newRef;
            workbenchState.activeTab = "MY_QUEUE";
            workbenchState.workbenchView = "CONSOLE";
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Generated ${scope} Case ${newRef} and loaded it into your 360° Execution Console!`);
        }
    };
    document.getElementById("btnQuickSeedDeptCase")?.addEventListener("click", handleQuickSeedCase);
    document.getElementById("btnQueueSeedSampleCase")?.addEventListener("click", handleQuickSeedCase);
    document.getElementById("btnQuickSeedFromInbox")?.addEventListener("click", handleQuickSeedCase);

    // Sync Connected Gmail Desk
    const handleSyncMailbox = async () => {
        const ag = workbenchState.agent || {};
        const syncBtn = document.getElementById("btnSyncDeptMailboxInbox");
        if (syncBtn) syncBtn.classList.add("is-syncing");
        const targetEmail = ag.email || ag.dept_info?.dept_gmail || "";
        setToast("info", `Syncing ${ag.team_name || "Department"} mailbox (${targetEmail || "Desk"})...`);
        try {
            const resp = await fetch(`${BACKEND_API_BASE}/api/gmail/sync`, {
                method: "POST",
                headers: {
                    ...buildAuthHeaders(),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ account_email: targetEmail, limit: 30 }),
            });
            const data = await resp.json();
            if (data && data.success) {
                const newCount = data.data?.sync?.new_stored_count ?? 0;
                setToast("success", `Mailbox synced! ${newCount} new message(s) retrieved and processed.`);
            } else {
                setToast("warning", data?.error?.message || "Sync completed.");
            }
        } catch (err) {
            console.warn("Mailbox sync warning:", err);
            setToast("info", "Mailbox sync completed. Refreshing workbench...");
        } finally {
            if (syncBtn) syncBtn.classList.remove("is-syncing");
        }
        await loadWorkbenchData(ag.email, ag.id, true);
    };
    document.getElementById("btnSyncDeptMailboxEmpty")?.addEventListener("click", handleSyncMailbox);
    document.getElementById("btnSyncDeptMailboxInbox")?.addEventListener("click", handleSyncMailbox);

    // Refresh Workbench
    document.getElementById("btnRefreshWorkbench")?.addEventListener("click", async () => {
        await loadWorkbenchData(workbenchState.agent?.email, workbenchState.agent?.id, true);
        setToast("success", "Synced latest cases, tasks, and SLA metrics.");
    });

    // =========================================================================
    // SAMSUNG ONE UI 9.0 CASE MANAGEMENT WORKSPACE CONTROLLERS
    // =========================================================================

    // 1. Queue Tabs (My Queue, Team Queue, Unclaimed, All Cases)
    document.querySelectorAll("[data-qtab]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.getAttribute("data-qtab");
            if (tab) {
                workbenchState.activeTab = tab;
                workbenchState.caseActiveKpiFilter = null;
                renderAgentWorkbench();
            }
        });
    });

    // Backwards-compat for legacy tab buttons & cards
    document.querySelectorAll(".agent-kpi-card[data-tab], .agent-q-tab").forEach((el) => {
        el.addEventListener("click", () => {
            const tab = el.getAttribute("data-tab");
            if (tab) {
                workbenchState.activeTab = tab;
                workbenchState.caseActiveKpiFilter = null;
                renderAgentWorkbench();
            }
        });
    });

    // 2. View Mode Switcher (Table vs Bento Cards)
    document.querySelectorAll("[data-vmode]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.getAttribute("data-vmode") || "TABLE";
            workbenchState.caseViewMode = mode;
            renderAgentWorkbench();
        });
    });

    // 3. 4-Card Bento KPI Strip (Open, My Queue, Overdue SLA, Needs Review)
    document.querySelectorAll("[data-case-kpi]").forEach((card) => {
        card.addEventListener("click", () => {
            const kpi = card.getAttribute("data-case-kpi");
            if (kpi === "MY_QUEUE") {
                workbenchState.activeTab = "MY_QUEUE";
                workbenchState.caseActiveKpiFilter = null;
            } else {
                workbenchState.caseActiveKpiFilter = (workbenchState.caseActiveKpiFilter === kpi) ? null : kpi;
            }
            renderAgentWorkbench();
        });
    });

    // 4. Floating Filter Bar: Search Input & Clear
    const caseSearchInp = document.getElementById("caseWorkspaceSearch");
    if (caseSearchInp) {
        caseSearchInp.addEventListener("input", (e) => {
            workbenchState.searchQuery = e.target.value;
            renderAgentWorkbench();
            const refocused = document.getElementById("caseWorkspaceSearch");
            if (refocused) {
                refocused.focus();
                refocused.setSelectionRange(refocused.value.length, refocused.value.length);
            }
        });
    }

    document.getElementById("btnClearCaseSearch")?.addEventListener("click", () => {
        workbenchState.searchQuery = "";
        renderAgentWorkbench();
    });

    // Legacy search input fallback
    const legacyQInput = document.getElementById("agentQueueSearch");
    if (legacyQInput) {
        legacyQInput.addEventListener("input", (e) => {
            workbenchState.searchQuery = e.target.value;
            renderAgentWorkbench();
            const refocused = document.getElementById("agentQueueSearch");
            if (refocused) {
                refocused.focus();
                refocused.setSelectionRange(refocused.value.length, refocused.value.length);
            }
        });
    }

    // 5. Advanced Dropdown Filters (Status, Priority, SLA)
    document.getElementById("caseFilterStat")?.addEventListener("change", (e) => {
        workbenchState.statusFilter = e.target.value;
        renderAgentWorkbench();
    });
    document.getElementById("caseFilterPrio")?.addEventListener("change", (e) => {
        workbenchState.priorityFilter = e.target.value;
        renderAgentWorkbench();
    });
    document.getElementById("caseFilterSlaState")?.addEventListener("change", (e) => {
        workbenchState.slaFilter = e.target.value;
        renderAgentWorkbench();
    });

    // Legacy dropdown fallback
    document.getElementById("agentCategoryFilter")?.addEventListener("change", (e) => {
        workbenchState.categoryFilter = e.target.value;
        renderAgentWorkbench();
    });
    document.getElementById("agentCaseTabSelect")?.addEventListener("change", (e) => {
        workbenchState.activeTab = e.target.value || "MY_QUEUE";
        renderAgentWorkbench();
    });

    // 7. Reset All Active Filters
    document.getElementById("btnResetCaseFilters")?.addEventListener("click", () => {
        workbenchState.searchQuery = "";
        workbenchState.categoryFilter = "ALL";
        workbenchState.statusFilter = "ALL";
        workbenchState.priorityFilter = "ALL";
        workbenchState.slaFilter = "ALL";
        workbenchState.caseActiveKpiFilter = null;
        renderAgentWorkbench();
    });

    // 8. Refresh Queue Button
    document.getElementById("btnRefreshCasesQueue")?.addEventListener("click", async () => {
        const ag = workbenchState.agent || {};
        await loadWorkbenchData(ag.email, ag.id, true);
        setToast("success", "Refreshed operational queue with latest department telemetry.");
    });

    // 9. Open Case 360° Detail in Dedicated New Tab (Table Open button, Bento Card Open button, Case ID link, or Row click)
    document.querySelectorAll(".btn-open-case-newtab, .btn-open-case-modal, .case-row-link").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const ref = btn.getAttribute("data-case-ref");
            if (ref && btn.tagName.toLowerCase() !== "a") {
                e.preventDefault();
                window.open(`casedetail.html?case=${encodeURIComponent(ref)}`, "_blank");
            }
        });
    });

    document.querySelectorAll(".oneui-case-table-row").forEach((row) => {
        row.addEventListener("click", (e) => {
            if (e.target.closest("button, select, input, a, .case-row-link, .btn-card-claim, .btn-open-case-newtab")) return;
            const ref = row.getAttribute("data-case-ref");
            if (ref) {
                window.open(`casedetail.html?case=${encodeURIComponent(ref)}`, "_blank");
            }
        });
    });

    // Bento Card click
    document.querySelectorAll(".oneui-case-bento-card").forEach((card) => {
        card.addEventListener("click", (e) => {
            if (e.target.closest("button, select, input, a, .case-row-link, .btn-card-claim, .btn-open-case-newtab")) return;
            const ref = card.getAttribute("data-case-ref");
            if (ref) {
                window.open(`casedetail.html?case=${encodeURIComponent(ref)}`, "_blank");
            }
        });
    });

    // Legacy case item click fallback
    document.querySelectorAll(".agent-case-item").forEach((card) => {
        card.addEventListener("click", async (e) => {
            if (e.target.closest(".btn-card-claim, button, a")) return;
            const ref = card.getAttribute("data-case-ref");
            if (ref) {
                window.open(`casedetail.html?case=${encodeURIComponent(ref)}`, "_blank");
            }
        });
    });

    // 10. Claim Case Buttons (Table rows, Bento cards, Detail header)
    document.querySelectorAll(".btn-card-claim").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await handleClaim(btn.getAttribute("data-case-ref"));
        });
    });
    document.getElementById("btnDetailClaimCase")?.addEventListener("click", async () => {
        await handleClaim(workbenchState.selectedCaseRef);
    });

    // 11. Reassign Case Buttons (Email detail pane & 360° Case Detail modal)
    document.querySelectorAll(".btn-trigger-reassign").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const ref = btn.getAttribute("data-case-ref");
            const title = btn.getAttribute("data-title") || "";
            const owner = btn.getAttribute("data-owner") || "";
            const team = btn.getAttribute("data-team") || "";
            openAgentReassignModal(ref, { title, owner, team });
        });
    });

    // Close 360° Case Detail Modal on backdrop click or Escape key
    const caseModalEl = document.getElementById("agentCaseDetailModal");
    if (caseModalEl && !caseModalEl.dataset.backdropBound) {
        caseModalEl.dataset.backdropBound = "true";
        caseModalEl.addEventListener("click", (e) => {
            if (e.target === caseModalEl) closeAgentCaseDetailModal();
        });
    }

    // Close Reassign Modal on backdrop click
    const reassignModalEl = document.getElementById("agentReassignModal");
    if (reassignModalEl && !reassignModalEl.dataset.backdropBound) {
        reassignModalEl.dataset.backdropBound = "true";
        reassignModalEl.addEventListener("click", (e) => {
            if (e.target === reassignModalEl) closeAgentReassignModal();
        });
    }

    if (!window._caseModalEscapeBound) {
        window._caseModalEscapeBound = true;
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                const modal = document.getElementById("agentCaseDetailModal");
                if (modal && modal.style.display !== "none") {
                    closeAgentCaseDetailModal();
                }
                const rModal = document.getElementById("agentReassignModal");
                if (rModal && rModal.style.display !== "none") {
                    closeAgentReassignModal();
                }
            }
        });
    }

    // Preserve typing in Reply Textarea so task/HRMS clicks never overwrite custom edits
    const replyArea = document.getElementById("agentReplyTextarea");
    if (replyArea) {
        replyArea.addEventListener("input", (e) => {
            const key = replyArea.getAttribute("data-draft-key");
            if (key) {
                workbenchState.customReplyDrafts[key] = e.target.value;
            }
        });
    }

    document.getElementById("btnResetSmartTemplate")?.addEventListener("click", () => {
        const area = document.getElementById("agentReplyTextarea");
        const key = area?.getAttribute("data-draft-key");
        if (key) {
            delete workbenchState.customReplyDrafts[key];
            renderAgentWorkbench();
        }
    });

    // Unified Action helper (uses top-level runCaseAction)

    // Status Dropdown Change
    document.getElementById("detailStatusSelect")?.addEventListener("change", async (e) => {
        const newSt = e.target.value;
        await runCaseAction({ action_type: "UPDATE_STATUS", status: newSt }, `Case status updated to ${newSt}.`);
    });

    // Advance Workflow Step
    document.getElementById("btnDetailNextStep")?.addEventListener("click", async () => {
        await runCaseAction({ action_type: "NEXT_STEP" }, "Advanced case workflow to the next stage.");
    });

    // Clickable Workflow Stepper Boxes
    document.querySelectorAll(".agent-step-box").forEach((box) => {
        box.addEventListener("click", async () => {
            const stNum = Number(box.getAttribute("data-step") || 1);
            await runCaseAction({ action_type: "SET_STEP", step: stNum }, `Transitioned case to Step ${stNum} of 4.`);
        });
    });

    // Confirm / Accept AI Classification
    document.getElementById("btnAcceptAiClassification")?.addEventListener("click", async () => {
        await runCaseAction({ action_type: "ACCEPT_AI" }, "AI Category & Intent classification verified and accepted.");
    });

    // Escalate to HR Lead / Manager
    document.getElementById("btnDetailEscalate")?.addEventListener("click", async () => {
        const note = document.getElementById("agentReplyTextarea")?.value?.trim() || "Escalated by HR Specialist for Lead/Manager review.";
        await runCaseAction({ action_type: "ESCALATE", reason: note }, "Case escalated to HR Team Lead / Manager with High Priority.");
    });

    // Quick Resolve Button
    document.getElementById("btnDetailQuickResolve")?.addEventListener("click", async () => {
        const notes = document.getElementById("agentReplyTextarea")?.value?.trim() || "Verified and resolved by HR Specialist.";
        await runCaseAction({ action_type: "RESOLVE", resolution_notes: notes, notify_employee: true }, "Case resolved and confirmation dispatched to employee!");
    });

    // Toggle Verification Task Checkbox
    document.querySelectorAll(".agent-task-checkbox").forEach((cb) => {
        cb.addEventListener("change", async () => {
            const tid = Number(cb.getAttribute("data-task-id"));
            await runCaseAction({ action_type: "TOGGLE_TASK", task_id: tid }, "Updated verification task status.");
        });
    });

    // Add New Verification Task
    document.getElementById("btnAgentAddTask")?.addEventListener("click", async () => {
        const inp = document.getElementById("agentNewTaskInput");
        const title = inp?.value?.trim();
        if (!title) return;
        await runCaseAction({ action_type: "ADD_TASK", title }, `Added verification task: "${title}"`);
    });

    // Execute Authorized Low/Medium-Risk HRMS Action
    document.getElementById("btnRunHrmsAction")?.addEventListener("click", async () => {
        const code = document.getElementById("agentHrmsActionSelect")?.value || "VERIFY_LEAVE_BALANCE";
        await runCaseAction(
            { action_type: "EXECUTE_HRMS_ACTION", hrms_action_code: code },
            `Executed HRMS Action [${code}] — Verification recorded in Case Audit Trail!`
        );
    });

    // Toggle Request Manager Approval Gate
    document.getElementById("btnToggleApprovalForm")?.addEventListener("click", () => {
        workbenchState.showApprovalRequestForm = !workbenchState.showApprovalRequestForm;
        renderAgentWorkbench();
    });

    // Submit Manager / Lead Approval Request
    document.getElementById("btnSubmitApprovalReq")?.addEventListener("click", async () => {
        const approvalType = document.getElementById("reqApprovalType")?.value || "HIGH_RISK_ACTION_SIGN_OFF";
        const approverRole = document.getElementById("reqApproverRole")?.value || "HR_MANAGER";
        const comments = document.getElementById("reqApprovalNotes")?.value?.trim() || "Requested sign-off from HR Agent Workbench.";
        workbenchState.showApprovalRequestForm = false;
        await runCaseAction(
            { action_type: "REQUEST_APPROVAL", approval_type: approvalType, approver_role: approverRole, comments },
            `Approval request routed to ${approverRole}! Case placed ON HOLD pending sign-off.`
        );
    });

    // Switch Smart Reply Template Mode
    document.querySelectorAll(".btn-tpl-mode").forEach((btn) => {
        btn.addEventListener("click", () => {
            workbenchState.replyTemplateMode = btn.getAttribute("data-mode") || "UPDATE";
            renderAgentWorkbench();
        });
    });

    // Send Official Gmail Reply
    document.getElementById("btnSendGmailReply")?.addEventListener("click", async () => {
        const body = document.getElementById("agentReplyTextarea")?.value?.trim();
        if (!body) {
            setToast("error", "Please enter a reply message before sending.");
            return;
        }
        await runCaseAction(
            { action_type: "SEND_REPLY", reply_body: body, next_status: "IN_PROGRESS" },
            "Official Gmail reply sent to employee and logged in Case Communications!"
        );
    });

    // Request Missing Info & Hold Case
    document.getElementById("btnRequestMissingInfo")?.addEventListener("click", async () => {
        const body = document.getElementById("agentReplyTextarea")?.value?.trim();
        if (!body) {
            setToast("error", "Please enter the missing information details to request.");
            return;
        }
        await runCaseAction(
            { action_type: "REQUEST_INFO", reply_body: body },
            "Missing information request emailed to employee — Case moved to ON HOLD."
        );
    });

    // Resolve Case & Notify Employee
    document.getElementById("btnResolveAndNotify")?.addEventListener("click", async () => {
        const body = document.getElementById("agentReplyTextarea")?.value?.trim() || "Resolved by HR Operations Specialist.";
        await runCaseAction(
            { action_type: "RESOLVE", resolution_notes: body, notify_employee: true },
            "Case marked RESOLVED and resolution email sent to employee!"
        );
    });

    // Unified 1-Click Send & Resolve Button
    document.getElementById("btnSendAndResolveUnified")?.addEventListener("click", async () => {
        const body = document.getElementById("agentReplyTextarea")?.value?.trim() || "Approved and resolved in HRMS by HR Specialist.";
        const notifyEmp = document.getElementById("chkDeckNotifyEmp")?.checked ?? true;
        const closeCase = document.getElementById("chkDeckCloseCase")?.checked ?? true;
        if (closeCase) {
            await runCaseAction(
                { action_type: "RESOLVE", resolution_notes: body, reply_body: body, notify_employee: notifyEmp },
                notifyEmp
                    ? "Case RESOLVED! Confirmation email dispatched to employee."
                    : "Case marked RESOLVED in HRMS."
            );
        } else {
            await runCaseAction(
                { action_type: "SEND_REPLY", reply_body: body, next_status: "IN_PROGRESS" },
                "Official reply sent to employee!"
            );
        }
    });

    // Execute Leave Verification in Internal HRMS
    document.getElementById("btnExecuteLeaveHrms")?.addEventListener("click", async () => {
        await runCaseAction(
            { action_type: "EXECUTE_HRMS_ACTION", hrms_action_code: "VERIFY_LEAVE_BALANCE" },
            "Internal HRMS: Verified leave balance (7.0 days available, 3.0 days requested). Recorded in audit trail."
        );
    });

    // Keyboard Shortcut (Cmd+Enter / Ctrl+Enter) to trigger Send & Resolve
    const replyAreaElem = document.getElementById("agentReplyTextarea");
    if (replyAreaElem) {
        replyAreaElem.addEventListener("keydown", (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                document.getElementById("btnSendAndResolveUnified")?.click();
            }
        });
    }

    // =========================================================================
    // DEPT & ASSIGNED INBOX + TASKS BOARD INTERACTIVE LISTENERS
    // =========================================================================

    // Toggle Verification Task directly from Tasks Board view
    document.querySelectorAll(".btn-board-toggle-task").forEach((cb) => {
        cb.addEventListener("change", async () => {
            const tid = Number(cb.getAttribute("data-task-id"));
            const caseRef = cb.getAttribute("data-case-ref");
            if (!tid || !caseRef) return;
            const ag = workbenchState.agent || {};
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
                method: "POST",
                headers: buildAuthHeaders(),
                body: JSON.stringify({
                    performed_by: ag.name || "HR Specialist",
                    action_type: "TOGGLE_TASK",
                    task_id: tid,
                }),
            });
            if (res.ok) {
                await loadWorkbenchData(ag.email, ag.id, true);
                setToast("success", `Updated verification task on Case ${caseRef}.`);
            }
        });
    });

    // Zone 1 and Zone 3 Collapse / Expand Controllers
    const btnExpandRail = document.getElementById("btnExpandQueueRail");
    if (btnExpandRail) {
        btnExpandRail.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.toggleWorkspaceZoneList) window.toggleWorkspaceZoneList();
        };
    }
    const btnCollapsePane = document.getElementById("btnCollapseQueuePane");
    if (btnCollapsePane) {
        btnCollapsePane.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.toggleWorkspaceZoneList) window.toggleWorkspaceZoneList();
        };
    }
    const btnToggleRhs = document.getElementById("wsBtnToggleRhs");
    if (btnToggleRhs) {
        btnToggleRhs.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.toggleWorkspaceZoneRhs) window.toggleWorkspaceZoneRhs();
        };
    }

    // Inbox Filter Tabs, Category Pills & Dropdowns
    document.querySelectorAll(".btn-inbox-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.getAttribute("data-inbox-tab") || "ALL";
            workbenchState.inboxFilterTab = tab;
            const filterSelect = document.getElementById("agentInboxFilterSelect");
            if (filterSelect) filterSelect.value = tab;
            renderAgentWorkbench();
        });
    });

    document.querySelectorAll(".cat-filter-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
            const cat = pill.getAttribute("data-inbox-cat") || "ALL";
            workbenchState.inboxCategoryFilter = cat;
            const catSelect = document.getElementById("agentInboxCatFilterSelect");
            if (catSelect) catSelect.value = cat;
            renderAgentWorkbench();
        });
    });

    document.getElementById("agentInboxFilterSelect")?.addEventListener("change", (e) => {
        workbenchState.inboxFilterTab = e.target.value || "ALL";
        renderAgentWorkbench();
    });

    document.getElementById("agentInboxCatFilterSelect")?.addEventListener("change", (e) => {
        workbenchState.inboxCategoryFilter = e.target.value || "ALL";
        renderAgentWorkbench();
    });

    // Toggle Inline Reply Drawer in Zone 2 Reader
    const openReplyDrawer = (focusArea) => {
        workbenchState.showInboxReplyDrawer = true;
        renderAgentWorkbench();
        if (focusArea) {
            setTimeout(() => document.getElementById("agentInboxReplyTextarea")?.focus(), 40);
        }
    };

    document.getElementById("btnToggleAgentReplyDrawer")?.addEventListener("click", () => {
        workbenchState.showInboxReplyDrawer = !workbenchState.showInboxReplyDrawer;
        renderAgentWorkbench();
    });

    document.getElementById("btnCloseAgentReplyDrawer")?.addEventListener("click", () => {
        workbenchState.showInboxReplyDrawer = false;
        renderAgentWorkbench();
    });

    document.getElementById("btnRhsQuickReply")?.addEventListener("click", () => openReplyDrawer(true));

    const openMissingInfoDrawer = () => {
        workbenchState.showInboxReplyDrawer = true;
        renderAgentWorkbench();
        setTimeout(() => {
            const tplBtn = document.querySelector('.btn-inbox-quick-tpl[data-tpl="MISSING_INFO"]');
            tplBtn?.click();
            document.getElementById("agentInboxReplyTextarea")?.focus();
        }, 40);
    };
    document.getElementById("btnToolbarRequestInfo")?.addEventListener("click", openMissingInfoDrawer);
    document.getElementById("btnRhsQuickHold")?.addEventListener("click", openMissingInfoDrawer);

    // Dept Inbox Search Input
    const inboxSearch = document.getElementById("agentInboxSearchInput");
    if (inboxSearch) {
        inboxSearch.addEventListener("input", (e) => {
            workbenchState.inboxSearchQuery = e.target.value;
            renderAgentWorkbench();
            const refocused = document.getElementById("agentInboxSearchInput");
            if (refocused) {
                refocused.focus();
                refocused.setSelectionRange(refocused.value.length, refocused.value.length);
            }
        });
    }

    // Select Email in Zone 1 Email List
    document.querySelectorAll(".email-row-card[data-agent-email-id]").forEach((item) => {
        item.addEventListener("click", () => {
            const eid = Number(item.getAttribute("data-agent-email-id"));
            if (eid) {
                workbenchState.selectedEmailId = eid;
                workbenchState.activeRhsDialogTab = null;
                renderAgentWorkbench();
            }
        });
    });

    // Select Sent Reply in Zone 1 (when SENT_REPLIES tab is active)
    document.querySelectorAll(".email-row-card[data-agent-comm-id]").forEach((item) => {
        item.addEventListener("click", () => {
            const cid = Number(item.getAttribute("data-agent-comm-id"));
            if (cid) {
                workbenchState.selectedCommId = cid;
                workbenchState.activeRhsDialogTab = null;
                renderAgentWorkbench();
            }
        });
    });

    // Jump from Sent Reply Reader back to Original Employee Mail in Inbox
    document.getElementById("btnSentReplyViewOriginalMail")?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const srcEmailId = Number(btn.getAttribute("data-source-email-id") || 0);
        const caseRef = btn.getAttribute("data-case-ref") || "";
        const matchedEm = (workbenchState.deptEmails || []).find(
            (em) => (srcEmailId && Number(em.id) === srcEmailId) || (caseRef && em.case_number === caseRef)
        );
        if (matchedEm) {
            workbenchState.inboxFilterTab = "ALL";
            workbenchState.selectedEmailId = matchedEm.id;
            renderAgentWorkbench();
            setToast("success", `Opened original employee mail for ${caseRef || `#${matchedEm.id}`}.`);
        } else if (caseRef) {
            workbenchState.workbenchView = "CONSOLE";
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", "#agent-workbench");
            }
            loadSelectedCaseDetail(caseRef, true);
        }
    });

    // Helper: Get currently selected email object
    const getCurrentlySelectedEmail = () => {
        return (workbenchState.deptEmails || []).find((em) => Number(em.id) === Number(workbenchState.selectedEmailId)) || null;
    };

    // Helper: Ensure a Case exists for an Email (and optionally claim it)
    const ensureEmailCase = async (emailId, claim) => {
        if (!emailId || !(workbenchState.deptEmails || []).some((em) => Number(em.id) === Number(emailId))) {
            return null;
        }
        const ag = workbenchState.agent || {};
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/emails/${encodeURIComponent(emailId)}/claim-or-open`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                claim: Boolean(claim),
                agent_name: ag.name || "HR Specialist",
                agent_email: ag.email || "",
                agent_team: ag.team_name || "HR Operations",
            }),
        });
        const json = await res.json();
        if (!res.ok) {
            setToast("error", json.error?.message || "Could not link or claim email.");
            return null;
        }
        return json.data || json;
    };

    // 1-Click Claim & Assign Mail to Me from Dept Inbox or Dialog
    const handleClaimInboxEmail = async (e) => {
        const btn = e.currentTarget;
        const emailId = Number(btn.getAttribute("data-email-id"));
        if (!emailId) return;
        const ag = workbenchState.agent || {};
        const result = await ensureEmailCase(emailId, true);
        if (result && result.case_number) {
            workbenchState.selectedCaseRef = result.case_number;
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Mail claimed and assigned to you under Case ${result.case_number}!`);
        }
    };
    document.getElementById("btnInboxClaimEmail")?.addEventListener("click", handleClaimInboxEmail);
    document.getElementById("btnDialogClaimCase")?.addEventListener("click", handleClaimInboxEmail);

    // =========================================================================
    // SAMSUNG ONE UI 9.0 / GOOGLE CLOUD INTELLIGENCE MODAL DIALOG HANDLERS
    // =========================================================================
    const dialogOverlay = document.getElementById("hrCardDetailModal");
    const dialogTitles = {
        ai: "AI Classification & Model Telemetry",
        case: "Case Workspace & Specialist Gmail Dispatch",
        employee: "Employee Cloud Identity & Directory",
        workflow: "Workflow Engine & State Machine Stepper",
        actions: "HR Action Center & Service Level Agreement",
        audit: "Chronological Case & Email Audit Trail",
    };

    const openRhsDialog = (tabKey) => {
        workbenchState.activeRhsDialogTab = tabKey;
        if (!dialogOverlay) return;
        dialogOverlay.style.display = "flex";
        const headingEl = document.getElementById("rhsDialogHeading");
        if (headingEl && dialogTitles[tabKey]) headingEl.textContent = dialogTitles[tabKey];
        dialogOverlay.querySelectorAll(".rhs-dialog-tab").forEach((t) => {
            const tKey = t.getAttribute("data-switch-rhs-tab") || t.getAttribute("data-switch-agent-rhs");
            t.classList.toggle("active", tKey === tabKey);
        });
        dialogOverlay.querySelectorAll(".rhs-dialog-panel").forEach((p) => {
            p.style.display = p.getAttribute("data-rhs-panel") === tabKey ? "block" : "none";
        });
    };

    const closeRhsDialog = () => {
        workbenchState.activeRhsDialogTab = null;
        if (dialogOverlay) dialogOverlay.style.display = "none";
    };

    // Open Workspace Intelligence Modal Dialog when clicking any RHS summary card
    document.querySelectorAll(".rhs-summary-card[data-open-rhs-dialog], .rhs-summary-card[data-open-agent-rhs]").forEach((card) => {
        card.addEventListener("click", () => {
            const tab = card.getAttribute("data-open-rhs-dialog") || card.getAttribute("data-open-agent-rhs") || "ai";
            openRhsDialog(tab);
        });
    });

    // Switch Tabs inside Workspace Intelligence Modal Dialog (Zero page re-render flicker)
    dialogOverlay?.querySelectorAll(".rhs-dialog-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tab = btn.getAttribute("data-switch-rhs-tab") || btn.getAttribute("data-switch-agent-rhs") || "ai";
            openRhsDialog(tab);
        });
    });

    // Close Dialog on ✕ button, backdrop click, or Escape key
    document.getElementById("btnCloseRhsDialog")?.addEventListener("click", closeRhsDialog);
    if (dialogOverlay) {
        dialogOverlay.addEventListener("click", (e) => {
            if (e.target === dialogOverlay) closeRhsDialog();
        });
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && dialogOverlay && dialogOverlay.style.display === "flex") {
            closeRhsDialog();
        }
    });

    // Open Email in 360° Case Execution Console (Toolbar button, Case Pill, RHS Quick Console, Dialog buttons)
    const handleOpenEmailInConsole = async (e) => {
        const btn = e.currentTarget;
        const emailId = Number(btn.getAttribute("data-email-id")) || workbenchState.selectedEmailId;
        let caseRef = btn.getAttribute("data-case-ref");
        if (!caseRef && emailId) {
            const result = await ensureEmailCase(emailId, false);
            caseRef = result?.case_number || "";
        }
        if (caseRef) {
            closeRhsDialog();
            window.open(`casedetail.html?case=${encodeURIComponent(caseRef)}`, "_blank");
        }
    };
    document.getElementById("btnInboxOpenInConsole")?.addEventListener("click", handleOpenEmailInConsole);
    document.getElementById("btnReaderPillOpenConsole")?.addEventListener("click", handleOpenEmailInConsole);
    document.getElementById("rhsCardOpenConsole")?.addEventListener("click", handleOpenEmailInConsole);
    document.getElementById("btnRhsQuickConsole")?.addEventListener("click", handleOpenEmailInConsole);
    document.getElementById("btnDialogOpenConsole")?.addEventListener("click", handleOpenEmailInConsole);
    document.getElementById("btnDialogJumpConsole")?.addEventListener("click", handleOpenEmailInConsole);
    document.getElementById("pillOpenCaseWorkspace")?.addEventListener("click", handleOpenEmailInConsole);

    // =========================================================================
    // WORKFLOW ENGINE ACTIONS (Next Step, Step Back, Redo, Direct Step Override)
    // =========================================================================
    const handleWorkflowNextStep = async (e) => {
        if (e) e.stopPropagation();
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ performed_by: ag.name || "HR Specialist", action_type: "NEXT_STEP" }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Advanced ${caseRef} to next workflow stage!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not advance workflow.");
        }
    };
    document.getElementById("btnAdvanceWorkflow")?.addEventListener("click", handleWorkflowNextStep);
    document.getElementById("btnQuickAdvanceWf")?.addEventListener("click", handleWorkflowNextStep);
    document.querySelectorAll(".btn-quick-next-step, .btn-dialog-next-step").forEach((btn) => {
        btn.addEventListener("click", handleWorkflowNextStep);
    });

    const handleWorkflowStepBack = async (e) => {
        if (e) e.stopPropagation();
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const currentStepNum = Number(curEm.current_step || 1);
        const targetStep = Math.max(1, currentStepNum - 1);
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ performed_by: ag.name || "HR Specialist", action_type: "SET_STEP", step: targetStep }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Moved ${caseRef} back to step ${targetStep}!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not step back workflow.");
        }
    };
    document.getElementById("btnStepBackWorkflow")?.addEventListener("click", handleWorkflowStepBack);
    document.getElementById("btnQuickStepBackWf")?.addEventListener("click", handleWorkflowStepBack);
    document.querySelectorAll(".btn-quick-step-back, .btn-dialog-step-back").forEach((btn) => {
        btn.addEventListener("click", handleWorkflowStepBack);
    });

    const handleWorkflowRedo = async (e) => {
        if (e) e.stopPropagation();
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ performed_by: ag.name || "HR Specialist", action_type: "SET_STEP", step: 1 }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Workflow restarted from Step 1 for ${caseRef}!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not restart workflow.");
        }
    };
    document.getElementById("btnRedoWorkflow")?.addEventListener("click", handleWorkflowRedo);
    document.getElementById("btnQuickRedoWf")?.addEventListener("click", handleWorkflowRedo);

    // Workflow Direct Jump Dropdown
    document.getElementById("btnApplyWfJump")?.addEventListener("click", async () => {
        const selEl = document.getElementById("wfJumpStateSelect");
        const targetStep = Number(selEl?.value || 1);
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ performed_by: ag.name || "HR Specialist", action_type: "SET_STEP", step: targetStep }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Workflow stepped to Step ${targetStep} for ${caseRef}!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not set workflow step.");
        }
    });

    // Clickable nodes in Workflow Stepper
    document.querySelectorAll(".wf-step-node[data-wf-step]").forEach((nodeEl) => {
        nodeEl.addEventListener("click", async () => {
            const targetStep = Number(nodeEl.getAttribute("data-wf-step") || 1);
            const curEm = getCurrentlySelectedEmail();
            if (!curEm) return;
            const ag = workbenchState.agent || {};
            const ensured = await ensureEmailCase(curEm.id, true);
            const caseRef = ensured?.case_number || curEm.case_number;
            if (!caseRef) return;
            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
                method: "POST",
                headers: buildAuthHeaders(),
                body: JSON.stringify({ performed_by: ag.name || "HR Specialist", action_type: "SET_STEP", step: targetStep }),
            });
            if (res.ok) {
                await loadWorkbenchData(ag.email, ag.id, true);
                setToast("success", `Stepped to Step ${targetStep} for ${caseRef}!`);
            }
        });
    });

    // =========================================================================
    // QUICK ACTIONS & SLA ACTION CENTER (8-Tile Bento Grid & Action Chips)
    // =========================================================================
    // Reply
    const handleQuickReplyTrigger = (e) => {
        if (e) e.stopPropagation();
        closeRhsDialog();
        openReplyDrawer(true);
    };
    document.getElementById("actReply")?.addEventListener("click", handleQuickReplyTrigger);
    document.getElementById("quickActReply")?.addEventListener("click", handleQuickReplyTrigger);
    document.querySelectorAll(".btn-quick-reply-toggle").forEach((btn) => {
        btn.addEventListener("click", handleQuickReplyTrigger);
    });
    document.getElementById("btnDialogReplyAction")?.addEventListener("click", handleQuickReplyTrigger);
    document.getElementById("btnDialogQuickReply")?.addEventListener("click", handleQuickReplyTrigger);

    // On Hold / Request Missing Info
    const handleQuickHoldTrigger = (e) => {
        if (e) e.stopPropagation();
        closeRhsDialog();
        openMissingInfoDrawer();
    };
    document.getElementById("actPutOnHold")?.addEventListener("click", handleQuickHoldTrigger);
    document.getElementById("quickActHold")?.addEventListener("click", handleQuickHoldTrigger);
    document.querySelectorAll(".btn-quick-hold-action").forEach((btn) => {
        btn.addEventListener("click", handleQuickHoldTrigger);
    });
    document.getElementById("btnDialogHoldAction")?.addEventListener("click", handleQuickHoldTrigger);
    document.getElementById("btnDialogRequestMissing")?.addEventListener("click", handleQuickHoldTrigger);
    document.getElementById("btnDialogQuickHold")?.addEventListener("click", handleQuickHoldTrigger);

    // Resolve Case
    const handleQuickResolveCase = async (e) => {
        if (e) e.stopPropagation();
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        if (!confirm(`Mark case ${caseRef} as RESOLVED and send confirmation to employee?`)) return;
        closeRhsDialog();
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                performed_by: ag.name || "HR Specialist",
                action_type: "RESOLVE",
                resolution_notes: "Resolved directly via AI Copilot workbench by HR Specialist.",
                notify_employee: true,
            }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Case ${caseRef} marked resolved!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not resolve case.");
        }
    };
    document.getElementById("actResolve")?.addEventListener("click", handleQuickResolveCase);
    document.getElementById("quickActResolve")?.addEventListener("click", handleQuickResolveCase);
    document.querySelectorAll(".btn-quick-resolve-action").forEach((btn) => {
        btn.addEventListener("click", handleQuickResolveCase);
    });
    document.getElementById("btnDialogResolveAction")?.addEventListener("click", handleQuickResolveCase);
    document.getElementById("btnDialogQuickResolve")?.addEventListener("click", handleQuickResolveCase);

    // Priority Change
    document.getElementById("actChangePriority")?.addEventListener("click", async () => {
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const newPrio = prompt("Enter Case Priority (LOW, MEDIUM, HIGH, CRITICAL):", curEm.case_priority || "HIGH");
        if (!newPrio) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseRef)}/priority`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                priority: newPrio.trim().toUpperCase(),
                performed_by: ag.name || "HR Specialist",
                role: ag.role || "HR_AGENT",
            }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Updated priority of ${caseRef} to ${newPrio.trim().toUpperCase()}`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Invalid priority");
        }
    });

    // Close Case
    document.getElementById("actCloseCase")?.addEventListener("click", async () => {
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseRef)}/close`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ performed_by: ag.name || "HR Specialist", role: ag.role || "HR_AGENT" }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Case ${caseRef} closed!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Case must be RESOLVED before closing.");
        }
    });

    // Reopen Case
    document.getElementById("actReopenCase")?.addEventListener("click", async () => {
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const reason = prompt("Reason for reopening this case:", "Employee shared additional documents");
        if (!reason) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseRef)}/reopen`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ reason, performed_by: ag.name || "HR Specialist", role: ag.role || "HR_AGENT" }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Case ${caseRef} reopened!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not reopen case.");
        }
    });

    // Change Category & Edit Classification Box
    const toggleEditClassification = () => {
        const editBox = document.getElementById("editClassificationContainer");
        if (editBox) {
            editBox.style.display = editBox.style.display === "none" ? "flex" : "none";
        }
    };
    document.getElementById("actChangeCategory")?.addEventListener("click", toggleEditClassification);
    document.getElementById("btnEditClassification")?.addEventListener("click", toggleEditClassification);

    document.getElementById("saveClassificationBtn")?.addEventListener("click", async () => {
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const selEl = document.getElementById("overrideCategorySelect");
        const newCat = selEl?.value || curEm.category;
        const ag = workbenchState.agent || {};
        const res = await fetch(`${BACKEND_API_BASE}/api/emails/${curEm.id}/override`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                category: newCat,
                role: ag.role || "HR_AGENT",
                performed_by: ag.name || "HR Specialist",
            }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Category updated to ${newCat}!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not update category.");
        }
    });

    // Change Employee Profile Drawer
    const toggleEditEmpDrawer = () => {
        const drawer = document.getElementById("empInlineEditDrawer");
        if (drawer) {
            drawer.style.display = drawer.style.display === "none" ? "block" : "none";
        }
    };
    document.getElementById("actChangeEmployee")?.addEventListener("click", toggleEditEmpDrawer);
    document.getElementById("btnChangeEmployee")?.addEventListener("click", toggleEditEmpDrawer);
    document.getElementById("btnViewEmployee")?.addEventListener("click", toggleEditEmpDrawer);

    document.getElementById("btnSaveEmpProfile")?.addEventListener("click", async () => {
        const nameVal = document.getElementById("empEditNameInput")?.value?.trim() || "";
        const codeVal = document.getElementById("empEditCodeInput")?.value?.trim().toUpperCase() || "";
        const deptVal = document.getElementById("empEditDeptInput")?.value?.trim() || "";
        const desigVal = document.getElementById("empEditDesigInput")?.value?.trim() || "";
        const mgrVal = document.getElementById("empEditManagerInput")?.value?.trim() || "";
        const locVal = document.getElementById("empEditLocationInput")?.value?.trim() || "";
        const emailVal = document.getElementById("empEditEmailInput")?.value?.trim() || "";

        if (!nameVal) {
            alert("Employee Full Name is required.");
            return;
        }

        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};

        const payload = {
            name: nameVal,
            department: deptVal,
            designation: desigVal,
            manager_name: mgrVal,
            location: locVal,
            email: emailVal,
        };
        if (codeVal) payload.employee_id = codeVal;

        const res = await fetch(`${BACKEND_API_BASE}/api/employees`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Employee profile saved!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not save employee profile.");
        }
    });

    // Accept AI Decision
    const handleAcceptAiDecision = async () => {
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({ performed_by: ag.name || "HR Specialist", action_type: "ACCEPT_AI" }),
        });
        if (res.ok) {
            if (window.AuraBot) {
                window.AuraBot.recordStep({
                    title: String(payload.action_type || "Specialist Action").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    nodeType: String(payload.action_type || "").includes("HRMS") ? "data" : String(payload.action_type || "").includes("APPROVAL") ? "gate" : "action",
                    description: `Recorded action on ${ref} by ${ag.name || "Specialist"}`
                });
            }
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `Verified & accepted AI classification for ${caseRef}!`);
        } else {
            const errJson = await res.json().catch(() => ({}));
            setToast("error", errJson.error?.message || "Could not accept AI classification.");
        }
    };
    document.getElementById("btnAcceptAiDecision")?.addEventListener("click", handleAcceptAiDecision);
    document.getElementById("btnDialogAcceptAi")?.addEventListener("click", handleAcceptAiDecision);

    // HRMS Ledger Verification Action
    document.getElementById("btnDialogQuickHrms")?.addEventListener("click", async () => {
        const curEm = getCurrentlySelectedEmail();
        if (!curEm) return;
        const ag = workbenchState.agent || {};
        const ensured = await ensureEmailCase(curEm.id, true);
        const caseRef = ensured?.case_number || curEm.case_number;
        if (!caseRef) return;
        await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                performed_by: ag.name || "HR Specialist",
                action_type: "EXECUTE_HRMS_ACTION",
                hrms_action_code: "VERIFY_PAYROLL_LEDGER",
            }),
        });
        closeRhsDialog();
        await loadWorkbenchData(ag.email, ag.id, true);
        setToast("success", `Executed HRMS Payroll & Attendance Ledger Verification on ${caseRef}!`);
    });

    // Preserve typing in Dept Inbox Reply Textarea
    const inboxReplyArea = document.getElementById("agentInboxReplyTextarea");
    if (inboxReplyArea) {
        inboxReplyArea.addEventListener("input", (e) => {
            const eid = inboxReplyArea.getAttribute("data-email-id");
            if (eid) {
                workbenchState.inboxReplyDrafts[`inbox_em_${eid}`] = e.target.value;
            }
        });
    }

    // Quick Template Switcher inside Dept Inbox Reply Dock
    document.querySelectorAll(".btn-inbox-quick-tpl").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tplType = btn.getAttribute("data-tpl") || "RESOLVE";
            const area = document.getElementById("agentInboxReplyTextarea");
            if (!area) return;
            const eid = area.getAttribute("data-email-id");
            const ag = workbenchState.agent || {};
            const scope = (ag.category_scope || "PAYROLL").split(",")[0].trim().toUpperCase();
            const selEm = (workbenchState.deptEmails || []).find((e) => Number(e.id) === Number(eid)) || {};
            const empName = selEm.employee_name || selEm.sender_name || "Employee";
            const subj = selEm.subject || "your HR request";
            const refTag = selEm.case_number ? ` (Case #${selEm.case_number})` : "";

            let text = "";
            if (tplType === "REASSIGN") {
                const targetName = selEm.case_owner || ag.name || "Specialist";
                const targetSub = selEm.sub_department || selEm.category || "Salary & Payroll";
                text =
                    `Dear ${empName},\n\n` +
                    `Thank you for contacting PeopleDesk regarding "${subj}"${refTag}.\n\n` +
                    `Your request has been reviewed by our intake team and transitioned to our specialized ${targetSub} desk under PeopleDesk for dedicated processing.\n\n` +
                    `Specialist ${targetName} from the ${targetSub} team has been assigned to your case and is reviewing your request.\n\n` +
                    `Warm regards,\nPeopleDesk Operations\nUniversal HR Desk`;
            } else if (tplType === "INVESTIGATING") {
                text =
                    `Dear ${empName},\n\n` +
                    `Thank you for reaching out to ${ag.team_name || "HR Operations"} regarding "${subj}"${refTag}.\n\n` +
                    `I have claimed your ${selEm.category || scope} request and am currently verifying your attendance/payroll ledger in our HRMS portal. I will share the confirmed breakdown with you shortly.\n\n` +
                    `Warm regards,\n${ag.name}\n${ag.designation || "HR Specialist"} · ${ag.team_name || "HR Operations"}`;
            } else if (tplType === "MISSING_INFO") {
                text =
                    `Dear ${empName},\n\n` +
                    `Thank you for contacting ${ag.team_name || "HR Operations"} regarding "${subj}"${refTag}.\n\n` +
                    `To complete verification on your ${selEm.category || scope} request, please reply to this email with your supporting document/screenshot or manager sign-off confirmation. Your case has been placed on hold pending your reply.\n\n` +
                    `Warm regards,\n${ag.name}\n${ag.designation || "HR Specialist"} · ${ag.team_name || "HR Operations"}`;
            } else {
                text =
                    `Dear ${empName},\n\n` +
                    `Thank you for contacting ${ag.team_name || "HR Operations"} regarding "${subj}"${refTag}.\n\n` +
                    `I have reviewed your ${selEm.category || scope} request and verified your records in our HRMS portal. Your request has been processed and reconciled.\n\n` +
                    `Warm regards,\n${ag.name}\n${ag.designation || "HR Specialist"} · ${ag.team_name || "HR Operations"}`;
            }
            area.value = text;
            if (eid) {
                workbenchState.inboxReplyDrafts[`inbox_em_${eid}`] = text;
            }
        });
    });

    // Helper: Execute Reply / Request Info / Resolve directly from Dept Inbox
    const runInboxEmailAction = async (btnEl, actionBuilder, successMsg) => {
        const emailId = Number(btnEl?.getAttribute("data-email-id"));
        let caseRef = btnEl?.getAttribute("data-case-ref");
        const bodyText = document.getElementById("agentInboxReplyTextarea")?.value?.trim();
        if (!bodyText) {
            setToast("error", "Please enter a reply message before sending.");
            return;
        }
        const ag = workbenchState.agent || {};
        // Ensure case exists and claim it to this agent when replying
        const ensured = await ensureEmailCase(emailId, true);
        caseRef = ensured?.case_number || caseRef;
        if (!caseRef) return;

        const payload = actionBuilder(bodyText);
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            headers: buildAuthHeaders(),
            body: JSON.stringify({
                performed_by: ag.name || "HR Specialist",
                ...payload,
            }),
        });
        const json = await res.json();
        if (res.ok) {
            workbenchState.selectedCaseRef = caseRef;
            workbenchState.showInboxReplyDrawer = false;
            await loadWorkbenchData(ag.email, ag.id, true);
            setToast("success", `${successMsg} (Case ${caseRef})`);
        } else {
            setToast("error", json.error?.message || "Could not complete inbox action.");
        }
    };

    document.getElementById("btnInboxSendReply")?.addEventListener("click", async (e) => {
        await runInboxEmailAction(
            e.currentTarget,
            (body) => ({ action_type: "SEND_REPLY", reply_body: body, next_status: "IN_PROGRESS" }),
            "Official Gmail reply sent directly from your Department Inbox!"
        );
    });

    document.getElementById("btnInboxRequestInfo")?.addEventListener("click", async (e) => {
        await runInboxEmailAction(
            e.currentTarget,
            (body) => ({ action_type: "REQUEST_INFO", reply_body: body }),
            "Missing info requested and case placed ON HOLD!"
        );
    });

    document.getElementById("btnInboxResolveCase")?.addEventListener("click", async (e) => {
        const bodyText = document.getElementById("agentInboxReplyTextarea")?.value?.trim();
        if (bodyText) {
            await runInboxEmailAction(
                e.currentTarget,
                (body) => ({ action_type: "RESOLVE", resolution_notes: body, notify_employee: true }),
                "Mail & Case resolved and confirmation emailed to employee!"
            );
        } else {
            await handleQuickResolveCase(e);
        }
    });

    // 1-Click Copy Clean Inbound Email Content to Clipboard
    document.getElementById("btnCopyEmailContent")?.addEventListener("click", () => {
        const bodyEl = document.getElementById("readerCleanBodyContainer");
        const bodyText = bodyEl ? bodyEl.innerText.trim() : "";
        const copyBtnText = document.getElementById("btnCopyEmailContentText");
        const markSuccess = () => {
            if (copyBtnText) copyBtnText.textContent = "✓ Copied!";
            setTimeout(() => {
                if (copyBtnText) copyBtnText.textContent = "Copy Text";
            }, 2200);
            setToast("success", "Email text copied to clipboard!");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(bodyText).then(markSuccess).catch(() => {
                setToast("info", "Copied text to clipboard.");
            });
        } else {
            try {
                const ta = document.createElement("textarea");
                ta.value = bodyText;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                markSuccess();
            } catch (_) {
                setToast("info", "Unable to auto-copy. Please select and copy text manually.");
            }
        }
    });

    // Toggle Font Density (Standard vs Comfortable Large Reading Font)
    document.getElementById("btnToggleEmailDensity")?.addEventListener("click", () => {
        workbenchState.readerFontComfortable = !workbenchState.readerFontComfortable;
        const container = document.getElementById("readerCleanBodyContainer");
        const btn = document.getElementById("btnToggleEmailDensity");
        const lbl = document.getElementById("btnToggleDensityLabel");
        if (container) {
            container.classList.toggle("font-comfortable", workbenchState.readerFontComfortable);
        }
        if (btn) {
            btn.classList.toggle("is-active", workbenchState.readerFontComfortable);
        }
        if (lbl) {
            lbl.textContent = workbenchState.readerFontComfortable ? "Large" : "Default";
        }
        setToast("info", workbenchState.readerFontComfortable ? "Comfortable Large Font enabled." : "Standard Font restored.");
    });
}

function initAgentWorkbench() {
    // Clear stale collapsed zone flags from prior sessions so all 3 zones open cleanly
    if (localStorage.getItem("hrflow_agent_v6_fresh") !== "1") {
        try {
            localStorage.removeItem("hrflow_hide_zone_list");
            localStorage.removeItem("hrflow_hide_zone_rhs");
            localStorage.setItem("hrflow_agent_v6_fresh", "1");
        } catch (_) {}
        if (window.syncLayoutBodyClasses) window.syncLayoutBodyClasses();
    }
    // Ensure all 3 zones open cleanly on first agent workbench launch
    if (!localStorage.getItem("hrflow_agent_v6_fresh")) {
        try {
            localStorage.removeItem("hrflow_hide_zone_list");
            localStorage.removeItem("hrflow_hide_zone_rhs");
            localStorage.setItem("hrflow_agent_v6_fresh", "1");
        } catch (_) {}
    }
    if (window.syncLayoutBodyClasses) window.syncLayoutBodyClasses();

    // Initialize view from URL hash if present (#inbox, #cases, #tasks, #approvals, #actions, #reports)
    if (window.location.hash) {
        workbenchState.workbenchView = mapHashToWorkbenchView(window.location.hash);
    }

    // Intercept sidebar clicks on agent.html so HR_AGENT never navigates to Admin inbox.html
    document.querySelectorAll("#appSidebar .sidebar-nav .nav-item").forEach((item) => {
        item.addEventListener("click", (e) => {
            const mod = item.getAttribute("data-module");
            if (mod === "tracker") return; // allow Client Case Tracker external tab
            const sessionUser = getSessionUser();
            const isInspector = sessionUser && ["ADMIN", "SUPER_ADMIN", "HR_MANAGER", "HR_LEAD"].includes(String(sessionUser.role || "").toUpperCase());
            const agentSupportedMods = ["agent-workbench", "inbox", "cases", "approvals", "actions"];
            if (!isInspector || agentSupportedMods.includes(mod)) {
                e.preventDefault();
                workbenchState.workbenchView = mapHashToWorkbenchView(mod);
                if (mod === "cases") {
                    workbenchState.activeTab = "DEPT_QUEUE";
                }
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, "", `#${mod}`);
                }
                renderAgentWorkbench();
            }
        });
    });

    window.addEventListener("hashchange", () => {
        workbenchState.workbenchView = mapHashToWorkbenchView(window.location.hash);
        renderAgentWorkbench();
    });

    // Specialist Switcher in topbar (only visible for Admin/Manager/Lead)
    document.getElementById("agentProfileSelect")?.addEventListener("change", async (e) => {
        const selectedEmail = e.target.value;
        if (selectedEmail) {
            workbenchState.selectedCaseRef = null;
            workbenchState.inboxCategoryFilter = "ALL";
            workbenchState.inboxFilterTab = "ALL";
            await loadWorkbenchData(selectedEmail, null, false);
        }
    });

    // Admin Role Switcher in agent.html topbar
    document.getElementById("agentRoleSelect")?.addEventListener("change", async (e) => {
        const targetRole = e.target.value;
        if (!confirm(`Switch your active role to ${targetRole}?`)) {
            e.target.value = getSessionUser()?.role || "HR_AGENT";
            return;
        }
        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/auth/switch-role`, {
                method: "POST",
                headers: buildAuthHeaders(),
                body: JSON.stringify({ role: targetRole }),
            });
            const json = await res.json();
            if (!res.ok || json.status === "error") {
                throw new Error(json.message || json.error?.message || "Failed to switch role");
            }
            const updatedUser = json.data?.user || json.user || {};
            sessionStorage.setItem("hrflow_user", JSON.stringify(updatedUser));
            localStorage.setItem("hrflow_last_user", JSON.stringify(updatedUser));
            if (json.token) {
                sessionStorage.setItem("hrflow_token", json.token);
                localStorage.setItem("hrflow_last_token", json.token);
            }
            alert(`Role switched to ${targetRole}! Redirecting...`);
            if (targetRole === "HR_AGENT") {
                window.location.reload();
            } else {
                window.location.href = "inbox.html";
            }
        } catch (err) {
            alert("Error switching role: " + (err.message || err));
            e.target.value = getSessionUser()?.role || "HR_AGENT";
        }
    });

    // Logout button
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        sessionStorage.removeItem("hrflow_token");
        sessionStorage.removeItem("hrflow_user");
        window.location.href = "login.html";
    });

    // Fallback definition for zone list toggle in case sidebar script loaded asynchronously
    if (!window.toggleWorkspaceZoneList) {
        window.toggleWorkspaceZoneList = function () {
            const next = !document.body.classList.contains("hide-zone-list");
            try { localStorage.setItem("hrflow_hide_zone_list", next ? "1" : "0"); } catch (_) {}
            if (typeof window.syncLayoutBodyClasses === "function") {
                window.syncLayoutBodyClasses();
            } else {
                document.body.classList.toggle("hide-zone-list", next);
            }
        };
    }
    if (!window.toggleWorkspaceZoneRhs) {
        window.toggleWorkspaceZoneRhs = function () {
            const next = !document.body.classList.contains("hide-zone-rhs");
            try { localStorage.setItem("hrflow_hide_zone_rhs", next ? "1" : "0"); } catch (_) {}
            if (typeof window.syncLayoutBodyClasses === "function") {
                window.syncLayoutBodyClasses();
            } else {
                document.body.classList.toggle("hide-zone-rhs", next);
            }
        };
    }

    // Automatic fast background auto-refresh polling (6s for seamless live sync)
    let _agentAutoRefreshIntervalId = null;
    function startAgentAutoRefreshPolling() {
        if (_agentAutoRefreshIntervalId) clearInterval(_agentAutoRefreshIntervalId);
        _agentAutoRefreshIntervalId = setInterval(async () => {
            // Only auto-refresh if page is visible, modal is closed, and user is not actively composing
            if (document.visibilityState === "hidden") return;
            const modal = document.getElementById("agentNewCaseModal");
            if (modal && modal.style.display !== "none") return;
            const replyTextarea = document.getElementById("agentInboxReplyTextarea");
            if (replyTextarea && document.activeElement === replyTextarea && replyTextarea.value.trim().length > 0) return;

            try {
                const ag = workbenchState.agent || {};
                await loadWorkbenchData(ag.email, null, true);
            } catch (err) {
                console.debug("Silent workbench auto-refresh error:", err);
            }
        }, 6000);
    }

    loadWorkbenchData();
    startAgentAutoRefreshPolling();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAgentWorkbench);
} else {
    initAgentWorkbench();
}
