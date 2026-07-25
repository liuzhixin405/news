# 把后端部署到 Cloudflare Worker（零依赖，两种方式）

> 说明：Workers 不是 Node 环境，跑不了 Express / rss-parser / article-extractor，
> 所以这是把原 `backend/server.js` 逻辑**改写成的 Worker 版**（`worker.js`），功能一致：
> 聚合多源、RSSHub 全文、缓存、正文提取、CORS。**零依赖、单文件**，可直接粘贴部署。

## 方式一：网页编辑器粘贴（最快，无需装任何东西）

1. 登录 https://dash.cloudflare.com → 左侧 **Workers & Pages**
2. **Create application → Create Worker** → 起个名字（如 `news-hub-api`）→ **Deploy**
3. 进入该 Worker → **Edit code**，把编辑器里默认代码**全删**，粘贴 `worker.js` 全部内容 → **Deploy**
4. 部署后得到地址：`https://news-hub-api.你的子域.workers.dev`
5. （可选）Worker → **Settings → Variables** 里加：
   - `RSSHUB_BASE`、`SIXTY_BASE`、`ALLOW_ORIGIN`（不加则用代码里的默认值）

验证：浏览器打开
```
https://news-hub-api.你的子域.workers.dev/api/news?cat=dev
```
能看到 JSON 即成功。

## 方式一·B：用 GitHub 仓库部署（新版界面推荐，push 即自动部署）

新版 Create Worker 若只给"导入 Git 仓库 / 选模板"，就走这条：

1. **建仓库**：在 GitHub 新建一个仓库（如 `news-hub-worker`，可设为 Private），把这三个文件放到仓库**根目录**：
   - `worker.js`
   - `wrangler.toml`
   - `package.json`
   > 不会用 git 也行：GitHub 仓库页 → **Add file → Upload files** → 把三个文件拖进去 → Commit。
2. **连接**：Cloudflare → Workers & Pages → **Create → Workers → Import a repository（连接 Git）** → 授权 GitHub → 选中该仓库。
3. **构建设置**（关键，别填错）：
   - Project/根目录：`/`（若文件放在子目录，就填那个子目录）
   - Build command（构建命令）：**留空**
   - Deploy command（部署命令）：`npx wrangler deploy`
4. **Save and Deploy**。首次会拉代码并部署，完成后给出 `https://news-hub-api.你的子域.workers.dev`。
5. 以后改代码 → `git push`（或在 GitHub 网页改文件 Commit）→ Cloudflare 自动重新部署。

> 环境变量（`RSSHUB_BASE` 等）：部署后在 Worker → **Settings → Variables** 里加；`wrangler.toml` 里的 `[vars]` 也会生效。

## 方式二：命令行 wrangler（适合改动/上仓库）

```bash
npm install -g wrangler
wrangler login                 # 浏览器授权
# 把 worker.js 和 wrangler.toml 放同一目录
wrangler deploy
```

## 前端对接

把 `frontend/index.html` 顶部的 `API_BASE` 改成你的 Worker 地址：

```js
const API_BASE = "https://news-hub-api.你的子域.workers.dev";
```

前端仍托管在 Cloudflare Pages。因为 Worker 已开 CORS（`ALLOW_ORIGIN`），跨域没问题；把 `ALLOW_ORIGIN` 设成你的 Pages 域名更安全。

## 能力与限制（相对服务器版）

| 能力 | Worker 版 | 说明 |
|---|---|---|
| 多源聚合 / 去重 / 排序 | ✅ | 一致 |
| RSSHub 全文 → 站内阅读 | ✅ | 依赖 RSSHub 可达 |
| 正文提取 `/api/article` | ✅（轻量正则版） | 无 jsdom，效果比服务器版略弱 |
| 无头浏览器抓 JS 渲染页 | ❌ | Workers 不支持，需服务器 |
| 缓存 | ✅（isolate 内存 + 边缘缓存） | 想跨实例持久可接 KV |
| 每天请求量 | 免费 10 万次 | 内部用足够 |

> 注意：Workers 跑在海外边缘节点，个别国内源可能抓取慢或受限；若发现某些源在 Worker 上取不到，
> 就把 `RSSHUB_BASE` 指向一台自托管 RSSHub（服务器版）来兜底。
