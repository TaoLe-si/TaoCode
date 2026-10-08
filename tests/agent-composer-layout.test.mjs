// `agent/composer-layout` 判据：ZCode 输入区/工具条可见结构表**逐条对回 ZCode 源码**。
//
// 起因（用户原话）：「agent 聊天窗口和 Zcode 完全一致」+「修正 UI 设计问题，风格统一化」。
// src/agentComposerLayout.ts 是主代理改 AgentPanel.vue 模板时照抄的结构表；这里钉住三件事：
//   ① 表里每条文案在 zh-CN.ts 里**逐字**存在，且行号指得对（指错 = 后来人扑空）；
//   ② 工具条顺序与 ZCode 真实挂载顺序一致（顺序是本表最核心的信息，抄错整条工具条就反了）；
//   ③ 每条元素引的 ZCode 文件:行号真实存在、行号在文件长度内、锚点内容对得上。
//
// 「不许出现 X」型的门都配了阳性对照 —— 本仓吃过空判据的亏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMPOSER_EMPTY_STATES,
  COMPOSER_ELEMENTS,
  COMPOSER_INPUT,
  COMPOSER_SHORTCUTS,
  COMPOSER_TEXTS,
  GREETING_HOUR_RULES_SOURCE,
  PLACEHOLDER_RESOLVER_SOURCE,
  TOOLBAR_ROWS,
  UNVERIFIABLE,
  ZCODE_SHARED_SRC,
  ZCODE_UI_SRC,
} from '../src/agentComposerLayout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ui = join(root, ZCODE_UI_SRC)
const shared = join(root, ZCODE_SHARED_SRC)

/** ZCode 源码树在不在：不在就跳过依赖它的断言（与 tests/source-citations.test.mjs 同处理）。 */
const hasZCode = existsSync(ui) && existsSync(shared)
const skipIfNoZCode = { skip: hasZCode ? false : 'ZCode 参考树不在本机' }

// ZCode 树在本机是 CRLF（Windows clone），统一折成 LF 再切行，否则行号与跨行匹配都会偏。
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const lines = p => read(p).split('\n')
const uiFile = p => join(ui, p.replace(`${ZCODE_UI_SRC}/`, ''))
const sharedFile = p => join(shared, p.replace(`${ZCODE_SHARED_SRC}/`, ''))

/** 把 `文件:行号` 或 `文件:行号,行号-行号` 解成 { file, lines: [n...] }。 */
function parseCitation(at) {
  const m = /^(.+?):([\d,\-]+)$/.exec(at)
  assert.ok(m, `引用形状不对：${at}`)
  const nums = []
  for (const part of m[2].split(',')) {
    const r = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    assert.ok(r, `行号段不对：${part}（在 ${at}）`)
    for (let n = Number(r[1]); n <= Number(r[2] ?? r[1]); n++) nums.push(n)
  }
  return { file: m[1], nums }
}

/** 引用的文件必须存在、行号必须在长度内。返回该文件的行数组。 */
function loadCitation(at) {
  const { file, nums } = parseCitation(at)
  const abs = join(root, file)
  assert.ok(existsSync(abs), `引用的文件不存在：${file}（来自 ${at}）`)
  const body = lines(abs)
  for (const n of nums) {
    assert.ok(n >= 1 && n <= body.length, `${at} 的行号 ${n} 超出 ${file} 长度 ${body.length}`)
  }
  return body
}

// ── ① 词条表 ─────────────────────────────────────────────────────────────

test('词条表：每条键在 zh-CN.ts 里逐字存在，行号指得对', skipIfNoZCode, () => {
  const locale = uiFile('i18n/locales/zh-CN.ts')
  assert.ok(existsSync(locale), 'zh-CN 词条文件必须在')
  const body = lines(locale)
  assert.ok(COMPOSER_TEXTS.length >= 70, `词条表太薄（${COMPOSER_TEXTS.length} 条），疑似被删空`)

  for (const entry of COMPOSER_TEXTS) {
    assert.ok(entry.at.startsWith(`${ZCODE_UI_SRC}/i18n/locales/zh-CN.ts:`), `${entry.key} 的 at 必须指 zh-CN.ts`)
    const line = body[Number(entry.at.split(':').pop()) - 1] ?? ''
    assert.ok(
      line.includes(`"${entry.key}"`),
      `${entry.key} 的 at 行不对：第 ${entry.at.split(':').pop()} 行是「${line.trim()}」`,
    )
    // 长文案会折到下一行（如 chat.toolbar.computerUse.tooltip.error），窗口取 4 行。
    const at = Number(entry.at.split(':').pop())
    const win = body.slice(at - 1, at + 3).join('\n')
    assert.ok(
      win.includes(entry.zh),
      `${entry.key} 的中文与 zh-CN.ts 不一致：表里「${entry.zh}」，源码「${line.trim()}」`,
    )
  }
})

test('词条表：每条键都有真实消费方（不是从 locale 里抄了个死键）', skipIfNoZCode, () => {
  // 消费方 = ui/src 下非 locales 的 .ts/.tsx 里出现该键（含 `chat.x.${y}` 动态拼接的取值域）。
  const files = []
  ;(function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'i18n' && e.name !== 'node_modules') walk(p)
      } else if (/\.tsx?$/.test(e.name)) files.push(p)
    }
  })(ui)
  const blob = files.map(f => read(f)).join('\n')
  // 阳性对照：扫到的源码必须真的很大，否则「全都有消费方」是空判据。
  assert.ok(blob.length > 1_000_000, `阳性对照：扫描面太小（${blob.length} 字节）`)

  const dead = COMPOSER_TEXTS.filter(e =>
    e.dynamicPrefix ? !blob.includes(e.dynamicPrefix) : !blob.includes(e.key))
  assert.deepEqual(dead.map(e => e.key), [], '表里出现零消费方的死键')
})

test('词条表：元素引用的每个文案键都在表里（不许表外裸引）', () => {
  const declared = new Set(COMPOSER_TEXTS.map(e => e.key))
  const referenced = []
  for (const el of COMPOSER_ELEMENTS) {
    if (el.labelKey) referenced.push([el.id, el.labelKey])
    for (const k of el.textKeys) referenced.push([el.id, k])
  }
  for (const es of COMPOSER_EMPTY_STATES) for (const k of es.textKeys) referenced.push([es.id, k])
  for (const ph of COMPOSER_INPUT.placeholders) referenced.push(['placeholder', ph.key])
  assert.ok(referenced.length >= 60, `引用面太窄（${referenced.length}）`)

  const missing = referenced.filter(([, k]) => !declared.has(k))
  assert.deepEqual(missing, [], '有元素引用了词条表里没有的键')
})

// ── ② 工具条顺序 ─────────────────────────────────────────────────────────

test('工具条顺序：leading 四件套 + trailing 五件套，与 ZCode 挂载顺序一致', skipIfNoZCode, () => {
  const rows = Object.fromEntries(TOOLBAR_ROWS.map(r => [r.id, r]))
  assert.deepEqual(
    rows.leading.elementIds,
    ['actionMenu', 'modeSwitch', 'cuaEntry', 'backgroundWorkTrigger'],
    'leading 顺序：动作菜单 → 模式 → CUA → 后台任务',
  )
  assert.deepEqual(
    rows.trailing.elementIds,
    ['contextUsage', 'modelSelect', 'thoughtLevel', 'stop', 'send'],
    'trailing 顺序：context usage → 模型 → 思考档 → 停止/发送',
  )
  assert.equal(rows.leading.side, 'leading')
  assert.equal(rows.trailing.side, 'trailing')
})

test('工具条顺序：leading 与 ZCode 源码的挂载顺序逐一对上', skipIfNoZCode, () => {
  // ChatPromptEditor.tsx:391-405 先渲染动作菜单，:407 再渲染 leadingActions。
  const editor = read(uiFile('prompt-editor/ChatPromptEditor.tsx'))
  const menuIdx = editor.indexOf('<ChatPromptActionMenu')
  const leadingIdx = editor.indexOf('{leadingActions}')
  assert.ok(menuIdx > 0 && leadingIdx > 0, '阳性对照：两个插槽都在模板里')
  assert.ok(menuIdx < leadingIdx, '动作菜单必须排在 leadingActions 之前')

  // ConversationComposer.tsx:2142-2165 的 leadingActions 内容顺序。
  const composer = read(uiFile('v4/ConversationComposer.tsx'))
  const modeIdx = composer.indexOf('<V4ComposerModeSwitch')
  const cuaIdx = composer.indexOf('<V4ComposerCuaEntry')
  const bgIdx = composer.indexOf('<ConversationBackgroundWorkTrigger')
  assert.ok(modeIdx > 0 && cuaIdx > 0 && bgIdx > 0, '阳性对照：三个常驻入口都在')
  assert.ok(modeIdx < cuaIdx && cuaIdx < bgIdx, '模式 → CUA → 后台任务 的顺序不许换')
})

test('工具条顺序：trailing 与 ZCode 源码的挂载顺序逐一对上', skipIfNoZCode, () => {
  // V4ComposerModelControls 内部顺序：ChatContextUsage → ModelConfigSelect → ThoughtLevelCycleControl。
  const toolbar = read(uiFile('v4/composer/V4ComposerToolbar.tsx'))
  const usageIdx = toolbar.indexOf('<ChatContextUsage')
  const modelIdx = toolbar.indexOf('<ModelConfigSelect')
  const thoughtIdx = toolbar.indexOf('<ThoughtLevelCycleControl')
  assert.ok(usageIdx > 0 && modelIdx > 0 && thoughtIdx > 0, '阳性对照：三件套都在')
  assert.ok(usageIdx < modelIdx && modelIdx < thoughtIdx, 'context usage → 模型 → 思考档')

  // submitControl 里 stop 与 send 同槽互斥，stop 在前（三元的第一支）。
  const composer = read(uiFile('v4/ConversationComposer.tsx'))
  const stopIdx = composer.indexOf('{showStopControl ? (')
  const sendIdx = composer.indexOf('data-testid={TID_V4_COMPOSER_SEND}')
  assert.ok(stopIdx > 0 && sendIdx > 0, '阳性对照：stop 与 send 都在 submitControl 里')
  assert.ok(stopIdx < sendIdx, 'stop 是三元第一支，必须排在 send 前')
})

test('工具条顺序：trailing 的模型簇必须排在 stop/send 之前', skipIfNoZCode, () => {
  const composer = read(uiFile('v4/ConversationComposer.tsx'))
  const clusterIdx = composer.indexOf('<V4ComposerModelControls')
  const stopIdx = composer.indexOf('{showStopControl ? (')
  assert.ok(clusterIdx > 0, '阳性对照：模型簇挂在 submitControl 里')
  assert.ok(clusterIdx < stopIdx, '模型/思考/用量簇在左，stop/send 在右')
})

// ── ③ 元素表 ─────────────────────────────────────────────────────────────

test('元素表：九个元素齐、kind 合法、id 与工具条顺序表闭合', () => {
  const orderIds = TOOLBAR_ROWS.flatMap(r => r.elementIds)
  assert.equal(COMPOSER_ELEMENTS.length, orderIds.length, '元素表与顺序表的条数必须相等')
  assert.deepEqual(COMPOSER_ELEMENTS.map(e => e.id), orderIds, '元素表顺序必须与顺序表一致')

  const kinds = new Set(['usage', 'select', 'button', 'toggle'])
  for (const el of COMPOSER_ELEMENTS) {
    assert.ok(kinds.has(el.kind), `${el.id} 的 kind 非法：${el.kind}`)
  }
  // 每个元素必须给可见性规则；指不到就写进 UNVERIFIABLE，不许留空。
  for (const el of COMPOSER_ELEMENTS) {
    assert.ok(el.visibleWhen && el.visibleWhen.length > 0, `${el.id} 缺 visibleWhen`)
  }
})

test('元素表：stop/send 同槽互斥，其余元素不占槽', () => {
  const byId = Object.fromEntries(COMPOSER_ELEMENTS.map(e => [e.id, e]))
  assert.equal(byId.stop.exclusiveSlot, 'submitControl.tail')
  assert.equal(byId.send.exclusiveSlot, 'submitControl.tail')
  const others = COMPOSER_ELEMENTS.filter(e => e.id !== 'stop' && e.id !== 'send')
  assert.deepEqual(others.filter(e => e.exclusiveSlot).map(e => e.id), [], '别的元素不该占这个槽')
})

test('元素表：每条 source / mountSource / 图标 import / testIdSource 都指得实', skipIfNoZCode, () => {
  let iconGroups = 0
  for (const el of COMPOSER_ELEMENTS) {
    loadCitation(el.source)
    loadCitation(el.mountSource)
    if (el.testIdSource) loadCitation(el.testIdSource)
    if (el.shortcutSource) loadCitation(el.shortcutSource)
    for (const g of el.iconGroups) {
      iconGroups++
      loadCitation(g.at)
    }
  }
  for (const es of COMPOSER_EMPTY_STATES) {
    loadCitation(es.source)
    loadCitation(es.mountSource)
    if (es.testIdSource) loadCitation(es.testIdSource)
    for (const g of es.iconGroups) {
      iconGroups++
      loadCitation(g.at)
    }
  }
  assert.ok(iconGroups >= 10, `图标分组太少（${iconGroups}），疑似漏登记`)
  loadCitation(COMPOSER_INPUT.shellSource)
  loadCitation(COMPOSER_INPUT.editorSource)
  loadCitation(PLACEHOLDER_RESOLVER_SOURCE)
  loadCitation(GREETING_HOUR_RULES_SOURCE)
})

test('元素表：每组图标的 import 行真的导出了那些图标名', skipIfNoZCode, () => {
  let groups = 0
  for (const el of COMPOSER_ELEMENTS) {
    assert.ok(el.iconGroups.length > 0, `${el.id} 缺 iconGroups`)
    for (const g of el.iconGroups) {
      groups++
      const { nums } = parseCitation(g.at)
      const body = lines(join(root, g.at.split(':')[0]))
      const region = nums.map(n => body[n - 1]).join('\n')
      for (const icon of g.icons) {
        assert.ok(
          region.includes(icon),
          `${el.id} 的图标 ${icon} 不在 ${g.at} 的 import 区间里`,
        )
      }
    }
  }
  assert.ok(groups >= 10, `图标分组太少（${groups}），疑似漏登记`)
})

test('元素表：动态图标（模式选择）的候选集与 resolveModeOptionIcon 的返回一致', skipIfNoZCode, () => {
  const src = read(uiFile('chat-input-toolbar/display.tsx'))
  const fnStart = src.indexOf('export function resolveModeOptionIcon')
  assert.ok(fnStart > 0, '阳性对照：函数在')
  const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart))
  const byId = Object.fromEntries(COMPOSER_ELEMENTS.map(e => [e.id, e]))
  for (const icon of ['ShieldAlertIcon', 'HandIcon', 'NotepadText', 'ShieldCheckIcon']) {
    assert.ok(fnBody.includes(icon), `resolveModeOptionIcon 应返回 ${icon}`)
    assert.ok(
      byId.modeSwitch.iconGroups.flatMap(g => g.icons).includes(icon),
      `模式元素候选集缺 ${icon}`,
    )
  }
})

// ── ④ test-id ────────────────────────────────────────────────────────────

test('元素表：test-id 字面量与 shared/test-ids.ts 一致', skipIfNoZCode, () => {
  const ids = read(sharedFile('test-ids.ts'))
  for (const el of COMPOSER_ELEMENTS) {
    if (!el.testId) continue
    assert.ok(
      ids.includes(`"${el.testId}"`),
      `${el.id} 的 testId「${el.testId}」在 test-ids.ts 里找不到`,
    )
  }
  assert.ok(ids.includes(`"${COMPOSER_INPUT.testId}"`), '输入框 test-id 必须在 test-ids.ts 里')
})

// ── ⑤ 快捷键 ─────────────────────────────────────────────────────────────

test('快捷键：三条工具条热键的默认键位与命令表逐字一致', skipIfNoZCode, () => {
  const cmds = read(sharedFile('shortcutCommands.ts'))
  assert.ok(COMPOSER_SHORTCUTS.length === 3, '工具条热键就三条')
  for (const s of COMPOSER_SHORTCUTS) {
    const re = new RegExp(`id: "${s.command}"[^}]*defaultBindings: \\["([^"]+)"\\]`)
    const m = re.exec(cmds)
    assert.ok(m, `命令表里没有 ${s.command}`)
    assert.equal(m[1], s.binding, `${s.command} 的默认键位对不上：表 ${s.binding} / 源码 ${m[1]}`)
  }
  // 阳性对照：命令表确实很大，不是只匹配到三条。
  assert.ok(cmds.split('\n').length > 80, '阳性对照：命令表文件过短')
})

test('快捷键：Enter 发送 / Shift+Enter 换行的默认绑定对得上', skipIfNoZCode, () => {
  const cmds = read(sharedFile('shortcutCommands.ts'))
  assert.match(cmds, /id: "composerSend"[^}]*defaultBindings: \["Enter"\]/, 'composerSend 绑 Enter')
  assert.match(
    cmds,
    /id: "composerInsertNewline"[^}]*defaultBindings: \["Shift\+Enter"\]/,
    'composerInsertNewline 绑 Shift+Enter',
  )
  assert.equal(COMPOSER_INPUT.enter.binding, 'Enter')
  assert.equal(COMPOSER_INPUT.shiftEnter.binding, 'Shift+Enter')
})

test('输入框：Enter 提交谓词与 LexicalChatInput 源码一致', skipIfNoZCode, () => {
  const lexical = read(uiFile('LexicalChatInput.tsx'))
  const fnStart = lexical.indexOf('function shouldSubmitLexicalEnter(')
  assert.ok(fnStart > 0, '阳性对照：谓词函数在')
  // 参数解构自己就带一个 `\n}`，不能用它当函数尾；取到下一个顶层 function 为止。
  const nextFn = lexical.indexOf('\nfunction ', fnStart + 1)
  const body = lexical.slice(fnStart, nextFn > fnStart ? nextFn : fnStart + 900)
  assert.match(body, /return Boolean\(text\.trim\(\) \|\| allowSubmitWhenEmpty\)/, '函数体取全了')
  // 逐条核谓词的四个否定条件 + 文本/空提交条件。
  assert.match(body, /if \(!enterSubmits\)/, 'enterSubmits 门')
  assert.match(body, /if \(shiftKey \|\| ctrlKey \|\| metaKey \|\| isComposing\)/, '修饰键/IME 门')
  assert.match(body, /Boolean\(text\.trim\(\) \|\| allowSubmitWhenEmpty\)/, '空文本门')
  assert.match(COMPOSER_INPUT.enterSubmitPredicate, /shouldSubmitLexicalEnter/)
  assert.match(COMPOSER_INPUT.enterSubmitPredicate, /enterSubmits/)
  assert.match(COMPOSER_INPUT.enterSubmitPredicate, /allowSubmitWhenEmpty/)
})

test('输入框：placeholder 四条分流规则与 chatPlaceholder.ts 一致', skipIfNoZCode, () => {
  const ph = read(uiFile('lib/chatPlaceholder.ts'))
  for (const rule of COMPOSER_INPUT.placeholders) {
    assert.ok(ph.includes(`"${rule.key}"`), `chatPlaceholder.ts 里没有 ${rule.key}`)
  }
  // 分流形状：无历史 → newTask；有历史 → 处理中 queue / 空闲 ask。
  assert.match(ph, /if \(!hasHistoryMessages\)/)
  assert.match(ph, /compactNewTask \? "chat\.placeholder\.newTaskMobile" : "chat\.placeholder\.newTask"/)
  assert.match(ph, /isTaskProcessing \? "chat\.placeholder\.followUpQueue" : "chat\.placeholder\.followUpAsk"/)
  // 表里"无历史 + compactNewTask"那条的键必须真的是 newTaskMobile。
  const mobile = COMPOSER_INPUT.placeholders.find(p => p.key === 'chat.placeholder.newTaskMobile')
  assert.match(mobile.when, /compactNewTask/)
})

test('发送/停止：切换规则与 ConversationComposer 的状态机一致', skipIfNoZCode, () => {
  const composer = read(uiFile('v4/ConversationComposer.tsx'))
  // showStopControl = canStop && !hasDraftToSubmit
  assert.match(composer, /const showStopControl = canStop && !hasDraftToSubmit/)
  assert.match(composer, /const canStop = Boolean\(snapshot\?\.control\.canStop\)/)
  // canSend 的六个合取项。
  for (const term of ['!disabled', '!pending', 'hasDraftToSubmit', 'routingAllowsSend', 'attachmentsReady', 'submissionReady']) {
    assert.ok(composer.includes(term), `canSend 的合取项缺 ${term}`)
  }
  const stop = COMPOSER_ELEMENTS.find(e => e.id === 'stop')
  const send = COMPOSER_ELEMENTS.find(e => e.id === 'send')
  assert.match(stop.visibleWhen, /showStopControl/)
  assert.match(send.visibleWhen, /!showStopControl|showStopControl/)
  assert.match(send.disabledWhen, /canSend/)
  // 发送键 tooltip 在 enqueue 模式下换成「加入队列」。
  assert.match(composer, /mode === "enqueue" \? "chat\.queue\.enqueue" : "chat\.send"/)
})

test('停止键：Esc 的忽略判定走 escapeStop 纯函数', skipIfNoZCode, () => {
  const pane = read(uiFile('v4/SessionPane.tsx'))
  assert.match(pane, /shouldIgnoreEscapeForStopGeneration/, 'Esc 停止必须过忽略判定')
  assert.match(pane, /event\.key !== "Escape"/)
  assert.match(pane, /handleStop\("escape"\)/)
  const escape = read(uiFile('v4/composer/escapeStop.ts'))
  assert.match(escape, /export function shouldIgnoreEscapeForStopGeneration/)
  assert.match(escape, /role"\) === "dialog"/, 'dialog 路径要跳过（关弹窗不该停生成）')
  const stop = COMPOSER_ELEMENTS.find(e => e.id === 'stop')
  assert.equal(stop.shortcut, 'Esc')
})

// ── ⑥ 空态 ───────────────────────────────────────────────────────────────

test('空态：草稿问候语按时段分流，七条键与源码一致', skipIfNoZCode, () => {
  const draft = read(uiFile('v4/ConversationDraftEmptyState.tsx'))
  const greeting = COMPOSER_EMPTY_STATES.find(e => e.id === 'draftGreeting')
  assert.ok(greeting, '草稿空态必须在表里')
  assert.equal(greeting.component, 'ConversationDraftEmptyState')
  for (const key of greeting.textKeys) {
    assert.ok(draft.includes(`"${key}"`), `草稿空态缺问候键 ${key}`)
  }
  // 六个时段边界 + office 覆盖。
  assert.match(draft, /hour >= 5 && hour < 9/)
  assert.match(draft, /hour >= 9 && hour < 12/)
  assert.match(draft, /hour >= 12 && hour < 14/)
  assert.match(draft, /hour >= 14 && hour < 18/)
  assert.match(draft, /hour >= 18 && hour < 23/)
  assert.match(draft, /isOfficeMode \? "chat\.empty\.greeting\.office"/)
  assert.ok(greeting.textKeys.includes('chat.empty.greeting.office'))
})

test('空态：草稿空态挂载在 SessionPane 的 isDraft 分支', skipIfNoZCode, () => {
  const pane = read(uiFile('v4/SessionPane.tsx'))
  assert.match(pane, /emptyState=\{[\s\S]{0,200}isDraft \? \(/)
  assert.match(pane, /<ConversationDraftEmptyState \/>/)
  const greeting = COMPOSER_EMPTY_STATES.find(e => e.id === 'draftGreeting')
  assert.match(greeting.mountSource, /SessionPane\.tsx:4786-4790/)
})

test('空态：工作区菜单七个分区与文案键与源码一致', skipIfNoZCode, () => {
  const src = read(uiFile('ChatEmptyState.tsx'))
  const menu = COMPOSER_EMPTY_STATES.find(e => e.id === 'workspacePreviewMenu')
  assert.ok(menu, '工作区菜单必须在表里')
  assert.equal(menu.component, 'ChatEmptyWorkspacePreviewMenu')
  for (const key of menu.textKeys) {
    assert.ok(src.includes(`"${key}"`), `工作区菜单缺文案键 ${key}`)
  }
  for (const part of ['搜索框', '工作区复选列表', '打开文件夹', '远程连接', '不在项目中工作']) {
    assert.ok(menu.parts.includes(part), `分区清单缺「${part}」`)
  }
  // 固定尾部入口顺序：打开文件夹 → 远程连接 → 不在项目中工作。
  const openFolder = src.indexOf('workspace.openFolder')
  const remote = src.indexOf('"remote.trigger"')
  const outside = src.indexOf('chat.empty.workOutsideProject')
  assert.ok(openFolder > 0 && remote > 0 && outside > 0, '阳性对照：三个入口都在')
  assert.ok(openFolder < remote && remote < outside, '打开文件夹 → 远程连接 → 不在项目中工作')
})

test('空态：表里不许出现零消费方的 chat.empty.title/description', skipIfNoZCode, () => {
  // 这四个键在 locale 里有、在源码里没有；表里收它们就是抄了死键。
  const allKeys = [
    ...COMPOSER_TEXTS.map(e => e.key),
    ...COMPOSER_EMPTY_STATES.flatMap(e => e.textKeys),
  ]
  for (const dead of ['chat.empty.title', 'chat.empty.description', 'chat.empty.description.beforeWorkspace', 'chat.empty.description.afterWorkspace']) {
    assert.ok(!allKeys.includes(dead), `${dead} 零消费方，不该进表（应列进 UNVERIFIABLE）`)
  }
  assert.ok(
    UNVERIFIABLE.some(u => u.what.includes('chat.empty.title')),
    '零消费方的空态标题键必须记进 UNVERIFIABLE',
  )
})

// ── ⑦ 引用完整性 ─────────────────────────────────────────────────────────

test('每条引用都指得到：文件在、行号在长度内（全表扫一遍）', skipIfNoZCode, () => {
  const citations = [
    ...COMPOSER_ELEMENTS.flatMap(e => [e.source, e.mountSource, e.testIdSource, e.shortcutSource, ...e.iconGroups.map(g => g.at)]),
    ...COMPOSER_EMPTY_STATES.flatMap(e => [e.source, e.mountSource, e.testIdSource, ...e.iconGroups.map(g => g.at)]),
    ...COMPOSER_SHORTCUTS.flatMap(s => [s.source, s.commandSource]),
    ...TOOLBAR_ROWS.map(r => r.source),
    COMPOSER_INPUT.shellSource,
    COMPOSER_INPUT.editorSource,
    COMPOSER_INPUT.testIdSource,
    COMPOSER_INPUT.enter.source,
    COMPOSER_INPUT.shiftEnter.source,
    PLACEHOLDER_RESOLVER_SOURCE,
    GREETING_HOUR_RULES_SOURCE,
    ...COMPOSER_TEXTS.map(t => t.at),
  ].filter(Boolean)
  assert.ok(citations.length >= 60, `引用条数太少（${citations.length}）`)
  for (const c of citations) loadCitation(c)
})

test('每条引用都指到 ZCode 树里（不许指到本仓或不存在的目录）', skipIfNoZCode, () => {
  const citations = COMPOSER_ELEMENTS.flatMap(e => [e.source, e.mountSource])
  for (const c of citations) {
    assert.ok(
      c.startsWith(`${ZCODE_UI_SRC}/`) || c.startsWith(`${ZCODE_SHARED_SRC}/`),
      `引用必须指 ZCode 树：${c}`,
    )
  }
})

test('无法核实清单：每条都写了具体原因（不许空、不许「同上」）', () => {
  assert.ok(UNVERIFIABLE.length >= 4, '无法核实清单至少四条（空态标题键 / 折叠断点 / 图标像素 / 非 glm 模式文案）')
  for (const u of UNVERIFIABLE) {
    assert.ok(u.what.trim().length > 0, 'what 不许空')
    assert.ok(u.why.trim().length >= 12, `${u.what} 的原因太短（「${u.why}」）`)
    assert.ok(!/^同上$|^不适用$/.test(u.why.trim()), `${u.what} 的原因写了「同上/不适用」`)
  }
})

// ── ⑧ 文件卫生 ───────────────────────────────────────────────────────────

test('源文件卫生：LF、无 NUL、块注释无裸 */、行数 ≤ 900', () => {
  const path = join(root, 'src/agentComposerLayout.ts')
  const raw = read(path)
  assert.ok(!raw.includes('\r'), '不许有 CR（必须 LF）')
  assert.ok(!raw.includes('\0'), '不许有 NUL 字节')
  assert.ok(statSync(path).size > 0)
  const lineCount = raw.split('\n').length
  assert.ok(lineCount <= 900, `行数 ${lineCount} 超上限 900`)
  // 块注释正文里不许有裸 */（会提前闭合注释，后面中文被当代码读）。
  const blocks = raw.match(/\/\*[\s\S]*?\*\//g) ?? []
  for (const b of blocks) {
    const inner = b.slice(2, -2)
    assert.ok(!inner.includes('*/'), `块注释正文里有裸 */：${b.slice(0, 60)}…`)
  }
})

test('源文件是纯数据：零 import、零 Vue/DOM 引用', () => {
  const raw = read(join(root, 'src/agentComposerLayout.ts'))
  assert.doesNotMatch(raw, /^\s*import\s/m, '纯数据模块不许有 import')
  assert.doesNotMatch(raw, /\bdocument\b|\bwindow\b|\bref\(|\bdefineComponent\b/, '不许碰 DOM/Vue')
})
