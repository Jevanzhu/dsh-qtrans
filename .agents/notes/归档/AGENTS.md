# 归档决策记录

封存的决策记录。此处的每一件都已冻结：永不编辑、重排、翻译、修复、移动或删除。`manifest.json` 逐条记录内容哈希且只增不改——对已封存字节的任何改动都会被 `scripts/harness/verify-archived-agent-notes.ts` 拒绝。

归档是文件进入此树的唯一途径：

1. 从 `已实施/<类>/` 移动完整的三件套。
2. 在每个语言文件的 `Status: implemented` 行正下方插入一行相同的 `Archived: YYYY-MM-DD`。
3. 重录任何配对内容哈希。
4. 修理或删除指向它的入站链接。
5. 用 `node scripts/harness/verify-archived-agent-notes.ts --write` 封存。

归档树的链接只查入站：指向本树的链接会被校验，本树发出的链接不查——它们按设计可能已经过时。
