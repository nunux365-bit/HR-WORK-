/**
 * index.js — Agent Execution Workbench Master Controller
 * Clean 2-Pane Architecture, Smart Queue Defaulting, and Non-destructive Background Sync.
 */

import { Store } from "./state.js";
import { AgentAPI } from "./api.js";
import { renderHeader } from "./components/header.js";
import { renderWorkfeed, bindWorkfeedEvents } from "./components/workfeed.js";
import { renderStepper } from "./components/stepper.js";
import { renderDossier, bindDossierEvents } from "./components/dossier.js";
import { renderActionHub, bindActionHubEvents } from "./components/actionHub.js";
import { renderModals, bindModalEvents } from "./components/modals.js";
import { escapeHtml } from "./utils.js";

async function loadWorkbenchData(preserveSelection = true, targetDeptId = null) {
    const urlParams = new URLSearchParams(window.location.search);
    const welcomeUser = (urlParams.get("welcome_user") || urlParams.get("email") || "").trim().toLowerCase();
    const agentIdParam = urlParams.get("agent_id");
    const sessionUser = AgentAPI.getSessionUser();
    const queryEmail = welcomeUser || (sessionUser?.role === "HR_AGENT" ? sessionUser.email : "") || "";
    const queryAgentId = agentIdParam || "";

    let activeDeptId = targetDeptId || localStorage.getItem("hrflow_agent_active_dept_id") || urlParams.get("dept_id") || "";

    try {
        Store.setState({ isSyncing: true });
        const data = await AgentAPI.fetchWorkbench({
            email: queryEmail,
            agentId: queryAgentId,
            deptId: activeDeptId,
        });

        const ag = data.agent || {};
        const cases = data.dept_cases || data.all_cases || [];
        const myCases = data.my_cases || [];
        const unclaimed = data.unclaimed_cases || [];
        const allAgents = data.all_agents || [];
        const currentActiveDeptId = ag.active_dept_id || activeDeptId || 1;
        const currentActiveDeptName = ag.active_dept_name || ag.team_name || "HR Operations";

        try {
            localStorage.setItem("hrflow_agent_active_dept_id", String(currentActiveDeptId));
        } catch (_) {}

        // Put initial state
        Store.setState({
            agent: ag,
            kpis: data.kpis || {},
            cases: cases,
            myCases: myCases,
            unclaimedCases: unclaimed,
            allAgents: allAgents,
            activeDeptId: currentActiveDeptId,
            activeDeptName: currentActiveDeptName,
            isLoading: false,
            isSyncing: false,
            lastSyncTimestamp: Date.now(),
        });

        // Smart default queue filter:
        const counts = Store.getQueueCounts();
        let targetFilter = Store.getState().activeQueueFilter;
        if (!preserveSelection || targetFilter === "ALL") {
            if (counts.myActive > 0) {
                targetFilter = "MY_QUEUE";
            } else if (counts.unclaimed > 0) {
                targetFilter = "UNCLAIMED";
            } else {
                targetFilter = "ALL";
            }
        }
        Store.setState({ activeQueueFilter: targetFilter });

        // Select initial case
        let nextSelectedRef = Store.getState().activeCaseRef;
        if (!preserveSelection || !nextSelectedRef) {
            const filtered = Store.getFilteredCases();
            if (filtered.length > 0) {
                nextSelectedRef = filtered[0].case_number || filtered[0].id;
            } else if (cases.length > 0) {
                nextSelectedRef = cases[0].case_number || cases[0].id;
            }
        }
        Store.setState({ activeCaseRef: nextSelectedRef });

        // Load active case details
        if (nextSelectedRef) {
            await loadActiveCaseDetail(nextSelectedRef);
        }

        // Render full workbench
        renderEntireWorkbench();
    } catch (err) {
        console.error("Failed to load HR Agent Workbench:", err);
        Store.setState({ isLoading: false, isSyncing: false });
        renderErrorState(err.message);
    }
}

async function loadActiveCaseDetail(caseRef) {
    if (!caseRef) {
        Store.setState({ activeCaseDetail: null });
        renderExecutionPane();
        return;
    }

    try {
        Store.setState({ isDetailLoading: true });
        const detail = await AgentAPI.fetchCaseDetail(caseRef);
        Store.setState({
            activeCaseDetail: detail,
            isDetailLoading: false,
        });
        renderExecutionPane();
    } catch (err) {
        console.warn("Failed to load case detail:", err);
        Store.setState({ isDetailLoading: false });
    }
}

// -----------------------------------------------------------------------------
// RENDERERS (CLEAN 2-PANE FLUID LAYOUT)
// -----------------------------------------------------------------------------
function renderEntireWorkbench() {
    renderHeader();

    const root = document.getElementById("agentWorkbenchRoot");
    if (!root) return;

    const state = Store.getState();
    const toast = state.toast;

    root.innerHTML = `
        ${
            toast
                ? `
            <div class="agent-floating-toast toast-${toast.type}">
                <span>✓ ${escapeHtml(toast.text)}</span>
            </div>
        `
                : ""
        }

        <div class="agent-2pane-workspace">
            <!-- PANE 1: SMART WORKFEED & QUEUE DOCK (LEFT) -->
            <div id="workfeedPaneContainer" class="agent-workfeed-container"></div>

            <!-- PANE 2: 360° EXECUTION DOSSIER & ACTION HUB (RIGHT) -->
            <div id="executionPaneContainer" class="agent-execution-container"></div>
        </div>

        <!-- OVERLAY MODALS -->
        <div id="modalsContainer"></div>
    `;

    renderWorkfeedPane();
    renderExecutionPane();
    renderModalsContainer();
}

function renderWorkfeedPane() {
    const container = document.getElementById("workfeedPaneContainer");
    if (!container) return;
    container.innerHTML = renderWorkfeed();
    bindWorkfeedEvents(container);
}

function renderExecutionPane() {
    const container = document.getElementById("executionPaneContainer");
    if (!container) return;

    const state = Store.getState();
    const caseData = state.activeCaseDetail;
    const isDetailLoading = state.isDetailLoading;

    if (isDetailLoading) {
        container.innerHTML = `
            <div class="dossier-loading-state">
                <div class="spinner-ring"></div>
                <span>Loading 360° Case Dossier...</span>
            </div>
        `;
        return;
    }

    if (!caseData) {
        container.innerHTML = renderDossier(null);
        return;
    }

    const c = caseData.case || caseData;

    container.innerHTML = `
        <div class="execution-scroll-inner">
            <!-- Sleek 4-Stage Stepper -->
            ${renderStepper(c.current_step, c.status)}

            <!-- Case Dossier Header & Employee Telemetry Bento Cards -->
            ${renderDossier(caseData)}

            <!-- Interactive Action Hub (Checklist, Inquire, Diagnostics, Approvals, Composer) -->
            ${renderActionHub(caseData)}
        </div>
    `;

    bindDossierEvents(container);
    bindActionHubEvents(container);
}

function renderModalsContainer() {
    const container = document.getElementById("modalsContainer");
    if (!container) return;
    container.innerHTML = renderModals();
    bindModalEvents(container);
}

function renderErrorState(errMsg) {
    const root = document.getElementById("agentWorkbenchRoot");
    if (!root) return;
    root.innerHTML = `
        <div class="agent-error-state">
            <div class="error-icon">⚠️</div>
            <h3>Could not connect to HR Flow Backend</h3>
            <p>${escapeHtml(errMsg || "Make sure backend/server.py is running on port 5000.")}</p>
            <button type="button" class="btn-action-primary" onclick="window.location.reload()">
                Retry Connection
            </button>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// INTELLIGENT NON-DESTRUCTIVE POLLING (DELTA SYNC)
// -----------------------------------------------------------------------------
let _syncIntervalId = null;

function startSmartSync() {
    if (_syncIntervalId) clearInterval(_syncIntervalId);

    _syncIntervalId = setInterval(async () => {
        if (document.visibilityState === "hidden") return;
        if (Store.getState().activeModal) return;

        const activeElem = document.activeElement;
        if (activeElem && (activeElem.tagName === "INPUT" || activeElem.tagName === "TEXTAREA")) {
            return;
        }

        try {
            const ag = Store.getState().agent;
            if (!ag) return;
            const data = await AgentAPI.fetchWorkbench({
                email: ag.email,
                deptId: Store.getState().activeDeptId,
            });

            const newCases = data.dept_cases || data.all_cases || [];
            const newMyCases = data.my_cases || [];
            const newUnclaimed = data.unclaimed_cases || [];

            Store.setState({
                kpis: data.kpis || {},
                cases: newCases,
                myCases: newMyCases,
                unclaimedCases: newUnclaimed,
                lastSyncTimestamp: Date.now(),
            });

            renderWorkfeedPane();
        } catch (err) {
            console.debug("Silent background sync note:", err);
        }
    }, 10000);
}

// -----------------------------------------------------------------------------
// GLOBAL HOOKS & INIT
// -----------------------------------------------------------------------------
if (typeof window !== "undefined") {
    window.refreshWorkbenchData = (preserveSelection = true, targetDeptId = null) => {
        return loadWorkbenchData(preserveSelection, targetDeptId);
    };
}

// Store subscriber for targeted re-renders
Store.subscribe((state, changedKeys) => {
    if (changedKeys.includes("activeCaseRef")) {
        loadActiveCaseDetail(state.activeCaseRef);
    }
    if (
        changedKeys.includes("activeQueueFilter") ||
        changedKeys.includes("activeCategoryFilter") ||
        changedKeys.includes("searchQuery")
    ) {
        renderWorkfeedPane();
    }
    if (changedKeys.includes("activeHubTab")) {
        renderExecutionPane();
    }
    if (changedKeys.includes("activeModal")) {
        renderModalsContainer();
    }
    if (changedKeys.includes("toast")) {
        if (typeof document !== "undefined") {
            const existingToast = document.querySelector(".agent-floating-toast");
            if (state.toast) {
                if (existingToast) {
                    existingToast.className = `agent-floating-toast toast-${state.toast.type}`;
                    existingToast.innerHTML = `<span>✓ ${escapeHtml(state.toast.text)}</span>`;
                } else {
                    const toastEl = document.createElement("div");
                    toastEl.className = `agent-floating-toast toast-${state.toast.type}`;
                    toastEl.innerHTML = `<span>✓ ${escapeHtml(state.toast.text)}</span>`;
                    document.body.appendChild(toastEl);
                }
            } else if (existingToast) {
                existingToast.remove();
            }
        }
    }
});

// Initialization on DOMContentLoaded
function initAgentApp() {
    loadWorkbenchData(false);
    startSmartSync();
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAgentApp);
    } else {
        initAgentApp();
    }
}
