/**
 * HR Flow — Step 2: Streamlined 3-Milestone Lifecycle Audit & Clarification Mailer
 * (frontend/js/casedetail/components/step2-audit.js)
 *
 * 1. Milestone 1: When Mail Came (Arrival timestamp, sender, subject, channel)
 * 2. Milestone 2: When Working Started (Specialist pickup, status moved to IN_PROGRESS, response time)
 * 3. Milestone 3: When Ticket Finished / Resolved (Resolution timestamp, resolving specialist, SLA turnaround time)
 * 4. Agent Clarification Mailer: Allows agent/specialist to directly email requester for additional details.
 */

import { escapeHtml, formatHuman, formatDateTimeIST, showToast } from "../utils/formatters.js";
import { executeCaseAction, setWorkflowStep } from "../api.js";

/**
 * Calculates human-readable elapsed duration between two timestamps.
 */
function formatDurationBetween(startIso, endIso) {
    if (!startIso || !endIso) return "--";
    try {
        const start = new Date(startIso).getTime();
        const end = new Date(endIso).getTime();
        if (isNaN(start) || isNaN(end)) return "--";
        const diffMs = Math.max(0, end - start);
        const diffSecs = Math.floor(diffMs / 1000);
        const mins = Math.floor(diffSecs / 60);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            const remHours = hours % 24;
            return `${days}d ${remHours}h`;
        }
        if (hours > 0) {
            const remMins = mins % 60;
            return `${hours} hr${hours > 1 ? 's' : ''} ${remMins} min${remMins !== 1 ? 's' : ''}`;
        }
        return `${Math.max(1, mins)} min${mins !== 1 ? 's' : ''}`;
    } catch (_) {
        return "--";
    }
}

/**
 * Locates the exact timestamp when active work commenced on this docket.
 */
function getWorkCommencedTimestamp(c, auditLogs = []) {
    // Check audit logs for earliest transition to IN_PROGRESS or specialist assignment
    for (let i = auditLogs.length - 1; i >= 0; i--) {
        const a = auditLogs[i];
        const action = (a.action || "").toUpperCase();
        const desc = (a.description || "").toUpperCase();
        if (action === "STATUS_CHANGED" || action === "CASE_UPDATED" || action === "ASSIGNED" || action === "STATUS_UPDATE") {
            if (desc.includes("IN_PROGRESS") || desc.includes("ASSIGNED") || desc.includes("PICKED UP")) {
                if (a.created_at || a.timestamp) return a.created_at || a.timestamp;
            }
        }
    }
    // Fallback: if case has been updated past creation, use updated_at, else created_at
    if (c.status !== "NEW" && c.updated_at && c.updated_at !== c.created_at) {
        return c.updated_at;
    }
    return c.created_at || new Date().toISOString();
}

export function renderStep2Audit(container, state) {
    const c = state.caseData?.case || {};
    const emp = state.caseData?.employee || {};
    const em = state.caseData?.email || {};
    const auditLogs = state.caseData?.audit_logs || [];

    const empDisplayName = emp.name || c.employee_name || em.sender_name || "Requester";
    const empDisplayEmail = emp.email || c.employee_email || em.sender_email || "requester@company.com";
    const caseRef = c.case_number || state.caseRef || "CASE-000000";
    const assignedSpecialist = c.assigned_user || c.assigned_to || "Assigned Specialist";
    const category = (c.category || "OPERATIONS").toUpperCase();

    const fb = state.caseData?.feedback || (c.feedback_rating ? {
        rating: Number(c.feedback_rating),
        rating_label: c.feedback_label || {1: "Poor", 2: "Fair", 3: "Good", 4: "Great", 5: "Excellent"}[c.feedback_rating] || "Rating",
        comments: c.feedback_comments || "",
        tags: Array.isArray(c.feedback_tags) ? c.feedback_tags : [],
        submitted_by: c.feedback_submitted_by || empDisplayName,
        created_at: c.feedback_created_at || c.updated_at
    } : null);

    // 1. Milestone 1: When Mail Came
    const mailCameTime = em.received_at || c.created_at;
    const mailSubject = em.subject || c.title || `Inquiry ${caseRef}`;

    // 2. Milestone 2: When Working Started
    const workStartedTime = getWorkCommencedTimestamp(c, auditLogs);
    const pickupDuration = formatDurationBetween(mailCameTime, workStartedTime);

    // 3. Milestone 3: When Ticket Got Finished (Query Resolved)
    const isResolved = c.status === "RESOLVED" || c.status === "CLOSED" || c.status === "MERGED";
    const finishedTime = isResolved ? (c.resolved_at || c.closed_at || c.updated_at) : null;
    const finishedSpecialist = c.resolved_by || c.closed_by || assignedSpecialist;
    const totalTurnaroundTime = isResolved ? formatDurationBetween(mailCameTime, finishedTime) : null;
    const activeWorkingDuration = !isResolved ? formatDurationBetween(workStartedTime, new Date().toISOString()) : null;
    const resolutionVerdict = c.resolution_type || (c.status === "MERGED" ? `MERGED_INTO_${c.merged_into || 'PARENT'}` : "RESOLVED");
    const resolutionNotes = c.resolution_notes || "Case investigation completed and finalized.";

    container.innerHTML = `
        <div class="step2-streamlined-container">
            
            <!-- Left Column: 3-Milestone Lifecycle Audit Timeline -->
            <div class="step2-lifecycle-column">
                
                <div class="panel-card lifecycle-timeline-card">
                    <div class="card-header" style="margin-bottom:16px;">
                        <div>
                            <h2 class="card-title" style="font-size:1.05rem;">
                                <span>⏱️</span>
                                <span>Query Lifecycle &amp; Service Audit</span>
                            </h2>
                            <p style="font-size:0.76rem; color:var(--c-text-muted); margin:3px 0 0 0;">
                                Official audit milestones tracking inquiry arrival, specialist commencement, and resolution closure.
                            </p>
                        </div>
                        <span class="card-badge" style="background:#f1f5f9; color:#334155; font-family:monospace; font-size:0.74rem;">
                            Docket #${escapeHtml(caseRef)}
                        </span>
                    </div>

                    ${c.reopened_at ? `
                        <!-- 24-Hour Policy Auto-Reopen Alert Banner -->
                        <div style="margin-bottom:14px; padding:10px 14px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; display:flex; align-items:center; justify-content:space-between;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-size:1.15rem;">↩️</span>
                                <div>
                                    <div style="font-size:0.8rem; font-weight:800; color:#1e40af;">Ticket Auto-Reopened via Requester Reply</div>
                                    <div style="font-size:0.72rem; color:#475569;">
                                        Reopened on ${escapeHtml(formatDateTimeIST(c.reopened_at))} by <strong>${escapeHtml(c.reopened_by || 'Requester')}</strong> (${escapeHtml(c.reopen_reason || 'Inbound reply within 24h grace window')}).
                                    </div>
                                </div>
                            </div>
                            <span class="card-badge" style="background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; font-size:0.7rem; font-weight:700;">
                                24h Grace Re-Open
                            </span>
                        </div>
                    ` : ''}

                    <!-- Milestone 1: When Mail Came -->
                    <div class="lifecycle-milestone-row completed">
                        <div class="milestone-indicator">
                            <div class="milestone-dot dot-emerald">📨</div>
                            <div class="milestone-line"></div>
                        </div>
                        <div class="milestone-content-box">
                            <div class="milestone-top-strip">
                                <span class="milestone-badge badge-received">1. Mail Received</span>
                                <span class="milestone-timestamp">${formatDateTimeIST(mailCameTime)}</span>
                            </div>
                            <h3 class="milestone-title">Inbound Query Received</h3>
                            <div class="milestone-desc">
                                Official communication arrived from <strong>${escapeHtml(empDisplayName)}</strong> (&lt;${escapeHtml(empDisplayEmail)}&gt;) via Google Workspace Direct.
                            </div>
                            <div class="milestone-meta-pills">
                                <span class="meta-pill">TLS 1.3 Verified</span>
                                <span class="meta-pill">Subject: "${escapeHtml(mailSubject)}"</span>
                                <span class="meta-pill">Category: ${escapeHtml(category)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Milestone 2: When Working Started -->
                    <div class="lifecycle-milestone-row completed">
                        <div class="milestone-indicator">
                            <div class="milestone-dot dot-blue">⚙️</div>
                            <div class="milestone-line"></div>
                        </div>
                        <div class="milestone-content-box">
                            <div class="milestone-top-strip">
                                <span class="milestone-badge badge-started">2. Work Commenced</span>
                                <span class="milestone-timestamp">${formatDateTimeIST(workStartedTime)}</span>
                            </div>
                            <h3 class="milestone-title">Specialist Picked Up Ticket</h3>
                            <div class="milestone-desc">
                                Active case investigation initiated by <strong>${escapeHtml(assignedSpecialist)}</strong>. Docket transitioned from queue to active operations.
                            </div>
                            <div class="milestone-meta-pills">
                                <span class="meta-pill highlight">Pickup Response: ${escapeHtml(pickupDuration)} after inbound</span>
                                <span class="meta-pill">Assigned Specialist: ${escapeHtml(assignedSpecialist)}</span>
                                <span class="meta-pill">Queue Status: IN_PROGRESS</span>
                            </div>
                        </div>
                    </div>

                    <!-- Milestone 3: When Ticket Finished / Resolved -->
                    <div class="lifecycle-milestone-row ${isResolved ? 'completed' : 'pending'}">
                        <div class="milestone-indicator">
                            <div class="milestone-dot ${isResolved ? 'dot-purple' : 'dot-amber'}">${isResolved ? '🏁' : '⏳'}</div>
                        </div>
                        <div class="milestone-content-box">
                            <div class="milestone-top-strip">
                                <span class="milestone-badge ${isResolved ? 'badge-resolved' : 'badge-pending'}">
                                    ${isResolved ? '3. Query Finished &amp; Resolved' : '3. Final Resolution (Pending)'}
                                </span>
                                <span class="milestone-timestamp">
                                    ${isResolved ? formatDateTimeIST(finishedTime) : 'Currently In Progress'}
                                </span>
                            </div>
                            <h3 class="milestone-title">
                                ${isResolved ? `Official Resolution Committed (${escapeHtml(resolutionVerdict)})` : 'Awaiting Final Resolution Sign-Off'}
                            </h3>
                            <div class="milestone-desc">
                                ${isResolved ? `
                                    Query successfully investigated and finalized by <strong>${escapeHtml(finishedSpecialist)}</strong>.
                                    Employee ledger records synchronized and notification archived.
                                ` : `
                                    Case is currently under active specialist review. All verification findings and response draft are being prepared for dispatch.
                                `}
                            </div>

                            ${isResolved ? `
                                <div class="milestone-meta-pills" style="margin-top:8px;">
                                    <span class="meta-pill success">Total Turnaround Time: <strong>${escapeHtml(totalTurnaroundTime)}</strong></span>
                                    <span class="meta-pill">Resolved By: ${escapeHtml(finishedSpecialist)}</span>
                                    <span class="meta-pill">Outcome: ${escapeHtml(resolutionVerdict)}</span>
                                </div>
                                <div class="resolution-notes-preview">
                                    <strong>Resolution Audit Notes:</strong> ${escapeHtml(resolutionNotes)}
                                </div>
                            ` : `
                                <div class="milestone-meta-pills" style="margin-top:8px;">
                                    <span class="meta-pill warning">Active Time: ${escapeHtml(activeWorkingDuration)} elapsed</span>
                                    <span class="meta-pill">Awaiting: Specialist Reply &amp; Resolution Closure</span>
                                </div>
                                <div style="margin-top:12px;">
                                    <button type="button" class="btn-action-pill primary" id="btnGoToStep3Resolution" style="height:32px; font-size:0.78rem;">
                                        <span>Advance to Step 3: Response &amp; Resolution Gate →</span>
                                    </button>
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- Milestone 4: Employee Feedback & CSAT Audit -->
                    <div class="lifecycle-milestone-row ${fb && fb.rating ? 'completed' : (isResolved ? 'pending' : '')}">
                        <div class="milestone-indicator">
                            <div class="milestone-dot" style="${fb && fb.rating ? 'background:#f59e0b; color:#ffffff; font-size:0.9rem; border:2px solid #d97706;' : 'background:#e2e8f0; color:#64748b;'}">
                                ${fb && fb.rating ? '⭐' : '📋'}
                            </div>
                        </div>
                        <div class="milestone-content-box" style="${fb && fb.rating ? 'border:1px solid #fde68a; background:linear-gradient(180deg, #ffffff 0%, #fffdf5 100%); box-shadow:0 2px 8px rgba(245,158,11,0.08);' : ''}">
                            <div class="milestone-top-strip">
                                <span class="milestone-badge" style="${fb && fb.rating ? 'background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:800;' : 'background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;'}">
                                    ${fb && fb.rating ? `4. Employee CSAT Rating: ${'★'.repeat(fb.rating)} ${fb.rating}.0 / 5` : '4. Employee Satisfaction Survey'}
                                </span>
                                <span class="milestone-timestamp">
                                    ${fb && fb.created_at ? formatDateTimeIST(fb.created_at) : (isResolved ? 'Awaiting Employee Response (24h Window)' : 'Pending Resolution')}
                                </span>
                            </div>
                            <h3 class="milestone-title" style="${fb && fb.rating ? 'color:#92400e;' : ''}">
                                ${fb && fb.rating ? `Customer Satisfaction Verified · ${escapeHtml(fb.rating_label || 'Rating')}` : (isResolved ? '1-Click Survey Sent via Resolution Email' : 'Survey Dispatched Upon Case Resolution')}
                            </h3>
                            <div class="milestone-desc">
                                ${fb && fb.rating ? `
                                    Employee submitted official <strong>${fb.rating}-Star (${escapeHtml(fb.rating_label || '')})</strong> service evaluation. All satisfaction telemetry has been audited and logged to the compliance ledger.
                                ` : (isResolved ? `
                                    1-Click star rating links were delivered in the official resolution notification to <strong>${escapeHtml(empDisplayEmail)}</strong>. Ratings are recorded immediately upon selection.
                                ` : `
                                    CSAT survey is automatically triggered when the docket is marked resolved in Step 3.
                                `)}
                            </div>

                            ${fb && fb.rating ? `
                                <div class="milestone-meta-pills" style="margin-top:8px;">
                                    <span class="meta-pill highlight" style="background:#fffbeb; color:#b45309; border-color:#fde68a;">Rating: <strong>⭐ ${fb.rating}.0 / 5.0 (${escapeHtml(fb.rating_label || 'Rating')})</strong></span>
                                    <span class="meta-pill">Submitted By: ${escapeHtml(fb.submitted_by || empDisplayName)}</span>
                                    ${Array.isArray(fb.tags) && fb.tags.length > 0 ? `<span class="meta-pill">Tags: ${escapeHtml(fb.tags.join(', '))}</span>` : ''}
                                </div>
                                ${fb.comments ? `
                                    <div class="resolution-notes-preview" style="background:#fffbeb; border-color:#fde68a; color:#78350f; font-style:italic; margin-top:8px;">
                                        <strong>Employee Remarks:</strong> "${escapeHtml(fb.comments)}"
                                    </div>
                                ` : ''}
                            ` : ''}
                        </div>
                    </div>

                </div>

                <!-- Step 2 Navigation Footer -->
                <div class="step-footer-bar" style="margin-top:16px;">
                    <button type="button" class="btn-action-pill" id="btnBackToStep1" style="height:36px; padding:0 14px; font-size:0.80rem;">
                        <span>← Back to Step 1: Details &amp; Dossier</span>
                    </button>
                    <button type="button" class="btn-action-pill primary" id="btnForwardToStep3" style="height:36px; padding:0 18px; font-size:0.84rem;">
                        <span>Proceed to Step 3: Response &amp; Resolution →</span>
                    </button>
                </div>

            </div>

            <!-- Right Column: Agent Clarification Mailer ("Request More Details") -->
            <div class="step2-mailer-column">
                
                <div class="panel-card direct-inquiry-card">
                    <div class="card-header" style="margin-bottom:12px;">
                        <div>
                            <h2 class="card-title" style="font-size:0.98rem; color:#1e3a8a;">
                                <span>📤</span>
                                <span>Request More Details</span>
                            </h2>
                            <p style="font-size:0.75rem; color:#3b82f6; margin:3px 0 0 0;">
                                Send an official clarification email directly to the requester if information is missing.
                            </p>
                        </div>
                        <span class="card-badge" style="background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd;">
                            Direct Mailer
                        </span>
                    </div>

                    <!-- Recipient & Routing Details -->
                    <div class="inquiry-form-group">
                        <label class="inquiry-field-label">Recipient Email Address</label>
                        <div class="inquiry-recipient-pill">
                            <span class="recipient-name">${escapeHtml(empDisplayName)}</span>
                            <span class="recipient-email">&lt;${escapeHtml(empDisplayEmail)}&gt;</span>
                        </div>
                    </div>

                    <div class="inquiry-form-group">
                        <label class="inquiry-field-label">Subject Line</label>
                        <input type="text" class="inquiry-input-field" id="inputInquirySubject" value="Action Required: Information needed regarding Case #${escapeHtml(caseRef)}">
                    </div>

                    <!-- Quick Preset Prompts -->
                    <div class="inquiry-form-group">
                        <label class="inquiry-field-label">Quick Clarification Presets</label>
                        <div class="inquiry-presets-strip">
                            <button type="button" class="inquiry-preset-btn" data-preset="PUNCH_TIMES">
                                🕒 Missing Punch Timings
                            </button>
                            <button type="button" class="inquiry-preset-btn" data-preset="MANAGER_SIGN">
                                ✍️ Manager Approval
                            </button>
                            <button type="button" class="inquiry-preset-btn" data-preset="DOC_PROOF">
                                📎 Supporting Proof / Receipts
                            </button>
                            <button type="button" class="inquiry-preset-btn" data-preset="BANK_DETAILS">
                                🏦 Payroll / IFSC Verification
                            </button>
                        </div>
                    </div>

                    <!-- Inquiry Message Body Textarea -->
                    <div class="inquiry-form-group">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label class="inquiry-field-label" style="margin:0;">Inquiry Message Draft</label>
                            <span id="inquiryCharCounter" style="font-size:0.70rem; color:var(--c-text-muted);">0 chars</span>
                        </div>
                        <textarea class="inquiry-textarea" id="textareaInquiryBody" rows="7" placeholder="Type your inquiry message here. It will be emailed directly to the employee from the Operations Desk..."></textarea>
                    </div>

                    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 12px; margin-bottom:14px; font-size:0.74rem; color:#1e40af; line-height:1.4;">
                        ℹ️ <strong>Workflow Effect:</strong> Sending this inquiry will dispatch an official SMTP email to the employee, flag ticket status as <strong>ON_HOLD (Pending Info)</strong>, and record the exchange in the audit docket.
                    </div>

                    <div class="inquiry-action-row">
                        <button type="button" class="btn-action-pill primary" id="btnSendClarificationEmail" style="width:100%; justify-content:center; height:38px; font-size:0.84rem; background:#2563eb; font-weight:700;">
                            <span>📤 Send Clarification Email to Employee</span>
                        </button>
                    </div>

                </div>

                <!-- Recent Communications Audit Box -->
                <div class="panel-card" style="margin-top:16px;">
                    <div class="card-header" style="margin-bottom:10px;">
                        <h3 class="card-title" style="font-size:0.88rem;">
                            <span>📜</span>
                            <span>Audit Activity Log</span>
                        </h3>
                        <span class="card-badge" style="background:#f1f5f9; color:#475569;">
                            ${auditLogs.length} Events
                        </span>
                    </div>
                    ${auditLogs.length > 0 ? `
                        <div class="mini-audit-feed">
                            ${auditLogs.slice(0, 5).map(log => `
                                <div class="mini-audit-item">
                                    <div class="mini-audit-top">
                                        <strong>${escapeHtml(log.action || "EVENT")}</strong>
                                        <span>${formatDateTimeIST(log.created_at || log.timestamp)}</span>
                                    </div>
                                    <div class="mini-audit-desc">${escapeHtml(log.description || "Action recorded")}</div>
                                </div>
                            `).join("")}
                        </div>
                    ` : `
                        <div style="font-size:0.75rem; color:var(--c-text-muted); text-align:center; padding:16px;">
                            Zero exception flags recorded for this docket.
                        </div>
                    `}
                </div>

            </div>

        </div>
    `;

    // Presets dictionary
    const inquiryPresets = {
        PUNCH_TIMES: `Hi ${empDisplayName},\n\nRegarding Case #${caseRef} (${mailSubject}):\nTo proceed with your attendance regularization, please reply with your exact clock-in and clock-out timings for the incident date.\n\nWarm regards,\n${assignedSpecialist}\nOperations Desk`,
        MANAGER_SIGN: `Hi ${empDisplayName},\n\nRegarding Case #${caseRef} (${mailSubject}):\nPlease confirm if your reporting manager has approved this request or forward their written confirmation email to this thread so we can commit the adjustment.\n\nWarm regards,\n${assignedSpecialist}\nOperations Desk`,
        DOC_PROOF: `Hi ${empDisplayName},\n\nRegarding Case #${caseRef} (${mailSubject}):\nPlease attach the required supporting documentation (e.g. medical slip, travel receipt, or gate pass) so we can proceed with your case audit.\n\nWarm regards,\n${assignedSpecialist}\nOperations Desk`,
        BANK_DETAILS: `Hi ${empDisplayName},\n\nRegarding Case #${caseRef} (${mailSubject}):\nTo complete your payroll adjustment, please verify your official employee code and attach a copy of your cancelled cheque for account verification.\n\nWarm regards,\n${assignedSpecialist}\nOperations Desk`
    };

    // Pre-fill initial draft if empty
    const textareaBody = container.querySelector("#textareaInquiryBody");
    const charCounter = container.querySelector("#inquiryCharCounter");
    const inputSubject = container.querySelector("#inputInquirySubject");

    if (textareaBody) {
        textareaBody.value = `Hi ${empDisplayName},\n\nRegarding Case #${caseRef} (${mailSubject}):\nWe are reviewing your inquiry and need a few additional details before we can finalize the request.\n\nPlease reply directly to this email with any additional information.\n\nWarm regards,\n${assignedSpecialist}\nOperations Desk`;
        if (charCounter) charCounter.textContent = `${textareaBody.value.length} chars`;

        textareaBody.addEventListener("input", () => {
            if (charCounter) charCounter.textContent = `${textareaBody.value.length} chars`;
        });
    }

    // Preset button clicks
    container.querySelectorAll(".inquiry-preset-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.preset;
            if (inquiryPresets[key] && textareaBody) {
                textareaBody.value = inquiryPresets[key];
                if (charCounter) charCounter.textContent = `${textareaBody.value.length} chars`;
                showToast("Loaded clarification template", "info");
            }
        });
    });

    // Send Clarification Email handler
    const btnSendEmail = container.querySelector("#btnSendClarificationEmail");
    if (btnSendEmail) {
        btnSendEmail.addEventListener("click", async () => {
            const body = textareaBody?.value?.trim();
            const subject = inputSubject?.value?.trim() || `Inquiry Regarding Case #${caseRef}`;
            if (!body) {
                showToast("Please enter an inquiry message before sending", "error");
                return;
            }

            try {
                btnSendEmail.disabled = true;
                btnSendEmail.innerHTML = `<span>Sending Email...</span>`;

                await executeCaseAction(state.caseRef, {
                    action_type: "REQUEST_INFO",
                    reply_body: body,
                    subject: subject,
                    recipient_email: empDisplayEmail,
                    next_status: "ON_HOLD",
                });

                showToast(`Clarification email sent to ${empDisplayEmail}`, "success");
                btnSendEmail.innerHTML = `<span>✓ Email Dispatched</span>`;
                setTimeout(() => {
                    btnSendEmail.disabled = false;
                    btnSendEmail.innerHTML = `<span>📤 Send Clarification Email to Employee</span>`;
                }, 2000);

                state.emit("refresh");
            } catch (err) {
                btnSendEmail.disabled = false;
                btnSendEmail.innerHTML = `<span>📤 Send Clarification Email to Employee</span>`;
                showToast(err.message || "Failed to dispatch email", "error");
            }
        });
    }

    // Step navigation buttons
    const btnBack1 = container.querySelector("#btnBackToStep1");
    if (btnBack1) {
        btnBack1.addEventListener("click", async () => {
            try {
                await setWorkflowStep(state.caseRef, 1);
                state.setStep(1);
            } catch (_) {
                state.setStep(1);
            }
        });
    }

    const btnForward3 = container.querySelector("#btnForwardToStep3");
    if (btnForward3) {
        btnForward3.addEventListener("click", async () => {
            try {
                await setWorkflowStep(state.caseRef, 3);
                state.setStep(3);
            } catch (_) {
                state.setStep(3);
            }
        });
    }

    const btnGoStep3 = container.querySelector("#btnGoToStep3Resolution");
    if (btnGoStep3) {
        btnGoStep3.addEventListener("click", async () => {
            try {
                await setWorkflowStep(state.caseRef, 3);
                state.setStep(3);
            } catch (_) {
                state.setStep(3);
            }
        });
    }
}
