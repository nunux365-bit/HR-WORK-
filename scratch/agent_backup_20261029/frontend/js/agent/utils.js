/**
 * utils.js — Agent Workbench Formatting & UI Helpers
 */

export function escapeHtml(raw) {
    if (raw == null) return "";
    return String(raw)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function formatHuman(str) {
    if (!str) return "—";
    return String(str)
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getInitials(name) {
    if (!name) return "AG";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatDate(isoStr) {
    if (!isoStr) return "—";
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return String(isoStr);
        return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch (_) {
        return String(isoStr);
    }
}

export function getCategoryTone(category) {
    const cat = String(category || "GENERAL_HR").toUpperCase();
    if (cat === "PAYROLL" || cat === "BENEFITS") {
        return { bg: "#eef2ff", fg: "#4338ca", border: "#c7d2fe", label: "Payroll", tone: "indigo" };
    }
    if (cat === "LEAVE") {
        return { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0", label: "Leave", tone: "emerald" };
    }
    if (cat === "ATTENDANCE") {
        return { bg: "#f0f9ff", fg: "#0369a1", border: "#bae6fd", label: "Attendance", tone: "cyan" };
    }
    if (cat === "RESIGNATION") {
        return { bg: "#fff1f2", fg: "#be123c", border: "#fecdd3", label: "Resignation", tone: "rose" };
    }
    if (cat === "ONBOARDING" || cat === "BGV") {
        return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a", label: "Onboarding", tone: "amber" };
    }
    if (cat === "ASSET_IT") {
        return { bg: "#f5f3ff", fg: "#6d28d9", border: "#ddd6fe", label: "IT & Assets", tone: "violet" };
    }
    return { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1", label: formatHuman(cat), tone: "slate" };
}

export function getStatusBadge(status) {
    const st = String(status || "NEW").toUpperCase();
    if (st === "RESOLVED" || st === "CLOSED") {
        return { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0", label: "Resolved" };
    }
    if (st === "IN_PROGRESS" || st === "READY") {
        return { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe", label: "In Progress" };
    }
    if (st === "AWAITING_EMPLOYEE_INFO" || st === "ON_HOLD") {
        return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a", label: "Awaiting Info" };
    }
    if (st === "PENDING_APPROVAL") {
        return { bg: "#f5f3ff", fg: "#6d28d9", border: "#ddd6fe", label: "Pending Approval" };
    }
    if (st === "REVIEW_REQUIRED" || st === "ESCALATED") {
        return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca", label: "Review Required" };
    }
    return { bg: "#f8fafc", fg: "#475569", border: "#e2e8f0", label: formatHuman(st) };
}

export function getPriorityBadge(priority) {
    const p = String(priority || "MEDIUM").toUpperCase();
    if (p === "CRITICAL") {
        return { bg: "#fef2f2", fg: "#dc2626", border: "#fecaca", label: "Critical" };
    }
    if (p === "HIGH") {
        return { bg: "#fff7ed", fg: "#ea580c", border: "#fed7aa", label: "High" };
    }
    if (p === "LOW") {
        return { bg: "#f8fafc", fg: "#64748b", border: "#e2e8f0", label: "Low" };
    }
    return { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1", label: "Medium" };
}

export function formatSlaCountdown(slaRemaining, slaStatus, caseStatus) {
    const isResolved = ["RESOLVED", "CLOSED"].includes(String(caseStatus || "").toUpperCase());
    if (isResolved) {
        return { text: "✓ Completed", tone: "completed", isPaused: false };
    }

    const isAwaiting = ["AWAITING_EMPLOYEE_INFO", "ON_HOLD"].includes(String(caseStatus || "").toUpperCase());
    if (isAwaiting) {
        return { text: "⏸️ SLA Paused (Awaiting Info)", tone: "paused", isPaused: true };
    }

    const st = String(slaStatus || "").toUpperCase();
    const rem = String(slaRemaining || "").trim();

    if (st === "OVERDUE" || st === "BREACHED" || rem.toLowerCase().includes("overdue")) {
        return { text: `⚠️ Overdue (${rem || "Breached"})`, tone: "overdue", isPaused: false };
    }

    if (st === "DUE_SOON" || rem.toLowerCase().includes("m remaining") || (rem.includes("h") && parseInt(rem) <= 4)) {
        return { text: `⏳ ${rem || "Due Soon"}`, tone: "urgent", isPaused: false };
    }

    return { text: `⏱️ ${rem || "48h remaining"}`, tone: "normal", isPaused: false };
}

