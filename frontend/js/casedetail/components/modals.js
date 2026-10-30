/**
 * HR Flow — Interactive Modals Manager (frontend/js/casedetail/components/modals.js)
 */

import { escapeHtml } from "../utils/formatters.js";
import { reassignCase, escalateCase, requestApproval, resolveCase, executeCaseAction, updateRequesterProfile, savePlaybook } from "../api.js";
import { showToast } from "../utils/formatters.js";

export function initModals(state) {
    const overlay = document.getElementById("casedetailModalsContainer");
    if (!overlay) return;

    state.on("openModal", ({ modal, data }) => {
        openModal(overlay, modal, state, data);
    });
}

function closeModal(overlay) {
    overlay.innerHTML = "";
    overlay.className = "modal-overlay";
}

function openModal(overlay, modalName, state, data = {}) {
    const c = state.caseData?.case || {};
    const emp = state.caseData?.employee || {};
    const pb = state.caseData?.playbook || {};
    const proofCfg = pb.proof_config || {};

    overlay.className = "modal-overlay open";

    if (modalName === "reassign") {
        overlay.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-header">
                    <h3>Reassign Case ${escapeHtml(c.case_number || state.caseRef)}</h3>
                    <button class="btn-action-pill" id="btnCloseModal">✕</button>
                </div>
                <div class="modal-body">
                    <div>
                        <label class="profile-field-label">Specialist Assignee Name</label>
                        <input type="text" class="form-input-field" id="modalInputAssignee" placeholder="e.g. Vaibhav (Tech Ops)" value="${escapeHtml(c.assigned_user || '')}">
                    </div>
                    <div>
                        <label class="profile-field-label">Target Department / Operations Team</label>
                        <input type="text" class="form-input-field" id="modalInputTeam" placeholder="e.g. Attendance HR / IT Support" value="${escapeHtml(c.assigned_team || '')}">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-action-pill" id="btnCancelModal">Cancel</button>
                    <button class="btn-action-pill primary" id="btnSubmitReassign">Reassign Case</button>
                </div>
            </div>
        `;

        overlay.querySelector("#btnSubmitReassign").addEventListener("click", async () => {
            const user = overlay.querySelector("#modalInputAssignee").value.trim();
            const team = overlay.querySelector("#modalInputTeam").value.trim();
            try {
                await reassignCase(state.caseRef, user, team);
                showToast(`Reassigned to ${user}`, "success");
                closeModal(overlay);
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    else if (modalName === "escalate") {
        overlay.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-header">
                    <h3 style="color:#b91c1c;">⚠️ Escalate to Team Lead</h3>
                    <button class="btn-action-pill" id="btnCloseModal">✕</button>
                </div>
                <div class="modal-body">
                    <p style="font-size:0.80rem; color:var(--c-text-muted); margin:0;">
                        Escalating this case immediately elevates priority to <strong>CRITICAL</strong>, flags it for leadership review, and records a high-priority incident notice.
                    </p>
                    <div>
                        <label class="profile-field-label">Escalation Justification / Reason</label>
                        <textarea class="form-input-field" id="modalInputEscalateReason" rows="3" placeholder="Provide clear reason for supervisory intervention..."></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-action-pill" id="btnCancelModal">Cancel</button>
                    <button class="btn-action-pill" style="background:#dc2626; color:#ffffff; border-color:#b91c1c;" id="btnSubmitEscalate">
                        Confirm Escalation
                    </button>
                </div>
            </div>
        `;

        overlay.querySelector("#btnSubmitEscalate").addEventListener("click", async () => {
            const reason = overlay.querySelector("#modalInputEscalateReason").value.trim();
            if (!reason) {
                showToast("Please provide an escalation reason", "error");
                return;
            }
            try {
                await escalateCase(state.caseRef, reason);
                showToast("Case escalated to leadership", "success");
                closeModal(overlay);
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    else if (modalName === "resolve") {
        const curProof = state.forensicProof || {};
        const refLabel = proofCfg.refLabel || "Reference / UTR / Docket ID";
        const metricLabel = proofCfg.metricLabel || "Adjustment Amount / Metric";

        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width:650px;">
                <div class="modal-header">
                    <h3 style="color:#059669;">✓ Official Case Resolution &amp; Closure</h3>
                    <button class="btn-action-pill" id="btnCloseModal">✕</button>
                </div>
                <div class="modal-body">
                    <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; padding:10px 12px; font-size:0.78rem; color:#065f46;">
                        Resolving this case closes the operational workflow and commits the transaction proof into the immutable audit ledger.
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label class="profile-field-label">Resolution Verdict / Outcome</label>
                            <select class="form-input-field" id="modalResolveVerdict">
                                <option value="VERIFIED_RESOLVED" ${curProof.verdict === 'VERIFIED_RESOLVED' ? 'selected' : ''}>Verified &amp; Resolved (Approved)</option>
                                <option value="PARTIALLY_RESOLVED" ${curProof.verdict === 'PARTIALLY_RESOLVED' ? 'selected' : ''}>Partially Approved</option>
                                <option value="REQUEST_DECLINED" ${curProof.verdict === 'REQUEST_DECLINED' ? 'selected' : ''}>Declined / Rejected</option>
                                <option value="QUERY_EXPLAINED" ${curProof.verdict === 'QUERY_EXPLAINED' ? 'selected' : ''}>Information Provided / Explained</option>
                            </select>
                        </div>
                        <div>
                            <label class="profile-field-label">${escapeHtml(refLabel)}</label>
                            <input type="text" class="form-input-field" id="modalResolveProofId" placeholder="e.g. DBX-REG-202610-1MG0023" value="${escapeHtml(curProof.proofId || `REG-${c.case_number || state.caseRef}`)}">
                        </div>
                    </div>

                    <div>
                        <label class="profile-field-label">${escapeHtml(metricLabel)}</label>
                        <input type="text" class="form-input-field" id="modalResolveMetric" placeholder="e.g. 1.0 Day Regularized / ₹ 5,000 / Access Granted" value="${escapeHtml(curProof.metric || '')}">
                    </div>

                    <div>
                        <label class="profile-field-label">Official Resolution Notes (Included in Email to Requester)</label>
                        <textarea class="form-input-field" id="modalResolveNotes" rows="3" placeholder="Explain the investigation findings and actions taken...">${escapeHtml(curProof.notes || 'All verification checks have been completed and approved per company guidelines.')}</textarea>
                    </div>

                    <div style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" id="modalResolveNotify" checked style="width:16px; height:16px; cursor:pointer;">
                        <label for="modalResolveNotify" style="font-size:0.78rem; font-weight:700; color:#334155; cursor:pointer;">
                            Dispatch official resolution email notification to requester
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-action-pill" id="btnCancelModal">Cancel</button>
                    <button class="btn-action-pill success" id="btnSubmitResolution">
                        <span>✓ Confirm Resolution</span>
                    </button>
                </div>
            </div>
        `;

        overlay.querySelector("#btnSubmitResolution").addEventListener("click", async () => {
            const verdict = overlay.querySelector("#modalResolveVerdict").value;
            const proofId = overlay.querySelector("#modalResolveProofId").value.trim();
            const metric = overlay.querySelector("#modalResolveMetric").value.trim();
            const notes = overlay.querySelector("#modalResolveNotes").value.trim();
            const notify = overlay.querySelector("#modalResolveNotify").checked;

            try {
                await resolveCase(state.caseRef, verdict, notes, { proofId: proofId || `REG-${state.caseRef}`, metric, notes, verdict }, notify);
                showToast("Case successfully resolved & closed!", "success");
                closeModal(overlay);
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    else if (modalName === "addStage") {
        overlay.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-header">
                    <h3>+ Add Custom Workflow Stage</h3>
                    <button class="btn-action-pill" id="btnCloseModal">✕</button>
                </div>
                <div class="modal-body">
                    <div>
                        <label class="profile-field-label">Stage Title / Label</label>
                        <input type="text" class="form-input-field" id="modalStageTitle" placeholder="e.g. Medical Board Review / IT Security Sign-Off">
                    </div>
                    <div>
                        <label class="profile-field-label">Description / Objective</label>
                        <input type="text" class="form-input-field" id="modalStageDesc" placeholder="e.g. Specialized clinical verification gate">
                    </div>
                    <div>
                        <label class="profile-field-label">Stage Type</label>
                        <select class="form-input-field" id="modalStageType">
                            <option value="AUDIT">Audit &amp; Verification</option>
                            <option value="APPROVAL">Managerial Approval Gate</option>
                            <option value="INTEGRATION">External System Sync</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-action-pill" id="btnCancelModal">Cancel</button>
                    <button class="btn-action-pill primary" id="btnSubmitAddStage">Add Stage</button>
                </div>
            </div>
        `;

        overlay.querySelector("#btnSubmitAddStage").addEventListener("click", async () => {
            const title = overlay.querySelector("#modalStageTitle").value.trim();
            const desc = overlay.querySelector("#modalStageDesc").value.trim();
            const type = overlay.querySelector("#modalStageType").value;

            if (!title) {
                showToast("Stage title is required", "error");
                return;
            }

            try {
                await executeCaseAction(state.caseRef, {
                    action_type: "ADD_STAGE",
                    label: title,
                    description: desc,
                    stage_type: type,
                });
                showToast("Custom stage added to pipeline", "success");
                closeModal(overlay);
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    else if (modalName === "employeeProfile") {
        overlay.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-header">
                    <h3>Requester Directory Profile</h3>
                    <button class="btn-action-pill" id="btnCloseModal">✕</button>
                </div>
                <div class="modal-body">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label class="profile-field-label">Full Name</label>
                            <input type="text" class="form-input-field" id="modalEmpName" value="${escapeHtml(emp.name || c.employee_name || '')}">
                        </div>
                        <div>
                            <label class="profile-field-label">Employee / Requester ID</label>
                            <input type="text" class="form-input-field" id="modalEmpCode" value="${escapeHtml(emp.employee_id || c.employee_id || '')}">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label class="profile-field-label">Email</label>
                            <input type="text" class="form-input-field" id="modalEmpEmail" value="${escapeHtml(emp.email || c.employee_email || '')}">
                        </div>
                        <div>
                            <label class="profile-field-label">Department</label>
                            <input type="text" class="form-input-field" id="modalEmpDept" value="${escapeHtml(emp.department || c.employee_department || '')}">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label class="profile-field-label">Designation</label>
                            <input type="text" class="form-input-field" id="modalEmpDesig" value="${escapeHtml(emp.designation || '')}">
                        </div>
                        <div>
                            <label class="profile-field-label">Reporting Manager</label>
                            <input type="text" class="form-input-field" id="modalEmpMgr" value="${escapeHtml(emp.manager_name || '')}">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-action-pill" id="btnCancelModal">Cancel</button>
                    <button class="btn-action-pill primary" id="btnSubmitEmpProfile">Save Profile</button>
                </div>
            </div>
        `;

        overlay.querySelector("#btnSubmitEmpProfile").addEventListener("click", async () => {
            const payload = {
                name: overlay.querySelector("#modalEmpName").value.trim(),
                employee_id: overlay.querySelector("#modalEmpCode").value.trim(),
                email: overlay.querySelector("#modalEmpEmail").value.trim(),
                department: overlay.querySelector("#modalEmpDept").value.trim(),
                designation: overlay.querySelector("#modalEmpDesig").value.trim(),
                manager_name: overlay.querySelector("#modalEmpMgr").value.trim(),
            };
            try {
                await updateRequesterProfile(state.caseRef, payload);
                showToast("Requester profile updated and linked", "success");
                closeModal(overlay);
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    else if (modalName === "playbookStudio") {
        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width:750px;">
                <div class="modal-header">
                    <h3>⚙️ Playbook Studio: ${escapeHtml(pb.display_name || c.category)}</h3>
                    <button class="btn-action-pill" id="btnCloseModal">✕</button>
                </div>
                <div class="modal-body">
                    <div style="font-size:0.78rem; color:var(--c-text-muted);">
                        Customize default verification tasks, SLA configurations, and forensic proof labels for category <strong>${escapeHtml(c.category)}</strong> across the company.
                    </div>
                    <div>
                        <label class="profile-field-label">Display Name</label>
                        <input type="text" class="form-input-field" id="modalPbName" value="${escapeHtml(pb.display_name || '')}">
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label class="profile-field-label">Category Icon</label>
                            <input type="text" class="form-input-field" id="modalPbIcon" value="${escapeHtml(pb.icon || '📋')}">
                        </div>
                        <div>
                            <label class="profile-field-label">Badge Color</label>
                            <input type="text" class="form-input-field" id="modalPbColor" value="${escapeHtml(pb.badge_color || '#3b82f6')}">
                        </div>
                    </div>
                    <div>
                        <label class="profile-field-label">Forensic Proof Reference Label</label>
                        <input type="text" class="form-input-field" id="modalPbProofLabel" value="${escapeHtml(proofCfg.refLabel || '')}">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-action-pill" id="btnCancelModal">Cancel</button>
                    <button class="btn-action-pill primary" id="btnSubmitPlaybook">Save Playbook</button>
                </div>
            </div>
        `;

        overlay.querySelector("#btnSubmitPlaybook").addEventListener("click", async () => {
            const updated = {
                ...pb,
                display_name: overlay.querySelector("#modalPbName").value.trim(),
                icon: overlay.querySelector("#modalPbIcon").value.trim(),
                badge_color: overlay.querySelector("#modalPbColor").value.trim(),
                proof_config: {
                    ...proofCfg,
                    refLabel: overlay.querySelector("#modalPbProofLabel").value.trim(),
                },
            };
            try {
                await savePlaybook(c.category, updated);
                showToast("Category playbook rules saved", "success");
                closeModal(overlay);
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // Common close & cancel bindings
    const btnClose = overlay.querySelector("#btnCloseModal");
    const btnCancel = overlay.querySelector("#btnCancelModal");
    if (btnClose) btnClose.addEventListener("click", () => closeModal(overlay));
    if (btnCancel) btnCancel.addEventListener("click", () => closeModal(overlay));
}

