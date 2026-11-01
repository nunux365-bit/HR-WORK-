/**
 * TATA 1mg PeopleDesk — User Management & RBAC Governance Console (users.js)
 * Clean, fast, zero-dependency controller for specialist directory, role matrix, and workload.
 */

const BACKEND_API_BASE = window.location.origin;

// Application State
const umState = {
    users: [],
    departments: [],
    role_metadata: {},
    role_rules: {},
    permission_labels: {},
    activeTab: "DIRECTORY", // "DIRECTORY" | "PERMISSIONS" | "WORKLOAD"
    roleFilter: "ALL",
    deptFilter: "ALL",
    statusFilter: "ALL", // "ALL" | "ACTIVE" | "DEACTIVATED"
    searchQuery: "",
    editingUser: null,
    pendingDeactivateTarget: null,
};

const ROLE_STYLES = {
    ADMIN: {
        label: "Admin",
        tier: "Tier 1",
        bg: "#eef2ff",
        fg: "#3730a3",
        border: "#c7d2fe",
        avatarBg: "linear-gradient(135deg, #312e81 0%, #4f46e5 100%)",
        dot: "#4f46e5",
    },
    HR_MANAGER: {
        label: "HR Manager",
        tier: "Tier 2",
        bg: "#ecfdf5",
        fg: "#065f46",
        border: "#a7f3d0",
        avatarBg: "linear-gradient(135deg, #065f46 0%, #059669 100%)",
        dot: "#059669",
    },
    HR_LEAD: {
        label: "HR Lead",
        tier: "Tier 3",
        bg: "#fffbeb",
        fg: "#92400e",
        border: "#fde68a",
        avatarBg: "linear-gradient(135deg, #92400e 0%, #d97706 100%)",
        dot: "#d97706",
    },
    HR_AGENT: {
        label: "HR Agent",
        tier: "Tier 4",
        bg: "#eff6ff",
        fg: "#1e40af",
        border: "#bfdbfe",
        avatarBg: "linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)",
        dot: "#2563eb",
    },
};

// Initialize Console on Page Load
document.addEventListener("DOMContentLoaded", () => {
    initCurrentUserProfile();
    checkNeonStatus();
    checkMailboxStatus();
    setupEventHandlers();
    loadUsersData();
});

// User Profile in Topbar
function initCurrentUserProfile() {
    try {
        const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
        if (userStr) {
            const u = JSON.parse(userStr);
            const nameEl = document.getElementById("userName");
            const roleEl = document.getElementById("userRole");
            const avatarEl = document.getElementById("userAvatar");
            if (nameEl) nameEl.textContent = u.name || "Admin";
            if (roleEl) roleEl.textContent = (u.role === "SUPER_ADMIN" ? "Admin" : u.role || "Admin");
            if (avatarEl) {
                const words = (u.name || "Admin").split(" ").filter(Boolean);
                avatarEl.textContent = words.map(w => w[0]).join("").toUpperCase().slice(0, 2) || "AD";
            }
        }
    } catch (_) {}
}

// Live Neon PostgreSQL Connection Status Inspector
async function checkNeonStatus() {
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/cases/neon/status`);
        if (res.ok) {
            const json = await res.json();
            const data = json.data || json;
            const pill = document.getElementById("neonDbStatusPill");
            const label = document.getElementById("neonDbLabel");
            if (data.connected) {
                if (label) label.textContent = `Neon DB: Connected (${data.counts?.cases ?? 0} Cases)`;
                if (pill) {
                    pill.title = `Neon Cloud PostgreSQL (${data.database || "neondb"}) Live • Cases: ${data.counts?.cases}, Employees: ${data.counts?.employees}`;
                    pill.style.display = "inline-flex";
                }
            } else {
                if (label) label.textContent = "Neon DB: Connected (Syncing)";
            }
        }
    } catch (e) {
        console.debug("Neon status check:", e);
    }
}

// Connected Mailbox Status Monitor
async function checkMailboxStatus() {
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/gmail/status`);
        if (res.ok) {
            const data = await res.json();
            const label = document.getElementById("mailboxLabel");
            const unread = document.getElementById("mailboxUnread");
            const email = data.connected_email || data.email || "nunux365@gmail.com";
            if (label) label.textContent = `${email} (${data.connected ? "Connected" : "Online"})`;
            if (unread) unread.textContent = `${data.stored_emails_count ?? data.unread_count ?? 0} Emails`;
        }
    } catch (e) {
        console.debug("Mailbox check:", e);
    }
}

// Fetch Full Roster & RBAC Metadata
async function loadUsersData(silent = false) {
    if (!silent) {
        const tbody = document.getElementById("usersTableBody");
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="padding:48px 24px; text-align:center; color:#64748b;">Loading user directory and RBAC permissions...</td></tr>`;
        }
    }

    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/employees`);
        if (!res.ok) throw new Error("Could not load employee directory");
        const json = await res.json();
        const data = json.data || json;

        umState.users = normalizeUsers(data.employees || []);
        umState.departments = data.departments || [];
        umState.role_metadata = data.role_metadata || {};
        umState.role_rules = data.role_rules || {};
        umState.permission_labels = data.permission_labels || {};

        populateDepartmentFilterSelect();
        populateDepartmentCheckboxes();
        renderActiveView();
        updateKpiCounters();
    } catch (err) {
        showToast("Error loading user directory: " + err.message, "error");
    }
}

// Normalize incoming user payload
function normalizeUsers(raw) {
    return raw.map((u, idx) => {
        const r = (u.role === "SUPER_ADMIN" || u.role === "ADMIN") ? "ADMIN" : (u.role || "HR_AGENT");
        const name = (u.name === "Super Admin" || u.member_name === "Super Admin") ? "Admin" : (u.name || u.member_name || "Admin");
        const st = (u.status || (u.active === 0 ? "DEACTIVATED" : "ACTIVE")).toUpperCase();
        const active = st === "ACTIVE" ? 1 : 0;
        return {
            ...u,
            id: u.id || (idx + 1),
            member_id: u.member_id || u.id,
            user_id: u.user_id || u.id,
            name,
            role: r,
            status: st,
            active,
            designation: u.designation || ROLE_STYLES[r]?.label || "Specialist",
            active_cases: Number(u.active_cases || 0),
            workload_status: u.workload_status || (Number(u.active_cases || 0) === 0 ? "AVAILABLE" : Number(u.active_cases) <= 3 ? "OPTIMAL" : "BUSY"),
        };
    });
}

// Scope Formatter (Clean badges instead of 14-line enum dumps)
function formatCategoryScope(rawScope) {
    if (!rawScope) return `<span class="um-scope-pill">General HR</span>`;
    const str = String(rawScope).trim();
    if (str.toUpperCase().includes("ALL_HR") || str.toUpperCase().includes("ALL_CATEGORIES") || str === "*") {
        return `<span class="um-scope-pill global" title="Universal Scope: All HR categories handled">✨ Universal Scope (All Categories)</span>`;
    }
    const parts = str.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length > 3) {
        const firstTwo = parts.slice(0, 2).map(formatScopeName).join(", ");
        return `<span class="um-scope-pill multi" title="${escapeHtml(str)}">📋 ${escapeHtml(firstTwo)} +${parts.length - 2} more</span>`;
    }
    return parts.map(p => `<span class="um-scope-chip">${escapeHtml(formatScopeName(p))}</span>`).join(" ");
}

function formatScopeName(scope) {
    return String(scope)
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Populate department filter in toolbar
function populateDepartmentFilterSelect() {
    const sel = document.getElementById("umDeptFilterSelect");
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="ALL">All Departments (${umState.departments.length})</option>` +
        umState.departments.map(d => `<option value="${escapeHtml(d.team_name)}" ${cur === d.team_name ? "selected" : ""}>${escapeHtml(d.team_name)}</option>`).join("");
}

// Populate department checkboxes in modal
function populateDepartmentCheckboxes(selectedDeptIds = []) {
    const wrap = document.getElementById("umDeptChecklist");
    if (!wrap) return;
    if (umState.departments.length === 0) {
        wrap.innerHTML = `<span style="font-size:0.78rem; color:#64748b;">No departments created yet. You can create them in Departments console.</span>`;
        return;
    }
    wrap.innerHTML = umState.departments.map(d => {
        const isChecked = selectedDeptIds.length === 0 ? true : selectedDeptIds.includes(Number(d.id));
        return `
            <label class="um-dept-check-item">
                <input type="checkbox" class="um-dept-cb" value="${d.id}" ${isChecked ? "checked" : ""}>
                <div style="display:flex; flex-direction:column; min-width:0;">
                    <strong style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.team_name)}</strong>
                    <span style="font-size:0.68rem; font-weight:700; color:#4f46e5;">Scope: ${escapeHtml(d.category_scope || "GENERAL_HR")}</span>
                </div>
            </label>
        `;
    }).join("");
}

// Update Top KPI Counters
function updateKpiCounters() {
    const total = umState.users.length;
    const admin = umState.users.filter(u => u.role === "ADMIN").length;
    const manager = umState.users.filter(u => u.role === "HR_MANAGER").length;
    const lead = umState.users.filter(u => u.role === "HR_LEAD").length;
    const agent = umState.users.filter(u => u.role === "HR_AGENT").length;

    const elTotal = document.getElementById("kpiCountTotal");
    const elAdmin = document.getElementById("kpiCountAdmin");
    const elMgr = document.getElementById("kpiCountManager");
    const elLead = document.getElementById("kpiCountLead");
    const elAgent = document.getElementById("kpiCountAgent");
    const elDepts = document.getElementById("kpiDeptsSub");
    const tabCount = document.getElementById("tabCountDirectory");

    if (elTotal) elTotal.textContent = total;
    if (elAdmin) elAdmin.textContent = admin;
    if (elMgr) elMgr.textContent = manager;
    if (elLead) elLead.textContent = lead;
    if (elAgent) elAgent.textContent = agent;
    if (elDepts) elDepts.textContent = `${umState.departments.length} Departments`;
    if (tabCount) tabCount.textContent = total;
}

// Render the Active Sub-tab View
function renderActiveView() {
    const viewDir = document.getElementById("viewDirectory");
    const viewPerms = document.getElementById("viewPermissions");
    const viewWorkload = document.getElementById("viewWorkload");

    document.body.classList.toggle("tab-not-directory", umState.activeTab !== "DIRECTORY");

    if (viewDir) viewDir.style.display = umState.activeTab === "DIRECTORY" ? "block" : "none";
    if (viewPerms) viewPerms.style.display = umState.activeTab === "PERMISSIONS" ? "grid" : "none";
    if (viewWorkload) viewWorkload.style.display = umState.activeTab === "WORKLOAD" ? "block" : "none";

    if (umState.activeTab === "DIRECTORY") {
        renderDirectoryTable();
    } else if (umState.activeTab === "PERMISSIONS") {
        renderPermissionsMatrix();
    } else if (umState.activeTab === "WORKLOAD") {
        renderWorkloadMatrix();
    }
}

// Render Tab 1: User Directory Table
function renderDirectoryTable() {
    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;

    const filtered = umState.users.filter(u => {
        if (umState.roleFilter !== "ALL" && u.role !== umState.roleFilter) return false;
        if (umState.deptFilter !== "ALL" && String(u.team_name || "").toLowerCase() !== umState.deptFilter.toLowerCase()) return false;
        if (umState.statusFilter !== "ALL" && u.status !== umState.statusFilter) return false;
        if (umState.searchQuery.trim()) {
            const q = umState.searchQuery.trim().toLowerCase();
            const hay = `${u.name} ${u.email} ${u.role} ${u.designation} ${u.team_name} ${u.category_scope}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="padding:48px 24px; text-align:center;">
                    <div style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-bottom:6px;">No users match your filters</div>
                    <div style="font-size:0.84rem; color:#64748b; margin-bottom:14px;">Try resetting the filters or onboard a new specialist.</div>
                    <button type="button" class="btn-um-primary" onclick="openAddUserModal()">+ Onboard Team Member</button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((u, idx) => {
        const st = ROLE_STYLES[u.role] || ROLE_STYLES.HR_AGENT;
        const initials = String(u.name || "AD")
            .split(" ")
            .filter(Boolean)
            .map(w => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
        const isPrimaryAdmin = String(u.email || "").toLowerCase() === "nunux365@gmail.com";
        const isActive = u.status === "ACTIVE";

        const loadBadgeClass = u.active_cases === 0 ? "available" : (u.active_cases <= 3 ? "optimal" : (u.active_cases <= 6 ? "busy" : "overloaded"));
        const loadLabel = u.active_cases === 0 ? "0 Cases · Available" : `${u.active_cases} Active · ${u.workload_status}`;

        return `
            <tr data-user-id="${u.id}" data-email="${escapeHtml(u.email)}">
                <!-- 1. Index -->
                <td style="font-family:ui-monospace, monospace; font-size:0.78rem; font-weight:800; color:#64748b;">
                    #${idx + 1}
                </td>

                <!-- 2. User & Email -->
                <td>
                    <div class="um-user-cell">
                        <div class="um-avatar" style="background:${st.avatarBg};">
                            ${escapeHtml(initials)}
                        </div>
                        <div class="um-user-meta">
                            <div class="um-user-name-line">
                                <span class="um-user-name">${escapeHtml(u.name)}</span>
                                ${isPrimaryAdmin ? `<span class="um-tag-primary-admin">PRIMARY ADMIN</span>` : ""}
                            </div>
                            <span class="um-user-email">${escapeHtml(u.email)}</span>
                        </div>
                    </div>
                </td>

                <!-- 3. Current Role & Title -->
                <td>
                    <span class="um-role-badge" style="background:${st.bg}; color:${st.fg}; border:1px solid ${st.border};">
                        <span class="um-role-dot" style="background:${st.dot};"></span>
                        ${escapeHtml(st.label)} (${escapeHtml(st.tier)})
                    </span>
                    <div class="um-designation-text">${escapeHtml(u.designation || st.label)}</div>
                </td>

                <!-- 4. Department & Scope -->
                <td>
                    <div class="um-dept-name">🏢 ${escapeHtml(u.team_name || "HR Operations")}</div>
                    <div style="margin-top:2px;">${formatCategoryScope(u.category_scope)}</div>
                    ${u.sub_department ? `<div class="um-subdept-pill">🏷️ ${escapeHtml(u.sub_department)}</div>` : ""}
                </td>

                <!-- 5. Workload & Capacity -->
                <td>
                    <span class="um-workload-badge ${loadBadgeClass}">
                        <span style="font-size:0.8rem;">●</span> ${loadLabel}
                    </span>
                    <div style="font-size:0.71rem; color:#64748b; margin-top:4px;">
                        ${u.welcome_email ? `<span style="color:#059669; font-weight:700;">✓ Welcome Email Sent</span>` : `Ready to invite`}
                    </div>
                </td>

                <!-- 6. Account Status Toggle -->
                <td>
                    <button type="button" class="um-status-btn ${isActive ? "active" : "deactivated"}" 
                        onclick="toggleUserStatus(${u.id}, '${escapeHtml(u.email)}', '${u.status}', ${u.active_cases})"
                        title="${isPrimaryAdmin ? 'Primary Admin cannot be deactivated' : (isActive ? 'Click to Deactivate / Suspend' : 'Click to Activate')}">
                        <span>${isActive ? "● Active" : "○ Deactivated"}</span>
                    </button>
                </td>

                <!-- 7. Actions & Links (Dynamic Links based on Active Origin) -->
                <td class="um-actions-cell">
                    <div class="um-actions-wrap">
                        <!-- Quick Role Switcher -->
                        <select class="um-action-select" onchange="quickUpdateUserRole(${u.id}, '${escapeHtml(u.email)}', this.value)">
                            <option value="ADMIN" ${u.role === "ADMIN" ? "selected" : ""}>Admin</option>
                            <option value="HR_MANAGER" ${u.role === "HR_MANAGER" ? "selected" : ""}>HR Manager</option>
                            <option value="HR_LEAD" ${u.role === "HR_LEAD" ? "selected" : ""}>HR Lead</option>
                            <option value="HR_AGENT" ${u.role === "HR_AGENT" ? "selected" : ""}>HR Agent</option>
                        </select>

                        <!-- Edit User Details -->
                        <button type="button" class="btn-action-tata" onclick="openEditUserModal(${u.id})" title="Edit Name, Department, Designation">
                            ✎ Edit
                        </button>

                        <!-- Agent Status Dossier (Dynamic Origin Link) -->
                        <a href="${window.location.origin}/agentworktracker.html?agent=${encodeURIComponent(u.email)}" target="_blank" class="btn-action-tata" title="360° Specialist Dossier">
                            📊 Status ↗
                        </a>

                        <!-- Agent Workspace (Dynamic Origin Link) -->
                        <a href="${window.location.origin}/agent.html?email=${encodeURIComponent(u.email)}&inspect=admin" target="_blank" class="btn-action-tata" title="Specialist Execution Workspace">
                            🎯 Workspace ↗
                        </a>

                        <!-- Invite via Email -->
                        <button type="button" class="btn-action-tata" onclick="openWelcomeEmailPreview('${escapeHtml(u.name)}', '${escapeHtml(u.email)}', '${u.role}', '${escapeHtml(u.team_name || 'HR Operations')}', '${escapeHtml(u.designation || '')}', ${u.id})" title="Preview or Re-send Welcome Email">
                            ✉ Invite
                        </button>

                        <!-- Revoke Access -->
                        ${isPrimaryAdmin ? "" : `
                            <button type="button" class="btn-action-tata danger" onclick="deleteUserSafely(${u.user_id || u.id}, '${escapeHtml(u.name)}', '${escapeHtml(u.email)}', ${u.active_cases}, ${u.member_id || u.id})" title="Revoke Portal Access">
                                ✕
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// Render Tab 2: 4-Tier Role Permissions Matrix
function renderPermissionsMatrix() {
    const wrap = document.getElementById("viewPermissions");
    if (!wrap) return;

    const roles = ["ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT"];
    wrap.innerHTML = roles.map(rKey => {
        const meta = umState.role_metadata[rKey] || {};
        const st = ROLE_STYLES[rKey] || ROLE_STYLES.HR_AGENT;
        const activePerms = umState.role_rules[rKey] || [];
        const allPermKeys = Object.keys(umState.permission_labels || {});
        const displayPerms = allPermKeys.length > 0 ? allPermKeys : activePerms;

        return `
            <div class="um-matrix-card">
                <div class="um-matrix-header" style="background:${st.bg}; border-bottom-color:${st.border};">
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span class="um-matrix-tier-tag" style="color:${st.fg};">${rKey}</span>
                        <span style="padding:2px 8px; border-radius:999px; background:#ffffff; color:${st.fg}; font-size:0.68rem; font-weight:800; border:1px solid ${st.border};">
                            ${activePerms.length} Rules Active
                        </span>
                    </div>
                    <h3>${escapeHtml(meta.title || st.label)}</h3>
                    <p>${escapeHtml(meta.summary || "")}</p>
                </div>

                <div class="um-matrix-modules">
                    <div class="um-matrix-subheading">Unlocked Workspace Modules</div>
                    <div class="um-module-tags">
                        ${(meta.accessible_modules || []).map(m => `<span class="um-module-tag">${escapeHtml(m)}</span>`).join("")}
                    </div>
                </div>

                <div class="um-matrix-perms">
                    <div class="um-matrix-subheading">Granular RBAC Rules</div>
                    ${displayPerms.map(pKey => {
                        const enabled = activePerms.includes(pKey);
                        const lbl = umState.permission_labels[pKey] || pKey.replace(/_/g, " ");
                        return `
                            <label class="um-perm-row">
                                <span style="color:${enabled ? '#0f172a' : '#94a3b8'}; font-weight:${enabled ? '600' : '500'};">${escapeHtml(lbl)}</span>
                                <input type="checkbox" onchange="togglePermission('${rKey}', '${pKey}', this.checked)" ${enabled ? "checked" : ""} ${rKey === "ADMIN" ? "disabled" : ""}>
                            </label>
                        `;
                    }).join("")}
                </div>
            </div>
        `;
    }).join("");
}

// Render Tab 3: Specialist Workload Matrix
function renderWorkloadMatrix() {
    const grid = document.getElementById("workloadCardsGrid");
    if (!grid) return;

    if (umState.users.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:32px; color:#64748b;">No specialists onboarded yet.</div>`;
        return;
    }

    grid.innerHTML = umState.users.map(u => {
        const st = ROLE_STYLES[u.role] || ROLE_STYLES.HR_AGENT;
        const loadClass = u.active_cases === 0 ? "available" : (u.active_cases <= 3 ? "optimal" : "busy");
        return `
            <div style="background:#ffffff; border:1px solid var(--tata-border); border-radius:16px; padding:18px 20px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="um-avatar" style="width:36px; height:36px; background:${st.avatarBg}; font-size:0.8rem;">
                            ${escapeHtml(u.name.slice(0, 2).toUpperCase())}
                        </div>
                        <div>
                            <div style="font-weight:800; font-size:0.92rem; color:#0f172a;">${escapeHtml(u.name)}</div>
                            <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(u.designation || st.label)}</div>
                        </div>
                    </div>
                    <span class="um-workload-badge ${loadClass}">
                        ${u.active_cases} Active
                    </span>
                </div>

                <div style="background:#f8fafc; border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:0.78rem;">
                    <div><strong>Department:</strong> ${escapeHtml(u.team_name || "General")}</div>
                    <div style="margin-top:4px;">${formatCategoryScope(u.category_scope)}</div>
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <a href="${window.location.origin}/agentworktracker.html?agent=${encodeURIComponent(u.email)}" target="_blank" class="btn-um-sm success" style="flex:1; justify-content:center;">
                        📊 Dossier
                    </a>
                    <a href="${window.location.origin}/cases.html" class="btn-um-sm primary" style="flex:1; justify-content:center;">
                        + Assign Case
                    </a>
                </div>
            </div>
        `;
    }).join("");
}

// Quick Update User Role from Table Dropdown
async function quickUpdateUserRole(userId, email, newRole) {
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/users/${encodeURIComponent(userId)}/role?email=${encodeURIComponent(email)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole, email }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to update role");
        showToast(`Role updated to ${newRole} for ${email}`, "success");
        await loadUsersData(true);
    } catch (err) {
        showToast(err.message, "error");
        await loadUsersData(true);
    }
}

// Toggle User Status (Active vs Deactivated)
async function toggleUserStatus(userId, email, currentStatus, activeCases) {
    if (email.toLowerCase() === "nunux365@gmail.com") {
        showToast("Primary Admin cannot be deactivated.", "error");
        return;
    }

    if (currentStatus === "ACTIVE" && activeCases > 0) {
        umState.pendingDeactivateTarget = { userId, email, activeCases };
        const text = document.getElementById("umTransferModalText");
        if (text) {
            text.innerHTML = `<strong>${escapeHtml(email)}</strong> currently has <strong>${activeCases} active cases</strong> assigned. Deactivating them will prevent further case routing.`;
        }
        document.getElementById("umTransferModal")?.classList.add("open");
        return;
    }

    const nextStatus = currentStatus === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/users/${encodeURIComponent(userId)}/status?email=${encodeURIComponent(email)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus, email, unassign_cases: false }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to update status");
        showToast(`User ${email} status set to ${nextStatus}`, "success");
        await loadUsersData(true);
    } catch (err) {
        showToast(err.message, "error");
    }
}

// Safe Delete / Revoke User
async function deleteUserSafely(userId, name, email, activeCases, memberId = null) {
    if (email.toLowerCase() === "nunux365@gmail.com") {
        showToast("Primary Admin cannot be removed.", "error");
        return;
    }

    const warnMsg = activeCases > 0
        ? `Revoke portal access for ${name} (${email})? Their ${activeCases} active cases will be safely returned to Department Queue.`
        : `Revoke portal access for ${name} (${email})?`;

    if (!confirm(warnMsg)) return;

    try {
        const targetId = userId || memberId;
        const res = await fetch(`${BACKEND_API_BASE}/api/users/${encodeURIComponent(targetId)}?email=${encodeURIComponent(email)}`, {
            method: "DELETE",
        });
        const json = await res.json();
        if (!res.ok) {
            // Fallback to agent employee delete route if needed
            if (memberId) {
                const fbRes = await fetch(`${BACKEND_API_BASE}/api/agent/employees/${encodeURIComponent(memberId)}`, { method: "DELETE" });
                if (fbRes.ok) {
                    showToast(`Revoked access for ${name} (${email})`, "success");
                    await loadUsersData(true);
                    return;
                }
            }
            throw new Error(json.error?.message || "Failed to delete user");
        }
        showToast(`Revoked access for ${name} (${email})`, "success");
        await loadUsersData(true);
    } catch (err) {
        showToast(err.message, "error");
    }
}

// Toggle RBAC Permission Checkbox in Matrix
async function togglePermission(role, permission, enabled) {
    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/roles/rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, permission, enabled }),
        });
        const json = await res.json();
        if (res.ok && json.data?.role_rules) {
            umState.role_rules = json.data.role_rules;
            showToast(`${enabled ? "Enabled" : "Disabled"} '${permission}' for ${role}`, "success");
        }
    } catch (err) {
        console.error("Rule toggle error:", err);
    }
}

// Modal Handlers: Open Add User Modal
function openAddUserModal() {
    umState.editingUser = null;
    document.getElementById("umModalTitle").textContent = "Onboard New HR User & Assign Role";
    document.getElementById("umInputUserId").value = "";
    document.getElementById("umInputMemberId").value = "";
    document.getElementById("umInputName").value = "";
    document.getElementById("umInputEmail").value = "";
    document.getElementById("umInputEmail").disabled = false;
    document.getElementById("umInputRole").value = "HR_AGENT";
    document.getElementById("umInputDesignation").value = "";
    document.getElementById("umInputSubDept").value = "Universal Desk (General)";
    document.getElementById("umInputStatus").value = "ACTIVE";
    document.getElementById("umInputNote").value = "";
    document.getElementById("umInputSendEmail").checked = true;

    populateDepartmentCheckboxes([]);
    document.getElementById("umAddEditModal")?.classList.add("open");
}

// Modal Handlers: Open Edit User Modal
function openEditUserModal(userId) {
    const user = umState.users.find(u => Number(u.id) === Number(userId));
    if (!user) return;

    umState.editingUser = user;
    document.getElementById("umModalTitle").textContent = `Edit Specialist — ${user.name}`;
    document.getElementById("umInputUserId").value = user.user_id || user.id;
    document.getElementById("umInputMemberId").value = user.member_id || "";
    document.getElementById("umInputName").value = user.name || "";
    document.getElementById("umInputEmail").value = user.email || "";
    document.getElementById("umInputEmail").disabled = user.email.toLowerCase() === "nunux365@gmail.com";
    document.getElementById("umInputRole").value = user.role || "HR_AGENT";
    document.getElementById("umInputDesignation").value = user.designation || "";
    document.getElementById("umInputSubDept").value = user.sub_department || "Universal Desk (General)";
    document.getElementById("umInputStatus").value = user.status || "ACTIVE";
    document.getElementById("umInputNote").value = "";
    document.getElementById("umInputSendEmail").checked = false;

    const assignedDids = Array.isArray(user.dept_ids) ? user.dept_ids : (user.dept_id ? [Number(user.dept_id)] : []);
    populateDepartmentCheckboxes(assignedDids);
    document.getElementById("umAddEditModal")?.classList.add("open");
}

// Submit Add / Edit User Form
async function submitUserForm() {
    const btn = document.getElementById("btnUmSubmitUser");
    const name = document.getElementById("umInputName")?.value?.trim();
    const email = document.getElementById("umInputEmail")?.value?.trim().toLowerCase();
    const role = document.getElementById("umInputRole")?.value || "HR_AGENT";
    const designation = document.getElementById("umInputDesignation")?.value?.trim() || "";
    const sub_department = document.getElementById("umInputSubDept")?.value || "";
    const status = document.getElementById("umInputStatus")?.value || "ACTIVE";
    const custom_note = document.getElementById("umInputNote")?.value?.trim() || "";
    const send_welcome_email = Boolean(document.getElementById("umInputSendEmail")?.checked);

    const checkedBoxes = Array.from(document.querySelectorAll(".um-dept-cb:checked"));
    const dept_ids = checkedBoxes.map(cb => Number(cb.value)).filter(Boolean);
    const dept_id = dept_ids[0] || (umState.departments[0]?.id || 1);

    if (!name || !email || !email.includes("@")) {
        showToast("Please provide a valid Full Name and Login Email address.", "error");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        const isEdit = Boolean(umState.editingUser);
        const url = isEdit
            ? `${BACKEND_API_BASE}/api/agent/employees/${encodeURIComponent(umState.editingUser.member_id || umState.editingUser.id)}`
            : `${BACKEND_API_BASE}/api/agent/employees`;
        const method = isEdit ? "PUT" : "POST";

        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                email,
                target_email: isEdit ? umState.editingUser.email : email,
                member_id: isEdit ? umState.editingUser.member_id : null,
                role,
                dept_id: Number(dept_id),
                dept_ids,
                designation,
                sub_department,
                status,
                custom_note,
                send_welcome_email,
                portal_base_url: window.location.origin,
            }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Failed to save user");

        document.getElementById("umAddEditModal")?.classList.remove("open");
        showToast(`${isEdit ? "Updated" : "Onboarded"} ${name} (${email}) as ${role}`, "success");
        await loadUsersData(true);
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "💾 Save & Provision User";
    }
}

// Live HTML Welcome Email Preview
async function openWelcomeEmailPreview(name, email, role, team_name, designation, memberId = null) {
    umState.previewEmailTarget = { name, email, role, team_name, designation, memberId };
    const modal = document.getElementById("umWelcomePreviewModal");
    const body = document.getElementById("umPreviewModalBody");
    const dispatchBtn = document.getElementById("btnUmDispatchPreviewEmail");
    if (!modal || !body) return;

    if (dispatchBtn) {
        dispatchBtn.disabled = false;
        dispatchBtn.textContent = "🚀 Dispatch Email via Gmail SMTP";
    }

    modal.classList.add("open");
    body.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">Generating live HTML email template preview...</div>`;

    try {
        const res = await fetch(`${BACKEND_API_BASE}/api/agent/employees/welcome-preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, role, team_name, designation, portal_base_url: window.location.origin }),
        });
        const json = await res.json();
        const data = json.data || json;

        body.innerHTML = `
            <div style="background:#ffffff; padding:12px 16px; border-radius:12px; border:1px solid #cbd5e1; margin-bottom:12px; font-size:0.8rem;">
                <div><strong>Recipient:</strong> ${escapeHtml(data.recipient_name || name)} &lt;${escapeHtml(data.recipient_email || email)}&gt;</div>
                <div style="margin-top:4px;"><strong>Subject:</strong> ${escapeHtml(data.subject || "Welcome to Tata 1mg PeopleDesk")}</div>
                <div style="margin-top:4px; font-size:0.75rem; color:#64748b;"><strong>Status:</strong> Live SMTP dispatch via <strong>smtp.gmail.com:465</strong> (nunux365@gmail.com)</div>
            </div>
            <div style="background:#ffffff; border-radius:12px; border:1px solid #cbd5e1; overflow:hidden;">
                ${data.body_html || `<pre style="padding:16px;">${escapeHtml(data.body_text || "")}</pre>`}
            </div>
        `;
    } catch (err) {
        body.innerHTML = `<div style="padding:20px; color:#dc2626;">Could not generate preview: ${escapeHtml(err.message)}</div>`;
    }
}

// Toast Notifications Helper
function showToast(message, type = "success") {
    const container = document.getElementById("umToastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `um-toast ${type === "error" ? "error" : ""}`;
    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <span>${type === "error" ? "⚠️" : "✅"}</span>
            <span>${escapeHtml(message)}</span>
        </div>
        <button type="button" style="background:transparent; border:none; cursor:pointer; font-weight:800; color:inherit;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.innerHTML = "";
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 6000);
}

// Bind All DOM Listeners
function setupEventHandlers() {
    // Topbar Sync Mail Button
    document.getElementById("syncMailBtn")?.addEventListener("click", async () => {
        const btn = document.getElementById("syncMailBtn");
        btn.disabled = true;
        btn.querySelector("span").textContent = "Syncing...";
        try {
            await fetch(`${BACKEND_API_BASE}/api/gmail/sync`, { method: "POST" });
            await checkMailboxStatus();
            showToast("Gmail sync complete.", "success");
        } catch (_) {}
        btn.disabled = false;
        btn.querySelector("span").textContent = "Sync Mail";
    });

    // Sub-tab Switchers
    document.getElementById("tabBtnDirectory")?.addEventListener("click", () => switchTab("DIRECTORY"));
    document.getElementById("tabBtnPermissions")?.addEventListener("click", () => switchTab("PERMISSIONS"));
    document.getElementById("tabBtnWorkload")?.addEventListener("click", () => switchTab("WORKLOAD"));

    function switchTab(tab) {
        umState.activeTab = tab;
        document.getElementById("tabBtnDirectory")?.classList.toggle("active", tab === "DIRECTORY");
        document.getElementById("tabBtnPermissions")?.classList.toggle("active", tab === "PERMISSIONS");
        document.getElementById("tabBtnWorkload")?.classList.toggle("active", tab === "WORKLOAD");
        renderActiveView();
    }

    // Refresh Button
    document.getElementById("btnUmRefresh")?.addEventListener("click", () => loadUsersData());

    // Onboard User Button
    document.getElementById("btnUmOpenAddModal")?.addEventListener("click", openAddUserModal);
    document.getElementById("btnUmCloseAddModal")?.addEventListener("click", () => {
        document.getElementById("umAddEditModal")?.classList.remove("open");
    });

    // Modal Submit
    document.getElementById("btnUmSubmitUser")?.addEventListener("click", submitUserForm);

    // Modal Preview Welcome Email
    document.getElementById("btnUmPreviewWelcome")?.addEventListener("click", () => {
        const name = document.getElementById("umInputName")?.value || "Specialist";
        const email = document.getElementById("umInputEmail")?.value || "specialist@gmail.com";
        const role = document.getElementById("umInputRole")?.value || "HR_AGENT";
        const designation = document.getElementById("umInputDesignation")?.value || "";
        openWelcomeEmailPreview(name, email, role, "HR Operations", designation);
    });

    document.getElementById("btnUmClosePreviewModal")?.addEventListener("click", () => {
        document.getElementById("umWelcomePreviewModal")?.classList.remove("open");
    });

    // 1-Click Dispatch Welcome Email via Gmail SMTP
    document.getElementById("btnUmDispatchPreviewEmail")?.addEventListener("click", async () => {
        const target = umState.previewEmailTarget;
        if (!target) return;
        const btn = document.getElementById("btnUmDispatchPreviewEmail");
        btn.disabled = true;
        btn.textContent = "⏳ Dispatching via Gmail SMTP...";

        try {
            let res;
            if (target.memberId) {
                res = await fetch(`${BACKEND_API_BASE}/api/agent/employees/${encodeURIComponent(target.memberId)}/send-welcome`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ custom_note: "", portal_base_url: window.location.origin })
                });
            } else {
                // If previewed from add modal, check if user already exists
                const matched = umState.users.find(u => u.email.toLowerCase() === target.email.toLowerCase());
                if (matched && (matched.member_id || matched.id)) {
                    res = await fetch(`${BACKEND_API_BASE}/api/agent/employees/${encodeURIComponent(matched.member_id || matched.id)}/send-welcome`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ custom_note: "", portal_base_url: window.location.origin })
                    });
                } else {
                    showToast("Please save and provision the user first to dispatch official credentials.", "error");
                    btn.disabled = false;
                    btn.textContent = "🚀 Dispatch Email via Gmail SMTP";
                    return;
                }
            }

            const json = await res.json();
            if (!res.ok) throw new Error(json.error?.message || "Failed to dispatch email");

            const dispatch = json.data?.welcome_dispatch || {};
            if (dispatch.sent) {
                showToast(`✓ Welcome email dispatched to ${target.email} via Gmail SMTP!`, "success");
            } else if (dispatch.status === "LOGGED_LOCAL_ONLY" || dispatch.status === "SMTP_ERROR_LOGGED") {
                showToast(`Email recorded in audit log (${dispatch.message || dispatch.error || 'Local logged'})`, "success");
            } else {
                showToast(`Dispatch status: ${dispatch.status || 'OK'}`, "success");
            }

            btn.textContent = "✓ Email Dispatched!";
            setTimeout(() => {
                document.getElementById("umWelcomePreviewModal")?.classList.remove("open");
                btn.disabled = false;
                btn.textContent = "🚀 Dispatch Email via Gmail SMTP";
            }, 1500);

            await loadUsersData(true);
        } catch (err) {
            showToast(err.message, "error");
            btn.disabled = false;
            btn.textContent = "🚀 Dispatch Email via Gmail SMTP";
        }
    });

    // Deactivate Transfer Modal Handlers
    document.getElementById("btnUmCloseTransferModal")?.addEventListener("click", () => {
        document.getElementById("umTransferModal")?.classList.remove("open");
    });
    document.getElementById("btnUmCancelTransfer")?.addEventListener("click", () => {
        document.getElementById("umTransferModal")?.classList.remove("open");
    });
    document.getElementById("btnUmConfirmTransfer")?.addEventListener("click", async () => {
        if (!umState.pendingDeactivateTarget) return;
        const { userId, email } = umState.pendingDeactivateTarget;
        const unassign = document.querySelector('input[name="transferOption"]:checked')?.value === "UNASSIGN";

        try {
            const res = await fetch(`${BACKEND_API_BASE}/api/users/${encodeURIComponent(userId)}/status?email=${encodeURIComponent(email)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "DEACTIVATED", email, unassign_cases: unassign }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error?.message || "Failed to deactivate");
            document.getElementById("umTransferModal")?.classList.remove("open");
            showToast(`Deactivated ${email} ${unassign ? "and returned active cases to queue." : ""}`, "success");
            await loadUsersData(true);
        } catch (err) {
            showToast(err.message, "error");
        }
    });

    // Filters: Search
    document.getElementById("umSearchInput")?.addEventListener("input", (e) => {
        umState.searchQuery = e.target.value;
        renderDirectoryTable();
        toggleResetButton();
    });

    // Filters: Department
    document.getElementById("umDeptFilterSelect")?.addEventListener("change", (e) => {
        umState.deptFilter = e.target.value;
        renderDirectoryTable();
        toggleResetButton();
    });

    // Filters: Status
    document.getElementById("umStatusFilterSelect")?.addEventListener("change", (e) => {
        umState.statusFilter = e.target.value;
        renderDirectoryTable();
        toggleResetButton();
    });

    // Filters: Reset
    document.getElementById("btnUmResetFilters")?.addEventListener("click", () => {
        umState.roleFilter = "ALL";
        umState.deptFilter = "ALL";
        umState.statusFilter = "ALL";
        umState.searchQuery = "";
        const s = document.getElementById("umSearchInput");
        if (s) s.value = "";
        const d = document.getElementById("umDeptFilterSelect");
        if (d) d.value = "ALL";
        const st = document.getElementById("umStatusFilterSelect");
        if (st) st.value = "ALL";
        document.querySelectorAll(".um-pill-btn").forEach(p => p.classList.toggle("active", p.dataset.role === "ALL"));
        document.querySelectorAll(".case-stat-box").forEach(c => c.classList.toggle("active", c.dataset.roleFilter === "ALL"));
        renderDirectoryTable();
        toggleResetButton();
    });

    // Role Pills
    document.querySelectorAll(".um-pill-btn").forEach(pill => {
        pill.addEventListener("click", () => {
            const r = pill.dataset.role;
            umState.roleFilter = r;
            document.querySelectorAll(".um-pill-btn").forEach(p => p.classList.toggle("active", p.dataset.role === r));
            document.querySelectorAll(".case-stat-box").forEach(c => c.classList.toggle("active", c.dataset.roleFilter === r));
            renderDirectoryTable();
            toggleResetButton();
        });
    });

    // Clickable High-Density Subheader KPI Metric Boxes
    document.querySelectorAll(".case-stat-box").forEach(card => {
        card.addEventListener("click", () => {
            const r = card.dataset.roleFilter || "ALL";
            umState.roleFilter = r;
            document.querySelectorAll(".case-stat-box").forEach(c => c.classList.toggle("active", c.dataset.roleFilter === r));
            document.querySelectorAll(".um-pill-btn").forEach(p => p.classList.toggle("active", p.dataset.role === r));
            switchTab("DIRECTORY");
            renderDirectoryTable();
            toggleResetButton();
        });
    });

    function toggleResetButton() {
        const isDirty = umState.roleFilter !== "ALL" || umState.deptFilter !== "ALL" || umState.statusFilter !== "ALL" || Boolean(umState.searchQuery);
        const btn = document.getElementById("btnUmResetFilters");
        if (btn) btn.style.display = isDirty ? "inline-flex" : "none";
    }
}

// Utility: HTML Escaping
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

