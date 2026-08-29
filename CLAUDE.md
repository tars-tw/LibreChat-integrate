# LibreChat

## Project Overview

LibreChat is a monorepo with the following key workspaces:

| Workspace | Language | Side | Dependency | Purpose |
|---|---|---|---|---|
| `/api` | JS (legacy) | Backend | `packages/api`, `packages/data-schemas`, `packages/data-provider`, `@librechat/agents` | Express server — minimize changes here |
| `/packages/api` | **TypeScript** | Backend | `packages/data-schemas`, `packages/data-provider` | New backend code lives here (TS only, consumed by `/api`) |
| `/packages/data-schemas` | TypeScript | Backend | `packages/data-provider` | Database models/schemas, shareable across backend projects |
| `/packages/data-provider` | TypeScript | Shared | — | Shared API types, endpoints, data-service — used by both frontend and backend |
| `/client` | TypeScript/React | Frontend | `packages/data-provider`, `packages/client` | Frontend SPA |
| `/packages/client` | TypeScript | Frontend | `packages/data-provider` | Shared frontend utilities |

The source code for `@librechat/agents` (major backend dependency, same team) lives at
<https://github.com/danny-avila/agents>.

---

## Integration with pwc_tars

This LibreChat instance serves as the **product shell (UI/UX layer)** for the `pwc_tars` platform at `/Users/liaopoyu/Downloads/pwc_tars`. pwc_tars already provides the heavy backend capabilities — LLM services, knowledge base, SQL agent — and LibreChat is the polished frontend wrapped around them.

- **pwc_tars is the source of truth** for authentication and user/account data. LibreChat integrates with it rather than reimplementing those capabilities.
- **pwc_tars tech stack**: Flask (Python) + PostgreSQL (SQLAlchemy) + JWT. Its auth entrypoint is `POST /api/auth/login`, which logs in by **`username`** (not email).
- **Integration target**: all future integrations connect to pwc_tars. Before building one, read the corresponding pwc_tars Flask route (`/Users/liaopoyu/Downloads/pwc_tars/backend/apps/routers/...`) and model (`.../apps/models/...`).
- **Integration pattern**: keep the LibreChat-side surface a thin JS wrapper in `/api` that calls into TypeScript logic in `/packages/api`. Do **not** swap LibreChat's MongoDB user store for PostgreSQL — every downstream feature (conversations, files, agents, balances, permissions) keys off the MongoDB `User._id`. Instead, verify against pwc_tars and provision a linked local "shadow" user.
- **Reference implementation — login** (the first integration): credentials are verified against pwc_tars (`packages/api/src/auth/tars.ts` → Flask `POST /api/auth/login`); on success a local MongoDB user is provisioned/synced (`provider: 'tars'`, linked via `tarsId`), then LibreChat issues its own JWT + refresh tokens. Mirrors the existing LDAP flow. Gated by the `TARS_AUTH_URL` env var. Key files: `api/strategies/tarsStrategy.js`, `api/server/middleware/requireTarsAuth.js`.

### LLM Gateway (`pwc_tars → LibreChat`, the one reverse-direction integration)

Most integrations are `LibreChat → pwc_tars` (auth, knowledge-base/domain/prompt CRUD, conversation mirror — all via `tarsFetch` in `packages/api/src/tars/*`, gated by `TARS_AUTH_URL`). The **LLM gateway is the opposite**: pwc_tars borrows LibreChat's models. LibreChat is a *passive* OpenAI-compatible endpoint here — it just serves whoever calls it; the decision to route through it lives entirely on the pwc_tars side.

- **Endpoint**: `POST /api/agents/v1m/chat/completions` (`v1m` = model passthrough, distinct from the agent endpoint `/api/agents/v1` where `model` is an agent_id). Here `model` is a **real `<provider>/<model>`** pair, e.g. `openAI/gpt-5.4-mini`, `anthropic/claude-...`, `google/gemini-...` (LibreChat has no model→provider reverse lookup, so the prefix is required). Standard OpenAI chat-completions body (`messages`, `stream`, `temperature`, ...). No agent pipeline — a bare ephemeral agent (no tools, no system prompt).
- **How a caller invokes it** (e.g. a plain OpenAI client / LangChain `ChatOpenAI`): point `base_url` at `http://<host>:3080/api/agents/v1m` and set `model` to `<provider>/<model>`. Auth (LibreChat `.env`, `# LLM Gateway` block): `LLM_GATEWAY_ALLOW_UNAUTHENTICATED=true` (closed internal net; no key), OR `LLM_GATEWAY_SERVICE_KEY=<secret>` sent as `Authorization: Bearer <secret>`, else per-user remote-agent API keys.
- **LibreChat key files**: `packages/api/src/agents/passthrough.ts` (parse `<provider>/<model>` + build the bare ephemeral agent via `loadEphemeralAgent`), `api/server/controllers/agents/passthrough.js` (thin wrapper), `api/server/routes/agents/passthrough.js` (mounted at `/v1m`), `api/server/routes/agents/middleware.js` (`gatewayServiceAuth`). Streaming/aggregation reuses `createAgentChatCompletion` in `packages/api/src/agents/openai/service.ts`.
- **pwc_tars side** (for context — lives in the pwc_tars repo): routing is **per-request, not global**. The Langflow `TarsAgent` component sends header `X-Use-Librechat-Gateway: true` → the `langflow-service` route calls `llm_factory.mark_gateway_request` → `LLMManager.__init__` (request thread) swaps `api_endpoint` to the gateway and prefixes the model. Gated by sys_config `FLAG_USE_LIBRECHAT_LLM` (master switch) + `KEY_LIBRECHAT_BASE_URL`. pwc_tars's own native services (message route) never send the header, so they stay direct-to-provider.
- **Caveat**: pwc_tars probes the gateway over IPv4; LibreChat's default `HOST=localhost` binds IPv6-only (`::1`) on macOS → `ECONNREFUSED`. Set `HOST=127.0.0.1` (same-host) or `0.0.0.0` (cross-host).
- **Full docs**: `docs/TARS_INTEGRATION.md` §6.4.

### TARS MCP Gateway (pwc_tars MCP → LibreChat; pwc_tars is the sole MCP management surface)

pwc_tars's MCP `openapi` (Swagger import), `custom_api`, and `external` (real MCP servers over stdio / streamable_http, executed by pwc_tars) servers surface in LibreChat's MCP tool system via **per-server loopback MCP servers**: `POST /api/tars/mcp/:serverId` hosts a stateless streamable-http MCP server (real `@modelcontextprotocol/sdk` server) whose `tools/list`/`tools/call` proxy to pwc_tars's `/api/mcp` REST API — pwc_tars stays the source of truth (definitions, domain permissions, per-user toggles/credentials, `mcp_logs` audit); only `builtin` is not proxied. When `TARS_AUTH_URL` is set, `withTarsMcpConfig` (now async) fetches the pwc_tars server list at base-config load and injects **one `mcpConfig` entry per enabled server, named `tars_<code>`** (helper `tarsMcpServerName`/`isTarsMcpServerName` in data-provider; name is a `normalizeServerName` fixed point), so each server is its own toggle in the chat dropdown/agent tools and LibreChat's entire MCP pipeline works with zero changes. pwc_tars down at boot → nothing injected + one-shot 60s retry (`tarsMcpInjectionFailed`); every LibreChat-proxied admin mutation (create/update/delete/sync, tool toggle, domain save) calls `invalidateTarsMcpToolsCache()` + `invalidateConfigCaches()` so entries refresh immediately. The legacy aggregate `POST /api/tars/mcp` (single `tars` entry, `<code>__<tool>` names) remains for YAML-pinned setups (deprecated). Per-user scoping via `X-Tars-User-Id: {{LIBRECHAT_USER_ID}}` header → `User.tarsId` → pwc_tars `GET /available-tools?user_id=` (full permission stack pwc_tars-side: domain grants, `mcp_tool_ids` whitelists, `sys_user_mcp` opt-in toggles; admin role_id=1 bypasses domain whitelists but own toggles still apply); unlinked users fail closed. Per-server tool names are **unprefixed** (final: `<tool>_mcp_tars_<code>`); `TARS_MCP_MAX_TOOLS` (default 100) applies per server. Route auth is a gateway key (HMAC of `JWT_SECRET`, override `TARS_MCP_GATEWAY_KEY`), not JWT. **When TARS is enabled (`startupConfig.tarsMcpEnabled`), the native MCP management UI is hidden** (side-panel add/list, agent-marketplace "create MCP") — librechat.yaml servers (langflow) keep working — and the chat dropdown filters `tars_*` entries to those the user enabled (`useMCPServerManager` + `useTarsMcpUserSettingsQuery`; enforcement stays server-side). Admin page `/mcp-settings` now has three tabs: **Servers** (CRUD for all three types incl. external transport editor stdio/streamable_http, priority/tags, per-tool enable via `PUT /api/tars/mcp/admin/tools/:toolId`, parse-openapi, test/sync), **Permissions** (domain↔server→tool whitelist tree → `POST /api/tars/mcp/admin/domains/save`, full-overwrite), **Logs** (`GET /api/tars/mcp/admin/logs`). Per-user "TARS Tools" dialog unchanged (`/api/tars/mcp/user/*`). Frontend: `client/src/components/McpSettings/` (`McpSettingsView`, `McpServerModal`, `McpServerToolsPanel`, `McpPermissionsTab`, `McpLogsTab`), `client/src/components/Tars/McpToolsDialog.tsx`, hooks in `client/src/data-provider/Tars/`. Key files: `packages/api/src/tars/mcp/{client,server,config,admin,user}.ts`, `api/server/routes/tars/mcp.js`, injection in `api/server/services/Config/app.js`. Full docs: `docs/TARS_INTEGRATION.md` §6.6.

### TARS SQL Agent (LibreChat → pwc_tars, a native LibreChat tool)

pwc_tars's SQL agent is a **first-class LibreChat tool**, not an MCP server: `Tools.sql_agent` / `AgentCapabilities.sql_agent` / `PermissionTypes.SQL_AGENT` / `ephemeralAgent.sql_agent`, gated by `interface.sqlAgent` and constructed in `handleTools.js` beside `web_search` and `execute_code`. It shows in the chat tools menu as 「資料庫查詢」 (`Database` icon) with its own composer badge and pin, exactly like web search. Available whenever `TARS_AUTH_URL` is set.

One tool, `sql_agent({ question, knowledge_base_id? })` → `POST /api/langflow-service/sql`. Its reachable databases are resolved **per request** and written into the tool's own description, which removes the usual list-then-query round trip: a brain binding one database needs no `knowledge_base_id` at all, and a brain binding several advertises them by name. Scoping mirrors pwc_tars's own chat path (`message/routes.py` resolves a database from the domain's `knowledge_base_ids`, not from everything the user can see): the candidate set is `has_sql_database` on `GET /api/knowledge_base/prepare_data` intersected with the active 專用腦's knowledge bases, and the same set authorizes the call. pwc_tars owns the whole text-to-SQL loop (schema prompt from the KB↔database binding's `llm_table_info`, read-only guard, row formatting); LibreChat only bounds which knowledge base may be asked (fail-closed for unlinked accounts) and relays the answer, so the markdown table plus the SQL used flows back into the normal agent loop and composes with every other tool.

`sql_agent` costs **two** LLM calls: the chat model decides to call the tool, then pwc_tars's nested loop writes and runs the SQL. The nested loop runs on the **same model the chat turn is on** — being a native tool, `handleTools.js` reads `agent.model` and `req.body.domain_id` straight off the request, so no side channel is needed. The model is matched against pwc_tars `model_profile` names — the same whitelist `ModelSelectorContext` filters the picker by, so the picker can only produce a match — and unmatched models (saved agents and assistants bypass that filter; it also fails open while pwc_tars is down) fall back to pwc_tars's default sys_model rather than letting pwc_tars 400 the call — there is no LibreChat-side model pin, both ends of that decision are pwc_tars's. Every call logs `[tars-sql] kb=… requested=… used=… tokens=… via=…` at debug level, where `used` is what pwc_tars reports it actually ran.

The pwc_tars service key is read from the `KEY_LANGFLOW_API_KEY` sys_config row — pwc_tars validates the whole `/api/langflow-service` blueprint against that single row, so there is no LibreChat-side override. The nested loop's own LLM **always** goes back through LibreChat's gateway (`X-Use-Librechat-Gateway: true` plus `X-Librechat-User-Id`, so the quota lands on the acting user) — pwc_tars hosts the tools but carries no models of its own; its `FLAG_USE_LIBRECHAT_LLM` sys_config switch is the only remaining gate. Other env: `TARS_SQL_AGENT_TIMEOUT_MS`. Key files: `packages/api/src/tars/sql/{client,tool}.ts`, construction in `api/app/clients/tools/util/handleTools.js`, capability gate in `api/server/services/ToolService.js`, equipping in `packages/api/src/agents/{load,added}.ts`, UI in `client/src/components/Chat/Input/{SqlAgent,ToolsDropdown}.tsx` + `BadgeRowContext`. **No pwc_tars-side change is required** — `/api/langflow-service/sql` already exists for Langflow. Not yet wired into the saved-agent builder catalog (`client/src/components/SidePanel/Agents/Tools/items/`), so saved agents can run the tool but cannot pick it in that UI.

---

### TARS Long-term Memory + langflow tools (chart / data / table-task)

When `TARS_AUTH_URL` is set (`startupConfig.tarsMemoryEnabled`), **chat uploads bypass `/api/files` entirely**: the composer paperclip and drag-drop are replaced by a single path into pwc_tars's 長期記憶區 (`TarsMemoryAttach` swap in `AttachFileChat.tsx`, shared hook `client/src/hooks/Files/useTarsMemoryUpload.ts`), and the 附加檔案 side panel becomes a memory manager (`client/src/components/SidePanel/TarsMemory/`, swap in `useSideNavLinks.ts`). Semantics mirror pwc_tars exactly: files live on the **pwc_tars conversation** (`memory_document`, linked via the mirror's `tarsConversationId`), `status=1` rows apply to **every** turn — non-structured files' parsed `summary` is injected into the system prompt via `toolContextMap['tars_memory']`, csv/xlsx/xls instead auto-equip the data tools. Per turn, `primeTarsMemory` (`packages/api/src/tars/memory/prime.ts`, three guarded hook points in `packages/api/src/agents/initialize.ts`) fetches `get_memory_data` once in parallel with init (10s cap, fail-soft), stashes a WeakMap snapshot reused by the tool factories, filters rows to `created_by === User.tarsId` (pwc_tars's memory routes don't authorize — LibreChat closes that gap; `update_status`/`delete` are ownership-prechecked in `api/server/routes/tars/memory.js`). New-chat uploads have no conversation yet: pwc_tars creates one, the id rides conversation state → `compactAgentsBaseSchema` pick list (the send-path schema; `agentsBaseSchema` carries it for settings parsing) → first send, where `request.js` adopts it only after a pending-registry claim (`memory/pending.ts`) or document-ownership re-verification. Trade-off: images no longer reach the model as vision input, only their VLM-parsed text. Routes: `/api/tars/memory/{upload,list/:id,documents/:id/...}`.

Three tools call `/api/langflow-service/{chart,data,table-task}` through the shared client `packages/api/src/tars/langflow/client.ts` (service key = sys_config `KEY_LANGFLOW_API_KEY`, no env override — pwc_tars owns the value; model matching same as sql_agent, no pin; the gateway headers are always sent, as for sql_agent — `sql/client.ts` was refactored onto this client):
- **`Tools.chart_agent`** (「產生圖表」) — full sql_agent-style wiring: `AgentCapabilities.chart_agent` (must be listed in librechat.yaml capabilities), `PermissionTypes.CHART_AGENT`, `interface.chartAgent`, `TEphemeralAgent.chart_agent`, badge `ChartAgent.tsx` + pin + ToolsDropdown (gated on `startupConfig.tarsAuth`). pwc_tars renders a PNG under its unauthenticated `/static`; the answer embeds `![chart](url)` directly — pwc_tars sys_config `HOST` must be browser-reachable or images render broken.
- **`Tools.data_query` / `Tools.table_task`** — **auto-equipped, never user-toggled**: when the snapshot has active structured docs, `initialize.ts` appends them to `agent.tools` before `loadTools` (ephemeral AND saved agents), the structured-file list goes in as `toolContextMap['tars_memory_data']`, and ToolService gates them on `isTarsConfigured()` only. Both send `document_ids` (defaulting to all attached; requested ids outside the snapshot are dropped). `table_task` additionally resolves `knowledge_base_ids` from the active 專用腦 (like `buildTarsSqlContext` but without the `has_sql_database` filter), refuses cleanly with no domain/no KBs, runs up to ~29min (`TARS_TABLE_TASK_TIMEOUT_MS` default 1_740_000 — watch reverse-proxy idle timeouts), and appends the xlsx download link.

Key files: `packages/api/src/tars/{memory,langflow}/`, registry entries in `packages/api/src/tools/registry/definitions.ts`, dispatch in `handleTools.js`, gates in `ToolService.js`. **No pwc_tars-side change was required.** Full docs: `docs/TARS_INTEGRATION.md` §6.7.

## Workspace Boundaries

- **All new backend code must be TypeScript** in `/packages/api`.
- Keep `/api` changes to the absolute minimum (thin JS wrappers calling into `/packages/api`).
- Database-specific shared logic goes in `/packages/data-schemas`.
- Frontend/backend shared API logic (endpoints, types, data-service) goes in `/packages/data-provider`.
- Build data-provider from project root: `npm run build:data-provider`.

---

## Git Workflow

- **Never `git commit` or `git push` on your own.** Do not commit or push unless the user explicitly asks for that action in the current request. Staging changes for review is fine; creating a commit or pushing is not.
- Standing approval does not carry over — a previous "go ahead and commit" applies only to that one request, never to later changes.
- Leave finished work as **uncommitted changes in the working tree** and tell the user what changed, so they decide when and how to commit.
- **Never `git push` / `git push --force` / `git push --tags`** to any remote under any circumstances.
- Other local git operations (`add`, `stash`, `branch`, `checkout`, `reset`, local `merge`/`rebase`) are allowed when they serve the task.

### Rebasing onto upstream (`main`)

`main` mirrors upstream LibreChat; `release/26P3_dev` is this fork's trunk and is
**replayed on top of it, never merged** — the fork stays a readable stack of TARS
commits. The operation recurs every few weeks (see the `backup/26P3_dev-pre-rebase-*`
branches), so it is worth doing the same way every time:

```bash
git fetch origin --prune && git branch backup/26P3_dev-pre-rebase-$(date +%Y%m%d) && git rebase main
```

`rerere` is enabled in this clone with a large resolution cache, so most recurring
conflicts replay themselves; only genuinely new ones stop the rebase.

**Conflict policy: TARS wins on intent, upstream wins on mechanism.** Take upstream's
rewritten code and re-attach our TARS hook to it — never resolve by deleting upstream
logic to keep our older copy of the same function. The exception is our own product
surface: TARS features, our design/theming, and our frontend components are
authoritative, so where upstream restyles or re-lays-out a screen we own, keep ours.

The same handful of files conflict nearly every round, and all of them resolve by
**keeping both sides**:

| File | What conflicts | Resolution |
|---|---|---|
| `packages/api/src/auth/index.ts`, `packages/api/src/agents/index.ts` | export barrels — upstream appends a line where we appended `./tars` / `./passthrough` | keep both exports |
| `packages/data-schemas/src/schema/convo.ts` + `types/convo.ts` | `tarsConversationId` lands next to upstream's new conversation fields | keep both blocks |
| `api/server/controllers/agents/request.js` | the `require('@librechat/api')` destructure | upstream's list **plus** our TARS names; drop the duplicate `saveConvo` |
| `api/server/controllers/auth/LogoutController.js` | import line | fold `notifyTarsLogout` into upstream's `@librechat/api` require |
| `client/src/components/Chat/Input/ChatForm.tsx` | import block + `useSubmitMessage()` destructure | upstream's imports, our `insertPrompt` and `Disclaimer` |
| `.github/workflows/static-checks.yml`, `package.json` | our fork deletes the `paths:` trigger and the i18n + depcheck steps | re-apply those deletions **onto upstream's new file**, never restore our whole old copy |

Upstream dependency bumps ride along with the rebase (this last round:
`@librechat/agents` 3.7.1 → 3.7.8, `axios` → 1.20, new `helmet` and
`express-rate-limit` in `packages/api`). `node_modules` is stale until you sync it,
and `packages/api` will not typecheck before then — **`npm run smart-reinstall` is
part of the rebase, not an optional follow-up.**

Then verify in this order, because each step feeds the next:

```bash
npm run build:data-provider && npm run build:data-schemas && npm run build:api
```

A stale `data-provider/dist` makes `data-schemas` report phantom "property does not
exist" errors — build before believing any typecheck. Then the four `tsc --noEmit`
projects (see "Code Style Check"), then `node scripts/static-checks.mts --against main`,
then the TARS suites:

```bash
cd packages/api && npx jest src/tars src/auth/tars src/agents/passthrough
```

```bash
cd api && npx jest strategies/tarsStrategy
```

Finally, confirm the integration seams survived the auto-merges — textual success is
not semantic success. The load-bearing ones: `primeTarsMemory` in
`packages/api/src/agents/initialize.ts`, the TARS tool gates in
`api/server/services/ToolService.js`, the tool construction in `handleTools.js`,
`mirrorChatToTars` / `claimPendingTarsConversation` in `agents/request.js`,
`withTarsMcpConfig` in `api/server/services/Config/app.js`, and on the frontend
`TarsMemoryAttach`, `TarsMemoryPanel`, `TarsPromptsButton`.

---

## Code Style

### Naming and File Organization

- **Single-word file names** whenever possible (e.g., `permissions.ts`, `capabilities.ts`, `service.ts`).
- When multiple words are needed, prefer grouping related modules under a **single-word directory** rather than using multi-word file names (e.g., `admin/capabilities.ts` not `adminCapabilities.ts`).
- The directory already provides context — `app/service.ts` not `app/appConfigService.ts`.

### Structure and Clarity

- **Never-nesting**: early returns, flat code, minimal indentation. Break complex operations into well-named helpers.
- **Functional first**: pure functions, immutable data, `map`/`filter`/`reduce` over imperative loops. Only reach for OOP when it clearly improves domain modeling or state encapsulation.
- **No dynamic imports** unless absolutely necessary.

### DRY

- Extract repeated logic into utility functions.
- Reusable hooks / higher-order components for UI patterns.
- Parameterized helpers instead of near-duplicate functions.
- Constants for repeated values; configuration objects over duplicated init code.
- Shared validators, centralized error handling, single source of truth for business rules.
- Shared typing system with interfaces/types extending common base definitions.
- Abstraction layers for external API interactions.

### Iteration and Performance

- **Minimize looping** — especially over shared data structures like message arrays, which are iterated frequently throughout the codebase. Every additional pass adds up at scale.
- Consolidate sequential O(n) operations into a single pass whenever possible; never loop over the same collection twice if the work can be combined.
- Choose data structures that reduce the need to iterate (e.g., `Map`/`Set` for lookups instead of `Array.find`/`Array.includes`).
- Avoid unnecessary object creation; consider space-time tradeoffs.
- Prevent memory leaks: careful with closures, dispose resources/event listeners, no circular references.

### Backend Database Performance

- On request startup and first page load paths, watch for serial database reads.
  Multiple round trips to MongoDB can add significant latency when the database
  is far from the app server.
- Prefer passing already-loaded request/user/config data through helper
  functions instead of re-reading the same user, role, tenant, or principal data.
- When two reads are independent, start them in parallel and gate the response
  on the authorization or validation result before returning data.
- Keep authorization, permission, and tenant checks semantically identical when
  parallelizing reads. Speculative reads must remain scoped to the authenticated
  user or tenant and must not write to the response before validation succeeds.

### Type Safety

- **Never use `any`**. Explicit types for all parameters, return values, and variables.
- **Limit `unknown`** — avoid `unknown`, `Record<string, unknown>`, and `as unknown as T` assertions. A `Record<string, unknown>` almost always signals a missing explicit type definition.
- **Don't duplicate types** — before defining a new type, check whether it already exists in the project (especially `packages/data-provider`). Reuse and extend existing types rather than creating redundant definitions.
- Use union types, generics, and interfaces appropriately.
- All TypeScript and ESLint warnings/errors must be addressed — do not leave unresolved diagnostics.

### Comments and Documentation

- Write self-documenting code; no inline comments narrating what code does.
- JSDoc only for complex/non-obvious logic or intellisense on public APIs.
- Single-line JSDoc for brief docs, multi-line for complex cases.
- Avoid standalone `//` comments unless absolutely necessary.

### Import Order

Imports are organized into three sections:

1. **Package imports** — sorted shortest to longest line length (`react` always first).
2. **`import type` imports** — sorted longest to shortest (package types first, then local types; length resets between sub-groups).
3. **Local/project imports** — sorted longest to shortest.

Multi-line imports count total character length across all lines. Consolidate value imports from the same module. Always use standalone `import type { ... }` — never inline `type` inside value imports.

### JS/TS Loop Preferences

- **Limit looping as much as possible.** Prefer single-pass transformations and avoid re-iterating the same data.
- `for (let i = 0; ...)` for performance-critical or index-dependent operations.
- `for...of` for simple array iteration.
- `for...in` only for object property enumeration.

---

## Frontend Rules (`client/src/**/*`)

### Localization

- All user-facing text must use `useLocalize()`.
- Every new or changed key must be written to **both** `client/src/locales/en/translation.json` and `client/src/locales/zh-Hant/translation.json` in the same change. Traditional Chinese is the product's primary display language and is maintained by hand here; leaving it out ships an English string to users. All other languages are automated externally — do not edit them.
- Match the Traditional Chinese wording pwc_tars already uses (專用腦, 使用者群組, 供應商, 額度, 配額, 專案 …) rather than translating the English literally; check the existing `com_ui_tars_*` entries in `zh-Hant` for the established term before inventing one.
- Insert keys in their sorted position and never reorder or reformat the surrounding entries — the locale files are not fully sorted, so rewriting them produces a diff that buries the real change.
- Semantic key prefixes: `com_ui_`, `com_assistants_`, etc.
- To find gaps: compare the two files' key sets (e.g. every `com_ui_tars_*` key present in `en` must exist in `zh-Hant`).

### Components

- TypeScript for all React components with proper type imports.
- Semantic HTML with ARIA labels (`role`, `aria-label`) for accessibility.
- Group related components in feature directories (e.g., `SidePanel/Memories/`).
- Use index files for clean exports.

### Theming and styling

- **Compose before styling.** Search `@librechat/client` for an existing primitive, semantic
  variant, or composition before adding feature-local classes or CSS.
- **Use semantic roles.** Colors and shared appearance values must come from the semantic
  Tailwind/theme roles. Do not add raw palette utilities, hard-coded hex/RGB/HSL colors, or
  light/dark-specific values in feature components.
- **Deepen the system when the need is reusable.** Add a focused variant to a shared primitive or
  extend the canonical, versioned theme-token registry when multiple screens should share the
  same design decision. Do not create shallow local wrappers that merely relocate class strings.
- **Themes are data, not arbitrary CSS.** Theme definitions may select semantic colors and shared
  appearance roles. They must not contain selectors, arbitrary CSS, application behavior, or
  alternate feature layouts. Preserve existing environment and stored-theme compatibility when
  changing the theme engine.
- **Keep layout and behavior local.** Feature structure, responsive layout, state-driven
  transitions, and specialized visualization may remain feature-owned. Expose a theme role only
  when it represents a stable, reusable appearance decision; do not turn every measurement into a
  global token.
- **Treat custom CSS as an exception.** Use it only when shared primitives and semantic utilities
  cannot express the requirement. Keep it narrowly scoped, consume theme variables where
  applicable, support light/dark and reduced motion, and add a brief code or PR explanation of why
  the exception is necessary.
- **Preserve defaults and prove variability.** New theme-aware variants must reproduce the current
  default appearance unless a redesign is explicitly requested. Test semantic-token use and, when
  extending theme capabilities, include a deliberately different reference theme to prove that
  components adapt without feature-specific overrides.

### Data Management

- Feature hooks: `client/src/data-provider/[Feature]/queries.ts` → `[Feature]/index.ts` → `client/src/data-provider/index.ts`.
- React Query (`@tanstack/react-query`) for all API interactions; proper query invalidation on mutations.
- QueryKeys and MutationKeys in `packages/data-provider/src/keys.ts`.

### Client State Ownership

The client is migrating from Recoil to Jotai. Convert the areas you touch rather than
migrating wholesale, and split the work by who owns the state:

- **Feature-owned state** — atoms a single feature both writes and reads. Convert these to
  Jotai as you touch them, and keep them inside the feature.
- **App-global state** — preferences and shell state a feature merely consumes
  (`maximizeChatSpace`, `showScrollButton`, `enterToSend`, artifact visibility). A feature
  that could plausibly be extracted must not reach into `~/store` for these; accept them
  through props or a small context the host supplies.

Passing app-global state in — rather than reaching for it — is what lets a feature move to
its own workspace later without a rewrite, and it keeps the Jotai conversion scoped to the
state a feature actually owns instead of dragging the global migration forward early.

### Data-Provider Integration

- Endpoints: `packages/data-provider/src/api-endpoints.ts`
- Data service: `packages/data-provider/src/data-service.ts`
- Types: `packages/data-provider/src/types/queries.ts`
- Use `encodeURIComponent` for dynamic URL parameters.

### Performance

- Prioritize memory and speed efficiency at scale.
- Cursor pagination for large datasets.
- Proper dependency arrays to avoid unnecessary re-renders.
- Leverage React Query caching and background refetching.

---

## Backend Rules (`api/**`, `packages/api/**`)

### Auth cache invalidation

When adding or changing code that mutates user documents, invalidate the auth user document cache
for the affected users. This covers single-user updates as well as bulk role and user mutations.
Without it, OpenID JWT request burst caching can serve a stale `req.user` until its TTL expires.

---

## Development Commands

| Command | Purpose |
|---|---|
| `npm run smart-reinstall` | Install deps (if lockfile changed) + build via Turborepo |
| `npm run reinstall` | Clean install — wipe `node_modules` and reinstall from scratch |
| `npm run backend` | Start the backend server |
| `npm run backend:dev` | Start backend with file watching (development) |
| `npm run build` | Build all compiled code via Turborepo (parallel, cached) |
| `npm run frontend` | Build all compiled code sequentially (legacy fallback) |
| `npm run frontend:dev` | Start frontend dev server with HMR (port 3090, requires backend running) |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after changes |
| `npm run static-checks` | Run the CI static-check job locally, scoped to the staged diff |

- Node.js: v24.16.0
- Database: MongoDB
- Backend runs on `http://localhost:3080/`; frontend dev server on `http://localhost:3090/`

### Rebuild / Restart After Changing Code

**The `packages/*` workspaces compile to `dist/` and are consumed by `/api` and `/client`. `nodemon` (`backend:dev`) only watches `/api` — it does NOT rebuild packages.** So a change only takes effect after the right rebuild:

| Changed area | What to run | Notes |
|---|---|---|
| `/api` (backend JS) | nothing if on `npm run backend:dev` (auto-restart); else Ctrl+C + `npm run backend` | |
| `/client` (React) | nothing if on `npm run frontend:dev` (HMR, port 3090); for 3080 prod build re-run `cd client && npm run build` | |
| `packages/data-provider` | `npm run build:data-provider`, then restart backend | shared types/endpoints |
| `packages/data-schemas` | `npm run build:data-schemas`, then restart backend | DB schema/types |
| `packages/api` | `npm run build:api`, then restart backend | TS backend logic |
| Multiple / unsure | `npm run frontend` (builds all packages + client), then `npm run backend` | full rebuild |

Recommended dev setup: two terminals — `npm run backend:dev` (terminal A) and `npm run frontend:dev` (terminal B). Manually run the matching `build:*` only when touching `packages/*`. After changes, also run the relevant Jest tests and `npx eslint <changed files>` (zero warnings required).

> **Working agreement:** whenever code is changed, clearly explain to the user how to rebuild/restart and launch it — which `build:*`/restart command applies to the area touched, plus any env vars or services needed to see the change.

---

## Testing

- Framework: **Jest**, run per-workspace.
- Run tests from their workspace directory: `cd api && npx jest <pattern>`, `cd packages/api && npx jest <pattern>`, etc.
- Frontend tests: `__tests__` directories alongside components; use `test/layout-test-utils` for rendering.
- Cover loading, success, and error states for UI/data flows.

### Typechecking

- **A green build is not a typecheck.** `packages/api`, `packages/client` and `packages/data-schemas`
  build with `tsdown` alone, which emits without checking types. Only `packages/data-provider` runs
  `tsc` as part of its build.
- Run `npx tsc --noEmit` in the workspace you changed before calling it done. `client` also exposes
  it as `npm run typecheck`.
- `packages/client/tsconfig.json` excludes `*.spec.ts(x)` and `*.test.ts(x)`, so test files there are
  never typechecked — a type error in a spec surfaces only when the test runs.
- `npm run static-checks` runs the Static Checks CI job locally against your staged files;
  `npm run static-checks -- --against origin/dev` reproduces what CI sees for a pull request, and
  `npm run static-checks:full` adds the slow gates (TypeScript, config migration tests, unused i18n
  keys, unused npm packages).
### Live LLM / chat testing

- When exercising real chat / LLM flows (manual or end-to-end, e.g. verifying the pwc_tars conversation mirror), **only use the `gpt-5.4-mini` model**. Do not send live requests with any other model.

### Philosophy

- **Real logic over mocks.** Exercise actual code paths with real dependencies. Mocking is a last resort.
- **Spies over mocks.** Assert that real functions are called with expected arguments and frequency without replacing underlying logic.
- **MongoDB**: use `mongodb-memory-server` for a real in-memory MongoDB instance. Test actual queries and schema validation, not mocked DB calls.
- **MCP**: use real `@modelcontextprotocol/sdk` exports for servers, transports, and tool definitions. Mirror real scenarios, don't stub SDK internals.
- Only mock what you cannot control: external HTTP APIs, rate-limited services, non-deterministic system calls.
- Heavy mocking is a code smell, not a testing strategy.

---

## Formatting

Fix all formatting lint errors (trailing spaces, tabs, newlines, indentation) using auto-fix when available. All TypeScript/ESLint warnings and errors **must** be resolved.

---

## Code Style Check — mandatory before every PR

CI (`.github/workflows/static-checks.yml`) blocks a PR on **ESLint**, **Prettier**,
and **import sorting**, each evaluated against the files your branch changed
relative to the PR base. These are not advisory. Run them locally before pushing —
never discover them from a red CI run.

### The one-command path

`scripts/static-checks.mts` is a local mirror of that CI job: it derives the changed
file list itself and runs the same per-file checks plus the path-gated tree-wide ones.
Prefer it — it cannot make the scoping mistake the manual commands can:

```bash
node scripts/static-checks.mts --against release/26P3_dev
```

`npm run static-checks` scopes to the staged diff (what the pre-commit hook runs);
`npm run static-checks:full` adds the slow gates. Note that `--full` still includes
`i18n` and `depcheck`, the two gates **this fork removed from CI** because they
mis-flag TARS locale keys and TARS-only dependencies — read their output as advisory,
or pass `--skip i18n,depcheck`. Check ids: `eslint`, `prettier`, `imports`,
`eslint-config`, `json`, `circular-deps`, `typecheck`, `config-tests`, `i18n`,
`depcheck`.

The explicit-file-list commands below remain the ground truth for what CI runs, and
are what you reach for when you need to re-run a single check on a single file.

### Collect your changed files first

From the repo root, on your feature branch. Diffing the merge-base against the
working tree covers both committed and uncommitted work, so this is a superset
of what CI inspects:

```bash
git diff --name-only --diff-filter=ACMRTUXB "$(git merge-base release/26P3_dev HEAD)" | grep -E '^(api|client|packages)/.*\.(js|jsx|ts|tsx)$' > /tmp/style-files.txt; wc -l < /tmp/style-files.txt
```

**If that file is empty, stop — do not run the commands below.** With no path
arguments these tools operate on the entire repository, which is exactly the
failure mode described under "Never run repo-wide formatters".

### Then run the three blocking checks

```bash
node scripts/sort-imports.mts $(cat /tmp/style-files.txt)
```

```bash
npx prettier --write $(cat /tmp/style-files.txt)
```

```bash
npx eslint --config eslint.config.mjs --no-warn-ignored --max-warnings=0 -- $(cat /tmp/style-files.txt)
```

`sort-imports` and `prettier` rewrite in place; ESLint must exit 0 with **zero**
warnings. Re-run after any fix. Then typecheck whatever you touched:

```bash
npx tsc --noEmit -p packages/data-provider/tsconfig.json
npx tsc --noEmit -p packages/data-schemas/tsconfig.json
npx tsc --noEmit -p packages/api/tsconfig.json
cd client && npx tsc --noEmit
```

Typecheck is where our TARS code has historically broken CI: a missing
`translation.json` key makes `localize()` reject the argument, a schema field
added without extending its interface fails `data-schemas`, and a shared
primitive's required ARIA prop fails `client`. All of those are caught here in
seconds.

### The pre-commit hook is the safety net, not the plan

`.husky/pre-commit` runs `lint-staged` (Prettier + import sort on the exact staged
content), then `node scripts/static-checks.mts --skip eslint,prettier,imports` for the
rest of the CI job, gated on the paths the commit touches. `STATIC_CHECKS_FULL=1`
adds the slow gates. It is installed by the root `prepare` script on `npm install` /
`npm ci`. Verify once per clone:

```bash
npm run prepare && git config core.hooksPath
```

It must print `.husky/_`. **Never commit with `--no-verify`.** The hook only
covers staged files, so it is a backstop for the command above, not a substitute.

### Never run repo-wide formatters

`npm run sort-imports`, `npm run format`, and `eslint . --fix` with no path
argument rewrite the whole tree — roughly 200 upstream files carry pre-existing
import drift. Rewriting them creates a merge/rebase minefield against upstream
LibreChat for zero benefit. **Always pass an explicit file list scoped to your
own changes**, exactly as the command above does.

### What `static-checks.yml` does and does not cover

It gates on ESLint, Prettier, import sorting, the ESLint-config regression
sweep, the config-migration tests, and a smoke test of `scripts/static-checks.mts`
itself (the `runner` filter — keep the script's `FILTERS` block in sync with the
workflow's `paths-filter` block). The unused-i18n-key scan and the depcheck
sweep were removed from this fork — they could not see TARS locale keys or
TARS-only dependencies, and they cost more runtime than the rest of the workflow
combined. Nothing checks for unused locale keys or stale dependencies on a PR
now; audit those locally when it matters.

See `.github/workflows/README.md` for the full CI policy of this fork.
