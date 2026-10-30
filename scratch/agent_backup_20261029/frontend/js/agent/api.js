/**
 * api.js — Agent Workbench API Service Layer
 * Centralized client for all Agent Workbench endpoints.
 */

const API_BASE =
    typeof window !== "undefined" && window.location &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    window.location.port &&
    window.location.port !== "5000"
        ? "http://127.0.0.1:5000"
        : "";

function getSessionUser() {
    try {
        const u = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
        return u ? JSON.parse(u) : null;
    } catch (_) {
        return null;
    }
}

function getAuthHeaders(extraHeaders = {}) {
    const token = sessionStorage.getItem("hrflow_token") || localStorage.getItem("hrflow_last_token") || "";
    const user = getSessionUser();
    const headers = {
        "Content-Type": "application/json",
        ...extraHeaders,
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    if (user?.role) {
        headers["X-HR-Role"] = user.role;
    }
    if (user?.email) {
        headers["X-HR-Email"] = user.email;
    }
    const deptId = localStorage.getItem("hrflow_agent_active_dept_id");
    if (deptId) {
        headers["X-HR-Dept-Id"] = deptId;
    }
    return headers;
}

async function request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = getAuthHeaders(options.headers || {});
    const config = {
        ...options,
        headers,
    };

    const res = await fetch(url, config);
    let data;
    try {
        data = await res.json();
    } catch (_) {
        data = { status: "error", message: `HTTP ${res.status}: ${res.statusText}` };
    }

    if (!res.ok || data.status === "error") {
        const errMsg = data.message || data.error?.message || `Request failed (${res.status})`;
        const error = new Error(errMsg);
        error.status = res.status;
        error.data = data;
        throw error;
    }

    return data.data !== undefined ? data.data : data;
}

export const AgentAPI = {
    getSessionUser,
    getAuthHeaders,

    async fetchWorkbench({ email, agentId, deptId } = {}) {
        const qs = new URLSearchParams();
        if (email) qs.set("email", email);
        if (agentId) qs.set("agent_id", agentId);
        if (deptId) qs.set("dept_id", deptId);
        const query = qs.toString() ? `?${qs.toString()}` : "";
        return request(`/api/agent/my-workbench${query}`, { method: "GET" });
    },

    async fetchCaseDetail(caseRef) {
        if (!caseRef) throw new Error("caseRef is required");
        return request(`/api/agent/cases/${encodeURIComponent(caseRef)}/detail`, { method: "GET" });
    },

    async claimCase(caseRef) {
        return request(`/api/agent/cases/${encodeURIComponent(caseRef)}/claim`, {
            method: "POST",
            body: JSON.stringify({}),
        });
    },

    async reassignCase(caseRef, { target_agent_id, target_dept_id, note } = {}) {
        return request(`/api/agent/cases/${encodeURIComponent(caseRef)}/reassign`, {
            method: "POST",
            body: JSON.stringify({
                target_agent_id,
                target_dept_id,
                note: note || "Reassigned by specialist",
            }),
        });
    },

    async executeCaseAction(caseRef, actionPayload) {
        return request(`/api/agent/cases/${encodeURIComponent(caseRef)}/action`, {
            method: "POST",
            body: JSON.stringify(actionPayload || {}),
        });
    },

    async requestEmployeeInfo(caseRef, { message, requested_items } = {}) {
        return request(`/api/cases/${encodeURIComponent(caseRef)}/request-info`, {
            method: "POST",
            body: JSON.stringify({
                message: message || "Please provide the requested information to proceed.",
                requested_items: requested_items || [],
                reason: "Employee clarification required",
            }),
        });
    },

    async completeTask(taskId) {
        return request(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
            method: "POST",
            body: JSON.stringify({ notes: "Completed by HR Specialist" }),
        });
    },

    async createTask({ case_id, task_name, description, category } = {}) {
        return request(`/api/tasks`, {
            method: "POST",
            body: JSON.stringify({
                case_id,
                title: task_name || "Custom Verification Task",
                description: description || "",
                category: category || "OPERATIONS",
            }),
        });
    },

    async resolveCase(caseRef, { resolution_notes, resolution_category, send_email, email_body, proof_reference } = {}) {
        return request(`/api/cases/${encodeURIComponent(caseRef)}/resolve`, {
            method: "POST",
            body: JSON.stringify({
                resolution_notes: resolution_notes || "Resolved by HR Specialist",
                resolution_category: resolution_category || "RESOLVED",
                send_email: send_email !== false,
                email_body: email_body || "",
                proof_reference: proof_reference || "",
            }),
        });
    },

    async createNewCase(casePayload) {
        return request(`/api/agent/cases/create`, {
            method: "POST",
            body: JSON.stringify(casePayload),
        });
    },

    async switchRole(targetRole) {
        return request(`/api/auth/switch-role`, {
            method: "POST",
            body: JSON.stringify({ role: targetRole }),
        });
    },

    async logout() {
        try {
            await request(`/api/auth/logout`, { method: "POST" });
        } catch (_) {}
        sessionStorage.removeItem("hrflow_token");
        sessionStorage.removeItem("hrflow_user");
        localStorage.removeItem("hrflow_last_token");
        localStorage.removeItem("hrflow_last_user");
        window.location.replace("login.html");
    },
};
