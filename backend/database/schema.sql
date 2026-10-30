PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    employee_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,

    department TEXT,
    designation TEXT,
    manager_name TEXT,
    location TEXT,

    source TEXT NOT NULL DEFAULT 'email',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    provider TEXT NOT NULL DEFAULT 'gmail',
    provider_message_id TEXT NOT NULL,
    account_email TEXT,

    thread_id TEXT,

    sender_name TEXT,
    sender_email TEXT,

    subject TEXT,
    body TEXT,

    received_at TEXT,

    employee_id INTEGER,

    category TEXT,
    category_confidence REAL,

    intent TEXT,
    intent_score REAL,

    requires_review INTEGER NOT NULL DEFAULT 0,

    processing_status TEXT NOT NULL DEFAULT 'RECEIVED',

    category_reason TEXT,
    decision_status TEXT,
    extracted_fields TEXT,
    validation_result TEXT,
    is_actionable INTEGER NOT NULL DEFAULT 1,
    actionable_reason TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (employee_id)
        REFERENCES employees(id)
        ON DELETE SET NULL,

    UNIQUE(provider, provider_message_id)
);


CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    case_number TEXT NOT NULL UNIQUE,

    email_id INTEGER,
    employee_id INTEGER,

    category TEXT,
    intent TEXT,

    title TEXT,
    description TEXT,

    status TEXT NOT NULL DEFAULT 'NEW',
    priority TEXT NOT NULL DEFAULT 'MEDIUM',

    assigned_team TEXT,
    assigned_user TEXT,
    assigned_user_email TEXT,
    assigned_to TEXT,
    last_dispatch_status TEXT,
    last_dispatched_at TEXT,

    sla_hours INTEGER NOT NULL DEFAULT 48,
    due_at TEXT,

    workflow_id TEXT,
    workflow_state TEXT,

    extracted_fields TEXT,
    validation_result TEXT,

    resolution_type TEXT,
    resolution_notes TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    closed_by TEXT,
    reopened_by TEXT,
    reopened_at TEXT,
    reopen_reason TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,

    FOREIGN KEY (email_id)
        REFERENCES emails(id)
        ON DELETE SET NULL,

    FOREIGN KEY (employee_id)
        REFERENCES employees(id)
        ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS hr_departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL UNIQUE,
    team_name TEXT NOT NULL UNIQUE,
    category_scope TEXT NOT NULL,
    dept_gmail TEXT NOT NULL,
    sla_hours INTEGER NOT NULL DEFAULT 48,
    default_priority TEXT NOT NULL DEFAULT 'MEDIUM',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS hr_department_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_id INTEGER NOT NULL,
    dept_ids TEXT,
    team_name TEXT NOT NULL,
    member_name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'HR_AGENT',
    designation TEXT NOT NULL DEFAULT 'HR Specialist',
    sub_department TEXT NOT NULL DEFAULT 'Salary & Payroll',
    category_scope TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dept_id)
        REFERENCES hr_departments(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS workflow_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    case_id INTEGER NOT NULL,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT,
    current_state TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    history_json TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS case_field_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    case_id INTEGER,
    email_id INTEGER,

    field_name TEXT NOT NULL,
    field_value TEXT,
    is_valid INTEGER NOT NULL DEFAULT 1,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE,

    FOREIGN KEY (email_id)
        REFERENCES emails(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    case_id INTEGER NOT NULL,

    title TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'HR_REVIEW',
    description TEXT,

    status TEXT NOT NULL DEFAULT 'PENDING',
    priority TEXT NOT NULL DEFAULT 'MEDIUM',

    assigned_to TEXT,
    assigned_team TEXT,
    created_by TEXT NOT NULL DEFAULT 'hr_admin',

    due_at TEXT,
    completed_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    approval_code TEXT NOT NULL UNIQUE,
    case_id INTEGER NOT NULL,
    task_id INTEGER,

    approval_type TEXT NOT NULL DEFAULT 'MANAGER_APPROVAL',
    approver TEXT NOT NULL,
    approver_role TEXT DEFAULT 'HR_MANAGER',

    status TEXT NOT NULL DEFAULT 'PENDING',
    workflow_trigger_approve TEXT,
    workflow_trigger_reject TEXT,

    requested_by TEXT NOT NULL DEFAULT 'hr_admin',
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decision_at TEXT,
    decision_by TEXT,
    comments TEXT,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE,

    FOREIGN KEY (task_id)
        REFERENCES tasks(id)
        ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS case_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    case_id INTEGER NOT NULL,
    email_id INTEGER,

    name TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'SUPPORTING_DOCUMENT',
    uploaded_by TEXT NOT NULL DEFAULT 'Employee',
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    size TEXT DEFAULT '—',
    status TEXT NOT NULL DEFAULT 'RECEIVED',
    notes TEXT,
    file_path TEXT,
    content_type TEXT DEFAULT 'application/octet-stream',
    file_size_bytes INTEGER DEFAULT 0,
    attachment_id INTEGER,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    file_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);


CREATE TABLE IF NOT EXISTS case_communications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    case_id INTEGER NOT NULL,
    email_id INTEGER,

    sender_type TEXT NOT NULL DEFAULT 'HR',
    sender_name TEXT NOT NULL,
    recipient TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    comm_type TEXT NOT NULL DEFAULT 'OUTBOUND_HR',
    missing_items TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    notif_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    case_id INTEGER,
    case_number TEXT,
    recipient_user TEXT,
    recipient_role TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,

    action TEXT NOT NULL,
    description TEXT,

    performed_by TEXT NOT NULL DEFAULT 'system',

    metadata TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX IF NOT EXISTS idx_employees_email
ON employees(email);

CREATE INDEX IF NOT EXISTS idx_emails_employee
ON emails(employee_id);

CREATE INDEX IF NOT EXISTS idx_emails_received_at
ON emails(received_at);

CREATE INDEX IF NOT EXISTS idx_emails_category
ON emails(category);

CREATE INDEX IF NOT EXISTS idx_emails_processing_status
ON emails(processing_status);

CREATE INDEX IF NOT EXISTS idx_cases_employee
ON cases(employee_id);

CREATE INDEX IF NOT EXISTS idx_cases_email
ON cases(email_id);

CREATE INDEX IF NOT EXISTS idx_cases_status
ON cases(status);

CREATE INDEX IF NOT EXISTS idx_cases_category
ON cases(category);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_case
ON workflow_instances(case_id);

CREATE INDEX IF NOT EXISTS idx_tasks_case
ON tasks(case_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_approvals_case
ON approvals(case_id);

CREATE INDEX IF NOT EXISTS idx_approvals_status
ON approvals(status);

CREATE INDEX IF NOT EXISTS idx_case_docs_case
ON case_documents(case_id);

CREATE INDEX IF NOT EXISTS idx_case_comms_case
ON case_communications(case_id);

CREATE INDEX IF NOT EXISTS idx_notifications_read
ON notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_audit_entity
ON audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_created_at
ON audit_logs(created_at);


-- ============================================================
-- PHASE 8 — INTEGRATION & ACTION AUTOMATION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    mode TEXT NOT NULL DEFAULT 'MOCK',
    configuration TEXT NOT NULL DEFAULT '{}',
    capabilities TEXT NOT NULL DEFAULT '[]',
    last_health_check_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(integration_id, secret_key),
    FOREIGN KEY (integration_id)
        REFERENCES integrations(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_policies (
    action_type TEXT PRIMARY KEY,
    risk_level TEXT NOT NULL DEFAULT 'LOW',
    execution_mode TEXT NOT NULL DEFAULT 'AUTOMATIC',
    required_role TEXT NOT NULL DEFAULT 'HR_AGENT',
    requires_approval INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hr_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_code TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    case_id INTEGER,
    case_number TEXT,
    employee_id TEXT,
    employee_name TEXT,
    workflow_id TEXT,
    workflow_step TEXT,
    action_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'LOW',
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    request_payload TEXT DEFAULT '{}',
    response_payload TEXT DEFAULT '{}',
    external_reference TEXT,
    error_message TEXT,
    requested_by TEXT NOT NULL DEFAULT 'system',
    approved_by TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id)
        REFERENCES cases(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_api_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    action_id INTEGER,
    case_id INTEGER,
    case_number TEXT,
    employee_id TEXT,
    provider TEXT NOT NULL,
    action_type TEXT NOT NULL,
    performed_by TEXT NOT NULL DEFAULT 'system',
    status TEXT NOT NULL,
    external_reference TEXT,
    sanitized_request TEXT DEFAULT '{}',
    sanitized_response TEXT DEFAULT '{}',
    error_message TEXT,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hr_actions_case
ON hr_actions(case_id);

CREATE INDEX IF NOT EXISTS idx_hr_actions_status
ON hr_actions(status);

CREATE INDEX IF NOT EXISTS idx_hr_actions_provider
ON hr_actions(provider);

CREATE INDEX IF NOT EXISTS idx_external_audits_case
ON external_api_audits(case_id);

CREATE INDEX IF NOT EXISTS idx_external_audits_provider
ON external_api_audits(provider);


-- ============================================================
-- PHASE 9 — USER MANAGEMENT (RBAC)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'HR_AGENT',
    name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT,
    department TEXT,
    profile_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connected_mailboxes (
    email TEXT PRIMARY KEY,
    app_password TEXT NOT NULL,
    role TEXT DEFAULT 'ADMIN',
    provider TEXT DEFAULT 'GMAIL',
    imap_host TEXT DEFAULT 'imap.gmail.com',
    smtp_host TEXT DEFAULT 'smtp.gmail.com',
    inbox_total INTEGER DEFAULT 0,
    last_sync_at TEXT,
    connected INTEGER DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    case_number TEXT NOT NULL,
    employee_id TEXT,
    employee_email TEXT,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    tags TEXT DEFAULT '[]',
    comments TEXT,
    submitted_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_feedback_case_id ON case_feedback(case_id);
CREATE INDEX IF NOT EXISTS idx_case_feedback_case_num ON case_feedback(case_number);


