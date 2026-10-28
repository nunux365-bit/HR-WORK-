/**
 * HR Flow — Executive Header Component (frontend/js/casedetail/components/header.js)
 */

import { escapeHtml, formatDateTimeIST } from "../utils/formatters.js";
import { updateStatus, toggleFollow } from "../api.js";
import { showToast } from "../utils/formatters.js";

export function renderHeader(container, state) {
    const c = state.caseData?.case || {};
    const emp = state.caseData?.employee || {};
    const em = state.caseData?.email || {};
    const pb = state.caseData?.playbook || {};

    const caseRef = c.case_number || state.caseRef || "CASE-000000";
    const rawCat = (c.category || "GENERAL_HR").toUpperCase();
    const rawStatus = (c.status || "NEW").toUpperCase();
    const rawPrio = (c.priority || "MEDIUM").toUpperCase();
    const assignedUser = c.assigned_user || c.assigned_to || "Unassigned";

    // SLA calculations
    const slaText = c.sla_remaining || c.sla_status || "On Track";
    const slaShort = String(c.sla_short || "").toUpperCase();
    const slaTone = (slaShort === "OVERDUE" || slaText.toLowerCase().includes("overdue"))
        ? "overdue"
        : (slaShort.includes("h") && parseInt(slaShort) < 12)
            ? "duesoon"
            : "ontrack";

    const isInDb = Boolean(emp && (emp.is_in_db === true || (emp.is_in_db !== false && emp.id != null)));
    const empName = emp.name || c.employee_name || em.sender_name || "Requester";
    const empCode = emp.employee_id || c.employee_id || "";
    const empDept = emp.department || c.employee_department || "Operations";
    const title = em.subject || c.title || `Case ${caseRef}`;

    container.innerHTML = `
        <div class="executive-header">
            <!-- Tier 1: Utility & Navigation Strip -->
            <div class="nav-strip">
                <div class="nav-strip-left">
                    <a href="agent.html#cases" class="nav-back-btn">← Back to Queue</a>
                    <div class="nav-divider"></div>
                    <div class="nav-breadcrumbs">
                        <span>Workforce Ops</span>
                        <span class="bc-sep">/</span>
                        <span>${escapeHtml(rawCat)}</span>
                        <span class="bc-sep">/</span>
                        <span class="bc-current">${escapeHtml(caseRef)}</span>
                    </div>
                </div>

                <div class="nav-strip-center" style="display:flex; align-items:center; gap:8px;">
                    <div class="sla-indicator ${slaTone}">
                        <span>⏱️ SLA:</span>
                        <strong>${escapeHtml(slaText)}</strong>
                    </div>
                    ${(state.caseData?.feedback?.rating || state.caseData?.case?.feedback_rating) ? `
                        <div class="sla-indicator" style="background:#fffbeb; color:#92400e; border-color:#fde68a;">
                            <span>⭐ CSAT:</span>
                            <strong>${'★'.repeat(Number(state.caseData?.feedback?.rating || state.caseData?.case?.feedback_rating))} ${(state.caseData?.feedback?.rating || state.caseData?.case?.feedback_rating)}.0</strong>
                        </div>
                    ` : ''}
                </div>

                <div class="nav-strip-right">
                    <button class="btn-action-pill ${state.caseData?.is_following ? 'active' : ''}" id="btnToggleFollow" title="Watch this ticket to receive live status updates" style="height:28px; font-size:0.74rem;">
                        <span>${state.caseData?.is_following ? '⭐ Following' : '☆ Follow'}</span>
                    </button>
                    <button class="btn-action-pill" id="btnToggleTimeline" title="View Activity & Communications Timeline" style="height:28px; font-size:0.74rem;">
                        <span>⏱️ Activity Log</span>
                    </button>
                    <div class="view-mode-toggle">
                        <button class="view-mode-btn ${state.viewMode === "GUIDED" ? "active" : ""}" id="btnModeGuided">Guided Steps</button>
                        <button class="view-mode-btn ${state.viewMode === "FULL" ? "active" : ""}" id="btnModeFull">Full Overview</button>
                    </div>
                    <button class="btn-action-pill" id="btnPlaybookStudio" title="Category Playbook Rules" style="height:28px; font-size:0.74rem;">
                        <span>⚙️ Studio</span>
                    </button>
                </div>
            </div>

            <!-- Tier 2: Hero Identity Zone -->
            <div class="hero-banner">
                <div class="hero-identity-zone">
                    <div class="hero-meta-row">
                        <span class="case-ref-pill">${escapeHtml(caseRef)}</span>
                        <span class="category-chip" style="background:${pb.badge_color || '#3b82f6'}15; color:${pb.badge_color || '#3b82f6'}; border-color:${pb.badge_color || '#3b82f6'}40;">
                            ${escapeHtml(pb.icon || "📋")} ${escapeHtml(pb.display_name || rawCat)}
                        </span>
                        <span class="card-badge" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;">
                            Assignee: <strong>${escapeHtml(assignedUser)}</strong>
                        </span>
                        ${c.status === "MERGED" ? `
                            <a href="casedetail.html?case=${encodeURIComponent(c.merged_into || '')}" class="card-badge" style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; text-decoration:none;" title="Click to view parent case">
                                🔗 Merged into #${escapeHtml(c.merged_into || 'Parent')}
                            </a>
                        ` : ''}
                        ${Array.isArray(state.caseData?.linked_cases) && state.caseData.linked_cases.length > 0 ? `
                            <span class="card-badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;" title="${state.caseData.linked_cases.length} linked ticket(s)">
                                📎 ${state.caseData.linked_cases.length} Linked Dockets
                            </span>
                        ` : ''}
                    </div>

                    <h1 class="hero-case-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h1>

                    <div class="hero-subtitle-row">
                        <span>Requester: <strong>${escapeHtml(empName)}</strong></span>
                        <span>·</span>
                        <span>ID: <strong style="color:${isInDb ? '#2563eb' : '#d97706'}">${escapeHtml(empCode || (isInDb ? "Registered" : "Unverified"))}</strong></span>
                        <span>·</span>
                        <span>Department: <strong>${escapeHtml(empDept)}</strong></span>
                        <span>·</span>
                        <span>Received: <strong>${formatDateTimeIST(em.received_at || c.created_at)}</strong></span>
                    </div>
                </div>

                <!-- Hero Controls Zone -->
                <div class="hero-controls-zone">
                    <select class="control-select-pill" id="selectCaseStatus" title="Update Status">
                        <option value="NEW" ${rawStatus === "NEW" ? "selected" : ""}>Status: New</option>
                        <option value="IN_PROGRESS" ${rawStatus === "IN_PROGRESS" ? "selected" : ""}>Status: In Progress</option>
                        <option value="ON_HOLD" ${rawStatus === "ON_HOLD" ? "selected" : ""}>Status: On Hold (Pending Info)</option>
                        <option value="REVIEW_REQUIRED" ${rawStatus === "REVIEW_REQUIRED" ? "selected" : ""}>Status: Review Required</option>
                        <option value="RESOLVED" ${rawStatus === "RESOLVED" ? "selected" : ""}>Status: Resolved</option>
                        <option value="CLOSED" ${rawStatus === "CLOSED" ? "selected" : ""}>Status: Closed</option>
                    </select>

                    <select class="control-select-pill" id="selectCasePriority" title="Update Priority">
                        <option value="LOW" ${rawPrio === "LOW" ? "selected" : ""}>Priority: Low</option>
                        <option value="MEDIUM" ${rawPrio === "MEDIUM" ? "selected" : ""}>Priority: Medium</option>
                        <option value="HIGH" ${rawPrio === "HIGH" ? "selected" : ""}>Priority: High</option>
                        <option value="CRITICAL" ${rawPrio === "CRITICAL" ? "selected" : ""}>Priority: Critical</option>
                    </select>

                    <button class="btn-action-pill" id="btnHeaderReassign">
                        <span>Reassign</span>
                    </button>

                    <button class="btn-action-pill" id="btnHeaderEscalate">
                        <span>Escalate</span>
                    </button>

                    <button class="btn-action-pill ${rawStatus === "RESOLVED" ? "" : "success"}" id="btnHeaderResolve">
                        <span>${rawStatus === "RESOLVED" ? "✓ Resolved" : "Resolve Query"}</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Event Bindings
    const btnGuided = container.querySelector("#btnModeGuided");
    const btnFull = container.querySelector("#btnModeFull");
    if (btnGuided) btnGuided.addEventListener("click", () => state.setViewMode("GUIDED"));
    if (btnFull) btnFull.addEventListener("click", () => state.setViewMode("FULL"));

    const selStatus = container.querySelector("#selectCaseStatus");
    const selPrio = container.querySelector("#selectCasePriority");

    if (selStatus) {
        selStatus.addEventListener("change", async (e) => {
            const newStat = e.target.value;
            try {
                await updateStatus(caseRef, newStat, selPrio.value);
                state.caseData.case.status = newStat;
                showToast(`Status updated to ${newStat}`, "success");
                state.emit("change", state.caseData);
            } catch (err) {
                showToast(err.message, "error");
                selStatus.value = rawStatus;
            }
        });
    }

    if (selPrio) {
        selPrio.addEventListener("change", async (e) => {
            const newPrio = e.target.value;
            try {
                await updateStatus(caseRef, selStatus.value, newPrio);
                state.caseData.case.priority = newPrio;
                showToast(`Priority updated to ${newPrio}`, "success");
                state.emit("change", state.caseData);
            } catch (err) {
                showToast(err.message, "error");
                selPrio.value = rawPrio;
            }
        });
    }

    const btnReassign = container.querySelector("#btnHeaderReassign");
    if (btnReassign) {
        btnReassign.addEventListener("click", () => state.emit("openModal", { modal: "reassign" }));
    }

    const btnEscalate = container.querySelector("#btnHeaderEscalate");
    if (btnEscalate) {
        btnEscalate.addEventListener("click", () => state.emit("openModal", { modal: "escalate" }));
    }

    const btnResolve = container.querySelector("#btnHeaderResolve");
    if (btnResolve) {
        btnResolve.addEventListener("click", () => state.emit("openModal", { modal: "resolve" }));
    }

    const btnStudio = container.querySelector("#btnPlaybookStudio");
    if (btnStudio) {
        btnStudio.addEventListener("click", () => state.emit("openModal", { modal: "playbookStudio" }));
    }

    const btnTimeline = container.querySelector("#btnToggleTimeline");
    if (btnTimeline) {
        btnTimeline.addEventListener("click", () => state.emit("toggleTimelineDrawer"));
    }

    const btnFollow = container.querySelector("#btnToggleFollow");
    if (btnFollow) {
        btnFollow.addEventListener("click", async () => {
            try {
                const res = await toggleFollow(caseRef);
                state.caseData.is_following = res.is_following;
                showToast(res.is_following ? "You are now following this ticket" : "Unfollowed ticket", "info");
                renderHeader(container, state);
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }
}

