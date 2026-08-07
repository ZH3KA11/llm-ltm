import { useState } from "react";
import type {
  IngestSourceDetails,
  MemoryIngestionDetail,
  MemoryIngestionStatus,
} from "../types";

interface IngestionHistoryProps {
  error: string | null;
  finished: boolean;
  ingestions: MemoryIngestionDetail[];
  sourceDetails: IngestSourceDetails;
}

const STATUS_LABEL: Record<MemoryIngestionStatus, string> = {
  summarizing: "Creating summary",
  "saving-summary": "Saving summary",
  "awaiting-graph": "Summary saved",
  graphing: "Building graph",
  "saving-graph": "Saving graph",
  complete: "Ingested",
  error: "Needs attention",
};

function formatDuration(value?: number) {
  if (value === undefined) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function stageState(
  item: MemoryIngestionDetail,
  stage: "source" | "summary" | "graph" | "saved",
) {
  if (item.status === "error") return stage === "saved" ? "error" : "done";
  if (stage === "source") return "done";
  if (stage === "summary") {
    return item.summaryCall
      ? "done"
      : item.status === "summarizing"
        ? "active"
        : "pending";
  }
  if (stage === "graph") {
    if (item.graphCall || item.graphSkipped || item.status === "complete") {
      return "done";
    }
    return item.status === "graphing" || item.status === "saving-graph"
      ? "active"
      : "pending";
  }
  return item.status === "complete" ? "done" : "pending";
}

function CopyBlock({ children }: { children: string }) {
  return <pre className="ingestion-copy">{children || "No content returned."}</pre>;
}

function MemoryIngestionCard({
  expanded,
  item,
  onToggle,
}: {
  expanded: boolean;
  item: MemoryIngestionDetail;
  onToggle: () => void;
}) {
  const summarySave = item.summaryCall?.saveDurationMs ?? 0;
  const graphSave = item.graphCall?.saveDurationMs ?? 0;
  const saveDuration = summarySave + graphSave;
  const outputCharacters =
    (item.summaryCall?.response.length ?? 0) +
    (item.graphCall?.response.length ?? 0);

  return (
    <article
      className={`ingestion-card status-${item.status}`}
      aria-labelledby={`${item.id}-title`}
    >
      <button
        className="ingestion-card-head"
        type="button"
        aria-expanded={expanded}
        aria-controls={`${item.id}-details`}
        onClick={onToggle}
      >
        <span className="memory-index" aria-hidden="true">
          {String(item.memoryNumber).padStart(2, "0")}
        </span>
        <span className="ingestion-card-heading">
          <span className="ingestion-card-kicker">
            <span className={`status-pulse ${item.status}`} />
            {STATUS_LABEL[item.status]}
          </span>
          <strong id={`${item.id}-title`}>
            Memory from {formatTimestamp(item.sourceTimestamp)}
          </strong>
          <span>
            {item.messageCount} {item.messageCount === 1 ? "message" : "messages"}
            {item.summaryCall?.response
              ? ` · ${item.summaryCall.response}`
              : " · Reading the conversation window…"}
          </span>
        </span>
        <span className="card-total">
          <small>Total time</small>
          <strong>{formatDuration(item.totalDurationMs)}</strong>
        </span>
        <span className={`disclosure-chevron ${expanded ? "open" : ""}`}>
          ›
        </span>
      </button>

      <div className="ingestion-stage-track" aria-label="Ingestion stages">
        {(["source", "summary", "graph", "saved"] as const).map((stage) => (
          <span className={stageState(item, stage)} key={stage}>
            <i />
            {stage === "source"
              ? "Source"
              : stage === "summary"
                ? "Summary"
                : stage === "graph"
                  ? "Knowledge graph"
                  : "Saved"}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="ingestion-card-details" id={`${item.id}-details`}>
          {item.error && (
            <div className="ingestion-error" role="alert">
              <strong>Ingestion stopped</strong>
              <span>{item.error}</span>
            </div>
          )}

          <div className="ingestion-metrics" aria-label="Processing timings">
            <div>
              <span>Summary model</span>
              <strong>{formatDuration(item.summaryCall?.durationMs)}</strong>
            </div>
            <div>
              <span>Graph model</span>
              <strong>{formatDuration(item.graphCall?.durationMs)}</strong>
            </div>
            <div>
              <span>Database writes</span>
              <strong>{saveDuration ? formatDuration(saveDuration) : "—"}</strong>
            </div>
            <div>
              <span>Entities / relations</span>
              <strong>
                {item.graphEntities.length} / {item.graphRelations.length}
              </strong>
            </div>
          </div>

          <details className="ingestion-section" open>
            <summary>
              <span className="section-icon source">01</span>
              <span>
                <strong>Raw conversation</strong>
                <small>Exact source window used to create this memory</small>
              </span>
              <span className="section-count">{item.inputCharacters} chars</span>
            </summary>
            <div className="ingestion-section-body">
              <CopyBlock>{item.rawConversation}</CopyBlock>
            </div>
          </details>

          <details className="ingestion-section" open={Boolean(item.summaryCall)}>
            <summary>
              <span className="section-icon summary">02</span>
              <span>
                <strong>Memory summary</strong>
                <small>Response returned by the summary model</small>
              </span>
              <span className="section-count">
                {item.summaryCall
                  ? formatDuration(item.summaryCall.durationMs)
                  : "In progress"}
              </span>
            </summary>
            <div className="ingestion-section-body">
              {item.summaryCall ? (
                <>
                  <CopyBlock>{item.summaryCall.response}</CopyBlock>
                  <details className="prompt-disclosure">
                    <summary>View the complete prompt sent to the model</summary>
                    <div>
                      <label>System prompt</label>
                      <CopyBlock>{item.summaryCall.systemPrompt}</CopyBlock>
                      <label>User prompt</label>
                      <CopyBlock>{item.summaryCall.userPrompt}</CopyBlock>
                    </div>
                  </details>
                </>
              ) : (
                <div className="section-loading">
                  <span className="spin" /> Waiting for the model response…
                </div>
              )}
            </div>
          </details>

          <details className="ingestion-section" open={Boolean(item.graphCall)}>
            <summary>
              <span className="section-icon graph">03</span>
              <span>
                <strong>Knowledge graph</strong>
                <small>Model output and the entities and relations extracted</small>
              </span>
              <span className="section-count">
                {item.graphSkipped
                  ? "Skipped"
                  : item.graphCall
                    ? `${item.graphTripleCount} triples`
                    : "Pending"}
              </span>
            </summary>
            <div className="ingestion-section-body">
              {item.graphSkipped ? (
                <p className="graph-note">
                  Graph construction was skipped because the summary response was empty.
                </p>
              ) : item.graphCall ? (
                <>
                  {item.graphEntities.length > 0 && (
                    <div className="entity-chip-list" aria-label="Extracted entities">
                      {item.graphEntities.map((entity) => (
                        <span className={`entity-chip ${entity.kind}`} key={entity.id}>
                          {entity.label}
                          <small>{entity.kind}</small>
                        </span>
                      ))}
                    </div>
                  )}
                  {item.graphRelations.length > 0 && (
                    <div className="relation-list">
                      {item.graphRelations.map((relation, index) => {
                        const from =
                          item.graphEntities.find((entity) => entity.id === relation.from)
                            ?.label ?? relation.from;
                        const to =
                          item.graphEntities.find((entity) => entity.id === relation.to)
                            ?.label ?? relation.to;
                        return (
                          <div key={`${relation.from}-${relation.to}-${index}`}>
                            <span>{from}</span>
                            <strong>{relation.label}</strong>
                            <span>{to}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <details className="prompt-disclosure">
                    <summary>View raw model response and prompt</summary>
                    <div>
                      <label>Raw LLM response</label>
                      <CopyBlock>{item.graphCall.response}</CopyBlock>
                      <label>System prompt</label>
                      <CopyBlock>{item.graphCall.systemPrompt}</CopyBlock>
                      <label>User prompt</label>
                      <CopyBlock>{item.graphCall.userPrompt}</CopyBlock>
                    </div>
                  </details>
                </>
              ) : (
                <div className="section-loading">
                  {item.status === "graphing" || item.status === "saving-graph" ? (
                    <><span className="spin" /> Constructing the graph…</>
                  ) : (
                    "Graph construction will begin after the summaries are saved."
                  )}
                </div>
              )}
            </div>
          </details>

          <details className="ingestion-section run-details">
            <summary>
              <span className="section-icon run">i</span>
              <span>
                <strong>Run details</strong>
                <small>Model, storage, identifiers, and payload sizes</small>
              </span>
            </summary>
            <div className="run-detail-grid">
              <div><span>Inference engine</span><strong>{item.engineName}</strong></div>
              <div><span>Session ID</span><strong>{item.sessionId}</strong></div>
              <div><span>Memory ID</span><strong>{item.memoryId ?? "Pending"}</strong></div>
              <div><span>Source messages</span><strong>{item.messageCount}</strong></div>
              <div><span>Input size</span><strong>{item.inputCharacters} chars</strong></div>
              <div><span>Output size</span><strong>{outputCharacters} chars</strong></div>
              <div><span>Started</span><strong>{formatTimestamp(item.startedAt)}</strong></div>
              <div><span>Completed</span><strong>{item.completedAt ? formatTimestamp(item.completedAt) : "In progress"}</strong></div>
            </div>
          </details>
        </div>
      )}
    </article>
  );
}

export function IngestionHistory({
  error,
  finished,
  ingestions,
  sourceDetails,
}: IngestionHistoryProps) {
  const newestId = ingestions[0]?.id ?? null;
  const [expansionOverrides, setExpansionOverrides] = useState<
    Map<string, boolean>
  >(new Map());

  const toggle = (id: string) => {
    setExpansionOverrides((current) => {
      const next = new Map(current);
      const isExpanded = current.get(id) ?? id === newestId;
      next.set(id, !isExpanded);
      return next;
    });
  };

  return (
    <section className="ingestion-history" aria-live="polite">
      <header className="ingestion-history-head">
        <div>
          <span className="eyebrow">Process visibility</span>
          <h2>Memory ingestion details</h2>
          <p>Newest memories appear first. Expand any card to inspect the complete run.</p>
        </div>
        {ingestions.length > 0 && (
          <span className="history-count">{ingestions.length} memor{ingestions.length === 1 ? "y" : "ies"}</span>
        )}
      </header>

      {error && ingestions.length === 0 && (
        <div className="ingestion-error" role="alert">
          <strong>Ingestion stopped</strong>
          <span>{error}</span>
        </div>
      )}

      {ingestions.length === 0 ? (
        <div className={`ingestion-preflight ${finished ? "complete" : ""}`}>
          <span className="preflight-orb">{finished ? "✓" : <span className="spin" />}</span>
          <div>
            <strong>{finished ? "Everything is up to date" : "Reading conversations"}</strong>
            <p>
              {finished
                ? "No new conversation messages were found after the latest saved memory."
                : "Finding new messages and preparing conversation windows for the models."}
            </p>
          </div>
          <dl>
            <div><dt>Engine</dt><dd>{sourceDetails.engineName}</dd></div>
            <div><dt>Sessions read</dt><dd>{sourceDetails.sessionsRead}</dd></div>
            <div><dt>Messages found</dt><dd>{sourceDetails.messagesRead}</dd></div>
            <div>
              <dt>Memory cutoff</dt>
              <dd>{sourceDetails.cutoffTimestamp ? formatTimestamp(sourceDetails.cutoffTimestamp) : "First ingestion"}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="ingestion-stack">
          {ingestions.map((item) => (
            <MemoryIngestionCard
              expanded={
                expansionOverrides.get(item.id) ?? item.id === newestId
              }
              item={item}
              key={item.id}
              onToggle={() => toggle(item.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
