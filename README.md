# 页间：团队读书打卡 MVP

统一后的单体应用：浏览器只访问同源 Express API，数据保存在服务器文件中，AI 请求由服务器代理。旧 `docs/` GitHub Pages/Gist 实现已移除，浏览器没有 GitHub Token、共享 AI Key 或管理员密码的配置入口。

## 本地运行

需要 Node.js 18+（推荐 22）。

```bash
npm ci
ADMIN_PASSWORD='仅用于本地测试的密码' npm start
```

访问 <http://localhost:3000>。首次启动且没有 `data.json` 时，界面读取 `sample-data.json`；第一次写入后会创建 `data.json`。运行测试：`npm test`。

当前本地工作副本已导入授权的迁移数据：381 条记录、5 个真实分组、20 名成员和 25 张图片。`data.json` 与 `data/images/` 均被 `.gitignore` 排除，不应提交、打包、上传或分享。图片已改写为同源 `/media/<文件名>`，不再访问旧 GitHub/CDN。

## 环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 默认 `3000` |
| `DATA_FILE` | 生产建议 | 持久化 JSON 文件的绝对路径 |
| `MEDIA_DIR` | 生产建议 | 图片目录，默认项目内 `data/images` |
| `ADMIN_PASSWORD` | 管理操作必需 | 只供管理 API 的 `x-admin-password` 请求头使用；MVP 不在 UI 暴露管理入口 |
| `AI_API_KEY` | AI 功能必需 | 只在服务端读取，绝不返回浏览器 |
| `AI_BASE_URL` | 否 | OpenAI 兼容接口，默认 `https://api.openai.com/v1` |
| `AI_MODEL` | 否 | 默认 `gpt-4.1-mini` |

不要把 `.env`、密钥或生产 `data.json` 提交到仓库。若平台支持 secret manager，应在那里配置变量。

## API 与限制

- `GET /api/health`、`GET /api/records`、`POST /api/checkin`、`POST /api/ai-feedback`
- `DELETE /api/records/:name/:day`、`POST /api/reset`、`GET /api/export` 需 `x-admin-password`

图片以受限 Data URL 暂存于 JSON，MVP 限制 2MB。人数或图片量增长后，应迁移到对象存储并在记录中只保存 URL。当前文件存储适合小团队单实例；多实例部署前应迁移到数据库，并增加成员登录、角色权限、速率限制、CSRF 防护、AI 配额与审计日志。

## 生产数据迁移

导出包已脱敏，因此本项目没有也不能自动恢复真实成员、记录、图片或配置。

1. 在隔离环境从旧系统导出 `data.json`，不要把 Token 或 AI 配置字段带入新文件。
2. 转换为 `{ "records": [...] }`；每条只保留 `key/name/day/text/image/feedback/time`，人工抽检编码与时间戳。
3. 先备份生产数据，再把清洗后的文件放到持久卷，通过 `DATA_FILE` 指向它；不要依赖平台临时文件系统。
4. 将旧 Base64 图片迁移到受控对象存储，替换为 URL；先确认成员授权与数据保留期限。
5. 用部署平台 Secret 管理配置 `ADMIN_PASSWORD` 和可选 AI 变量。不要放进前端、Git、Gist、Dockerfile 或部署清单。
6. 灰度核对记录数量、随机样本、移动端打卡和导出，再把旧 Pages 入口重定向到新服务，最后撤销旧 GitHub Token/Gist 权限。

## Docker / Render

```bash
docker build -t reading-checkin .
docker run --rm -p 3000:3000 -e ADMIN_PASSWORD='安全注入' \
  -e DATA_FILE=/data/data.json -v reading-data:/data reading-checkin
```

`render.yaml` 可创建服务，但仍需配置持久盘和环境变量。本次交付未执行部署或外部写入。

生产上线时必须把 `data.json` 与图片放入受控持久存储：单实例可将同一持久卷分别映射给 `DATA_FILE` 和 `MEDIA_DIR`；多实例建议把记录迁入数据库、图片迁入带访问控制的对象存储。迁移前确认成员授权、访问权限、备份与删除策略。

## Vercel 部署（免费、无需绑卡）

Vercel 文件系统只读，因此本仓库同时提供两种运行方式：`server.js`（Render / Docker，本地文件持久盘）与 `api/index.mjs`（Vercel Serverless Function，数据存 Vercel KV、图片存 Vercel Blob）。前端 `public/index.html` 两者通用，无需改动。

### 1. 准备存储
在 Vercel 控制台创建两个资源（Hobby 免费额度内）：
- **KV**：Store → Create → 记下 `KV_REST_API_URL` 与 `KV_REST_API_TOKEN`
- **Blob**：Storage → Create Blob Store → 记下 `BLOB_READ_WRITE_TOKEN`

### 2. 导入并配置
- New → Project → Import Git Repository → 选 `reading-checkin-server`
- Framework Preset 选 `Other`，Build Command `npm install`，Output 留空（Vercel 自动识别 `api/` 与 `public/`）
- Environment Variables 填：
  - `ADMIN_PASSWORD`、`AI_API_KEY`（AI Key 非 OpenAI 官方时再加 `AI_BASE_URL`、`AI_MODEL`）
  - `KV_REST_API_URL`、`KV_REST_API_TOKEN`、`BLOB_READ_WRITE_TOKEN`

### 3. Deploy
点 Deploy。首次冷启动会自动把仓库内置 `data.json`（381 条）与 `data/images`（25 张）迁移进 KV + Blob，并把记录里的 `/media/xxx.png` 替换为 Blob 公网 URL。

### 4. 验证
部署后访问 `https://<你的项目>.vercel.app/api/health` 应返回 `{"ok":true,...}`；`/api/records` 应为 381 条；历史图片经 Blob URL 可访问。

> 注意：Vercel Function 每次冷启动最多 60s（已在 vercel.json 配置），种子迁移（上传 25 图）只在 KV 为空时发生一次。
