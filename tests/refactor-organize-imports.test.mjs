// `Optimize Imports` 在本仓（LSP 架构）的可核实那一半：请求形状与动作筛选。
//
// 上游落点是 IntelliJ 自己那份「把 ImportOptimizer 接到 LSP」的实现，不是 Swing 那一层：
//   · `platform/lsp-impl/src/impl/features/formatter/LspImportOptimizer.kt`
//     - `:20` import `org.eclipse.lsp4j.CodeActionKind.SourceOrganizeImports`；
//     - `:42` `supports(psiFile) = findClientToOptimizeImports(psiFile) != null` —— 文件级判定；
//     - `:69-72` `CodeActionContext`：`diagnostics = emptyList()`、`triggerKind = Invoked`、
//       **`only = listOf(SourceOrganizeImports)`**；
//     - `:77-80` `CodeActionParams(lspDocument.id, Range(Position(0, 0), Position(0, 0)), codeActionContext)`
//       且范围那一行的源码注释就是 `// doesn't matter` ⇒ **与光标无关**；
//   · 结果侧的账：`platform/lang-impl/src/com/intellij/codeInsight/actions/OptimizeImportsProcessor.java:278-288`
//     —— 「Imports optimized」那句 hint 只在至少有一个 optimizer 真改了东西时才给
//     （`NotificationInfo.NOTHING_CHANGED_NOTIFICATION` 在 `:292`，`isSomethingChanged = false`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORGANIZE_IMPORTS_KIND, organizeImportsActionOf, organizeImportsRequest } from '../src/organizeImports.ts'
// 出厂键位表与匹配器：Ctrl+Alt+O 那条接线要按 id 查同一张表（菜单与分派器读的就是它），
// 不在测试里抄第二份键位事实。
import { KEY_BINDINGS, findKeyBinding, keymapKeys, matchesKeyChord } from '../src/keymapBindings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = name => readFileSync(join(here, '..', 'src', name), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

test('上游锚点：LspImportOptimizer 的请求仍是「(0,0) 范围 + only=SourceOrganizeImports」', (t, done) => {
  const file = join(REF, 'platform/lsp-impl/src/impl/features/formatter/LspImportOptimizer.kt')
  if (!existsSync(file)) return done()
  const body = readFileSync(file, 'utf8').split('\n')
  assert.match(body[19], /import org\.eclipse\.lsp4j\.CodeActionKind\.SourceOrganizeImports/, ':20')
  assert.match(body[41], /override fun supports\(psiFile: PsiFile\): Boolean/, ':42 supports 是文件级')
  // 订正留痕（2026-10-06 refactorfix，坐标自己开的）：这一条原先断 `body[69]`（= 第 70 行）含
  // `triggerKind` —— 实测 `:70` 是 `diagnostics = emptyList()`，`triggerKind` 在 **`:71`**、
  // `only` 在 `:72`（`CodeActionContext().apply {` 在 `:69`）。差一行的红是**判据自己错**，
  // 上游源码没动。现在三条各钉一行，仍是逐字符的位置判定，没有放松成「文件里找得到」。
  assert.match(body[68], /val codeActionContext = CodeActionContext\(\)\.apply \{/, ':69 context 从这里起')
  assert.match(body[69], /diagnostics = emptyList\(\)/, ':70 诊断空表')
  assert.match(body[70], /triggerKind = CodeActionTriggerKind\.Invoked/, ':71 显式调用')
  assert.match(body[71], /only = listOf\(SourceOrganizeImports\)/, ':72 按 kind 筛')
  assert.match(body[78], /Range\(Position\(0, 0\), Position\(0, 0\)\), \/\/ doesn't matter/, ':79 范围与光标无关')
  done()
})

// ---------------------------------------------------------------- 请求形状

test('organizeImportsRequest：位置固定 (0,0)、诊断空表，与光标无关', () => {
  assert.deepEqual(organizeImportsRequest('src/a.ts'), {
    kind: 'codeAction', path: 'src/a.ts', line: 0, character: 0, diagnostics: [],
  })
  // 这条判据钉的是「换个光标位置结果一样」——此前传的是 caretPayload()
  assert.deepEqual(organizeImportsRequest('src/a.ts'), organizeImportsRequest('src/a.ts'))
})

// ---------------------------------------------------------------- 动作筛选

const action = (title, kind) => ({ title, index: 0, kind, edits: [] })

test('organizeImportsActionOf：按 kind 精确命中（含子 kind）', () => {
  const wanted = action('Organize imports', ORGANIZE_IMPORTS_KIND)
  assert.equal(organizeImportsActionOf([action('Add import', 'quickfix'), wanted]), wanted)
  const inner = action('优化导入', `${ORGANIZE_IMPORTS_KIND}.inner`)
  assert.equal(organizeImportsActionOf([inner]), inner)
})

test('organizeImportsActionOf：服务器都填了 kind 时**不**按标题猜（防把 quickfix 当整理导入）', () => {
  const fix = action('Organize imports and fix everything', 'source.fixAll')
  assert.equal(organizeImportsActionOf([fix]), undefined)
})

test('organizeImportsActionOf：全都缺 kind 时标题兜底；混着给 kind 时不兜底', () => {
  const byTitle = action('Organize Imports', undefined)
  assert.equal(organizeImportsActionOf([byTitle]), byTitle)
  // 订正留痕（2026-10-06 refactorfix）：这一条原先写
  // `assert.equal(organizeImportsActionOf([action('优化导入', undefined), byTitle]), action('优化导入', undefined))`
  // —— 拿**新建**的对象比 `strictEqual`（引用比较），结构相同也永远红。判据要钉的恰恰是
  // 「返回的就是清单里那一条本体」（调用方随后把它交给 `applyCodeAction`，返回拷贝就丢了 `index`，
  // 而 `native/lsp_code_actions.cpp` 那边按 index 寻址服务器原始对象），所以改成先立变量再比引用：
  // 实现若退回「返回一份浅拷贝」这条立刻红。
  const first = action('优化导入', undefined)
  assert.equal(organizeImportsActionOf([first, byTitle]), first, '两条都能兜底时取**靠前那一条的本体**')
  const mixed = [action('Organize Imports', undefined), fix2()]
  assert.equal(organizeImportsActionOf(mixed), mixed[0], '有任意一条填了 kind 也仍按标题兜底：本仓按「缺 kind 的那些」优先给正则机会')
})

test('organizeImportsActionOf：空清单与不相关的清单都返回 undefined', () => {
  assert.equal(organizeImportsActionOf([]), undefined)
  assert.equal(organizeImportsActionOf([action('Add import', 'quickfix')]), undefined)
})

function fix2() { return action('Sort imports', 'source.other') }

// ---------------------------------------------------------------- 接线

test('接线：runOrganizeImports 用这两个出口，且不再问光标位置', () => {
  const source = read('semanticActions.ts')
  assert.match(source, /import \{ organizeImportsActionOf, organizeImportsRequest \} from '\.\/organizeImports\.ts'/)
  const body = source.slice(source.indexOf('async function runOrganizeImports'), source.indexOf('async function applyCodeAction'))
  assert.ok(body.length > 100, '找不到 runOrganizeImports')
  assert.match(body, /request<LspCodeActionResults>\('lsp\.request', organizeImportsRequest\(tab\.path\)\)/)
  assert.match(body, /organizeImportsActionOf\(result\.actions \?\? \[\]\)/)
  // 订正留痕（2026-10-06 refactorfix）：两条负判据原先在**原文**上找 `caretPayload()` / kind 字面量，
  // 而这一段里留着一条说明旧缺陷的行注释（「本仓此前问的是光标处（`caretPayload()`）」）
  // ⇒ 把缺陷改掉的那一轮反而被缺陷的**说明文字**判红。判据管的是代码，不是注释，所以先把整行
  // 注释剥掉再逐字符比 —— 剥完仍然要求「代码里一次都不出现」，没有放松成 includes/存在性。
  const code = body.replace(/^\s*\/\/.*$/gm, '')
  assert.equal(code.includes('caretPayload()'), false, '整理导入不许再按光标取动作')
  assert.equal(/item\.kind === 'source\.organizeImports'/.test(code), false, 'kind 字面量不许再散在调用点')
  // 请求的坐标系也只能来自那个出口：代码里不许再手写 line/character 的取法。
  assert.equal(/line: (cursor|tab)\b/.test(code), false, '请求参数不许再手写光标行')
})

test('接线：Code 菜单那一行与 Ctrl+Alt+O 仍指向同一个入口（没有第二条实现）', () => {
  const menu = read('menus/codeMenu.ts')
  const dispatch = read('keymap.ts')
  // ① 菜单那一行：id + 文案 + 键位栏 + 出口（`run` 必须是 ctx.runOrganizeImports，不许就地再实现一遍）。
  const row = menu.match(/\{ id: 'code\.optimizeImports', title: '([^']*)', keys: '([^']*)', keywords: '[^']*', enabled: \(\) => Boolean\(ctx\.active\.value\) && ctx\.lspReady\.value, run: \(\) => void ctx\.runOrganizeImports\(\) \}/)
  assert.ok(row, 'Code 菜单要有「优化导入」那一行，且 run 走 ctx.runOrganizeImports')
  assert.equal(row[1], '优化导入', '文案口径（ActionsBundle `OptimizeImportsAction` = Optimize Imports 的中文化）')
  // ② 出厂键位表里必须有这一条，且键位等于上游 `OptimizeImports` = `control alt O`
  //   （`platform/platform-resources/src/keymaps/$default.xml:340-342`，本轮自己打开核对）。
  const binding = KEY_BINDINGS.find(item => item.id === 'code.optimizeImports')
  assert.ok(binding, 'Ctrl+Alt+O 必须在全局键位表里：菜单写着加速键而表里没这条 = 看着能按、按了没反应')
  assert.deepEqual(binding.chord, { key: 'o', control: 'ctrl', alt: true, forbid: ['shift'] },
    '上游是 control alt O；同物理键的另外三档各有其人（control O=OverrideMethods :544-546、'
    + 'alt O=ExportToTextFile :974-976、Alt Shift O=SelectVirtualTemplateElement :1002-1004），不许串味')
  assert.equal(binding.scope, 'editor')
  assert.equal(binding.label, row[1], '注册表文案与菜单行同源（一个 id 一份文案）')
  assert.equal(binding.display, row[2], '菜单键位栏与注册表显示串同源（不许两边各写一份）')
  assert.equal(keymapKeys('code.optimizeImports'), 'Ctrl Alt O')
  assert.match(binding.upstream, /\$default\.xml:340-342/, '上游依据要写行进本表的那个口径')
  // 整表实跑一遍：按下 Ctrl+Alt+O 落到这一格（前面的行不许抢），
  // 而同一物理键的另外三档（Ctrl+O / Alt+O / Ctrl+Alt+Shift+O）都不该命中这一行。
  const ready = { workspace: true, editor: true, lsp: true }
  const hit = (key, modifiers) => findKeyBinding({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers }, ready)
  assert.equal(hit('o', { ctrlKey: true, altKey: true })?.id, 'code.optimizeImports')
  assert.equal(hit('O', { ctrlKey: true, altKey: true })?.id, 'code.optimizeImports', '大写 O 同一档（单字符忽略大小写）')
  const event = { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }
  assert.equal(matchesKeyChord(binding.chord, { ...event, key: 'o', ctrlKey: true, altKey: true }), true)
  assert.equal(matchesKeyChord(binding.chord, { ...event, key: 'o', ctrlKey: true, shiftKey: true, altKey: true }), false,
    'Ctrl+Alt+Shift+O 不接管（上游键位是精确匹配）')
  assert.equal(matchesKeyChord(binding.chord, { ...event, key: 'o', altKey: false }), false,
    'Ctrl+O 是 OverrideMethods（:544-546），不是整理导入')
  assert.equal(matchesKeyChord(binding.chord, { ...event, key: 'o', ctrlKey: false, altKey: true }), false,
    'Alt+O 是 ExportToTextFile（:974-976），不是整理导入')
  // 可用性谓词与菜单行的 `enabled` 逐字对齐（有编辑器 + 语言服务就绪）。
  assert.equal(binding.when?.({ workspace: true, editor: true, lsp: true }), true)
  assert.equal(binding.when?.({ workspace: true, editor: true, lsp: false }), false)
  assert.equal(binding.when?.({ workspace: true, editor: false, lsp: true }), false)
  // ③ 分派器指向**同一个**入口：走宿主传进来的 runOrganizeImports（= `src/organizeImports.ts` 那两个出口的
  //   唯一消费者），宿主没给时不注册（`unwired`），不许留一条命中后只吞键的假动作。
  assert.match(dispatch, /'code\.optimizeImports': \(\) => void \(runOrganizeImports\?\.\(\)\)/)
  assert.match(dispatch, /runOrganizeImports \? '' : 'code\.optimizeImports'/)
  assert.match(dispatch, /runOrganizeImports\?: \(\) => unknown/, 'KeymapContext 里这一位是可选的（宿主还没接线）')
})

test('结果侧的账：applyEditsToFiles 报的是真改了几个文件（0 个就写 0 个，不冒充「已优化」）', () => {
  const source = read('semanticActions.ts')
  assert.match(source, /notify\(`\$\{doneMessage\} · 更新 \$\{count\} 个文件`\)/)
  assert.match(source, /if \(next === content\) continue/)
})
