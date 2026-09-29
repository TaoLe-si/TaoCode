// 「月相」配色体系的两条结构约束 + 浮层族统一规格。
//
// 为什么要机检而不是靠眼看：换主题的实现方式是"只换 `--m-*` 那一层，语义名一个都不动"。
// 这个做法的好处是加一个语义令牌就自动两档生效，坏处是**只要有一档漏了某个 `--m-*`**，
// 那一档就会静默沿用另一档的值 —— 表现是"切到暗面后某一格还是亮面的颜色"，
// 而 CSS 不报错、看不出来。所以这里把"两档月相名必须一模一样"钉死。
// 另一条：浮层（菜单、补全、各处下拉）以前每个类自带一套 border/shadow 配方，
// 19 个浮层 5 种写法；现在统一走 `--popup-*`，所以禁止再出现裸配方。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const tokens = read('src/tokens.css')
const darkAt = tokens.indexOf("[data-theme='dark']")
const lightBlock = tokens.slice(0, darkAt)
const darkBlock = tokens.slice(darkAt)

/** 某个块里声明过的 `--m-*` 名字集合。 */
function moonNames(block) {
  return new Set([...block.matchAll(/^\s*(--m-[a-z0-9-]+):/gm)].map(m => m[1]))
}

test('两档主题的月相层是同一批名字（漏一个就会静默串色）', () => {
  const light = moonNames(lightBlock)
  const dark = moonNames(darkBlock)
  assert.ok(light.size >= 40, `月相层应当有一批中性/强调/夜面/浮层色，实际 ${light.size} 个`)
  assert.deepEqual([...light].filter(name => !dark.has(name)), [],
    '深色主题缺这些月相名 —— 切到暗面时它们会沿用亮面的值')
  assert.deepEqual([...dark].filter(name => !light.has(name)), [],
    '亮色主题缺这些月相名 —— 切到亮面时它们会沿用暗面的值')
})

test('语义层不写裸色：只有月相层允许十六进制', () => {
  // 语义别名块 = 从第一处 `var(--m-` 到 `:root` 结束；里面出现裸色就是绕过月相层。
  const semantic = lightBlock.slice(lightBlock.indexOf('--editor: var(--m-editor)'))
  const raw = [...semantic.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}[^;]*);/gm)]
    // 例外：阴影/遮罩的基色两档不同（亮面用墨、暗面用纯黑），只能各写一次。
    .filter(m => !['--shadow', '--backdrop', '--file-color-blue', '--file-color-green', '--file-color-orange',
      '--file-color-rose', '--file-color-violet', '--file-color-yellow', '--file-color-gray'].includes(m[1]))
  assert.deepEqual(raw.map(m => `${m[1]}: ${m[2]}`), [],
    '这些语义令牌绕过了月相层，换主题时不会跟着换面')
})

test('补全弹窗不再自带颜色，只读令牌（所以它跟着主题换面）', () => {
  const completion = read('src/completionUi.ts')
  assert.doesNotMatch(completion, /#[0-9a-fA-F]{6}\b/, 'completionUi.ts 里又出现了裸色')
  assert.doesNotMatch(completion, /completionColors|colorRules/, '颜色应由 tokens 提供，不该再按 CM 的 light/dark 各发一份')
  for (const role of ['--completion-background', '--completion-foreground', '--completion-match',
    '--completion-selection', '--completion-inactive', '--completion-info', '--popup-radius', '--popup-shadow']) {
    assert.ok(tokens.includes(`${role}:`), `缺少令牌 ${role}`)
  }
})

test('补全弹窗不得裁掉自己的文档面板', () => {
  // CM 把 .cm-completionInfo 绝对定位在 tooltip 内、列表右侧：容器一旦 overflow: hidden 就被裁没。
  const completion = read('src/completionUi.ts')
  const container = /'\.cm-tooltip\.tc-completion': \{([\s\S]*?)\}/.exec(completion)
  assert.ok(container, '找不到补全弹窗容器的规则')
  assert.doesNotMatch(container[1], /overflow: 'hidden'/, '容器不能裁切：右侧文档面板会被切掉')
  assert.match(container[1], /borderRadius: 'var\(--popup-radius\)'/, '圆角走浮层族令牌')
})

test('浮层族统一：absolute/fixed 的浮层不再自带 border/shadow 配方', () => {
  const files = ['src/style.css', 'src/components/BookmarksPanel.vue', 'src/components/BranchPopup.vue',
    'src/components/WelcomePage.vue', 'src/components/SettingsDialog.vue', 'src/components/TodoPanel.vue',
    'src/components/RunConfigurationsDialog.vue']
  const offenders = []
  for (const file of files) {
    for (const line of read(file).split('\n')) {
      if (!/position: (absolute|fixed)/.test(line) || !/border:/.test(line)) continue
      if (/border: 1px solid var\(--line-strong\)/.test(line)) offenders.push(`${file}: ${line.slice(0, 60)}…`)
      if (/box-shadow: (var\(--menu-shadow\)|0 8px 24px rgb\(0 0 0 \/ 18%\))/.test(line)) offenders.push(`${file}: 旧阴影配方`)
    }
  }
  assert.deepEqual(offenders, [], '这些浮层还在用自己的配方，与补全弹窗不是同一套规格')
})

test('补全弹窗的出现动效与菜单同一套语汇，且尊重 reduced-motion', () => {
  const style = read('src/style.css')
  assert.match(style, /\.cm-tooltip\.tc-completion \{ animation: completion-in var\(--dur-1\) var\(--ease\)/,
    '补全弹窗要有出现动效（用时长/缓动令牌，不写死毫秒）')
  assert.match(style, /@keyframes completion-in \{ from \{ opacity: 0; translate: 0 2px; \} \}/,
    '用独立的 translate 属性，避免和 CM 自己写的 transform 打架')
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion 的全局兜底不能少')
})
