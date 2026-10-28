"""
HR FLOW — HR Departments & Team Roster Service (backend/services/cases/department_service.py)
Manages HR Departments (`hr_departments`) and their Team Members (`hr_department_members`)
including each specialist's Gmail address, role, designation, and live open case workload.
"""

from typing import Dict, Any, List, Optional
from backend.database.connection import get_connection


_DEFAULT_DEPARTMENTS: List[Dict[str, Any]] = [
    {
        "dept_code": "DEPT-LEAVE",
        "team_name": "Leave Operations HR",
        "category_scope": "LEAVE",
        "dept_gmail": "leave.ops.hr@gmail.com",
        "sla_hours": 48,
        "default_priority": "MEDIUM",
        "description": "Manages casual, sick, earned, maternity/paternity leave applications, balances, and encashment.",
        "members": [],
    },
    {
        "dept_code": "DEPT-ATTENDANCE",
        "team_name": "Attendance HR",
        "category_scope": "ATTENDANCE",
        "dept_gmail": "attendance.desk.hr@gmail.com",
        "sla_hours": 48,
        "default_priority": "MEDIUM",
        "description": "Handles biometric punches, WFH regularization, shift swaps, and timesheet corrections.",
        "members": [],
    },
    {
        "dept_code": "DEPT-PAYROLL",
        "team_name": "Payroll HR",
        "category_scope": "PAYROLL",
        "dept_gmail": "payroll.desk.hr@gmail.com",
        "sla_hours": 24,
        "default_priority": "HIGH",
        "description": "Manages salary disbursement, payslips, tax declarations (Form 16/TDS), and reimbursements.",
        "members": [],
    },
    {
        "dept_code": "DEPT-OPS",
        "team_name": "HR Operations",
        "category_scope": "RESIGNATION, DOCUMENTS, EMPLOYEE_PROFILE",
        "dept_gmail": "core.hrops@gmail.com",
        "sla_hours": 24,
        "default_priority": "HIGH",
        "description": "Handles resignations, exit clearances, full & final settlement, HR letters, and profile updates.",
        "members": [],
    },
    {
        "dept_code": "DEPT-BGV",
        "team_name": "BGV Team",
        "category_scope": "BGV",
        "dept_gmail": "bgv.verification.hr@gmail.com",
        "sla_hours": 72,
        "default_priority": "MEDIUM",
        "description": "Performs employment background verification, reference checks, and relieving letter validation.",
        "members": [],
    },
    {
        "dept_code": "DEPT-ONBOARD",
        "team_name": "Onboarding HR",
        "category_scope": "ONBOARDING",
        "dept_gmail": "onboarding.desk.hr@gmail.com",
        "sla_hours": 48,
        "default_priority": "MEDIUM",
        "description": "Manages pre-joining documentation, offer induction, orientation, and day-1 readiness.",
        "members": [],
    },
    {
        "dept_code": "DEPT-IT-ASSET",
        "team_name": "IT Asset Desk",
        "category_scope": "ASSET_IT",
        "dept_gmail": "it.asset.hr@gmail.com",
        "sla_hours": 48,
        "default_priority": "MEDIUM",
        "description": "Handles laptop allocation, VPN/email provisioning, hardware return, and access badges.",
        "members": [],
    },
    {
        "dept_code": "DEPT-BENEFITS",
        "team_name": "Benefits & Comp HR",
        "category_scope": "BENEFITS, PERFORMANCE",
        "dept_gmail": "benefits.comp.hr@gmail.com",
        "sla_hours": 72,
        "default_priority": "LOW",
        "description": "Manages medical insurance, wellness benefits, variable pay, and performance appraisal cycles.",
        "members": [],
    },
    {
        "dept_code": "DEPT-PEOPLEDESK",
        "team_name": "PeopleDesk",
        "category_scope": "ALL_HR, PAYROLL, LEAVE, ATTENDANCE, RESIGNATION, ONBOARDING, BGV, DOCUMENTS, ASSET_IT, EMPLOYEE_PROFILE, BENEFITS, PERFORMANCE, GENERAL_HR, PEOPLEDESK",
        "dept_gmail": "vaibhavx002@zohomail.in",
        "sla_hours": 48,
        "default_priority": "MEDIUM",
        "description": "Central People Desk managing all employee queries, onboarding, payroll, leave, attendance, and multi-department routing.",
        "members": [],
    },
]


def ensure_default_departments_seeded() -> None:
    conn = get_connection()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS hr_system_meta (key TEXT PRIMARY KEY, val TEXT)")
        conn.execute("CREATE TABLE IF NOT EXISTS hr_deleted_departments (dept_code TEXT PRIMARY KEY, deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        
        meta = conn.execute("SELECT val FROM hr_system_meta WHERE key = 'departments_initialized'").fetchone()
        deleted_rows = conn.execute("SELECT dept_code FROM hr_deleted_departments").fetchall()
        deleted_codes = {r["dept_code"] for r in deleted_rows}

        if not meta:
            for dept in _DEFAULT_DEPARTMENTS:
                if dept["dept_code"] not in deleted_codes:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO hr_departments (
                            dept_code, team_name, category_scope, dept_gmail, sla_hours, default_priority, description
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            dept["dept_code"],
                            dept["team_name"],
                            dept["category_scope"],
                            dept["dept_gmail"],
                            int(dept["sla_hours"]),
                            dept["default_priority"],
                            dept["description"],
                        ),
                    )
            conn.execute("INSERT OR REPLACE INTO hr_system_meta (key, val) VALUES ('departments_initialized', '1')")

        # Ensure vaibhavx002@zohomail.in is registered as specialist in PeopleDesk if PeopleDesk exists
        p_row = conn.execute("SELECT id FROM hr_departments WHERE dept_code = 'DEPT-PEOPLEDESK'").fetchone()
        if p_row:
            p_id = int(p_row["id"])
            m_check = conn.execute("SELECT id FROM hr_department_members WHERE LOWER(email) = 'vaibhavx002@zohomail.in'").fetchone()
            if not m_check:
                conn.execute(
                    """
                    INSERT INTO hr_department_members (
                        dept_id, dept_ids, team_name, member_name, email, role, designation, category_scope, active
                    ) VALUES (
                        ?, ?, 'PeopleDesk', 'Vaibhav Yadav', 'vaibhavx002@zohomail.in', 'HR_AGENT',
                        'HR Specialist / Agent',
                        'ALL_HR, PAYROLL, LEAVE, ATTENDANCE, RESIGNATION, ONBOARDING, BGV, DOCUMENTS, ASSET_IT, EMPLOYEE_PROFILE, BENEFITS, PERFORMANCE, GENERAL_HR, PEOPLEDESK',
                        1
                    )
                    """,
                    (p_id, str(p_id)),
                )
        conn.commit()
    finally:
        conn.close()


def list_departments_with_members() -> List[Dict[str, Any]]:
    ensure_default_departments_seeded()
    conn = get_connection()
    try:
        dept_rows = conn.execute(
            "SELECT * FROM hr_departments ORDER BY id ASC"
        ).fetchall()
        member_rows = conn.execute(
            "SELECT * FROM hr_department_members WHERE active = 1 ORDER BY id ASC"
        ).fetchall()
        case_rows = conn.execute(
            """
            SELECT assigned_team, assigned_user, status
            FROM cases
            WHERE UPPER(status) NOT IN ('CLOSED')
            """
        ).fetchall()
    finally:
        conn.close()

    team_case_counts: Dict[str, int] = {}
    user_case_counts: Dict[str, int] = {}
    for cr in case_rows:
        t_name = (cr["assigned_team"] or "").strip()
        u_name = (cr["assigned_user"] or "").strip()
        if t_name:
            team_case_counts[t_name.lower()] = team_case_counts.get(t_name.lower(), 0) + 1
        if u_name:
            user_case_counts[u_name.lower()] = user_case_counts.get(u_name.lower(), 0) + 1

    members_by_dept: Dict[int, List[Dict[str, Any]]] = {}
    for mr in member_rows:
        m_dict = dict(mr)
        m_name = m_dict["member_name"]
        m_dict["active_cases"] = user_case_counts.get(m_name.lower(), 0)
        
        # Ensure sub_department is properly categorized
        cur_sub = (m_dict.get("sub_department") or "").strip()
        cat_scope = (m_dict.get("category_scope") or "").upper()
        desig = (m_dict.get("designation") or "").upper()
        team = (m_dict.get("team_name") or "").upper()
        if not cur_sub or cur_sub in ("General HR", "Salary & Payroll"):
            if "LEAVE" in cat_scope or "LEAVE" in desig or "LEAVE" in team:
                m_dict["sub_department"] = "Leave Management"
            elif "ATTEND" in cat_scope or "ATTEND" in desig or "ATTEND" in team:
                m_dict["sub_department"] = "Attendance & Shifts"
            elif "PAYROLL" in cat_scope or "SALARY" in cat_scope or "PAYROLL" in desig or "PAYROLL" in team:
                m_dict["sub_department"] = "Salary & Payroll"
            elif "BENEFIT" in cat_scope or "COMP" in desig or "BENEFIT" in team:
                m_dict["sub_department"] = "Benefits & Wellness"
            elif "RESIGN" in cat_scope or "EXIT" in desig or "OPS" in team:
                m_dict["sub_department"] = "HR Operations & Exit"
            elif "ASSET" in cat_scope or "IT" in team:
                m_dict["sub_department"] = "IT Asset Desk"
            elif "BGV" in cat_scope or "BGV" in team:
                m_dict["sub_department"] = "Background Verification"
            else:
                m_dict["sub_department"] = cur_sub or "Salary & Payroll"
        else:
            m_dict["sub_department"] = cur_sub

        members_by_dept.setdefault(int(m_dict["dept_id"]), []).append(m_dict)

    from backend.services.classification.model_registry import get_category_ai_summary

    departments: List[Dict[str, Any]] = []
    for dr in dept_rows:
        d_dict = dict(dr)
        dept_id = int(d_dict["id"])
        t_name = d_dict["team_name"]
        m_list = members_by_dept.get(dept_id, [])
        d_dict["members"] = m_list
        d_dict["member_count"] = len(m_list)
        d_dict["active_cases"] = team_case_counts.get(t_name.lower(), 0)
        cats = [c.strip().upper() for c in (d_dict.get("category_scope") or "").split(",") if c.strip()]
        d_dict["categories"] = cats
        ai_models = [get_category_ai_summary(c) for c in cats] if cats else []
        d_dict["ai_models"] = ai_models
        d_dict["primary_ai_model"] = ai_models[0] if ai_models else get_category_ai_summary("GENERAL_HR")
        departments.append(d_dict)

    return departments


def _sync_department_categories_and_routing(
    team_name: str,
    category_scope: str,
    sla_hours: int,
    default_priority: str,
    description: str = "",
) -> None:
    """
    Ensure every category code handled by a department is registered in
    `backend/data/categories.json` and `backend/data/routing.json`.
    """
    from backend.classification.category_config import load_category_configs, save_or_update_category_config
    from backend.services.cases.case_engine import save_or_update_routing_rule

    cats = [c.strip().upper().replace(" ", "_") for c in (category_scope or "").split(",") if c.strip()]
    existing_configs = load_category_configs()
    for cat in cats:
        if cat == "UNKNOWN":
            continue
        if cat not in existing_configs:
            desc_words = [
                w.lower()
                for w in (description or "").replace(",", " ").replace(".", " ").split()
                if len(w) >= 4
            ][:6]
            save_or_update_category_config(
                cat,
                {
                    "display_name": cat.replace("_", " ").title(),
                    "specialized_model": False,
                    "keywords_strong": [cat.replace("_", " ").lower(), team_name.lower()],
                    "keywords_weak": [cat.lower()] + desc_words,
                    "required_fields": ["employee_id"],
                    "optional_fields": ["description", "attachment"],
                },
            )
        save_or_update_routing_rule(
            cat,
            {
                "team": team_name,
                "priority": default_priority,
                "sla_hours": sla_hours,
                "auto_create_case": True,
            },
        )


def resolve_member_email(team_name: Optional[str], member_name: Optional[str], explicit_email: Optional[str] = None) -> Optional[str]:
    if explicit_email and "@" in str(explicit_email):
        return str(explicit_email).strip()

    ensure_default_departments_seeded()
    conn = get_connection()
    try:
        if member_name:
            row = conn.execute(
                """
                SELECT email FROM hr_department_members
                WHERE LOWER(member_name) = LOWER(?) AND active = 1
                ORDER BY CASE WHEN LOWER(team_name) = LOWER(?) THEN 0 ELSE 1 END
                LIMIT 1
                """,
                (member_name.strip(), (team_name or "").strip()),
            ).fetchone()
            if row and row["email"]:
                return str(row["email"]).strip()

        if team_name:
            d_row = conn.execute(
                "SELECT dept_gmail FROM hr_departments WHERE LOWER(team_name) = LOWER(?) LIMIT 1",
                (team_name.strip(),),
            ).fetchone()
            if d_row and d_row["dept_gmail"]:
                return str(d_row["dept_gmail"]).strip()
    finally:
        conn.close()
    return None


def add_department_member(
    dept_id: int,
    member_name: str,
    email: str,
    role: str = "HR_AGENT",
    designation: str = "HR Specialist",
    sub_department: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_default_departments_seeded()
    clean_name = (member_name or "").strip()
    clean_email = (email or "").strip().lower()
    clean_sub_dept = (sub_department or "").strip() or None
    if not clean_name or not clean_email or "@" not in clean_email:
        raise ValueError("Valid member name and Gmail address are required.")

    conn = get_connection()
    try:
        dept_row = conn.execute("SELECT * FROM hr_departments WHERE id = ?", (int(dept_id),)).fetchone()
        if not dept_row:
            raise ValueError(f"Department id {dept_id} not found.")
        cur = conn.execute(
            """
            INSERT INTO hr_department_members (
                dept_id, team_name, member_name, email, role, designation, sub_department, active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                int(dept_id),
                dept_row["team_name"],
                clean_name,
                clean_email,
                (role or "HR_AGENT").strip().upper(),
                (designation or "HR Specialist").strip(),
                clean_sub_dept,
            ),
        )
        new_id = int(cur.lastrowid)
        conn.commit()
        row = conn.execute("SELECT * FROM hr_department_members WHERE id = ?", (new_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def update_department_member(
    member_id: int,
    member_name: Optional[str] = None,
    email: Optional[str] = None,
    role: Optional[str] = None,
    designation: Optional[str] = None,
    sub_department: Optional[str] = None,
) -> Dict[str, Any]:
    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM hr_department_members WHERE id = ?", (int(member_id),)).fetchone()
        if not existing:
            raise ValueError(f"Department member {member_id} not found.")
        new_name = (member_name or existing["member_name"]).strip()
        new_email = (email or existing["email"]).strip().lower()
        new_role = (role or existing["role"]).strip().upper()
        new_desig = (designation or existing["designation"]).strip()
        new_sub_dept = (sub_department or "").strip() or existing["sub_department"] if sub_department is not None else existing["sub_department"]
        conn.execute(
            """
            UPDATE hr_department_members
            SET member_name = ?, email = ?, role = ?, designation = ?, sub_department = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_name, new_email, new_role, new_desig, new_sub_dept, int(member_id)),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM hr_department_members WHERE id = ?", (int(member_id),)).fetchone()
        return dict(row)
    finally:
        conn.close()


def delete_department_member(member_id: int) -> bool:
    conn = get_connection()
    try:
        conn.execute("DELETE FROM hr_department_members WHERE id = ?", (int(member_id),))
        conn.commit()
        return True
    finally:
        conn.close()


def create_department(
    team_name: str,
    dept_gmail: str,
    dept_code: Optional[str] = None,
    category_scope: Optional[str] = None,
    sla_hours: int = 48,
    default_priority: str = "MEDIUM",
    description: Optional[str] = None,
    lead_name: Optional[str] = None,
    lead_email: Optional[str] = None,
    lead_designation: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_default_departments_seeded()
    clean_name = (team_name or "").strip()
    clean_gmail = (dept_gmail or "").strip().lower()
    if not clean_name:
        raise ValueError("Department / Team Name is required.")
    if not clean_gmail or "@" not in clean_gmail:
        raise ValueError("A valid Department Gmail address is required.")

    import re
    slug = re.sub(r"[^A-Z0-9]+", "-", clean_name.upper()).strip("-")[:10] or "CUSTOM"
    clean_code = (dept_code or f"DEPT-{slug}").strip().upper()
    default_cat = re.sub(r"[^A-Z0-9]+", "_", clean_name.upper()).strip("_")[:16] or "GENERAL_HR"
    clean_scope = (category_scope or default_cat).strip().upper()
    clean_sla = max(1, int(sla_hours or 48))
    clean_prio = (default_priority or "MEDIUM").strip().upper()
    if clean_prio not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
        clean_prio = "MEDIUM"
    clean_desc = (description or f"Operational HR desk for {clean_name}.").strip()

    conn = get_connection()
    try:
        dup = conn.execute(
            "SELECT id FROM hr_departments WHERE LOWER(team_name) = LOWER(?) OR LOWER(dept_code) = LOWER(?)",
            (clean_name, clean_code),
        ).fetchone()
        if dup:
            raise ValueError(f"Department '{clean_name}' (or code '{clean_code}') already exists.")

        cur = conn.execute(
            """
            INSERT INTO hr_departments (
                dept_code, team_name, category_scope, dept_gmail, sla_hours, default_priority, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (clean_code, clean_name, clean_scope, clean_gmail, clean_sla, clean_prio, clean_desc),
        )
        dept_id = int(cur.lastrowid)

        if lead_name and str(lead_name).strip():
            m_email = (lead_email or clean_gmail).strip().lower()
            m_desig = (lead_designation or f"Lead — {clean_name}").strip()
            conn.execute(
                """
                INSERT INTO hr_department_members (
                    dept_id, team_name, member_name, email, role, designation, active
                ) VALUES (?, ?, ?, ?, 'HR_LEAD', ?, 1)
                """,
                (dept_id, clean_name, str(lead_name).strip(), m_email, m_desig),
            )

        conn.commit()
        row = conn.execute("SELECT * FROM hr_departments WHERE id = ?", (dept_id,)).fetchone()
        dept_out = dict(row)
    finally:
        conn.close()

    try:
        _sync_department_categories_and_routing(
            team_name=clean_name,
            category_scope=clean_scope,
            sla_hours=clean_sla,
            default_priority=clean_prio,
            description=clean_desc,
        )
    except Exception:
        pass
    return dept_out


def update_department_info(
    dept_id: int,
    team_name: Optional[str] = None,
    dept_code: Optional[str] = None,
    category_scope: Optional[str] = None,
    dept_gmail: Optional[str] = None,
    sla_hours: Optional[int] = None,
    default_priority: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM hr_departments WHERE id = ?", (int(dept_id),)).fetchone()
        if not existing:
            raise ValueError(f"Department {dept_id} not found.")
        new_name = (team_name or existing["team_name"]).strip()
        new_code = (dept_code or existing["dept_code"]).strip().upper()
        new_scope = (category_scope or existing["category_scope"]).strip().upper()
        new_gmail = (dept_gmail or existing["dept_gmail"]).strip().lower()
        new_sla = int(sla_hours if sla_hours is not None else existing["sla_hours"])
        new_prio = (default_priority or existing["default_priority"]).strip().upper()
        new_desc = (description if description is not None else existing["description"]).strip()
        conn.execute(
            """
            UPDATE hr_departments
            SET team_name = ?, dept_code = ?, category_scope = ?, dept_gmail = ?, sla_hours = ?, default_priority = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_name, new_code, new_scope, new_gmail, new_sla, new_prio, new_desc, int(dept_id)),
        )
        if new_name != existing["team_name"]:
            conn.execute(
                "UPDATE hr_department_members SET team_name = ? WHERE dept_id = ?",
                (new_name, int(dept_id)),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM hr_departments WHERE id = ?", (int(dept_id),)).fetchone()
        dept_out = dict(row)
    finally:
        conn.close()

    try:
        _sync_department_categories_and_routing(
            team_name=new_name,
            category_scope=new_scope,
            sla_hours=new_sla,
            default_priority=new_prio,
            description=new_desc,
        )
    except Exception:
        pass
    return dept_out



def delete_department(dept_id: int) -> bool:
    conn = get_connection()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS hr_deleted_departments (dept_code TEXT PRIMARY KEY, deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        row = conn.execute("SELECT dept_code FROM hr_departments WHERE id = ?", (int(dept_id),)).fetchone()
        if row and row["dept_code"]:
            conn.execute("INSERT OR REPLACE INTO hr_deleted_departments (dept_code) VALUES (?)", (row["dept_code"],))
        conn.execute("DELETE FROM hr_department_members WHERE dept_id = ?", (int(dept_id),))
        conn.execute("DELETE FROM hr_departments WHERE id = ?", (int(dept_id),))
        conn.commit()
        return True
    finally:
        conn.close()

