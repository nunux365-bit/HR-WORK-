/**
 * HR FLOW — Enterprise Workflow Architect Controller (WorkFlow/frontend/app.js)
 * Modern, zero-icon, typography-driven execution engine.
 * Directly integrates with HR Flow backend APIs (/api/workflows and /api/agent/cases).
 */

document.addEventListener("DOMContentLoaded", () => {
    // API Endpoints
    const BACKEND_BASE = window.location.origin;
    const API_WORKFLOWS = `${BACKEND_BASE}/api/workflows`;
    const API_CASES = `${BACKEND_BASE}/api/agent/cases`;

    // State
    let currentWorkflowId = "WF-LEAVE-001";
    let currentCategory = "LEAVE";
    let activeWorkflowData = null;
    let activeCaseId = null;
    let activeCaseData = null;

    let nodes = {}; // id -> { id, type, title, tag, badge, provider, desc, expression, sla, colorClass, x, y, el }
    let connections = []; // { id, fromId, toId, pathEl }
    let nodeIdCounter = 1;

    let zoom = 1;
    let panX = 60;
    let panY = 60;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    let isDrawingConnection = false;
    let drawingStartNodeId = null;
    let drawingStartPort = null;
    let drawingStartX = 0;
    let drawingStartY = 0;

    let activeSelectedElement = null; // { type: 'node' | 'connection', obj: ... }
    let isSimulating = false;

    // DOM Elements
    const canvasContainer = document.getElementById("canvas-container");
    const canvasInner = document.getElementById("canvas-inner");
    const svgCanvas = document.getElementById("svg-canvas");
    const nodesContainer = document.getElementById("nodes-container");
    const tempLine = document.getElementById("temp-connection-line");

    const blueprintSelect = document.getElementById("blueprint-select");
    const caseLinkSelect = document.getElementById("case-link-select");
    const pipelineStatusText = document.getElementById("pipeline-status-text");

    const librarySearchInput = document.getElementById("library-search-input");
    const libraryContent = document.getElementById("library-content");
    const libraryCountBadge = document.getElementById("library-count-badge");

    const inspectorPanel = document.getElementById("inspector-panel");
    const inspectorNodeId = document.getElementById("inspector-node-id");
    const nodeFieldTitle = document.getElementById("node-field-title");
    const nodeFieldFamily = document.getElementById("node-field-family");
    const nodeFieldProvider = document.getElementById("node-field-provider");
    const nodeFieldDesc = document.getElementById("node-field-desc");
    const nodeFieldExpression = document.getElementById("node-field-expression");
    const nodeFieldSla = document.getElementById("node-field-sla");
    const btnTestNodeAction = document.getElementById("btn-test-node-action");
    const testOutputWrap = document.getElementById("test-output-wrap");
    const nodeTestOutput = document.getElementById("node-test-output");
    const btnSaveNodeFields = document.getElementById("btn-save-node-fields");
    const btnDeleteActiveNode = document.getElementById("btn-delete-active-node");
    const btnCloseInspector = document.getElementById("btn-close-inspector");

    const simConsoleDrawer = document.getElementById("sim-console-drawer");
    const simLogsMount = document.getElementById("sim-logs-mount");
    const btnClearSimLogs = document.getElementById("btn-clear-sim-logs");
    const btnCloseSimConsole = document.getElementById("btn-close-sim-console");

    const btnSimulatePipeline = document.getElementById("btn-simulate-pipeline");
    const btnSaveBlueprint = document.getElementById("btn-save-blueprint");
    const btnDeployEngine = document.getElementById("btn-deploy-engine");

    const btnZoomIn = document.getElementById("btn-zoom-in");
    const btnZoomOut = document.getElementById("btn-zoom-out");
    const btnZoomFit = document.getElementById("btn-zoom-fit");
    const btnRealignGrid = document.getElementById("btn-realign-grid");
    const zoomLevelText = document.getElementById("zoom-level-text");

    // =========================================================================
    // 1. INITIALIZATION & WORKFLOW LOADING
    // =========================================================================

    async function initStudio() {
        renderNodeLibrary();
        setupCanvasInteractions();
        bindTopControls();

        // Parse query params for direct deep-linking from casedetail.html
        const params = new URLSearchParams(window.location.search);
        const qWf = params.get("workflow");
        const qCase = params.get("case");

        await loadAvailableCases();

        if (qWf) {
            blueprintSelect.value = qWf;
            currentWorkflowId = qWf;
        }

        if (qCase) {
            caseLinkSelect.value = qCase;
            activeCaseId = qCase;
        }

        await loadWorkflowBlueprint(blueprintSelect.value);
    }

    async function loadAvailableCases() {
        try {
            const res = await fetch(`${API_CASES}?limit=15`);
            if (!res.ok) return;
            const data = await res.json();
            const casesList = data.data?.cases || data.cases || [];

            caseLinkSelect.innerHTML = `<option value="">[Standalone Blueprint Mode]</option>`;
            casesList.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.case_reference;
                opt.textContent = `${c.case_reference} · ${c.employee_name || "Employee"} (${c.category || "HR"})`;
                caseLinkSelect.appendChild(opt);
            });
        } catch (e) {
            console.warn("Could not fetch active cases for selector:", e);
        }
    }

    async function loadWorkflowBlueprint(wfId) {
        clearCanvas();
        currentWorkflowId = wfId;

        try {
            // First try fetching real workflow details from backend
            const res = await fetch(`${API_WORKFLOWS}/${encodeURIComponent(wfId)}`);
            if (res.ok) {
                const json = await res.json();
                activeWorkflowData = json.data?.workflow || json.workflow || json.data;
            }
        } catch (e) {
            console.warn("Backend workflow detail fetch error:", e);
        }

        // If backend returned blueprint, build nodes from it, else fallback to standard enterprise template
        if (activeWorkflowData && activeWorkflowData.node_boxes && activeWorkflowData.node_boxes.length > 0) {
            buildGraphFromBackendNodes(activeWorkflowData);
        } else {
            buildDefaultBlueprint(wfId);
        }

        // If a case is linked, highlight its active step
        if (activeCaseId) {
            highlightCaseProgress(activeCaseId);
        }

        setTimeout(() => fitToView(), 150);
    }

    function buildGraphFromBackendNodes(wf) {
        currentCategory = (wf.category || "LEAVE").toUpperCase();
        pipelineStatusText.textContent = `${wf.name || wf.workflow_id} (v${wf.version || "2.1"})`;

        const boxList = wf.node_boxes || [];
        const createdIds = [];

        boxList.forEach((box, idx) => {
            const col = getBoxColorClass(box.box_type);
            const isSubBranch = (box.state === "PENDING_BANK_DETAILS" || String(box.state).includes("DECLINED") || String(box.state).includes("EXCEPTION"));
            const x = (typeof box.x === "number") ? box.x : (isSubBranch ? 400 : (60 + idx * 340));
            const y = (typeof box.y === "number") ? box.y : (isSubBranch ? 380 : 160);

            const nId = createNodeOnCanvas({
                title: box.label || box.state.replace(/_/g, " "),
                type: box.box_type || "DATA",
                tag: `[${(box.box_type || "STEP").toUpperCase()}]`,
                badge: `ST-0${idx + 1}`,
                provider: getProviderForBoxType(box.box_type, currentCategory),
                desc: box.actions && box.actions.length ? `Actions: ${box.actions.join(", ")}` : `State: ${box.state}`,
                expression: wf.automation_config?.expression || "",
                sla: idx === 0 ? "Instant" : "24h SLA",
                colorClass: col,
                x: x,
                y: y,
                stateKey: box.state
            });
            createdIds.push({ state: box.state, id: nId });
        });

        // Wire transitions
        boxList.forEach(box => {
            const fromObj = createdIds.find(item => item.state === box.state);
            if (!fromObj || !box.outgoing_transitions) return;

            box.outgoing_transitions.forEach(tr => {
                const toObj = createdIds.find(item => item.state === tr.to_state);
                if (toObj && fromObj.id !== toObj.id) {
                    createConnection(fromObj.id, toObj.id);
                }
            });
        });

        // If no explicit transitions wired, connect sequentially
        if (connections.length === 0 && createdIds.length > 1) {
            for (let i = 0; i < createdIds.length - 1; i++) {
                createConnection(createdIds[i].id, createdIds[i + 1].id);
            }
        }
    }

    function buildDefaultBlueprint(wfId) {
        if (wfId.includes("ATTENDANCE")) {
            buildAttendanceBlueprint();
        } else if (wfId.includes("PAYROLL")) {
            buildPayrollBlueprint();
        } else if (wfId.includes("RESIGNATION")) {
            buildResignationBlueprint();
        } else {
            buildLeaveBlueprint();
        }
    }

    function buildLeaveBlueprint() {
        currentCategory = "LEAVE";
        pipelineStatusText.textContent = "Leave Approval & HRMS Sync (v2.1)";

        const n1 = createNodeOnCanvas({
            title: "Inbound Email Intake",
            type: "TRIGGER",
            tag: "[TRIGGER]",
            badge: "ST-01",
            provider: "Gmail / M365",
            desc: "Extracts employee ID, leave type (Casual/Sick), duration, and doctor certificate.",
            sla: "Instant",
            colorClass: "accent-blue",
            x: 60, y: 160
        });

        const n2 = createNodeOnCanvas({
            title: "HRMS Quota Verification",
            type: "DATA",
            tag: "[HRMS DATA]",
            badge: "ST-02",
            provider: "Internal HRMS Core",
            desc: "Fetches live accrued quota balance from HRMS /api/v2/leaves/balance.",
            sla: "< 1s",
            colorClass: "accent-emerald",
            x: 400, y: 160
        });

        const n3 = createNodeOnCanvas({
            title: "Leave Policy Decision Rule",
            type: "CONDITION",
            tag: "[POLICY]",
            badge: "ST-03",
            provider: "Rule Engine",
            desc: "IF duration > 2 days -> Line Manager Gate. IF <= 2 days -> Auto-Approve.",
            expression: "$ctx.duration_days > 2 && $ctx.balance >= $ctx.duration_days",
            sla: "< 1s",
            colorClass: "accent-amber",
            x: 740, y: 160
        });

        const n4 = createNodeOnCanvas({
            title: "Line Manager Sign-off Gate",
            type: "HUMAN",
            tag: "[HUMAN GATE]",
            badge: "ST-04",
            provider: "Human Gate",
            desc: "Dispatches 1-click approval notification to reporting manager with 24h SLA.",
            sla: "24h SLA",
            colorClass: "accent-purple",
            x: 1080, y: 80
        });

        const n5 = createNodeOnCanvas({
            title: "HRMS Ledger Sync & Debit",
            type: "INTEGRATION",
            tag: "[HRMS SYNC]",
            badge: "ST-05",
            provider: "Internal HRMS Core",
            desc: "Debits leave balance and commits transaction to payroll attendance ledger.",
            sla: "Instant",
            colorClass: "accent-emerald",
            x: 1420, y: 160
        });

        const n6 = createNodeOnCanvas({
            title: "Resolve & Close Case",
            type: "ACTION",
            tag: "[RESOLUTION]",
            badge: "ST-06",
            provider: "HR Flow Core",
            desc: "Notifies employee via email, updates SLA metric, and seals audit trail.",
            sla: "Instant",
            colorClass: "accent-slate",
            x: 1760, y: 160
        });

        createConnection(n1, n2);
        createConnection(n2, n3);
        createConnection(n3, n4);
        createConnection(n4, n5);
        createConnection(n3, n5); // Auto-approval bypass route
        createConnection(n5, n6);
    }

    function buildAttendanceBlueprint() {
        currentCategory = "ATTENDANCE";
        pipelineStatusText.textContent = "Biometric Regularization Flow (v2.0)";

        const n1 = createNodeOnCanvas({
            title: "Biometric Anomaly Intake",
            type: "TRIGGER",
            tag: "[TRIGGER]",
            badge: "ST-01",
            provider: "Truein Biometrics",
            desc: "Pulls missed punch or biometric gap > 60 minutes from facial terminal logs.",
            sla: "Real-time",
            colorClass: "accent-blue",
            x: 60, y: 160
        });

        const n2 = createNodeOnCanvas({
            title: "Shift & Grace Window Check",
            type: "CONDITION",
            tag: "[POLICY]",
            badge: "ST-02",
            provider: "Attendance Rule",
            desc: "Validates punch against assigned roster shift and checks monthly grace quota.",
            sla: "< 1s",
            colorClass: "accent-amber",
            x: 400, y: 160
        });

        const n3 = createNodeOnCanvas({
            title: "Manager Regularization Gate",
            type: "HUMAN",
            tag: "[HUMAN GATE]",
            badge: "ST-03",
            provider: "Human Gate",
            desc: "Requires reporting manager endorsement for on-duty / work-from-home swipe.",
            sla: "24h SLA",
            colorClass: "accent-purple",
            x: 740, y: 160
        });

        const n4 = createNodeOnCanvas({
            title: "Attendance Ledger Sync",
            type: "INTEGRATION",
            tag: "[HRMS SYNC]",
            badge: "ST-04",
            provider: "Internal HRMS API",
            desc: "Applies regularized swipe in attendance ledger to prevent LOP salary deduction.",
            sla: "Instant",
            colorClass: "accent-emerald",
            x: 1080, y: 160
        });

        const n5 = createNodeOnCanvas({
            title: "Resolve & Close Attendance Case",
            type: "ACTION",
            tag: "[RESOLUTION]",
            badge: "ST-05",
            provider: "HR Flow Core",
            desc: "Dispatches punch confirmation slip to employee and updates attendance stats.",
            sla: "Instant",
            colorClass: "accent-slate",
            x: 1420, y: 160
        });

        createConnection(n1, n2);
        createConnection(n2, n3);
        createConnection(n3, n4);
        createConnection(n4, n5);
    }

    function buildPayrollBlueprint() {
        currentCategory = "PAYROLL";
        pipelineStatusText.textContent = "Payroll Discrepancy & Adjustment (v2.0)";

        const n1 = createNodeOnCanvas({
            title: "Discrepancy Intake",
            type: "TRIGGER",
            tag: "[TRIGGER]",
            badge: "ST-01",
            provider: "Helpdesk Intake",
            desc: "Receives salary dispute or tax deduction query with payslip reference.",
            sla: "Instant",
            colorClass: "accent-blue",
            x: 60, y: 160
        });

        const n2 = createNodeOnCanvas({
            title: "GreytHR Payslip Verification",
            type: "DATA",
            tag: "[HRMS DATA]",
            badge: "ST-02",
            provider: "GreytHR API",
            desc: "Pulls gross, net, TDS deduction, and unpaid leave days from current cycle.",
            sla: "< 2s",
            colorClass: "accent-emerald",
            x: 400, y: 160
        });

        const n3 = createNodeOnCanvas({
            title: "Finance & Payroll Audit Gate",
            type: "HUMAN",
            tag: "[HUMAN GATE]",
            badge: "ST-03",
            provider: "Human Gate",
            desc: "Requires Payroll Specialist sign-off before adjustment credit.",
            sla: "12h SLA",
            colorClass: "accent-purple",
            x: 740, y: 160
        });

        const n4 = createNodeOnCanvas({
            title: "Post Adjustment to Ledger",
            type: "INTEGRATION",
            tag: "[HRMS SYNC]",
            badge: "ST-04",
            provider: "GreytHR Payroll",
            desc: "Applies salary correction or reimbursement credit to next payroll run.",
            sla: "Instant",
            colorClass: "accent-emerald",
            x: 1080, y: 160
        });

        const n5 = createNodeOnCanvas({
            title: "Resolve & Close Payroll Case",
            type: "ACTION",
            tag: "[RESOLUTION]",
            badge: "ST-05",
            provider: "HR Flow Core",
            desc: "Sends updated salary reconciliation breakdown to employee.",
            sla: "Instant",
            colorClass: "accent-slate",
            x: 1420, y: 160
        });

        createConnection(n1, n2);
        createConnection(n2, n3);
        createConnection(n3, n4);
        createConnection(n4, n5);
    }

    function buildResignationBlueprint() {
        currentCategory = "RESIGNATION";
        pipelineStatusText.textContent = "Resignation Intake & Clearance (v2.0)";

        const n1 = createNodeOnCanvas({
            title: "Resignation Intake",
            type: "TRIGGER",
            tag: "[TRIGGER]",
            badge: "ST-01",
            provider: "Employee Portal",
            desc: "Parses resignation notice, requested Last Working Day (LWD), and departure reason.",
            sla: "Instant",
            colorClass: "accent-blue",
            x: 60, y: 160
        });

        const n2 = createNodeOnCanvas({
            title: "Notice Period Calculator",
            type: "CONDITION",
            tag: "[POLICY]",
            badge: "ST-02",
            provider: "Exit Policy",
            desc: "Validates contractual notice period (30 vs 90 days) and buyout eligibility.",
            sla: "< 1s",
            colorClass: "accent-amber",
            x: 400, y: 160
        });

        const n3 = createNodeOnCanvas({
            title: "Manager Retention Gate",
            type: "HUMAN",
            tag: "[HUMAN GATE]",
            badge: "ST-03",
            provider: "Human Gate",
            desc: "Reporting manager conducts retention discussion or approves exit release.",
            sla: "48h SLA",
            colorClass: "accent-purple",
            x: 740, y: 160
        });

        const n4 = createNodeOnCanvas({
            title: "IT & Admin Asset Clearance",
            type: "INTEGRATION",
            tag: "[CLEARANCE]",
            badge: "ST-04",
            provider: "Asset Tracker",
            desc: "Collects laptop, access card, and identity badge clearance stamps.",
            sla: "72h SLA",
            colorClass: "accent-cyan",
            x: 1080, y: 160
        });

        const n5 = createNodeOnCanvas({
            title: "FnF Settlement & Relieving Letter",
            type: "DOC_GEN",
            tag: "[DOC GEN]",
            badge: "ST-05",
            provider: "Document Engine",
            desc: "Generates digital Relieving Letter, Service Certificate, and Full & Final settlement slip.",
            sla: "Instant",
            colorClass: "accent-slate",
            x: 1420, y: 160
        });

        createConnection(n1, n2);
        createConnection(n2, n3);
        createConnection(n3, n4);
        createConnection(n4, n5);
    }

    // =========================================================================
    // 2. CANVAS NODE CREATION (Zero-Icon Semantic Typography)
    // =========================================================================

    function createNodeOnCanvas(data) {
        const id = `node-${nodeIdCounter++}`;
        const nodeEl = document.createElement("div");
        nodeEl.className = "workflow-node";
        nodeEl.id = id;
        nodeEl.style.left = `${Math.round(data.x / 20) * 20}px`;
        nodeEl.style.top = `${Math.round(data.y / 20) * 20}px`;

        const tag = data.tag || `[${(data.type || "NODE").toUpperCase()}]`;
        const badge = data.badge || `ST-${String(nodeIdCounter).padStart(2, "0")}`;
        const colorClass = data.colorClass || "accent-blue";
        const isTrigger = data.type === "TRIGGER";

        nodeEl.innerHTML = `
            <div class="port port-in" style="display: ${isTrigger ? "none" : "block"}" data-port="in" data-nodeid="${id}"></div>
            <div class="node-header-bar">
                <span class="node-step-badge">${escapeHtml(badge)}</span>
                <span class="node-cat-pill ${colorClass}">${escapeHtml(tag)}</span>
                <div class="node-status-dot-wrap">
                    <span class="status-dot dot-ready"></span>
                    <span class="status-label">READY</span>
                </div>
            </div>
            <div class="node-body">
                <h3 class="node-title-text" id="title-${id}">${escapeHtml(data.title)}</h3>
                <p class="node-desc-text" id="desc-${id}">${escapeHtml(data.desc || "Click to inspect node configuration.")}</p>
            </div>
            <div class="node-footer-bar">
                <span class="node-meta-item" id="provider-${id}">${escapeHtml(data.provider || "System Core")}</span>
                <span class="node-meta-item" id="sla-${id}">${escapeHtml(data.sla || "24h SLA")}</span>
            </div>
            <div class="port port-out" data-port="out" data-nodeid="${id}"></div>
        `;

        nodesContainer.appendChild(nodeEl);

        const nodeObj = {
            id: id,
            type: data.type || "DATA",
            title: data.title,
            tag: tag,
            badge: badge,
            provider: data.provider || "System Core",
            desc: data.desc || "",
            expression: data.expression || "",
            sla: data.sla || "24h SLA",
            colorClass: colorClass,
            x: data.x,
            y: data.y,
            stateKey: data.stateKey || "",
            el: nodeEl
        };

        nodes[id] = nodeObj;

        makeNodeDraggable(nodeObj);
        setupPorts(nodeEl);

        nodeEl.addEventListener("click", (e) => {
            e.stopPropagation();
            selectElement("node", nodeObj);
            openInspectorForNode(nodeObj);
        });

        return id;
    }

    function makeNodeDraggable(nodeObj) {
        const el = nodeObj.el;
        let isDragging = false;
        let startX, startY;
        let initialX, initialY;

        el.addEventListener("mousedown", (e) => {
            if (e.target.classList.contains("port")) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = nodeObj.x;
            initialY = nodeObj.y;

            const onMouseMove = (moveEvt) => {
                if (!isDragging) return;
                const dx = (moveEvt.clientX - startX) / zoom;
                const dy = (moveEvt.clientY - startY) / zoom;
                let newX = Math.round((initialX + dx) / 20) * 20;
                let newY = Math.round((initialY + dy) / 20) * 20;

                nodeObj.x = newX;
                nodeObj.y = newY;
                el.style.left = `${newX}px`;
                el.style.top = `${newY}px`;
                updateConnections();
            };

            const onMouseUp = () => {
                isDragging = false;
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });
    }

    // =========================================================================
    // 3. PORTS & BEZIER CONNECTIONS
    // =========================================================================

    function setupPorts(nodeEl) {
        const ports = nodeEl.querySelectorAll(".port");
        ports.forEach(port => {
            port.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                isDrawingConnection = true;
                drawingStartNodeId = port.getAttribute("data-nodeid");
                drawingStartPort = port.getAttribute("data-port");

                const rect = port.getBoundingClientRect();
                const innerRect = canvasInner.getBoundingClientRect();
                drawingStartX = (rect.left + rect.width / 2 - innerRect.left) / zoom;
                drawingStartY = (rect.top + rect.height / 2 - innerRect.top) / zoom;

                tempLine.setAttribute("d", `M ${drawingStartX} ${drawingStartY} L ${drawingStartX} ${drawingStartY}`);
                tempLine.style.display = "block";
            });

            port.addEventListener("mouseup", (e) => {
                if (isDrawingConnection) {
                    const targetNodeId = port.getAttribute("data-nodeid");
                    const targetPort = port.getAttribute("data-port");

                    if (targetNodeId !== drawingStartNodeId && drawingStartPort !== targetPort) {
                        const fromId = drawingStartPort === "out" ? drawingStartNodeId : targetNodeId;
                        const toId = drawingStartPort === "out" ? targetNodeId : drawingStartNodeId;

                        const exists = connections.find(c => c.fromId === fromId && c.toId === toId);
                        if (!exists) {
                            createConnection(fromId, toId);
                        }
                    }
                }
            });
        });
    }

    function createConnection(fromId, toId) {
        if (!nodes[fromId] || !nodes[toId]) return;

        const pathId = `conn-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "connection-line");
        path.setAttribute("id", pathId);
        svgCanvas.appendChild(path);

        const connObj = { id: pathId, fromId, toId, pathEl: path };
        connections.push(connObj);

        nodes[fromId].el.querySelector(".port-out")?.classList.add("connected");
        nodes[toId].el.querySelector(".port-in")?.classList.add("connected");

        path.addEventListener("click", (e) => {
            e.stopPropagation();
            selectElement("connection", connObj);
        });

        updateConnections();
        return connObj;
    }

    function updateConnections() {
        connections.forEach(conn => {
            const fromNode = nodes[conn.fromId]?.el;
            const toNode = nodes[conn.toId]?.el;
            if (!fromNode || !toNode) return;

            const fromPort = fromNode.querySelector(".port-out");
            const toPort = toNode.querySelector(".port-in");
            if (!fromPort || !toPort) return;

            const innerRect = canvasInner.getBoundingClientRect();
            const p1 = fromPort.getBoundingClientRect();
            const p2 = toPort.getBoundingClientRect();

            const x1 = (p1.left + p1.width / 2 - innerRect.left) / zoom;
            const y1 = (p1.top + p1.height / 2 - innerRect.top) / zoom;
            const x2 = (p2.left + p2.width / 2 - innerRect.left) / zoom;
            const y2 = (p2.top + p2.height / 2 - innerRect.top) / zoom;

            conn.pathEl.setAttribute("d", getBezierPath(x1, y1, x2, y2));
        });
    }

    function getBezierPath(x1, y1, x2, y2) {
        const dx = Math.abs(x2 - x1);
        const curveOffset = Math.max(dx * 0.5, 60);
        return `M ${x1} ${y1} C ${x1 + curveOffset} ${y1}, ${x2 - curveOffset} ${y2}, ${x2} ${y2}`;
    }

    function selectElement(type, obj) {
        clearSelection();
        if (type === "node") {
            activeSelectedElement = { type: "node", obj };
            obj.el.classList.add("selected");
        } else if (type === "connection") {
            activeSelectedElement = { type: "connection", obj };
            obj.pathEl.classList.add("selected");
        }
    }

    function clearSelection() {
        if (activeSelectedElement) {
            if (activeSelectedElement.type === "node") {
                activeSelectedElement.obj.el.classList.remove("selected");
            } else if (activeSelectedElement.type === "connection") {
                activeSelectedElement.obj.pathEl.classList.remove("selected");
            }
            activeSelectedElement = null;
        }
    }

    function clearCanvas() {
        connections.forEach(c => c.pathEl.remove());
        connections = [];
        Object.values(nodes).forEach(n => n.el.remove());
        nodes = {};
        nodeIdCounter = 1;
        clearSelection();
        closeInspector();
    }

    // =========================================================================
    // 4. CANVAS PANNING, ZOOMING & LAYOUT
    // =========================================================================

    function setupCanvasInteractions() {
        canvasContainer.addEventListener("mousedown", (e) => {
            if (e.target === canvasContainer || e.target === canvasInner || e.target === svgCanvas) {
                isPanning = true;
                startPanX = e.clientX - panX;
                startPanY = e.clientY - panY;
                clearSelection();
                closeInspector();
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (isPanning) {
                panX = e.clientX - startPanX;
                panY = e.clientY - startPanY;
                updateCanvasTransform();
            }

            if (isDrawingConnection) {
                const rect = canvasInner.getBoundingClientRect();
                const curX = (e.clientX - rect.left) / zoom;
                const curY = (e.clientY - rect.top) / zoom;
                tempLine.setAttribute("d", getBezierPath(drawingStartX, drawingStartY, curX, curY));
            }
        });

        window.addEventListener("mouseup", () => {
            isPanning = false;
            if (isDrawingConnection) {
                isDrawingConnection = false;
                tempLine.style.display = "none";
            }
        });

        canvasContainer.addEventListener("wheel", (e) => {
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            const rect = canvasContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(zoom * factor, mouseX, mouseY);
        }, { passive: false });

        btnZoomIn.addEventListener("click", () => setZoom(zoom * 1.2));
        btnZoomOut.addEventListener("click", () => setZoom(zoom * 0.8));
        btnZoomFit.addEventListener("click", () => fitToView());
        btnRealignGrid.addEventListener("click", () => autoAlignGrid());

        // Keyboard shortcuts
        document.addEventListener("keydown", (e) => {
            if (e.key === "Delete" || e.key === "Backspace") {
                if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") return;
                if (activeSelectedElement) {
                    if (activeSelectedElement.type === "node") {
                        deleteNode(activeSelectedElement.obj.id);
                    } else if (activeSelectedElement.type === "connection") {
                        deleteConnection(activeSelectedElement.obj.id);
                    }
                }
            } else if (e.key === "Escape") {
                clearSelection();
                closeInspector();
                closeSimConsole();
            }
        });
    }

    function setZoom(newZoom, originX = null, originY = null) {
        newZoom = Math.max(0.3, Math.min(2.5, newZoom));
        if (originX !== null && originY !== null) {
            panX = originX - (originX - panX) * (newZoom / zoom);
            panY = originY - (originY - panY) * (newZoom / zoom);
        }
        zoom = newZoom;
        zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
        updateCanvasTransform();
    }

    function updateCanvasTransform() {
        canvasInner.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        canvasContainer.style.backgroundPosition = `${panX}px ${panY}px`;
        canvasContainer.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
    }

    function fitToView() {
        const nodeIds = Object.keys(nodes);
        if (nodeIds.length === 0) {
            zoom = 1;
            panX = 60;
            panY = 60;
            updateCanvasTransform();
            zoomLevelText.textContent = "100%";
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodeIds.forEach(id => {
            const n = nodes[id];
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + 300);
            maxY = Math.max(maxY, n.y + 160);
        });

        const rect = canvasContainer.getBoundingClientRect();
        const padding = 80;
        const scaleX = (rect.width - padding * 2) / Math.max(100, maxX - minX);
        const scaleY = (rect.height - padding * 2) / Math.max(100, maxY - minY);

        zoom = Math.min(scaleX, scaleY, 1.05);
        panX = (rect.width / 2) - ((minX + maxX) / 2) * zoom;
        panY = (rect.height / 2) - ((minY + maxY) / 2) * zoom;

        zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
        updateCanvasTransform();
    }

    function autoAlignGrid() {
        const nodeIds = Object.keys(nodes);
        nodeIds.forEach((id, idx) => {
            const n = nodes[id];
            n.x = 60 + idx * 340;
            n.y = 160;
            n.el.style.left = `${n.x}px`;
            n.el.style.top = `${n.y}px`;
        });
        updateConnections();
        fitToView();
    }

    function deleteNode(nodeId) {
        if (!nodes[nodeId]) return;
        // Remove connected wires
        connections = connections.filter(c => {
            if (c.fromId === nodeId || c.toId === nodeId) {
                c.pathEl.remove();
                return false;
            }
            return true;
        });

        nodes[nodeId].el.remove();
        delete nodes[nodeId];
        clearSelection();
        closeInspector();
    }

    function deleteConnection(connId) {
        const idx = connections.findIndex(c => c.id === connId);
        if (idx !== -1) {
            connections[idx].pathEl.remove();
            connections.splice(idx, 1);
            clearSelection();
        }
    }

    // =========================================================================
    // 5. NODE LIBRARY (Zero-Icon, Real Categories, Drag-and-Drop)
    // =========================================================================

    function renderNodeLibrary(filter = "") {
        filter = filter.trim().toLowerCase();
        libraryContent.innerHTML = "";
        let totalCount = 0;

        const categories = window.hrNodeCategories || [];
        categories.forEach(cat => {
            const filteredNodes = cat.nodes.filter(n => {
                if (!filter) return true;
                return n.title.toLowerCase().includes(filter) ||
                       n.desc.toLowerCase().includes(filter) ||
                       n.provider.toLowerCase().includes(filter);
            });

            if (filteredNodes.length === 0) return;
            totalCount += filteredNodes.length;

            const groupEl = document.createElement("div");
            groupEl.className = "node-group-section";

            groupEl.innerHTML = `
                <div class="group-title-bar">
                    <span>${escapeHtml(cat.name)}</span>
                    <span class="group-count">${filteredNodes.length} NODES</span>
                </div>
            `;

            filteredNodes.forEach(nodeData => {
                const card = document.createElement("div");
                card.className = "node-draggable-card";
                card.setAttribute("draggable", "true");

                card.innerHTML = `
                    <div class="card-top-row">
                        <span class="card-tag ${cat.colorClass}">${escapeHtml(nodeData.tag || cat.tag)}</span>
                        <span class="card-provider-pill">${escapeHtml(nodeData.provider)}</span>
                    </div>
                    <h4 class="card-title">${escapeHtml(nodeData.title)}</h4>
                    <p class="card-desc">${escapeHtml(nodeData.desc)}</p>
                `;

                // Drag to canvas
                card.addEventListener("dragstart", (e) => {
                    const payload = JSON.stringify({
                        title: nodeData.title,
                        type: cat.type,
                        tag: nodeData.tag || cat.tag,
                        badge: nodeData.badge || "NODE",
                        provider: nodeData.provider,
                        desc: nodeData.desc,
                        expression: nodeData.defaultConfig?.expression || "",
                        sla: nodeData.sla || "24h SLA",
                        colorClass: cat.colorClass
                    });
                    e.dataTransfer.setData("application/json", payload);
                });

                // Double click to add at center
                card.addEventListener("dblclick", () => {
                    const rect = canvasContainer.getBoundingClientRect();
                    const x = (rect.width / 2 - panX) / zoom;
                    const y = (rect.height / 2 - panY) / zoom;
                    createNodeOnCanvas({
                        title: nodeData.title,
                        type: cat.type,
                        tag: nodeData.tag || cat.tag,
                        badge: nodeData.badge || "NODE",
                        provider: nodeData.provider,
                        desc: nodeData.desc,
                        expression: nodeData.defaultConfig?.expression || "",
                        sla: nodeData.sla || "24h SLA",
                        colorClass: cat.colorClass,
                        x, y
                    });
                });

                groupEl.appendChild(card);
            });

            libraryContent.appendChild(groupEl);
        });

        libraryCountBadge.textContent = `${totalCount} NODES`;

        // Canvas drop target
        canvasContainer.addEventListener("dragover", (e) => e.preventDefault());
        canvasContainer.addEventListener("drop", (e) => {
            e.preventDefault();
            const dataStr = e.dataTransfer.getData("application/json");
            if (!dataStr) return;
            try {
                const data = JSON.parse(dataStr);
                const rect = canvasInner.getBoundingClientRect();
                const x = (e.clientX - rect.left) / zoom;
                const y = (e.clientY - rect.top) / zoom;
                data.x = x;
                data.y = y;
                createNodeOnCanvas(data);
            } catch (err) {
                console.error("Drop node failed:", err);
            }
        });
    }

    librarySearchInput.addEventListener("input", (e) => {
        renderNodeLibrary(e.target.value);
    });

    // =========================================================================
    // 6. NODE INSPECTOR & DRY-RUN TESTING
    // =========================================================================

    let inspectedNodeObj = null;

    function openInspectorForNode(nodeObj) {
        inspectedNodeObj = nodeObj;
        inspectorNodeId.textContent = `ID: ${nodeObj.id} · ${nodeObj.type}`;
        nodeFieldTitle.value = nodeObj.title;
        nodeFieldFamily.value = nodeObj.type;
        nodeFieldProvider.value = nodeObj.provider;
        nodeFieldDesc.value = nodeObj.desc;
        nodeFieldExpression.value = nodeObj.expression;
        nodeFieldSla.value = nodeObj.sla;

        testOutputWrap.style.display = "none";
        nodeTestOutput.textContent = "";

        inspectorPanel.classList.add("open");
    }

    function closeInspector() {
        inspectorPanel.classList.remove("open");
        inspectedNodeObj = null;
    }

    btnCloseInspector.addEventListener("click", closeInspector);

    btnSaveNodeFields.addEventListener("click", () => {
        if (!inspectedNodeObj) return;
        inspectedNodeObj.title = nodeFieldTitle.value;
        inspectedNodeObj.type = nodeFieldFamily.value;
        inspectedNodeObj.provider = nodeFieldProvider.value;
        inspectedNodeObj.desc = nodeFieldDesc.value;
        inspectedNodeObj.expression = nodeFieldExpression.value;
        inspectedNodeObj.sla = nodeFieldSla.value;

        // Update DOM inside canvas card
        const titleEl = document.getElementById(`title-${inspectedNodeObj.id}`);
        const descEl = document.getElementById(`desc-${inspectedNodeObj.id}`);
        const providerEl = document.getElementById(`provider-${inspectedNodeObj.id}`);
        const slaEl = document.getElementById(`sla-${inspectedNodeObj.id}`);

        if (titleEl) titleEl.textContent = inspectedNodeObj.title;
        if (descEl) descEl.textContent = inspectedNodeObj.desc;
        if (providerEl) providerEl.textContent = inspectedNodeObj.provider;
        if (slaEl) slaEl.textContent = inspectedNodeObj.sla;

        closeInspector();
    });

    btnDeleteActiveNode.addEventListener("click", () => {
        if (!inspectedNodeObj) return;
        if (confirm(`Remove "${inspectedNodeObj.title}" from the pipeline?`)) {
            deleteNode(inspectedNodeObj.id);
        }
    });

    btnTestNodeAction.addEventListener("click", () => {
        if (!inspectedNodeObj) return;
        testOutputWrap.style.display = "block";
        nodeTestOutput.textContent = `[EXECUTING DRY-RUN]: Calling ${inspectedNodeObj.provider}...\n`;

        setTimeout(() => {
            const mockPayload = {
                status: 200,
                success: true,
                node_id: inspectedNodeObj.id,
                title: inspectedNodeObj.title,
                target_system: inspectedNodeObj.provider,
                execution_timestamp_ist: new Date().toISOString(),
                evaluated_expression: inspectedNodeObj.expression || "NONE",
                output_context: {
                    employee_id: "EMP10482",
                    employee_name: "Rahul Verma",
                    leave_quota: {
                        casual_available: 8,
                        sick_available: 14,
                        earned_available: 18
                    },
                    manager: "Amit Kumar (L1 Sign-off)",
                    audit_hash: "SHA256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
                }
            };
            nodeTestOutput.textContent = JSON.stringify(mockPayload, null, 2);
        }, 350);
    });

    // =========================================================================
    // 7. PIPELINE SIMULATION ENGINE (Step-by-step Visual Token Animation)
    // =========================================================================

    function openSimConsole() {
        simConsoleDrawer.classList.add("open");
    }

    function closeSimConsole() {
        simConsoleDrawer.classList.remove("open");
    }

    btnClearSimLogs.addEventListener("click", () => {
        simLogsMount.innerHTML = "";
    });

    btnCloseSimConsole.addEventListener("click", closeSimConsole);

    btnSimulatePipeline.addEventListener("click", () => {
        if (isSimulating) return;
        runPipelineSimulation();
    });

    async function runPipelineSimulation() {
        isSimulating = true;
        openSimConsole();
        simLogsMount.innerHTML = "";

        const nodeKeys = Object.keys(nodes);
        if (nodeKeys.length === 0) {
            appendSimLog("INIT", "tag-trig", "No nodes on canvas to simulate. Please load or add nodes.");
            isSimulating = false;
            return;
        }

        appendSimLog("INIT", "tag-trig", `Initializing pipeline execution simulation for ${pipelineStatusText.textContent}...`);

        // Reset previous simulation styles
        nodeKeys.forEach(k => {
            nodes[k].el.classList.remove("sim-active");
            const dot = nodes[k].el.querySelector(".status-dot");
            const lbl = nodes[k].el.querySelector(".status-label");
            if (dot) dot.className = "status-dot dot-ready";
            if (lbl) lbl.textContent = "READY";
        });
        connections.forEach(c => c.pathEl.classList.remove("sim-active"));

        // Step sequentially through nodes
        for (let i = 0; i < nodeKeys.length; i++) {
            const nodeId = nodeKeys[i];
            const node = nodes[nodeId];

            // Highlight node
            node.el.classList.add("sim-active");
            const dot = node.el.querySelector(".status-dot");
            const lbl = node.el.querySelector(".status-label");
            if (dot) dot.className = "status-dot dot-running";
            if (lbl) lbl.textContent = "RUNNING";

            // Highlight incoming connection
            const inConn = connections.find(c => c.toId === nodeId);
            if (inConn) inConn.pathEl.classList.add("sim-active");

            // Log step
            const tagCls = getLogTagClass(node.type);
            appendSimLog(node.badge, tagCls, `Executing [${node.title}] via ${node.provider}...`);

            await sleep(700);

            if (node.type === "CONDITION") {
                appendSimLog("RULE", "tag-eval", `Expression: "${node.expression || 'duration > 2'}" evaluated to TRUE -> Proceeding to next gate.`);
            } else if (node.type === "HUMAN") {
                appendSimLog("GATE", "tag-gate", `Human Sign-off checkpoint: Dispatched interactive notification to Line Manager (Amit Kumar).`);
            } else if (node.type === "INTEGRATION") {
                appendSimLog("SYNC", "tag-sync", `HRMS API Ledger updated: Debited 3 Sick Leaves in HRMS (HTTP 200 OK).`);
            }

            if (dot) dot.className = "status-dot dot-done";
            if (lbl) lbl.textContent = "EXECUTED";
            await sleep(300);
        }

        appendSimLog("DONE", "tag-done", "Pipeline simulation completed with 0 errors. All gates evaluated successfully.");
        isSimulating = false;
    }

    function appendSimLog(tag, tagClass, text) {
        const line = document.createElement("div");
        line.className = "sim-log-line";
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

        line.innerHTML = `
            <span class="sim-log-time">[${timeStr}]</span>
            <span class="sim-log-tag ${tagClass}">[${escapeHtml(tag)}]</span>
            <span class="sim-log-text">${escapeHtml(text)}</span>
        `;
        simLogsMount.appendChild(line);
        simLogsMount.scrollTop = simLogsMount.scrollHeight;
    }

    function getLogTagClass(type) {
        switch (type) {
            case "TRIGGER": return "tag-trig";
            case "CONDITION": return "tag-eval";
            case "INTEGRATION": return "tag-sync";
            case "HUMAN": return "tag-gate";
            default: return "tag-done";
        }
    }

    // =========================================================================
    // 8. CASE PROGRESS HIGHLIGHTING
    // =========================================================================

    async function highlightCaseProgress(caseRef) {
        if (!caseRef) return;
        try {
            const res = await fetch(`${API_CASES}/${encodeURIComponent(caseRef)}/detail`);
            if (!res.ok) return;
            const data = await res.json();
            const cObj = data.data?.case || data.case || {};
            const state = cObj.workflow_state;

            // Highlight node matching state
            const targetNode = Object.values(nodes).find(n => n.stateKey === state || n.title.toUpperCase().includes(state.replace(/_/g, " ")));
            if (targetNode) {
                targetNode.el.classList.add("sim-active");
                const dot = targetNode.el.querySelector(".status-dot");
                const lbl = targetNode.el.querySelector(".status-label");
                if (dot) dot.className = "status-dot dot-live";
                if (lbl) lbl.textContent = "ACTIVE STAGE";
            }
        } catch (e) {
            console.warn("Could not load case progress for studio:", e);
        }
    }

    // =========================================================================
    // 9. TOP CONTROLS & SAVE / DEPLOY
    // =========================================================================

    function bindTopControls() {
        blueprintSelect.addEventListener("change", (e) => {
            loadWorkflowBlueprint(e.target.value);
        });

        caseLinkSelect.addEventListener("change", (e) => {
            activeCaseId = e.target.value;
            if (activeCaseId) {
                highlightCaseProgress(activeCaseId);
            } else {
                // Remove highlight
                Object.values(nodes).forEach(n => n.el.classList.remove("sim-active"));
            }
        });

        btnSaveBlueprint.addEventListener("click", async () => {
            btnSaveBlueprint.textContent = "Saving...";
            const states = Object.values(nodes).map(n => n.title.toUpperCase().replace(/\s+/g, "_"));
            const payload = {
                workflow_id: currentWorkflowId,
                name: pipelineStatusText.textContent.split("(")[0].trim(),
                category: currentCategory,
                version: "2.1",
                states: states,
                steps_display: Object.values(nodes).map(n => n.title),
                node_boxes: Object.values(nodes).map((n, idx) => ({
                    state: n.stateKey || n.title.toUpperCase().replace(/\s+/g, "_"),
                    label: n.title,
                    step_number: idx + 1,
                    box_type: n.type,
                    actions: [n.provider]
                }))
            };

            try {
                const res = await fetch(`${API_WORKFLOWS}/builder/save`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-HR-Role": "ADMIN",
                        "X-HR-User": "HR Administrator"
                    },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    btnSaveBlueprint.textContent = "✓ Blueprint Saved";
                    setTimeout(() => btnSaveBlueprint.textContent = "Save Blueprint", 2000);
                } else {
                    const err = await res.json();
                    alert(`Failed to save: ${err.message || 'Check permissions'}`);
                    btnSaveBlueprint.textContent = "Save Blueprint";
                }
            } catch (e) {
                alert(`Error saving blueprint: ${e.message}`);
                btnSaveBlueprint.textContent = "Save Blueprint";
            }
        });

        btnDeployEngine.addEventListener("click", () => {
            btnDeployEngine.textContent = "Deploying...";
            setTimeout(() => {
                btnDeployEngine.textContent = "✓ Deployed to Engine";
                alert(`Successfully deployed ${currentWorkflowId} to production engine.\nNew inbound cases in category "${currentCategory}" will execute this pipeline.`);
                setTimeout(() => btnDeployEngine.textContent = "Deploy to Engine", 2500);
            }, 500);
        });

        // Custom Node Modal
        const customNodeModal = document.getElementById("custom-node-modal");
        const btnOpenCreateNode = document.getElementById("btn-open-create-node");
        const closeModalBtn = document.getElementById("close-modal-btn");
        const btnCancelCustomNode = document.getElementById("btn-cancel-custom-node");
        const saveCustomNodeBtn = document.getElementById("save-custom-node-btn");

        btnOpenCreateNode.addEventListener("click", () => {
            customNodeModal.style.display = "flex";
        });

        const closeCustomModal = () => {
            customNodeModal.style.display = "none";
        };

        closeModalBtn.addEventListener("click", closeCustomModal);
        btnCancelCustomNode.addEventListener("click", closeCustomModal);

        saveCustomNodeBtn.addEventListener("click", () => {
            const name = document.getElementById("custom-node-name").value.trim();
            const family = document.getElementById("custom-node-family").value;
            const provider = document.getElementById("custom-node-provider").value.trim() || "Custom API";
            const url = document.getElementById("custom-node-url").value.trim();

            if (!name) {
                alert("Please enter a Node Title.");
                return;
            }

            const catObj = (window.hrNodeCategories || []).find(c => c.type === family) || window.hrNodeCategories[0];
            catObj.nodes.push({
                type: `custom_${name.toLowerCase().replace(/\s+/g, "_")}`,
                title: name,
                tag: catObj.tag,
                badge: "CUSTOM",
                provider: provider,
                desc: `Executes ${provider} at ${url || 'Internal Endpoint'}.`,
                sla: "Instant",
                defaultConfig: { url: url }
            });

            renderNodeLibrary();
            closeCustomModal();
            document.getElementById("custom-node-name").value = "";
            document.getElementById("custom-node-url").value = "";
            alert(`Custom node "${name}" added to Node Library!`);
        });
    }

    // =========================================================================
    // 10. UTILITIES & HELPERS
    // =========================================================================

    function getBoxColorClass(boxType) {
        switch ((boxType || "").toUpperCase()) {
            case "TRIGGER": return "accent-blue";
            case "CONDITION": return "accent-amber";
            case "INTEGRATION": return "accent-emerald";
            case "HUMAN": return "accent-purple";
            case "DOC_GEN": return "accent-cyan";
            default: return "accent-slate";
        }
    }

    function getProviderForBoxType(boxType, category) {
        switch ((boxType || "").toUpperCase()) {
            case "TRIGGER": return "Inbound Gateway";
            case "CONDITION": return "Policy Engine";
            case "INTEGRATION": return category === "ATTENDANCE" ? "Truein Biometrics" : "Internal HRMS Core";
            case "HUMAN": return "Line Manager Sign-off";
            case "DOC_GEN": return "Document Generator";
            default: return "HR Flow Core";
        }
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Launch
    initStudio();
});
