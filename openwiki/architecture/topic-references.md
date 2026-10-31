# Topic references

Account search and pasted topic references. There is no built-in tool. The user already names the topic, so both model-request builders load it while assembling the system role.

## Search

`TopicModel.searchAccountTopics` matches the signed-in user's topic titles and `user` / `assistant` message text. It is not `queryByKeyword`: that method stays limited to the current session or group, and a missing container matches only topics with both ids null.

Results are capped at 30 topics, ordered by `lastActivityAt`. `%`, `_`, and `\` in the query are escaped before `ILIKE`. A hit returns a short snippet, not the message. The page is `/search` (desktop sidebar; phone **More** menu).

## Parser

`parseTopicReferenceIds` in `src/helpers/topicReference.ts` reads user messages only. It accepts `tpc_` plus 12 letters or digits, including that id in a `topic` query parameter. Assistant and tool text is ignored. The current topic id is ignored. Duplicates collapse. At most 3 ids are kept, in first-seen order.

## What is loaded

`loadTopicReferenceBlock` (`src/server/services/topicReference/load.ts`) loads only topics owned by the same user. Main-thread `user` and `assistant` text is used. Thread replies are not.

- If that text fits 6,000 characters, it is included with role labels.
- Otherwise the topic's `historySummary` is used when present, then messages after `historySummaryLastMessageId` while they still fit.
- With no summary, a short head and tail are kept and the middle is marked omitted.
- The whole block is capped at 12,000 characters.
- An unknown or unowned id becomes one line that the topic was not found.

The block tells the model the text is background data and that the current conversation takes precedence. It is not written into the new topic.

## Where it is injected

The block is appended to the system role, so `fixedContextOverheadText` counts it and the history window shrinks to fit.

- Durable sends: `buildConversationChatPayload` scans the full transcript, including turns already covered by the current topic's compaction cursor. `excludeTopicId` is `operation.topicId` at each call site in `execute.ts`.
- Deferred in-tab sends: `ChatService.createAssistantMessage` resolves the same block through `topic.resolveTopicReferences` before `contextEngineering`.
- The token estimate hook loads the block when the open messages or the composer draft contain ids.

Asking for a topic in plain language, without an id or URL, does not search history.
