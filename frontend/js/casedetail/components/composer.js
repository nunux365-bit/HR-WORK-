/**
 * HR Flow — Omnichannel Response Studio Component (frontend/js/casedetail/components/composer.js)
 * Canned Communication Presets, Dynamic Merge Tags, Auto-Saving Draft Studio & SMTP Dispatcher.
 */

import { escapeHtml } from "../utils/formatters.js";
import { sendReply, saveDraft } from "../api.js";
import { showToast } from "../utils/formatters.js";

let saveDebounceTimer = null;

export function renderComposer(container, state) {
    const c = state.caseData?.case || {};
    const em = state.caseData?.email || {};
    const emp = state.caseData?.employee || {};
    const inquiries = state.caseData?.inquiry_presets || [];
    const smartTemplates = state.caseData?.smart_templates || {};

    const currentMode = state.replyTemplateMode || "UPDATE";
    const currentDraft = state.activeDraft || "";
    const recipientEmail = emp.email || c.employee_email || em.sender_email || "requester@company.com";
    const recipientName = emp.name || c.employee_name || em.sender_name || "Requester";

    const inquiryOptionsHtml = inquiries.map(inq => `
        <option value="${inq.id}">${escapeHtml(inq.label)}</option>
    `).join("");

    container.innerHTML = `
        <!-- Response Studio Card -->
        <div class="panel-card">
            <div class="card-header">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:1.1rem;">💬</span>
                    <h2 class="card-title" style="margin:0;">Omnichannel Response Studio</h2>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span class="card-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;" title="Outbound email connected to SMTP direct gateway">
                        ⚡ SMTP Live
                    </span>
                    <span id="draftSavedIndicator" style="font-size:0.72rem; color:var(--c-emerald); font-weight:700;">
                        ✓ Saved to Cloud
                    </span>
                </div>
            </div>

            <!-- Recipient Addressing Strip -->
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
                <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                    <span style="font-size:0.75rem; color:var(--c-text-muted); font-weight:700;">To:</span>
                    <strong style="font-size:0.82rem; color:#0f172a;">${escapeHtml(recipientName)}</strong>
                    <span style="font-size:0.75rem; color:var(--c-text-muted);">&lt;${escapeHtml(recipientEmail)}&gt;</span>
                </div>
                <span class="card-badge" style="background:#f1f5f9; color:#475569; font-size:0.68rem;">
                    Re: [${escapeHtml(c.case_number || state.caseRef)}] ${escapeHtml(c.title || "Inquiry")}
                </span>
            </div>

            <!-- Canned Response Mode Chips -->
            <div>
                <div style="font-size:0.70rem; color:var(--c-text-muted); font-weight:800; text-transform:uppercase; margin-bottom:6px;">
                    Canned Action Templates:
                </div>
                <div class="canned-templates-strip" style="display:flex; flex-wrap:wrap; gap:6px;">
                    <button type="button" class="btn-action-pill canned-tpl-chip ${currentMode === 'APPROVE' ? 'active' : ''}" data-mode="APPROVE" style="height:28px; font-size:0.74rem;">
                        ✓ Approve Request
                    </button>
                    <button type="button" class="btn-action-pill canned-tpl-chip ${currentMode === 'REQUEST_INFO' ? 'active' : ''}" data-mode="REQUEST_INFO" style="height:28px; font-size:0.74rem;">
                        ❓ Request Information
                    </button>
                    <button type="button" class="btn-action-pill canned-tpl-chip ${currentMode === 'UPDATE' ? 'active' : ''}" data-mode="UPDATE" style="height:28px; font-size:0.74rem;">
                        ℹ️ Progress Status Update
                    </button>
                    <button type="button" class="btn-action-pill canned-tpl-chip ${currentMode === 'REJECT' ? 'active' : ''}" data-mode="REJECT" style="height:28px; font-size:0.74rem;">
                        ❌ Decline Request
                    </button>
                </div>
            </div>

            <!-- Dynamic Inquiry Presets from Playbook -->
            ${inquiries.length > 0 ? `
            <div>
                <label class="profile-field-label" style="font-size:0.70rem; font-weight:700; color:#64748b; text-transform:uppercase;">
                    Specialist Clarification Presets:
                </label>
                <select class="form-input-field" id="selectInquiryPreset" style="height:32px; font-size:0.78rem; padding:0 8px;">
                    <option value="">-- Choose playbook inquiry template --</option>
                    ${inquiryOptionsHtml}
                </select>
            </div>
            ` : ''}

            <!-- Merge Tag Inserters -->
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-size:0.68rem; font-weight:700; color:var(--c-text-muted); text-transform:uppercase;">Insert Tag:</span>
                <button type="button" class="btn-insert-tag" data-tag="{{employeeName}}">+ Name</button>
                <button type="button" class="btn-insert-tag" data-tag="{{caseNumber}}">+ Case #</button>
                <button type="button" class="btn-insert-tag" data-tag="{{proofId}}">+ Proof ID</button>
                <button type="button" class="btn-insert-tag" data-tag="{{agentName}}">+ My Name</button>
                <button type="button" class="btn-insert-tag" data-tag="{{teamName}}">+ Team</button>
            </div>

            <!-- Response Textarea -->
            <div>
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <label class="profile-field-label" style="font-size:0.70rem; font-weight:700; color:#64748b; text-transform:uppercase;">Official Response Draft</label>
                    <span id="composerCharCount" style="font-size:0.70rem; color:var(--c-text-muted);">${currentDraft.length} characters</span>
                </div>
                <textarea class="response-textarea form-input-field" id="textareaCaseReply" rows="7" placeholder="Compose official response to requester..." style="font-family:'Inter', sans-serif; font-size:0.84rem; line-height:1.6; resize:vertical; padding:12px;">${escapeHtml(currentDraft)}</textarea>
            </div>

            <!-- Dispatch Action Buttons -->
            <div style="display:flex; gap:10px; border-top:1px solid #f1f5f9; padding-top:12px;">
                <button type="button" class="btn-action-pill" id="btnComposerRequestInfo" style="flex:1; justify-content:center; color:#b45309; border-color:#fde68a; background:#fffbeb; height:36px; font-size:0.80rem;">
                    <span>❓ Request Missing Details (Set On-Hold)</span>
                </button>
                <button type="button" class="btn-action-pill primary" id="btnComposerSendReply" style="flex:1; justify-content:center; height:36px; font-size:0.82rem; font-weight:700;">
                    <span>📤 Dispatch Official Reply via SMTP</span>
                </button>
            </div>
        </div>
    `;

    // Canned Mode Click
    container.querySelectorAll(".canned-tpl-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const mode = chip.dataset.mode;
            state.setReplyTemplateMode(mode);
            const ta = container.querySelector("#textareaCaseReply");
            if (ta) ta.value = state.activeDraft;
            container.querySelectorAll(".canned-tpl-chip").forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            showToast(`Loaded ${mode} response template`, "info");
        });
    });

    // Inquiry Preset Dropdown
    const selInq = container.querySelector("#selectInquiryPreset");
    if (selInq) {
        selInq.addEventListener("change", (e) => {
            const inqId = e.target.value;
            if (!inqId) return;
            const inq = inquiries.find(x => x.id === inqId);
            if (inq && inq.prompt) {
                state.setDraft(inq.prompt);
                const ta = container.querySelector("#textareaCaseReply");
                if (ta) ta.value = inq.prompt;
                showToast(`Loaded template: ${inq.label}`, "info");
            }
        });
    }

    // Insert Tag Buttons
    const ta = container.querySelector("#textareaCaseReply");
    container.querySelectorAll(".btn-insert-tag").forEach(btn => {
        btn.addEventListener("click", () => {
            const tag = btn.dataset.tag;
            if (!ta) return;
            const start = ta.selectionStart || ta.value.length;
            const end = ta.selectionEnd || ta.value.length;
            const text = ta.value;
            ta.value = text.substring(0, start) + tag + text.substring(end);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + tag.length;
            ta.dispatchEvent(new Event("input"));
        });
    });

    // Textarea input & debounced saveDraft to database
    const indicator = container.querySelector("#draftSavedIndicator");
    const charCount = container.querySelector("#composerCharCount");

    if (ta) {
        ta.addEventListener("input", (e) => {
            const val = e.target.value;
            state.activeDraft = val;
            if (charCount) charCount.textContent = `${val.length} characters`;
            if (indicator) {
                indicator.textContent = "Saving draft...";
                indicator.style.color = "var(--c-amber)";
            }

            clearTimeout(saveDebounceTimer);
            saveDebounceTimer = setTimeout(async () => {
                try {
                    await saveDraft(state.caseRef, val);
                    if (indicator) {
                        indicator.textContent = "✓ Saved to Cloud";
                        indicator.style.color = "var(--c-emerald)";
                    }
                } catch (_) {}
            }, 800);
        });
    }

    // Send Reply Button
    const btnSend = container.querySelector("#btnComposerSendReply");
    if (btnSend) {
        btnSend.addEventListener("click", async () => {
            const bodyText = (ta?.value || "").trim();
            if (!bodyText) {
                showToast("Reply message cannot be empty", "error");
                return;
            }
            try {
                btnSend.disabled = true;
                btnSend.textContent = "Dispatching via SMTP...";
                await sendReply(state.caseRef, bodyText, false, "IN_PROGRESS", recipientEmail);
                showToast("Official reply dispatched via SMTP to " + recipientEmail, "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                btnSend.disabled = false;
                btnSend.innerHTML = `<span>📤 Dispatch Official Reply via SMTP</span>`;
            }
        });
    }

    // Request Info Button
    const btnReqInfo = container.querySelector("#btnComposerRequestInfo");
    if (btnReqInfo) {
        btnReqInfo.addEventListener("click", async () => {
            const bodyText = (ta?.value || "").trim();
            if (!bodyText) {
                showToast("Request body cannot be empty", "error");
                return;
            }
            try {
                btnReqInfo.disabled = true;
                btnReqInfo.textContent = "Sending inquiry...";
                await sendReply(state.caseRef, bodyText, true, "ON_HOLD", recipientEmail);
                showToast("Clarification inquiry sent (Status -> On Hold)", "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                btnReqInfo.disabled = false;
                btnReqInfo.innerHTML = `<span>❓ Request Missing Details (Set On-Hold)</span>`;
            }
        });
    }
}
