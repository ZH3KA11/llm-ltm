import type {
  LaylaCharacter,
  LaylaPersona,
  LaylaSDK,
} from "@layla-network/sdk";

export interface PromptTemplateValues {
  char: string;
  user: string;
  persona: string;
  character_card: string;
  description: string;
  personality: string;
}

export interface PromptTemplateField {
  key: keyof PromptTemplateValues;
  label: string;
  template: string;
  description: string;
}

export const PROMPT_TEMPLATE_FIELDS: readonly PromptTemplateField[] = [
  {
    key: "char",
    label: "Character name",
    template: "{{char}}",
    description: "Character's name.",
  },
  {
    key: "user",
    label: "User name",
    template: "{{user}}",
    description: "Your name.",
  },
  {
    key: "persona",
    label: "User persona",
    template: "{{persona}}",
    description: "Your persona attached to this character.",
  },
  {
    key: "character_card",
    label: "Full character card",
    template: "{{character_card}}",
    description:
      "Full character details including description, personality, prompt, etc.",
  },
  {
    key: "description",
    label: "Character description",
    template: "{{description}}",
    description: "A compact character description.",
  },
  {
    key: "personality",
    label: "Character personality",
    template: "{{personality}}",
    description: "A compact personality for the character.",
  },
];

const TEMPLATE_PATTERN =
  /\{\{(char|user|persona|character_card|description|personality)\}\}/g;

export const SYSTEM_PROMPT_CONTEXT_TEMPLATE = `Character context:
Character name: {{char}}
User name: {{user}}
User persona:
{{persona}}
Full character card:
{{character_card}}
Character description:
{{description}}
Character personality:
{{personality}}`;

export async function loadPromptTemplateValues(
  layla: LaylaSDK,
  character: LaylaCharacter,
  signal: AbortSignal,
): Promise<PromptTemplateValues> {
  const persona = await layla.personas.get(character.id, { signal });
  return createPromptTemplateValues(character, persona);
}

export function createPromptTemplateValues(
  character: LaylaCharacter,
  persona: LaylaPersona,
): PromptTemplateValues {
  const data = character.data.data;

  return {
    char: data.name,
    user: persona.name,
    persona: persona.description,
    character_card: serializeCharacterCard(character),
    description: data.description,
    personality: data.personality,
  };
}

export function renderSystemPrompt(
  systemPrompt: string,
  values: PromptTemplateValues,
): string {
  const missingFields = PROMPT_TEMPLATE_FIELDS.filter(
    ({ template }) => !systemPrompt.includes(template),
  );
  const missingContext = missingFields
    .map(({ key, label }) => `${label}: {{${key}}}`)
    .join("\n");
  const promptTemplate = [systemPrompt.trimEnd(), missingContext]
    .filter(Boolean)
    .join("\n\n");

  return promptTemplate.replace(
    TEMPLATE_PATTERN,
    (_template, key: keyof PromptTemplateValues) => values[key],
  );
}

function serializeCharacterCard(character: LaylaCharacter): string {
  const extensions = { ...character.data.data.extensions };

  // Portraits may be multi-megabyte data URIs and do not provide useful text
  // context to the model. Preserve the field without sending the image payload.
  if ("image" in extensions) {
    extensions.image = "[omitted from text prompt]";
  }

  return JSON.stringify(
    {
      ...character.data,
      data: {
        ...character.data.data,
        extensions,
      },
    },
    null,
    2,
  );
}
