# Desktop Voice Assistant

桌面端 Electron + React 客户端，Node.js (Express + Prisma + Stripe) 后端。支持 OpenRouter 流式对话、Whisper 语音转文字、快捷键唤醒。

## 开发

1. 后端
   ```bash
   cd backend
   cp .env.example .env
   # 配置 DATABASE_URL / OPENROUTER_API_KEY / OPENAI_API_KEY / STRIPE_*
   npm install
   npx prisma generate
   npm run dev
   ```
2. 客户端
   ```bash
   cd client
   npm install
   npm run dev
   ```
   Electron 会在 Vite 启动后自动打开。默认快捷键：`Alt + Space` 唤醒并显示窗口、`Alt + Shift + Space` 后台语音模式。

## 部署（后端）
- Render 上创建 Node 服务，运行 `npm install && npm run start`。
- Render PostgreSQL 连接串填入 `DATABASE_URL`，在部署前执行 `npx prisma migrate deploy`。
- 配置环境变量：`OPENROUTER_API_KEY`、`OPENAI_API_KEY`、`STRIPE_SECRET_KEY`、`STRIPE_PRICE_ID`、`STRIPE_WEBHOOK_SECRET`、`JWT_SECRET`、`FRONTEND_URL`。
- Stripe Webhook 指向 `<backend-url>/api/payment/webhook`。

## 功能对照
- 流式聊天：`POST /api/chat` 代理 OpenRouter。
- 语音输入：前端使用 `MediaRecorder`，后端 `POST /api/whisper` 调用 OpenAI Whisper。
- 快捷键：Electron 全局快捷键，唤醒时 beep 提示；后台模式自动朗读回复。
- 登录注册：JWT + Prisma 用户表。
- 支付：Stripe Checkout 会话创建及 webhook 验签（留有 DB 更新 TODO）。
