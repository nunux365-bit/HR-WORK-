/**
 * header.js — Top Navigation & Agent Identity Bar
 */

import { Store } from "../state.js";
import { escapeHtml, getInitials } from "../utils.js";
import { AgentAPI } from "../api.js";

export function renderHeader() {
    const state = Store.getState();
    const ag = state.agent;
    if (!ag) return;

    // 1. Department Pill
    const deptPill = document.getElementById("topbarDeptPill");
    if (deptPill) {
        const assignedDepts = Array.isArray(ag.assigned_departments) ? ag.assigned_departments : [];
        const hasMultiple = assignedDepts.length > 1;
        const currentActiveName = state.activeDeptName || ag.active_dept_name || ag.team_name || "HR Operations";

        if (hasMultiple) {
            deptPill.className = "agent-dept-pill agent-dept-pill-interactive";
            deptPill.style.cursor = "pointer";
            deptPill.title = `Active Desk: ${currentActiveName}. Click to switch desk (${assignedDepts.length} assigned).`;
            deptPill.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 21h18"></path><path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                    <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                </svg>
                <span style="font-weight:700;">${escapeHtml(currentActiveName)}</span>
                <span class="dept-pill-switch-tag" style="background:rgba(79, 70, 229, 0.12); color:#4338ca; padding:2px 7px; border-radius:999px; font-size:0.7rem; font-weight:700; margin-left:4px;">
                    Switch (${assignedDepts.length}) ▾
                </span>
            `;
            deptPill.onclick = () => Store.setState({ activeModal: "DEPT_SWITCH" });
        } else {
            deptPill.className = "agent-dept-pill";
            deptPill.style.cursor = "default";
            deptPill.onclick = null;
            deptPill.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 21h18"></path><path d="M9 8h1"></path><path d="M9 12h1"></path><path d="M9 16h1"></path>
                    <path d="M14 8h1"></path><path d="M14 12h1"></path><path d="M14 16h1"></path>
                    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
                </svg>
                <span style="font-weight:700;">${escapeHtml(currentActiveName)}</span>
            `;
        }
    }

    // 2. User Avatar & Info
    const avEl = document.getElementById("userAvatar");
    const nameEl = document.getElementById("userName");
    const roleEl = document.getElementById("userRole");

    const sessionUser = AgentAPI.getSessionUser();
    const isInspector = sessionUser && ["ADMIN", "HR_MANAGER", "HR_LEAD"].includes(String(sessionUser.role || "").toUpperCase()) &&
                        sessionUser.email?.toLowerCase() !== ag.email?.toLowerCase();

    const displayName = isInspector ? sessionUser.name : (ag.name || "HR Specialist");
    const displayRole = isInspector
        ? `${sessionUser.role} (Inspecting ${ag.name})`
        : `${ag.designation || "HR Specialist"} · ${state.activeDeptName || "HR Ops"}`;

    if (avEl) avEl.textContent = getInitials(displayName);
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) {
        roleEl.textContent = displayRole;
        roleEl.title = displayRole;
    }

    // 3. Admin Switchers
    const roleSwitcherWrap = document.getElementById("agentRoleSwitcherWrap");
    const roleSelect = document.getElementById("agentRoleSelect");
    const canSwitchRole = Boolean(isInspector || sessionUser?.role === "ADMIN" || sessionUser?.email?.includes("admin"));

    if (roleSwitcherWrap) {
        roleSwitcherWrap.style.display = canSwitchRole ? "inline-flex" : "none";
        if (roleSelect && canSwitchRole && !roleSelect.dataset.bound) {
            roleSelect.dataset.bound = "true";
            roleSelect.value = sessionUser?.role || "HR_AGENT";
            roleSelect.addEventListener("change", async (e) => {
                const targetRole = e.target.value;
                if (!confirm(`Switch active role to ${targetRole}?`)) {
                    e.target.value = sessionUser?.role || "HR_AGENT";
                    return;
                }
                try {
                    await AgentAPI.switchRole(targetRole);
                    const updatedUser = { ...sessionUser, role: targetRole };
                    sessionStorage.setItem("hrflow_user", JSON.stringify(updatedUser));
                    localStorage.setItem("hrflow_last_user", JSON.stringify(updatedUser));
                    if (targetRole === "HR_AGENT") {
                        window.location.reload();
                    } else {
                        window.location.href = "inbox.html";
                    }
                } catch (err) {
                    alert("Error switching role: " + err.message);
                    e.target.value = sessionUser?.role || "HR_AGENT";
                }
            });
        }
    }

    // 4. Logout Button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && !logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "true";
        logoutBtn.addEventListener("click", () => AgentAPI.logout());
    }
}

