/**
 * shopee-vd-api — services/processor.js
 *
 * Baixa o vídeo e (opcionalmente) remove metadados com FFmpeg.
 * Os arquivos ficam em /tmp/videos/ e são deletados após o download.
 */

const fs      = require("fs");
const path    = require("path");
const axios   = require("axios");
const { exec } = require("child_process");
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
 * Processa o vídeo com FFmpeg:
 * - remove metadados (-map_metadata -1)
 * - corta marcas d'água de topo/rodapé (-vf crop=...)
 * - ajusta a resolução final (ex: 720x1080)
 */
function processVideoFFmpeg(inputPath, outputPath, opts) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath || "ffmpeg";
    const filters = [];

    // 1. Limpar marca d'água (Corta topo 12% e rodapé 12% onde ficam a logo Shopee e afiliado)
    if (opts.cleanWatermark) {
      filters.push("crop=in_w:in_h*0.76:0:in_h*0.12");
    }

    // 2. Formatar resolução (ex: 720x1080)
    if (opts.formatResolution) {
      const w = opts.targetWidth || 720;
      const h = opts.targetHeight || 1080;
      filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
      filters.push(`crop=${w}:${h}`);
      filters.push("setsar=1");
    }

    const vfFlag = filters.length > 0 ? `-vf "${filters.join(",")}"` : "";
    const metaFlag = opts.removeMetadata ? "-map_metadata -1" : "";

    // Se não houver filtros de vídeo, copia os fluxos direto sem recodificar
    const codecFlags = filters.length > 0
      ? "-c:v libx264 -preset superfast -crf 20 -c:a copy -pix_fmt yuv420p"
      : "-c copy";

    const cmd = `"${bin}" -y -i "${inputPath}" ${metaFlag} ${vfFlag} ${codecFlags} "${outputPath}"`;
    console.log("[FFmpeg] Executando:", cmd);

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("[FFmpeg] Erro no processamento principal:", stderr);
        // Fallback: se "-c:a copy" falhar devido à incompatibilidade de áudio, recodifica o áudio em AAC
        if (filters.length > 0 && codecFlags.includes("-c:a copy")) {
          console.log("[FFmpeg] Tentando fallback recodificando áudio para AAC…");
          const fallbackCodecFlags = "-c:v libx264 -preset superfast -crf 20 -c:a aac -b:a 128k -pix_fmt yuv420p";
          const fallbackCmd = `"${bin}" -y -i "${inputPath}" ${metaFlag} ${vfFlag} ${fallbackCodecFlags} "${outputPath}"`;
          exec(fallbackCmd, (err2, stdout2, stderr2) => {
            if (err2) {
              console.error("[FFmpeg] Erro no fallback:", stderr2);
              reject(new Error("Falha ao processar vídeo com FFmpeg."));
            } else {
              resolve();
            }
          });
        } else {
          reject(new Error("Falha ao processar vídeo com FFmpeg."));
        }
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

