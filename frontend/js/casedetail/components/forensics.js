/**
 * HR Flow — Forensic Proof & System Diagnostics Component (frontend/js/casedetail/components/forensics.js)
 */

import { escapeHtml } from "../utils/formatters.js";
import { executeIntegrationAction } from "../api.js";
import { showToast } from "../utils/formatters.js";

export function renderForensics(container, state) {
    const pb = state.caseData?.playbook || {};
    const proofCfg = pb.proof_config || {};
    const presets = proofCfg.presets || [
        { id: "OK", label: "✓ Approved & Executed", metric: "Approved", notes: "Verified and executed per policy." },
        { id: "REJECT", label: "❌ Declined", metric: "Declined", notes: "Declined due to policy guidelines." },
    ];

    const refLabel = proofCfg.refLabel || "Reference / UTR / Docket ID";
    const refPlaceholder = proofCfg.refPlaceholder || "e.g. REF-2026-00129";
    const metricLabel = proofCfg.metricLabel || "Adjustment Amount / Metric";
    const metricPlaceholder = proofCfg.metricPlaceholder || "e.g. 1.0 Day, ₹ 0.00, Approved";

    const currentProof = state.forensicProof || {};
    const actions = state.caseData?.hr_actions || [];

    const presetsHtml = presets.map(p => `
        <button class="proof-preset-btn ${currentProof.notes === p.notes ? 'selected' : ''}" data-preset-id="${p.id}">
            ${escapeHtml(p.label)}
        </button>
    `).join("");

    let actionsListHtml = "<div style='color:var(--c-text-muted); font-size:0.75rem;'>No automated diagnostic actions run yet</div>";
    if (actions.length > 0) {
        actionsListHtml = actions.slice(0, 5).map(act => `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:6px 10px; font-size:0.75rem; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>${escapeHtml(act.title || act.action_type || "Diagnostic Check")}</strong>
                    <div style="color:var(--c-text-muted); font-size:0.68rem;">via ${escapeHtml(act.provider || "Enterprise API")}</div>
                </div>
                <span class="card-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0;">
                    ✓ ${escapeHtml(act.status || "COMPLETED")}
                </span>
            </div>
        `).join("");
    }

    container.innerHTML = `
        <!-- Forensic Proof Verification Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>🔬</span>
                    <span>Forensic Evidence &amp; Proof</span>
                </h2>
                <span class="card-badge" style="background:var(--c-emerald-tint); color:var(--c-emerald); border:1px solid var(--c-emerald-border);">
                    Proof ID Required
                </span>
            </div>

            <div>
                <div style="font-size:0.72rem; color:var(--c-text-muted); font-weight:700; margin-bottom:6px;">Quick Forensic Presets:</div>
                <div class="proof-preset-strip">
                    ${presetsHtml}
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                    <label class="profile-field-label">${escapeHtml(refLabel)}</label>
                    <input type="text" class="form-input-field" id="inputForensicProofId" placeholder="${escapeHtml(refPlaceholder)}" value="${escapeHtml(currentProof.proofId || '')}">
                </div>
                <div>
                    <label class="profile-field-label">${escapeHtml(metricLabel)}</label>
                    <input type="text" class="form-input-field" id="inputForensicMetric" placeholder="${escapeHtml(metricPlaceholder)}" value="${escapeHtml(currentProof.metric || '')}">
                </div>
            </div>

            <div>
                <label class="profile-field-label">Audit Notes &amp; Findings</label>
                <textarea class="form-input-field" id="inputForensicNotes" rows="2" placeholder="Record investigation findings..." style="resize:vertical;">${escapeHtml(currentProof.notes || '')}</textarea>
            </div>
        </div>

        <!-- System Diagnostics & Executed Actions Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>⚡</span>
                    <span>Live Diagnostic Actions</span>
                </h2>
                <button class="btn-action-pill" id="btnRunSystemDiagnostic" style="height:26px; font-size:0.72rem; padding:0 8px;">
                    <span>▶ Run Diagnostic</span>
                </button>
            </div>

            <div style="display:flex; flex-direction:column; gap:6px;">
                ${actionsListHtml}
            </div>
        </div>
    `;

    // Presets click binding
    container.querySelectorAll(".proof-preset-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const pId = btn.dataset.presetId;
            const p = presets.find(x => x.id === pId);
            if (!p) return;

            const newProof = {
                verdict: p.verdict || "RESOLVED",
                notes: p.notes || "",
                metric: p.metric || "",
                proofId: p.refPrefix ? `${p.refPrefix}-${Date.now().toString().slice(-6)}` : state.forensicProof.proofId,
            };

            state.setForensicProof(newProof);

            // Update inputs
            const inRef = container.querySelector("#inputForensicProofId");
            const inMet = container.querySelector("#inputForensicMetric");
            const inNot = container.querySelector("#inputForensicNotes");
            if (inRef) inRef.value = newProof.proofId || "";
            if (inMet) inMet.value = newProof.metric || "";
            if (inNot) inNot.value = newProof.notes || "";

            showToast(`Applied preset: ${p.label}`, "info");
        });
    });

    // Inputs change binding
    const inRef = container.querySelector("#inputForensicProofId");
    const inMet = container.querySelector("#inputForensicMetric");
    const inNot = container.querySelector("#inputForensicNotes");

    if (inRef) inRef.addEventListener("input", (e) => state.setForensicProof({ proofId: e.target.value }));
    if (inMet) inMet.addEventListener("input", (e) => state.setForensicProof({ metric: e.target.value }));
    if (inNot) inNot.addEventListener("input", (e) => state.setForensicProof({ notes: e.target.value }));

    // Run diagnostic action button
    const btnDiag = container.querySelector("#btnRunSystemDiagnostic");
    if (btnDiag) {
        btnDiag.addEventListener("click", async () => {
            try {
                const actName = `Verify ${pb.display_name || 'Department'} Records`;
                const res = await executeIntegrationAction(state.caseRef, "DIAGNOSTIC_CHECK", actName, "Enterprise Cloud Adapter", "Automated system diagnostics completed. Telemetry matched.");
                if (!state.caseData.hr_actions) state.caseData.hr_actions = [];
                state.caseData.hr_actions.unshift(res);
                showToast("System diagnostic executed successfully", "success");
                state.emit("change", state.caseData);
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }
}

