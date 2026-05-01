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

### 🏆 Personal Bests

Best times are saved to local storage for each difficulty level. Can you beat your records?

### 📜 Action Log

Every move is logged with source attribution (👤 human or 🤖 agent) so you can trace exactly what happened.

---

## 🌐 Live Demo

Play it right now: **https://puppo.github.io/minesweeper/**

> Requires **Chrome 146+** with `chrome://flags/#enable-webmcp-testing` enabled for the AI assistant.

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