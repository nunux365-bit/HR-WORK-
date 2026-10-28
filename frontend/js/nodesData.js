const hrNodeCategories = [
    {
        name: "1. Triggers & Events", color: "bg-purple", icon: "fa-bolt",
        nodes: ["Manual Trigger", "Schedule Trigger", "Cron Trigger", "Email Received Trigger", "Gmail Email Trigger", "Microsoft 365 Email Trigger", "IMAP Email Trigger", "Webhook Trigger", "Case Created Trigger", "Case Updated Trigger", "Case Status Changed Trigger", "Employee Created Trigger", "Employee Updated Trigger", "Employee Joined Trigger", "Employee Exit Trigger", "Document Received Trigger", "Approval Completed Trigger", "Approval Rejected Trigger", "SLA Breach Trigger", "External Event Trigger"]
    },
    {
        name: "2. Workflow / Logic", color: "bg-gray", icon: "fa-code-branch",
        nodes: ["Condition", "Switch", "IF / ELSE", "AND", "OR", "NOT", "Compare Values", "Check Exists", "Check Empty", "Check Null", "Check Type", "Filter", "Loop", "For Each", "Batch Items", "Merge", "Split", "Join", "Wait", "Wait Until Date", "Wait for Event", "Wait for Webhook", "Wait for Email", "Wait for Approval", "Execute Workflow", "Sub-workflow", "Stop Workflow", "Continue", "Error Route", "No Operation"]
    },
    {
        name: "3. Data / Variables / Transformation", color: "bg-blue", icon: "fa-database",
        nodes: ["Set Value", "Set Variable", "Get Variable", "Delete Variable", "Map Fields", "Transform Data", "Rename Field", "Remove Field", "Copy Field", "Merge Fields", "Split Field", "Format Text", "Format Number", "Format Date", "Format Currency", "Convert Timezone", "Parse JSON", "Create JSON", "Parse XML", "Create XML", "Parse CSV", "Create CSV", "Array Map", "Array Filter", "Array Reduce", "Array Sort", "Array Unique", "Object Merge", "Object Pick", "Object Omit"]
    },
    {
        name: "4. Expression / Utility", color: "bg-gray", icon: "fa-calculator",
        nodes: ["Expression", "Template", "String Contains", "String Starts With", "String Ends With", "String Replace", "String Split", "String Join", "String Length", "Regex Match", "Regex Extract", "Number Add", "Number Subtract", "Number Multiply", "Number Divide", "Number Round", "Date Difference", "Add Date", "Current Date/Time", "Generate ID"]
    },
    {
        name: "5. Employee / Workforce", color: "bg-green", icon: "fa-user-tie",
        nodes: ["Get Employee", "Create Employee", "Update Employee", "Delete Employee", "Get Manager", "Get Department", "Get Employment Status", "Get Employee Profile", "Get Employee Contact", "Get Employee Job Details", "Get Employee Location", "Get Employee Grade", "Get Employee Designation", "Get Employee Joining Date", "Get Employee Exit Date", "Get Employee Type", "Get Reporting Manager", "Get HRBP", "Get Employee Documents", "Update Employee Contact", "Update Employee Job Details", "Update Employee Manager", "Update Employee Department", "Update Employee Status", "Search Employees"]
    },
    {
        name: "6. HR Case Management", color: "bg-orange", icon: "fa-briefcase",
        nodes: ["Create Case", "Get Case", "Update Case", "Assign Case", "Change Case Status", "Close Case", "Reopen Case", "Search Cases", "Get Case History", "Get Case Comments", "Add Case Comment", "Add Case Attachment", "Remove Case Attachment", "Set Case Priority", "Set Case Category", "Set Case SLA", "Assign Case Team", "Assign Case Owner", "Escalate Case", "Resolve Case", "Reject Case", "Put Case On Hold", "Resume Case", "Link Case", "Unlink Case"]
    },
    {
        name: "7. HR Intelligence / Classification", color: "bg-purple", icon: "fa-brain",
        nodes: ["Classify HR Request", "Extract HR Fields", "Validate HR Request", "Detect HR Category", "Detect Employee", "Detect Intent", "Detect Sentiment", "Detect Urgency", "Detect Priority", "Extract Employee ID", "Extract Dates", "Extract Documents", "Extract Case Details", "Extract Email Entities", "Detect Duplicate Request", "Detect Unknown Category", "Route Unknown Request", "Human Review", "Confidence Check", "AI Decision Gate"]
    },
    {
        name: "8. Attendance", color: "bg-green", icon: "fa-calendar-check",
        nodes: ["Get Attendance", "Check Attendance", "Correct Attendance", "Create Attendance Case", "Get Shift", "Get Attendance Policy", "Get Attendance History", "Get Daily Attendance", "Get Monthly Attendance", "Check Missing Punch", "Check Late Mark", "Check Early Leaving", "Check Absent Status", "Check Shift Assignment", "Update Attendance", "Regularize Attendance", "Approve Attendance Regularization", "Reject Attendance Regularization", "Notify Attendance Team", "Close Attendance Issue"]
    },
    {
        name: "9. Leave", color: "bg-green", icon: "fa-plane-departure",
        nodes: ["Get Leave Balance", "Check Leave Eligibility", "Create Leave Request", "Approve Leave", "Reject Leave", "Cancel Leave", "Get Leave History", "Get Leave Policy", "Get Leave Types", "Check Holiday", "Check Working Day", "Calculate Leave Days", "Check Overlap", "Check Manager Approval", "Escalate Leave Request", "Update Leave Request", "Withdraw Leave Request", "Notify Leave Team", "Create Leave Case", "Close Leave Case"]
    },
    {
        name: "10. Payroll", color: "bg-green", icon: "fa-money-check-dollar",
        nodes: ["Get Payroll", "Check Payroll Status", "Get Payslip", "Create Payroll Case", "Notify Payroll Team", "Get Salary Details", "Get Salary History", "Get Payroll Month", "Check Salary Credit", "Check Deduction", "Check Tax Deduction", "Check Bonus", "Check Reimbursement", "Check Payroll Error", "Submit Payroll Correction", "Approve Payroll Correction", "Reject Payroll Correction", "Generate Payroll Request", "Escalate Payroll Case", "Close Payroll Case"]
    },
    {
        name: "11. BGV / Background Verification", color: "bg-blue", icon: "fa-id-card",
        nodes: ["Create BGV", "Get BGV Status", "Send BGV Request", "Upload Document", "Verify Document", "Complete BGV", "Get BGV Details", "Update BGV", "Start Verification", "Check Verification Status", "Verify Employment", "Verify Education", "Verify Address", "Verify Identity", "Verify Reference", "Request Missing Document", "Reject Document", "Escalate BGV", "Mark BGV Failed", "Close BGV"]
    },
    {
        name: "12. Resignation / Exit", color: "bg-red", icon: "fa-person-walking-arrow-right",
        nodes: ["Create Exit Case", "Get Exit Details", "Request Documents", "Validate Documents", "Manager Approval", "Asset Clearance", "IT Clearance", "Finance Clearance", "BGV", "Generate Relieving Letter", "Close Exit", "Get Resignation", "Create Resignation", "Update Resignation", "Withdraw Resignation", "Accept Resignation", "Reject Resignation", "Calculate Notice Period", "Check Notice Period", "Calculate Last Working Day", "Request Experience Letter", "Request Indemnity Letter", "Check Exit Checklist", "Complete Exit Checklist", "Escalate Exit"]
    },
    {
        name: "13. Asset / IT", color: "bg-orange", icon: "fa-laptop",
        nodes: ["Create IT Ticket", "Get Asset", "Assign Asset", "Return Asset", "Asset Clearance", "Create IT Request", "Update IT Ticket", "Close IT Ticket", "Get Asset History", "Get Employee Assets", "Search Assets", "Check Asset Availability", "Reserve Asset", "Transfer Asset", "Repair Asset", "Mark Asset Lost", "Mark Asset Damaged", "Approve Asset Request", "Reject Asset Request", "Notify IT Team"]
    },
    {
        name: "14. Communication", color: "bg-red", icon: "fa-envelope",
        nodes: ["Send Email", "Reply Email", "Send Teams", "Send Slack", "Send WhatsApp", "Send Notification", "Create Template", "Send SMS", "Send Push Notification", "Send HR Notification", "Send Manager Notification", "Send Employee Notification", "Send Approval Request", "Send Reminder", "Send Escalation", "Send Case Update", "Send Document Request", "Send Welcome Email", "Send Exit Email", "Send Completion Notification"]
    },
    {
        name: "15. AI", color: "bg-purple", icon: "fa-robot",
        nodes: ["AI Classifier", "AI Extractor", "AI Summarizer", "AI Reply Generator", "AI Decision Assistant", "AI Document Analyzer", "AI Email Analyzer", "AI Category Predictor", "AI Field Extractor", "AI Duplicate Detector", "AI Sentiment Analyzer", "AI Priority Predictor", "AI Response Drafter", "AI Document Reviewer", "AI Human Review Assistant"]
    },
    {
        name: "16. Email / Mailbox", color: "bg-blue", icon: "fa-inbox",
        nodes: ["Gmail", "Microsoft 365", "IMAP", "Email Parser", "Email Normalizer", "Email Attachment Extractor", "Email Thread Resolver", "Email Sender Resolver", "Email Category Router", "Email Case Creator"]
    },
    {
        name: "17. Integration / API / Platform", color: "bg-gray", icon: "fa-plug",
        nodes: ["Internal HRMS", "Truein", "Slack Integration", "Jira Integration", "Generic REST API", "HTTP Request", "Credential", "Execute Workflow", "Webhook Response"]
    }
];

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}
