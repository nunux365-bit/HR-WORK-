/**
 * HR Flow — Unified Activity & Communications Timeline (frontend/js/casedetail/components/timeline.js)
 * Interactive Filter Tabs (All / Messages / Diagnostics / Audits) & Full Chronological Feed.
 */

import { escapeHtml, formatDateTimeIST } from "../utils/formatters.js";

export function renderTimeline(container, state) {
    const comms = state.caseData?.communications || [];
    const audits = state.caseData?.audit_logs || [];
    const actions = state.caseData?.hr_actions || [];

    // Combine and sort events by timestamp
    const allEvents = [];

    comms.forEach(c => {
        allEvents.push({
            type: "COMMUNICATION",
            title: c.comm_type === "REQUEST_INFO" ? "Information Requested" : (c.comm_type === "RESOLUTION_NOTICE" ? "Resolution Notice" : "Official Message"),
            desc: c.message,
            by: c.sender_name || c.sender_type || "Specialist",
            time: c.created_at,
            icon: c.comm_type === "REQUEST_INFO" ? "❓" : "💬",
            color: c.comm_type === "REQUEST_INFO" ? "#d97706" : "#2563eb",
        });
    });

    actions.forEach(a => {
        allEvents.push({
            type: "ACTION",
            title: a.title || a.action_type || "Diagnostic Check",
            desc: a.details || a.action_code,
            by: a.requested_by || "System Action",
            time: a.completed_at || a.created_at,
            icon: "⚡",
            color: "#059669",
        });
    });

    audits.forEach(au => {
        const isFeedback = au.action === "FEEDBACK_RECORDED" || String(au.description || "").includes("CSAT");
        allEvents.push({
            type: "AUDIT",
            title: isFeedback ? "⭐ Employee CSAT Feedback Recorded" : (au.action || "Audit Log"),
            desc: au.description,
            by: au.performed_by || "System",
            time: au.created_at,
            icon: isFeedback ? "⭐" : "📜",
            color: isFeedback ? "#f59e0b" : "#64748b",
        });
    });

    const fb = state.caseData?.feedback;
    const hasFeedbackInAudits = audits.some(a => a.action === "FEEDBACK_RECORDED");
    if (fb && fb.rating && !hasFeedbackInAudits) {
        allEvents.push({
            type: "AUDIT",
            title: `⭐ Employee CSAT: ${'★'.repeat(fb.rating)} ${fb.rating}.0 / 5 (${fb.rating_label || 'Rating'})`,
            desc: fb.comments ? `"${fb.comments}"` : "Verified rating submitted by employee.",
            by: fb.submitted_by || "Employee",
            time: fb.created_at,
            icon: "⭐",
            color: "#f59e0b",
        });
    }

    // Sort descending by time
    allEvents.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    let activeFilter = "ALL";

    function renderList(filter) {
        let filtered = allEvents;
        if (filter === "COMMUNICATION") filtered = allEvents.filter(e => e.type === "COMMUNICATION");
        else if (filter === "ACTION") filtered = allEvents.filter(e => e.type === "ACTION");
        else if (filter === "AUDIT") filtered = allEvents.filter(e => e.type === "AUDIT");

        if (filtered.length === 0) {
            return "<div style='color:var(--c-text-muted); font-size:0.75rem; text-align:center; padding:16px;'>No matching events in this view</div>";
        }

        return filtered.map(ev => `
            <div class="timeline-item">
                <div class="timeline-dot-col">
                    <div class="timeline-dot" style="background:${ev.color};"></div>
                    <div class="timeline-line"></div>
                </div>
                <div class="timeline-content-card">
                    <div class="timeline-header-row">
                        <span style="font-weight:700; color:#0f172a;">${ev.icon} ${escapeHtml(ev.title)} <span style="font-weight:500; color:var(--c-text-muted);">by ${escapeHtml(ev.by)}</span></span>
                        <span style="font-size:0.70rem; color:var(--c-text-muted);">${formatDateTimeIST(ev.time)}</span>
                    </div>
                    <div style="font-size:0.78rem; color:#334155; white-space:pre-wrap; word-break:break-word; margin-top:3px;">
                        ${escapeHtml(ev.desc || "")}
                    </div>
                </div>
            </div>
        `).join("");
    }

    container.innerHTML = `
        <div class="panel-card" style="box-shadow:none; border:none; padding:0;">
            <div class="card-header" style="padding-bottom:10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:1.1rem;">⏱️</span>
                    <h2 class="card-title" style="margin:0;">Activity &amp; Communications History</h2>
                </div>
                <span class="card-badge" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;">
                    ${allEvents.length} Total Events
                </span>
            </div>

            <!-- Filter Tabs Strip -->
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; padding:0 2px;">
                <button type="button" class="btn-action-pill timeline-tab-btn active" data-filter="ALL" style="height:24px; font-size:0.70rem; padding:0 8px;">
                    All (${allEvents.length})
                </button>
                <button type="button" class="btn-action-pill timeline-tab-btn" data-filter="COMMUNICATION" style="height:24px; font-size:0.70rem; padding:0 8px;">
                    💬 Messages (${comms.length})
                </button>
                <button type="button" class="btn-action-pill timeline-tab-btn" data-filter="ACTION" style="height:24px; font-size:0.70rem; padding:0 8px;">
                    ⚡ Diagnostics (${actions.length})
                </button>
                <button type="button" class="btn-action-pill timeline-tab-btn" data-filter="AUDIT" style="height:24px; font-size:0.70rem; padding:0 8px;">
                    📜 Audits (${audits.length})
                </button>
            </div>

            <div class="timeline-list" id="timelineListMount">
                ${renderList("ALL")}
            </div>
        </div>
    `;

    // Filter Buttons binding
    const listMount = container.querySelector("#timelineListMount");
    container.querySelectorAll(".timeline-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const filter = btn.dataset.filter;
            container.querySelectorAll(".timeline-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            if (listMount) listMount.innerHTML = renderList(filter);
        });
    });
}
