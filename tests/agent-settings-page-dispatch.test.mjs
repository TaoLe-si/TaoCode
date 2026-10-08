// Agent 设置页的**分节派发**判据：15 个节位每一个都要有落点，且不留在「诚实空态」里。
//
// 起因：这一页原先把 9 节渲染成同一段兜底空态（说清 ZCode 管什么、本仓缺哪块）。那一段是
// 过渡期的正确做法，但**过渡期会变成永久**——节位在、控件不在，用户每次进来都读到同一句。
// 现在 9 节各有自己的纯逻辑模块 + 自己的组件，所以本页的职责收回到「节导航 + Agent 总设置」。
//
// 这里钉两件事：
//   ① 节清单与 ZCode 的 `BASE_SETTINGS_SECTIONS` **逐个对齐**（顺序、id、标题都算）；
//   ② 每一个节位都有渲染出口，没有一个落到 v-else 兜底里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/components/AgentSettingsPage.vue', import.meta.url), 'utf8')

/** ZCode `settingsPageConfig.ts` 中已移植的 15 个节位，三组，顺序逐条对齐。 */
const ZCODE_SECTIONS = [
  ['general', '常规', 'basics'], ['appearance', '外观', 'basics'], ['modelProvider', '模型设置', 'basics'],
  ['browser', '浏览器控制', 'basics'], ['computerUse', '电脑控制', 'basics'],
  ['shortcuts', '键盘快捷键', 'basics'],
  ['memory', '记忆', 'agentCapabilities'], ['subagents', '子智能体', 'agentCapabilities'],
  ['plugin', '插件', 'agentCapabilities'], ['mcp', 'MCP 服务器', 'agentCapabilities'],
  ['skill', '技能', 'agentCapabilities'], ['commands', '命令', 'agentCapabilities'],
  ['automations', '自动化', 'agentCapabilities'], ['hooks', '钩子', 'agentCapabilities'],
  ['usage', '使用统计', 'dataAndStats'],
]

test('节清单：15 节的 id 与中文标题逐条对齐 ZCode 的 BASE_SETTINGS_SECTIONS', () => {
  for (const [id, label] of ZCODE_SECTIONS) {
    assert.match(page, new RegExp(`\\{ id: '${id}', label: '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
      `节位 ${id}（${label}）不在侧栏表里`)
  }
})

test('三组标题与顺序照 ZCode（基础设置 / Agent 能力 / 数据与统计）', () => {
  const basics = page.indexOf("title: '基础设置'")
  const capabilities = page.indexOf("title: 'Agent 能力'")
  const dataAndStats = page.indexOf("title: '数据与统计'")
  assert.ok(basics > 0 && capabilities > basics && dataAndStats > capabilities,
    '三组标题的先后顺序照 settingsPageConfig.ts 的 BASE_SETTINGS_SECTION_GROUPS')
})

test('每个节位都有渲染出口（没有一节落到 v-else 兜底里）', () => {
  // 正面：逐节找它的出口标记。
  for (const [id] of ZCODE_SECTIONS) {
    assert.match(page, new RegExp(`section === '${id}'`), `节位 ${id} 在模板里没有出口`)
  }
  // 反面：**不许**再有 `v-else` 的兜底块。九节各有组件之后，那段兜底是不可达的 ——
  // 留着就等于「万一有新节位进来就显示一段假说明」。
  assert.doesNotMatch(page, /<template v-else>\s*\n\s*<p class="section-description">ZCode 有这一节/,
    '兜底空态还在：新节位会静默读到那段说明，而不是知道自己没实现')
  // 阳性对照：本页确实还有 `v-else-if` 链（证明上面那条 doesNotMatch 不是空判据）。
  assert.match(page, /v-else-if="section === 'usage'"/, '阳性对照：本页确实按节位分派')
})

test('九节各有自己的组件，页面不内联它们的内容（一个文件一个职责域）', () => {
  const components = [
    'MemorySettingsSection', 'HooksSettingsSection', 'AutomationsSettingsSection',
    'McpSettingsSection', 'SkillsSettingsSection', 'SubagentsSettingsSection', 'PluginsSettingsSection',
    'BrowserControlSettingsSection', 'ComputerUseSettingsSection',
  ]
  for (const name of components) {
    assert.match(page, new RegExp(`import ${name} from '\\./agent-settings/${name}\\.vue'`), `没 import ${name}`)
    assert.match(page, new RegExp(`<${name}[ /]`), `模板里没挂 ${name}`)
  }
  // 组件本体必须真的存在（import 一个不存在的文件是构建期错误，不是运行时才发现）。
  const dir = new URL('../src/components/agent-settings/', import.meta.url)
  for (const name of components) {
    const file = new URL(`${name}.vue`, dir)
    assert.doesNotThrow(() => readFileSync(file, 'utf8'), `${name}.vue 不存在`)
  }
})

test('拆出去的那几节不进本页的保存按钮（各自的草稿在节里，别互相覆盖）', () => {
  // 本页的 draft 是 **Agent 总设置**（常规 / 模型设置）。若把别节的字段塞进来，
  // 点一次「保存」会把别的节一并覆盖 —— 所以保存按钮只在这两节出现。
  assert.match(page, /v-if="section === 'general' \|\| section === 'modelProvider'"/,
    '保存按钮的可见范围应只覆盖总设置那两节')
})
