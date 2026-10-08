// 大文件按字节判定（`src/largeFileBytes.ts`）：UTF-8 长度、阈值策略、大小文案，
// 以及**降级档经 `com.intellij.fileEditorProvider` 的 `LargeFileEditor` 支裁决**
// （`largeFileEditorViewFor`，bundled 贡献在 `src/largeFileViewer.ts`；挂点
// `src/components/CodeEditor.vue:130` —— 它读的 `large.large` 就是这里的结论）。
//
// 三个格式化件（`utf8ByteLength` / `formatFileSize`）住 `src/fileSizeFormat.ts`：搬家的理由是
// 打断 `largeFileBytes → largeFileViewer → largeFileBytes` 的循环，本文件把它钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LARGE_FILE_LIMIT, LARGE_FILE_NOTICE, largeFilePolicy } from '../src/largeFileMode.ts'
import { formatFileSize, isLargeFileText, largeFilePolicyForText, utf8ByteLength } from '../src/largeFileBytes.ts'
import { registerFileEditorProvider, registerFileEditorProviderSuppressor } from '../src/fileEditorProviders.ts'
import { LARGE_FILE_EDITOR_PROVIDER, LARGE_FILE_EDITOR_PROVIDER_ID } from '../src/largeFileViewer.ts'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const BIG = 'a'.repeat(LARGE_FILE_LIMIT + 1)
const FULL = { lsp: true, syntaxHighlighting: true, wordWrap: true }
const REDUCED = { lsp: false, syntaxHighlighting: false, wordWrap: false }

/** 把 bundled 那支放回 EP 表（第三方按同一 id 覆盖过后恢复原状，避免污染同进程的后续用例）。 */
const restoreBundled = () => registerFileEditorProvider(LARGE_FILE_EDITOR_PROVIDER, { source: 'bundled' })

test('UTF-8 字节：ASCII 1、拉丁扩展 2、CJK 3、emoji 4', () => {
  assert.equal(utf8ByteLength('abc'), 3)
  assert.equal(utf8ByteLength('é'), 2)
  assert.equal(utf8ByteLength('中文'), 6, '两个汉字 6 字节')
  assert.equal(utf8ByteLength('😀'), 4, '代理对按一个码点 4 字节')
  assert.equal(utf8ByteLength('a中😀'), 1 + 3 + 4)
  assert.equal(utf8ByteLength(''), 0)
})

test('阈值：2M 个汉字就已超过 5MiB（按字符判会晚 3 倍）', () => {
  const cjk = '中'.repeat(2 * 1024 * 1024)
  assert.equal(utf8ByteLength(cjk), 6 * 1024 * 1024)
  assert.ok(isLargeFileText(cjk))
  assert.ok(largeFilePolicyForText(cjk).large)
  assert.ok(!largeFilePolicyForText('a'.repeat(LARGE_FILE_LIMIT - 1)).large)
  assert.ok(largeFilePolicyForText('a'.repeat(LARGE_FILE_LIMIT)).large)
  assert.equal(largeFilePolicyForText('x'.repeat(LARGE_FILE_LIMIT)).notice, largeFilePolicyForText('中'.repeat(LARGE_FILE_LIMIT)).notice)
})

test('降级清单与字符版一致（同一策略，只是口径换成字节）', () => {
  const policy = largeFilePolicyForText(BIG)
  assert.deepEqual(policy.features, REDUCED)
  assert.ok(policy.notice.includes('大文件模式'))
})

test('大小文案：B / KiB / MiB 各一档', () => {
  assert.equal(formatFileSize(512), '512 B')
  assert.equal(formatFileSize(2048), '2.0 KiB')
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MiB')
  assert.equal(formatFileSize(-1), '0 B')
  assert.equal(formatFileSize(Number.NaN), '0 B')
})

// ── 降级档过 EP（W-EP-2 的编辑器那一半） ────────────────────────────────────────────────

test('判定真的 consult 了 largeFileEditorViewFor（源码锚点 + 搬家后的再导出）', () => {
  const bytes = source('src/largeFileBytes.ts')
  assert.match(bytes, /import \{ largeFileEditorViewFor \} from '\.\/largeFileViewer\.ts'/)
  assert.match(bytes, /const view = largeFileEditorViewFor\(\{ path, root, bytes \}\)/, '超限后问 EP，path/root/bytes 一起给')
  assert.match(bytes, /export \{ formatFileSize, utf8ByteLength \} from '\.\/fileSizeFormat\.ts'/, '搬走的两个件原样再导出')
  const viewer = source('src/largeFileViewer.ts')
  assert.match(viewer, /import \{ formatFileSize, utf8ByteLength \} from '\.\/fileSizeFormat\.ts'/)
  assert.doesNotMatch(viewer, /from '\.\/largeFileBytes\.ts'/, 'viewer 不再反向依赖 —— 循环被打断')
})

test('只挂 bundled 时与旧行为逐字一致（features 就是 REDUCED，notice 就是那句）', () => {
  const local = largeFilePolicy(utf8ByteLength(BIG))
  const policy = largeFilePolicyForText(BIG)
  assert.equal(policy.large, local.large)
  assert.equal(policy.notice, LARGE_FILE_NOTICE)
  assert.deepEqual(policy.features, REDUCED)
  // 小文件不走 EP，原样返回本地结论。
  const small = largeFilePolicyForText('abc', 'a.ts', '/ws')
  assert.equal(small.large, false)
  assert.equal(small.notice, null)
  assert.deepEqual(small.features, FULL)
})

test('第三方按同一 id 挂 features 全开的提供者 ⇒ 判定随之改变（EP 说了算）', () => {
  const seen = []
  const handle = registerFileEditorProvider({
    id: LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: input => { seen.push(input); return (input.bytes ?? 0) >= LARGE_FILE_LIMIT },
    createEditor: () => ({ editorTypeId: 'ThirdPartyLargeFile', sizeText: '巨无霸', features: FULL, notice: '第三方说不用降级' }),
  })
  try {
    const policy = largeFilePolicyForText(BIG, 'src/big.ts', '/ws')
    assert.equal(policy.large, false, 'features 全开 ⇒ 这个文件不降级')
    assert.deepEqual(policy.features, FULL)
    assert.equal(policy.notice, '第三方说不用降级', 'notice 取视图的（非空优先）')
    assert.ok(seen.length > 0, 'EP 的 accept 真的被问了')
    const input = seen[seen.length - 1]
    assert.equal(input.path, 'src/big.ts', 'path 透传给提供者')
    assert.equal(input.root, '/ws', 'root 透传')
    assert.equal(input.bytes, LARGE_FILE_LIMIT + 1, '按文本算出的字节数透传（提供者不必再解码一次）')
  } finally {
    handle.dispose()
    restoreBundled()
  }
  assert.deepEqual(largeFilePolicyForText(BIG).features, REDUCED, '恢复 bundled 后回到降级档')
})

test('第三方只关一项也判降级；给出的 notice 为空则退回本地那句', () => {
  const handle = registerFileEditorProvider({
    id: LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyWordWrapOff',
    accept: () => true,
    createEditor: () => ({ features: { lsp: true, syntaxHighlighting: true, wordWrap: false }, notice: '' }),
  })
  try {
    const policy = largeFilePolicyForText(BIG)
    assert.equal(policy.large, true, '三个能力里有任何一个没开就是降级档')
    assert.deepEqual(policy.features, { lsp: true, syntaxHighlighting: true, wordWrap: false })
    assert.equal(policy.notice, LARGE_FILE_NOTICE, '视图没给文案 ⇒ 退回本地那句，不是空提示')
  } finally {
    handle.dispose()
    restoreBundled()
  }
})

test('抑制器挡住 ⇒ 没有视图 ⇒ 退回本地档（不再吃别的提供者的 features）', () => {
  const provider = registerFileEditorProvider({
    id: LARGE_FILE_EDITOR_PROVIDER_ID,
    getEditorTypeId: () => 'ThirdPartyLargeFile',
    accept: () => true,
    createEditor: () => ({ features: FULL, notice: '第三方说不用降级' }),
  })
  const suppressor = registerFileEditorProviderSuppressor({
    id: 'test.suppressBigFiles',
    suppress: input => (input.bytes ?? 0) >= LARGE_FILE_LIMIT,
  })
  try {
    const policy = largeFilePolicyForText(BIG)
    assert.equal(policy.large, true, '被抑制 ⇒ largeFileEditorViewFor 给 null ⇒ 本地按字节档')
    assert.deepEqual(policy.features, REDUCED)
    assert.equal(policy.notice, LARGE_FILE_NOTICE)
    assert.equal(largeFilePolicyForText('abc').large, false, '小文件本来就不问 EP，不受抑制器影响')
  } finally {
    suppressor.dispose()
    provider.dispose()
    restoreBundled()
  }
})
