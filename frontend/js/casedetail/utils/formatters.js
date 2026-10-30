/**
 * HR Flow — Formatting & Utility Functions (frontend/js/casedetail/utils/formatters.js)
 */

export function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function formatHuman(str) {
    if (!str) return "";
    return String(str)
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

export function getInitials(name) {
    if (!name) return "U";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatDateTimeIST(isoStr) {
    if (!isoStr) return "Just now";
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return String(isoStr);
        return d.toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        }) + " IST";
    } catch (_) {
        return String(isoStr);
    }
}

export function interpolateTemplate(tpl, vars = {}) {
    if (!tpl) return "";
    let result = String(tpl);
    for (const [key, val] of Object.entries(vars)) {
        const cleanVal = val != null ? String(val) : "";
        result = result
            .replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), cleanVal)
            .replace(new RegExp(`\\{${key}\\}`, "g"), cleanVal);
    }
    return result;
}

export function showToast(message, type = "info") {
    let toast = document.getElementById("casedetailToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "casedetailToast";
        toast.className = "casedetail-toast";
        document.body.appendChild(toast);
    }
    toast.className = `casedetail-toast show ${type}`;
    const icon = type === "success" ? "✓ " : type === "error" ? "⚠️ " : "ℹ️ ";
    toast.textContent = `${icon}${message}`;

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 3200);
}

