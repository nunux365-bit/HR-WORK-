/**
 * HR Flow — REST API Client (frontend/js/casedetail/api.js)
 * Agnostic endpoints for full case dossier and operations actions.
 */

const BACKEND_API_BASE = (() => {
    try {
        const hostname = window.location.hostname || "";
        const port = window.location.port || "";
        const isLocal = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "0.0.0.0";
        if (isLocal && port && port !== "5000") {
            return `${window.location.protocol}//${hostname}:5000`;
        }
        return "";
    } catch (_) {
        return "";
    }
})();

function getSessionUser() {
    try {
        const raw = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
        if (raw) return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {}
    return { name: "Vaibhav (HR)", role: "ADMIN", email: "vaibhavx002@gmail.com" };
}

function getSessionToken() {
    try {
        return sessionStorage.getItem("hrflow_token") || localStorage.getItem("hrflow_last_token") || "";
    } catch (_) {}
    return "";
}

function buildAuthHeaders() {
    const u = getSessionUser();
    const token = getSessionToken();
    const headers = {
        "Content-Type": "application/json",
        "X-HR-User": u.name || "Vaibhav (HR)",
        "X-HR-Role": u.role || "ADMIN",
        "X-HR-Email": u.email || "vaibhavx002@gmail.com",
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

export async function fetchDossier(caseRef) {
    // Attempt /api/cases/<caseRef>/dossier first, fallback to /api/agent/cases/<caseRef>/detail
    let res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseRef)}/dossier`, {
        headers: buildAuthHeaders(),
    });
    if (!res.ok) {
        res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/detail`, {
            headers: buildAuthHeaders(),
        });
    }
    if (!res.ok) {
        throw new Error(`Failed to load case dossier (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.data || json;
}

export async function executeCaseAction(caseRef, actionPayload) {
    const user = getSessionUser();
    const payload = {
        performed_by: user.name || "Agent",
        ...actionPayload,
    };
    const res = await fetch(`${BACKEND_API_BASE}/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `Action failed (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.data || json;
}

export async function updateStatus(caseRef, status, priority) {
    return executeCaseAction(caseRef, {
        action_type: "UPDATE_STATUS",
        status,
        priority,
    });
}

export async function setWorkflowStep(caseRef, step, draftNotes = "") {
    return executeCaseAction(caseRef, {
        action_type: "SET_STEP",
        step: Number(step),
        draft_notes: draftNotes,
    });
}

export async function toggleTask(caseRef, taskId, title = "") {
    return executeCaseAction(caseRef, {
        action_type: "TOGGLE_TASK",
        task_id: taskId,
        title: title,
    });
}

export async function addTask(caseRef, title, taskType = "CHECKBOX", guidance = "") {
    return executeCaseAction(caseRef, {
        action_type: "ADD_TASK",
        title,
        task_type: taskType,
        guidance,
    });
}

export async function saveDraft(caseRef, draftBody) {
    return executeCaseAction(caseRef, {
        action_type: "SAVE_DRAFT",
        draft: draftBody,
    });
}

export async function sendReply(caseRef, replyBody, isRequestInfo = false, nextStatus = null, recipientEmail = "") {
    return executeCaseAction(caseRef, {
        action_type: isRequestInfo ? "REQUEST_INFO" : "SEND_REPLY",
        reply_body: replyBody,
        next_status: nextStatus,
        recipient_email: recipientEmail,
    });
}

export async function saveForensicProof(caseRef, forensicProof) {
    return executeCaseAction(caseRef, {
        action_type: "SAVE_FORENSIC_PROOF",
        forensic_proof: forensicProof,
        reference_id: forensicProof.proofId || "",
        adjustment_amount: forensicProof.metric || "",
        resolution_notes: forensicProof.notes || "",
        verdict: forensicProof.verdict || "RESOLVED",
    });
}

export async function resolveCase(caseRef, resolutionType, notes, forensicProof = {}, notifyEmployee = true) {
    let payload = {};
    if (typeof resolutionType === "object" && resolutionType !== null) {
        payload = resolutionType;
    } else {
        payload = {
            resolution_type: resolutionType || "RESOLVED",
            resolution_notes: notes || "",
            reference_id: forensicProof.proofId || forensicProof.refId || "",
            adjustment_amount: forensicProof.metric || forensicProof.amount || "",
            forensic_proof: forensicProof,
            notify_employee: notifyEmployee !== false,
        };
    }
    return executeCaseAction(caseRef, {
        action_type: "RESOLVE",
        ...payload,
    });
}

export async function mergeCases(sourceRef, targetRef, reason = "") {
    return executeCaseAction(sourceRef, {
        action_type: "MERGE_CASE",
        target_case: targetRef,
        reason,
    });
}

export async function linkCases(sourceRef, targetRef, relation = "RELATED") {
    return executeCaseAction(sourceRef, {
        action_type: "LINK_CASE",
        target_case: targetRef,
        relation,
    });
}

export async function toggleFollow(caseRef) {
    return executeCaseAction(caseRef, {
        action_type: "TOGGLE_FOLLOW",
    });
}

export async function reassignCase(caseRef, targetUser, targetTeam = "") {
    return executeCaseAction(caseRef, {
        action_type: "REASSIGN",
        assigned_user: targetUser,
        assigned_to: targetUser,
        assigned_team: targetTeam,
    });
}

export async function escalateCase(caseRef, reason) {
    return executeCaseAction(caseRef, {
        action_type: "ESCALATE",
        reason,
    });
}

export async function requestApproval(caseRef, approvalType, approverRole, comments) {
    return executeCaseAction(caseRef, {
        action_type: "REQUEST_APPROVAL",
        approval_type: approvalType,
        approver_role: approverRole,
        comments,
    });
}

export async function executeIntegrationAction(caseRef, actionCode, actionTitle, provider, details, riskLevel = "LOW") {
    return executeCaseAction(caseRef, {
        action_type: "EXECUTE_HRMS_ACTION",
        action_code: actionCode,
        title: actionTitle,
        provider,
        details,
        risk_level: riskLevel,
    });
}

export async function savePlaybook(category, playbookData) {
    const res = await fetch(`${BACKEND_API_BASE}/api/agent/playbooks/${encodeURIComponent(category)}`, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify(playbookData),
    });
    if (!res.ok) {
        throw new Error(`Failed to save playbook (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.data || json;
}

export async function updateRequesterProfile(caseRef, empData) {
    return executeCaseAction(caseRef, {
        action_type: "UPDATE_EMPLOYEE",
        ...empData,
    });
}

export async function simulate24hReply(caseRef, replyText = "") {
    return executeCaseAction(caseRef, {
        action_type: "SIMULATE_24H_REPLY",
        reply_text: replyText || "Hello HR Operations, I reviewed the resolution update and would like to confirm my punch records.",
    });
}

export async function force24hAutoClose(caseRef) {
    return executeCaseAction(caseRef, {
        action_type: "FORCE_24H_AUTO_CLOSE",
    });
}

export async function getCaseFeedback(caseRef) {
    const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseRef)}/feedback`, {
        headers: buildAuthHeaders(),
    });
    if (!res.ok) {
        throw new Error(`Failed to load feedback (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.data || json;
}

export async function submitCaseFeedback(caseRef, rating, tags = [], comments = "") {
    const res = await fetch(`${BACKEND_API_BASE}/api/cases/${encodeURIComponent(caseRef)}/feedback`, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ rating, tags, comments }),
    });
    if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Failed to submit feedback");
    }
    const json = await res.json();
    return json.data || json;
}

export async function simulateFeedback(caseRef, rating = 5) {
    return executeCaseAction(caseRef, {
        action_type: "SIMULATE_FEEDBACK",
        rating: Number(rating),
        tags: ["Fast Resolution", "Clear Communication", "Courteous Specialist"],
        comments: "Issue regularized promptly. Great support from the PeopleDesk team!",
    });
}



