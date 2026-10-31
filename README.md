# Live Lyrics 滾動歌詞

純前端網頁程式（HTML + CSS + JavaScript），不需要安裝，也不需要後端。

## 功能

- **搜尋歌詞**：輸入歌名、歌手或一句歌詞搜尋（資料來源：[LRCLIB](https://lrclib.net)，免費、不需要 API 金鑰）。
- **語音搜尋**：按「🎤 用說的」直接說出歌名；說話時會出現語音面板，顯示聽到的內容，可直接切換「國語／粵語／英文／日文／韓文」。
- **簡體轉正體**：中文歌詞是簡體字時，自動轉成正體中文（台灣字形）顯示；英文、日文、韓文等其他語言不更動。
- **選歌即播放**：在搜尋結果點一首歌，歌詞就會從頭開始，跟著時間軸自動滾動。
- **滾動歌詞**：目前唱到的那一句會放大、發亮並置中；手動捲動時會暫停自動捲動 3 秒。
- **歌詞大小**：用 `A−`／`A+`、滑桿，或在歌詞區按 `Ctrl + 滾輪` 縮放（會記住設定）。
- **點歌詞跳播**：點任何一行歌詞，就會從那一段繼續播放。
- **歌詞時間**：覺得歌詞跟歌對不上，按右下角「慢一點」或「快一點」，每次調整 0.5 秒。
- **新手引導**：首頁有三步驟說明和範例歌曲，點一下就能試用。
- 快速鍵：`空白鍵` 播放／暫停，`←`／`→` 倒退／快轉 5 秒。

## 使用方式

直接用瀏覽器開啟 `index.html`，或用任一靜態伺服器：

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

> 語音輸入需使用 Chrome、Edge 或 Safari，並允許麥克風權限。
> Chrome 只在 `https://` 或 `http://localhost` 下才會開放麥克風，
> 建議用上面的方式啟動，或部署到 GitHub Pages。

## 連線說明

搜尋時會先直接連到 LRCLIB。如果被網路（例如公司防火牆）或瀏覽器擋住，會自動改用公開的中繼服務
（allorigins、corsproxy.io、codetabs）再試，並記住成功的路線。走中繼時，搜尋的關鍵字會經過這些第三方服務。

簡體轉正體使用 [opencc-js](https://github.com/nk2028/opencc-js)（從 jsDelivr 載入）。如果載入失敗，會直接顯示原本的歌詞。

## 加上網易雲音樂（NeteaseCloudMusicApi）

設定後，搜尋會**先找網易雲**，再找 LRCLIB；任一來源失敗時，仍會顯示另一個來源的結果。
網頁本身不包含網易雲服務，需要你自己執行 [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapienhanced/api-enhanced)（以下用社群維護的 api-enhanced 版本）。

### 1. 執行服務（擇一）

**Docker：**

```bash
docker run -d -p 3000:3000 --name ncm-api moefurina/ncm-api:latest
```

**Node.js（需要 Node.js 22 以上）：**

```bash
git clone https://github.com/neteasecloudmusicapienhanced/api-enhanced.git
cd api-enhanced
pnpm i        # 或 npm install
node app.js   # 預設在 http://localhost:3000
```

### 2. 在網頁上設定

打開 Live Lyrics → 左下角「⚙ 歌詞來源設定」→ 填入 `http://localhost:3000` → 按「儲存並測試」。
看到「✓ 連線成功」就完成了，之後搜尋會優先使用網易雲。

### 注意事項

- 網頁用到的只有 `/cloudsearch`（搜尋）和 `/lyric`（歌詞）兩個功能，不需要登入網易雲帳號。
- 從 `https://` 網址（例如 GitHub Pages）連到 `http://localhost:3000` 時，Chrome 可能會詢問是否允許存取「區域網路裝置」，請按允許。
  如果被擋，也可以在本機用 `python3 -m http.server 8000` 開啟網頁（網址 `http://localhost:8000`）。
- 服務架在海外主機（例如 Vercel）時，網易雲可能限制海外連線，在台灣的電腦上執行最穩定。
- NeteaseCloudMusicApi 是第三方非官方專案，不是網易官方提供的 API，僅建議用於個人研究與自用。
