export interface PromptEvent {
  id: string;
  timestamp: string;
  rawPrompt: string;
  status: "pending" | "linked" | "audited";
  linkedCommit: string | undefined;
  aiTool: string;
  intention: string | undefined;
  responseSummary: string | undefined;
  filesChanged: string[] | undefined;
}

export interface AuditCard {
  id: string;
  promptEventId: string;
  commitHash: string;
  file: string;
  functionName: string;
  prompt: string;
  intention: string;
  responseSummary: string;
  createdAt: string;
}

export interface FunctionRecord {
  functionName: string;
  file: string;
  createdByPromptId: string;
  lastModifiedByPromptId: string;
  auditHistory: { promptEventId: string; commitHash: string; cardRef: string }[];
}
