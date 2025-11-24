import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import multer from "multer";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const upload = multer();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";

app.use(cors());
app.use("/api/payment/webhook", express.raw({ type: "*/*" }));
app.use(express.json({ limit: "15mb" }));

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });
  const [, token] = header.split(" ");
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

const createToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });

app.get("/", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(400).json({ error: "User already exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, passwordHash } });
  res.json({ token: createToken(user), user: { id: user.id, email } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ token: createToken(user), user: { id: user.id, email } });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ user: { id: user.id, email: user.email } });
});

app.post("/api/chat", authMiddleware, async (req, res) => {
  const { messages, model } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array required" });
  }

  const controller = new AbortController();
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  try {
    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": FRONTEND_URL,
          "X-Title": "Desktop Assistant",
        },
        body: JSON.stringify({
          model: model || OPENROUTER_MODEL,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      }
    );

    upstream.body.on("data", (chunk) => {
      res.write(chunk);
    });

    upstream.body.on("end", () => {
      res.end();
    });

    req.on("close", () => {
      controller.abort();
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to stream completion" });
  }
});

app.post("/api/whisper", authMiddleware, upload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Audio file required" });
  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([file.buffer], { type: file.mimetype || "audio/webm" }),
      file.originalname || "audio.webm"
    );
    formData.append("model", "whisper-1");

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(500).json({ error: text });
    }
    const data = await upstream.json();
    res.json({ text: data.text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Whisper transcription failed" });
  }
});

app.post(
  "/api/payment/create-checkout-session",
  authMiddleware,
  async (_req, res) => {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: process.env.STRIPE_PRICE_ID,
            quantity: 1,
          },
        ],
        success_url: `${FRONTEND_URL}/success`,
        cancel_url: `${FRONTEND_URL}/billing`,
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Stripe checkout failed" });
    }
  }
);

app.post("/api/payment/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  // TODO: mark subscription status in DB (stub only)
  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
