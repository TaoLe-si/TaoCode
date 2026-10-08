// 四个设置节组件的**接线判据**（子智能体 / 插件 / 浏览器控制 / 电脑控制）—— 2026-10-07。
//
// 钉住的是「渲染层不许自己发挥」这条纪律，不是组件好不好看：
//   1. 四节都用 `AgentSettingsSectionShell` 包起来，说明取自模块或本节自己的常量。
//   2. 浏览器 / 电脑控制两节**没有设置面**：一个原生控件都没有，也没有保存按钮。
//      子智能体 / 插件两节的控件只作用在模块自己的持久化字段上。
//   3. 子智能体那个 `AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS` 是 **ZCode 那边可选的档位**，
//      渲染时标明它是对照清单、且不给可勾选的控件。
//   4. 导入路径不带 `.ts` 扩展（本仓 `.vue` 的既有约定）。
// 至少有一条判据**真的把 SFC 模板跑一遍**（`loadSfc` + `renderToString`），
// 其余是源码接线断言 —— 因为这个仓没有 DOM，SSR 是唯一能验「控件真的渲染出来了」的路。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rel = name => `src/components/agent-settings/${name}.vue`
const source = name => readFileSync(join(root, rel(name)), 'utf8')

const SUBAGENTS = 'SubagentsSettingsSection'
const PLUGINS = 'PluginsSettingsSection'
const BROWSER = 'BrowserControlSettingsSection'
const COMPUTER_USE = 'ComputerUseSettingsSection'
const ALL = [SUBAGENTS, PLUGINS, BROWSER, COMPUTER_USE]

const {
  AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS, AGENT_SUBAGENTS_STORAGE_KEY,
} = await import('../src/agentSubagents.ts')
const { AGENT_PLUGINS_STORAGE_KEY } = await import('../src/agentPlugins.ts')
const {
  computerUseAvailability, browserControlAvailability, cuaPermissionPreparation,
} = await import('../src/agentComputerUse.ts')

/** 模板里出现的原生表单控件标签（组件标签不算）。 */
const CONTROL_TAGS = ['input', 'select', 'textarea']

/** 某节模板里出现的原生控件标签清单。 */
function controlTags(src) {
  const template = src.slice(src.indexOf('<template>'), src.indexOf('<style'))
  return CONTROL_TAGS.filter(tag => new RegExp(`<${tag}[\\s>/]`).test(template))
}

// ── 1 · 四节都用 shell ────────────────────────────────────────────────────────

test('四节都用 AgentSettingsSectionShell 包起来（节标题/说明是共用口径，不许各写一份）', () => {
  // 阳性对照：shell 自己确实带这个 prop（不然这条会变成「引用了个不存在的东西也算过」）。
  const shell = readFileSync(join(root, 'src/components/agent-settings/AgentSettingsSectionShell.vue'), 'utf8')
  assert.ok(shell.includes('description'), 'shell 没有 description 这一格，先确认口径再判组件')
  for (const name of ALL) {
    const src = source(name)
    assert.ok(src.includes("from './AgentSettingsSectionShell.vue'"), `${rel(name)} 没有 import shell`)
    assert.match(src, /<AgentSettingsSectionShell\b/, `${rel(name)} 模板里没有用 shell 包`)
    assert.match(src, /:description=/, `${rel(name)} 没有把 description 交给 shell`)
  }
})

// ── 2 · 不放假控件 ────────────────────────────────────────────────────────────

test('浏览器控制 / 电脑控制两节一个原生控件都没有（可用性判定没有设置面，不许画开关）', () => {
  for (const name of [BROWSER, COMPUTER_USE]) {
    assert.deepEqual(controlTags(source(name)), [],
      `${rel(name)} 里出现了原生控件：这两节只判定可用性，画成能点的东西就是放假控件`)
  }
  // 阳性对照：子智能体 / 插件两节**确实**有控件 —— 否则上一条可能只是「正则没匹配上」。
  assert.ok(controlTags(source(SUBAGENTS)).includes('input'), `${rel(SUBAGENTS)} 应该有控件，判据的阳性对照失效了`)
  assert.ok(controlTags(source(PLUGINS)).includes('input'), `${rel(PLUGINS)} 应该有控件，判据的阳性对照失效了`)
})

test('浏览器 / 电脑控制两节没有保存按钮（没有设置面就没有保存；positive 对照是另两节有）', () => {
  for (const name of [BROWSER, COMPUTER_USE]) {
    const src = source(name)
    assert.ok(!/<button\b/.test(src), `${rel(name)} 不该有按钮：它没有设置面`)
    assert.ok(!/saveAgent/.test(src), `${rel(name)} 不该 import 任何 save* —— 判定结果不是设置`)
  }
  // 阳性对照：另两节真的调了模块的 save。
  assert.ok(source(SUBAGENTS).includes('saveAgentSubagentsSettings'), `${rel(SUBAGENTS)} 应该调 save`)
  assert.ok(source(PLUGINS).includes('saveAgentPluginsSettings'), `${rel(PLUGINS)} 应该调 save`)
})

test('子智能体 / 插件两节的控件只作用在模块自己的持久化字段上（不塞进页面的 draft）', () => {
  // 两节自己管草稿：`reactive(normalize(load()))` + `save(...)`，这是本仓的分节约定。
  for (const [name, storageKey, saveFn] of [
    [SUBAGENTS, AGENT_SUBAGENTS_STORAGE_KEY, 'saveAgentSubagentsSettings'],
    [PLUGINS, AGENT_PLUGINS_STORAGE_KEY, 'saveAgentPluginsSettings'],
  ]) {
    const src = source(name)
    assert.match(src, /reactive\(\s*normalize/, `${rel(name)} 的草稿应是 reactive(normalize(load()))`)
    assert.ok(src.includes(saveFn), `${rel(name)} 保存前要过模块的 ${saveFn}`)
    assert.ok(src.includes('validate'), `${rel(name)} 保存前要跑模块的 validate 并逐条显示 problems`)
    assert.ok(storageKey.length > 0)
  }
  // 否定侧：这两节不许从页面 props / 共享 draft 拿值（那会让别的 lane 的改动牵动这里）。
  for (const name of [SUBAGENTS, PLUGINS]) {
    assert.ok(!/defineProps/.test(source(name)), `${rel(name)} 不该收 props：这一节自己管草稿`)
  }
})

// ── 3 · 子智能体的 ZCode 工具档位是对照清单 ────────────────────────────────────

test('ZCode 工具档位被标明为「ZCode 那边可选的档位」且不给可勾选的控件', () => {
  const src = source(SUBAGENTS)
  assert.ok(src.includes('AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS'), `${rel(SUBAGENTS)} 应该把这个对照常量渲染出来`)
  assert.match(src, /ZCode 那边可选的档位/, `${rel(SUBAGENTS)} 必须标明这份清单属于 ZCode 那边，不是本仓工具`)
  // 清单是只读对照：只看渲染它的那一个 `<ul>`，里面不许有 input/checkbox。
  const listStart = src.indexOf('v-for="tool in AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS"')
  const listEnd = src.indexOf('</ul>', listStart)
  assert.ok(listStart > 0 && listEnd > listStart, '没找到对照清单那个列表（判据本身失效）')
  const block = src.slice(listStart, listEnd)
  assert.ok(block.includes('{{ tool }}'), '对照清单那一段没有渲染工具名（判据本身失效）')
  assert.ok(!new RegExp(`<${CONTROL_TAGS.join('|')}[\\s>/]`).test(block),
    '对照清单那一段里出现了原生控件：勾了也存不进任何执行路径，那就是放假控件')
  // 阳性对照：常量本身确实非空且是那份 ZCode 命名（否则「渲染出来」是空的）。
  assert.ok(AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS.includes('Read') && AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS.includes('Bash'),
    'ZCode 工具档位常量本身变了，先确认模块再判组件')
})

// ── 4 · 导入路径与图标 ────────────────────────────────────────────────────────

test('导入 .vue 组件带 .vue 扩展、导入纯逻辑模块不带 .ts 扩展（本仓既有约定）', () => {
  for (const name of ALL) {
    for (const m of source(name).matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1]
      // 硬规则：任何 import 都不得带 `.ts`（tsconfig 是 moduleResolution: Bundler，
      // 纯逻辑模块按 `'../../agentSubagents'` 这样的裸路径引；组件才带 `.vue`）。
      assert.ok(!spec.endsWith('.ts'), `${rel(name)} 的 import 「${spec}」带了 .ts 扩展`)
      if (spec.startsWith('.') && /\.[a-z]+$/i.test(spec)) {
        assert.ok(spec.endsWith('.vue') || spec.endsWith('.css'), `${rel(name)} 的相对 import 「${spec}」既不带 .ts 也不带 .vue`)
      }
    }
  }
  // 阳性对照：确实导了四个纯逻辑模块（这条判据不是「什么都没导所以通过」）。
  assert.ok(source(SUBAGENTS).includes("from '../../agentSubagents'"))
  assert.ok(source(PLUGINS).includes("from '../../agentPlugins'"))
  assert.ok(source(BROWSER).includes("from '../../agentComputerUse'"))
  assert.ok(source(COMPUTER_USE).includes("from '../../agentComputerUse'"))
  // 阳性对照：组件 import 确实带 .vue。
  for (const name of ALL) assert.ok(source(name).includes("from './AgentSettingsSectionShell.vue'"))
})

test('图标只用 lucide-vue-next / IDEA 副本，且尺寸只从 iconSize 角色取', () => {
  for (const name of ALL) {
    const src = source(name)
    const template = src.slice(src.indexOf('<template>'), src.indexOf('<style'))
    // 硬编码尺寸：ui-icons 门禁也会扫，这里把它钉在「这一组四节」上。
    for (const m of template.matchAll(/:size\s*=\s*"([^"]*)"/g)) {
      assert.match(m[1], /^iconSize\.\w+$/, `${rel(name)} 的 :size="${m[1]}" 不是 iconSize 阶梯上的一档`)
    }
    if (/iconSize\./.test(src)) assert.match(src, /import\s*\{[^}]*\biconSize\b[^}]*\}\s*from\s*'\.\.\/\.\.\/uiIcons'/, `${rel(name)} 用了 iconSize 却没 import`)
    if (/Idea[A-Z]\w*Icon/.test(src)) assert.ok(src.includes("from '../icons/toolWindowIcons'"), `${rel(name)} 用了 IDEA 图标副本却没 import`)
  }
  // 阳性对照：确实有图标（不是「没图标所以通过」）。
  assert.ok(source(SUBAGENTS).includes(':size="iconSize.control"'), `${rel(SUBAGENTS)} 应该有图标`)
  assert.ok(source(SUBAGENTS).includes('IdeaCheckedIcon'), '勾选记号应该用 IDEA 的 checked 副本')
})

// ── 5 · 真把 SFC 模板跑一遍 ──────────────────────────────────────────────────

/** SSR 渲染一节（无 DOM 环境下 localStorage 不存在 → 模块走 null 存储路径，拿到合法默认值）。 */
async function render(name) {
  const { component } = loadSfc(join(root, rel(name)))
  return renderToString(createSSRApp(component))
}

test('子智能体节真渲染：只出现模块允许的控件，且 ZCode 工具档位是只读清单', async () => {
  const html = await render(SUBAGENTS)
  // 阳性对照：搜索框（真控件）渲染出来了。
  assert.ok(html.includes('搜索子智能体'), '搜索框没渲染出来')
  assert.ok(html.includes('type="text"'), '搜索输入框（真控件）没渲染出来')
  // 清单为空时**一个启用开关都不该有** ——
  // 开关是逐条挂在条目上的（模块的 `supportsEnabledToggle`），没有条目就没有开关。
  // 这条同时钉住「不凭空造子智能体」：有控件 ≠ 有数据。
  assert.ok(!html.includes('type="checkbox"'),
    '空清单却渲染出了启用开关：开关必须逐条由模块的 supportsEnabledToggle 判，没条目就不该有')
  for (const tool of AGENT_SUBAGENT_ZCODE_TOOL_OPTIONS) {
    assert.ok(html.includes(tool), `对照清单里少了 ${tool}`)
  }
  // 否定侧 + 阳性对照：清单是 li，不是可勾选的 input。
  const listMatch = html.match(/<ul[^>]*>(?:(?!<\/ul>)[\s\S])*?Read(?:(?!<\/ul>)[\s\S])*?<\/ul>/)
  assert.ok(listMatch, '没找到工具档位那个列表（判据本身失效）')
  assert.ok(!listMatch[0].includes('<input'), '工具档位清单里出现了 input：对照清单不该可勾选')
})

test('浏览器控制 / 电脑控制两节真渲染：只有判定结果，一个可点控件都没有', async () => {
  const browserHtml = await render(BROWSER)
  const computerHtml = await render(COMPUTER_USE)

  for (const [name, html, availability] of [
    [BROWSER, browserHtml, browserControlAvailability({ isDesktop: false }, {})],
    [COMPUTER_USE, computerHtml, computerUseAvailability({ isDesktop: false }, {})],
  ]) {
    // 阳性对照：判定结果真的渲染出来了（不是渲染了个空壳）。
    for (const item of availability.missing) {
      assert.ok(html.includes(item.slice(0, 18)), `${rel(name)} 少了一条「缺什么」：${item.slice(0, 24)}…`)
    }
    // 否定侧：没有任何可点的东西。
    for (const tag of ['<input', '<select', '<button', 'type="checkbox"']) {
      assert.ok(!html.includes(tag), `${rel(name)} 渲染出了 ${tag}：这两节是判定面，不许有可点控件`)
    }
  }

  // 电脑控制多一步：准备步骤逐条来自 cuaPermissionPreparation，不是自己编的。
  const preparation = cuaPermissionPreparation(null)
  assert.equal(preparation.steps.length, 5, '准备步骤的条数变了（模块那边改了），先确认模块再判组件')
  for (const step of preparation.steps) {
    assert.ok(computerHtml.includes(step.title), `准备步骤少了一步：${step.title}`)
  }
})

test('子智能体节的分组与能力投影逐条来自模块（阳性对照：模块说有可编辑条目时界面就说可编辑）', async () => {
  const { normalizeAgentSubagentsSettings } = await import('../src/agentSubagents.ts')
  const withEntry = normalizeAgentSubagentsSettings({
    entries: [{ name: 'reviewer', path: 'agents/reviewer/agent.md', scope: 'user', source: 'user', description: '审阅', systemPrompt: 'p' }],
  })
  assert.equal(withEntry.entries.length, 1, '模块的归一化没保住这条用户级子智能体，判据的阳性对照失效了')
  assert.equal(withEntry.entries[0].enabled, true, '用户级子智能体缺省应是启用态')

  const html = await render(SUBAGENTS)
  // 空草稿时不该出现任何条目行（不造假的内置条目）。
  assert.ok(!html.includes('审阅'), '空草稿渲染出了条目：界面不许凭空造子智能体')
  // 组件确实引用了模块的能力投影函数（分组 / 只读 / 有无开关都由它判）。
  const src = source(SUBAGENTS)
  assert.ok(src.includes('subagentCapabilities'), `${rel(SUBAGENTS)} 应该用模块的 subagentCapabilities 判每行能点什么`)
  assert.match(src, /supportsEnabledToggle/, '启用开关必须由模块判（只有用户级子智能体有）')
})