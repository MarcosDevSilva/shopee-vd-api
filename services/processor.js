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
 * Baixa o vídeo para o disco e, opcionalmente, remove metadados.
 *
 * @param {string}  videoUrl        URL direta do .mp4
 * @param {boolean} removeMetadata  Remover metadados com FFmpeg?
 * @returns {Promise<{ id, filePath, filename }>}
 */
async function downloadAndProcess(videoUrl, removeMetadata = true) {
  const id        = uuidv4();
  const rawPath   = path.join(TMP_DIR, `${id}_raw.mp4`);
  const finalPath = path.join(TMP_DIR, `${id}.mp4`);

  // 1. Download do vídeo
  console.log("[Processor] Baixando vídeo:", videoUrl);
  await downloadFile(videoUrl, rawPath);
  console.log("[Processor] Download concluído:", rawPath);

  // 2. Remoção de metadados
  if (removeMetadata && FFMPEG_AVAILABLE) {
    console.log("[Processor] Removendo metadados com FFmpeg…");
    await removeMetadataFFmpeg(rawPath, finalPath);
    fs.unlinkSync(rawPath); // deleta o raw
    console.log("[Processor] Metadados removidos:", finalPath);
  } else {
    // Se não tiver FFmpeg, apenas renomeia
    fs.renameSync(rawPath, finalPath);
    if (!FFMPEG_AVAILABLE && removeMetadata) {
      console.warn("[Processor] FFmpeg não disponível — metadados mantidos.");
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
 * Remove metadados usando FFmpeg:
 *   ffmpeg -i entrada.mp4 -map_metadata -1 -c copy saida.mp4
 *
 * -map_metadata -1  → descarta todos os metadados
 * -c copy           → copia streams sem recodificar (muito rápido)
 */
function removeMetadataFFmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath || "ffmpeg";
    const cmd = `"${bin}" -y -i "${inputPath}" -map_metadata -1 -c copy "${outputPath}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("[FFmpeg] Erro:", stderr);
        reject(new Error("Falha ao remover metadados com FFmpeg."));
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
