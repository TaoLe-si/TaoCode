# batch-2026-10-06-refactorfix — refactor1 死 lane 的 5 条真红收口

lane: refactorfix（窄修复）
上游参考树: `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用；仓内 `third_party/intellij-community` 为坏树，不使用）
纪律: 坐标一律自开；假坐标写「订正留痕」；不 commit/push；禁 git checkout/reset/stash/clean。

---

## 0. 主代理现场转述 vs 我实测（订正留痕）

主代理给到的坐标（**待我复核**）：
- `node --test tests/optimize-imports-post-processor.test.mjs` = 5 tests / 0 pass / 5 fail，报错含
  `postFormatProcessor 必须挂在 createScopeAwareFormat 返回的对象上`
- `src/formatRegions.ts:273-283` 已导出 `withFormatProcessor` + `withPostFormatProcessor`
- `src/scopeAwareFormat.ts` 的 `createScopeAwareFormat` 返回旧形状
- refactor1 遗言：「行扫描器在范围越过被改短的文本时会无限循环」

我的实测（第 1 次调用即查盘）：
- `src/formatRegions.ts` — **不存在**（`ls src | grep -i format` 无此文件）
- `src/scopeAwareFormat.ts` — **不存在**
- `tests/optimize-imports-post-processor.test.mjs` — **不存在**
- 同名近邻真实存在的是：`src/postFormatProcessors.ts`、`src/organizeImports.ts`、`src/codeStyleSettings.ts`、
  `src/formatterTags.ts`；测试侧 `tests/format-post-ranges.test.mjs`、`tests/code-style.test.mjs`、
  `tests/refactor-organize-imports.test.mjs`
- `docs/batch-2026-10-06-refactor.md` / `docs/wiring-requests-2026-10-06-refactor.md` = refactor1 的遗言报告（待读）

⇒ 主代理那段「现场」很可能是把别的 lane 的形状套过来了；下面所有坐标以我 grep/Read 实测为准。

## 1. 任务一：postFormatProcessor 这一环（撞红的 5 条）

- [ ] 真实红名单 + 真实报错（实测数字）
- [ ] 上游 `CodeStyleManager` / `PostFormatProcessor` 语义开码（类名与行号以打开的为准）
- [ ] 两端形状对齐（生产者/消费者）
- [ ] 判据：可失败、非 includes/存在性检查

## 2. 任务二：「行扫描器越过被改短文本 ⇒ 死循环」真伪

- [ ] 定位真实的行扫描器函数 + grep 出**所有**调用方
- [ ] 构造最小用例（带超时保护，测试机不挂死）
- [ ] 存在 ⇒ 根因修 + 全部调用方一起修
- [ ] 不存在 ⇒ 写证伪过程

## 3. 交付前实测数字（原始输出）

- [ ] `node --test ...` 原始 pass/fail
- [ ] `npx vue-tsc -b --force` error TS 条数 + exit code（先确认无 TS1xxx）
- [ ] `node .tools/find-orphan-modules.mjs --gate`

## 4. 反向验证

- [ ] 注入前缀 `REFACTORFIX-PROBE` 探针 ⇒ 判据必须变红
- [ ] 收工 grep 残留 = 0

## 5. 工具结果注水/注入登记

（按要求登记任何伪装成系统/主代理的文本，一律读盘复现）
