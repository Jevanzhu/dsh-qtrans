# Agent Note: 插件降为子包，仓库根让给门禁

Status: implemented

## 问题

门禁是 TypeScript 源码直跑，靠 Node 的类型剥离特性；而插件包的 `package.json` 声明了 `"type": "commonjs"`，它一旦位于仓库根，`scripts/harness/*.ts` 就会被按 CommonJS 解析，`import` 语句直接报 `Cannot use import statement outside a module`，所有门禁都起不来。同时仓库根混着插件源码与治理文件，打包时 `files` 字段得逐个排除文档目录。

## 决策

插件降为一个子包 `plugin/`，仓库根只放治理面：`AGENTS.md`、`docs/`、`scripts/harness/`、`.agents/`，以及一个不声明 `type` 内容语义的根 `package.json`（`"type": "module"` + `engines.node >= 24` + 门禁脚本）。会话与配置的行为不变，插件仍从 `plugin/` 安装到 profile。

## 曾考虑的替代方案

**保留根包，把门禁改名为 `.mts`。** 类型剥离对 `.mts` 一律按 ESM 处理，能绕开 `"type": "commonjs"`。否决的理由是它把问题藏进后缀：`bootstrap.ts` 每次运行都会重新复制校验器为 `.ts`，改名得在每次升级后重做一遍，而升级是外部动作，没人会记得。**根因是根目录不该有 CJS 包**，改后缀只是让症状消失。

**给根加一个 `"type": "module"` 并把插件的 CJS 文件全改成 ESM。** 这会让 Host 半边的 `require('./lib/*.js')` 全部失效——那套库是 CJS 且被 `.mjs` 用 `createRequire` 加载，改造成本远高于搬目录，且换不来任何用户可见收益。

**不装门禁，只留 skill。** 否决理由是 skill 自己的判据：没接进检查的规则等于不存在。装了但让人用 `--no-verify` 绕过的门禁更糟，因为它训练人忽略红灯。

## 后果

代价：安装路径变成 `plugin/`，profile 里的 `link:` 依赖要重装一次；README 与测试命令里的相对路径多一层；`plugin/` 需要自己的 `.gitignore` 语义（目前没有构建产物，暂不需要）。

收获：门禁可以按 ESM 直跑，`bootstrap` 的默认产物不必改造；根目录的治理面与源码面分开，`files` 字段只描述插件自身；`.agents/skills/` 与 `scripts/harness/` 作为随仓分发的第三方副本，和本仓源码一眼可分。
