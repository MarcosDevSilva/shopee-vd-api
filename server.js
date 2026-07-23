/**
 * shopee-vd-api — server.js
 *
 * Servidor Express principal.
 * Inicia na porta PORT (padrão 3001).
 *
 * Variáveis de ambiente:
 *   PORT              → porta do servidor (padrão: 3001)
 *   ALLOWED_ORIGINS   → origens CORS separadas por vírgula
 *                       (padrão: marcosdevsilva.github.io + localhost)
 */

const express      = require("express");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const videoRoutes  = require("./routes/video");

const app  = express();
const PORT = process.env.PORT || 3001;

/* ── Origens permitidas (CORS) ─────────────────────────── */

const defaultOrigins = [
  "https://marcosdevsilva.github.io",
  "http://localhost:8787",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
];

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : defaultOrigins;

/* ── Middlewares globais ────────────────────────────────── */

// CORS — permite apenas origens configuradas
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sem origin (ex: Postman, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS bloqueado para origem: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Parse JSON
app.use(express.json({ limit: "10kb" }));

// Rate limiting: máximo 20 req/minuto por IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Muitas requisições. Aguarde um momento e tente novamente.",
  },
});
app.use("/api/", limiter);

/* ── Rotas ─────────────────────────────────────────────── */

// Health check
app.get("/", (req, res) => {
  res.json({
    name:    "Shopee Video Downloader API",
    version: "1.0.0",
    status:  "online",
    time:    new Date().toISOString(),
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Rotas de vídeo
app.use("/api/video", videoRoutes);

/* ── Tratamento de erros global ─────────────────────────── */

app.use((err, req, res, next) => {
  console.error("[Server] Erro não tratado:", err.message);
  res.status(500).json({
    success: false,
    message: "Erro interno do servidor.",
  });
});

/* ── Inicialização ──────────────────────────────────────── */

app.listen(PORT, () => {
  console.log(`\n🚀 Shopee VD API rodando em http://localhost:${PORT}`);
  console.log(`   Origins permitidas: ${allowedOrigins.join(", ")}`);
  console.log(`   Pressione Ctrl+C para parar.\n`);
});
