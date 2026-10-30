/**
 * modals.js — Agent Workbench Overlay Modals (Department Switch, Reassign, New Case)
 */

import { Store } from "../state.js";
import { AgentAPI } from "../api.js";
import { escapeHtml } from "../utils.js";

export function renderModals() {
    const state = Store.getState();
    const activeModal = state.activeModal;

    if (!activeModal) return "";

    if (activeModal === "DEPT_SWITCH") {
        return renderDeptSwitchModal(state);
    }
    if (activeModal === "REASSIGN") {
        return renderReassignModal(state);
    }
    if (activeModal === "NEW_CASE") {
        return renderNewCaseModal(state);
    }

    return "";
}

// -----------------------------------------------------------------------------
// 1. Department Switch Modal
// -----------------------------------------------------------------------------
function renderDeptSwitchModal(state) {
    const ag = state.agent || {};
    const assignedDepts = Array.isArray(ag.assigned_departments) ? ag.assigned_departments : [];
    const activeDeptId = state.activeDeptId;

    return `
        <div class="agent-modal-backdrop active" id="modalBackdrop">
            <div class="agent-modal-card">
                <div class="agent-modal-header">
                    <h3>Switch Operating Desk</h3>
                    <button type="button" class="btn-close-modal" id="btnCloseModal">✕</button>
                </div>
                <div class="agent-modal-body">
                    <p style="font-size:0.85rem; color:#64748b; margin-bottom:14px;">
                        Select which assigned HR department desk to operate from:
                    </p>
                    <div class="dept-options-list">
                        ${assignedDepts
                            .map((d) => {
                                const isCurrent = Number(d.id) === Number(activeDeptId);
                                return `
                                    <button type="button" class="dept-option-btn ${isCurrent ? "active" : ""}" data-dept-id="${d.id}" data-dept-name="${escapeHtml(d.team_name || d.name)}">
                                        <div class="dept-opt-left">
                                            <strong>${escapeHtml(d.team_name || d.name)}</strong>
                                            <span>Categories: ${escapeHtml(d.category_scope || "Operations")}</span>
                                        </div>
                                        ${isCurrent ? `<span class="badge-current-desk">Active Desk</span>` : ""}
                                    </button>
                                `;
                            })
                            .join("")}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// 2. Reassign Case Modal
// -----------------------------------------------------------------------------
function renderReassignModal(state) {
    const targetRef = state.reassignCaseTarget;
    const allAgents = state.allAgents || [];
    const depts = state.agent?.assigned_departments || [];

    return `
        <div class="agent-modal-backdrop active" id="modalBackdrop">
            <div class="agent-modal-card">
                <div class="agent-modal-header">
                    <h3>Reassign Case ${escapeHtml(targetRef || "")}</h3>
                    <button type="button" class="btn-close-modal" id="btnCloseModal">✕</button>
                </div>
                <div class="agent-modal-body">
                    <div class="form-group">
                        <label for="reassignAgentSelect">Select Target Specialist:</label>
                        <select id="reassignAgentSelect" class="form-select">
                            <option value="">-- Choose Specialist --</option>
                            ${allAgents
                                .map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.team_name || a.role_title || "Specialist")})</option>`)
                                .join("")}
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="reassignNote">Reassignment Reason / Note:</label>
                        <textarea id="reassignNote" class="form-textarea" rows="3" placeholder="e.g. Requires specialist with banking adjustment access"></textarea>
                    </div>

                    <div class="agent-modal-footer">
                        <button type="button" class="btn-action-outline" id="btnCancelModal">Cancel</button>
                        <button type="button" class="btn-action-primary" id="btnSubmitReassign" data-case-ref="${escapeHtml(targetRef || "")}">
                            Confirm Reassign
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// 3. New Case Modal
// -----------------------------------------------------------------------------
function renderNewCaseModal(state) {
    const activeDept = state.activeDeptName || "HR Operations";

    return `
        <div class="agent-modal-backdrop active" id="modalBackdrop">
            <div class="agent-modal-card">
                <div class="agent-modal-header">
                    <h3>Log New HR Case (${escapeHtml(activeDept)})</h3>
                    <button type="button" class="btn-close-modal" id="btnCloseModal">✕</button>
                </div>
                <div class="agent-modal-body">
                    <div class="form-group">
                        <label for="newCaseEmpEmail">Employee Email:</label>
                        <input type="email" id="newCaseEmpEmail" class="form-input" placeholder="employee@company.com" required />
                    </div>

                    <div class="form-group">
                        <label for="newCaseTitle">Request Subject / Title:</label>
                        <input type="text" id="newCaseTitle" class="form-input" placeholder="e.g. Bank Account IFSC Update" required />
                    </div>

                    <div class="form-group">
                        <label for="newCaseCategory">Category:</label>
                        <select id="newCaseCategory" class="form-select">
                            <option value="PAYROLL">Payroll &amp; Benefits</option>
                            <option value="LEAVE">Leave Management</option>
                            <option value="ATTENDANCE">Attendance &amp; Regularization</option>
                            <option value="RESIGNATION">Resignation &amp; Exit</option>
                            <option value="ONBOARDING">Onboarding &amp; BGV</option>
                            <option value="ASSET_IT">IT &amp; Assets</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="newCasePriority">Priority:</label>
                        <select id="newCasePriority" class="form-select">
                            <option value="MEDIUM" selected>Medium</option>
                            <option value="HIGH">High</option>
                            <option value="CRITICAL">Critical</option>
                            <option value="LOW">Low</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="newCaseDescription">Request Details / Notes:</label>
                        <textarea id="newCaseDescription" class="form-textarea" rows="4" placeholder="Enter case details or employee inquiry..."></textarea>
                    </div>

                    <div class="agent-modal-footer">
                        <button type="button" class="btn-action-outline" id="btnCancelModal">Cancel</button>
                        <button type="button" class="btn-action-primary" id="btnSubmitNewCase">
                            Create &amp; Open Case
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// EVENT BINDINGS FOR MODALS
// -----------------------------------------------------------------------------
export function bindModalEvents(container) {
    // Close modal
    container.querySelectorAll("#btnCloseModal, #btnCancelModal").forEach((btn) => {
        btn.addEventListener("click", () => {
            Store.setState({ activeModal: null, reassignCaseTarget: null });
        });
    });

    // Dept switch option
    container.querySelectorAll(".dept-option-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const deptId = btn.getAttribute("data-dept-id");
            const deptName = btn.getAttribute("data-dept-name");
            if (deptId) {
                localStorage.setItem("hrflow_agent_active_dept_id", deptId);
                Store.setState({ activeDeptId: deptId, activeDeptName: deptName, activeModal: null });
                if (window.refreshWorkbenchData) {
                    window.refreshWorkbenchData(true, deptId);
                }
            }
        });
    });

    // Reassign submit
    const submitReassignBtn = container.querySelector("#btnSubmitReassign");
    if (submitReassignBtn) {
        submitReassignBtn.addEventListener("click", async () => {
            const caseRef = submitReassignBtn.getAttribute("data-case-ref");
            const agentSelect = container.querySelector("#reassignAgentSelect");
            const noteTextarea = container.querySelector("#reassignNote");
            const agentId = agentSelect ? agentSelect.value : "";
            const note = noteTextarea ? noteTextarea.value.trim() : "";

            if (!agentId) {
                alert("Please select a target specialist to reassign.");
                return;
            }

            try {
                submitReassignBtn.disabled = true;
                submitReassignBtn.textContent = "Reassigning...";
                await AgentAPI.reassignCase(caseRef, {
                    target_agent_id: Number(agentId),
                    note: note || "Reassigned by specialist",
                });
                Store.setState({ activeModal: null, reassignCaseTarget: null });
                Store.showToast(`Case ${caseRef} successfully reassigned!`, "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                alert("Failed to reassign: " + err.message);
                submitReassignBtn.disabled = false;
                submitReassignBtn.textContent = "Confirm Reassign";
            }
        });
    }

    // New case submit
    const submitNewCaseBtn = container.querySelector("#btnSubmitNewCase");
    if (submitNewCaseBtn) {
        submitNewCaseBtn.addEventListener("click", async () => {
            const emailInput = container.querySelector("#newCaseEmpEmail");
            const titleInput = container.querySelector("#newCaseTitle");
            const catSelect = container.querySelector("#newCaseCategory");
            const prioSelect = container.querySelector("#newCasePriority");
            const descInput = container.querySelector("#newCaseDescription");

            const email = emailInput ? emailInput.value.trim() : "";
            const title = titleInput ? titleInput.value.trim() : "";

            if (!email || !title) {
                alert("Please fill in employee email and title.");
                return;
            }

            try {
                submitNewCaseBtn.disabled = true;
                submitNewCaseBtn.textContent = "Creating...";
                const res = await AgentAPI.createNewCase({
                    employee_email: email,
                    title: title,
                    category: catSelect ? catSelect.value : "GENERAL_HR",
                    priority: prioSelect ? prioSelect.value : "MEDIUM",
                    description: descInput ? descInput.value.trim() : "",
                });
                Store.setState({ activeModal: null });
                Store.showToast("Case created successfully!", "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                alert("Failed to create case: " + err.message);
                submitNewCaseBtn.disabled = false;
                submitNewCaseBtn.textContent = "Create & Open Case";
            }
        });
    }
}

