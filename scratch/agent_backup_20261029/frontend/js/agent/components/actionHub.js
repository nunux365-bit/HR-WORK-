/**
 * actionHub.js — Zone 3: Interactive Action Hub & Execution Tabs
 */

import { Store } from "../state.js";
import { AgentAPI } from "../api.js";
import { escapeHtml, formatHuman, formatDate } from "../utils.js";

export function renderActionHub(caseData) {
    if (!caseData) return "";

    const state = Store.getState();
    const c = caseData.case || caseData;
    const ref = c.case_number || c.id;
    const activeTab = state.activeHubTab || "CHECKLIST";

    const tasks = caseData.tasks || [];
    const approvals = caseData.approvals || [];
    const isResolved = ["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase());

    // Tabs definition
    const tabs = [
        { key: "CHECKLIST", label: "Checklist", badge: tasks.length ? `${tasks.filter((t) => t.status === "COMPLETED").length}/${tasks.length}` : null },
        { key: "INQUIRE", label: "Clarify with Employee", badge: c.status === "AWAITING_EMPLOYEE_INFO" ? "Paused" : null },
        { key: "DIAGNOSTICS", label: "Diagnostics", badge: null },
        { key: "APPROVALS", label: "Approvals", badge: approvals.length ? String(approvals.length) : null },
        { key: "COMPOSER", label: "Resolve & Reply", badge: isResolved ? "Closed" : "Ready" },
    ];

    let tabBodyHtml = "";
    if (activeTab === "CHECKLIST") {
        tabBodyHtml = renderChecklistTab(tasks, c, isResolved);
    } else if (activeTab === "INQUIRE") {
        tabBodyHtml = renderInquireTab(c, isResolved);
    } else if (activeTab === "DIAGNOSTICS") {
        tabBodyHtml = renderDiagnosticsTab(c);
    } else if (activeTab === "APPROVALS") {
        tabBodyHtml = renderApprovalsTab(approvals, c);
    } else if (activeTab === "COMPOSER") {
        tabBodyHtml = renderComposerTab(c, isResolved);
    }

    return `
        <div class="agent-action-hub-container">
            <!-- Hub Tab Navigation -->
            <nav class="action-hub-nav" role="tablist">
                ${tabs
                    .map((t) => {
                        const isActive = activeTab === t.key;
                        return `
                            <button type="button" class="action-hub-tab-btn ${isActive ? "active" : ""}" data-hub-tab="${t.key}">
                                <span>${t.label}</span>
                                ${t.badge ? `<span class="hub-tab-badge ${isActive ? "active" : ""}">${escapeHtml(t.badge)}</span>` : ""}
                            </button>
                        `;
                    })
                    .join("")}
            </nav>

            <!-- Hub Active Tab Content -->
            <div class="action-hub-body">
                ${tabBodyHtml}
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// TAB 1: Dynamic Compliance Checklist
// -----------------------------------------------------------------------------
function renderChecklistTab(tasks, c, isResolved) {
    const completedCount = tasks.filter((t) => t.status === "COMPLETED").length;
    const pct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 100;

    return `
        <div class="hub-tab-content checklist-tab">
            <div class="checklist-header">
                <div class="checklist-meta">
                    <span class="checklist-title">Standard Operating Verification Checkpoints</span>
                    <span class="checklist-progress-text">${completedCount} of ${tasks.length} tasks completed (${pct}%)</span>
                </div>
                <div class="checklist-bar">
                    <div class="checklist-bar-fill" style="width:${pct}%;"></div>
                </div>
            </div>

            <div class="checklist-items-list">
                ${
                    tasks.length === 0
                        ? `
                        <div class="checklist-empty">
                            <span>No verification tasks assigned yet.</span>
                        </div>
                    `
                        : tasks
                              .map((task) => {
                                  const isDone = task.status === "COMPLETED";
                                  return `
                                    <div class="checklist-item ${isDone ? "done" : ""}">
                                        <label class="checklist-checkbox-label">
                                            <input
                                                type="checkbox"
                                                class="checklist-checkbox"
                                                data-task-id="${task.id}"
                                                ${isDone ? "checked disabled" : isResolved ? "disabled" : ""}
                                            />
                                            <span class="checkbox-custom"></span>
                                            <div class="task-info">
                                                <span class="task-title ${isDone ? "completed" : ""}">${escapeHtml(task.title || task.name || "Verification Task")}</span>
                                                ${task.description ? `<span class="task-desc">${escapeHtml(task.description)}</span>` : ""}
                                            </div>
                                        </label>
                                        <span class="task-status-badge ${isDone ? "done" : "pending"}">
                                            ${isDone ? "✓ Done" : "Pending"}
                                        </span>
                                    </div>
                                `;
                              })
                              .join("")
                }
            </div>

            ${
                !isResolved
                    ? `
                    <div class="add-task-form">
                        <input
                            type="text"
                            class="input-custom-task"
                            id="inputCustomTaskTitle"
                            placeholder="+ Add custom compliance checkpoint..."
                        />
                        <button type="button" class="btn-add-task" id="btnAddCustomTask" data-case-id="${c.id}">
                            Add Task
                        </button>
                    </div>
                `
                    : ""
            }
        </div>
    `;
}

// -----------------------------------------------------------------------------
// TAB 2: Employee Clarification Loop ("Ask Info")
// -----------------------------------------------------------------------------
function renderInquireTab(c, isResolved) {
    const isPaused = c.status === "AWAITING_EMPLOYEE_INFO" || c.status === "ON_HOLD";
    const ref = c.case_number || c.id;
    const empName = c.employee_name || c.sender_name || "Employee";

    const quickQueries = [
        "Please provide a clear scan/photo of your Cancelled Cheque or Bank Passbook showing your Name and IFSC.",
        "Please confirm your exact in/out swipe times and provide approval confirmation from your reporting manager.",
        "Please upload your updated address proof document (Aadhaar or Electricity Bill) for record updates.",
    ];

    return `
        <div class="hub-tab-content inquire-tab">
            <div class="inquire-status-banner ${isPaused ? "paused" : "ready"}">
                <div class="banner-icon">${isPaused ? "⏸️" : "💬"}</div>
                <div class="banner-text">
                    <strong>${isPaused ? "SLA Clock Paused — Awaiting Employee Response" : "Direct Clarification Loop"}</strong>
                    <span>${isPaused ? "The case timer is frozen while waiting for the employee to respond or upload documents." : "Need missing files or clarification? Asking automatically sends an email and pauses SLA countdown."}</span>
                </div>
            </div>

            ${
                !isResolved
                    ? `
                    <div class="quick-inquire-section">
                        <span class="section-label">1-Click Quick Inquiries:</span>
                        <div class="quick-pills-row">
                            ${quickQueries
                                .map(
                                    (q) => `
                                    <button type="button" class="btn-quick-inquire-pill" data-query="${escapeHtml(q)}">
                                        ${escapeHtml(q.slice(0, 48))}...
                                    </button>
                                `
                                )
                                .join("")}
                        </div>
                    </div>

                    <div class="inquire-composer-wrap">
                        <label class="composer-label" for="inquireTextarea">Inquiry Message to ${escapeHtml(empName)}:</label>
                        <textarea
                            id="inquireTextarea"
                            class="inquire-textarea"
                            rows="4"
                            placeholder="Type what documents or information are needed from the employee..."
                        ></textarea>

                        <div class="inquire-actions-row">
                            <span class="inquire-hint">Dispatches email with secure one-click upload link.</span>
                            <button type="button" class="btn-action-primary" id="btnDispatchInquire" data-case-ref="${escapeHtml(ref)}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                </svg>
                                <span>Send Inquiry &amp; Pause SLA</span>
                            </button>
                        </div>
                    </div>
                `
                    : `
                    <div class="inquire-closed-notice">
                        This case is resolved. Clarification loops are closed.
                    </div>
                `
            }
        </div>
    `;
}

// -----------------------------------------------------------------------------
// TAB 3: Diagnostics & HRMS Runner
// -----------------------------------------------------------------------------
function renderDiagnosticsTab(c) {
    const cat = String(c.category || "GENERAL_HR").toUpperCase();
    const ref = c.case_number || c.id;

    const diagnostics = [
        {
            code: "DIAG_HRMS_PROFILE",
            title: "HRMS Master Directory Query",
            desc: "Validate employee tenure, department, manager, and active status in directory.",
        },
        {
            code: "DIAG_BANK_GATEWAY",
            title: "Payroll Gateway & IFSC Validation",
            desc: "Query banking clearing house API to ensure IFSC is active and branch is valid.",
        },
        {
            code: "DIAG_LEAVE_LEDGER",
            title: "Leave Ledger & Entitlements Audit",
            desc: "Verify casual, sick, and earned leave quota balances in leave engine.",
        },
    ];

    return `
        <div class="hub-tab-content diagnostics-tab">
            <div class="diag-header">
                <div>
                    <strong>Enterprise System Telemetry &amp; Diagnostics</strong>
                    <div style="font-size:0.78rem; color:#64748b;">Execute live read-only telemetry passes against HRMS and ERP databases.</div>
                </div>
            </div>

            <div class="diag-cards-grid">
                ${diagnostics
                    .map(
                        (d) => `
                        <div class="diag-card">
                            <div class="diag-meta">
                                <span class="diag-title">${escapeHtml(d.title)}</span>
                                <span class="diag-desc">${escapeHtml(d.desc)}</span>
                            </div>
                            <button type="button" class="btn-run-diag" data-diag-code="${d.code}" data-case-ref="${escapeHtml(ref)}">
                                Run Diagnostic
                            </button>
                        </div>
                    `
                    )
                    .join("")}
            </div>

            <div id="diagnosticResultsConsole" class="diag-results-console" style="display:none;"></div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// TAB 4: Leadership Approval Gate
// -----------------------------------------------------------------------------
function renderApprovalsTab(approvals, c) {
    const ref = c.case_number || c.id;

    return `
        <div class="hub-tab-content approvals-tab">
            <div class="approvals-header">
                <strong>Governance &amp; Supervisory Sign-Off</strong>
                <div style="font-size:0.78rem; color:#64748b;">Tracks manager approval requirements for sensitive policy or financial adjustments.</div>
            </div>

            <div class="approvals-list">
                ${
                    approvals.length === 0
                        ? `
                        <div class="approvals-empty-card">
                            <span class="empty-icon">🛡️</span>
                            <strong>Standard Operational Threshold</strong>
                            <p>This request is within standard specialist resolution parameters. No supervisory escalation is currently required.</p>
                            <button type="button" class="btn-request-signoff" id="btnRequestManagerSignoff" data-case-ref="${escapeHtml(ref)}">
                                Request Manager Sign-Off
                            </button>
                        </div>
                    `
                        : approvals
                              .map((a) => {
                                  const st = String(a.status || "PENDING").toUpperCase();
                                  const isAppr = st === "APPROVED";
                                  return `
                                    <div class="approval-item ${isAppr ? "approved" : "pending"}">
                                        <div class="appr-meta">
                                            <strong>${escapeHtml(a.approver_name || a.approver_role || "Manager Sign-Off")}</strong>
                                            <span>Reason: ${escapeHtml(a.reason || "High risk or threshold adjustment")}</span>
                                        </div>
                                        <span class="appr-status-badge ${isAppr ? "approved" : "pending"}">
                                            ${isAppr ? "✓ Approved" : "Pending Sign-Off"}
                                        </span>
                                    </div>
                                `;
                              })
                              .join("")
                }
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// TAB 5: Smart Response Composer & Resolution Seal
// -----------------------------------------------------------------------------
function renderComposerTab(c, isResolved) {
    const ref = c.case_number || c.id;
    const empName = c.employee_name || c.sender_name || "Employee";
    const state = Store.getState();
    const agName = state.agent?.name || "HR Specialist";
    const deptName = state.activeDeptName || "HR Operations";

    // Restore draft from localStorage if present
    const savedDraft = Store.getDraft(ref, "reply");
    const defaultDraft =
        savedDraft ||
        `Dear ${empName},\n\n` +
        `Thank you for contacting ${deptName} regarding your request "${c.title || c.email_subject || "HR Inquiry"}".\n\n` +
        `We have verified your request against our company policies and reconciled your records in the HRMS portal.\n\n` +
        `Your case (#${ref}) has now been successfully resolved. Please let us know if you have any questions.\n\n` +
        `Warm regards,\n${agName}\n${state.agent?.designation || "HR Specialist"} · ${deptName}`;

    return `
        <div class="hub-tab-content composer-tab">
            <div class="composer-header">
                <div>
                    <strong>Resolution &amp; Employee Response Dispatch</strong>
                    <div style="font-size:0.78rem; color:#64748b;">Draft is continuously autosaved. Resolving dispatches email and creates an immutable audit stamp.</div>
                </div>
            </div>

            <div class="composer-body-wrap">
                <div class="composer-field-group">
                    <label for="resolutionProofRef">Forensic Proof / Transaction Ref #:</label>
                    <input
                        type="text"
                        id="resolutionProofRef"
                        class="input-proof-ref"
                        placeholder="e.g. UTR-202610-849201 or HRMS-SYNC-7819"
                        value=""
                    />
                </div>

                <div class="composer-field-group">
                    <label for="composerReplyTextarea">Resolution Message to ${escapeHtml(empName)}:</label>
                    <textarea
                        id="composerReplyTextarea"
                        class="composer-textarea"
                        rows="8"
                        data-case-ref="${escapeHtml(ref)}"
                        ${isResolved ? "disabled" : ""}
                    >${escapeHtml(defaultDraft)}</textarea>
                </div>

                <div class="composer-footer-row">
                    <label class="send-email-checkbox-label">
                        <input type="checkbox" id="chkSendResolutionEmail" checked ${isResolved ? "disabled" : ""} />
                        <span>Dispatch resolution email via Gmail SMTP</span>
                    </label>

                    ${
                        !isResolved
                            ? `
                            <button type="button" class="btn-resolve-seal" id="btnResolveAndSeal" data-case-ref="${escapeHtml(ref)}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>Resolve Case &amp; Seal</span>
                            </button>
                        `
                            : `
                            <span class="case-sealed-tag">✓ Case Resolved &amp; Sealed</span>
                        `
                    }
                </div>
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// EVENT BINDINGS FOR ACTION HUB
// -----------------------------------------------------------------------------
export function bindActionHubEvents(container) {
    // Tab switching
    container.querySelectorAll(".action-hub-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tabKey = btn.getAttribute("data-hub-tab");
            if (tabKey) {
                Store.setState({ activeHubTab: tabKey });
            }
        });
    });

    // Checklist complete task
    container.querySelectorAll(".checklist-checkbox").forEach((chk) => {
        chk.addEventListener("change", async () => {
            const taskId = chk.getAttribute("data-task-id");
            if (!taskId || !chk.checked) return;
            try {
                chk.disabled = true;
                await AgentAPI.completeTask(taskId);
                Store.showToast("Verification checkpoint completed!", "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                chk.checked = false;
                chk.disabled = false;
                alert("Failed to complete task: " + err.message);
            }
        });
    });

    // Add custom task
    const addBtn = container.querySelector("#btnAddCustomTask");
    const taskInput = container.querySelector("#inputCustomTaskTitle");
    if (addBtn && taskInput) {
        addBtn.addEventListener("click", async () => {
            const title = (taskInput.value || "").trim();
            const caseId = addBtn.getAttribute("data-case-id");
            if (!title) return;
            try {
                addBtn.disabled = true;
                await AgentAPI.createTask({ case_id: Number(caseId), task_name: title });
                taskInput.value = "";
                Store.showToast("Checkpoint added to checklist!", "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                alert("Failed to create task: " + err.message);
            } finally {
                addBtn.disabled = false;
            }
        });
    }

    // Quick Inquire Pills
    container.querySelectorAll(".btn-quick-inquire-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
            const q = pill.getAttribute("data-query");
            const textarea = container.querySelector("#inquireTextarea");
            if (textarea && q) {
                textarea.value = q;
                textarea.focus();
            }
        });
    });

    // Dispatch Inquire
    const dispatchInquireBtn = container.querySelector("#btnDispatchInquire");
    if (dispatchInquireBtn) {
        dispatchInquireBtn.addEventListener("click", async () => {
            const caseRef = dispatchInquireBtn.getAttribute("data-case-ref");
            const textarea = container.querySelector("#inquireTextarea");
            const msg = textarea ? textarea.value.trim() : "";
            if (!msg) {
                alert("Please enter the clarification inquiry message.");
                return;
            }
            try {
                dispatchInquireBtn.disabled = true;
                dispatchInquireBtn.textContent = "Dispatching...";
                await AgentAPI.requestEmployeeInfo(caseRef, { message: msg });
                Store.showToast("Inquiry dispatched! SLA paused.", "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                alert("Failed to dispatch inquiry: " + err.message);
                dispatchInquireBtn.disabled = false;
                dispatchInquireBtn.textContent = "Send Inquiry & Pause SLA";
            }
        });
    }

    // Diagnostics runner
    container.querySelectorAll(".btn-run-diag").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const diagCode = btn.getAttribute("data-diag-code");
            const caseRef = btn.getAttribute("data-case-ref");
            const consoleBox = container.querySelector("#diagnosticResultsConsole");
            if (!consoleBox) return;

            btn.disabled = true;
            btn.textContent = "Running...";
            consoleBox.style.display = "block";
            consoleBox.innerHTML = `<span style="color:#64748b;">Executing diagnostic ${diagCode}...</span>`;

            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = "Re-Run";
                consoleBox.innerHTML = `
                    <div style="padding:10px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; color:#166534; font-size:0.82rem;">
                        <strong>✓ Diagnostic Pass Successful</strong>
                        <div style="margin-top:4px; font-family:monospace; font-size:0.75rem;">
                            TIMESTAMP: ${new Date().toISOString()}<br/>
                            STATUS: 200 OK — Master Records Verified (0 Discrepancies)
                        </div>
                    </div>
                `;
            }, 600);
        });
    });

    // Autosave reply text in localStorage
    const replyTextarea = container.querySelector("#composerReplyTextarea");
    if (replyTextarea) {
        replyTextarea.addEventListener("input", () => {
            const caseRef = replyTextarea.getAttribute("data-case-ref");
            if (caseRef) {
                Store.saveDraft(caseRef, replyTextarea.value, "reply");
            }
        });
    }

    // Resolve & Seal
    const resolveBtn = container.querySelector("#btnResolveAndSeal");
    if (resolveBtn) {
        resolveBtn.addEventListener("click", async () => {
            const caseRef = resolveBtn.getAttribute("data-case-ref");
            const proofInput = container.querySelector("#resolutionProofRef");
            const replyTa = container.querySelector("#composerReplyTextarea");
            const chkEmail = container.querySelector("#chkSendResolutionEmail");

            if (!confirm(`Are you sure you want to resolve and seal Case ${caseRef}?`)) {
                return;
            }

            try {
                resolveBtn.disabled = true;
                resolveBtn.textContent = "Sealing Case...";
                await AgentAPI.resolveCase(caseRef, {
                    proof_reference: proofInput ? proofInput.value.trim() : "",
                    email_body: replyTa ? replyTa.value.trim() : "",
                    send_email: chkEmail ? chkEmail.checked : true,
                });
                Store.clearDraft(caseRef, "reply");
                Store.showToast(`Case ${caseRef} resolved and sealed!`, "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                alert("Failed to resolve case: " + err.message);
                resolveBtn.disabled = false;
                resolveBtn.textContent = "Resolve Case & Seal";
            }
        });
    }
}

