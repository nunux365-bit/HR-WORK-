/**
 * HR FLOW — Enterprise Workflow Nodes & Catalog (WorkFlow/frontend/nodesData.js)
 * High-performance, zero-icon typographic architecture for enterprise HR operations.
 * Covers Internal HRMS, Truein Biometrics, GreytHR, Gmail/M365, Policy Engine, and Approval Gates.
 */

const hrNodeCategories = [
    {
        id: "triggers",
        name: "1. Triggers & Intake",
        type: "TRIGGER",
        tag: "[TRIGGER]",
        badge: "TRIG",
        colorClass: "accent-blue",
        colorHex: "#2563eb",
        nodes: [
            {
                type: "trigger_email_inbound",
                title: "Inbound Email Intake",
                tag: "[TRIGGER]",
                badge: "EMAIL",
                provider: "Gmail / M365",
                desc: "Parses email body, subject, attachments, and employee sender address.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { mailbox: "hr@company.com", autoParseIntent: true }
            },
            {
                type: "trigger_hrms_webhook",
                title: "HRMS Event Webhook",
                tag: "[TRIGGER]",
                badge: "HRMS",
                provider: "Internal HRMS",
                desc: "Fires when employee lifecycle or leave event changes in HRMS.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { eventType: "LEAVE_APPLIED", hrmsEnv: "Production" }
            },
            {
                type: "trigger_biometric_anomaly",
                title: "Biometric Swipe Anomaly",
                tag: "[TRIGGER]",
                badge: "PUNCH",
                provider: "Truein Biometrics",
                desc: "Triggers on missing punch, late mark, or swipe variance > 60 minutes.",
                mode: "Automated",
                sla: "Real-time",
                defaultConfig: { varianceThresholdMin: 60, shiftPolicy: "Standard Day" }
            },
            {
                type: "trigger_case_created",
                title: "Case Created Intake",
                tag: "[TRIGGER]",
                badge: "CASE",
                provider: "HR Flow Core",
                desc: "Triggers immediately when an HR Specialist or AI initiates a new case.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { autoAssignQueue: true, priorityInherit: true }
            },
            {
                type: "trigger_cron_schedule",
                title: "Scheduled Cron Sweep",
                tag: "[TRIGGER]",
                badge: "CRON",
                provider: "Scheduler",
                desc: "Executes periodic batch audit, SLA breach monitoring, or payroll lock checks.",
                mode: "Automated",
                sla: "Scheduled",
                defaultConfig: { schedule: "0 9 * * 1-5", timezone: "Asia/Kolkata" }
            }
        ]
    },
    {
        id: "policy",
        name: "2. Policy & Evaluation",
        type: "CONDITION",
        tag: "[POLICY]",
        badge: "EVAL",
        colorClass: "accent-amber",
        colorHex: "#d97706",
        nodes: [
            {
                type: "eval_leave_balance",
                title: "Evaluate Quota Balance",
                tag: "[POLICY]",
                badge: "QUOTA",
                provider: "Policy Engine",
                desc: "Checks if employee has sufficient leave balance in HRMS for requested dates.",
                mode: "Automated",
                sla: "< 1s",
                defaultConfig: { leaveType: "CASUAL_OR_SICK", minBalanceRequired: 1 }
            },
            {
                type: "eval_branch_condition",
                title: "IF / ELSE Policy Branch",
                tag: "[POLICY]",
                badge: "LOGIC",
                provider: "Rule Engine",
                desc: "Branches execution based on duration (e.g. > 2 days -> Manager, <= 2 days -> Auto).",
                mode: "Automated",
                sla: "< 1s",
                defaultConfig: { expression: "$ctx.duration_days > 2", trueBranch: "MANAGER_GATE", falseBranch: "AUTO_APPROVE" }
            },
            {
                type: "eval_biometric_grace",
                title: "Shift & Grace Evaluator",
                tag: "[POLICY]",
                badge: "SHIFT",
                provider: "Attendance Rule",
                desc: "Applies 15-minute grace window and calculates regularization allowance.",
                mode: "Automated",
                sla: "< 1s",
                defaultConfig: { graceMinutes: 15, monthlyQuota: 3 }
            },
            {
                type: "eval_sla_escalation",
                title: "SLA Escalation Timer",
                tag: "[POLICY]",
                badge: "TIMER",
                provider: "SLA Monitor",
                desc: "Auto-escalates to Department Head if approval remains pending past threshold.",
                mode: "Automated",
                sla: "24h / 48h",
                defaultConfig: { thresholdHours: 24, escalateTo: "Department Head" }
            },
            {
                type: "eval_notice_period",
                title: "Notice Period Calculator",
                tag: "[POLICY]",
                badge: "TENURE",
                provider: "Exit Policy",
                desc: "Calculates official notice period days, buyout eligibility, and FnF clearance dates.",
                mode: "Automated",
                sla: "< 1s",
                defaultConfig: { probationDays: 30, confirmedDays: 90 }
            }
        ]
    },
    {
        id: "integrations",
        name: "3. HRMS Integrations",
        type: "INTEGRATION",
        tag: "[HRMS]",
        badge: "SYNC",
        colorClass: "accent-emerald",
        colorHex: "#059669",
        nodes: [
            {
                type: "hrms_ledger_sync",
                title: "HRMS Leave Ledger Sync",
                tag: "[HRMS]",
                badge: "LEDGER",
                provider: "Internal HRMS Core",
                desc: "Debits employee balance and records approved leave transaction in HRMS.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { apiEndpoint: "/api/v2/leaves/apply", idempotent: true }
            },
            {
                type: "hrms_truein_pull",
                title: "Truein Biometric Punch Pull",
                tag: "[HRMS]",
                badge: "TRUEIN",
                provider: "Truein Cloud",
                desc: "Queries real-time biometric terminal punches, face ID timestamps, and geo-fence logs.",
                mode: "Automated",
                sla: "< 2s",
                defaultConfig: { terminalGroup: "HQ_GATES", includeSelfie: false }
            },
            {
                type: "hrms_greythr_payroll",
                title: "GreytHR Payroll Adjustment",
                tag: "[HRMS]",
                badge: "PAYROLL",
                provider: "GreytHR API",
                desc: "Posts salary adjustment, LOP deduction, or reimbursement credit directly to payroll.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { payrollCycle: "CURRENT_MONTH", postMode: "STAGING" }
            },
            {
                type: "hrms_profile_fetch",
                title: "Fetch Employee Profile",
                tag: "[HRMS]",
                badge: "DATA",
                provider: "HRMS Employee Master",
                desc: "Fetches manager email, cost center, band, and emergency contacts for case context.",
                mode: "Automated",
                sla: "< 1s",
                defaultConfig: { fields: ["manager", "department", "grade", "joining_date"] }
            },
            {
                type: "hrms_custom_rest",
                title: "Custom REST API Connector",
                tag: "[HRMS]",
                badge: "REST",
                provider: "External API",
                desc: "Sends HTTP POST/GET payload to enterprise internal services or ERP gateways.",
                mode: "Automated",
                sla: "Configurable",
                defaultConfig: { method: "POST", url: "https://api.internal/v1/hrms", auth: "Bearer" }
            }
        ]
    },
    {
        id: "gates",
        name: "4. Human Approval Gates",
        type: "HUMAN",
        tag: "[HUMAN GATE]",
        badge: "GATE",
        colorClass: "accent-purple",
        colorHex: "#7c3aed",
        nodes: [
            {
                type: "gate_manager_approval",
                title: "Line Manager Sign-off",
                tag: "[HUMAN GATE]",
                badge: "L1 MGR",
                provider: "Human Gate",
                desc: "Pauses workflow for direct manager sign-off via 1-click email or Slack response.",
                mode: "Human-in-the-Loop",
                sla: "24h SLA",
                defaultConfig: { approverRole: "REPORTING_MANAGER", reminderIntervalHours: 12 }
            },
            {
                type: "gate_hrbp_audit",
                title: "HR Business Partner Audit",
                tag: "[HUMAN GATE]",
                badge: "HRBP",
                provider: "Human Gate",
                desc: "Requires HRBP review for policy exceptions, extended medical leave, or salary corrections.",
                mode: "Human-in-the-Loop",
                sla: "24h SLA",
                defaultConfig: { approverRole: "HRBP", allowOverride: true }
            },
            {
                type: "gate_dept_head",
                title: "Department Head Sign-off",
                tag: "[HUMAN GATE]",
                badge: "L2 HEAD",
                provider: "Human Gate",
                desc: "Level 2 executive approval for high-impact organizational or budget adjustments.",
                mode: "Human-in-the-Loop",
                sla: "48h SLA",
                defaultConfig: { approverRole: "DEPT_HEAD", autoEscalateOnBreach: true }
            },
            {
                type: "gate_finance_lock",
                title: "Finance & Payroll Lock",
                tag: "[HUMAN GATE]",
                badge: "FINANCE",
                provider: "Human Gate",
                desc: "Requires Finance verification prior to final payroll cutoff release.",
                mode: "Human-in-the-Loop",
                sla: "12h SLA",
                defaultConfig: { cutoffDay: 25, approverRole: "PAYROLL_ADMIN" }
            }
        ]
    },
    {
        id: "docs",
        name: "5. Document & Clearance",
        type: "DOC_GEN",
        tag: "[DOC GEN]",
        badge: "DOCS",
        colorClass: "accent-cyan",
        colorHex: "#0284c7",
        nodes: [
            {
                type: "doc_sanction_letter",
                title: "Generate PDF Sanction Letter",
                tag: "[DOC GEN]",
                badge: "PDF",
                provider: "Document Engine",
                desc: "Assembles official leave sanction or regularized attendance record with digital stamp.",
                mode: "Automated",
                sla: "< 2s",
                defaultConfig: { template: "OFFICIAL_SANCTION_V2", attachToCase: true }
            },
            {
                type: "doc_medical_ocr",
                title: "Medical Certificate OCR",
                tag: "[DOC GEN]",
                badge: "OCR",
                provider: "Doc Parser",
                desc: "Validates physician registration number, diagnosis date, and certificate authenticity.",
                mode: "Automated",
                sla: "< 3s",
                defaultConfig: { requireDoctorReg: true, matchDatesWithRequest: true }
            },
            {
                type: "doc_relieving_letter",
                title: "Generate Relieving & Experience Letter",
                tag: "[DOC GEN]",
                badge: "EXIT",
                provider: "Document Engine",
                desc: "Produces full exit pack including Service Certificate, Relieving Letter, and FnF breakdown.",
                mode: "Automated",
                sla: "< 2s",
                defaultConfig: { template: "RELIEVING_V3", watermark: false }
            },
            {
                type: "doc_esign_request",
                title: "E-Signature Dispatch",
                tag: "[DOC GEN]",
                badge: "ESIGN",
                provider: "DocuSign / ZohoSign",
                desc: "Dispatches document for legally compliant dual-party electronic signatures.",
                mode: "Human-in-the-Loop",
                sla: "48h SLA",
                defaultConfig: { signers: ["EMPLOYEE", "HR_DIRECTOR"], expiryDays: 3 }
            }
        ]
    },
    {
        id: "resolution",
        name: "6. Notifications & Audit",
        type: "ACTION",
        tag: "[RESOLUTION]",
        badge: "AUDIT",
        colorClass: "accent-slate",
        colorHex: "#475569",
        nodes: [
            {
                type: "notif_email_update",
                title: "Send Transactional Email",
                tag: "[RESOLUTION]",
                badge: "NOTIF",
                provider: "Gmail SMTP",
                desc: "Dispatches personalized email acknowledgement or resolution notification to employee.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { template: "CASE_STATUS_UPDATE", trackOpens: true }
            },
            {
                type: "notif_slack_ping",
                title: "Slack Manager Action Card",
                tag: "[RESOLUTION]",
                badge: "SLACK",
                provider: "Slack Webhook",
                desc: "Posts rich interactive card with 1-click [Approve] and [Reject] buttons in manager DM.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { channel: "MANAGER_DM", interactive: true }
            },
            {
                type: "audit_state_log",
                title: "State Machine Audit Trail",
                tag: "[RESOLUTION]",
                badge: "LOG",
                provider: "Audit Service",
                desc: "Appends immutable entry to case audit trail with timestamp, user ID, and transition delta.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { logType: "TRANSITION_AUDIT", complianceRetentionYears: 7 }
            },
            {
                type: "action_close_case",
                title: "Resolve & Close Case",
                tag: "[RESOLUTION]",
                badge: "CLOSE",
                provider: "HR Flow Engine",
                desc: "Marks case status as RESOLVED, updates SLA performance metrics, and archives thread.",
                mode: "Automated",
                sla: "Instant",
                defaultConfig: { notifyEmployee: true, resolutionCode: "COMPLETED_SUCCESSFULLY" }
            }
        ]
    }
];

if (typeof window !== "undefined") {
    window.hrNodeCategories = hrNodeCategories;
}
