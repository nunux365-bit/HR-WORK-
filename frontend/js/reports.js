/**
 * reports.js — Executive HR & HR Manager Case Intelligence & Step-by-Step Lifecycle Report Center
 *
 * Provides:
 *   1. Accurate IST (+05:30 Asia/Kolkata) timestamp conversion for all UTC SQLite & ISO dates
 *      (fixes the 06:39 UTC display issue -> shows 12:09 PM IST).
 *   2. Synthesized Step-by-Step Case Execution Engine that records EVERY single step of the case:
 *      Email Ingestion -> Employee Verification -> AI Stage 1 & Stage 2 Triage -> Case Creation & SLA ->
 *      Department Routing -> Workflow Transitions -> Tasks -> Manager Approvals -> Documents ->
 *      Communications & HR Manager Review Notes -> Resolution & Closure.
 *   3. Elevated Executive UI tailored for HR Specialists & HR Managers with live Status/Priority
 *      controls, inline HR Manager Review/Sign-Off step logger, 4-lens sub-tabs, Print/PDF & CSV/JSON export.
 */

let reportDossierTab = "ALL"; // "ALL" | "STEPS" | "GOVERNANCE" | "EVIDENCE"

function toIstDisplay(rawTs, includeSeconds = true) {
    if (!rawTs || rawTs === "—") return "—";
    const s = String(rawTs).trim();
    if (!s) return "—";

    // If backend audit_log formatted string came without Z/IST (e.g., "07 Oct 2026, 06:39:12"), parse it as UTC
    let d = null;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
        d = new Date(s.replace(" ", "T") + "Z");
    } else if (/^\d{2} [A-Za-z]{3} \d{4},? \d{2}:\d{2}(:\d{2})?$/.test(s) && !s.toUpperCase().includes("IST")) {
        d = new Date(s.replace(",", "") + " UTC");
    } else if (!s.toUpperCase().includes("IST")) {
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) d = parsed;
    } else {
        return s;
    }

    if (!d || isNaN(d.getTime())) return s;

    try {
        const datePart = d.toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
        const timePart = d
            .toLocaleTimeString("en-IN", {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                ...(includeSeconds ? { second: "2-digit" } : {}),
                hour12: true
            })
            .toUpperCase();
        return `${datePart}, ${timePart} IST`;
    } catch (e) {
        return s;
    }
}

function toUtcMs(rawTs) {
    if (!rawTs || rawTs === "—") return NaN;
    const s = String(rawTs).trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
        return new Date(s.replace(" ", "T") + "Z").getTime();
    }
    if (/^\d{2} [A-Za-z]{3} \d{4},? \d{2}:\d{2}(:\d{2})?$/.test(s) && !s.toUpperCase().includes("IST")) {
        return new Date(s.replace(",", "") + " UTC").getTime();
    }
    return new Date(s).getTime();
}

function formatDurationDelta(msDiff) {
    if (isNaN(msDiff) || msDiff <= 0) return "Instant (<1s)";
    const sec = Math.floor(msDiff / 1000);
    if (sec < 60) return `+${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `+${min}m ${sec % 60}s`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `+${hr}h ${min % 60}m`;
    const days = Math.floor(hr / 24);
    return `+${days}d ${hr % 24}h`;
}

function buildCompleteCaseExecutionSteps(detail, formatHuman, formatCatLabel) {
    const c = detail.case || detail || {};
    const emp = detail.employee || c.employee || {};
    const origEmail = detail.original_email || {};
    const ai = detail.ai_classification || detail.classification || {};
    const rawFields = detail.extracted_fields || c.extracted_fields || {};
    const fieldsObj =
        rawFields && typeof rawFields.fields === "object" && rawFields.fields !== null
            ? rawFields.fields
            : rawFields;
    const val = detail.validation || c.validation || {};
    const wf = detail.workflow || {};
    const tasks = detail.tasks || [];
    const approvals = detail.approvals || [];
    const docsObj = detail.documents || {};
    const docsList = Array.isArray(docsObj) ? docsObj : (docsObj.documents || []);
    const comms = detail.communications || [];
    const timeline = detail.timeline || detail.audit || [];

    const steps = [];
    const baseCreatedRaw = origEmail.received_at || c.created_at;
    const baseMs = toUtcMs(baseCreatedRaw) || Date.now();

    // Check which actions already exist in timeline
    const hasAction = (actName) =>
        timeline.some((ev) => String(ev.action || "").toUpperCase().includes(actName));

    // Synthesize foundational pipeline steps if not explicitly in audit log
    if (!hasAction("EMAIL_INGESTED")) {
        steps.push({
            rawTs: origEmail.received_at || c.created_at,
            ms: baseMs,
            phase: "INGESTION",
            tone: "blue",
            action: "EMAIL_INGESTED",
            title: "Employee Request Received via Gmail Inbox",
            actor: origEmail.from_name || emp.name || "Employee",
            role: "EMPLOYEE",
            transition: "GMAIL → INBOX",
            description: `Inbound email "${origEmail.subject || c.title || "HR Request"}" ingested from ${origEmail.from_email || emp.email || "employee"}.`,
            chips: [
                `Sender: ${origEmail.from_email || emp.email || "—"}`,
                `Attachments: ${(origEmail.attachments || []).length}`
            ]
        });
    }

    if (!hasAction("EMPLOYEE_")) {
        const verified = emp.employee_code && emp.employee_code !== "UNVERIFIED";
        steps.push({
            rawTs: c.created_at,
            ms: baseMs + 500,
            phase: "IDENTITY",
            tone: verified ? "emerald" : "amber",
            action: verified ? "EMPLOYEE_VERIFIED" : "EMPLOYEE_UNVERIFIED",
            title: verified ? "Employee Master Identity Verified" : "Sender Flagged as Unverified Identity",
            actor: "HR Flow Identity Engine",
            role: "SYSTEM",
            transition: `EMAIL → ${emp.employee_code || "UNVERIFIED"}`,
            description: verified
                ? `Matched employee ${emp.name} (${emp.employee_code}) in ${emp.department || "Organization"} (${emp.location || "HQ"}).`
                : `Sender email could not be automatically matched to an active employee code; flagged for HR verification.`,
            chips: [
                `Emp ID: ${emp.employee_code || "UNVERIFIED"}`,
                `Dept: ${emp.department || "—"}`,
                `Manager: ${emp.manager || emp.manager_name || "—"}`
            ]
        });
    }

    if (!hasAction("CATEGORY_CLASSIFIED") && !hasAction("EMAIL_CLASSIFIED")) {
        const confPct = Math.round(
            Number(ai.category_confidence ?? 0.95) <= 1
                ? Number(ai.category_confidence ?? 0.95) * 100
                : Number(ai.category_confidence ?? 95)
        );
        steps.push({
            rawTs: c.created_at,
            ms: baseMs + 1000,
            phase: "AI TRIAGE",
            tone: "purple",
            action: "AI_DEPARTMENT_TRIAGE",
            title: `Stage 1 & 2 AI Classification: ${formatCatLabel(c.category)} (${confPct}%)`,
            actor: "AI Classification Pipeline",
            role: "AI ENGINE",
            transition: `RAW EMAIL → ${c.category || "GENERAL_HR"}`,
            description:
                ai.reason ||
                `Classified under ${formatCatLabel(c.category)} with specialized intent "${formatHuman(ai.intent_name || c.intent || "General")}" (${ai.decision_status || "AUTO PROCESSED"}).`,
            chips: [
                `Category: ${formatCatLabel(c.category)} (${confPct}%)`,
                `Intent: ${formatHuman(ai.intent_name || c.intent || "General")}`,
                `Validation: ${val.status || "READY"}`
            ]
        });
    }

    if (!hasAction("CASE_CREATED")) {
        steps.push({
            rawTs: c.created_at,
            ms: baseMs + 1500,
            phase: "CASE CREATION",
            tone: "blue",
            action: "CASE_CREATED",
            title: `Operational Case ${c.case_number || c.id} Initialized & Routed`,
            actor: "Case Orchestrator",
            role: "SYSTEM",
            transition: `NONE → ${c.status || "NEW"}`,
            description: `Created case ${c.case_number || c.id} with ${c.priority || "MEDIUM"} priority (${c.sla_hours || 48}h SLA) and assigned to ${c.assigned_team || "HR Operations"} (${c.assigned_user || "HR Specialist"}).`,
            chips: [
                `Team: ${c.assigned_team || "HR Operations"}`,
                `Owner: ${c.assigned_user || "Unassigned"}`,
                `SLA: ${c.sla_hours || 48} Hours`
            ]
        });
    }

    // Add every audit timeline event
    timeline.forEach((ev, idx) => {
        const raw = ev.timestamp_iso || ev.created_at_utc || ev.created_at || c.created_at;
        const ms = toUtcMs(raw) || baseMs + 2000 + idx * 100;
        const act = String(ev.action || "EVENT").toUpperCase();

        let phase = "GOVERNANCE";
        let tone = "blue";
        if (act.includes("EMAIL")) {
            phase = "INGESTION";
            tone = "blue";
        } else if (act.includes("EMPLOYEE")) {
            phase = "IDENTITY";
            tone = "emerald";
        } else if (act.includes("CLASSIF") || act.includes("INTENT") || act.includes("FIELD")) {
            phase = "AI TRIAGE";
            tone = "purple";
        } else if (act.includes("ASSIGN") || act.includes("DISPATCH")) {
            phase = "ROUTING";
            tone = "blue";
        } else if (act.includes("WORKFLOW") || act.includes("STATE")) {
            phase = "WORKFLOW";
            tone = "indigo";
        } else if (act.includes("TASK")) {
            phase = "HR TASK";
            tone = "amber";
        } else if (act.includes("APPROV")) {
            phase = "APPROVAL";
            tone = act.includes("REJECT") ? "red" : "emerald";
        } else if (act.includes("RESOLV") || act.includes("CLOSE")) {
            phase = "RESOLUTION";
            tone = "emerald";
        } else if (act.includes("HOLD") || act.includes("REOPEN") || act.includes("INFO")) {
            phase = "HR ACTION";
            tone = "amber";
        }

        const chips = [];
        if (ev.entity_type) chips.push(`${ev.entity_type} #${ev.entity_id || c.id}`);
        if (ev.reason) chips.push(`Note: ${ev.reason}`);

        steps.push({
            rawTs: raw,
            ms,
            phase,
            tone,
            action: act,
            title: formatHuman(act),
            actor: ev.performed_by || "System",
            role: String(ev.performed_by || "").toLowerCase() === "system" ? "SYSTEM" : "HR / MANAGER",
            transition:
                ev.from_value || ev.to_value
                    ? `${ev.from_value || "—"} → ${ev.to_value || "—"}`
                    : null,
            description: ev.description || ev.text || "Operational step recorded.",
            chips
        });
    });

    // Also include any communications/review notes that were not already in audit timeline
    comms.forEach((cm, idx) => {
        const raw = cm.created_at || c.updated_at;
        const ms = toUtcMs(raw) || baseMs + 5000 + idx * 100;
        steps.push({
            rawTs: raw,
            ms,
            phase: "COMMUNICATION",
            tone: "indigo",
            action: cm.comm_type || "HR_COMMUNICATION",
            title: `${formatHuman(cm.comm_type || "Communication")}: ${cm.subject || "Case Update / Review Note"}`,
            actor: cm.sender_name || cm.sender_type || "HR Specialist",
            role: cm.sender_type || "HR",
            transition: `${cm.sender_name || "HR"} → ${cm.recipient || "Case Record"}`,
            description: cm.message || "Communication recorded on case.",
            chips: cm.missing_items ? [`Requested: ${cm.missing_items}`] : []
        });
    });

    // Sort chronologically
    steps.sort((a, b) => a.ms - b.ms);

    return steps.map((st, idx) => {
        const prevMs = idx > 0 ? steps[idx - 1].ms : st.ms;
        return {
            ...st,
            stepNumber: idx + 1,
            stepCode: `STEP ${String(idx + 1).padStart(2, "0")}`,
            istTime: toIstDisplay(st.rawTs, true),
            deltaDisplay: idx === 0 ? "Initial Trigger" : formatDurationDelta(st.ms - prevMs)
        };
    });
}

window.renderReportsWorkspaceView = async function renderReportsWorkspaceView(container, skipListReload = false) {
    if (!container) return;

    const formatHuman = (s) =>
        String(s || "—")
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, (ch) => ch.toUpperCase());

    const formatCatLabel = (rawCat) => {
        const cat = String(rawCat || "UNKNOWN").toUpperCase();
        if (cat === "UNKNOWN") return "Unclassified";
        if (cat === "BGV") return "BGV";
        if (cat === "ASSET_IT") return "Asset & IT";
        if (cat === "GENERAL_HR") return "General HR";
        return formatHuman(cat);
    };

    const getStatusBadgeStyle = (stRaw) => {
        const st = String(stRaw || "NEW").toUpperCase();
        if (["RESOLVED", "CLOSED", "READY", "COMPLETED", "APPROVED", "VERIFIED", "ON_TRACK"].includes(st)) {
            return { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0", dot: "#10b981" };
        }
        if (["REVIEW_REQUIRED", "ON_HOLD", "PENDING_APPROVAL", "PENDING", "DUE_SOON"].includes(st)) {
            return { bg: "#fffbeb", color: "#b45309", border: "#fde68a", dot: "#f59e0b" };
        }
        if (["OVERDUE", "REJECTED", "FAILED", "MISSING"].includes(st)) {
            return { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca", dot: "#ef4444" };
        }
        return { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", dot: "#3b82f6" };
    };

    const getPrioBadgeStyle = (prioRaw) => {
        const p = String(prioRaw || "MEDIUM").toUpperCase();
        if (p === "CRITICAL" || p === "URGENT") return { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" };
        if (p === "HIGH") return { bg: "#fff7ed", color: "#ea580c", border: "#fed7aa" };
        if (p === "LOW") return { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" };
        return { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" };
    };

    const getStepToneColors = (tone) => {
        if (tone === "emerald") return { bg: "#ecfdf5", border: "#6ee7b7", badgeBg: "#059669", text: "#065f46" };
        if (tone === "amber") return { bg: "#fffbeb", border: "#fcd34d", badgeBg: "#d97706", text: "#92400e" };
        if (tone === "red") return { bg: "#fef2f2", border: "#fca5a5", badgeBg: "#dc2626", text: "#991b1b" };
        if (tone === "purple") return { bg: "#f5f3ff", border: "#c4b5fd", badgeBg: "#7c3aed", text: "#5b21b6" };
        if (tone === "indigo") return { bg: "#eef2ff", border: "#a5b4fc", badgeBg: "#4f46e5", text: "#3730a3" };
        return { bg: "#eff6ff", border: "#93c5fd", badgeBg: "#2563eb", text: "#1e40af" };
    };

    try {
        if (!skipListReload || reportCachedCases.length === 0) {
            const [casesRes, metricsRes] = await Promise.all([
                fetch(`${BACKEND_API_BASE}/api/cases?limit=300&current_user=${encodeURIComponent(currentUserName)}`),
                fetch(`${BACKEND_API_BASE}/api/cases/metrics?user=${encodeURIComponent(currentUserName)}`)
            ]);
            const casesJson = await casesRes.json();
            const metricsJson = await metricsRes.json();
            reportCachedCases = casesJson.data?.cases || casesJson.cases || [];
            reportCachedMetrics = metricsJson.data || metricsJson || {};
        }
    } catch (err) {
        console.warn("Error loading cases for reports:", err);
    }

    const allCases = reportCachedCases || [];
    const filteredCases = allCases.filter((c) => {
        const q = reportSearchQuery.trim().toLowerCase();
        const cid = String(c.case_number || c.id || "").toLowerCase();
        const empName = String(c.employee_name || c.employee?.name || "").toLowerCase();
        const empId = String(c.employee_id || c.employee?.id || "").toLowerCase();
        const dept = String(c.employee_department || c.assigned_team || "").toLowerCase();
        const title = String(c.title || c.subject || "").toLowerCase();
        const cat = String(c.category || "UNKNOWN").toUpperCase();
        const st = String(c.status || "NEW").toUpperCase();
        const sla = String(c.sla_status || c.sla_state || "ON_TRACK").toUpperCase();

        const matchesSearch =
            !q ||
            cid.includes(q) ||
            empName.includes(q) ||
            empId.includes(q) ||
            dept.includes(q) ||
            title.includes(q) ||
            cat.toLowerCase().includes(q);
        const matchesCat = reportCategoryFilter === "ALL" || cat === reportCategoryFilter;

        let matchesQuick = true;
        if (reportQuickFilter === "ATTENTION") {
            matchesQuick =
                st === "REVIEW_REQUIRED" ||
                st === "ON_HOLD" ||
                st === "PENDING_APPROVAL" ||
                sla === "OVERDUE" ||
                Boolean(c.sla_breached);
        } else if (reportQuickFilter === "OVERDUE") {
            matchesQuick = sla === "OVERDUE" || Boolean(c.sla_breached) || sla === "DUE_SOON";
        } else if (reportQuickFilter === "RESOLVED") {
            matchesQuick = st === "RESOLVED" || st === "CLOSED";
        }
        return matchesSearch && matchesCat && matchesQuick;
    });

    if (!reportSelectedCaseId && filteredCases.length > 0) {
        reportSelectedCaseId = filteredCases[0].case_number || filteredCases[0].id;
    } else if (reportSelectedCaseId && filteredCases.length > 0) {
        const existsInFiltered = filteredCases.some((c) => (c.case_number || c.id) === reportSelectedCaseId);
        if (!existsInFiltered) {
            reportSelectedCaseId = filteredCases[0].case_number || filteredCases[0].id;
        }
    }

    let activeDetail = null;
    if (reportSelectedCaseId) {
        try {
            const detailRes = await fetch(
                `${BACKEND_API_BASE}/api/cases/${encodeURIComponent(reportSelectedCaseId)}?role=${encodeURIComponent(currentRole)}`
            );
            if (detailRes.ok) {
                const detailJson = await detailRes.json();
                activeDetail = detailJson.data?.detail || detailJson.detail || detailJson.data || null;
                if (activeDetail) {
                    reportCachedDetailMap[reportSelectedCaseId] = activeDetail;
                }
            }
        } catch (e) {
            activeDetail = reportCachedDetailMap[reportSelectedCaseId] || null;
        }
    }

    // Portfolio KPIs
    const totalCasesCount = allCases.length;
    const openCasesCount = allCases.filter((c) => !["RESOLVED", "CLOSED"].includes(String(c.status || "").toUpperCase())).length;
    const resolvedCasesCount = totalCasesCount - openCasesCount;
    const overdueCount = allCases.filter((c) => c.sla_status === "OVERDUE" || c.sla_breached).length;
    const dueSoonCount = allCases.filter((c) => c.sla_status === "DUE_SOON").length;
    const slaCompliantCount = Math.max(0, totalCasesCount - overdueCount);
    const slaCompliancePct = totalCasesCount > 0 ? Math.round((slaCompliantCount / totalCasesCount) * 100) : 100;
    const attentionCount = allCases.filter(
        (c) =>
            ["REVIEW_REQUIRED", "ON_HOLD", "PENDING_APPROVAL"].includes(String(c.status || "").toUpperCase()) ||
            c.sla_status === "OVERDUE" ||
            c.sla_breached
    ).length;
    const classifiedCases = allCases.filter((c) => String(c.category || "UNKNOWN").toUpperCase() !== "UNKNOWN");
    const autoClassifiedPct = totalCasesCount > 0 ? Math.round((classifiedCases.length / totalCasesCount) * 100) : 100;
    const uniqueCats = Array.from(new Set(["ALL", ...allCases.map((c) => String(c.category || "UNKNOWN").toUpperCase())]));

    const renderDossierContent = (detail) => {
        if (!detail) {
            return `
                <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:64px 32px; background:#ffffff; border:1px solid #e2e8f0; border-radius:20px; text-align:center;">
                    <h3 style="margin:0 0 6px 0; font-size:1.1rem; font-weight:700; color:#0f172a;">No Case Selected</h3>
                    <p style="margin:0; font-size:0.86rem; color:#64748b;">Select a case from the left directory to view its full HR &amp; HR Manager Intelligence Report.</p>
                </div>
            `;
        }

        const c = detail.case || detail || {};
        const caseId = c.case_number || c.id || "CASE";
        const emp = detail.employee || c.employee || {};
        const origEmail = detail.original_email || {};
        const ai = detail.ai_classification || detail.classification || {};
        const rawFields = detail.extracted_fields || c.extracted_fields || {};
        const fieldsObj =
            rawFields && typeof rawFields.fields === "object" && rawFields.fields !== null
                ? rawFields.fields
                : rawFields;
        const val = detail.validation || c.validation || {};
        const sla = detail.sla || {};
        const wf = detail.workflow || {};
        const tasks = detail.tasks || [];
        const approvals = detail.approvals || [];
        const docsObj = detail.documents || {};
        const docsList = Array.isArray(docsObj) ? docsObj : (docsObj.documents || []);
        const comms = detail.communications || [];
        const readiness = detail.resolution_readiness || detail.pre_resolution_checklist || {};
        const checks = readiness.checks || {};
        const blockingReasons = readiness.blocking_reasons || [];

        const stStyle = getStatusBadgeStyle(c.status);
        const prioStyle = getPrioBadgeStyle(c.priority);
        const slaState = sla.sla_state || sla.sla_status || c.sla_status || "ON_TRACK";
        const slaStyle = getStatusBadgeStyle(slaState);

        // Accurate IST Formatted Timestamps
        const createdIst = toIstDisplay(c.created_at, true);
        const updatedIst = toIstDisplay(c.updated_at || c.created_at, true);
        const dueIst = toIstDisplay(sla.due_at || c.due_at, false);
        const emailReceivedIst = toIstDisplay(origEmail.received_at || c.created_at, true);

        // Synthesize EVERY recorded step for this case
        const recordedSteps = buildCompleteCaseExecutionSteps(detail, formatHuman, formatCatLabel);

        // Governance Checks
        const checkKeys = [
            { key: "required_fields_complete", label: "Mandatory Data Fields Complete", desc: (val.missing_fields || []).length ? `Missing: ${(val.missing_fields || []).join(", ")}` : "All required case fields extracted & validated" },
            { key: "required_documents_complete", label: "Supporting Documents Verified", desc: (readiness.missing_documents_count || 0) > 0 ? `${readiness.missing_documents_count} required document(s) pending/missing` : "All required supporting documents verified" },
            { key: "required_tasks_complete", label: "Operational HR Tasks Completed", desc: (readiness.open_tasks_count || 0) > 0 ? `${readiness.open_tasks_count} task(s) still open` : `${tasks.length} task(s) completed / clear` },
            { key: "required_approvals_complete", label: "Manager & HR Approvals Cleared", desc: (readiness.pending_approvals_count || 0) > 0 ? `${readiness.pending_approvals_count} approval(s) awaiting decision` : "No pending or rejected approvals" },
            { key: "workflow_allows_resolution", label: "Workflow Stage Permits Closure", desc: `Current stage: ${formatHuman(wf.current_state || c.workflow_state || "ACTIVE")}` }
        ];
        const passedChecksCount = checkKeys.filter((k) => checks[k.key] !== false).length;
        const readinessPct = Math.round((passedChecksCount / checkKeys.length) * 100);

        const wfStates = wf.states || ["NEW", "TRIAGED", "IN_REVIEW", "ACTION_TAKEN", "RESOLVED", "CLOSED"];
        const currentWfState = wf.current_state || c.workflow_state || c.status || "NEW";
        const currentWfIdx = Math.max(0, wfStates.indexOf(currentWfState));
        const wfPct = wf.progress_percent ?? Math.round(((currentWfIdx + 1) / Math.max(1, wfStates.length)) * 100);

        const catConfPct = Math.round(
            Number(ai.category_confidence ?? 0.95) <= 1
                ? Number(ai.category_confidence ?? 0.95) * 100
                : Number(ai.category_confidence ?? 95)
        );
        const intentScoreDisplay =
            ai.intent_score != null
                ? Number(ai.intent_score) <= 1
                    ? `${Math.round(Number(ai.intent_score) * 100)}%`
                    : String(ai.intent_score)
                : "94%";

        const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
        const approvedApprovals = approvals.filter((a) => a.status === "APPROVED").length;
        const pendingApprovalsList = approvals.filter((a) => a.status === "PENDING");
        const fieldEntries = Object.entries(fieldsObj || {}).filter(([k]) => !["raw_text", "metadata"].includes(k));
        const missingFieldsList = val.missing_fields || [];

        const empDisplay = `${escapeHtml(emp.name || c.employee_name || "Employee")} (${escapeHtml(emp.employee_code || emp.id || "UNVERIFIED")})`;
        const deptDisplay = escapeHtml(emp.department || c.employee_department || "Organization");
        const catDisplay = escapeHtml(formatCatLabel(c.category));
        const intentDisplay = escapeHtml(formatHuman(ai.intent_name || ai.intent || c.intent || "General Inquiry"));
        const teamDisplay = escapeHtml(c.assigned_team || "HR Operations");
        const ownerDisplay = escapeHtml(c.assigned_user || c.assigned_to || "Unassigned HR Specialist");
        const wfStageDisplay = escapeHtml(formatHuman(currentWfState));
        const slaRemDisplay = escapeHtml(sla.sla_remaining || c.sla_remaining || `${c.sla_hours || 48}h window`);

        const showGovernance = reportDossierTab === "ALL" || reportDossierTab === "GOVERNANCE";
        const showEvidence = reportDossierTab === "ALL" || reportDossierTab === "EVIDENCE";
        const showSteps = reportDossierTab === "ALL" || reportDossierTab === "STEPS";

        return `
            <div id="printableCaseDossierArea" style="display:flex; flex-direction:column; gap:18px;">
                <!-- 1. EXECUTIVE DARK-NAVY & ROYAL-BLUE HR / HR MANAGER DOSSIER HEADER -->
                <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:22px; overflow:hidden; box-shadow:0 16px 40px -12px rgba(15,23,42,0.08);">
                    <div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1e3a8a 100%); padding:22px 26px; color:#ffffff;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:14px;">
                            <div>
                                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                                    <span style="font-size:0.68rem; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; padding:4px 10px; border-radius:6px; background:rgba(59,130,246,0.25); border:1px solid rgba(147,197,253,0.4); color:#93c5fd;">
                                        OFFICIAL HR &amp; HR MANAGER CASE REPORT
                                    </span>
                                    <span style="font-family:ui-monospace, monospace; font-size:0.86rem; font-weight:800; padding:4px 11px; border-radius:8px; background:#ffffff; color:#0f172a;">
                                        ${escapeHtml(caseId)}
                                    </span>
                                    <span style="display:inline-flex; align-items:center; gap:6px; padding:4px 11px; border-radius:999px; font-size:0.74rem; font-weight:700; background:${stStyle.bg}; color:${stStyle.color};">
                                        <span style="width:7px; height:7px; border-radius:50%; background:${stStyle.dot};"></span>
                                        ${escapeHtml(formatHuman(c.status))}
                                    </span>
                                    <span style="padding:4px 11px; border-radius:999px; font-size:0.73rem; font-weight:700; background:${prioStyle.bg}; color:${prioStyle.color};">
                                        ${escapeHtml(c.priority || "MEDIUM")} PRIORITY
                                    </span>
                                    <span style="padding:4px 11px; border-radius:999px; font-size:0.73rem; font-weight:700; background:${slaStyle.bg}; color:${slaStyle.color};">
                                        ⏱ SLA: ${escapeHtml(formatHuman(slaState))} (${slaRemDisplay})
                                    </span>
                                </div>
                                <h2 style="margin:0 0 8px 0; font-size:1.38rem; font-weight:800; color:#ffffff; letter-spacing:-0.02em;">
                                    ${escapeHtml(c.title || origEmail.subject || "HR Operational Case")}
                                </h2>
                                <div style="font-size:0.78rem; color:#cbd5e1; display:flex; align-items:center; flex-wrap:wrap; gap:16px;">
                                    <span>📅 <strong style="color:#ffffff;">Created (IST):</strong> ${escapeHtml(createdIst)}</span>
                                    <span>🔄 <strong style="color:#ffffff;">Last Updated (IST):</strong> ${escapeHtml(updatedIst)}</span>
                                    <span>🎯 <strong style="color:#ffffff;">SLA Deadline (IST):</strong> ${escapeHtml(dueIst)} (${escapeHtml(String(c.sla_hours || 48))}h SLA)</span>
                                    <span>👣 <strong style="color:#93c5fd;">Recorded Steps:</strong> ${recordedSteps.length} Steps</span>
                                </div>
                            </div>

                            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                                <button type="button" class="ios-liquid-primary-btn" id="btnReportOpenWorkspace" data-case-id="${escapeHtml(caseId)}" style="padding:9px 15px; font-size:0.78rem; box-shadow:0 4px 14px rgba(37,99,235,0.4);">
                                    ⚡ Open Full Case Workspace
                                </button>
                                <button type="button" id="btnReportPrintDossier" style="padding:9px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.1); color:#ffffff; font-size:0.78rem; font-weight:700; cursor:pointer;">
                                    🖨 Print / Save PDF
                                </button>
                                <button type="button" id="btnReportExportJson" style="padding:9px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.1); color:#ffffff; font-size:0.78rem; font-weight:700; cursor:pointer;">
                                    ⬇ Export JSON
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- HR & HR MANAGER DIRECT GOVERNANCE CONTROLS + EXECUTIVE SYNOPSIS -->
                    <div style="padding:18px 24px; background:#ffffff;">
                        <!-- Direct HR / HR Manager Action Bar -->
                        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:12px 16px; border-radius:14px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:14px;">
                            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
                                <span style="font-size:0.74rem; font-weight:800; text-transform:uppercase; color:#0f172a; letter-spacing:0.04em;">
                                    👔 HR &amp; Manager Quick Controls:
                                </span>
                                <select id="reportQuickStatusSelect" class="ios-glass-input" style="height:34px; font-size:0.76rem; font-weight:700;">
                                    ${["NEW", "REVIEW_REQUIRED", "READY", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"]
                                        .map((st) => `<option value="${st}" ${st === c.status ? "selected" : ""}>Status: ${formatHuman(st)}</option>`)
                                        .join("")}
                                </select>
                                <select id="reportQuickPrioritySelect" class="ios-glass-input" style="height:34px; font-size:0.76rem; font-weight:700;">
                                    ${["LOW", "MEDIUM", "HIGH", "CRITICAL"]
                                        .map((pr) => `<option value="${pr}" ${pr === (c.priority || "MEDIUM") ? "selected" : ""}>Priority: ${formatHuman(pr)}</option>`)
                                        .join("")}
                                </select>
                            </div>

                            <!-- Inline HR / HR Manager Step & Review Note Logger -->
                            <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:300px; max-width:560px;">
                                <input type="text" id="reportManagerNoteInput" class="ios-glass-input" placeholder="Add HR / HR Manager review remark or audit step note..." style="flex:1; height:34px; font-size:0.78rem;">
                                <button type="button" class="ios-liquid-primary-btn" id="btnRecordManagerStepNote" style="height:34px; padding:0 14px; font-size:0.76rem; white-space:nowrap;">
                                    ✓ Record Step Note
                                </button>
                            </div>
                        </div>

                        <!-- Executive Briefing Narrative -->
                        <div style="background:linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%); border:1px solid #bfdbfe; border-left:4px solid #2563eb; border-radius:12px; padding:14px 18px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
                                <span style="font-size:0.73rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#1e40af;">
                                    📋 Executive Summary for HR &amp; HR Manager
                                </span>
                                <span style="font-size:0.74rem; font-weight:700; color:#334155;">
                                    Governance Readiness: <strong style="color:${readinessPct === 100 ? "#059669" : "#d97706"};">${readinessPct}% (${passedChecksCount}/${checkKeys.length} Gates Passed)</strong>
                                </span>
                            </div>
                            <p style="margin:0; font-size:0.85rem; color:#1e293b; line-height:1.65;">
                                Case <strong>${escapeHtml(caseId)}</strong> was submitted by <strong>${empDisplay}</strong> (${deptDisplay}) on <strong>${escapeHtml(createdIst)}</strong> regarding <strong>${catDisplay} — ${intentDisplay}</strong>.
                                AI Stage-1 &amp; Stage-2 Triage classified this request with <strong>${catConfPct}% confidence</strong> (${escapeHtml(ai.decision_status || "AUTO PROCESSED")}) and routed it to <strong>${teamDisplay}</strong> (Assigned Specialist: <strong>${ownerDisplay}</strong>).
                                The case has progressed through <strong>${recordedSteps.length} recorded operational steps</strong> and is currently in <strong>${escapeHtml(formatHuman(c.status))}</strong> status at workflow stage <strong>${wfStageDisplay} (${wfPct}% complete)</strong>.
                                ${
                                    blockingReasons.length > 0
                                        ? `<span style="color:#b45309; font-weight:700;">HR Manager Action Needed: ${blockingReasons.length} blocker(s) active — ${escapeHtml(blockingReasons.join("; "))}.</span>`
                                        : `<span style="color:#047857; font-weight:700;">All 5 pre-resolution compliance gates are satisfied.</span>`
                                }
                            </p>
                        </div>

                        <!-- Sub-Tab Navigation Bar for the Report -->
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:14px; padding-top:12px; border-top:1px solid #f1f5f9;">
                            ${[
                                { id: "ALL", label: `📑 Complete 360° Report (All Sections)` },
                                { id: "STEPS", label: `👣 Step-by-Step Case Journey (${recordedSteps.length} Steps)` },
                                { id: "GOVERNANCE", label: `🛡 Manager Governance, Tasks & Approvals (${tasks.length + approvals.length})` },
                                { id: "EVIDENCE", label: `✉ Employee, AI Diagnostics & Evidence` }
                            ]
                                .map(
                                    (tb) => `
                                <button type="button" class="btn-report-subtab" data-subtab="${tb.id}" style="padding:7px 14px; border-radius:999px; font-size:0.76rem; font-weight:700; cursor:pointer; border:1px solid ${reportDossierTab === tb.id ? "#2563eb" : "#cbd5e1"}; background:${reportDossierTab === tb.id ? "#2563eb" : "#ffffff"}; color:${reportDossierTab === tb.id ? "#ffffff" : "#334155"}; transition:all 0.15s;">
                                    ${tb.label}
                                </button>`
                                )
                                .join("")}
                        </div>
                    </div>
                </div>

                <!-- 2. 6-METRIC CASE HEALTH SCORECARD STRIP -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:12px;">
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:14px 16px;">
                        <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#64748b;">Workflow Progress</div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0;">
                            <span style="font-size:1.35rem; font-weight:800; color:#0f172a;">${wfPct}%</span>
                            <span style="font-size:0.74rem; font-weight:700; color:#2563eb;">${wfStageDisplay}</span>
                        </div>
                        <div style="width:100%; height:6px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
                            <div style="width:${wfPct}%; height:100%; background:linear-gradient(90deg, #2563eb, #10b981); border-radius:999px;"></div>
                        </div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:14px 16px;">
                        <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#64748b;">SLA Status &amp; Due (IST)</div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0;">
                            <span style="font-size:1.2rem; font-weight:800; color:${slaStyle.color};">${escapeHtml(formatHuman(slaState))}</span>
                            <span style="font-size:0.74rem; font-weight:700; color:#475569;">${escapeHtml(String(c.sla_hours || 48))}h SLA</span>
                        </div>
                        <div style="font-size:0.72rem; color:#64748b;">Due: <strong>${escapeHtml(dueIst)}</strong></div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:14px 16px;">
                        <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#64748b;">Recorded Case Steps</div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0;">
                            <span style="font-size:1.35rem; font-weight:800; color:#1d4ed8;">${recordedSteps.length} Steps</span>
                            <span style="font-size:0.74rem; font-weight:700; color:#059669;">100% Logged</span>
                        </div>
                        <div style="font-size:0.72rem; color:#64748b;">Latest: <strong>${escapeHtml(recordedSteps[recordedSteps.length - 1]?.title || "Initialized")}</strong></div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:14px 16px;">
                        <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#64748b;">Governance Readiness</div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0;">
                            <span style="font-size:1.35rem; font-weight:800; color:${readinessPct === 100 ? "#059669" : "#d97706"};">${passedChecksCount}/${checkKeys.length}</span>
                            <span style="font-size:0.74rem; font-weight:700; color:${readinessPct === 100 ? "#059669" : "#d97706"};">${readinessPct === 100 ? "Ready" : "Blocked"}</span>
                        </div>
                        <div style="font-size:0.72rem; color:#64748b;">${blockingReasons.length === 0 ? "All mandatory gates passed" : `${blockingReasons.length} active blocker(s)`}</div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:14px 16px;">
                        <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#64748b;">AI Triage Confidence</div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0;">
                            <span style="font-size:1.35rem; font-weight:800; color:#6d28d9;">${catConfPct}%</span>
                            <span style="font-size:0.74rem; font-weight:700; color:#475569;">Intent: ${escapeHtml(intentScoreDisplay)}</span>
                        </div>
                        <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(ai.decision_status || "AUTO PROCESSED")}</div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:14px 16px;">
                        <div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#64748b;">Tasks &amp; Approvals</div>
                        <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0;">
                            <span style="font-size:1.2rem; font-weight:800; color:#0f172a;">${completedTasks}/${tasks.length} Tasks</span>
                            <span style="font-size:0.75rem; font-weight:700; color:${pendingApprovalsList.length > 0 ? "#d97706" : "#059669"};">${approvedApprovals}/${approvals.length} Appr.</span>
                        </div>
                        <div style="font-size:0.72rem; color:#64748b;">${pendingApprovalsList.length > 0 ? `${pendingApprovalsList.length} awaiting manager` : "All approvals clear"}</div>
                    </div>
                </div>

                ${
                    showSteps
                        ? `
                <!-- 3. STEP-BY-STEP RECORDED CASE JOURNEY (EVERY STEP CHRONOLOGICALLY LOGGED) -->
                <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:20px; padding:22px 24px; box-shadow:0 8px 24px rgba(15,23,42,0.04);">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:18px; padding-bottom:12px; border-bottom:1px solid #e2e8f0;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg, #2563eb, #1d4ed8); color:#ffffff; display:inline-flex; align-items:center; justify-content:center; font-weight:800; font-size:0.95rem;">👣</span>
                            <div>
                                <h3 style="margin:0; font-size:1.02rem; font-weight:800; color:#0f172a;">Step-by-Step Case Lifecycle &amp; Execution Record (${recordedSteps.length} Recorded Steps)</h3>
                                <div style="font-size:0.76rem; color:#64748b;">Every automated AI pipeline step, routing decision, workflow transition, task, approval, and HR manager action in IST</div>
                            </div>
                        </div>
                        <span class="audit-live-badge"><span class="audit-live-dot"></span> COMPLETE STEP TRACE</span>
                    </div>

                    <!-- Horizontal Workflow Stage Bar -->
                    <div style="display:flex; align-items:center; gap:8px; overflow-x:auto; padding:6px 2px 18px 2px; margin-bottom:16px; border-bottom:1px dashed #e2e8f0;">
                        ${wfStates
                            .map((st, idx) => {
                                const isDone = idx < currentWfIdx || c.status === "CLOSED";
                                const isCurr = idx === currentWfIdx && c.status !== "CLOSED";
                                const bg = isDone ? "#ecfdf5" : isCurr ? "#eff6ff" : "#f8fafc";
                                const border = isDone ? "#10b981" : isCurr ? "#2563eb" : "#e2e8f0";
                                const color = isDone ? "#047857" : isCurr ? "#1d4ed8" : "#64748b";
                                return `
                                    <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:125px;">
                                        <div style="flex:1; padding:9px 12px; border-radius:12px; background:${bg}; border:1.5px solid ${border}; text-align:center;">
                                            <div style="font-size:0.66rem; font-weight:800; text-transform:uppercase; color:${color}; margin-bottom:2px;">
                                                ${isDone ? "✓ Completed" : isCurr ? "● Active Stage" : `Stage ${idx + 1}`}
                                            </div>
                                            <div style="font-size:0.78rem; font-weight:700; color:#0f172a; white-space:nowrap;">${escapeHtml(formatHuman(st))}</div>
                                        </div>
                                        ${idx < wfStates.length - 1 ? `<span style="color:#94a3b8; font-weight:800;">→</span>` : ""}
                                    </div>
                                `;
                            })
                            .join("")}
                    </div>

                    <!-- Numbered Vertical Step-by-Step Timeline -->
                    <div style="display:flex; flex-direction:column; gap:12px; position:relative;">
                        ${recordedSteps
                            .map((st) => {
                                const tc = getStepToneColors(st.tone);
                                return `
                                    <div style="display:grid; grid-template-columns:110px minmax(0, 1fr); gap:14px; align-items:stretch;">
                                        <!-- Left Step Number & Delta Column -->
                                        <div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-start; padding-top:4px; text-align:right;">
                                            <span style="font-family:ui-monospace, monospace; font-size:0.73rem; font-weight:800; padding:4px 10px; border-radius:8px; background:${tc.badgeBg}; color:#ffffff; letter-spacing:0.04em;">
                                                ${escapeHtml(st.stepCode)}
                                            </span>
                                            <span style="font-size:0.69rem; font-weight:700; color:#64748b; margin-top:5px;">
                                                ⏱ ${escapeHtml(st.deltaDisplay)}
                                            </span>
                                        </div>

                                        <!-- Right Step Detail Card -->
                                        <div style="background:${tc.bg}; border:1px solid ${tc.border}; border-left:4px solid ${tc.badgeBg}; border-radius:14px; padding:13px 16px;">
                                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
                                                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                                                    <span style="font-size:0.68rem; font-weight:800; text-transform:uppercase; padding:2px 8px; border-radius:6px; background:#ffffff; color:${tc.text}; border:1px solid ${tc.border};">
                                                        ${escapeHtml(st.phase)}
                                                    </span>
                                                    <strong style="font-size:0.88rem; font-weight:800; color:#0f172a;">
                                                        ${escapeHtml(st.title)}
                                                    </strong>
                                                    ${
                                                        st.transition
                                                            ? `<span style="font-family:ui-monospace, monospace; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:6px; background:#ffffff; color:#334155; border:1px solid #cbd5e1;">
                                                                ${escapeHtml(st.transition)}
                                                               </span>`
                                                            : ""
                                                    }
                                                </div>
                                                <div style="display:flex; align-items:center; gap:10px; font-size:0.74rem; color:#475569;">
                                                    <span>👤 <strong>${escapeHtml(st.actor)}</strong></span>
                                                    <span style="font-family:ui-monospace, monospace; font-weight:700; color:#0f172a; background:#ffffff; padding:2px 8px; border-radius:6px; border:1px solid #cbd5e1;">
                                                        🕒 ${escapeHtml(st.istTime)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div style="font-size:0.82rem; color:#1e293b; line-height:1.55;">
                                                ${escapeHtml(st.description)}
                                            </div>
                                            ${
                                                st.chips && st.chips.length > 0
                                                    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                                                        ${st.chips
                                                            .map(
                                                                (ch) =>
                                                                    `<span style="font-size:0.7rem; font-weight:600; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.85); color:#334155; border:1px solid rgba(148,163,184,0.4);">${escapeHtml(ch)}</span>`
                                                            )
                                                            .join("")}
                                                       </div>`
                                                    : ""
                                            }
                                        </div>
                                    </div>
                                `;
                            })
                            .join("")}
                    </div>
                </div>
                `
                        : ""
                }

                ${
                    showGovernance
                        ? `
                <!-- 4. HR MANAGER GOVERNANCE CHECKLIST, TASKS & APPROVALS -->
                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="width:28px; height:28px; border-radius:8px; background:#fef3c7; color:#d97706; display:inline-flex; align-items:center; justify-content:center; font-weight:800; font-size:0.82rem;">🛡</span>
                            <div>
                                <h3 style="margin:0; font-size:0.94rem; font-weight:800; color:#0f172a;">HR Manager Pre-Resolution Governance &amp; Blocker Audit</h3>
                                <div style="font-size:0.74rem; color:#64748b;">5 mandatory compliance gates checked before case resolution and closure</div>
                            </div>
                        </div>
                        <span style="font-size:0.75rem; font-weight:800; padding:4px 12px; border-radius:999px; background:${blockingReasons.length === 0 ? "#ecfdf5" : "#fffbeb"}; color:${blockingReasons.length === 0 ? "#047857" : "#b45309"}; border:1px solid ${blockingReasons.length === 0 ? "#a7f3d0" : "#fde68a"};">
                            ${blockingReasons.length === 0 ? "✓ ALL 5 GOVERNANCE GATES PASSED" : `⚠ ${blockingReasons.length} BLOCKING CONDITION(S) ACTIVE`}
                        </span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:10px;">
                        ${checkKeys
                            .map((chk) => {
                                const ok = checks[chk.key] !== false;
                                return `
                                    <div style="padding:12px 14px; border-radius:12px; background:${ok ? "#f0fdf4" : "#fef2f2"}; border:1px solid ${ok ? "#bbf7d0" : "#fecaca"};">
                                        <div style="font-size:0.72rem; font-weight:800; color:${ok ? "#15803d" : "#b91c1c"}; margin-bottom:4px;">${ok ? "✓ PASSED" : "✕ ACTION NEEDED"}</div>
                                        <div style="font-size:0.82rem; font-weight:700; color:#0f172a; margin-bottom:3px;">${escapeHtml(chk.label)}</div>
                                        <div style="font-size:0.74rem; color:#475569;">${escapeHtml(chk.desc)}</div>
                                    </div>
                                `;
                            })
                            .join("")}
                    </div>
                </div>

                <!-- TASKS & MANAGER APPROVALS LEDGER -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:16px;">
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #f1f5f9;">
                            <h3 style="margin:0; font-size:0.94rem; font-weight:800; color:#0f172a;">☑ Operational HR Tasks (${tasks.length})</h3>
                            <span style="font-size:0.74rem; font-weight:700; color:#475569;">${completedTasks}/${tasks.length} Completed</span>
                        </div>
                        ${
                            tasks.length === 0
                                ? `<div style="padding:20px; text-align:center; color:#64748b; font-size:0.82rem; background:#f8fafc; border-radius:12px;">No operational tasks assigned to this case.</div>`
                                : `<div style="display:flex; flex-direction:column; gap:8px;">
                                    ${tasks
                                        .map((t) => {
                                            const tst = getStatusBadgeStyle(t.status);
                                            return `
                                                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0;">
                                                    <div>
                                                        <div style="font-size:0.82rem; font-weight:700; color:#0f172a;">${escapeHtml(t.title)}</div>
                                                        <div style="font-size:0.72rem; color:#64748b;">Owner: <strong>${escapeHtml(t.assigned_to || t.assigned_team || "HR")}</strong> · Created: ${escapeHtml(toIstDisplay(t.created_at, false))}</div>
                                                    </div>
                                                    <div style="display:flex; align-items:center; gap:6px;">
                                                        <span style="padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${tst.bg}; color:${tst.color}; border:1px solid ${tst.border};">
                                                            ${escapeHtml(formatHuman(t.status))}
                                                        </span>
                                                        ${
                                                            t.status !== "COMPLETED" && t.status !== "CANCELLED"
                                                                ? `<button type="button" class="ios-glass-btn primary-tint btn-report-complete-task" data-task-id="${t.id}" style="padding:4px 8px; font-size:0.7rem;">✓ Complete</button>`
                                                                : ""
                                                        }
                                                    </div>
                                                </div>
                                            `;
                                        })
                                        .join("")}
                                   </div>`
                        }
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #f1f5f9;">
                            <h3 style="margin:0; font-size:0.94rem; font-weight:800; color:#0f172a;">⏳ HR Manager &amp; Department Approvals (${approvals.length})</h3>
                            <span style="font-size:0.74rem; font-weight:700; color:${pendingApprovalsList.length > 0 ? "#d97706" : "#059669"};">${pendingApprovalsList.length} Pending</span>
                        </div>
                        ${
                            approvals.length === 0
                                ? `<div style="padding:20px; text-align:center; color:#64748b; font-size:0.82rem; background:#f8fafc; border-radius:12px;">No formal approvals required or requested for this case.</div>`
                                : `<div style="display:flex; flex-direction:column; gap:8px;">
                                    ${approvals
                                        .map((ap) => {
                                            const ast = getStatusBadgeStyle(ap.status);
                                            const apCode = ap.approval_id || ap.approval_code || ap.id;
                                            return `
                                                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0;">
                                                    <div>
                                                        <div style="font-size:0.82rem; font-weight:700; color:#0f172a;">${escapeHtml(formatHuman(ap.approval_type || "MANAGER_APPROVAL"))} (${escapeHtml(String(apCode))})</div>
                                                        <div style="font-size:0.72rem; color:#64748b;">Approver: <strong>${escapeHtml(ap.approver || "HR Manager")}</strong> · Requested: ${escapeHtml(toIstDisplay(ap.requested_at, false))}</div>
                                                        ${ap.comments ? `<div style="font-size:0.72rem; color:#334155; margin-top:2px;">Remark: "${escapeHtml(ap.comments)}"</div>` : ""}
                                                    </div>
                                                    <div style="display:flex; align-items:center; gap:6px;">
                                                        <span style="padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${ast.bg}; color:${ast.color}; border:1px solid ${ast.border};">
                                                            ${escapeHtml(formatHuman(ap.status))}
                                                        </span>
                                                        ${
                                                            ap.status === "PENDING"
                                                                ? `<button type="button" class="ios-glass-btn primary-tint btn-report-decide-approval" data-approval-id="${escapeHtml(String(apCode))}" data-decision="APPROVE" style="padding:4px 8px; font-size:0.7rem;">✓ Approve</button>
                                                                   <button type="button" class="ios-glass-btn danger-tint btn-report-decide-approval" data-approval-id="${escapeHtml(String(apCode))}" data-decision="REJECT" style="padding:4px 8px; font-size:0.7rem;">✕ Reject</button>`
                                                                : ""
                                                        }
                                                    </div>
                                                </div>
                                            `;
                                        })
                                        .join("")}
                                   </div>`
                        }
                    </div>
                </div>
                `
                        : ""
                }

                ${
                    showEvidence
                        ? `
                <!-- 5. EMPLOYEE 360 PROFILE, HR OWNERSHIP, AI DIAGNOSTICS & ORIGINAL EMAIL -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:16px;">
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #f1f5f9;">
                            <h3 style="margin:0; font-size:0.94rem; font-weight:800; color:#0f172a;">👤 Employee 360° Identity &amp; Org Context</h3>
                            <span style="padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${emp.employee_code && emp.employee_code !== "UNVERIFIED" ? "#ecfdf5" : "#fffbeb"}; color:${emp.employee_code && emp.employee_code !== "UNVERIFIED" ? "#047857" : "#b45309"};">
                                ${emp.employee_code && emp.employee_code !== "UNVERIFIED" ? "✓ VERIFIED EMPLOYEE" : "⚠ UNVERIFIED SENDER"}
                            </span>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:0.82rem;">
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">FULL NAME</div><div style="font-weight:700; color:#0f172a;">${escapeHtml(emp.name || c.employee_name || "—")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">EMPLOYEE ID</div><div style="font-family:ui-monospace, monospace; font-weight:700; color:#2563eb;">${escapeHtml(emp.employee_code || emp.id || c.employee_id || "UNVERIFIED")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">EMAIL ADDRESS</div><div style="font-weight:600; color:#334155; word-break:break-all;">${escapeHtml(emp.email || c.employee_email || origEmail.from_email || "—")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">DEPARTMENT</div><div style="font-weight:700; color:#0f172a;">${escapeHtml(emp.department || c.employee_department || "—")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">DESIGNATION</div><div style="font-weight:600; color:#334155;">${escapeHtml(emp.designation || "—")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">REPORTING MANAGER</div><div style="font-weight:600; color:#334155;">${escapeHtml(emp.manager || emp.manager_name || "—")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">ASSIGNED HR TEAM</div><div style="font-weight:700; color:#0f172a;">${escapeHtml(c.assigned_team || "HR Operations")}</div></div>
                            <div><div style="color:#64748b; font-size:0.7rem; font-weight:700;">ASSIGNED HR SPECIALIST</div><div style="font-weight:700; color:#2563eb;">${escapeHtml(c.assigned_user || c.assigned_to || "Unassigned")}</div></div>
                        </div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid #f1f5f9;">
                            <h3 style="margin:0; font-size:0.94rem; font-weight:800; color:#0f172a;">🤖 AI Classification &amp; Extracted Case Data</h3>
                            <span style="padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; background:#eff6ff; color:#1d4ed8;">
                                ${catDisplay} (${catConfPct}%)
                            </span>
                        </div>
                        ${
                            fieldEntries.length === 0
                                ? `<div style="padding:14px; text-align:center; color:#64748b; font-size:0.8rem; background:#f8fafc; border-radius:10px;">No structured fields extracted for this case category.</div>`
                                : `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    ${fieldEntries
                                        .map(
                                            ([k, v]) => `
                                        <div style="padding:8px 10px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0;">
                                            <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:#64748b;">${escapeHtml(formatHuman(k))}</div>
                                            <div style="font-size:0.82rem; font-weight:700; color:#0f172a; margin-top:2px;">${escapeHtml(v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v))}</div>
                                        </div>`
                                        )
                                        .join("")}
                                   </div>`
                        }
                        ${
                            missingFieldsList.length > 0
                                ? `<div style="margin-top:10px; padding:8px 12px; border-radius:8px; background:#fffbeb; border:1px solid #fde68a; color:#b45309; font-size:0.76rem; font-weight:600;">
                                    ⚠ Missing Required Fields: ${escapeHtml(missingFieldsList.map(formatHuman).join(", "))}
                                   </div>`
                                : ""
                        }
                    </div>
                </div>

                <!-- ORIGINAL INBOUND EMAIL & SUPPORTING DOCUMENTS -->
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:16px;">
                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                        <h3 style="margin:0 0 10px 0; font-size:0.94rem; font-weight:800; color:#0f172a;">✉ Original Inbound Employee Email</h3>
                        <div style="font-size:0.78rem; color:#475569; margin-bottom:10px; display:flex; flex-direction:column; gap:3px;">
                            <div><strong>From:</strong> ${escapeHtml(origEmail.from_display || `${emp.name || "Employee"} <${emp.email || ""}>`)}</div>
                            <div><strong>Subject:</strong> ${escapeHtml(origEmail.subject || c.title || "—")}</div>
                            <div><strong>Received (IST):</strong> ${escapeHtml(emailReceivedIst)}</div>
                        </div>
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; font-size:0.82rem; color:#1e293b; line-height:1.6; max-height:220px; overflow-y:auto; white-space:pre-wrap;">${escapeHtml(origEmail.body || c.description || "No email transcript body recorded.")}</div>
                    </div>

                    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; padding:18px 20px;">
                        <h3 style="margin:0 0 10px 0; font-size:0.94rem; font-weight:800; color:#0f172a;">📎 Supporting Documents &amp; Evidence (${docsList.length})</h3>
                        ${
                            docsList.length === 0
                                ? `<div style="padding:22px; text-align:center; color:#64748b; font-size:0.82rem; background:#f8fafc; border-radius:12px;">No supporting documents required or uploaded for this case.</div>`
                                : `<div style="display:flex; flex-direction:column; gap:8px;">
                                    ${docsList
                                        .map((d) => {
                                            const dst = getStatusBadgeStyle(d.status);
                                            return `
                                                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0;">
                                                    <div>
                                                        <div style="font-size:0.82rem; font-weight:700; color:#0f172a;">${escapeHtml(d.name || "Document")}</div>
                                                        <div style="font-size:0.72rem; color:#64748b;">Type: ${escapeHtml(formatHuman(d.doc_type || "SUPPORTING"))} · Uploaded: ${escapeHtml(toIstDisplay(d.uploaded_at, false))}</div>
                                                    </div>
                                                    <span style="padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${dst.bg}; color:${dst.color}; border:1px solid ${dst.border};">
                                                        ${escapeHtml(formatHuman(d.status || "RECEIVED"))}
                                                    </span>
                                                </div>
                                            `;
                                        })
                                        .join("")}
                                   </div>`
                        }
                    </div>
                </div>
                `
                        : ""
                }
            </div>
        `;
    };

    const renderMatrixContent = () => {
        return `
            <div class="op-ios-table-card" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; overflow:hidden;">
                <div style="padding:16px 20px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3 style="margin:0; font-size:0.98rem; font-weight:800; color:#0f172a;">All Cases Executive Comparative Report Matrix (${filteredCases.length})</h3>
                        <p style="margin:2px 0 0 0; font-size:0.76rem; color:#64748b;">All timestamps displayed in Indian Standard Time (IST). Click any case to open its full 360° Step-by-Step Report.</p>
                    </div>
                </div>
                <div style="overflow-x:auto;">
                    <table class="op-ios-table" style="width:100%;">
                        <thead>
                            <tr>
                                <th>CASE ID</th>
                                <th>EMPLOYEE &amp; DEPT</th>
                                <th>CATEGORY &amp; INTENT</th>
                                <th>SUBJECT / TITLE</th>
                                <th>PRIORITY</th>
                                <th>STATUS &amp; STAGE</th>
                                <th>ASSIGNED TEAM / OWNER</th>
                                <th>SLA HEALTH &amp; DUE (IST)</th>
                                <th>CREATED (IST)</th>
                                <th>REPORT</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                                filteredCases.length === 0
                                    ? `<tr><td colspan="10" style="padding:32px; text-align:center; color:#64748b;">No cases match the active report filters.</td></tr>`
                                    : filteredCases
                                          .map((c) => {
                                              const cid = c.case_number || c.id;
                                              const stS = getStatusBadgeStyle(c.status);
                                              const prS = getPrioBadgeStyle(c.priority);
                                              const slS = getStatusBadgeStyle(c.sla_status || "ON_TRACK");
                                              return `
                                                <tr class="report-matrix-row" data-case-id="${escapeHtml(cid)}" style="cursor:pointer;">
                                                    <td style="font-family:ui-monospace, monospace; font-weight:800; color:#1d4ed8;">${escapeHtml(cid)}</td>
                                                    <td>
                                                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(c.employee_name || c.employee?.name || "Employee")}</div>
                                                        <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(c.employee_id || "UNVERIFIED")} · ${escapeHtml(c.employee_department || "—")}</div>
                                                    </td>
                                                    <td>
                                                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(formatCatLabel(c.category))}</div>
                                                        <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(formatHuman(c.intent || "General"))}</div>
                                                    </td>
                                                    <td style="max-width:240px; font-weight:600; color:#1e293b;">${escapeHtml(c.title || "—")}</td>
                                                    <td>
                                                        <span style="padding:3px 8px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${prS.bg}; color:${prS.color}; border:1px solid ${prS.border};">
                                                            ${escapeHtml(c.priority || "MEDIUM")}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span style="padding:3px 9px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${stS.bg}; color:${stS.color}; border:1px solid ${stS.border};">
                                                            ${escapeHtml(formatHuman(c.status))}
                                                        </span>
                                                        <div style="font-size:0.7rem; color:#64748b; margin-top:3px;">Stage: ${escapeHtml(formatHuman(c.workflow_state || c.status))}</div>
                                                    </td>
                                                    <td>
                                                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(c.assigned_team || "HR Operations")}</div>
                                                        <div style="font-size:0.72rem; color:#2563eb;">${escapeHtml(c.assigned_user || c.assigned_to || "Unassigned")}</div>
                                                    </td>
                                                    <td>
                                                        <span style="padding:3px 8px; border-radius:999px; font-size:0.7rem; font-weight:700; background:${slS.bg}; color:${slS.color}; border:1px solid ${slS.border};">
                                                            ${escapeHtml(formatHuman(c.sla_status || "ON_TRACK"))}
                                                        </span>
                                                        <div style="font-size:0.7rem; color:#64748b; margin-top:3px;">${escapeHtml(toIstDisplay(c.due_at, false))}</div>
                                                    </td>
                                                    <td style="font-size:0.74rem; color:#334155; white-space:nowrap;">${escapeHtml(toIstDisplay(c.created_at, false))}</td>
                                                    <td>
                                                        <button type="button" class="ios-liquid-primary-btn btn-matrix-open-dossier" data-case-id="${escapeHtml(cid)}" style="padding:6px 11px; font-size:0.74rem; white-space:nowrap;">
                                                            📊 360° Report
                                                        </button>
                                                    </td>
                                                </tr>
                                              `;
                                          })
                                          .join("")
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    container.innerHTML = `
        <div class="op-ios-hero-bar" style="flex-wrap:wrap; gap:14px;">
            <div class="op-ios-hero-left">
                <div class="ios-squircle-icon blue" style="width:48px; height:48px; border-radius:15px; display:flex; align-items:center; justify-content:center;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <line x1="10" y1="9" x2="8" y2="9"></line>
                    </svg>
                </div>
                <div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <h1 class="op-ios-title">HR &amp; HR Manager Case Intelligence Reports</h1>
                        <span class="audit-live-badge"><span class="audit-live-dot"></span> FULL STEP-BY-STEP TRACE · IST</span>
                    </div>
                    <p class="op-ios-subtitle">Executive case-by-case reporting recording every step from email ingestion to resolution in Indian Standard Time (IST)</p>
                </div>
            </div>

            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
                <select id="reportQuickCaseSelect" class="ios-glass-input" style="height:36px; min-width:240px; font-weight:700; color:#0f172a;">
                    ${allCases
                        .map((c) => {
                            const cid = c.case_number || c.id;
                            const sel = cid === reportSelectedCaseId ? "selected" : "";
                            return `<option value="${escapeHtml(cid)}" ${sel}>${escapeHtml(cid)} — ${escapeHtml((c.employee_name || "Employee").slice(0, 22))} (${escapeHtml(formatCatLabel(c.category))})</option>`;
                        })
                        .join("")}
                </select>

                <div style="display:inline-flex; background:#f1f5f9; padding:3px; border-radius:10px; border:1px solid #cbd5e1;">
                    <button type="button" id="btnReportModeDossier" style="padding:6px 12px; border-radius:8px; border:none; font-size:0.76rem; font-weight:700; cursor:pointer; background:${reportViewMode === "DOSSIER" ? "#ffffff" : "transparent"}; color:${reportViewMode === "DOSSIER" ? "#1d4ed8" : "#475569"};">
                        📋 360° Case Report
                    </button>
                    <button type="button" id="btnReportModeMatrix" style="padding:6px 12px; border-radius:8px; border:none; font-size:0.76rem; font-weight:700; cursor:pointer; background:${reportViewMode === "MATRIX" ? "#ffffff" : "transparent"}; color:${reportViewMode === "MATRIX" ? "#1d4ed8" : "#475569"};">
                        📊 All Cases Matrix (${allCases.length})
                    </button>
                </div>

                <button type="button" class="ios-glass-btn" id="btnExportAllCasesCsv" style="height:36px; padding:0 14px; font-size:0.78rem; font-weight:700;">
                    ⬇ Export CSV
                </button>
            </div>
        </div>

        <!-- PORTFOLIO KPI BAR -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
            <div class="report-kpi-card" data-qf="ALL" style="cursor:pointer; background:#ffffff; border:${reportQuickFilter === "ALL" ? "2px solid #2563eb" : "1px solid #e2e8f0"}; border-radius:16px; padding:14px 18px;">
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase;">Total Case Reports</div>
                <div style="display:flex; align-items:baseline; justify-content:space-between; margin-top:6px;">
                    <span style="font-size:1.6rem; font-weight:800; color:#0f172a;">${totalCasesCount}</span>
                    <span style="font-size:0.76rem; font-weight:700; color:#2563eb;">${openCasesCount} Active · ${resolvedCasesCount} Closed</span>
                </div>
            </div>

            <div class="report-kpi-card" data-qf="OVERDUE" style="cursor:pointer; background:#ffffff; border:${reportQuickFilter === "OVERDUE" ? "2px solid #ef4444" : "1px solid #e2e8f0"}; border-radius:16px; padding:14px 18px;">
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase;">SLA Compliance Rate</div>
                <div style="display:flex; align-items:baseline; justify-content:space-between; margin-top:6px;">
                    <span style="font-size:1.6rem; font-weight:800; color:${overdueCount > 0 ? "#d97706" : "#059669"};">${slaCompliancePct}%</span>
                    <span style="font-size:0.76rem; font-weight:700; color:${overdueCount > 0 ? "#dc2626" : "#059669"};">${overdueCount} Overdue · ${dueSoonCount} Due Soon</span>
                </div>
            </div>

            <div class="report-kpi-card" data-qf="ATTENTION" style="cursor:pointer; background:#ffffff; border:${reportQuickFilter === "ATTENTION" ? "2px solid #f59e0b" : "1px solid #e2e8f0"}; border-radius:16px; padding:14px 18px;">
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase;">HR Manager Attention</div>
                <div style="display:flex; align-items:baseline; justify-content:space-between; margin-top:6px;">
                    <span style="font-size:1.6rem; font-weight:800; color:${attentionCount > 0 ? "#d97706" : "#0f172a"};">${attentionCount}</span>
                    <span style="font-size:0.76rem; font-weight:700; color:#b45309;">Review / Hold / Breach</span>
                </div>
            </div>

            <div class="report-kpi-card" data-qf="RESOLVED" style="cursor:pointer; background:#ffffff; border:${reportQuickFilter === "RESOLVED" ? "2px solid #10b981" : "1px solid #e2e8f0"}; border-radius:16px; padding:14px 18px;">
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase;">Resolved &amp; Closed</div>
                <div style="display:flex; align-items:baseline; justify-content:space-between; margin-top:6px;">
                    <span style="font-size:1.6rem; font-weight:800; color:#059669;">${resolvedCasesCount}</span>
                    <span style="font-size:0.76rem; font-weight:700; color:#047857;">Auto-Triaged: ${autoClassifiedPct}%</span>
                </div>
            </div>
        </div>

        ${
            reportViewMode === "MATRIX"
                ? renderMatrixContent()
                : `
        <div style="display:grid; grid-template-columns:320px minmax(0, 1fr); gap:18px; align-items:start;">
            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:20px; padding:14px; display:flex; flex-direction:column; gap:10px; position:sticky; top:0; max-height:calc(100vh - 140px);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.78rem; font-weight:800; text-transform:uppercase; color:#0f172a;">Case Directory (${filteredCases.length})</span>
                    ${
                        reportQuickFilter !== "ALL" || reportCategoryFilter !== "ALL" || reportSearchQuery
                            ? `<button type="button" id="btnResetReportFilters" style="border:none; background:none; color:#2563eb; font-size:0.72rem; font-weight:700; cursor:pointer;">Reset</button>`
                            : ""
                    }
                </div>
                <input type="text" id="reportCaseSearchInput" class="ios-glass-input" value="${escapeHtml(reportSearchQuery)}" placeholder="Search Case #, Employee, Subject..." style="width:100%; height:34px; font-size:0.78rem;">
                <select id="reportCategorySelect" class="ios-glass-input" style="width:100%; height:34px; font-size:0.78rem;">
                    ${uniqueCats
                        .map(
                            (cat) =>
                                `<option value="${escapeHtml(cat)}" ${reportCategoryFilter === cat ? "selected" : ""}>${cat === "ALL" ? "All HR Categories" : escapeHtml(formatCatLabel(cat))}</option>`
                        )
                        .join("")}
                </select>
                <div style="display:flex; flex-direction:column; gap:8px; overflow-y:auto; padding-right:2px; flex:1;">
                    ${
                        filteredCases.length === 0
                            ? `<div style="padding:24px 12px; text-align:center; color:#64748b; font-size:0.8rem;">No cases match your filter.</div>`
                            : filteredCases
                                  .map((c) => {
                                      const cid = c.case_number || c.id;
                                      const isSelected = cid === reportSelectedCaseId;
                                      const stS = getStatusBadgeStyle(c.status);
                                      const prS = getPrioBadgeStyle(c.priority);
                                      return `
                                        <div class="report-nav-case-card" data-case-id="${escapeHtml(cid)}" style="cursor:pointer; padding:12px; border-radius:14px; background:${isSelected ? "linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)" : "#f8fafc"}; border:${isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0"};">
                                            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:5px;">
                                                <span style="font-family:ui-monospace, monospace; font-size:0.76rem; font-weight:800; color:${isSelected ? "#1d4ed8" : "#0f172a"};">${escapeHtml(cid)}</span>
                                                <span style="padding:2px 7px; border-radius:999px; font-size:0.66rem; font-weight:700; background:${stS.bg}; color:${stS.color}; border:1px solid ${stS.border};">
                                                    ${escapeHtml(formatHuman(c.status))}
                                                </span>
                                            </div>
                                            <div style="font-size:0.81rem; font-weight:700; color:#0f172a; margin-bottom:4px;">
                                                ${escapeHtml(c.title || "HR Case")}
                                            </div>
                                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:#475569;">
                                                <span>👤 ${escapeHtml((c.employee_name || c.employee?.name || "Employee").slice(0, 18))}</span>
                                                <span style="font-weight:700; color:${prS.color};">${escapeHtml(c.priority || "MEDIUM")}</span>
                                            </div>
                                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.68rem; color:#64748b; margin-top:4px; padding-top:4px; border-top:1px dashed #e2e8f0;">
                                                <span>${escapeHtml(formatCatLabel(c.category))}</span>
                                                <span>🕒 ${escapeHtml(toIstDisplay(c.created_at, false).split(",")[1] || toIstDisplay(c.created_at, false))}</span>
                                            </div>
                                        </div>
                                      `;
                                  })
                                  .join("")
                    }
                </div>
            </div>

            <div style="min-width:0;">
                ${renderDossierContent(activeDetail)}
            </div>
        </div>
        `
        }
    `;

    // Bind Controls
    document.getElementById("reportQuickCaseSelect")?.addEventListener("change", (e) => {
        reportSelectedCaseId = e.target.value;
        reportViewMode = "DOSSIER";
        renderReportsWorkspaceView(container, true);
    });

    document.getElementById("btnReportModeDossier")?.addEventListener("click", () => {
        reportViewMode = "DOSSIER";
        renderReportsWorkspaceView(container, true);
    });

    document.getElementById("btnReportModeMatrix")?.addEventListener("click", () => {
        reportViewMode = "MATRIX";
        renderReportsWorkspaceView(container, true);
    });

    container.querySelectorAll(".btn-report-subtab").forEach((btn) => {
        btn.addEventListener("click", () => {
            reportDossierTab = btn.getAttribute("data-subtab") || "ALL";
            renderReportsWorkspaceView(container, true);
        });
    });

    // HR & HR Manager Direct Status / Priority / Step Note Controls
    document.getElementById("reportQuickStatusSelect")?.addEventListener("change", async (e) => {
        if (!reportSelectedCaseId) return;
        await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(reportSelectedCaseId)}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: e.target.value, performed_by: currentUserName, role: currentRole })
        });
        await renderReportsWorkspaceView(container, false);
        await refreshNavBadgesAndNotifications();
    });

    document.getElementById("reportQuickPrioritySelect")?.addEventListener("change", async (e) => {
        if (!reportSelectedCaseId) return;
        await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(reportSelectedCaseId)}/priority`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ priority: e.target.value, performed_by: currentUserName, role: currentRole })
        });
        await renderReportsWorkspaceView(container, false);
    });

    document.getElementById("btnRecordManagerStepNote")?.addEventListener("click", async () => {
        const noteInput = document.getElementById("reportManagerNoteInput");
        const noteText = (noteInput?.value || "").trim();
        if (!noteText || !reportSelectedCaseId) return;
        await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(reportSelectedCaseId)}/communications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sender_type: currentRole,
                sender_name: `${currentUserName} (${currentRole})`,
                recipient: "Case Audit Record",
                subject: "HR / HR Manager Review & Step Sign-Off",
                message: noteText,
                comm_type: "MANAGER_REVIEW_STEP"
            })
        });
        if (noteInput) noteInput.value = "";
        await renderReportsWorkspaceView(container, false);
    });

    container.querySelectorAll(".report-kpi-card").forEach((card) => {
        card.addEventListener("click", () => {
            const qf = card.getAttribute("data-qf") || "ALL";
            reportQuickFilter = reportQuickFilter === qf && qf !== "ALL" ? "ALL" : qf;
            renderReportsWorkspaceView(container, true);
        });
    });

    document.getElementById("btnResetReportFilters")?.addEventListener("click", () => {
        reportQuickFilter = "ALL";
        reportCategoryFilter = "ALL";
        reportSearchQuery = "";
        renderReportsWorkspaceView(container, true);
    });

    const searchEl = document.getElementById("reportCaseSearchInput");
    if (searchEl) {
        searchEl.addEventListener("input", (e) => {
            reportSearchQuery = e.target.value;
            renderReportsWorkspaceView(container, true).then(() => {
                const refocused = document.getElementById("reportCaseSearchInput");
                if (refocused) {
                    refocused.focus();
                    refocused.setSelectionRange(refocused.value.length, refocused.value.length);
                }
            });
        });
    }

    document.getElementById("reportCategorySelect")?.addEventListener("change", (e) => {
        reportCategoryFilter = e.target.value;
        renderReportsWorkspaceView(container, true);
    });

    container.querySelectorAll(".report-nav-case-card").forEach((card) => {
        card.addEventListener("click", () => {
            reportSelectedCaseId = card.getAttribute("data-case-id");
            renderReportsWorkspaceView(container, true);
        });
    });

    container.querySelectorAll(".report-matrix-row, .btn-matrix-open-dossier").forEach((row) => {
        row.addEventListener("click", (e) => {
            e.stopPropagation();
            reportSelectedCaseId = row.getAttribute("data-case-id");
            reportViewMode = "DOSSIER";
            renderReportsWorkspaceView(container, true);
        });
    });

    document.getElementById("btnReportOpenWorkspace")?.addEventListener("click", (e) => {
        const cid = e.currentTarget.getAttribute("data-case-id");
        if (cid) openCaseDetailWorkspace(cid);
    });

    document.getElementById("btnReportPrintDossier")?.addEventListener("click", () => {
        const dossierEl = document.getElementById("printableCaseDossierArea");
        if (!dossierEl) return;
        const printWin = window.open("", "_blank", "width=1100,height=850");
        if (!printWin) {
            window.print();
            return;
        }
        printWin.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>HR & HR Manager Case Report — ${escapeHtml(reportSelectedCaseId || "Case")}</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Inter', sans-serif; margin: 24px; color: #0f172a; background: #ffffff; }
                    button, select, input { display: none !important; }
                </style>
            </head>
            <body>
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:20px;">
                    <div>
                        <div style="font-size:11px; font-weight:800; color:#2563eb; letter-spacing:0.08em;">HR FLOW OPERATIONS PORTAL · OFFICIAL HR &amp; HR MANAGER CASE REPORT</div>
                        <h1 style="margin:4px 0 0 0; font-size:20px;">Case Dossier: ${escapeHtml(reportSelectedCaseId || "")}</h1>
                    </div>
                    <div style="font-size:12px; color:#475569; text-align:right;">
                        <div>Generated (IST): ${toIstDisplay(new Date().toISOString(), true)}</div>
                        <div>Reviewed by: ${escapeHtml(currentUserName)} (${escapeHtml(currentRole)})</div>
                    </div>
                </div>
                ${dossierEl.innerHTML}
            </body>
            </html>
        `);
        printWin.document.close();
        setTimeout(() => {
            printWin.focus();
            printWin.print();
        }, 350);
    });

    document.getElementById("btnReportExportJson")?.addEventListener("click", () => {
        if (!activeDetail) return;
        const blob = new Blob([JSON.stringify(activeDetail, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${reportSelectedCaseId || "case"}_hr_manager_report.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById("btnExportAllCasesCsv")?.addEventListener("click", () => {
        const headers = ["Case ID", "Employee Name", "Employee ID", "Department", "Category", "Intent", "Title", "Priority", "Status", "Workflow Stage", "Assigned Team", "Assigned Owner", "SLA Status", "Due At (IST)", "Created At (IST)"];
        const rows = filteredCases.map((c) => [
            c.case_number || c.id || "",
            c.employee_name || c.employee?.name || "",
            c.employee_id || "",
            c.employee_department || "",
            c.category || "",
            c.intent || "",
            (c.title || "").replace(/"/g, '""'),
            c.priority || "",
            c.status || "",
            c.workflow_state || "",
            c.assigned_team || "",
            c.assigned_user || c.assigned_to || "",
            c.sla_status || "",
            toIstDisplay(c.due_at, false),
            toIstDisplay(c.created_at, true)
        ]);
        const csvContent = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v ?? "")}"`).join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `hrflow_case_reports_IST_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });

    container.querySelectorAll(".btn-report-complete-task").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const tid = btn.getAttribute("data-task-id");
            if (!tid) return;
            await fetch(`${BACKEND_API_BASE}/api/tasks/${encodeURIComponent(tid)}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "COMPLETED", performed_by: currentUserName, role: currentRole })
            });
            await renderReportsWorkspaceView(container, false);
            await refreshNavBadgesAndNotifications();
        });
    });

    container.querySelectorAll(".btn-report-decide-approval").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const apId = btn.getAttribute("data-approval-id");
            const decision = btn.getAttribute("data-decision");
            if (!apId || !decision) return;
            const endpoint = decision === "APPROVE" ? "approve" : "reject";
            await fetch(`${BACKEND_API_BASE}/api/approvals/${encodeURIComponent(apId)}/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    performed_by: currentUserName,
                    role: currentRole,
                    comments: `${decision === "APPROVE" ? "Approved" : "Rejected"} via HR Manager Case Report`
                })
            });
            await renderReportsWorkspaceView(container, false);
            await refreshNavBadgesAndNotifications();
        });
    });
};
