# Shotbeam

Локальная студия коротких видео (Reels / Shorts / TikTok), которой управляет Claude через MCP.
Медиатека из локальных папок и Google Drive for Desktop, поиск «сочных» моментов, разбор
референсов по ссылкам, форматы-шаблоны, озвучка (Fish Audio API / локальный Fish / Kokoro /
Chatterbox), моушн (HyperFrames / Remotion), монтаж на таймлайне и рендер в ffmpeg.

Концепция и решения: [docs/CONCEPT.md](docs/CONCEPT.md).

## Что нужно

- Node 24+, pnpm, ffmpeg и ffprobe в PATH
- Python 3.10–3.12 (локальные модели ставятся из приложения: Настройки → Локальные модели)
- Для десктопа: Rust (stable) и WebView2 (в Windows 11 уже есть)

## Запуск

```bash
pnpm install
```

Браузерная версия (движок + UI на http://localhost:5180):

```bash
pnpm dev
```

Десктоп (окно Tauri; движок запускается сам):

```bash
pnpm dev:desktop
```

## Подключить к Claude

```bash
claude mcp add --scope user shotbeam -- node D:/prjoects/shotbeam/apps/mcp/bin/shotbeam-mcp.mjs
```

Библиотека (база, превью, голоса, рендеры) лежит там, куда указывает `~/.shotbeam.json`.
