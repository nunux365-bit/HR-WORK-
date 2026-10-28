import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from backend.database.connection import get_connection

def ensure_playbooks_table_seeded() -> None:
    """Creates the category_playbooks table and ensures all columns exist."""
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS category_playbooks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                icon TEXT DEFAULT '📋',
                badge_color TEXT DEFAULT '#3b82f6',
                default_tasks TEXT NOT NULL,
                inquiry_presets TEXT NOT NULL,
                diagnostic_keywords TEXT,
                proof_config TEXT NOT NULL,
                sla_config TEXT,
                is_custom INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: ensure sla_config and intake_rules columns exist
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(category_playbooks)").fetchall()}
        if "sla_config" not in cols:
            conn.execute("ALTER TABLE category_playbooks ADD COLUMN sla_config TEXT")
        if "intake_rules" not in cols:
            conn.execute("ALTER TABLE category_playbooks ADD COLUMN intake_rules TEXT")
        conn.commit()

        # Check if table has data
        row = conn.execute("SELECT COUNT(*) AS cnt FROM category_playbooks").fetchone()
        if row and row["cnt"] == 0:
            seed_default_playbooks(conn)
        else:
            # Upgrade existing un-customized playbooks to include INTAKE_GATE task if missing
            refresh_uncustomized_defaults(conn)
    finally:
        conn.close()


def refresh_uncustomized_defaults(conn) -> None:
    try:
        rows = conn.execute("SELECT category, intake_rules FROM category_playbooks WHERE is_custom = 0").fetchall()
        for r in rows:
            cat = r["category"]
            cur_rules = json.loads(r["intake_rules"] or "{}") if "intake_rules" in r.keys() and r["intake_rules"] else {}
            if not cur_rules:
                clean_rules = {"enabled": False, "rule_name": "", "required_items": [], "missing_action": {"preset_id": None, "pause_sla": True, "warning_message": ""}}
                conn.execute("UPDATE category_playbooks SET intake_rules = ? WHERE category = ?", (json.dumps(clean_rules), cat))
        conn.commit()
    except Exception:
        pass
        pass


def seed_default_playbooks(conn) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    defaults = [
        {
            "category": "ATTENDANCE",
            "display_name": "Attendance & Shift Regularization",
            "icon": "🕒",
            "badge_color": "#10b981",
            "default_tasks": [
                {
                    "title": "Verify biometric turnstile in/out swipe logs",
                    "task_type": "DIAGNOSTIC",
                    "is_mandatory": True,
                    "guidance": "Cross-reference turnstile swipe timestamps against designated shift roster hours."
                },
                {
                    "title": "Audit active VPN & SSO login sessions duration",
                    "task_type": "DIAGNOSTIC",
                    "is_mandatory": False,
                    "guidance": "Check VPN telemetry if physical biometric punch is missing due to remote work."
                },
                {
                    "title": "Review manager email approval for regularization",
                    "task_type": "APPROVAL",
                    "is_mandatory": True,
                    "guidance": "Ensure line manager written confirmation or ticket sign-off is on record."
                },
                {
                    "title": "Calculate adjusted work hours & overtime discrepancy",
                    "task_type": "POLICY",
                    "is_mandatory": True,
                    "guidance": "Confirm minimum 8.5 work hours completed to avoid unapproved loss of pay."
                },
                {
                    "title": "Update monthly attendance registry & payroll ledger",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Regularize shift status from LOP to PRESENT in company attendance master."
                }
            ],
            "inquiry_presets": [
                {
                    "id": "punch_time",
                    "label": "🕒 Missing Swipe / Timings",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}} for Attendance Regularization:\nPlease provide your exact in-time, out-time, and reason for the missing turnstile swipe.\n\nWarm regards,\nAttendance Operations Desk"
                },
                {
                    "id": "wf_proof",
                    "label": "📸 Regularization Form / Proof",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease attach your approved regularization slip or manager email confirmation.\n\nWarm regards,\nAttendance Operations Desk"
                },
                {
                    "id": "mgr_signoff",
                    "label": "👔 Line Manager Confirmation",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease loop in or attach sign-off from your reporting manager confirming your presence on the date(s) in question.\n\nWarm regards,\nAttendance Operations Desk"
                }
            ],
            "diagnostic_keywords": ["ATTEND", "BIOMETRIC", "SWIPE", "PUNCH", "SHIFT", "TIMESHEET", "VPN"],
            "proof_config": {
                "refLabel": "Biometric / HRMS Regularization ID",
                "refPlaceholder": "e.g. ATT-REG-202610-9901",
                "metricLabel": "Regularized Hours / Days",
                "metricPlaceholder": "e.g. 1.0 Day, 8.5 Hours",
                "defaultVerdict": "ATTENDANCE_REGULARIZED",
                "presets": [
                    {
                        "id": "ATT_REG",
                        "label": "🕒 Regularized (Present)",
                        "verdict": "ATTENDANCE_REGULARIZED",
                        "refPrefix": "ATT-REG",
                        "metric": "1.0 Day Regularized",
                        "notes": "Biometric logs and VPN telemetry verified. Timesheet adjusted with zero leave/salary loss."
                    },
                    {
                        "id": "ATT_HALF",
                        "label": "🌗 Half Day Approved",
                        "verdict": "ATTENDANCE_REGULARIZED",
                        "refPrefix": "ATT-HALF",
                        "metric": "0.5 Day Regularized",
                        "notes": "First-half swipe verified. Second-half marked as approved permission."
                    },
                    {
                        "id": "ATT_DECLINED",
                        "label": "❌ Declined (Absent)",
                        "verdict": "REQUEST_DECLINED",
                        "refPrefix": "VOID",
                        "metric": "0.0 Days",
                        "notes": "Zero turnstile records or VPN activity found. Manager approval denied."
                    }
                ]
            },
            "sla_config": {
                "sla_hours": 24,
                "auto_pause_on_inquiry": True,
                "auto_escalate_risk": True,
                "approval_mode": "MANAGER_REQUIRED"
            },
            "intake_rules": {
                "enabled": False,
                "rule_name": "",
                "required_items": [],
                "missing_action": {
                    "preset_id": None,
                    "pause_sla": True,
                    "warning_message": ""
                }
            }
        },
        {
            "category": "PAYROLL",
            "display_name": "Payroll & Salary Operations",
            "icon": "🏦",
            "badge_color": "#f59e0b",
            "default_tasks": [
                {
                    "title": "Review payroll inquiry details against employee master records",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Confirm employee active employment status, cost center, and compensation tier."
                },
                {
                    "title": "Audit salary ledger, timesheet deductions, and allowances",
                    "task_type": "DIAGNOSTIC",
                    "is_mandatory": True,
                    "guidance": "Cross-reference HRMS payroll run records against attendance logs and tax declarations."
                },
                {
                    "title": "Inspect supporting proof or authorization documentation",
                    "task_type": "DOC_REQ",
                    "is_mandatory": False,
                    "guidance": "Verify all mandatory justification documents and proofs are attached."
                },
                {
                    "title": "Obtain department head or finance approval sign-off",
                    "task_type": "APPROVAL",
                    "is_mandatory": True,
                    "guidance": "Manager or finance sign-off required for any compensation adjustment."
                },
                {
                    "title": "Commit transaction to payroll gateway and log immutable audit hash",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Post verified resolution to HRMS payroll ledger."
                }
            ],
            "inquiry_presets": [
                {
                    "id": "clarify_details",
                    "label": "📝 Request Additional Details",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding your payroll inquiry {{caseNumber}}:\nPlease provide additional details or background notes to help us process this promptly.\n\nWarm regards,\nPayroll Operations Desk"
                },
                {
                    "id": "supporting_doc",
                    "label": "📎 Upload Supporting Proof",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease upload relevant supporting documents or signed approvals.\n\nWarm regards,\nPayroll Operations Desk"
                }
            ],
            "diagnostic_keywords": ["PAYROLL", "SALARY", "TAX", "PAYSLIP", "DEDUCTION", "LEDGER", "ARREARS"],
            "proof_config": {
                "refLabel": "Payroll Reference / Batch ID",
                "refPlaceholder": "e.g. PAY-202610-849201",
                "metricLabel": "Adjustment Metric / Amount (₹)",
                "metricPlaceholder": "e.g. ₹ 0.00",
                "defaultVerdict": "QUERY_EXPLAINED",
                "presets": [
                    {
                        "id": "PAY_RESOLVED",
                        "label": "✓ Query Resolved",
                        "verdict": "QUERY_EXPLAINED",
                        "refPrefix": "PAY-REF",
                        "metric": "Verified",
                        "notes": "Payroll inquiry audited and explained to employee."
                    },
                    {
                        "id": "PAY_ADJUSTED",
                        "label": "💳 Ledger Adjusted",
                        "verdict": "CREDITED_RECONCILED",
                        "refPrefix": "PAY-ADJ",
                        "metric": "Adjusted",
                        "notes": "Salary adjustment validated and scheduled into next payroll run."
                    }
                ]
            },
            "sla_config": {
                "sla_hours": 48,
                "auto_pause_on_inquiry": True,
                "auto_escalate_risk": True,
                "approval_mode": "MANAGER_REQUIRED"
            },
            "intake_rules": {
                "enabled": False,
                "rule_name": "",
                "required_items": [],
                "missing_action": {
                    "preset_id": None,
                    "pause_sla": True,
                    "warning_message": ""
                }
            }
        },
        {
            "category": "LEAVE",
            "display_name": "Leave Balance & PTO Regularization",
            "icon": "📅",
            "badge_color": "#8b5cf6",
            "default_tasks": [
                {
                    "title": "Verify available leave quota in HRMS ledger",
                    "task_type": "DIAGNOSTIC",
                    "is_mandatory": True,
                    "guidance": "Ensure adequate balance exists in requested leave entitlement bucket (Sick/Casual/Earned)."
                },
                {
                    "title": "Check overlapping public holidays and weekend rules",
                    "task_type": "POLICY",
                    "is_mandatory": True,
                    "guidance": "Check statutory company sandwich leave policy and consecutive holiday rules."
                },
                {
                    "title": "Inspect medical certificate or leave justification",
                    "task_type": "DOC_REQ",
                    "is_mandatory": True,
                    "guidance": "Medical doctor certificate with registration number required for sick leave > 2 days."
                },
                {
                    "title": "Confirm manager approval in HRMS",
                    "task_type": "APPROVAL",
                    "is_mandatory": True,
                    "guidance": "Ensure project deliverable coverage and team handover confirmed."
                },
                {
                    "title": "Adjust leave quota and update ledger balance",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Debit days from HRMS master quota and recalculate closing entitlement."
                }
            ],
            "inquiry_presets": [
                {
                    "id": "med_cert",
                    "label": "🏥 Medical Certificate / Bill",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding your sick leave application for {{caseNumber}}:\nPlease attach the registered medical practitioner certificate or hospital discharge summary covering the requested leave dates.\n\nWarm regards,\nLeave Operations Desk"
                },
                {
                    "id": "leave_dates",
                    "label": "📅 Confirm Exact Leave Dates",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease confirm your exact start date and return-to-office date so we can adjust your leave ledger balance.\n\nWarm regards,\nLeave Operations Desk"
                }
            ],
            "diagnostic_keywords": ["LEAVE", "BALANCE", "QUOTA", "PTO", "SICK", "CASUAL", "VACATION"],
            "proof_config": {
                "refLabel": "HRMS Leave Transaction ID",
                "refPlaceholder": "e.g. LV-TRAN-202610-771",
                "metricLabel": "Leave Quota Restored / Debited",
                "metricPlaceholder": "e.g. 2.0 Days Casual, 4.0 Days Sick",
                "defaultVerdict": "LEAVE_QUOTA_RESTORED",
                "presets": [
                    {
                        "id": "LV_RESTORE",
                        "label": "📅 Leave Quota Restored",
                        "verdict": "LEAVE_QUOTA_RESTORED",
                        "refPrefix": "LV-CREDIT",
                        "metric": "2.0 Days Restored",
                        "notes": "Approved medical certificate validated. 2.0 Days restored to Earned Leave quota."
                    },
                    {
                        "id": "LV_DECLINED",
                        "label": "❌ Declined",
                        "verdict": "REQUEST_DECLINED",
                        "refPrefix": "VOID",
                        "metric": "0 Days",
                        "notes": "Insufficient leave balance and policy limits exceeded."
                    }
                ]
            },
            "sla_config": {
                "sla_hours": 24,
                "auto_pause_on_inquiry": True,
                "auto_escalate_risk": True,
                "approval_mode": "EXCEPTION_ONLY"
            },
            "intake_rules": {
                "enabled": False,
                "rule_name": "",
                "required_items": [],
                "missing_action": {
                    "preset_id": None,
                    "pause_sla": True,
                    "warning_message": ""
                }
            }
        },
        {
            "category": "ASSET_IT",
            "display_name": "IT Asset & Access Provisioning",
            "icon": "💻",
            "badge_color": "#0284c7",
            "default_tasks": [
                {
                    "title": "Lookup active asset allocation in IT inventory",
                    "task_type": "DIAGNOSTIC",
                    "is_mandatory": True,
                    "guidance": "Check CMDB / Snipe-IT for current machine serial number and warranty status."
                },
                {
                    "title": "Audit Okta / ActiveDirectory user privileges",
                    "task_type": "SECURITY",
                    "is_mandatory": True,
                    "guidance": "Verify employee role groups, security clearance, and 2FA authentication state."
                },
                {
                    "title": "Verify hardware replacement / warranty eligibility",
                    "task_type": "POLICY",
                    "is_mandatory": False,
                    "guidance": "Laptops eligible for refresh after 36 months or unrepairable accidental damage."
                },
                {
                    "title": "Manager IT cost-center approval confirmed",
                    "task_type": "APPROVAL",
                    "is_mandatory": True,
                    "guidance": "Cost-center budget approval required for equipment requisition."
                },
                {
                    "title": "Provision hardware / access token in ITSM",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Assign device barcode, generate tracking token, and update dispatch log."
                }
            ],
            "inquiry_presets": [
                {
                    "id": "asset_tag",
                    "label": "💻 Laptop Serial / Asset Tag",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding your IT equipment request for {{caseNumber}}:\nPlease share the asset barcode / serial number from the underside of your laptop or machine.\n\nWarm regards,\nTechOps IT Desk"
                },
                {
                    "id": "screenshot",
                    "label": "📸 Error Screenshot",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease attach a full-screen screenshot of the error message showing the error code and timestamp.\n\nWarm regards,\nTechOps IT Desk"
                }
            ],
            "diagnostic_keywords": ["IT", "ASSET", "OKTA", "LDAP", "SAML", "LAPTOP", "HARDWARE", "ACCESS"],
            "proof_config": {
                "refLabel": "ITSM Ticket / Asset Tag ID",
                "refPlaceholder": "e.g. ITSM-202610-88910",
                "metricLabel": "Hardware Unit / License Metric",
                "metricPlaceholder": "e.g. 1x MacBook Pro M2, 1x Token",
                "defaultVerdict": "ACCESS_PROVISIONED",
                "presets": [
                    {
                        "id": "IT_TICKET",
                        "label": "💻 Ticket Resolved",
                        "verdict": "ACCESS_PROVISIONED",
                        "refPrefix": "ITSM",
                        "metric": "1x Provisioned",
                        "notes": "Hardware allocation updated in master CMDB and credentials assigned."
                    },
                    {
                        "id": "IT_SAML",
                        "label": "🛡️ SAML Auth Granted",
                        "verdict": "ACCESS_PROVISIONED",
                        "refPrefix": "SAML-AUTH",
                        "metric": "1x Token Active",
                        "notes": "User privileges provisioned in Okta directory; 2FA sessions reset."
                    }
                ]
            },
            "sla_config": {
                "sla_hours": 12,
                "auto_pause_on_inquiry": True,
                "auto_escalate_risk": True,
                "approval_mode": "MANAGER_REQUIRED"
            }
        },
        {
            "category": "GENERAL_HR",
            "display_name": "Enterprise Operations & SOP Audit",
            "icon": "⚡",
            "badge_color": "#4f46e5",
            "default_tasks": [
                {
                    "title": "Verify entity identity in master directory",
                    "task_type": "SECURITY",
                    "is_mandatory": True,
                    "guidance": "Validate employee code, department assignment, and reporting manager in company HRMS."
                },
                {
                    "title": "Audit enterprise records and policy limits",
                    "task_type": "POLICY",
                    "is_mandatory": True,
                    "guidance": "Check statutory guidelines, expenditure threshold caps, and company manual rules."
                },
                {
                    "title": "Verify supporting documentation attached",
                    "task_type": "DOC_REQ",
                    "is_mandatory": False,
                    "guidance": "Confirm all receipts, purchase orders, or authorization certificates are attached."
                },
                {
                    "title": "Confirm managerial sign-off if required",
                    "task_type": "APPROVAL",
                    "is_mandatory": True,
                    "guidance": "Supervisory approval required for any policy exceptions or threshold deviations."
                },
                {
                    "title": "Execute master record update & log proof",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Apply operational modification in master database and record forensic proof."
                }
            ],
            "inquiry_presets": [
                {
                    "id": "clarify",
                    "label": "📝 General Clarification",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding your inquiry for {{caseNumber}}:\nPlease provide further details or supporting documentation to help us process your request.\n\nWarm regards,\nOperations Desk"
                },
                {
                    "id": "receipt",
                    "label": "📦 PO / Invoice Receipt",
                    "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease attach the relevant purchase order or delivery receipt copy.\n\nWarm regards,\nOperations Desk"
                }
            ],
            "diagnostic_keywords": [],
            "proof_config": {
                "refLabel": "PO / Transaction Reference ID",
                "refPlaceholder": "e.g. PO-202610-8849",
                "metricLabel": "Adjustment Metric",
                "metricPlaceholder": "e.g. 1x Verified, ₹ 0.00",
                "defaultVerdict": "QUERY_EXPLAINED",
                "presets": [
                    {
                        "id": "OPS_PO",
                        "label": "📦 PO Reconciled",
                        "verdict": "ORDER_VERIFIED",
                        "refPrefix": "PO-REF",
                        "metric": "PO Matched",
                        "notes": "Goods Receipt Note matches PO line items. Verified by Operations."
                    },
                    {
                        "id": "OPS_SOP",
                        "label": "📋 Policy Confirmed",
                        "verdict": "QUERY_EXPLAINED",
                        "refPrefix": "SOP-CONF",
                        "metric": "SOP Confirmed",
                        "notes": "Standard departmental policy verified and communicated to user."
                    }
                ]
            },
            "sla_config": {
                "sla_hours": 48,
                "auto_pause_on_inquiry": True,
                "auto_escalate_risk": True,
                "approval_mode": "EXCEPTION_ONLY"
            }
        }
    ]

    for d in defaults:
        conn.execute("""
            INSERT OR REPLACE INTO category_playbooks 
            (category, display_name, icon, badge_color, default_tasks, inquiry_presets, diagnostic_keywords, proof_config, sla_config, intake_rules, is_custom, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        """, (
            d["category"],
            d["display_name"],
            d["icon"],
            d["badge_color"],
            json.dumps(d["default_tasks"]),
            json.dumps(d["inquiry_presets"]),
            json.dumps(d["diagnostic_keywords"]),
            json.dumps(d["proof_config"]),
            json.dumps(d.get("sla_config", {})),
            json.dumps(d.get("intake_rules", {})),
            now_iso,
            now_iso
        ))
    conn.commit()


def get_playbook_for_category(category: str) -> Dict[str, Any]:
    ensure_playbooks_table_seeded()
    cat = (category or "GENERAL_HR").strip().upper()
    conn = get_connection()
    try:
        # 1. Exact match
        row = conn.execute("SELECT * FROM category_playbooks WHERE UPPER(category) = UPPER(?)", (cat,)).fetchone()
        
        # 2. Substring match fallback
        if not row:
            if any(k in cat for k in ["ATTEND", "BIOMETRIC", "PUNCH", "SHIFT"]):
                row = conn.execute("SELECT * FROM category_playbooks WHERE category = 'ATTENDANCE'").fetchone()
            elif any(k in cat for k in ["PAYROLL", "SALARY", "TAX", "BANK", "COMPENSATION"]):
                row = conn.execute("SELECT * FROM category_playbooks WHERE category = 'PAYROLL'").fetchone()
            elif any(k in cat for k in ["LEAVE", "PTO", "VACATION", "SICK"]):
                row = conn.execute("SELECT * FROM category_playbooks WHERE category = 'LEAVE'").fetchone()
            elif any(k in cat.split('_') or k in cat for k in ["ASSET", "SECURITY", "LAPTOP", "HARDWARE", "ACCESS", "VPN", "SOFTWARE"]) or cat == "IT" or cat.startswith("IT_") or cat.endswith("_IT"):
                row = conn.execute("SELECT * FROM category_playbooks WHERE category = 'ASSET_IT'").fetchone()

        # 3. If exact or substring match found in database, return it
        if row:
            return {
                "category": row["category"],
                "display_name": row["display_name"],
                "icon": row["icon"],
                "badge_color": row["badge_color"],
                "default_tasks": json.loads(row["default_tasks"] or "[]"),
                "inquiry_presets": json.loads(row["inquiry_presets"] or "[]"),
                "diagnostic_keywords": json.loads(row["diagnostic_keywords"] or "[]"),
                "proof_config": json.loads(row["proof_config"] or "{}"),
                "sla_config": json.loads(row["sla_config"] or "{}") if "sla_config" in row.keys() and row["sla_config"] else {
                    "sla_hours": 48,
                    "auto_pause_on_inquiry": True,
                    "auto_escalate_risk": True,
                    "approval_mode": "EXCEPTION_ONLY"
                },
                "intake_rules": json.loads(row["intake_rules"] or "{}") if "intake_rules" in row.keys() and row["intake_rules"] else {
                    "enabled": False,
                    "rule_name": "",
                    "required_items": [],
                    "missing_action": {}
                },
                "is_custom": bool(row["is_custom"]),
                "updated_at": row["updated_at"]
            }

        # 4. If cat is GENERAL_HR or empty, load GENERAL_HR row
        if cat in ("GENERAL_HR", "DEFAULT", "GENERAL", "HR", "OTHER", "UNKNOWN"):
            row = conn.execute("SELECT * FROM category_playbooks WHERE category = 'GENERAL_HR'").fetchone()
            if row:
                return {
                    "category": row["category"],
                    "display_name": row["display_name"],
                    "icon": row["icon"],
                    "badge_color": row["badge_color"],
                    "default_tasks": json.loads(row["default_tasks"] or "[]"),
                    "inquiry_presets": json.loads(row["inquiry_presets"] or "[]"),
                    "diagnostic_keywords": json.loads(row["diagnostic_keywords"] or "[]"),
                    "proof_config": json.loads(row["proof_config"] or "{}"),
                    "sla_config": json.loads(row["sla_config"] or "{}") if "sla_config" in row.keys() and row["sla_config"] else {
                        "sla_hours": 48,
                        "auto_pause_on_inquiry": True,
                        "auto_escalate_risk": True,
                        "approval_mode": "EXCEPTION_ONLY"
                    },
                    "intake_rules": json.loads(row["intake_rules"] or "{}") if "intake_rules" in row.keys() and row["intake_rules"] else {
                        "enabled": False,
                        "rule_name": "",
                        "required_items": [],
                        "missing_action": {}
                    },
                    "is_custom": bool(row["is_custom"]),
                    "updated_at": row["updated_at"]
                }

        # 4. Universal Dynamic Category Synthesis (for any arbitrary company/department)
        human_title = cat.replace("_", " ").title()
        cat_icon = "📋"
        if any(w in cat for w in ["FINANCE", "BILLING", "INVOICE", "EXPENSE"]):
            cat_icon = "💳"
        elif any(w in cat for w in ["LEGAL", "CONTRACT", "COMPLIANCE"]):
            cat_icon = "⚖️"
        elif any(w in cat for w in ["FACILITY", "OFFICE", "ADMIN"]):
            cat_icon = "🏢"
        elif any(w in cat for w in ["TECH", "CODE", "ENGINEERING", "DEV"]):
            cat_icon = "💻"
        elif any(w in cat for w in ["CUSTOMER", "CLIENT", "SUPPORT"]):
            cat_icon = "🎧"

        return {
            "category": cat,
            "display_name": f"{human_title} Operations",
            "icon": cat_icon,
            "badge_color": "#2563eb",
            "default_tasks": [
                {
                    "title": f"Verify requester identity and authorization for {human_title}",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Confirm requester records in directory and ensure eligibility."
                },
                {
                    "title": "Inspect submitted request details and attached documentation",
                    "task_type": "DIAGNOSTIC",
                    "is_mandatory": True,
                    "guidance": "Cross-reference submitted data points against standard operating policy."
                },
                {
                    "title": "Review departmental approval and compliance guidelines",
                    "task_type": "APPROVAL",
                    "is_mandatory": False,
                    "guidance": "Verify supervisor or stakeholder sign-off if required."
                },
                {
                    "title": "Execute resolution in departmental system and log reference ID",
                    "task_type": "CHECKBOX",
                    "is_mandatory": True,
                    "guidance": "Commit verified changes and record forensic docket reference."
                }
            ],
            "inquiry_presets": [
                {
                    "id": "clarify_inquiry",
                    "label": "📝 Request Additional Details",
                    "prompt_template": f"Hi {{{{employeeName}}}},\n\nRegarding your {human_title} request (Case {{{{caseNumber}}}}):\nPlease share additional details or supporting context so we can finalize this promptly.\n\nWarm regards,\n{{{{teamName}}}}"
                },
                {
                    "id": "mgr_approval_inquiry",
                    "label": "👔 Supervisor / Manager Sign-off",
                    "prompt_template": f"Hi {{{{employeeName}}}},\n\nRegarding Case {{{{caseNumber}}}}:\nPlease forward written confirmation or approval from your reporting manager or department lead.\n\nWarm regards,\n{{{{teamName}}}}"
                }
            ],
            "diagnostic_keywords": [cat, "POLICY", "VERIFICATION", "STATUS", "RECORD"],
            "proof_config": {
                "refLabel": f"{human_title} Docket / Reference ID",
                "refPlaceholder": f"e.g. {cat[:4]}-REF-2026-001",
                "metricLabel": "Resolution Outcome / Action Taken",
                "metricPlaceholder": "e.g. Completed, Granted, Closed",
                "defaultVerdict": "REQUEST_RESOLVED",
                "presets": [
                    {
                        "id": "RESOLVED_OK",
                        "label": "✓ Approved & Executed",
                        "verdict": "REQUEST_RESOLVED",
                        "refPrefix": f"{cat[:4]}-OK",
                        "metric": "Approved",
                        "notes": f"Request verified per {human_title} guidelines and successfully executed."
                    },
                    {
                        "id": "DECLINED",
                        "label": "❌ Declined (Policy)",
                        "verdict": "REQUEST_DECLINED",
                        "refPrefix": "VOID",
                        "metric": "Declined",
                        "notes": "Request could not be authorized due to company policy constraints."
                    }
                ]
            },
            "sla_config": {
                "sla_hours": 48,
                "auto_pause_on_inquiry": True,
                "auto_escalate_risk": True,
                "approval_mode": "EXCEPTION_ONLY"
            },
            "intake_rules": {
                "enabled": False,
                "rule_name": "",
                "required_items": [],
                "missing_action": {}
            },
            "is_custom": False,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
    finally:
        conn.close()


def save_playbook(category: str, data: Dict[str, Any], mark_custom: bool = True) -> Dict[str, Any]:
    ensure_playbooks_table_seeded()
    cat = (category or data.get("category") or "GENERAL_HR").strip().upper()
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        display_name = data.get("display_name") or f"{cat} Operations Playbook"
        icon = data.get("icon") or "📋"
        badge_color = data.get("badge_color") or "#3b82f6"
        tasks_json = json.dumps(data.get("default_tasks") or [])
        inquiries_json = json.dumps(data.get("inquiry_presets") or [])
        keywords_json = json.dumps(data.get("diagnostic_keywords") or [])
        proof_json = json.dumps(data.get("proof_config") or {})
        sla_json = json.dumps(data.get("sla_config") or {
            "sla_hours": 48,
            "auto_pause_on_inquiry": True,
            "auto_escalate_risk": True,
            "approval_mode": "EXCEPTION_ONLY"
        })
        intake_json = json.dumps(data.get("intake_rules") or {
            "enabled": False,
            "rule_name": "",
            "required_items": [],
            "missing_action": {}
        })

        conn.execute("""
            INSERT INTO category_playbooks 
            (category, display_name, icon, badge_color, default_tasks, inquiry_presets, diagnostic_keywords, proof_config, sla_config, intake_rules, is_custom, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(category) DO UPDATE SET
                display_name = excluded.display_name,
                icon = excluded.icon,
                badge_color = excluded.badge_color,
                default_tasks = excluded.default_tasks,
                inquiry_presets = excluded.inquiry_presets,
                diagnostic_keywords = excluded.diagnostic_keywords,
                proof_config = excluded.proof_config,
                sla_config = excluded.sla_config,
                intake_rules = excluded.intake_rules,
                is_custom = excluded.is_custom,
                updated_at = excluded.updated_at
        """, (
            cat,
            display_name,
            icon,
            badge_color,
            tasks_json,
            inquiries_json,
            keywords_json,
            proof_json,
            sla_json,
            intake_json,
            1 if mark_custom else 0,
            now_iso,
            now_iso
        ))
        conn.commit()
        return get_playbook_for_category(cat)
    finally:
        conn.close()


def list_all_playbooks() -> List[Dict[str, Any]]:
    ensure_playbooks_table_seeded()
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM category_playbooks ORDER BY category ASC").fetchall()
        result = []
        for r in rows:
            result.append({
                "category": r["category"],
                "display_name": r["display_name"],
                "icon": r["icon"],
                "badge_color": r["badge_color"],
                "tasks_count": len(json.loads(r["default_tasks"] or "[]")),
                "inquiries_count": len(json.loads(r["inquiry_presets"] or "[]")),
                "is_custom": bool(r["is_custom"]),
                "updated_at": r["updated_at"]
            })
        return result
    finally:
        conn.close()


def generate_ai_playbook_suggestions(category: str) -> Dict[str, Any]:
    """
    Intelligently generates enterprise-grade SOC2/ISO aligned SOP steps, 
    inquiries, and proof settings tailored to any department or category.
    """
    cat = (category or "OPERATIONS").strip().upper()

    if "ATTEND" in cat:
        return {
            "suggested_tasks": [
                {"title": "Audit physical turnstile RFID swipe records at office access points", "task_type": "DIAGNOSTIC", "is_mandatory": True, "guidance": "Check entry/exit turnstile logs to confirm physical presence."},
                {"title": "Validate enterprise VPN tunnel & active SSO user session hours", "task_type": "SECURITY", "is_mandatory": False, "guidance": "If biometric punch is missing, check active tunnel duration (min 8.5 hrs)."},
                {"title": "Inspect line manager written attendance regularization approval", "task_type": "APPROVAL", "is_mandatory": True, "guidance": "Reporting manager sign-off required for timesheet exception."},
                {"title": "Audit company statutory late-mark policy threshold (< 3 per month)", "task_type": "POLICY", "is_mandatory": True, "guidance": "Check if employee has exceeded monthly permissible grace limit."},
                {"title": "Execute HRMS attendance status change from LOP to PRESENT", "task_type": "CHECKBOX", "is_mandatory": True, "guidance": "Recalculates timesheet ledger with zero loss of pay."}
            ],
            "suggested_inquiries": [
                {"label": "🕒 In/Out Timings & Gate Location", "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease specify the approximate in-time, out-time, and which entry turnstile gate you used.\n\nWarm regards,\nAttendance Desk"},
                {"label": "👔 Manager Regularization Email", "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease forward your reporting manager's written confirmation or approval ticket.\n\nWarm regards,\nAttendance Desk"}
            ],
            "suggested_proof": {
                "refLabel": "HRMS Regularization Reference ID",
                "refPlaceholder": "e.g. ATT-REG-202610-9901",
                "metricLabel": "Regularized Shift Duration",
                "metricPlaceholder": "e.g. 1.0 Day / 8.5 Hours",
                "defaultVerdict": "ATTENDANCE_REGULARIZED"
            },
            "suggested_intake_rules": {
                "enabled": True,
                "rule_name": "Attendance Regularization Inbound Criteria",
                "required_items": [
                    {"field_type": "DATE", "label": "Shift Date"},
                    {"field_type": "TIME", "label": "Approximate In/Out Timestamps"},
                    {"field_type": "ATTACHMENT", "label": "Manager Email / Proof (Optional)"}
                ],
                "missing_action": {
                    "preset_id": "inq_timings",
                    "pause_sla": True,
                    "warning_message": "Employee did not specify missed shift date or turnstile punch timings."
                }
            }
        }
    elif any(k in cat for k in ["PAYROLL", "SALARY", "TAX", "BANK", "FINANCE"]):
        return {
            "suggested_tasks": [
                {"title": "Validate 11-digit IFSC routing code against RBI national database", "task_type": "DIAGNOSTIC", "is_mandatory": True, "guidance": "Verify branch location and IFSC validity before queueing payout."},
                {"title": "Inspect clear image copy of cancelled cheque or bank passbook", "task_type": "DOC_REQ", "is_mandatory": True, "guidance": "Ensure account number, IFSC, and employee legal name are legible."},
                {"title": "Execute real-time penny-drop beneficiary bank account verification", "task_type": "SECURITY", "is_mandatory": True, "guidance": "Penny-drop confirms beneficiary name exactly matches payroll master records."},
                {"title": "Verify line manager / HRBP approval for bank change request", "task_type": "APPROVAL", "is_mandatory": True, "guidance": "Manager approval required to safeguard against credential hijacking."},
                {"title": "Commit bank details to payroll gateway ledger and log audit hash", "task_type": "CHECKBOX", "is_mandatory": True, "guidance": "Updates direct deposit routing for upcoming salary dispatch."}
            ],
            "suggested_inquiries": [
                {"label": "🏦 Upload Cancelled Cheque Copy", "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease upload a legible photo of your cancelled cheque with your name printed on it.\n\nWarm regards,\nPayroll Desk"},
                {"label": "📑 Confirm Account & IFSC Code", "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease double-check and confirm your complete 11-character IFSC and Account Number.\n\nWarm regards,\nPayroll Desk"}
            ],
            "suggested_proof": {
                "refLabel": "Bank UTR / Transaction Reference ID",
                "refPlaceholder": "e.g. UTR-202610-849201",
                "metricLabel": "Adjustment Amount (₹)",
                "metricPlaceholder": "e.g. ₹ 4,500.00",
                "defaultVerdict": "CREDITED_RECONCILED"
            },
            "suggested_intake_rules": {
                "enabled": True,
                "rule_name": "Inbound Bank Credentials & Proof Gate",
                "required_items": [
                    {"field_type": "NUMBER_SEQUENCE", "label": "Bank Account Number (9-18 digits)"},
                    {"field_type": "IFSC_CODE", "label": "Bank IFSC Code (11-character)"},
                    {"field_type": "ATTACHMENT", "label": "Cancelled Cheque or Bank Passbook Copy"}
                ],
                "missing_action": {
                    "preset_id": "inq_bank_details",
                    "pause_sla": True,
                    "warning_message": "Employee requested salary account update but did not provide Account Number, IFSC, or Cancelled Cheque."
                }
            }
        }
    elif any(k in cat for k in ["LEAVE", "PTO", "VACATION"]):
        return {
            "suggested_tasks": [
                {"title": "Query real-time HRMS employee leave quota & entitlement ledger", "task_type": "DIAGNOSTIC", "is_mandatory": True, "guidance": "Confirm requested category balance (Earned/Sick/Casual) is available."},
                {"title": "Audit statutory sandwich leave policy and consecutive weekend rules", "task_type": "POLICY", "is_mandatory": True, "guidance": "Check if Friday and Monday leave spans weekend days."},
                {"title": "Inspect registered medical practitioner certificate or hospital note", "task_type": "DOC_REQ", "is_mandatory": True, "guidance": "Required for sick leave claims exceeding 2 consecutive working days."},
                {"title": "Confirm reporting manager sign-off and project handover coverage", "task_type": "APPROVAL", "is_mandatory": True, "guidance": "Manager must confirm work responsibilities are covered."},
                {"title": "Debit approved leave quota in HRMS and update attendance ledger", "task_type": "CHECKBOX", "is_mandatory": True, "guidance": "Closing balance adjusted with zero unexpected salary deduction."}
            ],
            "suggested_inquiries": [
                {"label": "🏥 Medical Fitness Certificate", "prompt_template": "Hi {{employeeName}},\n\nRegarding your sick leave application {{caseNumber}}:\nPlease attach the registered doctor certificate covering the requested absence dates.\n\nWarm regards,\nLeave Desk"},
                {"label": "📅 Confirm Exact Return Date", "prompt_template": "Hi {{employeeName}},\n\nRegarding Case {{caseNumber}}:\nPlease confirm your exact resume-work date so we can finalize the ledger adjustment.\n\nWarm regards,\nLeave Desk"}
            ],
            "suggested_proof": {
                "refLabel": "HRMS Leave Transaction ID",
                "refPlaceholder": "e.g. LV-TRAN-202610-771",
                "metricLabel": "Adjusted Leave Days",
                "metricPlaceholder": "e.g. 2.0 Days Restored",
                "defaultVerdict": "LEAVE_QUOTA_RESTORED"
            },
            "suggested_intake_rules": {
                "enabled": True,
                "rule_name": "Medical / Leave Document Prerequisite",
                "required_items": [
                    {"field_type": "DATE", "label": "Leave Start & Resume Dates"},
                    {"field_type": "ATTACHMENT", "label": "Medical Doctor Note / Travel Proof"}
                ],
                "missing_action": {
                    "preset_id": "inq_med_cert",
                    "pause_sla": True,
                    "warning_message": "Employee requested multi-day medical leave without attaching medical practitioner certificate."
                }
            }
        }
    else:
        # Universal enterprise suggestions
        return {
            "suggested_tasks": [
                {"title": f"Verify {cat} request against company standard operating guidelines", "task_type": "POLICY", "is_mandatory": True, "guidance": "Confirm request meets departmental policy standards and expenditure caps."},
                {"title": "Cross-reference employee credentials and role permissions in master directory", "task_type": "SECURITY", "is_mandatory": True, "guidance": "Confirm employee identity, department cost center, and active employment tier."},
                {"title": "Inspect supporting documentary proof or authorization attachments", "task_type": "DOC_REQ", "is_mandatory": False, "guidance": "Verify all mandatory justification documents and invoices are attached."},
                {"title": "Obtain authorized management sign-off and cost-center clearance", "task_type": "APPROVAL", "is_mandatory": True, "guidance": "Department Head or Lead sign-off required before system execution."},
                {"title": "Execute master enterprise system update and record immutable transaction proof", "task_type": "CHECKBOX", "is_mandatory": True, "guidance": "Log operational change in ERP/HRMS with permanent reference ID."}
            ],
            "suggested_inquiries": [
                {"label": "📝 Additional Justification", "prompt_template": f"Hi {{{{employeeName}}}},\n\nRegarding your {cat} request {{{{caseNumber}}}}:\nPlease provide additional details or background notes to help us process this promptly.\n\nWarm regards,\nOperations Desk"},
                {"label": "📎 Supporting Proof / Attachment", "prompt_template": f"Hi {{{{employeeName}}}},\n\nRegarding Case {{{{caseNumber}}}}:\nPlease attach the relevant supporting documents or approvals.\n\nWarm regards,\nOperations Desk"}
            ],
            "suggested_proof": {
                "refLabel": "Enterprise Audit Reference ID",
                "refPlaceholder": f"e.g. {cat[:3]}-202610-9901",
                "metricLabel": "Operational Metric / Units",
                "metricPlaceholder": "e.g. 1x Verified / Completed",
                "defaultVerdict": "QUERY_EXPLAINED"
            },
            "suggested_intake_rules": {
                "enabled": False,
                "rule_name": f"{cat} Intake Gate",
                "required_items": [],
                "missing_action": {
                    "preset_id": None,
                    "pause_sla": True,
                    "warning_message": "Required intake criteria not provided."
                }
            }
        }
