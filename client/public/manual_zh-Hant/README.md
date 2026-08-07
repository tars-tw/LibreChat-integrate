# 操作手冊放置位置（繁體中文）

| 語系 | 目錄 | 對外網址 |
|------|------|----------|
| 繁體中文 | `client/public/manual_zh-Hant/` | `/manual_zh-Hant/index.html` |
| 英文 | `client/public/manual_en/` | `/manual_en/index.html` |

此資料夾**只**用來放「說明與常見問題」要顯示的靜態內容（pandoc / Word 輸出的 `index.html` 與搭配的 `media/` 圖片資料夾）。

## 更換／更新手冊時

1. 將輸出的主檔與資源資料夾**全部**覆蓋進對應語系目錄。
2. 主 HTML 一律命名為 **`index.html`**；圖片等資源使用**相對路徑**（例如 `./media/image1.png`），才能在子路徑部署下正常顯示。
3. 若要新增／修改語系對應規則，改 `client/src/utils/manual.ts` 的 `MANUAL_PATHS`。

## 運作方式

- Vite build 時 `client/public/` 會整包複製到 `client/dist/`，後端 `staticCache(paths.dist)` 直接提供服務，不需額外 nginx 或 express 設定。
- 選單入口在 `client/src/components/Nav/AccountSettings.tsx`（Help → 說明與常見問題），依使用者語系（`store.lang`）選擇手冊，開新分頁。
- 語系以 `zh-Hant` 開頭 → 中文手冊；其餘一律英文手冊。
- 若環境變數 `HELP_AND_FAQ_URL` 有明確設定（非預設的 `https://librechat.ai`），則改開該外部網址，不使用本地手冊。
- 這兩個目錄已排除在 PWA precache 之外（`client/vite.config.ts` 的 `globIgnores`），避免 service worker 預先下載近 88MB 的內容。

## 重新產生手冊時的注意事項

- 中英文兩份目錄**各自獨立**（文字與圖片都會不同），請分別更新，不要共用 `media/`。
- 手冊以「開新分頁」開啟，沒有可回上一頁的瀏覽歷史。pandoc 樣板產出的左側「返回」按鈕（`.manual-back-strip` / `.manual-back-btn`，呼叫 `history.back()`）在此情境下無作用，已從 `index.html` 移除；日後重新產生手冊後請一併移除。
