/**
 * shopee-vd-api — services/processor.js
 *
 * Baixa o vídeo e (opcionalmente) remove metadados com FFmpeg.
 * Os arquivos ficam em /tmp/videos/ e são deletados após o download.
 */

const fs      = require("fs");
const path    = require("path");
const axios   = require("axios");
const { exec, execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");

/* ── Diretório temporário ─────────────────────────────── */

const TMP_DIR = path.join(__dirname, "..", "tmp", "videos");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const ffmpegPath = require("ffmpeg-static");

/* ── Verificar se FFmpeg está disponível ─────────────── */

let FFMPEG_AVAILABLE = !!ffmpegPath;
if (!FFMPEG_AVAILABLE) {
  exec("ffmpeg -version", (err) => {
    FFMPEG_AVAILABLE = !err;
    console.log(`[Processor] FFmpeg via sistema disponível: ${FFMPEG_AVAILABLE}`);
  });
} else {
  console.log(`[Processor] FFmpeg via ffmpeg-static ativo: ${ffmpegPath}`);
}


/* ── Download do vídeo ────────────────────────────────── */

/**
 * Baixa o vídeo para o disco e, opcionalmente, processa metadados, marcas d'água e resolução.
 *
 * @param {string}         videoUrl URL direta do .mp4
 * @param {object|boolean} options  Opções de processamento
 * @returns {Promise<{ id, filePath, filename }>}
 */
async function downloadAndProcess(videoUrl, options = {}) {
  const id        = uuidv4();
  const rawPath   = path.join(TMP_DIR, `${id}_raw.mp4`);
  const finalPath = path.join(TMP_DIR, `${id}.mp4`);

  const opts = typeof options === "boolean"
    ? { removeMetadata: options, cleanWatermark: true, formatResolution: true }
    : { removeMetadata: true, cleanWatermark: true, formatResolution: true, targetWidth: 720, targetHeight: 1080, ...options };

  // 1. Download do vídeo
  console.log("[Processor] Baixando vídeo:", videoUrl);
  await downloadFile(videoUrl, rawPath);
  console.log("[Processor] Download concluído:", rawPath);

  // 2. Processamento com FFmpeg (metadados, marcas d'água, resolução)
  const needsFFmpeg = opts.removeMetadata || opts.cleanWatermark || opts.formatResolution;

  if (needsFFmpeg && FFMPEG_AVAILABLE) {
    console.log("[Processor] Processando vídeo com FFmpeg…", opts);
    await processVideoFFmpeg(rawPath, finalPath, opts);
    try { fs.unlinkSync(rawPath); } catch (_) {}
    console.log("[Processor] Vídeo processado com sucesso:", finalPath);
  } else {
    // Se não necessitar de FFmpeg ou FFmpeg não estiver disponível
    fs.renameSync(rawPath, finalPath);
    if (!FFMPEG_AVAILABLE && needsFFmpeg) {
      console.warn("[Processor] FFmpeg não disponível — alterações de vídeo mantidas no formato original.");
    }
  }

  // 3. Agendar limpeza do arquivo após 10 minutos
  setTimeout(() => {
    try {
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
        console.log("[Processor] Arquivo temporário removido:", finalPath);
      }
    } catch (_) {}
  }, 10 * 60 * 1000);

  return {
    id,
    filePath: finalPath,
    filename: "video-shopee.mp4",
  };
}

/* ── Helpers ──────────────────────────────────────────── */

/**
 * Baixa um arquivo de uma URL para um caminho local
 * usando streaming (sem carregar tudo na memória).
 */
async function downloadFile(url, destPath) {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 60_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: "https://shopee.com.br/",
    },
    maxRedirects: 5,
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

/**
 * Processa o vídeo com FFmpeg usando execFile (sem shell):
 * - remove metadados (-map_metadata -1)
 * - corta marcas d'água de topo/rodapé
 * - ajusta resolução sem zoom (scale + pad)
 */
function processVideoFFmpeg(inputPath, outputPath, opts) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath || "ffmpeg";
    const filters = [];

    // ── 1. Remover marcas d'água ──────────────────────────────
    // Remove 10% do topo (logo Shopee) e 12% do rodapé (afiliado)
    if (opts.cleanWatermark) {
      filters.push("crop=in_w:in_h*0.78:0:in_h*0.10");
    }

    // ── 2. Ajustar resolução sem zoom (scale + pad) ───────────
    // scale=720:-2  → escala pela largura, mantém proporção
    // pad=720:1080  → centraliza verticalmente com barras pretas
    if (opts.formatResolution) {
      const w = opts.targetWidth  || 720;
      const h = opts.targetHeight || 1080;
      filters.push(`scale=${w}:-2`);
      filters.push(`pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`);
      filters.push("setsar=1");
    }

    // Monta args como array (sem shell — sem bugs de escape)
    const args = ["-y", "-i", inputPath];

    if (opts.removeMetadata) {
      args.push("-map_metadata", "-1");
    }

    if (filters.length > 0) {
      args.push("-vf", filters.join(","));
      args.push("-c:v", "libx264", "-preset", "superfast", "-crf", "20");
      args.push("-c:a", "aac", "-b:a", "128k");
      args.push("-pix_fmt", "yuv420p");
    } else {
      args.push("-c", "copy");
    }

    args.push(outputPath);

    console.log("[FFmpeg] Executando:", bin, args.join(" "));

    execFile(bin, args, { maxBuffer: 100 * 1024 * 1024, timeout: 180_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("[FFmpeg] Erro:\n", stderr?.slice(-2000));
        reject(new Error("Falha ao processar vídeo com FFmpeg: " + (stderr?.slice(-400) || err.message)));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Retorna o caminho do arquivo pelo ID
 */
function getFilePath(id) {
  return path.join(TMP_DIR, `${id}.mp4`);
}

module.exports = { downloadAndProcess, getFilePath };

