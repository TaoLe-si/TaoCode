// `agent/prompt-menu` 判据：ZCode 斜杠命令 / @ 上下文面板的交互层**逐条回源码核**。
//
// src/agentPromptMenu.ts 是主代理接线 AgentPanel.vue 时要照抄的交互规则表；这里钉四件事：
//   ① 触发词规则（词边界 / 中文放宽 / 域名拒绝 / tail 长度）与 promptInputTriggers.ts 一致；
//   ② @ 来源清单、分组顺序、字段形状与 ZCode 源码逐条对上，且引用的 文件:行号**真实存在**；
//   ③ 文案键在 zh-CN.ts 里逐字存在、行号指得对、且**有真实消费方**（不引死键）；
//   ④ 两套过滤 / 插入语义 / 键盘导航是照源码转写的纯函数。
//
// 「不许出现 X」型的门都配了阳性对照 —— 本仓吃过空判据的亏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_MENU_FOOTER_TRIGGERS,
  ACTION_MENU_QUICK_COMMANDS,
  CONTEXT_GROUP_ORDER,
  CONTEXT_MENU_SOURCES,
  MENTION_CHIP_ICONS,
  MENTION_CHIP_ICONS_SOURCE,
  MENU_OPTION_FIELDS,
  MENU_SECTION_FIELDS,
  MENU_SELECT_KEYS,
  PROMPT_MENU_TEXTS,
  PROMPT_MENU_UNVERIFIABLE,
  ZCODE_LOCALE_FILE,
  ZCODE_UI_SRC,
  actionMenuQuickCommands,
  actionMenuSelectTarget,
  bestPromptMenuSuggestionIndex,
  buildFileMentionMarkdown,
  buildPluginMentionMarkdown,
  buildPromptMenuRows,
  buildSessionMentionMarkdown,
  buildSkillMentionMarkdown,
  buildSubagentMentionMarkdown,
  clampedMenuIndex,
  clampMenuIndexToLength,
  coerceEnabledMenuIndex,
  createPromptMenuTokenSnapshot,
  extractActivePromptMenuTrigger,
  filterMentionMenuItems,
  filterPromptMenuSuggestions,
  hasPromptMenuQuery,
  mentionGroupLimitForQuery,
  mentionPanelSearchHintKey,
  nextEnabledMenuIndex,
  normalizePromptMentionDisplayLabel,
  normalizeSlashCommandValue,
  promptMenuChrome,
  promptMenuGroupOrder,
  promptMenuInsertionForMentionItem,
  promptMenuInsertionForSuggestion,
  promptMenuOwner,
  promptMenuTokenReplacementRange,
  promptMenuTokenTailLength,
  promptMenuTriggerSignature,
  reconcilePromptMenuTokenSnapshot,
  scoreMentionFuzzy,
  sessionMentionWorkspaceScope,
  shouldPromptMenuProcessUpdate,
  slashApplyMentionPayload,
  visiblePromptMenuSections,
  wrappedMenuIndex,
} from '../src/agentPromptMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ui = join(root, ZCODE_UI_SRC)

/** ZCode 源码树在不在：不在就跳过依赖它的断言（与 tests/agent-composer-layout.test.mjs 同处理）。 */
const hasZCode = existsSync(ui)
const skipIfNoZCode = { skip: hasZCode ? false : 'ZCode 参考树不在本机' }

// ZCode 树在本机是 CRLF，统一折成 LF 再切行，否则行号会偏。
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const lines = p => read(p).split('\n')
const uiFile = p => join(ui, p.replace(`${ZCODE_UI_SRC}/`, ''))

/** 把 `文件:行号` 或 `文件:行号-行号` 解成 { file, nums }。 */
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

/** 行号指向的那一行必须含 anchor（防止行号漂移后指到别处）。 */
function assertLineContains(at, anchor) {
  const body = loadCitation(at)
  const { nums } = parseCitation(at)
  for (const n of nums) {
    if (body[n - 1].includes(anchor)) return
  }
  assert.fail(`${at} 的这几行都不含「${anchor}」：\n${nums.map(n => `${n}: ${body[n - 1]}`).join('\n')}`)
}

// ── ① 文案表 ─────────────────────────────────────────────────────────────

test('文案表：每条键在 zh-CN.ts 里逐字存在、行号指得对、中文一致', skipIfNoZCode, () => {
  const locale = uiFile(ZCODE_LOCALE_FILE)
  assert.ok(existsSync(locale), 'zh-CN 词条文件必须在')
  const body = lines(locale)
  assert.ok(PROMPT_MENU_TEXTS.length >= 35, `文案表太薄（${PROMPT_MENU_TEXTS.length} 条），疑似被删空`)

  for (const entry of PROMPT_MENU_TEXTS) {
    const line = body[entry.at - 1] ?? ''
    assert.ok(line.includes(`"${entry.key}"`), `${entry.key} 的 at 行不对：第 ${entry.at} 行是「${line.trim()}」`)
    const window = body.slice(entry.at - 1, entry.at + 3).join('\n')
    assert.ok(window.includes(entry.zh), `${entry.key} 的中文与 zh-CN.ts 不一致：表里「${entry.zh}」，源码「${line.trim()}」`)
  }
})

test('文案表：每条键都有真实消费方，且消费方 文件:行号 指得对', skipIfNoZCode, () => {
  const uiRoot = join(root, ZCODE_UI_SRC)
  for (const entry of PROMPT_MENU_TEXTS) {
    const consumers = entry.consumers.split(',').map(s => s.trim()).filter(Boolean)
    assert.ok(consumers.length > 0, `${entry.key} 没登记消费方`)
    for (const consumer of consumers) {
      const at = `${ZCODE_UI_SRC}/${consumer}`
      const body = loadCitation(at)
      const { nums } = parseCitation(at)
      const hit = nums.some(n => body[n - 1].includes(entry.key))
      assert.ok(hit, `${entry.key} 的消费方 ${consumer} 那几行没出现这个键`)
    }
  }
  // 阳性对照：真的扫到了 ZCode 树（不是路径拼错导致全体 existsSync 失败）。
  assert.ok(uiRoot.length > 0 && existsSync(join(uiRoot, 'SlashCommandPlugin.tsx')))
})

test('文案表：@ / / 两个面板的标题与空态键都在表里', () => {
  const declared = new Set(PROMPT_MENU_TEXTS.map(e => e.key))
  const required = [
    'chat.mention.title',
    'chat.mention.searchHint',
    'chat.mention.emptyResults',
    'chat.mention.category.loading',
    'chat.slash.title',
    'chat.slash.searchHint',
    'chat.slash.commands.title',
    'chat.slash.skills.title',
    'chat.slash.subagents.title',
    'chat.slash.emptyUnavailable',
    'chat.slash.emptyResults',
    'chat.composer.actionMenu',
  ]
  const missing = required.filter(key => !declared.has(key))
  assert.deepEqual(missing, [], '面板骨架文案有缺失')
})

test('「无法核实」清单每条都写了原因，且不是空表', () => {
  assert.ok(PROMPT_MENU_UNVERIFIABLE.length >= 4)
  for (const item of PROMPT_MENU_UNVERIFIABLE) {
    assert.ok(item.what.trim(), 'what 不得为空')
    assert.ok(item.why.trim(), `${item.what} 没写为什么无法核实`)
  }
})

// ── ② 触发词规则 ─────────────────────────────────────────────────────────

test('触发词：行首或空白后触发，句中紧贴非空白字符不触发', () => {
  assert.deepEqual(extractActivePromptMenuTrigger('/'), { trigger: '/', query: '' })
  assert.deepEqual(extractActivePromptMenuTrigger('hello /'), { trigger: '/', query: '' })
  assert.deepEqual(extractActivePromptMenuTrigger('hello /cl'), { trigger: '/', query: 'cl' })
  assert.equal(extractActivePromptMenuTrigger('hello/cl'), null, '斜杠前不是空白就不触发')
  assert.equal(extractActivePromptMenuTrigger('hello\nx@y'), null, '紧贴正文的 @ 不触发')
  assert.deepEqual(extractActivePromptMenuTrigger('a @b'), { trigger: '@', query: 'b' })
  assert.deepEqual(extractActivePromptMenuTrigger('a #sess_1'), { trigger: '#', query: 'sess_1' })
  assert.deepEqual(extractActivePromptMenuTrigger('a $sk'), { trigger: '$', query: 'sk' })
})

test('触发词：中文紧邻 @ 放宽（不在句中插空格），但域名形态拒绝', () => {
  assert.deepEqual(extractActivePromptMenuTrigger('看看@'), { trigger: '@', query: '' })
  assert.deepEqual(extractActivePromptMenuTrigger('联系@张'), { trigger: '@', query: '张' })
  assert.deepEqual(extractActivePromptMenuTrigger('看看，@foo'), { trigger: '@', query: 'foo' })
  assert.equal(extractActivePromptMenuTrigger('联系邮箱@example.com'), null, '汉字紧邻 + x.y 形态 = 邮箱，不触发')
  assert.deepEqual(
    extractActivePromptMenuTrigger('联系邮箱 @example.com'),
    { trigger: '@', query: 'example.com' },
    '空白后的 x.y 不是邮箱形态，保持触发',
  )
  assert.equal(extractActivePromptMenuTrigger('看看@foo.bar'), null, '汉字紧邻 + 域名形态拒绝')
})

test('触发词：query 只到下一个空白/触发符为止，尾部不是当前 token 就整体不触发', () => {
  // 触发符必须紧贴光标（query 是它到光标之间的连续非触发字符），所以光标落在别的字上就不触发。
  assert.equal(extractActivePromptMenuTrigger('@a b'), null, '光标在 b 上，@ 不是当前 token')
  assert.equal(extractActivePromptMenuTrigger('@a/b'), null, 'query 被 / 截断后够不到光标')
  assert.deepEqual(extractActivePromptMenuTrigger('@a'), { trigger: '@', query: 'a' })
  assert.deepEqual(extractActivePromptMenuTrigger('hi /go'), { trigger: '/', query: 'go' })
  assert.deepEqual(extractActivePromptMenuTrigger('a ¥sk'), { trigger: '$', query: 'sk' })
  assert.deepEqual(extractActivePromptMenuTrigger('a ￥sk'), { trigger: '$', query: 'sk' })
})

test('签名：trigger + query 组合，@x 与 /x 不互相压住', () => {
  assert.equal(promptMenuTriggerSignature(null), null)
  assert.equal(promptMenuTriggerSignature({ trigger: '@', query: 'x' }), '@:x')
  assert.equal(promptMenuTriggerSignature({ trigger: '/', query: 'x' }), '/:x')
  assert.notEqual(
    promptMenuTriggerSignature({ trigger: '@', query: 'x' }),
    promptMenuTriggerSignature({ trigger: '/', query: 'x' }),
  )
})

test('tail 长度：query 为空给 0；只删候选未输入后缀能对上的那一小段', () => {
  assert.equal(promptMenuTokenTailLength({ trigger: '/', query: '' }, 'al', '/goal'), 0)
  assert.equal(promptMenuTokenTailLength({ trigger: '/', query: 'go' }, 'al', '/goal'), 2)
  assert.equal(promptMenuTokenTailLength({ trigger: '/', query: 'go' }, 'xyz', '/goal'), 0)
  assert.equal(promptMenuTokenTailLength({ trigger: '@', query: 'foo' }, '.ts', '@foo.ts'), 3)
})

test('历史导航回填：带 tag 的更新不处理（否则方向键被 CRITICAL 处理器吞掉）', () => {
  assert.equal(shouldPromptMenuProcessUpdate(new Set()), true)
  assert.equal(shouldPromptMenuProcessUpdate(new Set(['zcode-history-navigation'])), false)
  assert.equal(shouldPromptMenuProcessUpdate(new Set(['zcode-programmatic'])), true)
})

test('面板归属：/ 是 SlashCommandPlugin，@ # $ 是 MentionPlugin', () => {
  assert.equal(promptMenuOwner('/').panel, 'SlashCommandPlugin')
  for (const trigger of ['@', '#', '$']) assert.equal(promptMenuOwner(trigger).panel, 'MentionPlugin')
})

// ── ③ token 快照与替换区间 ────────────────────────────────────────────────

test('快照：tokenStart 落在触发符上，tokenText 含触发符与 query', () => {
  const snapshot = createPromptMenuTokenSnapshot({
    cursorOffset: 8, nodeKey: 'n1', text: 'hi /goal', textBeforeCursor: 'hi /goal',
  })
  assert.ok(snapshot)
  assert.equal(snapshot.trigger, '/')
  assert.equal(snapshot.query, 'goal')
  assert.equal(snapshot.tokenStart, 3, "'hi /goal' 里 / 在下标 3")
  assert.equal(snapshot.tokenEnd, 8)
  assert.equal(snapshot.tokenText, '/goal')
})

test('快照：仅选区变化且 token 原样 → 复用旧快照（左右键不重算）', () => {
  const previous = createPromptMenuTokenSnapshot({
    cursorOffset: 8, nodeKey: 'n1', text: 'hi /goal', textBeforeCursor: 'hi /goal',
  })
  const same = reconcilePromptMenuTokenSnapshot(
    previous,
    { cursorOffset: 8, nodeKey: 'n1', text: 'hi /goal', textBeforeCursor: 'hi /goal' },
    true,
  )
  assert.equal(same, previous, '应原样复用')

  const moved = reconcilePromptMenuTokenSnapshot(
    previous,
    { cursorOffset: 3, nodeKey: 'n1', text: 'hi /goal', textBeforeCursor: 'hi ' },
    true,
  )
  assert.equal(moved, null, '光标移到 token 起点之前后不再复用')

  const edited = reconcilePromptMenuTokenSnapshot(
    previous,
    { cursorOffset: 8, nodeKey: 'n1', text: 'hi /goXl', textBeforeCursor: 'hi /goX' },
    true,
  )
  assert.ok(edited, 'token 文本变了要重建快照')
  assert.equal(edited.query, 'goX')
})

test('替换区间：快照有效时给出 [tokenStart, tokenEnd]；失效给 null', () => {
  const snapshot = createPromptMenuTokenSnapshot({
    cursorOffset: 8, nodeKey: 'n1', text: 'hi /goal', textBeforeCursor: 'hi /goal',
  })
  assert.deepEqual(
    promptMenuTokenReplacementRange(snapshot, { cursorOffset: 8, nodeKey: 'n1', text: 'hi /goal', textBeforeCursor: 'hi /goal' }),
    { start: 3, end: 8 },
  )
  assert.equal(
    promptMenuTokenReplacementRange(snapshot, { cursorOffset: 8, nodeKey: 'n2', text: 'hi /goal', textBeforeCursor: 'hi /goal' }),
    null,
    '换了节点就不认',
  )
})

// ── ④ @ 来源清单与分组顺序 ────────────────────────────────────────────────

test('@ 分组顺序固定：插件 → 文件 → 对话 → 画板', () => {
  assert.deepEqual([...CONTEXT_GROUP_ORDER], ['plugins', 'files', 'sessions', 'whiteboards'])
  assert.deepEqual([...promptMenuGroupOrder('@')], ['plugins', 'files', 'sessions', 'whiteboards'])
  assert.deepEqual([...promptMenuGroupOrder('#')], ['sessions'])
  assert.deepEqual([...promptMenuGroupOrder('$')], ['skills'])
  assert.deepEqual([...promptMenuGroupOrder('/')], [])
})

test('来源清单：五条各带 id 前缀 / 图标 / provider 出处，且 @ 面板拿到四条', () => {
  assert.equal(CONTEXT_MENU_SOURCES.length, 5)
  const ids = CONTEXT_MENU_SOURCES.map(s => s.id)
  assert.deepEqual(ids, ['plugins', 'files', 'sessions', 'whiteboards', 'skills'])

  const forContext = CONTEXT_MENU_SOURCES.filter(s => s.enabledFor.includes('@')).map(s => s.id)
  assert.deepEqual(forContext, ['plugins', 'files', 'sessions', 'whiteboards'], '@ 面板的四条来源')

  for (const source of CONTEXT_MENU_SOURCES) {
    assert.ok(source.idPrefix.endsWith(':'), `${source.id} 的 idPrefix 形状不对`)
    assert.ok(source.icon.trim(), `${source.id} 缺图标`)
    assert.ok(source.iconSource.trim(), `${source.id} 缺图标出处`)
    assert.ok(source.providerSource.trim(), `${source.id} 缺 provider 出处`)
    assert.ok(source.markdownSource.trim(), `${source.id} 缺 markdown 出处`)
  }
})

test('来源清单引用的每个 文件:行号 都真实存在且锚点对得上', skipIfNoZCode, () => {
  // 每条来源的 iconSource / providerSource / markdownSource 都要指到「含该来源特征串」的行。
  // 这样把任一出处改错（越界、指到别处）都会红，出处才真的是承重的。
  const expectedAnchor = {
    plugins: ['PluginIcon', 'usePluginsMentionProvider', 'buildPluginMentionMarkdown'],
    files: ['item.category === "files"', 'useFileMentionProvider', 'buildFileMentionMarkdown'],
    sessions: ['MessagesSquare', 'useSessionsMentionProvider', 'buildSessionMentionMarkdown'],
    whiteboards: ['PaletteIcon', 'useWhiteboardMentionProvider', 'markdown'],
    skills: ['WandSparkles', 'useSkillsMentionProvider', 'buildSkillMentionMarkdown'],
  }
  assert.deepEqual(CONTEXT_MENU_SOURCES.map(s => s.id), Object.keys(expectedAnchor), '来源清单与锚点表一一对应')

  for (const source of CONTEXT_MENU_SOURCES) {
    const [iconAnchor, providerAnchor, markdownAnchor] = expectedAnchor[source.id]
    // 出处里可能带行号区间；逐行都算命中。
    for (const [at, anchor] of [
      [source.iconSource, iconAnchor],
      [source.providerSource, providerAnchor],
      [source.markdownSource, markdownAnchor],
    ]) {
      assertLineContains(at, anchor)
    }
  }

  // chip 图标表的出处也要指得到六条图标常量。
  for (const name of Object.values(MENTION_CHIP_ICONS)) {
    assert.ok(
      lines(uiFile(MENTION_CHIP_ICONS_SOURCE.split(':')[0])).some(line => line.includes(`export const ${name}`)),
      `${MENTION_CHIP_ICONS_SOURCE} 里找不到 ${name}`,
    )
  }
})

test('来源 id 前缀与 ZCode provider 里的 item id 前缀一致', skipIfNoZCode, () => {
  const fileProvider = read(uiFile('mentions/providers/fileMentionProvider.ts'))
  assert.match(fileProvider, /id: `file:\$\{entry\.relativePath\}`/)
  const sessionProvider = read(uiFile('mentions/providers/sessionsMentionProvider.ts'))
  assert.match(sessionProvider, /id: `session:\$\{task\.taskId\}`/)
  const pluginProvider = read(uiFile('mentions/providers/pluginsMentionProvider.ts'))
  assert.match(pluginProvider, /id: `plugin:\$\{entry\.pluginId\}`/)
  const boardProvider = read(uiFile('mentions/providers/whiteboardMentionProvider.ts'))
  assert.match(boardProvider, /id: `whiteboard:\$\{board\.id\}`/)
  const skillProvider = read(uiFile('mentions/providers/skillsMentionProvider.ts'))
  assert.match(skillProvider, /id: `skill:\$\{skill\.id\}`/)
})

test('会话范围：@ 只搜当前 workspace，# 才扩到同 authority', () => {
  assert.equal(sessionMentionWorkspaceScope('@'), 'current-workspace')
  assert.equal(sessionMentionWorkspaceScope('#'), 'same-authority-workspaces')
  assert.equal(sessionMentionWorkspaceScope('$'), 'current-workspace')
  assert.equal(sessionMentionWorkspaceScope(null), 'current-workspace')
})

test('描述行：无 query 时 # / $ 各有专属提示，其余走通用', () => {
  assert.equal(mentionPanelSearchHintKey('#'), 'chat.mention.sessions.searchHint')
  assert.equal(mentionPanelSearchHintKey('$'), 'chat.mention.skills.searchHint')
  assert.equal(mentionPanelSearchHintKey('@'), 'chat.mention.searchHint')
  assert.equal(mentionPanelSearchHintKey(null), 'chat.mention.searchHint')
})

test('chip 图标表：六类 mention 都有，files 走 fileDisplay 不在此表', () => {
  assert.deepEqual(
    Object.keys(MENTION_CHIP_ICONS).sort(),
    ['commands', 'plugins', 'sessions', 'skills', 'subagents', 'whiteboards'],
  )
  assert.equal(MENTION_CHIP_ICONS.files, undefined)
})

// ── ⑤ 菜单项 / 分组形状 ───────────────────────────────────────────────────

test('选项与分组字段全集照 MentionPanel 接口', () => {
  assert.deepEqual([...MENU_OPTION_FIELDS], ['id', 'label', 'description', 'content', 'meta', 'disabled', 'disabledReason'])
  assert.deepEqual([...MENU_SECTION_FIELDS], ['id', 'title', 'options', 'emptyText', 'loadingText', 'loading', 'errorText'])
})

test('行序：多分组才插标题；error → loading → empty 优先，命中就不渲染该组选项', () => {
  const sections = [
    {
      id: 'a', title: 'A', emptyText: '空A',
      options: [{ id: 'a1', label: 'a1', description: '' }],
    },
    {
      id: 'b', title: 'B', emptyText: '空B', errorText: '炸了',
      options: [{ id: 'b1', label: 'b1', description: '' }],
    },
    {
      id: 'c', title: 'C', emptyText: '空C', loading: true, loadingText: '搜索中...',
      options: [],
    },
    { id: 'd', title: 'D', emptyText: '空D', options: [] },
  ]
  const rows = buildPromptMenuRows(sections)
  assert.deepEqual(
    rows.map(r => `${r.kind}:${r.sectionId}`),
    ['section-header:a', 'option:a', 'section-header:b', 'status:b', 'section-header:c', 'status:c', 'section-header:d', 'status:d'],
  )
  const statuses = rows.filter(r => r.kind === 'status')
  assert.deepEqual(statuses.map(r => r.content), ['error', 'loading', 'empty'])
  assert.equal(statuses[0].text, '炸了')
  assert.equal(statuses[1].text, '搜索中...', 'loading 有 loadingText 就用它')
  assert.equal(statuses[2].text, '空D')

  // 单分组不插标题；扁平行索引只数真的渲染出来的选项。
  const single = buildPromptMenuRows([
    { id: 'only', title: 'Only', emptyText: '空', options: [{ id: 'x', label: 'x', description: '' }] },
  ])
  assert.deepEqual(single.map(r => r.kind), ['option'])
  assert.equal(single[0].flatOptionIndex, 0)
})

test('可见分组：空且不在加载也不出错的分组被丢掉', () => {
  const kept = visiblePromptMenuSections([
    { id: 'a', loading: false, errorText: null, options: [] },
    { id: 'b', loading: true, errorText: null, options: [] },
    { id: 'c', loading: false, errorText: 'err', options: [] },
    { id: 'd', loading: false, errorText: null, options: [{}] },
  ])
  assert.deepEqual(kept.map(s => s.id), ['b', 'c', 'd'])
})

test('面板骨架显隐：有 query 才显示空态；无 query 才显示 footer 与描述', () => {
  assert.deepEqual(promptMenuChrome({ hasActiveQuery: true, hasFooter: true, hasDescription: true, hasEmptyText: true }), {
    showEmptyText: true, showFooter: false, showDescription: false,
  })
  assert.deepEqual(promptMenuChrome({ hasActiveQuery: false, hasFooter: true, hasDescription: true, hasEmptyText: true }), {
    showEmptyText: false, showFooter: true, showDescription: true,
  })
  assert.deepEqual(promptMenuChrome({ hasActiveQuery: true, hasFooter: true, hasDescription: true, hasEmptyText: false }), {
    showEmptyText: false, showFooter: false, showDescription: false,
  })
})

// ── ⑥ 键盘导航 ───────────────────────────────────────────────────────────

test('mention 面板循环导航，并跳过禁选项；全禁时原地不动', () => {
  assert.equal(wrappedMenuIndex(0, -1, 3), 2, '上键从第一项跳到末项')
  assert.equal(wrappedMenuIndex(2, 1, 3), 0)
  assert.equal(wrappedMenuIndex(0, 1, 0), 0)

  const items = [{ disabled: true }, {}, {}]
  assert.equal(nextEnabledMenuIndex(0, 1, items), 1, '跳过禁选的第 0 项')
  assert.equal(nextEnabledMenuIndex(1, -1, items), 2, '反向也跳过禁选项')
  assert.equal(nextEnabledMenuIndex(0, 1, [{ disabled: true }, { disabled: true }]), 0, '全禁原地')
})

test('mention 面板候选更新后收敛到可选条目', () => {
  assert.equal(coerceEnabledMenuIndex(0, [{ disabled: true }, {}]), 1)
  assert.equal(coerceEnabledMenuIndex(0, [{}]), 0)
  assert.equal(coerceEnabledMenuIndex(5, [{}, {}]), 1, '越界夹回')
  assert.equal(coerceEnabledMenuIndex(0, [{ disabled: true }, { disabled: true }]), 0, '全禁保持')
  assert.equal(coerceEnabledMenuIndex(0, []), 0)
})

test('slash 面板夹紧不循环', () => {
  assert.equal(clampedMenuIndex(0, -1, 3), 0, '上键在第一项停住')
  assert.equal(clampedMenuIndex(2, 1, 3), 2, '下键在末项停住')
  assert.equal(clampedMenuIndex(1, 1, 3), 2)
  assert.equal(clampMenuIndexToLength(5, 3), 2)
  assert.equal(clampMenuIndexToLength(0, 0), 0)
})

test('确认键：mention/slash 认 Enter 与 Tab，+ 菜单多认空格', () => {
  assert.deepEqual([...MENU_SELECT_KEYS.mention], ['Enter', 'Tab'])
  assert.deepEqual([...MENU_SELECT_KEYS.slash], ['Enter', 'Tab'])
  assert.deepEqual([...MENU_SELECT_KEYS.action], ['Enter', 'Tab', ' '])
})

// ── ⑦ 过滤 ───────────────────────────────────────────────────────────────

test('mention 打分：中文 query 不做逐字符子序列，英文才做', () => {
  assert.equal(scoreMentionFuzzy('浏览器操作', '浏器', true), null, '中文子序列过宽，应拒绝')
  assert.ok(scoreMentionFuzzy('浏览器操作', '浏览', true) !== null, '连续子串命中')
  assert.ok(scoreMentionFuzzy('fileMentionProvider', 'fmp', true) !== null, '英文仍走子序列')
  assert.equal(scoreMentionFuzzy('', 'x', true), null)
  assert.equal(scoreMentionFuzzy('abc', '', true), 0)
})

test('mention 过滤：空 query 给预览条数、目录排后；requireQuery 时空表', () => {
  const items = [
    { id: 'file:a/x.ts', category: 'files', label: 'x.ts', description: 'a/x.ts', value: 'a/x.ts', markdown: '', data: { kind: 'file' } },
    { id: 'file:a', category: 'files', label: 'a', description: 'a', value: 'a', markdown: '', data: { kind: 'directory' } },
  ]
  const preview = filterMentionMenuItems(items, '', { limit: 10 })
  assert.deepEqual(preview.map(i => i.id), ['file:a/x.ts', 'file:a'], '文件在目录之前')

  assert.deepEqual(filterMentionMenuItems(items, '', { requireQuery: true }), [], 'requireQuery 时空 query 给空表')

  const limited = filterMentionMenuItems(items, '', { limit: 1 })
  assert.equal(limited.length, 1)
})

test('mention 过滤：query 命中 label/value/description/keywords，plugins 不看 description', () => {
  const items = [
    { id: 'plugin:p', category: 'plugins', label: 'my-plugin', description: '一段很长的中文描述', value: 'my-plugin@mkt', markdown: '', keywords: ['插件'] },
    { id: 'file:z.ts', category: 'files', label: 'z.ts', description: '描述里有 zebra', value: 'z.ts', markdown: '' },
  ]
  assert.deepEqual(filterMentionMenuItems(items, 'my-plug').map(i => i.id), ['plugin:p'])
  assert.deepEqual(filterMentionMenuItems(items, '插件').map(i => i.id), ['plugin:p'], 'keywords 命中')
  assert.deepEqual(filterMentionMenuItems(items, 'zebra').map(i => i.id), ['file:z.ts'], '文件看 description')
  assert.deepEqual(
    filterMentionMenuItems(items, '一段很长').map(i => i.id),
    [],
    'plugins 的 description 不参与匹配（长描述会带进无关候选）',
  )
})

test('mention 过滤：命中数量上限默认 1000', () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({
    id: `file:f${i}`, category: 'files', label: `f${i}`, description: '', value: `f${i}`, markdown: '',
  }))
  assert.equal(filterMentionMenuItems(many, '').length, 1000)
  assert.equal(filterMentionMenuItems(many, '').length, 1000, '不因 limit 缺省而放行全量')
})

test('分组预览条数：空 query 给默认，有 query 时给 undefined', () => {
  assert.equal(mentionGroupLimitForQuery(''), 3)
  assert.equal(mentionGroupLimitForQuery('   '), 3)
  assert.equal(mentionGroupLimitForQuery('abc'), undefined)
  assert.equal(mentionGroupLimitForQuery('abc', 10), undefined)
  assert.equal(mentionGroupLimitForQuery('', 10), 10)
  assert.equal(hasPromptMenuQuery('  '), false)
  assert.equal(hasPromptMenuQuery('a'), true)
})

test('slash 过滤：query 为 null 给空表，空串给全表且顺序不变', () => {
  const suggestions = [
    { id: 'slash:a', trigger: '/', value: 'alpha', label: '/alpha', description: '第一个' },
    { id: 'slash:b', trigger: '/', value: 'beta', label: '/beta', description: '第二个' },
  ]
  assert.deepEqual(filterPromptMenuSuggestions(suggestions, null), [])
  assert.deepEqual(filterPromptMenuSuggestions(suggestions, '').map(s => s.id), ['slash:a', 'slash:b'])
  assert.deepEqual(filterPromptMenuSuggestions(suggestions, '  ').map(s => s.id), ['slash:a', 'slash:b'])
})

test('slash 过滤：打分权重 value < label(+50) < description(+250) < keywords(+450)', () => {
  const suggestions = [
    { id: 'slash:value', trigger: '/', value: 'goal', label: '/x', description: '' },
    { id: 'slash:label', trigger: '/', value: 'zzz', label: '/goal', description: '' },
    { id: 'slash:desc', trigger: '/', value: 'zzz', label: '/yyy', description: 'goal' },
    { id: 'slash:kw', trigger: '/', value: 'zzz', label: '/yyy', description: '', keywords: ['goal'] },
  ]
  assert.deepEqual(
    filterPromptMenuSuggestions(suggestions, 'goal').map(s => s.id),
    ['slash:value', 'slash:label', 'slash:desc', 'slash:kw'],
  )
  assert.deepEqual(
    filterPromptMenuSuggestions(suggestions, '不存在').map(s => s.id),
    [],
  )
})

test('slash 默认选中：按统一模糊评分取全局最佳，空 query 落第 0 项', () => {
  const suggestions = [
    { id: 'slash:a', trigger: '/', value: 'zzz', label: '/zzz', description: 'rev' },
    { id: 'slash:b', trigger: '/', value: 'review', label: '/review', description: '' },
  ]
  assert.equal(bestPromptMenuSuggestionIndex(suggestions, null), 0)
  assert.equal(bestPromptMenuSuggestionIndex(suggestions, '  '), 0)
  assert.equal(bestPromptMenuSuggestionIndex(suggestions, 'review'), 1, '值命中压过描述命中')
})

test('slash 命令值归一：远端返回 /init 时去掉前导斜杠', () => {
  assert.equal(normalizeSlashCommandValue('/init'), 'init')
  assert.equal(normalizeSlashCommandValue('//init'), 'init')
  assert.equal(normalizeSlashCommandValue(' init '), 'init')
  assert.equal(normalizeSlashCommandValue(''), '')
})

// ── ⑧ 插入语义 ───────────────────────────────────────────────────────────

test('slash 选中：命令插 /value，skill 走 $，subagent 走 @，都补一个尾随空格', () => {
  const command = slashApplyMentionPayload({ id: 'slash:init', trigger: '/', value: '/init', label: '/init', description: 'x' })
  assert.equal(command.category, 'commands')
  assert.equal(command.label, 'init')
  assert.equal(command.markdown, '/init')

  const skill = slashApplyMentionPayload({ id: 'skill:s', trigger: '/', value: 'code-review', label: '$code-review', description: '', data: { path: '/p/skills/code-review/SKILL.md' } })
  assert.equal(skill.category, 'skills')
  assert.equal(skill.markdown, '[$code-review](/p/skills/code-review/SKILL.md)')

  const subagent = slashApplyMentionPayload({ id: 'subagent:a', trigger: '/', value: 'explore', label: 'explore', description: '' })
  assert.equal(subagent.category, 'subagents')
  assert.equal(subagent.markdown, '@explore')

  const plan = promptMenuInsertionForSuggestion({ id: 'slash:init', trigger: '/', value: 'init', label: '/init', description: '' })
  assert.equal(plan.kind, 'mention')
  assert.equal(plan.trailingText, ' ')
})

test('slash 选中：App 命令只删 token，不插 mention 不发送', () => {
  const plan = promptMenuInsertionForSuggestion({
    id: 'app-slash:side', trigger: '/', value: 'side', label: '/side', description: '辅助对话',
  })
  assert.deepEqual(plan, { kind: 'remove-only' })
})

test('mention 选中：普通项插 mention + 空格；画板走宿主回调只删 token', () => {
  const file = {
    id: 'file:a/x.ts', category: 'files', label: 'x.ts', description: 'a/x.ts', value: 'a/x.ts',
    markdown: '[x.ts](./a/x.ts)', data: { kind: 'file', relativePath: 'a/x.ts' },
  }
  const plan = promptMenuInsertionForMentionItem(file)
  assert.equal(plan.kind, 'mention')
  assert.equal(plan.payload.markdown, '[x.ts](./a/x.ts)')
  assert.equal(plan.trailingText, ' ')

  const board = { id: 'whiteboard:b', category: 'whiteboards', label: 'B', description: '3', value: 'b', markdown: '@B' }
  assert.equal(promptMenuInsertionForMentionItem(board).kind, 'mention', '没有宿主回调时按普通 mention 插')
  assert.deepEqual(promptMenuInsertionForMentionItem(board, { onWhiteboardMentionSelected: true }), { kind: 'remove-only' })
})

test('markdown 构造：文件补 ./、目录尾斜杠、会话有标题走链接、插件身份在 destination', () => {
  assert.equal(buildFileMentionMarkdown('a/x.ts', 'x.ts'), '[x.ts](./a/x.ts)')
  assert.equal(buildFileMentionMarkdown('src/lib', 'lib', 'directory'), '[lib](./src/lib/)')
  assert.equal(buildFileMentionMarkdown('/abs/x.ts', 'x.ts'), '[x.ts](/abs/x.ts)', '绝对路径不再补 ./')
  assert.equal(buildFileMentionMarkdown('a/[x].ts', '[x].ts'), '[\\[x\\].ts](./a/[x].ts)')
  assert.equal(buildSkillMentionMarkdown('code-review'), '$code-review')
  assert.equal(buildSubagentMentionMarkdown('explore'), '@explore')
  assert.equal(buildSessionMentionMarkdown('sess_1'), '#sess_1')
  assert.equal(buildSessionMentionMarkdown('sess_1', '我的会话'), '[#我的会话](#sess_1)')
  assert.equal(buildSessionMentionMarkdown('sess_1', 'sess_1'), '#sess_1', '标题就是 id 时退回裸标记')
  assert.equal(buildPluginMentionMarkdown('my-plugin', 'my-plugin@mkt'), '[@my-plugin](plugin://my-plugin@mkt)')
})

test('显示名：从 markdown 链接取 label，再按分类剥掉前导触发符', () => {
  assert.equal(normalizePromptMentionDisplayLabel('files', '[x.ts](./a/x.ts)', 'a/x.ts'), 'x.ts')
  assert.equal(normalizePromptMentionDisplayLabel('skills', '$code-review', 'code-review'), 'code-review')
  assert.equal(normalizePromptMentionDisplayLabel('sessions', '#sess_1', 'sess_1'), 'sess_1')
  assert.equal(normalizePromptMentionDisplayLabel('subagents', '@explore', 'explore'), 'explore')
  assert.equal(normalizePromptMentionDisplayLabel('commands', '/init', 'init'), '/init', '命令不去斜杠')
  assert.equal(normalizePromptMentionDisplayLabel('files', '   ', 'fallback'), 'fallback')
})

test('App 命令建议的 id 前缀固定', () => {
  assert.equal(
    filterPromptMenuSuggestions(
      [{ id: 'app-slash:side', trigger: '/', value: 'side', label: '/side', description: '' }],
      'side',
    ).length,
    1,
  )
})

// ── ⑨ + 菜单（按钮触发的那个）────────────────────────────────────────────

test('快捷命令规格：goal / workflow 两条，各带 id / 文案键 / 图标', () => {
  assert.deepEqual(Object.keys(ACTION_MENU_QUICK_COMMANDS).sort(), ['goal', 'workflow'])
  assert.equal(ACTION_MENU_QUICK_COMMANDS.goal.id, 'add-goal')
  assert.equal(ACTION_MENU_QUICK_COMMANDS.goal.labelKey, 'chat.goalBanner.label')
  assert.equal(ACTION_MENU_QUICK_COMMANDS.goal.icon, 'GoalIcon')
  assert.equal(ACTION_MENU_QUICK_COMMANDS.workflow.id, 'add-workflow')
  assert.equal(ACTION_MENU_QUICK_COMMANDS.workflow.labelKey, 'chat.composer.addWorkflow')
  assert.equal(ACTION_MENU_QUICK_COMMANDS.workflow.icon, 'Workflow')
})

test('底部三个触发词提示固定为 @ / $', () => {
  assert.deepEqual(
    ACTION_MENU_FOOTER_TRIGGERS.map(t => t.trigger),
    ['@', '/', '$'],
  )
  assert.deepEqual(
    ACTION_MENU_FOOTER_TRIGGERS.map(t => t.labelKey),
    ['chat.composer.contextShortcut', 'chat.composer.capabilityShortcut', 'chat.composer.skillShortcut'],
  )
})

test('快捷命令可用性：只在空草稿提供；goal 还要新会话，workflow 还要 CLI 有它', () => {
  const base = { emptyDraft: true, sessionId: null, slashCommandNames: ['workflow'] }
  assert.deepEqual([...actionMenuQuickCommands(base)], ['goal', 'workflow'])
  assert.deepEqual([...actionMenuQuickCommands({ ...base, emptyDraft: false })], [], '非空草稿一条都不给')
  assert.deepEqual([...actionMenuQuickCommands({ ...base, sessionId: 's1' })], ['workflow'], 'goal 只给新会话')
  assert.deepEqual([...actionMenuQuickCommands({ ...base, slashCommandNames: [] })], ['goal'], 'catalog 没有 workflow 就不给')
  assert.deepEqual(
    [...actionMenuQuickCommands({ ...base, excludedNames: ['goal'] })],
    ['workflow'],
    '被 excluded 的快捷命令不提供',
  )
  assert.deepEqual([...actionMenuQuickCommands({ ...base, slashCommandNames: ['/workflow'] })], ['goal', 'workflow'], '前导斜杠归一后仍算有')
})

test('+ 菜单索引落点：附件占第 0 位，其后是快捷命令，再是提及候选', () => {
  const options = { hasAttachment: true, quickCommands: ['goal', 'workflow'], mentionItemCount: 2 }
  assert.deepEqual(actionMenuSelectTarget(0, options), { kind: 'attachment' })
  assert.deepEqual(actionMenuSelectTarget(1, options), { kind: 'command', command: 'goal' })
  assert.deepEqual(actionMenuSelectTarget(2, options), { kind: 'command', command: 'workflow' })
  assert.deepEqual(actionMenuSelectTarget(3, options), { kind: 'mention', itemIndex: 0 })
  assert.deepEqual(actionMenuSelectTarget(4, options), { kind: 'mention', itemIndex: 1 })
  assert.equal(actionMenuSelectTarget(5, options), null, '越界给 null')

  const noAttachment = { hasAttachment: false, quickCommands: [], mentionItemCount: 1 }
  assert.deepEqual(actionMenuSelectTarget(0, noAttachment), { kind: 'mention', itemIndex: 0 })
})

// ── ⑩ 与 agentCommands.ts 的分工 ─────────────────────────────────────────

test('本模块不登记命令表：五条命令仍在 agentCommands.ts，这里只给命令值归一', async () => {
  const commands = await import('../src/agentCommands.ts')
  assert.equal(commands.AGENT_COMMANDS.length, 5, '命令表在 agentCommands.ts，本模块不重复登记')
  const exported = Object.keys(await import('../src/agentPromptMenu.ts'))
  for (const forbidden of ['AGENT_COMMANDS', 'AgentCommand', 'parseAgentCommand', 'matchAgentCommands', 'commandUsageHint']) {
    assert.ok(!exported.includes(forbidden), `本模块不该导出 ${forbidden}（那是 agentCommands.ts 的职责）`)
  }
})
