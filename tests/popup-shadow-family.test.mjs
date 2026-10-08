// 「浮层族阴影只有一档」的门禁（2026-10-06 UI 对标线，第一百二十一批）。
//
// 成文规则在 `src/tokens.css:348-350`：
//   「浮层族只有一档阴影：菜单、补全、各处下拉共用 --m-menu-shadow。
//     对话框才用更重的 --shadow-3（它是窗中窗，需要更大的高度差）。」
// 这条规则当时只有注释，没有机检 —— 于是实际散成三档：`--shadow-2`、`--shadow-3`、`--popup-shadow`
// 在**同一个角色**（贴着触发器展开的菜单/弹层）上并存，换主题时相邻浮层的投影深浅还不一样。
//
// 本批收口（8 处，全部是"同角色的浮层用了非族内令牌"）：
//   · `src/components/VcsLog.vue` 的 `.log-menu` —— 用了**对话框档** `--shadow-3`（它是右键菜单，不是窗中窗）；
//   · `src/components/MainToolbar.vue` 的三个下拉（`.run-more-popup` / `.targets-popup` / `.run-dashboard-popup`）；
//   · `src/components/TodoPanel.vue` 的 `.groupby-popup`；
//   · `src/components/SearchEverywhereDialog.vue` 的 `.se-funnel-panel`；
//   · `src/components/ProjectStructurePane.vue` 的 `.ps-popup`（行内展开的输入浮层，role=dialog 只是可达性语义）；
//   · `src/style.css` 的 `.quick-eval-hint`（调试悬停值提示）与 `.signature-popup`（参数信息）。
//
// `.workspace-notice`（右下角 toast）**故意保留** `--shadow-2`：它不是"贴着触发器展开的菜单"，
// 是常驻通知条；它的类名不带浮层语素，本门禁的结构式那一条不会把它扫进来，也就无需例外表。
//
// 判据（结构式，只管本线名下的样式文件：`src/style.css` + `src/components/**` 里除四个大组件外的 `.vue`）：
//   1. 选择器带浮层语素（dropdown / popup / menu / tooltip / hint）的规则，不许声明 `--shadow-2`/`--shadow-3`；
//   2. 上表点名的那些类必须**真的**引 `--popup-shadow`（别悄悄退回裸数字或老令牌）；
//   3. `--shadow-3` 只许出现在对话框的选择器上 —— 用一张**写死理由的允许表**钉住，多一处就红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

/** 本线名下的样式文件（四个大组件 lane 独占的文件不在内）。 */
const FORBIDDEN = new Set(['CodeEditor.vue', 'DebugPanel.vue', 'SourceControl.vue', 'DiffView.vue', 'EditorFindBar.vue'])
const OWNED_VUE = readdirSync('src/components')
  .filter(f => f.endsWith('.vue') && !FORBIDDEN.has(f))
  .map(f => `src/components/${f}`)
const STYLE_FILES = ['src/style.css', ...OWNED_VUE]

/** 只取样式块（`.vue` 只扫 `<style>` 里的内容，免得把模板里的内联样式误伤）。 */
function styleText(file) {
  const text = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return text
  const blocks = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text))) blocks.push(m[1])
  return blocks.join('\n')
}

/** 把一条样式表拆成 `选择器 → 声明体`。 */
function rules(css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selector = m[1].trim()
    if (selector) out.push({ selector, body: m[2] })
  }
  return out
}

/** 浮层语素：贴触发器展开的菜单/下拉/补全/提示这类"同族"浮层。 */
const POPUP_MORPHEME = /\.(?:[\w-]*(?:dropdown|popup|menu|tooltip|hint)[\w-]*)\b/

/** 本批点名的类 → 所在文件（正查它真的换了令牌）。 */
const NAMED = [
  ['src/components/VcsLog.vue', '.log-menu'],
  ['src/components/MainToolbar.vue', '.run-more-popup'],
  ['src/components/MainToolbar.vue', '.targets-popup'],
  ['src/components/MainToolbar.vue', '.run-dashboard-popup'],
  ['src/components/TodoPanel.vue', '.groupby-popup'],
  ['src/components/SearchEverywhereDialog.vue', '.se-funnel-panel'],
  ['src/components/ProjectStructurePane.vue', '.ps-popup'],
  ['src/style.css', '.quick-eval-hint'],
  ['src/style.css', '.signature-popup'],
]

/** 允许用对话框档 `--shadow-3` 的选择器 —— 每一项都写清为什么它是"窗中窗"而不是菜单。 */
const DIALOG_SHADOW3 = new Map([
  ['.diff-dialog', '并排差异对话框（App.vue 内 role=dialog）'],
  ['.command-palette', '寻找操作/最近文件/转到文件一族的模态壳（role=dialog）'],
  ['.mnemonic-pop', '书签助记符选择器（BookmarkMnemonicChooser role=dialog）'],
  ['.help-dialog', '帮助对话框'],
  ['.task-editor', 'Gradle 任务编辑器（GradlePanel 内 role=dialog aria-modal）'],
])

test('浮层族的选择器不许用 --shadow-2 / --shadow-3（只有一档 --popup-shadow）', () => {
  const bad = []
  let scanned = 0
  for (const file of STYLE_FILES) {
    for (const { selector, body } of rules(styleText(file))) {
      if (!POPUP_MORPHEME.test(selector)) continue
      scanned += 1
      const m = body.match(/(?:^|[;\s])box-shadow\s*:\s*([^;]+)/)
      if (!m) continue
      const value = m[1].trim()
      if (/var\(--shadow-[23]\)/.test(value)) {
        bad.push(`${file}: ${selector} { box-shadow: ${value} }`)
      }
    }
  }
  assert.ok(scanned >= 20, `只扫到 ${scanned} 条浮层规则 —— 门禁本身可能空转了`)
  assert.deepEqual(bad, [],
    `这些浮层用了别的档位阴影（菜单/补全/下拉共用 --popup-shadow，--shadow-3 只留给对话框）：\n${bad.join('\n')}`)
})

test('本批点名的九个类都真的引了 --popup-shadow', () => {
  for (const [file, cls] of NAMED) {
    const text = readFileSync(file, 'utf8')
    const m = text.match(new RegExp(`${cls.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))
    assert.ok(m, `${file} 里找不到 ${cls}`)
    const shadow = m[1].match(/(?:^|[;\s])box-shadow\s*:\s*([^;]+)/)
    assert.ok(shadow, `${cls} 没有 box-shadow 声明`)
    assert.equal(shadow[1].trim(), 'var(--popup-shadow)',
      `${cls} 的阴影应走 --popup-shadow（它属于菜单/浮层族）`)
  }
})

test('--shadow-3 只许出现在对话框选择器上（允许表写死理由，多一处即红）', () => {
  const found = []
  for (const file of STYLE_FILES) {
    for (const { selector, body } of rules(styleText(file))) {
      if (!/var\(--shadow-3\)/.test(body)) continue
      // 一条规则可以写多个选择器（逗号分隔），逐个核。
      for (const one of selector.split(',').map(s => s.trim()).filter(Boolean)) {
        found.push({ file, selector: one })
        assert.ok(DIALOG_SHADOW3.has(one),
          `${file} 的 ${one} 用了 --shadow-3，但它不是允许表里的对话框 —— `
          + '贴着触发器展开的浮层要用 --popup-shadow（规则见 src/tokens.css:348-350）。')
      }
    }
  }
  // 允许表不能过期：表里每一项都必须还能在样式里找到，否则删掉那一行。
  for (const selector of DIALOG_SHADOW3.keys()) {
    assert.ok(found.some(item => item.selector === selector),
      `允许表里的 ${selector} 已经不用 --shadow-3 了 —— 把它从 DIALOG_SHADOW3 移除`)
  }
})
