"""
HR FLOW — Admin Case Management & Allotment Service (backend/services/cases/admin_case_service.py)
Provides Admin supervision capabilities:
  - Atomic zero-duplicate case number allotment (1MG-00001, 1MG-00002...)
  - Manual on-demand case allotment with direct specialist assignment
  - Specialist workload matrix ("Who is working on what")
  - Case reassignment with full forensic audit tracking
"""

import json
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from backend.database.connection import get_connection
from backend.services.cases.case_number import (
    allot_next_case_number,
    peek_next_case_number,
    get_sequence_status,
    DEFAULT_PREFIX,
)
from backend.services.audit.audit_service import log_event
from backend.models.case import get_case_by_id_or_number


def get_next_case_preview(prefix: str = DEFAULT_PREFIX) -> Dict[str, Any]:
    """Lookahead of the next guaranteed unique case number."""
    return get_sequence_status(prefix)


def allot_admin_case(payload: Dict[str, Any], performed_by: str = "Admin") -> Dict[str, Any]:
    """
    Allots a new case with a guaranteed unique sequential case number.
    Ensures zero race conditions and duplicate-free creation.
    """
    title = (payload.get("title") or "").strip()
    if not title:
        raise ValueError("Case title/subject is required.")

    category = (payload.get("category") or "GENERAL_HR").strip().upper()
    priority = (payload.get("priority") or "MEDIUM").strip().upper()
    if priority not in ("LOW", "MEDIUM", "HIGH", "URGENT", "CRITICAL"):
        priority = "MEDIUM"

    description = (payload.get("description") or payload.get("body") or "").strip()
    prefix = (payload.get("prefix") or DEFAULT_PREFIX).strip().upper()

    # Calculate SLA Hours
    sla_map = {
        "URGENT": 12,
        "CRITICAL": 12,
        "HIGH": 24,
        "MEDIUM": 48,
        "LOW": 72,
    }
    sla_hours = int(payload.get("sla_hours") or sla_map.get(priority, 48))

    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    due_iso = (now_utc + timedelta(hours=sla_hours)).isoformat()

    # 1. ATOMIC ALLOTMENT: Dispense guaranteed unique case number first
    case_number = allot_next_case_number(prefix=prefix)

    # Handle Assigned Specialist
    assigned_user = (payload.get("assigned_user") or "").strip()
    assigned_team = (payload.get("assigned_team") or "").strip()
    assigned_user_email = (payload.get("assigned_user_email") or "").strip()

    conn = get_connection()
    try:
        # Resolve specialist details if user name was chosen from directory
        if assigned_user and (not assigned_team or not assigned_user_email):
            member_row = conn.execute(
                """
                SELECT member_name, email, team_name, role 
                FROM hr_department_members 
                WHERE LOWER(member_name) = LOWER(?) OR LOWER(email) = LOWER(?)
                LIMIT 1
                """,
                (assigned_user, assigned_user),
            ).fetchone()

            if member_row:
                assigned_user = member_row["member_name"]
                if not assigned_user_email:
                    assigned_user_email = member_row["email"]
                if not assigned_team:
                    assigned_team = member_row["team_name"]
            else:
                user_row = conn.execute(
                    "SELECT name, email FROM users WHERE LOWER(name) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1",
                    (assigned_user, assigned_user),
                ).fetchone()
                if user_row:
                    assigned_user = user_row["name"] or assigned_user
                    if not assigned_user_email:
                        assigned_user_email = user_row["email"]

        if not assigned_team:
            assigned_team = "People Operations"

        # Determine target status
        if assigned_user and assigned_user.upper() != "UNASSIGNED":
            status_val = "IN_PROGRESS"
            workflow_state = "DOC_VERIFICATION"
            assigned_to = assigned_user
        else:
            status_val = "NEW"
            workflow_state = "INTAKE"
            assigned_to = assigned_team or "UNASSIGNED"
            assigned_user = ""

        # Handle Employee Linking / Creation
        emp_id_input = (payload.get("employee_id") or "").strip()
        emp_name_input = (payload.get("employee_name") or "").strip()
        emp_email_input = (payload.get("employee_email") or "").strip()

        emp_db_id = None
        if emp_id_input or emp_email_input:
            emp_row = conn.execute(
                "SELECT id, employee_id, name, email FROM employees WHERE employee_id = ? OR email = ? LIMIT 1",
                (emp_id_input, emp_email_input),
            ).fetchone()
            if emp_row:
                emp_db_id = emp_row["id"]
            else:
                new_emp_code = emp_id_input or f"EMP-{int(now_utc.timestamp()) % 100000}"
                new_emp_name = emp_name_input or "Employee"
                new_emp_email = emp_email_input or f"{new_emp_code.lower()}@company.local"
                cur_emp = conn.execute(
                    """
                    INSERT INTO employees (employee_id, name, email, department, designation, source, created_at, updated_at)
                    VALUES (?, ?, ?, 'General', 'Staff', 'ADMIN_ALLOTMENT', ?, ?)
                    """,
                    (new_emp_code, new_emp_name, new_emp_email, now_iso, now_iso),
                )
                emp_db_id = cur_emp.lastrowid

        # 2. Insert Case
        cur = conn.execute(
            """
            INSERT INTO cases (
                case_number, employee_id, category, intent, title, description,
                status, priority, assigned_team, assigned_user, assigned_user_email,
                assigned_to, sla_hours, due_at, workflow_state, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_number,
                emp_db_id,
                category,
                "administrative_allotment",
                title,
                description,
                status_val,
                priority,
                assigned_team,
                assigned_user,
                assigned_user_email,
                assigned_to,
                sla_hours,
                due_iso,
                workflow_state,
                now_iso,
                now_iso,
            ),
        )
        case_id = cur.lastrowid

        # 3. Seed initial staff communication note
        dispatch_note = f"Assigned to {assigned_user} ({assigned_team})" if assigned_user else "Sent to Unclaimed Queue"
        conn.execute(
            """
            INSERT INTO case_communications (
                case_id, sender_type, sender_name, comm_type, message, created_at
            ) VALUES (?, 'HR_ADMIN', ?, 'INTERNAL_NOTE', ?, ?)
            """,
            (
                case_id,
                performed_by,
                f"⚡ Case #{case_number} officially allotted by Admin {performed_by}. {dispatch_note}. Priority: {priority}, SLA: {sla_hours}h.",
                now_iso,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    # 4. Log Forensic Audit Event
    log_event(
        entity_type="CASE",
        entity_id=case_id,
        action="CASE_ALLOTTED",
        description=f"Admin {performed_by} allotted unique case {case_number} ({title}) -> {assigned_user or 'Unclaimed'}",
        performed_by=performed_by,
        metadata={
            "case_number": case_number,
            "category": category,
            "priority": priority,
            "assigned_user": assigned_user,
            "assigned_team": assigned_team,
            "sla_hours": sla_hours,
        },
    )

    return get_case_by_id_or_number(case_id)


def get_agents_workload_overview() -> Dict[str, Any]:
    """
    Returns an overview of all agents and their active cases.
    Allows Admin to see who is working on what, their load, and unassigned backlog.
    """
    conn = get_connection()
    try:
        # Collect distinct active agents from hr_department_members and users
        members_query = """
            SELECT id, member_name, email, role, designation, team_name, active
            FROM hr_department_members
            WHERE active = 1
            ORDER BY member_name ASC
        """
        members = [dict(r) for r in conn.execute(members_query).fetchall()]

        # Ensure known users (like Vaibhav Yadav, Priya Sharma, Admin) are included
        existing_emails = {m["email"].lower() for m in members if m.get("email")}
        users = conn.execute("SELECT id, name, email, role FROM users").fetchall()
        for u in users:
            u_email = (u["email"] or "").lower()
            if u_email and u_email not in existing_emails:
                members.append({
                    "id": u["id"] + 1000,
                    "member_name": u["name"] or u["email"].split("@")[0].title(),
                    "email": u["email"],
                    "role": u["role"] or "HR_AGENT",
                    "designation": "Specialist",
                    "team_name": "People Operations",
                    "active": 1,
                })
                existing_emails.add(u_email)

        # Get all open/active cases
        active_cases_query = """
            SELECT c.id, c.case_number, c.title, c.category, c.priority, c.status,
                   c.assigned_user, c.assigned_team, c.assigned_user_email,
                   c.created_at, c.due_at, c.sla_hours,
                   e.name as employee_name, e.employee_id as employee_code
            FROM cases c
            LEFT JOIN employees e ON c.employee_id = e.id
            WHERE UPPER(c.status) NOT IN ('CLOSED', 'RESOLVED')
            ORDER BY c.id DESC
        """
        all_active_cases = [dict(r) for r in conn.execute(active_cases_query).fetchall()]

        # Group cases by agent
        agents_data = []
        unassigned_cases = []

        assigned_case_ids = set()

        for agent in members:
            agent_name = (agent.get("member_name") or "").strip().lower()
            agent_email = (agent.get("email") or "").strip().lower()

            agent_cases = []
            for c in all_active_cases:
                c_user = (c.get("assigned_user") or "").strip().lower()
                c_email = (c.get("assigned_user_email") or "").strip().lower()

                # Flexible match: exact match, email match, or first-name match
                first_name_match = bool(
                    c_user and agent_name and (
                        c_user == agent_name or
                        agent_name in c_user or
                        c_user in agent_name or
                        (c_user.split()[0] == agent_name.split()[0] and len(agent_name.split()[0]) > 2)
                    )
                )

                if first_name_match or (c_email and c_email == agent_email):
                    agent_cases.append(c)
                    assigned_case_ids.add(c["id"])

            case_count = len(agent_cases)
            urgent_count = sum(1 for c in agent_cases if (c.get("priority") or "").upper() in ("URGENT", "CRITICAL", "HIGH"))

            if case_count == 0:
                load_status = "AVAILABLE"
                load_color = "#12B76A" # green
            elif case_count <= 3:
                load_status = "OPTIMAL"
                load_color = "#2E90FA" # blue
            elif case_count <= 6:
                load_status = "BUSY"
                load_color = "#F79009" # amber
            else:
                load_status = "OVERLOADED"
                load_color = "#F04438" # red

            agents_data.append({
                "agent_id": agent.get("id"),
                "name": agent.get("member_name"),
                "email": agent.get("email"),
                "role": agent.get("role"),
                "team_name": agent.get("team_name"),
                "designation": agent.get("designation"),
                "active_case_count": case_count,
                "urgent_case_count": urgent_count,
                "workload_status": load_status,
                "workload_color": load_color,
                "cases": agent_cases,
            })

        # Find unassigned cases
        for c in all_active_cases:
            if c["id"] not in assigned_case_ids:
                unassigned_cases.append(c)

        # Sort agents by active cases descending
        agents_data.sort(key=lambda a: a["active_case_count"], reverse=True)

        return {
            "total_active_cases": len(all_active_cases),
            "total_agents": len(agents_data),
            "unassigned_count": len(unassigned_cases),
            "unassigned_cases": unassigned_cases,
            "agents": agents_data,
        }
    finally:
        conn.close()


def admin_reassign_case(
    case_identifier: str,
    target_user: str,
    target_team: Optional[str] = None,
    target_user_email: Optional[str] = None,
    reason: str = "",
    performed_by: str = "Admin",
) -> Dict[str, Any]:
    """
    Reassigns a case from Admin console with automatic team resolution and audit trail.
    """
    case = get_case_by_id_or_number(case_identifier)
    if not case:
        raise ValueError(f"Case '{case_identifier}' not found.")

    case_id = case["db_id"]
    case_number = case["case_number"]
    old_user = case.get("assigned_user") or "Unassigned"
    target_user = (target_user or "").strip()

    conn = get_connection()
    try:
        # Resolve target team and email
        if target_user and (not target_team or not target_user_email):
            member_row = conn.execute(
                """
                SELECT member_name, email, team_name 
                FROM hr_department_members 
                WHERE LOWER(member_name) = LOWER(?) OR LOWER(email) = LOWER(?)
                LIMIT 1
                """,
                (target_user, target_user),
            ).fetchone()
            if member_row:
                target_user = member_row["member_name"]
                target_user_email = target_user_email or member_row["email"]
                target_team = target_team or member_row["team_name"]

        target_team = target_team or case.get("assigned_team") or "People Operations"
        now_iso = datetime.now(timezone.utc).isoformat()

        conn.execute(
            """
            UPDATE cases
            SET assigned_user = ?,
                assigned_user_email = ?,
                assigned_team = ?,
                assigned_to = ?,
                status = CASE WHEN UPPER(status) = 'NEW' THEN 'IN_PROGRESS' ELSE status END,
                updated_at = ?
            WHERE id = ?
            """,
            (target_user, target_user_email or "", target_team, target_user, now_iso, case_id),
        )

        # Communication log
        note_body = f"Case #{case_number} reassigned by Admin {performed_by} from [{old_user}] to [{target_user} ({target_team})]."
        if reason:
            note_body += f" Reason: {reason}"

        conn.execute(
            """
            INSERT INTO case_communications (
                case_id, sender_type, sender_name, comm_type, message, created_at
            ) VALUES (?, 'HR_ADMIN', ?, 'INTERNAL_NOTE', ?, ?)
            """,
            (case_id, performed_by, note_body, now_iso),
        )
        conn.commit()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case_id,
        action="CASE_REASSIGNED",
        description=f"Admin {performed_by} reassigned case {case_number} to {target_user} ({target_team})",
        performed_by=performed_by,
        metadata={
            "case_number": case_number,
            "from_user": old_user,
            "to_user": target_user,
            "team": target_team,
            "reason": reason,
        },
    )

    return get_case_by_id_or_number(case_id)
