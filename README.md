# 在途

面向同行旅行者的共享行程、随手记账与旅途照片应用。

## 功能

- 按旅行日期横向浏览多日行程，一次导入多天计划
- 将导入地点生成高德路线地图，支持步行/驾车切换与轨迹播放
- 交通、住宿、餐饮、门票和其他开销实时汇总
- 账单记录修改、删除与同行成员同步
- 手机原图自动压缩后上传，支持多图邮票墙和单张删除
- 将随拍与每日行程生成 PNG 打卡长图
- 将当前旅程保存为可再次打开的历史快照

## 在线存储

- Neon Postgres 保存旅程、日期、日程、账单、照片元数据和历史快照
- Vercel Blob 保存用户上传的照片文件
- 页面每 5 秒刷新共享状态，写入成功后立即刷新当前页面
- 当前版本使用共享旅程码 `TRIP-START`，适合同一组同行者使用

## 本地运行

需要 Node.js `>=22.13.0`。复制 `.env.example` 为 `.env.local`，填入 Neon 和 Vercel Blob 提供的环境变量，然后运行：

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/`。

## 部署到 Vercel

1. 在 Vercel 导入 GitHub 仓库 `su1102yan02-hub/traveling`。
2. 在项目的 Storage 页面添加 Neon Postgres，确认生成 `DATABASE_URL`。
3. 添加 Vercel Blob，确认生成 `BLOB_READ_WRITE_TOKEN`。
4. 在高德开放平台分别创建“Web端（JS API）”与“Web服务”Key，并在 Vercel 添加：
   - `NEXT_PUBLIC_AMAP_JS_KEY`
   - `NEXT_PUBLIC_AMAP_SECURITY_CODE`
   - `AMAP_WEB_SERVICE_KEY`
5. 重新部署项目。首次访问 API 时会自动初始化数据库表。

## 验证

```bash
npm run build
npm test
```
