/**
 * HR Flow — Verification Checklist & Policy Workbench (frontend/js/casedetail/components/checklist.js)
 */

import { escapeHtml } from "../utils/formatters.js";
import { toggleTask, addTask } from "../api.js";
import { showToast } from "../utils/formatters.js";

export function renderChecklist(container, state) {
    const tasks = state.caseData?.tasks || [];
    const pb = state.caseData?.playbook || {};
    const c = state.caseData?.case || {};

    const completedCount = tasks.filter(t => (t.status || "").toUpperCase() === "COMPLETED").length;
    const totalCount = tasks.length;
    const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    let tasksHtml = "<div style='color:var(--c-text-muted); font-size:0.80rem; padding:12px; text-align:center;'>No verification checks recorded</div>";
    const suggestedTasks = pb.default_tasks || [];

    if (tasks.length > 0) {
        tasksHtml = tasks.map(t => {
            const isDone = (t.status || "").toUpperCase() === "COMPLETED";
            const taskType = t.task_type || "CHECKBOX";
            return `
                <div class="task-item-row ${isDone ? 'completed' : ''}" data-task-id="${t.id}">
                    <div class="task-checkbox-custom ${isDone ? 'checked' : ''}" data-task-id="${t.id}" title="${isDone ? 'Mark Pending' : 'Mark Completed'}">
                        ${isDone ? '✓' : ''}
                    </div>
                    <div class="task-body-zone">
                        <div class="task-text">${escapeHtml(t.title)}</div>
                        ${t.description || t.guidance ? `<div class="task-guidance">${escapeHtml(t.description || t.guidance)}</div>` : ''}
                    </div>
                    <span class="card-badge" style="background:#f1f5f9; color:#64748b; font-size:0.65rem;">
                        ${escapeHtml(taskType)}
                    </span>
                </div>
            `;
        }).join("");
    } else if (suggestedTasks.length > 0) {
        tasksHtml = `
            <div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:12px; text-align:center;">
                <div style="font-size:0.80rem; font-weight:700; color:#334155; margin-bottom:4px;">No checklist tasks recorded for this case yet</div>
                <div style="font-size:0.72rem; color:var(--c-text-muted); margin-bottom:10px;">${suggestedTasks.length} recommended checks available from ${escapeHtml(pb.display_name || 'Playbook')}</div>
                <button class="btn-action-pill primary" id="btnAdoptPlaybookTasks" style="font-size:0.74rem; height:28px; padding:0 12px; margin:0 auto;">
                    <span>+ Load ${suggestedTasks.length} Playbook Tasks</span>
                </button>
            </div>
        `;
    }

    container.innerHTML = `
        <!-- Verification Checklist Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>✅</span>
                    <span>Verification Checklist</span>
                </h2>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:0.74rem; font-weight:800; color:${completedCount === totalCount && totalCount > 0 ? '#059669' : '#2563eb'};">
                        ${completedCount} / ${totalCount} Done (${progressPct}%)
                    </span>
                </div>
            </div>

            <!-- Progress Bar -->
            <div style="width:100%; height:6px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
                <div style="width:${progressPct}%; height:100%; background:linear-gradient(90deg, #2563eb, #059669); transition:width 0.3s ease;"></div>
            </div>

            <!-- Tasks List -->
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${tasksHtml}
            </div>

            <!-- Add Task Form -->
            <div style="display:flex; gap:8px; border-top:1px solid #f1f5f9; padding-top:10px;">
                <input type="text" class="form-input-field" id="inputNewTaskTitle" placeholder="Add custom verification check..." style="font-size:0.78rem; height:32px; padding:0 10px;">
                <button class="btn-action-pill primary" id="btnSubmitNewTask" style="height:32px; padding:0 12px; font-size:0.76rem;">
                    <span>+ Add</span>
                </button>
            </div>
        </div>

        <!-- Departmental Policy & Governance Guidance Card -->
        <div class="panel-card">
            <div class="card-header">
                <h2 class="card-title">
                    <span>📘</span>
                    <span>Policy &amp; Compliance Rule</span>
                </h2>
                <span class="card-badge" style="background:var(--c-purple-tint); color:var(--c-purple); border:1px solid var(--c-purple-border);">
                    Standard Operating Procedure
                </span>
            </div>

            <div style="font-size:0.80rem; color:#334155; line-height:1.6; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px;">
                <strong>Standard Operating Procedure for ${escapeHtml(pb.display_name || c.category || "Operations")}:</strong>
                <p style="margin:4px 0 0 0;">
                    Verify all inbound request criteria, inspect telemetry logs for discrepancies, and confirm line manager or supervisor sign-off before committing database adjustments. Record the transaction proof ID in the resolution dossier prior to case closure.
                </p>
            </div>
        </div>
    `;

    // Interactive Checkbox Toggles
    container.querySelectorAll(".task-checkbox-custom").forEach(box => {
        box.addEventListener("click", async () => {
            const taskId = Number(box.dataset.taskId);
            try {
                const res = await toggleTask(state.caseRef, taskId);
                // Optimistically update local task
                const t = (state.caseData.tasks || []).find(x => x.id === taskId);
                if (t) t.status = res.status;
                showToast(`Task marked as ${res.status}`, "success");
                state.emit("change", state.caseData);
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    });

    // Adopt Playbook Tasks Button
    const btnAdopt = container.querySelector("#btnAdoptPlaybookTasks");
    if (btnAdopt) {
        btnAdopt.addEventListener("click", async () => {
            try {
                btnAdopt.disabled = true;
                btnAdopt.textContent = "Loading tasks...";
                for (const dt of suggestedTasks) {
                    await addTask(state.caseRef, dt.title, dt.task_type || "CHECKBOX", dt.guidance || "");
                }
                showToast(`Loaded ${suggestedTasks.length} playbook checks`, "success");
                state.emit("refresh");
            } catch (err) {
                showToast(err.message, "error");
                btnAdopt.disabled = false;
                btnAdopt.textContent = "+ Load Playbook Tasks";
            }
        });
    }

    // Add Task Handler
    const inputNewTask = container.querySelector("#inputNewTaskTitle");
    const btnAdd = container.querySelector("#btnSubmitNewTask");

    const handleAddTask = async () => {
        const title = (inputNewTask.value || "").trim();
        if (!title) return;
        try {
            const res = await addTask(state.caseRef, title, "CHECKBOX");
            if (!state.caseData.tasks) state.caseData.tasks = [];
            state.caseData.tasks.push({
                id: res.task_id,
                title: title,
                task_type: "CHECKBOX",
                status: "PENDING",
            });
            inputNewTask.value = "";
            showToast("Custom task added", "success");
            state.emit("change", state.caseData);
        } catch (err) {
            showToast(err.message, "error");
        }
    };

    if (btnAdd) btnAdd.addEventListener("click", handleAddTask);
    if (inputNewTask) {
        inputNewTask.addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleAddTask();
        });
    }
}
