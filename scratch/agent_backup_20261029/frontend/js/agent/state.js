/**
 * state.js — Reactive State Store & Event Hub for Agent Workbench
 */

class AgentStore {
    constructor() {
        this.state = {
            agent: null,
            kpis: {},
            cases: [],
            myCases: [],
            unclaimedCases: [],
            deptCases: [],
            allCases: [],
            allAgents: [],
            assignedDepartments: [],
            activeDeptId: null,
            activeDeptName: "HR Operations",

            // Filters & Selection
            activeQueueFilter: "ALL", // 'ALL' | 'MY_QUEUE' | 'UNCLAIMED' | 'URGENT' | 'AWAITING_INFO' | 'RESOLVED'
            activeCategoryFilter: "ALL",
            searchQuery: "",
            activeCaseRef: null,
            activeCaseDetail: null,
            activeHubTab: "CHECKLIST", // 'CHECKLIST' | 'INQUIRE' | 'DIAGNOSTICS' | 'APPROVALS' | 'COMPOSER'

            // Loading / Sync states
            isLoading: true,
            isDetailLoading: false,
            isSyncing: false,
            lastSyncTimestamp: null,

            // UI feedback
            toast: null,
            activeModal: null, // 'DEPT_SWITCH' | 'REASSIGN' | 'NEW_CASE' | null
            reassignCaseTarget: null,
        };

        this.listeners = new Set();
    }

    getState() {
        return this.state;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(changedKeys = []) {
        for (const listener of this.listeners) {
            try {
                listener(this.state, changedKeys);
            } catch (err) {
                console.error("Store listener error:", err);
            }
        }
    }

    setState(patch) {
        const changedKeys = Object.keys(patch);
        this.state = { ...this.state, ...patch };
        this.notify(changedKeys);
    }

    // Helper to evaluate assignment
    isCaseAssignedToMe(c) {
        if (c.is_assigned_to_me != null) return Boolean(c.is_assigned_to_me);
        const { agent } = this.state;
        const curEmail = (agent?.email || "").toLowerCase();
        const curName = (agent?.name || "").toLowerCase();
        const firstToken = curName.split(/\s+/)[0] || "";

        const assignedUser = String(c.assigned_user || "").toLowerCase();
        const assignedEmail = String(c.assigned_user_email || "").toLowerCase();
        const assignedTo = String(c.assigned_to || "").toLowerCase();

        return Boolean(
            (curEmail && assignedEmail === curEmail) ||
            (curName && assignedUser.includes(curName)) ||
            (curName && assignedTo.includes(curName)) ||
            (firstToken.length >= 3 && (assignedUser.includes(firstToken) || assignedTo.includes(firstToken)))
        );
    }

    isCaseUnclaimed(c) {
        if (c.is_unclaimed != null) return Boolean(c.is_unclaimed);
        if (this.isCaseAssignedToMe(c)) return false;
        const assignedUser = String(c.assigned_user || c.assigned_to || "").trim().toUpperCase();
        return !assignedUser || ["UNASSIGNED", "NONE", "PENDING", "HR OPERATIONS"].includes(assignedUser);
    }

    // Filter computation
    getFilteredCases() {
        const { cases, activeQueueFilter, activeCategoryFilter, searchQuery } = this.state;

        return cases.filter((c) => {
            const status = String(c.status || "").toUpperCase();
            const prio = String(c.priority || "").toUpperCase();
            const slaStatus = String(c.sla_status || c.sla_state || "").toUpperCase();
            const isResolved = status === "RESOLVED" || status === "CLOSED";
            const isAssigned = this.isCaseAssignedToMe(c);
            const isUncl = this.isCaseUnclaimed(c);
            const isAwaitingInfo = status === "AWAITING_EMPLOYEE_INFO" || status === "ON_HOLD";
            const isUrgent = !isResolved && (prio === "CRITICAL" || prio === "HIGH" || ["DUE_SOON", "OVERDUE", "BREACHED"].includes(slaStatus));

            // Queue filter
            if (activeQueueFilter === "MY_QUEUE") {
                if (!isAssigned || isResolved) return false;
            } else if (activeQueueFilter === "UNCLAIMED") {
                if (!isUncl || isResolved) return false;
            } else if (activeQueueFilter === "URGENT") {
                if (!isUrgent) return false;
            } else if (activeQueueFilter === "AWAITING_INFO") {
                if (!isAwaitingInfo || isResolved) return false;
            } else if (activeQueueFilter === "RESOLVED") {
                if (!isResolved) return false;
            } else if (activeQueueFilter === "ALL") {
                // Return everything for current department
            }

            // Category filter
            if (activeCategoryFilter !== "ALL") {
                const cat = String(c.category || "").toUpperCase();
                if (cat !== activeCategoryFilter.toUpperCase()) return false;
            }

            // Search query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const num = String(c.case_number || "").toLowerCase();
                const title = String(c.title || c.email_subject || "").toLowerCase();
                const empName = String(c.employee_name || c.sender_name || "").toLowerCase();
                const empCode = String(c.employee_code || c.emp_code || "").toLowerCase();
                const intent = String(c.intent || "").toLowerCase();

                if (!num.includes(q) && !title.includes(q) && !empName.includes(q) && !empCode.includes(q) && !intent.includes(q)) {
                    return false;
                }
            }

            return true;
        });
    }

    // Compute queue counts dynamically
    getQueueCounts() {
        const { cases } = this.state;

        let myActive = 0;
        let unclaimed = 0;
        let urgent = 0;
        let awaitingInfo = 0;
        let resolved = 0;

        for (const c of cases) {
            const status = String(c.status || "").toUpperCase();
            const prio = String(c.priority || "").toUpperCase();
            const slaStatus = String(c.sla_status || c.sla_state || "").toUpperCase();
            const isResolved = status === "RESOLVED" || status === "CLOSED";
            const isAssigned = this.isCaseAssignedToMe(c);
            const isUncl = this.isCaseUnclaimed(c);
            const isAwaiting = status === "AWAITING_EMPLOYEE_INFO" || status === "ON_HOLD";
            const isUrgent = !isResolved && (prio === "CRITICAL" || prio === "HIGH" || ["DUE_SOON", "OVERDUE", "BREACHED"].includes(slaStatus));

            if (isAssigned && !isResolved) myActive++;
            if (isUncl && !isResolved) unclaimed++;
            if (isUrgent) urgent++;
            if (isAwaiting && !isResolved) awaitingInfo++;
            if (isResolved) resolved++;
        }

        return {
            myActive,
            unclaimed,
            urgent,
            awaitingInfo,
            resolved,
            total: cases.length,
        };
    }

    // Draft persistence
    getDraft(caseRef, type = "reply") {
        try {
            return localStorage.getItem(`hrflow_draft_${caseRef}_${type}`) || "";
        } catch (_) {
            return "";
        }
    }

    saveDraft(caseRef, text, type = "reply") {
        try {
            if (text && text.trim()) {
                localStorage.setItem(`hrflow_draft_${caseRef}_${type}`, text);
            } else {
                localStorage.removeItem(`hrflow_draft_${caseRef}_${type}`);
            }
        } catch (_) {}
    }

    clearDraft(caseRef, type = "reply") {
        try {
            localStorage.removeItem(`hrflow_draft_${caseRef}_${type}`);
        } catch (_) {}
    }

    showToast(text, type = "success") {
        this.setState({ toast: { text, type, timestamp: Date.now() } });
        setTimeout(() => {
            const cur = this.state.toast;
            if (cur && Date.now() - cur.timestamp >= 4000) {
                this.setState({ toast: null });
            }
        }, 4500);
    }
}

export const Store = new AgentStore();
