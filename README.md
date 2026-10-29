# dsh-qtrans（DSH 跃迁 · Quantum Transition）

把 DSH 的**配置与会话**跃迁到另一台机器：白天在这台、晚上在那台，同一个会话接着往下做。**界面优先**：会话标题栏有「跃迁」按钮，设置里有独立一页；命令 `/qtrans` 只是同一套操作的脚本入口。

核心设计：**会话不绑目录，导入时按当前项目重新挂载**。你在哪个会话里点导入，它就落在那个会话的项目下——和 ZCode“导入后按导入的项目再改目录”是同一个模型。

## 界面

| 位置 | 内容 |
|---|---|
| 会话标题栏右侧 →「跃迁」 | 导出会话（下载 ZIP）／上传到另一台／从另一台取回／从文件导入… |
| 设置 → 插件 → **DSH 跃迁** 页 | 配置卡片：WebDAV 地址、用户名、密码环境变量名、远端目录，外加「保存」和「测试连接」 |

配置卡片走 `plugins.bundle.config` 槽位（`key: dsh-qtrans`），和「上下文洞察」(dsh-context) 同一套放置方式——落在插件自己的页面上，而不是另开一个顶级设置页。

「测试连接」在服务端真跑一遍 `MKCOL → PUT → HEAD → DELETE`，成功返回耗时与字节数，失败直接指出哪一步、HTTP 几。

界面调的都是 Host 路由 `/api/qtrans/*`（export / import / send / recv / settings / ping），和 `/qtrans` 命令共用同一套核心逻辑，不存在两套实现。

> 改动 Host 半或新增客户端文件后，需要**完全退出并重启 DSH** 才会加载新的模块代际；只刷新页面不够。

## 命令

| 命令 | 作用 |
|---|---|
| `/qtrans list` | 列出本机会话（优先显示当前项目的） |
| `/qtrans export <会话id>` | 打包到 `~/.dsh-qtrans/out/<id>.dshsess.zip` |
| `/qtrans import <bundle.zip>` | **导入到当前项目**，并挂到该项目下 |
| `/qtrans send <会话id>` | 打包并上传到 WebDAV |
| `/qtrans recv <会话id>` | 从 WebDAV 下载并导入到当前项目 |
| `/qtrans sync [会话id]` | 谁新听谁的；省略 id 取当前项目最近更新的会话 |

日常接力就是每台机器各一次 `/qtrans sync`。

## 为什么插件版比 CLI 版更好

| | CLI | 插件 |
|---|---|---|
| 登记工作区 | 直接改 `workspace.json`（必须退出 DSH） | `ctx.workspaceRegistry` + `attachSession`，**DSH 开着也能导入** |
| 导出前刷盘 | 无法触发 | `ctx.sessions.flush()`，把内存里未落盘的事件刷出去 |
| 目标项目 | 手写 `--project` | 取当前会话的工作目录，零参数 |
| 会话正被打开 | 检测不到 | 直接拒绝，避免读到内存里的旧状态 |

## 实现要点

- 会话日志是**多帧 zstd**，Node 的 `zstdDecompressSync` 只解第一帧，所以 `plugin/lib/zstd.js` 自己走帧格式切分。
- 项目目录名照抄 DSH 的 `projectKey`（`:`、`/`、`\` 都变 `-` 且连续折叠，`^` 变 `~005E`，开头 `-` 剥掉，超长截到 251）。
- 导入只改 header 里的 `cwd`，其余事件逐字节保留；`import` 用事件前缀判断前进/回退/分叉。
- 附件按 `attachments/v1/objects/<hash前2位>/<hash>` 内容寻址复制。
- 插件包在 `plugin/`，仓库根没有 `type: commonjs`——这样 `scripts/harness/*.ts` 才能按 ESM 直跑。

## 测试

```bash
node plugin/test/core.test.js <真实DSH home> <会话id>
```

9 项断言：导出 → 导入到不同项目路径 → header 改写 → 记录数/内容不变 → 走 registry 而非 JSON → 幂等 → 会话打开时拒绝。

## 命名沿革

项目名换过三次，标识跟着一起改；2.x → 3.x 留了自动迁移，配置和导出目录不会丢：

| 阶段 | 名字 | 包名 / 命令 / 路由 | 数据目录 |
|---|---|---|---|
| 1.x | DSH SessionPort | `dsh-session-port` / `/port` / `/api/session-port` | `~/.dsh-port` |
| 2.x | DSH 摆渡（Shuttle） | `dsh-shuttle` / `/shuttle` / `/api/shuttle` | `~/.dsh-shuttle` |
| 现名 | **DSH 跃迁**（Quantum Transition，缩写 QT） | `dsh-qtrans` / `/qtrans` / `/api/qtrans` | `~/.dsh-qtrans` |

版本号已重置为 `v0.1.0`，不再编码改名阶段——上面的「阶段」列只是历史，不是 semver。

2.x → 3.x 是唯一一次带迁移的改名：插件激活时会把旧的 `~/.dsh-shuttle`、`~/.dsh/.dsh-shuttle`（导出目录）一次性复制到新名字下，旧目录原样保留以便回退。

工作区目录本身改名不归插件管：那要离线做（改目录名、修 profile 的 `link:` 依赖与 junction、逐条重挂会话的 `header.cwd`），会话日志的追加写句柄在运行时被占用。

## 已知限制

- 只搬主会话，不搬子会话（`subagent` 派生的是临时产物，续聊不依赖）。
- 分叉不合并：同一个会话在两台机器各自续写后，只会被拒绝并报出共同前缀长度。

## plugin/tools 离线脚本

这些脚本要求 **DSH 完全退出**（含托盘图标），因为会话日志是追加写的，运行时改写 header 并移动文件会让后续追加写到旧路径、撕裂日志。

| 脚本 | 用途 |
|---|---|
| `plugin/tools/migrate-session.js <会话id> <目标项目路径> [--apply]` | 把一条会话迁到另一个项目下（不带 `--apply` 是预演） |
| `plugin/tools/workspace-tool.js sessions <路径>` | 列出某个项目下的会话 id（读 header.cwd，不看登记表） |
| `plugin/tools/workspace-tool.js drop <路径> [--apply]` | 删掉指向不存在目录、且已经空了的旧工作区登记 |

