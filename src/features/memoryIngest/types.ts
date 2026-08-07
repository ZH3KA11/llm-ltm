import type { DemoEntity, DemoRelation } from "../../demo/data";

export type AppScreen = "picker" | "settings" | "ingesting";

export interface IngestConfig {
  inferenceEngine: string | null;
  summarySystem: string;
  summaryInstruction: string;
  graphSystem: string;
  graphInstruction: string;
}

export type MemoryIngestionStatus =
  | "summarizing"
  | "saving-summary"
  | "awaiting-graph"
  | "graphing"
  | "saving-graph"
  | "complete"
  | "error";

export interface IngestionLlmCall {
  systemPrompt: string;
  userPrompt: string;
  response: string;
  durationMs?: number;
  saveDurationMs?: number;
}

export interface MemoryIngestionDetail {
  id: string;
  memoryNumber: number;
  sessionId: string;
  sourceTimestamp: number;
  rawConversation: string;
  messageCount: number;
  inputCharacters: number;
  engineName: string;
  status: MemoryIngestionStatus;
  startedAt: number;
  completedAt?: number;
  totalDurationMs?: number;
  memoryId?: number;
  summaryCall?: IngestionLlmCall;
  graphCall?: IngestionLlmCall;
  graphJson?: string;
  graphEntities: DemoEntity[];
  graphRelations: DemoRelation[];
  graphTripleCount: number;
  graphSkipped?: boolean;
  error?: string;
}

export interface IngestSourceDetails {
  cutoffTimestamp: number;
  sessionsRead: number;
  messagesRead: number;
  engineName: string;
}

export interface PlacedNode extends DemoEntity {
  x: number;
  y: number;
}

export interface GraphEdge {
  from: PlacedNode;
  to: PlacedNode;
}

export interface IngestStats {
  entities: number;
  memories: number;
  relations: number;
}

export interface Particle {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  dur: number;
}

export type PhaseIdx = 0 | 1 | 2 | 3;
