#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "缺少 Node.js；请先安装 Node.js 22.5 或更高版本。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "缺少 npm；请安装随 Node.js 提供的 npm。" >&2
  exit 1
fi

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`Node.js ${process.versions.node} 版本过低；需要 22.5 或更高版本。`);
    process.exit(1);
  }
'

if ! command -v lark-cli >/dev/null 2>&1; then
  echo "缺少 lark-cli。请先运行：npm install -g @larksuite/cli" >&2
  exit 1
fi

echo "正在安装依赖并验证项目……"
npm ci
npm test
npm run check
npm run build

echo
echo "安装验证完成。"
echo "下一步：确认 lark-cli 配置后运行 npm start。"
echo "启动成功后，在飞书里私聊机器人并发送：开始学习"
