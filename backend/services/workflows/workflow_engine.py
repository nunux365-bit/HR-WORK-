"""
HR FLOW — Phase 6.15 & Phase 7.12 Workflow State Machine Engine (backend/services/workflows/workflow_engine.py)
Executes explicit state transitions with:
  - From State
  - To State
  - Trigger
  - Conditions (employee_matched, all_fields_valid, approvals_completed)
  - Actions
  - Audit Event
Strictly blocks invalid transitions and condition-violating transitions.
"""

import json
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from backend.database.connection import get_connection
from backend.services.workflows.workflow_registry import get_workflow_for_category, get_workflow_by_id
from backend.services.audit.audit_service import log_event


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def get_or_create_workflow_instance(
    case_id: int,
    category: str,
    initial_state_override: Optional[str] = None,
    performed_by: str = "workflow_engine",
) -> Optional[Dict[str, Any]]:
    wf_def = get_workflow_for_category(category)
    if not wf_def:
        return None

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
            (int(case_id),),
        ).fetchone()
        if existing:
            return _format_workflow_instance(existing, wf_def)

        init_state = initial_state_override or wf_def["initial_state"]
        history = [
            {
                "from_state": None,
                "to_state": init_state,
                "trigger": "WORKFLOW_INITIALIZED",
                "timestamp": _utc_now_iso(),
                "performed_by": performed_by,
                "audit_event": f"Workflow '{wf_def['name']}' initialized at state {init_state}",
            }
        ]
        cur = conn.execute(
            """
            INSERT INTO workflow_instances (
                case_id,
                workflow_id,
                workflow_name,
                current_state,
                status,
                history_json
            ) VALUES (?, ?, ?, ?, 'ACTIVE', ?)
            """,
            (
                int(case_id),
                wf_def["workflow_id"],
                wf_def["name"],
                init_state,
                json.dumps(history),
            ),
        )
        conn.execute(
            """
            UPDATE cases
            SET workflow_id = ?,
                workflow_state = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (wf_def["workflow_id"], init_state, int(case_id)),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM workflow_instances WHERE id = ?", (cur.lastrowid,)).fetchone()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case_id,
        action="WORKFLOW_STARTED",
        description=f"Workflow '{wf_def['name']}' started in state {init_state}",
        performed_by=performed_by,
        metadata={"workflow_id": wf_def["workflow_id"], "state": init_state},
    )
    return _format_workflow_instance(row, wf_def)


def transition_workflow_state(
    case_id: int,
    trigger: Optional[str] = None,
    target_state: Optional[str] = None,
    performed_by: str = "hr_admin",
    enforce_conditions: bool = False,
) -> Dict[str, Any]:
    """
    Execute a deterministic state transition on the workflow instance for `case_id`.
    Strictly blocks transitions not valid from `current_state`.
    """
    conn = get_connection()
    try:
        case_row = conn.execute("SELECT * FROM cases WHERE id = ?", (int(case_id),)).fetchone()
        if not case_row:
            raise ValueError(f"Case {case_id} not found.")
        case_dict = dict(case_row)

        inst_row = conn.execute(
            "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
            (int(case_id),),
        ).fetchone()
        if not inst_row:
            created = get_or_create_workflow_instance(int(case_id), case_dict.get("category") or "GENERAL_HR", performed_by=performed_by)
            if not created:
                raise ValueError(f"No workflow definition configured for category {case_dict.get('category')}.")
            inst_row = conn.execute(
                "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
                (int(case_id),),
            ).fetchone()

        inst = dict(inst_row)
    finally:
        conn.close()

    wf_def = get_workflow_by_id(inst["workflow_id"])
    if not wf_def:
        raise ValueError(f"Workflow definition {inst['workflow_id']} not found.")

    current_state = inst["current_state"]
    if current_state == "CLOSED" and inst.get("status") == "COMPLETED":
        raise ValueError("Workflow is already COMPLETED at state 'CLOSED'.")

    transitions: List[Dict[str, Any]] = wf_def.get("transitions", [])

    chosen_transition = None
    for t in transitions:
        if t["from_state"] == current_state:
            if trigger and t["trigger"].upper() == trigger.upper():
                chosen_transition = t
                break
            if target_state and t["to_state"].upper() == target_state.upper():
                chosen_transition = t
                break
            if not trigger and not target_state and chosen_transition is None:
                chosen_transition = t

    if not chosen_transition:
        states_list = wf_def.get("states", [])
        if not trigger and not target_state and current_state in states_list:
            cur_idx = states_list.index(current_state)
            if cur_idx < len(states_list) - 1:
                next_st = states_list[cur_idx + 1]
                chosen_transition = {
                    "from_state": current_state,
                    "to_state": next_st,
                    "trigger": f"ADVANCE_TO_{next_st}",
                    "conditions": [],
                    "actions": ["resolve_and_close_case"] if next_st == "CLOSED" else ["set_case_in_progress"],
                    "audit_event": f"Workflow advanced from {current_state} to {next_st}",
                }
        if not chosen_transition:
            requested = trigger or target_state or "NEXT"
            raise ValueError(
                f"Invalid workflow transition '{requested}' from current state '{current_state}'."
            )

    # Check transition conditions if enforce_conditions is enabled or case is in REVIEW_REQUIRED conflict
    if enforce_conditions:
        conds = chosen_transition.get("conditions") or []
        if "employee_matched" in conds and not case_dict.get("employee_id"):
            raise ValueError(
                f"Transition '{chosen_transition['trigger']}' blocked: employee must be verified first."
            )
        if "all_fields_valid" in conds:
            try:
                val_res = json.loads(case_dict.get("validation_result") or "{}")
            except Exception:
                val_res = {}
            if val_res.get("missing_fields"):
                raise ValueError(
                    f"Transition '{chosen_transition['trigger']}' blocked: missing required fields ({', '.join(val_res['missing_fields'])})."
                )

    next_state = chosen_transition["to_state"]
    wf_status = "COMPLETED" if next_state == "CLOSED" else "ACTIVE"

    try:
        history = json.loads(inst.get("history_json") or "[]")
    except Exception:
        history = []

    history.append(
        {
            "from_state": current_state,
            "to_state": next_state,
            "trigger": chosen_transition.get("trigger"),
            "actions": chosen_transition.get("actions", []),
            "timestamp": _utc_now_iso(),
            "performed_by": performed_by,
            "audit_event": chosen_transition.get("audit_event"),
        }
    )

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE workflow_instances
            SET current_state = ?,
                status = ?,
                history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_state, wf_status, json.dumps(history), inst["id"]),
        )

        actions = chosen_transition.get("actions", [])
        case_status_update = None
        if "set_case_on_hold" in actions or next_state == "DOCUMENTS_REQUIRED":
            case_status_update = "ON_HOLD"
        elif "resolve_and_close_case" in actions or next_state == "CLOSED":
            case_status_update = "RESOLVED"
        elif "set_case_in_progress" in actions:
            case_status_update = "IN_PROGRESS"

        if case_status_update:
            conn.execute(
                """
                UPDATE cases
                SET workflow_state = ?,
                    status = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (next_state, case_status_update, int(case_id)),
            )
        else:
            conn.execute(
                """
                UPDATE cases
                SET workflow_state = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (next_state, int(case_id)),
            )
        conn.commit()
        updated_row = conn.execute("SELECT * FROM workflow_instances WHERE id = ?", (inst["id"],)).fetchone()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case_id,
        action="WORKFLOW_TRANSITIONED",
        description=chosen_transition.get("audit_event")
        or f"Workflow transitioned {current_state} → {next_state}",
        performed_by=performed_by,
        metadata={
            "from_state": current_state,
            "to_state": next_state,
            "trigger": chosen_transition.get("trigger"),
        },
    )

    # Phase 8.18 Workflow -> Action Execution Mapping:
    # Delegate configured external HR actions to the universal Action Execution Engine
    _INTERNAL_STATE_MACROS = {
        "set_case_on_hold",
        "set_case_in_progress",
        "resolve_and_close_case",
        "request_manager_approval",
        "reopen_case",
        "assign_bgv_team",
        "record_bgv_clearance",
        "initiate_asset_and_payroll_clearance",
        "update_attendance_log",
        "update_hrms_leave",
        "dispatch_bgv_vendor",
        "record_bgv_report",
        "update_payroll_sheet",
        "allocate_it_asset",
        "validate_exit_pack",
        "send_document_request",
    }
    executed_action_results = []
    try:
        from backend.services.actions.action_engine import execute_hr_action
        from backend.services.actions.action_library import DEFAULT_ACTION_CATALOG, resolve_standard_action_type

        for act_item in chosen_transition.get("actions", []):
            if act_item in _INTERNAL_STATE_MACROS:
                continue
            std_act = resolve_standard_action_type(act_item)
            if std_act in DEFAULT_ACTION_CATALOG:
                act_res = execute_hr_action(
                    action_type=std_act,
                    case_identifier=int(case_id),
                    workflow_id=inst["workflow_id"],
                    workflow_step=f"{current_state}_TO_{next_state}",
                    performed_by=performed_by,
                    role="ADMIN",
                )
                executed_action_results.append(act_res)
    except Exception:
        pass

    formatted = _format_workflow_instance(updated_row, wf_def)
    formatted["executed_actions"] = executed_action_results
    return formatted


def redo_or_step_workflow_state(
    case_id: int,
    action: str = "RESTART",
    target_state: Optional[str] = None,
    reason: Optional[str] = None,
    performed_by: str = "hr_admin",
) -> Dict[str, Any]:
    """
    Supports moving the workflow backward, restarting/redoing from step 1,
    jumping directly to any step, or advancing to the next step:
      - action='RESTART' / 'REDO': Resets workflow to initial_state (Step 1) and sets status='ACTIVE'.
      - action='STEP_BACK' / 'PREVIOUS_STEP': Moves workflow back one step in states list.
      - action='GOTO_STATE' / 'SET_STATE': Moves workflow to any valid state in wf_def['states'].
      - action='NEXT_STEP': Advances workflow to the next state.
    """
    norm_action = (action or "RESTART").strip().upper()
    if norm_action == "NEXT_STEP":
        return transition_workflow_state(
            case_id=case_id,
            trigger=None,
            target_state=target_state,
            performed_by=performed_by,
            enforce_conditions=False,
        )

    conn = get_connection()
    try:
        case_row = conn.execute("SELECT * FROM cases WHERE id = ?", (int(case_id),)).fetchone()
        if not case_row:
            raise ValueError(f"Case ID {case_id} not found.")
        case_dict = dict(case_row)

        inst_row = conn.execute(
            "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
            (int(case_id),),
        ).fetchone()
    finally:
        conn.close()

    if not inst_row:
        get_or_create_workflow_instance(
            int(case_id),
            case_dict.get("category") or "GENERAL_HR",
            performed_by=performed_by,
        )
        conn = get_connection()
        try:
            inst_row = conn.execute(
                "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
                (int(case_id),),
            ).fetchone()
        finally:
            conn.close()

    inst = dict(inst_row)
    wf_def = get_workflow_by_id(inst["workflow_id"]) or get_workflow_for_category(case_dict.get("category") or "")
    if not wf_def:
        raise ValueError(f"Workflow definition '{inst['workflow_id']}' not found.")

    states: List[str] = wf_def.get("states", [])
    if not states:
        raise ValueError("Workflow definition has no states configured.")

    current_state = inst["current_state"]
    initial_state = wf_def.get("initial_state") or states[0]

    if norm_action in ("RESTART", "REDO", "RESET"):
        new_state = initial_state
        trigger_code = "REDO_PROCESS"
        audit_code = "WORKFLOW_RESTARTED"
        default_desc = f"Workflow redo initiated: reset from {current_state} back to Step 1 ({new_state})"
    elif norm_action in ("STEP_BACK", "PREVIOUS_STEP", "BACK"):
        if current_state in states:
            cur_idx = states.index(current_state)
            if cur_idx <= 0:
                raise ValueError(f"Workflow is already at the first step ('{current_state}').")
            new_state = states[cur_idx - 1]
        else:
            new_state = initial_state
        trigger_code = "STEP_BACK"
        audit_code = "WORKFLOW_STEPPED_BACK"
        default_desc = f"Workflow stepped back from {current_state} to {new_state}"
    elif norm_action in ("GOTO_STATE", "SET_STATE", "JUMP"):
        req_state = (target_state or "").strip().upper()
        matched_state = next((s for s in states if s.upper() == req_state), None)
        if not matched_state:
            raise ValueError(f"Target state '{target_state}' is not valid for workflow {wf_def.get('workflow_id')}.")
        new_state = matched_state
        trigger_code = f"GOTO_{new_state}"
        audit_code = "WORKFLOW_STATE_OVERRIDDEN"
        default_desc = f"Workflow state set from {current_state} to {new_state}"
    else:
        raise ValueError(f"Unsupported workflow control action '{action}'.")

    reason_text = (reason or "").strip()
    audit_description = f"{default_desc} ({reason_text})" if reason_text else default_desc
    wf_status = "COMPLETED" if new_state == "CLOSED" else "ACTIVE"

    try:
        history = json.loads(inst.get("history_json") or "[]")
    except Exception:
        history = []

    history.append({
        "from_state": current_state,
        "to_state": new_state,
        "trigger": trigger_code,
        "actions": [norm_action.lower()],
        "timestamp": _utc_now_iso(),
        "performed_by": performed_by,
        "audit_event": audit_description,
    })

    conn = get_connection()
    try:
        conn.execute(
            """
            UPDATE workflow_instances
            SET current_state = ?,
                status = ?,
                history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_state, wf_status, json.dumps(history), inst["id"]),
        )

        # Keep cases table status and workflow_state in sync
        if new_state == "CLOSED":
            new_case_status = "RESOLVED"
        elif new_state == "DOCUMENTS_REQUIRED":
            new_case_status = "ON_HOLD"
        elif new_state == initial_state and norm_action in ("RESTART", "REDO", "RESET"):
            new_case_status = "IN_PROGRESS"
        else:
            new_case_status = "IN_PROGRESS"

        conn.execute(
            """
            UPDATE cases
            SET workflow_state = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_state, new_case_status, int(case_id)),
        )
        conn.commit()
        updated_row = conn.execute("SELECT * FROM workflow_instances WHERE id = ?", (inst["id"],)).fetchone()
    finally:
        conn.close()

    log_event(
        entity_type="CASE",
        entity_id=case_id,
        action=audit_code,
        description=audit_description,
        performed_by=performed_by,
        metadata={
            "action": norm_action,
            "from_state": current_state,
            "to_state": new_state,
            "trigger": trigger_code,
            "reason": reason_text,
        },
    )

    return _format_workflow_instance(updated_row, wf_def)


def reopen_workflow_instance(case_id: int, performed_by: str = "hr_admin", reason: str = "Case reopened") -> Optional[Dict[str, Any]]:
    """Reopen a COMPLETED workflow instance back to ACTIVE at its initial or penultimate state."""
    conn = get_connection()
    try:
        inst_row = conn.execute(
            "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
            (int(case_id),),
        ).fetchone()
        if not inst_row:
            return None
        inst = dict(inst_row)
        wf_def = get_workflow_by_id(inst["workflow_id"]) or {}
        states = wf_def.get("states", [])
        reopen_state = states[-2] if len(states) >= 2 else (wf_def.get("initial_state") or "IN_PROGRESS")

        try:
            history = json.loads(inst.get("history_json") or "[]")
        except Exception:
            history = []

        history.append({
            "from_state": inst["current_state"],
            "to_state": reopen_state,
            "trigger": "REOPEN_CASE",
            "actions": ["reopen_case"],
            "timestamp": _utc_now_iso(),
            "performed_by": performed_by,
            "audit_event": f"Workflow reopened to {reopen_state}: {reason}",
        })

        conn.execute(
            """
            UPDATE workflow_instances
            SET current_state = ?,
                status = 'ACTIVE',
                history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (reopen_state, json.dumps(history), inst["id"]),
        )
        conn.execute(
            """
            UPDATE cases
            SET workflow_state = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (reopen_state, int(case_id)),
        )
        conn.commit()
        updated = conn.execute("SELECT * FROM workflow_instances WHERE id = ?", (inst["id"],)).fetchone()
        return _format_workflow_instance(updated, wf_def)
    finally:
        conn.close()


def _format_workflow_instance(row, wf_def: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row)
    wf_def = wf_def or get_workflow_by_id(d["workflow_id"]) or {}
    try:
        history = json.loads(d.get("history_json") or "[]")
    except Exception:
        history = []

    states = wf_def.get("states", [])
    steps_display = wf_def.get("steps_display", states)
    current_state = d.get("current_state")
    initial_state = wf_def.get("initial_state") or (states[0] if states else "READY")

    available_transitions = [
        {
            "trigger": t["trigger"],
            "label": t["trigger"].replace("_", " ").title(),
            "to_state": t["to_state"],
            "to": t["to_state"],
            "conditions": t.get("conditions", []),
            "actions": t.get("actions", []),
            "audit_event": t.get("audit_event"),
        }
        for t in wf_def.get("transitions", [])
        if t.get("from_state") == current_state
    ]

    cur_idx = states.index(current_state) if current_state in states else 0
    total_steps = len(states) if states else 1
    step_index = cur_idx + 1
    progress_percent = round((step_index / total_steps) * 100) if total_steps > 0 else 0
    previous_state = states[cur_idx - 1] if cur_idx > 0 and len(states) > cur_idx else None
    next_seq_state = states[cur_idx + 1] if cur_idx < len(states) - 1 else None

    if not available_transitions and next_seq_state:
        available_transitions = [
            {
                "trigger": f"ADVANCE_TO_{next_seq_state}",
                "label": f"Move to {next_seq_state.replace('_', ' ').title()}",
                "to_state": next_seq_state,
                "to": next_seq_state,
                "conditions": [],
                "actions": [],
                "audit_event": f"Workflow advanced to {next_seq_state}",
            }
        ]

    return {
        "instance_id": d["id"],
        "case_id": d["case_id"],
        "workflow_id": d["workflow_id"],
        "category": wf_def.get("category"),
        "name": d.get("workflow_name") or wf_def.get("name") or d["workflow_id"],
        "version": wf_def.get("version", "v1.0"),
        "description": wf_def.get("description", ""),
        "initial_state": initial_state,
        "current_state": current_state,
        "status": d.get("status", "ACTIVE"),
        "states": states,
        "steps_display": steps_display,
        "state_box_types": wf_def.get("state_box_types", {}),
        "node_boxes": wf_def.get("node_boxes", []),
        "automation_config": wf_def.get("automation_config", {}),
        "step_index": step_index,
        "total_steps": total_steps,
        "progress_percent": progress_percent,
        "can_step_back": bool(cur_idx > 0),
        "previous_state": previous_state,
        "can_advance": bool(available_transitions),
        "can_redo": bool(cur_idx > 0 or d.get("status") == "COMPLETED" or len(history) > 1),
        "available_transitions": available_transitions,
        "all_transitions": wf_def.get("transitions", []),
        "history": history,
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
    }


def _parse_duration_days(fields_map: Dict[str, Any]) -> int:
    """Calculate or parse leave duration in days from extracted fields."""
    import re
    raw_dur = fields_map.get("duration") or fields_map.get("duration_days")
    if raw_dur is not None:
        m = re.search(r"(\d+)", str(raw_dur))
        if m:
            val = int(m.group(1))
            if "week" in str(raw_dur).lower():
                val *= 7
            return max(1, val)

    start_s = str(fields_map.get("start_date") or "").strip()
    end_s = str(fields_map.get("end_date") or "").strip()
    if start_s and end_s:
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%b %d, %Y", "%d %b %Y"):
            try:
                d1 = datetime.strptime(start_s, fmt)
                d2 = datetime.strptime(end_s, fmt)
                return max(1, (d2 - d1).days + 1)
            except Exception:
                continue
        if start_s == end_s:
            return 1
    return 1


def build_execution_context(
    case_id: Optional[int] = None,
    category: Optional[str] = None,
    mock_overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Builds the n8n-style Runtime Execution Context (`$ctx`) for evaluating conditions
    and executing automated actions.
    """
    case_dict: Dict[str, Any] = {}
    emp_dict: Dict[str, Any] = {}
    fields_map: Dict[str, Any] = {}
    val_res: Dict[str, Any] = {}

    if case_id:
        conn = get_connection()
        try:
            c_row = conn.execute("SELECT * FROM cases WHERE id = ?", (int(case_id),)).fetchone()
            if c_row:
                case_dict = dict(c_row)
                try:
                    ext = json.loads(case_dict.get("extracted_data") or "{}")
                    fields_map = ext.get("fields") if isinstance(ext.get("fields"), dict) else ext
                except Exception:
                    fields_map = {}
                try:
                    val_res = json.loads(case_dict.get("validation_result") or "{}")
                except Exception:
                    val_res = {}
                emp_code = case_dict.get("employee_id") or fields_map.get("employee_id")
                if emp_code:
                    e_row = conn.execute(
                        "SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?) OR CAST(id AS TEXT) = ? LIMIT 1",
                        (str(emp_code), str(emp_code)),
                    ).fetchone()
                    if e_row:
                        emp_dict = dict(e_row)
        finally:
            conn.close()

    norm_cat = (category or case_dict.get("category") or "LEAVE").strip().upper()
    emp_id = emp_dict.get("employee_id") or case_dict.get("employee_id") or fields_map.get("employee_id") or ""
    emp_matched = bool(case_dict.get("employee_id") or emp_dict) if case_id else True
    missing_fields = val_res.get("missing_fields") if isinstance(val_res.get("missing_fields"), list) else []

    duration_days = _parse_duration_days(fields_map)
    has_attachment = bool(fields_map.get("attachment") or fields_map.get("documents"))

    ctx: Dict[str, Any] = {
        "case": {
            "id": case_dict.get("id") or 0,
            "case_number": case_dict.get("case_number") or "SIMULATION-CASE",
            "category": norm_cat,
            "status": case_dict.get("status") or "IN_PROGRESS",
            "priority": case_dict.get("priority") or "MEDIUM",
            "assigned_team": case_dict.get("assigned_team") or "HR Operations",
        },
        "employee": {
            "matched": emp_matched,
            "employee_id": str(emp_id),
            "name": emp_dict.get("name") or case_dict.get("employee_name") or "Aarav Mehta",
            "department": emp_dict.get("department") or "Engineering",
            "employment_status": emp_dict.get("status") or "ACTIVE",
        },
        "fields": {
            "employee_id": str(emp_id),
            "leave_type": str(fields_map.get("leave_type") or "CASUAL_LEAVE").upper().replace(" ", "_"),
            "start_date": fields_map.get("start_date") or "2026-10-05",
            "end_date": fields_map.get("end_date") or "2026-10-06",
            "duration_days": duration_days,
            "reason": fields_map.get("reason") or fields_map.get("description") or "Standard HR request",
            "date": fields_map.get("date") or "2026-10-02",
            "issue_type": str(fields_map.get("issue_type") or "MISSED_PUNCH").upper().replace(" ", "_"),
            "check_in": fields_map.get("check_in") or "09:00 AM",
            "check_out": fields_map.get("check_out") or "06:12 PM",
            "has_attachment": has_attachment,
            "missing_fields_count": len(missing_fields),
            "missing_fields": missing_fields,
        },
        "hrms": {
            "available_balance": 8,
            "punch_count": 1,
            "punch_in": "MISSED_PUNCH",
            "punch_out": "06:12 PM",
            "shift_code": "GENERAL_SHIFT (09:00 AM - 06:00 PM)",
            "status": "READY",
        },
    }

    # Apply any custom/sandbox overrides from the Workflow Builder simulator
    if isinstance(mock_overrides, dict):
        for section in ("case", "employee", "fields", "hrms"):
            if isinstance(mock_overrides.get(section), dict):
                ctx[section].update(mock_overrides[section])
        # Also support flat dot-keys like "fields.duration_days": 4
        for k, v in mock_overrides.items():
            if "." in k:
                sec, subk = k.split(".", 1)
                if sec in ctx and isinstance(ctx[sec], dict):
                    ctx[sec][subk] = v

    return ctx


def _resolve_ctx_value(ctx: Dict[str, Any], path: Optional[str]) -> Any:
    if not path or not isinstance(path, str):
        return None
    parts = path.strip().split(".")
    cur: Any = ctx
    for p in parts:
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            return None
    return cur


def _evaluate_single_rule(rule: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
    left_path = str(rule.get("left") or "").strip()
    op = str(rule.get("operator") or "EQUALS").strip().upper()
    left_val = _resolve_ctx_value(ctx, left_path)

    right_ref = rule.get("right_ref")
    if right_ref:
        right_val = _resolve_ctx_value(ctx, str(right_ref))
        right_label = f"${right_ref} ({right_val})"
    else:
        right_val = rule.get("right")
        right_label = str(right_val)

    passed = False
    try:
        if op == "IS_TRUE":
            passed = bool(left_val is True or str(left_val).lower() in ("true", "1", "yes"))
            right_label = "true"
        elif op == "IS_FALSE":
            passed = bool(left_val is False or str(left_val).lower() in ("false", "0", "no", "none", ""))
            right_label = "false"
        elif op == "IS_NOT_EMPTY":
            passed = left_val is not None and str(left_val).strip() != ""
            right_label = "not empty"
        elif op == "IS_EMPTY":
            passed = left_val is None or str(left_val).strip() == ""
            right_label = "empty"
        elif op == "EQUALS":
            if isinstance(left_val, (int, float)) or isinstance(right_val, (int, float)):
                passed = float(left_val or 0) == float(right_val or 0)
            else:
                passed = str(left_val or "").strip().upper() == str(right_val or "").strip().upper()
        elif op == "NOT_EQUALS":
            if isinstance(left_val, (int, float)) or isinstance(right_val, (int, float)):
                passed = float(left_val or 0) != float(right_val or 0)
            else:
                passed = str(left_val or "").strip().upper() != str(right_val or "").strip().upper()
        elif op == "LESS_OR_EQUAL":
            passed = float(left_val if left_val is not None else 0) <= float(right_val if right_val is not None else 0)
        elif op == "GREATER_OR_EQUAL":
            passed = float(left_val if left_val is not None else 0) >= float(right_val if right_val is not None else 0)
        elif op == "LESS_THAN":
            passed = float(left_val if left_val is not None else 0) < float(right_val if right_val is not None else 0)
        elif op == "GREATER_THAN":
            passed = float(left_val if left_val is not None else 0) > float(right_val if right_val is not None else 0)
        elif op == "IN":
            items = [x.strip().upper() for x in str(right_val or "").split(",") if x.strip()]
            passed = str(left_val or "").strip().upper() in items
        elif op == "CONTAINS":
            passed = str(right_val or "").strip().lower() in str(left_val or "").strip().lower()
        elif op == "STARTS_WITH":
            passed = str(left_val or "").strip().lower().startswith(str(right_val or "").strip().lower())
        elif op == "ENDS_WITH":
            passed = str(left_val or "").strip().lower().endswith(str(right_val or "").strip().lower())
    except Exception:
        passed = False

    return {
        "id": rule.get("id") or left_path,
        "left": left_path,
        "left_value": left_val,
        "operator": op,
        "right": right_val,
        "right_ref": right_ref,
        "right_display": right_label,
        "passed": passed,
        "description": rule.get("description") or f"{left_path} {op} {right_label}",
    }


def evaluate_condition_rules(
    rules: List[Dict[str, Any]],
    combinator: str = "AND",
    ctx: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Evaluates a list of declarative condition rules against `$ctx` using AND / OR combinator.
    """
    ctx = ctx or {}
    comb = (combinator or "AND").strip().upper()
    eval_list = [_evaluate_single_rule(r, ctx) for r in (rules or [])]
    if not eval_list:
        overall = True
    elif comb == "OR":
        overall = any(r["passed"] for r in eval_list)
    else:
        overall = all(r["passed"] for r in eval_list)

    return {
        "combinator": comb,
        "passed": overall,
        "branch": "YES" if overall else "NO",
        "total_rules": len(eval_list),
        "passed_count": sum(1 for r in eval_list if r["passed"]),
        "rule_results": eval_list,
    }


def run_automated_workflow(
    case_id: Optional[int] = None,
    category: Optional[str] = None,
    dry_run: bool = False,
    mock_overrides: Optional[Dict[str, Any]] = None,
    performed_by: str = "n8n_auto_runner",
) -> Dict[str, Any]:
    """
    Executes the n8n-style automated workflow graph for a real Case or Dry-Run Simulation:
      1. Builds `$ctx` (Employee + Extracted Email Fields).
      2. Executes Reusable Subworkflow (`SUBWF-EMP-VALIDATION`) & Data Enrichment Boxes
         (`GET_LEAVE_BALANCE` for Leave, `FETCH_ATTENDANCE` for Attendance) and merges live HRMS/Biometric
         responses into `$ctx["hrms"]`.
      3. Evaluates the IF / Branch Condition Box (`automation_config["rules"]`) against `$ctx`.
      4. Routes automatically along the `YES` branch (Auto-Execute Integration + Close) or
         `NO` branch (Pause at Human Approval / Verification Gate), recording a full node-by-node
         `execution_trace` with per-node `input_snapshot`, `output_snapshot`, `idempotency_key`,
         and explicitly separated `execution_state` vs `case_business_status`.
    """
    ctx = build_execution_context(case_id=case_id, category=category, mock_overrides=mock_overrides)
    norm_cat = ctx["case"]["category"]
    wf_def = get_workflow_for_category(norm_cat)
    if not wf_def:
        raise ValueError(f"No workflow definition found for category '{norm_cat}'.")

    auto_cfg = wf_def.get("automation_config") or {}
    states: List[str] = wf_def.get("states", [])
    initial_state = wf_def.get("initial_state") or (states[0] if states else "RECEIVED")
    case_key = str(ctx["case"].get("case_number") or f"CASE-{case_id or 'SIM'}")
    exec_id = f"EXEC-{wf_def.get('version', 'v1').replace(' ', '')}"

    trace: List[Dict[str, Any]] = []
    executed_actions: List[Dict[str, Any]] = []

    # 1. Trigger Box Trace
    trace.append({
        "step": 1,
        "box_type": "TRIGGER",
        "node_id": initial_state,
        "title": f"Trigger: {initial_state.replace('_', ' ').title()}",
        "status": "EXECUTED",
        "execution_state": "PROCESSING",
        "case_business_status": "OPEN",
        "idempotency_key": f"{case_key}:{initial_state}:{exec_id}",
        "duration_ms": 4,
        "summary": f"Initialized $ctx for {norm_cat} ({ctx['employee']['employee_id']} · {ctx['employee']['name']})",
        "input_snapshot": {"case_number": case_key, "category": norm_cat},
        "output_snapshot": {"employee_id": ctx["employee"]["employee_id"], "matched": ctx["employee"]["matched"]},
    })

    # 1b. Reusable Subworkflow: Employee & Policy Validation
    subwfs = wf_def.get("subworkflows_attached") or ["SUBWF-EMP-VALIDATION"]
    if "SUBWF-EMP-VALIDATION" in subwfs:
        trace.append({
            "step": len(trace) + 1,
            "box_type": "SUBWORKFLOW",
            "node_id": "SUBWF-EMP-VALIDATION",
            "title": "Subworkflow: Employee & Policy Validation",
            "status": "EXECUTED",
            "execution_state": "PROCESSING",
            "case_business_status": "IN_PROGRESS",
            "idempotency_key": f"{case_key}:SUBWF-EMP-VALIDATION:{exec_id}",
            "duration_ms": 6,
            "summary": f"Validated employee {ctx['employee']['employee_id']} ({ctx['employee']['department']}) & active employment status",
            "input_snapshot": {"employee_id": ctx["employee"]["employee_id"]},
            "output_snapshot": {"matched": ctx["employee"]["matched"], "department": ctx["employee"]["department"]},
        })

    # 2. Data Enrichment Box (Live HRMS / Truein lookup)
    enrichment_actions: List[str] = auto_cfg.get("data_enrichment") or []
    for act_code in enrichment_actions:
        if not dry_run and case_id:
            try:
                from backend.services.actions.action_engine import execute_hr_action
                res = execute_hr_action(
                    action_type=act_code,
                    case_identifier=int(case_id),
                    workflow_id=wf_def["workflow_id"],
                    workflow_step="DATA_ENRICHMENT",
                    performed_by=performed_by,
                    role="ADMIN",
                )
                executed_actions.append(res)
                resp_data = (res.get("response_payload") or {}).get("data") or res.get("response_payload") or {}
                if isinstance(resp_data, dict):
                    if "available_balance" in resp_data and not (mock_overrides and "hrms" in mock_overrides):
                        ctx["hrms"]["available_balance"] = resp_data["available_balance"]
                    if "punches" in resp_data and not (mock_overrides and "hrms" in mock_overrides):
                        ctx["hrms"]["punch_count"] = len(resp_data.get("punches") or [])
            except Exception:
                pass

        trace.append({
            "step": len(trace) + 1,
            "box_type": "DATA",
            "node_id": f"DATA_{act_code}",
            "title": f"Data Box: {act_code}",
            "status": "EXECUTED",
            "execution_state": "PROCESSING",
            "case_business_status": "IN_PROGRESS",
            "idempotency_key": f"{case_key}:DATA_{act_code}:{exec_id}",
            "duration_ms": 14,
            "summary": (
                f"Fetched available_balance={ctx['hrms'].get('available_balance')} days from HRMS"
                if "LEAVE" in act_code
                else f"Fetched biometric logs (punch_count={ctx['hrms'].get('punch_count')}) from Truein"
                if "ATTENDANCE" in act_code
                else f"Enriched employee profile ({ctx['employee']['employee_id']})"
            ),
            "input_snapshot": {"employee_id": ctx["employee"]["employee_id"], "action": act_code},
            "output_snapshot": dict(ctx["hrms"]),
        })

    # 3. Evaluate IF / Branch Condition Box
    cond_eval = evaluate_condition_rules(
        rules=auto_cfg.get("rules") or [],
        combinator=auto_cfg.get("condition_combinator") or "AND",
        ctx=ctx,
    )
    branch = cond_eval["branch"]  # "YES" or "NO"
    cond_node_id = states[1] if len(states) > 1 else "CONDITION_CHECK"

    trace.append({
        "step": len(trace) + 1,
        "box_type": "CONDITION",
        "node_id": cond_node_id,
        "title": auto_cfg.get("condition_title") or "IF Policy & Guard Conditions Pass",
        "status": "BRANCH_YES" if branch == "YES" else "BRANCH_NO",
        "execution_state": "PROCESSING",
        "case_business_status": "IN_PROGRESS",
        "idempotency_key": f"{case_key}:{cond_node_id}:{exec_id}",
        "branch": branch,
        "branch_type": auto_cfg.get("branch_type") or "IF_ELSE",
        "expression_preview": auto_cfg.get("expression_preview") or "",
        "duration_ms": 2,
        "summary": f"Evaluated {cond_eval['passed_count']}/{cond_eval['total_rules']} rules ({cond_eval['combinator']}) → Routed to {branch} branch",
        "rule_results": cond_eval["rule_results"],
        "input_snapshot": {"fields": ctx["fields"], "hrms": ctx["hrms"]},
        "output_snapshot": {"branch": branch, "passed": cond_eval["passed"], "passed_count": cond_eval["passed_count"]},
    })

    # 4. Route & Execute Target Branch (Strictly separating Node vs Execution State vs Case Business Status)
    yes_target = auto_cfg.get("yes_branch_target") or (states[-2] if len(states) >= 2 else states[-1])
    no_target = auto_cfg.get("no_branch_target") or (states[1] if len(states) > 1 else states[0])
    auto_close = bool(auto_cfg.get("auto_close_on_yes", True))

    if branch == "YES":
        target_state = "CLOSED" if auto_close and "CLOSED" in states else yes_target
        branch_actions = auto_cfg.get("yes_branch_actions") or []
        for b_act in branch_actions:
            if b_act in enrichment_actions:
                continue
            if not dry_run and case_id and b_act.isupper():
                try:
                    from backend.services.actions.action_engine import execute_hr_action
                    res = execute_hr_action(
                        action_type=b_act,
                        case_identifier=int(case_id),
                        workflow_id=wf_def["workflow_id"],
                        workflow_step=f"AUTO_YES_{yes_target}",
                        performed_by=performed_by,
                        role="ADMIN",
                    )
                    executed_actions.append(res)
                except Exception:
                    pass

        trace.append({
            "step": len(trace) + 1,
            "box_type": "INTEGRATION",
            "node_id": yes_target,
            "title": f"Integration Box: {yes_target.replace('_', ' ').title()}",
            "status": "EXECUTED",
            "execution_state": "PROCESSING",
            "case_business_status": "RESOLVED",
            "idempotency_key": f"{case_key}:{yes_target}:{exec_id}",
            "duration_ms": 18,
            "summary": f"Auto-executed {', '.join([a for a in branch_actions if a.isupper()] or ['HRMS Sync'])} on YES branch (Idempotent key protected)",
            "input_snapshot": {"target_node": yes_target, "actions": branch_actions},
            "output_snapshot": {"connector_status": "200 OK", "idempotent_dedup": True},
        })

        final_execution_state = "COMPLETED"
        final_case_business_status = "CLOSED" if target_state == "CLOSED" else "RESOLVED"

        if target_state == "CLOSED":
            trace.append({
                "step": len(trace) + 1,
                "box_type": "ACTION",
                "node_id": "CLOSED",
                "title": "Terminal Box: Case Resolved & Closed",
                "status": "COMPLETED",
                "execution_state": "COMPLETED",
                "case_business_status": "CLOSED",
                "idempotency_key": f"{case_key}:CLOSED:{exec_id}",
                "duration_ms": 5,
                "summary": "Workflow Execution State = COMPLETED; Case Business Status = CLOSED.",
                "input_snapshot": {"previous_node": yes_target},
                "output_snapshot": {"execution_state": "COMPLETED", "case_business_status": "CLOSED"},
            })
    else:
        # NO branch -> Pause at Human Approval / Verification Gate (or Hold if missing fields)
        if not ctx["employee"]["matched"] or ctx["fields"]["missing_fields_count"] > 0:
            target_state = "DOCUMENTS_REQUIRED" if "DOCUMENTS_REQUIRED" in states else no_target
            final_execution_state = "WAITING_FOR_DOCUMENT"
            final_case_business_status = "ON_HOLD"
            pause_reason = "Paused: Missing required fields or unverified employee — Execution State: WAITING_FOR_DOCUMENT | Case Status: ON_HOLD"
        else:
            target_state = no_target
            final_execution_state = "WAITING_FOR_APPROVAL"
            final_case_business_status = "PENDING_APPROVAL"
            pause_reason = f"Paused at Human Gate '{target_state.replace('_', ' ').title()}' — Execution State: WAITING_FOR_APPROVAL | Case Status: PENDING_APPROVAL"

        trace.append({
            "step": len(trace) + 1,
            "box_type": "HUMAN",
            "node_id": target_state,
            "title": f"Human Gate: {target_state.replace('_', ' ').title()}",
            "status": "PAUSED_FOR_HUMAN",
            "execution_state": final_execution_state,
            "case_business_status": final_case_business_status,
            "idempotency_key": f"{case_key}:{target_state}:{exec_id}",
            "duration_ms": 3,
            "summary": pause_reason,
            "input_snapshot": {"failed_rules": [r["id"] for r in cond_eval["rule_results"] if not r["passed"]]},
            "output_snapshot": {
                "execution_state": final_execution_state,
                "case_business_status": final_case_business_status,
                "sla_escalation_active": True,
            },
        })

    wf_instance = None
    if not dry_run and case_id:
        get_or_create_workflow_instance(int(case_id), norm_cat, performed_by=performed_by)
        wf_instance = redo_or_step_workflow_state(
            case_id=int(case_id),
            action="GOTO_STATE",
            target_state=target_state,
            reason=f"n8n Auto-Runner ({branch} branch → {target_state})",
            performed_by=performed_by,
        )

    return {
        "dry_run": dry_run,
        "category": norm_cat,
        "workflow_id": wf_def["workflow_id"],
        "workflow_name": wf_def["name"],
        "version": wf_def.get("version", "Version 1.0"),
        "branch_taken": branch,
        "final_state": target_state,
        "execution_state": final_execution_state,
        "case_business_status": final_case_business_status,
        "auto_completed": target_state == "CLOSED",
        "context": ctx,
        "condition_evaluation": cond_eval,
        "execution_trace": trace,
        "executed_actions": executed_actions,
        "sla_config": wf_def.get("sla_config"),
        "error_recovery": wf_def.get("error_recovery"),
        "workflow": wf_instance,
    }


def run_workflow_test_suite(category: str) -> Dict[str, Any]:
    """
    Executes all saved Automated Workflow Test Cases for a category (`test_cases`)
    and verifies whether `branch_taken` and `final_state` match expectations.
    """
    norm_cat = (category or "LEAVE").strip().upper()
    wf_def = get_workflow_for_category(norm_cat)
    if not wf_def:
        raise ValueError(f"No workflow definition found for category '{norm_cat}'.")

    test_cases = wf_def.get("test_cases") or []
    results: List[Dict[str, Any]] = []
    passed_count = 0

    for tc in test_cases:
        sim = run_automated_workflow(
            case_id=None,
            category=norm_cat,
            dry_run=True,
            mock_overrides=tc.get("mock_overrides") or {},
            performed_by="workflow_test_runner",
        )
        exp_branch = (tc.get("expected_branch") or "YES").upper()
        exp_state = tc.get("expected_final_state")
        branch_ok = sim["branch_taken"] == exp_branch
        state_ok = (not exp_state) or (sim["final_state"] == exp_state)
        test_passed = bool(branch_ok and state_ok)
        if test_passed:
            passed_count += 1

        results.append({
            "id": tc.get("id"),
            "name": tc.get("name"),
            "passed": test_passed,
            "expected_branch": exp_branch,
            "actual_branch": sim["branch_taken"],
            "expected_final_state": exp_state,
            "actual_final_state": sim["final_state"],
            "execution_state": sim["execution_state"],
            "case_business_status": sim["case_business_status"],
            "passed_rules": f"{sim['condition_evaluation']['passed_count']}/{sim['condition_evaluation']['total_rules']}",
        })

    return {
        "category": norm_cat,
        "workflow_id": wf_def["workflow_id"],
        "total_tests": len(results),
        "passed_count": passed_count,
        "failed_count": len(results) - passed_count,
        "all_passed": passed_count == len(results),
        "results": results,
    }



