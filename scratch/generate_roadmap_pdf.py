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
        self.drawRightString(559, 814, "NEXUS BOT & UNIVERSAL AUDIT SPECIFICATION v3.0")
        
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
    slate_dark = colors.HexColor("#1e293b")
    slate_muted = colors.HexColor("#64748b")
    slate_border = colors.HexColor("#cbd5e1")

    styles.add(ParagraphStyle(
        name="BodyTextSmall",
        fontName="Helvetica",
        fontSize=8.2,
        leading=11.2,
        textColor=colors.HexColor("#334155")
    ))

    styles.add(ParagraphStyle(
        name="TableHeader",
        fontName="Helvetica-Bold",
        fontSize=7.8,
        leading=9.8,
        textColor=colors.HexColor("#ffffff"),
        alignment=0
    ))

    styles.add(ParagraphStyle(
        name="TableCell",
        fontName="Helvetica",
        fontSize=7.4,
        leading=9.6,
        textColor=colors.HexColor("#1e293b")
    ))

    styles.add(ParagraphStyle(
        name="TableCellBold",
        fontName="Helvetica-Bold",
        fontSize=7.4,
        leading=9.6,
        textColor=colors.HexColor("#0f172a")
    ))

    def make_section_banner(title_text, section_num):
        content = [
            [
                Paragraph(f"<b>SECTION {section_num}</b>", ParagraphStyle('sec_num', fontName='Helvetica-Bold', fontSize=7.5, textColor=colors.HexColor("#a5b4fc"))),
                Paragraph(f"<b>{title_text}</b>", ParagraphStyle('sec_title', fontName='Helvetica-Bold', fontSize=9.5, textColor=colors.white))
            ]
        ]
        t = Table(content, colWidths=[70, 453])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), slate_dark),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LINEBELOW', (0,0), (-1,-1), 1.8, indigo),
        ]))
        return t

    story = []

    # =========================================================================
    # PAGE 1: HEADER, OVERVIEW, DEPT MATRIX & BOT IDENTITY
    # =========================================================================
    header_table_data = [
        [
            Paragraph("<b>ENTERPRISE WORKFLOW ARCHITECTURE SPECIFICATION</b>", ParagraphStyle('hdr_kicker', fontName='Helvetica-Bold', fontSize=8, textColor=indigo)),
            Paragraph("<b>DOCUMENT ID:</b> SPEC-NEXUS-AUDIT-2026-V3.0", ParagraphStyle('hdr_id', fontName='Helvetica-Bold', fontSize=7.2, textColor=slate_muted, alignment=2))
        ],
        [
            Paragraph("<b>Universal Enterprise Audit & Autonomous Bot Roadmap</b>", ParagraphStyle('hdr_main', fontName='Helvetica-Bold', fontSize=16, leading=19, textColor=primary_color)),
            Paragraph("<b>DATE:</b> October 2026<br/><b>STATUS:</b> Approved Architecture", ParagraphStyle('hdr_meta', fontName='Helvetica', fontSize=7.2, leading=9.5, textColor=slate_dark, alignment=2))
        ],
        [
            Paragraph("Comprehensive operational blueprint to scale the platform into a <b>Universal Multi-Department Orchestration Platform</b> (IT, Finance, Legal, Operations, People Ops) powered by <b>Nexus Copilot</b> and the <b>4-Pillar Universal Audit & Forensic Proof Section</b>.", ParagraphStyle('hdr_desc', fontName='Helvetica', fontSize=8, leading=11, textColor=slate_muted)),
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
    story.append(Spacer(1, 6))

    # Architecture Snapshot Strip
    meta_box_data = [
        [
            Paragraph("<b>TARGET PLATFORM:</b><br/>Universal Case 360", styles['TableCell']),
            Paragraph("<b>BOT IDENTITY:</b><br/><b>Nexus Copilot</b>", styles['TableCell']),
            Paragraph("<b>AUDIT SCOPE:</b><br/>4-Pillar Multi-Dept Engine", styles['TableCell']),
            Paragraph("<b>LIFECYCLE:</b><br/>3-Step Consolidated Flow", styles['TableCell']),
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
    story.append(Spacer(1, 8))

    # SECTION 1
    story.append(make_section_banner("Executive Overview & The Universal Enterprise Pivot", 1))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>From Department-Siloed HR Tool to Universal Enterprise Orchestrator:</b><br/>"
        "Modern enterprises operate with interconnected business units—<b>IT, Finance, Operations, Legal, Procurement, and People Operations</b>. "
        "A rigid, single-domain tool creates administrative friction and compliance blindness. This project formalizes the platform's evolution into a "
        "<b>Universal Enterprise Ticketing, Autonomous Process Mining & Audit Platform</b> deployable to <b>any company and any department</b> with zero code modifications.",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 5))

    dept_table_data = [
        [
            Paragraph("<b>DEPARTMENT</b>", styles['TableHeader']),
            Paragraph("<b>TYPICAL INBOUND CASES</b>", styles['TableHeader']),
            Paragraph("<b>DIAGNOSTIC SYSTEM CHECKS</b>", styles['TableHeader']),
            Paragraph("<b>FORENSIC PROOF ARTIFACT</b>", styles['TableHeader']),
            Paragraph("<b>AUDIT OUTCOME VERDICT</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>IT & TechOps</b>", styles['TableCellBold']),
            Paragraph("Access provisioning, VPN failure, laptop requisition, software license grant", styles['TableCell']),
            Paragraph("LDAP/Okta lookup, ActiveDirectory group sync, asset inventory check", styles['TableCell']),
            Paragraph("ITSM Ticket ID / SAML Authorization Token", styles['TableCell']),
            Paragraph("PROVISIONED / ACCESS_GRANTED", styles['TableCell'])
        ],
        [
            Paragraph("<b>Finance & Accounts</b>", styles['TableCellBold']),
            Paragraph("Vendor invoice dispute, expense reimbursement, tax deduction, payout arrears", styles['TableCell']),
            Paragraph("ERP/SAP ledger audit, bank transmission verification, tax ledger check", styles['TableCell']),
            Paragraph("Bank UTR Number / Payout Batch Reference", styles['TableCell']),
            Paragraph("SALARY_CREDITED / RECONCILED", styles['TableCell'])
        ],
        [
            Paragraph("<b>Legal & Risk</b>", styles['TableCellBold']),
            Paragraph("Vendor NDA sign-off, contract review, regulatory filing, policy breach inquiry", styles['TableCell']),
            Paragraph("Contract repository check, regulatory blacklist scan, clause audit", styles['TableCell']),
            Paragraph("DocuSign Envelope ID / Contract Registry #", styles['TableCell']),
            Paragraph("POLICY_APPROVED / EXCEPTION_GRANTED", styles['TableCell'])
        ],
        [
            Paragraph("<b>Procurement & Ops</b>", styles['TableCellBold']),
            Paragraph("Hardware procurement, vendor onboarding, supply delivery discrepancy", styles['TableCell']),
            Paragraph("ERP PO match, warehouse receiving dock log, vendor status check", styles['TableCell']),
            Paragraph("PO Number / Goods Receipt Note (GRN)", styles['TableCell']),
            Paragraph("ORDER_DISPATCHED / VERIFIED", styles['TableCell'])
        ],
        [
            Paragraph("<b>People / HR Ops</b>", styles['TableCellBold']),
            Paragraph("Leave balance dispute, medical expense regularization, attendance punch sync", styles['TableCell']),
            Paragraph("Biometric punch telemetry, HRMS leave balance check, policy limits", styles['TableCell']),
            Paragraph("HRMS Transaction ID / Medical Certificate Ref", styles['TableCell']),
            Paragraph("LEAVE_APPROVED / ATTENDANCE_FIXED", styles['TableCell'])
        ]
    ]
    dept_table = Table(dept_table_data, colWidths=[85, 128, 130, 100, 80])
    dept_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(dept_table)
    story.append(Spacer(1, 8))

    # SECTION 2
    story.append(make_section_banner("Autonomous Workflow Copilot — Identity & Interactive Persona", 2))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Bot Identity Evaluation & Official Selection:</b> The conversational assistant is named <b>Nexus Copilot</b>. "
        "Nexus embodies the central orchestration hub connecting cross-department workflows, telemetry checks, and state synthesis.",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 4))

    bot_table_data = [
        [
            Paragraph("<b>NAME</b>", styles['TableHeader']),
            Paragraph("<b>BRAND PERSONALITY</b>", styles['TableHeader']),
            Paragraph("<b>CROSS-DEPARTMENT RELEVANCE</b>", styles['TableHeader']),
            Paragraph("<b>SELECTION STATUS</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>Nexus</b>", styles['TableCellBold']),
            Paragraph("Central intelligence hub, deterministic, authoritative, deeply integrated", styles['TableCell']),
            Paragraph("Connects IT, Finance, HR, Legal & Ops into unified state machines", styles['TableCell']),
            Paragraph("<b>SELECTED (#1 RECOMMENDATION)</b>", ParagraphStyle('sel', fontName='Helvetica-Bold', fontSize=7.2, textColor=emerald))
        ],
        [
            Paragraph("<b>Omni / OmniFlow</b>", styles['TableCellBold']),
            Paragraph("All-encompassing, versatile, universal operational assistant", styles['TableCell']),
            Paragraph("Strong multi-department capability; signifies complete coverage", styles['TableCell']),
            Paragraph("Alternative Candidate", styles['TableCell'])
        ],
        [
            Paragraph("<b>Aura</b>", styles['TableCellBold']),
            Paragraph("Luminous, warm, playful visual aesthetic (velvet sunset-aurora orb)", styles['TableCell']),
            Paragraph("Currently active baseline in UI; visually distinct and friendly", styles['TableCell']),
            Paragraph("Visual Avatar Baseline", styles['TableCell'])
        ],
        [
            Paragraph("<b>Cortex</b>", styles['TableCellBold']),
            Paragraph("Deeply analytical, forensic, strict compliance & audit focus", styles['TableCell']),
            Paragraph("Strong audit tone but lacks the warmth of interactive customer-facing ops", styles['TableCell']),
            Paragraph("Audit Specialized", styles['TableCell'])
        ]
    ]
    bot_table = Table(bot_table_data, colWidths=[85, 145, 198, 95])
    bot_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#f0fdf4"), colors.HexColor("#ffffff"), colors.HexColor("#f8fafc"), colors.HexColor("#ffffff")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(bot_table)
    story.append(Spacer(1, 4))

    story.append(Paragraph(
        "<b>Core Interactive Bot Capabilities:</b> (1) <b>3D Velvet Aurora Orb:</b> Floating launcher with interactive arrow-eyes, winking Delight animations, dynamic hover speech bubbles, and step badges. (2) <b>Real-Time Process Mining:</b> Passively observes specialist diagnostic clicks, task checks, and manual entries to construct directed acyclic workflow graphs. (3) <b>1-Click State Machine Synthesis:</b> Converts recorded steps into executable JSON state machines. (4) <b>Autonomous Dry-Run Simulation:</b> Executes 4 synthetic end-to-end passes against mock staging endpoints. (5) <b>Learned SLA Telemetry:</b> Benchmarks manual handling vs bot execution velocity (92.7% acceleration, 98.4% deterministic confidence).",
        styles['BodyTextSmall']
    ))

    # End Page 1
    story.append(PageBreak())

    # =========================================================================
    # PAGE 2: 4-PILLAR AUDIT SECTION & 3-STEP LIFECYCLE
    # =========================================================================
    story.append(make_section_banner("Universal Multi-Department Audit Section (Step 2 Workspace)", 3))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Why the Previous Implementation Needed Architectural Overhaul:</b><br/>"
        "Step 2 previously contained hardcoded HR cards (biometric punch, Darwinbox) and was subsequently stripped to an empty container "
        "(<code>&lt;div id=\"auditSectionWorkspace\"&gt;&lt;/div&gt;</code>). The new architecture establishes a <b>dynamic, schema-driven, 4-pillar audit engine</b> "
        "that automatically configures its verification checks based on the inbound case's department and category.",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 5))

    pillar_data = [
        [
            Paragraph("<b>PILLAR</b>", styles['TableHeader']),
            Paragraph("<b>COMPONENT & ARCHITECTURE</b>", styles['TableHeader']),
            Paragraph("<b>OPERATIONAL CAPABILITY & FUNCTIONALITY</b>", styles['TableHeader']),
            Paragraph("<b>DATA INTEGRITY & STORAGE</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>Pillar 1:<br/>Dynamic SOP Checklist</b>", styles['TableCellBold']),
            Paragraph("Category-Aware Task Engine<br/><code>/api/tasks</code>", styles['TableCell']),
            Paragraph("Auto-populates mandatory compliance steps for the department. Specialists can check off items, toggle status, and dynamically add custom audit tasks.", styles['TableCell']),
            Paragraph("Persisted in <code>tasks</code> table linked to <code>case_id</code> with audit logging.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Pillar 2:<br/>Enterprise Diagnostics</b>", styles['TableCellBold']),
            Paragraph("Diagnostic Console Mount<br/><code>#diagConsoleMount</code>", styles['TableCell']),
            Paragraph("Executes live API/system verification passes (ERP ledger, LDAP directory, IT ticketing, HRMS). Results appear in an interactive console with a 1-click '+ Insert Findings to Proof' action.", styles['TableCell']),
            Paragraph("Sanitized payload logged to <code>external_api_audits</code> and <code>audit_logs</code>.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Pillar 3:<br/>Forensic Proof Hub</b>", styles['TableCellBold']),
            Paragraph("Universal Proof Ledger<br/><code>forensicProof</code> State Object", styles['TableCell']),
            Paragraph("Mandates empirical verification before closure:<br/>"
                      "• <b>Reference / Proof ID:</b> UTR #, Ticket ID, PO #, Invoice #<br/>"
                      "• <b>Metric / Amount:</b> Discrepancy value, hours, or units<br/>"
                      "• <b>Outcome Verdict:</b> Reconciled, Approved, Granted, Void<br/>"
                      "• <b>Executive Notes:</b> Findings synced directly to Step 3 draft.", styles['TableCell']),
            Paragraph("Stored in <code>cases.resolution_type</code>, <code>resolution_notes</code>, and synced to <code>localStorage</code>.", styles['TableCell'])
        ],
        [
            Paragraph("<b>Pillar 4:<br/>Immutable Audit Trail</b>", styles['TableCellBold']),
            Paragraph("Chronological Event Feed<br/><code>/api/audit/logs</code>", styles['TableCell']),
            Paragraph("Visual tamper-proof timeline documenting DKIM/SPF email reception, specialist view events, diagnostic runs, manager approvals, and status mutations.", styles['TableCell']),
            Paragraph("Append-only <code>audit_logs</code> repository compliant with SOC2/ISO audit rules.", styles['TableCell'])
        ]
    ]
    pillar_table = Table(pillar_data, colWidths=[90, 115, 208, 110])
    pillar_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(pillar_table)
    story.append(Spacer(1, 10))

    # SECTION 4
    story.append(make_section_banner("Consolidated 3-Step Guided Resolution Lifecycle", 4))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Unified 3-Step Workflow:</b> Streamlines case handling from fragmented, confusing tabs into an intuitive, milestone-driven progression.",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 5))

    lifecycle_data = [
        [
            Paragraph("<b>STEP 1: DETAILS & DOSSIER</b>", styles['TableHeader']),
            Paragraph("<b>STEP 2: UNIVERSAL AUDIT SECTION</b>", styles['TableHeader']),
            Paragraph("<b>STEP 3: RESPONSE & RESOLUTION</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>Inbound Message & Identity Triage</b><br/>"
                      "• Executive typography mail viewer with DKIM/SPF telemetry.<br/>"
                      "• Universal Entity Profile (detects Employee, Vendor, Client, or Registered User).<br/>"
                      "• Database verification banner (Matched vs Unregistered Sender).<br/>"
                      "• Attachment scanner (PDF invoices, medical slips, receipts).<br/>"
                      "• [Reassign Task] & [Quick Add as Parsed] controls.", styles['TableCell']),
            Paragraph("<b>Investigation, Diagnostics & Proof</b><br/>"
                      "• Dynamic department-specific SOP checklist.<br/>"
                      "• Enterprise diagnostic action buttons with live console.<br/>"
                      "• Forensic proof entry: Reference ID, Amount, Verdict.<br/>"
                      "• Quick preset chips (Bank UTR, Ticket ID, PO #).<br/>"
                      "• Immutable chronological event audit trail feed.<br/>"
                      "• Prepares structured findings for resolution draft.", styles['TableCell']),
            Paragraph("<b>Authenticated Dispatch & Closure</b><br/>"
                      "• Smart reply composer auto-populated with findings and UTR proof from Step 2.<br/>"
                      "• 4 Standardized Response Presets: Approved/Credited, Request Info, In-Progress, Declined.<br/>"
                      "• Authenticated SMTP/Zoho dispatch to sender.<br/>"
                      "• Dual resolution controls: [Send Reply Only] vs [Resolve Query & Dispatch].<br/>"
                      "• Permanent case lock with audit compliance proof.", styles['TableCell'])
        ]
    ]
    lifecycle_table = Table(lifecycle_data, colWidths=[174, 175, 174])
    lifecycle_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor("#f8fafc")),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(lifecycle_table)
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "<b>Forensic Proof Synchronization Principle:</b> "
        "Any diagnostic finding or reference identifier entered in Step 2 instantly binds into Step 3's official response composer. "
        "The specialist does not need to retype bank UTR numbers, ticket codes, or adjustment summaries, eliminating human transcription error.",
        styles['BodyTextSmall']
    ))

    # End Page 2
    story.append(PageBreak())

    # =========================================================================
    # PAGE 3: TECHNICAL ROADMAP, GOVERNANCE & SIGN-OFF
    # =========================================================================
    story.append(make_section_banner("Technical Implementation Roadmap & Execution Milestones", 5))
    story.append(Spacer(1, 4))

    roadmap_data = [
        [
            Paragraph("<b>PHASE & OBJECTIVE</b>", styles['TableHeader']),
            Paragraph("<b>TARGET CODEBASE COMPONENTS</b>", styles['TableHeader']),
            Paragraph("<b>KEY DELIVERABLES & TECHNICAL TASKS</b>", styles['TableHeader']),
            Paragraph("<b>ACCEPTANCE CRITERIA</b>", styles['TableHeader'])
        ],
        [
            Paragraph("<b>PHASE 1:<br/>Bot Identity & Persona</b>", styles['TableCellBold']),
            Paragraph("<code>frontend/js/workflow-bot.js</code><br/><code>frontend/css/workflow-bot.css</code>", styles['TableCell']),
            Paragraph("• Set official interactive name to <b>Nexus Copilot</b>.<br/>"
                      "• Update speech greetings, avatar tooltips, and chip prompts to be department-agnostic.<br/>"
                      "• Support dynamic department context extraction (IT, Finance, Legal, Ops, HR).", styles['TableCell']),
            Paragraph("Bot launches with Nexus branding on any case dossier without HR-only phrasing.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 2:<br/>Universal Audit Section</b>", styles['TableCellBold']),
            Paragraph("<code>frontend/casedetail.html</code><br/>(<code>renderStep2AuditHtml</code>)", styles['TableCell']),
            Paragraph("• Replace empty workspace with complete 4-Pillar bento grid layout.<br/>"
                      "• Render Dynamic SOP Checklist with toggle & add capabilities.<br/>"
                      "• Build Universal Diagnostic Console with '+ Insert Findings' handler.<br/>"
                      "• Build Forensic Proof Card with Reference ID, Amount, and Outcome Verdict.<br/>"
                      "• Connect Quick Preset Chips (Bank UTR, Ticket ID, PO #).", styles['TableCell']),
            Paragraph("Step 2 displays rich, interactive, department-customized audit tools; zero blank screens.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 3:<br/>Bot & Audit Deep Sync</b>", styles['TableCellBold']),
            Paragraph("<code>frontend/js/workflow-bot.js</code><br/><code>frontend/casedetail.html</code>", styles['TableCell']),
            Paragraph("• Two-way event bus between Nexus Bot and Audit Workspace.<br/>"
                      "• Prompt chip: 'Summarize audit findings' auto-inserts into Step 2 notes.<br/>"
                      "• Prompt chip: 'Run diagnostic checks' executes system action suite.<br/>"
                      "• 'Synthesize Blueprint' compiles active diagnostic checkpoints into workflow nodes.", styles['TableCell']),
            Paragraph("Interacting with the bot directly drives the audit UI in real-time.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 4:<br/>Backend Action Library</b>", styles['TableCellBold']),
            Paragraph("<code>backend/services/actions/</code><br/><code>backend/api/agent_routes.py</code>", styles['TableCell']),
            Paragraph("• Expand <code>action_library.py</code> to support multi-department action codes (e.g., <code>LDAP_LOOKUP</code>, <code>PO_MATCH</code>, <code>CONTRACT_AUDIT</code> alongside HRMS actions).<br/>"
                      "• Ensure <code>execute_action</code> endpoint returns structured diagnostic telemetry.<br/>"
                      "• Persist forensic proof fields in <code>cases</code> table on resolve.", styles['TableCell']),
            Paragraph("All action executions are recorded in <code>external_api_audits</code> with sanitized logs.", styles['TableCell'])
        ],
        [
            Paragraph("<b>PHASE 5:<br/>Cross-Dept E2E Verification</b>", styles['TableCellBold']),
            Paragraph("<code>backend/tests/</code><br/>Browser Verification", styles['TableCell']),
            Paragraph("• End-to-end test with a <b>Finance Case</b> (Bank UTR, Ledger Reconciled).<br/>"
                      "• End-to-end test with an <b>IT Case</b> (SAML Token, Access Provisioned).<br/>"
                      "• End-to-end test with an <b>Operations Case</b> (PO Reference, Order Dispatched).<br/>"
                      "• Regression test across existing 43 automated test suites.", styles['TableCell']),
            Paragraph("100% test pass rate, flawless Step 1 -> 2 -> 3 transition, verified forensic proof.", styles['TableCell'])
        ]
    ]
    roadmap_table = Table(roadmap_data, colWidths=[85, 115, 213, 110])
    roadmap_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), slate_dark),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor("#ffffff"), colors.HexColor("#f8fafc")]),
        ('GRID', (0, 0), (-1, -1), 0.5, slate_border),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(roadmap_table)
    story.append(Spacer(1, 10))

    # SECTION 6
    story.append(make_section_banner("Governance, Security & Audit Compliance Standards", 6))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "<b>Enterprise Zero-Trust & Regulatory Adherence:</b><br/>"
        "• <b>Tamper-Proof Audit Repository:</b> Audit records are immutable once committed to <code>audit_logs</code>. Any manual update or override records a secondary supervisory event.<br/>"
        "• <b>PII Redaction & Sanitization:</b> All external API diagnostic requests pass through the <code>credential_vault.py</code> sanitization layer—bearer tokens, client secrets, and sensitive financial identifiers are redacted prior to logging.<br/>"
        "• <b>Forensic Closure Standard:</b> No case can be transitioned to <code>RESOLVED</code> without mandatory empirical proof (valid transaction reference or supervisor exception sign-off).",
        styles['BodyTextSmall']
    ))
    story.append(Spacer(1, 10))

    # Sign-off box
    signoff_data = [
        [
            Paragraph("<b>ARCHITECTURAL SPECIFICATION APPROVAL</b>", ParagraphStyle('so_title', fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor("#1e293b"))),
            Paragraph("<b>VERSION:</b> 3.0-ENTERPRISE", ParagraphStyle('so_v', fontName='Helvetica-Bold', fontSize=8, textColor=indigo, alignment=2))
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
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(signoff_box)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated {filename}")

if __name__ == "__main__":
    out_dir = "/home/vaibhav/Desktop/HRWork"
    pdf_path = os.path.join(out_dir, "Enterprise_Audit_and_Bot_Roadmap.pdf")
    frontend_pdf_path = os.path.join(out_dir, "frontend", "Enterprise_Audit_and_Bot_Roadmap.pdf")
    
    build_pdf(pdf_path)
    build_pdf(frontend_pdf_path)

