/**
 * stepper.js — Zone 2: Compact Universal 4-Stage Stepper
 */

import { escapeHtml } from "../utils.js";

export function renderStepper(currentStep = 1, caseStatus = "NEW") {
    const isResolved = ["RESOLVED", "CLOSED"].includes(String(caseStatus || "").toUpperCase());
    const effectiveStep = isResolved ? 4 : Math.min(Math.max(Number(currentStep) || 1, 1), 4);

    const stages = [
        { num: 1, label: "1. Intake & Identity" },
        { num: 2, label: "2. Policy & Audit" },
        { num: 3, label: "3. Action Execution" },
        { num: 4, label: "4. Resolution & Seal" },
    ];

    return `
        <div class="agent-universal-stepper-compact">
            <div class="stepper-compact-track">
                ${stages
                    .map((s, idx) => {
                        const isDone = effectiveStep > s.num || isResolved;
                        const isCurrent = effectiveStep === s.num && !isResolved;
                        return `
                            <div class="stepper-pill-node ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}">
                                <span class="node-icon">${isDone ? "✓" : s.num}</span>
                                <span class="node-label">${escapeHtml(s.label)}</span>
                            </div>
                            ${idx < stages.length - 1 ? `<div class="stepper-connector ${isDone ? "done" : ""}"></div>` : ""}
                        `;
                    })
                    .join("")}
            </div>
        </div>
    `;
}
