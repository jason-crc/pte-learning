# PTE 碎片学习机器人

复用本机 lark-cli 已连接的飞书机器人，定时发送 PTE 单词卡。用户点击“认识 / 不认识”后，机器人展示答案并自动安排下一次复习。

## 用 Codex 安装（推荐）

把下面这段话复制给 Codex：

```text
请帮我安装并启动 https://github.com/jason-crc/pte-learning 。
先阅读仓库根目录的 AGENTS.md，复用我现有的 lark-cli 机器人配置，
完成依赖安装、测试、构建和启动，并验证两个飞书事件流已经 ready。
不要把任何 App Secret 或 token 写入仓库。
```

更完整的提示词和安装说明见 [docs/CODEX_INSTALL.md](./docs/CODEX_INSTALL.md)。根据 [OpenAI 官方说明](https://learn.chatgpt.com/docs/agent-configuration/agents-md)，Codex 会读取仓库根目录的 `AGENTS.md`，按照项目约定执行安装和验证。

## 运行要求

- Node.js 22.5 或更高版本
- 官方 lark-cli 1.0.89 或更高版本
- 一个启用了机器人能力的飞书自建应用

项目不会读取或保存飞书 App Secret；认证、消息发送和事件接收全部交给 lark-cli。

## 已实现功能

- 回答后每隔 5 分钟自动推送下一张卡片
- 上一张卡片未回答时不会继续推送，状态在重启后仍然有效
- 飞书单聊内自助订阅，无需填写用户或会话 ID
- “认识 / 不认识”交互卡片，点击后显示释义与例句
- 认识后按 `1、3、7、14、30、60` 天递增复习
- 不认识的单词默认 20 分钟后再出现
- “再来一个”“统计”“停止”等聊天指令
- SQLite 本地持久化
- 重复点击、消息重试和每用户推送周期去重
- lark-cli 事件消费者异常退出后自动重连
- 长连接接收消息和卡片回调，不需要公网域名

## 1. 飞书后台配置

lark-cli 已经连上机器人，并不代表飞书后台已经订阅了本项目需要的事件。请确认对应的自建应用具有以下配置。

应用身份权限：

- `im:message.p2p_msg:readonly`：读取用户发给机器人的单聊消息
- `im:message:send_as_bot`：以机器人身份发送消息
- `im:message:readonly`：卡片回调时读取原消息
- 可选：`im:message.group_at_msg:readonly`，仅在需要群聊 @ 响应时开通

事件与回调：

- 事件配置选择“使用长连接接收事件”，添加 `im.message.receive_v1`
- 回调配置选择“使用长连接接收回调”，添加 `card.action.trigger`
- 发布应用版本，并确保自己在应用可用范围内

## 2. 手动安装与启动

需要 Node.js 22.5 或更高版本，以及已登录的 lark-cli 1.0.89 或更高版本。

如果还没有安装 lark-cli：

```bash
npm install -g @larksuite/cli
```

如果还没有配置飞书应用：

```bash
lark-cli config init --new
```

先验证 lark-cli：

```bash
lark-cli --version
lark-cli doctor --offline
lark-cli auth status --verify
```

克隆仓库并运行安装自检：

```bash
git clone https://github.com/jason-crc/pte-learning.git
cd pte-learning
./scripts/install.sh
npm start
```

看到以下日志代表项目已经接管两个长连接事件流：

```text
lark-cli 事件消费者已就绪 {"eventKey":"im.message.receive_v1"}
lark-cli 事件消费者已就绪 {"eventKey":"card.action.trigger"}
飞书机器人已连接 {"bot":"你的机器人名称","transport":"lark-cli"}
```

然后在飞书里私聊自己的机器人并发送：

```text
开始学习
```

机器人会保存当前单聊并立即发送第一张卡。

## 3. 飞书指令

| 指令 | 效果 |
| --- | --- |
| `开始学习` | 首次订阅或恢复定时推送 |
| `来一个` | 立即发送一张到期的学习卡 |
| `统计` | 查看今日与累计学习数据 |
| `停止` | 暂停推送，但保留学习进度 |

## 4. 自定义配置

项目无需 `.env` 也能启动。需要调整推送节奏时再执行：

```bash
cp .env.example .env
```

常用配置：

```dotenv
PUSH_INTERVAL_MINUTES=5
TIMEZONE=Asia/Shanghai
KNOWN_INTERVALS_DAYS=1,3,7,14,30,60
UNKNOWN_RETRY_MINUTES=20
```

如果 lark-cli 有多个 profile，可指定：

```dotenv
LARK_CLI_PROFILE=你的profile名称
```

只允许指定飞书用户使用机器人：

```dotenv
ALLOWED_OPEN_IDS=ou_xxx
```

## 5. 添加 PTE 词库

编辑 [data/words.json](./data/words.json)。每个词的 `slug` 必须唯一；程序启动时会自动新增或更新词条，不会清除已有学习进度。

```json
{
  "slug": "coherent",
  "word": "coherent",
  "phonetic": "/kəʊˈhɪərənt/",
  "partOfSpeech": "adj.",
  "meaningZh": "连贯的；条理清楚的",
  "example": "A good essay presents a coherent argument.",
  "exampleZh": "一篇好文章会提出连贯的论点。",
  "tags": ["writing", "academic"]
}
```

当前内置 26 个示例学术词。

## 6. 运维命令

```bash
npm test             # 运行测试
npm run check        # TypeScript 类型检查
npm run build        # 构建生产版本
npm start            # 运行构建后的版本
npm run stats        # 在终端查看订阅者统计
npm run send:now     # 给所有订阅者立即推送一张真实卡片
```

`send:now` 会产生真实飞书消息，测试请求形状时应使用 lark-cli 的 `--dry-run`。

## 运行边界

机器人依赖宿主机的 lark-cli 配置和长连接，因此项目进程需要一直在线。开发时可使用 `npm run dev`，长期运行建议构建后交给 launchd、pm2 等进程管理器。

MVP 暂未包含 PTE 选择题、听力、口语评分和管理后台；当前聚焦于“单词推送 → 点击反馈 → 间隔复习”闭环。

## 开源许可

[MIT](./LICENSE)
