/**
 * dossier.js — Zone 2: Executive Case Header & 360° Employee Telemetry
 */

import { Store } from "../state.js";
import { AgentAPI } from "../api.js";
import {
    escapeHtml,
    formatDate,
    getInitials,
    getCategoryTone,
    getStatusBadge,
    getPriorityBadge,
    formatSlaCountdown,
    formatHuman,
} from "../utils.js";

function cleanCategoryLabel(rawCat) {
    if (!rawCat) return "General HR";
    const s = String(rawCat).trim();
    if (s.toUpperCase().startsWith("TEST_TEMP_")) {
        return s.replace(/^TEST_TEMP_/i, "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }
    return formatHuman(s);
}

export function renderDossier(caseData) {
    if (!caseData) {
        return `
            <div class="dossier-empty-state">
                <div class="empty-icon-box">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 14 14"></polyline>
                    </svg>
                </div>
                <h3>Select a Case to Begin Execution</h3>
                <p>Choose an assigned case or claim an open request from the team queue.</p>
            </div>
        `;
    }

    const state = Store.getState();
    const currentAgentEmail = (state.agent?.email || "").toLowerCase();
    const c = caseData.case || caseData;
    const ref = c.case_number || c.id;
    const isAssignedToMe = Store.isCaseAssignedToMe(c);
    const canClaim = Store.isCaseUnclaimed(c);

    const catTone = getCategoryTone(c.category);
    const statusBadge = getStatusBadge(c.status);
    const prioBadge = getPriorityBadge(c.priority);
    const slaInfo = formatSlaCountdown(c.sla_remaining, c.sla_status || c.sla_state, c.status);
    const categoryDisplay = cleanCategoryLabel(c.category);

    const empName = c.employee_name && c.employee_name !== "Unknown" ? c.employee_name : (c.sender_name || "Employee");
    const empCode = c.employee_code || c.emp_code || "";
    const empDept = c.department || c.employee_department || "Operations";
    const empEmail = c.employee_email || c.sender_email || "";
    const isMatched = Boolean(c.employee_matched);

    // Parse extracted fields
    let extFields = {};
    if (c.extracted_fields) {
        try {
            extFields = typeof c.extracted_fields === "string" ? JSON.parse(c.extracted_fields) : c.extracted_fields;
            if (extFields.fields) extFields = extFields.fields;
        } catch (_) {}
    }
    const extEntries = Object.entries(extFields).filter(
        ([k, v]) => v != null && v !== "" && typeof v !== "object" && k !== "category"
    );

    return `
        <div class="agent-case-dossier-wrapper">
            <!-- Case Header Strip -->
            <header class="dossier-header-bar">
                <div class="dossier-header-left">
                    <div class="dossier-title-row">
                        <span class="dossier-case-num">${escapeHtml(ref)}</span>
                        <span class="badge" style="background:${statusBadge.bg}; color:${statusBadge.fg}; border:1px solid ${statusBadge.border};">
                            ${escapeHtml(statusBadge.label)}
                        </span>
                        <span class="badge" style="background:${prioBadge.bg}; color:${prioBadge.fg}; border:1px solid ${prioBadge.border};">
                            ${escapeHtml(prioBadge.label)}
                        </span>
                        <span class="badge" style="background:${catTone.bg}; color:${catTone.fg}; border:1px solid ${catTone.border};">
                            ${escapeHtml(categoryDisplay)}
                        </span>
                        <span class="dossier-sla-tag sla-tone-${slaInfo.tone}">
                            ${escapeHtml(slaInfo.text)}
                        </span>
                    </div>
                    <h2 class="dossier-subject">${escapeHtml(c.title || c.email_subject || `HR Request (${ref})`)}</h2>
                </div>

                <div class="dossier-header-actions">
                    ${
                        canClaim
                            ? `
                            <button type="button" class="btn-action-primary" id="btnClaimCase" data-case-ref="${escapeHtml(ref)}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="9" cy="7" r="4"></circle>
                                    <polyline points="16 11 18 13 22 9"></polyline>
                                </svg>
                                <span>Claim Case</span>
                            </button>
                        `
                            : ""
                    }
                    <button type="button" class="btn-action-outline" id="btnTriggerReassign" data-case-ref="${escapeHtml(ref)}" title="Reassign to another specialist or desk">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 3 21 3 21 8"></polyline>
                            <line x1="4" y1="20" x2="21" y2="3"></line>
                            <polyline points="21 16 21 21 16 21"></polyline>
                            <line x1="15" y1="15" x2="21" y2="21"></line>
                        </svg>
                        <span>Reassign</span>
                    </button>
                    <a href="casedetail.html?case=${encodeURIComponent(ref)}" target="_blank" class="btn-action-outline" title="Open full 360° Case Detail in new tab">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        <span>Full Detail ↗</span>
                    </a>
                </div>
            </header>

            <!-- Employee 360° Identity Card & Attributes Grid -->
            <div class="dossier-telemetry-grid">
                <!-- Employee Card -->
                <div class="dossier-card emp-telemetry-card">
                    <div class="emp-card-header">
                        <div class="emp-card-avatar">
                            ${escapeHtml(getInitials(empName))}
                        </div>
                        <div class="emp-card-meta">
                            <div class="emp-card-name-row">
                                <strong class="emp-name">${escapeHtml(empName)}</strong>
                                <span class="emp-verified-tag ${isMatched ? "verified" : "unmatched"}">
                                    ${isMatched ? "✓ Verified HRMS Record" : "⚠️ Identity Verification Needed"}
                                </span>
                            </div>
                            <div class="emp-card-details">
                                <span>Code: <strong>${escapeHtml(empCode || "—")}</strong></span>
                                <span>·</span>
                                <span>Dept: <strong>${escapeHtml(cleanCategoryLabel(empDept))}</strong></span>
                                <span>·</span>
                                <span>Email: <a href="mailto:${escapeHtml(empEmail)}">${escapeHtml(empEmail)}</a></span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Extracted Key Data Entities -->
                <div class="dossier-card entities-card">
                    <div class="entities-title">Key Request Attributes</div>
                    <div class="entities-grid">
                        <div class="entity-pill">
                            <span class="label">Intent</span>
                            <span class="value" title="${escapeHtml(c.intent || "General Request")}">${escapeHtml(c.intent || "General Request")}</span>
                        </div>
                        <div class="entity-pill">
                            <span class="label">Received</span>
                            <span class="value">${escapeHtml(formatDate(c.created_at))}</span>
                        </div>
                        ${extEntries.slice(0, 4).map(([k, v]) => `
                            <div class="entity-pill">
                                <span class="label">${escapeHtml(formatHuman(k))}</span>
                                <span class="value" title="${escapeHtml(String(v))}">${escapeHtml(String(v))}</span>
                            </div>
                        `).join("")}
                    </div>
                </div>
            </div>

            <!-- Inbound Message Accordion Box -->
            <details class="dossier-inbound-message-box" ${c.email_body || c.description ? "open" : ""}>
                <summary class="inbound-message-summary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    <span>Inbound Inquiry Message</span>
                </summary>
                <div class="inbound-message-content">
                    <pre class="inbound-body-text">${escapeHtml(c.email_body || c.description || "No message body provided.")}</pre>
                </div>
            </details>
        </div>
    `;
}

export function bindDossierEvents(container) {
    const claimBtn = container.querySelector("#btnClaimCase");
    if (claimBtn) {
        claimBtn.addEventListener("click", async () => {
            const caseRef = claimBtn.getAttribute("data-case-ref");
            if (!caseRef) return;
            try {
                claimBtn.disabled = true;
                claimBtn.textContent = "Claiming...";
                await AgentAPI.claimCase(caseRef);
                Store.showToast(`Case ${caseRef} assigned to you!`, "success");
                if (window.refreshWorkbenchData) {
                    await window.refreshWorkbenchData(true);
                }
            } catch (err) {
                alert("Failed to claim case: " + err.message);
                claimBtn.disabled = false;
                claimBtn.textContent = "Claim Case";
            }
        });
    }

    const reassignBtn = container.querySelector("#btnTriggerReassign");
    if (reassignBtn) {
        reassignBtn.addEventListener("click", () => {
            const caseRef = reassignBtn.getAttribute("data-case-ref");
            Store.setState({ activeModal: "REASSIGN", reassignCaseTarget: caseRef });
        });
    }
}
