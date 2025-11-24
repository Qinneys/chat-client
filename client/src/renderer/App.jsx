import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

const initialMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content: "你好，我是你的桌面助手，可以语音或文本与我对话。",
};

const roles = {
  user: { label: "你", color: "#2563eb" },
  assistant: { label: "AI", color: "#16a34a" },
};

const decodeStreamChunk = (chunk) => {
  const text = chunk.toString();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const deltas = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.replace(/^data:\s*/, "");
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      const delta =
        parsed?.choices?.[0]?.delta?.content ||
        parsed?.choices?.[0]?.message?.content ||
        "";
      if (delta) deltas.push(delta);
    } catch (err) {
      // swallow malformed chunk
    }
  }
  return deltas.join("");
};

const speak = (text) => {
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
};

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(
    localStorage.getItem("user")
      ? JSON.parse(localStorage.getItem("user"))
      : null
  );
  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const [backgroundReply, setBackgroundReply] = useState(false);
  const inputRef = useRef(null);
  const chatBottomRef = useRef(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (window.electronAPI?.onStartVoiceInput) {
      window.electronAPI.onStartVoiceInput(({ background }) => {
        setBackgroundReply(background);
        startRecording().catch(() => {});
      });
    }
    if (window.electronAPI?.onPlayDing) {
      window.electronAPI.onPlayDing(() => {
        window.electronAPI?.beep();
      });
    }
  }, []);

  const authedHeaders = useMemo(
    () =>
      token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {},
    [token]
  );

  const persistAuth = (userData, tokenValue) => {
    setUser(userData);
    setToken(tokenValue);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("token", tokenValue);
  };

  const handleAuth = async (mode) => {
    if (!email || !password) return;
    const res = await fetch(`${API_BASE}/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data?.token) {
      persistAuth(data.user, data.token);
    } else {
      alert(data.error || "认证失败");
    }
  };

  const startRecording = async () => {
    if (recording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      stream.getTracks().forEach((t) => t.stop());
      sendToWhisper(blob);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    inputRef.current?.focus();
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    setRecording(false);
  };

  const sendToWhisper = async (blob) => {
    if (!token) {
      alert("请先登录");
      return;
    }
    const form = new FormData();
    form.append("audio", blob, "audio.webm");
    const res = await fetch(`${API_BASE}/api/whisper`, {
      method: "POST",
      headers: { ...authedHeaders },
      body: form,
    });
    const data = await res.json();
    if (data?.text) {
      setInput((prev) => `${prev ? `${prev} ` : ""}${data.text}`);
      inputRef.current?.focus();
      if (backgroundReply) {
        handleSend(data.text, true);
      }
    } else {
      alert("语音识别失败");
    }
  };

  const handleSend = async (overrideText, speakBack = false) => {
    if (!token) {
      alert("请先登录");
      return;
    }
    const text = (overrideText ?? input).trim();
    if (!text) return;
    setInput("");
    setBackgroundReply(false);
    const userMessage = { id: `user-${Date.now()}`, role: "user", content: text };
    const assistantMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authedHeaders },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(({ role, content }) => ({
            role,
            content,
          })),
        }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += decodeStreamChunk(chunk);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id ? { ...m, content: full } : m
          )
        );
      }
      setLoading(false);
      if (speakBack) speak(full);
    } catch (err) {
      console.error(err);
      setLoading(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, content: "出错了，请稍后再试。" }
            : m
        )
      );
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken("");
    localStorage.removeItem("user");
    localStorage.removeItem("token");
  };

  const startCheckout = async () => {
    if (!token) return alert("请先登录");
    const res = await fetch(`${API_BASE}/api/payment/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authedHeaders },
    });
    const data = await res.json();
    if (data?.url) {
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(data.url);
      } else {
        window.open(data.url, "_blank");
      }
    }
  };

  const newChat = () => {
    setMessages([initialMessage]);
    setInput("");
  };

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Desktop Assistant</h1>
          <p>登录或注册后体验语音聊天与支付。</p>
          <div className="auth-toggle">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => setAuthMode("login")}
            >
              登录
            </button>
            <button
              className={authMode === "register" ? "active" : ""}
              onClick={() => setAuthMode("register")}
            >
              注册
            </button>
          </div>
          <input
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            placeholder="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={() => handleAuth(authMode)}>
            {authMode === "login" ? "登录" : "注册"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <aside className="sidebar">
        <button className="primary" onClick={newChat}>
          ＋ 新对话
        </button>
        <div className="sidebar-section">
          <div className="sidebar-title">账户</div>
          <div className="sidebar-item">{user.email}</div>
          <button onClick={startCheckout}>Stripe 订阅</button>
          <button onClick={handleLogout}>退出</button>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-title">快捷键</div>
          <div className="sidebar-item">唤醒并显示：Alt + Space</div>
          <div className="sidebar-item">后台语音：Alt + Shift + Space</div>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div>
            <div className="title">对话</div>
            <div className="subtitle">与桌面助手实时沟通，支持语音。</div>
          </div>
          <div className={`record-indicator ${recording ? "on" : ""}`}>
            ● 语音 {recording ? "录制中" : "待机"}
          </div>
        </header>

        <section className="messages">
          {messages.map((msg) => (
            <article key={msg.id} className="message">
              <div
                className="avatar"
                style={{ backgroundColor: roles[msg.role].color }}
              >
                {roles[msg.role].label}
              </div>
              <div className="bubble">
                <div className="bubble-header">{roles[msg.role].label}</div>
                <div className="bubble-body">{msg.content || "..."}</div>
              </div>
            </article>
          ))}
          <div ref={chatBottomRef} />
        </section>

        <section className="composer">
          <div className="composer-inner">
            <textarea
              ref={inputRef}
              placeholder={
                recording ? "录音中，按回车停止" : "输入消息，或使用快捷键语音"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (recording) {
                    stopRecording();
                  } else {
                    handleSend();
                  }
                }
              }}
              rows={3}
            />
            <div className="composer-actions">
              <button onClick={recording ? stopRecording : startRecording}>
                {recording ? "停止录音" : "🎤 语音"}
              </button>
              <button className="primary" onClick={() => handleSend()}>
                {loading ? "发送中..." : "发送"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
