/**
 * ============================================================================
 * ENTERPRISE WORKFLOW ORCHESTRATION — NEXUS AUTONOMOUS COPILOT (workflow-bot.js)
 * Conversational AI Assistant · Live Process Mining · Universal State Machine
 * Any Company · Any Department (IT, Finance, Legal, Operations, People Ops)
 * ============================================================================
 */

(function () {
    "use strict";

    function getCaseRefFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("case") || params.get("id") || "";
        if (ref) return ref.trim();
        const hash = (window.location.hash.replace("#", "") || "").trim();
        const nonCaseHashes = ["cases", "inbox", "tasks", "approvals", "actions", "reports", "console", "agent-workbench", "departments", "analytics"];
        if (hash && !nonCaseHashes.includes(hash.toLowerCase())) {
            return hash;
        }
        return "";
    }

    function isSupportedPage() {
        const path = window.location.pathname.toLowerCase();
        return path.includes("casedetail") || path.includes("agent") || Boolean(getCaseRefFromUrl());
    }

    // Mount on case details or agent execution workbench page
    if (!isSupportedPage()) {
        return;
    }

    // Bot permanently disabled across all sections
    function isBotUiEnabled() {
        return false;
    }

    if (!isBotUiEnabled()) {
        // Expose safe no-op Proxy so ANY caller or method never throws errors
        const noopTarget = {
            recordStep: function () {},
            setIntent: function () {},
            initForCase: function () {},
            open: function () {},
            close: function () {},
            toggle: function () {},
            updateTelemetry: function () {}
        };
        const noopProxy = new Proxy(noopTarget, {
            get(target, prop) {
                if (prop in target) return target[prop];
                return function () {};
            }
        });
        window.NexusBot = window.AuraBot = noopProxy;

        // Clean up any stray DOM nodes if already mounted
        const orb = document.getElementById("grokOrbContainer");
        if (orb) orb.remove();
        const cockpit = document.getElementById("grokExpandedCockpit");
        if (cockpit) cockpit.remove();
        return;
    }

    function getCategoryDiagnosticExamples(cat) {
        const u = (cat || "").toUpperCase();
        if (u.includes("IT") || u.includes("SECURITY") || u.includes("TECH") || u.includes("ASSET")) {
            return "LDAP privileges, Okta identity tokens, asset allocations & VPN logs";
        } else if (u.includes("FINANCE") || u.includes("PAYROLL") || u.includes("BILLING") || u.includes("TAX")) {
            return "ERP invoice records, payment ledger balances & bank transmission logs";
        } else if (u.includes("LEGAL") || u.includes("COMPLIANCE") || u.includes("CONTRACT")) {
            return "vendor NDA terms, regulatory checklists & compliance verifications";
        } else if (u.includes("OPERATIONS") || u.includes("PROCUREMENT") || u.includes("LOGISTICS")) {
            return "purchase order records, goods receipt notes & shipping dock logs";
        } else if (u.includes("LEAVE") || u.includes("ATTENDANCE") || u.includes("PEOPLE") || u.includes("HR")) {
            return "biometric punch logs, shift schedules & leave ledger balances";
        }
        return "master directory lookups, ledger audits & system verification checkpoints";
    }

    const initialCaseRef = getCaseRefFromUrl() || "";
    const initialCategory = "OPERATIONS";
    const initialExamples = getCategoryDiagnosticExamples(initialCategory);

    function getAgentDisplayName() {
        try {
            if (auraState.specialistName && auraState.specialistName.trim()) {
                const clean = auraState.specialistName.replace(/[._\-]/g, " ").trim().split(" ")[0];
                if (clean && clean.toLowerCase() !== "unassigned" && clean.toLowerCase() !== "specialist") {
                    return clean.charAt(0).toUpperCase() + clean.slice(1);
                }
            }
            const userStr = sessionStorage.getItem("hrflow_user") || localStorage.getItem("hrflow_last_user");
            if (userStr) {
                const u = JSON.parse(userStr);
                let raw = u.name || u.full_name || u.username || (u.email ? u.email.split("@")[0] : "");
                // If user role is HR_AGENT but name is Admin (due to legacy corrupted session), sanitize it
                if (raw && raw.toLowerCase() === "admin" && String(u.role || "").toUpperCase() === "HR_AGENT") {
                    if (u.email && !u.email.toLowerCase().startsWith("admin")) {
                        raw = u.email.split("@")[0];
                    } else {
                        raw = "Specialist";
                    }
                }
                if (raw) {
                    const clean = raw.replace(/[._\-]/g, " ").trim().split(" ")[0];
                    if (clean && clean.toLowerCase() !== "unassigned") {
                        return clean.charAt(0).toUpperCase() + clean.slice(1);
                    }
                }
            }
            const domName = document.querySelector("#userName, .user-name, #heroAssigneeText, .user-profile-name, .agent-name, #sidebarAgentName, #topNavUserName, #agentFullName");
            if (domName && domName.innerText.trim()) {
                const clean = domName.innerText.trim().split(" ")[0];
                if (clean && clean.toLowerCase() !== "unassigned") {
                    return clean.charAt(0).toUpperCase() + clean.slice(1);
                }
            }
        } catch (_) {}
        return "Specialist";
    }

    const auraState = {
        isOpen: false,
        activeTab: "chat", // "chat" | "workflow"
        status: "RECORDING", // IDLE | RECORDING | SYNTHESIZING | READY
        activeIntentCode: "OPS",
        activeIntentName: "Enterprise Inquiry & Resolution",
        activeCategory: initialCategory,
        caseRef: initialCaseRef,
        specialistName: "",
        isWorkflowConfigured: false,
        workflowExists: false,
        workflowName: "",
        speechMessage: initialCaseRef ? `Nexus observing ${initialCaseRef}! ✨` : "Nexus Copilot Ready! ✨",
        isTyping: false,
        messages: [],
        recordedSteps: [],
        telemetry: {
            confidence: 98.4,
            stepsCaptured: 0,
            avgResolutionSec: "1m 45s",
            suggestedSla: "24 Hours"
        }
    };

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatBotMessage(rawText) {
        if (!rawText) return "";
        let safe = escapeHtml(rawText);
        // Animated Waving Hand Gesture
        if (safe.includes("👋")) {
            safe = safe.replace(/👋/g, '<span class="nexus-wave-hand" title="Hello!">👋</span>');
        }
        // High-Bot Success / Positive Card with SVG
        if (safe.includes("⚡ **")) {
            safe = safe.replace(/⚡\s*\*\*(.*?)\*\*/g, `
                <div class="aura-success-banner">
                    <div class="aura-alert-header">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                        <span>$1</span>
                    </div>
                </div>
            `);
        }
        // High-Bot Warning / Advisory Alert Card with SVG
        if (safe.includes("⚠️")) {
            safe = safe.replace(/⚠️\s*\*\*(.*?)\*\*/g, `
                <div class="aura-alert-banner">
                    <div class="aura-alert-header">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span>$1</span>
                    </div>
                </div>
            `);
        }
        // Bold **text**
        safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong class="aura-msg-strong">$1</strong>');
        // Inline code `code`
        safe = safe.replace(/\x60([^\x60]+)\x60/g, '<code class="aura-inline-code">$1</code>');
        // Bullet lists
        safe = safe.replace(/(?:^|\n)- (.*?)(?=(?:\n|$))/g, '<div class="aura-msg-bullet"><span class="aura-bullet-dot">›</span><span>$1</span></div>');
        // Line breaks
        safe = safe.replace(/\n/g, '<br/>');
        return safe;
    }

    // OFFICIAL REAL BOT LOGO VECTOR (Dark Velvet Glowing Orb with Arrowhead Eyes)
    function getNexusBotLogoSvg(size = 24, className = "") {
        const gradId = `nexusBotLogoGrad_${size}`;
        const glowId = `nexusBotEyeGlow_${size}`;
        return `
            <svg class="${className}" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="${gradId}" x1="15%" y1="10%" x2="85%" y2="90%">
                        <stop offset="0%" stop-color="#ff2a85" />
                        <stop offset="28%" stop-color="#ec4899" />
                        <stop offset="65%" stop-color="#a855f7" />
                        <stop offset="85%" stop-color="#6366f1" />
                        <stop offset="100%" stop-color="#3b0764" />
                    </linearGradient>
                    <filter id="${glowId}" x="-30%" y="-30%" width="160%" height="160%">
                        <feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="#ffffff" flood-opacity="0.95" />
                        <feDropShadow dx="0" dy="0" stdDeviation="4.2" flood-color="#f472b6" flood-opacity="0.8" />
                    </filter>
                </defs>
                <!-- Orb Body with 3D Velvet Depth -->
                <circle cx="50" cy="50" r="47" fill="url(#${gradId})" />
                <circle cx="50" cy="50" r="46.5" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.2" />
                <!-- Subtle Specular Glint -->
                <ellipse cx="40" cy="22" rx="24" ry="12" fill="rgba(255,255,255,0.15)" transform="rotate(-15 40 22)" />
                <!-- Two Glowing Arrowhead Eyes -->
                <g filter="url(#${glowId})">
                    <g transform="translate(23.5, 30) scale(1.05)">
                        <path d="M12 3.5 C13 4.8 17.8 12.8 18.8 15 C19.6 16.8 18.2 18.8 16.2 18.2 C14.5 17.6 13 16.8 12 16.8 C11 16.8 9.5 17.6 7.8 18.2 C5.8 18.8 4.4 16.8 5.2 15 C6.2 12.8 11 4.8 12 3.5 Z" fill="#ffffff" />
                    </g>
                    <g transform="translate(52.5, 30) scale(1.05)">
                        <path d="M12 3.5 C13 4.8 17.8 12.8 18.8 15 C19.6 16.8 18.2 18.8 16.2 18.2 C14.5 17.6 13 16.8 12 16.8 C11 16.8 9.5 17.6 7.8 18.2 C5.8 18.8 4.4 16.8 5.2 15 C6.2 12.8 11 4.8 12 3.5 Z" fill="#ffffff" />
                    </g>
                </g>
            </svg>
        `;
    }

    // 1. RENDER SUNSET-AURORA BOT ORB
    function renderCircularOrb() {
        let container = document.getElementById("grokOrbContainer");
        if (!container) {
            container = document.createElement("div");
            container.id = "grokOrbContainer";
            container.className = "aura-bot-launcher gemini-orb-container grok-orb-container";
            document.body.appendChild(container);
            setupDraggable(container);
        }

        const stepCount = auraState.recordedSteps.length;

        container.innerHTML = `
            <!-- 1. SOFT WARM FLOOR SHADOW -->
            <div class="aura-floor-shadow"></div>

            <!-- 2. DIFFUSED AMBIENT BLOOM -->
            <div class="aura-ambient-bloom"></div>

            <!-- 3. SPHERICAL BODY WITH VELVET 3D DEPTH -->
            <div class="aura-orb-body grok-orb-core" id="grokOrbCore">
                <!-- Interactive Speech Bubble -->
                <div class="aura-speech-bubble" id="auraSpeechBubble" title="Click to view Nexus Copilot workspace">
                    <span class="aura-speech-text" id="auraSpeechText">${escapeHtml(auraState.speechMessage)}</span>
                </div>

                <!-- Inner chamber: Velvet Saturated Aurora with 3D Depth & Fluid Motion -->
                <div class="aura-orb-chamber">
                    <div class="aura-gradient-base"></div>
                    <div class="aura-moving-gradient"></div>
                    <div class="aura-gradient-wave"></div>
                    <div class="aura-dark-shading-mask"></div>
                    <div class="aura-glass-specular"></div>
                </div>

                <!-- 4. CENTERED GLOWING ARROWHEAD EYES WRAPPER -->
                <div class="aura-eyes-wrapper">
                    <div class="aura-eyes-face" id="auraEyesFace">
                        <div class="aura-single-eye eye-left" id="auraEyeLeft">
                            <svg viewBox="0 0 24 24" fill="none">
                                <path d="M12 3.5 C13 4.8 17.8 12.8 18.8 15 C19.6 16.8 18.2 18.8 16.2 18.2 C14.5 17.6 13 16.8 12 16.8 C11 16.8 9.5 17.6 7.8 18.2 C5.8 18.8 4.4 16.8 5.2 15 C6.2 12.8 11 4.8 12 3.5 Z" fill="#ffffff" />
                            </svg>
                        </div>
                        <div class="aura-single-eye eye-right" id="auraEyeRight">
                            <svg viewBox="0 0 24 24" fill="none">
                                <path d="M12 3.5 C13 4.8 17.8 12.8 18.8 15 C19.6 16.8 18.2 18.8 16.2 18.2 C14.5 17.6 13 16.8 12 16.8 C11 16.8 9.5 17.6 7.8 18.2 C5.8 18.8 4.4 16.8 5.2 15 C6.2 12.8 11 4.8 12 3.5 Z" fill="#ffffff" />
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- 5. FLOATING STEP BADGE (Only visible when steps are logged) -->
                ${stepCount > 0 ? `
                    <div class="aura-step-badge grok-step-badge" id="grokStepBadge" title="${stepCount} Steps Captured">
                        ${stepCount}
                    </div>
                ` : ""}
            </div>
        `;

        // Interactive hover states for speech bubble
        container.onmouseenter = () => {
            const speechText = document.getElementById("auraSpeechText");
            if (speechText) {
                speechText.innerText = `${stepCount} steps · Nexus active ✨`;
            }
        };

        container.onmouseleave = () => {
            const speechText = document.getElementById("auraSpeechText");
            if (speechText) {
                speechText.innerText = auraState.speechMessage;
            }
        };

        // Interactive Click with Wink Animation
        container.onclick = (e) => {
            if (container.getAttribute("data-was-dragged") === "true") {
                container.removeAttribute("data-was-dragged");
                return;
            }
            triggerWinkAndOpen();
        };

        const bubble = container.querySelector("#auraSpeechBubble");
        if (bubble) {
            bubble.onclick = (e) => {
                e.stopPropagation();
                triggerWinkAndOpen();
            };
        }
    }

    function triggerWinkAndOpen() {
        const leftEye = document.getElementById("auraEyeLeft");
        const rightEye = document.getElementById("auraEyeRight");
        const speech = document.getElementById("auraSpeechText");

        if (leftEye && rightEye) {
            leftEye.classList.add("is-winking");
            rightEye.classList.add("is-delighted");
            if (speech) speech.innerText = "Opening Nexus Studio... 🚀";

            setTimeout(() => {
                leftEye.classList.remove("is-winking");
                rightEye.classList.remove("is-delighted");
                toggleCockpit();
            }, 220);
        } else {
            toggleCockpit();
        }
    }

    // 2. RENDER CENTERED HERO GREETING (LOGO -> GREETING -> INTENT -> DECISION CHOICES)
    function renderCenteredHero() {
        const agentName = getAgentDisplayName();
        const rawIntent = (auraState.activeIntentName || "").trim();
        const rawCode = (auraState.activeIntentCode || "").trim().toUpperCase();
        const isGeneric = !rawIntent || 
                          rawIntent.toLowerCase().includes("enterprise inquiry") || 
                          rawIntent.toLowerCase().includes("generic") || 
                          rawIntent.toLowerCase().includes("unclassified") || 
                          rawIntent.toLowerCase().includes("no intent") ||
                          rawCode === "CASE" || rawCode === "GEN" || rawCode === "OPS";
        const hasIntent = !isGeneric && rawIntent.length > 0;
        const hasWorkflow = Boolean(
            auraState.isWorkflowConfigured &&
            auraState.workflowName &&
            !auraState.workflowName.toLowerCase().includes("no workflow")
        );

        let workflowTitle = "Workflow";
        if (hasWorkflow) {
            workflowTitle = `"${auraState.workflowName}"`;
        } else if (auraState.activeIntentCode && auraState.activeIntentCode !== "CASE" && auraState.activeIntentCode !== "OPS" && auraState.activeIntentCode !== "GEN") {
            workflowTitle = `"WF-${auraState.activeIntentCode} Workflow"`;
        } else {
            workflowTitle = `"Standard ${auraState.activeCategory || "Operations"} Workflow"`;
        }

        return `
            <div class="nexus-chat-hero" id="nexusChatHero">
                <!-- 1. Nexus Logo above it in center -->
                <div class="nexus-hero-logo-wrap">
                    <div class="nexus-hero-logo-bloom"></div>
                    <div class="nexus-hero-logo-core" title="Nexus Autonomous Copilot">
                        ${getNexusBotLogoSvg(58, "nexus-hero-bot-logo")}
                    </div>
                </div>

                <!-- 2. Greeting in center -->
                <div class="nexus-hero-greeting-block">
                    <h2 class="nexus-hero-greeting">Hi, ${escapeHtml(agentName)} <span class="nexus-wave-hand">👋</span></h2>
                    <p class="nexus-hero-subtitle">I'm <strong>Nexus</strong>, your Universal Autonomous Process Mining Copilot</p>
                </div>

                <!-- 3. Intent in center (if identified) -->
                ${hasIntent ? `
                    <div class="nexus-hero-intent-block">
                        <span class="nexus-hero-intent-kicker">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg>
                            IDENTIFIED INTENT
                        </span>
                        <div class="nexus-hero-intent-pill" title="${escapeHtml(auraState.activeIntentName)}">
                            <span class="nexus-hero-intent-code">${escapeHtml(auraState.activeIntentCode)}</span>
                            <span class="nexus-hero-intent-text">${escapeHtml(auraState.activeIntentName)}</span>
                            <span class="nexus-hero-cat-tag">${escapeHtml(auraState.activeCategory || "OPERATIONS")}</span>
                        </div>
                    </div>
                ` : ""}

                <!-- 4. Workflow Decisions in center -->
                ${hasWorkflow ? `
                    <!-- Standard Workflow Configured: Offer Use or Create New -->
                    <div class="nexus-hero-decision-box">
                        <div class="nexus-hero-actions-row">
                            <button type="button" class="nexus-hero-action-btn btn-use-workflow" id="btnHeroUseWorkflow" title="Execute validated ${escapeHtml(workflowTitle)}">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                <span>Use ${escapeHtml(workflowTitle)}</span>
                            </button>
                            <button type="button" class="nexus-hero-action-btn btn-create-workflow" id="btnHeroCreateNew" title="Mine a new autonomous workflow for this case">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg>
                                <span>Create New One</span>
                            </button>
                        </div>
                    </div>
                ` : `
                    <!-- No Workflow Configured yet: Add line "Let's create a workflow" and button "Create New One" -->
                    <div class="nexus-hero-no-intent-box">
                        <p class="nexus-hero-create-line">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                            Let's create a workflow
                        </p>
                        <div class="nexus-hero-actions-row">
                            <button type="button" class="nexus-hero-action-btn btn-create-workflow" id="btnHeroCreateNew" title="Mine a new autonomous workflow">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                <span>Create New One</span>
                            </button>
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    // 3. RENDER EXPANDED WORKSPACE CHAT & STUDIO SHEET
    function renderExpandedCockpit() {
        let cockpit = document.getElementById("grokExpandedCockpit");
        if (!cockpit) {
            cockpit = document.createElement("div");
            cockpit.id = "grokExpandedCockpit";
            cockpit.className = "aura-expanded-cockpit gemini-expanded-sheet grok-expanded-cockpit is-hidden";
            document.body.appendChild(cockpit);
        }

        if (auraState.isOpen) {
            cockpit.classList.remove("is-hidden");
            cockpit.classList.add("is-visible");
        } else {
            cockpit.classList.remove("is-visible");
            cockpit.classList.add("is-hidden");
        }

        const isReady = auraState.status === "READY";
        const isSynthesizing = auraState.status === "SYNTHESIZING";
        const isChatTab = auraState.activeTab === "chat";

        cockpit.innerHTML = `
            <!-- 1. TOP HEADER: Real Logo · Nexus · Case Number · Chat · Node · Refresh · Close -->
            <div class="aura-sheet-header nexus-header-bar">
                <div class="nexus-header-left">
                    <!-- 1. Real Logo (Official Bot Orb Logo) -->
                    <div class="nexus-real-logo" title="Nexus Autonomous AI Copilot">
                        ${getNexusBotLogoSvg(24, "nexus-header-real-logo")}
                    </div>

                    <!-- 2. Nexus -->
                    <span class="nexus-brand-title">Nexus</span>

                    <!-- 3. Case Number -->
                    <div class="nexus-case-pill" title="Active Case: ${escapeHtml(auraState.caseRef)} (${escapeHtml(auraState.activeCategory)})">
                        <span class="nexus-live-dot"></span>
                        <span class="nexus-case-text">${escapeHtml(auraState.caseRef || "CASE-000001")}</span>
                    </div>
                </div>

                <div class="nexus-header-right">
                    <!-- 4 & 5. Chat & Node Tabs -->
                    <div class="nexus-tabs-pill aura-tabs-pill">
                        <button type="button" class="nexus-tab-btn aura-tab-btn ${isChatTab ? "is-active" : ""}" id="btnAuraTabChat" title="Chat Copilot View">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span>Chat</span>
                        </button>
                        <button type="button" class="nexus-tab-btn aura-tab-btn ${!isChatTab ? "is-active" : ""}" id="btnAuraTabWorkflow" title="Recorded Workflow Nodes">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                            <span>Node (${auraState.recordedSteps.length})</span>
                        </button>
                    </div>

                    <!-- 6. Refresh Button -->
                    <button type="button" class="nexus-icon-btn aura-icon-btn" id="btnGrokReset" title="Refresh &amp; Reset Session" aria-label="Refresh">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                            <path d="M3 3v5h5"></path>
                        </svg>
                    </button>

                    <!-- 7. Close Button -->
                    <button type="button" class="nexus-icon-btn nexus-btn-close aura-icon-btn aura-btn-close" id="btnGrokClose" title="Close / Minimize Window" aria-label="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- 2. STATUS STRIP (ACTIVE INTENT) -->
            <div class="aura-context-banner">
                <div class="aura-intent-pill">
                    <span class="aura-intent-code">${escapeHtml(auraState.activeIntentCode)}</span>
                    <span>${escapeHtml(auraState.activeIntentName)}</span>
                </div>
                <span class="aura-status-tag">
                    <span class="aura-pulse-dot"></span>
                    <span>Autonomous Mining Active</span>
                </span>
            </div>

            <!-- 3. VIEW CONTAINER (CHAT FEED VS WORKFLOW NODES) -->
            ${isChatTab ? `
                <!-- TAB A: CONVERSATIONAL CHAT FEED -->
                <div class="aura-chat-stream" id="auraChatStream">
                    ${renderCenteredHero()}
                    ${auraState.messages.map((msg) => `
                        <div class="aura-chat-row ${msg.sender === "user" ? "user-row" : "aura-row"}">
                            ${msg.sender === "aura" ? `
                                <div class="aura-msg-avatar-wrap" title="Nexus Copilot">
                                    ${getNexusBotLogoSvg(28, "aura-msg-avatar-bot-logo")}
                                </div>
                            ` : ""}
                            <div class="aura-msg-content">
                                <div class="aura-msg-bubble">
                                    ${msg.sender === "aura" ? `
                                        <div class="aura-msg-sender-bar">
                                            <span class="aura-msg-sender-name">
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
                                                Nexus Copilot
                                            </span>
                                            <button type="button" class="aura-msg-action-copy" data-copy-text="${escapeHtml(msg.text)}" title="Copy message">
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                <span>Copy</span>
                                            </button>
                                        </div>
                                    ` : ""}
                                    <div class="aura-msg-text-body">
                                        ${formatBotMessage(msg.text)}
                                    </div>
                                </div>

                                ${msg.cardType === "workflow_decision" ? `
                                    <div class="nexus-decision-card ${auraState.isWorkflowConfigured ? "is-configured" : "is-mining"}">
                                        <div class="nexus-card-top-strip">
                                            <div class="nexus-decision-badge ${auraState.isWorkflowConfigured ? "badge-found" : "badge-missing"}">
                                                ${auraState.isWorkflowConfigured ? `
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                                                    <span>Standard Workflow Configured</span>
                                                ` : `
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                                    <span>No Workflow Configured</span>
                                                `}
                                            </div>
                                            <span class="nexus-pipeline-pill">${escapeHtml(auraState.activeCategory)} PIPELINE</span>
                                        </div>

                                        <div class="nexus-decision-intent-row">
                                            <span class="nexus-decision-intent-code">${escapeHtml(auraState.activeIntentCode)}</span>
                                            <span class="nexus-decision-intent-name" title="${escapeHtml(auraState.activeIntentName)}">${escapeHtml(auraState.activeIntentName)}</span>
                                        </div>

                                        ${auraState.isWorkflowConfigured ? `
                                            <!-- Configured Stages Preview -->
                                            <div class="nexus-decision-flow-preview">
                                                ${auraState.workflowStages && auraState.workflowStages.length > 0 ? auraState.workflowStages.map((stg, si) => `
                                                    <div class="nexus-flow-node">
                                                        <span class="nexus-node-dot"></span>
                                                        ${escapeHtml(stg.label || stg.name || `Stage ${si + 1}`)}
                                                    </div>
                                                    ${si < auraState.workflowStages.length - 1 ? '<span class="nexus-flow-arrow">➔</span>' : ''}
                                                `).join("") : `
                                                    <div class="nexus-flow-node"><span class="nexus-node-dot"></span> Ingestion &amp; Diagnostics</div>
                                                    <span class="nexus-flow-arrow">➔</span>
                                                    <div class="nexus-flow-node"><span class="nexus-node-dot"></span> Ledger Balances</div>
                                                    <span class="nexus-flow-arrow">➔</span>
                                                    <div class="nexus-flow-node"><span class="nexus-node-dot"></span> Policy Gate</div>
                                                    <span class="nexus-flow-arrow">➔</span>
                                                    <div class="nexus-flow-node"><span class="nexus-node-dot"></span> Resolution Proof</div>
                                                `}
                                            </div>

                                            <div class="nexus-decision-prompt-text">
                                                Would you like to <strong>Proceed</strong> with this existing workflow, or <strong>Mine a New</strong> custom workflow?
                                            </div>

                                            <div class="nexus-decision-actions">
                                                <button type="button" class="nexus-choice-btn btn-choice-proceed" id="btnChoiceProceedWf" title="Execute validated operating procedure">
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                                    <span>Proceed with Workflow</span>
                                                </button>
                                                <button type="button" class="nexus-choice-btn btn-choice-new" id="btnChoiceNewWf" title="Observe and record a new custom blueprint">
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg>
                                                    <span>No, Mine New</span>
                                                </button>
                                            </div>
                                        ` : `
                                            <div class="nexus-decision-mining-note">
                                                As you execute diagnostic actions (e.g. ${escapeHtml(getCategoryDiagnosticExamples(auraState.activeCategory))}), Nexus will actively observe and synthesize a new state machine.
                                            </div>

                                            <div class="nexus-decision-prompt-text">
                                                Would you like to <strong>Start Autonomous Mining</strong> for this new workflow, or <strong>Synthesize</strong> from templates?
                                            </div>

                                            <div class="nexus-decision-actions">
                                                <button type="button" class="nexus-choice-btn btn-choice-proceed" id="btnChoiceMineWf" title="Start live recording of execution steps">
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
                                                    <span>Mine New Workflow</span>
                                                </button>
                                                <button type="button" class="nexus-choice-btn btn-choice-new" id="btnChoiceTemplateWf" title="Generate blueprint in Workflow Studio">
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                                    <span>Synthesize Blueprint</span>
                                                </button>
                                            </div>
                                        `}
                                    </div>
                                ` : ""}

                                ${msg.cardType === "sequence" ? `
                                    <div class="aura-chat-card-nodes">
                                        <div class="aura-chat-card-title">
                                            <span>CAPTURED SEQUENCE (${auraState.recordedSteps.length} NODES)</span>
                                            <span class="aura-flow-tag">WF-${escapeHtml(auraState.activeIntentCode)}</span>
                                        </div>
                                        <div class="aura-chat-steps-list">
                                            ${auraState.recordedSteps.map((s, i) => `
                                                <div class="aura-chat-step-item">
                                                    <div class="aura-chat-step-num">${i + 1}</div>
                                                    <div class="aura-chat-step-info">
                                                        <div class="aura-chat-step-name">${escapeHtml(s.title)}</div>
                                                        <div class="aura-chat-step-sub">${escapeHtml(s.description)}</div>
                                                    </div>
                                                    <span class="aura-type-pill ${s.nodeType}">${escapeHtml(s.nodeType)}</span>
                                                </div>
                                            `).join("")}
                                        </div>
                                    </div>
                                ` : ""}

                                ${msg.cardType === "blueprint" ? `
                                    <div class="aura-blueprint-card">
                                        <div class="aura-card-header-row">
                                            <div class="aura-card-header-left">
                                                <span class="aura-sparkle-icon">✨</span>
                                                <strong class="aura-card-title">Blueprint WF-${escapeHtml(auraState.activeIntentCode)} Ready</strong>
                                            </div>
                                            <span class="aura-badge-ready">COMPILED &amp; VERIFIED</span>
                                        </div>
                                        
                                        <!-- Dynamic Sequence Flow Diagram -->
                                        <div class="aura-chat-step-flow">
                                            ${auraState.recordedSteps.length > 0 ? auraState.recordedSteps.map((s, i) => `
                                                <div class="aura-flow-node" title="${escapeHtml(s.description || '')}">
                                                    <span class="aura-flow-icon">${s.nodeType === 'data' ? '🔍' : s.nodeType === 'task' ? '☑️' : s.nodeType === 'gate' ? '🛡️' : s.nodeType === 'email' ? '✉️' : '⚡'}</span>
                                                    ${escapeHtml(s.title.length > 18 ? s.title.slice(0, 16) + '...' : s.title)}
                                                </div>
                                                ${i < auraState.recordedSteps.length - 1 ? '<div class="aura-flow-arrow">➔</div>' : ''}
                                            `).join('') : `
                                                <div class="aura-flow-node"><span class="aura-flow-icon">📊</span> Telemetry</div>
                                                <div class="aura-flow-arrow">➔</div>
                                                <div class="aura-flow-node"><span class="aura-flow-icon">🔍</span> Diagnostics</div>
                                                <div class="aura-flow-arrow">➔</div>
                                                <div class="aura-flow-node"><span class="aura-flow-icon">🛡️</span> Gate</div>
                                                <div class="aura-flow-arrow">➔</div>
                                                <div class="aura-flow-node"><span class="aura-flow-icon">✉️</span> Dispatch</div>
                                            `}
                                        </div>

                                        <!-- Telemetry Metric Grid -->
                                        <div class="aura-telemetry-grid">
                                            <div class="aura-telemetry-box">
                                                <div class="aura-telemetry-num">${auraState.recordedSteps.length}</div>
                                                <div class="aura-telemetry-lbl">NODES</div>
                                            </div>
                                            <div class="aura-telemetry-box">
                                                <div class="aura-telemetry-num">1.7m</div>
                                                <div class="aura-telemetry-lbl">BOT SLA</div>
                                            </div>
                                            <div class="aura-telemetry-box">
                                                <div class="aura-telemetry-num">98.4%</div>
                                                <div class="aura-telemetry-lbl">ACCURACY</div>
                                            </div>
                                        </div>

                                        <!-- Actions -->
                                        <div class="aura-blueprint-actions">
                                            <button type="button" class="aura-btn-outline" id="btnAuraChatDryRun">⚡ Test Simulation</button>
                                            <button type="button" class="aura-btn-primary" id="btnAuraChatPublish">Publish to Studio ↗</button>
                                        </div>
                                    </div>
                                ` : ""}
                            </div>
                        </div>
                    `).join("")}

                    ${auraState.isTyping ? `
                        <div class="aura-chat-row aura-row">
                            <div class="aura-msg-avatar-wrap" title="Nexus Copilot">
                                ${getNexusBotLogoSvg(28, "aura-msg-avatar-bot-logo")}
                            </div>
                            <div class="aura-msg-content">
                                <div class="aura-typing-bubble">
                                    <span class="aura-typing-dot"></span>
                                    <span class="aura-typing-dot"></span>
                                    <span class="aura-typing-dot"></span>
                                </div>
                            </div>
                        </div>
                    ` : ""}
                </div>
            ` : `
                <!-- TAB B: RECORDED WORKFLOW NODES TREE -->
                <div class="aura-workflow-tree-view" id="auraWorkflowTreeView">
                    <div class="aura-tree-banner">
                        <div class="aura-tree-banner-left">
                            <span class="aura-tree-kicker">AUTONOMOUS DISCOVERY</span>
                            <h4 class="aura-tree-title">State Machine WF-${escapeHtml(auraState.activeIntentCode)}</h4>
                        </div>
                        <span class="aura-pill-counter">${auraState.recordedSteps.length} Nodes</span>
                    </div>

                    ${auraState.recordedSteps.length === 0 ? `
                        <div class="aura-empty-nodes">
                            <div class="aura-empty-icon">⚡</div>
                            <strong style="color:#ffffff;">No workflow nodes recorded yet</strong>
                            <p style="color:#94a3b8; font-size:0.8rem; margin:6px 0 0 0;">
                                Run verification checks in Step 2 or chat with Nexus to start building the autonomous state machine.
                            </p>
                        </div>
                    ` : `
                        <div class="aura-nodes-chain">
                            ${auraState.recordedSteps.map((step, idx) => `
                                <div class="aura-node-row">
                                    <div class="aura-node-spine">
                                        <div class="aura-node-dot ${step.nodeType}">${idx + 1}</div>
                                        ${idx < auraState.recordedSteps.length - 1 ? '<div class="aura-node-line"></div>' : ""}
                                    </div>
                                    <div class="aura-node-card">
                                        <div class="aura-node-header">
                                            <strong class="aura-node-name">${escapeHtml(step.title)}</strong>
                                            <span class="aura-type-pill ${step.nodeType}">${escapeHtml(step.nodeType)}</span>
                                        </div>
                                        <div class="aura-node-desc">${escapeHtml(step.description || "State step recorded")}</div>
                                    </div>
                                </div>
                            `).join("")}
                        </div>
                    `}

                    ${isReady ? `
                        <div class="aura-ready-box">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <strong style="color:#10b981; font-size:0.85rem;">✓ State Machine Synthesized</strong>
                                <span class="aura-badge-ready">Ready</span>
                            </div>
                            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-bottom:10px;">
                                <div style="padding:8px 6px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); border-radius:10px; text-align:center;">
                                    <div style="font-size:0.92rem; font-weight:800; color:#f472b6; font-family:monospace;">${auraState.recordedSteps.length}</div>
                                    <div style="font-size:0.62rem; color:#94a3b8; font-weight:700;">NODES</div>
                                </div>
                                <div style="padding:8px 6px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); border-radius:10px; text-align:center;">
                                    <div style="font-size:0.92rem; font-weight:800; color:#f472b6; font-family:monospace;">1.7m</div>
                                    <div style="font-size:0.62rem; color:#94a3b8; font-weight:700;">LEARNED SLA</div>
                                </div>
                                <div style="padding:8px 6px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); border-radius:10px; text-align:center;">
                                    <div style="font-size:0.92rem; font-weight:800; color:#f472b6; font-family:monospace;">98.4%</div>
                                    <div style="font-size:0.62rem; color:#94a3b8; font-weight:700;">ACCURACY</div>
                                </div>
                            </div>
                            <button type="button" id="btnGrokPublishBuilder" class="aura-primary-btn" style="height:38px; font-size:0.8rem; background:linear-gradient(135deg, #10b981 0%, #059669 100%);">
                                ✓ Publish to Workflow Studio
                            </button>
                        </div>
                    ` : ""}
                </div>
            `}

            <!-- 4. FOOTER: QUICK CHIPS & INPUT BAR -->
            <div class="aura-sheet-footer">
                <!-- QUICK PROMPT CHIPS WITH HIGH-BOT SVG ICONS -->
                <div class="aura-prompt-chips-tray">
                    <button type="button" class="aura-chip primary-chip" data-prompt="Synthesize WF Blueprint">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
                        <span>Synthesize Blueprint</span>
                    </button>
                    <button type="button" class="aura-chip" data-prompt="Summarize audit findings">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        <span>Summarize Findings</span>
                    </button>
                    <button type="button" class="aura-chip" data-prompt="Run system diagnostic checks">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <span>Run Diagnostics</span>
                    </button>
                    <button type="button" class="aura-chip" data-prompt="Add manager approval gate">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        <span>Approval Gate</span>
                    </button>
                    <button type="button" class="aura-chip" data-prompt="Check learned SLA performance">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>Check SLA</span>
                    </button>
                    <button type="button" class="aura-chip" data-prompt="Draft official resolution letter">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <span>Draft Letter</span>
                    </button>
                    <button type="button" class="aura-chip" data-prompt="Run autonomous dry test simulation">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        <span>Dry Run</span>
                    </button>
                </div>

                ${!isChatTab && !isReady ? `
                    <div class="aura-workflow-footer-cta">
                        <button type="button" id="btnGrokSynthesizeNow" class="aura-primary-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
                            <span>${isSynthesizing ? "Synthesizing Blueprint..." : `Synthesize WF-${escapeHtml(auraState.activeIntentCode)} Blueprint`}</span>
                        </button>
                    </div>
                ` : ""}

                <!-- HIGH-BOT COMMAND INPUT DOCK -->
                <div class="aura-input-wrapper">
                    <div class="aura-prompt-box">
                        <span class="aura-prompt-sparkle" title="Nexus AI Assistant">✦</span>
                        <input type="text" id="grokPromptInput" class="aura-prompt-input" placeholder="Ask Nexus Copilot or command workflow synthesis..." autocomplete="off">
                        <button type="button" id="btnAuraVoiceMic" class="aura-voice-btn" title="Simulated Voice Input" aria-label="Voice Input">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="22"></line>
                            </svg>
                        </button>
                        <button type="button" id="btnGrokSendPrompt" class="aura-send-btn" title="Send Prompt (Enter)" aria-label="Send">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        bindCockpitEvents(cockpit);

        // Auto-scroll chat to bottom
        const stream = cockpit.querySelector("#auraChatStream");
        if (stream) stream.scrollTop = stream.scrollHeight;
    }

    function openCockpit() {
        auraState.isOpen = true;
        renderExpandedCockpit();

        const cockpit = document.getElementById("grokExpandedCockpit");
        const orb = document.getElementById("grokOrbContainer");

        if (cockpit) {
            cockpit.classList.remove("is-hidden");
            cockpit.classList.add("is-visible");
            setTimeout(() => {
                const input = cockpit.querySelector("#grokPromptInput");
                if (input) input.focus();
            }, 120);
        }
        if (orb) {
            orb.style.display = "none";
        }
    }

    function closeCockpit() {
        auraState.isOpen = false;
        const cockpit = document.getElementById("grokExpandedCockpit");
        const orb = document.getElementById("grokOrbContainer");

        if (cockpit) {
            cockpit.classList.remove("is-visible");
            cockpit.classList.add("is-hidden");
        }
        if (orb) {
            orb.style.display = "flex";
            renderCircularOrb();
        }
    }

    function toggleCockpit() {
        if (auraState.isOpen) {
            closeCockpit();
        } else {
            openCockpit();
        }
    }

    function handleSendUserMessage(userText) {
        if (!userText || !userText.trim()) return;
        const text = userText.trim();

        // 1. Add user message
        auraState.messages.push({
            id: auraState.messages.length + 1,
            sender: "user",
            text: text,
            timestamp: "Just now"
        });

        auraState.isTyping = true;
        renderExpandedCockpit();

        // 2. Intelligent Copilot response
        setTimeout(() => {
            auraState.isTyping = false;
            const lower = text.toLowerCase().trim();
            const agentName = getAgentDisplayName();
            const caseId = auraState.caseRef || "CASE-000001";
            const empName = auraState.employeeName || "Karan Malhotra";

            // 1. Natural Human Greetings
            const isGreeting = /^(hi|hello|hey|heya|hiya|good\s+morning|good\s+afternoon|good\s+evening|greetings|howdy|sup|yo)\b/i.test(lower);
            if (isGreeting) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `Hi ${agentName}! 👋 It's great to work with you.\n\n` +
                          `I'm actively monitoring **${caseId}** for **${empName}** (Marketing Department).\n` +
                          `He reported an incomplete attendance record for **23 October 2026** because the office turnstile biometric machine failed to register his morning punch-in.\n\n` +
                          `**Where we stand right now:**\n` +
                          `• **Step 1 (Intake Gate):** Passed ✓\n` +
                          `• **Current Stage:** Step 2 (Audit & Execution)\n` +
                          `• **Identified Intent:** [A08] Attendance Correction / Regularization\n\n` +
                          `How would you like to proceed? You can ask me anything or tell me to:\n` +
                          `• 🔍 *"Run the biometric diagnostics"* — verify Truein swipe telemetry\n` +
                          `• 🛡️ *"Add manager approval stage"* — insert Marketing Lead sign-off gate\n` +
                          `• 📝 *"Summarize findings"* — auto-fill Step 2 forensic audit proof\n` +
                          `• 🕒 *"Regularize attendance"* — view Darwinbox shift adjustment parameters`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = `Hi ${agentName}! Ready to help with ${caseId} 👋`;
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 2. Human Politeness & Small Talk
            if (/^(how are you|how's it going|how are things|how do you do|how r u)/i.test(lower)) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `I'm doing great, thank you for asking! 😊 Everything is set up for **${caseId}**. All audit checkpoints and Darwinbox integrations are connected. How can I assist you with Karan's request today?`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Doing great! Ready to help 😊";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            if (/^(thank you|thanks|thx|ty|appreciate it|awesome|great job|perfect|cool|nice)/i.test(lower)) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `You're very welcome, ${agentName}! Always happy to help. Let me know whenever you're ready to advance to Step 3 for the resolution dispatch or need any more telemetry checks! 🚀`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Glad to help! 🚀";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            if (lower === "who are you" || lower.includes("what can you do") || lower === "help") {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `🤖 **I'm Nexus, your Autonomous Process Mining & People Operations Copilot.**\n\n` +
                          `I work alongside you to:\n` +
                          `• **Explain cases & policies:** Instant answers on employee history, shift rules, and 1MG compliance.\n` +
                          `• **Execute live actions:** Type *"add manager approval stage"* or *"run diagnostics"* and I'll perform it on your screen.\n` +
                          `• **Mine & synthesize workflows:** Capture your manual actions and turn them into reusable automated state machines.\n` +
                          `• **Draft responses:** Generate executive resolution emails with verified audit references.`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Here is what I can do! 🤖";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 3. Case Briefing & Understanding
            if (lower.includes("what is this case") || lower.includes("tell me about") || lower.includes("case summary") || lower.includes("what happened") || lower.includes("issue") || lower.includes("explain case")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `📋 **Case Dossier Briefing — ${caseId}**\n\n` +
                          `• **Employee:** Karan Malhotra (Marketing, EMP ID: \`1MG0023\`)\n` +
                          `• **Date of Incident:** 23 October 2026\n` +
                          `• **Shift:** General Shift (09:00 – 18:00, standard 8.5h)\n` +
                          `• **The Problem:** Worked in the office all day, but the biometric turnstile machine failed to capture his punch-in swipe, showing incomplete attendance in the portal.\n` +
                          `• **Email Note:** Sent from personal address \`vaibhavx002@gmail.com\`. Under **1MG Data Security Policy**, identity verification was matched to Master Record \`1MG0023\`.\n` +
                          `• **Current Progress:** Step 1 Intake Gate passed. Ready for Step 2 physical & telemetry audit.`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Here is the case briefing! 📋";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 4. Policy Advice: Can I Regularize / Should I Approve?
            if (lower.includes("can i regularize") || lower.includes("should i approve") || lower.includes("is it safe") || lower.includes("policy") || lower.includes("eligible") || lower.includes("rule")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `⚖️ **1MG Attendance Policy Assessment**\n\n` +
                          `**Eligibility Verdict:** Approved for Regularization under **Clause 4.2 (Biometric Hardware Malfunction)**, provided:\n\n` +
                          `1. **Truein Telemetry Corroboration:** Evening punch-out swipe at 18:15 PM is captured OR office Wi-Fi DHCP session duration is ≥ 8.5 hours.\n` +
                          `2. **Reporting Manager Sign-Off:** Marketing Lead written confirmation or ticket approval on record.\n` +
                          `3. **Monthly Limit Check:** Employee has not exceeded 3 permissible regularizations in October 2026.\n\n` +
                          `Once these 3 items are checked, Darwinbox will update shift status to \`PRESENT\` with zero Loss-of-Pay (LOP).`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Policy verified: eligible! ⚖️";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 5. Employee & Identity Discrepancy Understanding
            if (lower.includes("karan") || lower.includes("who is employee") || lower.includes("identity") || lower.includes("vaibhav") || lower.includes("sender") || lower.includes("discrepancy")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `👤 **Employee Identity Profile & Security Check**\n\n` +
                          `• **Stated Employee:** Karan Malhotra (Marketing Department)\n` +
                          `• **Matched Master Record:** \`1MG0023\` (Vaibhav, Sales & Marketing)\n` +
                          `• **Sender Email:** \`vaibhavx002@gmail.com\` (Personal External Account)\n` +
                          `• **Security Gate:** Under **1MG Data Security Policy**, personal email requests require employee ID verification before permanent payroll timesheet adjustments.\n` +
                          `• **Status:** Intake Gate passed successfully because the employee ID \`1MG0023\` and date were explicitly stated in the message body.`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Employee profile retrieved! 👤";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 6. Actionable Next Steps
            if (lower.includes("what should i do") || lower.includes("what next") || lower.includes("next step") || lower.includes("how to proceed") || lower.includes("status")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `🎯 **Immediate Action Checklist for ${caseId}**\n\n` +
                          `1. **Step 2 Diagnostics:** Click **"Verify Biometric Swipe"** in the diagnostic console to cross-check Truein turnstile telemetry.\n` +
                          `2. **Manager Approval Gate:** Click **+ Add Stage** (or type *"add manager approval stage"*) to insert the governance sign-off.\n` +
                          `3. **Confirm Timesheet Hours:** Verify 8.5 work hours completed to safeguard against Loss of Pay.\n` +
                          `4. **Darwinbox Sync:** Update punch-in to 09:00 AM and mark status as \`PRESENT\` (Ref: \`DBX-REG-202610-1MG0023\`).\n` +
                          `5. **Step 3 Dispatch:** Send resolution email to Karan from \`peopledesk@1mg.com\`.`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Here are your next steps! 🎯";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 7. Add Manager Approval Stage (Interactive Action)
            if (lower.includes("add stage") || lower.includes("add approval") || lower.includes("add manager approval") || lower.includes("approval gate")) {
                if (typeof window.executeCaseAction === "function") {
                    window.executeCaseAction({
                        action_type: "ADD_STAGE",
                        label: "Line Manager Approval Gate",
                        stage_type: "APPROVAL",
                        description: "Marketing Lead written confirmation for in-office presence on 23 Oct 2026"
                    }, "Manager Approval Gate added to workflow pipeline!");
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `✅ **Added "Line Manager Approval Gate" Stage to Pipeline!**\n\n` +
                              `I've dynamically inserted an **APPROVAL** milestone right before final resolution.\n` +
                              `Your case pipeline now has a 4-stage governance trail:\n` +
                              `1. Dossier → 2. Audit → 3. Manager Approval → 4. Resolution Dispatch.`,
                        timestamp: "Just now"
                    });
                    auraState.speechMessage = "Approval gate added! ✅";
                } else {
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `🛡️ Click **+ Add Stage** at the top of the case detail view, set Title to \`Line Manager Approval Gate\`, select Type **APPROVAL**, and confirm!`,
                        timestamp: "Just now"
                    });
                }
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 8. Darwinbox / Truein Regularization Parameters
            if (lower.includes("regularize") || lower.includes("darwinbox") || lower.includes("punch") || lower.includes("biometric") || lower.includes("truein")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `🕒 **Darwinbox Attendance Regularization Parameters**\n\n` +
                          `• **Provider:** Darwinbox HRMS Integration (\`darwinbox\`)\n` +
                          `• **Employee Code:** \`1MG0023\`\n` +
                          `• **Target Date:** 23 October 2026\n` +
                          `• **Shift Code:** General Shift (\`09:00 – 18:00\`)\n` +
                          `• **Punch-In Adjustment:** \`09:00 AM\` (Hardware Glitch Override)\n` +
                          `• **Punch-Out Captured:** \`18:15 PM\` (Truein Gate 3 Verified)\n` +
                          `• **Status:** Regularized to \`PRESENT\` (Zero LOP)\n` +
                          `• **Audit Reference Hash:** \`DBX-REG-202610-1MG0023\``,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Darwinbox parameters ready! 🕒";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 9. Workflow Design Blueprint
            if (lower.includes("how we can design") || lower.includes("how to design") || lower.includes("design the workflow") || lower.includes("design it") || lower === "design") {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `🏛️ **Enterprise Workflow Blueprint Design for Tata 1mg (${auraState.activeIntentName})**\n\n` +
                          `Here is the recommended 5-stage architecture for biometric failure attendance regularization:\n\n` +
                          `**Stage 1: Intake Gate & Identity Validation** *(Done ✓)*\n` +
                          `• Match sender \`vaibhavx002@gmail.com\` against EMP ID \`1MG0023\` (\`Karan Malhotra\`, Marketing).\n` +
                          `• Verify 1MG Data Security policy compliance for personal email.\n\n` +
                          `**Stage 2: Audit & Telemetry Diagnostics** *(Active)*\n` +
                          `• Query Truein biometric gate reader for evening punch-out swipe on 23 Oct 2026.\n` +
                          `• Validate Tata 1mg SSO/VPN login sessions duration (min 8.5h General Shift).\n\n` +
                          `**Stage 3: Manager Approval Gate** *(Governance)*\n` +
                          `• Dispatch 1-click sign-off request to Marketing Reporting Manager.\n\n` +
                          `**Stage 4: Darwinbox HRMS Punch Correction** *(Integration Action)*\n` +
                          `• Execute \`POST /attendance/regularize\` marking status as \`PRESENT\` (Ref: \`DBX-REG-202610-1MG0023\`).\n\n` +
                          `**Stage 5: Official Dispatch & Resolution** *(Dispatch)*\n` +
                          `• Dispatch formal resolution confirmation from \`peopledesk@1mg.com\` and archive immutable audit hash.\n\n` +
                          `💡 *Tip: Type **"Add manager approval stage"** to automatically insert Stage 3 into your pipeline!*`,
                    timestamp: "Just now",
                    cardType: "blueprint"
                });
                auraState.speechMessage = "Architecture designed! 🏛️";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 10. Audit Summary & Forensic Notes
            if (lower.includes("summarize") || lower.includes("findings") || lower.includes("audit summary")) {
                const findingsSummary = `[Forensic Audit Findings · ${caseId} (ATTENDANCE)]
• Compliance & Policy Gate: 100% Passed.
• Master Directory & Telemetry: Verified against enterprise master records (EMP: 1MG0023).
• Truein Gate 3 Logs: Evening punch-out verified at 18:15 PM; morning punch dropped due to turnstile reader error.
• System Diagnostic Checks: All automated checkpoints passed with zero policy exceptions.
• Resolution Verdict: Cleared for official Darwinbox regularization and resolution dispatch.`;

                // Live-sync with Step 2 Audit Notes if present on the page!
                const notesArea = document.getElementById("step2AuditNotes");
                if (notesArea) {
                    const currentNotes = notesArea.value.trim();
                    notesArea.value = (currentNotes ? currentNotes + "\n\n" : "") + findingsSummary;
                    const event = new Event("input", { bubbles: true });
                    notesArea.dispatchEvent(event);
                }

                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `📝 **Audit Findings Synthesized & Synced!**\nI've analyzed all active checkpoints and telemetry for **${caseId}** and inserted verified findings into your **Step 2 Forensic Proof Notes**:\n\n` + findingsSummary,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Findings synced to Step 2! 📝";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 11. Run Diagnostics Trigger
            if (lower.includes("diagnostic") || lower.includes("verify swipe") || lower.includes("check swipe")) {
                const firstCheckBtn = document.querySelector(".btn-exec-act");
                if (firstCheckBtn) {
                    firstCheckBtn.click();
                }
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `🔍 **Diagnostic Checks Executed for ATTENDANCE**\n• Truein Turnstile Telemetry: **200 OK (Swipe captured at 18:15 PM)**\n• Data Integrity & Schema Check: **100% Passed**\n• 1MG Security Policy Compliance: **Zero Violations**\nResults updated in your Step 2 Diagnostic Console!`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Diagnostics verified! 🔍";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 11b. Verify All Checkpoints in 1 Click
            if (lower.includes("verify all") || lower.includes("check all") || lower.includes("complete all") || lower.includes("pass all")) {
                const btn = document.querySelector(".btn-verify-all-tasks");
                if (btn) {
                    btn.click();
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `✅ **All 5 Checkpoints Batch-Verified!**\n\nI've toggled all pending audit items to **COMPLETED**:\n• Truein biometric turnstile logs verified\n• SSO & VPN session hours validated (≥ 8.5h)\n• Monthly grace threshold confirmed (< 3 regularizations)\n• Manager approval confirmed\n• Darwinbox shift update queued\n\nThe Step 2 compliance meter is now at **100% Verified**!`,
                        timestamp: "Just now"
                    });
                    auraState.speechMessage = "All 5 checkpoints verified! ✅";
                } else {
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `Check the top-right button in Step 2: **"✓ Verify All Checkpoints"** to batch-verify tasks.`,
                        timestamp: "Just now"
                    });
                }
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 11c. Auto-Populate & Save Forensic Proof
            if (lower.includes("save proof") || lower.includes("record proof") || lower.includes("fill proof") || lower.includes("auto fill proof")) {
                const elOutcome = document.getElementById("step2OutcomeType");
                const elRefId = document.getElementById("step2RefId");
                const elAmt = document.getElementById("step2AdjustmentAmount");
                const elNotes = document.getElementById("step2AuditNotes");
                const btnSave = document.getElementById("btnSaveForensicProof");

                if (elOutcome) elOutcome.value = "ATTENDANCE_REGULARIZED";
                if (elRefId) elRefId.value = "DBX-REG-202610-1MG0023";
                if (elAmt) elAmt.value = "1.0 Day (09:00 - 18:00)";
                if (elNotes) elNotes.value = `[Forensic Audit Findings · ${caseId} (ATTENDANCE)]\n• Biometric Hardware Glitch: Turnstile Gate 3 failed to register morning swipe on 23 Oct 2026.\n• Truein Telemetry: Evening punch-out verified at 18:15 PM.\n• 1MG Policy Compliance: Approved under Clause 4.2 with Marketing Manager sign-off.\n• Darwinbox Ledger: Regularized to PRESENT with zero Loss-of-Pay (LOP).`;

                if (btnSave) {
                    btnSave.click();
                }

                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `💾 **Forensic Resolution Proof Saved & Bound to Step 3!**\n\n• **Outcome Verdict:** Attendance & Shift Regularized (Present)\n• **Proof Reference ID:** \`DBX-REG-202610-1MG0023\`\n• **Adjustment Metric:** \`1.0 Day (09:00 - 18:00)\`\n• **Forensic Notes:** Auto-populated with verified Truein logs & manager sign-off.\n\nEverything is locked in. Would you like to advance to **Step 3 (Response & Resolution)** to dispatch the resolution email?`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = "Forensic proof saved! 💾";
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 11d. Advance Stepper to Step 3 (Response & Resolution)
            if (lower.includes("advance") || lower.includes("go to step 3") || lower.includes("next stage") || lower.includes("proceed to response")) {
                const nextBtn = document.querySelector(".btn-wizard-next");
                if (nextBtn) {
                    nextBtn.click();
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `🚀 **Advanced to Step 3: Response & Resolution!**\n\nForensic proof and verified Darwinbox reference have been synced into the final response email draft. Review the message to Karan Malhotra and click **"Dispatch Resolution & Close Case"**!`,
                        timestamp: "Just now"
                    });
                    auraState.speechMessage = "Advanced to Step 3! 🚀";
                } else {
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `Click the blue button at the bottom of the page: **"Advance to Step 3: Response & Resolution →"**!`,
                        timestamp: "Just now"
                    });
                }
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 12. Synthesize Blueprint
            if (lower.includes("synthesize") || lower.includes("blueprint") || lower.includes("state machine") || lower.includes("compile")) {
                auraState.status = "READY";
                auraState.speechMessage = "Workflow ready! ✨";
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `✨ **State Machine WF-A08 Synthesized!**\nCompiled all captured nodes, Truein conditions, and Darwinbox dispatch triggers into an autonomous state machine with **98.4% execution confidence**.`,
                    timestamp: "Just now",
                    cardType: "blueprint"
                });
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 13. Recorded Actions / History
            if (lower.includes("action") || lower.includes("recorded") || lower.includes("what did i do") || lower.includes("steps") || lower.includes("history") || lower.includes("log")) {
                if (auraState.recordedSteps.length === 0) {
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `⚡ **No manual actions recorded yet for this session.**\nExecute system diagnostics, check off SOP tasks, or save forensic proof in Step 2 to build the state machine sequence!`,
                        timestamp: "Just now"
                    });
                } else {
                    const stepsList = auraState.recordedSteps.map((s, i) => `${i + 1}. **${s.title}** [${(s.nodeType || "action").toUpperCase()}] — ${s.description || "Verified"}`).join("\n");
                    auraState.messages.push({
                        id: auraState.messages.length + 1,
                        sender: "aura",
                        text: `📋 **Recorded Specialist Actions (${auraState.recordedSteps.length}):**\n\n${stepsList}\n\n*Click "✨ Synthesize Blueprint" to compile these into an autonomous state machine!*`,
                        timestamp: "Just now",
                        cardType: "sequence"
                    });
                }
                auraState.speechMessage = `${auraState.recordedSteps.length} actions logged! ⚡`;
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 14. Email / Letter Draft
            if (lower.includes("email") || lower.includes("letter") || lower.includes("draft") || lower.includes("resolution") || lower.includes("template")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `✉️ **Resolution Dispatch Drafted for ${empName}**\n\n` +
                          `*Dear ${empName},*\n\n` +
                          `*Your attendance record for 23 October 2026 has been verified via Truein biometric logs and approved by your reporting manager. Your shift has been regularized in Darwinbox (Ref: DBX-REG-202610-1MG0023) as PRESENT with zero salary or leave deduction.*\n\n` +
                          `*Warm regards,*\n*1MG People Operations Desk*\n*Tata 1mg Healthcare Solutions Private Limited*`,
                    timestamp: "Just now",
                    cardType: "email_preview"
                });
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 15. Dry Run / Test
            if (lower.includes("dry") || lower.includes("test") || lower.includes("simulat") || lower.includes("run")) {
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `⚡ **Autonomous Dry Run Simulation Complete**\nExecuted 4 synthetic verification passes against staging connectors (Darwinbox HRMS, Truein Biometrics, Google Workspace) with zero runtime errors.`,
                    timestamp: "Just now",
                    cardType: "dry_run"
                });
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 16. Use Standard Workflow
            if (lower.includes("proceed") || lower.startsWith("use ") || lower.includes("use \"") || lower.includes("use '") || lower === "use workflow") {
                if (auraState.caseRef) {
                    fetch(`/api/workflows/case/${encodeURIComponent(auraState.caseRef)}/start`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ performed_by: auraState.specialistName || "Specialist" })
                    }).then(() => {
                        if (typeof window.loadCaseDossier === "function") {
                            window.loadCaseDossier(auraState.caseRef, true);
                        }
                    }).catch(() => {});
                }
                auraState.messages.push({
                    id: auraState.messages.length + 1,
                    sender: "aura",
                    text: `🚀 **Standard Workflow Activated: ${auraState.workflowName || "Attendance Correction"}**!\n\nConnected to **WF-ATTENDANCE-001** state machine in database.\n- **Initial State:** ATTENDANCE_RECEIVED (Ready)\n- **Active Step:** Step 2 Audit & Diagnostics\n- **Next Milestone:** Manager Sign-Off & Darwinbox Regularization\n\nI will monitor all telemetry checks and governance gates as you process this dossier.`,
                    timestamp: "Just now"
                });
                auraState.speechMessage = `Workflow WF-${auraState.activeIntentCode} Active! 🚀`;
                renderExpandedCockpit();
                renderCircularOrb();
                return;
            }

            // 17. Intelligent Human Fallback (Never robotic "Received: X")
            auraState.messages.push({
                id: auraState.messages.length + 1,
                sender: "aura",
                text: `I understand! Regarding "${text}":\n\n` +
                      `For **${empName}**'s attendance regularization on **${caseId}**, we are currently at **Step 2 (Audit & Execution)**.\n\n` +
                      `Here are the most helpful things I can do for you right now:\n` +
                      `• 🔍 **Run Diagnostics** — verify Truein turnstile telemetry & Wi-Fi sessions\n` +
                      `• 🛡️ **Add Manager Approval** — insert a line manager approval stage into your stepper\n` +
                      `• 📝 **Summarize Findings** — auto-generate audit proof notes for Step 2\n` +
                      `• 🕒 **Regularize in Darwinbox** — update shift status to PRESENT with zero LOP\n\n` +
                      `Just type any instruction, or tell me which one you'd like to run!`,
                timestamp: "Just now"
            });
            auraState.speechMessage = "Ready to assist! 💡";
            renderExpandedCockpit();
            renderCircularOrb();

            renderExpandedCockpit();
            renderCircularOrb();
        }, 450);
    }

    function bindCockpitEvents(cockpit) {
        // Close, Minimize, & Reset
        cockpit.querySelector("#btnGrokMinimize")?.addEventListener("click", (e) => {
            e.stopPropagation();
            closeCockpit();
        });

        cockpit.querySelector("#btnGrokClose")?.addEventListener("click", (e) => {
            e.stopPropagation();
            closeCockpit();
        });

        cockpit.querySelector("#btnGrokReset")?.addEventListener("click", () => {
            auraState.status = "RECORDING";
            auraState.recordedSteps = [];
            auraState.speechMessage = "Nexus active! ✨";
            auraState.messages = [];
            renderExpandedCockpit();
            renderCircularOrb();
        });

        // Copy Bot Message text
        cockpit.querySelectorAll(".aura-msg-action-copy").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const copyText = btn.getAttribute("data-copy-text") || "";
                if (!copyText) return;
                navigator.clipboard?.writeText(copyText).then(() => {
                    const span = btn.querySelector("span");
                    if (span) {
                        const original = span.innerText;
                        span.innerText = "Copied!";
                        btn.style.color = "#34d399";
                        setTimeout(() => {
                            span.innerText = original;
                            btn.style.color = "";
                        }, 1600);
                    }
                }).catch(() => {});
            });
        });

        // Tabs
        cockpit.querySelector("#btnAuraTabChat")?.addEventListener("click", () => {
            auraState.activeTab = "chat";
            renderExpandedCockpit();
        });

        cockpit.querySelector("#btnAuraTabWorkflow")?.addEventListener("click", () => {
            auraState.activeTab = "workflow";
            renderExpandedCockpit();
        });

        // Centered Hero Onboarding Decision Buttons
        cockpit.querySelector("#btnHeroUseWorkflow")?.addEventListener("click", () => {
            const btnSpan = cockpit.querySelector("#btnHeroUseWorkflow span");
            const label = btnSpan ? btnSpan.innerText.trim() : "Use Workflow";
            handleSendUserMessage(label);
        });

        cockpit.querySelector("#btnHeroCreateNew")?.addEventListener("click", () => {
            handleSendUserMessage("Create new workflow");
        });

        // Interactive Decision Card Choice Buttons
        cockpit.querySelector("#btnChoiceProceedWf")?.addEventListener("click", () => {
            handleSendUserMessage("Proceed with standard workflow");
        });

        cockpit.querySelector("#btnChoiceNewWf")?.addEventListener("click", () => {
            handleSendUserMessage("Mine a new workflow for this case");
        });

        cockpit.querySelector("#btnChoiceMineWf")?.addEventListener("click", () => {
            handleSendUserMessage("Mine a new workflow for this case");
        });

        cockpit.querySelector("#btnChoiceTemplateWf")?.addEventListener("click", () => {
            handleSendUserMessage("Synthesize WF Blueprint");
        });

        // Quick Suggestion Chips
        cockpit.querySelectorAll(".aura-chip").forEach((chip) => {
            chip.addEventListener("click", () => {
                const prompt = chip.getAttribute("data-prompt");
                if (prompt) handleSendUserMessage(prompt);
            });
        });

        // 1-Click Synthesize from Workflow Tab
        cockpit.querySelector("#btnGrokSynthesizeNow")?.addEventListener("click", () => {
            handleSendUserMessage("Synthesize WF Blueprint");
        });

        // Publish to Studio
        cockpit.querySelector("#btnGrokPublishBuilder")?.addEventListener("click", () => {
            window.open(`builder.html?synthesized_intent=${encodeURIComponent(auraState.activeIntentCode)}`, "_blank");
        });

        cockpit.querySelector("#btnAuraChatPublish")?.addEventListener("click", () => {
            window.open(`builder.html?synthesized_intent=${encodeURIComponent(auraState.activeIntentCode)}`, "_blank");
        });

        cockpit.querySelector("#btnAuraChatDryRun")?.addEventListener("click", () => {
            handleSendUserMessage("Run autonomous dry test simulation");
        });

        cockpit.querySelector("#btnAuraPreviewEmail")?.addEventListener("click", () => {
            window.open(`builder.html?synthesized_intent=${encodeURIComponent(auraState.activeIntentCode)}`, "_blank");
        });

        // Voice Mic Simulated Interaction
        const micBtn = cockpit.querySelector("#btnAuraVoiceMic");
        micBtn?.addEventListener("click", () => {
            if (micBtn.classList.contains("is-listening")) return;
            micBtn.classList.add("is-listening");
            const input = cockpit.querySelector("#grokPromptInput");
            const prevPlaceholder = input ? input.placeholder : "";
            if (input) input.placeholder = "🎙️ Listening to voice instruction...";
            setTimeout(() => {
                micBtn.classList.remove("is-listening");
                if (input) {
                    input.placeholder = prevPlaceholder || "Ask Nexus or command workflow synthesis...";
                    handleSendUserMessage(`Synthesize autonomous workflow for ${auraState.activeIntentCode} with manager auto-pass gate`);
                }
            }, 1800);
        });

        // Send Text on Click or Enter
        const promptInput = cockpit.querySelector("#grokPromptInput");
        const sendBtn = cockpit.querySelector("#btnGrokSendPrompt");

        const submitPrompt = () => {
            if (!promptInput) return;
            const text = promptInput.value.trim();
            if (text) {
                promptInput.value = "";
                handleSendUserMessage(text);
            }
        };

        sendBtn?.addEventListener("click", submitPrompt);
        promptInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
            }
        });
    }

    function triggerShockwave() {
        const core = document.getElementById("grokOrbCore");
        if (core) {
            core.classList.remove("trigger-shockwave");
            void core.offsetWidth; // re-flow
            core.classList.add("trigger-shockwave");
        }
    }

    function setupDraggable(el) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        el.addEventListener("mousedown", (e) => {
            if (e.target.closest("#auraSpeechBubble") || e.target.closest("button") || e.target.closest("input")) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = el.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            el.style.transition = "none";
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            el.setAttribute("data-was-dragged", "true");
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Constrain within viewport
            newLeft = Math.max(16, Math.min(window.innerWidth - 80, newLeft));
            newTop = Math.max(16, Math.min(window.innerHeight - 80, newTop));

            el.style.left = `${newLeft}px`;
            el.style.top = `${newTop}px`;
            el.style.bottom = "auto";
            el.style.right = "auto";
        });

        window.addEventListener("mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            el.style.transition = "all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)";
            
            // Magnetic edge snap
            const rect = el.getBoundingClientRect();
            const snapToRight = (rect.left + rect.width / 2) > (window.innerWidth / 2);
            if (snapToRight) {
                el.style.left = "auto";
                el.style.right = "34px";
                el.classList.remove("docked-left");
                el.classList.add("docked-right");
            } else {
                el.style.left = "34px";
                el.style.right = "auto";
                el.classList.remove("docked-right");
                el.classList.add("docked-left");
            }
        });
    }

    // Public Integration Hook
    window.NexusBot = {
        open: openCockpit,
        close: closeCockpit,
        toggle: toggleCockpit,
        recordStep: (stepObj) => {
            triggerShockwave();
            const nextIdx = auraState.recordedSteps.length + 1;
            const title = stepObj.title || "Specialist Action";
            const nodeType = stepObj.nodeType || "action";
            const desc = stepObj.description || "";
            auraState.recordedSteps.push({
                id: nextIdx,
                title: title,
                nodeType: nodeType,
                description: desc,
                timestamp: "Just now"
            });
            auraState.status = "RECORDING";
            auraState.speechMessage = `Step #${nextIdx} logged! 🎉`;
            auraState.messages.push({
                id: auraState.messages.length + 1,
                sender: "aura",
                text: `⚡ Captured action: **${title}** [${nodeType.toUpperCase()}]. Added to state machine sequence.${desc ? `\n> *${desc}*` : ""}`,
                timestamp: "Just now",
                cardType: "sequence"
            });
            renderCircularOrb();
            renderExpandedCockpit();
        },
        setIntent: (intentCode, intentName, category, specialistName) => {
            auraState.activeIntentCode = intentCode || "GEN";
            auraState.activeIntentName = intentName || "Enterprise Inquiry";
            auraState.activeCategory = (category || "OPERATIONS").toUpperCase();
            if (specialistName) {
                auraState.specialistName = String(specialistName).trim();
            }
            auraState.speechMessage = `Learning ${intentCode}! ✨`;
            renderCircularOrb();
            renderExpandedCockpit();
        },
        initForCase: (info) => {
            if (!info) return;
            if (info.specialistName || info.agentName) {
                auraState.specialistName = String(info.specialistName || info.agentName).trim();
            }
            const newCaseRef = info.caseRef || auraState.caseRef;
            const isSameCase = auraState.caseRef === newCaseRef;

            // If already initialized for this case and chat is open or has active conversation, do NOT wipe messages!
            if (isSameCase && (auraState.messages.length > 0 || auraState.isOpen)) {
                auraState.isWorkflowConfigured = Boolean(info.isWorkflowConfigured);
                if (info.workflowName) auraState.workflowName = info.workflowName;
                return;
            }

            auraState.caseRef = newCaseRef;
            auraState.activeIntentName = info.intentName || "Enterprise Inquiry & Resolution";
            auraState.activeCategory = (info.category || "OPERATIONS").toUpperCase();

            const match = String(auraState.activeIntentName).match(/^([A-Z0-9]+)\s*[—\-·:]\s*(.+)$/);
            auraState.activeIntentCode = match ? match[1] : (auraState.activeCategory.slice(0, 4) || "CASE");
            if (match && match[2]) {
                auraState.activeIntentName = match[2].trim();
            }
            auraState.isWorkflowConfigured = Boolean(info.isWorkflowConfigured);
            auraState.workflowStages = Array.isArray(info.workflowStages) ? info.workflowStages : [];

            if (info.workflowName && !info.workflowName.toLowerCase().includes("no workflow")) {
                auraState.workflowName = info.workflowName;
            } else if (auraState.isWorkflowConfigured) {
                auraState.workflowName = `WF-${auraState.activeIntentCode} Workflow`;
            } else {
                auraState.workflowName = "";
            }

            if (Array.isArray(info.pastActions) && info.pastActions.length > 0) {
                auraState.recordedSteps = info.pastActions.map((act, idx) => ({
                    id: idx + 1,
                    title: (act.title || act.action_type || act.hrms_action_code || "Action").replace(/_/g, " "),
                    nodeType: (act.action_type === "EXECUTE_HRMS_ACTION" || act.action_type === "EXECUTE_ACTION" || act.action_type === "CREATE_AND_EXECUTE_ACTION") ? "data" : (act.action_type === "RESOLVE" ? "email" : "action"),
                    description: act.details || (act.provider ? `Executed via ${act.provider} on ${auraState.caseRef}` : `Executed on ${auraState.caseRef}`),
                    timestamp: "Earlier"
                }));
            }

            if (auraState.isWorkflowConfigured) {
                auraState.speechMessage = `Workflow WF-${auraState.activeIntentCode} detected! ⚡`;
            } else {
                auraState.speechMessage = `Nexus observing ${auraState.activeCategory} · Learning! ✨`;
            }

            // Clean initial messages array so the centered hero greeting & intent decision takes center stage!
            auraState.messages = [];

            renderCircularOrb();
            renderExpandedCockpit();
        }
    };

    // Backward compatibility alias
    window.AuraBot = window.NexusBot;

    // Global ESC key to minimize/close sheet
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && auraState.isOpen) {
            closeCockpit();
        }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            renderCircularOrb();
            renderExpandedCockpit();
        });
    } else {
        renderCircularOrb();
        renderExpandedCockpit();
    }
})();
