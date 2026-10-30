# HR FLOW — Enterprise Modular Workflow Builder & New Category Extension Guide (24-Point Locked Architecture)

> **Core Golden Rule**: **Category = Configuration, Not Code.**
> Adding a new HR category (e.g., `PROMOTION_REQUEST`, `TRAVEL_EXPENSE`, `RELOCATION`, `GRIEVANCE`) is 100% configuration-driven across Category, Form Schema, Workflow, Rules, Connectors, and SLA/Governance—requiring **zero Python backend code changes**.

---

## 1. The 6-Layer Platform Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. HR WORKFLOW BUILDER (6 Clean Category Scope Sub-Tabs)    │
│    Canvas | Form Schema | Rules & Mapping | SLA | Tests     │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. WORKFLOW DEFINITION (Versioned & Diffable Blueprint)     │
│    Trigger → Subworkflow → Data → Branch → Human/API → End  │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. CASE ENGINE (Strict Separation of Concerns)              │
│    Node ≠ Workflow Execution State ≠ Case Business Status   │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. EXECUTION ENGINE                                         │
│    Expression Engine | Timers | Retries | Idempotency Keys  │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. CONNECTORS & GENERIC HTTP/WEBHOOKS                       │
│    Gmail | Darwinbox | Truein | Payroll | IT | Generic REST │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. AUDIT, ANALYTICS & AUTOMATED TEST SUITE                  │
│    Input/Output Snapshots | SLA Ladders | Regression Tests  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Architectural Separation: Node vs. Execution State vs. Case Business Status

We strictly separate **what executes** from **where the engine is** and **what HR sees**:

| Dimension | Purpose | Canonical Values |
| :--- | :--- | :--- |
| **1. Workflow Node** | What the graph step actually executes | `TRIGGER`, `DATA`, `CONDITION`, `HUMAN`, `WAIT`, `SUBWORKFLOW`, `INTEGRATION`, `ACTION` |
| **2. Workflow Execution State** | Where the workflow engine runtime is right now | `PROCESSING`, `WAITING_FOR_APPROVAL`, `WAITING_FOR_DOCUMENT`, `WAITING_FOR_EVENT`, `RETRYING_INTEGRATION`, `FAILED`, `COMPLETED` |
| **3. Case Business Status** | What HR Operations and the Employee see on the Case | `OPEN`, `IN_PROGRESS`, `ON_HOLD`, `PENDING_APPROVAL`, `RESOLVED`, `CLOSED` |

---

## 3. The 8 Modular Node Families & 5 Branching Modes

### 8 Node Box Families (`NODE_BOX_FAMILIES`)
1. **Trigger Box (`TRIGGER`)**: Email Classified, Manual HR Intake, Scheduled Cron, Inbound Webhook.
2. **Data Enrichment Box (`DATA`)**: Fetches live HRMS/Biometric/Payroll records (`GET_LEAVE_BALANCE`, `FETCH_ATTENDANCE`, `EMPLOYEE_LOOKUP`) into `$ctx.hrms`.
3. **Condition / Gateway Box (`CONDITION`)**: Evaluates visual rules + expressions to route execution.
4. **Human Task & Approval Box (`HUMAN`)**: Supports 9 rich archetypes (`Manager Approval`, `HR Review`, `Finance Approval`, `IT Asset Clearance`, `Document Verification`, `Employee Clarification`, `Payroll Sign-off`, `Exception Handling`, `Escalation Review`).
5. **Wait / Event / SLA Timer Box (`WAIT`)**: Pauses for external events (`document.received`, `employee.replied`) with correlation key `$ctx.case.case_number`.
6. **Reusable Subworkflow Box (`SUBWORKFLOW`)**: Invokes shared building blocks (`SUBWF-EMP-VALIDATION`, `SUBWF-DOC-COLLECTION`, `SUBWF-MGR-APPROVAL`, `SUBWF-AUDIT-NOTIFY`).
7. **External Integration & REST Box (`INTEGRATION`)**: Executes Darwinbox, Truein, Payroll, IT Asset, or Generic HTTP/Webhook calls with idempotency protection.
8. **Case & Communication Box (`ACTION`)**: Updates Case Business Status, dispatches templated Gmail notifications, and writes immutable audit entries.

### 5 Branching Modes (`BRANCH_TYPES_CATALOG`)
- `IF_ELSE`: Binary `YES` (True) / `NO` (False) routing.
- `MULTI_CONDITION`: Range routing (e.g., `< 10K` → Auto-Approve, `10K–50K` → Manager, `> 50K` → Finance).
- `SWITCH`: Multi-way value switch (e.g., `Department`: `Finance` / `HR` / `IT` / `Sales`).
- `PARALLEL_SPLIT`: Concurrent tracks (`IT Asset Clearance` + `Finance FnF` + `Admin ID Card`) joining at `PARALLEL_JOIN`.
- `DMN_DECISION`: First-hit Decision Table evaluation.

---

## 4. 7-Source Variable & Data Mapping Layer + Expression Engine

Every node input can bind dynamically to 7 structured sources:
1. `CASE` (`$ctx.case.*`)
2. `EMPLOYEE` (`$ctx.employee.*`)
3. `EMAIL` (`$ctx.email.*`)
4. `FORM` (`$ctx.fields.*` / `$ctx.form.*`)
5. `PREVIOUS_NODE` (`$ctx.prev_node.*`)
6. `INTEGRATION_RESPONSE` (`$ctx.hrms.*`)
7. `WORKFLOW_VARIABLE` (`$ctx.variables.*`)

---

## 5. Native SLA Escalation Ladder, Retry Recovery & Idempotency

- **3-Tier SLA Escalation Ladder**:
  - **Tier 1 (`24h`)**: Automatic reminder sent to assignee.
  - **Tier 2 (`80% SLA / 38h`)**: Auto-escalated to `Team Lead`.
  - **Tier 3 (`100% Breach / 48h`)**: Escalated to `HR Head` and flagged `AT_RISK`.
- **Retry & Fallback Human Task**: Failed integrations retry `3x` (30s backoff) and automatically fall back to an `Exception Handling` Human Task rather than crashing the case.
- **Idempotency Key Protection**: Every external mutation carries `{case_id}:{node_id}:{execution_id}` so retries never double-deduct leave balance or send duplicate emails.

---

## 6. How to Add a New HR Category in 60 Seconds (Step-by-Step)

### Option A: 1-Click UI Wizard (Recommended)
1. Open the sidebar and click **Workflow Builder** (`inbox.html#builder`).
2. Click **➕ New Category** in the top lifecycle toolbar.
3. Enter:
   - **Category Code**: e.g., `PROMOTION_REQUEST`
   - **Display Name**: `Promotion Request`
   - **Assigned HR Department**: `HR Operations`
   - **SLA Target**: `48` hours
   - **Strong Keywords**: `promotion, grade change, role elevation`
   - **Required Form Fields**: `employee_id, current_grade, new_grade, effective_date`
4. Click **Create Category & Provision Full Stack**.
5. Switch across the **6 Category Scope Sub-Tabs** (`Workflow Canvas`, `Dynamic Form Schema`, `Rules & Data Mapper`, `SLA & Recovery`, `Simulator & Test Suite`, `Versions & Governance`) to test and publish!

### Option B: REST API Provisioning
- `POST /api/workflows/builder/category` — Atomically updates `categories.json`, `routing.json`, and `workflows.json`.
- `POST /api/workflows/builder/save` — Saves draft changes to nodes, form schema, rules, SLA ladder, and test cases.
- `POST /api/workflows/builder/test-suite` — Runs all automated regression test cases for a category.
- `POST /api/workflows/builder/lifecycle` — Publishes a new version (`PUBLISH`) or rolls back (`ROLLBACK`) with RBAC verification.
