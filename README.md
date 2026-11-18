# 💣 MINESWEEPER

### *WebMCP Edition — Play with mouse, keyboard, or let an AI drive*

![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)
![React](https://img.shields.io/badge/React-19.2-blue)
![Vite](https://img.shields.io/badge/Vite-8.0-646cff)

---

## 🎮 Overview

A fully-featured Minesweeper clone supercharged with **WebMCP** AI agent integration. Not only can you play the classic game, but you can also chat with an AI assistant that analyzes the board and plays moves for you — or explains its reasoning!

Built with **React 19**, **TypeScript**, and **Vite** for a blazing-fast, modern experience.

---

## ✨ Features

### 🕹️ Multiple Input Methods

| Input | Action |
|-------|--------|
| `← ↑ ↓ →` | Move cursor around the board |
| `Space` / `↵` | Reveal the current cell |
| `F` | Toggle flag on the current cell |
| `C` | Chord (reveal neighbors if flags match) |
| `N` | Start a new game |
| `right-click` | Flag a cell |
| `middle-click` | Chord a cell |

### 🎯 Difficulty Levels

| Level | Grid | 💣 Mines |
|-------|------|----------|
| 🌱 Beginner | 9×9 | 10 |
| 🟡 Intermediate | 16×16 | 40 |
| 🔴 Expert | 16×30 | 99 |
| ⚙️ Custom | 5-30 × 5-40 | Configurable |

### 🤖 AI Assistant

The built-in AI chat can:
- 💬 Analyze the current board state
- 🎯 Suggest and execute the safest moves
- 🚩 Flag obvious mines
- 🧠 Explain its reasoning step-by-step

> **Note:** Requires Chrome with the Prompt API enabled

### 🧰 WebMCP Agent Tools

The page registers nine client-side WebMCP tools for browser agents via
`document.modelContext`. Browsers without native WebMCP are covered by the
official W3C polyfill ([`@w3c/webmcp-polyfill`](https://www.npmjs.com/package/@w3c/webmcp-polyfill)),
so the tools register in any modern browser served over HTTPS or localhost —
native Chrome support (146+, `chrome://flags/#enable-webmcp-testing`) is used
when present and never overridden.

| Tool | Purpose |
|------|---------|
| `get_game_rules` | Learn the objective, coordinates, cell states, actions, and win/loss rules |
| `get_play_strategy` | Learn forced-move deductions, safe chording, and risk-minimizing strategy |
| `analyze_board` | Get one read-only, deduction-backed move or a clearly labeled lowest-risk guess |
| `start_new_game` | Start a preset or custom game |
| `reveal_cell` | Reveal one hidden cell |
| `toggle_flag` | Add or remove a flag |
| `chord_cell` | Reveal neighbors around a satisfied numbered cell |
| `get_board_state` | Read the complete public board |
| `get_game_status` | Read a compact status summary |

A playing agent can call `get_game_rules` and `get_play_strategy` once, start a
game, then repeat `analyze_board` → the recommended action tool →
`get_game_status` until the game is won or lost. `analyze_board` never changes
the board and never reads hidden mine locations.

### 🏆 Personal Bests

Best times are saved to local storage for each difficulty level. Can you beat your records?

### 📜 Action Log

Every move is logged with source attribution (👤 human or 🤖 agent) so you can trace exactly what happened.

---

## 🌐 Live Demo

Play it right now: **https://puppo.github.io/minesweeper/**

> The AI assistant requires **Chrome** with the Prompt API enabled. The WebMCP agent tools work in any browser (via the bundled W3C polyfill); **Chrome 146+** with `chrome://flags/#enable-webmcp-testing` provides the native implementation.

---

## 🚀 Getting Started

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

---

## 🔧 Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 | UI framework |
| TypeScript 6 | Type safety |
| Vite 8 | Build tool & dev server |
| WebMCP | AI agent protocol |

---

## 📄 License

MIT — Play freely, flag responsibly 🏴

---

**Made with 💣 and 🤖**
