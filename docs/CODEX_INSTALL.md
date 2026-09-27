# 使用 Codex 安装

把下面这段话直接发给 Codex，即可让它在你的电脑上完成安装和验证：

```text
请帮我安装并启动这个 PTE 飞书学习机器人：
https://github.com/jason-crc/pte-learning

请先阅读仓库根目录的 AGENTS.md，然后：
1. 检查 Node.js、npm 和 lark-cli；
2. 复用我现有的 lark-cli 飞书机器人配置，不要把 App Secret 写入项目；
3. 安装依赖并运行测试、类型检查和生产构建；
4. 检查飞书应用的消息事件与卡片回调配置；
5. 启动机器人，并以两个事件流的 ready 日志确认启动成功；
6. 告诉我应该在飞书里给机器人发送什么指令。
```

如果尚未配置飞书机器人，Codex 会引导你使用 `lark-cli config init --new`。App ID 与 App Secret 由 `lark-cli` 管理，不需要写入本仓库。

安装完成后，在飞书里私聊自己的机器人并发送：

```text
开始学习
```

机器人会立即发送第一张单词卡；回答后约 5 分钟发送下一张。上一张未回答时不会继续推送，但会每 30 分钟提醒一次。
