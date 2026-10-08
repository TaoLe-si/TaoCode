// 「Agent 设置」三个已接线分节的判据（记忆 / 钩子 / 自动化）。
//
// 为什么用**源码接线断言**而不是跑组件逻辑：这四节只是把已交付的纯逻辑模块（`src/agentMemoryFiles.ts`
// 等，判据在各自模块测试里）接成控件，业务语义一律不在组件里。
// 组件唯一值得钉的是「接线」本身：调了哪个模块的哪个导出、保存是不是走 validate → save。
// 这四件事都在源码里有确定锚点，用锚点钉才不会随模板重排失效。
//
// 但只做源码断言不够 —— 那样判据自己拼错了正则也照样全绿（本仓吃过空判据的亏）。
// 所以最后一条真的把 SFC 跑起来：`loadSfc` + `renderToString`（照 `tests/about-dialog-copy.test.mjs`），
// 渲染出真实 HTML 再核对控件确实在页面上。每条「不许出现 X」都配一条阳性对照。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { loadSfc } from './vue-sfc-loader.mjs'

const SECTIONS = {
  memory: 'src/components/agent-settings/MemorySettingsSection.vue',
  hooks: 'src/components/agent-settings/HooksSettingsSection.vue',
  automations: 'src/components/agent-settings/AutomationsSettingsSection.vue',
}

/** 一个分节的源码 + 它的 `<template>` 块（模板与脚本分开断言，锚点才不会互相污染）。 */
function sourceOf(key) {
  const source = readFileSync(SECTIONS[key], 'utf8')
  const template = /<template>([\s\S]*)<\/template>/.exec(source)
  assert.ok(template, `${SECTIONS[key]} 里找不到 <template> 块`)
  return { source, template: template[1], script: source.slice(0, template.index) }
}

// ─────────────────────────────────────────────────────── 记忆

test('记忆节：真用 shell，控件取自模块导出（不在组件里另写一句中文）', () => {
  const { source, template } = sourceOf('memory')
  assert.match(template, /<AgentSettingsSectionShell/, '这一节必须包在 AgentSettingsSectionShell 里')
  // 真控件绑的是模块字段：总开关与记忆文件清单。
  assert.match(template, /v-model="draft\.enabled"/, '总开关必须绑到草稿的 enabled')
  assert.match(template, /v-for="\(entry, index\) in draft\.files"/, '清单必须遍历草稿的 files')
  assert.match(source, /reactive\(normalizeAgentMemoryFiles\(loadAgentMemoryFiles\(\)\)\)/,
    '草稿必须是 reactive(normalize(load())) —— 读路径自己管，不塞进页面那份 draft')
})

test('记忆节：保存走 validate → save，有 problems 就不写并逐条显示', () => {
  const { source, template } = sourceOf('memory')
  const validateAt = source.indexOf('validateAgentMemoryFiles(')
  const saveAt = source.indexOf('saveAgentMemoryFiles(')
  assert.ok(validateAt > 0, '保存路径必须先跑 validateAgentMemoryFiles')
  assert.ok(saveAt > 0, '保存路径必须调 saveAgentMemoryFiles')
  assert.ok(validateAt < saveAt, '必须先校验再落盘（有 problems 就不写）')
  assert.match(source, /if \(found\.length\) \{[^}]*return/, '有 problems 时必须直接 return，不落盘')
  assert.match(template, /v-for="\(problem, index\) in problems"/, 'problems 必须逐条显示，不能吞掉')
})

test('记忆节：模块 import 不带 .ts 扩展（带扩展会被 iconSize 导入门禁那一族判红）', () => {
  const { source } = sourceOf('memory')
  const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
  assert.ok(imports.length >= 3, '解析到的 import 太少，判据可能空转')
  for (const spec of imports) {
    assert.ok(!spec.endsWith('.ts'), `import「${spec}」带了 .ts 扩展，本仓 .vue 约定是不带`)
  }
  assert.ok(imports.includes('../../agentMemoryFiles'), '必须真的 import 记忆模块')
  assert.ok(imports.includes('./AgentSettingsSectionShell.vue'), '.vue 组件导入才带 .vue 扩展')
  // 阳性对照：同一条正则对「带扩展」的写法确实会命中（否则上面是空判据）。
  assert.ok(/from '[^']+\.ts'/.test("import x from '../../agentMemoryFiles.ts'"), '阳性对照失败：正则不认 .ts 后缀')
})

// ─────────────────────────────────────────────────────────── 钩子

test('钩子节：真用 shell，控件来自模块导出', () => {
  const { source, template } = sourceOf('hooks')
  assert.match(template, /<AgentSettingsSectionShell/, '这一节必须包在 AgentSettingsSectionShell 里')
  assert.match(template, /v-for="\(hook, index\) in draft\.hooks"/, '列表必须遍历草稿的 hooks')
  assert.match(source, /reactive\(normalizeAgentHooks\(loadAgentHooks\(\)\)\)/, '草稿必须自己读自己写')
  // 阳性对照：真控件在（新建 / 保存 / 编辑）。
  assert.match(template, /addHook/, '「新建钩子」必须是真控件')
  assert.match(template, /@click="save"/, '「保存」必须是真控件')
})

test('钩子节：信任门控走模块判定，需要审核的行开关强制置灰', () => {
  const { template, source } = sourceOf('hooks')
  assert.match(source, /requiresWorkspaceHookTrust/, '信任门控必须走模块那个判定')
  assert.match(template, /:disabled="trustLabel\(hook\) \|\| hook\.readOnly"/,
    '需要审核的行开关必须强制置灰（ZCode HooksList.tsx:298-303）')
})

test('钩子节：保存走 validate → save，有 problems 就不写并逐条显示', () => {
  const { source, template } = sourceOf('hooks')
  assert.ok(source.indexOf('validateAgentHooks(') < source.indexOf('saveAgentHooks('), '必须先校验再落盘')
  assert.match(source, /if \(found\.length\) \{[^}]*return/, '有 problems 时必须直接 return')
  assert.match(template, /v-for="\(problem, index\) in problems"/, 'problems 必须逐条显示')
})

test('钩子节：模块 import 不带 .ts 扩展', () => {
  const { source } = sourceOf('hooks')
  const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
  assert.ok(imports.includes('../../agentHooks'), '必须真的 import 钩子模块')
  for (const spec of imports) assert.ok(!spec.endsWith('.ts'), `import「${spec}」带了 .ts 扩展`)
  assert.ok(/from '[^']+\.ts'/.test("import z from '../../agentHooks.ts'"), '阳性对照失败：正则不认 .ts 后缀')
})

// ────────────────────────────────────────────────────────── 自动化

test('自动化节：真用 shell，控件来自模块导出', () => {
  const { source, template } = sourceOf('automations')
  assert.match(template, /<AgentSettingsSectionShell/, '这一节必须包在 AgentSettingsSectionShell 里')
  assert.match(template, /v-model="automation\.enabled"/, '启停开关必须是真控件')
  assert.match(source, /reactive\(normalizeAgentAutomations\(loadAgentAutomations\(\)\)\)/, '草稿必须自己读自己写')
  // 阳性对照：真控件在（新建 / 保存）。
  assert.match(template, /addAutomation/, '「新建」必须是真控件')
  assert.match(template, /@click="save"/, '「保存」必须是真控件')
})

test('自动化节：调度摘要与下次运行都走模块导出', () => {
  const { source, template } = sourceOf('automations')
  assert.match(source, /formatAutomationSchedule\(automation\)/, '卡片调度摘要必须走模块的 formatAutomationSchedule')
  assert.match(source, /automationNextRun\(automation, Date\.now\(\)\)/, '下次运行必须走模块的 automationNextRun 并注入基准时刻')
  assert.match(template, /AGENT_AUTOMATIONS_BETA_BADGE/, 'Beta 徽标取自模块常量')
  // 模板目录为空时要有空态说明。
  // 模板目录为空时**不再**画一段说明（交接件：那是本仓实现说明，2026-10-08 已删）；
  // 空态改成上游原文的三件套：标题/说明/手动创建（`zh-CN.ts:6186-6188`），动作接真出口。
  assert.match(template, /v-if="!draft\.automations\.length"/, '一条任务都没有时要有上游空态')
  assert.ok(template.includes('还没有定时任务') && template.includes('手动创建'), '空态标题/动作要逐字取上游')
})

test('自动化节：保存走 validate → save，有 problems 就不写并逐条显示', () => {
  const { source, template } = sourceOf('automations')
  assert.ok(source.indexOf('validateAgentAutomations(') < source.indexOf('saveAgentAutomations('), '必须先校验再落盘')
  assert.match(source, /if \(found\.length\) \{[^}]*return/, '有 problems 时必须直接 return')
  assert.match(template, /v-for="\(problem, index\) in problems"/, 'problems 必须逐条显示')
})

test('自动化节：模块 import 不带 .ts 扩展', () => {
  const { source } = sourceOf('automations')
  const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
  assert.ok(imports.includes('../../agentAutomations'), '必须真的 import 自动化模块')
  for (const spec of imports) assert.ok(!spec.endsWith('.ts'), `import「${spec}」带了 .ts 扩展`)
  assert.ok(/from '[^']+\.ts'/.test("import w from '../../agentAutomations.ts'"), '阳性对照失败：正则不认 .ts 后缀')
})

// ───────────────────────────────────── 真把 SFC 跑起来（不是源码字符串）

test('三节都真的能解析出模板并渲染：shell 到位、真控件在页面上、纯图标按钮有 title + aria-label', async () => {
  for (const key of Object.keys(SECTIONS)) {
    const { descriptor, errors } = parseSfc(readFileSync(SECTIONS[key], 'utf8'), { filename: SECTIONS[key] })
    assert.equal(errors.length, 0, `${SECTIONS[key]} 解析失败：${errors[0]?.message}`)
    assert.ok(descriptor.template?.content.trim(), `${SECTIONS[key]} 没有根 <template>`)
  }

  const rendered = {}
  for (const [key, file] of Object.entries(SECTIONS)) {
    // 无 DOM 环境：模块的 defaultSettingsStorage() 返回 null，走「无存储 → 默认值」那条路径，
    // 组件拿到的仍是合法草稿（这是模块铁律：读路径永不抛）。
    rendered[key] = await renderToString(createSSRApp(loadSfc(file).component))
  }

  for (const key of Object.keys(SECTIONS)) {
    assert.ok(rendered[key].includes('agent-section-shell'), `${SECTIONS[key]} 没有渲染出 shell`)
  }

  // 真控件在页面上（不是只在源码里）。
  assert.ok(rendered.memory.includes('记忆文件'), '记忆节该渲染出清单控件')
  assert.ok(rendered.hooks.includes('暂无钩子配置'), '钩子节空态要在页面上')
  // 默认草稿没有任何任务 ⇒ 渲染出来的是上游「还没有定时任务」那一支；
  // 「没有符合条件的任务」是**有任务但被筛空**那一支（`zh-CN.ts:6089`），在源码里钉。
  assert.ok(rendered.automations.includes('还没有定时任务'), '自动化节空态要在页面上')

  // 纯图标按钮必须同时有 title 与 aria-label（门禁 tests/ui-icons.test.mjs:122 也守这条）。
  for (const [key, html] of Object.entries(rendered)) {
    const iconButtons = [...html.matchAll(/<button[^>]*>\s*<svg[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)*<\/svg>\s*<\/button>/g)]
    for (const [button] of iconButtons) {
      assert.match(button, /title="/, `${SECTIONS[key]} 有纯图标按钮缺 title`)
      assert.match(button, /aria-label="/, `${SECTIONS[key]} 有纯图标按钮缺 aria-label`)
    }
  }
})
