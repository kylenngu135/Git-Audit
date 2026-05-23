export interface PromptEvent {
  id: string;
  timestamp: string;
  rawPrompt: string;
  status: "pending" | "linked" | "audited";
  linkedCommit: string | undefined;
  aiTool: string;
}

export interface AuditCard {
  promptEventId: string;
  commitHash: string;
  file: string;
  functionName: string;
  linesChanged: { start: number; end: number };
  what: string;
  decisions: string[];
  risks: { message: string; severity: "low" | "medium" | "high" }[];
  testssuggested: string[];
  trustStatus: "unverified" | "verified" | "flagged";
  createdAt: string;
}

export interface FunctionRecord {
  functionName: string;
  file: string;
  createdByPromptId: string;
  lastModifiedByPromptId: string;
  auditHistory: { promptEventId: string; commitHash: string; cardRef: string }[];
  openRisks: { message: string; severity: "low" | "medium" | "high"; introducedByPromptId: string }[];
  trustScore: number;
}
