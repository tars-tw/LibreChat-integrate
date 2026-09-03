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
| Langflow (`:7860`) | 用 Langflow 整合才需要;**開機時要在線**(project id 開機探測一次) | `curl localhost:7860/health` |

### 1.2 初始化指令(只做一次)

```bash
nvm use
cp .env.example .env                       # 再依 §1.3 填值
# 建立 librechat.yaml(§1.5 全文照貼;被 .gitignore,新機器要自建)
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
| `HOST` | `127.0.0.1`(同機)或 `0.0.0.0`(跨機) | 預設 `localhost` 在 macOS 綁 IPv6-only,pwc_tars 走 IPv4 探測會 `ECONNREFUSED` |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/LibreChat` | 後端在本機跑,連 override 打開的 27017 |
| `VITE_LANGFLOW_URL` | `http://localhost:7860` | Langflow URL 單一來源(iframe + MCP url host + SSRF 白名單)。**Vite build-time,改了要重 build 前端** |
| `LANGFLOW_API_KEY` | 你的 Langflow API key | `librechat.yaml` 以 `${LANGFLOW_API_KEY}` 帶入 MCP header |
| `SCHEDULES_SINGLE_PROCESS` | `true` | 單機跑排程,避免多實例重複執行 |
| `HTTP_REQUEST_TIMEOUT_MS` | `1800000`(30 分鐘) | Node 預設 300 秒,涵蓋整個請求含 body。長期記憶區上傳一支長音檔時,pwc_tars 是同步解析＋轉錄才回應,會撞到這個上限:瀏覽器看到請求斷掉,pwc_tars 卻已寫入 memory_document |

以下在 `.env.example` **已預設可用**,本機 dev 不用動,但要知道它們的意義:

| 變數 | 預設 | 說明 |
|---|---|---|
| `LLM_GATEWAY_ALLOW_UNAUTHENTICATED` | `true` | `/api/agents/v1m` gateway 免認證(pwc_tars 反向借模型用)。**僅限封閉內網;對外部署改設 `LLM_GATEWAY_SERVICE_KEY`** |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_KEY` | `user_provided` | 哨兵值,`.env` 不放真 key。實際 key 解析鏈:使用者聊天室自設 > pwc_tars sys_config > 提示設 key |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` / `CREDS_KEY` / `CREDS_IV` / `MEILI_MASTER_KEY` | 內建範例值 | ⚠️ 是公開 repo 人人可見的值,**對外/共享環境務必重新產生** |
| `TARS_ADMIN_ROLE_IDS` | `1` | pwc_tars `role_id` 屬此集合者 → LibreChat ADMIN |
| `TARS_MEMORY_UPLOAD_TIMEOUT_MS` | `1800000`(30 分鐘) | LibreChat 等 pwc_tars `upload_memory_data` 回應的上限(undici `headersTimeout`/`bodyTimeout`)。不設就吃 undici 的 300 秒預設。調高時 `HTTP_REQUEST_TIMEOUT_MS` 要一起調 |

> Langflow 的 project id **不用設**:開機時後端從唯一的 Langflow 專案自動探測。Langflow 有多個專案時才需在 `.env` 設 `LANGFLOW_PROJECT_ID`。

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

被 `.gitignore`,新機器要自建。全用 `${...}` 帶 `.env` 的值或 `tars://local` 探索標記,host、api key、project id 都不寫死,**照貼到專案根目錄即可,一個字都不用改**:

```yaml
# LibreChat configuration
# Docs: https://www.librechat.ai/docs/configuration/librechat_yaml
version: 1.3.13
cache: true

# The local Langflow host is auto-exempted from the MCP SSRF block — its host:port is derived
# from VITE_LANGFLOW_URL in code (api/server/services/initializeMCPs.js), so no host is hardcoded
# here. Add other services to mcpSettings.allowedAddresses if you need to exempt them too.

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
      - chart_agent
      - skills
      - context

  custom:
    # Local (地端) models served by vLLM. This endpoint is fully auto-discovered
    # from the pwc_tars model registry — the special baseURL `tars://local` tells
    # LibreChat to source BOTH the model list and each model's host live from
    # pwc_tars `GET /api/model/health_status` (30s TTL cache):
    #   - Which models appear = whichever local models are currently loaded on any
    #     vLLM host (availability-gated; the whole endpoint is hidden when none are
    #     up or pwc_tars is unreachable — nothing to fall back to).
    #   - Each model routes to its OWN host (models may live on different machines;
    #     e.g. gemma-4-31B and a deepseek-reasoner build can be on separate boxes).
    # Add a local model purely on the pwc_tars side (register it in model_profile
    # with its endpoint + serve it on vLLM) and it appears here with ZERO LibreChat
    # config. `models.default` is nominal only (schema requires ≥1); the real list
    # always comes from pwc_tars.
    - name: 'vLLM'
      # vLLM runs without --api-key, so any non-empty placeholder works. The real
      # per-model baseURL is injected at request time (see tars://local above).
      apiKey: 'EMPTY'
      baseURL: 'tars://local'
      models:
        default: ['gemma-4-31B', 'gemma-4-26B-A4B']
      titleConvo: true
      titleModel: 'current_model'
      modelDisplayLabel: 'vLLM'

mcpServers:
  # Langflow integration — exposes the flows of a Langflow project as callable tools.
  # Which flows appear is controlled on the Langflow side (per-flow `mcp_enabled` toggle in the
  # project's MCP settings). Nothing here is per-machine: the host is ${VITE_LANGFLOW_URL} (.env),
  # the api key ${LANGFLOW_API_KEY} (.env), and the project id is auto-discovered at boot from the
  # single Langflow project (api/server/services/langflow/project.js) into ${LANGFLOW_PROJECT_ID}.
  langflow:
    type: sse
    url: '${VITE_LANGFLOW_URL}/api/v1/mcp/project/${LANGFLOW_PROJECT_ID}/sse'
    headers:
      x-api-key: '${LANGFLOW_API_KEY}'
      # 把發話者的 LibreChat user id 以 Langflow request-variable header 帶進 flow：
      # Langflow 會把 x-langflow-global-var-* 放進 graph.context.request_variables，
      # TarsAgent component 讀取後轉發 pwc_tars → LLM gateway 以該使用者身分解析個人 key。
      # 這個佔位符同時讓 langflow 的 MCP 連線變成 per-user scoped。
      x-langflow-global-var-librechat_user_id: '{{LIBRECHAT_USER_ID}}'
    title: 'Langflow'
    description: 'Langflow flows exposed as callable tools'
    timeout: 60000
    # Hidden from the regular chat input toggle — the per-flow "Langflow ·" Agents are the
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
- 對外部署時把網域指到 `:3080`,並改 `.env`:`VITE_LANGFLOW_URL` 設為對外 Langflow 網址(**要用主站同網域的子網域**,否則 iframe 被第三方 cookie 政策擋)、重新產生 `JWT_*`/`CREDS_*`、`LLM_GATEWAY_ALLOW_UNAUTHENTICATED` 改為 `LLM_GATEWAY_SERVICE_KEY`。改任何 `VITE_*` 都要重跑 `npm run frontend`。

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

`.env` 與 `librechat.yaml` 都被 `.gitignore`,git 看不到它們的歷史——**每次異動必須在此表新增一列**(新的放最上面),更新環境的人照表補設定。

| 日期 | 檔案 | 變更內容 | 相關 commit |
|---|---|---|---|
| 2026-09-04 | `.env` | 新增 `HTTP_REQUEST_TIMEOUT_MS=1800000`(必設,解掉長期記憶區音檔上傳的 5 分鐘天花板);可選的 `TARS_MEMORY_UPLOAD_TIMEOUT_MS` 覆寫外送端逾時,程式內建同樣是 30 分鐘,不設也可用。 | `feature/tars-memory-upload-timing`(待 commit) |
| 2026-08-29 | `librechat.yaml` | `endpoints.agents.capabilities` 新增 `sql_agent`、`chart_agent`(TARS SQL agent 與產生圖表工具的 capability 閘門);vLLM `models.default` 佔位清單加入 `gemma-4-26B-A4B`。`.env` 無新必填值(僅新增可選的 `TARS_*_TIMEOUT_MS` 覆寫)。 | `1eacbe6e1`、`241a7e08d` |
