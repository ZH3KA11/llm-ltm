import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { LaylaCharacter, LaylaSDK } from "@layla-network/sdk";
import type { IngestConfig } from "../types";
import type { ConfigSaveState } from "../useIngestFlow";
import { Field } from "../components/Field";
import { PROMPT_TEMPLATE_FIELDS } from "../promptTemplates";
import { truncateText } from "../../../libs/truncateText";

interface CharacterSettingsProps {
  character: LaylaCharacter;
  config: IngestConfig;
  configError: string | null;
  configSaveState: ConfigSaveState;
  layla: LaylaSDK;
  onBack: () => void;
  onStart: () => void;
  portrait: string;
  setConfig: Dispatch<SetStateAction<IngestConfig>>;
}

export function CharacterSettings({
  character,
  config,
  configError,
  configSaveState,
  layla,
  onBack,
  onStart,
  portrait,
  setConfig,
}: CharacterSettingsProps) {
  const [inferenceEngines, setInferenceEngines] = useState<string[]>([]);
  const [inferenceEnginesError, setInferenceEnginesError] = useState<
    string | null
  >(null);
  const [isLoadingInferenceEngines, setIsLoadingInferenceEngines] =
    useState(true);
  const data = character.data.data;
  const tagline = truncateText(
    data.extensions?.tagline ?? data.personality ?? "",
  );
  const description = truncateText(data.description);
  const isLoadingConfig = configSaveState === "loading";
  const statusText =
    configSaveState === "loading"
      ? "Loading saved settings"
      : configSaveState === "saving"
        ? "Saving settings"
        : configSaveState === "saved"
          ? "Settings saved"
          : configSaveState === "error"
            ? "Settings not saved"
            : "Per-character settings";
  const setConfigValue =
    (key: Exclude<keyof IngestConfig, "inferenceEngine">) =>
    (value: string) =>
      setConfig((current) => ({ ...current, [key]: value }));
  const savedEngineIsMissing =
    config.inferenceEngine !== null &&
    !inferenceEngines.includes(config.inferenceEngine);

  useEffect(() => {
    const controller = new AbortController();

    void layla.chat
      .getInferenceEngines({ signal: controller.signal })
      .then((engines) => {
        if (controller.signal.aborted) return;

        setInferenceEngines(engines);
        setIsLoadingInferenceEngines(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;

        setInferenceEnginesError((error as Error).message);
        setIsLoadingInferenceEngines(false);
      });

    return () => controller.abort();
  }, [layla]);

  return (
    <>
      <header className="hdr">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          {"←"}
        </button>
        <div>
          <div className="eyebrow">Configure ingest</div>
          <h1>{data.name}</h1>
        </div>
      </header>

      <div className="detail-hero">
        <img className="portrait lg" src={portrait} alt="" />
        <div className="meta">
          <div className="tagline">{tagline}</div>
          <div className="chips">
            {(data.tags ?? []).map((tag) => (
              <span className="chip" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="desc">{description}</p>

      <div className="section-label">
        <span className="dot" />
        <span className="txt">How memories are processed</span>
        <span className={`hint config-state ${configSaveState}`}>
          {statusText}
        </span>
      </div>
      {configError && <div className="config-error">{configError}</div>}

      <div className="config-card engine">
        <header>
          <span className="badge">{"⚙️"}</span>
          <div>
            <h3>Inference engine</h3>
            <p className="sub">Choose the engine used for this ingest</p>
          </div>
        </header>
        <div className="field">
          <label htmlFor="inference-engine">Engine</label>
          <select
            className="input"
            disabled={isLoadingConfig || isLoadingInferenceEngines}
            id="inference-engine"
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                inferenceEngine: event.target.value || null,
              }))
            }
            value={config.inferenceEngine ?? ""}
          >
            <option value="">
              {isLoadingInferenceEngines
                ? "Loading engines..."
                : "Default engine"}
            </option>
            {savedEngineIsMissing && (
              <option value={config.inferenceEngine ?? ""}>
                {config.inferenceEngine}{" "}
                {isLoadingInferenceEngines || inferenceEnginesError
                  ? "(saved)"
                  : "(unavailable)"}
              </option>
            )}
            {inferenceEngines.map((engine) => (
              <option key={engine} value={engine}>
                {engine}
              </option>
            ))}
          </select>
          {inferenceEnginesError ? (
            <p className="field-error">{inferenceEnginesError}</p>
          ) : (
            <p className="field-hint">
              Default uses the inference engine selected in Layla.
            </p>
          )}
        </div>
      </div>

      <div className="config-card">
        <header>
          <span className="badge">{"📝"}</span>
          <div>
            <h3>Summarising conversations</h3>
            <p className="sub">Condense each chat into durable memories</p>
          </div>
        </header>
        <Field
          disabled={isLoadingConfig}
          label="System prompt"
          onChange={setConfigValue("summarySystem")}
          rows={3}
          value={config.summarySystem}
        />
        <Field
          disabled={isLoadingConfig}
          label="Custom instruction"
          onChange={setConfigValue("summaryInstruction")}
          rows={2}
          value={config.summaryInstruction}
        />
      </div>

      <div className="config-card graph">
        <header>
          <span className="badge">{"🕸️"}</span>
          <div>
            <h3>Constructing the knowledge graph</h3>
            <p className="sub">Link memories into entities and relationships</p>
          </div>
        </header>
        <Field
          disabled={isLoadingConfig}
          label="System prompt"
          onChange={setConfigValue("graphSystem")}
          rows={3}
          value={config.graphSystem}
        />
        <Field
          disabled={isLoadingConfig}
          label="Custom instruction"
          onChange={setConfigValue("graphInstruction")}
          rows={2}
          value={config.graphInstruction}
        />
      </div>

      <details className="template-reference">
        <summary>
          <span>Prompt template fields</span>
          <span className="template-count">
            {PROMPT_TEMPLATE_FIELDS.length} available
          </span>
        </summary>
        <div className="template-reference-body">
          <p>
            These fields are replaced with the selected character and persona
            just before each prompt is sent.
          </p>
          <div className="template-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Template</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {PROMPT_TEMPLATE_FIELDS.map((field) => (
                  <tr key={field.key}>
                    <td>
                      <code>{field.template}</code>
                    </td>
                    <td>{field.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <div className="cta-bar">
        <button
          className="btn btn-primary"
          disabled={isLoadingConfig}
          onClick={onStart}
        >
          {"✨"} Start ingesting memories
        </button>
      </div>
    </>
  );
}
