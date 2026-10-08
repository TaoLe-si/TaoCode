// 「MCP 服务器」与「技能」两节的**接线**判据（`src/components/agent-settings/{Mcp,Skills}SettingsSection.vue`）。
//
// 验的不是「文件存在」，而是几条接线纪律有没有被绕过：
//   1. 控件只作用在纯逻辑模块导出的字段上，组件里不另编业务语义。
//   2. 技能的 `injected` 是三态：`null` = 本仓未接运行时（**未知**），渲染成模块给的
//      `injectedLabel`（「未接入（本仓无技能运行时）」）。把它当 `false` 渲染会让用户以为
//      「装了就真的没被注入」，而不是「本仓没接」—— 这是产品承诺，必须钉住。
//   3. 保存路径必须是 `validate` → `save`：有 problems 就不写盘，并逐条显示。
//
// 组件逻辑本身用 SFC 解析不方便，所以主体是**源码锚点断言**；但最后真的把模板编译出来
// 在 SSR 下渲染一遍（`loadSfc` + `renderToString`，照 `tests/about-dialog-copy.test.mjs`），
// 验「屏幕上的控件真的渲染出来了」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { loadSfc } from './vue-sfc-loader.mjs'
import {
  defaultAgentMcpSettings, describeMcpFailure, parseMcpServerInput,
  mcpServerConfigJson, normalizeAgentMcpSettings, validateAgentMcpSettings,
} from '../src/agentMcpServers.ts'
import {
  AGENT_SKILL_INJECTION_UNKNOWN, defaultAgentSkillsSettings,
  describeSkillEntry, filterSkills, normalizeAgentSkillsSettings, validateAgentSkillsSettings,
} from '../src/agentSkills.ts'

const MCP_VUE = 'src/components/agent-settings/McpSettingsSection.vue'
const SKILL_VUE = 'src/components/agent-settings/SkillsSettingsSection.vue'
const read = file => readFileSync(file, 'utf8')
const mcpSrc = read(MCP_VUE)
const skillSrc = read(SKILL_VUE)

/** 拆出 `<template>` 块（判据要区分「脚本里写了」与「模板里渲染了」—— 两者不是一回事）。 */
function templateOf(file) {
  const { descriptor } = parseSfc(read(file), { filename: file })
  return descriptor.template?.content ?? ''
}
const mcpTpl = templateOf(MCP_VUE)
const skillTpl = templateOf(SKILL_VUE)

/** 一条 import 语句的模块说明符（去掉引号）。 */
function importSpecifiers(src) {
  return [...src.matchAll(/\bfrom\s+'([^']+)'/g)].map(match => match[1])
}

// ── 1. 用了 shell ─────────────────────────────────────────────────────────────

test('两节都用 AgentSettingsSectionShell 包起来', () => {
  for (const [file, src, tpl] of [[MCP_VUE, mcpSrc, mcpTpl], [SKILL_VUE, skillSrc, skillTpl]]) {
    assert.ok(tpl.includes('<AgentSettingsSectionShell'), `${file} 必须用 shell 包起来`)
    assert.ok(src.includes(`from './AgentSettingsSectionShell.vue'`), `${file} 必须 import shell`)
    assert.ok(tpl.includes(':description='), `${file} 要把这一节的说明交给 shell`)
  }
})

// ── 2. controls：真控件只作用在模块字段上 ─────────────────────────────────────

test('两节的控件都绑到模块导出的字段上，不在组件里自建业务语义', () => {
  // MCP：条目字段（名称 / 类型 / 落盘层级 / 超时 / 协议版本 / 命令或 URL / 参数 / 键值表）。
  assert.ok(mcpTpl.includes('v-model="server.enabled"'), '启用开关必须绑到草稿的 enabled')
  assert.ok(mcpTpl.includes('v-model="selected.name"'), '名称输入必须绑到草稿的 name')
  assert.ok(mcpTpl.includes('v-model="selected.transport"'), '类型选择必须绑到草稿的 transport')
  assert.ok(mcpSrc.includes('mcpServerConfigJson'), '导出必须走模块的 mcpServerConfigJson')
  // 技能：搜索过滤走模块的 filterSkills，条目编辑直接改草稿。
  assert.ok(skillSrc.includes('filterSkills'), '组件必须用模块的 filterSkills')
  assert.ok(skillTpl.includes('v-model="query"'), '搜索框必须绑到 query')
  assert.ok(skillTpl.includes('v-model="editing.name"'), '名称输入必须绑到草稿的 name')
})

test('反例：组件里不许手写三档状态字面量（那是把产品判断搬进模板）', () => {
  for (const [file, src] of [[MCP_VUE, mcpSrc], [SKILL_VUE, skillSrc]]) {
    assert.doesNotMatch(src, /status:\s*'(?:wired|config-only|gap)'/, `${file} 不许手写三档状态`)
  }
})

// ── 3. injected === null 渲染成「未接入」而不是 false（产品承诺）────────────

test('injected 为 null 时显示模块给的 injectedLabel，模板里没有自己写的二元判断', () => {
  const unknown = describeSkillEntry({ id: 'x', name: 'x', injected: null })
  assert.equal(unknown.injected, null, '阳性对照：模块把 null 保留成 null，没有退成 false')
  assert.equal(unknown.injectedLabel, AGENT_SKILL_INJECTION_UNKNOWN)
  // 反例定位：真值三档在模块里是齐全的，组件只准显示 label。
  assert.equal(describeSkillEntry({ id: 'x', name: 'x', injected: false }).injectedLabel, '不参与注入')
  assert.equal(describeSkillEntry({ id: 'x', name: 'x', injected: true }).injectedLabel, '参与注入')

  // 模板里那处显式的 null 判定只用来**加一个「未接入」徽标**，判据锁死它不是 `v-if="!injected"`。
  assert.ok(skillTpl.includes('row.injected === null'), '模板必须显式判 === null（不许用 !injected 把 null 并进 false）')
  assert.doesNotMatch(skillTpl, /v-if="!row\.injected"|v-if="row\.injected"/, '不许把 injected 当布尔量判真假')
  assert.ok(skillTpl.includes('selected.injectedLabel'), '详情里显示的是模块折好的 injectedLabel')
})

test('技能节没有把「参与注入」做成可拨的开关', () => {
  assert.equal(AGENT_SKILL_INJECTION_UNKNOWN, '未接入（本仓无技能运行时）', '阳性对照：模块给了 null 档文案')
  assert.doesNotMatch(
    skillTpl, /v-model="[^"]*\.injected"/,
    '不许把 injected 绑成可编辑控件（本仓没有运行时，那个字段不是用户能拨的）',
  )
  assert.doesNotMatch(skillTpl, /type="checkbox"[^>]*injected/, 'injected 不许渲染成勾选框')
})

// ── 4. 保存路径：validate → save，有 problems 就不写并逐条显示 ────────────────

test('两节的保存都是先 validate 再 save，有 problems 就不落盘并逐条显示', () => {
  for (const [file, src, tpl, validateFn, saveFn] of [
    [MCP_VUE, mcpSrc, mcpTpl, 'validateAgentMcpSettings', 'saveAgentMcpSettings'],
    [SKILL_VUE, skillSrc, skillTpl, 'validateAgentSkillsSettings', 'saveAgentSkillsSettings'],
  ]) {
    // 源码锚点：validate 的结果先存进 problems，判空后才轮到 save。
    const body = /function save\(\): void \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
    assert.ok(body.includes(`const found = ${validateFn}(draft)`), `${file}: save 必须先跑 ${validateFn}`)
    assert.ok(body.includes('problems.value = found'), `${file}: problems 必须来自 validate 的返回值`)
    assert.ok(
      /if \(found\.length\) return[\s\S]*?save/.test(body),
      `${file}: 有 problems 时必须**不**写盘就返回`,
    )
    assert.ok(body.includes(saveFn), `${file}: 通过校验才调 ${saveFn}`)
    // 模板：problems 逐条渲染 + role="alert"。
    assert.ok(tpl.includes('v-for="problem in problems"'), `${file}: problems 必须逐条显示`)
    assert.ok(tpl.includes('role="alert"'), `${file}: problems 容器要有 role="alert"`)
  }
})

test('反例：校验不通过时 problems 非空，且文案真来自模块的校验函数', () => {
  // 阳性对照：一条 stdio 缺命令的条目确实被拦下（空名会被 normalize 回填成 id，所以拦它的是命令那条规则）。
  const badMcp = normalizeAgentMcpSettings({ servers: [{ name: 'x', transport: 'stdio' }] })
  const mcpProblems = validateAgentMcpSettings(badMcp)
  assert.ok(mcpProblems.length > 0, '阳性对照：stdio 缺命令必须产生问题')
  assert.ok(mcpProblems.some(text => text.includes('必须填命令')), `实得：${JSON.stringify(mcpProblems)}`)

  // 真正会红的两条：重名，以及技能路径不是绝对路径。
  const dup = normalizeAgentMcpSettings({
    servers: [{ name: 'a', transport: 'http', url: 'https://a.example' }, { name: 'a', transport: 'http', url: 'https://b.example' }],
  })
  assert.ok(validateAgentMcpSettings(dup).some(text => text.includes('重复')), '重名必须被校验拦下')

  const badSkill = normalizeAgentSkillsSettings({ entries: [{ name: 'a', path: 'relative/path' }] })
  const skillProblems = validateAgentSkillsSettings(badSkill)
  assert.ok(skillProblems.some(text => text.includes('绝对路径')), '相对路径必须被校验拦下')
  assert.ok(skillProblems.every(text => typeof text === 'string' && text.length > 0), '每条问题都是一句中文')
})

// ── 5. 导入路径不带 .ts 扩展（iconSize 导入门禁那一族要求路径以 uiIcons 结尾）──

test('两个组件 import 纯逻辑模块时不带 .ts 扩展，.vue 才带扩展', () => {
  const BARE_OK = /^vue$|^lucide-vue-next$/
  for (const [file, src] of [[MCP_VUE, mcpSrc], [SKILL_VUE, skillSrc]]) {
    for (const spec of importSpecifiers(src)) {
      assert.doesNotMatch(spec, /\.ts$/, `${file}: import 不许带 .ts 扩展（${spec}）`)
      // 相对导入在 Vite 下允许省略扩展；这里只钉住「不许带 .ts」与「.vue 必须带扩展」两条。
      if (spec.startsWith('.')) continue
      assert.match(spec, BARE_OK, `${file}: 意外的裸模块导入 ${spec}`)
    }
    // 阳性对照：确实 import 到了那两个模块（断言"没写 .ts"不能靠"根本没 import"蒙对）。
    const wanted = file === MCP_VUE ? '../../agentMcpServers' : '../../agentSkills'
    assert.ok(importSpecifiers(src).includes(wanted), `${file} 必须 import ${wanted}`)
  }
  // .vue 组件导入**要**带扩展（与 .ts 相反），钉住这条区别。
  assert.ok(importSpecifiers(mcpSrc).includes('./AgentSettingsSectionShell.vue'), '阳性对照：.vue 导入带扩展')
  assert.ok(importSpecifiers(mcpSrc).includes('../../uiIcons'), '阳性对照：uiIcons 导入不带扩展（那条正则要求路径以 uiIcons 结尾）')
})

test('反例：带 .ts 扩展的写法确实会被这条判据抓住（阳性对照）', () => {
  const bad = "import { iconSize } from '../../uiIcons.ts'\nimport { x } from '../../agentMcpServers.ts'"
  const badSpecs = importSpecifiers(bad)
  assert.ok(badSpecs.includes('../../uiIcons.ts'), '样本里确实有带扩展的路径')
  assert.ok(badSpecs.some(spec => /\.ts$/.test(spec)), '判据在样本上会命中（不是永不触发的空判据）')
})

// ── 6. 真的把模板渲染一遍：真控件与真数据在屏幕上 ──────────────────────────────

test('MCP 节 SSR 渲染：条目行、内置 taocode 服务器、落盘层级徽标都在', async () => {
  const { component } = loadSfc(MCP_VUE)
  const html = await renderToString(createSSRApp(component))
  assert.ok(html.includes('mcp-row'), 'MCP 条目行必须渲染出来')
  assert.ok(html.includes('taocode'), '内置那条 taocode 服务器必须出现在列表里')
  assert.ok(html.includes('mcp-badge'), '落盘层级徽标必须渲染出来')
  assert.ok(html.includes('agent-section-shell'), 'shell 必须渲染出来')
  // 阳性对照：默认设置里确实有内置条目（否则上面是空判据）。
  assert.ok(defaultAgentMcpSettings().servers.length > 0, '阳性对照：默认设置含内置条目')
})

test('技能节 SSR 渲染出的注入状态是「未接入」而不是「不参与注入」', async () => {
  const { component } = loadSfc(SKILL_VUE)
  const html = await renderToString(createSSRApp(component))
  const entries = defaultAgentSkillsSettings().entries
  for (const entry of entries) {
    const described = describeSkillEntry(entry)
    assert.equal(described.injected, null, `阳性对照：内置技能 ${entry.id} 的 injected 是 null（未接运行时）`)
    assert.ok(html.includes('未接入'), '列表里必须有「未接入」徽标')
    assert.ok(!html.includes('不参与注入'), '绝不能把 null 渲染成「不参与注入」—— 那是本仓没接运行时，不是技能没被注入')
  }
  // 阳性对照：真数据（实测的内置技能名）在屏幕上。
  assert.ok(html.includes('ai-coder'), '实测到的内置技能必须渲染出来')
  assert.ok(html.includes('暂无描述'), '空描述必须回落成模块给的「暂无描述」')
})

test('技能的搜索过滤走模块的 filterSkills（空查询返回全部）', () => {
  const entries = defaultAgentSkillsSettings().entries
  assert.equal(filterSkills(entries, '').length, entries.length, '阳性对照：空查询返回全部')
  assert.equal(filterSkills(entries, 'ponytail').length, 1)
  assert.ok(skillSrc.includes('filterSkills'), '组件必须用模块的 filterSkills')
  assert.ok(skillTpl.includes('v-model="query"'), '搜索框必须绑到 query')
})

// ── 7. 图标与勾选记号 ────────────────────────────────────────────────────────

test('两节只用 lucide 尺寸角色，不硬编码像素；勾选记号不碰 lucide 的 Check', () => {
  for (const [file, src, tpl] of [[MCP_VUE, mcpSrc, mcpTpl], [SKILL_VUE, skillSrc, skillTpl]]) {
    for (const match of tpl.matchAll(/:size\s*=\s*"([^"]*)"/g)) {
      assert.match(match[1], /^iconSize\.[a-z]+$/, `${file}: :size 必须是 iconSize.<role>（实得 ${match[1]}）`)
    }
    assert.match(src, /import \{ iconSize \} from '\.\.\/\.\.\/uiIcons'/, `${file} 必须 import iconSize`)
    // 阳性对照：本仓的门禁把 lucide Check 留给 IdeaCheckedIcon（tests/menu-check-icon.test.mjs）。
    const lucide = /import \{([^}]*)\} from 'lucide-vue-next'/.exec(src)
    assert.ok(lucide, `${file} 必须从 lucide-vue-next 取图标`)
    assert.doesNotMatch(lucide[1], /\bCheck\b/, `${file} 不许从 lucide 导入 Check`)
    assert.doesNotMatch(tpl, /<Check[ >/]/, `${file} 不许渲染 <Check>`)
  }
  // 阳性对照：这两节确实用了图标（判据不是靠"没用到"蒙对）。
  assert.ok(mcpTpl.includes('<Cable') && skillTpl.includes('<Search'), '两节都真的渲染了 lucide 图标')
})

test('纯图标按钮同时有 aria-label 与 title（读屏名与鼠标提示缺一不可）', () => {
  for (const [file, tpl] of [[MCP_VUE, mcpTpl], [SKILL_VUE, skillTpl]]) {
    // 本判据只看纯图标按钮：有 <Trash2>/<Upload> 子树、没有可见文字的那些。
    for (const match of tpl.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
      const block = match[0]
      const isIconOnly = /<Trash2|<Upload/.test(block) && !/>[^<>]*[一-鿿][^<>]*</.test(block)
      if (!isIconOnly) continue
      assert.ok(block.includes(':aria-label='), `${file}: 纯图标按钮缺 aria-label —— ${block.slice(0, 80)}`)
      assert.ok(block.includes(':title='), `${file}: 纯图标按钮缺 title —— ${block.slice(0, 80)}`)
    }
  }
  // 阳性对照：MCP 的删除按钮确实是无文字的纯图标按钮，且两个属性都在。
  assert.ok(/aria-label="`删除 /.test(mcpTpl) && /title="`删除 /.test(mcpTpl), 'MCP 删除按钮两属性齐备')
  // 技能节**一个纯图标按钮都没有**：删除目录那一档本仓没做，所以那里没有可点的东西。
  assert.doesNotMatch(skillTpl, /<Trash2/, '技能节不该有删除按钮')
  assert.ok(skillTpl.includes('新增条目'), '阳性对照：技能节仍有真实控件（新增条目）')
})

// ── 8. 判据自身的健康度（不许退化成空转）────────────────────────────────────

test('反例：上面每条「不许出现 X」都能在反例样本上命中（防空判据）', () => {
  const fakes = {
    '自建状态表': "const controls = [{ key: 'a', label: '甲', status: 'gap', note: 'n' }]",
    '带 .ts 扩展': "import { x } from '../../agentMcpServers.ts'",
    '注入当布尔': '<span v-if="!row.injected">不参与注入</span>',
  }
  // 逐条确认判据用的正则在反例上确实会命中。
  assert.ok(/status:\s*'(?:wired|config-only|gap)'/.test(fakes['自建状态表']), '状态表反例应被三档正则命中')
  assert.ok(importSpecifiers(fakes['带 .ts 扩展']).some(spec => /\.ts$/.test(spec)), '扩展反例应被导入判据命中')
  assert.ok(/v-if="!row\.injected"/.test(fakes['注入当布尔']), '注入反例应被注入判据命中')
  assert.ok(mcpTpl.length > 500 && skillTpl.length > 500, '模板抽取本身没退化成空串')
})