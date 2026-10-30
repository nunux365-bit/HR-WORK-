/**
 * HR FLOW — Admin / HR "Agents Status" Department-Wise Agent Work Tracker
 * (frontend/js/agentworktracker.js)
 *
 * Connected to GET /api/agent/work-tracker:
 *   - Displays all HR Agents & Specialists organized by HR Department (Staffed Depts First)
 *   - Shows complete work metrics & live activity per agent (Cases Active/Resolved,
 *     Verification Tasks Completed/Pending, Outbound Emails Replied, HRMS Actions Executed,
 *     Approvals Requested, and Chronological Audit Trail)
 *   - Allows Admin/HR to open a 5-tab 360° Agent Work Dossier for any agent
 *   - Allows Admin/HR to assign unclaimed department cases directly to an agent
 */

const BACKEND_API_BASE =
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    window.location.port &&
    window.location.port !== "5000"
        ? "http://127.0.0.1:5000"
        : "";

let awtState = {
    kpis: {},
    departments: [],
    agents: [],
    allCases: [],

    // Filters & View Mode
    viewMode: "BY_DEPT", // BY_DEPT | ACTIVE_AGENTS | MATRIX
    deptFilter: "ALL", // ALL | STAFFED_ONLY | <dept_id>
    roleFilter: "ALL",
    statusFilter: "ALL",
    searchQuery: "",

    // 360° Agent Work Dossier Modal
    selectedAgentEmail: null,
    dossierTab: "CASES", // CASES | TASKS | REPLIES | ACTIONS | AUDIT
    toast: null,
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

function formatHuman(str) {
    if (!str) return "—";
    return String(str)
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRoleBadgeStyle(role) {
    const r = String(role || "HR_AGENT").toUpperCase();
    if (r === "ADMIN" || r === "SUPER_ADMIN") {
        return { bg: "#eef2ff", fg: "#3730a3", border: "#c7d2fe", avatar: "linear-gradient(135deg, #312e81, #4f46e5)", label: "Admin" };
    }
    if (r === "HR_MANAGER") {
        return { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0", avatar: "linear-gradient(135deg, #065f46, #059669)", label: "HR Manager" };
    }
    if (r === "HR_LEAD") {
        return { bg: "#fffbeb", fg: "#92400e", border: "#fde68a", avatar: "linear-gradient(135deg, #92400e, #d97706)", label: "HR Team Lead" };
    }
    return { bg: "#eff6ff", fg: "#1e40af", border: "#bfdbfe", avatar: "linear-gradient(135deg, #1e3a8a, #2563eb)", label: "HR Agent" };
}

function getCaseStatusStyle(status) {
    const st = String(status || "NEW").toUpperCase();
    if (st === "RESOLVED" || st === "CLOSED") return { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" };
    if (st === "IN_PROGRESS" || st === "READY") return { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" };
    if (st === "ON_HOLD" || st === "PENDING_APPROVAL") return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" };
    if (st === "REVIEW_REQUIRED" || st === "ESCALATED") return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" };
    return { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1" };
}

function syncHeaderProfile() {
    try {
        const raw = sessionStorage.getItem("hrflow_user");
        if (!raw) return;
        const user = JSON.parse(raw);
        const avEl = document.getElementById("userAvatar");
        const nameEl = document.getElementById("userName");
        const roleEl = document.getElementById("userRole");
        const cleanName = user.name === "Super Admin" ? "Admin" : user.name || "Admin";
        if (avEl) avEl.textContent = getInitials(cleanName);
        if (nameEl) nameEl.textContent = cleanName;
        if (roleEl) roleEl.textContent = user.designation || user.role || "Admin";
    } catch (_) {}
}

async function loadAgentWorkTrackerData() {
    syncHeaderProfile();
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/work-tracker`);
        const json = await res.json();
        const data = json.data || json;

        awtState.kpis = data.kpis || {};
        awtState.departments = data.departments || [];
        awtState.agents = data.agents || [];
        awtState.allCases = data.all_cases || [];

        // Check URL param ?agent=email to auto-open dossier if requested
        const urlParams = new URLSearchParams(window.location.search);
        const agentParam = (urlParams.get("agent") || urlParams.get("email") || "").trim().toLowerCase();
        if (agentParam && !awtState.selectedAgentEmail) {
            const match = awtState.agents.find((a) => String(a.email || "").toLowerCase() === agentParam);
            if (match) {
                awtState.selectedAgentEmail = match.email;
            }
        }

        renderAgentWorkTracker();
        if (awtState.selectedAgentEmail) {
            renderAgentDossierModal();
        }
    } catch (err) {
        console.error("Failed to load Agents Status & Work Tracker:", err);
        const root = document.getElementById("awtRootContainer");
        if (root) {
            root.innerHTML = `
                <div style="background:#ffffff; border:1px solid #fecaca; border-radius:18px; padding:40px; text-align:center;">
                    <h3 style="margin:0 0 8px 0; color:#dc2626;">Could not load Agents Status &amp; Work Tracker</h3>
                    <p style="margin:0; color:#64748b; font-size:0.85rem;">Make sure backend/server.py is running at http://127.0.0.1:5000</p>
                </div>
            `;
        }
    }
}

function filterAgentMatches(ag) {
    if (awtState.roleFilter !== "ALL" && String(ag.role || "").toUpperCase() !== awtState.roleFilter) {
        return false;
    }
    if (awtState.statusFilter !== "ALL" && String(ag.live_status?.code || "") !== awtState.statusFilter) {
        return false;
    }
    const q = (awtState.searchQuery || "").trim().toLowerCase();
    if (q) {
        const caseNums = (ag.work_details?.all_cases || []).map((c) => `${c.case_number} ${c.title}`).join(" ");
        const taskTitles = (ag.work_details?.all_tasks || []).map((t) => t.title).join(" ");
        const hay = `${ag.name || ""} ${ag.email || ""} ${ag.team_name || ""} ${ag.designation || ""} ${ag.category_scope || ""} ${caseNums} ${taskTitles}`.toLowerCase();
        if (!hay.includes(q)) return false;
    }
    return true;
}

function renderAgentCardHtml(ag, deptUnclaimedCases = []) {
    const rStyle = getRoleBadgeStyle(ag.role);
    const lStat = ag.live_status || { label: "Available / Ready", color: "#047857", bg: "#ecfdf5", border: "#a7f3d0" };
    const m = ag.metrics || {};
    const wd = ag.work_details || {};
    const latestCase = (wd.all_cases || [])[0] || null;
    const totalTasksCount = (m.tasks_completed_count || 0) + (m.tasks_pending_count || 0);

    return `
        <div class="awt-agent-card">
            <!-- 1. TOP IDENTITY & STATUS ROW -->
            <div class="awt-agent-top-bar">
                <div style="display:flex; align-items:center; gap:13px; min-width:0; flex:1;">
                    <div style="position:relative; width:46px; height:46px; border-radius:14px; background:${rStyle.avatar}; color:#ffffff; display:flex; align-items:center; justify-content:center; font-size:0.96rem; font-weight:800; flex-shrink:0; box-shadow:0 6px 14px rgba(37,99,235,0.22);">
                        ${escapeHtml(getInitials(ag.name))}
                        <span style="position:absolute; bottom:-2px; right:-2px; width:12px; height:12px; border-radius:50%; background:#10b981; border:2px solid #ffffff;" title="Active Specialist"></span>
                    </div>

                    <div style="min-width:0; flex:1;">
                        <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
                            <span style="font-size:1.02rem; font-weight:800; color:#0f172a; letter-spacing:-0.01em;">
                                ${escapeHtml(ag.name)}
                            </span>
                            <span style="padding:2px 9px; border-radius:999px; font-size:0.67rem; font-weight:800; background:${rStyle.bg}; color:${rStyle.fg}; border:1px solid ${rStyle.border};">
                                ${escapeHtml(rStyle.label)}
                            </span>
                            <span style="padding:2px 8px; border-radius:6px; font-size:0.66rem; font-weight:800; font-family:ui-monospace, monospace; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;">
                                ${escapeHtml(ag.category_scope || "GENERAL_HR")}
                            </span>
                        </div>

                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:4px; font-size:0.75rem; color:#475569;">
                            <span style="display:inline-flex; align-items:center; gap:4px;">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3" fill="#1a73e8" fill-opacity="0.16"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                <strong>${escapeHtml(ag.email)}</strong>
                            </span>
                            <span style="color:#cbd5e1;">·</span>
                            <span>${escapeHtml(ag.designation || rStyle.label)}</span>
                            <span style="color:#cbd5e1;">·</span>
                            <span style="color:#64748b;">${escapeHtml(ag.team_name || "HR Operations")}</span>
                        </div>
                    </div>
                </div>

                <!-- Right Side: Live Workload Pill -->
                <span style="padding:4px 11px; border-radius:999px; font-size:0.7rem; font-weight:800; background:${lStat.bg}; color:${lStat.color}; border:1px solid ${lStat.border}; white-space:nowrap; flex-shrink:0;">
                    ● ${escapeHtml(lStat.label)}
                </span>
            </div>

            <!-- 2. SIX-METRIC TELEMETRY RIBBON -->
            <div class="awt-agent-metrics-grid">
                <div class="awt-metric-box" style="border-top:2.5px solid #1a73e8;">
                    <div class="awt-metric-num" style="color:#1a73e8;">${m.active_cases_count ?? 0}</div>
                    <div class="awt-metric-lbl">Active Cases</div>
                </div>
                <div class="awt-metric-box" style="border-top:2.5px solid #059669;">
                    <div class="awt-metric-num" style="color:#059669;">${m.resolved_cases_count ?? 0}</div>
                    <div class="awt-metric-lbl">Resolved</div>
                </div>
                <div class="awt-metric-box" style="border-top:2.5px solid #0d9488;">
                    <div class="awt-metric-num" style="color:#0d9488;">
                        ${m.tasks_completed_count ?? 0}<span style="font-size:0.76rem; color:#64748b; font-weight:700;">/${totalTasksCount}</span>
                    </div>
                    <div class="awt-metric-lbl">Tasks Done</div>
                </div>
                <div class="awt-metric-box" style="border-top:2.5px solid #4f46e5;">
                    <div class="awt-metric-num" style="color:#4f46e5;">${m.emails_replied_count ?? 0}</div>
                    <div class="awt-metric-lbl">Replies Sent</div>
                </div>
                <div class="awt-metric-box" style="border-top:2.5px solid #0284c7;">
                    <div class="awt-metric-num" style="color:#0284c7;">${m.hrms_actions_count ?? 0}</div>
                    <div class="awt-metric-lbl">HRMS Checks</div>
                </div>
                <div class="awt-metric-box" style="border-top:2.5px solid ${(m.completion_rate_pct || 0) >= 50 ? "#059669" : "#d97706"};">
                    <div class="awt-metric-num" style="color:${(m.completion_rate_pct || 0) >= 50 ? "#059669" : "#d97706"};">${m.completion_rate_pct ?? 0}%</div>
                    <div class="awt-metric-lbl">Resolution %</div>
                </div>
            </div>

            <!-- 3. COMPACT CURRENT FOCUS / QUICK CASE ASSIGNMENT STRIP -->
            <div class="awt-agent-activity-strip">
                <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1; font-size:0.76rem;">
                    ${
                        latestCase
                            ? `
                        <span style="padding:2px 7px; border-radius:6px; background:#eff6ff; color:#1a73e8; font-family:ui-monospace, monospace; font-weight:800; font-size:0.7rem; flex-shrink:0;">
                            ${escapeHtml(latestCase.case_number)}
                        </span>
                        <span style="color:#0f172a; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${escapeHtml(latestCase.title || "HR Request")}
                        </span>
                        <span style="color:#64748b; font-size:0.71rem; flex-shrink:0;">
                            (${escapeHtml(latestCase.status)} · Step ${latestCase.current_step || 1}/4)
                        </span>`
                            : `
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill="#059669" fill-opacity="0.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <span style="color:#475569; font-weight:600;">
                            Queue ready — open dedicated workspace to inspect or assign cases
                        </span>`
                    }
                </div>

                ${
                    deptUnclaimedCases.length > 0
                        ? `
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <select class="awt-assign-case-select awt-input" data-agent-email="${escapeHtml(ag.email)}" style="height:30px; font-size:0.72rem; padding:0 8px; background:#ffffff; min-width:170px; max-width:220px;">
                            ${deptUnclaimedCases
                                .map((uc) => `<option value="${escapeHtml(uc.case_number)}">Assign ${escapeHtml(uc.case_number)} — ${escapeHtml((uc.title || "HR Case").slice(0, 24))}</option>`)
                                .join("")}
                        </select>
                        <button type="button" class="btn-awt-assign-case awt-btn-outline" data-agent-name="${escapeHtml(ag.name)}" data-agent-email="${escapeHtml(ag.email)}" data-agent-team="${escapeHtml(ag.team_name)}" style="height:30px; padding:0 10px; font-size:0.71rem; border-color:#bfdbfe; background:#eff6ff; color:#1a73e8;">
                            + Assign
                        </button>
                    </div>`
                        : ""
                }
            </div>

            <!-- 4. CLEAN ACTION FOOTER: LAUNCH FULL AGENT WORKSPACE IN NEW PAGE -->
            <div class="awt-agent-footer-bar">
                <span style="font-size:0.72rem; color:#64748b; font-weight:600; display:inline-flex; align-items:center; gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    <span>${m.audit_events_count ?? 0} Audit Events · ${(wd.all_cases || []).length} Total Cases</span>
                </span>

                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <button type="button" class="btn-awt-open-dossier awt-btn-outline" data-agent-email="${escapeHtml(ag.email)}" style="height:34px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="3" fill="#4f46e5" fill-opacity="0.16"></rect>
                            <line x1="8" y1="16" x2="8" y2="12"></line>
                            <line x1="12" y1="16" x2="12" y2="8"></line>
                            <line x1="16" y1="16" x2="16" y2="10"></line>
                        </svg>
                        <span>360° Work Dossier</span>
                    </button>

                    <a href="agent.html?email=${encodeURIComponent(ag.email)}&inspect=admin" target="_blank" class="awt-btn-primary" style="height:34px;" title="Open ${escapeHtml(ag.name)}'s Full-Screen Execution Workspace in a New Tab">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        <span>Open Agent Workspace ↗</span>
                    </a>
                </div>
            </div>
        </div>
    `;
}

function renderMatrixViewHtml(filteredAgents) {
    return `
        <div class="awt-dept-section">
            <div class="awt-dept-header">
                <div>
                    <h2 style="margin:0; font-size:1rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" fill="#1a73e8" fill-opacity="0.16"/><line x1="8" y1="16" x2="8" y2="12"/><line x1="12" y1="16" x2="12" y2="8"/><line x1="16" y1="16" x2="16" y2="10"/></svg>
                        <span>Organization-Wide Specialists Performance Matrix (${filteredAgents.length})</span>
                    </h2>
                    <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                        Launch any specialist's full-screen workspace in a new tab or inspect their 360° work dossier
                    </div>
                </div>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; text-align:left; font-size:0.7rem; font-weight:800; text-transform:uppercase; color:#475569;">
                            <th style="padding:12px 16px;">Specialist / Agent</th>
                            <th style="padding:12px 14px;">HR Department &amp; Scope</th>
                            <th style="padding:12px 14px;">Role</th>
                            <th style="padding:12px 14px;">Live Status</th>
                            <th style="padding:12px 14px; text-align:center;">Active Cases</th>
                            <th style="padding:12px 14px; text-align:center;">Resolved</th>
                            <th style="padding:12px 14px; text-align:center;">Tasks Done</th>
                            <th style="padding:12px 14px; text-align:center;">Replies Sent</th>
                            <th style="padding:12px 14px; text-align:center;">HRMS Checks</th>
                            <th style="padding:12px 16px; text-align:right;">Workspace &amp; Dossier</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            filteredAgents.length === 0
                                ? `<tr><td colspan="10" style="padding:32px; text-align:center; color:#64748b;">No agents match your current filter.</td></tr>`
                                : filteredAgents
                                      .map((ag) => {
                                          const rStyle = getRoleBadgeStyle(ag.role);
                                          const lStat = ag.live_status || { label: "Available", color: "#475569", bg: "#f8fafc", border: "#cbd5e1" };
                                          const m = ag.metrics || {};
                                          return `
                                        <tr style="border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                            <td style="padding:12px 16px;">
                                                <div style="font-weight:800; color:#0f172a;">${escapeHtml(ag.name)}</div>
                                                <div style="font-size:0.73rem; color:#64748b;">${escapeHtml(ag.email)}</div>
                                            </td>
                                            <td style="padding:12px 14px;">
                                                <div style="font-weight:700; color:#0f172a;">${escapeHtml(ag.team_name || "HR Operations")}</div>
                                                <span style="font-size:0.68rem; font-family:ui-monospace, monospace; color:#059669; font-weight:700;">Scope: ${escapeHtml(ag.category_scope || "ALL_HR")}</span>
                                            </td>
                                            <td style="padding:12px 14px;">
                                                <span style="padding:3px 9px; border-radius:999px; font-size:0.68rem; font-weight:800; background:${rStyle.bg}; color:${rStyle.fg}; border:1px solid ${rStyle.border};">
                                                    ${escapeHtml(rStyle.label)}
                                                </span>
                                            </td>
                                            <td style="padding:12px 14px;">
                                                <span style="padding:3px 9px; border-radius:999px; font-size:0.68rem; font-weight:800; background:${lStat.bg}; color:${lStat.color}; border:1px solid ${lStat.border};">
                                                    ● ${escapeHtml(lStat.label)}
                                                </span>
                                            </td>
                                            <td style="padding:12px 14px; text-align:center; font-weight:800; color:#1a73e8;">${m.active_cases_count ?? 0}</td>
                                            <td style="padding:12px 14px; text-align:center; font-weight:800; color:#059669;">${m.resolved_cases_count ?? 0}</td>
                                            <td style="padding:12px 14px; text-align:center; font-weight:800; color:#0d9488;">${m.tasks_completed_count ?? 0} / ${(m.tasks_completed_count || 0) + (m.tasks_pending_count || 0)}</td>
                                            <td style="padding:12px 14px; text-align:center; font-weight:800; color:#4f46e5;">${m.emails_replied_count ?? 0}</td>
                                            <td style="padding:12px 14px; text-align:center; font-weight:800; color:#0284c7;">${m.hrms_actions_count ?? 0}</td>
                                            <td style="padding:12px 16px; text-align:right;">
                                                <div style="display:inline-flex; gap:6px;">
                                                    <button type="button" class="btn-awt-open-dossier awt-btn-outline" data-agent-email="${escapeHtml(ag.email)}" style="height:30px; padding:0 10px; font-size:0.71rem;">
                                                        360° Dossier
                                                    </button>
                                                    <a href="agent.html?email=${encodeURIComponent(ag.email)}&inspect=admin" target="_blank" class="awt-btn-primary" style="height:30px; padding:0 11px; font-size:0.71rem;" title="Open ${escapeHtml(ag.name)}'s Workspace in a New Tab">
                                                        Workspace ↗
                                                    </a>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                      })
                                      .join("")
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderStaffedDeptSectionHtml(dept, deptAgents) {
    const sum = dept.summary || {};
    const unclaimedList = dept.unclaimed_cases_list || [];

    return `
        <section class="awt-dept-section">
            <div class="awt-dept-header">
                <div style="min-width:0; flex:1;">
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <span class="awt-dept-badge">${escapeHtml(dept.dept_code)}</span>
                        <h2 style="margin:0; font-size:1.05rem; font-weight:800; color:#0f172a;">
                            ${escapeHtml(dept.team_name)}
                        </h2>
                        <span style="padding:3px 9px; border-radius:6px; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; font-size:0.69rem; font-weight:800; font-family:ui-monospace, monospace;">
                            Scope: ${escapeHtml(dept.category_scope)}
                        </span>
                    </div>
                    <div class="awt-dept-desc-line">
                        <span style="display:inline-flex; align-items:center; gap:5px;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3" fill="#1a73e8" fill-opacity="0.16"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            <span>Desk: <strong>${escapeHtml(dept.dept_gmail)}</strong></span>
                        </span>
                        <span style="color:#cbd5e1;">·</span>
                        <span>SLA: <strong>${dept.sla_hours || 48}h</strong></span>
                        ${
                            dept.description
                                ? `<span style="color:#cbd5e1;">·</span><span class="awt-dept-desc-trunc" title="${escapeHtml(dept.description)}">${escapeHtml(dept.description)}</span>`
                                : ""
                        }
                    </div>
                </div>

                <div class="awt-dept-stats-strip">
                    <span class="awt-dept-stat-pill" style="background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4" fill="#1d4ed8" fill-opacity="0.18"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/></svg>
                        <span><strong>${deptAgents.length}</strong> ${deptAgents.length === 1 ? "Specialist" : "Specialists"}</span>
                    </span>
                    <span class="awt-dept-stat-pill" style="border-color:#c7d2fe; background:#eef2ff; color:#4338ca;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4338ca" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2.5" fill="#4338ca" fill-opacity="0.16"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                        <span><strong>${sum.active_cases ?? 0}</strong> Active</span>
                    </span>
                    <span class="awt-dept-stat-pill" style="border-color:#a7f3d0; background:#ecfdf5; color:#047857;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#047857" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill="#047857" fill-opacity="0.16"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <span><strong>${sum.resolved_cases ?? 0}</strong> Resolved</span>
                    </span>
                    <span class="awt-dept-stat-pill" style="border-color:#fde68a; background:#fffbeb; color:#b45309;">
                        <span><strong>${sum.unclaimed_cases ?? 0}</strong> Unclaimed</span>
                    </span>
                </div>
            </div>

            <div class="awt-agents-grid">
                ${deptAgents.map((ag) => renderAgentCardHtml(ag, unclaimedList)).join("")}
            </div>
        </section>
    `;
}

function renderUnstaffedDeptsGridHtml(unstaffedDepts) {
    if (!unstaffedDepts || unstaffedDepts.length === 0) return "";

    return `
        <section style="margin-top:20px;">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:12px; padding:0 4px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="#475569" fill-opacity="0.16"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="#475569" fill-opacity="0.16"/><rect x="8.5" y="14" width="7" height="7" rx="1.5" fill="#475569" fill-opacity="0.16"/><path d="M6.5 10v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/></svg>
                    <span style="font-size:0.86rem; font-weight:800; color:#334155;">
                        Unstaffed HR Departments — Ready for Specialist Assignment (${unstaffedDepts.length})
                    </span>
                </div>
                <a href="inbox.html#users" class="awt-btn-outline" style="height:30px; font-size:0.72rem;">
                    + Elect Specialists in User Management
                </a>
            </div>

            <div class="awt-unstaffed-grid">
                ${unstaffedDepts
                    .map((dept) => {
                        const sum = dept.summary || {};
                        return `
                        <div class="awt-unstaffed-card">
                            <div>
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <span class="awt-dept-badge" style="background:#334155;">${escapeHtml(dept.dept_code)}</span>
                                        <strong style="font-size:0.94rem; font-weight:800; color:#0f172a;">${escapeHtml(dept.team_name)}</strong>
                                    </div>
                                    <span style="padding:2px 8px; border-radius:6px; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; font-size:0.66rem; font-weight:800; font-family:ui-monospace, monospace;">
                                        Scope: ${escapeHtml(dept.category_scope)}
                                    </span>
                                </div>

                                <div style="font-size:0.74rem; color:#475569; margin-top:6px;">
                                    Desk: <strong>${escapeHtml(dept.dept_gmail)}</strong> · SLA: <strong>${dept.sla_hours || 48}h</strong>
                                </div>
                                ${
                                    dept.description
                                        ? `<div style="font-size:0.72rem; color:#64748b; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(dept.description)}">${escapeHtml(dept.description)}</div>`
                                        : ""
                                }
                            </div>

                            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; padding-top:10px; border-top:1px solid #f1f5f9;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                    <span style="padding:3px 9px; border-radius:999px; font-size:0.68rem; font-weight:700; background:#f1f5f9; color:#475569;">
                                        0 Specialists
                                    </span>
                                    <span style="padding:3px 9px; border-radius:999px; font-size:0.68rem; font-weight:700; background:#fffbeb; color:#b45309; border:1px solid #fde68a;">
                                        ${sum.unclaimed_cases ?? 0} Unclaimed Cases
                                    </span>
                                </div>

                                <a href="inbox.html#users" class="awt-btn-outline" style="height:28px; padding:0 10px; font-size:0.71rem; border-color:#bfdbfe; background:#eff6ff; color:#1a73e8;">
                                    + Assign Agent
                                </a>
                            </div>
                        </div>`;
                    })
                    .join("")}
            </div>
        </section>
    `;
}

function renderAgentWorkTracker() {
    const root = document.getElementById("awtRootContainer");
    if (!root) return;

    const kpis = awtState.kpis || {};
    const depts = awtState.departments || [];
    const nonAdminAgents = awtState.agents.filter((a) => a.role !== "ADMIN");
    const baseAgents = nonAdminAgents.length > 0 ? nonAdminAgents : awtState.agents;
    const filteredAgents = baseAgents.filter(filterAgentMatches);

    // Sort departments so Staffed Departments (with agents > 0) always come FIRST!
    const sortedDepts = [...depts].sort((a, b) => {
        const aCount = (a.agents || []).length;
        const bCount = (b.agents || []).length;
        if (bCount !== aCount) return bCount - aCount;
        const aCases = a.summary?.total_cases || 0;
        const bCases = b.summary?.total_cases || 0;
        return bCases - aCases;
    });

    const staffedDeptsCount = sortedDepts.filter((d) => (d.agents || []).length > 0).length;

    const visibleDepts = sortedDepts.filter((d) => {
        if (awtState.deptFilter === "STAFFED_ONLY") {
            return (d.agents || []).length > 0;
        }
        if (awtState.deptFilter !== "ALL" && String(d.dept_id) !== String(awtState.deptFilter)) {
            return false;
        }
        return true;
    });

    const toastBannerHtml = awtState.toast
        ? `
        <div style="padding:12px 18px; border-radius:14px; background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; font-size:0.82rem; font-weight:700; display:flex; justify-content:space-between; align-items:center;">
            <span>✓ ${escapeHtml(awtState.toast)}</span>
            <button type="button" id="btnDismissAwtToast" style="background:none; border:none; font-weight:800; color:#065f46; cursor:pointer;">✕</button>
        </div>`
        : "";

    // Build Main Content depending on View Mode
    let mainContentHtml = "";
    if (awtState.viewMode === "MATRIX") {
        mainContentHtml = renderMatrixViewHtml(filteredAgents);
    } else if (awtState.viewMode === "ACTIVE_AGENTS") {
        mainContentHtml = `
            <section class="awt-dept-section">
                <div class="awt-dept-header">
                    <div>
                        <h2 style="margin:0; font-size:1.05rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:8px;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4" fill="#1a73e8" fill-opacity="0.18"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/></svg>
                            <span>Active HR Specialists Directory (${filteredAgents.length})</span>
                        </h2>
                        <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                            Click "Open Agent Workspace ↗" on any card to launch their full-screen execution workspace in a new page
                        </div>
                    </div>
                </div>
                <div class="awt-agents-grid">
                    ${
                        filteredAgents.length === 0
                            ? `<div style="padding:32px; text-align:center; color:#64748b;">No active specialists match your filter.</div>`
                            : filteredAgents.map((ag) => renderAgentCardHtml(ag, [])).join("")
                    }
                </div>
            </section>
        `;
    } else {
        const staffedList = [];
        const unstaffedList = [];

        visibleDepts.forEach((dept) => {
            const deptAgents = (dept.agents || []).filter(filterAgentMatches);
            if (deptAgents.length > 0 || (awtState.deptFilter !== "ALL" && awtState.deptFilter !== "STAFFED_ONLY")) {
                staffedList.push({ dept, deptAgents });
            } else if (!awtState.searchQuery && awtState.roleFilter === "ALL" && awtState.statusFilter === "ALL") {
                unstaffedList.push(dept);
            }
        });

        const staffedHtml = staffedList
            .map(({ dept, deptAgents }) => {
                if (deptAgents.length === 0) {
                    return renderUnstaffedDeptsGridHtml([dept]);
                }
                return renderStaffedDeptSectionHtml(dept, deptAgents);
            })
            .join("");

        const unstaffedHtml = renderUnstaffedDeptsGridHtml(unstaffedList);
        mainContentHtml = `${staffedHtml}${unstaffedHtml}`;
    }

    root.innerHTML = `
        ${toastBannerHtml}

        <!-- 1. SLEEK ONE UI 9.0 COMMAND HERO HEADER -->
        <section class="awt-hero-bar">
            <div class="awt-hero-left">
                <div class="awt-hero-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="7" r="4" fill="#ffffff" fill-opacity="0.24"></circle>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <polyline points="16 11 18 13 22 9"></polyline>
                    </svg>
                </div>
                <div>
                    <h1 class="awt-hero-title">
                        <span>Department &amp; Specialist Work Tracker</span>
                        <span class="awt-live-pill">● LIVE TELEMETRY</span>
                    </h1>
                    <p class="awt-hero-sub">
                        Monitor department queues, specialist workloads, and launch dedicated full-screen agent workspaces.
                    </p>
                </div>
            </div>

            <div class="awt-hero-controls">
                <div class="awt-segmented-group">
                    <button type="button" id="btnModeByDept" class="awt-seg-btn ${awtState.viewMode === "BY_DEPT" ? "active" : ""}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity="0.2"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity="0.2"/><rect x="8.5" y="14" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity="0.2"/><path d="M6.5 10v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/></svg>
                        <span>By Department (${depts.length})</span>
                    </button>
                    <button type="button" id="btnModeActiveAgents" class="awt-seg-btn ${awtState.viewMode === "ACTIVE_AGENTS" ? "active" : ""}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4" fill="currentColor" fill-opacity="0.2"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/></svg>
                        <span>Specialists (${baseAgents.length})</span>
                    </button>
                    <button type="button" id="btnModeMatrix" class="awt-seg-btn ${awtState.viewMode === "MATRIX" ? "active" : ""}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" fill-opacity="0.18"/><line x1="8" y1="16" x2="8" y2="12"/><line x1="12" y1="16" x2="12" y2="8"/><line x1="16" y1="16" x2="16" y2="10"/></svg>
                        <span>Performance Matrix</span>
                    </button>
                </div>

                <button type="button" id="btnExportAgentsCsv" class="awt-btn-outline" style="background:rgba(255,255,255,0.12); color:#ffffff; border-color:rgba(255,255,255,0.22); height:34px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Export CSV</span>
                </button>
                <button type="button" id="btnRefreshTracker" class="awt-btn-primary" style="height:34px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                    <span>Sync Status</span>
                </button>
            </div>
        </section>

        <!-- 2. SIX ONE UI 9.0 FROSTED GLASS KPI CARDS (Dual-Tone SVG Icons) -->
        <section class="awt-kpi-grid">
            <div class="awt-kpi-card theme-blue">
                <div class="awt-kpi-top">
                    <div class="awt-kpi-label">Depts &amp; Staff</div>
                    <div class="awt-kpi-icon" style="background:linear-gradient(135deg,#eff6ff,#dbeafe); color:#1a73e8;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity="0.22"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity="0.22"/><rect x="8.5" y="14" width="7" height="7" rx="1.5" fill="currentColor" fill-opacity="0.22"/><path d="M6.5 10v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/></svg>
                    </div>
                </div>
                <div class="awt-kpi-val">${kpis.total_agents ?? baseAgents.length} <span style="font-size:0.82rem; font-weight:700; color:#64748b;">Specialists</span></div>
                <div class="awt-kpi-sub">Across <strong>${kpis.total_departments ?? depts.length}</strong> Depts (${staffedDeptsCount} Staffed)</div>
            </div>

            <div class="awt-kpi-card theme-indigo">
                <div class="awt-kpi-top">
                    <div class="awt-kpi-label">Active Cases</div>
                    <div class="awt-kpi-icon" style="background:linear-gradient(135deg,#eef2ff,#e0e7ff); color:#4f46e5;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2.5" fill="currentColor" fill-opacity="0.2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2 12h20"/></svg>
                    </div>
                </div>
                <div class="awt-kpi-val" style="color:#4f46e5;">${kpis.active_assigned_cases ?? 0}</div>
                <div class="awt-kpi-sub"><strong>${kpis.unclaimed_dept_cases ?? 0}</strong> unclaimed in pools</div>
            </div>

            <div class="awt-kpi-card theme-emerald">
                <div class="awt-kpi-top">
                    <div class="awt-kpi-label">Resolved Cases</div>
                    <div class="awt-kpi-icon" style="background:linear-gradient(135deg,#ecfdf5,#d1fae5); color:#059669;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" fill="currentColor" fill-opacity="0.2"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </div>
                </div>
                <div class="awt-kpi-val" style="color:#059669;">${kpis.resolved_cases_total ?? 0}</div>
                <div class="awt-kpi-sub">Verified &amp; closed with notes</div>
            </div>

            <div class="awt-kpi-card theme-teal">
                <div class="awt-kpi-top">
                    <div class="awt-kpi-label">Tasks Completed</div>
                    <div class="awt-kpi-icon" style="background:linear-gradient(135deg,#f0fdfa,#ccfbf1); color:#0d9488;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" fill-opacity="0.2"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>
                    </div>
                </div>
                <div class="awt-kpi-val" style="color:#0d9488;">${kpis.tasks_completed_total ?? 0}</div>
                <div class="awt-kpi-sub"><strong>${kpis.tasks_pending_total ?? 0}</strong> open checklist tasks</div>
            </div>

            <div class="awt-kpi-card theme-violet">
                <div class="awt-kpi-top">
                    <div class="awt-kpi-label">Replies Sent</div>
                    <div class="awt-kpi-icon" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe); color:#7c3aed;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3" fill="currentColor" fill-opacity="0.2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </div>
                </div>
                <div class="awt-kpi-val" style="color:#7c3aed;">${kpis.emails_replied_total ?? 0}</div>
                <div class="awt-kpi-sub">Dispatched via Gmail SMTP</div>
            </div>

            <div class="awt-kpi-card theme-cyan">
                <div class="awt-kpi-top">
                    <div class="awt-kpi-label">HRMS Actions</div>
                    <div class="awt-kpi-icon" style="background:linear-gradient(135deg,#e0f2fe,#bae6fd); color:#0284c7;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" fill-opacity="0.22"/></svg>
                    </div>
                </div>
                <div class="awt-kpi-val" style="color:#0284c7;">${kpis.hrms_actions_total ?? 0}</div>
                <div class="awt-kpi-sub">Automated &amp; verified checks</div>
            </div>
        </section>

        <!-- 3. SINGLE-LINE FROSTED FILTER & QUICK-PILLS TOOLBAR -->
        <section class="awt-toolbar">
            <div class="awt-toolbar-top">
                <div class="awt-toolbar-filters">
                    <div class="awt-search-wrap">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input type="text" id="awtFilterSearch" class="awt-input" value="${escapeHtml(awtState.searchQuery)}" placeholder="Search Agent, Email, Department, Case #, or Task...">
                    </div>

                    <select id="awtDeptSelect" class="awt-input">
                        <option value="ALL" ${awtState.deptFilter === "ALL" ? "selected" : ""}>All HR Departments (${depts.length})</option>
                        <option value="STAFFED_ONLY" ${awtState.deptFilter === "STAFFED_ONLY" ? "selected" : ""}>Staffed Depts Only (${staffedDeptsCount})</option>
                        ${sortedDepts
                            .map((d) => `<option value="${d.dept_id}" ${String(awtState.deptFilter) === String(d.dept_id) ? "selected" : ""}>${escapeHtml(d.team_name)} (${(d.agents || []).length})</option>`)
                            .join("")}
                    </select>

                    <select id="awtRoleSelect" class="awt-input">
                        <option value="ALL" ${awtState.roleFilter === "ALL" ? "selected" : ""}>All Specialist Roles</option>
                        <option value="HR_AGENT" ${awtState.roleFilter === "HR_AGENT" ? "selected" : ""}>HR Specialist (HR_AGENT)</option>
                        <option value="HR_LEAD" ${awtState.roleFilter === "HR_LEAD" ? "selected" : ""}>HR Team Lead (HR_LEAD)</option>
                        <option value="HR_MANAGER" ${awtState.roleFilter === "HR_MANAGER" ? "selected" : ""}>HR Manager (HR_MANAGER)</option>
                    </select>

                    <select id="awtStatusSelect" class="awt-input">
                        <option value="ALL" ${awtState.statusFilter === "ALL" ? "selected" : ""}>All Workload States</option>
                        <option value="ACTIVE_WORKING" ${awtState.statusFilter === "ACTIVE_WORKING" ? "selected" : ""}>Actively Working</option>
                        <option value="HIGH_LOAD" ${awtState.statusFilter === "HIGH_LOAD" ? "selected" : ""}>High Workload</option>
                        <option value="COMPLETED_QUEUE" ${awtState.statusFilter === "COMPLETED_QUEUE" ? "selected" : ""}>Queue Cleared</option>
                        <option value="AVAILABLE" ${awtState.statusFilter === "AVAILABLE" ? "selected" : ""}>Available / Ready</option>
                    </select>
                </div>

                <a href="inbox.html#users" class="awt-btn-primary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span>Elect / Add Specialist</span>
                </a>
            </div>

            <!-- Interactive Quick-Filter Department Pills -->
            <div class="awt-dept-pills-row">
                <span style="font-size:0.69rem; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-right:4px;">Quick Filter:</span>
                <button type="button" class="awt-dept-filter-pill ${awtState.deptFilter === "ALL" ? "active" : ""}" data-dept-pill="ALL">
                    All Departments (${depts.length})
                </button>
                <button type="button" class="awt-dept-filter-pill ${awtState.deptFilter === "STAFFED_ONLY" ? "active" : ""}" data-dept-pill="STAFFED_ONLY">
                    <span class="awt-pill-dot online"></span>
                    <span>Staffed Depts (${staffedDeptsCount})</span>
                </button>
                ${sortedDepts
                    .map((d) => {
                        const agCnt = (d.agents || []).length;
                        const isAct = String(awtState.deptFilter) === String(d.dept_id);
                        return `
                        <button type="button" class="awt-dept-filter-pill ${isAct ? "active" : ""}" data-dept-pill="${escapeHtml(d.dept_id)}">
                            <span class="awt-pill-dot ${agCnt > 0 ? "online" : "empty"}"></span>
                            <span>${escapeHtml(d.team_name)}</span>
                            <span style="padding:1px 6px; border-radius:999px; background:${isAct ? "rgba(255,255,255,0.24)" : agCnt > 0 ? "#dbeafe" : "#e2e8f0"}; color:${isAct ? "#ffffff" : agCnt > 0 ? "#1e40af" : "#475569"}; font-size:0.66rem; font-weight:800;">
                                ${agCnt}
                            </span>
                        </button>`;
                    })
                    .join("")}
            </div>
        </section>

        <!-- 4. MAIN CONTENT: STAFFED DEPARTMENTS FIRST + UNSTAFFED GRID OR MATRIX -->
        ${mainContentHtml}
    `;

    bindAwtEvents();
}

function renderAgentDossierModal() {
    const modal = document.getElementById("awtAgentDossierModal");
    if (!modal) return;

    const email = awtState.selectedAgentEmail;
    if (!email) {
        modal.style.display = "none";
        return;
    }

    const ag = awtState.agents.find((a) => String(a.email || "").toLowerCase() === String(email).toLowerCase());
    if (!ag) {
        modal.style.display = "none";
        return;
    }

    modal.style.display = "flex";
    const rStyle = getRoleBadgeStyle(ag.role);
    const m = ag.metrics || {};
    const wd = ag.work_details || {};
    const tab = awtState.dossierTab || "CASES";

    let tabBodyHtml = "";

    if (tab === "CASES") {
        const cases = wd.all_cases || [];
        tabBodyHtml =
            cases.length === 0
                ? `<div style="padding:36px; text-align:center; color:#64748b; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0;">No cases assigned to or resolved by ${escapeHtml(ag.name)} yet.</div>`
                : `
            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden;">
                <table style="width:100%; border-collapse:collapse; font-size:0.79rem;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; text-align:left; font-size:0.69rem; font-weight:800; color:#475569; text-transform:uppercase;">
                            <th style="padding:10px 14px;">Case #</th>
                            <th style="padding:10px 12px;">Employee</th>
                            <th style="padding:10px 12px;">Category &amp; Intent</th>
                            <th style="padding:10px 12px;">Subject &amp; Resolution Notes</th>
                            <th style="padding:10px 12px;">Workflow Step</th>
                            <th style="padding:10px 12px;">Status &amp; SLA</th>
                            <th style="padding:10px 14px;">Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cases
                            .map((c) => {
                                const stS = getCaseStatusStyle(c.status);
                                return `
                            <tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:10px 14px; font-family:ui-monospace, monospace; font-weight:800; color:#1d4ed8;">${escapeHtml(c.case_number)}</td>
                                <td style="padding:10px 12px;">
                                    <div style="font-weight:700; color:#0f172a;">${escapeHtml(c.employee_name || "Employee")}</div>
                                    <div style="font-size:0.7rem; color:#64748b;">${escapeHtml(c.employee_id || c.sender_email || "")}</div>
                                </td>
                                <td style="padding:10px 12px;">
                                    <span style="padding:2px 7px; border-radius:6px; background:#eff6ff; color:#1d4ed8; font-size:0.68rem; font-weight:800;">${escapeHtml(c.category || "HR")}</span>
                                    <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">${escapeHtml(c.intent || "")}</div>
                                </td>
                                <td style="padding:10px 12px; max-width:280px;">
                                    <div style="font-weight:700; color:#0f172a;">${escapeHtml(c.title || "HR Request")}</div>
                                    ${
                                        c.resolution_notes
                                            ? `<div style="font-size:0.71rem; color:#047857; margin-top:3px;">✓ Resolution: ${escapeHtml(c.resolution_notes)}</div>`
                                            : ""
                                    }
                                </td>
                                <td style="padding:10px 12px; font-weight:700; color:#334155;">
                                    Step ${c.current_step || 1} of 4
                                    <div style="font-size:0.68rem; color:#64748b;">${escapeHtml(c.workflow_state || "INTAKE")}</div>
                                </td>
                                <td style="padding:10px 12px;">
                                    <span style="padding:2px 8px; border-radius:999px; font-size:0.66rem; font-weight:800; background:${stS.bg}; color:${stS.fg}; border:1px solid ${stS.border};">
                                        ${escapeHtml(c.status)}
                                    </span>
                                    <div style="font-size:0.69rem; color:#64748b; margin-top:3px;">SLA: ${escapeHtml(c.sla_remaining || c.sla_status || "On Track")}</div>
                                </td>
                                <td style="padding:10px 14px; font-size:0.71rem; color:#64748b;">${escapeHtml(c.resolved_at || c.updated_at || c.created_at || "")}</td>
                            </tr>`;
                            })
                            .join("")}
                    </tbody>
                </table>
            </div>`;
    } else if (tab === "TASKS") {
        const tasks = wd.all_tasks || [];
        tabBodyHtml =
            tasks.length === 0
                ? `<div style="padding:36px; text-align:center; color:#64748b; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0;">No verification tasks recorded for ${escapeHtml(ag.name)} yet.</div>`
                : `
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${tasks
                    .map((t) => {
                        const isDone = String(t.status || "").toUpperCase() === "COMPLETED";
                        return `
                    <div style="background:#ffffff; border:1px solid ${isDone ? "#a7f3d0" : "#e2e8f0"}; border-radius:12px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="width:22px; height:22px; border-radius:50%; background:${isDone ? "#dcfce7" : "#f1f5f9"}; color:${isDone ? "#15803d" : "#64748b"}; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:800;">
                                ${isDone ? "✓" : "○"}
                            </span>
                            <div>
                                <div style="font-size:0.83rem; font-weight:800; color:#0f172a;">${escapeHtml(t.title)}</div>
                                <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">
                                    Case: <strong style="color:#1d4ed8;">${escapeHtml(t.case_number || `#${t.case_id}`)}</strong> · Priority: <strong>${escapeHtml(t.priority || "MEDIUM")}</strong>
                                </div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <span style="padding:3px 9px; border-radius:999px; font-size:0.68rem; font-weight:800; background:${isDone ? "#ecfdf5" : "#fffbeb"}; color:${isDone ? "#047857" : "#b45309"}; border:1px solid ${isDone ? "#a7f3d0" : "#fde68a"};">
                                ${isDone ? "COMPLETED" : escapeHtml(t.status || "PENDING")}
                            </span>
                            <div style="font-size:0.69rem; color:#64748b; margin-top:3px;">${escapeHtml(t.completed_at || t.created_at || "")}</div>
                        </div>
                    </div>`;
                    })
                    .join("")}
            </div>`;
    } else if (tab === "REPLIES") {
        const comms = wd.communications || [];
        tabBodyHtml =
            comms.length === 0
                ? `<div style="padding:36px; text-align:center; color:#64748b; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0;">No outbound employee emails or replies sent by ${escapeHtml(ag.name)} yet.</div>`
                : `
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${comms
                    .map(
                        (cm) => `
                    <div style="background:#ffffff; border:1px solid #bfdbfe; border-radius:12px; padding:14px 16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #f1f5f9;">
                            <div>
                                <span style="padding:2px 8px; border-radius:6px; background:#eff6ff; color:#1d4ed8; font-size:0.68rem; font-weight:800; margin-right:6px;">
                                    ${escapeHtml(cm.comm_type || "AGENT_REPLY")}
                                </span>
                                <strong style="font-size:0.82rem; color:#0f172a;">${escapeHtml(cm.subject || "Case Update")}</strong>
                            </div>
                            <span style="font-size:0.71rem; color:#64748b;">${escapeHtml(cm.created_at || "")}</span>
                        </div>
                        <div style="font-size:0.74rem; color:#475569; margin-bottom:6px;">
                            To: <strong>${escapeHtml(cm.recipient || "Employee")}</strong> · Case: <strong>${escapeHtml(cm.case_number || `#${cm.case_id}`)}</strong>
                        </div>
                        <div style="font-size:0.79rem; color:#1e293b; background:#f8fafc; padding:10px 12px; border-radius:8px; white-space:pre-wrap;">${escapeHtml(cm.message || "")}</div>
                    </div>`
                    )
                    .join("")}
            </div>`;
    } else if (tab === "ACTIONS") {
        const actions = wd.hrms_actions || [];
        const approvals = wd.approvals || [];
        tabBodyHtml = `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:14px 16px;">
                    <h4 style="margin:0 0 10px 0; font-size:0.78rem; font-weight:800; text-transform:uppercase; color:#0f172a;">
                        Executed HRMS Verification Actions (${actions.length})
                    </h4>
                    ${
                        actions.length === 0
                            ? `<div style="font-size:0.78rem; color:#64748b;">No HRMS actions executed yet.</div>`
                            : actions
                                  .map(
                                      (ha) => `
                                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:8px; background:#ecfdf5; border:1px solid #a7f3d0; margin-bottom:6px; font-size:0.76rem;">
                                    <div>
                                        <strong style="color:#065f46;">✓ ${escapeHtml(ha.action_type)}</strong> via ${escapeHtml(ha.provider)}
                                        <span style="color:#047857;"> · Case: ${escapeHtml(ha.case_number || `#${ha.case_id}`)}</span>
                                    </div>
                                    <span style="font-size:0.7rem; color:#047857; font-family:ui-monospace, monospace;">${escapeHtml(ha.completed_at || "")}</span>
                                </div>`
                                  )
                                  .join("")
                    }
                </div>

                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:14px 16px;">
                    <h4 style="margin:0 0 10px 0; font-size:0.78rem; font-weight:800; text-transform:uppercase; color:#0f172a;">
                        Manager / Lead Approval Requests Submitted (${approvals.length})
                    </h4>
                    ${
                        approvals.length === 0
                            ? `<div style="font-size:0.78rem; color:#64748b;">No approval requests submitted yet.</div>`
                            : approvals
                                  .map(
                                      (ap) => `
                                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:8px; background:#fffbeb; border:1px solid #fde68a; margin-bottom:6px; font-size:0.76rem;">
                                    <div>
                                        <strong>${escapeHtml(ap.approval_code)}</strong> · ${escapeHtml(formatHuman(ap.approval_type))}
                                        <span style="color:#64748b;"> (${escapeHtml(ap.comments || "")})</span>
                                    </div>
                                    <span style="font-weight:800; color:#b45309;">● ${escapeHtml(ap.status)}</span>
                                </div>`
                                  )
                                  .join("")
                    }
                </div>
            </div>`;
    } else if (tab === "AUDIT") {
        const logs = wd.audit_logs || [];
        tabBodyHtml =
            logs.length === 0
                ? `<div style="padding:36px; text-align:center; color:#64748b; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0;">No audit events recorded for ${escapeHtml(ag.name)} yet.</div>`
                : `
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${logs
                    .map(
                        (al) => `
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:0.77rem;">
                        <div>
                            <span style="padding:2px 7px; border-radius:6px; background:#f1f5f9; color:#0f172a; font-family:ui-monospace, monospace; font-size:0.69rem; font-weight:800; margin-right:6px;">
                                ${escapeHtml(al.action)}
                            </span>
                            <span style="color:#1e293b; font-weight:600;">${escapeHtml(al.description || "")}</span>
                        </div>
                        <span style="font-size:0.7rem; color:#64748b; white-space:nowrap;">${escapeHtml(al.created_at || "")}</span>
                    </div>`
                    )
                    .join("")}
            </div>`;
    }

    modal.innerHTML = `
        <div class="awt-modal-dialog">
            <div class="awt-modal-header">
                <div style="display:flex; align-items:center; gap:14px;">
                    <div style="width:46px; height:46px; border-radius:14px; background:rgba(255,255,255,0.16); border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:1.02rem; font-weight:800;">
                        ${escapeHtml(getInitials(ag.name))}
                    </div>
                    <div>
                        <div style="font-size:0.69rem; font-weight:800; color:#93c5fd; text-transform:uppercase; letter-spacing:0.06em;">
                            360° SPECIALIST WORK DOSSIER · ${escapeHtml(ag.team_name || "HR Operations")}
                        </div>
                        <h3 style="margin:2px 0 0 0; font-size:1.1rem; font-weight:800; color:#ffffff;">
                            ${escapeHtml(ag.name)} (${escapeHtml(rStyle.label)}) — ${escapeHtml(ag.email)}
                        </h3>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <a href="agent.html?email=${encodeURIComponent(ag.email)}&inspect=admin" target="_blank" class="awt-btn-primary" style="height:34px;" title="Open ${escapeHtml(ag.name)}'s Full Workspace in a New Tab">
                        <span>Open Full Workspace ↗</span>
                    </a>
                    <button type="button" id="btnCloseAwtDossier" style="background:rgba(255,255,255,0.14); border:none; color:#ffffff; width:34px; height:34px; border-radius:10px; font-weight:800; cursor:pointer;">✕</button>
                </div>
            </div>

            <div class="awt-modal-tabs">
                <button type="button" class="awt-dossier-tab ${tab === "CASES" ? "active" : ""}" data-dtab="CASES">
                    <span>Cases Handled (${(wd.all_cases || []).length})</span>
                </button>
                <button type="button" class="awt-dossier-tab ${tab === "TASKS" ? "active" : ""}" data-dtab="TASKS">
                    <span>Tasks History (${(wd.all_tasks || []).length})</span>
                </button>
                <button type="button" class="awt-dossier-tab ${tab === "REPLIES" ? "active" : ""}" data-dtab="REPLIES">
                    <span>Sent Employee Replies (${(wd.communications || []).length})</span>
                </button>
                <button type="button" class="awt-dossier-tab ${tab === "ACTIONS" ? "active" : ""}" data-dtab="ACTIONS">
                    <span>HRMS Actions &amp; Approvals (${(wd.hrms_actions || []).length + (wd.approvals || []).length})</span>
                </button>
                <button type="button" class="awt-dossier-tab ${tab === "AUDIT" ? "active" : ""}" data-dtab="AUDIT">
                    <span>Complete Audit Trail (${(wd.audit_logs || []).length})</span>
                </button>
            </div>

            <div class="awt-modal-body">
                <!-- Quick Summary Strip inside Dossier -->
                <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:10px; margin-bottom:16px;">
                    <div class="awt-metric-box" style="background:#ffffff;"><div class="awt-metric-num" style="color:#1a73e8;">${m.active_cases_count ?? 0}</div><div class="awt-metric-lbl">Active Cases</div></div>
                    <div class="awt-metric-box" style="background:#ffffff;"><div class="awt-metric-num" style="color:#059669;">${m.resolved_cases_count ?? 0}</div><div class="awt-metric-lbl">Resolved Cases</div></div>
                    <div class="awt-metric-box" style="background:#ffffff;"><div class="awt-metric-num" style="color:#0d9488;">${m.tasks_completed_count ?? 0}</div><div class="awt-metric-lbl">Tasks Completed</div></div>
                    <div class="awt-metric-box" style="background:#ffffff;"><div class="awt-metric-num" style="color:#4f46e5;">${m.emails_replied_count ?? 0}</div><div class="awt-metric-lbl">Replies Sent</div></div>
                    <div class="awt-metric-box" style="background:#ffffff;"><div class="awt-metric-num" style="color:#0284c7;">${m.hrms_actions_count ?? 0}</div><div class="awt-metric-lbl">HRMS Checks</div></div>
                    <div class="awt-metric-box" style="background:#ffffff;"><div class="awt-metric-num" style="color:#059669;">${m.completion_rate_pct ?? 0}%</div><div class="awt-metric-lbl">Resolution Rate</div></div>
                </div>

                ${tabBodyHtml}
            </div>
        </div>
    `;

    document.getElementById("btnCloseAwtDossier")?.addEventListener("click", () => {
        awtState.selectedAgentEmail = null;
        modal.style.display = "none";
    });

    modal.querySelectorAll(".awt-dossier-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            awtState.dossierTab = btn.getAttribute("data-dtab") || "CASES";
            renderAgentDossierModal();
        });
    });
}

function bindAwtEvents() {
    document.getElementById("btnDismissAwtToast")?.addEventListener("click", () => {
        awtState.toast = null;
        renderAgentWorkTracker();
    });

    document.getElementById("btnModeByDept")?.addEventListener("click", () => {
        awtState.viewMode = "BY_DEPT";
        renderAgentWorkTracker();
    });

    document.getElementById("btnModeActiveAgents")?.addEventListener("click", () => {
        awtState.viewMode = "ACTIVE_AGENTS";
        renderAgentWorkTracker();
    });

    document.getElementById("btnModeMatrix")?.addEventListener("click", () => {
        awtState.viewMode = "MATRIX";
        renderAgentWorkTracker();
    });

    document.getElementById("btnRefreshTracker")?.addEventListener("click", async () => {
        await loadAgentWorkTrackerData();
        awtState.toast = "Synced latest department-wise agent status and case telemetry.";
        renderAgentWorkTracker();
    });

    const fSearch = document.getElementById("awtFilterSearch");
    if (fSearch) {
        fSearch.addEventListener("input", (e) => {
            awtState.searchQuery = e.target.value;
            renderAgentWorkTracker();
            const el = document.getElementById("awtFilterSearch");
            if (el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
            }
        });
    }

    document.getElementById("awtDeptSelect")?.addEventListener("change", (e) => {
        awtState.deptFilter = e.target.value;
        renderAgentWorkTracker();
    });

    document.querySelectorAll("[data-dept-pill]").forEach((pill) => {
        pill.addEventListener("click", () => {
            awtState.deptFilter = pill.getAttribute("data-dept-pill") || "ALL";
            renderAgentWorkTracker();
        });
    });

    document.getElementById("awtRoleSelect")?.addEventListener("change", (e) => {
        awtState.roleFilter = e.target.value;
        renderAgentWorkTracker();
    });

    document.getElementById("awtStatusSelect")?.addEventListener("change", (e) => {
        awtState.statusFilter = e.target.value;
        renderAgentWorkTracker();
    });

    // Open 360° Agent Work Dossier
    document.querySelectorAll(".btn-awt-open-dossier").forEach((btn) => {
        btn.addEventListener("click", () => {
            awtState.selectedAgentEmail = btn.getAttribute("data-agent-email");
            awtState.dossierTab = "CASES";
            renderAgentDossierModal();
        });
    });

    // Assign Unclaimed Case directly to an Agent
    document.querySelectorAll(".btn-awt-assign-case").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const agentEmail = btn.getAttribute("data-agent-email") || "";
            const agentName = btn.getAttribute("data-agent-name") || "HR Agent";
            const agentTeam = btn.getAttribute("data-agent-team") || "HR Operations";
            const sel = document.querySelector(`.awt-assign-case-select[data-agent-email="${CSS.escape(agentEmail)}"]`);
            const caseRef = sel?.value;
            if (!caseRef) return;

            const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agent_name: agentName,
                    agent_email: agentEmail,
                    agent_team: agentTeam,
                }),
            });
            if (res.ok) {
                awtState.toast = `Assigned Case ${caseRef} to ${agentName} (${agentTeam}).`;
                await loadAgentWorkTrackerData();
            }
        });
    });

    // Export CSV
    document.getElementById("btnExportAgentsCsv")?.addEventListener("click", () => {
        const headers = ["Name", "Email", "Role", "Designation", "Department", "Category Scope", "Live Status", "Active Cases", "Resolved Cases", "Tasks Completed", "Tasks Pending", "Emails Replied", "HRMS Actions Run", "Resolution Rate %"];
        const rows = awtState.agents.map((a) => {
            const m = a.metrics || {};
            return [
                a.name || "",
                a.email || "",
                a.role || "",
                a.designation || "",
                a.team_name || "",
                a.category_scope || "",
                a.live_status?.label || "",
                m.active_cases_count ?? 0,
                m.resolved_cases_count ?? 0,
                m.tasks_completed_count ?? 0,
                m.tasks_pending_count ?? 0,
                m.emails_replied_count ?? 0,
                m.hrms_actions_count ?? 0,
                m.completion_rate_pct ?? 0,
            ];
        });
        const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `hrflow_agents_status_report_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        sessionStorage.removeItem("hrflow_token");
        sessionStorage.removeItem("hrflow_user");
        window.location.href = "login.html";
    });

    loadAgentWorkTrackerData();
});
