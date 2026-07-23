# Shopee VD API

Backend Node.js para o [Shopee Video Downloader](https://marcosdevsilva.github.io/).  
Extrai vídeos públicos da Shopee usando Playwright e, opcionalmente, remove metadados com FFmpeg.

---

## Requisitos

- **Node.js** 18+
- **FFmpeg** instalado no sistema (opcional — só necessário para remoção de metadados)

### Instalar FFmpeg

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS (Homebrew)
brew install ffmpeg

# Windows (via Chocolatey)
choco install ffmpeg

# Render.com — adicione ao Dockerfile ou use buildpack
```

---

## Rodar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Instalar o navegador do Playwright
npx playwright install chromium

# 3. Iniciar o servidor
npm start
# ou em modo dev (hot reload):
npm run dev
```

O servidor sobe em `http://localhost:3001`.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta do servidor |
| `ALLOWED_ORIGINS` | GitHub Pages + localhost | Origens CORS permitidas |

Exemplo de `.env`:
```
PORT=3001
ALLOWED_ORIGINS=https://marcosdevsilva.github.io,http://localhost:8787
```

---

## Endpoints

### `GET /`
Health check — retorna status e versão.

### `POST /api/video/info`
Extrai informações do vídeo.

**Body:**
```json
{ "url": "https://br.shp.ee/vjf13l0a" }
```

**Resposta:**
```json
{
  "success": true,
  "id": "...",
  "title": "Nome do vídeo",
  "thumbnail": "https://...",
  "duration": 28,
  "videoUrl": "https://...cdn.mp4"
}
```

### `POST /api/video/process`
Baixa e processa o vídeo.

**Body:**
```json
{ "url": "https://br.shp.ee/vjf13l0a", "removeMetadata": true }
```

**Resposta:**
```json
{ "success": true, "id": "uuid-aqui", "filename": "video-shopee.mp4" }
```

### `GET /api/video/download/:id`
Retorna o arquivo `.mp4` para download. O arquivo é deletado do servidor após o envio.

---

## Deploy no Render.com (gratuito)

1. Crie uma conta em [render.com](https://render.com)
2. **New → Web Service → Connect a repository**
3. Aponte para este repositório
4. Configure:
   - **Build Command:** `npm install && npx playwright install chromium`
   - **Start Command:** `npm start`
   - **Environment:** `Node`
5. Adicione a variável de ambiente:
   - `ALLOWED_ORIGINS` = `https://marcosdevsilva.github.io`
6. Clique em **Create Web Service**
7. Anote a URL gerada (ex: `https://shopee-vd-api.onrender.com`)
8. Atualize o frontend ([script.js](https://github.com/MarcosDevSilva/MarcosDevSilva.github.io/blob/main/script.js)):
   ```js
   const API_BASE_URL = "https://shopee-vd-api.onrender.com";
   const DEMO_MODE    = false;
   ```

> ⚠️ No plano gratuito do Render, o servidor "dorme" após 15 min sem uso.
> A primeira requisição pode demorar ~30s para acordar.

---

## Como funciona a extração

```
URL da Shopee (curta ou completa)
        ↓
Playwright abre o navegador headless
        ↓
Intercepta requisições de rede em busca do .mp4
        ↓
Extrai URL do vídeo (CDN da Shopee)
        ↓
Baixa o arquivo no servidor
        ↓
(Opcional) FFmpeg remove metadados
        ↓
Serve o arquivo para download
```

---

## Aviso legal

Use apenas para vídeos públicos que você tem autorização de baixar.  
Este projeto é open-source para fins educacionais e não se responsabiliza pelo uso indevido.
