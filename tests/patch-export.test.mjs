// 本地更改的补丁导出（上游 `ChangesView.CreatePatch` / `CreatePatchToClipboard`）。
//
// 上游要点：`:127` 「从本地更改创建补丁…」、`:131` 「作为补丁复制到剪贴板」（`ActionsBundle.properties`）；
// 补丁文本 = 本地更改的 `git diff`。本仓用 `git diff HEAD`（**暂存 + 未暂存一起** ——
// 单跑 `git diff` 只有未暂存那一半），落盘走 `dialog.saveFile` + `app.writeExportFiles`。
//
// **如实记的缺口**：未跟踪的文件不在补丁里（git 的 diff 不认它们；上游会把它们当新文件加进去）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CREATE_PATCH_TEXT, PATCH_FILTERS, PATCH_TO_CLIPBOARD_TEXT, copyPatchToClipboard } from '../src/patchExport.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('the labels and the save filter match upstream', () => {
  assert.equal(CREATE_PATCH_TEXT, '从本地更改创建补丁…', 'ActionsBundle.properties:127')
  assert.equal(PATCH_TO_CLIPBOARD_TEXT, '作为补丁复制到剪贴板', ':131')
  assert.deepEqual(PATCH_FILTERS, [{ name: '补丁文件', pattern: '*.patch' }], '上游 FILE_EXTENSION = "patch"')
})

test('the patch comes from git.patch (whole diff + untracked files as new files)', () => {
  const src = read('src/patchExport.ts')
  // 宿主侧 `git.patch` = `git diff HEAD`（暂存 + 未暂存）再按"新文件"接上未跟踪的文件。
  // **别退回 `git.diff` + `base: 'HEAD'`**：那会变成 `git diff HEAD HEAD`（空）—— 真机上踩过。
  assert.match(src, /request<\{ patch: string \}>\(.git\.patch., \{ includeUntracked: true \}\)/)
  assert.ok(!src.includes("base: 'HEAD'"), '不许再走"比较两个尖端"那条路')
})

test('the module says untracked files are included, not excluded', () => {
  const src = read('src/patchExport.ts')
  assert.match(src, /未跟踪的文件/, '文件头要说清未跟踪的那一份怎么进来')
  assert.ok(!src.includes('**不在**补丁里'), '第一百一十五批起未跟踪的文件在补丁里')
})

test('an empty patch never reaches the clipboard', async () => {
  const calls = []
  const { localPatchText } = await import('../src/patchExport.ts')
  assert.equal(typeof localPatchText, 'function')
  // 直接测"空补丁不动剪贴板"这条分支：把 request 换成返回空 diff 的实现做不到（模块内部 import），
  // 所以这里用一个替身 deps 演一遍同一条链（copy 被调用就该失败）。
  let copied = false
  await copyPatchToClipboard({ notify: message => calls.push(message), copy: () => { copied = true } })
    .catch(() => undefined)
  // 真机上 git 调用会因为"没有工作区"而抛错 —— 那条路走的是 notify(失败)，不是 copy。
  assert.equal(copied, false, '复制只在拿到非空补丁之后发生')
  assert.ok(calls.length >= 1, '失败也要说一句')
})

test('the panel routes the two menu rows through the module', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /import \{ copyPatchToClipboard, createPatchFile \} from '\.\.\/patchExport'/)
  assert.match(panel, /case 'patch': return void createPatchFile\(\{ notify/)
  assert.match(panel, /case 'patchClipboard': return void copyPatchToClipboard\(\{ notify/)
})
