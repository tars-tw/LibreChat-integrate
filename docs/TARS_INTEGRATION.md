# TARS.ai(LibreChat × pwc_tars)啟動與更新指南

本 repo 是 LibreChat 作為 pwc_tars 產品(UI/UX 層)的整合版本。本文件只講三件事:

1. [第一次啟動](#1-第一次啟動) — 從 clone 到跑起來的完整步驟
2. [Commit 更新後如何更新](#2-commit-更新後如何更新)
3. [設定檔變更紀錄](#3-設定檔變更紀錄) — `.env` / `librechat.yaml` 每次異動記在這裡

> 各整合功能(認證、LLM gateway、MCP gateway、SQL agent、長期記憶…)的架構與關鍵檔案說明在根目錄 [CLAUDE.md](../CLAUDE.md);本文件不重複。

---

## 1. 第一次啟動

### 1.1 前置需求

| 需求 | 說明 | 檢查 |
|---|---|---|
| Node.js **24.16.0** | `nvm use` 讀 `.nvmrc`;沒裝先 `nvm install 24.16.0` | `node -v` |
| Docker | 只用來跑依賴服務(MongoDB + Meilisearch),**不跑官方 api image** | `docker info` |
| **pwc_tars** (`:5000`) | 登入/知識庫/工具的真正後端,由 pwc_tars 專案自己啟動 | `curl localhost:5000/api/auth/sso/status` |
| Langflow (`:7860`) | 用 Langflow 整合才需要;須為 TARS 版 `langflow_tars` `187d365173`(`feat/langflow-sso`)之後的版本,舊版沒有 `/api/v1/tars/*`,Workflow 頁與從對話執行 flow 都會 404。建議比 LibreChat 先啟動 | `curl localhost:7860/health`;版本:`curl -s -o /dev/null -w '%{http_code}' localhost:7860/api/v1/tars/flows` 回 `403` 為新版、`404` 為舊版 |

### 1.2 初始化指令(只做一次)

```bash
nvm use
cp .env.example .env                       # 再依 §1.3 填值
# librechat.yaml 已納入版控(ci/26C4.CI),clone 後即有,不用自建
# 建立 docker-compose.override.yml(§1.4 全文照貼;被 .gitignore,新機器要自建)
docker compose up -d mongodb meilisearch   # 只起依賴服務
npm ci
npm run frontend                           # build 全部 packages + client
```

### 1.3 `.env` 一定要設的值

`cp .env.example .env` 之後,以下值在範例檔是**註解掉或未填**的,務必解註解/補上(即目前實機 `.env` 的實際設定):

| 變數 | 設成 | 作用 / 不設的後果 |
|---|---|---|
| `TARS_AUTH_URL` | `http://localhost:5000` | **整個 TARS 整合的總開關**。不設就退回原生 LibreChat(email 登入、無影子使用者、所有 tars 功能不啟用) |
| `TARS_JWT_SECRET` | 與 pwc_tars `SysConst.DEFAULT_SECRET_KEY` 相同 | pwc_tars 的 MCP 管理 API(新增/修改/刪除/測試/同步 server、工具編輯、專用腦綁定)有 `@admin_required`,LibreChat 以此金鑰替當下的管理員簽 60 秒 bearer。不設則 `/mcp-settings` 的這些操作全部失敗 |
| `HOST` | `127.0.0.1`(同機)或 `0.0.0.0`(跨機) | 預設 `localhost` 在 macOS 綁 IPv6-only,pwc_tars 走 IPv4 探測會 `ECONNREFUSED` |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/LibreChat` | 後端在本機跑,連 override 打開的 27017 |
| `VITE_LANGFLOW_URL` | `http://localhost:7860` | Langflow URL 單一來源(iframe + MCP url host + SSRF 白名單)。**Vite build-time,改了要重 build 前端** |
| `LANGFLOW_API_KEY` | Langflow **系統共用帳號**(`LANGFLOW_SUPERUSER`,預設 `langflow`)的 API key | `librechat.yaml` 以 `${LANGFLOW_API_KEY}` 帶入 MCP header,也用來同步「Workflow ·」Agent。要以系統帳號登入 Langflow 後在 Settings > API Keys 產生(管理員可從 Workflow 頁的工作區切換器進入「系統共用帳號」);其他帳號的 key 會被 Langflow 拒絕(403) |
| `HTTP_REQUEST_TIMEOUT_MS` | `1800000`(30 分鐘) | Node 預設 300 秒,涵蓋整個請求含 body。大檔上傳(含音檔轉錄、OCR)在回應前同步處理,超過上限時瀏覽器會看到請求中斷 |

以下在 `.env.example` **已預設可用**,本機 dev 不用動,但要知道它們的意義:

| 變數 | 預設 | 說明 |
|---|---|---|
| `LLM_GATEWAY_ALLOW_UNAUTHENTICATED` | `true` | `/api/agents/v1m` gateway 免認證(pwc_tars 反向借模型用)。**僅限封閉內網;對外部署改設 `LLM_GATEWAY_SERVICE_KEY`** |
| `LLM_GATEWAY_BODY_LIMIT` | `50mb` | 只套用在 `/api/agents/v1m` 的 request body 上限(其餘 API 維持 3mb)。pwc_tars 的 table task 每個批次把整批知識庫文件塞進 prompt,超過 3mb 會被 Express 回 `request entity too large`(gateway 回 500)|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_KEY` | `user_provided` | 哨兵值,`.env` 不放真 key。實際 key 解析鏈:使用者聊天室自設 > pwc_tars sys_config > 提示設 key |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` / `CREDS_KEY` / `CREDS_IV` / `MEILI_MASTER_KEY` | 內建範例值 | ⚠️ 是公開 repo 人人可見的值,**對外/共享環境務必重新產生** |
| `TARS_LANGFLOW_SSO_SECRET` | 內建預設值(與 pwc_tars `infra/langflow/.env.example` 相同) | Workflow 頁的一次性登入票證與 Langflow 帳號移交呼叫用它簽章,**必須和 Langflow 端(本機為 pwc_tars `infra/langflow/.env`)的同名變數相同**;兩邊都照範例檔複製就一致。要換時兩邊一起換(至少 32 字元)並都重啟。沒設定時 Workflow 頁顯示「Workflow 登入尚未完成設定」(503),兩邊不一致時顯示「登入連結已失效」。從對話執行「Workflow ·」Agent 不需要它 |
| `SCHEDULES_SINGLE_PROCESS` | `true` | 排程聊天(側欄「排程」)的執行引擎開關,見下方說明。不設且沒有 Redis 時,排程入口仍會出現,但新增/修改排程回 503、排程也不會觸發,後端 log 有 `[schedules] scheduler NOT started` |
| `TARS_ADMIN_ROLE_IDS` | `1` | pwc_tars `role_id` 屬此集合者 → LibreChat ADMIN |
| `TARS_PLUGIN_TOOL_TIMEOUT_MS` | `240000`(4 分鐘) | 聊天室呼叫 pwc_tars 外掛工具(`tars_tool_sdk`,`POST /api/langflow-service/tools/<name>`)的上限。外掛本身由 pwc_tars `backend/.env` 的 `TARS_TOOL_PLUGINS_DIR` 載入,LibreChat 這邊不用設定;在專用腦管理的「外掛工具」區塊決定每個腦要顯示哪些 |

> **排程聊天與部署方式**:排程引擎要知道「同一個排程現在是不是有人在跑」。這份資訊預設存在 LibreChat process 的記憶體裡,只有一個 process 時是準確的;若同時跑多個 LibreChat(多台機器、PM2 cluster、多個容器副本)又沒有共用的 Redis,每個 process 只看得到自己的執行狀態,可能把別台正在跑的排程誤判為中斷、重複佔用額度。`SCHEDULES_SINGLE_PROCESS=true` 就是宣告「只有一個 process」,符合本文件的部署方式(單一 `npm run backend`)。**要擴成多個 LibreChat 時**:架 Redis、設 `USE_REDIS=true`(`USE_REDIS_STREAMS` 跟著預設開啟)與 `REDIS_URI`,並拿掉 `SCHEDULES_SINGLE_PROCESS`。另外,會「中途停下來等人」的排程 agent(工具核准 `endpoints.agents.toolApproval`,或 `ask_user_question` 詢問使用者)一定要有 Redis 才能跑,沒有時該次排程直接失敗;目前 `librechat.yaml` 兩者都沒開,所以不受影響。

> Langflow 的 project id **不用設**:MCP 連線改走 `/api/v1/tars/mcp/streamable`,涵蓋所有使用者、所有專案的 flow,不再需要 `LANGFLOW_PROJECT_ID`。Langflow 端要設的值(`TARS_LANGFLOW_SSO_SECRET`、正式部署要關閉 auto login 等)見 pwc_tars `infra/langflow/README.md`。

### 1.4 `docker-compose.override.yml`(全文)

被 `.gitignore`,新機器 clone 後沒有此檔,照貼即可。作用:把依賴服務 port 對外開放,讓本機 `npm run backend` 連得到;不啟動官方 api image。

```yaml
# 本機開發用：把依賴服務的 port 對外開放，讓本機 npm run backend 連得到。
# 只啟動 mongodb 與 meilisearch，不啟動官方 api image。
services:
  mongodb:
    ports:
      - "27017:27017"
  meilisearch:
    ports:
      - "7700:7700"
```

### 1.5 `librechat.yaml`(全文)

此分支(`ci/26C4.CI`)已將 `librechat.yaml` 納入版控,clone 後即有;**以 repo 根目錄的檔案為準**,下面是同一份內容供對照。全用 `${...}` 帶 `.env` 的值,host、api key、project id 都不寫死,**照貼到專案根目錄即可**——唯一例外是 `Azure` endpoint:它的 `baseURL` 與 deployment 清單是客戶專屬,要照該客戶 pwc_tars `model_profile` 的 Azure 資料列填;key 用 `${tars:KEY_OPEN_AI_API}` 直接讀 pwc_tars sys_config(`${tars:KEY}` 語法目前只支援 custom endpoint 的 `apiKey`):

```yaml
# LibreChat configuration
# Docs: https://www.librechat.ai/docs/configuration/librechat_yaml
version: 1.3.13
cache: true

# The local Langflow host is auto-exempted from the MCP SSRF block — its host:port is derived
# from VITE_LANGFLOW_URL in code (api/server/services/initializeMCPs.js), so no host is hardcoded
# here. Add other services to mcpSettings.allowedAddresses if you need to exempt them too.

interface:
  marketplace:
    use: false
  langflow: false
  # Scheduled chats (upstream default: off). Firing needs Redis streams or, on a
  # single replica without Redis, SCHEDULES_SINGLE_PROCESS=true in .env.
  schedules:
    use: true
    create: true

endpoints:
  agents:
    # Capabilities available to Agents. `tools` is what lets an Agent call MCP tools
    # (e.g. the Langflow flows exposed below).
    capabilities:
      - tools
      - actions
      - file_search
      - artifacts
      - execute_code
      - web_search
      - sql_agent
      - rag_agent
      - chart_agent
      - file_agent
      - skills
      - context

  custom:
    # The customer's Azure OpenAI deployment(s), configured statically. The
    # model id MUST be the Azure deployment name (= pwc_tars model_profile.name),
    # because pwc_tars routes gateway calls here as `Azure/<deployment>` — keep
    # `name: 'Azure'` as is (case-sensitive) and this list in step with the
    # model_profile rows whose endpoint is this Azure resource.
    #   - dropParams temperature: gpt56-luna-dev only accepts its default
    #     (model_profile supports_temperature=false); a custom value is a 400.
    #   - tokenConfig: the deployment name matches no built-in model, so without
    #     it the context window falls back to 32k. prompt/completion are
    #     per-1M-token rates for balance accounting (0 = not charged).
    # apiKey `${tars:KEY}` is read from pwc_tars sys_config at request time
    # (30s cache), so a key rotated in pwc_tars needs no LibreChat change.
    # KEY_OPEN_AI_API is the key pwc_tars itself sends to Azure.
    - name: 'Azure'
      apiKey: '${tars:KEY_OPEN_AI_API}'
      baseURL: 'https://aoai-dev-ca-pcc-cssai-jpe-001.openai.azure.com/openai/v1'
      models:
        default: ['gpt56-luna-dev']
      dropParams: ['temperature']
      tokenConfig:
        gpt56-luna-dev: { prompt: 0, completion: 0, context: 400000 }
      titleConvo: true
      titleModel: 'current_model'
      modelDisplayLabel: 'Azure OpenAI'

# Web search runs on Tavily alone (search + page extract, no reranker), so no other
# provider's key is ever consulted and users get no key/provider dialog. The key is
# pwc_tars's sys_config KEY_TAVILY (系統參數設定), read live with a 30s cache — rotate
# it there, not in .env. Unset or pwc_tars unreachable → web search is unavailable.
webSearch:
  searchProvider: 'tavily'
  scraperProvider: 'tavily'
  rerankerType: 'none'
  tavilyApiKey: '${tars:KEY_TAVILY}'

mcpServers:
  # Langflow integration — Langflow flows exposed as callable tools (the "Workflow ·" agents).
  # Each chatting user gets the shared account's MCP-enabled flows plus their own, in any project;
  # a flow is published by its MCP switch in Langflow. Nothing here is per-machine: the host is
  # ${VITE_LANGFLOW_URL} (.env) and the key ${LANGFLOW_API_KEY} (.env), which must be the Langflow
  # system account's (LANGFLOW_SUPERUSER) — Langflow refuses any other key on this endpoint.
  langflow:
    type: streamable-http
    url: '${VITE_LANGFLOW_URL}/api/v1/tars/mcp/streamable'
    headers:
      x-api-key: '${LANGFLOW_API_KEY}'
      # 把發話者的 LibreChat user id 以 Langflow request-variable header 帶進 flow：
      # Langflow 會把 x-langflow-global-var-* 放進 graph.context.request_variables，
      # TarsAgent component 讀取後轉發 pwc_tars → LLM gateway 以該使用者身分解析個人 key。
      # 這個佔位符同時讓 langflow 的 MCP 連線變成 per-user scoped。
      x-langflow-global-var-librechat_user_id: '{{LIBRECHAT_USER_ID}}'
      # 發話者對應的 pwc_tars 使用者（sys_user.id）；pwc_tars 依此限制可用的知識庫，沒帶就不能用知識庫。
      x-langflow-global-var-tars_user_id: '{{LIBRECHAT_USER_TARSID}}'
    title: 'Langflow'
    description: 'Langflow flows exposed as callable tools'
    timeout: 60000
    # Hidden from the regular chat input toggle — the per-flow "Workflow ·" Agents are the
    # intended entry point. The server still loads on startup so those Agents can call its tools.
    chatMenu: false
    startup: true
```

### 1.6 啟動

先確認 pwc_tars(`:5000`)與依賴服務(`docker compose up -d mongodb meilisearch`)都在跑。

**Dev 模式(日常開發)★ — 兩個常駐終端機分頁:**

```bash
npm run backend:dev
```

```bash
npm run frontend:dev
```

→ 瀏覽器開 **http://localhost:3090**,用 pwc_tars 帳號(username)登入。

- `:3090` = Vite dev server,前端改動即時熱更新;API 請求 proxy 到 `:3080`。
- `/api/`(後端 JS)改動 nodemon 自動重啟;**改到 `packages/*` 要先跑對應 `npm run build:<套件>` 再重啟前端 dev server**(Vite 不會偵測 `packages/*/dist` 變更)。

**實際服務(production,單一服務):**

```bash
npm run frontend     # 完整建置:packages + client,VITE_* 在此固化進前端
npm run backend      # Express 在 :3080 同時 serve 打包好的前端 + API
```

→ 瀏覽器開 **http://localhost:3080**。

- `:3080` 吐的是「上次 build 的靜態前端」——改了 `client/` 沒重跑 `npm run frontend`(或 `cd client && npm run build`)就永遠是舊畫面。
- 對外部署時把網域指到 `:3080`,並改 `.env`:`VITE_LANGFLOW_URL` 設為對外 Langflow 網址(**要用主站同網域的子網域**,否則 iframe 被第三方 cookie 政策擋)、重新產生 `JWT_*`/`CREDS_*`、確認 `TARS_LANGFLOW_SSO_SECRET` 與 Langflow 端相同(沿用範例檔預設值即可;若有更換,兩邊一起換並都重啟)、`LLM_GATEWAY_ALLOW_UNAUTHENTICATED` 改為 `LLM_GATEWAY_SERVICE_KEY`。改任何 `VITE_*` 都要重跑 `npm run frontend`。

---

## 2. Commit 更新後如何更新

`packages/*` 是先編譯成 `dist/` 才被 `/api` 與 `/client` 引用;拉了別人的 commit 不重建,後端就用到過時的 dist(典型症狀:`xxx is not a function`)。所以**每次 `git pull` / 切分支後,先重建再啟動**:

**(a) `package-lock.json` 沒變(預設走這條):**

```bash
npm run build        # turbo 全部 packages 重建,有快取沒變的自動 skip
```

**(b) `package-lock.json` 變了(先補依賴):**

```bash
npm ci
npm run build
```

> 拿不準 lockfile 有沒有變就直接走 (a);真的缺套件 build 會明確報錯(`Cannot find module`),那時再 `npm ci`。

重建後重啟:

- Dev:重啟 `npm run backend:dev` 與 `npm run frontend:dev`(必要時先刪 `client/node_modules/.vite`)。
- Production:重跑 `npm run frontend` + `npm run backend`。
- 瀏覽器硬重新整理 **Cmd+Shift+R** 清舊 bundle。

同時檢查 [§3 變更紀錄](#3-設定檔變更紀錄):若這次更新有新的 `.env` / `librechat.yaml` 要求,照紀錄補上再啟動。

> ⚠️ **`npm run smart-reinstall` 是破壞性的**:需要重裝時它會「先刪光 `node_modules` → `npm cache clean --force` → `npm ci`」,中途失敗(常見:`~/.npm` 有 root-owned 檔案報 `EACCES`)會落到完全沒依賴的狀態。日常更新優先用上面 (a)/(b);要用它先修權限:`sudo chown -R $(id -u):$(id -g) ~/.npm`。

---

## 3. 設定檔變更紀錄

`.env` 被 `.gitignore`,git 看不到它的歷史;`librechat.yaml` 在 `ci/26C4.CI` 已納入版控,但它的異動常伴隨要補的 `.env` 值——**兩者每次異動都在此表新增一列**(新的放最上面),更新環境的人照表補設定。

| 日期 | 檔案 | 變更內容 | 相關 commit |
|---|---|---|---|
| 2026-10-15 | `librechat.yaml`、`.env` | 開啟排程聊天(upstream 預設關閉):`librechat.yaml` 的 `interface` 新增 `schedules: { use: true, create: true }`,側欄出現「排程」入口(角色權限 `SCHEDULES` 預設即開)。`.env.example` 的 `SCHEDULES_SINGLE_PROCESS=true` 改為預設開啟;既有 `.env` 沒有這行要補上,否則排程不會觸發。多個 LibreChat process 的部署改用 Redis,見 §1.3 排程說明。 | `feat/enable-scheduled-chats`(待 commit) |
| 2026-10-14 | `.env` | `.env.example` 直接帶 `TARS_LANGFLOW_SSO_SECRET` 預設值,與 pwc_tars `infra/langflow/.env.example` 相同,兩邊照範例檔複製即可;既有 `.env` 若是自己產生的值,改成範例檔的值,或維持兩邊相同即可。 | `feat/hard-code-langflow-sso-secret`(待 commit)、pwc_tars `feature/hard-code-langflow-sso-secret` |
| 2026-10-13 | `librechat.yaml`、`.env` | Langflow 改為每個 pwc_tars 使用者各自的帳號(Workflow SSO)。`librechat.yaml` 的 `mcpServers.langflow` 改為 `type: streamable-http`、`url: '${VITE_LANGFLOW_URL}/api/v1/tars/mcp/streamable'`(舊的 `/api/v1/mcp/project/${LANGFLOW_PROJECT_ID}/sse` 不再使用)。`.env` 新增必填 `TARS_LANGFLOW_SSO_SECRET`(與 Langflow 端相同);`LANGFLOW_API_KEY` 必須改用 Langflow 系統共用帳號的 key;`LANGFLOW_PROJECT_ID` 不再需要。Langflow 須同步升級到 `langflow_tars` `187d365173` 之後,否則 Workflow 頁與從對話執行 flow 都會 404;升級後也要重 build 前端。 | `a6de9bf87`、`876ec6d6a`(PR #91) |
| 2026-10-05 | `librechat.yaml` | `endpoints.agents.capabilities` 新增 `file_agent`(產生檔案的 capability 閘門)。產生檔案(`tars_generate_file`,PDF / Word / Excel / PPT)改為獨立開關,不再隨知識庫檢索、資料庫查詢、產生圖表或附加試算表自動掛上;**既有部署若未加 `file_agent`,產生檔案會整個不可用**。另有 `interface.fileAgent`(角色權限 `FILE_AGENT.USE`,預設開)。`.env` 無新增值。 | `feature/tool_plugin`(待 commit) |
| 2026-10-03 | `librechat.yaml` | 此分支(Azure 客戶)沒有 Gemini:`speech.stt` 移除 `gemini` 區塊與 `endpoints: { google: gemini }` 路由,只留 `openai` 一個 provider(單一 provider 不需 `provider` 欄位),所有對話與麥克風都走它。不需要 sys_config `KEY_GEMINI_API`。`.env` 無新增值。 | `release/26P4_dev_azure`(待 commit) |
| 2026-10-03 | `librechat.yaml`、`.env` | 聊天上傳改回 LibreChat 原生檔案(不再用 pwc_tars 長期記憶區)。`librechat.yaml` 新增 `fileConfig.defaultLLMDeliveryPath.overrides`,把 `text/csv`、`application/csv`、`application/vnd.ms-excel`、`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` 設為 `none`(只存原檔,整張表不會被抽成文字塞進 prompt;試算表由 pwc_tars 資料工具查詢)。`.env` 的 `TARS_MEMORY_UPLOAD_TIMEOUT_MS` 已無作用,可刪。pwc_tars 端:sys_config `KEY_LIBRECHAT_BASE_URL` 必須是 pwc_tars 連得到的 LibreChat 位址(資料工具從它的 `/api/tars/files` 下載試算表);可選 env `LIBRECHAT_DATA_CACHE_DIR`、`LIBRECHAT_DATA_FILE_MAX_BYTES`(預設 100MB)、`LIBRECHAT_DATA_CACHE_TTL_HOURS`(預設 24)、`LIBRECHAT_DATA_FILE_TIMEOUT_SEC`(預設 120)。同日再加 `speech.stt.openai`(`apiKey: '${tars:KEY_OPEN_AI_API}'` 即時讀 pwc_tars sys_config、`model: gpt-4o-mini-transcribe`)與 `fileConfig.defaultLLMDeliveryPath.overrides` 的 `audio/*: text`,音檔一律轉成逐字稿再給模型;`KEY_OPEN_AI_API` 沒有有效值時音檔上傳會失敗。`speech.stt.traditionalChinese: true` 把逐字稿轉成繁體台灣用語(OpenCC s2twp,與 pwc_tars 相同;新增依賴 `opencc-js`),附件與輸入框麥克風都套用;不設則維持模型原樣輸出。STT 改為可設多個 provider:`speech.stt.provider: openai` 為預設(麥克風與非 Gemini 對話),`speech.stt.endpoints: { google: gemini }` 讓 Gemini 對話裡附的音檔改由 `speech.stt.gemini`(`apiKey: '${tars:KEY_GEMINI_API}'`、`model: gemini-3.6-flash`,`generateContent` 直接聽音檔轉錄)處理。 | `feature/longterm_memory_fix`、pwc_tars `feature/librechat_data_file_refs`(待 commit) |
| 2026-10-02 | `librechat.yaml` | 新增 `webSearch` 區塊:網路搜尋只用 Tavily(`searchProvider`/`scraperProvider: tavily`、`rerankerType: none`),key 為 `tavilyApiKey: '${tars:KEY_TAVILY}'`,即時讀 pwc_tars sys_config `KEY_TAVILY`(30 秒快取)。`.env` 的 `TAVILY_API_KEY` 不再被網路搜尋使用;`KEY_TAVILY` 未設或 pwc_tars 連不到時網路搜尋不可用。 | `feature/web_search_tavily_only`(待 commit) |
| 2026-09-23 | `librechat.yaml` | `endpoints.custom` 新增 `Azure` endpoint(寫死 Azure 資源 URL 與 deployment `gpt56-luna-dev`、`dropParams: ['temperature']`、`tokenConfig` context 400000);`name` 必須是 `Azure`,與 pwc_tars gateway 前綴 `Azure/<deployment>` 對應;`apiKey: '${tars:KEY_OPEN_AI_API}'` 直接讀 pwc_tars sys_config,換 key 不用動 LibreChat。客戶換 deployment 時 pwc_tars `model_profile` 與此檔都要改。同時 `librechat.yaml` 移出 `.gitignore`,改由此分支版控;移除 `vLLM` endpoint(此分支不用地端模型)。`.env` 無新增值。 | `ci/26C4.CI`(待 commit) |
| 2026-09-15 | `librechat.yaml` | 新增 `interface.langflow: false`,控制側欄的 Langflow(Workflow)入口,設 `true` 才顯示;程式預設即為 `false`,不設也是隱藏。`/langflow` 頁面、管理選單與 MCP 設定頁的入口不受影響。Agent 市場改回只靠既有的 `interface.marketplace.use: false` 關閉(需明確寫在 yaml,才會覆蓋 MongoDB 角色權限)。`.env` 無新增值。 | `fix/sidebar-menu-yaml-gate`(待 commit) |
| 2026-09-10 | `librechat.yaml` | 新增 `interface.marketplace.use: false`,關閉聊天左側的 Agent 市場入口。`.env` 無新增值。 | `feature/tars-ui-improvements`(待 commit) |
| 2026-09-04 | `.env` | 新增 `HTTP_REQUEST_TIMEOUT_MS=1800000`(必設,解掉長期記憶區音檔上傳的 5 分鐘天花板);可選的 `TARS_MEMORY_UPLOAD_TIMEOUT_MS` 覆寫外送端逾時,程式內建同樣是 30 分鐘,不設也可用。 | `feature/tars-memory-upload-timing`(待 commit) |
| 2026-08-29 | `librechat.yaml` | `endpoints.agents.capabilities` 新增 `sql_agent`、`chart_agent`(TARS SQL agent 與產生圖表工具的 capability 閘門);vLLM `models.default` 佔位清單加入 `gemma-4-26B-A4B`。`.env` 無新必填值(僅新增可選的 `TARS_*_TIMEOUT_MS` 覆寫)。 | `1eacbe6e1`、`241a7e08d` |
