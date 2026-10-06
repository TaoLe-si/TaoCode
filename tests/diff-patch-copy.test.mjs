// 差异视图里那份**补丁文本**（`DiffView.vue` 的 `props.unified`）的真消费者。
//
// 缺陷本身：`unified` 只在「行表为空」那块 `pre` 里出现，而前端生成补丁的三处
// （保存冲突预览 / 与剪贴板比较 / 与文件比较）行表**永远非空** ⇒ 由 `src/diffText.ts` 的
// `generateUnifiedDiff` 生成的那份文本没有任何可见出口（块头写错在真机上看不出来就是这个原因）。
//
// 还原方式（上游那一档亲自打开过，逐条见 `src/components/DiffView.vue` 的 §补丁文本注释）：
//   · 动作 = `ChangesView.CreatePatchToClipboard`
//     （`platform/vcs-impl/resources/META-INF/VcsActions.xml:213-214`，
//       文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:1583`）；
//   · 挂在差异查看器上的那一支 = `DiffViewerCreatePatchActionProvider$Clipboard`
//     （`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/diff/DiffViewerCreatePatchActionProvider.java:55-59`）；
//   · 不弹对话框、直接进剪贴板 = `CreatePatchFromChangesAction.java:182-200`
//     → `CreatePatchCommitExecutor.java:343-355` → `PatchWriter.java:104-111`
//     （`CopyPasteManager.setContents(new StringSelection(补丁全文))`）；
//   · 可见性谓词 = 同文件 `:71-76` 的 `setEnabledAndVisible(isEnabled)` —— 没有补丁文本那一项**不出现**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'
import { generateUnifiedDiff } from '../src/diffText.ts'
import { clipboardRing, copyToClipboard } from '../src/clipboard.ts'
import { PATCH_TO_CLIPBOARD_TEXT } from '../src/patchExport.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const view = read('src/components/DiffView.vue')

/** 一份够渲染的行表（并排档与统一档都要非空行表才会走「不是 pre」那条路）。 */
const ROWS = [{ kind: 'change', left: { no: 1, text: 'alpha' }, right: { no: 1, text: 'omega' } }]
/** 按钮的 HTML 形状（SSR 会把模板注释也留在输出里，所以只能按属性判，不能按整串文案判）。 */
const COPY_BUTTON = /<button[^>]*title="作为补丁复制到剪贴板"[^>]*aria-label="作为补丁复制到剪贴板"/

async function render(props) {
  const { component } = loadSfc('src/components/DiffView.vue')
  return renderToString(createSSRApp(component, { path: 'a.txt', rows: ROWS, ...props }))
}

/** 补丁的「块头声明的行数」与「正文实际吐出的行数」（读侧 `src/patchApply.ts` 收块用的就是这笔账）。 */
function patchAccounts(patch) {
  const lines = patch.split('\n')
  const headerAt = lines.findIndex(line => line.startsWith('@@'))
  const header = lines[headerAt]
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
  const declared = { before: Number(match?.[2] ?? 1), after: Number(match?.[4] ?? 1) }
  let actual = { before: 0, after: 0 }
  for (const line of lines.slice(headerAt + 1)) {
    if (line === '') continue
    if (line[0] !== '+') actual = { ...actual, before: actual.before + 1 }
    if (line[0] !== '-') actual = { ...actual, after: actual.after + 1 }
  }
  return { declared, actual, header }
}

test('props.unified 有两处消费者：工具带的复制补丁与无行表时的那块 pre', () => {
  // 原来只有后面这一处，且它落在 `effectiveRows.length === 0` 的分支里 ⇒ 前端生成补丁的三处永远看不到。
  assert.match(view, /<pre v-else class="diff-body">\{\{ unified \|\| '（无差异）' \}\}<\/pre>/,
    '无行表时的补丁文本兜底必须还在（宿主侧只给文本的场合）')
  assert.match(view, /const patchText = computed\(\(\) => \(props\.unified\.trim\(\) \? props\.unified : ''\)\)/,
    '补丁文本 = props.unified 本身（不是重新生成一份，避免两侧口径打架）')
  assert.match(view, /const canCopyPatch = computed\(\(\) => patchText\.value !== ''\)/,
    '可见性谓词：没有补丁文本就没有那颗按钮（上游 setEnabledAndVisible）')
})

test('复制补丁走剪贴板中央入口，复制的就是 props.unified 那份全文', () => {
  assert.match(view, /import \{ copyToClipboard \} from '\.\.\/clipboard'/,
    '剪贴板出口 = src/clipboard.ts 的 copyToClipboard（系统剪贴板 + 剪贴板环）')
  assert.match(view, /import \{ PATCH_TO_CLIPBOARD_TEXT \} from '\.\.\/patchExport'/,
    '文案与变更视图那两条同源（同一个上游动作 id），不在组件里另抄一份')
  // 函数体逐行钉住：空补丁不动剪贴板 → await 复制 → 才给那句成功提示。
  assert.match(view, /async function copyPatch\(\) \{\n\s*const text = patchText\.value\n\s*\/\/ 空补丁不动剪贴板[^\n]*\n\s*if \(!text\) return\n\s*await copyToClipboard\(text\)\n\s*patchCopied\.value = true\n\s*\}/,
    'copyPatch 必须把 patchText（= props.unified）整份交给 copyToClipboard')
  assert.match(view, /watch\(\(\) => props\.unified, \(\) => \{ patchCopied\.value = false \}\)/,
    '换了补丁就把上一句提示作废')
})

test('工具带那颗按钮的形状：纯图标件必须有 title 与 aria-label（playbook §5.3）', () => {
  assert.match(view, /<button v-if="canCopyPatch" class="find-icon-button" type="button" :title="PATCH_TO_CLIPBOARD_TEXT"/,
    '可见性由 canCopyPatch 决定（没有补丁文本就不出现）')
  assert.match(view, /:aria-label="PATCH_TO_CLIPBOARD_TEXT" @click="copyPatch"><Copy :size="iconSize.control" \/><\/button>/,
    '图标走 lucide 的 Copy 与 iconSize.control，不写 Unicode 字形')
  assert.match(view, /<span v-if="patchCopied" class="diff-copy-state" role="status">\{\{ PATCH_COPIED_TEXT \}\}<\/span>/,
    '成功那一句是 role=status 的实时提示')
  assert.match(view, /\.diff-copy-state \{ color: var\(--success\); font: 11px var\(--font-ui\); white-space: nowrap; \}/,
    '样式走令牌，不写裸色值')
})

test('真渲染：行表非空时（正是原来看不见补丁文本的那一档）按钮带 title 与 aria-label 出现', async () => {
  const html = await render({ unified: generateUnifiedDiff(['alpha'], ['omega']) })
  assert.ok(COPY_BUTTON.test(html), '复制补丁按钮必须真渲染出来')
  // 文案逐字取上游那条常量的等价物（`ActionsBundle.properties:1583`）。
  assert.equal(PATCH_TO_CLIPBOARD_TEXT, '作为补丁复制到剪贴板')
  assert.ok(html.includes(`aria-label="${PATCH_TO_CLIPBOARD_TEXT}"`), 'aria-label 来自同一条常量')
  // 反向：那句成功提示在**点了之后**才有，渲染初始态不该出现（`patchCopied` 起始为 false）。
  assert.ok(!html.includes('补丁已复制到剪贴板'), '未复制时不显示成功提示')
})

test('真渲染：没有补丁文本时那颗按钮不出现（不放假控件）', async () => {
  for (const unified of ['', '   ', '\n']) {
    const html = await render({ unified })
    assert.ok(!COPY_BUTTON.test(html), `unified = ${JSON.stringify(unified)} 时不许出现复制补丁按钮`)
  }
  // 有行表、无补丁文本 ⇒ 两处消费者都不出现（pre 兜底走「（无差异）」，按钮整件不渲染）。
  const html = await render({ unified: '' })
  assert.ok(!html.includes('class="diff-copy-state"'), '未复制时也不该有那句提示的容器')
  assert.ok(!html.includes('（无差异）'), '有行表时不渲染 pre 兜底（走行表那两档）')
})

test('真渲染：没有行表时那份补丁文本自己就是显示内容（宿主只给文本的场合，两处消费者同时在场）', async () => {
  const patch = generateUnifiedDiff(['x'], ['y'])
  const { component } = loadSfc('src/components/DiffView.vue')
  const html = await renderToString(createSSRApp(component, { path: 'a.txt', rows: [], unified: patch }))
  assert.ok(html.includes(`<pre class="diff-body">${patch}</pre>`), 'pre 兜底必须逐字渲染那份补丁（含换行与缩进）')
  assert.ok(COPY_BUTTON.test(html), '同一份补丁也能被复制出去')
  // 反向：完全没有补丁时 pre 说的是「无差异」，且没有按钮。
  const empty = await renderToString(createSSRApp(component, { path: 'a.txt', rows: [], unified: '' }))
  assert.ok(empty.includes('<pre class="diff-body">（无差异）</pre>'), '没补丁文本时才是那句占位')
  assert.ok(!COPY_BUTTON.test(empty), '没补丁文本时不许出现复制按钮')
})

test('真函数调用：generateUnifiedDiff 的那份文本原样进剪贴板环（含 @@ 块头）', async () => {
  const before = ['one', 'two', 'three']
  const after = ['one', 'TWO', 'three', 'four']
  const patch = generateUnifiedDiff(before, after)
  const size = clipboardRing.value.length
  await copyToClipboard(patch)
  assert.equal(clipboardRing.value.length, size + 1, '复制要进剪贴板环（上游 CopyPasteManager 的环）')
  assert.equal(clipboardRing.value[0].text, patch, '复制的就是那份补丁全文，一行不裁')
  assert.ok(clipboardRing.value[0].text.startsWith('--- '), '补丁的表头也在剪贴板里')
  assert.match(clipboardRing.value[0].text, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m, '块头带着两侧行数（原缺陷就写死在这里）')
})

test('空补丁不动剪贴板（组件里的 if 与 copyToClipboard 自己的守卫同向）', async () => {
  const size = clipboardRing.value.length
  await copyToClipboard('')
  assert.equal(clipboardRing.value.length, size, '空串不许进环')
})

test('会失败的用例：块头改回旧写法 @@ -1 +1 @@ ⇒ 声明的行数与实际不符', () => {
  const patch = generateUnifiedDiff(['a', 'b', 'c'], ['a', 'B', 'c'])
  const { declared, actual } = patchAccounts(patch)
  assert.deepEqual(declared, actual, '真生成的那份必须自洽（读侧按声明行数收块）')
  // 反向对照：把块头手动改回修复前的写死形状，同一笔账必须**不平** —— 这条断言不是糊的。
  const lying = patch.replace(/^@@[^\n]*$/m, '@@ -1 +1 @@')
  const lie = patchAccounts(lying)
  assert.deepEqual(lie.declared, { before: 1, after: 1 }, '省略第二个数就是 1（上游 PatchReader.java:359 的口径）')
  assert.notDeepEqual(lie.declared, lie.actual, '旧写法的块头与正文不符 ⇒ 这条判据必须能红')
})
