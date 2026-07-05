import type { LaylaChatMessage } from "@layla-network/sdk";

interface OpenAIModelList {
  data?: Array<{ id?: unknown }>;
}

interface OpenAIChatCompletion {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

const LM_STUDIO_BASE_URL = "http://localhost:1234/v1";
const configuredModel = import.meta.env.VITE_LM_STUDIO_MODEL?.trim();

let discoveredModel: Promise<string> | undefined;

async function readError(response: Response): Promise<string> {
  const body = await response.text();

  if (!body) return response.statusText;

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };

    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // The response was not JSON, so surface its text below.
  }

  return body;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}${path}`, init);

    if (!response.ok) {
      const detail = await readError(response);
      throw new Error(
        `LM Studio returned ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LM Studio returned")) {
      throw error;
    }

    throw new Error(
      `Unable to reach LM Studio at ${LM_STUDIO_BASE_URL}. Start its local server and allow browser requests.`,
      { cause: error },
    );
  }
}

async function resolveModel(): Promise<string> {
  if (configuredModel) return configuredModel;

  discoveredModel ??= request("/models")
    .then((response) => response.json() as Promise<OpenAIModelList>)
    .then((models) => {
      const model = models.data?.find(
        (candidate) => typeof candidate.id === "string" && candidate.id,
      )?.id;

      if (typeof model !== "string") {
        throw new Error(
          "LM Studio did not report an available model. Load a model or set VITE_LM_STUDIO_MODEL.",
        );
      }

      return model;
    })
    .catch((error) => {
      discoveredModel = undefined;
      throw error;
    });

  return discoveredModel;
}

export async function respondWithLMStudio(
  messages: LaylaChatMessage[],
): Promise<string> {
  const model = await resolveModel();
  const response = await request("/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });
  const completion = (await response.json()) as OpenAIChatCompletion;
  const content = completion.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LM Studio returned a completion without assistant content.");
  }

  return content;
}
