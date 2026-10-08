// `agent/panel-wiring` 判据：AgentPanel 把会话库与斜杠命令**真的接上**了。
//
// 起因：交接件 §四.2 记着「会话库/斜杠命令还没接进 AgentPanel（模块+判据已交付）」——
// `src/agentSessions.ts` 与 `src/agentCommands.ts` 有判据，但面板没消费它们，那就是两份死代码。
// 这里钉的是**接线**（哪个模块的哪个出口被谁调、面板上有没有那个控件），不重复测那两个模块自身的行为。
//
// 「不许出现 X」型的门都配了阳性对照 —— 本仓吃过空判据的亏（`new RegExp` 拼字符串导致双重转义）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const panel = readFileSync(new URL('../src/components/AgentPanel.vue', import.meta.url), 'utf8')
const hostWire = readFileSync(new URL('../src/agentHostWire.ts', import.meta.url), 'utf8')
const sessionModule = readFileSync(new URL('../src/agentSession.ts', import.meta.url), 'utf8')
const agentSettings = readFileSync(new URL('../src/components/AgentSettingsPage.vue', import.meta.url), 'utf8')
// 会话库弹层的**渲染**在 2026-10-07 拆成独立组件（AgentPanel 顶在 900 行机检上限）——
// 头部按钮留在面板里，列表与三条动作在组件里。判据跨这两个文件看，意图不变。
const sessionPop = readFileSync(new URL('../src/components/AgentSessionPop.vue', import.meta.url), 'utf8')

test('面板消费会话库：建库、每轮存档、切场把转写装回活会话', () => {
  assert.match(panel, /createAgentSessionStore\(\)/, '面板要真的建一份会话库')
  assert.match(panel, /saveTranscript\(/)
  assert.match(panel, /sessions\.open\(id\)/, '切场要走会话库的 open')
  assert.match(panel, /session\(\)\.restore\(sessions\.activeEntries\(\)\)/,
    '切场后要把库里那份转写装回活会话，否则下拉能切、内容不换')
  assert.match(panel, /sessions\.remove\(id\)/, '删场要走会话库的 remove')
  // 阳性对照：下面这条 doesNotMatch 只有在本文件真的含 `<script setup` 时才有意义。
  assert.match(panel, /<script setup lang="ts">/, '阳性对照：本文件确实是个 SFC')
  assert.doesNotMatch(panel, /createAgentSessionStore[\s\S]*?createAgentSessionStore[\s\S]*?createAgentSessionStore/,
    '别在面板里建三份库（每份一份 localStorage 副本，彼此看不见）')
})

test('面板头部有会话按钮与弹层（用户看得见的部分，不能只在 script 里接线）', () => {
  assert.match(panel, /class="agent-session-button"/, '头部要有一个会话按钮')
  assert.match(sessionPop, /v-for="item in sessions"/, '弹层里要列出库里的每一场')
  assert.match(sessionPop, /AGENT_SESSION_LIMIT/, '上限要显示出来（用户要知道会淘汰）')
  // 阳性对照：面板必须真的挂上那个弹层组件，否则「列表在组件里」等于没渲染。
  assert.match(panel, /<AgentSessionPop v-if="openPop === 'sessions'"/, '面板要挂上会话弹层组件')
})

test('斜杠命令：send 拦 `/` 走命令表，认不出来的原样按消息发（不吞输入）', () => {
  assert.match(panel, /parseAgentCommand/, '面板要用命令表解析器')
  assert.match(panel, /isAgentCommandInput|matchAgentCommands/)
  assert.match(panel, /if \(runCommand\(text\)\)/, 'send 必须在发给模型之前先拦一道')
  // 阳性对照：runCommand 必须在「认不出命令时返回 false」——那条是「不吞用户输入」的实现。
  assert.match(panel, /if \(!parsed\) return false\s*\n\s*const command = AGENT_COMMANDS\.find/,
    '认不出来的命令要 return false（继续按普通文本发出）')
  assert.match(panel, /placeholder="[^"]*\/[^"]*面板命令/, '输入框的提示要说清 `/` 开头是面板命令')
})

test('斜杠命令的五条真命令都有派发出口（表里有的，面板里不许漏）', () => {
  for (const id of ['new', 'clear', 'review', 'keep-all', 'settings']) {
    assert.match(panel, new RegExp(`case '${id}':`), `命令 /${id} 没有派发出口`)
  }
})

test('`/只看待决` 真接到改动列表的过滤上（不是只弹一句提示）', () => {
  assert.match(panel, /const pendingOnly = ref\(false\)/)
  assert.match(panel, /pendingOnly\.value \? edits\.value\.filter\(edit => edit\.state === 'pending'\) : edits\.value/,
    '改动列表要真的按 pendingOnly 过滤')
  assert.match(panel, /v-for="edit in visibleEdits"/, '模板渲染的是过滤后的那一份')
  assert.match(panel, /:aria-pressed="pendingOnly"/, '过滤钮是开关 ⇒ 带 aria-pressed')
})

test('没有会话完成状态时，不展示会永久删除会话的自动归档设置', () => {
  assert.doesNotMatch(panel, /archiveStaleSessions|runAutoArchive/)
  assert.doesNotMatch(agentSettings, /v-model="draft\.general\.taskAutoArchiveEnabled"/)
})

test('宿主文件桥有等待上限兜底（挂起不再把面板永久锁死）', () => {
  assert.match(hostWire, /withBridgeTimeout/, 'file.read / file.write 要过时限')
  assert.match(hostWire, /import \{ withBridgeTimeout \} from '\.\/agentBridgeTimeout\.ts'/)
  // 阳性对照：读与写两条路都要有（只给读加、写那条挂起同样会锁住「保留」那颗钮）。
  const guarded = hostWire.match(/withBridgeTimeout\(/g) ?? []
  assert.ok(guarded.length >= 3, `读/取版本/写三处都该有时限，实际 ${guarded.length} 处`)
})

test('会话状态机提供清空与恢复两个出口（面板的命令与下拉都落在它们上面）', () => {
  assert.match(sessionModule, /clear\(\): void/, '要 clear')
  assert.match(sessionModule, /restore\(entries: readonly AgentTranscriptEntry\[\]\): void/, '要 restore')
  // 阳性对照：restore 必须有「历史调用不进执行队列」那条实现，不然切回旧对话会把旧改动再写一次盘。
  assert.match(sessionModule, /approved\.length = 0\s*\/\/ 历史调用一律不进/,
    'restore 必须先清空执行队列（阳性对照）')
})
