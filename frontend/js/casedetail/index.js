/**
 * HR Flow — Case 360° Operations Console Entrypoint (frontend/js/casedetail/index.js)
 */

import { CaseState } from "./state.js";
import { fetchDossier } from "./api.js";
import { showToast, escapeHtml } from "./utils/formatters.js";
import { renderHeader } from "./components/header.js";
import { renderStepper } from "./components/stepper.js";
import { renderStep1Dossier } from "./components/step1-dossier.js";
import { renderStep2Audit } from "./components/step2-audit.js";
import { renderStep3Response } from "./components/step3-response.js";
import { renderDossier } from "./components/dossier.js";
import { renderChecklist } from "./components/checklist.js";
import { renderForensics } from "./components/forensics.js";
import { renderComposer } from "./components/composer.js";
import { renderTimeline } from "./components/timeline.js";
import { initModals } from "./components/modals.js";

function getCaseRefFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("case") || params.get("id") || params.get("ref") || "CASE-000001";
}

async function loadCase(ref, isSilent = false) {
    if (!isSilent) {
        renderLoadingState(ref);
    }

    try {
        const dossier = await fetchDossier(ref);
        CaseState.initFromDossier(dossier, ref);
        document.title = `${ref} — Service Operations Console`;

        // Sync with Nexus Copilot Bot
        syncWithNexusBot(dossier);
    } catch (err) {
        console.error("Failed to load case dossier:", err);
        renderErrorState(ref, err.message);
    }
}

function syncWithNexusBot(dossier) {
    // Bot kept completely inactive per specialist instruction
    try {
        const botApi = window.NexusBot || window.AuraBot;
        if (botApi && typeof botApi.destroy === "function") {
            botApi.destroy();
        }
        const orb = document.getElementById("grokOrbContainer");
        if (orb) orb.remove();
        document.querySelectorAll(".grok-orb-container, .aura-bot-launcher, #nexusBotRoot, #workflowBotContainer, #auraSideSheet").forEach(el => el.remove());
    } catch (_) {}
}

function renderLoadingState(ref) {
    const mount = document.getElementById("casedetailWorkspaceMount");
    if (mount) {
        mount.innerHTML = `
            <div style="padding:120px 24px; text-align:center; color:var(--c-text-muted);">
                <div style="width:28px; height:28px; border:3px solid #e2e8f0; border-top-color:#2563eb; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 16px auto;"></div>
                <h2 style="font-size:1.15rem; font-weight:800; color:#0f172a; margin:0 0 6px 0;">Loading Case ${escapeHtml(ref)}...</h2>
                <p style="font-size:0.84rem; color:var(--c-text-muted); margin:0;">Aggregating 360° telemetry, verification checklist &amp; communications</p>
            </div>
            <style>
                @keyframes spin { 100% { transform: rotate(360deg); } }
            </style>
        `;
    }
}

function renderErrorState(ref, message) {
    const mount = document.getElementById("casedetailWorkspaceMount");
    if (mount) {
        mount.innerHTML = `
            <div style="max-width:540px; margin:80px auto; padding:36px; background:#ffffff; border-radius:16px; border:1px solid #fee2e2; text-align:center; box-shadow:0 10px 25px rgba(239,68,68,0.1);">
                <div style="font-size:2.5rem; margin-bottom:12px;">⚠️</div>
                <h2 style="font-size:1.2rem; font-weight:800; color:#dc2626; margin:0 0 8px 0;">Case Not Found or Inaccessible</h2>
                <p style="font-size:0.86rem; color:#64748b; margin:0 0 20px 0;">Could not load dossier for <strong>${escapeHtml(ref)}</strong>. ${escapeHtml(message)}</p>
                <a href="agent.html#cases" class="btn-action-pill primary" style="text-decoration:none; display:inline-flex;">← Back to Cases Queue</a>
            </div>
        `;
    }
}

function renderApp() {
    const headerMount = document.getElementById("casedetailHeaderMount");
    const stepperMount = document.getElementById("casedetailStepperMount");
    const workspaceMount = document.getElementById("casedetailWorkspaceMount");

    try {
        if (headerMount) renderHeader(headerMount, CaseState);
    } catch (hErr) {
        console.error("renderHeader error:", hErr);
    }

    try {
        if (stepperMount) renderStepper(stepperMount, CaseState);
    } catch (sErr) {
        console.error("renderStepper error:", sErr);
    }

    if (!workspaceMount) return;

    try {
        if (CaseState.viewMode === "GUIDED") {
            // Guided N-Stage Execution Router
            const cur = CaseState.currentStep;
            if (cur === 1) {
                renderStep1Dossier(workspaceMount, CaseState);
            } else if (cur === 2) {
                renderStep2Audit(workspaceMount, CaseState);
            } else {
                renderStep3Response(workspaceMount, CaseState);
            }
        } else {
            // FULL OVERVIEW MODE: 2 wide side-by-side columns
            workspaceMount.innerHTML = `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; height:100%; overflow-y:auto; padding:20px; box-sizing:border-box;">
                    <div style="display:flex; flex-direction:column; gap:16px;" id="colFullLeft"></div>
                    <div style="display:flex; flex-direction:column; gap:16px;" id="colFullRight"></div>
                </div>
            `;

            const leftCol = document.getElementById("colFullLeft");
            const rightCol = document.getElementById("colFullRight");

            if (leftCol) {
                const dContainer = document.createElement("div");
                renderDossier(dContainer, CaseState);
                leftCol.appendChild(dContainer);

                const tContainer = document.createElement("div");
                renderTimeline(tContainer, CaseState);
                leftCol.appendChild(tContainer);
            }

            if (rightCol) {
                const chkContainer = document.createElement("div");
                renderChecklist(chkContainer, CaseState);
                rightCol.appendChild(chkContainer);

                const fContainer = document.createElement("div");
                renderForensics(fContainer, CaseState);
                rightCol.appendChild(fContainer);

                const cContainer = document.createElement("div");
                renderComposer(cContainer, CaseState);
                rightCol.appendChild(cContainer);
            }
        }
    } catch (wErr) {
        console.error("Workspace render error:", wErr);
        workspaceMount.innerHTML = `
            <div style="max-width:700px; margin:40px auto; padding:24px; background:#ffffff; border-radius:12px; border:1px solid #fecaca; box-shadow:0 4px 15px rgba(239,68,68,0.08);">
                <h3 style="margin:0 0 8px 0; color:#dc2626; font-size:1.1rem;">⚠️ Workspace Display Encountered an Issue</h3>
                <p style="font-size:0.84rem; color:#64748b; margin:0 0 16px 0;">The workspace renderer encountered an unexpected error while preparing Step ${CaseState.currentStep}:</p>
                <pre style="background:#fef2f2; color:#991b1b; padding:12px; border-radius:8px; font-size:0.75rem; overflow-x:auto;">${escapeHtml(wErr.stack || wErr.message)}</pre>
                <div style="margin-top:16px; display:flex; gap:10px;">
                    <button class="btn-action-pill primary" onclick="location.reload()">Reload Console</button>
                    <a href="agent.html#cases" class="btn-action-pill" style="text-decoration:none;">Back to Cases Queue</a>
                </div>
            </div>
        `;
    }
}

// Activity Drawer Handler
function initTimelineDrawer() {
    const drawer = document.getElementById("casedetailTimelineDrawer");
    const backdrop = document.getElementById("casedetailDrawerBackdrop");
    const closeBtn = document.getElementById("btnCloseTimelineDrawer");
    const mount = document.getElementById("timelineDrawerMount");

    if (!drawer) return;

    const openDrawer = () => {
        if (mount) renderTimeline(mount, CaseState);
        drawer.classList.add("open");
        if (backdrop) backdrop.classList.add("open");
    };

    const closeDrawer = () => {
        drawer.classList.remove("open");
        if (backdrop) backdrop.classList.remove("open");
    };

    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    CaseState.on("toggleTimelineDrawer", () => {
        if (drawer.classList.contains("open")) {
            closeDrawer();
        } else {
            openDrawer();
        }
    });
}

// Bootstrap
function bootstrap() {
    initModals(CaseState);
    initTimelineDrawer();

    CaseState.on("loaded", () => {
        renderApp();
    });

    CaseState.on("stepChange", () => {
        renderApp();
    });

    CaseState.on("viewModeChange", () => {
        renderApp();
    });

    CaseState.on("refresh", () => {
        loadCase(CaseState.caseRef, true);
    });

    const caseRef = getCaseRefFromUrl();
    loadCase(caseRef);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
} else {
    bootstrap();
}
