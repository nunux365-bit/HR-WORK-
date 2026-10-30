/**
 * HR Flow — Step 1: Details & Dossier Component (frontend/js/casedetail/components/step1-dossier.js)
 * High-Contrast Executive Query Letter Canvas, Dynamic Intake Gate,
 * Requester 360° Identity Profile, AI Intent Triage & Ticket History.
 */

import { escapeHtml, formatHuman, formatDateTimeIST, getInitials, showToast } from "../utils/formatters.js";
import { executeCaseAction, setWorkflowStep, mergeCases, linkCases } from "../api.js";

/**
 * Formats inbound email body: parses structured key-value lines into clean card chips
 * and formats paragraphs with high-contrast executive typography.
 */
export function formatEmailBodyHtml(raw) {
    if (!raw) return '<p style="color:#94a3b8; font-style:italic;">No email body content available.</p>';

    let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/\n\s*-\s*\n/g, '\n');
    s = s.replace(/^\s*-\s*\n/g, '');
    s = s.replace(/<[^>]*\+91[^>]*>/g, '');

    const lines = s.split('\n');
    const output = [];
    let curKvBlock = [];
    let curParaLines = [];

    const flushKv = () => {
        if (curKvBlock.length > 0) {
            let card = '<div class="mail-key-details-card">';
            for (const item of curKvBlock) {
                card += `
                    <div class="mail-kv-item">
                        <span class="mail-kv-key">${escapeHtml(item.key)}</span>
                        <span class="mail-kv-val">${escapeHtml(item.val)}</span>
                    </div>
                `;
            }
            card += '</div>';
            output.push(card);
            curKvBlock = [];
        }
    };

    const flushPara = () => {
        if (curParaLines.length > 0) {
            let pText = curParaLines.map(l => escapeHtml(l)).join('<br>');
            pText = pText.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a; font-weight:800;">$1</strong>');
            output.push(`<p class="mail-letter-p">${pText}</p>`);
            curParaLines = [];
        }
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            flushKv();
            flushPara();
            continue;
        }

        const cleanLine = trimmed.replace(/^-\s*/, '').trim();
        const m = cleanLine.match(/^\*?([A-Za-z0-9\s/]+)\*?:\s*(.+)$/);
        const isHeaderLike = /^(dear|hi|hello|please find|note|subject|regards|thank|best regards|sincerely)/i.test(trimmed);

        if (m && m[1].length <= 32 && !isHeaderLike) {
            flushPara();
            curKvBlock.push({
                key: m[1].trim().replace(/\*/g, ''),
                val: m[2].trim().replace(/\*/g, '')
            });
        } else {
            flushKv();
            curParaLines.push(trimmed);
        }
    }

    flushKv();
    flushPara();

    return output.join('\n');
}

/**
 * Dynamically evaluates whether the inbound request provides all mandatory intake criteria
 * defined in the Category Playbook's `intake_rules`.
 */
export function evaluateIntakeGate(c, em, playbook, allAttachments = []) {
    const rules = playbook?.intake_rules;
    const cat = (c.category || "GENERAL_HR").toUpperCase();

    if (!rules || rules.enabled === false || !Array.isArray(rules.required_items) || rules.required_items.length === 0) {
        return {
            isConfigured: false,
            isComplete: true,
            title: `${formatHuman(cat)} Intake Gate`,
            detectedItems: ["Standard inquiry criteria accepted"],
            missingItems: [],
            inquiryPresetId: null,
            buttonLabel: "Request Clarification",
            emptyStateSummary: "Inbound criteria evaluated and accepted."
        };
    }

    const subject = String(em.subject || c.title || "");
    const body = String(em.body_plain || em.body || c.description || "");
    const combined = `${subject}\n${body}`.toLowerCase();

    const detected = [];
    const missing = [];

    for (const item of rules.required_items) {
        const label = item.label || "Required Field";
        const type = (item.field_type || "KEYWORD").toUpperCase();
        const isOptional = item.optional === true || item.is_optional === true || /\(optional\)/i.test(label);
        let found = false;

        if (type === "ATTACHMENT") {
            found = Array.isArray(allAttachments) && allAttachments.length > 0;
        } else if (type === "DATE") {
            found = Boolean(combined.match(/\b(?:\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(?:20\d{2})?)\b/i));
        } else if (type === "TIME") {
            found = Boolean(combined.match(/\b(?:\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i));
        } else if (type === "NUMBER_SEQUENCE") {
            found = Boolean(combined.match(/\b([0-9]{5,18})\b/));
        } else {
            const needle = (item.pattern || item.label || "").toLowerCase();
            found = combined.includes(needle);
        }

        if (found) {
            detected.push(label);
        } else if (!isOptional) {
            missing.push(label);
        }
    }

    const isComplete = missing.length === 0;
    const missingAction = rules.missing_action || {};

    return {
        isConfigured: true,
        isComplete,
        title: rules.rule_name || `${formatHuman(cat)} Criteria`,
        detectedItems: detected,
        missingItems: missing,
        inquiryPresetId: missingAction.preset_id || null,
        buttonLabel: missingAction.preset_id ? "Request Missing Info (Auto-Draft)" : "Request Supporting Details",
        emptyStateSummary: missingAction.warning_message || `Inbound request is missing required fields: ${missing.join(', ')}.`
    };
}

export function renderStep1Dossier(container, state) {
    const c = state.caseData?.case || {};
    const emp = state.caseData?.employee || {};
    const em = state.caseData?.email || {};
    const pb = state.caseData?.playbook || {};
    const docs = state.caseData?.documents || [];
    const reqHistory = state.caseData?.requester_history || [];

    const isInDb = Boolean(emp && (emp.is_in_db === true || (emp.is_in_db !== false && emp.id != null)));
    const empDisplayName = emp.name || c.employee_name || em.sender_name || "Requester";
    const empDisplayCode = emp.employee_id || c.employee_id || "";
    const empDisplayDept = emp.department || c.employee_department || "Operations";
    const empDisplayRole = emp.designation || c.employee_designation || "Staff Specialist";
    const empDisplayMgr = emp.manager_name || c.employee_manager || "Department Lead";
    const empDisplayEmail = emp.email || c.employee_email || em.sender_email || "requester@company.com";
    const empDisplayLoc = emp.location || c.employee_location || "Headquarters";

    const emailSubject = em.subject || c.title || `Case ${c.case_number || c.id || "Inquiry"}`;
    const formattedTime = formatDateTimeIST(em.received_at || c.created_at);
    const rawCat = (c.category || "GENERAL_HR").toUpperCase();

    // Attachments
    const allAttachments = [];
    if (Array.isArray(em.attachments)) {
        em.attachments.forEach(att => allAttachments.push({
            filename: att.filename || "Attachment",
            size: att.size ? `${Math.round(att.size / 1024)} KB` : "Document",
            id: att.id,
            url: att.id ? `/api/attachments/${att.id}/download` : null,
        }));
    }
    if (Array.isArray(docs)) {
        docs.forEach(d => allAttachments.push({
            filename: d.filename || "Case Document",
            size: d.file_size_bytes ? `${Math.round(d.file_size_bytes / 1024)} KB` : "Document",
            id: d.id,
            url: `/api/cases/${encodeURIComponent(c.case_number || c.id)}/documents/${d.id}/download`,
        }));
    }

    const intakeGate = evaluateIntakeGate(c, em, pb, allAttachments);
    const dupMatch = state.caseData?.duplicate_match;
    const convThread = Array.isArray(state.caseData?.conversation_thread) ? state.caseData.conversation_thread : [];

    // Extracted Fields from AI
    let extFields = c.extracted_fields?.fields || c.extracted_fields || {};
    if (typeof extFields === "string") {
        try { extFields = JSON.parse(extFields); } catch (_) { extFields = {}; }
    }
    const extEntries = Object.entries(extFields).filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && k !== "category" && k !== "attachment");

    container.innerHTML = `
        <div class="step1-layout-container">
            <!-- Left: Executive Email & Intake Verification Canvas -->
            <div class="step1-main-column">

                <!-- 1. Smart Duplicate & Recurring Case Intelligence Banner -->
                ${dupMatch && dupMatch.has_match ? `
                    <div class="duplicate-match-banner" id="duplicateMatchBanner">
                        <div class="dup-banner-header">
                            <div class="dup-banner-left">
                                <span class="dup-banner-icon">⚡</span>
                                <div>
                                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                        <strong style="font-size:0.92rem; color:#1e3a8a;">Duplicate / Recurring Inquiry Detected</strong>
                                        <span class="card-badge" style="background:#dbeafe; color:#1d4ed8; border:1px solid #93c5fd; font-weight:800;">
                                            ${dupMatch.match_score}% Match Confidence
                                        </span>
                                    </div>
                                    <div style="font-size:0.78rem; color:#3b82f6; margin-top:2px;">
                                        Matches active docket <strong>#${escapeHtml(dupMatch.matched_case_number)}</strong> ("${escapeHtml(dupMatch.matched_title)}") · Status: <strong>${escapeHtml(dupMatch.status)}</strong> · Specialist: <strong>${escapeHtml(dupMatch.assigned_user)}</strong>
                                    </div>
                                </div>
                            </div>
                            <div class="dup-banner-dismiss">
                                <button type="button" class="btn-action-pill" id="btnDismissDupBanner" title="Dismiss suggestion and keep as distinct ticket">✕ Keep Independent</button>
                            </div>
                        </div>
                        <div class="dup-banner-reasons">
                            ${dupMatch.reasons.map(r => `<span class="card-badge" style="background:#ffffff; color:#1e40af; border:1px solid #bfdbfe;">✓ ${escapeHtml(r)}</span>`).join("")}
                        </div>
                        <div class="dup-banner-actions">
                            ${dupMatch.can_merge ? `
                                <button type="button" class="btn-action-pill" id="btnMergeIntoMatchedCase" style="background:#2563eb; color:#ffffff; border-color:#1d4ed8; font-weight:700;">
                                    🔗 Follow &amp; Merge into #${escapeHtml(dupMatch.matched_case_number)}
                                </button>
                            ` : ''}
                            <button type="button" class="btn-action-pill" id="btnLinkAsRelatedCase" style="background:#ffffff; color:#1e40af; border-color:#93c5fd; font-weight:700;">
                                📎 Link as Related Docket
                            </button>
                            <a href="casedetail.html?case=${encodeURIComponent(dupMatch.matched_case_number)}" target="_blank" class="btn-action-pill" style="text-decoration:none;">
                                👁️ Inspect Matched Case ↗
                            </a>
                        </div>
                    </div>
                ` : ''}
                
                <!-- Email Executive Paper Card -->
                <div class="mail-executive-card">
                    <!-- Top Metadata Strip -->
                    <div class="mail-card-topbar">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="card-badge" style="background:var(--c-primary-tint); color:var(--c-primary); border:1px solid var(--c-primary-border);">
                                📨 Inbound Message
                            </span>
                            <span class="card-badge" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;">
                                Official Email
                            </span>
                            <span class="card-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;" title="DKIM &amp; SPF Authentication Verified">
                                ✓ Verified TLS
                            </span>
                        </div>
                        <div style="font-size:0.75rem; color:var(--c-text-muted); font-weight:600;">
                            Received: <strong>${escapeHtml(formattedTime)}</strong>
                        </div>
                    </div>

                    <!-- Subject Header Banner -->
                    <div class="mail-subject-banner">
                        <div style="font-size:0.68rem; font-weight:800; color:var(--c-primary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
                            Inbound Subject Header
                        </div>
                        <h2 style="margin:0 0 8px 0; font-size:1.15rem; font-weight:800; color:#0f172a; line-height:1.4;">
                            ${escapeHtml(emailSubject)}
                        </h2>
                        <div style="display:flex; flex-wrap:wrap; gap:6px;">
                            <span class="card-badge" style="background:var(--c-primary-tint); color:var(--c-primary); border:1px solid var(--c-primary-border);">
                                ${escapeHtml(rawCat)}
                            </span>
                            <span class="card-badge" style="background:var(--c-purple-tint); color:var(--c-purple); border:1px solid var(--c-purple-border);">
                                ${escapeHtml(c.intent || "Operational Inquiry")}
                            </span>
                            <span class="card-badge" style="background:var(--c-amber-tint); color:var(--c-amber); border:1px solid var(--c-amber-border);">
                                Priority: ${escapeHtml(formatHuman(c.priority || "MEDIUM"))}
                            </span>
                            <span class="card-badge" style="background:${isInDb ? 'var(--c-emerald-tint)' : 'var(--c-amber-tint)'}; color:${isInDb ? 'var(--c-emerald)' : 'var(--c-amber)'}; border:1px solid ${isInDb ? 'var(--c-emerald-border)' : 'var(--c-amber-border)'};">
                                ${isInDb ? `✓ Directory Matched: ${escapeHtml(empDisplayName)} (${escapeHtml(empDisplayCode)})` : `⚠️ Unregistered: ${escapeHtml(empDisplayName)}`}
                            </span>
                        </div>
                    </div>

                    <!-- Sender & Routing Header -->
                    <div class="mail-sender-address-card">
                        <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 auto;">
                            <div class="mail-sender-avatar ${isInDb ? 'tone-blue' : 'tone-amber'}">
                                ${escapeHtml(getInitials(empDisplayName))}
                            </div>
                            <div style="min-width:0;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                    <strong style="font-size:0.86rem; color:#0f172a;">${escapeHtml(empDisplayName)}</strong>
                                    ${empDisplayCode ? `<span class="card-badge" style="background:#f1f5f9; color:#334155;">ID: ${escapeHtml(empDisplayCode)}</span>` : ''}
                                    <span style="font-size:0.75rem; color:var(--c-text-muted);">&lt;${escapeHtml(empDisplayEmail)}&gt;</span>
                                    <button type="button" class="btn-action-pill" id="btnCopySenderEmail" style="height:22px; font-size:0.68rem; padding:0 6px;" title="Copy email address">
                                        Copy Email
                                    </button>
                                </div>
                                <div style="font-size:0.72rem; color:var(--c-text-muted); margin-top:2px;">
                                    <span>to: <strong>${escapeHtml(em.account_email || "Operations Desk")}</strong></span>
                                    <span>·</span>
                                    <span>Via Google Workspace Direct</span>
                                </div>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <button type="button" class="btn-action-pill" id="btnCopyMailBody" style="height:28px; font-size:0.74rem;">
                                Copy Text
                            </button>
                            <button type="button" class="btn-action-pill" id="btnQuoteToDraft" style="height:28px; font-size:0.74rem;">
                                Quote in Reply
                            </button>
                        </div>
                    </div>

                    <!-- Letter Canvas Body -->
                    <div class="mail-letter-canvas">
                        ${formatEmailBodyHtml(em.body_plain || em.body || c.description || "")}
                    </div>

                    <!-- Supporting Attachments Drawer -->
                    <div style="border-top:1px solid #f1f5f9; padding-top:14px; margin-top:14px;">
                        <div style="font-size:0.72rem; font-weight:800; color:var(--c-text-muted); text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
                            <span>Attached Supporting Documents (${allAttachments.length})</span>
                            ${allAttachments.length === 0 ? '<span style="font-size:0.70rem; font-weight:500; color:#94a3b8; text-transform:none;">No files attached to inbound message</span>' : ''}
                        </div>
                        ${allAttachments.length > 0 ? `
                            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                                ${allAttachments.map(att => `
                                    <a ${att.url ? `href="${escapeHtml(att.url)}" target="_blank" download` : ''} class="attachment-chip" title="Click to download ${escapeHtml(att.filename)}">
                                        <span>📎</span>
                                        <strong>${escapeHtml(att.filename)}</strong>
                                        <span style="color:var(--c-text-muted); font-size:0.72rem;">(${escapeHtml(att.size)})</span>
                                        <span style="font-size:0.68rem; color:var(--c-primary);">↓ Download</span>
                                    </a>
                                `).join("")}
                            </div>
                        ` : ''}
                    </div>

                    <!-- Dynamic Intake Gate Completeness Callout -->
                    ${!intakeGate.isComplete ? `
                        <div class="intake-gate-alert missing">
                            <div style="display:flex; gap:12px; align-items:flex-start;">
                                <span style="font-size:1.6rem; line-height:1;">⚠️</span>
                                <div>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <strong style="font-size:0.86rem; color:#92400e;">Intake Gate: Mandatory Details Missing</strong>
                                        <span class="card-badge" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;">Action Required</span>
                                    </div>
                                    <div style="font-size:0.76rem; color:#b45309; margin:4px 0 6px 0;">
                                        ${escapeHtml(intakeGate.emptyStateSummary)}
                                    </div>
                                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                                        ${intakeGate.missingItems.map(m => `
                                            <span class="card-badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca;">
                                                ❌ ${escapeHtml(m)}: Missing
                                            </span>
                                        `).join("")}
                                    </div>
                                </div>
                            </div>
                            <button type="button" class="btn-action-pill" id="btnTriggerIntakeInquiry" style="background:#d97706; color:#ffffff; border-color:#b45309; height:34px; padding:0 14px; font-size:0.78rem;">
                                ${escapeHtml(intakeGate.buttonLabel)}
                            </button>
                        </div>
                    ` : `
                        <div class="intake-gate-alert passed">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-size:1.3rem; color:#059669;">✓</span>
                                <div>
                                    <strong style="font-size:0.84rem; color:#065f46;">Intake Gate Passed: All Required Criteria Detected</strong>
                                    <div style="font-size:0.74rem; color:#047857; margin-top:2px;">
                                        ${escapeHtml(intakeGate.title)} satisfied (${intakeGate.detectedItems.join(' · ')}).
                                    </div>
                                </div>
                            </div>
                            <span class="card-badge" style="background:#d1fae5; color:#065f46; border:1px solid #a7f3d0;">
                                Ready for Audit
                            </span>
                        </div>
                    `}
                </div>

                <!-- 2. Omnichannel Conversation & Follow-up History Stream -->
                ${convThread.length > 1 ? `
                    <div class="conversation-thread-section">
                        <div class="thread-section-header">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:1.1rem;">💬</span>
                                <strong style="font-size:0.88rem; color:#0f172a;">Communication &amp; Follow-up History</strong>
                                <span class="card-badge" style="background:#f1f5f9; color:#475569;">${convThread.length} Messages in Thread</span>
                            </div>
                            <div style="font-size:0.75rem; color:var(--c-text-muted);">
                                Chronological Audit Feed (Google Workspace &amp; Helpdesk)
                            </div>
                        </div>
                        <div class="conversation-thread-stream">
                            ${convThread.map((msg, idx) => {
                                const isInbound = msg.direction === "INBOUND";
                                const sName = msg.sender_name || (isInbound ? empDisplayName : "Specialist Desk");
                                const sEmail = msg.sender_email || "";
                                const msgTime = formatDateTimeIST(msg.timestamp);
                                const isRoot = msg.is_root;
                                return `
                                    <div class="thread-message-card ${isInbound ? 'inbound' : 'outbound'} ${isRoot ? 'root-inquiry' : ''}" data-msg-idx="${idx}">
                                        <div class="thread-card-header">
                                            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                                                <div class="mail-sender-avatar ${isInbound ? 'tone-blue' : 'tone-emerald'}" style="width:30px; height:30px; font-size:0.72rem;">
                                                    ${escapeHtml(getInitials(sName))}
                                                </div>
                                                <div style="min-width:0;">
                                                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                                        <strong style="font-size:0.82rem; color:#0f172a;">${escapeHtml(sName)}</strong>
                                                        ${sEmail ? `<span style="font-size:0.72rem; color:var(--c-text-muted);">&lt;${escapeHtml(sEmail)}&gt;</span>` : ''}
                                                        <span class="card-badge ${isInbound ? 'badge-inbound' : 'badge-outbound'}">
                                                            ${isInbound ? '📨 Inbound Message' : '📤 Specialist Notice'}
                                                        </span>
                                                        ${isRoot ? '<span class="card-badge" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">Original Ticket</span>' : ''}
                                                    </div>
                                                    <div style="font-size:0.70rem; color:var(--c-text-muted); margin-top:2px;">
                                                        <span>${escapeHtml(msgTime)}</span>
                                                        <span>·</span>
                                                        <span>${escapeHtml(msg.channel || 'EMAIL')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button type="button" class="btn-action-pill btn-quote-thread" data-quote-idx="${idx}" style="height:24px; font-size:0.68rem; padding:0 8px;" title="Quote this exchange into draft reply">
                                                Quote
                                            </button>
                                        </div>
                                        <div class="thread-card-body">
                                            ${formatEmailBodyHtml(msg.body)}
                                        </div>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                ` : ''}

                <!-- Step 1 Bottom Action Bar -->
                <div class="step-footer-bar">
                    <div style="font-size:0.78rem; color:var(--c-text-muted);">
                        Stage 1 of ${state.totalSteps}: <strong>Inbound Request Triage &amp; Requester Verification</strong>
                    </div>
                    <button type="button" class="btn-action-pill primary" id="btnProceedToStep2" style="height:38px; padding:0 18px; font-size:0.84rem;">
                        <span>Save &amp; Proceed to Step 2: Audit &amp; Verification →</span>
                    </button>
                </div>
            </div>

            <!-- Right: Requester 360° Profile, AI Telemetry & Ticket History -->
            <div class="step1-side-column">
                
                <!-- Requester 360° Identity Card -->
                <div class="panel-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <span>👤</span>
                            <span>Requester 360° Profile</span>
                        </h2>
                        <span class="card-badge" style="background:${isInDb ? 'var(--c-emerald-tint)' : 'var(--c-amber-tint)'}; color:${isInDb ? 'var(--c-emerald)' : 'var(--c-amber)'}; border:1px solid ${isInDb ? 'var(--c-emerald-border)' : 'var(--c-amber-border)'};">
                            ${isInDb ? 'Directory Verified' : 'Unregistered'}
                        </span>
                    </div>

                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                        <div class="mail-sender-avatar ${isInDb ? 'tone-blue' : 'tone-amber'}" style="width:48px; height:48px; font-size:1.05rem;">
                            ${escapeHtml(getInitials(empDisplayName))}
                        </div>
                        <div>
                            <div style="font-size:0.96rem; font-weight:800; color:#0f172a;">${escapeHtml(empDisplayName)}</div>
                            <div style="font-size:0.76rem; color:var(--c-text-muted);">${escapeHtml(empDisplayRole)} · ${escapeHtml(empDisplayDept)}</div>
                        </div>
                    </div>

                    <div class="requester-profile-grid">
                        <div>
                            <div class="profile-field-label">Subject ID</div>
                            <div class="profile-field-value" style="color:${isInDb ? '#2563eb' : '#d97706'}">
                                ${escapeHtml(empDisplayCode || "Not Registered")}
                            </div>
                        </div>
                        <div>
                            <div class="profile-field-label">Department</div>
                            <div class="profile-field-value">${escapeHtml(empDisplayDept)}</div>
                        </div>
                        <div>
                            <div class="profile-field-label">Reporting Manager</div>
                            <div class="profile-field-value">${escapeHtml(empDisplayMgr)}</div>
                        </div>
                        <div>
                            <div class="profile-field-label">Work Site</div>
                            <div class="profile-field-value">${escapeHtml(empDisplayLoc)}</div>
                        </div>
                        <div style="grid-column: span 2;">
                            <div class="profile-field-label">Email Address</div>
                            <div class="profile-field-value" style="font-size:0.75rem;">${escapeHtml(empDisplayEmail)}</div>
                        </div>
                    </div>

                    <!-- Unregistered Requester Callout -->
                    ${!isInDb ? `
                        <div style="margin-top:12px; padding:12px; border-radius:10px; background:#fffbeb; border:1px solid #fde68a;">
                            <div style="font-size:0.78rem; font-weight:800; color:#92400e; margin-bottom:2px;">New Subject Record Detected</div>
                            <div style="font-size:0.72rem; color:#78350f; margin-bottom:8px;">This requester does not exist in master records. Add them now to link future inquiries.</div>
                            <div style="display:flex; gap:6px;">
                                <button type="button" class="btn-action-pill" id="btnQuickAddSubject" style="background:#d97706; color:#ffffff; border-color:#b45309; height:28px; font-size:0.72rem;">
                                    Quick Register
                                </button>
                                <button type="button" class="btn-action-pill" id="btnEditSubjectModal" style="height:28px; font-size:0.72rem;">
                                    Review &amp; Edit
                                </button>
                            </div>
                        </div>
                    ` : `
                        <div style="border-top:1px solid #f1f5f9; padding-top:10px; margin-top:10px; display:flex; justify-content:flex-end;">
                            <button type="button" class="btn-action-pill" id="btnEditSubjectModal" style="height:26px; font-size:0.72rem; padding:0 8px;">
                                ✏️ Update Profile
                            </button>
                        </div>
                    `}
                </div>

                <!-- AI Classification & Telemetry Card -->
                <div class="panel-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <span>🤖</span>
                            <span>AI Intent &amp; Triage</span>
                        </h2>
                        <span class="card-badge" style="background:var(--c-emerald-tint); color:var(--c-emerald); border:1px solid var(--c-emerald-border);">
                            98.5% Confidence
                        </span>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:6px; font-size:0.80rem;">
                        <div>Detected Category: <strong>${escapeHtml(rawCat)}</strong></div>
                        <div>Classified Intent: <strong style="color:var(--c-primary);">${escapeHtml(c.intent || "Operational Inquiry")}</strong></div>
                    </div>

                    ${extEntries.length > 0 ? `
                        <div style="border-top:1px solid #f1f5f9; padding-top:10px; margin-top:8px;">
                            <div style="font-size:0.68rem; font-weight:800; color:var(--c-text-muted); text-transform:uppercase; margin-bottom:6px;">
                                Extracted Key Parameters (${extEntries.length})
                            </div>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                                ${extEntries.map(([k, v]) => `
                                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; font-size:0.74rem;">
                                        <div style="color:var(--c-text-muted); font-size:0.65rem; text-transform:uppercase; font-weight:700;">${escapeHtml(formatHuman(k))}</div>
                                        <div style="font-weight:700; color:#0f172a; word-break:break-word;">${escapeHtml(String(v))}</div>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    ` : ''}

                    <div style="border-top:1px solid #f1f5f9; padding-top:10px; margin-top:8px;">
                        <button type="button" class="btn-action-pill" id="btnAcceptAiClassification" style="width:100%; justify-content:center; height:30px; font-size:0.76rem;">
                            <span>✓ Verify &amp; Confirm AI Classification</span>
                        </button>
                    </div>
                </div>

                <!-- Requester Ticket History & Recurrence Card -->
                <div class="panel-card">
                    <div class="card-header">
                        <h2 class="card-title">
                            <span>📋</span>
                            <span>Requester Ticket History</span>
                        </h2>
                        <span class="card-badge" style="background:#f1f5f9; color:#475569;">
                            ${reqHistory.length} Prior Cases
                        </span>
                    </div>

                    ${reqHistory.length > 0 ? `
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${reqHistory.map(h => `
                                <a href="casedetail.html?case=${encodeURIComponent(h.case_number)}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; text-decoration:none; transition:all 0.15s ease;" class="history-ticket-row">
                                    <div style="min-width:0;">
                                        <div style="font-weight:700; font-size:0.78rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(h.title || h.case_number)}</div>
                                        <div style="font-size:0.70rem; color:var(--c-text-muted);">${escapeHtml(h.case_number)} · ${escapeHtml(h.category || "OPERATIONS")}</div>
                                    </div>
                                    <span class="card-badge" style="background:${h.status === 'RESOLVED' ? 'var(--c-emerald-tint)' : 'var(--c-amber-tint)'}; color:${h.status === 'RESOLVED' ? 'var(--c-emerald)' : 'var(--c-amber)'}; flex-shrink:0;">
                                        ${escapeHtml(h.status)}
                                    </span>
                                </a>
                            `).join("")}
                        </div>
                    ` : `
                        <div style="padding:14px; text-align:center; color:var(--c-text-muted); font-size:0.76rem; background:#f8fafc; border-radius:8px; border:1px dashed #cbd5e1;">
                            No prior tickets found for this requester.
                        </div>
                    `}
                </div>

            </div>
        </div>
    `;

    // Event Bindings
    // 1. Copy Email Button
    const btnCopyEmail = container.querySelector("#btnCopySenderEmail");
    if (btnCopyEmail) {
        btnCopyEmail.addEventListener("click", () => {
            navigator.clipboard.writeText(empDisplayEmail);
            showToast("Copied email to clipboard", "success");
        });
    }

    // 2. Copy Full Text Button
    const btnCopyBody = container.querySelector("#btnCopyMailBody");
    if (btnCopyBody) {
        btnCopyBody.addEventListener("click", () => {
            navigator.clipboard.writeText(em.body_plain || em.body || c.description || "");
            showToast("Copied full email text", "success");
        });
    }

    // 3. Quote in Reply Button
    const btnQuote = container.querySelector("#btnQuoteToDraft");
    if (btnQuote) {
        btnQuote.addEventListener("click", () => {
            const quoteText = `\n\n--- On ${formattedTime}, ${empDisplayName} wrote ---\n> ${String(em.body_plain || em.body || c.description || "").replace(/\n/g, '\n> ')}\n`;
            state.setDraft(quoteText + (state.activeDraft || ""));
            state.setStep(3); // Jump to response studio with draft pre-filled!
            showToast("Quoted message into Response Studio draft", "success");
        });
    }

    // 4. Trigger Intake Inquiry Button
    const btnIntakeInq = container.querySelector("#btnTriggerIntakeInquiry");
    if (btnIntakeInq) {
        btnIntakeInq.addEventListener("click", () => {
            const inqPreset = (pb.inquiry_presets || []).find(p => p.id === intakeGate.inquiryPresetId);
            const inqPrompt = inqPreset?.prompt_template || inqPreset?.prompt || `Hi ${empDisplayName},\n\nRegarding Case ${c.case_number}:\nTo proceed with your request, please provide the required information: ${intakeGate.missingItems.join(', ')}.\n\nWarm regards,\n${c.assigned_team || "Operations Desk"}`;
            state.setReplyTemplateMode("REQUEST_INFO");
            state.setDraft(inqPrompt);
            state.setStep(3); // Jump to response studio to dispatch!
            showToast("Loaded missing info inquiry draft in Response Studio", "info");
        });
    }

    // 5. Quick Add Subject Button
    const btnQuickAdd = container.querySelector("#btnQuickAddSubject");
    if (btnQuickAdd) {
        btnQuickAdd.addEventListener("click", async () => {
            try {
                await executeCaseAction(state.caseRef, {
                    action_type: "REGISTER_EMPLOYEE",
                    name: empDisplayName,
                    employee_id: empDisplayCode,
                    email: empDisplayEmail,
                    department: empDisplayDept,
                    designation: empDisplayRole,
                    manager_name: empDisplayMgr,
                    location: empDisplayLoc,
                });
                showToast(`Registered ${empDisplayName} into directory`, "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // 6. Review & Edit Subject Modal
    const btnEditModal = container.querySelector("#btnEditSubjectModal");
    if (btnEditModal) {
        btnEditModal.addEventListener("click", () => {
            state.emit("openModal", { modal: "employeeProfile" });
        });
    }

    // 7. Accept AI Classification Button
    const btnAcceptAi = container.querySelector("#btnAcceptAiClassification");
    if (btnAcceptAi) {
        btnAcceptAi.addEventListener("click", async () => {
            try {
                await executeCaseAction(state.caseRef, { action_type: "ACCEPT_AI" });
                showToast("AI classification verified and confirmed", "success");
                btnAcceptAi.disabled = true;
                btnAcceptAi.innerHTML = `<span>✓ Classification Confirmed</span>`;
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // 8. Proceed to Step 2 Button
    const btnProceed = container.querySelector("#btnProceedToStep2");
    if (btnProceed) {
        btnProceed.addEventListener("click", async () => {
            try {
                await setWorkflowStep(state.caseRef, 2);
                state.setStep(2);
                showToast("Advanced to Step 2: Audit & Verification", "success");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // 9. Duplicate / Recurring Case Actions
    const btnMerge = container.querySelector("#btnMergeIntoMatchedCase");
    if (btnMerge && dupMatch) {
        btnMerge.addEventListener("click", async () => {
            const confirmed = confirm(`Are you sure you want to merge this inquiry into Case #${dupMatch.matched_case_number}?\n\nAll thread messages will be consolidated into the parent docket, and this case will be resolved as MERGED.`);
            if (!confirmed) return;
            try {
                btnMerge.disabled = true;
                btnMerge.innerText = "Merging Docket...";
                await mergeCases(state.caseRef, dupMatch.matched_case_number, "Specialist merged duplicate recurring inquiry into parent docket");
                showToast(`Successfully merged into #${dupMatch.matched_case_number}`, "success");
                window.location.href = `casedetail.html?case=${encodeURIComponent(dupMatch.matched_case_number)}`;
            } catch (err) {
                btnMerge.disabled = false;
                btnMerge.innerText = `🔗 Follow & Merge into #${dupMatch.matched_case_number}`;
                showToast(err.message, "error");
            }
        });
    }

    const btnLink = container.querySelector("#btnLinkAsRelatedCase");
    if (btnLink && dupMatch) {
        btnLink.addEventListener("click", async () => {
            try {
                await linkCases(state.caseRef, dupMatch.matched_case_number, "RELATED");
                showToast(`Cross-linked with #${dupMatch.matched_case_number}`, "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    const btnDismissDup = container.querySelector("#btnDismissDupBanner");
    if (btnDismissDup) {
        btnDismissDup.addEventListener("click", () => {
            const banner = container.querySelector("#duplicateMatchBanner");
            if (banner) banner.style.display = "none";
            showToast("Dismissed recurring case suggestion", "info");
        });
    }

    // 10. Quote from conversation thread buttons
    container.querySelectorAll(".btn-quote-thread").forEach(btn => {
        btn.addEventListener("click", () => {
            const qIdx = Number(btn.dataset.quoteIdx);
            const msg = convThread[qIdx];
            if (!msg) return;
            const quoteText = `\n\n--- On ${formatDateTimeIST(msg.timestamp)}, ${msg.sender_name || "Requester"} wrote ---\n> ${String(msg.body || "").replace(/\n/g, '\n> ')}\n`;
            state.setDraft(quoteText + (state.activeDraft || ""));
            state.setStep(3); // Jump to Step 3 response studio
            showToast("Quoted message into Response Studio draft", "success");
        });
    });
}
