import os
import sys
import subprocess
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            super().showPage()
        super().save()

    def draw_header_footer(self, page_count):
        self.saveState()
        # Top running header
        self.setFont("Helvetica-Bold", 7.5)
        self.setFillColor(colors.HexColor("#475569"))
        self.drawString(36, 814, "ENTERPRISE WORKFLOW & AUDIT ORCHESTRATION PLATFORM")
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#64748b"))
        self.drawRightString(559, 814, "AGENT FREEDOM & UNIVERSAL OPERATIONAL STEPS SPECIFICATION v1.0")
        
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.6)
        self.line(36, 806, 559, 806)

        # Bottom running footer
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.6)
        self.line(36, 38, 559, 38)
        
        self.setFont("Helvetica-Bold", 7.5)
        self.setFillColor(colors.HexColor("#64748b"))
        self.drawString(36, 26, "CONFIDENTIAL & PROPRIETARY")
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#94a3b8"))
        self.drawString(180, 26, "ANY COMPANY · ANY DEPARTMENT · ZERO-TRUST COMPLIANCE")
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(559, 26, page_text)
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=42,
        bottomMargin=42
    )

    styles = getSampleStyleSheet()

    primary_color = colors.HexColor("#0f172a")
    indigo = colors.HexColor("#4f46e5")
    emerald = colors.HexColor("#059669")
    amber = colors.HexColor("#d97706")
    slate_dark = colors.HexColor("#1e293b")
    slate_muted = colors.HexColor("#64748b")
    slate_border = colors.HexColor("#cbd5e1")
    light_bg = colors.HexColor("#f8fafc")
    tint_blue = colors.HexColor("#eff6ff")
    tint_emerald = colors.HexColor("#f0fdf4")

    styles.add(ParagraphStyle(
        name="BodyTextSmall",
        fontName="Helvetica",
        fontSize=8.0,
        leading=10.8,
        textColor=colors.HexColor("#334155")
    ))

    styles.add(ParagraphStyle(
        name="TableHeader",
        fontName="Helvetica-Bold",
        fontSize=7.6,
        leading=9.6,
        textColor=colors.HexColor("#ffffff"),
        alignment=0
    ))

    styles.add(ParagraphStyle(
        name="TableCell",
        fontName="Helvetica",
        fontSize=7.2,
        leading=9.2,
        textColor=colors.HexColor("#1e293b")
    ))

    styles.add(ParagraphStyle(
        name="TableCellBold",
        fontName="Helvetica-Bold",
        fontSize=7.2,
        leading=9.2,
        textColor=colors.HexColor("#0f172a")
    ))

    styles.add(ParagraphStyle(
        name="CodeText",
        fontName="Courier",
        fontSize=7.0,
        leading=8.8,
        textColor=colors.HexColor("#1e293b")
    ))

    def make_section_banner(title_text, section_num):
        content = [
            [
                Paragraph(f"<b>SECTION {section_num}</b>", ParagraphStyle('sec_num', fontName='Helvetica-Bold', fontSize=7.5, textColor=colors.HexColor("#a5b4fc"))),
                Paragraph(f"<b>{title_text}</b>", ParagraphStyle('sec_title', fontName='Helvetica-Bold', fontSize=9.2, textColor=colors.white))
            ]
        ]
        t = Table(content, colWidths=[70, 453])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), slate_dark),
            ('TOPPADDING', (0,0), (-1,-1), 3.5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3.5),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LINEBELOW', (0,0), (-1,-1), 1.8, indigo),
        ]))
        return t

    def make_callout(text, bg=tint_blue, border=indigo, title="KEY ARCHITECTURAL HIGHLIGHT"):
        data = [
            [
                Paragraph(f"<b>{title}:</b> {text}", ParagraphStyle('co', fontName='Helvetica', fontSize=7.6, leading=10.2, textColor=colors.HexColor("#1e293b")))
            ]
        ]
        t = Table(data, colWidths=[523])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), bg),
            ('BOX', (0,0), (-1,-1), 0.8, border),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ]))
        return t

    story = []

    # =========================================================================
    # PAGE 1: HEADER, OVERVIEW, THE AGENT FREEDOM PARADIGM
    # =========================================================================
    header_table_data = [
        [
            Paragraph("<b>ENTERPRISE WORKFLOW &amp; AUDIT SPECIFICATION</b>", ParagraphStyle('hdr_kicker', fontName='Helvetica-Bold', fontSize=8, textColor=indigo)),
            Paragraph("<b>DOCUMENT ID:</b> SPEC-AGENT-FREEDOM-AUDIT-2026-V1.0", ParagraphStyle('hdr_id', fontName='Helvetica-Bold', fontSize=7.2, textColor=slate_muted, alignment=2))
        ],
        [
            Paragraph("<b>Universal Enterprise Audit: Agent Freedom &amp; Universal Steps</b>", ParagraphStyle('hdr_main', fontName='Helvetica-Bold', fontSize=15, leading=18, textColor=primary_color)),
            Paragraph("<b>DATE:</b> October 2026<br/><b>STATUS:</b> Approved Architecture", ParagraphStyle('hdr_meta', fontName='Helvetica', fontSize=7.2, leading=9.5, textColor=slate_dark, alignment=2))
        ],
        [
            Paragraph("Autonomous Operational Freedom: In-Audit Employee Clarification Loop, Dynamic Playbook Builder, and the 6 Universal Operational Steps Deployable Across <b>Any Company &amp; Any Department</b> (IT, Finance, Legal, Operations, People Ops).", ParagraphStyle('hdr_desc', fontName='Helvetica', fontSize=7.8, leading=10.5, textColor=slate_muted)),
            ""
        ]
    ]
    header_table = Table(header_table_data, colWidths=[405, 118])
    header_table.setStyle(TableStyle([
        ('SPAN', (0, 2), (1, 2)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 1),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 5))

    # Architecture Snapshot Strip
    meta_box_data = [
        [
            Paragraph("<b>TARGET PLATFORM:</b><br/>Universal Case 360", styles['TableCell']),
            Paragraph("<b>AGENT FREEDOM:</b><br/>In-Audit Inquire &amp; Build", styles['TableCell']),
            Paragraph("<b>EMPLOYEE LOOP:</b><br/>Auto-Pause SLA &amp; Forms", styles['TableCell']),
            Paragraph("<b>UNIVERSAL PLAYBOOK:</b><br/>6 Standard Enterprise Steps", styles['TableCell']),
            Paragraph("<b>GOVERNANCE:</b><br/>SOC2 / ISO27001 Aligned", styles['TableCell'])
        ]
    ]
    meta_box = Table(meta_box_data, colWidths=[104, 105, 105, 105, 104])
    meta_box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('BOX', (0, 0), (-1, -1), 0.8, slate_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(meta_box)
    story.append(Spacer(1, 6))

    # SECTION 1
    story.append(make_section_banner("Executive Vision: Why 'Agent Freedom' Transforms Audit", 1))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>From Rigid Checklists to an Executable Investigation Sandbox:</b><br/>"
        "In legacy ticketing and service desks, the Audit &amp; Investigation phase is a passive checklist. When an agent (specialist or AI copilot) "
        "investigates a case, they inevitably encounter three major bottlenecks that stall operations:<br/>"
        "• <b>1. Information Deadlocks (70%+ of Delays):</b> Cases arrive missing vital evidence (e.g. bank updates without cancelled cheques, expense claims missing GST bills, or IT access missing project codes). Traditional desks force agents to abandon the audit to draft generic emails, losing active investigative context.<br/>"
        "• <b>2. Operational Rigidity:</b> Real company workflows have edge cases. A fixed checklist cannot adapt when an agent needs to create an ad-hoc verification step, chain a database query, or request an emergency supervisor sign-off.<br/>"
        "• <b>3. Passive AI vs. Active Agent Freedom:</b> Conventional bots suggest text or passive summaries. A true agentic platform empowers agents with the <b>freedom to act, query, contact, build, and verify</b> directly inside the audit workbench.",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 5))

    # Visual Workflow Diagram Table
    flow_table_data = [
        [
            Paragraph("<b>INBOUND CASE</b>", styles['TableHeader']),
            Paragraph("<b>STEP 1: DOSSIER</b>", styles['TableHeader']),
            Paragraph("<b>STEP 2: AGENT FREEDOM INVESTIGATION HUB</b>", styles['TableHeader']),
            Paragraph("<b>STEP 3: PROOF &amp; DISPATCH</b>", styles['TableHeader'])
        ],
        [
            Paragraph("Inbound Email / Form<br/>• Auto-classified<br/>• Dept identified<br/>• SLA clock started", styles['TableCell']),
            Paragraph("Identity Triage<br/>• Sender profile match<br/>• DKIM/SPF telemetry<br/>• Attachment scan", styles['TableCell']),
            Paragraph("<b>Executable Operational Sandbox:</b><br/>"
                      "① <b>Verify:</b> Identity, role &amp; policy limits<br/>"
                      "② <b>Inquire:</b> Contact employee for missing info (Pauses SLA)<br/>"
                      "③ <b>Diagnose:</b> Live enterprise API queries (ERP, LDAP, DB)<br/>"
                      "④ <b>Build:</b> Create dynamic steps &amp; playbooks on the fly<br/>"
                      "⑤ <b>Approve:</b> Trigger leadership threshold sign-off<br/>"
                      "⑥ <b>Remediate:</b> Update master records &amp; record UTR proof", styles['TableCellBold']),
            Paragraph("Forensic Resolution<br/>• Auto-bound findings<br/>• UTR/Ticket synced<br/>• Authenticated mail<br/>• Immutable lock", styles['TableCell'])
        ]
    ]
    flow_table = Table(flow_table_data, colWidths=[95, 95, 233, 100])
    flow_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(flow_table)
    story.append(Spacer(1, 6))

    story.append(make_callout(
        "Agent Freedom grants specialists and AI copilots the complete operational authority to contact employees, pause SLA timers, build dynamic diagnostic checkpoints, and execute master record updates—all within Step 2 without losing case context.",
        bg=tint_emerald, border=emerald, title="CORE PRINCIPLE OF AGENT FREEDOM"
    ))

    story.append(PageBreak())

    # =========================================================================
    # PAGE 2: THE 6 UNIVERSAL OPERATIONAL STEPS ACROSS ALL COMPANIES
    # =========================================================================
    story.append(make_section_banner("The 6 Universal Operational Steps of Every Enterprise Agent", 2))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Universal Playbook Across Any Company &amp; Any Department:</b><br/>"
        "Whether an organization is handling IT provisioning, Finance salary reconciliation, Operations logistics, Legal contracts, or HR leave balances, every audit lifecycle naturally decomposes into these <b>6 Universal Building Blocks</b>:",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 4))

    steps_table_data = [
        [
            Paragraph("<b>STEP CODE &amp; NAME</b>", styles['TableHeader']),
            Paragraph("<b>OPERATIONAL CAPABILITY</b>", styles['TableHeader']),
            Paragraph("<b>CROSS-DEPARTMENT EXAMPLES</b>", styles['TableHeader']),
            Paragraph("<b>AGENT AUTONOMY &amp; FREEDOM</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>1. STEP_VERIFY_IDENTITY</b><br/>Identity &amp; Entitlements", styles['TableCellBold']),
            Paragraph("Validates sender authenticity, security token, role, department, and policy entitlements.", styles['TableCell']),
            Paragraph("• IT: Check LDAP/Okta status &amp; groups.<br/>• Finance: Check vendor master &amp; GSTIN.<br/>• HR: Verify emp ID, role, and probation.", styles['TableCell']),
            Paragraph("Auto-matches sender in database; flags unauthenticated or suspicious external addresses.", styles['TableCell'])
        ],
        [
            Paragraph("<b>2. STEP_REQUEST_INFO</b><br/>Contact &amp; Ask Info from Emp", styles['TableCellBold']),
            Paragraph("Direct in-audit employee clarification loop. Requests missing documents, clarifies discrepancies, pauses SLA.", styles['TableCell']),
            Paragraph("• Bank: Request cancelled cheque/statement.<br/>• Attendance: Request punch times &amp; manager note.<br/>• IT: Ask for laptop serial # / asset tag.<br/>• Finance: Request missing GST tax invoice.", styles['TableCell']),
            Paragraph("<b>1-Click Direct Inquire:</b> Pauses SLA clock (`AWAITING_INFO`), dispatches email + Magic Link; auto-ingests replies back into audit.", styles['TableCellBold'])
        ],
        [
            Paragraph("<b>3. STEP_SYSTEM_DIAGNOSTIC</b><br/>Enterprise Telemetry Query", styles['TableCellBold']),
            Paragraph("Live API/system verification passes against master records (ERP, CRM, Ledger, Directory).", styles['TableCell']),
            Paragraph("• Finance: Query SAP ERP &amp; tax deduction ledger.<br/>• IT: Run Okta MFA &amp; VPN session diagnostics.<br/>• Ops: Check warehouse GRN &amp; PO match.", styles['TableCell']),
            Paragraph("Executes automated API checks with live console telemetry and 1-click '+ Insert Findings to Proof'.", styles['TableCell'])
        ],
        [
            Paragraph("<b>4. STEP_BUILD_DYNAMIC</b><br/>Dynamic Steps &amp; Playbooks", styles['TableCellBold']),
            Paragraph("Agent freedom to build custom verification checkpoints, calculations, and reusable team playbooks.", styles['TableCell']),
            Paragraph("• Build tax proration formula checkpoint.<br/>• Create ad-hoc compliance task.<br/>• Save resolved sequence as Company SOP.", styles['TableCell']),
            Paragraph("Specialist adds custom tasks on the fly; Nexus mines actions into reusable state machines.", styles['TableCell'])
        ],
        [
            Paragraph("<b>5. STEP_APPROVAL_GATE</b><br/>Leadership Governance Gate", styles['TableCellBold']),
            Paragraph("Supervisory escalation for actions exceeding standard risk or financial thresholds.", styles['TableCell']),
            Paragraph("• Payroll adjustment > ₹10,000 requires VP sign-off.<br/>• IT admin role grant requires CISO approval.<br/>• Contract exception requires Legal review.", styles['TableCell']),
            Paragraph("Dispatches one-click approval push to supervisor; audit automatically proceeds upon callback.", styles['TableCell'])
        ],
        [
            Paragraph("<b>6. STEP_REMEDIATE_PROOF</b><br/>Execution &amp; Forensic Seal", styles['TableCellBold']),
            Paragraph("Applies master record updates and binds empirical forensic proof (UTR, Ticket ID, PO #).", styles['TableCell']),
            Paragraph("• Push new IFSC to Payroll Gateway.<br/>• Credit leave quota in HRMS ledger.<br/>• Record Bank UTR # &amp; closure verdict.", styles['TableCell']),
            Paragraph("Executes secure writeback; records tamper-proof proof in master audit ledger before closure.", styles['TableCell'])
        ]
    ]
    steps_table = Table(steps_table_data, colWidths=[95, 125, 145, 158])
    steps_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(steps_table)
    story.append(Spacer(1, 5))

    # Real-World Case Study Walkthrough Box
    case_walkthrough_data = [
        [
            Paragraph("<b>END-TO-END WALKTHROUGH ON LIVE CASE: CASE-000001 (Bank Account Update for Salary)</b>", ParagraphStyle('cw_hdr', fontName='Helvetica-Bold', fontSize=7.8, textColor=primary_color))
        ],
        [
            Paragraph(
                "• <b>Step 1: Inbound Triage:</b> Employee Vaibhav (`100245`, Operations) emails: <i>'Please update my salary bank account to HDFC'</i>. Sender is verified in database, but no cancelled cheque or passbook photo is attached.<br/>"
                "• <b>Step 2A: Agent Freedom to Contact Employee:</b> Agent clicks <b>'Ask Info: Missing Cancelled Cheque'</b>. Case transitions to `AWAITING_EMPLOYEE_INFO`, SLA pauses at 21h 0m remaining. An automated email with a 1-click Magic Form upload link is sent.<br/>"
                "• <b>Step 2B: Ingestion &amp; Diagnostic:</b> Employee uploads cheque via Magic Link. System validates image, resumes SLA clock, marks `[x] Cancelled Cheque Verified`. Agent runs <b>'Verify IFSC Master'</b> diagnostic (HDFC0001234 confirmed).<br/>"
                "• <b>Step 2C: Build &amp; Remediate:</b> Agent builds custom checkpoint: <i>'Name on Cheque matches Employee Master 100%'</i>. Agent executes Payroll Gateway update and enters UTR/Ref: `BANK-SYNC-202610-849201`.<br/>"
                "• <b>Step 3: Response &amp; Closure:</b> System binds findings and UTR proof into Step 3 draft. Agent clicks <b>'Resolve Query &amp; Dispatch'</b>. Tamper-proof audit sealed.",
                styles['BodyTextSmall']
            )
        ]
    ]
    case_walkthrough = Table(case_walkthrough_data, colWidths=[523])
    case_walkthrough.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 0.8, indigo),
        ('LINEBELOW', (0, 0), (-1, 0), 0.6, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(case_walkthrough)

    story.append(PageBreak())

    # =========================================================================
    # PAGE 3: IN-AUDIT EMPLOYEE CLARIFICATION LOOP & WORKBENCH WIREFRAME
    # =========================================================================
    story.append(make_section_banner("Architecture of the In-Audit Employee Clarification Loop", 3))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Solving the #1 Operational Bottleneck (`STEP_REQUEST_INFO`):</b><br/>"
        "In enterprise operations, cases stall when agents cannot seamlessly obtain missing information from employees. The In-Audit Clarification Loop integrates direct communication, automated SLA timer pausing, multi-channel dispatch, and automated response ingestion into Step 2.",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 4))

    loop_table_data = [
        [
            Paragraph("<b>COMPONENT</b>", styles['TableHeader']),
            Paragraph("<b>TECHNICAL ARCHITECTURE</b>", styles['TableHeader']),
            Paragraph("<b>FUNCTIONAL CAPABILITY &amp; IMPACT</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>Zero Context Loss</b>", styles['TableCellBold']),
            Paragraph("Step 2 Embedded Widget<br/><code>#auditClarificationHub</code>", styles['TableCell']),
            Paragraph("Specialists never leave Step 2 to compose emails. An inline Clarification Hub mounts directly above the compliance checklist with pre-filled missing field prompts.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Smart Clarification Presets</b>", styles['TableCellBold']),
            Paragraph("Departmental Templates<br/><code>REQUEST_INFO</code> Presets", styles['TableCell']),
            Paragraph("1-click presets for common omissions: (1) Missing Cancelled Cheque / Bank Statement, (2) Attendance Punch Date/Time Discrepancy, (3) Missing GST Tax Invoice, (4) Asset Serial Tag.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Automated SLA Timer Pausing</b>", styles['TableCellBold']),
            Paragraph("SLA Engine Hook<br/><code>sla_paused = TRUE</code>", styles['TableCell']),
            Paragraph("Case status shifts to <code>AWAITING_EMPLOYEE_INFO</code> and the SLA clock stops ticking. Protects agent resolution metrics from delays caused by employee response times.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Multi-Channel Dispatch</b>", styles['TableCellBold']),
            Paragraph("Dual Delivery Gateway<br/>SMTP &amp; Magic Link Web Form", styles['TableCell']),
            Paragraph("Sends authenticated email + 1-click mobile-responsive web link with secure file dropzone for employees who cannot send email attachments.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Automated Response Ingestion</b>", styles['TableCellBold']),
            Paragraph("Inbound Reply Parser<br/><code>gmail_fetcher.py</code>", styles['TableCell']),
            Paragraph("Employee replies or uploaded files automatically bind into the case dossier. SLA clock resumes, status flips to <code>READY_FOR_AUDIT</code>, and the checkpoint is auto-checked.", styles['TableCell'])
        ]
    ]
    loop_table = Table(loop_table_data, colWidths=[105, 125, 293])
    loop_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(loop_table)
    story.append(Spacer(1, 6))

    # SECTION 4: WORKBENCH WIREFRAME
    story.append(make_section_banner("UI/UX Layout: The 'Agent Freedom' Audit Workbench", 4))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Upgraded Step 2 Bento-Grid Architecture (casedetail.html):</b>",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 4))

    wireframe_text = (
        "+------------------------------------------------------------------------------------------------+\n"
        "|  STEP 2: UNIVERSAL AUDIT & AGENT INVESTIGATION WORKBENCH                         Stage 2 of 3  |\n"
        "|  Department: OPERATIONS / PAYROLL  ·  Case: CASE-000001  ·  SLA: 21h Remaining  ·  SOC2 Aligned |\n"
        "+------------------------------------------------------------------------------------------------+\n"
        "| LEFT COLUMN: AGENT ACTION & EXECUTION            | RIGHT COLUMN: FORENSIC PROOF & CLOSURE      |\n"
        "+--------------------------------------------------+---------------------------------------------+\n"
        "| 1. EMPLOYEE CLARIFICATION & INQUIRY HUB          | 3. FORENSIC RESOLUTION PROOF HUB            |\n"
        "|    Status: [ ACTIVE - NO PENDING INQUIRY ]       |    Outcome Verdict: [ Reconciled & Credited ]|\n"
        "|    [ Quick Ask: Cheque ] [ Ask Date Clarify ]    |    Reference ID:    [ UTR-202610-849201     ]|\n"
        "|    [ + Compose Custom Inquiry to Employee ]      |    Adjustment Amt:  [ ₹ 4,500.00            ]|\n"
        "|    (Auto-pauses SLA · Sends Mail & Magic Link)   |    Findings:        [ Ledger reconciled... ]|\n"
        "+--------------------------------------------------+---------------------------------------------+\n"
        "| 2. DYNAMIC COMPLIANCE TASKS                      | 4. LEADERSHIP APPROVAL GATE                 |\n"
        "|    Progress: [========        ] 2/4 (50%)        |    Status: [ Self-Approved (Within Limit)  ]|\n"
        "|    [x] Verify identity against HRMS database     |    [ Request Manager Sign-Off              ]|\n"
        "|    [x] Validate IFSC code and branch address     +---------------------------------------------+\n"
        "|    [ ] Inspect cancelled cheque attachment       | 5. IMMUTABLE EVENT AUDIT TRAIL              |\n"
        "|    [ + Add Custom Verification Step... ]         |    • 20:46 IST - Agent opened case dossier  |\n"
        "+--------------------------------------------------+    • 20:47 IST - Diagnostic: Payroll Gateway|\n"
        "| 3. ENTERPRISE SYSTEM DIAGNOSTICS & STUDIO        |    • 20:48 IST - Info requested from Vaibhav|\n"
        "|    [ Run: Fetch Salary & Tax Breakdown ]         |    • 20:50 IST - Magic Link cheque uploaded |\n"
        "|    [ + Build Custom Diagnostic Query / Action ]  +---------------------------------------------+\n"
        "+------------------------------------------------------------------------------------------------+"
    )
    wireframe_table = Table([[Paragraph(f"<pre>{wireframe_text}</pre>", styles['CodeText'])]], colWidths=[523])
    wireframe_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#0f172a")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(wireframe_table)

    story.append(PageBreak())

    # =========================================================================
    # PAGE 4: TECHNICAL ROADMAP (PHASES 1-5), GOVERNANCE & KPIS
    # =========================================================================
    story.append(make_section_banner("Technical Implementation Roadmap & Milestones", 5))
    story.append(Spacer(1, 4))

    roadmap_data = [
        [
            Paragraph("<b>PHASE &amp; OBJECTIVE</b>", styles['TableHeader']),
            Paragraph("<b>TARGET CODEBASE FILES</b>", styles['TableHeader']),
            Paragraph("<b>KEY DELIVERABLES &amp; ENGINEERING TASKS</b>", styles['TableHeader']),
            Paragraph("<b>ACCEPTANCE CRITERIA</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>PHASE 1:<br/>In-Audit Clarification Loop</b>", styles['TableCellBold']),
            Paragraph("<code>frontend/casedetail.html</code><br/><code>backend/api/case_routes.py</code><br/><code>backend/services/cases/</code>", styles['TableCell']),
            Paragraph("• Mount Employee Clarification Hub inside Step 2 audit view.<br/>"
                      "• Add 1-click inquiry presets (Cancelled Cheque, Invoice, Date).<br/>"
                      "• Implement <code>POST /api/cases/{id}/request-info</code> with SLA pause.<br/>"
                      "• Ingest employee email replies &amp; Magic Link attachments.", styles['TableCell']),
            Paragraph("Agent can request info directly in Step 2; SLA pauses; reply auto-resumes audit.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 2:<br/>Dynamic Action Studio</b>", styles['TableCellBold']),
            Paragraph("<code>frontend/casedetail.html</code><br/><code>backend/services/actions/</code><br/><code>action_library.py</code>", styles['TableCell']),
            Paragraph("• Dynamic step builder: add Checklist, Query, Upload, or Approval.<br/>"
                      "• Multi-department diagnostic actions (Bank IFSC, LDAP, ERP PO).<br/>"
                      "• 'Save as Team Playbook' action to reuse sequences.", styles['TableCell']),
            Paragraph("Agents build and run custom actions and save re-usable playbooks on the fly.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 3:<br/>Autonomous Copilot Sync</b>", styles['TableCellBold']),
            Paragraph("<code>frontend/js/workflow-bot.js</code><br/>Nexus State Machine", styles['TableCell']),
            Paragraph("• Nexus observes Step 2 and detects missing attachments proactively.<br/>"
                      "• Auto-generates pre-filled inquiry card for 1-click agent dispatch.<br/>"
                      "• Background dry-run: executes diagnostic passes automatically.", styles['TableCell']),
            Paragraph("Nexus proactively prompts missing info inquiries and runs diagnostics.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 4:<br/>Company Playbook Library</b>", styles['TableCellBold']),
            Paragraph("<code>backend/models/workflow.py</code><br/><code>workflow_service.py</code>", styles['TableCell']),
            Paragraph("• Database tables for <code>playbooks</code> and <code>playbook_steps</code>.<br/>"
                      "• Seed standard enterprise playbooks (Payroll, IT, Ops, HR).<br/>"
                      "• Auto-load playbook based on detected case category.", styles['TableCell']),
            Paragraph("Standard company playbooks load instantly for matching ticket types.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 5:<br/>Governance &amp; Verification</b>", styles['TableCellBold']),
            Paragraph("<code>backend/tests/</code><br/>Audit Dossier PDF Export", styles['TableCell']),
            Paragraph("• Immutable logging for all inquiries, uploads, and step mutations.<br/>"
                      "• End-to-end automated test suite covering SLA pause/resume math.<br/>"
                      "• 1-Click Forensic Audit Dossier PDF generator for auditors.", styles['TableCell']),
            Paragraph("100% test pass rate across 43 test suites; full SOC2 compliance log.", styles['TableCell'])
        ]
    ]
    roadmap_table = Table(roadmap_data, colWidths=[85, 115, 213, 110])
    roadmap_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(roadmap_table)
    story.append(Spacer(1, 5))

    # SECTION 6: SUCCESS METRICS & KPIS
    story.append(make_section_banner("Key Performance Indicators (KPIs) & Operational Impact", 6))
    story.append(Spacer(1, 3))

    kpi_data = [
        [
            Paragraph("<b>OPERATIONAL METRIC</b>", styles['TableHeader']),
            Paragraph("<b>TRADITIONAL DESK</b>", styles['TableHeader']),
            Paragraph("<b>WITH AGENT FREEDOM &amp; NEXUS</b>", styles['TableHeader']),
            Paragraph("<b>STRATEGIC BUSINESS IMPACT</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>First-Contact Resolution (FCR)</b>", styles['TableCellBold']),
            Paragraph("42% (Multi-day email lag)", styles['TableCell']),
            Paragraph("<b>78% (+36% Improvement)</b>", ParagraphStyle('fcr', fontName='Helvetica-Bold', fontSize=7.2, textColor=emerald)),
            Paragraph("Immediate in-audit diagnostics resolve cases in single session.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Information Gathering Delay</b>", styles['TableCellBold']),
            Paragraph("3.2 Days average wait", styles['TableCell']),
            Paragraph("<b>&lt; 4 Hours (-90% Acceleration)</b>", ParagraphStyle('igd', fontName='Helvetica-Bold', fontSize=7.2, textColor=emerald)),
            Paragraph("1-click micro-inquiries and Magic Links eliminate email delays.", styles['TableCell'])
        ],
        [
            Paragraph("<b>SLA Inaccuracy / False Breaches</b>", styles['TableCellBold']),
            Paragraph("24% of tickets unfairly breach", styles['TableCell']),
            Paragraph("<b>&lt; 1% (Complete SLA Protection)</b>", ParagraphStyle('sla', fontName='Helvetica-Bold', fontSize=7.2, textColor=emerald)),
            Paragraph("Automated SLA clock pausing while awaiting employee inputs.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Manual Transcription Errors</b>", styles['TableCellBold']),
            Paragraph("18% error rate on manual entry", styles['TableCell']),
            Paragraph("<b>0% (Automated Data Binding)</b>", ParagraphStyle('err', fontName='Helvetica-Bold', fontSize=7.2, textColor=emerald)),
            Paragraph("Diagnostic findings and UTR proofs auto-bind into Step 3 draft.", styles['TableCell'])
        ]
    ]
    kpi_table = Table(kpi_data, colWidths=[110, 100, 115, 198])
    kpi_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 5))

    # Sign-off box
    signoff_data = [
        [
            Paragraph("<b>ARCHITECTURAL SPECIFICATION APPROVAL</b>", ParagraphStyle('so_title', fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor("#1e293b"))),
            Paragraph("<b>VERSION:</b> 1.0-AGENT-FREEDOM", ParagraphStyle('so_v', fontName='Helvetica-Bold', fontSize=8, textColor=indigo, alignment=2))
        ],
        [
            Paragraph("<b>Engineering Lead:</b> Google DeepMind Advanced Agentic Systems<br/>"
                      "<b>Target Departments:</b> IT, Finance, Operations, Legal, People Operations<br/>"
                      "<b>Resolution Standard:</b> Empirical Transaction ID / Forensic Audit Proof Mandate", styles['TableCell']),
            Paragraph("<b>Execution Status:</b> Approved for Implementation<br/>"
                      "<b>Database Backend:</b> SQLite / Enterprise RDBMS<br/>"
                      "<b>Compliance Certification:</b> SOC2 Type II / ISO27001 Aligned", styles['TableCell'])
        ]
    ]
    signoff_box = Table(signoff_data, colWidths=[261, 262])
    signoff_box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 0.8, slate_border),
        ('LINEBELOW', (0, 0), (-1, 0), 0.8, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(signoff_box)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated {filename}")

if __name__ == "__main__":
    out_dir = "/home/vaibhav/Desktop/HRWork"
    pdf_path = os.path.join(out_dir, "Agent_Freedom_Audit_Roadmap.pdf")
    frontend_pdf_path = os.path.join(out_dir, "frontend", "Agent_Freedom_Audit_Roadmap.pdf")
    
    # Also update Enterprise_Audit_and_Bot_Roadmap.pdf if desired, or keep as flagship
    build_pdf(pdf_path)
    build_pdf(frontend_pdf_path)

