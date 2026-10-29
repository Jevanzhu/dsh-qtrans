# AGENTS.md

DSH 的跨机器「配置 + 会话」跃迁插件：白天在 Windows、晚上在 Mac，同一个会话接着做。最关键的架构事实是**会话不绑目录**——导入时改写 header 里的 `cwd` 并按目标项目重新挂载，所以同一个会话可以在两台上各自继续。设计细节见 `README.md`。

## 仓库结构

```
AGENTS.md            常驻规则（本文件），只放「不懂就会犯昂贵错误」的条目
README.md            项目说明：模型、桌面界面位置、离线工具
docs/                文档层级与预算（docs/AGENTS.md 是它的家）
plugin/              插件包本体，唯一含 package.json 的目录（CJS）
  index.mjs          Host 半边：/qtrans 命令与路由注册
  client.js          浏览器半边：会话头按钮 + 插件页配置卡片
  lib/               核心：port（编排）、routes（HTTP）、session/zstd/zip/webdav
  tools/             离线脚本：migrate-session（改 cwd 搬会话）、workspace-tool
  test/              测试：core（导入语义）、routes（HTTP 契约）
.agents/notes/       决策记录，生命周期即路径；归档棵封存后不可变
.agents/skills/      项目自带技能（dsh-project-harness），非本仓源码
scripts/harness/     门禁校验器副本，随仓分发，可独立运行
```

## 命令

```sh
node plugin/test/routes.test.js "$HOME/.dsh" <会话id>   # HTTP 契约：导出/导入/设置/探活
node plugin/test/core.test.js  "$HOME/.dsh" <会话id>   # 导入语义：cwd 改写、附件、幂等
node scripts/harness/run-gates.ts text                 # 文本面门禁（CI 的 npm run check）
node scripts/harness/run-gates.ts agent-notes          # 决策记录格式与归档
```

## 约定

- **只改 header 的 `cwd`**：其余事件里的历史绝对路径逐字节保留。改写历史路径会伪造过去的证据，也会让附件引用的对账失效。
- **界面与命令共用一套核心**：路由、`/qtrans` 命令、UI 按钮都调 `lib/port.js`，不写第二套实现；新增能力先进 core，再接两个调用方。
- **密码不落盘**：设置只存环境变量名（`passwordEnv`），不存明文；界面显示的是变量名而非密钥。
- **分叉不合并**：两台各自续写后按事件前缀判定前进／回退／分叉，分叉一律拒绝并报出共同前缀长度，绝不猜测覆盖。
- **面向用户的文案走 locale 字典**：`plugin/locale/*.json` 与 `client.js` 的 DICT 双份，`meta.title`/`description` 必须非空——否则插件页只剩包名。

## 门禁

按改动面选最小充分证据：改 `lib/` 跑两个测试；改文档跑 `text`；改决策记录跑 `agent-notes`。**门禁失败时不要绕过它**——要么改代码，要么在评审里论证门禁本身错了。

```sh
node scripts/harness/run-gates.ts text         # 8 项：链接、预算、折行、索引、注释、测试、宣称值、技能目录
node scripts/harness/run-gates.ts check-all    # 全量模式，构建/平台门由本仓按需填表
```

## 决策记录

有持久决策理由的改动（被放弃的备选、负面保证、协议语义、安全规则）写进 `.agents/notes/已实施/<类>/`，一篇一个决策；机械改动与局部 UI 调整豁免。事实变了要在原地改写，决策变了要新写一篇并交叉链接。

## 文档

文档层级、预算与「不写什么」见 `docs/AGENTS.md`。索引与活账尚未起步：本仓当前没有带链的文档（`scripts/harness/doc-index.manifest.json` 为 `{}`），需要时从 `.agents/skills/dsh-project-harness/templates/` 取 `docs-index.zh.md` 与 `ledger.zh.md` 起步。

## 边界

- 不搬子会话（`subagent` 派生的是临时产物，续聊不依赖）。
- 不自动改 profile：配置三方合并仍需 DSH 关闭时离线执行，插件只做会话与设置。
- 不做自动合并冲突：分叉只拒绝，不协商。

## 本文件的维护

本仓的工作语言在这里声明：**中文**——文档、提交信息与指令文件同一种语言，别处不再重复声明；换语言是一次显式迁移，不是逐文件漂移。**指令面永不配对**：本文件、`docs/AGENTS.md` 与决策记录的机制说明各只有一份。

只放规则，不放决策。逐条问：「这条改了，需要谁点头？」没人点头、跑了门禁就绿的是规则，留在这里；需要有人被说服的是决策，写进决策记录，这里只留一句指针。

改这份文件：一条一到三行、各自链到它的家；上限在 `scripts/harness/doc-budgets.manifest.json`（`node scripts/harness/verify-doc-budgets.ts --list` 看用量），超限先搬家、再精简，确需空间才提高上限并在同一个改动里给出理由。
