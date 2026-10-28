"""
HR FLOW — Manage Employee, Role Election & Access Governance API Routes (backend/api/agent_routes.py)
Allows Super Admin / HR Admin to:
  1. View everyone across the organization by role (SUPER_ADMIN, HR_MANAGER, HR_LEAD, HR_AGENT)
  2. Add a new person, assign their Role + Department + Designation, and automatically send a
     beautifully formatted HTML Welcome & Role Election Email via Gmail SMTP so they can access the site
  3. Modify any person's Role, Department, Designation, or Email (with optional Role Update Email)
  4. Remove / revoke a person's access
  5. View, add, remove, or toggle Role Rules & Permissions for SUPER_ADMIN, HR_MANAGER, HR_LEAD, HR_AGENT
  6. Preview or resend the HTML Welcome Email at any time
"""

import html as html_lib
import json
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from flask import Blueprint, request
from backend.api import success_response, error_response
from backend.config import Config
from backend.database.connection import get_connection
from backend.models.case import list_cases
from backend.services.cases.department_service import (
    ensure_default_departments_seeded,
    list_departments_with_members,
)
from backend.services.cases.case_service import ROLE_PERMISSIONS
from backend.services.gmail.gmail_client import send_gmail_smtp_email
from backend.services.audit.audit_service import log_event

agent_bp = Blueprint("agent", __name__, url_prefix="/api/agent")

ROLE_RULES_FILE = os.path.join(Config.BACKEND_DIR, "data", "role_rules.json")

ROLE_METADATA: Dict[str, Dict[str, Any]] = {
    "ADMIN": {
        "code": "ADMIN",
        "title": "Admin",
        "badge_bg": "#eef2ff",
        "badge_fg": "#3730a3",
        "badge_border": "#c7d2fe",
        "hero_gradient": "linear-gradient(135deg, #0f172a 0%, #312e81 55%, #4f46e5 100%)",
        "summary": "Full platform governance, employee & role election, AI model training, workflow builder, and system configuration.",
        "accessible_modules": [
            "Dashboard",
            "Manage Employee & Roles",
            "Mail Inbox",
            "HR Departments & AI Trainer",
            "Cases Workspace",
            "Tasks & Approvals",
            "Workflows & Workflow Builder",
            "Actions & Integrations",
            "Reports & Compliance Audit",
        ],
    },
    "HR_MANAGER": {
        "code": "HR_MANAGER",
        "title": "HR Manager",
        "badge_bg": "#ecfdf5",
        "badge_fg": "#065f46",
        "badge_border": "#a7f3d0",
        "hero_gradient": "linear-gradient(135deg, #0f172a 0%, #065f46 55%, #059669 100%)",
        "summary": "Departmental oversight, high-risk approval sign-off, SLA escalation management, case reassignment, and executive reporting.",
        "accessible_modules": [
            "Dashboard",
            "Mail Inbox",
            "HR Departments",
            "Cases Workspace (All Queues)",
            "Tasks & Manager Approvals",
            "Workflows",
            "Actions",
            "Reports",
        ],
    },
    "HR_LEAD": {
        "code": "HR_LEAD",
        "title": "HR Team Lead",
        "badge_bg": "#fffbeb",
        "badge_fg": "#92400e",
        "badge_border": "#fde68a",
        "hero_gradient": "linear-gradient(135deg, #0f172a 0%, #92400e 55%, #d97706 100%)",
        "summary": "Team queue supervision, specialist case assignment, category override, approval decisions, and SLA monitoring.",
        "accessible_modules": [
            "Dashboard",
            "Mail Inbox",
            "HR Departments",
            "Cases Workspace (Team & My Queue)",
            "Tasks & Approvals",
            "Workflows",
            "Actions",
            "Reports",
        ],
    },
    "HR_AGENT": {
        "code": "HR_AGENT",
        "title": "HR Specialist / Agent",
        "badge_bg": "#eff6ff",
        "badge_fg": "#1e40af",
        "badge_border": "#bfdbfe",
        "hero_gradient": "linear-gradient(135deg, #0f172a 0%, #1e3a8a 55%, #2563eb 100%)",
        "summary": "Frontline case execution, document verification, employee communication, workflow progression, and case resolution.",
        "accessible_modules": [
            "Mail Inbox",
            "Cases Workspace (Assigned & Dept Queue)",
            "Verification Tasks",
            "Approvals Request",
            "HRMS Actions",
            "Reports",
        ],
    },
}

PERMISSION_LABELS: Dict[str, str] = {
    "view_my_queue": "View Personal Assigned Case Queue",
    "view_team_queue": "View Department Team Queue",
    "view_all_cases": "View All Organization Cases",
    "work_assigned_case": "Process & Update Assigned Cases",
    "claim_case": "Self-Claim Unassigned Department Cases",
    "assign_case": "Assign Cases to Department Specialists",
    "reassign_case": "Reassign Cases Across Specialists / Teams",
    "change_priority": "Modify Case Priority & SLA Tier",
    "override_category": "Override AI Category & Intent Classification",
    "create_task": "Create Case Verification Tasks",
    "complete_task": "Complete & Sign Off Verification Tasks",
    "request_info": "Request Missing Information from Employees",
    "mark_ready": "Mark Cases Ready for Resolution",
    "move_workflow": "Transition Workflow Engine States",
    "request_approval": "Request Manager / Finance Approval",
    "approve_request": "Approve Pending Approval Requests",
    "reject_request": "Reject Pending Approval Requests",
    "resolve_case": "Resolve HR Cases with Resolution Notes",
    "close_case": "Permanently Close Resolved Cases",
    "reopen_case": "Reopen Closed or Resolved Cases",
    "escalate_case": "Escalate Breached or High-Risk Cases",
    "accept_ai": "Confirm AI Pipeline Classifications",
    "view_audit": "Inspect Immutable Compliance Audit Logs",
    "manage_system": "Manage Employees, Roles & System Rules",
    "view_integration_results": "View External HRMS / Payroll API Results",
    "execute_low_risk_action": "Execute Low-Risk HRMS Actions",
    "execute_medium_risk_action": "Execute Medium-Risk HRMS Actions",
    "approve_selected_action": "Approve Restricted External Actions",
    "approve_high_risk_action": "Approve High-Risk Payroll / Exit Actions",
    "configure_integrations": "Configure External Connectors & Webhooks",
    "manage_credentials": "Manage Encrypted Integration Credentials",
    "manage_user_roles": "Manage & Assign User Roles",
    "change_user_role": "Change & Assign Roles to Users",
}


def load_role_rules() -> Dict[str, List[str]]:
    """Load persisted role rules from disk and synchronize with runtime ROLE_PERMISSIONS."""
    if os.path.isfile(ROLE_RULES_FILE):
        try:
            with open(ROLE_RULES_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    for r_key, perms in saved.items():
                        if isinstance(perms, list):
                            norm_key = "ADMIN" if r_key.upper() == "SUPER_ADMIN" else r_key.upper()
                            ROLE_PERMISSIONS[norm_key] = [str(p).strip() for p in perms if str(p).strip()]
        except Exception:
            pass
    return {
        role: list(ROLE_PERMISSIONS.get(role, []))
        for role in ("ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT")
    }


def save_role_rules(updated_rules: Dict[str, List[str]]) -> Dict[str, List[str]]:
    """Save updated role rules to disk and update runtime ROLE_PERMISSIONS."""
    os.makedirs(os.path.dirname(ROLE_RULES_FILE), exist_ok=True)
    current = load_role_rules()
    for role, perms in updated_rules.items():
        r_norm = role.strip().upper()
        if r_norm == "SUPER_ADMIN":
            r_norm = "ADMIN"
        if r_norm in ("ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT") and isinstance(perms, list):
            clean_perms = []
            for p in perms:
                p_str = str(p).strip().lower().replace(" ", "_")
                if p_str and p_str not in clean_perms:
                    clean_perms.append(p_str)
            current[r_norm] = clean_perms
            ROLE_PERMISSIONS[r_norm] = clean_perms

    with open(ROLE_RULES_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)
    return current


def _normalize_role(role: Optional[str]) -> str:
    r = (role or "HR_AGENT").strip().upper().replace(" ", "_")
    if r == "SUPER_ADMIN":
        return "ADMIN"
    if r not in ("ADMIN", "HR_MANAGER", "HR_LEAD", "HR_AGENT"):
        return "HR_AGENT"
    return r


def _sync_users_and_members() -> List[Dict[str, Any]]:
    """
    Ensure `users` and `hr_department_members` are synchronized and return the unified
    list of all HR personnel with their role, department, designation, and active workload.
    """
    ensure_default_departments_seeded()
    depts = list_departments_with_members()
    all_cases = list_cases(account_email="__ALL__", limit=500)
    role_rules = load_role_rules()

    dept_by_id: Dict[int, Dict[str, Any]] = {int(d["id"]): d for d in depts}
    default_dept = depts[0] if depts else {
        "id": 1,
        "dept_code": "DEPT-LEAVE",
        "team_name": "HR Operations",
        "category_scope": "GENERAL_HR",
        "dept_gmail": "hr.operations@gmail.com",
    }

    conn = get_connection()
    try:
        mem_rows = conn.execute(
            "SELECT * FROM hr_department_members WHERE active = 1 ORDER BY id ASC"
        ).fetchall()
        user_rows = conn.execute(
            "SELECT * FROM users ORDER BY id ASC"
        ).fetchall()

        users_by_email: Dict[str, Dict[str, Any]] = {
            (r["email"] or "").strip().lower(): dict(r)
            for r in user_rows
            if r["email"]
        }
        members_by_email: Dict[str, Dict[str, Any]] = {}

        # 1. Ensure every department member exists in `users` table
        for mr in mem_rows:
            m_dict = dict(mr)
            em = (m_dict.get("email") or "").strip().lower()
            if not em:
                continue
            members_by_email[em] = m_dict
            norm_role = _normalize_role(m_dict.get("role"))
            if em not in users_by_email:
                cur = conn.execute(
                    "INSERT INTO users (email, role, name) VALUES (?, ?, ?)",
                    (em, norm_role, m_dict.get("member_name")),
                )
                users_by_email[em] = {
                    "id": int(cur.lastrowid),
                    "email": em,
                    "role": norm_role,
                    "name": m_dict.get("member_name"),
                }
            else:
                # Keep name synced if missing in users
                u_rec = users_by_email[em]
                if not u_rec.get("name") and m_dict.get("member_name"):
                    conn.execute(
                        "UPDATE users SET name = ? WHERE id = ?",
                        (m_dict["member_name"], int(u_rec["id"])),
                    )
                    u_rec["name"] = m_dict["member_name"]

        # Do not auto-insert users into hr_department_members; only explicitly added members belong in the roster.

        # Check welcome email audit logs
        welcome_logs = conn.execute(
            """
            SELECT entity_id, description, metadata, created_at
            FROM audit_logs
            WHERE action IN ('EMPLOYEE_WELCOME_EMAIL_SENT', 'ROLE_UPDATED_EMAIL_SENT')
            ORDER BY id DESC
            """
        ).fetchall()
        conn.commit()
    finally:
        conn.close()

    welcome_by_email: Dict[str, Dict[str, Any]] = {}
    for wl in welcome_logs:
        try:
            meta = json.loads(wl["metadata"] or "{}")
            em_key = (meta.get("email") or "").strip().lower()
            if em_key and em_key not in welcome_by_email:
                welcome_by_email[em_key] = {
                    "sent_at": wl["created_at"],
                    "smtp_status": meta.get("smtp_status") or "SENT",
                    "role": meta.get("role"),
                }
        except Exception:
            pass

    # Compute case counts per specialist
    active_by_person: Dict[str, int] = {}
    resolved_by_person: Dict[str, int] = {}
    for c in all_cases:
        c_user = (c.get("assigned_user") or "").strip().lower()
        c_email = (c.get("assigned_user_email") or "").strip().lower()
        c_status = (c.get("status") or "NEW").upper()
        for key in (c_user, c_email):
            if not key:
                continue
            if c_status in ("RESOLVED", "CLOSED"):
                resolved_by_person[key] = resolved_by_person.get(key, 0) + 1
            else:
                active_by_person[key] = active_by_person.get(key, 0) + 1

    # Build unified directory list (one entry per member row)
    conn = get_connection()
    try:
        final_members = conn.execute(
            "SELECT * FROM hr_department_members WHERE active = 1 ORDER BY id ASC"
        ).fetchall()
    finally:
        conn.close()

    directory: List[Dict[str, Any]] = []
    seen_emails = set()
    for mr in final_members:
        m = dict(mr)
        em = (m.get("email") or "").strip().lower()
        if em:
            seen_emails.add(em)
        m_name = (m.get("member_name") or "").strip()
        if m_name.lower() in ("super admin", "super_admin"):
            m_name = "Admin"
        norm_role = _normalize_role(m.get("role"))
        dept_info = dept_by_id.get(int(m.get("dept_id") or 0), default_dept)
        u_info = users_by_email.get(em, {})
        role_meta = ROLE_METADATA.get(norm_role, ROLE_METADATA["HR_AGENT"])
        perms = role_rules.get(norm_role, [])

        act_cnt = active_by_person.get(m_name.lower(), 0) or active_by_person.get(em, 0)
        res_cnt = resolved_by_person.get(m_name.lower(), 0) or resolved_by_person.get(em, 0)
        welcome_info = welcome_by_email.get(em)
        raw_desig = m.get("designation") or role_meta["title"]
        if str(raw_desig).strip().lower() in ("super admin", "super_admin"):
            raw_desig = "Admin"

        # Multi-department resolution for single or multi-assigned specialist
        assigned_dids: List[int] = []
        if m.get("dept_id"):
            try:
                assigned_dids.append(int(m["dept_id"]))
            except (ValueError, TypeError):
                pass
        if m.get("dept_ids"):
            for did_str in str(m["dept_ids"]).split(","):
                if did_str.strip().isdigit():
                    val = int(did_str.strip())
                    if val not in assigned_dids:
                        assigned_dids.append(val)

        assigned_depts = [dept_by_id[did] for did in assigned_dids if did in dept_by_id]
        if not assigned_depts:
            assigned_depts = [dept_info]

        all_cats = set()
        for ad in assigned_depts:
            if ad.get("category_scope"):
                for sc in str(ad["category_scope"]).split(","):
                    if sc.strip():
                        all_cats.add(sc.strip().upper())
        if m.get("category_scope"):
            for sc in str(m["category_scope"]).split(","):
                if sc.strip():
                    all_cats.add(sc.strip().upper())

        combined_cats = ", ".join(sorted(all_cats)) if all_cats else (dept_info.get("category_scope") or "GENERAL_HR")
        combined_teams = " & ".join([ad["team_name"] for ad in assigned_depts]) if len(assigned_depts) > 1 else (m.get("team_name") or dept_info["team_name"])

        directory.append({
            "id": int(m["id"]),
            "member_id": int(m["id"]),
            "user_id": u_info.get("id"),
            "name": m_name,
            "member_name": m_name,
            "email": em,
            "role": norm_role,
            "role_title": role_meta["title"],
            "sub_department": m.get("sub_department") or "",
            "designation": raw_desig,
            "dept_id": assigned_depts[0]["id"],
            "dept_ids": assigned_dids,
            "team_name": combined_teams,
            "dept_code": assigned_depts[0].get("dept_code") or "DEPT-HR",
            "category_scope": combined_cats,
            "allowed_categories": sorted(list(all_cats)),
            "assigned_departments": [
                {
                    "id": ad["id"],
                    "team_name": ad["team_name"],
                    "dept_code": ad.get("dept_code"),
                    "category_scope": ad.get("category_scope"),
                }
                for ad in assigned_depts
            ],
            "sla_hours": dept_info.get("sla_hours") or 48,
            "active_cases": act_cnt,
            "resolved_cases": res_cnt,
            "permissions": perms,
            "permission_count": len(perms),
            "accessible_modules": role_meta["accessible_modules"],
            "welcome_email": welcome_info,
            "created_at": m.get("created_at"),
            "updated_at": m.get("updated_at"),
        })

    # Include standalone `users` rows (such as the primary Admin account) in the User Management directory
    for em, u_info in users_by_email.items():
        if em in seen_emails:
            continue
        norm_role = _normalize_role(u_info.get("role"))
        role_meta = ROLE_METADATA.get(norm_role, ROLE_METADATA["ADMIN"])
        perms = role_rules.get(norm_role, [])
        u_name = (u_info.get("name") or "Admin").strip()
        if u_name.lower() in ("super admin", "super_admin"):
            u_name = "Admin"
        act_cnt = active_by_person.get(u_name.lower(), 0) or active_by_person.get(em, 0)
        res_cnt = resolved_by_person.get(u_name.lower(), 0) or resolved_by_person.get(em, 0)
        welcome_info = welcome_by_email.get(em)
        uid_int = int(u_info["id"])
        existing_ids = {int(x["id"]) for x in directory if x.get("id") is not None}
        non_colliding_id = uid_int
        if non_colliding_id in existing_ids:
            non_colliding_id = 10000 + uid_int
            while non_colliding_id in existing_ids:
                non_colliding_id += 1

        directory.insert(0 if norm_role == "ADMIN" else len(directory), {
            "id": non_colliding_id,
            "member_id": None,
            "user_id": uid_int,
            "name": u_name,
            "member_name": u_name,
            "email": em,
            "role": norm_role,
            "role_title": role_meta["title"],
            "designation": "Admin · Platform Head" if norm_role == "ADMIN" else role_meta["title"],
            "dept_id": int(default_dept["id"]),
            "team_name": "All HR Departments (Global)" if norm_role == "ADMIN" else default_dept["team_name"],
            "dept_code": "GLOBAL-ADMIN" if norm_role == "ADMIN" else (default_dept.get("dept_code") or "DEPT-HR"),
            "category_scope": "ALL_HR_CATEGORIES" if norm_role == "ADMIN" else (default_dept.get("category_scope") or "GENERAL_HR"),
            "sla_hours": 24,
            "active_cases": act_cnt,
            "resolved_cases": res_cnt,
            "permissions": perms,
            "permission_count": len(perms),
            "accessible_modules": role_meta["accessible_modules"],
            "welcome_email": welcome_info,
            "created_at": u_info.get("created_at"),
            "updated_at": u_info.get("updated_at"),
        })

    return directory


def build_role_welcome_email_payload(
    name: str,
    email: str,
    role: str,
    team_name: str,
    designation: str,
    category_scope: str = "ALL_HR",
    custom_note: Optional[str] = None,
    is_role_update: bool = False,
    portal_base_url: str = "",
) -> Dict[str, str]:
    """
    Build a rich, executive HTML + Plain-Text Welcome & Role Election Email for an employee
    granted access to the HR Flow Operations Portal.
    """
    norm_role = _normalize_role(role)
    role_meta = ROLE_METADATA.get(norm_role, ROLE_METADATA["HR_AGENT"])
    role_title = role_meta["title"]
    role_summary = role_meta["summary"]
    modules = role_meta["accessible_modules"]
    perms = load_role_rules().get(norm_role, [])

    base_url = Config.get_portal_base_url(portal_base_url)
    from urllib.parse import quote
    encoded_email = quote((email or "").strip().lower())
    login_url = f"{base_url}/login.html?email={encoded_email}"

    action_word = "Role Updated & Access Confirmed" if is_role_update else "Welcome to HR Flow Operations"
    subject = (
        f"[HR Flow Access Granted] Elected as {role_title} ({norm_role}) — {team_name}"
        if not is_role_update
        else f"[HR Flow Role Updated] Your New Role: {role_title} ({norm_role}) — {team_name}"
    )

    perm_labels = [PERMISSION_LABELS.get(p, p.replace("_", " ").title()) for p in perms[:10]]
    perm_rows_html = "".join(
        f"""
        <tr>
            <td style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a;">
                <span style="display:inline-block; width:18px; height:18px; line-height:18px; text-align:center; border-radius:50%; background:#dcfce7; color:#15803d; font-weight:800; font-size:11px; margin-right:8px;">✓</span>
                <strong>{html_lib.escape(lbl)}</strong>
            </td>
        </tr>
        """
        for lbl in perm_labels
    )

    module_pills_html = "".join(
        f"""<span style="display:inline-block; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-size:11.5px; font-weight:700; padding:5px 11px; border-radius:999px; margin:3px 4px 3px 0;">{html_lib.escape(m)}</span>"""
        for m in modules
    )

    custom_note_html = ""
    if custom_note and custom_note.strip():
        custom_note_html = f"""
        <div style="margin-top:22px; background:#f0f9ff; border:1px solid #bae6fd; border-left:4px solid #0284c7; border-radius:12px; padding:14px 16px;">
            <div style="font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#0369a1; margin-bottom:4px;">
                💬 Personal Note from Admin / HR Leadership
            </div>
            <div style="font-size:13.5px; color:#0c4a6e; line-height:1.55;">
                {html_lib.escape(custom_note.strip())}
            </div>
        </div>
        """

    now_display = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")

    body_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html_lib.escape(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:32px 16px;">
        <tr>
            <td align="center">
                <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px; width:100%; background-color:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 12px 36px rgba(15, 23, 42, 0.09); border:1px solid #e2e8f0;">
                    
                    <!-- TOP HERO BANNER -->
                    <tr>
                        <td style="background:{role_meta['hero_gradient']}; padding:36px 36px 30px 36px; color:#ffffff;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                <tr>
                                    <td>
                                        <span style="display:inline-block; background:rgba(255,255,255,0.16); color:#e0f2fe; font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; padding:5px 12px; border-radius:999px; border:1px solid rgba(255,255,255,0.24);">
                                            ✦ HR FLOW · OPERATIONS &amp; GOVERNANCE PORTAL
                                        </span>
                                    </td>
                                    <td align="right" style="font-size:12px; color:#cbd5e1; font-weight:600;">
                                        Official Role Election
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin:18px 0 8px 0; font-size:24px; font-weight:800; letter-spacing:-0.02em; color:#ffffff;">
                                {html_lib.escape(action_word)}, {html_lib.escape(name)}!
                            </h1>
                            <p style="margin:0; font-size:14px; color:#dbeafe; line-height:1.55;">
                                You have been officially elected as <strong>{html_lib.escape(role_title)} ({html_lib.escape(norm_role)})</strong> in <strong>{html_lib.escape(team_name)}</strong> and granted live access to the HR Flow Operations Portal.
                            </p>
                        </td>
                    </tr>

                    <!-- MAIN BODY -->
                    <tr>
                        <td style="padding:32px 36px;">
                            <p style="margin:0 0 14px 0; font-size:15px; color:#1e293b; font-weight:600;">
                                Dear {html_lib.escape(name)},
                            </p>
                            <p style="margin:0 0 24px 0; font-size:14px; color:#475569; line-height:1.65;">
                                {html_lib.escape(role_summary)} Below are your official role credentials, assigned department scope, and portal access privileges.
                            </p>

                            <!-- ELECTED ROLE BADGE HERO CARD -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%); border:2px dashed #93c5fd; border-radius:16px; padding:22px 24px; text-align:center;">
                                <tr>
                                    <td>
                                        <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.14em; color:#2563eb; margin-bottom:8px;">
                                            YOUR ELECTED PORTAL ROLE &amp; DESIGNATION
                                        </div>
                                        <div style="display:inline-block; background:#0f172a; color:#ffffff; font-size:20px; font-weight:800; letter-spacing:0.04em; padding:10px 24px; border-radius:12px; box-shadow:0 4px 12px rgba(15,23,42,0.18);">
                                            {html_lib.escape(role_title)} · {html_lib.escape(norm_role)}
                                        </div>
                                        <div style="margin-top:10px; font-size:13px; color:#334155; font-weight:600;">
                                            {html_lib.escape(designation)} — {html_lib.escape(team_name)}
                                        </div>
                                        <div style="margin-top:12px;">
                                            <span style="display:inline-block; background:#ffffff; color:#0f172a; border:1px solid #cbd5e1; font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px; margin:2px 4px;">
                                                📧 Login ID: {html_lib.escape(email)}
                                            </span>
                                            <span style="display:inline-block; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px; margin:2px 4px;">
                                                ● Access Status: Active
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            {custom_note_html}

                            <!-- PROFILE & DEPARTMENT SUMMARY TABLE -->
                            <div style="margin-top:24px;">
                                <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#475569; margin-bottom:10px;">
                                    📌 Your Official Portal Profile
                                </div>
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; background:#ffffff;">
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600; width:40%;">Full Name</td>
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:700;">{html_lib.escape(name)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Portal Login Email</td>
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#2563eb; font-weight:700;">{html_lib.escape(email)}</td>
                                    </tr>
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Elected System Role</td>
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:800;">{html_lib.escape(role_title)} ({html_lib.escape(norm_role)})</td>
                                    </tr>
                                    <tr>
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#64748b; font-weight:600;">Assigned HR Department</td>
                                        <td style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#0f172a; font-weight:700;">{html_lib.escape(team_name)}</td>
                                    </tr>
                                    <tr style="background:#f8fafc;">
                                        <td style="padding:10px 14px; font-size:13px; color:#64748b; font-weight:600;">Category Routing Scope</td>
                                        <td style="padding:10px 14px; font-size:13px; color:#059669; font-weight:700;">{html_lib.escape(category_scope or "GENERAL_HR")}</td>
                                    </tr>
                                </table>
                            </div>

                            <!-- ACCESSIBLE WORKSPACE MODULES -->
                            <div style="margin-top:24px;">
                                <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#475569; margin-bottom:10px;">
                                    🧭 Modules Unlocked for Your Role
                                </div>
                                <div>
                                    {module_pills_html}
                                </div>
                            </div>

                            <!-- GRANTED PERMISSIONS & GOVERNANCE RULES -->
                            <div style="margin-top:24px;">
                                <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#475569; margin-bottom:10px;">
                                    🛡️ Authorized Operational Rules &amp; Capabilities ({len(perms)} Active Rules)
                                </div>
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; background:#f8fafc;">
                                    {perm_rows_html}
                                </table>
                            </div>

                            <!-- CTA PORTAL ACCESS BOX (ONLY PORTAL LOGIN LINK) -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px; background:#0f172a; border-radius:16px; padding:24px; color:#ffffff;">
                                <tr>
                                    <td>
                                        <div style="font-size:16px; font-weight:800; color:#ffffff; margin-bottom:6px;">
                                            🚀 Access the HR Flow Portal Now
                                        </div>
                                        <p style="margin:0 0 18px 0; font-size:13px; color:#cbd5e1; line-height:1.55;">
                                            Click below to sign in to the <strong>HR Flow Operations Portal</strong> using your registered email (<strong style="color:#ffffff;">{html_lib.escape(email)}</strong>). Your workspace will automatically configure itself for your <strong>{html_lib.escape(role_title)}</strong> role.
                                        </p>
                                        <a href="{login_url}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; font-size:13.5px; font-weight:700; padding:12px 24px; border-radius:10px;">
                                            Portal Login Page &rarr;
                                        </a>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <!-- FOOTER -->
                    <tr>
                        <td style="background:#f8fafc; border-top:1px solid #e2e8f0; padding:20px 36px; text-align:center;">
                            <div style="font-size:12px; font-weight:700; color:#475569;">
                                HR FLOW — Enterprise HR Operations &amp; Role Governance
                            </div>
                            <div style="font-size:11.5px; color:#94a3b8; margin-top:4px;">
                                Provisioned on {html_lib.escape(now_display)} by Admin · Role: {html_lib.escape(norm_role)}
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>"""

    perm_text_lines = "\n".join(f"  ✓ {lbl}" for lbl in perm_labels)
    body_text = (
        f"Dear {name},\n\n"
        f"{action_word}! You have been officially elected as {role_title} ({norm_role}) "
        f"in {team_name} on the HR Flow Operations Portal.\n\n"
        f"==================================================\n"
        f"  ELECTED ROLE        : {role_title} ({norm_role})\n"
        f"  DESIGNATION         : {designation}\n"
        f"  ASSIGNED DEPARTMENT : {team_name}\n"
        f"  LOGIN EMAIL         : {email}\n"
        f"  CATEGORY SCOPE      : {category_scope}\n"
        f"==================================================\n\n"
        + (f"PERSONAL NOTE FROM HR LEADERSHIP:\n  {custom_note.strip()}\n\n" if custom_note and custom_note.strip() else "")
        + f"MODULES UNLOCKED FOR YOUR ROLE:\n  • {', '.join(modules)}\n\n"
        f"AUTHORIZED OPERATIONAL RULES ({len(perms)}):\n{perm_text_lines}\n\n"
        f"ACCESS THE HR FLOW PORTAL:\n"
        f"  • Portal Login Page : {login_url}\n\n"
        f"— HR Flow Admin & Governance Portal\n"
    )

    return {
        "recipient_name": name,
        "recipient_email": email,
        "role": norm_role,
        "role_title": role_title,
        "team_name": team_name,
        "designation": designation,
        "subject": subject,
        "body_text": body_text,
        "body_html": body_html,
        "login_url": login_url,
    }


# ============================================================================
# API ENDPOINTS FOR MANAGE EMPLOYEE & ROLE GOVERNANCE
# ============================================================================

@agent_bp.route("/employees", methods=["GET"])
@agent_bp.route("/workspace", methods=["GET"])
@agent_bp.route("/roster", methods=["GET"])
def list_managed_employees_route():
    """Return full employee/staff role directory, KPI breakdown, departments, and role permission rules."""
    directory = _sync_users_and_members()
    depts = list_departments_with_members()
    role_rules = load_role_rules()

    counts = {
        "total": len(directory),
        "ADMIN": sum(1 for p in directory if p["role"] == "ADMIN"),
        "HR_MANAGER": sum(1 for p in directory if p["role"] == "HR_MANAGER"),
        "HR_LEAD": sum(1 for p in directory if p["role"] == "HR_LEAD"),
        "HR_AGENT": sum(1 for p in directory if p["role"] == "HR_AGENT"),
    }

    return success_response({
        "count": len(directory),
        "kpis": counts,
        "employees": directory,
        "roster": directory,
        "departments": [
            {
                "id": d["id"],
                "dept_code": d["dept_code"],
                "team_name": d["team_name"],
                "category_scope": d["category_scope"],
                "dept_gmail": d["dept_gmail"],
                "sla_hours": d["sla_hours"],
            }
            for d in depts
        ],
        "role_metadata": ROLE_METADATA,
        "role_rules": role_rules,
        "permission_labels": PERMISSION_LABELS,
    })


@agent_bp.route("/employees", methods=["POST"])
def add_managed_employee_route():
    """
    Add a new employee/specialist, assign their Role (ADMIN, HR_MANAGER, HR_LEAD, HR_AGENT)
    and Department, and automatically send the HTML Welcome & Role Election Email via Gmail SMTP.
    """
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or payload.get("member_name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    role = _normalize_role(payload.get("role"))
    dept_id = payload.get("dept_id")
    team_name_req = (payload.get("team_name") or "").strip()
    designation = (payload.get("designation") or "").strip() or ROLE_METADATA[role]["title"]
    sub_department = (payload.get("sub_department") or "").strip()
    custom_note = (payload.get("custom_note") or payload.get("note") or "").strip()
    send_welcome = bool(payload.get("send_welcome_email", True))
    performed_by = payload.get("performed_by") or request.headers.get("X-HR-User") or "Admin"

    if not name:
        return error_response("VALIDATION_ERROR", "Full Name is required.", 400)
    if not email or "@" not in email:
        return error_response("VALIDATION_ERROR", "A valid Email / Gmail address is required.", 400)

    ensure_default_departments_seeded()
    depts = list_departments_with_members()
    raw_dept_ids = payload.get("dept_ids")
    selected_dept_ids: List[int] = []
    if isinstance(raw_dept_ids, (list, tuple)):
        for x in raw_dept_ids:
            if str(x).strip().isdigit():
                val = int(str(x).strip())
                if val not in selected_dept_ids:
                    selected_dept_ids.append(val)
    elif isinstance(raw_dept_ids, str) and raw_dept_ids.strip():
        for x in raw_dept_ids.split(","):
            if x.strip().isdigit():
                val = int(x.strip())
                if val not in selected_dept_ids:
                    selected_dept_ids.append(val)

    if dept_id and str(dept_id).isdigit():
        d_val = int(str(dept_id).strip())
        if d_val not in selected_dept_ids:
            selected_dept_ids.insert(0, d_val)

    selected_depts = [d for d in depts if int(d["id"]) in selected_dept_ids]
    if not selected_depts and team_name_req:
        td = next((d for d in depts if d["team_name"].lower() == team_name_req.lower()), None)
        if td:
            selected_depts = [td]
    if not selected_depts:
        selected_depts = [depts[0]]

    resolved_dept_id = int(selected_depts[0]["id"])
    resolved_dept_ids_str = ",".join(str(d["id"]) for d in selected_depts)

    all_cats = set()
    for sd in selected_depts:
        if sd.get("category_scope"):
            for sc in str(sd["category_scope"]).split(","):
                if sc.strip():
                    all_cats.add(sc.strip().upper())
    req_scope = (payload.get("category_scope") or "").strip()
    if req_scope:
        for sc in req_scope.split(","):
            if sc.strip():
                all_cats.add(sc.strip().upper())

    category_scope = ", ".join(sorted(all_cats)) if all_cats else (selected_depts[0].get("category_scope") or "GENERAL_HR")
    resolved_team = " & ".join([sd["team_name"] for sd in selected_depts]) if len(selected_depts) > 1 else selected_depts[0]["team_name"]

    conn = get_connection()
    try:
        # 1. Upsert in `users` table
        existing_user = conn.execute(
            "SELECT id FROM users WHERE LOWER(email) = LOWER(?)",
            (email,),
        ).fetchone()
        if existing_user:
            conn.execute(
                "UPDATE users SET name = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (name, role, int(existing_user["id"])),
            )
        else:
            conn.execute(
                "INSERT INTO users (email, role, name) VALUES (?, ?, ?)",
                (email, role, name),
            )

        # 2. Upsert in `hr_department_members`
        existing_mem = conn.execute(
            "SELECT id FROM hr_department_members WHERE LOWER(email) = LOWER(?) AND active = 1",
            (email,),
        ).fetchone()
        if existing_mem:
            member_id = int(existing_mem["id"])
            conn.execute(
                """
                UPDATE hr_department_members
                SET dept_id = ?, dept_ids = ?, category_scope = ?, team_name = ?, member_name = ?, email = ?, role = ?, designation = ?, sub_department = COALESCE(NULLIF(?, ''), sub_department), updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (resolved_dept_id, resolved_dept_ids_str, category_scope, resolved_team, name, email, role, designation, sub_department, member_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO hr_department_members (
                    dept_id, dept_ids, category_scope, team_name, member_name, email, role, designation, sub_department, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (resolved_dept_id, resolved_dept_ids_str, category_scope, resolved_team, name, email, role, designation, sub_department or None),
            )
            member_id = int(cur.lastrowid)

        conn.commit()
    finally:
        conn.close()

    portal_url = request.host_url.rstrip("/") if request.host_url else "http://127.0.0.1:5000"
    email_payload = build_role_welcome_email_payload(
        name=name,
        email=email,
        role=role,
        team_name=resolved_team,
        designation=designation,
        category_scope=category_scope,
        custom_note=custom_note,
        is_role_update=False,
        portal_base_url=portal_url,
    )

    smtp_res = {
        "sent": False,
        "status": "SKIPPED_BY_USER",
        "recipient": email,
        "message": "Welcome email was not requested.",
    }
    if send_welcome:
        smtp_res = send_gmail_smtp_email(
            recipient_email=email,
            subject=email_payload["subject"],
            body_text=email_payload["body_text"],
            body_html=email_payload["body_html"],
        )
        log_event(
            entity_type="USER",
            entity_id=member_id,
            action="EMPLOYEE_WELCOME_EMAIL_SENT",
            description=f"Elected {name} ({email}) as {role} in {resolved_team} · Welcome Email: {smtp_res['status']}",
            performed_by=performed_by,
            metadata={
                "member_id": member_id,
                "name": name,
                "email": email,
                "role": role,
                "team_name": resolved_team,
                "designation": designation,
                "smtp_status": smtp_res["status"],
                "sent": smtp_res.get("sent", False),
            },
        )
    else:
        log_event(
            entity_type="USER",
            entity_id=member_id,
            action="EMPLOYEE_ROLE_ADDED",
            description=f"Added {name} ({email}) as {role} in {resolved_team}",
            performed_by=performed_by,
            metadata={"member_id": member_id, "name": name, "email": email, "role": role, "team_name": resolved_team},
        )

    directory = _sync_users_and_members()
    added_record = next((p for p in directory if int(p["id"]) == member_id), None)

    return success_response({
        "employee": added_record,
        "welcome_dispatch": smtp_res,
        "email_preview": email_payload,
        "employees": directory,
    }, status_code=201)


@agent_bp.route("/employees/<int:member_id>", methods=["PUT", "PATCH"])
def update_managed_employee_route(member_id: int):
    """
    Modify an existing person's Role (ADMIN, HR_MANAGER, HR_LEAD, HR_AGENT),
    Department, Designation, Name, or Email, and optionally send a Role Election Update Email.
    """
    payload = request.get_json(silent=True) or {}
    performed_by = payload.get("performed_by") or request.headers.get("X-HR-User") or "Admin"
    send_notify = bool(payload.get("send_welcome_email") or payload.get("send_email", False))
    custom_note = (payload.get("custom_note") or payload.get("note") or "").strip()

    from backend.api.auth_routes import get_session_user_from_request, _ACTIVE_SESSIONS
    session_user = get_session_user_from_request()
    hdr_role = (request.headers.get("X-HR-Role") or "").strip().upper()
    sess_role = (session_user.get("role") or "").strip().upper()
    caller_role = sess_role or hdr_role or "ADMIN"
    if caller_role == "SUPER_ADMIN":
        caller_role = "ADMIN"
    is_admin = (
        caller_role == "ADMIN"
        or "ADMIN" in (performed_by or "").upper()
        or session_user.get("role") in ("ADMIN", "SUPER_ADMIN")
    )
    if not is_admin:
        return error_response("FORBIDDEN", "Only an Admin has authority to assign or modify roles.", 403)

    ensure_default_departments_seeded()
    depts = list_departments_with_members()

    conn = get_connection()
    try:
        req_email = (payload.get("target_email") or payload.get("email") or "").strip().lower()
        explicit_mid = payload.get("member_id")
        existing = None

        if explicit_mid is not None and str(explicit_mid).isdigit() and int(explicit_mid) > 0:
            existing = conn.execute(
                "SELECT * FROM hr_department_members WHERE id = ?",
                (int(explicit_mid),),
            ).fetchone()
        elif req_email:
            existing = conn.execute(
                "SELECT * FROM hr_department_members WHERE LOWER(email) = LOWER(?) AND active = 1 ORDER BY id DESC LIMIT 1",
                (req_email,),
            ).fetchone()
        else:
            cand = conn.execute(
                "SELECT * FROM hr_department_members WHERE id = ?",
                (int(member_id),),
            ).fetchone()
            if cand and (not req_email or (cand["email"] or "").strip().lower() == req_email):
                existing = cand

        if existing:
            target_mid = int(existing["id"])
            old_email = (existing["email"] or "").strip().lower()
            old_role = _normalize_role(existing["role"])
            new_name = (payload.get("name") or payload.get("member_name") or existing["member_name"]).strip()
            new_email = (payload.get("email") or existing["email"]).strip().lower()
            new_role = _normalize_role(payload.get("role") or existing["role"])
            default_titles = {m["title"].lower() for m in ROLE_METADATA.values()} | {"admin", "hr lead", "hr agent", "hr manager"}
            prev_desig = (existing["designation"] or "").strip()
            if payload.get("designation"):
                new_desig = payload["designation"].strip()
            elif not prev_desig or prev_desig.lower() in default_titles:
                new_desig = ROLE_METADATA[new_role]["title"]
            else:
                new_desig = prev_desig

            raw_dept_ids = payload.get("dept_ids")
            selected_dept_ids: List[int] = []
            if isinstance(raw_dept_ids, (list, tuple)):
                for x in raw_dept_ids:
                    if str(x).strip().isdigit():
                        val = int(str(x).strip())
                        if val not in selected_dept_ids:
                            selected_dept_ids.append(val)
            elif isinstance(raw_dept_ids, str) and raw_dept_ids.strip():
                for x in raw_dept_ids.split(","):
                    if x.strip().isdigit():
                        val = int(x.strip())
                        if val not in selected_dept_ids:
                            selected_dept_ids.append(val)

            dept_id_req = payload.get("dept_id")
            if dept_id_req and str(dept_id_req).isdigit():
                d_val = int(str(dept_id_req).strip())
                if d_val not in selected_dept_ids:
                    selected_dept_ids.insert(0, d_val)

            team_req = (payload.get("team_name") or "").strip()
            selected_depts = [d for d in depts if int(d["id"]) in selected_dept_ids]
            if not selected_depts and team_req:
                td = next((d for d in depts if d["team_name"].lower() == team_req.lower()), None)
                if td:
                    selected_depts = [td]
            if not selected_depts:
                ex_did = int(existing["dept_id"]) if existing.get("dept_id") else int(depts[0]["id"])
                td = next((d for d in depts if int(d["id"]) == ex_did), depts[0])
                selected_depts = [td]

            new_dept_id = int(selected_depts[0]["id"])
            new_dept_ids_str = ",".join(str(d["id"]) for d in selected_depts)

            all_cats = set()
            for sd in selected_depts:
                if sd.get("category_scope"):
                    for sc in str(sd["category_scope"]).split(","):
                        if sc.strip():
                            all_cats.add(sc.strip().upper())
            req_scope = (payload.get("category_scope") or "").strip()
            if req_scope:
                for sc in req_scope.split(","):
                    if sc.strip():
                        all_cats.add(sc.strip().upper())

            cat_scope = ", ".join(sorted(all_cats)) if all_cats else (selected_depts[0].get("category_scope") or "GENERAL_HR")
            new_team = " & ".join([sd["team_name"] for sd in selected_depts]) if len(selected_depts) > 1 else selected_depts[0]["team_name"]

            new_sub_dept = (payload.get("sub_department") or "").strip()
            final_sub_dept = new_sub_dept if "sub_department" in payload else existing["sub_department"]

            conn.execute(
                """
                UPDATE hr_department_members
                SET dept_id = ?, dept_ids = ?, category_scope = ?, team_name = ?, member_name = ?, email = ?, role = ?, designation = ?, sub_department = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (new_dept_id, new_dept_ids_str, cat_scope, new_team, new_name, new_email, new_role, new_desig, final_sub_dept, target_mid),
            )

            u_row = conn.execute(
                "SELECT id FROM users WHERE LOWER(email) IN (LOWER(?), LOWER(?)) LIMIT 1",
                (old_email, new_email),
            ).fetchone()
            if u_row:
                conn.execute(
                    "UPDATE users SET email = ?, name = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (new_email, new_name, new_role, int(u_row["id"])),
                )
            else:
                conn.execute(
                    "INSERT INTO users (email, role, name) VALUES (?, ?, ?)",
                    (new_email, new_role, new_name),
                )
        else:
            u_only = None
            if req_email:
                u_only = conn.execute(
                    "SELECT * FROM users WHERE LOWER(email) = LOWER(?)",
                    (req_email,),
                ).fetchone()
            if not u_only:
                u_only = conn.execute(
                    "SELECT * FROM users WHERE id = ?",
                    (int(member_id),),
                ).fetchone()
            if not u_only:
                return error_response("NOT_FOUND", f"User record #{member_id} not found.", 404)
            old_email = (u_only["email"] or "").strip().lower()
            old_role = _normalize_role(u_only["role"])
            new_name = (payload.get("name") or payload.get("member_name") or u_only["name"] or "Admin").strip()
            new_email = (payload.get("email") or u_only["email"]).strip().lower()
            new_role = _normalize_role(payload.get("role") or u_only["role"])
            new_desig = (payload.get("designation") or ROLE_METADATA[new_role]["title"]).strip()
            new_team = (payload.get("team_name") or "All HR Departments (Global)").strip()
            cat_scope = "ALL_HR_CATEGORIES"

            conn.execute(
                "UPDATE users SET email = ?, name = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (new_email, new_name, new_role, int(u_only["id"])),
            )
            dept_id_req = payload.get("dept_id")
            if dept_id_req and str(dept_id_req).isdigit():
                target_dept = next((d for d in depts if int(d["id"]) == int(dept_id_req)), None)
                if target_dept:
                    new_team = target_dept["team_name"]
                    cat_scope = target_dept.get("category_scope") or "GENERAL_HR"
                    conn.execute(
                        """
                        INSERT INTO hr_department_members (
                            dept_id, team_name, member_name, email, role, designation, active
                        ) VALUES (?, ?, ?, ?, ?, ?, 1)
                        """,
                        (int(target_dept["id"]), new_team, new_name, new_email, new_role, new_desig),
                    )
            if new_email:
                conn.execute(
                    "UPDATE user_sessions SET role = ? WHERE LOWER(email) IN (LOWER(?), LOWER(?))",
                    (new_role, old_email, new_email),
                )
        conn.commit()
    finally:
        conn.close()

    try:
        from backend.api.auth_routes import _ACTIVE_SESSIONS
        for tok, prof in list(_ACTIVE_SESSIONS.items()):
            if isinstance(prof, dict) and (prof.get("email") or "").strip().lower() in (old_email, new_email):
                prof["role"] = new_role
                prof["role_title"] = new_role.replace("_", " ").title()
    except Exception:
        pass

    smtp_res = None
    email_payload = None
    if send_notify:
        portal_url = request.host_url.rstrip("/") if request.host_url else "http://127.0.0.1:5000"
        email_payload = build_role_welcome_email_payload(
            name=new_name,
            email=new_email,
            role=new_role,
            team_name=new_team,
            designation=new_desig,
            category_scope=cat_scope,
            custom_note=custom_note,
            is_role_update=(old_role != new_role),
            portal_base_url=portal_url,
        )
        smtp_res = send_gmail_smtp_email(
            recipient_email=new_email,
            subject=email_payload["subject"],
            body_text=email_payload["body_text"],
            body_html=email_payload["body_html"],
        )
        log_event(
            entity_type="USER",
            entity_id=member_id,
            action="ROLE_UPDATED_EMAIL_SENT",
            description=f"Updated {new_name} ({new_email}): {old_role} → {new_role} ({new_team}) · Email: {smtp_res['status']}",
            performed_by=performed_by,
            metadata={
                "member_id": member_id,
                "name": new_name,
                "email": new_email,
                "old_role": old_role,
                "role": new_role,
                "team_name": new_team,
                "smtp_status": smtp_res["status"],
            },
        )
    else:
        log_event(
            entity_type="USER",
            entity_id=member_id,
            action="EMPLOYEE_ROLE_UPDATED",
            description=f"Updated {new_name} ({new_email}): {old_role} → {new_role} ({new_team})",
            performed_by=performed_by,
            metadata={
                "member_id": member_id,
                "name": new_name,
                "email": new_email,
                "old_role": old_role,
                "role": new_role,
                "team_name": new_team,
            },
        )

    directory = _sync_users_and_members()
    updated_record = next((p for p in directory if int(p["id"]) == int(member_id) or p["email"] == new_email), None)

    return success_response({
        "employee": updated_record,
        "welcome_dispatch": smtp_res,
        "email_preview": email_payload,
        "employees": directory,
    })


@agent_bp.route("/employees/<int:member_id>", methods=["DELETE"])
def delete_managed_employee_route(member_id: int):
    """Remove an employee from portal access (`hr_department_members` and `users`)."""
    performed_by = request.headers.get("X-HR-User") or "Admin"
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM hr_department_members WHERE id = ?",
            (int(member_id),),
        ).fetchone()
        if existing:
            em = (existing["email"] or "").strip().lower()
            name = existing["member_name"]
            role = existing["role"]
            conn.execute("DELETE FROM hr_department_members WHERE id = ?", (int(member_id),))
            if em and em != "nunux365@gmail.com":
                conn.execute("DELETE FROM users WHERE LOWER(email) = LOWER(?)", (em,))
        else:
            u_only = conn.execute("SELECT * FROM users WHERE id = ?", (int(member_id),)).fetchone()
            if not u_only:
                return error_response("NOT_FOUND", f"Employee record #{member_id} not found.", 404)
            em = (u_only["email"] or "").strip().lower()
            if em == "nunux365@gmail.com":
                return error_response("FORBIDDEN", "Primary Admin account cannot be removed.", 403)
            name = u_only["name"] or em
            role = u_only["role"]
            conn.execute("DELETE FROM users WHERE id = ?", (int(member_id),))
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="USER",
        entity_id=member_id,
        action="EMPLOYEE_ACCESS_REVOKED",
        description=f"Removed {name} ({em}) [{role}] from HR Flow portal access",
        performed_by=performed_by,
        metadata={"member_id": member_id, "name": name, "email": em, "role": role},
    )

    directory = _sync_users_and_members()
    return success_response({
        "deleted": True,
        "member_id": member_id,
        "employees": directory,
    })


@agent_bp.route("/employees/welcome-preview", methods=["POST"])
def preview_welcome_email_route():
    """Return the rendered HTML + plain-text Welcome & Role Election Email for live modal preview."""
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "New HR Specialist").strip()
    email = (payload.get("email") or "specialist.hr@gmail.com").strip().lower()
    role = _normalize_role(payload.get("role"))
    team_name = (payload.get("team_name") or "HR Operations").strip()
    designation = (payload.get("designation") or ROLE_METADATA[role]["title"]).strip()
    category_scope = (payload.get("category_scope") or "ALL_HR").strip()
    custom_note = (payload.get("custom_note") or "").strip()

    portal_url = request.host_url.rstrip("/") if request.host_url else "http://127.0.0.1:5000"
    preview = build_role_welcome_email_payload(
        name=name,
        email=email,
        role=role,
        team_name=team_name,
        designation=designation,
        category_scope=category_scope,
        custom_note=custom_note,
        is_role_update=bool(payload.get("is_role_update", False)),
        portal_base_url=portal_url,
    )
    return success_response(preview)


@agent_bp.route("/employees/<int:member_id>/send-welcome", methods=["POST"])
def send_welcome_email_to_existing_route(member_id: int):
    """Send or resend the HTML Welcome & Role Election Email to an existing member."""
    payload = request.get_json(silent=True) or {}
    custom_note = (payload.get("custom_note") or payload.get("note") or "").strip()
    performed_by = payload.get("performed_by") or request.headers.get("X-HR-User") or "Admin"

    directory = _sync_users_and_members()
    person = next((p for p in directory if int(p["id"]) == int(member_id)), None)
    if not person:
        return error_response("NOT_FOUND", f"Employee record #{member_id} not found.", 404)

    portal_url = request.host_url.rstrip("/") if request.host_url else "http://127.0.0.1:5000"
    email_payload = build_role_welcome_email_payload(
        name=person["name"],
        email=person["email"],
        role=person["role"],
        team_name=person["team_name"],
        designation=person["designation"],
        category_scope=person.get("category_scope") or "GENERAL_HR",
        custom_note=custom_note,
        is_role_update=False,
        portal_base_url=portal_url,
    )
    smtp_res = send_gmail_smtp_email(
        recipient_email=person["email"],
        subject=email_payload["subject"],
        body_text=email_payload["body_text"],
        body_html=email_payload["body_html"],
    )

    log_event(
        entity_type="USER",
        entity_id=member_id,
        action="EMPLOYEE_WELCOME_EMAIL_SENT",
        description=f"Sent Role Election Welcome Email to {person['name']} ({person['email']}) as {person['role']} · {smtp_res['status']}",
        performed_by=performed_by,
        metadata={
            "member_id": member_id,
            "name": person["name"],
            "email": person["email"],
            "role": person["role"],
            "team_name": person["team_name"],
            "smtp_status": smtp_res["status"],
            "sent": smtp_res.get("sent", False),
        },
    )

    updated_dir = _sync_users_and_members()
    return success_response({
        "welcome_dispatch": smtp_res,
        "email_preview": email_payload,
        "employees": updated_dir,
    })


@agent_bp.route("/roles/rules", methods=["GET", "POST", "PUT"])
def manage_role_rules_route():
    """
    View or modify the Role Rules / Permissions matrix for ADMIN, HR_MANAGER, HR_LEAD, and HR_AGENT.
    Supports:
      - Updating full permission list per role (`{"rules": {"HR_AGENT": [...]}}`)
      - Adding/removing/toggling a single rule (`{"role": "HR_AGENT", "permission": "...", "enabled": true}`)
    """
    if request.method == "GET":
        return success_response({
            "role_rules": load_role_rules(),
            "role_metadata": ROLE_METADATA,
            "permission_labels": PERMISSION_LABELS,
        })

    payload = request.get_json(silent=True) or {}
    performed_by = payload.get("performed_by") or request.headers.get("X-HR-User") or "Admin"
    current = load_role_rules()

    if isinstance(payload.get("rules"), dict):
        updated = save_role_rules(payload["rules"])
    else:
        target_role = _normalize_role(payload.get("role"))
        perm_code = (payload.get("permission") or payload.get("rule") or "").strip().lower().replace(" ", "_")
        perm_label = (payload.get("label") or "").strip()
        if not perm_code:
            return error_response("VALIDATION_ERROR", "Permission / Rule code is required.", 400)

        if perm_label:
            PERMISSION_LABELS[perm_code] = perm_label
        elif perm_code not in PERMISSION_LABELS:
            PERMISSION_LABELS[perm_code] = perm_code.replace("_", " ").title()

        role_list = list(current.get(target_role, []))
        action = (payload.get("action") or "").strip().upper()
        enabled = payload.get("enabled")

        if action == "REMOVE" or enabled is False:
            role_list = [p for p in role_list if p != perm_code]
        elif action == "ADD" or enabled is True:
            if perm_code not in role_list:
                role_list.append(perm_code)
        else:
            if perm_code in role_list:
                role_list = [p for p in role_list if p != perm_code]
            else:
                role_list.append(perm_code)

        current[target_role] = role_list
        updated = save_role_rules(current)

    log_event(
        entity_type="SYSTEM",
        entity_id="ROLE_RULES",
        action="ROLE_RULES_UPDATED",
        description="Admin updated Role Permissions & Governance Rules",
        performed_by=performed_by,
        metadata={"updated_rules": updated},
    )

    return success_response({
        "saved": True,
        "role_rules": updated,
        "permission_labels": PERMISSION_LABELS,
        "employees": _sync_users_and_members(),
    })


# =============================================================================
# 7. HR AGENT PERSONAL EXECUTION WORKBENCH API
#    (Used when an HR_AGENT / Specialist logs in and opens agent.html)
# =============================================================================

WORKFLOW_STAGES = [
    {"step": 1, "code": "DETAILS_DOSSIER", "label": "Details & Dossier", "desc": "Inbound request verification & Employee 360 profile"},
    {"step": 2, "code": "AUDIT_SECTION", "label": "Audit Section", "desc": "HR compliance audit, policy checklists & forensic proof entry"},
    {"step": 3, "code": "RESPONSE_RESOLUTION", "label": "Response & Resolution", "desc": "Official response dispatch, forensic proof & case closure"},
]

AGENT_HRMS_ACTIONS_CATALOG = [
    {
        "code": "VERIFY_LEAVE_BALANCE",
        "title": "Verify Leave Balance & Quota (HRMS)",
        "category": "LEAVE",
        "risk_level": "LOW",
        "provider": "Internal HRMS Core",
        "summary": "Fetches live Casual, Sick, and Earned leave ledger balances and policy eligibility.",
    },
    {
        "code": "SYNC_BIOMETRIC_LOGS",
        "title": "Reconcile Biometric & Shift Punch Logs",
        "category": "ATTENDANCE",
        "risk_level": "LOW",
        "provider": "Biometric Attendance Cloud",
        "summary": "Pulls raw swipe timestamps and reconciles missed punch or shift regularization.",
    },
    {
        "code": "FETCH_PAYROLL_LEDGER",
        "title": "Fetch Salary & Tax Deduction Breakdown",
        "category": "PAYROLL",
        "risk_level": "MEDIUM",
        "provider": "Payroll Gateway",
        "summary": "Retrieves current cycle gross-to-net payslip components, TDS, and reimbursement status.",
    },
    {
        "code": "VERIFY_BGV_DOCUMENTS",
        "title": "Run BGV Identity & Employment Check",
        "category": "BGV",
        "risk_level": "MEDIUM",
        "provider": "FirstAdvantage BGV",
        "summary": "Validates uploaded ID, pan/aadhaar, and prior relieving letters against BGV checklist.",
    },
    {
        "code": "CHECK_IT_ASSET_INVENTORY",
        "title": "Check IT Asset & Access Provisioning",
        "category": "ASSET_IT",
        "risk_level": "LOW",
        "provider": "ServiceNow ITAM",
        "summary": "Checks assigned laptop serial, VPN token, and software license status for employee.",
    },
    {
        "code": "AUDIT_SSO_VPN_ACCESS",
        "title": "Audit Identity SSO & VPN Access Logs",
        "category": "SECURITY",
        "risk_level": "LOW",
        "provider": "Okta Identity Cloud",
        "summary": "Verifies Multi-Factor Authentication, active session telemetry, and network security policies.",
    },
    {
        "code": "AUDIT_ERP_INVOICE",
        "title": "Audit SAP ERP Invoice & Vendor Ledger",
        "category": "FINANCE",
        "risk_level": "MEDIUM",
        "provider": "SAP S/4HANA ERP",
        "summary": "Audits invoice line items, tax brackets (GST/TDS), and payment voucher approvals.",
    },
    {
        "code": "VERIFY_BANK_TRANSMISSION",
        "title": "Verify Corporate Banking Payout & UTR",
        "category": "FINANCE",
        "risk_level": "LOW",
        "provider": "Corporate Banking Gateway",
        "summary": "Fetches real-time transmission status, settlement batch references, and bank UTR tokens.",
    },
    {
        "code": "VERIFY_CONTRACT_COMPLIANCE",
        "title": "Verify Contract Terms & NDA Registry",
        "category": "LEGAL",
        "risk_level": "LOW",
        "provider": "DocuSign CLM",
        "summary": "Validates signed contract clauses, NDA indemnities, and regulatory compliance certificates.",
    },
    {
        "code": "AUDIT_PROCUREMENT_PO",
        "title": "Audit Purchase Order & Receiving Dock",
        "category": "OPERATIONS",
        "risk_level": "LOW",
        "provider": "Oracle ERP Cloud",
        "summary": "Cross-references Purchase Order, vendor invoice, and Goods Receipt Note (GRN) timestamps.",
    },
    {
        "code": "UPDATE_EMPLOYEE_PROFILE_RECORD",
        "title": "Sync Master Profile Fields",
        "category": "GENERAL_HR",
        "risk_level": "LOW",
        "provider": "Enterprise Directory Core",
        "summary": "Verifies and updates address, emergency contact, bank IFSC, or master record details.",
    },
]

SMART_REPLY_TEMPLATES: Dict[str, Dict[str, str]] = {
    "PAYROLL": {
        "UPDATE": (
            "Dear {employee_name},\n\n"
            "Thank you for reaching out to the HR Payroll & Compensation Team regarding \"{subject}\" (Case #{case_number}).\n\n"
            "We have verified your payroll records and salary ledger for this pay cycle:\n"
            "• Verification Status: Completed by Payroll Operations\n"
            "• Resolution / Next Action: Your salary breakdown and tax ledger have been reconciled.\n\n"
            "Please reply directly to this email if you need any additional tax or payslip documentation.\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
        "REQUEST_INFO": (
            "Dear {employee_name},\n\n"
            "We are currently reviewing your Payroll request \"{subject}\" (Case #{case_number}).\n\n"
            "To complete our verification, please reply to this email with:\n"
            "1. Your Employee ID and relevant pay period month\n"
            "2. Supporting bank statement or investment proof document (if applicable)\n\n"
            "Once received, we will process your adjustment immediately.\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
    },
    "LEAVE": {
        "UPDATE": (
            "Dear {employee_name},\n\n"
            "Thank you for contacting Leave Operations HR regarding \"{subject}\" (Case #{case_number}).\n\n"
            "We have reviewed your leave balance and policy eligibility in the HRMS portal:\n"
            "• Leave Balance Check: Verified in Internal HRMS Core\n"
            "• Status Update: Your leave request has been processed and updated in your attendance ledger.\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
        "REQUEST_INFO": (
            "Dear {employee_name},\n\n"
            "Regarding your leave request \"{subject}\" (Case #{case_number}), please share:\n"
            "1. Exact start date and return date of your leave\n"
            "2. Medical certificate or supporting document (if applying for Sick/Extended Leave)\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
    },
    "ATTENDANCE": {
        "UPDATE": (
            "Dear {employee_name},\n\n"
            "We have reviewed your attendance regularization / shift log request regarding \"{subject}\" (Case #{case_number}).\n\n"
            "Your biometric and shift punch logs have been reconciled and your timesheet is now updated for the current payroll cutoff.\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
        "REQUEST_INFO": (
            "Dear {employee_name},\n\n"
            "To regularize your attendance for \"{subject}\" (Case #{case_number}), please confirm:\n"
            "1. Exact date(s) and In/Out punch times\n"
            "2. Work location (Office / WFH / Client Site) and brief reason for missed swipe\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
    },
    "DEFAULT": {
        "UPDATE": (
            "Dear {employee_name},\n\n"
            "Thank you for contacting HR Operations regarding \"{subject}\" (Case #{case_number}).\n\n"
            "I have reviewed your request and completed the required HR verification steps. "
            "Your request has been processed and updated in our HR records.\n\n"
            "Please let me know if you need any further assistance.\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
        "REQUEST_INFO": (
            "Dear {employee_name},\n\n"
            "Thank you for contacting HR Operations regarding \"{subject}\" (Case #{case_number}).\n\n"
            "To proceed with your request, could you please reply with the following details/documents?\n"
            "• Employee ID & Department\n"
            "• Relevant supporting document or clarification\n\n"
            "As soon as we receive this, we will finalize your request.\n\n"
            "Warm regards,\n"
            "{agent_name}\n"
            "{agent_designation} · {agent_team}"
        ),
    },
}

RESTRICTED_GOVERNANCE_CAPABILITIES = [
    {"code": "manage_system", "label": "Manage Employees, Role Election & System Rules", "min_role": "ADMIN"},
    {"code": "configure_integrations", "label": "Configure External Webhooks & API Connectors", "min_role": "ADMIN"},
    {"code": "approve_high_risk_action", "label": "Approve High-Risk Payroll / F&F Exit Sign-Offs", "min_role": "HR_MANAGER"},
    {"code": "approve_request", "label": "Approve / Reject Manager-Level Approval Requests", "min_role": "HR_LEAD"},
    {"code": "reassign_case", "label": "Cross-Department Case Reassignment", "min_role": "HR_LEAD"},
]


def _compute_workflow_step_number(workflow_state: Optional[str], status: Optional[str]) -> int:
    st = (status or "NEW").upper()
    wf = (workflow_state or "").upper()
    if st in ("RESOLVED", "CLOSED") or wf in ("RESOLVED", "CLOSED", "COMPLETED", "RESPONSE_RESOLUTION", "READY_FOR_RESOLUTION"):
        return 3
    if wf in ("AUDIT_SECTION", "HRMS_ACTION_APPROVAL", "PENDING_APPROVAL", "APPROVAL_PENDING", "DOC_VERIFICATION", "IN_REVIEW", "VERIFICATION"):
        return 2
    if wf in ("DETAILS_DOSSIER", "INTAKE_TRIAGE"):
        return 1
    if st == "ON_HOLD":
        return 2
    if st == "IN_PROGRESS":
        return 2
    return 1


def _get_case_stages_and_step(case_dict: Optional[dict]) -> tuple:
    """Return (stages_list, current_step_number, total_steps) for a case."""
    if not case_dict:
        return (WORKFLOW_STAGES, 1, len(WORKFLOW_STAGES))
    raw_st = case_dict.get("workflow_stages")
    st_list = None
    if raw_st:
        try:
            parsed = json.loads(raw_st) if isinstance(raw_st, str) else raw_st
            if isinstance(parsed, list) and len(parsed) > 0:
                st_list = parsed
        except Exception:
            pass
    if not st_list:
        st_list = [
            {"step": 1, "code": "DETAILS_DOSSIER", "label": "1. Details & Dossier", "desc": "Inbound request verification & Employee 360", "stage_type": "DOSSIER"},
            {"step": 2, "code": "AUDIT_SECTION", "label": "2. Audit & Execution", "desc": "Verification checklist, system diagnostics & forensic proof", "stage_type": "AUDIT"},
            {"step": 3, "code": "RESPONSE_RESOLUTION", "label": "3. Response & Resolution", "desc": "Official response dispatch, forensic proof & case closure", "stage_type": "RESOLUTION"}
        ]
    total_steps = len(st_list)
    wf_st = (case_dict.get("workflow_state") or "").upper()
    cur_step = 1
    for s in st_list:
        if s.get("code", "").upper() == wf_st:
            cur_step = s["step"]
            break
    else:
        if (case_dict.get("status") or "").upper() == "RESOLVED":
            cur_step = total_steps
        elif wf_st in ("HRMS_ACTION_APPROVAL", "DOC_VERIFICATION", "AUDIT_SECTION"):
            cur_step = min(2, total_steps)
        else:
            base_s = _compute_workflow_step_number(case_dict.get("workflow_state"), case_dict.get("status"))
            cur_step = min(base_s, total_steps)
    return (st_list, max(1, min(cur_step, total_steps)), total_steps)


def _resolve_case_row_by_ref(conn, case_ref: str):
    ref_str = str(case_ref or "").strip()
    if ref_str.isdigit():
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (int(ref_str),)).fetchone()
        if row:
            return dict(row)
    row = conn.execute("SELECT * FROM cases WHERE UPPER(case_number) = UPPER(?)", (ref_str,)).fetchone()
    return dict(row) if row else None


@agent_bp.route("/my-workbench", methods=["GET"])
def get_agent_personal_workbench():
    """
    Return the personalized HR Agent Execution Workbench for the logged-in HR_AGENT
    (or any specific agent selected by Admin/Manager via ?agent_id= or ?email=).
    """
    from backend.models.case import get_case_by_id_or_number
    from backend.services.workflows.workflow_service import build_workflow_preview_for_category

    from backend.api.auth_routes import get_session_user_from_request
    session_user = get_session_user_from_request()
    roster = _sync_users_and_members()

    caller_role = (
        (session_user.get("role") if session_user else "")
        or request.headers.get("X-HR-Role")
        or ""
    ).strip().upper()
    if caller_role == "SUPER_ADMIN":
        caller_role = "ADMIN"

    caller_email = (
        (session_user.get("email") if session_user else "")
        or request.headers.get("X-HR-Email")
        or ""
    ).strip().lower()

    is_inspector = caller_role in ("ADMIN", "HR_MANAGER", "HR_LEAD")

    agent_id_q = request.args.get("agent_id", type=int)
    email_q = (
        request.args.get("email")
        or request.headers.get("X-HR-Email")
        or ""
    ).strip().lower()

    selected_agent = None

    if not is_inspector:
        # Non-admin users (such as HR_AGENT) must ONLY see their own specialist workbench
        target_email = caller_email or email_q
        if target_email:
            selected_agent = next((m for m in roster if (m.get("email") or "").lower() == target_email), None)
        if not selected_agent and caller_email:
            caller_first = caller_email.split("@")[0].lower()
            selected_agent = next((m for m in roster if caller_first in (m.get("email") or "").lower()), None)
        if not selected_agent:
            # Fallback strictly to an HR_AGENT specialist, NEVER to Admin
            selected_agent = next((m for m in roster if m.get("role") == "HR_AGENT"), None)
    else:
        # Inspector (Admin or Manager) selecting/inspecting an agent
        if email_q:
            selected_agent = next((m for m in roster if (m.get("email") or "").lower() == email_q), None)
        if not selected_agent and agent_id_q:
            # First match an HR_AGENT with this member_id, user_id, or id
            selected_agent = next((m for m in roster if (int(m.get("member_id") or 0) == agent_id_q or int(m.get("user_id") or 0) == agent_id_q or int(m.get("id") or 0) == agent_id_q) and m.get("role") == "HR_AGENT"), None)
            if not selected_agent:
                selected_agent = next((m for m in roster if int(m.get("member_id") or 0) == agent_id_q or int(m.get("user_id") or 0) == agent_id_q or int(m.get("id") or 0) == agent_id_q), None)
        if not selected_agent and caller_email:
            # If admin didn't specify agent, default to first HR_AGENT (since this is Agent Workbench), or the caller
            selected_agent = next((m for m in roster if m.get("role") == "HR_AGENT"), None) or next((m for m in roster if (m.get("email") or "").lower() == caller_email), None)
        if not selected_agent:
            selected_agent = next((m for m in roster if m.get("role") == "HR_AGENT"), None) or (roster[0] if roster else None)

    if not selected_agent:
        return error_response("NOT_FOUND", "No agent profile found.", 404)

    agent_name = (selected_agent.get("member_name") or selected_agent.get("name") or "").strip()
    agent_email = (selected_agent.get("email") or "").strip().lower()
    agent_team = (selected_agent.get("team_name") or "").strip()
    agent_scope = (selected_agent.get("category_scope") or "").strip().upper()
    agent_role = _normalize_role(selected_agent.get("role"))
    perms = load_role_rules().get(agent_role, [])
    has_all_hr_scope = bool(
        "ALL_HR" in agent_scope
        or "ALL_HR_CATEGORIES" in agent_scope
        or "PEOPLEDESK" in agent_scope
        or (agent_team and agent_team.lower() == "peopledesk")
    )

    conn = get_connection()
    dept_info = None
    agent_first_token = agent_name.split()[0].lower() if agent_name else ""
    scope_list = [s.strip().upper() for s in agent_scope.split(",") if s.strip()]
    agent_cats = set(scope_list)
    if has_all_hr_scope:
        from backend.classification.category_config import VALID_CATEGORIES
        agent_cats.update(VALID_CATEGORIES)
        agent_cats.add("PEOPLEDESK")

    # Multi-department resolution: Collect all assigned departments and categories for this agent
    assigned_dept_ids: List[int] = []
    if selected_agent.get("dept_id"):
        try:
            assigned_dept_ids.append(int(selected_agent["dept_id"]))
        except (ValueError, TypeError):
            pass
    if selected_agent.get("dept_ids"):
        raw_dids = selected_agent["dept_ids"]
        if isinstance(raw_dids, (list, tuple)):
            for d in raw_dids:
                if str(d).strip().isdigit():
                    val = int(str(d).strip())
                    if val not in assigned_dept_ids:
                        assigned_dept_ids.append(val)
        elif isinstance(raw_dids, str):
            for d in raw_dids.split(","):
                if d.strip().isdigit():
                    val = int(d.strip())
                    if val not in assigned_dept_ids:
                        assigned_dept_ids.append(val)

    if agent_email:
        try:
            m_rows = conn.execute(
                "SELECT dept_id, dept_ids, category_scope, team_name FROM hr_department_members WHERE LOWER(email) = ? AND active = 1",
                (agent_email,),
            ).fetchall()
            for mr in m_rows:
                if mr["dept_id"]:
                    try:
                        val = int(mr["dept_id"])
                        if val not in assigned_dept_ids:
                            assigned_dept_ids.append(val)
                    except (ValueError, TypeError):
                        pass
                if mr["dept_ids"]:
                    for d in str(mr["dept_ids"]).split(","):
                        if d.strip().isdigit():
                            val = int(d.strip())
                            if val not in assigned_dept_ids:
                                assigned_dept_ids.append(val)
                if mr["category_scope"]:
                    for sc in str(mr["category_scope"]).split(","):
                        if sc.strip():
                            agent_cats.add(sc.strip().upper())
        except Exception as exc_m:
            print(f"Warning loading member rows in workbench: {exc_m}")

    assigned_dept_records = []
    assigned_team_names = set()
    if agent_team:
        assigned_team_names.add(agent_team.lower())

    for did in sorted(assigned_dept_ids):
        try:
            d_row = conn.execute("SELECT * FROM hr_departments WHERE id = ? LIMIT 1", (did,)).fetchone()
            if d_row:
                d_dict = dict(d_row)
                assigned_dept_records.append(d_dict)
                if d_dict.get("team_name"):
                    assigned_team_names.add(d_dict["team_name"].lower())
                if d_dict.get("category_scope"):
                    for sc in str(d_dict["category_scope"]).split(","):
                        if sc.strip():
                            agent_cats.add(sc.strip().upper())
        except Exception:
            pass

    dept_info = assigned_dept_records[0] if assigned_dept_records else None
    if not dept_info and agent_team:
        try:
            d_row = conn.execute(
                "SELECT * FROM hr_departments WHERE LOWER(team_name) = LOWER(?) LIMIT 1",
                (agent_team,),
            ).fetchone()
            if d_row:
                dept_info = dict(d_row)
                if dept_info.get("category_scope"):
                    for sc in str(dept_info["category_scope"]).split(","):
                        if sc.strip():
                            agent_cats.add(sc.strip().upper())
        except Exception:
            pass

    all_assigned_categories = set(agent_cats)
    all_assigned_team_names = set(assigned_team_names)
    has_multiple_depts = len(assigned_dept_records) > 1

    # Active department selection (support ?dept_id= query param or X-HR-Dept-Id header)
    requested_dept_param = (
        request.args.get("dept_id")
        or request.headers.get("X-HR-Dept-Id")
        or ""
    ).strip()

    active_dept_record = None
    active_dept_id = None
    active_dept_name = None

    if requested_dept_param:
        if requested_dept_param.upper() == "ALL":
            active_dept_id = "ALL"
            active_dept_name = "All Assigned Departments"
            dept_info = assigned_dept_records[0] if assigned_dept_records else None
        elif requested_dept_param.isdigit():
            target_did = int(requested_dept_param)
            active_dept_record = next((d for d in assigned_dept_records if d["id"] == target_did), None)
            if active_dept_record:
                active_dept_id = active_dept_record["id"]
                active_dept_name = active_dept_record["team_name"]
                dept_info = active_dept_record
                active_cats = {sc.strip().upper() for sc in str(active_dept_record.get("category_scope") or "").split(",") if sc.strip()}
                if active_cats:
                    agent_cats = active_cats
                assigned_team_names = {active_dept_record["team_name"].lower()}
                agent_team = active_dept_record["team_name"]

    if not active_dept_id:
        if has_multiple_depts:
            active_dept_record = assigned_dept_records[0]
            active_dept_id = active_dept_record["id"]
            active_dept_name = active_dept_record["team_name"]
            dept_info = active_dept_record
            active_cats = {sc.strip().upper() for sc in str(active_dept_record.get("category_scope") or "").split(",") if sc.strip()}
            if active_cats:
                agent_cats = active_cats
            assigned_team_names = {active_dept_record["team_name"].lower()}
            agent_team = active_dept_record["team_name"]
        elif assigned_dept_records:
            active_dept_record = assigned_dept_records[0]
            active_dept_id = active_dept_record["id"]
            active_dept_name = active_dept_record["team_name"]
            dept_info = active_dept_record
            agent_team = active_dept_record["team_name"]
        else:
            active_dept_id = 1
            active_dept_name = agent_team or "HR Operations"

    if (active_dept_name and active_dept_name.lower() == "peopledesk") or "PEOPLEDESK" in agent_scope or "ALL_HR" in agent_scope:
        has_all_hr_scope = True
        from backend.classification.category_config import VALID_CATEGORIES
        agent_cats.update(VALID_CATEGORIES)
        agent_cats.add("PEOPLEDESK")

    # Synchronize resolved categories and department list on selected_agent profile
    selected_agent["allowed_categories"] = sorted(list(agent_cats))
    selected_agent["all_assigned_categories"] = sorted(list(all_assigned_categories))
    selected_agent["category_scope"] = active_dept_record.get("category_scope") if active_dept_record else ", ".join(sorted(agent_cats))
    selected_agent["assigned_departments"] = [
        {
            "id": d["id"],
            "dept_code": d.get("dept_code"),
            "team_name": d.get("team_name"),
            "category_scope": d.get("category_scope"),
            "dept_gmail": d.get("dept_gmail"),
            "description": d.get("description"),
            "sla_hours": d.get("sla_hours"),
            "default_priority": d.get("default_priority"),
            "is_active": bool(active_dept_id == d["id"] or active_dept_id == "ALL"),
        }
        for d in assigned_dept_records
    ]
    selected_agent["dept_ids"] = assigned_dept_ids
    selected_agent["has_multiple_depts"] = has_multiple_depts
    selected_agent["active_dept_id"] = active_dept_id
    selected_agent["active_dept_name"] = active_dept_name
    selected_agent["active_department"] = active_dept_record
    selected_agent["team_name"] = active_dept_name

    # Collect designated department mailboxes for strict department mailbox filtering
    allowed_dept_mailboxes = set()
    for d in assigned_dept_records:
        if d.get("dept_gmail"):
            allowed_dept_mailboxes.add(d["dept_gmail"].strip().lower())
    if dept_info and dept_info.get("dept_gmail"):
        allowed_dept_mailboxes.add(dept_info["dept_gmail"].strip().lower())
    if active_dept_record and active_dept_record.get("dept_gmail"):
        allowed_dept_mailboxes.add(active_dept_record["dept_gmail"].strip().lower())

    active_dept_gmail = (active_dept_record.get("dept_gmail") or "").strip().lower() if active_dept_record else ""

    all_cases = list_cases(account_email="__ALL__", limit=400)

    my_cases = []
    dept_cases = []
    unclaimed_cases = []

    for c in all_cases:
        # Strict Department Mailbox Filtering:
        # Exclude any cases arriving from admin or non-department corporate mailboxes
        c_account = (c.get("account_email") or "").strip().lower()
        if c_account:
            if active_dept_gmail and c_account != active_dept_gmail:
                continue
            elif allowed_dept_mailboxes and c_account not in allowed_dept_mailboxes:
                continue

        assigned_user = (c.get("assigned_user") or "").strip()
        assigned_email = (c.get("assigned_user_email") or "").strip().lower()
        assigned_to = (c.get("assigned_to") or "").strip()
        c_team = (c.get("assigned_team") or "").strip()
        c_cat = (c.get("category") or "").strip().upper()

        c["current_step"] = _compute_workflow_step_number(c.get("workflow_state"), c.get("status"))
        c["total_steps"] = 3

        # Strict department & category scope:
        # Agent only handles cases strictly matching their assigned department categories
        if not has_all_hr_scope:
            if not c_cat or c_cat not in agent_cats:
                continue

        is_my_dept = bool(
            (c_cat and c_cat in agent_cats)
            or (c_team and c_team.lower() in assigned_team_names)
            or has_all_hr_scope
        )
        if not is_my_dept:
            continue

        is_mine = bool(
            (agent_email and assigned_email == agent_email)
            or (agent_name and assigned_user.lower() == agent_name.lower())
            or (agent_name and assigned_to.lower() == agent_name.lower())
            or (agent_email and assigned_to.lower() == agent_email)
            or (agent_first_token and len(agent_first_token) >= 3 and (
                agent_first_token in assigned_user.lower() or agent_first_token in assigned_to.lower()
            ))
        )

        is_unassigned = bool(
            not assigned_user
            or assigned_user.upper() in ("UNASSIGNED", "NONE", "PENDING", "HR OPERATIONS")
            or (c_team and assigned_user.lower() == c_team.lower())
        )

        c["is_assigned_to_me"] = is_mine
        c["is_unclaimed"] = is_unassigned and not is_mine

        if is_mine:
            my_cases.append(c)
        dept_cases.append(c)
        if is_unassigned and not is_mine:
            unclaimed_cases.append(c)

    tasks_list = []
    approvals_list = []
    my_comms = []
    my_hr_actions = []
    my_audits = []
    raw_emails = []
    like_pattern = f"%{agent_first_token}%" if len(agent_first_token) >= 3 else agent_name
    try:
        try:
            t_rows = conn.execute(
                """
                SELECT t.*, c.case_number, c.title AS case_title, emp.name AS employee_name
                FROM tasks t
                LEFT JOIN cases c ON t.case_id = c.id
                LEFT JOIN employees emp ON c.employee_id = emp.id
                ORDER BY CASE WHEN t.status IN ('PENDING', 'OPEN', 'IN_PROGRESS') THEN 0 ELSE 1 END, t.id DESC
                LIMIT 100
                """
            ).fetchall()
            tasks_list = [dict(r) for r in t_rows]
        except Exception as exc_t:
            print(f"Warning loading tasks in workbench: {exc_t}")

        try:
            ap_rows = conn.execute(
                """
                SELECT a.*, c.case_number, c.title AS case_title, emp.name AS employee_name, c.category
                FROM approvals a
                LEFT JOIN cases c ON a.case_id = c.id
                LEFT JOIN employees emp ON c.employee_id = emp.id
                ORDER BY a.id DESC
                LIMIT 50
                """
            ).fetchall()
            approvals_list = [dict(r) for r in ap_rows]
        except Exception as exc_ap:
            print(f"Warning loading approvals in workbench: {exc_ap}")

        try:
            em_rows = conn.execute(
                """
                SELECT e.*,
                       emp.name AS employee_name,
                       emp.employee_id AS emp_code,
                       emp.department AS employee_department,
                       emp.designation AS employee_designation,
                       emp.manager_name AS employee_manager,
                       emp.location AS employee_location,
                       c.id AS case_db_id,
                       c.case_number,
                       c.category AS case_category,
                       c.status AS case_status,
                       c.priority AS case_priority,
                       c.due_at AS case_due_at,
                       c.sla_hours AS case_sla_hours,
                       c.assigned_user AS case_owner,
                       c.assigned_user_email AS case_owner_email,
                       c.assigned_to AS case_assigned_to,
                       c.assigned_team AS case_team,
                       c.workflow_id AS case_workflow_id,
                       c.workflow_state AS case_workflow_state
                FROM emails e
                LEFT JOIN cases c ON c.email_id = e.id OR c.id = (SELECT case_id FROM case_communications WHERE email_id = e.id LIMIT 1)
                LEFT JOIN employees emp ON COALESCE(e.employee_id, c.employee_id) = emp.id
                ORDER BY e.id DESC
                LIMIT 200
                """
            ).fetchall()
            raw_emails = [dict(r) for r in em_rows]
        except Exception as exc_em:
            print(f"Warning loading emails in workbench: {exc_em}")

        try:
            cm_rows = conn.execute(
                """
                SELECT cm.*,
                       c.case_number,
                       c.title AS case_title,
                       c.category AS case_category,
                       c.status AS case_status,
                       c.priority AS case_priority,
                       c.email_id AS source_email_id,
                       emp.name AS employee_name,
                       emp.employee_id AS emp_code,
                       emp.department AS emp_department
                FROM case_communications cm
                LEFT JOIN cases c ON cm.case_id = c.id
                LEFT JOIN employees emp ON c.employee_id = emp.id
                ORDER BY cm.id DESC
                LIMIT 100
                """
            ).fetchall()
            all_comms = [dict(r) for r in cm_rows]
        except Exception as exc_cm:
            print(f"Warning loading comms in workbench: {exc_cm}")
            all_comms = []

        try:
            ha_rows = conn.execute(
                """
                SELECT * FROM hr_actions
                WHERE LOWER(requested_by) = LOWER(?)
                   OR LOWER(requested_by) LIKE LOWER(?)
                ORDER BY id DESC
                LIMIT 50
                """,
                (agent_name, like_pattern),
            ).fetchall()
            my_hr_actions = [dict(r) for r in ha_rows]
        except Exception as exc_ha:
            print(f"Warning loading hr_actions in workbench: {exc_ha}")

        try:
            al_rows = conn.execute(
                """
                SELECT * FROM audit_logs
                WHERE LOWER(performed_by) = LOWER(?)
                   OR LOWER(performed_by) = LOWER(?)
                   OR LOWER(performed_by) LIKE LOWER(?)
                ORDER BY id DESC
                LIMIT 60
                """,
                (agent_name, agent_email, like_pattern),
            ).fetchall()
            my_audits = [dict(r) for r in al_rows]
        except Exception as exc_al:
            print(f"Warning loading audit_logs in workbench: {exc_al}")
        sub_dept_map = {}
        try:
            s_rows = conn.execute(
                "SELECT email, member_name, sub_department FROM hr_department_members WHERE active = 1"
            ).fetchall()
            for sr in s_rows:
                if sr["sub_department"]:
                    if sr["email"]:
                        sub_dept_map[sr["email"].lower()] = sr["sub_department"]
                    if sr["member_name"]:
                        sub_dept_map[sr["member_name"].lower()] = sr["sub_department"]
        except Exception as exc_s:
            print(f"Warning loading sub_departments in workbench: {exc_s}")
    finally:
        conn.close()

    my_case_db_ids = {int(c.get("db_id") or 0) for c in my_cases if c.get("db_id")}
    dept_case_db_ids = {int(c.get("db_id") or 0) for c in dept_cases if c.get("db_id")}
    dept_case_numbers = {str(c.get("case_number") or "") for c in dept_cases if c.get("case_number")}
    my_case_numbers = {str(c.get("case_number") or "") for c in my_cases if c.get("case_number")}

    my_comms = []
    for cm in all_comms:
        cm_dir = str(cm.get("direction") or "OUTBOUND").strip().upper()
        if cm_dir != "OUTBOUND":
            continue
        cm_cat = str(cm.get("case_category") or "").strip().upper()
        if agent_cats and cm_cat and cm_cat not in agent_cats:
            continue
        is_mine_or_dept = (
            (agent_name and (cm.get("sender_name") or "").lower() == agent_name.lower())
            or (len(agent_first_token) >= 3 and agent_first_token in (cm.get("sender_name") or "").lower())
            or int(cm.get("case_id") or 0) in my_case_db_ids
            or int(cm.get("case_id") or 0) in dept_case_db_ids
            or (cm_cat and cm_cat in agent_cats)
        )
        if is_mine_or_dept:
            my_comms.append(cm)

    dept_gmail = (dept_info.get("dept_gmail") or "").strip().lower() if dept_info else ""
    dept_mailboxes = set()
    if agent_email:
        dept_mailboxes.add(agent_email)
    if dept_gmail:
        dept_mailboxes.add(dept_gmail)

    has_all_hr_scope = bool(
        "ALL_HR" in agent_scope
        or "ALL_HR_CATEGORIES" in agent_scope
        or "PEOPLEDESK" in agent_scope
        or (agent_team and agent_team.lower() == "peopledesk")
        or (active_dept_name and active_dept_name.lower() == "peopledesk")
    )

    dept_emails = []
    seen_email_ids = set()
    for em in raw_emails:
        em_id = em.get("id")
        if em_id in seen_email_ids:
            continue

        em_cat = (em.get("category") or em.get("case_category") or "").strip().upper()
        em_account = (em.get("account_email") or "").strip().lower()
        c_num = str(em.get("case_number") or "").strip()
        c_owner = (em.get("case_owner") or em.get("case_assigned_to") or "").strip()
        c_owner_email = (em.get("case_owner_email") or "").strip().lower()
        c_team = (em.get("case_team") or em.get("case_assigned_to") or "").strip()

        # STRICT AGENT MAILBOX ENFORCEMENT:
        # Agent strictly only sees emails received directly on his / her mailbox or department desk!
        if agent_email and em_account and em_account != agent_email and em_account not in dept_mailboxes:
            continue

        # STRICT DEPARTMENT & CATEGORY SCOPE ENFORCEMENT:
        # If a specific department desk is open (e.g. Leave, Payroll), only emails of that department are shown.
        # Desks with ALL_HR scope (like PeopleDesk) handle all HR categories.
        if not has_all_hr_scope and active_dept_id != "ALL":
            if not em_cat or em_cat not in agent_cats:
                continue

        # Department scope inclusion
        is_cat_match = bool(em_cat and em_cat in agent_cats)
        is_team_match = bool(
            (c_num and c_num in dept_case_numbers)
            or (c_team and c_team.lower() in assigned_team_names)
        )
        is_case_mine = bool(
            (c_num and c_num in my_case_numbers)
            or (agent_email and c_owner_email == agent_email)
            or (agent_name and c_owner.lower() == agent_name.lower())
            or (agent_first_token and len(agent_first_token) >= 3 and agent_first_token in c_owner.lower())
        )

        is_dept_mail = bool(
            is_cat_match
            or is_team_match
            or (is_case_mine and is_cat_match)
            or (has_all_hr_scope and active_dept_id == "ALL")
            or has_all_hr_scope
        )
        if not is_dept_mail:
            continue

        seen_email_ids.add(em_id)

        is_received_to_my_email = bool(agent_email and em_account == agent_email)
        # Only emails explicitly assigned to this agent by Admin, Manager, or Lead are "assigned to me"
        is_em_mine = bool(is_case_mine)
        is_claimed_by_other = bool(
            not is_em_mine
            and c_owner
            and c_owner.upper() not in ("UNASSIGNED", "NONE", "PENDING", "HR OPERATIONS")
            and (not c_team or c_owner.lower() != c_team.lower())
            and (not em.get("case_assigned_to") or str(em.get("case_assigned_to")).lower() not in [tn.lower() for tn in assigned_team_names])
            and c_owner_email
            and c_owner_email != agent_email
        )
        is_em_unclaimed = bool(not is_em_mine and not is_claimed_by_other)

        em["is_received_to_my_email"] = is_received_to_my_email
        em["is_assigned_to_me"] = is_em_mine
        em["is_unclaimed"] = is_em_unclaimed
        em["current_step"] = _compute_workflow_step_number(em.get("case_workflow_state"), em.get("case_status"))
        em["total_steps"] = 3

        # Compute SLA status for linked case
        is_case_resolved = bool((em.get("case_status") or "").upper() in ("RESOLVED", "CLOSED"))
        em["is_resolved"] = is_case_resolved
        if em.get("case_due_at"):
            try:
                from backend.models.case import calculate_sla_status
                sla_calc = calculate_sla_status(
                    em.get("case_due_at"),
                    em.get("created_at"),
                    em.get("case_status"),
                    em.get("case_sla_hours") or 48,
                )
                em["sla_status"] = sla_calc.get("sla_status")
                em["sla_display"] = sla_calc.get("due_display")
            except Exception:
                em["sla_status"] = "COMPLETED" if is_case_resolved else "ON_TRACK"
        else:
            em["sla_status"] = "COMPLETED" if is_case_resolved else "ON_TRACK"

        is_urgent_sla = bool(
            not is_case_resolved
            and (
                (em.get("case_priority") or "").upper() in ("CRITICAL", "HIGH")
                or (em.get("sla_status") or "").upper() in ("DUE_SOON", "OVERDUE", "AT_RISK", "BREACHED")
            )
        )
        em["is_urgent_sla"] = is_urgent_sla

        # Attach sub_department if available
        sub_dept_val = None
        if c_owner_email and c_owner_email.lower() in sub_dept_map:
            sub_dept_val = sub_dept_map[c_owner_email.lower()]
        elif c_owner and c_owner.lower() in sub_dept_map:
            sub_dept_val = sub_dept_map[c_owner.lower()]
        if not sub_dept_val:
            if "LEAVE" in em_cat:
                sub_dept_val = "Leave Management"
            elif "ATTEND" in em_cat:
                sub_dept_val = "Attendance & Shifts"
            elif "PAYROLL" in em_cat or "SALARY" in em_cat:
                sub_dept_val = "Salary & Payroll"
            elif "BENEFIT" in em_cat:
                sub_dept_val = "Benefits & Wellness"
            elif "RESIGN" in em_cat:
                sub_dept_val = "HR Operations & Exit"
            else:
                sub_dept_val = "Salary & Payroll"
        em["sub_department"] = sub_dept_val

        cat_display = em_cat if em_cat and em_cat != "UNKNOWN" else "Inquiry"
        if is_received_to_my_email and is_case_mine:
            em["routing_reason"] = f"Direct Mail · Assigned ({cat_display})"
        elif is_received_to_my_email:
            em["routing_reason"] = f"Direct Mail · {cat_display}"
        elif is_case_mine:
            em["routing_reason"] = f"Assigned to {agent_name} ({cat_display})"
        elif is_cat_match:
            em["routing_reason"] = f"{agent_team} Desk ({cat_display})"
        elif is_team_match:
            em["routing_reason"] = f"Assigned to {agent_team}"
        else:
            em["routing_reason"] = f"{agent_team} Queue"

        dept_emails.append(em)

    dept_approvals = [
        ap for ap in approvals_list
        if int(ap.get("case_id") or 0) in my_case_db_ids
        or int(ap.get("case_id") or 0) in dept_case_db_ids
        or (ap.get("category") or "").upper() in agent_cats
    ]

    my_all_tasks = [
        t for t in tasks_list
        if int(t.get("case_id") or 0) in my_case_db_ids
        or int(t.get("case_id") or 0) in dept_case_db_ids
        or (agent_name and (t.get("assigned_to") or "").lower() == agent_name.lower())
        or (agent_team and (t.get("assigned_team") or "").lower() == agent_team.lower())
    ]
    my_open_tasks = [
        t for t in my_all_tasks
        if (t.get("status") or "").upper() not in ("COMPLETED", "CANCELLED")
    ]
    my_completed_tasks = [
        t for t in my_all_tasks
        if (t.get("status") or "").upper() == "COMPLETED"
    ]

    my_active = [c for c in my_cases if (c.get("status") or "").upper() not in ("RESOLVED", "CLOSED")]
    my_resolved = [c for c in my_cases if (c.get("status") or "").upper() in ("RESOLVED", "CLOSED")]
    urgent_cases = [
        c for c in (my_active + unclaimed_cases)
        if (c.get("priority") or "").upper() in ("CRITICAL", "HIGH")
        or (c.get("sla_status") or "").upper() in ("DUE_SOON", "OVERDUE", "AT_RISK", "BREACHED")
    ]

    inbox_emails_count = sum(1 for e in dept_emails if not e.get("is_resolved"))
    my_assigned_emails_count = sum(1 for e in dept_emails if e.get("is_assigned_to_me") and not e.get("is_resolved"))
    urgent_emails_count = sum(1 for e in dept_emails if e.get("is_urgent_sla"))
    resolved_emails_count = sum(1 for e in dept_emails if e.get("is_resolved"))
    unclaimed_emails_count = sum(1 for e in dept_emails if e.get("is_unclaimed") and not e.get("is_resolved"))

    return success_response({
        "agent": {
            **selected_agent,
            "role": agent_role,
            "role_meta": ROLE_METADATA.get(agent_role, ROLE_METADATA["HR_AGENT"]),
            "dept_info": dept_info,
            "allowed_categories": sorted(list(agent_cats)) if agent_cats else ["GENERAL_HR"],
            "permissions": perms,
            "permission_labels": [
                {"code": p, "label": PERMISSION_LABELS.get(p, p.replace("_", " ").title())}
                for p in perms
            ],
            "restricted_capabilities": RESTRICTED_GOVERNANCE_CAPABILITIES,
        },
        "kpis": {
            "my_active_count": len(my_active),
            "dept_unclaimed_count": len(unclaimed_cases),
            "dept_total_count": len(dept_cases),
            "urgent_sla_count": len(urgent_cases),
            "pending_tasks_count": len(my_open_tasks),
            "completed_tasks_count": len(my_completed_tasks),
            "my_resolved_count": len(my_resolved),
            "emails_replied_count": len(my_comms),
            "hrms_actions_count": len(my_hr_actions),
            "dept_emails_count": len(dept_emails),
            "inbox_emails_count": inbox_emails_count,
            "my_assigned_emails_count": my_assigned_emails_count,
            "urgent_emails_count": urgent_emails_count,
            "resolved_emails_count": resolved_emails_count,
            "unclaimed_emails_count": unclaimed_emails_count,
            "dept_approvals_count": len(dept_approvals),
        },
        "my_cases": my_cases,
        "dept_cases": dept_cases,
        "unclaimed_cases": unclaimed_cases,
        "all_cases": dept_cases,
        "dept_emails": dept_emails,
        "tasks": my_all_tasks,
        "my_open_tasks": my_open_tasks,
        "approvals": dept_approvals,
        "my_communications": my_comms,
        "my_hr_actions": my_hr_actions,
        "my_audit_logs": my_audits,
        "workflow_stages": WORKFLOW_STAGES,
        "hrms_actions_catalog": AGENT_HRMS_ACTIONS_CATALOG,
        "all_agents": roster,
    })


@agent_bp.route("/emails/<int:email_id>/claim-or-open", methods=["POST"])
def claim_or_open_agent_email(email_id: int):
    """
    Ensure an email in the Agent's Department Inbox has a linked HR Case in `cases`,
    and optionally claim/assign that case to the logged-in HR Agent.
    """
    payload = request.get_json(silent=True) or {}
    agent_name = (payload.get("agent_name") or request.headers.get("X-HR-User") or "HR Specialist").strip()
    agent_email = (payload.get("agent_email") or request.headers.get("X-HR-Email") or "").strip().lower()
    agent_team = (payload.get("agent_team") or "HR Operations").strip()
    should_claim = bool(payload.get("claim", True))
    now_iso = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        em_row = conn.execute("SELECT * FROM emails WHERE id = ?", (email_id,)).fetchone()
        if not em_row:
            return error_response("NOT_FOUND", f"Email #{email_id} not found.", 404)
        em = dict(em_row)

        existing_case = conn.execute(
            "SELECT * FROM cases WHERE email_id = ? ORDER BY id DESC LIMIT 1",
            (email_id,),
        ).fetchone()

        if existing_case:
            c_dict = dict(existing_case)
            case_db_id = int(c_dict["id"])
            case_number = c_dict["case_number"]
            if should_claim:
                curr_st = (c_dict.get("status") or "NEW").upper()
                next_st = "IN_PROGRESS" if curr_st in ("NEW", "OPEN", "ROUTED", "REVIEW_REQUIRED") else curr_st
                conn.execute(
                    """
                    UPDATE cases
                       SET assigned_user = ?,
                           assigned_user_email = ?,
                           assigned_to = ?,
                           assigned_team = ?,
                           status = ?,
                           workflow_state = COALESCE(workflow_state, 'DOC_VERIFICATION'),
                           updated_at = ?
                     WHERE id = ?
                    """,
                    (agent_name, agent_email, agent_name, agent_team or c_dict.get("assigned_team"), next_st, now_iso, case_db_id),
                )
                conn.commit()
        else:
            case_number = f"CASE-2026-{int(datetime.now(timezone.utc).timestamp()) % 100000:05d}"
            cat = (em.get("category") or "GENERAL_HR").strip().upper()
            intent = (em.get("intent") or "general_inquiry").strip()
            title = (em.get("subject") or f"{cat} Request").strip()
            body = (em.get("body") or "").strip()
            ext_json = em.get("extracted_fields") or "{}"

            assigned_user = agent_name if should_claim else ""
            assigned_to = agent_name if should_claim else agent_team
            status_val = "IN_PROGRESS" if should_claim else "NEW"
            wf_val = "DOC_VERIFICATION" if should_claim else "INTAKE"

            cur_c = conn.execute(
                """
                INSERT INTO cases (
                    case_number, email_id, employee_id, title, description,
                    category, intent, priority, status, workflow_state,
                    assigned_team, assigned_to, assigned_user, assigned_user_email,
                    extracted_fields, sla_hours, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MEDIUM', ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)
                """,
                (
                    case_number,
                    email_id,
                    em.get("employee_id"),
                    title,
                    body,
                    cat,
                    intent,
                    status_val,
                    wf_val,
                    agent_team,
                    assigned_to,
                    assigned_user,
                    agent_email if should_claim else "",
                    ext_json,
                    now_iso,
                    now_iso,
                ),
            )
            case_db_id = int(cur_c.lastrowid)
            conn.commit()
    finally:
        conn.close()

    if should_claim:
        log_event(
            entity_type="CASE",
            entity_id=str(case_number),
            action="EMAIL_CLAIMED_BY_AGENT",
            description=f"{agent_name} claimed department email #{email_id} (Case {case_number})",
            performed_by=agent_name,
        )

    return success_response({
        "email_id": email_id,
        "case_id": case_db_id,
        "case_number": case_number,
        "claimed": should_claim,
        "assigned_user": agent_name if should_claim else "",
    })



@agent_bp.route("/cases/<case_ref>/detail", methods=["GET"])
def get_agent_case_detail(case_ref: str):
    """
    Return complete 360° case execution context for the HR Agent Workbench:
    formatted case record, source email content, matched employee profile,
    verification tasks, approvals, communications, HRMS actions history,
    audit timeline, and pre-filled smart reply templates.
    """
    from backend.models.case import get_case_by_id_or_number
    from backend.services.workflows.workflow_service import build_workflow_preview_for_category

    case_obj = get_case_by_id_or_number(case_ref)
    if not case_obj:
        return error_response("NOT_FOUND", f"Case '{case_ref}' not found.", 404)

    db_id = int(case_obj["db_id"])
    case_number = case_obj["case_number"]
    stages_list, cur_step, total_steps = _get_case_stages_and_step(case_obj)
    case_obj["current_step"] = cur_step
    case_obj["total_steps"] = total_steps
    case_obj["workflow_stages"] = stages_list

    conn = get_connection()
    try:
        email_obj = None
        if case_obj.get("email_id"):
            e_row = conn.execute("SELECT * FROM emails WHERE id = ?", (case_obj["email_id"],)).fetchone()
            if e_row:
                email_obj = dict(e_row)

        emp_obj = None
        c_emp_ref = case_obj.get("employee_id") or case_obj.get("employee_db_id")
        if c_emp_ref:
            if isinstance(c_emp_ref, int) or (isinstance(c_emp_ref, str) and str(c_emp_ref).isdigit()):
                emp_row = conn.execute("SELECT * FROM employees WHERE id = ?", (int(c_emp_ref),)).fetchone()
                if emp_row:
                    emp_obj = dict(emp_row)
            if not emp_obj:
                emp_row = conn.execute(
                    "SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?)",
                    (str(c_emp_ref).strip(),),
                ).fetchone()
                if emp_row:
                    emp_obj = dict(emp_row)
        if not emp_obj and case_obj.get("sender_email"):
            emp_row = conn.execute(
                "SELECT * FROM employees WHERE LOWER(email) = LOWER(?)",
                (case_obj["sender_email"].strip(),),
            ).fetchone()
            if emp_row:
                emp_obj = dict(emp_row)
        if not emp_obj and email_obj and email_obj.get("sender_email"):
            emp_row = conn.execute(
                "SELECT * FROM employees WHERE LOWER(email) = LOWER(?)",
                (email_obj["sender_email"].strip(),),
            ).fetchone()
            if emp_row:
                emp_obj = dict(emp_row)

        if emp_obj:
            emp_obj["is_in_db"] = True
        else:
            emp_name = case_obj.get("employee_name") or (email_obj and email_obj.get("sender_name")) or "Employee"
            emp_code = case_obj.get("employee_id") or case_obj.get("employee_code") or (email_obj and email_obj.get("employee_code")) or ""
            emp_dept = case_obj.get("department") or case_obj.get("employee_department") or (email_obj and email_obj.get("department")) or "Operations"
            emp_email = case_obj.get("employee_email") or case_obj.get("sender_email") or (email_obj and email_obj.get("sender_email")) or ""
            emp_obj = {
                "id": None,
                "name": emp_name,
                "employee_id": emp_code,
                "department": emp_dept,
                "designation": "Staff Specialist",
                "email": emp_email,
                "manager_name": "Department Manager",
                "location": "Corporate Headquarters",
                "is_in_db": False,
            }

        tasks_rows = conn.execute(
            "SELECT * FROM tasks WHERE case_id = ? ORDER BY id ASC",
            (db_id,),
        ).fetchall()
        tasks_list = [dict(r) for r in tasks_rows]

        approvals_rows = conn.execute(
            "SELECT * FROM approvals WHERE case_id = ? ORDER BY id DESC",
            (db_id,),
        ).fetchall()
        approvals_list = [dict(r) for r in approvals_rows]

        comms_rows = conn.execute(
            "SELECT * FROM case_communications WHERE case_id = ? ORDER BY id DESC LIMIT 20",
            (db_id,),
        ).fetchall()
        comms_list = [dict(r) for r in comms_rows]

        docs_rows = conn.execute(
            "SELECT * FROM case_documents WHERE case_id = ? ORDER BY id DESC",
            (db_id,),
        ).fetchall()
        docs_list = [dict(r) for r in docs_rows]

        actions_rows = conn.execute(
            "SELECT * FROM hr_actions WHERE case_id = ? ORDER BY id DESC LIMIT 15",
            (db_id,),
        ).fetchall()
        actions_list = []
        for r in actions_rows:
            ad = dict(r)
            if isinstance(ad.get("response_payload"), str):
                try:
                    resp_p = json.loads(ad["response_payload"])
                    ad["parsed_response"] = resp_p
                    if isinstance(resp_p, dict):
                        if resp_p.get("title"):
                            ad["title"] = resp_p["title"]
                        if resp_p.get("details"):
                            ad["details"] = resp_p["details"]
                except Exception:
                    pass
            actions_list.append(ad)

        audit_rows = conn.execute(
            """
            SELECT * FROM audit_logs
            WHERE (entity_type = 'CASE' AND entity_id = ?)
               OR (entity_type = 'CASE' AND entity_id = ?)
            ORDER BY id DESC LIMIT 30
            """,
            (str(db_id), str(case_number)),
        ).fetchall()
        audit_list = [dict(r) for r in audit_rows]
    finally:
        conn.close()

    cat_upper = (case_obj.get("category") or "DEFAULT").upper()
    tpl_group = SMART_REPLY_TEMPLATES.get(cat_upper, SMART_REPLY_TEMPLATES["DEFAULT"])
    agent_name = request.headers.get("X-HR-User") or case_obj.get("assigned_user") or "HR Specialist"
    fmt_kwargs = {
        "employee_name": case_obj.get("employee_name") or "Employee",
        "subject": case_obj.get("title") or "your HR request",
        "case_number": case_number,
        "agent_name": agent_name,
        "agent_designation": "HR Operations Specialist",
        "agent_team": case_obj.get("assigned_team") or "HR Operations",
    }
    smart_draft_update = tpl_group["UPDATE"].format(**fmt_kwargs)
    smart_draft_request_info = tpl_group["REQUEST_INFO"].format(**fmt_kwargs)

    from backend.services.playbooks.playbook_service import get_playbook_for_category
    cat_playbook = get_playbook_for_category(case_obj.get("category") or "GENERAL_HR")

    from backend.services.cases.feedback_service import get_case_feedback
    case_feedback_obj = get_case_feedback(case_number)

    return success_response({
        "case": case_obj,
        "email": email_obj,
        "employee": emp_obj,
        "tasks": tasks_list,
        "approvals": approvals_list,
        "communications": comms_list,
        "documents": docs_list,
        "hr_actions": actions_list,
        "audit_logs": audit_list,
        "workflow": build_workflow_preview_for_category(case_obj.get("category") or "GENERAL_HR", case_id=db_id),
        "workflow_stages": stages_list,
        "hrms_actions_catalog": AGENT_HRMS_ACTIONS_CATALOG,
        "smart_reply_draft": case_obj.get("draft_reply") or smart_draft_update,
        "active_draft": case_obj.get("draft_reply") or smart_draft_update,
        "smart_templates": {
            "UPDATE": smart_draft_update,
            "REQUEST_INFO": smart_draft_request_info,
        },
        "playbook": cat_playbook,
        "feedback": case_feedback_obj,
    })


@agent_bp.route("/cases/<case_ref>/claim", methods=["POST"])
def claim_agent_case(case_ref: str):
    """Allow an HR Agent to self-claim an unassigned case into their personal queue."""
    payload = request.get_json(silent=True) or {}
    agent_name = (payload.get("agent_name") or request.headers.get("X-HR-User") or "HR Agent").strip()
    agent_email = (payload.get("agent_email") or request.headers.get("X-HR-Email") or "").strip().lower()
    agent_team = (payload.get("agent_team") or "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        case_dict = _resolve_case_row_by_ref(conn, case_ref)
        if not case_dict:
            return error_response("NOT_FOUND", f"Case '{case_ref}' not found.", 404)
        db_id = int(case_dict["id"])
        case_number = case_dict["case_number"]
        new_team = agent_team or case_dict.get("assigned_team") or "HR Operations"
        curr_status = (case_dict.get("status") or "NEW").upper()
        new_status = "IN_PROGRESS" if curr_status in ("NEW", "OPEN", "ROUTED", "REVIEW_REQUIRED") else curr_status
        new_wf = case_dict.get("workflow_state") or "DOC_VERIFICATION"

        conn.execute(
            """
            UPDATE cases
               SET assigned_user = ?,
                   assigned_user_email = ?,
                   assigned_to = ?,
                   assigned_team = ?,
                   status = ?,
                   workflow_state = ?,
                   updated_at = ?
             WHERE id = ?
            """,
            (agent_name, agent_email, agent_name, new_team, new_status, new_wf, now_iso, db_id),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=str(case_number),
        action="CASE_CLAIMED_BY_AGENT",
        description=f"Case {case_number} self-claimed by {agent_name} ({new_team})",
        performed_by=agent_name,
    )
    return success_response({
        "claimed": True,
        "case_id": db_id,
        "case_number": case_number,
        "assigned_user": agent_name,
        "assigned_to": agent_name,
        "status": new_status,
    })


@agent_bp.route("/cases/<case_ref>/reassign", methods=["POST"])
def reassign_agent_case(case_ref: str):
    """
    Allow an HR Agent (or Lead/Admin) to reassign a case to another specialist
    under a specific sub-category (Salary & Payroll, Leave Management, Attendance, etc.).
    """
    from backend.services.cases.case_service import assign_case, get_full_case_detail
    payload = request.get_json(silent=True) or {}
    actor_name = (payload.get("performed_by") or payload.get("agent_name") or request.headers.get("X-HR-User") or "HR Agent").strip()
    actor_role = (payload.get("role") or request.headers.get("X-HR-Role") or "HR_AGENT").strip().upper()
    target_user = (payload.get("target_user") or payload.get("user") or "").strip()
    target_email = (payload.get("target_email") or payload.get("user_email") or "").strip()
    target_team = (payload.get("team") or payload.get("assigned_team") or "PeopleDesk").strip()
    sub_dept = (payload.get("sub_department") or payload.get("sub_dept") or "").strip()
    prio = payload.get("priority")
    note = (payload.get("note") or payload.get("dispatch_note") or "").strip()
    send_email = bool(payload.get("send_email", True))

    if not target_user:
        return error_response("VALIDATION_ERROR", "Target specialist is required for reassignment.", 400)

    dispatch_note_full = f"[Sub-Dept: {sub_dept}] {note}" if sub_dept else note

    try:
        updated = assign_case(
            identifier=case_ref,
            team=target_team,
            user=target_user,
            user_email=target_email,
            priority=prio,
            send_email=send_email,
            dispatch_note=dispatch_note_full,
            performed_by=actor_name,
            role=actor_role,
        )
        detail = get_full_case_detail(updated["db_id"], role=actor_role)
        return success_response({
            "reassigned": True,
            "case": updated,
            "sub_department": sub_dept,
            "target_user": target_user,
            "target_email": target_email,
            "detail": detail,
        })
    except PermissionError as pe:
        return error_response("FORBIDDEN", str(pe), 403)
    except ValueError as ve:
        return error_response("ASSIGN_ERROR", str(ve), 400)
    except Exception as e:
        return error_response("SERVER_ERROR", str(e), 500)


@agent_bp.route("/cases/<case_ref>/action", methods=["POST"])
def execute_agent_case_action(case_ref: str):
    """
    Unified case execution endpoint for HR Agent Workbench:
      - action_type = 'SEND_REPLY' | 'REQUEST_INFO' (sends Gmail reply & logs communication)
      - action_type = 'RESOLVE' (resolves case with notes + optional email notification)
      - action_type = 'UPDATE_STATUS' (changes status / priority)
      - action_type = 'NEXT_STEP' | 'SET_STEP' (advances workflow stage)
      - action_type = 'ACCEPT_AI' (confirms AI classification & clears review flag)
      - action_type = 'EXECUTE_HRMS_ACTION' (runs low/medium risk HRMS verification action)
      - action_type = 'REQUEST_APPROVAL' (submits approval request to HR Lead / Manager)
      - action_type = 'ESCALATE' (escalates case to HR Lead / Manager)
      - action_type = 'ADD_TASK' | 'TOGGLE_TASK' (manages case verification checklist)
    """
    from backend.models.case import get_case_by_id_or_number
    from backend.services.workflows.workflow_service import build_workflow_preview_for_category

    payload = request.get_json(silent=True) or {}
    action_type = (payload.get("action_type") or "").strip().upper()
    performed_by = (payload.get("performed_by") or request.headers.get("X-HR-User") or "HR Agent").strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        case_obj = _resolve_case_row_by_ref(conn, case_ref)
        if not case_obj:
            return error_response("NOT_FOUND", f"Case '{case_ref}' not found.", 404)
        db_id = int(case_obj["id"])
        case_number = case_obj["case_number"]

        # Resolve sender email from linked email if needed
        recipient_email = (payload.get("recipient_email") or "").strip()
        if not recipient_email and case_obj.get("email_id"):
            em_row = conn.execute("SELECT sender_email FROM emails WHERE id = ?", (case_obj["email_id"],)).fetchone()
            if em_row and em_row["sender_email"]:
                recipient_email = em_row["sender_email"].strip()

        smtp_result = None
        action_result_meta = {}

        if action_type in ("SEND_REPLY", "REQUEST_INFO"):
            reply_body = (payload.get("reply_body") or "").strip()
            if not reply_body:
                return error_response("VALIDATION_ERROR", "Reply message body cannot be empty.", 400)
            is_req_info = action_type == "REQUEST_INFO"
            subj_prefix = "Action Required: Missing Information" if is_req_info else "HR Update"
            subj = f"Re: [{case_number}] {case_obj.get('title') or subj_prefix}"
            html_body = (
                f"<div style='font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;'>"
                f"{html_lib.escape(reply_body).replace(chr(10), '<br>')}"
                f"<hr style='border:none;border-top:1px solid #e2e8f0;margin:18px 0;'>"
                f"<div style='font-size:12px;color:#64748b;'>HR Flow Case Reference: <strong>{html_lib.escape(str(case_number))}</strong> · Handled by {html_lib.escape(performed_by)}</div>"
                f"</div>"
            )
            if recipient_email and "@" in recipient_email:
                smtp_result = send_gmail_smtp_email(
                    recipient_email=recipient_email,
                    subject=subj,
                    body_text=reply_body,
                    body_html=html_body,
                )
            next_status = "ON_HOLD" if is_req_info else (payload.get("next_status") or "IN_PROGRESS")
            conn.execute(
                "UPDATE cases SET status = ?, updated_at = ? WHERE id = ?",
                (next_status, now_iso, db_id),
            )
            conn.execute(
                """
                INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
                VALUES (?, ?, 'HR_AGENT', ?, ?, ?, ?, ?)
                """,
                (
                    db_id,
                    case_obj.get("email_id"),
                    performed_by,
                    recipient_email or "employee",
                    subj,
                    reply_body,
                    "REQUEST_INFO" if is_req_info else "AGENT_REPLY",
                ),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="INFO_REQUESTED_BY_AGENT" if is_req_info else "AGENT_GMAIL_REPLY_SENT",
                description=f"{performed_by} sent {'missing-info request' if is_req_info else 'official reply'} to {recipient_email or 'employee'} (Status -> {next_status})",
                performed_by=performed_by,
            )

        elif action_type == "RESOLVE":
            res_type = (payload.get("resolution_type") or "AGENT_RESOLVED").strip().upper()
            ref_id = (payload.get("reference_id") or "").strip()
            adj_amt = (payload.get("adjustment_amount") or "").strip()
            notes = (payload.get("resolution_notes") or payload.get("reply_body") or "Verified and resolved by HR Specialist.").strip()

            proof_payload = payload.get("forensic_proof") or {"proofId": ref_id, "amount": adj_amt}
            proof_json = json.dumps(proof_payload) if isinstance(proof_payload, dict) else str(proof_payload)

            full_notes = notes
            meta_items = []
            if ref_id and ref_id not in full_notes:
                meta_items.append(f"Reference / UTR: {ref_id}")
            if adj_amt and adj_amt not in full_notes:
                meta_items.append(f"Adjustment: {adj_amt}")
            if meta_items:
                full_notes = f"{full_notes}\n\n[{' · '.join(meta_items)}]"

            conn.execute(
                """
                UPDATE cases
                   SET status = 'RESOLVED',
                       workflow_state = 'RESOLVED',
                       resolution_type = ?,
                       resolution_notes = ?,
                       forensic_proof = ?,
                       draft_reply = NULL,
                       resolved_by = ?,
                       resolved_at = ?,
                       updated_at = ?
                 WHERE id = ?
                """,
                (res_type, full_notes, proof_json, performed_by, now_iso, now_iso, db_id),
            )
            conn.commit()
            if payload.get("notify_employee", True) and recipient_email and "@" in recipient_email:
                subj = f"[Resolved · {case_number}] {case_obj.get('title') or 'HR Request Resolved'}"
                portal_url = Config.get_portal_base_url().rstrip("/")
                fb_url_base = f"{portal_url}/feedback.html?case={case_number}"
                csat_survey_html = (
                    f"<div style='margin:18px 0;padding:16px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;text-align:center;'>"
                    f"<div style='font-size:13px;font-weight:700;color:#166534;margin-bottom:4px;'>How was your support experience?</div>"
                    f"<div style='font-size:12px;color:#15803d;margin-bottom:12px;'>Rate your experience to help us improve People Operations services:</div>"
                    f"<div style='display:inline-flex;gap:8px;justify-content:center;flex-wrap:wrap;'>"
                    f"<a href='{fb_url_base}&rating=1' style='text-decoration:none;display:inline-block;padding:6px 12px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#334155;font-weight:700;'>⭐ 1 Poor</a>"
                    f"<a href='{fb_url_base}&rating=2' style='text-decoration:none;display:inline-block;padding:6px 12px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#334155;font-weight:700;'>⭐ 2 Fair</a>"
                    f"<a href='{fb_url_base}&rating=3' style='text-decoration:none;display:inline-block;padding:6px 12px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#334155;font-weight:700;'>⭐ 3 Good</a>"
                    f"<a href='{fb_url_base}&rating=4' style='text-decoration:none;display:inline-block;padding:6px 12px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#334155;font-weight:700;'>⭐ 4 Great</a>"
                    f"<a href='{fb_url_base}&rating=5' style='text-decoration:none;display:inline-block;padding:6px 12px;background:#059669;color:#ffffff;border-radius:6px;font-size:12px;font-weight:700;'>⭐ 5 Excellent</a>"
                    f"</div>"
                    f"</div>"
                )
                html_body = (
                    f"<div style='font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:620px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;'>"
                    f"<div style='background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;padding:20px 24px;'>"
                    f"<div style='font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;opacity:0.9;'>PeopleDesk · HR Operations Desk</div>"
                    f"<h2 style='margin:4px 0 0 0;font-size:20px;font-weight:800;'>✓ Query Resolved: {html_lib.escape(str(case_number))}</h2>"
                    f"</div>"
                    f"<div style='padding:24px;background:#ffffff;'>"
                    f"<p style='margin:0 0 16px 0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;'>{html_lib.escape(notes)}</p>"
                    f"<div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:18px 0;font-size:12px;color:#64748b;display:grid;grid-template-columns:1fr 1fr;gap:8px;'>"
                    f"<div><strong>Resolution Type:</strong> {html_lib.escape(res_type)}</div>"
                    f"<div><strong>Reference ID:</strong> {html_lib.escape(ref_id or 'N/A')}</div>"
                    f"<div><strong>Resolved By:</strong> {html_lib.escape(performed_by)}</div>"
                    f"<div><strong>Date &amp; Time:</strong> {html_lib.escape(now_iso)}</div>"
                    f"</div>"
                    f"{csat_survey_html}"
                    f"<hr style='border:none;border-top:1px solid #e2e8f0;margin:18px 0;'>"
                    f"<div style='font-size:11px;color:#94a3b8;'>This is an official resolution notification from PeopleDesk HR Flow. For questions or further assistance, reply directly to this email.</div>"
                    f"</div>"
                    f"</div>"
                )
                smtp_result = send_gmail_smtp_email(
                    recipient_email=recipient_email,
                    subject=subj,
                    body_text=full_notes,
                    body_html=html_body,
                )
                conn.execute(
                    """
                    INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
                    VALUES (?, ?, 'HR_AGENT', ?, ?, ?, ?, 'RESOLUTION_NOTICE')
                    """,
                    (db_id, case_obj.get("email_id"), performed_by, recipient_email, subj, full_notes),
                )
                conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="CASE_RESOLVED_BY_AGENT",
                description=f"{performed_by} resolved Case #{case_number} ({res_type}{f', Ref: {ref_id}' if ref_id else ''}): {notes[:140]}",
                performed_by=performed_by,
            )

        elif action_type == "UPDATE_STATUS":
            new_status = (payload.get("status") or case_obj.get("status") or "IN_PROGRESS").strip().upper()
            new_prio = (payload.get("priority") or case_obj.get("priority") or "MEDIUM").strip().upper()
            conn.execute(
                "UPDATE cases SET status = ?, priority = ?, updated_at = ? WHERE id = ?",
                (new_status, new_prio, now_iso, db_id),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="STATUS_CHANGED",
                description=f"{performed_by} updated status to {new_status} (Priority: {new_prio})",
                performed_by=performed_by,
            )

        elif action_type in ("NEXT_STEP", "SET_STEP"):
            stages_list, curr, total_st = _get_case_stages_and_step(case_obj)
            target_step = int(payload.get("step") or (curr + 1))
            target_step = max(1, min(target_step, total_st))
            stage_info = stages_list[target_step - 1]
            new_wf = stage_info["code"]
            is_last = (target_step == total_st or stage_info.get("stage_type") == "RESOLUTION")
            new_status = (payload.get("status") or ("READY" if is_last else "IN_PROGRESS")).strip().upper()
            conn.execute(
                "UPDATE cases SET workflow_state = ?, status = ?, updated_at = ? WHERE id = ?",
                (new_wf, new_status, now_iso, db_id),
            )
            draft_notes = (payload.get("draft_notes") or "").strip()
            if draft_notes:
                conn.execute(
                    """
                    INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
                    VALUES (?, ?, 'HR_AGENT', ?, ?, ?, ?, 'SAVED_DRAFT')
                    """,
                    (db_id, case_obj.get("email_id"), performed_by, recipient_email or "draft", f"Draft saved at Step {target_step}", draft_notes),
                )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="WORKFLOW_STEP_SAVED",
                description=f"{performed_by} saved workflow at Step {target_step}/{total_st} ({stage_info['label']}) [Status: {new_status}]",
                performed_by=performed_by,
            )

        elif action_type == "ADD_STAGE":
            label = (payload.get("label") or payload.get("title") or "Custom Stage").strip()
            desc = (payload.get("description") or payload.get("desc") or "Dynamic specialist verification stage").strip()
            stype = (payload.get("stage_type") or "AUDIT").strip().upper()

            stages_list, _, _ = _get_case_stages_and_step(case_obj)
            stages_copy = [dict(s) for s in stages_list]

            # Insert before final resolution stage if present, else append
            insert_idx = len(stages_copy)
            if stages_copy and stages_copy[-1].get("stage_type") == "RESOLUTION":
                insert_idx = len(stages_copy) - 1

            new_code = f"STAGE_{uuid.uuid4().hex[:6].upper()}"
            clean_label = re.sub(r"^\d+\.\s*", "", label)
            new_stage = {
                "step": insert_idx + 1,
                "code": new_code,
                "label": f"{insert_idx + 1}. {clean_label}",
                "desc": desc,
                "stage_type": stype,
                "is_custom": True,
            }
            stages_copy.insert(insert_idx, new_stage)
            for idx, s in enumerate(stages_copy, 1):
                s["step"] = idx
                s["label"] = f"{idx}. " + re.sub(r"^\d+\.\s*", "", s["label"])

            stages_json = json.dumps(stages_copy)
            conn.execute(
                "UPDATE cases SET workflow_stages = ?, updated_at = ? WHERE id = ?",
                (stages_json, now_iso, db_id),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="STAGE_ADDED",
                description=f"{performed_by} added custom workflow stage '{new_stage['label']}' ({stype})",
                performed_by=performed_by,
            )
            action_result_meta = {"workflow_stages": stages_copy, "added_stage": new_stage}

        elif action_type == "DELETE_STAGE":
            target_step = int(payload.get("step") or 0)
            stages_list, _, _ = _get_case_stages_and_step(case_obj)
            stages_copy = [dict(s) for s in stages_list]
            if 1 <= target_step <= len(stages_copy) and len(stages_copy) > 1:
                removed = stages_copy.pop(target_step - 1)
                for idx, s in enumerate(stages_copy, 1):
                    s["step"] = idx
                    s["label"] = f"{idx}. " + re.sub(r"^\d+\.\s*", "", s["label"])
                stages_json = json.dumps(stages_copy)
                conn.execute(
                    "UPDATE cases SET workflow_stages = ?, updated_at = ? WHERE id = ?",
                    (stages_json, now_iso, db_id),
                )
                conn.commit()
                log_event(
                    entity_type="CASE",
                    entity_id=str(case_number),
                    action="STAGE_DELETED",
                    description=f"{performed_by} removed workflow stage '{removed['label']}'",
                    performed_by=performed_by,
                )
                action_result_meta = {"workflow_stages": stages_copy, "removed_stage": removed}

        elif action_type == "ACCEPT_AI":
            if case_obj.get("email_id"):
                conn.execute(
                    "UPDATE emails SET requires_review = 0, decision_status = 'ACCEPTED', updated_at = ? WHERE id = ?",
                    (now_iso, case_obj["email_id"]),
                )
            new_status = "IN_PROGRESS" if (case_obj.get("status") or "").upper() in ("NEW", "REVIEW_REQUIRED") else case_obj.get("status")
            conn.execute(
                "UPDATE cases SET status = ?, workflow_state = 'DOC_VERIFICATION', updated_at = ? WHERE id = ?",
                (new_status, now_iso, db_id),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="AI_CLASSIFICATION_ACCEPTED",
                description=f"{performed_by} verified & accepted AI classification ({case_obj.get('category')} / {case_obj.get('intent')})",
                performed_by=performed_by,
            )

        elif action_type in ("REGISTER_EMPLOYEE", "UPDATE_EMPLOYEE"):
            emp_name = (payload.get("name") or payload.get("employee_name") or "").strip()
            emp_code = (payload.get("employee_id") or payload.get("employee_code") or "").strip().upper()
            emp_email = (payload.get("email") or payload.get("employee_email") or "").strip().lower()
            emp_dept = (payload.get("department") or "IT").strip()
            emp_desig = (payload.get("designation") or "Staff Specialist").strip()
            emp_mgr = (payload.get("manager_name") or "Department Manager").strip()
            emp_loc = (payload.get("location") or "Corporate Headquarters").strip()

            if not emp_name:
                return error_response("VALIDATION_ERROR", "Employee name is required.", 400)
            if not emp_code:
                emp_code = f"EMP{int(datetime.now(timezone.utc).timestamp()) % 10000:04d}"

            # Check if employee with this code or email already exists in employees table
            existing_emp = None
            if emp_code:
                existing_emp = conn.execute(
                    "SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?)",
                    (emp_code,),
                ).fetchone()
            if not existing_emp and emp_email:
                existing_emp = conn.execute(
                    "SELECT * FROM employees WHERE LOWER(email) = LOWER(?)",
                    (emp_email,),
                ).fetchone()

            if existing_emp:
                target_emp_id = int(existing_emp["id"])
                conn.execute(
                    """
                    UPDATE employees
                       SET name = ?,
                           employee_id = ?,
                           email = ?,
                           department = ?,
                           designation = ?,
                           manager_name = ?,
                           location = ?,
                           updated_at = ?
                     WHERE id = ?
                    """,
                    (emp_name, emp_code, emp_email or existing_emp["email"], emp_dept, emp_desig, emp_mgr, emp_loc, now_iso, target_emp_id),
                )
            else:
                cur = conn.execute(
                    """
                    INSERT INTO employees (
                        employee_id, name, email, department, designation, manager_name, location, source, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent_verified', ?, ?)
                    """,
                    (emp_code, emp_name, emp_email, emp_dept, emp_desig, emp_mgr, emp_loc, now_iso, now_iso),
                )
                target_emp_id = int(cur.lastrowid)

            # Link case and email to this employee
            conn.execute(
                "UPDATE cases SET employee_id = ?, updated_at = ? WHERE id = ?",
                (target_emp_id, now_iso, db_id),
            )
            if case_obj.get("email_id"):
                conn.execute(
                    "UPDATE emails SET employee_id = ?, updated_at = ? WHERE id = ?",
                    (target_emp_id, now_iso, case_obj["email_id"]),
                )
            conn.commit()

            log_event(
                entity_type="EMPLOYEE",
                entity_id=str(emp_code),
                action="EMPLOYEE_REGISTERED_BY_AGENT" if not existing_emp else "EMPLOYEE_UPDATED_BY_AGENT",
                description=f"{performed_by} {'registered' if not existing_emp else 'updated'} employee {emp_name} ({emp_code}, {emp_dept}) and linked to Case #{case_number}",
                performed_by=performed_by,
            )
            action_result_meta = {
                "employee_id": target_emp_id,
                "employee_code": emp_code,
                "name": emp_name,
                "is_new": not bool(existing_emp)
            }

        elif action_type in ("EXECUTE_HRMS_ACTION", "EXECUTE_ACTION", "CREATE_AND_EXECUTE_ACTION"):
            custom_title = (payload.get("title") or payload.get("action_name") or "").strip()
            custom_provider = (payload.get("provider") or payload.get("system") or "").strip()
            custom_details = (payload.get("details") or payload.get("notes") or payload.get("summary") or "").strip()
            custom_risk = (payload.get("risk_level") or "LOW").strip().upper()

            hrms_code = (payload.get("hrms_action_code") or payload.get("action_code") or "").strip().upper()
            if not hrms_code:
                if custom_title:
                    hrms_code = re.sub(r'[^A-Z0-9]+', '_', custom_title.upper()).strip('_')
                else:
                    hrms_code = "CUSTOM_CHECK"

            # Check catalog first
            cat_match = next((a for a in AGENT_HRMS_ACTIONS_CATALOG if a["code"] == hrms_code), None)
            if cat_match:
                cat_entry = {
                    "code": hrms_code,
                    "title": custom_title or cat_match.get("title") or hrms_code.replace("_", " ").title(),
                    "provider": custom_provider or cat_match.get("provider") or "Enterprise API",
                    "risk_level": custom_risk if payload.get("risk_level") else cat_match.get("risk_level", "LOW"),
                    "summary": custom_details or cat_match.get("summary") or f"Executed {hrms_code}",
                }
            else:
                cat_entry = {
                    "code": hrms_code,
                    "title": custom_title or hrms_code.replace("_", " ").title(),
                    "provider": custom_provider or "Enterprise Gateway",
                    "risk_level": custom_risk or "LOW",
                    "summary": custom_details or f"Executed dynamic check '{custom_title or hrms_code}'",
                }

            act_code = f"ACT-{db_id}-{int(datetime.now(timezone.utc).timestamp())}"
            idem_key = f"agent-{db_id}-{hrms_code}-{int(datetime.now(timezone.utc).timestamp())}"
            final_details = custom_details or f"Successfully executed '{cat_entry['title']}' via {cat_entry['provider']} for Case #{case_number}. All verification checks passed."
            status_verdict = (payload.get("status") or "VERIFIED").strip().upper()
            ext_ref = (payload.get("external_reference") or payload.get("reference_id") or f"REF-{int(datetime.now(timezone.utc).timestamp())}").strip()

            resp_summary = {
                "status": status_verdict,
                "action_code": hrms_code,
                "title": cat_entry["title"],
                "provider": cat_entry["provider"],
                "risk_level": cat_entry["risk_level"],
                "verified_by": performed_by,
                "timestamp": now_iso,
                "details": final_details,
                "external_reference": ext_ref,
            }
            conn.execute(
                """
                INSERT INTO hr_actions (
                    action_code, idempotency_key, case_id, case_number, employee_id, employee_name,
                    action_type, provider, risk_level, status, attempt_count,
                    request_payload, response_payload, external_reference, requested_by, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 1, ?, ?, ?, ?, ?)
                """,
                (
                    act_code,
                    idem_key,
                    db_id,
                    case_number,
                    str(case_obj.get("employee_id") or "EMP"),
                    case_obj.get("employee_name") or case_obj.get("sender_name") or "Employee",
                    hrms_code,
                    cat_entry["provider"],
                    cat_entry["risk_level"],
                    json.dumps({"case_number": case_number, "triggered_by": performed_by, "custom_title": cat_entry["title"]}),
                    json.dumps(resp_summary),
                    ext_ref,
                    performed_by,
                    now_iso,
                ),
            )
            conn.execute(
                "UPDATE cases SET workflow_state = 'HRMS_ACTION_APPROVAL', status = 'IN_PROGRESS', updated_at = ? WHERE id = ?",
                (now_iso, db_id),
            )
            conn.commit()
            action_result_meta = resp_summary
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="ACTION_EXECUTED",
                description=f"{performed_by} executed Action '{cat_entry['title']}' ({cat_entry['provider']}): {final_details[:140]}",
                performed_by=performed_by,
            )

        elif action_type == "REQUEST_APPROVAL":
            approval_type = (payload.get("approval_type") or "HIGH_RISK_ACTION_SIGN_OFF").strip().upper()
            approver_role = (payload.get("approver_role") or "HR_MANAGER").strip().upper()
            comments = (payload.get("comments") or "Agent requested Manager/Lead sign-off for policy/high-risk action.").strip()
            app_code = f"APR-{db_id}-{int(datetime.now(timezone.utc).timestamp()) % 100000}"
            conn.execute(
                """
                INSERT INTO approvals (
                    approval_code, case_id, approval_type, approver, approver_role,
                    status, requested_by, requested_at, comments
                ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
                """,
                (
                    app_code,
                    db_id,
                    approval_type,
                    "HR Operations Manager" if approver_role == "HR_MANAGER" else "HR Team Lead",
                    approver_role,
                    performed_by,
                    now_iso,
                    comments,
                ),
            )
            conn.execute(
                "UPDATE cases SET status = 'ON_HOLD', workflow_state = 'HRMS_ACTION_APPROVAL', updated_at = ? WHERE id = ?",
                (now_iso, db_id),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="APPROVAL_REQUESTED_BY_AGENT",
                description=f"{performed_by} requested {approver_role} approval ({app_code}): {comments}",
                performed_by=performed_by,
            )

        elif action_type == "ESCALATE":
            reason = (payload.get("reason") or "Escalated by HR Specialist for Lead/Manager intervention.").strip()
            conn.execute(
                "UPDATE cases SET status = 'REVIEW_REQUIRED', priority = 'CRITICAL', workflow_state = 'ESCALATED_TO_LEAD', updated_at = ? WHERE id = ?",
                (now_iso, db_id),
            )
            conn.execute(
                """
                INSERT INTO notifications (notif_type, title, message, case_id, case_number, recipient_role)
                VALUES ('SLA_ESCALATION', ?, ?, ?, ?, 'HR_LEAD')
                """,
                (
                    f"Case {case_number} Escalated by {performed_by}",
                    reason,
                    db_id,
                    case_number,
                ),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="CASE_ESCALATED",
                description=f"{performed_by} escalated case {case_number} to HR Lead/Manager: {reason}",
                performed_by=performed_by,
            )

        elif action_type == "ADD_TASK":
            task_title = (payload.get("title") or "").strip()
            if not task_title:
                return error_response("VALIDATION_ERROR", "Task title is required.", 400)
            conn.execute(
                """
                INSERT INTO tasks (case_id, title, task_type, status, priority, assigned_to, assigned_team, created_by, created_at)
                VALUES (?, ?, 'AGENT_VERIFICATION', 'PENDING', ?, ?, ?, ?, ?)
                """,
                (
                    db_id,
                    task_title,
                    case_obj.get("priority") or "MEDIUM",
                    performed_by,
                    case_obj.get("assigned_team") or "HR Operations",
                    performed_by,
                    now_iso,
                ),
            )
            conn.commit()
            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="TASK_CREATED",
                description=f"{performed_by} added verification task: {task_title}",
                performed_by=performed_by,
            )

        elif action_type == "TOGGLE_TASK":
            task_id = payload.get("task_id")
            task_title = payload.get("title")
            t_row = conn.execute("SELECT status, title FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if t_row:
                new_t_stat = "COMPLETED" if (t_row["status"] or "").upper() != "COMPLETED" else "PENDING"
                conn.execute(
                    "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                    (new_t_stat, now_iso if new_t_stat == "COMPLETED" else None, now_iso, task_id),
                )
                conn.commit()
                log_event(
                    entity_type="CASE",
                    entity_id=str(case_number),
                    action="TASK_COMPLETED" if new_t_stat == "COMPLETED" else "TASK_REOPENED",
                    description=f"{performed_by} marked task '{t_row['title']}' as {new_t_stat}",
                    performed_by=performed_by,
                )
            elif task_title:
                conn.execute(
                    """
                    INSERT INTO tasks (case_id, title, status, priority, assigned_to, assigned_team, created_by, created_at, completed_at, updated_at)
                    VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        db_id,
                        task_title,
                        case_obj.get("priority") or "MEDIUM",
                        performed_by,
                        case_obj.get("assigned_team") or "HR Operations",
                        performed_by,
                        now_iso,
                        now_iso,
                        now_iso,
                    ),
                )
                conn.commit()
                log_event(
                    entity_type="CASE",
                    entity_id=str(case_number),
                    action="TASK_COMPLETED",
                    description=f"{performed_by} verified compliance task: {task_title}",
                    performed_by=performed_by,
                )
        elif action_type == "SAVE_DRAFT":
            draft_text = (payload.get("draft") or payload.get("reply_body") or "").strip()
            conn.execute("UPDATE cases SET draft_reply = ?, updated_at = ? WHERE id = ?", (draft_text, now_iso, db_id))
            conn.commit()
            action_result_meta = {"draft_saved": True}

        elif action_type == "SAVE_FORENSIC_PROOF":
            fp = payload.get("forensic_proof") or {}
            fp_json = json.dumps(fp) if isinstance(fp, dict) else str(fp)
            ref_id = payload.get("reference_id") or fp.get("proofId") or ""
            notes = payload.get("resolution_notes") or fp.get("notes") or ""
            verdict = payload.get("verdict") or fp.get("verdict") or "RESOLVED"
            conn.execute(
                "UPDATE cases SET forensic_proof = ?, resolution_type = ?, resolution_notes = ?, updated_at = ? WHERE id = ?",
                (fp_json, verdict, notes, now_iso, db_id)
            )
            conn.commit()
            action_result_meta = {"proof_saved": True, "reference_id": ref_id}

        elif action_type in ("MERGE_CASE", "FOLLOW_CASE_MERGE", "MERGE"):
            from backend.services.cases.case_dossier_service import merge_cases
            target_ref = payload.get("target_case") or payload.get("target_case_number") or payload.get("parent_case")
            reason = payload.get("reason") or "Duplicate case consolidated by specialist."
            res_merge = merge_cases(case_number, target_ref, reason, performed_by)
            action_result_meta = res_merge

        elif action_type in ("LINK_CASE", "LINK"):
            from backend.services.cases.case_dossier_service import link_cases
            target_ref = payload.get("target_case") or payload.get("target_case_number")
            relation = payload.get("relation") or "RELATED"
            res_link = link_cases(case_number, target_ref, relation, performed_by)
            action_result_meta = res_link

        elif action_type in ("TOGGLE_FOLLOW", "FOLLOW_CASE"):
            from backend.services.cases.case_dossier_service import toggle_follow_case
            res_follow = toggle_follow_case(case_number, performed_by)
            action_result_meta = res_follow

        elif action_type in ("SIMULATE_24H_REPLY", "SIMULATE_REPLY"):
            curr_stat = str(case_obj.get("status") or "").upper()
            if curr_stat == "CLOSED":
                return error_response(
                    "CASE_CLOSED",
                    "This case is permanently CLOSED. The 24-hour grace period has expired; inbound replies can no longer reopen this docket.",
                    400,
                )

            res_str = str(case_obj.get("resolved_at") or "").strip().replace("Z", "+00:00")
            elapsed_hours = 2.5
            if res_str:
                try:
                    if "T" in res_str:
                        res_dt = datetime.fromisoformat(res_str)
                    else:
                        res_dt = datetime.strptime(res_str[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                    if res_dt.tzinfo is None:
                        res_dt = res_dt.replace(tzinfo=timezone.utc)
                    elapsed_hours = max(0.1, (datetime.now(timezone.utc) - res_dt).total_seconds() / 3600.0)
                except Exception:
                    elapsed_hours = 2.5

            reply_text = (payload.get("reply_text") or payload.get("reply_body") or "Hello HR Team, I reviewed the resolution update and would like to confirm my punch records.").strip()
            req_name = case_obj.get("employee_name") or performed_by or "Requester"

            conn.execute(
                """
                UPDATE cases
                   SET status = 'IN_PROGRESS',
                       workflow_state = 'AUDIT_SECTION',
                       reopened_at = ?,
                       reopened_by = ?,
                       reopen_reason = ?,
                       updated_at = ?
                 WHERE id = ?
                """,
                (
                    now_iso,
                    f"{req_name} (Simulated Reply)",
                    f"Requester replied within 24h grace window ({elapsed_hours:.1f}h elapsed)",
                    now_iso,
                    db_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO case_communications (case_id, email_id, sender_type, sender_name, recipient, subject, message, comm_type)
                VALUES (?, ?, 'EMPLOYEE', ?, 'PeopleDesk HR Operations', ?, ?, 'INBOUND_REPLY')
                """,
                (
                    db_id,
                    case_obj.get("email_id"),
                    req_name,
                    f"Re: [{case_number}] {case_obj.get('title') or 'HR Request'}",
                    reply_text,
                ),
            )
            conn.commit()

            log_event(
                entity_type="CASE",
                entity_id=str(case_number),
                action="CASE_AUTO_REOPENED_24H",
                description=f"Case #{case_number} auto-reopened: Requester replied within 24-hour grace window ({elapsed_hours:.1f}h elapsed). Returned to Step 2 (Audit & Execution).",
                performed_by=f"{req_name} (Simulated)",
            )
            action_result_meta = {
                "reopened": True,
                "elapsed_hours": elapsed_hours,
                "status": "IN_PROGRESS",
                "workflow_state": "AUDIT_SECTION",
                "message": f"Simulated reply received within 24h ({elapsed_hours:.1f}h elapsed). Case auto-reopened to In-Progress (Step 2 Audit).",
            }

        elif action_type in ("FORCE_24H_AUTO_CLOSE", "SIMULATE_24H_EXPIRE"):
            expired_time = (datetime.now(timezone.utc) - timedelta(hours=25)).strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                "UPDATE cases SET resolved_at = ?, status = 'RESOLVED', updated_at = ? WHERE id = ?",
                (expired_time, now_iso, db_id),
            )
            conn.commit()

            from backend.services.cases.case_service import check_and_auto_close_resolved_cases
            closed_cnt = check_and_auto_close_resolved_cases()

            action_result_meta = {
                "closed": True,
                "closed_count": closed_cnt,
                "status": "CLOSED",
                "workflow_state": "CLOSED",
                "message": f"Fast-forwarded 25 hours without reply. Case #{case_number} permanently closed by System Policy.",
            }

        elif action_type in ("SUBMIT_FEEDBACK", "SIMULATE_FEEDBACK"):
            from backend.services.cases.feedback_service import submit_case_feedback
            rating = int(payload.get("rating") or 5)
            tags = payload.get("tags") or ["Fast Resolution", "Clear Communication", "Helpful Specialist"]
            comments = payload.get("comments") or payload.get("notes") or "The regularization was processed quickly and turnstile logs were verified. Thank you!"
            sub_name = payload.get("submitted_by") or case_obj.get("employee_name") or "Vaibhav (Requester)"
            fb_res = submit_case_feedback(
                case_ref=case_number,
                rating=rating,
                tags=tags,
                comments=comments,
                submitted_by=sub_name,
            )
            action_result_meta = {"feedback": fb_res, "simulated": True}

        else:
            return error_response("VALIDATION_ERROR", f"Unsupported action_type: {action_type}", 400)

    finally:
        conn.close()

    updated_case = get_case_by_id_or_number(db_id)
    if updated_case:
        up_stages, up_cur, up_tot = _get_case_stages_and_step(updated_case)
        updated_case["current_step"] = up_cur
        updated_case["total_steps"] = up_tot
        updated_case["workflow_stages"] = up_stages

    return success_response({
        "case": updated_case,
        "smtp_dispatch": smtp_result,
        "action_result": action_result_meta,
    })


@agent_bp.route("/cases/create", methods=["POST"])
def create_agent_department_case():
    """
    Allow an HR Agent / Specialist to log a new employee HR request (walk-in, call, email, or test case)
    directly into their Department Queue or Personal Queue.
    """
    payload = request.get_json(silent=True) or {}
    agent_name = (payload.get("agent_name") or request.headers.get("X-HR-User") or "HR Specialist").strip()
    agent_email = (payload.get("agent_email") or request.headers.get("X-HR-Email") or "").strip().lower()
    agent_team = (payload.get("agent_team") or "Payroll Operations HR").strip()
    category = (payload.get("category") or "PAYROLL").strip().upper()
    if "," in category:
        category = category.split(",")[0].strip()

    employee_name = (payload.get("employee_name") or "Aarav Sharma").strip()
    employee_email = (payload.get("employee_email") or "aarav.sharma@company.com").strip().lower()
    employee_id = (payload.get("employee_id") or "EMP1042").strip().upper()
    priority = (payload.get("priority") or "HIGH").strip().upper()
    assign_to_me = bool(payload.get("assign_to_me", True))

    default_samples = {
        "PAYROLL": {
            "title": "Salary Arrears & TDS Discrepancy in October Payslip",
            "intent": "payslip_discrepancy_inquiry",
            "body": (
                f"Hi HR Payroll Desk,\n\n"
                f"My Employee ID is {employee_id} ({employee_name}). I noticed a deduction of INR 14,500 under TDS "
                f"in my latest payslip despite submitting my Section 80C investment proofs on time, and my appraisal "
                f"arrears for last month were not credited.\n\n"
                f"Could you please verify my payroll tax ledger and release the pending arrears?\n\n"
                f"Thanks,\n{employee_name}"
            ),
            "extracted": {"employee_id": employee_id, "pay_month": "October 2026", "discrepancy_amount": "INR 14,500", "claim_type": "TDS & Appraisal Arrears"},
        },
        "LEAVE": {
            "title": "Earned Leave Balance & Medical Leave Encashment Request",
            "intent": "leave_balance_correction",
            "body": (
                f"Hello Leave Operations Desk,\n\n"
                f"I am {employee_name} ({employee_id}). My HRMS portal shows 4 days of Earned Leave deducted "
                f"for October 2-5 even though I had approved medical leave with a hospital discharge summary.\n\n"
                f"Please restore my 4 Earned Leave days and update my leave quota.\n\n"
                f"Regards,\n{employee_name}"
            ),
            "extracted": {"employee_id": employee_id, "leave_type": "Earned / Medical Leave", "days_affected": "4 Days", "dates": "Oct 02 - Oct 05"},
        },
        "ATTENDANCE": {
            "title": "Biometric Swipe Miss & WFH Shift Regularization Request",
            "intent": "attendance_regularization",
            "body": (
                f"Hi Attendance HR Team,\n\n"
                f"My biometric out-punch on October 4th was missed due to a late client deployment (logged 9.5 hours on VPN). "
                f"The portal currently marks me Half-Day Lop.\n\n"
                f"Please regularize my attendance for October 4th before payroll cutoff.\n\n"
                f"Thanks,\n{employee_name} ({employee_id})"
            ),
            "extracted": {"employee_id": employee_id, "affected_date": "2026-10-04", "shift_hours": "9.5 hrs VPN", "request": "Regularize Full Day"},
        },
    }
    sample = default_samples.get(category, default_samples["PAYROLL"])
    title = (payload.get("title") or sample["title"]).strip()
    body = (payload.get("description") or payload.get("body") or sample["body"]).strip()
    intent = (payload.get("intent") or sample["intent"]).strip()
    extracted_json = json.dumps(payload.get("extracted_fields") or sample["extracted"])

    now_iso = datetime.now(timezone.utc).isoformat()
    case_number = f"CASE-2026-{int(datetime.now(timezone.utc).timestamp()) % 100000:05d}"

    conn = get_connection()
    try:
        # 1. Insert source email record so 360° pane has full email context
        cur_em = conn.execute(
            """
            INSERT INTO emails (
                provider, provider_message_id, sender_name, sender_email,
                subject, body, received_at, category, category_confidence,
                intent, processing_status, decision_status, extracted_fields,
                account_email, created_at, updated_at
            ) VALUES ('GMAIL', ?, ?, ?, ?, ?, ?, ?, 0.96, ?, 'PROCESSED', 'ACCEPTED', ?, ?, ?, ?)
            """,
            (
                f"<{case_number.lower()}@hrflow.local>",
                employee_name,
                employee_email,
                title,
                body,
                now_iso,
                category,
                intent,
                extracted_json,
                agent_email or "vaibhav.v1@1mg.com",
                now_iso,
                now_iso,
            ),
        )
        email_id = cur_em.lastrowid

        # 2. Insert HR Case record
        assigned_user = agent_name if assign_to_me else ""
        assigned_to = agent_name if assign_to_me else agent_team
        status_val = "IN_PROGRESS" if assign_to_me else "NEW"
        wf_val = "DOC_VERIFICATION" if assign_to_me else "INTAKE"

        cur_c = conn.execute(
            """
            INSERT INTO cases (
                case_number, email_id, title, description,
                category, intent, priority, status, workflow_state,
                assigned_team, assigned_to, assigned_user, assigned_user_email,
                extracted_fields, sla_hours, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?)
            """,
            (
                case_number,
                email_id,
                title,
                body,
                category,
                intent,
                priority,
                status_val,
                wf_val,
                agent_team,
                assigned_to,
                assigned_user,
                agent_email if assign_to_me else "",
                extracted_json,
                now_iso,
                now_iso,
            ),
        )
        case_db_id = cur_c.lastrowid
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=str(case_number),
        action="CASE_LOGGED_BY_AGENT",
        description=f"{agent_name} logged new {category} case {case_number} ({title}) in {agent_team}",
        performed_by=agent_name,
    )

    return success_response({
        "created": True,
        "case_id": case_db_id,
        "case_number": case_number,
        "category": category,
        "assigned_team": agent_team,
        "assigned_user": assigned_user,
    }, 201)


# =============================================================================
# 8. ADMIN / HR "AGENTS STATUS" — DEPARTMENT-WISE AGENT WORK TRACKER API
#    (Powers frontend/agentworktracker.html)
# =============================================================================

@agent_bp.route("/work-tracker", methods=["GET"])
def get_department_agent_work_tracker():
    """
    Return complete department-wise HR Agent & Specialist work tracking data for Admin / HR:
      - Organization-wide Agent Work KPIs
      - Department-by-department breakdown (with each department's agents, active/resolved cases, unclaimed pool)
      - Complete 360° work details per agent:
          * Assigned & Resolved Cases (with workflow stage, SLA status, resolution notes)
          * Verification Tasks (Completed & Pending)
          * Outbound Employee Replies & Communications Sent
          * HRMS Actions Executed & Approvals Requested
          * Chronological Audit Trail of everything the agent has done
    """
    ensure_default_departments_seeded()
    roster = _sync_users_and_members()
    depts = list_departments_with_members()
    all_cases = list_cases(account_email="__ALL__", limit=500)

    for c in all_cases:
        c["current_step"] = _compute_workflow_step_number(c.get("workflow_state"), c.get("status"))
        c["total_steps"] = 3

    conn = get_connection()
    tasks_all = []
    comms_all = []
    actions_all = []
    approvals_all = []
    audits_all = []
    try:
        t_rows = conn.execute(
            """
            SELECT t.*, c.case_number, c.title AS case_title, c.category AS case_category
            FROM tasks t
            LEFT JOIN cases c ON t.case_id = c.id
            ORDER BY t.id DESC LIMIT 400
            """
        ).fetchall()
        tasks_all = [dict(r) for r in t_rows]

        cm_rows = conn.execute(
            """
            SELECT cm.*, c.case_number, c.title AS case_title, c.category AS case_category
            FROM case_communications cm
            LEFT JOIN cases c ON cm.case_id = c.id
            ORDER BY cm.id DESC LIMIT 300
            """
        ).fetchall()
        comms_all = [dict(r) for r in cm_rows]

        ha_rows = conn.execute(
            "SELECT * FROM hr_actions ORDER BY id DESC LIMIT 300"
        ).fetchall()
        actions_all = [dict(r) for r in ha_rows]

        ap_rows = conn.execute(
            """
            SELECT a.*, c.case_number, c.title AS case_title
            FROM approvals a
            LEFT JOIN cases c ON a.case_id = c.id
            ORDER BY a.id DESC LIMIT 300
            """
        ).fetchall()
        approvals_all = [dict(r) for r in ap_rows]

        al_rows = conn.execute(
            "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500"
        ).fetchall()
        audits_all = [dict(r) for r in al_rows]
    except Exception:
        pass
    finally:
        conn.close()

    def _matches_person(target_str: Optional[str], person_name: str, person_email: str) -> bool:
        val = (target_str or "").strip().lower()
        if not val:
            return False
        p_name = (person_name or "").strip().lower()
        p_email = (person_email or "").strip().lower()
        if p_email and val == p_email:
            return True
        if p_name and val == p_name:
            return True
        first_tok = p_name.split()[0] if p_name else ""
        if len(first_tok) >= 3 and first_tok not in ("admin", "hr") and first_tok in val:
            return True
        return False

    enriched_agents: List[Dict[str, Any]] = []

    for person in roster:
        p_name = (person.get("name") or person.get("member_name") or "").strip()
        p_email = (person.get("email") or "").strip().lower()
        p_team = (person.get("team_name") or "").strip()
        p_role = _normalize_role(person.get("role"))

        # 1. Cases assigned to or resolved by this person
        person_cases = [
            c for c in all_cases
            if _matches_person(c.get("assigned_user"), p_name, p_email)
            or _matches_person(c.get("assigned_user_email"), p_name, p_email)
            or _matches_person(c.get("assigned_to"), p_name, p_email)
            or _matches_person(c.get("resolved_by"), p_name, p_email)
        ]
        person_case_db_ids = {int(c.get("db_id") or 0) for c in person_cases if c.get("db_id")}
        person_case_numbers = {str(c.get("case_number") or "").upper() for c in person_cases if c.get("case_number")}

        active_cases = [
            c for c in person_cases
            if (c.get("status") or "").upper() not in ("RESOLVED", "CLOSED")
        ]
        resolved_cases = [
            c for c in person_cases
            if (c.get("status") or "").upper() in ("RESOLVED", "CLOSED")
        ]
        overdue_cases = [
            c for c in active_cases
            if (c.get("sla_status") or "").upper() in ("OVERDUE", "DUE_SOON", "BREACHED", "AT_RISK")
        ]

        # 2. Tasks handled by this person (or belonging to their assigned cases)
        person_tasks = [
            t for t in tasks_all
            if _matches_person(t.get("assigned_to"), p_name, p_email)
            or _matches_person(t.get("created_by"), p_name, p_email)
            or int(t.get("case_id") or 0) in person_case_db_ids
        ]
        tasks_completed = [
            t for t in person_tasks
            if (t.get("status") or "").upper() == "COMPLETED"
        ]
        tasks_pending = [
            t for t in person_tasks
            if (t.get("status") or "").upper() not in ("COMPLETED", "CANCELLED")
        ]

        # 3. Outbound Employee Communications / Replies sent by this person
        person_comms = [
            cm for cm in comms_all
            if _matches_person(cm.get("sender_name"), p_name, p_email)
            or int(cm.get("case_id") or 0) in person_case_db_ids
        ]

        # 4. HRMS Actions executed by this person
        person_actions = [
            ha for ha in actions_all
            if _matches_person(ha.get("requested_by"), p_name, p_email)
            or int(ha.get("case_id") or 0) in person_case_db_ids
        ]

        # 5. Approvals requested or decided by this person
        person_approvals = [
            ap for ap in approvals_all
            if _matches_person(ap.get("requested_by"), p_name, p_email)
            or _matches_person(ap.get("decision_by"), p_name, p_email)
            or int(ap.get("case_id") or 0) in person_case_db_ids
        ]

        # 6. Audit logs performed by this person (or on their cases)
        person_audits = [
            al for al in audits_all
            if _matches_person(al.get("performed_by"), p_name, p_email)
            or (al.get("entity_type") == "CASE" and str(al.get("entity_id") or "").upper() in person_case_numbers)
        ]

        total_handled = len(person_cases)
        comp_rate = int(round((len(resolved_cases) / total_handled) * 100)) if total_handled > 0 else 0

        # Determine live operational status badge
        if len(active_cases) >= 4:
            live_status = {"code": "HIGH_LOAD", "label": "High Workload", "color": "#d97706", "bg": "#fffbeb", "border": "#fde68a"}
        elif len(active_cases) > 0:
            live_status = {"code": "ACTIVE_WORKING", "label": "Actively Working", "color": "#2563eb", "bg": "#eff6ff", "border": "#bfdbfe"}
        elif len(resolved_cases) > 0 or len(person_audits) > 0:
            live_status = {"code": "COMPLETED_QUEUE", "label": "Queue Cleared", "color": "#059669", "bg": "#ecfdf5", "border": "#a7f3d0"}
        else:
            live_status = {"code": "AVAILABLE", "label": "Available / Ready", "color": "#475569", "bg": "#f8fafc", "border": "#cbd5e1"}

        last_activity_ts = (
            (person_audits[0].get("created_at") if person_audits else None)
            or (person_comms[0].get("created_at") if person_comms else None)
            or (person_cases[0].get("updated_at") if person_cases else None)
            or person.get("updated_at")
            or person.get("created_at")
        )

        enriched_agents.append({
            **person,
            "role": p_role,
            "live_status": live_status,
            "metrics": {
                "active_cases_count": len(active_cases),
                "resolved_cases_count": len(resolved_cases),
                "total_cases_handled": total_handled,
                "overdue_or_risk_count": len(overdue_cases),
                "tasks_completed_count": len(tasks_completed),
                "tasks_pending_count": len(tasks_pending),
                "emails_replied_count": len(person_comms),
                "hrms_actions_count": len(person_actions),
                "approvals_count": len(person_approvals),
                "audit_events_count": len(person_audits),
                "completion_rate_pct": comp_rate,
                "last_active_at": last_activity_ts,
            },
            "work_details": {
                "active_cases": active_cases,
                "resolved_cases": resolved_cases,
                "all_cases": person_cases,
                "tasks_completed": tasks_completed,
                "tasks_pending": tasks_pending,
                "all_tasks": person_tasks,
                "communications": person_comms,
                "hrms_actions": person_actions,
                "approvals": person_approvals,
                "audit_logs": person_audits[:40],
            },
        })

    # Group by HR Department so Admin/HR can see every department and what each agent in that department has done
    departments_tracker: List[Dict[str, Any]] = []
    assigned_agent_ids = set()

    for d in depts:
        d_id = int(d["id"])
        d_name = (d["team_name"] or "").strip()
        d_scope = (d.get("category_scope") or "GENERAL_HR").strip().upper()
        scope_tokens = [s.strip() for s in d_scope.split(",") if s.strip()]

        dept_agents = [
            ag for ag in enriched_agents
            if (int(ag.get("dept_id") or 0) == d_id or (ag.get("team_name") or "").lower() == d_name.lower())
            and ag.get("role") != "ADMIN"
        ]
        for ag in dept_agents:
            assigned_agent_ids.add(ag["id"])

        dept_cases = [
            c for c in all_cases
            if (c.get("assigned_team") or "").strip().lower() == d_name.lower()
            or (c.get("category") or "").strip().upper() in scope_tokens
        ]
        dept_active = [c for c in dept_cases if (c.get("status") or "").upper() not in ("RESOLVED", "CLOSED")]
        dept_resolved = [c for c in dept_cases if (c.get("status") or "").upper() in ("RESOLVED", "CLOSED")]
        dept_unclaimed = [
            c for c in dept_active
            if not (c.get("assigned_user") or "").strip()
            or (c.get("assigned_user") or "").strip().lower() == d_name.lower()
            or (c.get("assigned_user") or "").strip().upper() in ("UNASSIGNED", "NONE", "HR OPERATIONS")
        ]

        departments_tracker.append({
            "dept_id": d_id,
            "dept_code": d["dept_code"],
            "team_name": d_name,
            "category_scope": d_scope,
            "dept_gmail": d["dept_gmail"],
            "sla_hours": d["sla_hours"],
            "default_priority": d.get("default_priority") or "MEDIUM",
            "description": d.get("description") or "",
            "summary": {
                "agents_count": len(dept_agents),
                "total_cases": len(dept_cases),
                "active_cases": len(dept_active),
                "resolved_cases": len(dept_resolved),
                "unclaimed_cases": len(dept_unclaimed),
                "tasks_completed": sum(ag["metrics"]["tasks_completed_count"] for ag in dept_agents),
                "emails_replied": sum(ag["metrics"]["emails_replied_count"] for ag in dept_agents),
                "hrms_actions_run": sum(ag["metrics"]["hrms_actions_count"] for ag in dept_agents),
            },
            "agents": dept_agents,
            "unclaimed_cases_list": dept_unclaimed[:20],
            "recent_dept_cases": dept_cases[:25],
        })

    # Overall KPIs across all agents & departments
    non_admin_agents = [a for a in enriched_agents if a.get("role") != "ADMIN"]
    agents_for_kpi = non_admin_agents if non_admin_agents else enriched_agents

    total_active_cases = sum(a["metrics"]["active_cases_count"] for a in agents_for_kpi)
    total_resolved_cases = sum(a["metrics"]["resolved_cases_count"] for a in agents_for_kpi)
    total_tasks_done = sum(a["metrics"]["tasks_completed_count"] for a in agents_for_kpi)
    total_tasks_open = sum(a["metrics"]["tasks_pending_count"] for a in agents_for_kpi)
    total_replies = sum(a["metrics"]["emails_replied_count"] for a in agents_for_kpi)
    total_hrms_actions = sum(a["metrics"]["hrms_actions_count"] for a in agents_for_kpi)
    total_unclaimed = sum(d["summary"]["unclaimed_cases"] for d in departments_tracker)

    return success_response({
        "kpis": {
            "total_departments": len(departments_tracker),
            "total_agents": len(agents_for_kpi),
            "active_assigned_cases": total_active_cases,
            "resolved_cases_total": total_resolved_cases,
            "unclaimed_dept_cases": total_unclaimed,
            "tasks_completed_total": total_tasks_done,
            "tasks_pending_total": total_tasks_open,
            "emails_replied_total": total_replies,
            "hrms_actions_total": total_hrms_actions,
        },
        "departments": departments_tracker,
        "agents": enriched_agents,
        "all_cases": all_cases[:100],
    })


# =========================================================================
# PLAYBOOK STUDIO & WORKFLOW CUSTOMIZER API
# =========================================================================

@agent_bp.route("/playbooks", methods=["GET"])
def get_all_playbooks_api():
    from backend.services.playbooks.playbook_service import list_all_playbooks
    return success_response({"playbooks": list_all_playbooks()})


@agent_bp.route("/playbooks/<category>", methods=["GET"])
def get_category_playbook_api(category: str):
    from backend.services.playbooks.playbook_service import get_playbook_for_category
    pb = get_playbook_for_category(category)
    return success_response({"playbook": pb})


@agent_bp.route("/playbooks/<category>", methods=["POST"])
def save_category_playbook_api(category: str):
    from backend.services.playbooks.playbook_service import save_playbook
    payload = request.get_json(silent=True) or {}
    updated = save_playbook(category, payload, mark_custom=True)
    return success_response({"playbook": updated, "message": f"Playbook for {category} saved successfully!"})


@agent_bp.route("/playbooks/<category>/reset", methods=["POST"])
def reset_category_playbook_api(category: str):
    from backend.services.playbooks.playbook_service import seed_default_playbooks, get_playbook_for_category
    conn = get_connection()
    try:
        conn.execute("DELETE FROM category_playbooks WHERE UPPER(category) = UPPER(?)", (category.strip(),))
        conn.commit()
        seed_default_playbooks(conn)
    finally:
        conn.close()
    return success_response({"playbook": get_playbook_for_category(category), "message": f"Playbook for {category} reset to factory defaults."})


@agent_bp.route("/playbooks/<category>/ai-suggest", methods=["GET"])
def get_ai_playbook_suggestions_api(category: str):
    from backend.services.playbooks.playbook_service import generate_ai_playbook_suggestions
    suggestions = generate_ai_playbook_suggestions(category)
    return success_response(suggestions)





