"""
HR FLOW — Phase 6.14, 6.15 & 7.12 Workflow Service (backend/services/workflows/workflow_service.py)
"""

from typing import Dict, Any, Optional, List
from backend.database.connection import get_connection
from backend.services.workflows.workflow_registry import (
    get_workflow_for_category,
    get_workflow_by_id,
    list_workflows,
)
from backend.services.workflows.workflow_engine import (
    get_or_create_workflow_instance,
    transition_workflow_state,
    redo_or_step_workflow_state,
    reopen_workflow_instance,
    _format_workflow_instance,
)


def get_case_workflow(case_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM workflow_instances WHERE case_id = ? ORDER BY id DESC LIMIT 1",
            (int(case_id),),
        ).fetchone()
        if not row:
            return None
        wf_def = get_workflow_by_id(row["workflow_id"])
        if not wf_def:
            return None
        formatted = _format_workflow_instance(row, wf_def)
        formatted["configured"] = True
        return formatted
    finally:
        conn.close()


def build_workflow_preview_for_category(category: str, case_id: Optional[int] = None) -> Dict[str, Any]:
    if case_id:
        inst = get_case_workflow(case_id)
        if inst:
            return inst

    wf_def = get_workflow_for_category(category)
    if not wf_def:
        norm_cat = (category or "GENERAL_HR").strip().upper()
        return {
            "configured": False,
            "workflow_id": None,
            "name": f"No Workflow Configured ({norm_cat})",
            "version": None,
            "description": f"No active workflow configured for {norm_cat}. Only an Administrator can create workflows.",
            "initial_state": None,
            "current_state": "NOT_CONFIGURED",
            "status": "NOT_CONFIGURED",
            "states": [],
            "steps_display": [],
            "step_index": 0,
            "total_steps": 0,
            "progress_percent": 0,
            "can_step_back": False,
            "previous_state": None,
            "can_advance": False,
            "can_redo": False,
            "available_transitions": [],
            "all_transitions": [],
            "history": [],
        }

    states = wf_def.get("states", [])
    initial_state = wf_def.get("initial_state", states[0] if states else "READY")
    available = [
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
        if t.get("from_state") == initial_state
    ]
    total_steps = len(states) if states else 1

    return {
        "configured": True,
        "workflow_id": wf_def["workflow_id"],
        "name": wf_def["name"],
        "version": wf_def.get("version", "Version 1.0"),
        "description": wf_def.get("description", ""),
        "initial_state": initial_state,
        "current_state": initial_state,
        "status": "Ready to start",
        "states": states,
        "steps_display": wf_def.get("steps_display", states),
        "state_box_types": wf_def.get("state_box_types", {}),
        "node_boxes": wf_def.get("node_boxes", []),
        "automation_config": wf_def.get("automation_config", {}),
        "step_index": 1,
        "total_steps": total_steps,
        "progress_percent": round((1 / total_steps) * 100) if total_steps > 0 else 25,
        "can_step_back": False,
        "previous_state": None,
        "can_advance": bool(available),
        "can_redo": False,
        "available_transitions": available,
        "all_transitions": wf_def.get("transitions", []),
        "history": [],
    }

