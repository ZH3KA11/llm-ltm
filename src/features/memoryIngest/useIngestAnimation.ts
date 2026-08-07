import { useCallback, useEffect, useRef, useState } from "react";
import {
  LaylaAbortError,
  type LaylaCharacter,
  type LaylaMemory,
  type LaylaSDK,
} from "@layla-network/sdk";
import type { DemoEntity, DemoRelation } from "../../demo/data";
import {
  buildTranscriptWindows,
  generateKnowledgeGraph,
  getLatestMemoryTimestamp,
  type IngestedMemoryDraft,
  loadNewTranscripts,
  makeMemoryDraft,
  summarizeWindow,
} from "./ingestion";
import { sleep } from "./layla";
import { loadPromptTemplateValues } from "./promptTemplates";
import type {
  GraphEdge,
  IngestConfig,
  IngestStats,
  IngestSourceDetails,
  MemoryIngestionDetail,
  Particle,
  PhaseIdx,
  PlacedNode,
} from "./types";

interface UseIngestAnimationArgs {
  character: LaylaCharacter;
  config: IngestConfig;
  layla: LaylaSDK;
}

function memoryPayload(memory: IngestedMemoryDraft): LaylaMemory {
  return {
    id: memory.id,
    character_id: memory.character_id,
    rawText: memory.rawText,
    timestamp: memory.timestamp,
    summary: memory.summary,
    knowledgeGraphJSON: memory.knowledgeGraphJSON,
    session_id: memory.session_id,
  };
}

export function useIngestAnimation({
  character,
  config,
  layla,
}: UseIngestAnimationArgs) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dimsRef = useRef({ w: 320, h: 360 });
  const abortRef = useRef<AbortController | null>(null);
  const particleId = useRef(0);
  const runRef = useRef(false);
  const activeDetailIdRef = useRef<string | null>(null);
  const processingStartRef = useRef(new Map<string, number>());

  const [phase, setPhase] = useState<PhaseIdx>(0);
  const [phaseProg, setPhaseProg] = useState(0);
  const [overall, setOverall] = useState(0);
  const [ingestions, setIngestions] = useState<MemoryIngestionDetail[]>([]);
  const [sourceDetails, setSourceDetails] = useState<IngestSourceDetails>({
    cutoffTimestamp: 0,
    sessionsRead: 0,
    messagesRead: 0,
    engineName: "Layla default",
  });
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<PlacedNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [stats, setStats] = useState<IngestStats>({
    entities: 0,
    memories: 0,
    relations: 0,
  });
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const readDims = () => {
      const next = { w: stage.clientWidth, h: stage.clientHeight };
      dimsRef.current = next;
    };
    const observer = new ResizeObserver(readDims);

    observer.observe(stage);
    readDims();

    return () => observer.disconnect();
  }, []);

  const updateIngestion = useCallback(
    (id: string, update: Partial<MemoryIngestionDetail>) => {
      setIngestions((current) =>
        current.map((item) => (item.id === id ? { ...item, ...update } : item)),
      );
    },
    [],
  );

  const finishIngestion = useCallback((id: string, activeDurationMs?: number) => {
    const completedAt = Date.now();
    const startedAt = processingStartRef.current.get(id);

    updateIngestion(id, {
      completedAt,
      status: "complete",
      totalDurationMs:
        activeDurationMs ??
        (startedAt === undefined ? undefined : performance.now() - startedAt),
    });
    processingStartRef.current.delete(id);
  }, [updateIngestion]);

  const setWeightedProgress = useCallback((phaseIndex: PhaseIdx, within: number) => {
    setPhaseProg(within);

    const base = phaseIndex === 0 ? 0 : phaseIndex === 1 ? 0.12 : 0.58;
    const span = phaseIndex === 0 ? 0.12 : phaseIndex === 1 ? 0.46 : 0.42;

    setOverall(Math.min(1, base + span * within));
  }, []);

  const placeNode = useCallback(
    (entity: DemoEntity, index: number): PlacedNode => {
      const { w, h } = dimsRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const ring = index % 2 === 0 ? 0 : 1;
      const radius = ring === 0 ? Math.min(w, h) * 0.3 : Math.min(w, h) * 0.42;
      const angle = index * 2.399963 + (ring === 1 ? 0.6 : 0);
      const jitter = ((index * 53) % 17) / 17 - 0.5;
      const r = radius + jitter * 18;
      const x = cx + Math.cos(angle) * r * 1.18;
      const y = cy + Math.sin(angle) * r;
      const pad = 60;

      return {
        ...entity,
        x: Math.max(pad, Math.min(w - pad, x)),
        y: Math.max(40, Math.min(h - 30, y)),
      };
    },
    [],
  );

  const spawnParticles = useCallback((target: PlacedNode) => {
    const { w, h } = dimsRef.current;
    const created: Particle[] = [];

    for (let i = 0; i < 3; i += 1) {
      const edge = Math.floor(Math.random() * 4);
      const start =
        edge === 0
          ? { x: Math.random() * w, y: -20 }
          : edge === 1
            ? { x: w + 20, y: Math.random() * h }
            : edge === 2
              ? { x: Math.random() * w, y: h + 20 }
              : { x: -20, y: Math.random() * h };

      created.push({
        id: particleId.current++,
        x0: start.x - target.x,
        y0: start.y - target.y,
        x: target.x,
        y: target.y,
        dur: 1.6 + Math.random() * 1.4,
      });
    }

    setParticles((current) => [...current, ...created]);

    const ids = new Set(created.map((particle) => particle.id));
    window.setTimeout(() => {
      setParticles((current) =>
        current.filter((particle) => !ids.has(particle.id)),
      );
    }, 3200);
  }, []);

  useEffect(() => {
    if (runRef.current) return;

    runRef.current = true;

    const abortController = new AbortController();
    abortRef.current = abortController;
    const { signal } = abortController;

    async function ingestMemories() {
      try {
        setPhase(0);
        const engineSelection = await layla.chat.setInferenceEngine(
          config.inferenceEngine,
          { signal },
        );
        const engineName = engineSelection.engineName ?? "Layla default";
        setSourceDetails((current) => ({ ...current, engineName }));

        const cutoffTimestamp = await getLatestMemoryTimestamp(
          layla,
          character.id,
          signal,
        );
        setSourceDetails((current) => ({ ...current, cutoffTimestamp }));

        const transcripts = await loadNewTranscripts({
          characterId: character.id,
          cutoffTimestamp,
          layla,
          onHistory: (sessionsRead, messageCount) => {
            setSourceDetails((current) => ({
              ...current,
              sessionsRead,
              messagesRead: current.messagesRead + messageCount,
            }));
          },
          onProgress: (complete, total) => {
            setWeightedProgress(0, total === 0 ? 1 : complete / total);
          },
          signal,
        });

        const windows = buildTranscriptWindows(transcripts, character);

        if (windows.length === 0) {
          setWeightedProgress(0, 1);
          setWeightedProgress(1, 1);
          setWeightedProgress(2, 1);
          setPhase(3);
          setOverall(1);
          setFinished(true);
          return;
        }

        setWeightedProgress(0, 1);
        await sleep(180, signal);
        setPhase(1);

        const promptTemplateValues = await loadPromptTemplateValues(
          layla,
          character,
          signal,
        );
        const memoryDrafts: IngestedMemoryDraft[] = [];
        const detailIds: string[] = [];
        const activeDurations: number[] = [];

        for (let i = 0; i < windows.length; i += 1) {
          const window = windows[i];
          const detailId = `${window.sessionId}:${window.timestamp}:${i}`;
          detailIds.push(detailId);
          activeDetailIdRef.current = detailId;
          processingStartRef.current.set(detailId, performance.now());
          setIngestions((current) => [
            {
              id: detailId,
              memoryNumber: i + 1,
              sessionId: window.sessionId,
              sourceTimestamp: window.timestamp,
              rawConversation: window.rawText,
              messageCount: window.messageCount,
              inputCharacters: window.rawText.length,
              engineName,
              status: "summarizing",
              startedAt: Date.now(),
              graphEntities: [],
              graphRelations: [],
              graphTripleCount: 0,
            },
            ...current,
          ]);

          const summaryStarted = performance.now();
          const summaryResult = await summarizeWindow(
            layla,
            config,
            promptTemplateValues,
            window.rawText,
            signal,
          );
          const summaryDurationMs = performance.now() - summaryStarted;
          updateIngestion(detailId, {
            status: "saving-summary",
            summaryCall: {
              ...summaryResult,
              durationMs: summaryDurationMs,
            },
          });

          const draft = makeMemoryDraft(
            character.id,
            window.sessionId,
            window,
            summaryResult.response,
            null,
            [],
          );
          const summarySaveStarted = performance.now();
          const [savedMemory] = await layla.memories.createOrUpdate(
            [memoryPayload(draft)],
            { signal },
          );
          const summarySaveDurationMs = performance.now() - summarySaveStarted;

          if (!savedMemory) {
            throw new Error("Layla did not return the saved memory.");
          }

          activeDurations[i] = summaryDurationMs + summarySaveDurationMs;
          updateIngestion(detailId, {
            memoryId: savedMemory.id,
            status: "awaiting-graph",
            summaryCall: {
              ...summaryResult,
              durationMs: summaryDurationMs,
              saveDurationMs: summarySaveDurationMs,
            },
          });

          memoryDrafts.push({
            ...draft,
            ...savedMemory,
            graphTriples: [],
          });
          setStats((current) => ({
            ...current,
            memories: memoryDrafts.length,
          }));

          setWeightedProgress(1, (i + 1) / windows.length);
          await sleep(160, signal);
        }

        setPhase(2);

        const entitiesById = new Map<string, DemoEntity>();
        const relationsByKey = new Map<string, DemoRelation>();
        const placedById = new Map<string, PlacedNode>();
        const graphProgress = (graphIndex: number, withinGraph: number) =>
          (graphIndex + withinGraph) / Math.max(1, memoryDrafts.length);

        const revealGraph = async (
          graphEntities: DemoEntity[],
          graphRelations: DemoRelation[],
          graphIndex: number,
        ) => {
          const newPlaced: PlacedNode[] = [];

          for (const entity of graphEntities) {
            if (entitiesById.has(entity.id)) continue;

            entitiesById.set(entity.id, entity);

            const placed = placeNode(entity, entitiesById.size - 1);
            placedById.set(entity.id, placed);
            newPlaced.push(placed);
          }

          for (const relation of graphRelations) {
            const key = `${relation.from}|${relation.label}|${relation.to}`;
            if (!relationsByKey.has(key)) {
              relationsByKey.set(key, relation);
            }
          }

          const updateEdges = () => {
            setEdges(
              [...relationsByKey.values()]
                .filter(
                  (relation) =>
                    placedById.has(relation.from) && placedById.has(relation.to),
                )
                .map((relation) => ({
                  from: placedById.get(relation.from)!,
                  to: placedById.get(relation.to)!,
                })),
            );
          };

          if (newPlaced.length === 0) {
            updateEdges();
            setWeightedProgress(2, graphProgress(graphIndex, 0.86));
            return;
          }

          for (let i = 0; i < newPlaced.length; i += 1) {
            const node = newPlaced[i];

            setNodes((current) => [...current, node]);
            spawnParticles(node);

            updateEdges();
            setWeightedProgress(
              2,
              graphProgress(
                graphIndex,
                0.62 + ((i + 1) / newPlaced.length) * 0.24,
              ),
            );
            await sleep(520, signal);
          }
        };

        for (let i = 0; i < memoryDrafts.length; i += 1) {
          const detailId = detailIds[i];
          activeDetailIdRef.current = detailId;

          if (!memoryDrafts[i].summary) {
            updateIngestion(detailId, { graphSkipped: true });
            finishIngestion(detailId, activeDurations[i]);
            setWeightedProgress(2, graphProgress(i, 1));
            continue;
          }

          updateIngestion(detailId, { status: "graphing" });
          const graphStarted = performance.now();
          const graph = await generateKnowledgeGraph(
            layla,
            config,
            promptTemplateValues,
            memoryDrafts[i].summary ?? "",
            signal,
          );
          const graphDurationMs = performance.now() - graphStarted;
          updateIngestion(detailId, {
            status: "saving-graph",
            graphCall: {
              systemPrompt: graph.systemPrompt,
              userPrompt: graph.userPrompt,
              response: graph.response,
              durationMs: graphDurationMs,
            },
            graphJson: graph.json,
            graphEntities: graph.display.entities,
            graphRelations: graph.display.relations,
            graphTripleCount: graph.triples.length,
          });

          const graphedMemory = {
            ...memoryDrafts[i],
            knowledgeGraphJSON: graph.json,
            graphTriples: graph.triples,
          };
          const graphSaveStarted = performance.now();
          const [savedMemory] = await layla.memories.createOrUpdate(
            [memoryPayload(graphedMemory)],
            { signal },
          );
          const graphSaveDurationMs = performance.now() - graphSaveStarted;

          if (!savedMemory) {
            throw new Error("Layla did not return the updated memory.");
          }

          memoryDrafts[i] = {
            ...graphedMemory,
            ...savedMemory,
            graphTriples: graph.triples,
          };
          updateIngestion(detailId, {
            memoryId: savedMemory.id,
            graphCall: {
              systemPrompt: graph.systemPrompt,
              userPrompt: graph.userPrompt,
              response: graph.response,
              durationMs: graphDurationMs,
              saveDurationMs: graphSaveDurationMs,
            },
          });
          finishIngestion(
            detailId,
            activeDurations[i] + graphDurationMs + graphSaveDurationMs,
          );
          setWeightedProgress(
            2,
            graphProgress(i, 0.62),
          );
          await revealGraph(graph.display.entities, graph.display.relations, i);
          setStats({
            entities: entitiesById.size,
            memories: memoryDrafts.length,
            relations: relationsByKey.size,
          });
        }

        setStats({
          entities: entitiesById.size,
          memories: memoryDrafts.length,
          relations: relationsByKey.size,
        });
        setWeightedProgress(2, 1);
        setPhase(3);
        setOverall(1);
        activeDetailIdRef.current = null;
        await sleep(500, signal);
        setFinished(true);
      } catch (error) {
        if (error instanceof LaylaAbortError) return;
        const message = (error as Error).message;
        setError(message);
        if (activeDetailIdRef.current) {
          const detailId = activeDetailIdRef.current;
          const startedAt = processingStartRef.current.get(detailId);
          updateIngestion(activeDetailIdRef.current, {
            completedAt: Date.now(),
            error: message,
            status: "error",
            totalDurationMs:
              startedAt === undefined ? undefined : performance.now() - startedAt,
          });
          processingStartRef.current.delete(detailId);
        }
      }
    }

    void ingestMemories();

    return () => {
      runRef.current = false;
      abortController.abort();
    };
  }, [
    character,
    config,
    finishIngestion,
    layla,
    placeNode,
    setWeightedProgress,
    spawnParticles,
    updateIngestion,
  ]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    abort,
    edges,
    error,
    finished,
    ingestions,
    nodes,
    overall,
    particles,
    phase,
    phaseProg,
    sourceDetails,
    stats,
    stageRef,
  };
}
