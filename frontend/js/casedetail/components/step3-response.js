/**
 * HR Flow — Step 3: Response & Resolution Studio (frontend/js/casedetail/components/step3-response.js)
 * Omnichannel Dispatch Studio, Pre-Resolution Validation Gate,
 * One-Click Approve / Decline Decisions, and Closure Certification.
 */

import { escapeHtml, formatHuman, formatDateTimeIST, showToast } from "../utils/formatters.js";
import { setWorkflowStep, resolveCase, updateStatus, simulate24hReply, force24hAutoClose, simulateFeedback } from "../api.js";
import { renderComposer } from "./composer.js";

export function renderStep3Response(container, state) {
    const c = state.caseData?.case || {};
    const emp = state.caseData?.employee || {};
    const pb = state.caseData?.playbook || {};
    const fb = state.caseData?.feedback || (c.feedback_rating ? {
        rating: Number(c.feedback_rating),
        rating_label: c.feedback_label || {1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent"}[c.feedback_rating] || "Rating",
        comments: c.feedback_comments || "",
        tags: Array.isArray(c.feedback_tags) ? c.feedback_tags : []
    } : null);
    const rawStatus = String(c.status || "").toUpperCase();
    const isResolvedOnly = rawStatus === "RESOLVED";
    const isClosedOnly = rawStatus === "CLOSED";
    const isResolved = isResolvedOnly || isClosedOnly;
    const resType = String(c.resolution_type || "").toUpperCase();
    const isRejected = resType.includes("REJECT") || resType.includes("DECLINE");

    const proofId = state.forensicProof?.proofId || c.forensic_proof?.proofId || `REG-${c.case_number || state.caseRef}`;
    const rawCat = (c.category || "OPERATIONS").toUpperCase();
    const humanCat = formatHuman(rawCat);

    container.innerHTML = `
        <div class="step3-layout-container">
            <!-- Left / Main Column: Omnichannel Response Studio -->
            <div class="step3-main-column">
                <div id="step3ComposerMount"></div>

                <!-- Step 3 Footer Bar -->
                <div class="step-footer-bar">
                    <button type="button" class="btn-action-pill" id="btnBackToStep2" style="height:38px; padding:0 16px; font-size:0.82rem;">
                        <span>← Back to Step 2: Audit &amp; Lifecycle</span>
                    </button>
                    <div style="font-size:0.78rem; color:var(--c-text-muted);">
                        Stage 3 of ${state.totalSteps}: <strong>Official Response &amp; Docket Resolution</strong>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${isResolved ? `
                            <span class="card-badge" style="background:${isRejected ? '#fef2f2' : 'var(--c-emerald-tint)'}; color:${isRejected ? '#dc2626' : 'var(--c-emerald)'}; border:1px solid ${isRejected ? '#fecaca' : 'var(--c-emerald-border)'}; font-size:0.82rem; padding:6px 12px; font-weight:700;">
                                ${isRejected ? '✕ Case Declined &amp; Closed' : '✓ Case Approved &amp; Closed'}
                            </span>
                        ` : `
                            <span class="card-badge" style="background:var(--c-emerald-tint); color:var(--c-emerald); border:1px solid var(--c-emerald-border); font-size:0.78rem; font-weight:700;">
                                Ready for Decision
                            </span>
                        `}
                    </div>
                </div>
            </div>

            <!-- Right Column: Final Decision & Resolution Gate -->
            <div class="step3-side-column">
                
                <!-- Resolution Audit Gate -->
                <div class="panel-card" style="border-top:4px solid ${isResolved ? (isRejected ? '#dc2626' : '#059669') : '#2563eb'};">
                    <div class="card-header">
                        <h2 class="card-title">
                            <span>🏁</span>
                            <span>Resolution &amp; Decision Gate</span>
                        </h2>
                        <span class="card-badge" style="background:${isResolved ? (isRejected ? '#fef2f2' : 'var(--c-emerald-tint)') : '#eff6ff'}; color:${isResolved ? (isRejected ? '#dc2626' : 'var(--c-emerald)') : '#2563eb'}; border:1px solid ${isResolved ? (isRejected ? '#fecaca' : 'var(--c-emerald-border)') : '#bfdbfe'};">
                            ${isResolved ? (isRejected ? 'Declined &amp; Closed' : 'Approved &amp; Closed') : 'Decision Pending'}
                        </span>
                    </div>

                    <div style="font-size:0.78rem; color:var(--c-text-muted); line-height:1.5;">
                        Review official inquiry findings and commit final operational resolution (Approve or Decline) to the audit trail.
                    </div>

                    <!-- Prerequisites List -->
                    <div style="display:flex; flex-direction:column; gap:6px; margin:6px 0 10px 0;">
                        <!-- 1. Inquiry & Identity -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:0.75rem;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="color:#059669; font-weight:800;">✓</span>
                                <span style="font-weight:700; color:#0f172a;">Inbound Query &amp; Requester</span>
                            </div>
                            <span class="card-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;">
                                ${escapeHtml(emp.employee_id || c.employee_id || 'Verified TLS')}
                            </span>
                        </div>

                        <!-- 2. Lifecycle Audit Milestones -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:0.75rem;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="color:#059669; font-weight:800;">✓</span>
                                <span style="font-weight:700; color:#0f172a;">Service Lifecycle Milestones</span>
                            </div>
                            <span class="card-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;">
                                Milestones Synced
                            </span>
                        </div>

                        <!-- 3. Dispatch Channel -->
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:0.75rem;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="color:#059669; font-weight:800;">✓</span>
                                <span style="font-weight:700; color:#0f172a;">Direct Mailer Channel</span>
                            </div>
                            <span class="card-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;">
                                SMTP Connected
                            </span>
                        </div>
                    </div>

                    <!-- Proof & Verdict Summary -->
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; font-size:0.74rem; display:flex; flex-direction:column; gap:4px; margin-bottom:8px;">
                        <div>Docket Proof Ref: <strong style="color:#0f172a; font-family:monospace;">${escapeHtml(proofId)}</strong></div>
                        <div>Current Verdict: <strong style="color:${isRejected ? '#dc2626' : '#059669'};">${escapeHtml(c.resolution_type || state.forensicProof?.verdict || "READY")}</strong></div>
                        <div>Assigned Specialist: <strong style="color:#0f172a;">${escapeHtml(c.assigned_user || "Vaibhav (HR)")}</strong></div>
                    </div>

                    <!-- Decision Action Buttons -->
                    ${!isResolved ? `
                        <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
                            <button type="button" class="btn-action-pill success" id="btnApproveResolution" style="height:44px; justify-content:center; font-size:0.86rem; font-weight:800; background:#059669; color:#ffffff; border-color:#047857; box-shadow:0 2px 6px rgba(5,150,105,0.22); cursor:pointer;">
                                <span>✓ Approve Request &amp; Commit Resolution</span>
                            </button>
                            <button type="button" class="btn-action-pill" id="btnRejectResolution" style="height:40px; justify-content:center; font-size:0.84rem; font-weight:800; background:#dc2626; color:#ffffff; border-color:#b91c1c; box-shadow:0 2px 6px rgba(220,38,38,0.2); cursor:pointer;">
                                <span>✕ Decline / Reject Request</span>
                            </button>
                        </div>
                    ` : `
                        <div style="padding:14px; background:${isRejected ? '#fef2f2' : '#ecfdf5'}; border:1px solid ${isRejected ? '#fecaca' : '#a7f3d0'}; border-radius:8px; text-align:center;">
                            <div style="font-size:0.95rem; font-weight:800; color:${isRejected ? '#991b1b' : '#065f46'}; margin-bottom:3px;">
                                ${isClosedOnly ? (isRejected ? '✕ Request Declined &amp; Permanently Closed' : '✓ Request Approved &amp; Permanently Closed') : (isRejected ? '✕ Request Declined · 24h Window Active' : '✓ Request Approved · 24h Window Active')}
                            </div>
                            <div style="font-size:0.73rem; color:${isRejected ? '#b91c1c' : '#047857'}; margin-bottom:10px;">
                                Outcome: <strong>${escapeHtml(c.resolution_type || 'RESOLVED')}</strong> · Handled by ${escapeHtml(c.resolved_by || 'Specialist')} at ${escapeHtml(formatDateTimeIST(c.resolved_at || c.closed_at || c.updated_at))}
                            </div>
                            <div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">
                                <button type="button" class="btn-action-pill" id="btnPrintResolutionReceipt" style="height:28px; font-size:0.72rem; background:#ffffff; border-color:#cbd5e1; color:#0f172a;">
                                    🖨️ Print Certificate
                                </button>
                                ${!isClosedOnly ? `
                                    <button type="button" class="btn-action-pill" id="btnReopenCase" style="height:28px; font-size:0.72rem; background:#ffffff; border-color:#cbd5e1; color:#475569;">
                                        ↩ Re-Open Docket
                                    </button>
                                ` : ''}
                            </div>
                        </div>

                        ${isResolvedOnly ? `
                            <!-- 24-Hour Grace Period & Auto-Closure Monitor -->
                            <div style="margin-top:12px; padding:12px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; text-align:left;">
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                                    <div style="font-size:0.8rem; font-weight:800; color:#1e40af; display:flex; align-items:center; gap:6px;">
                                        <span>⏳</span>
                                        <span>24-Hour Lifecycle Policy Active</span>
                                    </div>
                                    <span class="card-badge" style="background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; font-size:0.68rem; font-weight:700;">
                                        GRACE PERIOD
                                    </span>
                                </div>
                                <div style="font-size:0.72rem; color:#334155; line-height:1.45; margin-bottom:10px;">
                                    • <strong>Reply &le; 24h:</strong> Inbound reply auto-reopens this ticket to <em>In-Progress (Step 2 Audit)</em>.<br>
                                    • <strong>No Reply &gt; 24h:</strong> Background policy daemon automatically seals and marks case <em>Closed</em>.
                                </div>

                                <div style="font-size:0.68rem; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
                                    Simulation Test Controls:
                                </div>
                                <div style="display:flex; flex-direction:column; gap:6px;">
                                    <button type="button" class="btn-action-pill" id="btnSimulate24hReply" style="height:32px; font-size:0.73rem; background:#ffffff; border-color:#93c5fd; color:#1d4ed8; justify-content:center; font-weight:700; box-shadow:0 1px 3px rgba(37,99,235,0.1); cursor:pointer;">
                                        <span>⚡ Simulate Inbound Reply (&lt;24h Auto-Reopen)</span>
                                    </button>
                                    <button type="button" class="btn-action-pill" id="btnForce24hClose" style="height:32px; font-size:0.73rem; background:#ffffff; border-color:#cbd5e1; color:#475569; justify-content:center; font-weight:700; cursor:pointer;">
                                        <span>🔒 Simulate 24h Inactivity (Permanent Close)</span>
                                    </button>
                                </div>
                            </div>
                        ` : ''}

                        ${isClosedOnly ? `
                            <div style="margin-top:12px; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; text-align:left;">
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                                    <div style="font-size:0.8rem; font-weight:800; color:#334155; display:flex; align-items:center; gap:6px;">
                                        <span>🔒</span>
                                        <span>Docket Permanently Closed</span>
                                    </div>
                                    <span class="card-badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-size:0.68rem; font-weight:700;">
                                        SEALED
                                    </span>
                                </div>
                                <div style="font-size:0.72rem; color:#64748b; line-height:1.45;">
                                    24-hour response window has expired. Closed by <strong>${escapeHtml(c.closed_by || 'System Policy (24h Inactivity)')}</strong> at ${escapeHtml(formatDateTimeIST(c.closed_at))}. Inbound replies will no longer reopen this docket.
                                </div>
                            </div>
                        ` : ''}
                    `}
                </div>

                <!-- Employee CSAT & Service Feedback Card -->
                <div class="panel-card" style="border-top:4px solid ${fb && fb.rating ? '#f59e0b' : '#cbd5e1'};">
                    <div class="card-header">
                        <h2 class="card-title">
                            <span>⭐</span>
                            <span>Employee Feedback &amp; CSAT</span>
                        </h2>
                        ${fb && fb.rating ? `
                            <span class="card-badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:800; font-size:0.78rem;">
                                ${'★'.repeat(fb.rating)}${'☆'.repeat(5 - fb.rating)} ${fb.rating}.0 / 5
                            </span>
                        ` : `
                            <span class="card-badge" style="background:#f8fafc; color:#64748b; border:1px solid #e2e8f0; font-size:0.72rem;">
                                ${isResolved ? 'Awaiting Feedback' : 'Post-Resolution'}
                            </span>
                        `}
                    </div>

                    ${fb && fb.rating ? `
                        <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:12px 14px; margin-bottom:8px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                                <div style="font-size:0.86rem; font-weight:800; color:#92400e;">
                                    ${escapeHtml(fb.rating_label || 'Rating')} (${fb.rating} Stars)
                                </div>
                                <span style="font-size:0.7rem; color:#b45309;">
                                    By ${escapeHtml(fb.submitted_by || 'Requester')} · ${escapeHtml(formatDateTimeIST(fb.created_at))}
                                </span>
                            </div>

                            ${fb.comments ? `
                                <div style="font-size:0.78rem; color:#451a03; line-height:1.45; font-style:italic; margin-bottom:8px; padding-left:8px; border-left:3px solid #f59e0b;">
                                    "${escapeHtml(fb.comments)}"
                                </div>
                            ` : ''}

                            ${Array.isArray(fb.tags) && fb.tags.length > 0 ? `
                                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:8px;">
                                    ${fb.tags.map(t => `<span style="font-size:0.68rem; font-weight:700; background:#ffffff; color:#92400e; border:1px solid #fde68a; border-radius:999px; padding:2px 8px;">✓ ${escapeHtml(t)}</span>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div style="text-align:right;">
                            <a href="/feedback.html?case=${encodeURIComponent(c.case_number || state.caseRef)}" target="_blank" style="font-size:0.72rem; color:#2563eb; text-decoration:none; font-weight:600;">
                                View Full Employee Survey Form ↗
                            </a>
                        </div>
                    ` : `
                        <div style="font-size:0.74rem; color:var(--c-text-muted); line-height:1.45; margin-bottom:10px;">
                            ${isResolved 
                                ? '1-click CSAT survey buttons were dispatched with the resolution email. You can simulate employee feedback or open the public survey form.' 
                                : 'A 1-click CSAT survey banner will be automatically included in the resolution dispatch email.'}
                        </div>

                        ${isResolved ? `
                            <div style="display:flex; flex-direction:column; gap:6px;">
                                <button type="button" class="btn-action-pill" id="btnSimulateFeedback" style="height:32px; font-size:0.73rem; background:#ffffff; border-color:#fde68a; color:#b45309; justify-content:center; font-weight:700; box-shadow:0 1px 3px rgba(245,158,11,0.12); cursor:pointer;">
                                    <span>⭐ Simulate 5-Star Employee Feedback</span>
                                </button>
                                <a href="/feedback.html?case=${encodeURIComponent(c.case_number || state.caseRef)}" target="_blank" class="btn-action-pill" style="height:30px; font-size:0.73rem; background:#ffffff; border-color:#cbd5e1; color:#475569; justify-content:center; font-weight:600; text-decoration:none; display:flex; align-items:center;">
                                    <span>🔗 Open Employee Survey Form ↗</span>
                                </a>
                            </div>
                        ` : ''}
                    `}
                </div>

                <!-- Case 360° Operations Summary Card -->
                <div class="panel-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <span>📋</span>
                            <span>Docket Summary</span>
                        </h2>
                        <span class="card-badge" style="background:#f1f5f9; color:#475569;">
                            ${escapeHtml(c.case_number || state.caseRef)}
                        </span>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:6px; font-size:0.75rem;">
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--c-text-muted);">Requester:</span>
                            <strong style="color:#0f172a;">${escapeHtml(emp.name || c.employee_name || "Requester")} (${escapeHtml(emp.employee_id || c.employee_id || "ID")})</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--c-text-muted);">Department:</span>
                            <strong>${escapeHtml(emp.department || c.employee_department || humanCat)}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--c-text-muted);">Assigned Team:</span>
                            <strong>${escapeHtml(c.assigned_team || "PeopleDesk")}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--c-text-muted);">Total SLA Window:</span>
                            <strong>${escapeHtml(String(c.sla_hours || 48))} Hours</strong>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    `;

    // Mount Composer
    const compMount = container.querySelector("#step3ComposerMount");
    if (compMount) {
        renderComposer(compMount, state);
    }

    // Navigation back to Step 2
    const btnBack = container.querySelector("#btnBackToStep2");
    if (btnBack) {
        btnBack.addEventListener("click", async () => {
            try {
                await setWorkflowStep(state.caseRef, 2);
                state.setStep(2);
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // Print Resolution Certificate
    const btnPrint = container.querySelector("#btnPrintResolutionReceipt");
    if (btnPrint) {
        btnPrint.addEventListener("click", () => {
            window.print();
        });
    }

    // Re-open Docket
    const btnReopen = container.querySelector("#btnReopenCase");
    if (btnReopen) {
        btnReopen.addEventListener("click", async () => {
            try {
                btnReopen.disabled = true;
                btnReopen.textContent = "Re-opening...";
                await updateStatus(state.caseRef, "IN_PROGRESS", "MEDIUM");
                await setWorkflowStep(state.caseRef, 2);
                showToast(`Case #${c.case_number || state.caseRef} re-opened to In-Progress.`, "info");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
                btnReopen.disabled = false;
                btnReopen.textContent = "↩ Re-Open Docket";
            }
        });
    }

    // Helper: read composer draft
    function getDraftReplyText(defaultText) {
        const ta = container.querySelector("#textareaCaseReply");
        const val = (ta?.value || state.activeDraft || "").trim();
        return val || defaultText;
    }

    // 1. Approve Request Button
    const btnApprove = container.querySelector("#btnApproveResolution");
    if (btnApprove) {
        btnApprove.addEventListener("click", async () => {
            const replyText = getDraftReplyText(
                state.caseData?.smart_templates?.APPROVE ||
                "Specialist verified turnstile access logs. Shift attendance regularized and approved."
            );
            const proofCode = proofId || `APPR-${c.case_number || state.caseRef}`;

            try {
                btnApprove.disabled = true;
                btnApprove.textContent = "Committing Approval...";
                await resolveCase(state.caseRef, {
                    resolution_type: "APPROVED",
                    resolution_notes: replyText,
                    reference_id: proofCode,
                    forensic_proof: {
                        proofId: proofCode,
                        verdict: "APPROVED",
                        notes: replyText,
                        metric: "1.0 Day Regularized",
                    },
                    notify_employee: true,
                });
                await setWorkflowStep(state.caseRef, 3);
                showToast(`✓ Case #${c.case_number || state.caseRef} approved and resolved successfully!`, "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
                btnApprove.disabled = false;
                btnApprove.innerHTML = `<span>✓ Approve Request &amp; Commit Resolution</span>`;
            }
        });
    }

    // 2. Reject Request Button
    const btnReject = container.querySelector("#btnRejectResolution");
    if (btnReject) {
        btnReject.addEventListener("click", async () => {
            const replyText = getDraftReplyText(
                state.caseData?.smart_templates?.REJECT ||
                "We have investigated your request. Unfortunately, turnstile entries cannot be verified and this request is declined."
            );
            const proofCode = proofId || `REJ-${c.case_number || state.caseRef}`;

            try {
                btnReject.disabled = true;
                btnReject.textContent = "Committing Rejection...";
                await resolveCase(state.caseRef, {
                    resolution_type: "REJECTED",
                    resolution_notes: replyText,
                    reference_id: proofCode,
                    forensic_proof: {
                        proofId: proofCode,
                        verdict: "REJECTED",
                        notes: replyText,
                        metric: "0 Regularized",
                    },
                    notify_employee: true,
                });
                await setWorkflowStep(state.caseRef, 3);
                showToast(`Case #${c.case_number || state.caseRef} declined and closed.`, "info");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
                btnReject.disabled = false;
                btnReject.innerHTML = `<span>✕ Decline / Reject Request</span>`;
            }
        });
    }

    // 3. Simulate Inbound Reply (<24h Auto-Reopen)
    const btnSimReply = container.querySelector("#btnSimulate24hReply");
    if (btnSimReply) {
        btnSimReply.addEventListener("click", async () => {
            try {
                btnSimReply.disabled = true;
                btnSimReply.textContent = "Simulating Inbound Reply...";
                await simulate24hReply(
                    state.caseRef,
                    "Hi HR Operations, I received the resolution notice. I checked my attendance dashboard and have a quick clarification regarding the biometric punch time."
                );
                showToast(`✓ Inbound reply received! Case #${c.case_number || state.caseRef} auto-reopened to In-Progress.`, "success");
                await setWorkflowStep(state.caseRef, 2);
                state.emit("refresh");
                state.setStep(2);
            } catch (err) {
                showToast(err.message, "error");
                btnSimReply.disabled = false;
                btnSimReply.innerHTML = `<span>⚡ Simulate Inbound Reply (&lt;24h Auto-Reopen)</span>`;
            }
        });
    }

    // 4. Force 24h Auto-Close (Inactivity Expiration)
    const btnForceClose = container.querySelector("#btnForce24hClose");
    if (btnForceClose) {
        btnForceClose.addEventListener("click", async () => {
            try {
                btnForceClose.disabled = true;
                btnForceClose.textContent = "Fast-forwarding 24 Hours...";
                await force24hAutoClose(state.caseRef);
                showToast(`🔒 24 hours elapsed without reply. Case #${c.case_number || state.caseRef} permanently closed!`, "info");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
                btnForceClose.disabled = false;
                btnForceClose.innerHTML = `<span>🔒 Simulate 24h Inactivity (Permanent Close)</span>`;
            }
        });
    }

    // 5. Simulate 5-Star Employee Feedback
    const btnSimFb = container.querySelector("#btnSimulateFeedback");
    if (btnSimFb) {
        btnSimFb.addEventListener("click", async () => {
            try {
                btnSimFb.disabled = true;
                btnSimFb.textContent = "Recording 5-Star Feedback...";
                await simulateFeedback(state.caseRef, 5);
                showToast(`⭐ 5-Star CSAT feedback recorded for Case #${c.case_number || state.caseRef}!`, "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
                btnSimFb.disabled = false;
                btnSimFb.innerHTML = `<span>⭐ Simulate 5-Star Employee Feedback</span>`;
            }
        });
    }
}
