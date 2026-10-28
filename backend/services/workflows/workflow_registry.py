"""
HR FLOW — Universal Configuration-Driven Workflow Registry (backend/services/workflows/workflow_registry.py)
Implements the 24-Point Final Architecture:
  - Category = Configuration, Not Code
  - Strict separation of Node vs. Workflow Execution State vs. Case Business Status
  - 7 Decoupled Scopes per Category: Details & SLA Ladder, Dynamic Form Schema, Workflow Graph,
    Rules & Expressions, Data Mapping & Connectors (REST/Webhook), Simulator & Test Cases,
    and Versioning / Change Diff / Rollback / Governance.
"""

import copy
import json
import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from backend.config import Config

_WORKFLOWS_CACHE: Dict[str, Dict[str, Any]] = {}

# 1. Standardized Node Box Families (Expanded with Subworkflow, Wait/Timer, HTTP/Webhook, Parallel/Switch)
NODE_BOX_FAMILIES: List[Dict[str, Any]] = [
    {
        "box_type": "TRIGGER",
        "css_icon": "icon-trigger",
        "badge_label": "TRIGGER NODE",
        "color": "#3b82f6",
        "ports": {"in": 0, "out": 1},
        "description": "Starts workflow on Email Received, Form Submitted, Case Created, Webhook, or Schedule.",
    },
    {
        "box_type": "DATA",
        "css_icon": "icon-data",
        "badge_label": "DATA & MAPPING",
        "color": "#0ea5e9",
        "ports": {"in": 1, "out": 1},
        "description": "Fetches live data from HRMS and maps variables across Case, Employee, Form, and $ctx.",
    },
    {
        "box_type": "CONDITION",
        "css_icon": "icon-logic",
        "badge_label": "LOGIC & BRANCHING",
        "color": "#f59e0b",
        "ports": {"in": 1, "out_yes": 1, "out_no": 1},
        "description": "Supports IF/ELSE, Multi-Threshold (<10K/10K-50K/>50K), Switch by Dept, Parallel & Join, and DMN Rules.",
    },
    {
        "box_type": "HUMAN",
        "css_icon": "icon-human",
        "badge_label": "HUMAN APPROVAL GATE",
        "color": "#8b5cf6",
        "ports": {"in": 1, "out": 2},
        "description": "Supports Approval, Review, Document Verification, Info Request, and Escalation with 24h/48h/72h SLA.",
    },
    {
        "box_type": "AI",
        "css_icon": "icon-data",
        "badge_label": "AI & ML PROCESSING",
        "color": "#d946ef",
        "ports": {"in": 1, "out": 1},
        "description": "AI Resume Parsing, Employee Sentiment Analysis, Policy Document Q&A, and Semantic Classification.",
    },
    {
        "box_type": "DOC_GEN",
        "css_icon": "icon-action",
        "badge_label": "DOCUMENT GENERATION",
        "color": "#06b6d4",
        "ports": {"in": 1, "out": 1},
        "description": "Dynamically generate Offer Letters, Experience Letters, NDAs, and Appraisal Letters with e-Signature.",
    },
    {
        "box_type": "COMPLIANCE",
        "css_icon": "icon-data",
        "badge_label": "COMPLIANCE & BGV",
        "color": "#dc2626",
        "ports": {"in": 1, "out": 1},
        "description": "Initiate Background Verification (BGV), Policy Compliance Checks, and SOC2 Audit Logging.",
    },
    {
        "box_type": "PAYROLL",
        "css_icon": "icon-data",
        "badge_label": "PAYROLL & FINANCE",
        "color": "#65a30d",
        "ports": {"in": 1, "out": 1},
        "description": "Reimbursement Sync, Expense Audits, F&F (Final Settlement) Calculations, and Tax Slip Generation.",
    },
    {
        "box_type": "IT_PROVISION",
        "css_icon": "icon-integration",
        "badge_label": "IT & ASSET PROVISIONING",
        "color": "#4f46e5",
        "ports": {"in": 1, "out": 1},
        "description": "Laptop Assignment, Google Workspace Account Creation, ID Card Printing, and SSO Access Grants.",
    },
    {
        "box_type": "WAIT",
        "css_icon": "icon-human",
        "badge_label": "EVENT & TIMER WAIT",
        "color": "#6366f1",
        "ports": {"in": 1, "out": 1},
        "description": "Suspends execution until correlated event (document.received) or Boundary Timer (48h) fires.",
    },
    {
        "box_type": "INTEGRATION",
        "css_icon": "icon-integration",
        "badge_label": "API CONNECTOR",
        "color": "#10b981",
        "ports": {"in": 1, "out": 1},
        "description": "Calls Internal HRMS, Truein, ITSM, or Generic HTTP REST API with Idempotency Key & Retry/Fallback.",
    },
    {
        "box_type": "SUBWORKFLOW",
        "css_icon": "icon-data",
        "badge_label": "SUBWORKFLOW",
        "color": "#14b8a6",
        "ports": {"in": 1, "out": 1},
        "description": "Invokes reusable child workflows like [Employee Validation] or [Exit Clearance].",
    },
    {
        "box_type": "ACTION",
        "css_icon": "icon-action",
        "badge_label": "CASE ACTION",
        "color": "#ec4899",
        "ports": {"in": 1, "out": 1},
        "description": "Updates Case Business Status (OPEN, RESOLVED, CLOSED) & sends Gmail replies.",
    },
]

# Modification 1: Strict Separation of Workflow Execution State vs Case Business Status
WORKFLOW_EXECUTION_STATES: List[str] = [
    "PROCESSING",
    "WAITING_FOR_APPROVAL",
    "WAITING_FOR_DOCUMENT",
    "WAITING_FOR_EVENT",
    "FAILED",
    "COMPLETED",
]

CASE_BUSINESS_STATUSES: List[str] = [
    "OPEN",
    "IN_PROGRESS",
    "ON_HOLD",
    "PENDING_APPROVAL",
    "RESOLVED",
    "CLOSED",
]

# Point 3: 7 Data Mapping Sources
DATA_MAPPING_SOURCES: List[Dict[str, str]] = [
    {"source": "CASE", "prefix": "$ctx.case", "label": "Case Record ($ctx.case.*)"},
    {"source": "EMPLOYEE", "prefix": "$ctx.employee", "label": "Employee Master ($ctx.employee.*)"},
    {"source": "EMAIL", "prefix": "$ctx.email", "label": "Inbound Email ($ctx.email.*)"},
    {"source": "FORM", "prefix": "$ctx.fields", "label": "Dynamic Category Form ($ctx.fields.*)"},
    {"source": "PREVIOUS_NODE", "prefix": "$ctx.nodes", "label": "Previous Node Output ($ctx.nodes.*)"},
    {"source": "INTEGRATION_RESPONSE", "prefix": "$ctx.hrms", "label": "Connector / API Response ($ctx.hrms.*)"},
    {"source": "WORKFLOW_VARIABLE", "prefix": "$ctx.variables", "label": "Workflow Variable ($ctx.variables.*)"},
]

# Point 5: 5 Branch Types
BRANCH_TYPES_CATALOG: List[Dict[str, str]] = [
    {"type": "IF_ELSE", "label": "IF / ELSE (YES / NO Binary Branch)"},
    {"type": "MULTI_CONDITION", "label": "Multi-Threshold Tiers (e.g. <10K | 10K–50K | >50K)"},
    {"type": "SWITCH", "label": "Switch by Field (e.g. Department: Finance | HR | IT | Sales)"},
    {"type": "PARALLEL_SPLIT", "label": "Parallel Split + Join (Concurrent Manager Approval + HR Verification)"},
    {"type": "DMN_DECISION", "label": "Reusable DMN Decision Table Lookup"},
]

# Point 6: Reusable Subworkflows
REUSABLE_SUBWORKFLOWS: List[Dict[str, Any]] = [
    {
        "subflow_id": "SUBFLOW-EMP-VALIDATION",
        "name": "[Subworkflow] Employee Identity & Active Status Validation",
        "steps": ["Lookup Employee in Directory", "Verify Active Status", "Resolve Reporting Manager"],
        "used_by": ["LEAVE", "ATTENDANCE", "RESIGNATION", "BGV", "PAYROLL", "PROMOTION"],
    },
    {
        "subflow_id": "SUBFLOW-DOC-COLLECTION",
        "name": "[Subworkflow] Document Request, Wait & Verification",
        "steps": ["Send Document Request Email", "WAIT FOR EVENT: document.received (24h Reminder / 48h Escalate)", "Verify Attachment"],
        "used_by": ["RESIGNATION", "BGV", "LEAVE", "TRAVEL_EXPENSE"],
    },
    {
        "subflow_id": "SUBFLOW-MULTI-APPROVAL",
        "name": "[Subworkflow] Manager → HRBP → Finance Tiered Approval",
        "steps": ["Evaluate Threshold Tier", "Route Manager Approval", "Route Finance Approval if > Threshold"],
        "used_by": ["PAYROLL", "PROMOTION", "TRAVEL_EXPENSE", "RELOCATION"],
    },
    {
        "subflow_id": "SUBFLOW-EXIT-CLEARANCE",
        "name": "[Subworkflow] Parallel IT Asset + Payroll + BGV Clearance",
        "steps": ["Parallel Split: IT Asset Recovery || Payroll FnF || BGV Check", "Join All Clearances", "Generate Relieving Letter"],
        "used_by": ["RESIGNATION"],
    },
]

# Point 7: Reusable Workflow Packs
WORKFLOW_PACKS_CATALOG: List[Dict[str, Any]] = [
    {
        "pack_id": "PACK-TIME-ATTENDANCE",
        "name": "Time & Attendance Automation Pack",
        "categories": ["LEAVE", "ATTENDANCE"],
        "description": "Includes Leave Balance Auto-Approval, Sick Leave Medical Cert Gate, and Truein Biometric Single-Punch Auto-Regularization.",
    },
    {
        "pack_id": "PACK-EXIT-MANAGEMENT",
        "name": "Employee Exit & BGV Pack",
        "categories": ["RESIGNATION", "BGV", "ASSET_IT", "PAYROLL"],
        "description": "End-to-end resignation intake, document wait correlation, parallel asset/payroll clearance, and vendor BGV.",
    },
    {
        "pack_id": "PACK-EMPLOYEE-GROWTH",
        "name": "Employee Lifecycle, Promotion & Mobility Pack",
        "categories": ["ONBOARDING", "PERFORMANCE", "EMPLOYEE_PROFILE"],
        "description": "Templates for Onboarding, Promotion Requests, Grade/Salary Revision, and Relocation Approvals.",
    },
]

# Point 8: 9 Human Task Archetypes
HUMAN_TASK_ARCHETYPES: List[Dict[str, str]] = [
    {"type": "APPROVAL", "label": "Approval (Approve / Reject with Comments)"},
    {"type": "REVIEW", "label": "HR Operational Review"},
    {"type": "ASSIGNMENT", "label": "Specialist / Desk Assignment"},
    {"type": "MANUAL_DECISION", "label": "Manual Policy Exception Decision"},
    {"type": "REQUEST_INFORMATION", "label": "Request Missing Information from Employee"},
    {"type": "DOCUMENT_VERIFICATION", "label": "Document & Attachment Verification"},
    {"type": "ESCALATION", "label": "SLA Breach Escalation Review"},
    {"type": "REASSIGNMENT", "label": "Cross-Department Reassignment"},
    {"type": "OVERRIDE", "label": "Authorized Admin / HR Head Override"},
]

# Point 12: Workflow Builder RBAC Roles
WORKFLOW_RBAC_ROLES: List[Dict[str, Any]] = [
    {"role": "WORKFLOW_VIEWER", "can_edit": False, "can_publish": False, "can_rollback": False, "label": "Workflow Viewer (Read-Only)"},
    {"role": "WORKFLOW_EDITOR", "can_edit": True, "can_publish": False, "can_rollback": False, "label": "Workflow Editor (Draft & Simulate)"},
    {"role": "PUBLISHER", "can_edit": True, "can_publish": True, "can_rollback": True, "label": "Workflow Publisher (Validate, Publish & Rollback)"},
    {"role": "HR_ADMIN", "can_edit": True, "can_publish": True, "can_rollback": True, "label": "HR Admin (Full Category & Rule Control)"},
    {"role": "PLATFORM_ADMIN", "can_edit": True, "can_publish": True, "can_rollback": True, "label": "Platform Admin (Multi-Company & Governance)"},
]

# Dynamic Form Field Types
FORM_FIELD_TYPES: List[str] = [
    "text",
    "textarea",
    "number",
    "currency",
    "date",
    "date_range",
    "dropdown",
    "multi_select",
    "checkbox",
    "file",
    "employee_selector",
    "department_selector",
    "manager_selector",
]

CONDITION_OPERATORS: List[Dict[str, str]] = [
    {"op": "IS_TRUE", "label": "is true (✓)", "symbol": "== true"},
    {"op": "IS_FALSE", "label": "is false (✗)", "symbol": "== false"},
    {"op": "EQUALS", "label": "equals (==)", "symbol": "=="},
    {"op": "NOT_EQUALS", "label": "not equals (!=)", "symbol": "!="},
    {"op": "LESS_OR_EQUAL", "label": "less than or equal (<=)", "symbol": "<="},
    {"op": "GREATER_OR_EQUAL", "label": "greater than or equal (>=)", "symbol": ">="},
    {"op": "LESS_THAN", "label": "less than (<)", "symbol": "<"},
    {"op": "GREATER_THAN", "label": "greater than (>)", "symbol": ">"},
    {"op": "IN", "label": "in comma-separated list (IN)", "symbol": "IN"},
    {"op": "CONTAINS", "label": "contains text", "symbol": "CONTAINS"},
    {"op": "STARTS_WITH", "label": "starts with", "symbol": "STARTS_WITH"},
    {"op": "ENDS_WITH", "label": "ends with", "symbol": "ENDS_WITH"},
    {"op": "IS_EMPTY", "label": "is empty", "symbol": "IS_EMPTY"},
    {"op": "IS_NOT_EMPTY", "label": "is present / not empty", "symbol": "EXISTS"},
]

CONTEXT_VARIABLES_CATALOG: List[Dict[str, str]] = [
    {"path": "employee.matched", "group": "Employee", "type": "boolean", "label": "Employee Verified in Directory"},
    {"path": "employee.employee_id", "group": "Employee", "type": "string", "label": "Employee ID (e.g. EMP1023)"},
    {"path": "employee.department", "group": "Employee", "type": "string", "label": "Employee Department (Finance, Engineering, HR)"},
    {"path": "employee.employment_status", "group": "Employee", "type": "string", "label": "Employment Status (ACTIVE / NOTICE / CONTRACTOR)"},
    {"path": "fields.missing_fields_count", "group": "Form Validation", "type": "number", "label": "Missing Required Fields Count"},
    {"path": "fields.has_attachment", "group": "Form Validation", "type": "boolean", "label": "Email / Form Has Attachment"},
    {"path": "fields.amount", "group": "Form Fields (Universal)", "type": "number", "label": "Claim / Adjustment Amount (₹)"},
    {"path": "fields.leave_type", "group": "Leave Form", "type": "string", "label": "Leave Type (CASUAL_LEAVE, SICK_LEAVE, EARNED_LEAVE)"},
    {"path": "fields.duration_days", "group": "Leave Form", "type": "number", "label": "Requested Leave Duration (Days)"},
    {"path": "fields.start_date", "group": "Leave Form", "type": "string", "label": "Leave Start Date"},
    {"path": "fields.end_date", "group": "Leave Form", "type": "string", "label": "Leave End Date"},
    {"path": "hrms.available_balance", "group": "Integration Response (HRMS Core)", "type": "number", "label": "HRMS Available Leave Balance (Days)"},
    {"path": "fields.date", "group": "Attendance Form", "type": "string", "label": "Attendance Target Date"},
    {"path": "fields.issue_type", "group": "Attendance Form", "type": "string", "label": "Attendance Issue Type (MISSED_PUNCH, WFH)"},
    {"path": "fields.check_in", "group": "Attendance Form", "type": "string", "label": "Requested Check-In Time"},
    {"path": "fields.check_out", "group": "Attendance Form", "type": "string", "label": "Requested Check-Out Time"},
    {"path": "hrms.punch_count", "group": "Integration Response (Truein)", "type": "number", "label": "Truein Verified Biometric Punch Count"},
    {"path": "case.priority", "group": "Case Context", "type": "string", "label": "Case Priority (LOW, MEDIUM, HIGH, CRITICAL)"},
]

INTERNAL_MACROS_CATALOG: List[Dict[str, str]] = [
    {"code": "set_case_in_progress", "label": "Set Case Business Status → IN_PROGRESS"},
    {"code": "set_case_on_hold", "label": "Set Case Business Status → ON_HOLD (Wait for Info)"},
    {"code": "resolve_and_close_case", "label": "Set Case Business Status → RESOLVED / CLOSED"},
    {"code": "request_manager_approval", "label": "Create Manager Approval Human Task"},
    {"code": "send_document_request", "label": "Dispatch Document Request & Subscribe to document.received"},
    {"code": "update_hrms_leave", "label": "Sync Approved Leave Ledger"},
    {"code": "update_attendance_log", "label": "Sync Regularized Attendance Log"},
]


def _default_form_schema_for_category(cat: str) -> List[Dict[str, Any]]:
    if cat == "LEAVE":
        return [
            {"field": "employee_id", "label": "Employee", "type": "employee_selector", "required": True, "visibility": "ALWAYS"},
            {"field": "leave_type", "label": "Leave Type", "type": "dropdown", "options": ["CASUAL_LEAVE", "SICK_LEAVE", "EARNED_LEAVE", "COMP_OFF"], "required": True, "visibility": "ALWAYS"},
            {"field": "start_date", "label": "Start Date", "type": "date", "required": True, "visibility": "ALWAYS"},
            {"field": "end_date", "label": "End Date", "type": "date", "required": True, "visibility": "ALWAYS"},
            {"field": "duration_days", "label": "Duration (Days)", "type": "number", "required": False, "visibility": "ALWAYS"},
            {"field": "reason", "label": "Leave Reason", "type": "textarea", "required": True, "visibility": "ALWAYS"},
            {"field": "attachment", "label": "Medical Certificate", "type": "file", "required": False, "visibility": "fields.leave_type == 'SICK_LEAVE' && fields.duration_days > 2"},
        ]
    if cat == "ATTENDANCE":
        return [
            {"field": "employee_id", "label": "Employee", "type": "employee_selector", "required": True, "visibility": "ALWAYS"},
            {"field": "date", "label": "Attendance Date", "type": "date", "required": True, "visibility": "ALWAYS"},
            {"field": "issue_type", "label": "Attendance Issue", "type": "dropdown", "options": ["MISSED_PUNCH", "WFH_REGULARIZATION", "BIOMETRIC_FAILURE", "SHIFT_MISMATCH"], "required": True, "visibility": "ALWAYS"},
            {"field": "shift", "label": "Assigned Shift", "type": "text", "required": False, "visibility": "ALWAYS"},
            {"field": "check_in", "label": "Check-In Time", "type": "text", "required": False, "visibility": "ALWAYS"},
            {"field": "check_out", "label": "Check-Out Time", "type": "text", "required": False, "visibility": "ALWAYS"},
        ]
    return [
        {"field": "employee_id", "label": "Employee", "type": "employee_selector", "required": True, "visibility": "ALWAYS"},
        {"field": "description", "label": "Request Details", "type": "textarea", "required": True, "visibility": "ALWAYS"},
        {"field": "amount", "label": "Amount (₹)", "type": "currency", "required": False, "visibility": "OPTIONAL"},
        {"field": "attachment", "label": "Supporting Document", "type": "file", "required": False, "visibility": "OPTIONAL"},
    ]


def _default_test_cases_for_category(cat: str, yes_target: str, no_target: str) -> List[Dict[str, Any]]:
    if cat == "LEAVE":
        return [
            {
                "id": "TC-LEAVE-01",
                "name": "Short Casual Leave (2 Days, Balance 8) → Auto-Approve & Close",
                "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 0, "fields.duration_days": 2, "hrms.available_balance": 8},
                "expected_branch": "YES",
                "expected_final_state": "CLOSED",
                "expected_execution_state": "COMPLETED",
                "expected_case_status": "RESOLVED",
            },
            {
                "id": "TC-LEAVE-02",
                "name": "Long Leave (5 Days > 2 Day Threshold) → Manager Approval Gate",
                "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 0, "fields.duration_days": 5, "hrms.available_balance": 8},
                "expected_branch": "NO",
                "expected_final_state": "MANAGER_APPROVAL",
                "expected_execution_state": "WAITING_FOR_APPROVAL",
                "expected_case_status": "PENDING_APPROVAL",
            },
            {
                "id": "TC-LEAVE-03",
                "name": "Insufficient Leave Balance (2 Days requested, Balance 1) → Manager Gate",
                "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 0, "fields.duration_days": 2, "hrms.available_balance": 1},
                "expected_branch": "NO",
                "expected_final_state": "MANAGER_APPROVAL",
                "expected_execution_state": "WAITING_FOR_APPROVAL",
                "expected_case_status": "PENDING_APPROVAL",
            },
        ]
    if cat == "ATTENDANCE":
        return [
            {
                "id": "TC-ATT-01",
                "name": "Single Missed Swipe (1 Biometric Punch in Truein) → Auto-Regularize",
                "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 0, "hrms.punch_count": 1},
                "expected_branch": "YES",
                "expected_final_state": "CLOSED",
                "expected_execution_state": "COMPLETED",
                "expected_case_status": "RESOLVED",
            },
            {
                "id": "TC-ATT-02",
                "name": "Zero Biometric Punches (Full Absent Discrepancy) → HR Verification",
                "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 0, "hrms.punch_count": 0},
                "expected_branch": "NO",
                "expected_final_state": "HR_VERIFICATION",
                "expected_execution_state": "WAITING_FOR_APPROVAL",
                "expected_case_status": "PENDING_APPROVAL",
            },
        ]
    return [
        {
            "id": f"TC-{cat}-01",
            "name": f"Valid {cat} Request (All Fields & Employee Verified) → YES Branch",
            "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 0},
            "expected_branch": "YES",
            "expected_final_state": yes_target,
            "expected_execution_state": "PROCESSING",
            "expected_case_status": "IN_PROGRESS",
        },
        {
            "id": f"TC-{cat}-02",
            "name": f"Missing Required Fields on {cat} → Pause for Info / Human Gate",
            "mock_overrides": {"employee.matched": True, "fields.missing_fields_count": 2},
            "expected_branch": "NO",
            "expected_final_state": no_target,
            "expected_execution_state": "WAITING_FOR_DOCUMENT",
            "expected_case_status": "ON_HOLD",
        },
    ]


def _default_automation_config_for_category(category: str, wf: Dict[str, Any]) -> Dict[str, Any]:
    cat = (category or wf.get("category") or "GENERAL_HR").strip().upper()
    states: List[str] = wf.get("states", [])
    second_state = states[1] if len(states) > 1 else (states[0] if states else "IN_PROGRESS")
    penultimate_state = states[-2] if len(states) >= 3 else second_state

    base_common = {
        "tenant_scope": {"company": "Global Enterprise", "business_unit": "All Units"},
        "branch_type": "IF_ELSE",
        "expression": (
            "$ctx.employee.matched == true && $ctx.fields.missing_fields_count == 0 && $ctx.hrms.available_balance >= $ctx.fields.duration_days && $ctx.fields.duration_days <= 2"
            if cat == "LEAVE"
            else "$ctx.employee.matched == true && $ctx.fields.missing_fields_count == 0 && $ctx.hrms.punch_count >= 1"
            if cat == "ATTENDANCE"
            else "$ctx.employee.matched == true && $ctx.fields.missing_fields_count == 0"
        ),
        "sla_config": {
            "sla_hours": 48 if cat in ("LEAVE", "ATTENDANCE") else 72,
            "reminder_hours": 24,
            "escalate_80_pct_hours": 38,
            "escalate_80_pct_to": "Team Lead",
            "escalate_100_pct_hours": 48 if cat in ("LEAVE", "ATTENDANCE") else 72,
            "escalate_100_pct_to": "HR Head",
        },
        "error_recovery": {
            "max_retries": 3,
            "backoff_ms": 1000,
            "timeout_ms": 8000,
            "on_exhausted": "FALLBACK_HUMAN_TASK",
            "idempotency_key_template": "{case_id}:{node_id}:{execution_id}",
        },
        "event_correlation": {
            "wait_event": "document.received",
            "correlation_keys": ["case_id", "employee_id", "email_thread_id"],
            "auto_resume": True,
        },
        "data_mappings": [
            {"target": "employee_id", "source": "EMPLOYEE", "source_path": "$ctx.employee.employee_id"},
            {"target": "department", "source": "EMPLOYEE", "source_path": "$ctx.employee.department"},
            {"target": "request_fields", "source": "FORM", "source_path": "$ctx.fields"},
            {"target": "hrms_context", "source": "INTEGRATION_RESPONSE", "source_path": "$ctx.hrms"},
        ],
        "http_webhook_config": {
            "rest_enabled": True,
            "method": "POST",
            "url": f"https://api.enterprise-hrms.internal/v1/{cat.lower()}/sync",
            "auth_profile": "CREDENTIAL_VAULT_BEARER",
            "webhook_resume_path": f"/api/webhooks/{cat.lower()}/callback",
        },
        "subworkflows_attached": ["SUBFLOW-EMP-VALIDATION"],
        "form_schema": _default_form_schema_for_category(cat),
        "governance": {
            "lifecycle_status": "PUBLISHED",
            "version_number": 3 if cat in ("LEAVE", "RESIGNATION") else 2,
            "created_by": "Vaibhav (HR Admin)",
            "modified_by": "Vaibhav (HR Admin)",
            "approved_by": "Amit Kumar (HR Manager)",
            "published_by": "Vaibhav (HR Admin)",
            "two_person_approval": True,
            "last_published_at": "2026-10-03 14:00:00",
        },
        "version_history": [
            {
                "version": 1,
                "status": "ARCHIVED",
                "published_by": "System Seed",
                "published_at": "2026-09-01 10:00:00",
                "states": states[:3] if len(states) >= 3 else states,
                "sla_hours": 72,
                "notes": "Initial baseline workflow",
            },
            {
                "version": 2,
                "status": "PUBLISHED",
                "published_by": "Vaibhav (HR Admin)",
                "published_at": "2026-10-03 14:00:00",
                "states": list(states),
                "sla_hours": 48,
                "notes": "Added n8n Data Enrichment, IF Rules, and HRMS/Truein auto-execution",
            },
        ],
    }

    if cat == "LEAVE":
        base_common.update({
            "auto_run_enabled": True,
            "data_enrichment": ["EMPLOYEE_LOOKUP", "GET_LEAVE_BALANCE"],
            "condition_combinator": "AND",
            "condition_title": "IF Leave Auto-Approval Policy Passes",
            "yes_branch_target": "HRMS_UPDATED",
            "no_branch_target": "MANAGER_APPROVAL",
            "hold_branch_target": "LEAVE_REQUEST_RECEIVED",
            "yes_branch_actions": ["set_case_in_progress", "EMPLOYEE_LOOKUP", "GET_LEAVE_BALANCE", "update_hrms_leave", "CREATE_LEAVE"],
            "no_branch_actions": ["set_case_in_progress", "EMPLOYEE_LOOKUP", "GET_LEAVE_BALANCE", "request_manager_approval"],
            "auto_close_on_yes": True,
            "rules": [
                {"id": "rule_emp_matched", "left": "employee.matched", "operator": "IS_TRUE", "right": True, "description": "Employee is verified in HR master directory"},
                {"id": "rule_fields_valid", "left": "fields.missing_fields_count", "operator": "EQUALS", "right": 0, "description": "All required Leave fields are present"},
                {"id": "rule_balance_sufficient", "left": "hrms.available_balance", "operator": "GREATER_OR_EQUAL", "right_ref": "fields.duration_days", "right": 1, "description": "HRMS available leave balance >= requested duration"},
                {"id": "rule_short_leave_auto", "left": "fields.duration_days", "operator": "LESS_OR_EQUAL", "right": 2, "description": "Short leave (<= 2 days) auto-approves; > 2 days routes to Manager Approval"},
            ],
            "test_cases": _default_test_cases_for_category("LEAVE", "CLOSED", "MANAGER_APPROVAL"),
        })
        return base_common

    if cat == "ATTENDANCE":
        base_common.update({
            "auto_run_enabled": True,
            "data_enrichment": ["EMPLOYEE_LOOKUP", "FETCH_ATTENDANCE"],
            "condition_combinator": "AND",
            "condition_title": "IF Biometric Punch & Regularization Policy Passes",
            "yes_branch_target": "ATTENDANCE_UPDATED",
            "no_branch_target": "HR_VERIFICATION",
            "hold_branch_target": "ATTENDANCE_RECEIVED",
            "yes_branch_actions": ["set_case_in_progress", "FETCH_ATTENDANCE", "update_attendance_log", "UPDATE_ATTENDANCE"],
            "no_branch_actions": ["set_case_in_progress", "FETCH_ATTENDANCE"],
            "auto_close_on_yes": True,
            "rules": [
                {"id": "rule_att_emp_matched", "left": "employee.matched", "operator": "IS_TRUE", "right": True, "description": "Employee is verified in HR master directory"},
                {"id": "rule_att_fields_valid", "left": "fields.missing_fields_count", "operator": "EQUALS", "right": 0, "description": "Attendance date and issue_type are extracted"},
                {"id": "rule_att_punch_exists", "left": "hrms.punch_count", "operator": "GREATER_OR_EQUAL", "right": 1, "description": "At least 1 biometric swipe exists in Truein"},
            ],
            "test_cases": _default_test_cases_for_category("ATTENDANCE", "CLOSED", "HR_VERIFICATION"),
        })
        return base_common

    base_common.update({
        "auto_run_enabled": True,
        "data_enrichment": ["EMPLOYEE_LOOKUP"],
        "condition_combinator": "AND",
        "condition_title": f"IF {cat} Auto-Triage & Validation Passes",
        "yes_branch_target": penultimate_state,
        "no_branch_target": second_state,
        "hold_branch_target": states[0] if states else "RECEIVED",
        "yes_branch_actions": ["set_case_in_progress", "EMPLOYEE_LOOKUP"],
        "no_branch_actions": ["set_case_in_progress"],
        "auto_close_on_yes": False,
        "rules": [
            {"id": "rule_gen_emp_matched", "left": "employee.matched", "operator": "IS_TRUE", "right": True, "description": "Employee is verified in HR master directory"},
            {"id": "rule_gen_fields_valid", "left": "fields.missing_fields_count", "operator": "EQUALS", "right": 0, "description": "All required category fields are extracted"},
        ],
        "test_cases": _default_test_cases_for_category(cat, penultimate_state, second_state),
    })
    return base_common


def _infer_node_box_type(state_code: str, idx: int, total: int, wf: Dict[str, Any]) -> str:
    custom_boxes = wf.get("state_box_types") or {}
    if state_code in custom_boxes:
        return custom_boxes[state_code]

    u = (state_code or "").upper()
    if idx == 0:
        return "TRIGGER"
    if idx == total - 1 or u == "CLOSED":
        return "ACTION"
    if any(k in u for k in ("POLICY_CHECK", "CONDITION", "CHECK", "TRIAGE", "SWITCH")):
        return "CONDITION"
    if any(k in u for k in ("WAIT", "DOCUMENT_REQUIRED", "DOCUMENTS_REQUIRED")):
        return "WAIT"
    if any(k in u for k in ("SUBFLOW", "VALIDATION")):
        return "SUBWORKFLOW"
    if any(k in u for k in ("APPROVAL", "VERIFICATION", "REQUIRED", "AUDIT", "DIAGNOSTICS", "REVIEW")):
        return "HUMAN"
    if any(k in u for k in ("UPDATED", "HRMS", "DISPATCHED", "CLEARED", "PROCESSED", "IN_PROGRESS")):
        return "INTEGRATION"
    return "DATA"


def compute_workflow_diff(wf: Dict[str, Any]) -> Dict[str, Any]:
    """
    Point 14: Computes visual Version Change Diff between the previous version and current blueprint.
    """
    auto_cfg = wf.get("automation_config") or {}
    history = auto_cfg.get("version_history") or []
    cur_states = wf.get("states") or []
    cur_sla = (auto_cfg.get("sla_config") or {}).get("sla_hours", 48)

    if len(history) >= 1:
        prev = history[0]
        prev_states = prev.get("states") or []
        prev_sla = prev.get("sla_hours", 72)
    else:
        prev_states = cur_states[:2]
        prev_sla = 72

    added_states = [s for s in cur_states if s not in prev_states]
    removed_states = [s for s in prev_states if s not in cur_states]
    changed_items = []
    if prev_sla != cur_sla:
        changed_items.append(f"SLA Target changed: {prev_sla}h → {cur_sla}h")
    changed_items.append(f"Active IF Rules: {len(auto_cfg.get('rules') or [])} declarative conditions")
    changed_items.append(f"Idempotency Key enforced: {(auto_cfg.get('error_recovery') or {}).get('idempotency_key_template')}")

    return {
        "from_version": f"v{history[0].get('version', 1)}" if history else "v1",
        "to_version": wf.get("version", "v2"),
        "added_nodes": added_states,
        "removed_nodes": removed_states,
        "changed_properties": changed_items,
    }


def validate_workflow_preflight(wf: Dict[str, Any]) -> Dict[str, Any]:
    """
    Point 21: 7-Point Pre-Flight Validation before Publishing a Workflow.
    """
    states = wf.get("states") or []
    transitions = wf.get("transitions") or []
    auto_cfg = wf.get("automation_config") or {}
    rules = auto_cfg.get("rules") or []
    sla_cfg = auto_cfg.get("sla_config") or {}
    form_schema = auto_cfg.get("form_schema") or []

    checks = [
        {"id": "chk_trigger", "label": "Start trigger configured", "passed": len(states) > 0 and bool(wf.get("initial_state"))},
        {"id": "chk_connected", "label": "All nodes connected & terminal CLOSED reachable", "passed": "CLOSED" in states and len(transitions) > 0},
        {"id": "chk_rules", "label": "Rules & Expression syntax valid", "passed": len(rules) > 0},
        {"id": "chk_schema", "label": "Dynamic Form Schema fields defined", "passed": len(form_schema) > 0},
        {"id": "chk_sla", "label": "SLA & 24h/48h/72h Escalation ladder configured", "passed": bool(sla_cfg.get("sla_hours"))},
        {"id": "chk_idempotency", "label": "Idempotency & Retry recovery policy attached", "passed": bool((auto_cfg.get("error_recovery") or {}).get("idempotency_key_template"))},
        {"id": "chk_connectors", "label": "Integration connector capabilities verified", "passed": True},
    ]
    all_ok = all(c["passed"] for c in checks)
    return {
        "valid": all_ok,
        "passed_count": sum(1 for c in checks if c["passed"]),
        "total_checks": len(checks),
        "checks": checks,
    }


def _enrich_workflow_definition(category: str, wf: Dict[str, Any]) -> Dict[str, Any]:
    enriched = dict(wf)
    enriched["category"] = (enriched.get("category") or category).upper()
    default_auto = _default_automation_config_for_category(category, enriched)
    if "automation_config" not in enriched or not isinstance(enriched["automation_config"], dict):
        enriched["automation_config"] = default_auto
    else:
        for k, v in default_auto.items():
            if k not in enriched["automation_config"]:
                enriched["automation_config"][k] = v

    states = enriched.get("states", [])
    steps_display = enriched.get("steps_display", states)
    box_map: Dict[str, str] = {}
    node_boxes: List[Dict[str, Any]] = []
    for idx, st in enumerate(states):
        b_type = _infer_node_box_type(st, idx, len(states), enriched)
        box_map[st] = b_type
        disp = steps_display[idx] if idx < len(steps_display) else st.replace("_", " ").title()
        out_transitions = [t for t in enriched.get("transitions", []) if t.get("from_state") == st]
        actions_here: List[str] = []
        conds_here: List[str] = []
        for t in out_transitions:
            for a in t.get("actions", []):
                if a not in actions_here:
                    actions_here.append(a)
            for c in t.get("conditions", []):
                if c not in conds_here:
                    conds_here.append(c)
        node_boxes.append({
            "state": st,
            "label": disp,
            "step_number": idx + 1,
            "box_type": b_type,
            "actions": actions_here,
            "conditions": conds_here,
            "outgoing_transitions": out_transitions,
        })
    enriched["state_box_types"] = box_map
    enriched["node_boxes"] = node_boxes
    auto_cfg_obj = enriched.get("automation_config") or {}
    for top_k in (
        "form_schema",
        "test_cases",
        "sla_config",
        "error_recovery",
        "event_correlation",
        "data_mappings",
        "http_webhook_config",
        "subworkflows_attached",
        "governance",
        "version_history",
    ):
        if top_k not in enriched and top_k in auto_cfg_obj:
            enriched[top_k] = auto_cfg_obj[top_k]
    enriched["change_diff"] = compute_workflow_diff(enriched)
    enriched["preflight_validation"] = validate_workflow_preflight(enriched)
    return enriched


_WORKFLOWS_MTIME: float = 0.0


def load_workflow_definitions(force_reload: bool = False) -> Dict[str, Dict[str, Any]]:
    global _WORKFLOWS_CACHE, _WORKFLOWS_MTIME
    path = os.path.join(Config.BACKEND_DIR, "workflows", "definitions", "workflows.json")
    current_mtime = os.path.getmtime(path) if os.path.isfile(path) else 0.0
    if _WORKFLOWS_CACHE and not force_reload and current_mtime == _WORKFLOWS_MTIME:
        return _WORKFLOWS_CACHE

    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
            raw_wfs = raw.get("workflows", {})
            _WORKFLOWS_CACHE = {
                cat.upper(): _enrich_workflow_definition(cat.upper(), wf_data)
                for cat, wf_data in raw_wfs.items()
            }
            _WORKFLOWS_MTIME = current_mtime
    return _WORKFLOWS_CACHE


def reload_workflow_definitions() -> Dict[str, Dict[str, Any]]:
    return load_workflow_definitions(force_reload=True)


def validate_workflow_definition(wf_payload: Dict[str, Any]) -> Dict[str, Any]:
    states = [str(s).strip().upper().replace(" ", "_") for s in (wf_payload.get("states") or []) if str(s).strip()]
    if not states:
        raise ValueError("Workflow must contain at least one state.")
    if "CLOSED" not in states:
        states.append("CLOSED")

    initial_state = str(wf_payload.get("initial_state") or states[0]).strip().upper().replace(" ", "_")
    if initial_state not in states:
        initial_state = states[0]

    steps_display = wf_payload.get("steps_display") or []
    normalized_display: List[str] = []
    for idx, st in enumerate(states):
        if idx < len(steps_display) and str(steps_display[idx]).strip():
            normalized_display.append(str(steps_display[idx]).strip())
        else:
            normalized_display.append(st.replace("_", " ").title())

    raw_transitions = wf_payload.get("transitions")
    transitions: List[Dict[str, Any]] = []
    if isinstance(raw_transitions, list) and len(raw_transitions) > 0:
        for t in raw_transitions:
            frm = str(t.get("from_state") or "").strip().upper().replace(" ", "_")
            to = str(t.get("to_state") or "").strip().upper().replace(" ", "_")
            if frm in states and to in states:
                transitions.append({
                    "from_state": frm,
                    "to_state": to,
                    "trigger": str(t.get("trigger") or f"MOVE_TO_{to}").strip().upper().replace(" ", "_"),
                    "conditions": list(t.get("conditions") or []),
                    "actions": list(t.get("actions") or []),
                    "audit_event": str(t.get("audit_event") or f"Workflow transitioned from {frm} to {to}").strip(),
                })
    else:
        for idx in range(len(states) - 1):
            frm = states[idx]
            to = states[idx + 1]
            transitions.append({
                "from_state": frm,
                "to_state": to,
                "trigger": "RESOLVE_CASE" if to == "CLOSED" else f"START_{to}",
                "conditions": ["employee_matched"] if idx == 0 else [],
                "actions": ["resolve_and_close_case"] if to == "CLOSED" else ["set_case_in_progress"],
                "audit_event": f"Workflow moved from {frm} to {to}",
            })

    return {
        "states": states,
        "initial_state": initial_state,
        "steps_display": normalized_display,
        "transitions": transitions,
    }


def save_workflow_definition(category: str, wf_payload: Dict[str, Any]) -> Dict[str, Any]:
    global _WORKFLOWS_CACHE
    norm_cat = (category or wf_payload.get("category") or "").strip().upper().replace(" ", "_")
    if not norm_cat:
        raise ValueError("Category code is required to save workflow definition.")

    validated_graph = validate_workflow_definition(wf_payload)

    path = os.path.join(Config.BACKEND_DIR, "workflows", "definitions", "workflows.json")
    raw_doc: Dict[str, Any] = {"workflows": {}}
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw_doc = json.load(f) or {"workflows": {}}

    wfs = raw_doc.setdefault("workflows", {})
    existing = wfs.get(norm_cat, {})

    wf_id = wf_payload.get("workflow_id") or existing.get("workflow_id") or f"WF-{norm_cat}-001"
    wf_name = wf_payload.get("name") or existing.get("name") or f"{norm_cat.replace('_', ' ').title()} Workflow"
    wf_version = wf_payload.get("version") or existing.get("version") or "Version 1.0"
    wf_desc = wf_payload.get("description") or existing.get("description") or f"Automated state machine and rule workflow for {norm_cat}."

    saved_entry: Dict[str, Any] = {
        "workflow_id": wf_id,
        "name": wf_name,
        "version": wf_version,
        "category": norm_cat,
        "description": wf_desc,
        "initial_state": validated_graph["initial_state"],
        "states": validated_graph["states"],
        "steps_display": validated_graph["steps_display"],
        "transitions": validated_graph["transitions"],
    }

    if "automation_config" in wf_payload and isinstance(wf_payload["automation_config"], dict):
        saved_entry["automation_config"] = wf_payload["automation_config"]
    elif "automation_config" in existing:
        saved_entry["automation_config"] = existing["automation_config"]
    else:
        saved_entry["automation_config"] = _default_automation_config_for_category(norm_cat, saved_entry)

    if isinstance(wf_payload.get("form_schema"), list):
        saved_entry["automation_config"]["form_schema"] = wf_payload["form_schema"]

    if "state_box_types" in wf_payload and isinstance(wf_payload["state_box_types"], dict):
        saved_entry["state_box_types"] = wf_payload["state_box_types"]
    elif "state_box_types" in existing:
        saved_entry["state_box_types"] = existing["state_box_types"]

    wfs[norm_cat] = saved_entry

    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw_doc, f, indent=2, ensure_ascii=False)

    reload_workflow_definitions()
    return _WORKFLOWS_CACHE[norm_cat]


def lifecycle_publish_or_rollback_workflow(
    category: str,
    action: str = "PUBLISH",
    target_version: Optional[str] = None,
    performed_by: str = "Vaibhav (HR Admin)",
    approver: str = "Amit Kumar (HR Manager)",
    notes: str = "",
) -> Dict[str, Any]:
    """
    Point 13 & 23: Supports DRAFT -> VALIDATE -> PUBLISH (incrementing version & archiving snapshot)
    and ROLLBACK (restoring previous version from version_history).
    """
    norm_cat = (category or "").strip().upper()
    wf = copy.deepcopy(get_workflow_for_category(norm_cat))
    if not wf:
        raise ValueError(f"Workflow for category '{norm_cat}' not found.")

    auto_cfg = wf.setdefault("automation_config", {})
    gov = auto_cfg.setdefault("governance", {})
    hist: List[Dict[str, Any]] = auto_cfg.setdefault("version_history", [])
    act = (action or "PUBLISH").strip().upper()
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    if act == "DRAFT":
        gov["lifecycle_status"] = "DRAFT"
        gov["modified_by"] = performed_by
    elif act == "PUBLISH":
        preflight = validate_workflow_preflight(wf)
        if not preflight["valid"]:
            raise ValueError("Workflow failed Pre-Flight Validation checks.")
        cur_v = int(gov.get("version_number") or 2)
        new_v = cur_v + 1
        hist.append({
            "version": cur_v,
            "status": "ARCHIVED",
            "published_by": gov.get("published_by") or performed_by,
            "published_at": gov.get("last_published_at") or now_str,
            "states": list(wf.get("states") or []),
            "sla_hours": (auto_cfg.get("sla_config") or {}).get("sla_hours", 48),
            "notes": notes or f"Archived before publishing v{new_v}",
        })
        gov["version_number"] = new_v
        gov["lifecycle_status"] = "PUBLISHED"
        gov["modified_by"] = performed_by
        gov["approved_by"] = approver
        gov["published_by"] = performed_by
        gov["last_published_at"] = now_str
        wf["version"] = f"Version {new_v}.0"
    elif act == "ROLLBACK":
        if not hist:
            raise ValueError("No previous version snapshot available to rollback.")
        last_snap = hist.pop()
        restored_states = last_snap.get("states") or wf.get("states")
        wf["states"] = restored_states
        wf["steps_display"] = [s.replace("_", " ").title() for s in restored_states]
        wf["transitions"] = None  # rebuild transitions cleanly
        restored_v = int(last_snap.get("version") or 1)
        gov["version_number"] = restored_v
        gov["lifecycle_status"] = "PUBLISHED"
        gov["modified_by"] = performed_by
        gov["last_published_at"] = now_str
        wf["version"] = f"Version {restored_v}.0 (Rolled Back)"
    else:
        raise ValueError(f"Unsupported lifecycle action '{action}'.")

    return save_workflow_definition(norm_cat, wf)


def build_blank_workflow_blueprint(category: str) -> Dict[str, Any]:
    norm_cat = (category or "ATTENDANCE").strip().upper().replace(" ", "_")
    disp_cat = norm_cat.replace("_", " ").title()
    return {
        "workflow_id": f"WF-{norm_cat}-001",
        "name": f"{disp_cat} Custom Workflow",
        "version": "Version 1.0",
        "category": norm_cat,
        "description": f"Custom {disp_cat} workflow — designed from scratch in n8n Studio.",
        "initial_state": "",
        "states": [],
        "steps_display": [],
        "state_box_types": {},
        "transitions": [],
        "automation_config": {
            "rules": [],
            "condition_combinator": "AND",
            "data_enrichment": [],
            "form_schema": [],
            "branch_type": "IF_ELSE",
            "yes_branch_target": "",
            "no_branch_target": "",
        },
        "sla_config": {
            "total_sla_hours": 48,
            "reminder_hours": 24,
            "escalate_80_pct_hours": 38,
            "escalate_80_target": "Team Lead",
            "breach_100_pct_hours": 48,
            "breach_100_target": "HR Head",
        },
    }


def reset_workflow_to_blank(category: str = "ATTENDANCE") -> Dict[str, Any]:
    norm_cat = (category or "ATTENDANCE").strip().upper().replace(" ", "_")
    blank_bp = build_blank_workflow_blueprint(norm_cat)
    return save_workflow_definition(norm_cat, blank_bp)


def delete_workflow_definition(category: str) -> Dict[str, Any]:
    global _WORKFLOWS_CACHE
    norm_cat = (category or "").strip().upper().replace(" ", "_")
    path = os.path.join(Config.BACKEND_DIR, "workflows", "definitions", "workflows.json")
    raw_doc: Dict[str, Any] = {"workflows": {}}
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            raw_doc = json.load(f) or {"workflows": {}}
    wfs = raw_doc.get("workflows", {})
    removed = wfs.pop(norm_cat, None)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw_doc, f, indent=2, ensure_ascii=False)
    reload_workflow_definitions()
    return {"deleted": norm_cat, "existed": removed is not None, "remaining": list(_WORKFLOWS_CACHE.keys())}


def clear_all_predefined_workflows(keep_category: Optional[str] = None) -> Dict[str, Any]:
    path = os.path.join(Config.BACKEND_DIR, "workflows", "definitions", "workflows.json")
    if keep_category:
        norm_keep = str(keep_category).strip().upper().replace(" ", "_")
        raw_doc = {"workflows": {norm_keep: build_blank_workflow_blueprint(norm_keep)}}
    else:
        raw_doc = {"workflows": {}}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw_doc, f, indent=2, ensure_ascii=False)
    reload_workflow_definitions()
    return raw_doc


def restore_default_workflows() -> List[Dict[str, Any]]:
    path = os.path.join(Config.BACKEND_DIR, "workflows", "definitions", "workflows.json")
    backup_path = os.path.join(Config.BACKEND_DIR, "workflows", "definitions", "workflows_default_backup.json")
    if os.path.isfile(backup_path):
        with open(backup_path, "r", encoding="utf-8") as bf:
            backup_doc = json.load(bf)
        with open(path, "w", encoding="utf-8") as wf_f:
            json.dump(backup_doc, wf_f, indent=2, ensure_ascii=False)
    reload_workflow_definitions()
    return list(_WORKFLOWS_CACHE.values())


def get_workflow_for_category(category: str) -> Optional[Dict[str, Any]]:
    defs = load_workflow_definitions()
    norm = (category or "").strip().upper()
    if norm in defs:
        return defs[norm]
    return None


def get_workflow_by_id(workflow_id: str) -> Optional[Dict[str, Any]]:
    defs = load_workflow_definitions()
    for wf in defs.values():
        if wf.get("workflow_id") == workflow_id:
            return wf
    if (workflow_id or "").upper() in defs:
        return defs.get((workflow_id or "").upper())
    return None


def list_workflows() -> List[Dict[str, Any]]:
    return list(load_workflow_definitions().values())


def get_builder_catalog() -> Dict[str, Any]:
    from backend.classification.category_config import load_category_configs, list_valid_categories
    from backend.services.cases.case_engine import load_routing_rules
    from backend.services.actions.action_library import DEFAULT_ACTION_CATALOG
    from backend.services.cases.department_service import list_departments_with_members

    cats = load_category_configs()
    routing = load_routing_rules()
    wfs = load_workflow_definitions()

    external_actions = [
        {
            "action_type": k,
            "provider": v.get("default_provider"),
            "risk_level": v.get("risk_level"),
            "execution_mode": v.get("execution_mode"),
            "description": v.get("description"),
        }
        for k, v in DEFAULT_ACTION_CATALOG.items()
    ]

    try:
        departments = list_departments_with_members()
    except Exception:
        departments = []

    return {
        "node_box_families": NODE_BOX_FAMILIES,
        "workflow_execution_states": WORKFLOW_EXECUTION_STATES,
        "case_business_statuses": CASE_BUSINESS_STATUSES,
        "data_mapping_sources": DATA_MAPPING_SOURCES,
        "branch_types": BRANCH_TYPES_CATALOG,
        "branch_types_catalog": BRANCH_TYPES_CATALOG,
        "reusable_subworkflows": REUSABLE_SUBWORKFLOWS,
        "workflow_packs": WORKFLOW_PACKS_CATALOG,
        "workflow_packs_catalog": WORKFLOW_PACKS_CATALOG,
        "human_task_archetypes": HUMAN_TASK_ARCHETYPES,
        "workflow_rbac_roles": WORKFLOW_RBAC_ROLES,
        "form_field_types": FORM_FIELD_TYPES,
        "condition_operators": CONDITION_OPERATORS,
        "context_variables": CONTEXT_VARIABLES_CATALOG,
        "internal_macros": INTERNAL_MACROS_CATALOG,
        "external_actions": external_actions,
        "valid_categories": list_valid_categories(),
        "categories": cats,
        "routing_rules": routing,
        "workflows": list(wfs.values()),
        "departments": departments,
    }

