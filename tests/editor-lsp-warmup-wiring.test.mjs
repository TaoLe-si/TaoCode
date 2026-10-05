// CodeEditor 的三条导入期重试接线（真机缺陷：JDT 导入期间 semanticTokens/foldingRange/diagnostic
// 全 60 秒超时，只发一次、失败被吞 ⇒ 导入完成后文件没颜色）。规则在 src/lspWarmup.ts，
// 这条用例只钉"接上了、且成功判定是非空"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const editor = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')

test('three warmups are created from the shared LspWarmup', () => {
  assert.match(editor, /import \{ LspWarmup \} from '\.\.\/lspWarmup'/)
  assert.match(editor, /const semanticWarmup = new LspWarmup\(\{ run: runSemanticTokens \}\)/)
  assert.match(editor, /const foldingWarmup = new LspWarmup\(\{ run: foldingWarmupRun \}\)/)
  assert.match(editor, /const diagnosticWarmup = new LspWarmup\(\{ run: runPullDiagnostics \}\)/)
})

test('the three schedulers start the warmup instead of firing a single request', () => {
  assert.match(editor, /void semanticWarmup\.start\(\)/)
  assert.match(editor, /void diagnosticWarmup\.start\(\)/)
  assert.match(editor, /foldingWarmup\.start\(\)/)
})

test('non-empty means ready; available: false ends the retries', () => {
  // 语义着色：非空 data 才算成功；available:false 直接 true（能力没有，不再试）。
  assert.match(editor, /return semanticData\.length > 0/)
  assert.match(editor, /if \(!result\.available\) \{ resetSemanticTokens\(\); target\.dispatch\(\{ effects: setSemanticTokens\.of\(\[\]\) \}\); return true \}/)
  // 折叠：available:false ⇒ true；区间为空 ⇒ false（导入期还会再试）。
  assert.match(editor, /if \(!result\.available\) return true\n    if \(!\(result\.ranges \?\? \[\]\)\.length\) return false/)
  // pull 诊断：unsupported / unchanged 都算"到此为止"；非空 items 才算成功。
  assert.match(editor, /if \(!report\.supported\) \{ clearPullDiagnostics\(props\.path\); return true \}/)
  assert.match(editor, /if \(report\.kind === 'unchanged'\) return true/)
  assert.match(editor, /return \(report\.items \?\? \[\]\)\.length > 0/)
})

test('换文件与卸载都会 cancel', () => {
  assert.match(editor, /function cancelWarmups\(\) \{ semanticWarmup\.cancel\(\); foldingWarmup\.cancel\(\); diagnosticWarmup\.cancel\(\) \}/)
  assert.match(editor, /watch\(\(\) => props\.path, \(\) => \{ cancelWarmups\(\);/)
  assert.match(editor, /onBeforeUnmount\(\(\) => \{ cancelWarmups\(\);/)
})
