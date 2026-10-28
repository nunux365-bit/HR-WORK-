/**
 * HR Flow — Centralized Reactive State Store (frontend/js/casedetail/state.js)
 */

class StateStore {
    constructor() {
        this.caseRef = "";
        this.caseData = null;
        this.currentStep = 1;
        this.totalSteps = 3;
        this.viewMode = "GUIDED"; // "GUIDED" or "FULL"
        this.replyTemplateMode = "UPDATE"; // "APPROVE" | "REQUEST_INFO" | "UPDATE" | "REJECT"
        this.activeDraft = "";
        this.forensicProof = {
            proofId: "",
            metric: "",
            notes: "",
            verdict: "RESOLVED",
        };
        this.listeners = new Map();
        this.saveDraftTimeout = null;
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            for (const cb of this.listeners.get(event)) {
                try {
                    cb(data, this);
                } catch (err) {
                    console.error(`Error in state listener for '${event}':`, err);
                }
            }
        }
    }

    initFromDossier(dossier, initialRef) {
        this.caseRef = initialRef || dossier?.case?.case_number || dossier?.case?.id || "";
        this.caseData = dossier;

        const c = dossier.case || {};
        this.totalSteps = Number(dossier.total_steps || (Array.isArray(dossier.workflow_stages) ? dossier.workflow_stages.length : 3));
        
        if (c.status === "RESOLVED" || c.status === "CLOSED") {
            this.currentStep = this.totalSteps;
        } else {
            this.currentStep = Number(dossier.current_step || c.current_step || 1);
            if (this.currentStep > this.totalSteps) this.currentStep = this.totalSteps;
            if (this.currentStep < 1) this.currentStep = 1;
        }

        // Active draft from database or smart templates
        if (c.draft_reply) {
            this.activeDraft = c.draft_reply;
        } else if (dossier.active_draft) {
            this.activeDraft = dossier.active_draft;
        } else if (dossier.smart_templates && dossier.smart_templates[this.replyTemplateMode]) {
            this.activeDraft = dossier.smart_templates[this.replyTemplateMode];
        }

        // Forensic proof from database
        if (c.forensic_proof && typeof c.forensic_proof === "object") {
            this.forensicProof = { ...this.forensicProof, ...c.forensic_proof };
        } else if (c.resolution_type || c.resolution_notes) {
            this.forensicProof.verdict = c.resolution_type || "RESOLVED";
            this.forensicProof.notes = c.resolution_notes || "";
            const mRef = (c.resolution_notes || "").match(/(?:Reference ID|Ref|UTR|Ticket)[:\s]+([^\n·\]]+)/i);
            if (mRef) this.forensicProof.proofId = mRef[1].trim();
            const mAmt = (c.resolution_notes || "").match(/(?:Adjustment|Amount|Metric)[:\s]+([^\n·\]]+)/i);
            if (mAmt) this.forensicProof.metric = mAmt[1].trim();
        }

        this.emit("loaded", this.caseData);
        this.emit("change", this.caseData);
    }

    setStep(step) {
        const s = Math.max(1, Math.min(Number(step), this.totalSteps));
        if (this.currentStep !== s) {
            this.currentStep = s;
            this.emit("stepChange", s);
            this.emit("change", this.caseData);
        }
    }

    setViewMode(mode) {
        if (this.viewMode !== mode) {
            this.viewMode = mode;
            this.emit("viewModeChange", mode);
            this.emit("change", this.caseData);
        }
    }

    setReplyTemplateMode(mode) {
        this.replyTemplateMode = mode;
        if (this.caseData?.smart_templates && this.caseData.smart_templates[mode]) {
            this.activeDraft = this.caseData.smart_templates[mode];
        }
        this.emit("templateModeChange", mode);
        this.emit("draftChange", this.activeDraft);
    }

    setDraft(text, triggerSave = true) {
        this.activeDraft = text;
        this.emit("draftChange", text);
    }

    setForensicProof(data) {
        this.forensicProof = { ...this.forensicProof, ...data };
        this.emit("forensicProofChange", this.forensicProof);
    }
}

export const CaseState = new StateStore();

