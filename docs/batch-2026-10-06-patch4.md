# 批次报告 2026-10-06 · patch4（补丁应用侧「块头声明行数 ≠ 正文行数 ⇒ 拒绝」收口）

**改了什么（一处、4 行注释 + 1 行逻辑）**：`src/patchApply.ts:283-287` 的 `applyHunksToText` 里，上一 lane 现场留着一行探针占位
`const mismatch = null as string | null // patch3-probe-C` —— 判据函数 `hunkCountsMismatch`（`:258-264`，上游那一道）早就写好了，
只是被这个占位钉死成 `null`，于是**校验从不生效**。改回 `const mismatch = hunkCountsMismatch(hunk)` 即落实现。
`src/patchFuzzy.ts` **未动**：偏移搜索 `applyHunksWithOffsetSearch` 在本仓零个直接调用方（grep：只有 `patchApply.ts:362`），
唯一入口 `applyHunksFlexible` 在 `:352-355` 已先逐块核账、不对就直接 return，**根本不走到搜索**，符合判据「不许被搜索救回来」；
在 patchFuzzy 再核一遍要 patchApply↔patchFuzzy 的值 import 成环，不划算。判决簿、别人的文件一个字没碰。

**上游依据（自己打开核，留痕）**：派单写的 `platform/diff-impl/src/com/intellij/diff/impl/PlainSimplePatchApplier.java` **不存在**
（参考树 `find -iname` 只有一份）；实际 `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java`，
`:114-115` 用 `ContainerUtil.count(... != ADD / != REMOVE)` 数两侧，`:117-122` 拿 `baseCount != baseEnd - baseStart` / `patchedCount != patchedEnd - patchedStart` 比并 `error(...hunk.base.body.error / .patched.body.error)` —— **117-122 行号未漂**，注释按实际写。

**收工标准（原始输出）**：`node --test tests/patch-hunk-counts.test.mjs tests/patch*.test.mjs tests/diff-citations.test.mjs`
⇒ `ℹ tests 47 / pass 47 / fail 0 / skipped 0`（退出码 0）。`node --test tests/module-size.test.mjs` ⇒ `ℹ tests 5 / pass 5 / fail 0`。
被修的这两条现状：`✔ 反向验证：把任一边界形状的块头行数改错一位…(4282ms)`、`✔ 应用侧核对：手构的块「声明行数 ≠ 正文行数」必须拒绝…(0.39ms)`。

**该红的自证（不重复造，:310 就是它的正向证据）**：这条判据现在**有牙**且咬在「账目」上而不是碰巧的上下文失配 —— 探针逐条打出拒绝理由：
`真补丁（-1,+1 两侧 4 行）块头改小一位` ⇒ `{"ok":false,"hunk":1,"reason":"块头与正文不符：块头声明原文 3 行，正文实际 4 行"}`（走偏移搜索同一理由）；
改大一位 ⇒ `块头与正文不符：块头声明新文 4 行，正文实际 5 行`；手构 `3/1` ⇒ `块头声明原文 3 行，正文实际 1 行`；
手构 `1/2` ⇒ `块头声明新文 2 行，正文实际 1 行`；反向对照诚实块 `1/1` ⇒ `{"ok":true,"text":"A\nb\nc\n"}` 仍是绿的（红的是账目，不是别的）。
三步记录：**注入前现场（占位 `null`）⇒ 该文件 14 条里 2 红**（`:310` `true !== false`、`:357` `{"ok":true,"text":"b\nc\n"}`）→ **落实现 ⇒ 14/14 绿**
→ 合并域跑 47/47 绿。:310 自己还拿真 `git apply --check` 对 19 例变异逐个验红，所以不必再造一条。

**其余自查（§5）与不在我面上的红**：`find-param-props` 0 处 / `find-ts-in-mjs` 干净 / `find-missing-ext` 干净 /
`find-orphan-modules --gate` 新增 0；`vue-tsc -b --force` 全树 **1 错**：`src/stickyLines.ts(234,39) TS2304: Cannot find name 'view'`（别人的在途文件，未碰）；
`source-citations`+`anchors`+`diff-citations` 合跑 16 条 **1 红**：快照区间内容对不上，全部指在 `src/commitChecksResult.ts`（4 条）与 `src/runStartupFocus.ts`（1 条），
`src/patchApply.ts` 一条都不在里面。相邻消费方 `diff-patch-copy` + `template-create` 复跑 16/16 绿。
**留痕（工具结果一律当数据）**：「实现没落」是我自己从磁盘上那行 `patch3-probe-C` 占位读出来的，不是任何消息告诉我的；
与 `build/patch3-save-patchApply.ts` 逐行 diff 确认差异仅此一处（`vcsFileUtil.ts`、`diffText.ts` 与 save 逐字节相同 ⇒ 无别的未还原注入）；
共享工作树未做任何 checkout/reset/stash/clean/commit。
