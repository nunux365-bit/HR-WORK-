/**
 * queueNav.js — Zone 1: Queue Navigation & Filter Bar
 */

import { Store } from "../state.js";

export function renderQueueNav() {
    const state = Store.getState();
    const counts = Store.getQueueCounts();
    const activeFilter = state.activeQueueFilter;

    const navItems = [
        {
            key: "MY_QUEUE",
            label: "My Active Queue",
            count: counts.myActive,
            icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>`,
            tone: "primary",
        },
        {
            key: "UNCLAIMED",
            label: "Team Pool (Unclaimed)",
            count: counts.unclaimed,
            icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
            tone: "indigo",
        },
        {
            key: "URGENT",
            label: "Urgent & SLA Risk",
            count: counts.urgent,
            icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
            tone: "rose",
        },
        {
            key: "AWAITING_INFO",
            label: "Awaiting Employee Info",
            count: counts.awaitingInfo,
            icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line></svg>`,
            tone: "amber",
        },
        {
            key: "ALL",
            label: "All Department Cases",
            count: counts.total,
            icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
            tone: "slate",
        },
        {
            key: "RESOLVED",
            label: "Resolved",
            count: counts.resolved,
            icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
            tone: "emerald",
        },
    ];

    return `
        <aside class="agent-zone-queue-nav">
            <div class="agent-nav-header">
                <span class="agent-nav-title">WORKSPACE QUEUES</span>
                <button type="button" class="btn-new-case-mini" id="btnTriggerNewCase" title="Log New Department Case">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>New Case</span>
                </button>
            </div>

            <nav class="agent-queue-list">
                ${navItems
                    .map((item) => {
                        const isActive = activeFilter === item.key;
                        return `
                            <button type="button" class="agent-queue-item ${isActive ? "active" : ""}" data-queue="${item.key}">
                                <span class="queue-icon ${item.tone}">${item.icon}</span>
                                <span class="queue-label">${item.label}</span>
                                <span class="queue-badge ${item.tone} ${isActive ? "active" : ""}">${item.count}</span>
                            </button>
                        `;
                    })
                    .join("")}
            </nav>

            <div class="agent-nav-footer">
                <div class="agent-desk-card">
                    <div class="agent-desk-status">
                        <span class="desk-dot-pulse"></span>
                        <span class="desk-status-text">Specialist Shift Active</span>
                    </div>
                    <div class="agent-desk-sub">SLA Response: <strong>Real-time</strong></div>
                </div>
            </div>
        </aside>
    `;
}

export function bindQueueNavEvents(container) {
    container.querySelectorAll(".agent-queue-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const queueKey = btn.getAttribute("data-queue");
            if (queueKey) {
                Store.setState({ activeQueueFilter: queueKey });
            }
        });
    });

    const newCaseBtn = container.querySelector("#btnTriggerNewCase");
    if (newCaseBtn) {
        newCaseBtn.addEventListener("click", () => {
            Store.setState({ activeModal: "NEW_CASE" });
        });
    }
}

