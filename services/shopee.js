/**
 * shopee-vd-api — services/shopee.js
 *
 * Extrai a URL real (.mp4) de um vídeo da Shopee usando
 * Playwright com interceptação de rede em dois passos:
 *
 * Passo 1: Abre a URL original (ex: br.shp.ee/...) e captura
 *          qualquer URL de vídeo direto ou URL intermediária
 *          de share-video (sv.shopee.*).
 *
 * Passo 2: Se encontrou uma URL sv.shopee.*, abre essa página
 *          também e intercepta o .mp4 real do CDN.
 */

const { chromium } = require("playwright");

/* ── Configurações ─────────────────────────────────────── */

const TIMEOUT_MS = 35_000;

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

/* ── Detecção de URL de vídeo ──────────────────────────── */

/** URL direta de arquivo de vídeo (.mp4 ou CDN de vídeo) */
function isDirectMp4(url) {
  return (
    url.match(/\.mp4(\?|$)/) ||
    url.includes("video/tos") ||
    url.includes("v16-webapp") ||
    url.includes("v19-webapp") ||
    url.includes("tiktokcdn") ||
    (url.includes("akamaized") && url.includes("video")) ||
    (url.includes("cloudfront") && url.includes("video")) ||
    (url.includes("mms.") && url.includes(".mp4"))
  );
}

/** URL de share-video intermediária (sv.shopee.*) */
function isShareVideoUrl(url) {
  return url.includes("sv.shopee.") || url.includes("share-video");
}

/** Resposta JSON da API com dados de vídeo */
function isVideoApiJson(url) {
  return (
    url.includes("get_short_video") ||
    url.includes("short_video") ||
    url.includes("video/info") ||
    url.includes("reel") ||
    (url.includes("shopee") && (url.includes("feed") || url.includes("api")) && url.includes("video"))
  );
}

/* ── Extração recursiva de JSON ────────────────────────── */

function findInJson(obj, keys, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.startsWith("http") && v.length > 10) return v;
    if (typeof v === "number" && v > 0 && keys.includes("duration")) return v;
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "object") {
      const r = findInJson(v, keys, depth + 1);
      if (r !== null) return r;
    }
  }
  return null;
}

function findMp4InJson(obj, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.startsWith("http") &&
      (v.includes(".mp4") || v.includes("video") || v.includes("cdn"))) {
      return v;
    }
    if (typeof v === "object") {
      const r = findMp4InJson(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/* ── Criar browser context compartilhado ──────────────── */

async function createContext(browser) {
  const ctx = await browser.newContext({
    userAgent: randomUA(),
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1366, height: 768 },
    serviceWorkers: "block",
    extraHTTPHeaders: {
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
    },
  });

  // Bloquear recursos desnecessários para acelerar
  await ctx.route(/\.(woff2?|ttf|eot|svg)(\?.*)?$/, r => r.abort());
  await ctx.route(/(google-analytics|gtag|hotjar|facebook\.net|clarity\.ms)/, r => r.abort());

  return ctx;
}

/* ── Interceptar vídeo numa página ────────────────────── */

/**
 * Abre uma URL, intercepta a rede e retorna {videoUrl, thumbnail, title, duration, shareVideoUrl}
 * @param {object} context  Playwright BrowserContext
 * @param {string} url      URL a abrir
 * @param {boolean} isSecondPass  Se verdadeiro, não captura shareVideoUrl (evita loop)
 */
async function interceptPage(context, url, isSecondPass = false) {
  const page = await context.newPage();

  // Mascarar automação
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  let videoUrl     = null;
  let shareVideoUrl = null;
  let thumbnail    = null;
  let title        = null;
  let duration     = null;

  // Listener de rede
  page.on("response", async (response) => {
    const respUrl = response.url();
    const status  = response.status();

    // 1. MP4 direto
    if (!videoUrl && isDirectMp4(respUrl) && status >= 200 && status < 300) {
      videoUrl = respUrl.split("?")[0];
      console.log("[SW] MP4 direto capturado:", videoUrl.substring(0, 80));
      return;
    }

    // 2. share-video intermediário (sv.shopee.*) — só no primeiro passo
    if (!isSecondPass && !shareVideoUrl && isShareVideoUrl(respUrl)) {
      shareVideoUrl = respUrl;
      console.log("[SW] share-video intermediário capturado:", shareVideoUrl.substring(0, 80));
    }

    // 3. JSON da API de vídeo
    if (!videoUrl && isVideoApiJson(respUrl)) {
      try {
        const ct = response.headers()["content-type"] || "";
        if (!ct.includes("json")) return;
        const data = await response.json().catch(() => null);
        if (!data) return;

        console.log("[SW] API JSON interceptada:", respUrl.substring(0, 80));

        const mp4 = findMp4InJson(data);
        if (mp4) { videoUrl = mp4; console.log("[SW] videoUrl do JSON:", mp4.substring(0, 80)); }

        if (!thumbnail) thumbnail = findInJson(data, ["thumbnail", "thumb", "cover", "image_url", "cover_url"]);
        if (!title)     title     = findInJson(data, ["title", "video_title", "description", "content", "caption"]);
        if (!duration)  duration  = findInJson(data, ["duration", "video_duration", "length"]);
      } catch (_) {}
    }
  });

  try {
    console.log(`[SW] Abrindo: ${url.substring(0, 80)}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

    // Aguardar carregamento dinâmico
    await page.waitForTimeout(3500);
    await page.evaluate(() => window.scrollBy(0, 200)).catch(() => {});
    await page.waitForTimeout(1500);

    // Se ainda sem videoUrl, tenta extrair da DOM
    if (!videoUrl) {
      videoUrl = await extractFromDom(page);
      if (videoUrl) console.log("[SW] videoUrl da DOM:", videoUrl.substring(0, 80));
    }

    // Metadados da página
    if (!title) {
      const t = await page.title().catch(() => "");
      title = t.replace(/\s*[-|].*$/, "").trim() || null;
    }
    if (!thumbnail) {
      thumbnail = await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:image"]');
        return og?.content || null;
      }).catch(() => null);
    }

  } finally {
    await page.close();
  }

  return { videoUrl, shareVideoUrl, thumbnail, title, duration };
}

/* ── Extrair da DOM ────────────────────────────────────── */

async function extractFromDom(page) {
  return page.evaluate(() => {
    // __NEXT_DATA__
    try {
      const nd = window.__NEXT_DATA__;
      if (nd) {
        const s = JSON.stringify(nd);
        let m = s.match(/"(?:video_url|videoUrl|play_url|media_url|playUrl)"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/);
        if (m) return m[1];
        m = s.match(/"(https:[^"]*?(?:akamaized|cloudfront|cdn)[^"]*?\.mp4[^"]*)"/);
        if (m) return m[1];
      }
    } catch (_) {}

    // <video> tags
    for (const v of document.querySelectorAll("video[src], video source[src]")) {
      const src = v.src || v.getAttribute("src");
      if (src && src.startsWith("http")) return src;
    }

    // Scripts inline com .mp4
    for (const s of document.querySelectorAll("script:not([src])")) {
      const m = s.textContent?.match(/"(https:[^"]*\.mp4[^"]*)"/);
      if (m) return m[1];
    }

    return null;
  }).catch(() => null);
}

/* ── Função principal pública ──────────────────────────── */

/**
 * Extrai informações completas de um vídeo da Shopee.
 *
 * @param {string} shopeeUrl  URL da Shopee (curta ou completa)
 * @returns {Promise<{title, thumbnail, duration, videoUrl, pageUrl}>}
 */
async function extractShopeeVideo(shopeeUrl) {
  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
  const context = await createContext(browser);

  try {
    // ── Passo 1: Página original ──────────────────────────
    const pass1 = await interceptPage(context, shopeeUrl, false);

    let { videoUrl, thumbnail, title, duration } = pass1;
    const { shareVideoUrl } = pass1;
    const resolvedUrl = shopeeUrl;

    // ── Passo 2: Se encontrou share-video e ainda sem .mp4 ──
    if (!videoUrl && shareVideoUrl) {
      console.log("[SW] Passo 2 — abrindo share-video:", shareVideoUrl.substring(0, 80));
      const pass2 = await interceptPage(context, shareVideoUrl, true);

      videoUrl  = videoUrl  || pass2.videoUrl;
      thumbnail = thumbnail || pass2.thumbnail;
      title     = title     || pass2.title;
      duration  = duration  || pass2.duration;
    }

    if (!videoUrl) {
      throw new Error(
        "Não foi possível extrair o vídeo. " +
        "O vídeo pode ser privado, ter expirado, ou a Shopee pode estar bloqueando o acesso."
      );
    }

    return {
      title:     title     || "Vídeo da Shopee",
      thumbnail: thumbnail || null,
      duration:  typeof duration === "number" ? duration : null,
      videoUrl,
      pageUrl:   resolvedUrl,
    };

  } finally {
    await browser.close();
  }
}

module.exports = { extractShopeeVideo };
