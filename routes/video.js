/**
 * shopee-vd-api — routes/video.js
 *
 * Endpoints:
 *   POST /api/video/info      → busca informações do vídeo
 *   POST /api/video/process   → processa + baixa o vídeo
 *   GET  /api/video/download/:id → envia o arquivo para o cliente
 */

const express  = require("express");
const fs       = require("fs");
const router   = express.Router();

const { extractShopeeVideo }    = require("../services/shopee");
const { downloadAndProcess, getFilePath } = require("../services/processor");

/* ── Cache simples em memória (evitar buscas duplicadas) ── */
const infoCache = new Map(); // url → data (TTL: 5min)
const TTL_MS    = 5 * 60 * 1000;

function cacheSet(key, value) {
  infoCache.set(key, { value, expires: Date.now() + TTL_MS });
}
function cacheGet(key) {
  const entry = infoCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { infoCache.delete(key); return null; }
  return entry.value;
}

/* ────────────────────────────────────────────────────────
   POST /api/video/info
   Body: { url: string }
   ────────────────────────────────────────────────────── */
router.post("/info", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, message: "URL não fornecida." });
  }

  // Verificar cache
  const cached = cacheGet(url);
  if (cached) {
    console.log("[/info] Retornando do cache:", url);
    return res.json(cached);
  }

  try {
    console.log("[/info] Extraindo informações de:", url);
    const data = await extractShopeeVideo(url);

    const response = {
      success:   true,
      id:        encodeURIComponent(url), // usado como referência no /process
      title:     data.title,
      thumbnail: data.thumbnail,
      duration:  data.duration,
      videoUrl:  data.videoUrl,
    };

    cacheSet(url, response);
    return res.json(response);

  } catch (err) {
    console.error("[/info] Erro:", err.message);
    return res.status(422).json({
      success: false,
      message: err.message || "Erro ao extrair informações do vídeo.",
    });
  }
});

/* ────────────────────────────────────────────────────────
   POST /api/video/process
   Body: { url: string, removeMetadata: boolean }
   ────────────────────────────────────────────────────── */
router.post("/process", async (req, res) => {
  const { url, removeMetadata = true } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, message: "URL não fornecida." });
  }

  try {
    console.log("[/process] Processando:", url, "| removeMetadata:", removeMetadata);

    // 1. Extrair URL do vídeo (usa cache se disponível)
    let videoUrl;
    const cached = cacheGet(url);
    if (cached?.videoUrl) {
      videoUrl = cached.videoUrl;
      console.log("[/process] videoUrl do cache:", videoUrl);
    } else {
      const data = await extractShopeeVideo(url);
      videoUrl = data.videoUrl;
    }

    // 2. Download + processamento
    const result = await downloadAndProcess(videoUrl, removeMetadata);

    return res.json({
      success:  true,
      id:       result.id,
      filename: result.filename,
    });

  } catch (err) {
    console.error("[/process] Erro:", err.message);
    return res.status(422).json({
      success: false,
      message: err.message || "Erro ao processar o vídeo.",
    });
  }
});

/* ────────────────────────────────────────────────────────
   GET /api/video/download/:id
   Envia o arquivo de vídeo e o deleta após o envio.
   ────────────────────────────────────────────────────── */
router.get("/download/:id", (req, res) => {
  const { id } = req.params;

  // Segurança: impede path traversal
  if (!/^[a-f0-9-]+$/.test(id)) {
    return res.status(400).json({ success: false, message: "ID inválido." });
  }

  const filePath = getFilePath(id);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: "Arquivo não encontrado. Processe o vídeo novamente.",
    });
  }

  console.log("[/download] Enviando arquivo:", filePath);

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="video-shopee.mp4"`);
  res.setHeader("Content-Length", fs.statSync(filePath).size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  // Deletar arquivo após o envio completo
  stream.on("end", () => {
    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }, 5000);
  });
});

module.exports = router;
