# AGENTS.md

## Project purpose

This repository runs a local Feishu/Lark bot for PTE vocabulary practice. It reuses the active bot profile from the official `lark-cli`; application credentials must never be copied into this repository.

## Codex installation workflow

When a user asks you to install or start this project:

1. Read `README.md` and preserve any existing `lark-cli` profile.
2. Check Node.js 22.5+, npm, and `lark-cli` 1.0.89+.
3. If `lark-cli` is missing, explain that the official package is `@larksuite/cli` before installing it globally.
4. Run `npm ci`, `npm test`, `npm run check`, and `npm run build`.
5. Verify the selected bot identity with `lark-cli auth status --json --verify`. Never print tokens or secrets.
6. If no app profile exists, guide the user through `lark-cli config init --new`. Keep credentials only in `lark-cli`, never in `.env` or tracked files.
7. Confirm the Feishu app has the scopes and long-connection events listed in `README.md`.
8. Start with `npm start`. Treat these log lines as the readiness contract:
   - `lark-cli 事件消费者已就绪` for `im.message.receive_v1`
   - `lark-cli 事件消费者已就绪` for `card.action.trigger`
   - `飞书机器人已连接`
9. Do not send a real test message unless the user authorizes it. Ask the user to privately message the bot with `开始学习` for the first end-to-end test.

## Repository rules

- Never commit `.env`, SQLite databases, logs, tokens, App Secrets, or local `lark-cli` configuration.
- Use `npm ci` for reproducible installs.
- Run tests, type checking, and the production build after source changes.
- Keep the one-pending-card invariant: a user must not receive a new automatic study card before answering the previous one.
- Stop event consumers gracefully with SIGINT/SIGTERM; never use `kill -9`.
