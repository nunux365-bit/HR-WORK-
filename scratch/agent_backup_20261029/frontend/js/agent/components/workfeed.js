/**
 * workfeed.js — Zone 1: Smart Workfeed, Queue Filter Pills & Case List
 */

import { Store } from "../state.js";
import { escapeHtml, getInitials, getCategoryTone, getPriorityBadge, formatSlaCountdown } from "../utils.js";

export function renderWorkfeed() {
    const state = Store.getState();
    const filteredCases = Store.getFilteredCases();
    const counts = Store.getQueueCounts();
    const activeCaseRef = state.activeCaseRef;
    const activeFilter = state.activeQueueFilter;

    // Queue Segmented Dock Items
    const queueTabs = [
        { key: "MY_QUEUE", label: "My Queue", count: counts.myActive, tone: "blue" },
        { key: "UNCLAIMED", label: "Team Pool", count: counts.unclaimed, tone: "indigo" },
        { key: "URGENT", label: "Urgent SLA", count: counts.urgent, tone: "rose" },
        { key: "AWAITING_INFO", label: "Awaiting Info", count: counts.awaitingInfo, tone: "amber" },
        { key: "ALL", label: "All Cases", count: counts.total, tone: "slate" },
        { key: "RESOLVED", label: "Resolved", count: counts.resolved, tone: "emerald" },
    ];

    // Available category pills
    const categories = ["ALL", "PAYROLL", "LEAVE", "ATTENDANCE", "RESIGNATION", "ONBOARDING", "ASSET_IT"];

    return `
        <section class="agent-workfeed-pane">
            <!-- 1. Executive Horizontal Queue Segmented Pills Dock -->
            <div class="workfeed-queue-dock-wrap">
                <div class="workfeed-queue-segmented-dock" role="tablist" aria-label="Queue Filter">
                    ${queueTabs
                        .map((tab) => {
                            const isActive = activeFilter === tab.key;
                            return `
                                <button type="button" class="queue-dock-pill ${isActive ? "active" : ""}" data-queue="${tab.key}">
                                    <span class="dock-pill-label">${tab.label}</span>
                                    <span class="dock-pill-badge ${tab.tone} ${isActive ? "active" : ""}">${tab.count}</span>
                                </button>
                            `;
                        })
                        .join("")}
                </div>
            </div>

            <!-- 2. Search & Category Filter Row -->
            <div class="workfeed-search-strip">
                <div class="workfeed-search-wrap">
                    <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                        type="text"
                        class="workfeed-search-input"
                        id="workfeedSearchInput"
                        placeholder="Search employee, case #, intent..."
                        value="${escapeHtml(state.searchQuery)}"
                    />
                    ${state.searchQuery ? `<button type="button" class="search-clear-btn" id="btnSearchClear">✕</button>` : ""}
                </div>

                <div class="workfeed-category-pills">
                    ${categories
                        .map((cat) => {
                            const isActive = state.activeCategoryFilter === cat;
                            const label = cat === "ALL" ? "All" : cat === "ASSET_IT" ? "IT" : cat.charAt(0) + cat.slice(1).toLowerCase();
                            return `
                                <button type="button" class="category-pill-btn ${isActive ? "active" : ""}" data-category="${cat}">
                                    ${label}
                                </button>
                            `;
                        })
                        .join("")}
                </div>
            </div>

            <!-- 3. Feed Meta Bar -->
            <div class="workfeed-meta-bar">
                <span class="workfeed-count-text">
                    Showing <strong>${filteredCases.length}</strong> cases
                </span>
                <div class="workfeed-meta-actions">
                    <button type="button" class="btn-refresh-feed" id="btnRefreshFeed" title="Sync live updates">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                        <span>Sync</span>
                    </button>
                    <button type="button" class="btn-new-case-action" id="btnTriggerNewCase" title="Log New Department Case">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>New Case</span>
                    </button>
                </div>
            </div>

            <!-- 4. Scrollable Case Cards List -->
            <div class="workfeed-scroll-list">
                ${
                    filteredCases.length === 0
                        ? `
                        <div class="workfeed-empty-state">
                            <div class="empty-icon-circle">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="2" y="7" width="20" height="14" rx="2"></rect>
                                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                </svg>
                            </div>
                            <h3>No Cases in Current View</h3>
                            <p>Try switching queue tabs above or clearing filters.</p>
                        </div>
                    `
                        : filteredCases
                              .map((c) => {
                                  const ref = c.case_number || c.id;
                                  const isSelected = activeCaseRef && (String(activeCaseRef) === String(ref) || String(activeCaseRef) === String(c.id));
                                  const catTone = getCategoryTone(c.category);
                                  const prioInfo = getPriorityBadge(c.priority);
                                  const slaInfo = formatSlaCountdown(c.sla_remaining, c.sla_status || c.sla_state, c.status);
                                  const empName = c.employee_name && c.employee_name !== "Unknown" ? c.employee_name : (c.sender_name || "Employee");
                                  const empCode = c.employee_code || c.emp_code || "";
                                  const curStep = Number(c.current_step || 1);

                                  return `
                                    <article class="agent-case-card ${isSelected ? "selected" : ""}" data-case-ref="${escapeHtml(ref)}">
                                        <div class="card-top-strip">
                                            <span class="card-ref-badge">${escapeHtml(ref)}</span>
                                            <div class="card-badges-right">
                                                <span class="card-cat-badge" style="background:${catTone.bg}; color:${catTone.fg}; border:1px solid ${catTone.border};">
                                                    ${escapeHtml(catTone.label)}
                                                </span>
                                                <span class="card-prio-badge" style="background:${prioInfo.bg}; color:${prioInfo.fg}; border:1px solid ${prioInfo.border};">
                                                    ${escapeHtml(prioInfo.label)}
                                                </span>
                                            </div>
                                        </div>

                                        <h4 class="card-title">${escapeHtml(c.title || c.email_subject || `HR Request (${ref})`)}</h4>

                                        <div class="card-emp-row">
                                            <div class="card-emp-avatar">
                                                ${escapeHtml(getInitials(empName))}
                                            </div>
                                            <div class="card-emp-info">
                                                <span class="emp-name">${escapeHtml(empName)}</span>
                                                <span class="emp-sub">${escapeHtml(empCode ? `${empCode} · ${c.department || "Operations"}` : c.sender_email || "")}</span>
                                            </div>
                                        </div>

                                        <div class="card-footer-strip">
                                            <div class="card-sla-tag sla-tone-${slaInfo.tone}">
                                                ${escapeHtml(slaInfo.text)}
                                            </div>
                                            <div class="card-step-tag">
                                                Stage ${curStep}/4
                                            </div>
                                        </div>
                                    </article>
                                `;
                              })
                              .join("")
                }
            </div>
        </section>
    `;
}

export function bindWorkfeedEvents(container) {
    // Queue dock pills
    container.querySelectorAll(".queue-dock-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            const queueKey = btn.getAttribute("data-queue");
            if (queueKey) {
                Store.setState({ activeQueueFilter: queueKey });
            }
        });
    });

    // Search input
    const searchInput = container.querySelector("#workfeedSearchInput");
    if (searchInput) {
        let debounceTimer = null;
        searchInput.addEventListener("input", (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                Store.setState({ searchQuery: e.target.value });
            }, 200);
        });
    }

    const clearBtn = container.querySelector("#btnSearchClear");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            Store.setState({ searchQuery: "" });
        });
    }

    // Category pills
    container.querySelectorAll(".category-pill-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const cat = btn.getAttribute("data-category");
            if (cat) {
                Store.setState({ activeCategoryFilter: cat });
            }
        });
    });

    // Case card click
    container.querySelectorAll(".agent-case-card").forEach((card) => {
        card.addEventListener("click", () => {
            const ref = card.getAttribute("data-case-ref");
            if (ref) {
                Store.setState({ activeCaseRef: ref });
            }
        });
    });

    // Refresh button
    const refreshBtn = container.querySelector("#btnRefreshFeed");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            if (window.refreshWorkbenchData) {
                window.refreshWorkbenchData(true);
            }
        });
    }

    // New case button
    const newCaseBtn = container.querySelector("#btnTriggerNewCase");
    if (newCaseBtn) {
        newCaseBtn.addEventListener("click", () => {
            Store.setState({ activeModal: "NEW_CASE" });
        });
    }
}
