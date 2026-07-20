# Teaching an AI Companion to Remember: Building a Long-Term Memory Mini-App for Layla

## How a small React app turns conversation history into durable memories and a living knowledge graph—using Layla's on-device SDK

Anyone who has spent time talking with an AI companion knows the magic of a
moment that carries forward.

A remembered promise changes the next conversation. A familiar place gains a
history. A character who recalls why you were worried last week feels less like
a blank chat window and more like someone whose life continues between
sessions.

That continuity is the idea behind **LLM-based Long-term Memory**, a mini-app
for Layla. The app reads a character's recent conversations, distills them into
compact memories, extracts relationships between people, places, events, and
ideas, and saves the result back into Layla.

For Layla users, it is a way to strengthen a character's memory after a long
conversation. For developers, it is a useful example of something broader: a
mini-app does not have to be a separate toy living beside an AI companion. It
can become a workflow that reads from, reasons over, and contributes back to
the companion's world.

This article walks through how the app works and the design lessons it offers
to anyone building their own Layla mini-app.

> Suggested cover image: the completed ingest screen in `assets/4.jpg`, showing
> the character portrait surrounded by the generated knowledge graph.

## The problem: conversations are richer than isolated facts

A long chat contains several kinds of information at once.

There are direct facts: *the user is moving to a new city*. There are emotional
turning points: *the character promised to help when the move becomes
overwhelming*. There are relationships: *the user trusts a colleague named
Mira*. And there are recurring objects and places that acquire meaning over
time.

Saving every line verbatim is not the same as remembering it well. Raw history
is large, repetitive, and full of small talk. A useful memory system needs to
compress conversation without flattening it.

This app uses a two-stage LLM pipeline:

1. **Summarization** turns a small slice of conversation into a durable memory.
2. **Graph extraction** turns that memory into relationships such as
   `Alex — trusts → Mira` or `Mira — works at → Glass Harbor`.

The summary preserves narrative meaning. The graph makes connections explicit.
Together, they give Layla richer material to work with in future conversations.

## What the user experiences

The interface is deliberately simple.

First, the user chooses one of their Layla characters. The app loads real
character cards and portraits from Layla rather than maintaining a separate
list.

Next, the user configures how that character's memories should be processed.
They can choose an available inference engine and edit two sets of prompts: one
for summarization and another for knowledge-graph extraction. Settings are
stored per character, because a meticulous detective and a whimsical fantasy
companion may benefit from very different definitions of “important.”

Finally, the user starts the ingest. The app moves through three visible
phases—reading, summarizing, and graphing. As entities are discovered, nodes
appear around the character's portrait and relationships connect them.

This animation is more than decoration. On-device inference can take time. A
responsive progress experience reassures the user that the app is doing real
work and makes a multi-step AI pipeline understandable without exposing its
internal machinery.

At the end, the user sees how many memories, entities, and links were created.
Running the app again does not blindly process everything from the beginning;
it looks for conversation that is newer than the latest saved memory.

## The important architectural idea: Layla is both source and destination

The mini-app does not run its own character database, memory service, or model
API in production. Layla already owns those capabilities.

The app creates one SDK client:

```ts
import { LaylaSDK } from "@layla-network/sdk";

const layla = new LaylaSDK();
```

Inside the Layla WebView, the SDK communicates with the native Layla host. It
does not require an API key, a base URL, or a cloud LLM endpoint. The host
provides character data, chat history, local inference, memory storage, and
private file storage through a high-level TypeScript API.

The data flow looks like this:

```text
Layla character and persona
          +
Layla chat sessions and history
          |
          v
Overlapping conversation windows
          |
          v
Layla completion: durable summary
          |
          v
Layla memory record
          |
          v
Layla completion: graph extraction
          |
          v
Updated memory with knowledge-graph JSON
```

That loop is the app's real power. It reads context from Layla, uses Layla's
active inference environment to transform it, and writes the result back into
Layla's long-term memory.

For mini-app creators, this suggests a useful design question:

> What can your app contribute back to the character after it finishes its
> task?

A journaling app could save emotional themes. A game could turn important
choices into memories. A travel planner could connect people, locations, and
preferences. A study companion could remember the topics a user struggles
with. The SDK makes these experiences part of the character's continuity
instead of isolated web pages.

## Step 1: meeting the user's characters

The app begins with `layla.characters.list()`. Character records use Character
Card V2 data, so the interface can display names, descriptions, personalities,
tags, and custom extensions.

The catalog is paginated rather than assuming the user has only a few
characters:

```ts
const page = await layla.characters.list(offset, 12, { signal });
```

Portraits are requested separately with
`layla.characters.getImage(character.id)`. The cards can render as soon as the
character page arrives, while images are hydrated in the background. If the
host has no separate portrait, the app falls back to an image embedded in the
character card.

This is a small but valuable UX pattern for mini-apps: load useful structure
first, then enrich it. A slow image should not block a user's entire character
list.

It also demonstrates why native character integration matters. The user does
not need to recreate a profile inside every mini-app. Their existing Layla
characters arrive with identity and context intact.

## Step 2: making prompts character-aware

A generic summarizer would miss an important part of the experience: the same
sentence can mean different things depending on who the character is and who
the user is to them.

Before inference begins, the app loads the character-specific persona:

```ts
const persona = await layla.personas.get(character.id, { signal });
```

It then makes six values available to both system prompts:

- the character's name;
- the user's name;
- the user's persona description;
- the full textual Character Card V2 data;
- the character description;
- the character personality.

Users can reference these values with templates such as `{{char}}`,
`{{persona}}`, and `{{personality}}`.

The default summary prompt asks the model to behave like an archivist of the
character's inner life—to preserve durable facts, feelings, relationships, and
turning points while ignoring small talk. The graph prompt asks it to identify
entities and supported relationships.

The full character card can be included as text, but the app deliberately
replaces any embedded portrait payload with a short placeholder. Base64 image
data may be megabytes long and has no value in a text prompt. This is an easy
optimization to overlook when working with rich character objects.

The larger lesson is to treat character and persona context as first-class
inputs. A mini-app feels native to Layla when it understands who is present,
not merely what button was pressed.

## Step 3: reading only the history that matters

Conversation history can become large, so the app first asks Layla for the
character's newest saved memory:

```ts
const [latestMemory] = await layla.memories.list(
  character.id,
  0,
  1,
  { signal },
);

const cutoff = latestMemory?.timestamp ?? 0;
```

That timestamp becomes an incremental cutoff. The app pages through chat
sessions with `layla.chat.getChatSessions()` and retrieves messages for each
eligible session with `layla.chat.getChatHistory()`.

Both APIs return newest-first data. The app stops once it reaches sessions or
messages that are no newer than the cutoff. It discards blank messages, sorts
the selected history into chronological order, and preserves session
boundaries.

This is a practical pattern for any mini-app that derives data from history:
do not repeatedly scan the user's entire archive if the output itself can act
as a watermark.

There is a trade-off. This app uses one newest-memory cutoff for the whole
character. A production workflow requiring perfect resumability might keep a
watermark for each session or maintain explicit job checkpoints. But the
simple timestamp approach is easy to understand and efficient for an
interactive utility.

## Step 4: preserving local context with overlapping windows

The app does not summarize one message at a time. It groups messages into
overlapping windows of three.

For a sequence `A B C D E`, it creates:

```text
A B C
  B C D
    C D E
```

Why overlap?

Because meaning often crosses message boundaries. A user's question may only
make sense beside the character's answer, and the emotional consequence may
arrive in the next turn. Three-message windows retain that local arc without
sending an entire session to the model.

Each window is formatted as a miniature transcript with speaker names. Its
timestamp is the newest message it contains, and its source session ID follows
it into the memory record.

This approach intentionally creates some repetition. The design favors
continuity over maximal compression. Other mini-apps could choose token-based
windows, larger conversational turns, topic segmentation, or a second
deduplication pass depending on their goals.

## Step 5: turning conversation into durable memory

Each window is sent to Layla using the SDK's OpenAI-shaped chat completion API:

```ts
const completion = await layla.chat.completions.create({
  messages: [
    { role: "system", content: summarySystemPrompt },
    { role: "user", content: `${rawText}\n\n${summaryInstruction}` },
  ],
  signal,
});

const summary = completion.choices[0]?.message.content.trim() ?? "";
```

The app uses a non-streaming completion because it needs one final artifact to
save. A conversational interface would usually benefit from
`layla.chat.completions.stream()`, but structured transformation pipelines can
be simpler when they wait for complete output.

The summary is saved immediately:

```ts
const [savedMemory] = await layla.memories.createOrUpdate([
  {
    id: 0,
    character_id: character.id,
    session_id: window.sessionId,
    rawText: window.rawText,
    timestamp: window.timestamp,
    summary,
    knowledgeGraphJSON: null,
  },
], { signal });
```

An ID of zero tells Layla to create a memory and return its assigned ID. Saving
at this point means completed summaries survive if a later model call fails.

The app then performs graph extraction and calls the same method again with the
positive returned ID. That updates the existing record with
`knowledgeGraphJSON` instead of creating a second memory.

This create-then-update pattern is useful beyond memory ingestion. It lets a
mini-app persist the essential result first and enrich it with more expensive
work afterward.

## Step 6: treating model output as untrusted input

The graph prompt asks for a clean JSON array:

```json
[
  {
    "subject": "Alex",
    "relationship": "trusts",
    "object": "Mira"
  }
]
```

In reality, small local models do not always return perfect JSON. They may add
a Markdown fence, use single quotes, miss a comma, choose `from` and `to`
instead of `subject` and `object`, or stop before the final bracket.

The app assumes this will happen.

Its defensive parser extracts likely JSON candidates, tries strict parsing,
repairs common syntax mistakes, reconciles fuzzy field names, coerces simple
types, and ranks multiple possible results against a schema. It accepts both
triple arrays and richer objects containing nodes and edges.

Common aliases are normalized:

- `subject`, `from`, or `source`;
- `relationship`, `relation`, or `label`;
- `object`, `to`, or `target`.

If the parser still cannot recover a graph, the raw model response is preserved
inside JSON instead of being silently thrown away.

This is one of the most reusable lessons in the project: **an LLM response is
input, not a guarantee**. Prompting for a format is helpful; validating,
repairing, and degrading gracefully is what makes the feature dependable.

## Step 7: designing for on-device time

The whole ingest is sequential. For each conversation window, the app makes a
summary completion and a graph completion, plus a create and an update in the
memory store.

Sequential processing is not the fastest theoretical implementation, but it is
a sensible choice for an on-device model. It avoids competing inference jobs,
keeps memory writes ordered, makes cancellation predictable, and lets the UI
show exactly which phase is active.

All long-running SDK calls share one `AbortSignal`. The cancel button aborts
the host requests and the animation delays, and `LaylaAbortError` is treated as
a normal user exit rather than a failure.

The visible progress bar uses weighted phases:

- reading: 12%;
- summarizing: 46%;
- graphing: 42%.

These weights represent the user's perception of the work rather than a claim
about exact timing. That distinction matters in AI interfaces: progress often
needs to communicate stages and momentum even when token-generation duration
cannot be predicted precisely.

## Per-character settings without another backend

The app remembers prompt and engine choices in a versioned `config.json` stored
through Layla's private-file API:

```ts
await layla.utils.saveFile(
  "config.json",
  encodedJson,
  false,
);
```

The file contains one configuration entry per character. Changes are
debounced, and saves are serialized through a promise queue because each write
is a read-modify-write of the shared file.

This is an elegant middle ground for mini-app state. The settings do not belong
on the public character card, but they also do not justify a remote database.
Private host storage keeps them close to the app and available inside Layla.

## Developing outside the Layla WebView

Real SDK requests require the bridge that Layla injects into its WebView. For
normal browser development, the SDK provides `installLaylaMock()`.

This project builds a demo host with sample characters, generated portraits,
mock sessions, and in-memory memories. The React feature code is unchanged: it
still calls `characters.list`, `getChatHistory`, `completions.create`, and
`memories.createOrUpdate` through the same SDK client.

For model output, the development mock forwards completions to a locally
running LM Studio OpenAI-compatible server. Production never uses that HTTP
path; inside Layla, inference goes through the host bridge.

This separation is worth copying:

- keep application code written against the SDK;
- install the mock before the first SDK request in development;
- inject realistic characters and history;
- swap only the host behavior, not the feature implementation.

It gives creators a fast browser workflow without slowly drifting away from the
real runtime contract.

## Packaging a mini-app for Layla

The app is built with React, TypeScript, and Vite. The
`vite-plugin-singlefile` plugin inlines the JavaScript and CSS into one
WebView-friendly `index.html`.

The production output also includes:

- `app.json`, which describes the app to Layla;
- a square icon;
- a background image.

These files sit at the root of the package. A self-contained mini-app uses
`index.html`; an externally hosted one can use an `index.url` file instead.

The important point is that a Layla mini-app is still a web app. You can use a
familiar front-end stack. Layla supplies the runtime bridge that lets the web
experience participate in the user's local AI environment.

## What I would build next

This project already suggests several extensions.

One is stronger job recovery. Because summaries are saved before graphing, an
interrupted run can leave useful summary-only memories behind. A future version
could detect those records and finish their graph enrichment before scanning
new history.

Another is smarter segmentation. Fixed three-message windows are transparent
and reliable, but a model-assisted topic boundary detector could create more
natural memory units.

A third is interactive review. Users could approve, edit, merge, or discard
memories before committing them. That would turn the pipeline from automatic
ingestion into collaborative memory curation.

And the graph itself could become a new mini-app surface: tap a person to see
related memories, explore how a relationship changed, or ask the character to
reflect on a cluster of connected events.

The SDK opens other directions too. The same character and memory context could
be combined with sentiment analysis, image generation, scheduled messages, or
text-to-speech. A memory about an upcoming event could schedule a check-in. A
recalled location could become an illustration. An emotional turning point
could shape how a line is spoken.

## Five lessons for Layla mini-app creators

This app is specialized, but its strongest ideas are general.

### 1. Build with the character, not around the character

Use the character card, portrait, and persona already present in Layla. The
less identity the user has to recreate, the more native the mini-app feels.

### 2. Close the loop

Do not stop at displaying an AI result. Consider whether the result should
become a memory, a character update, a scheduled message, a saved file, or
another durable contribution to the Layla experience.

### 3. Assume local inference takes time

Show phases, stream visible responses when appropriate, make structured jobs
cancelable, and give users feedback that explains what is happening.

### 4. Validate model output defensively

Even a clear JSON prompt needs parsing, normalization, and fallback behavior.
Reliability is built after the model responds.

### 5. Develop against the same abstraction you ship

Use the Layla SDK in both production and local development. Let the mock replace
the host, not your application's architecture.

## A mini-app can become part of the relationship

The most interesting thing about LLM-based Long-term Memory is not that it
summarizes text or draws a graph. It is that the result has somewhere meaningful
to go.

The character's history enters the app. Layla's local inference turns that
history into something more compact and connected. The app writes it back as
durable memory. The next conversation can begin with a little more continuity
than the last.

That is a compelling model for mini-apps: small, focused experiences that can
borrow the intelligence and context already present in Layla, perform a task
the main chat interface was not designed to perform, and return something that
makes the companion richer.

If you are thinking about building a Layla mini-app, start with one question:

**What should the character know, remember, create, or do after the user closes
your app?**

The answer may be the beginning of a much more personal kind of software.

---

### Suggested Medium metadata

**Subtitle:** How a React mini-app uses Layla's on-device SDK to turn chat
history into durable memories and a living knowledge graph.

**Topics:** Artificial Intelligence, Local LLM, React, TypeScript, AI
Companions

**Suggested pull quote:** “A mini-app does not have to be a separate toy living
beside an AI companion. It can contribute back to the companion's world.”

**Suggested inline images:**

1. `assets/1.jpg` after “What the user experiences.”
2. `assets/2.jpg` after “Making prompts character-aware.”
3. `assets/3.jpg` after “Turning conversation into durable memory.”
4. `assets/4.jpg` after “Designing for on-device time.”
