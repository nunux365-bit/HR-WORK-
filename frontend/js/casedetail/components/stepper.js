/**
 * HR Flow — Workflow Stepper Component (frontend/js/casedetail/components/stepper.js)
 */

import { escapeHtml } from "../utils/formatters.js";
import { setWorkflowStep } from "../api.js";
import { showToast } from "../utils/formatters.js";

export function renderStepper(container, state) {
    const c = state.caseData?.case || {};
    const stages = state.caseData?.workflow_stages || [
        { step: 1, label: "1. Details & Dossier", code: "DETAILS_DOSSIER" },
        { step: 2, label: "2. Query Lifecycle Audit", code: "AUDIT_SECTION" },
        { step: 3, label: "3. Response & Resolution", code: "RESPONSE_RESOLUTION" },
    ];
    const curStep = state.currentStep;
    const isResolved = c.status === "RESOLVED";

    let nodesHtml = "";
    stages.forEach((st, idx) => {
        const stepNum = st.step || (idx + 1);
        const isActive = !isResolved && curStep === stepNum;
        const isCompleted = isResolved || curStep > stepNum;
        const cleanLabel = (st.label || `Step ${stepNum}`).replace(/^\d+\.\s*/, "");

        nodesHtml += `
            <div class="stepper-node ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" data-step="${stepNum}">
                <div class="stepper-node-dot">
                    ${isCompleted ? '✓' : stepNum}
                </div>
                <span>${escapeHtml(cleanLabel)}</span>
            </div>
        `;

        if (idx < stages.length - 1) {
            nodesHtml += `<span class="stepper-arrow">→</span>`;
        }
    });

    container.innerHTML = `
        <div class="stepper-bar-container">
            <div class="stepper-pipeline">
                ${nodesHtml}
            </div>
            <button class="btn-add-stage" id="btnAddWorkflowStage">
                <span>+ Custom Stage</span>
            </button>
        </div>
    `;

    // Interactive step clicks
    container.querySelectorAll(".stepper-node").forEach(node => {
        node.addEventListener("click", async () => {
            const targetStep = Number(node.dataset.step);
            if (targetStep === state.currentStep) return;

            try {
                await setWorkflowStep(state.caseRef, targetStep);
                state.setStep(targetStep);
                showToast(`Switched to Step ${targetStep}`, "info");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    });

    const btnAddStage = container.querySelector("#btnAddWorkflowStage");
    if (btnAddStage) {
        btnAddStage.addEventListener("click", () => {
            state.emit("openModal", { modal: "addStage" });
        });
    }
}

