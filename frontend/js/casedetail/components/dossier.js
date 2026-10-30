/**
 * HR Flow — Requester Dossier & Source Inquiry Component (frontend/js/casedetail/components/dossier.js)
 */

import { escapeHtml, formatDateTimeIST } from "../utils/formatters.js";

export function renderDossier(container, state) {
    const c = state.caseData?.case || {};
    const emp = state.caseData?.employee || {};
    const em = state.caseData?.email || {};
    const docs = state.caseData?.documents || [];

    const isInDb = Boolean(emp && (emp.is_in_db === true || (emp.is_in_db !== false && emp.id != null)));
    const empName = emp.name || c.employee_name || em.sender_name || "Requester";
    const empCode = emp.employee_id || c.employee_id || "";
    const empDept = emp.department || c.employee_department || "Operations";
    const empDesig = emp.designation || "Staff Specialist";
    const empEmail = emp.email || c.employee_email || em.sender_email || "requester@company.com";
    const empMgr = emp.manager_name || "Department Lead";
    const empLoc = emp.location || "Corporate Headquarters";

    // Combine email attachments and case documents
    const allAttachments = [];
    if (Array.isArray(em.attachments)) {
        em.attachments.forEach(att => allAttachments.push({
            filename: att.filename || "Attachment",
            size: att.size ? `${Math.round(att.size / 1024)} KB` : "Document",
            id: att.id,
        }));
    }
    if (Array.isArray(docs)) {
        docs.forEach(d => allAttachments.push({
            filename: d.filename || "Case Document",
            size: d.file_size_bytes ? `${Math.round(d.file_size_bytes / 1024)} KB` : "Document",
            id: d.id,
        }));
    }

    // Extracted Fields
    let extFields = c.extracted_fields?.fields || c.extracted_fields || {};
    if (typeof extFields === "string") {
        try { extFields = JSON.parse(extFields); } catch (_) { extFields = {}; }
    }
    const extEntries = Object.entries(extFields).filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && k !== "category" && k !== "attachment");

    let attachmentsHtml = "<span style='color:var(--c-text-muted); font-size:0.75rem;'>No attachments present</span>";
    if (allAttachments.length > 0) {
        attachmentsHtml = allAttachments.map(att => `
            <div class="attachment-chip" title="${escapeHtml(att.filename)}">
                <span>📎</span>
                <span style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(att.filename)}</span>
                <span style="color:var(--c-text-muted); font-size:0.68rem;">(${escapeHtml(att.size)})</span>
            </div>
        `).join("");
    }

    let extFieldsHtml = "<span style='color:var(--c-text-muted); font-size:0.75rem;'>No key parameters parsed</span>";
    if (extEntries.length > 0) {
        extFieldsHtml = extEntries.map(([k, v]) => `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:6px 10px;">
                <div style="font-size:0.68rem; text-transform:uppercase; color:var(--c-text-muted); font-weight:700;">${escapeHtml(k.replace(/_/g, ' '))}</div>
                <div style="font-size:0.80rem; font-weight:700; color:#0f172a; word-break:break-word;">${escapeHtml(String(v))}</div>
            </div>
        `).join("");
    }

    container.innerHTML = `
        <!-- Requester 360° Profile Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>👤</span>
                    <span>Requester 360°</span>
                </h2>
                <span class="card-badge" style="background:${isInDb ? 'var(--c-primary-tint)' : 'var(--c-amber-tint)'}; color:${isInDb ? 'var(--c-primary)' : 'var(--c-amber)'}; border:1px solid ${isInDb ? 'var(--c-primary-border)' : 'var(--c-amber-border)'};">
                    ${isInDb ? '✓ Directory Verified' : '⚠️ Unregistered'}
                </span>
            </div>

            <div class="requester-profile-grid">
                <div>
                    <div class="profile-field-label">Full Name</div>
                    <div class="profile-field-value">${escapeHtml(empName)}</div>
                </div>
                <div>
                    <div class="profile-field-label">Subject ID</div>
                    <div class="profile-field-value" style="color:${isInDb ? '#2563eb' : '#d97706'}">
                        ${escapeHtml(empCode || "Not Registered")}
                    </div>
                </div>
                <div>
                    <div class="profile-field-label">Work Email</div>
                    <div class="profile-field-value" style="font-size:0.74rem;">${escapeHtml(empEmail)}</div>
                </div>
                <div>
                    <div class="profile-field-label">Department</div>
                    <div class="profile-field-value">${escapeHtml(empDept)}</div>
                </div>
                <div>
                    <div class="profile-field-label">Designation</div>
                    <div class="profile-field-value">${escapeHtml(empDesig)}</div>
                </div>
                <div>
                    <div class="profile-field-label">Reporting Manager</div>
                    <div class="profile-field-value">${escapeHtml(empMgr)}</div>
                </div>
                <div style="grid-column: span 2;">
                    <div class="profile-field-label">Location / Site</div>
                    <div class="profile-field-value">${escapeHtml(empLoc)}</div>
                </div>
            </div>

            <div style="border-top:1px solid #f1f5f9; padding-top:10px; display:flex; justify-content:flex-end;">
                <button class="btn-action-pill" id="btnEditRequesterProfile" style="height:26px; font-size:0.72rem; padding:0 8px;">
                    <span>✏️ Edit Profile</span>
                </button>
            </div>
        </div>

        <!-- Inbound Inquiry Email & Thread Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>📩</span>
                    <span>Source Inquiry</span>
                </h2>
                <span class="card-badge" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;">
                    ${formatDateTimeIST(em.received_at || c.created_at)}
                </span>
            </div>

            <div>
                <div style="font-size:0.72rem; color:var(--c-text-muted); font-weight:700; margin-bottom:2px;">Subject:</div>
                <div style="font-size:0.86rem; font-weight:800; color:#0f172a; margin-bottom:8px;">${escapeHtml(em.subject || c.title || "HR Inquiry")}</div>
            </div>

            <div class="email-thread-box">
${escapeHtml(em.body || c.description || "No email body content available.")}
            </div>

            <div>
                <div style="font-size:0.72rem; color:var(--c-text-muted); font-weight:700; margin-bottom:6px;">Supporting Proofs &amp; Attachments:</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${attachmentsHtml}
                </div>
            </div>
        </div>

        <!-- Extracted Key Parameters Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>🔍</span>
                    <span>Extracted Metadata</span>
                </h2>
                <span class="card-badge" style="background:var(--c-primary-tint); color:var(--c-primary); border:1px solid var(--c-primary-border);">
                    ${extEntries.length} Detected
                </span>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                ${extFieldsHtml}
            </div>
        </div>
    `;

    const btnEdit = container.querySelector("#btnEditRequesterProfile");
    if (btnEdit) {
        btnEdit.addEventListener("click", () => {
            state.emit("openModal", { modal: "employeeProfile" });
        });
    }
}

