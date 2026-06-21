# LibreChat × pwc_tars 整合與本地執行指南

本 repo 是 **LibreChat 作為 `pwc_tars` 產品(UI/UX 層)** 的整合版本。`pwc_tars`已具備 LLM 服務、知識庫、SQL agent 等後端能力,LibreChat 只是包在它外面的前端。

- **pwc_tars 是認證與使用者/權限的真相來源**;LibreChat 不重實作,而是對接。
- **pwc_tars 技術棧**:Flask + PostgreSQL(SQLAlchemy)+ JWT;認證入口 `POST /api/auth/login`,以 **`username`**(非 email)登入。
- **整合原則**:LibreChat 端維持薄轉接層(`/api` 的 JS wrapper 呼叫 `packages/api` 的 TS 邏輯),**不**把 LibreChat 的 MongoDB 使用者庫換成 PostgreSQL —— 所有下游功能(對話、檔案、agents、餘額、權限)都以 MongoDB `User._id` 為外鍵。改採「驗證 pwc_tars + 在本地建立連動的影子使用者」。

> 工作區邊界、程式風格等開發規範見根目錄 [CLAUDE.md](../CLAUDE.md)。

---

## 1. 快速啟動(Dev 模式,最常用)★

> **記住兩個 port:`:3080` = 後端 API(同時吐出打包好的前端);`:3090` = 前端 dev server(Vite,即時熱更新)。日常開發看 `:3090`。**

**首次初始化(只做一次)**:

```bash
nvm use                                  # 讀 .nvmrc 切到 24.16.0(沒裝先 nvm install 24.16.0)
cp .env.example .env                     # 複製後手動填下方「必填」兩個值
#  建立 librechat.yaml(被 .gitignore,新機器要自建;內容直接抄 §7.2,全是 ${...} 參照可照貼)
# 建立 docker-compose.override.yml(被 .gitignore,每台機器自建;內容見下方)
docker compose up -d mongodb meilisearch # 只起依賴服務(MongoDB :27017 + Meilisearch)
npm ci                                   # 安裝依賴(或 npm install)
npm run frontend                         # build 全部 packages(dev 必要)+ client;純 dev 也可用更快的 npm run build
```

**`cp` 後一定要自己填的 `.env` 值** —— 這兩個在 `.env.example` 是**註解掉的**,複製過來預設沒生效,務必解註解並填:

| 變數 | 填什麼 | 不填的後果 |
|---|---|---|
| `TARS_AUTH_URL` | `http://localhost:5000`(pwc_tars Flask 位置) | **整個 tars 整合不啟用** —— 退回原生 LibreChat(email 登入、無影子使用者) |
| `VITE_LANGFLOW_URL` | Langflow URL,如 `http://localhost:7860`(**單一來源**,餵 iframe + MCP url host + SSRF 白名單) | 用 Langflow 才需要;**Vite build-time,改了要重 build 前端** |
| `LANGFLOW_API_KEY` | Langflow 的 API key | 用 Langflow 才需要 |

> Langflow 的 **project id 不用設** —— 開機時後端從你唯一的 Langflow 專案自動探測(`.env`、`librechat.yaml` 都不寫)。

其餘關鍵值(`JWT_SECRET`、`JWT_REFRESH_SECRET`、`CREDS_KEY`、`CREDS_IV`、`MEILI_MASTER_KEY`)`.env.example` 已內建可用範例值,本機 dev **不必動**;各家模型 API key(`OPENAI_API_KEY` 等)預設 `user_provided`,從 UI 輸入即可。完整變數說明見 [§6.2](#62-環境變數env)。

> ⚠️ 上述範例 secret 是公開 repo 內人人可見的值,**對外/共享環境請重新產生 `JWT_*` 與 `CREDS_*`**。

> **`docker-compose.override.yml` 沒進版控**(被 `.gitignore` 忽略),新機器 clone 後**沒有此檔**,要自己建。它把依賴服務的 port 對外開放,本機 `npm run backend` 才連得到:
>
> ```yaml
> # 本機開發用:把依賴服務的 port 對外開放,讓本機 npm run backend 連得到。
> # 只啟動 mongodb 與 meilisearch,不啟動官方 api image。
> services:
>   mongodb:
>     ports:
>       - "27017:27017"
>   meilisearch:
>     ports:
>       - "7700:7700"
> ```

**日常啟動(Dev,兩個常駐分頁)**:

```bash
# pwc_tars(:5000)要先在跑;改過 packages/* 後先 npm run build(或對應 build:*)

# 分頁 A — 後端:nodemon,改 /api 的 .js 自動重啟,跑在 :3080
npm run backend:dev

# 分頁 B — 前端 dev server:Vite HMR,跑在 :3090
npm run frontend:dev
```

→ 瀏覽器開 **http://localhost:3090**,用 pwc_tars 帳號登入。

之後幾乎只在 `client/` 和 `/api/` 改,都會自動更新;只有動到 `packages/*` 才需回去重建 + 重啟前端(見 [§5](#5-改了-x-要重建什麼速查))。

---

## 2. 架構心智模型(先懂這個,後面就不會亂)

```
packages/data-provider ─┐
packages/data-schemas  ─┼─► 各自編譯成 dist/ ─► 被 /api(後端) 與 /client(前端) 引用
packages/api           ─┤
packages/client        ─┘

/api    (Express 後端)  ── 跑在 :3080 ── 同時把 client/dist(打包好的前端) 當靜態網站吐出
/client (React 前端)    ── dev 跑在 :3090 (Vite),正式時 build 成 client/dist
```

三個關鍵事實:

1. **`packages/*` 是「先編譯成 dist 才被用」**。改了 `packages/*` 一定要重新 `build:該套件`,否則 `/api` 和 `/client` 用到的還是舊 dist。`nodemon`(`backend:dev`)只 watch `/api`,**不會**自動重建 packages。
2. **只有 `:3090`(dev)有熱更新**;`:3080` 看到的是「上次 `client build` 的結果」,不重建就永遠是舊畫面。
3. 兩種模式都需要後端 `:3080` 在跑(`:3090` 的前端會把 API 請求 proxy 到 `:3080`)。

---

## 3. 前置服務(兩種模式都要先有)

| 服務 | 用途 | 啟動方式 | 檢查 |
|---|---|---|---|
| **MongoDB** (:27017) + **Meilisearch** | LibreChat 的使用者/對話資料庫(+ 全文搜尋) | `docker compose up -d mongodb meilisearch`(只起依賴服務,不起官方 api image) | `nc -z localhost 27017` |
| **pwc_tars** (:5000) | 登入 / 專用腦 / 知識庫的真正後端 | 由 pwc_tars 專案自己啟動 | `curl localhost:5000/api/auth/sso/status` |
| **環境變數** | `.env` 內 `TARS_AUTH_URL=http://localhost:5000`(已設)、`MONGO_URI=mongodb://127.0.0.1:27017/LibreChat` | — | — |

> 每個長駐指令請各自開「一個獨立終端機分頁」並保持開著。關掉分頁＝關掉那個服務。

---

## 4. 兩種執行模式

### 模式一:Dev(開發用,最即時)★ 推薦

見 [§1 快速啟動](#1-快速啟動dev-模式最常用)。看 **http://localhost:3090**,前端改動秒更新(HMR)。

### 模式二:Production build(只用 `:3080` 單一服務)

模擬正式環境、或不想開兩個 server。看 **http://localhost:3080**。

```bash
# 完整建置(套件 + 前端一次到位)
npm run frontend
# 等同 build:data-provider → build:data-schemas → build:api → build:client-package → cd client && npm run build
# 產物:client/dist(打包好的前端)

# 啟動後端(會一併把 client/dist 當前端吐出);NODE_ENV=production,跑在 :3080
npm run backend
```

> ⚠️ 「3080 看不到更新」幾乎都是因為:production 前端是**預先打包的靜態檔**,改了 `client/` 卻沒重跑 `npm run frontend`(或 `cd client && npm run build`),3080 自然永遠是舊畫面。

---

## 5. 改了 X 要重建什麼(速查)

| 改動範圍 | Dev(`:3090`) | Production(`:3080`) |
|---|---|---|
| `client/`(React、含 `locales` 翻譯) | 自動 HMR,什麼都不用做 | `cd client && npm run build`,重新整理瀏覽器 |
| `/api/`(後端 JS) | nodemon 自動重啟,等一兩秒 | 重啟 `npm run backend`(Ctrl+C 再跑) |
| `packages/data-provider` | `npm run build:data-provider` → **重啟前端 `frontend:dev`** + 後端自動重啟 | `npm run frontend` → 重啟 `npm run backend` |
| `packages/data-schemas` | `npm run build:data-schemas` → 重啟後端 | `npm run frontend` → 重啟 `npm run backend` |
| `packages/api` | `npm run build:api` → 重啟後端 | `npm run frontend` → 重啟 `npm run backend` |
| 多處 / 不確定 | `npm run build`(turbo 全部重建)→ 重啟前後端 | `npm run frontend` → 重啟 `npm run backend` |

> **Vite 不會自動偵測 `packages/*/dist` 的變更**。所以只要動到 `packages/*`,dev 前端就要手動重啟才看得到(必要時先刪 `client/node_modules/.vite` 再重啟)。

### 5.1 `git pull` / 更版後一定要重建 ★

上表是「**你自己**改了 X」;但別人的 commit 改了 `packages/*` 時,你的 `dist/` 一樣是舊的——拉完不重建,後端就會用到過時的 dist,典型症狀是 `xxx is not a function`(原始碼有該匯出,但 dist 還沒編出來)。

所以 **每次 `git pull` / 切換分支 / 更版後,先重建再啟動**。分兩種情況:

**(a) `package-lock.json` 沒變 → 只要重編(預設,非破壞性):**

```bash
npm run build             # turbo 全部 packages 重建;有快取,沒變的 package 自動 skip,很快
```

**(b) `package-lock.json` 變了 → 先補裝依賴再重編:**

```bash
git diff HEAD@{1} -- package-lock.json   # 想確認有沒有變可先看這個(空 = 沒變,走 (a) 即可)
npm ci                                    # 依 lockfile 補裝
npm run build
```

> 拿不準 lockfile 有沒有變,就直接走 (a) 的 `npm run build`;真的缺套件,build 會明確報錯(`xxx: command not found` / `Cannot find module`),那時再補 `npm ci`。重建後再 `npm run backend:dev` / `npm run backend`。

#### ⚠️ 關於 `npm run smart-reinstall`(更版用它要先懂兩個地雷)

`smart-reinstall` 會自動判斷 lockfile 有沒有變、該不該重裝,看起來最省事,但它在**需要重裝依賴**那條路上是**破壞性**的——`config/smart-reinstall.js` 的 `installDeps()` 順序是:**①先刪光所有 `node_modules` → ②`npm cache clean --force` → ③`npm ci`**。

1. **中途失敗會把環境弄得比原本更糟**。若 ② 失敗(見下),`node_modules` 已被刪、③ 還沒跑,你會落到「完全沒有依賴」的狀態,接著任何 `npm run build` 都會 `rimraf: command not found`。
2. **②`npm cache clean --force` 會踩 `~/.npm` 權限地雷**。若你過去用過 `sudo npm`,`~/.npm` 裡會有 root 擁有的檔案,清不掉而報 `EACCES … root-owned files`,整個腳本中斷。**一次性修法**(npm 官方建議):
>
> ```bash
> sudo chown -R $(id -u):$(id -g) ~/.npm   # 把 cache 擁有權改回目前使用者
> ```

修掉權限後 `smart-reinstall` 才能順跑。但**日常更版建議優先用上面 (a)/(b) 的 `npm run build` / `npm ci`**:非破壞性、失敗了也只是沒做事,不會把你既有的 `node_modules` 先砍掉。`smart-reinstall` 留給「想一鍵重來」時用,且請接受它是破壞性的。

---

## 6. 已整合的功能

### 6.1 認證與使用者(pwc_tars)

| 功能 | 說明 | 關鍵檔案 |
|---|---|---|
| **登入委派** | 登入改打 pwc_tars Flask `POST /api/auth/login` 驗證帳密,成功後由 LibreChat 自簽 JWT + refresh | `packages/api/src/auth/tars.ts`、`api/strategies/tarsStrategy.js` |
| **影子使用者** | 驗證成功在 MongoDB 建立/同步一筆 `provider: 'tars'`、以 `tarsId` 對應 `sys_user.id` 的使用者 | `api/strategies/tarsStrategy.js` |
| **角色/權限保留** | 完整保留 pwc_tars 的 `role_id`、`user_group_id`、`menu_items` 到 `tars*` 欄位(不 flatten);`user.role` 另依 `role_id` 映射成 LibreChat ADMIN/USER | `packages/data-schemas/src/schema/user.ts` |
| **License 擋登入** | 登入回應 `license_status !== 'activate'` 時擋下 | `api/strategies/tarsStrategy.js` |
| **登出反向通知** | LibreChat 登出時 best-effort 通知 pwc_tars `POST /api/auth/logout`(更新 `last_active_at`) | `api/server/controllers/auth/LogoutController.js` |
| **SSO 登入 (LDAP)** | 登入頁依 pwc_tars `GET /api/auth/sso/status` 顯示「使用 SSO 登入 (LDAP)」勾選框;勾選則送 `use_sso: true` 走 LDAP bind | `client/src/components/Auth/LoginForm.tsx`、`api/server/routes/config.js` |

**尚未實作(Roadmap)**:OIDC/SAML(redirect 式)、`domain_ids`(專用腦範圍)、登入後即時 status/role 同步(refresh 輪詢)、聊天資料雙向同步(Mongo ↔ PostgreSQL)。

### 6.2 環境變數(`.env`)

| 變數 | 必填 | 說明 |
|---|---|---|
| `TARS_AUTH_URL` | ✅ | pwc_tars Flask 服務基底 URL。**設了才會啟用整個 tars 整合**(登入改走 pwc_tars、登入頁變 username、註冊/密碼重設自動關閉)。 |
| `TARS_ADMIN_ROLE_IDS` | ⬜ | 逗號清單;pwc_tars `role_id` 屬此集合者 → LibreChat `ADMIN`。預設 `1`(對應 pwc_tars 種子的 Admin 角色)。 |

沿用 LibreChat 既有(LibreChat 自簽自己的 token):`JWT_SECRET`、`JWT_REFRESH_SECRET`、`SESSION_EXPIRY`、`REFRESH_TOKEN_EXPIRY`。

啟用 `TARS_AUTH_URL` 時建議(且部分由程式強制):`ALLOW_REGISTRATION=false`、不啟用 `ALLOW_PASSWORD_RESET` —— 註冊/改密碼由 pwc_tars 管。`.env.example` 內 `# pwc_tars Auth` 區塊已含這些範例。

### 6.3 Docker / 網路設定

目前的跑法:**LibreChat 後端在本機 `npm run backend`(不在容器裡),pwc_tars Flask 在本機 `:5000`**。Docker 只用來起依賴服務(`mongodb` / `meilisearch`),由 `docker-compose.override.yml` 把它們的 port 對外開放(見 [§1](#1-快速啟動dev-模式最常用));**不啟動官方 api image**。

因此 `.env` 設 `TARS_AUTH_URL=http://localhost:5000` 即可,後端直接以 host 連 pwc_tars。

---

## 7. Langflow 整合

把 `~/Downloads/langflow`(本機跑在 `http://localhost:7860`)整進聊天室。**純設定 + 少量後端程式,沒有改 `packages/*`。**

### 7.1 三個入口(在 LibreChat 裡長這樣)

| 入口 | 位置 | 用途 |
|---|---|---|
| **內嵌 Langflow 頁面** | 左側 rail 的 **Langflow**(流程圖示)→ 全頁 `/langflow` iframe | 在 LibreChat 裡直接編輯 Langflow flow |
| **每個 flow 一個共享 Agent** | endpoint 切 **Agents** → 選 `Langflow · <flow 名>` | 明確指定用哪個 flow;對話會顯示 tool-call 卡片 |
| ~~一般聊天的 MCP「Langflow」開關~~ | 已用 `chatMenu: false` 隱藏 | 避免「所有 flow 一起、模型自動挑」造成混淆 |

> Agent 屬於 **Agents endpoint**,不在 `gpt-5.4-mini` 那層。共享的 agent 出現在 **Agents 市場**(「My Agents」只列你自己擁有的)。

### 7.2 設定檔:`librechat.yaml` 全文

`librechat.yaml` 被 `.gitignore`,新機器要自建。下面就是**我們實際在跑的整份內容**——全用 `${...}` 帶 `.env` 的值,host、api key、project id 都不寫死,所以**照貼到專案根目錄 `librechat.yaml` 即可,一個字都不用改**:

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
    title: 'Langflow'
    description: 'Langflow flows exposed as callable tools'
    timeout: 60000
    # Hidden from the regular chat input toggle — the per-flow "Langflow ·" Agents are the
    # intended entry point. The server still loads on startup so those Agents can call its tools.
    chatMenu: false
    startup: true
```

搭配的 `.env` 只要兩個值:`VITE_LANGFLOW_URL`(Langflow URL,單一來源)、`LANGFLOW_API_KEY`。yaml 把 server 掛上去、`.env` 提供連線值,**兩邊都要**才會生效。

> **project id 自動探測,不用設。** 開機時後端用 `LANGFLOW_API_KEY` 打 Langflow `GET /api/v1/projects/`,若**只有一個專案**就取它的 id 塞進 `process.env.LANGFLOW_PROJECT_ID`(`api/server/services/langflow/project.js`),yaml 的 `${LANGFLOW_PROJECT_ID}` 隨之填好。固定單一專案就完全免設;若有多個專案,探測會放棄並要你在 `.env` 設 `LANGFLOW_PROJECT_ID` 指定。

> **SSRF 白名單也自動處理,不用手動加。** `localhost` 本會被 LibreChat 當 SSRF 目標擋掉,但後端會在載入 app config 時從 `VITE_LANGFLOW_URL` 推導出 `host:port` 自動加進 `mcpSettings.allowedAddresses`(`api/server/services/Config/app.js` 的 `withLangflowAllowedAddress`,單一注入點,連線與工具執行兩條路都吃得到),所以你**不需要**在 `mcpSettings.allowedAddresses` 寫 `localhost:7860`。Docker 內跑後端時 `VITE_LANGFLOW_URL` 設成 `http://host.docker.internal:7860`,白名單也會跟著對。

> ⚠️ project id 探測在**開機時**做一次:Langflow 那時必須在線。若開機時 Langflow 沒起來,langflow MCP 這次會連不上;待 Langflow 起來後**重啟後端**即可。

### 7.3 自動同步:新增 flow → 馬上出現(零腳本)

機制在 `api/server/services/langflow/reconcile.js`:**每次有人打開 agent 清單**,後端就把 Langflow 專案裡 **已標 MCP 曝露(`mcp_enabled`)** 的 flow 對齊成「公開、admin 擁有」的 agent。

- **新增 flow 流程**:在 Langflow 建好 flow → 在該 project 的 MCP 設定**打開該 flow 的開關** → 回 LibreChat 打開 Agents 選單,它就在了。**不用跑任何腳本。**
- **只新增、不刪除**:在 Langflow 停用/改名 flow,舊 agent 不會自動消失,需手動刪。
- 編排模型預設 `gpt-5.4-mini`(走你自己帳號的 OpenAI key,因為 `OPENAI_API_KEY=user_provided`)。

### 7.4 必填與可選 env

**必填(兩個)**,寫在 `.env`:

| 變數 | 用途 |
|---|---|
| `VITE_LANGFLOW_URL` | Langflow URL **單一來源** —— 同時餵前端 iframe、`librechat.yaml` MCP url 的 host、SSRF 白名單。**build-time(Vite),改了要重 build 前端** |
| `LANGFLOW_API_KEY` | Langflow API key(`librechat.yaml` 以 `${LANGFLOW_API_KEY}` 帶入 header) |

> project id **不是 env**,開機自動探測(單一專案);yaml/.env 都不用寫。

**可選覆寫**(全有預設、非必填):

| 變數 | 預設 | 用途 |
|---|---|---|
| `LANGFLOW_AGENT_MODEL` | `gpt-5.4-mini` | agent 編排模型 |
| `LANGFLOW_AGENT_PROVIDER` | `openAI` | 編排 endpoint(**注意大小寫是 `openAI`**)|
| `LANGFLOW_AGENT_OWNER_EMAIL` | 第一個 ADMIN | 共享 agent 的擁有者 |
| `LANGFLOW_PROJECT_ID` | 開機自動探測 | 覆寫 project id;**Langflow 有多個專案**(探測無法唯一決定)時才需設 |
| `LANGFLOW_BASE_URL` | = `VITE_LANGFLOW_URL` | 後端專用的**過時別名**,留空即可 |

### 7.5 搬到其他機器要改的環境值

**只改 `.env` 兩個值,`librechat.yaml` 完全不用動**:

1. `.env`:`VITE_LANGFLOW_URL`(該環境的 host)、`LANGFLOW_API_KEY`。
2. build + 起 backend/frontend(Langflow 要在線,開機才探測得到 project id)→ 第一次有人打開 Agents 選單,agent 自動建好。**不需要設 project id、不需要 seed 腳本、不需要動白名單。**

---

## 8. 驗證(end-to-end)

前置:pwc_tars Flask + PostgreSQL 起來,`sys_user` 有一個 `status='active'` 的測試帳號;LibreChat 端設好 `TARS_AUTH_URL`,MongoDB 已啟動。

1. **設定旗標**:`curl http://localhost:3080/api/config` 應含 `"tarsAuth":true`;若 pwc_tars 啟用 LDAP,還會有 `"tarsSso":{"enabled":true,"type":"ldap"}`。
2. **登入頁**:`http://localhost:3080/login`(或 dev `:3090`)欄位為 **username**;LDAP 啟用時出現「Sign in with SSO (LDAP)」勾選框。
3. **登入**:用 pwc_tars 帳號登入(例:`Chris`)→ 進入 `/c/new`;cookie 含 `refreshToken`、`token_provider=librechat`。
4. **影子使用者**:MongoDB `users` 該筆應有 `provider:'tars'`、`tarsId`、`role`、`tarsRoleId`、`tarsMenuItems`、`tarsMenuKeys`、`tarsStatus`。
   ```bash
   docker exec chat-mongodb mongosh LibreChat --quiet --eval \
     "db.users.find({provider:'tars'},{username:1,role:1,tarsRoleId:1,tarsStatus:1,tarsMenuKeys:1}).pretty()"
   ```
5. **角色治理**:在 pwc_tars 改該帳號角色,重新登入後 MongoDB `role` / `tarsMenuItems` 應同步更新。
6. **License / SSO**:pwc_tars 回 `license_status: deactivate` → 登入被擋;勾 LDAP 登入 → 後端送 `use_sso:true`。
7. **專用腦選擇器**:對話頁上方,model 選擇器右邊的「No specialized brain」。
8. **專用腦／知識庫管理**:左下角**頭像** → 帳號選單 → **「Specialized Brains」**(僅 ADMIN+tars 可見)。
9. **Langflow project 探測**:後端啟動 log 應有 `[langflow/project] Discovered Langflow project id <uuid>`;接著 `[MCP][langflow] Tools: ...` 列出 flow 工具。
10. **Langflow agent**:endpoint 切 **Agents** → 應看到 `Langflow · <flow 名>`;內嵌頁開左側 rail 的 **Langflow**。
11. **Langflow 工具執行**:用某個 `Langflow · <flow>` agent 送一則訊息,應正常呼叫工具(若回 `Tool ..._mcp_langflow not found`,代表白名單沒生效 —— 見常見問題)。

---

## 9. 常見問題

- **「3080 看不到更新」** → 你看的是 production,改了前端要 `npm run frontend`(或 `cd client && npm run build`);日常開發改用 `:3090` dev。
- **「整個打不開 / 一直轉」** → 後端 `:3080` 沒在跑。`curl localhost:3080/health` 應回 `200`;不是就重開 `npm run backend(:dev)`。在「自己的終端機分頁」跑、別關分頁。
- **「改了還是舊的」** → 硬重新整理瀏覽器 **Cmd+Shift+R**(清掉舊 bundle 快取),或開無痕視窗。
- **「dev 改了 packages 沒反應」** → Vite 不自動重抓套件 dist:`build:該套件` 後**重啟 `frontend:dev`**(必要時先刪 `client/node_modules/.vite` 再重啟)。
- **「Specialized Brains 選單沒出現」** → 沒用 tars admin 帳號登入,或前端是舊 bundle(重建 + 硬重新整理)。
- **「Agents 選單看不到 Langflow agent」** → 多半是舊快取,硬重新整理 **Cmd+Shift+R**;並確認 endpoint 切到 **Agents 市場**(My Agents 只列自己擁有的)。
- **「內嵌 Langflow 頁面一片空白」** → Langflow 服務(`:7860`)沒跑,或被反向代理加了 `X-Frame-Options` 擋 iframe。
- **「`Tool <flow>_mcp_langflow not found` / `Domain no longer allowed`」** → `VITE_LANGFLOW_URL` 推導的 host 沒進 SSRF 白名單。確認 `.env` 有設 `VITE_LANGFLOW_URL` 且**重啟後端**(白名單在載入 app config 時注入);Docker 內跑後端要用 `host.docker.internal:7860`。
- **「Langflow agent 沒出現 / project 探測失敗」** → 開機時 Langflow 沒在線(探測在開機做一次),或 Langflow 有多個專案(探測放棄)。前者待 Langflow 起來後重啟後端;後者在 `.env` 設 `LANGFLOW_PROJECT_ID` 指定。
</content>
</invoke>
