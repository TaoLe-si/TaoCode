// `agent/skills` 判据：技能条目的形状、逐字段救、校验拦截、持久化往返、
// 展示折述（describeSkillEntry）、搜索过滤（filterSkills）。
//
// 判据锚点：
//   · ZCode `settingsPageConfig.ts:100-105`     —— 这一节存在，id `skill`、图标 WandSparkles
//   · ZCode `SkillsSection.tsx`                 —— 列表行与详情弹窗真实展示的字段
//   · ZCode `packages/shared/src/skills-types.ts` —— `SkillSummary` / `SkillScope` / `SkillMetadata`
//   · ZCode `pluginManagedResourceGroups.ts:143-174` —— 搜索匹配与空查询语义
//   · ZCode `i18n/locales/zh-CN.ts:3473-3592`  —— 节标题、字段标签与回落文案
// 以及本仓实测：`Get-ChildItem C:\Users\Administrator\.minimax\skills -Recurse -Depth 1`
// 与各 `SKILL.md` frontmatter / `_meta.json`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_BUILTIN_SKILL_ROOT,
  AGENT_SKILL_INJECTION_UNKNOWN,
  AGENT_SKILL_NO_DESCRIPTION,
  AGENT_SKILLS_STORAGE_KEY,
  defaultAgentSkillsSettings,
  describeSkillEntry,
  filterSkills,
  isSkillPathWithinRoot,
  loadAgentSkillsSettings,
  normalizeAgentSkillsSettings,
  saveAgentSkillsSettings,
  validateAgentSkillsSettings,
} from '../src/agentSkills.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 造一条能通过校验的技能，测试里只在要改某一个字段时覆盖它。 */
function skill(overrides = {}) {
  return {
    id: 's-1',
    name: 'my-skill',
    description: '一个技能',
    source: 'user',
    enabled: true,
    path: 'C:\\Users\\Administrator\\.taocode\\skills\\my-skill',
    injected: null,
    version: '1.0.0',
    slug: '',
    publishedAt: '',
    pluginName: '',
    ...overrides,
  }
}

test('出厂默认 = 宿主自带技能目录里实测到的那三条（不是照抄 ZCode 清单）', () => {
  const settings = defaultAgentSkillsSettings()
  assert.equal(settings.entries.length, 3, '实测：Get-ChildItem ~/.minimax/skills 只有 3 个目录，每个一个 SKILL.md')
  assert.deepEqual(
    settings.entries.map((entry) => entry.id),
    ['ai-coder', 'ponytail', 'ui-design-master'],
    '逐条取自目录名；D:\\TaoCode\\.agents 不存在（Test-Path 为 False），故没有项目级技能'
  )
  for (const entry of settings.entries) {
    assert.equal(entry.source, 'builtin', '这三条都来自宿主自带目录')
    assert.equal(entry.enabled, true, '出厂默认启用（这是本仓存的偏好，不是运行态判定）')
    assert.ok(entry.path.startsWith(AGENT_BUILTIN_SKILL_ROOT), `${entry.id} 的路径应在内置根下`)
  }
  // 阳性对照：出厂默认本身必须零校验问题，否则主代理一进来就看到一堆红字。
  assert.deepEqual(validateAgentSkillsSettings(settings), [], '出厂默认必须零校验问题')
})

test('内置清单里的三条真实细节：名字带空格、描述真的为空、版本来自 _meta.json', () => {
  const byId = Object.fromEntries(defaultAgentSkillsSettings().entries.map((entry) => [entry.id, entry]))
  // 真去读文件才会撞到的三条：
  assert.equal(byId['ui-design-master'].name, 'UI Design Master', 'frontmatter 的 name 带空格且大小写不同，目录名才是 ui-design-master')
  assert.equal(byId['ui-design-master'].version, '1.0.0', '来自 _meta.json 的 "1.0.0"')
  assert.equal(byId['ui-design-master'].publishedAt, '2026-03-20T08:15:34.672Z', '由 _meta.json 的 updated_at 转 ISO（SkillsSection.tsx:73-82 同口径）')
  assert.equal(byId['ai-coder'].version, '1.0.0')
  assert.equal(byId['ai-coder'].publishedAt, '2026-03-20T07:12:40.768Z')
  // ponytail 的 frontmatter `description:` 后面没有值，且没有 _meta.json —— 空就是空。
  assert.equal(byId.ponytail.description, '', '描述是真空的，不替它编一句')
  assert.equal(byId.ponytail.version, '', '没有 _meta.json → 版本空串')
  assert.equal(byId.ponytail.publishedAt, '', '没有 _meta.json → 发布时间空串')
})

test('内置条目的描述是从 frontmatter 逐字取的真内容（阳性对照：不是占位串）', () => {
  const byId = Object.fromEntries(defaultAgentSkillsSettings().entries.map((entry) => [entry.id, entry]))
  assert.ok(byId['ai-coder'].description.startsWith('一站式全栈开发专家（Full-stack development expert）。'),
    'ai-coder 的描述逐字取自 SKILL.md frontmatter')
  assert.match(byId['ai-coder'].description, /Trigger keywords: 全栈开发/, '含 frontmatter 里的 Trigger keywords 段')
  assert.ok(byId['ui-design-master'].description.startsWith('专业的UI/UX设计专家技能。'),
    'ui-design-master 的描述逐字取自 SKILL.md frontmatter')
  assert.match(byId['ui-design-master'].description, /Tailwind CSS/, '含 frontmatter 里的触发关键词尾段')
  // ponytail 回落：渲染期回落，不写回数据（SkillsSection.tsx:613-618）。
  assert.equal(describeSkillEntry(byId.ponytail).description, AGENT_SKILL_NO_DESCRIPTION, '空描述渲染成「暂无描述」')
  assert.equal(AGENT_SKILL_NO_DESCRIPTION, '暂无描述', '逐字对照 zh-CN.ts:3481')
})

test('「参与注入」一律 null（未接入），不许退成 false 假装已判定', () => {
  for (const entry of defaultAgentSkillsSettings().entries) {
    assert.equal(entry.injected, null, `${entry.id} 的注入状态是"未知"，不是 false`)
  }
  // 阳性对照：用户自己拨过的开关是真值，null 与 false 必须区分得开。
  assert.equal(normalizeAgentSkillsSettings({ entries: [{ injected: true }] }).entries[0].injected, true)
  assert.equal(normalizeAgentSkillsSettings({ entries: [{ injected: false }] }).entries[0].injected, false)
  assert.equal(normalizeAgentSkillsSettings({ entries: [{ injected: 'yes' }] }).entries[0].injected, null, '非布尔退 null，不退 false')
  assert.equal(describeSkillEntry({ injected: null }).injectedLabel, AGENT_SKILL_INJECTION_UNKNOWN)
  assert.equal(describeSkillEntry({ injected: true }).injectedLabel, '参与注入')
  assert.equal(describeSkillEntry({ injected: false }).injectedLabel, '不参与注入')
})

test('坏存档逐字段救：缺键补默认、错类型退默认、时间非法退空串', () => {
  const saved = normalizeAgentSkillsSettings({
    entries: [{
      name: '  ',
      description: 42,
      source: '外星',
      enabled: '是',
      path: 7,
      injected: 'maybe',
      version: null,
      slug: undefined,
      publishedAt: '不是时间',
      pluginName: 1,
    }],
  })
  assert.equal(saved.entries.length, 1, '有救的条目不丢')
  const entry = saved.entries[0]
  assert.equal(entry.id, 'skill-1', '缺 id 且缺 path 时补生成 id')
  assert.equal(entry.name, 'skill-1', '空名退回 id，不留空串')
  assert.equal(entry.description, '', '数字不是描述')
  assert.equal(entry.source, 'user', '非法来源退 user')
  assert.equal(entry.enabled, true, '错类型退默认（默认启用）')
  assert.equal(entry.path, '', '数字不是路径')
  assert.equal(entry.injected, null, '非布尔退 null')
  assert.equal(entry.version, '')
  assert.equal(entry.slug, '')
  assert.equal(entry.publishedAt, '', '非法时间退空串而不是 Invalid Date（SkillsSection.tsx:73-82 同口径）')
  assert.equal(entry.pluginName, '')
})

test('publishedAt 归一化：epoch 毫秒与 ISO 串都收，非法退空串', () => {
  const fromEpoch = normalizeAgentSkillsSettings({ entries: [{ publishedAt: 1773990760768 }] }).entries[0]
  assert.equal(fromEpoch.publishedAt, '2026-03-20T07:12:40.768Z')
  const fromIso = normalizeAgentSkillsSettings({ entries: [{ publishedAt: '2026-03-20T07:12:40.768Z' }] }).entries[0]
  assert.equal(fromIso.publishedAt, '2026-03-20T07:12:40.768Z', 'ISO 串原样往返')
  assert.equal(normalizeAgentSkillsSettings({ entries: [{ publishedAt: '垃圾' }] }).entries[0].publishedAt, '')
  assert.equal(normalizeAgentSkillsSettings({ entries: [{ publishedAt: '' }] }).entries[0].publishedAt, '')
  assert.equal(normalizeAgentSkillsSettings({ entries: [{}] }).entries[0].publishedAt, '', '缺键退空串')
})

test('坏存档不按字段数量判损坏：只有 1 个键的条目照样救回来（本仓铁律）', () => {
  const saved = normalizeAgentSkillsSettings({ entries: [{ name: '只有一个键' }] })
  assert.equal(saved.entries.length, 1, '不能因为字段少就判定损坏并丢弃 —— 历史上真出过把用户锁在项目外的事故')
  assert.equal(saved.entries[0].name, '只有一个键')
  // 阴性对照：非对象条目确实被丢掉。
  const withJunk = normalizeAgentSkillsSettings({
    entries: ['字符串', 42, null, [{ name: '数组' }], { name: '好的' }],
  })
  assert.equal(withJunk.entries.length, 1, '垃圾条目只丢自己')
  assert.equal(withJunk.entries[0].name, '好的')
  // 顶层不是对象 / entries 键坏掉 → 退回出厂默认（连内置三条一起回来）。
  assert.equal(normalizeAgentSkillsSettings(null).entries.length, 3)
  assert.equal(normalizeAgentSkillsSettings('垃圾').entries.length, 3)
  assert.equal(normalizeAgentSkillsSettings({ entries: '不是数组' }).entries.length, 3, 'entries 不是数组时退回默认')
  // 空数组是用户自己存的"我不要了"，尊重它，不偷偷塞回内置条目。
  assert.equal(normalizeAgentSkillsSettings({ entries: [] }).entries.length, 0, '空数组照实，不塞回内置')
})

test('校验拦下空名', () => {
  const problems = validateAgentSkillsSettings({ entries: [skill({ name: '   ' })] })
  assert.equal(problems.length, 1, `应恰好一条：${JSON.stringify(problems)}`)
  assert.match(problems[0], /技能名不能为空/)
  // 阳性对照：有名字就干净 —— 证明上面那条不是因为别的字段坏了才命中。
  assert.deepEqual(validateAgentSkillsSettings({ entries: [skill()] }), [])
})

test('校验拦下重名（ZCode 导入时以「同名已存在」跳过，本仓直接当错误）', () => {
  const dup = validateAgentSkillsSettings({ entries: [skill(), skill({ id: 's-2' })] })
  assert.equal(dup.length, 1, `重名应恰好一条：${JSON.stringify(dup)}`)
  assert.match(dup[0], /「my-skill」重复/)
  // 阳性对照：不同名放行。
  assert.deepEqual(validateAgentSkillsSettings({ entries: [skill(), skill({ id: 's-2', name: 'other' })] }), [])
})

test('校验拦下路径越界：内置条目必须落在内置根内', () => {
  const escaped = validateAgentSkillsSettings({
    entries: [skill({ id: 'b', name: '越界的内置', source: 'builtin', path: 'C:\\Windows\\System32\\evil' })],
  })
  assert.equal(escaped.length, 1, `应恰好一条：${JSON.stringify(escaped)}`)
  assert.match(escaped[0], /不在/)
  assert.match(escaped[0], /内置/)
  // 阳性对照：同一个路径但声明成 user 就不受内置根约束（那是用户自己的目录）。
  assert.deepEqual(
    validateAgentSkillsSettings({ entries: [skill({ path: 'C:\\Windows\\System32\\evil' })] }),
    [],
    '非 builtin 来源不受内置根约束'
  )
  // 内置根下的真实路径放行。
  assert.deepEqual(
    validateAgentSkillsSettings({ entries: [skill({ source: 'builtin', path: `${AGENT_BUILTIN_SKILL_ROOT}\\ai-coder` })] }),
    [],
    '内置根下的路径合法'
  )
})

test('校验拦下 .. 段与非绝对路径', () => {
  const dotDot = validateAgentSkillsSettings({ entries: [skill({ path: 'C:\\Users\\Administrator\\.taocode\\skills\\..\\..\\Windows' })] })
  assert.equal(dotDot.length, 1)
  assert.match(dotDot[0], /\.{2}/, '文案要点明 .. 段')
  const relative = validateAgentSkillsSettings({ entries: [skill({ path: 'skills/my-skill' })] })
  assert.equal(relative.length, 1)
  assert.match(relative[0], /绝对路径/)
  const empty = validateAgentSkillsSettings({ entries: [skill({ path: '  ' })] })
  assert.equal(empty.length, 1)
  assert.match(empty[0], /目录路径/)
  // 阳性对照：正斜杠的绝对路径（POSIX 形）也认。
  assert.deepEqual(validateAgentSkillsSettings({ entries: [skill({ path: '/home/u/skills/s' })] }), [])
  assert.deepEqual(validateAgentSkillsSettings({ entries: [skill({ path: 'D:\\x\\skills\\s' })] }), [], '盘符绝对路径放行')
})

test('isSkillPathWithinRoot 认大小写与分隔符差异，不把前缀相同的兄弟目录算进去', () => {
  assert.equal(isSkillPathWithinRoot(`${AGENT_BUILTIN_SKILL_ROOT}\\ai-coder`, AGENT_BUILTIN_SKILL_ROOT), true)
  assert.equal(isSkillPathWithinRoot(AGENT_BUILTIN_SKILL_ROOT.toLowerCase(), AGENT_BUILTIN_SKILL_ROOT), true, 'Windows 大小写不敏感')
  assert.equal(isSkillPathWithinRoot('C:/Users/Administrator/.minimax/skills/x', AGENT_BUILTIN_SKILL_ROOT), true, '正斜杠等价')
  assert.equal(isSkillPathWithinRoot(AGENT_BUILTIN_SKILL_ROOT, AGENT_BUILTIN_SKILL_ROOT), true, '根本身算在内')
  // 阴性对照 + 阳性对照：前缀相同的兄弟目录必须判为越界。
  assert.equal(isSkillPathWithinRoot(`${AGENT_BUILTIN_SKILL_ROOT}x`, AGENT_BUILTIN_SKILL_ROOT), false, 'skillsx 不在 skills 内')
  assert.equal(isSkillPathWithinRoot('C:\\Windows', AGENT_BUILTIN_SKILL_ROOT), false)
  assert.equal(isSkillPathWithinRoot('', AGENT_BUILTIN_SKILL_ROOT), false, '空路径不是合法路径')
  assert.equal(isSkillPathWithinRoot('C:\\x', ''), false, '空根不匹配任何东西')
})

test('describeSkillEntry 折出 ZCode 真实展示的字段', () => {
  const described = describeSkillEntry(skill({ name: 'ui-design-master', source: 'builtin', version: '1.0.0', slug: 'uds', publishedAt: '2026-03-20T08:15:34.672Z' }))
  assert.equal(described.name, 'ui-design-master')
  assert.equal(described.description, '一个技能', '有描述时原样用')
  assert.equal(described.sourceLabel, '内置', 'builtin 档（本仓新增，ZCode 无对应文案）')
  assert.equal(described.enabledLabel, '已启用', '逐字对照 zh-CN.ts:3588')
  assert.equal(described.version, '1.0.0')
  assert.equal(described.slug, 'uds')
  assert.equal(described.publishedAt, '2026-03-20T08:15:34.672Z')
  assert.equal(described.toggleable, true, '非 plugin 档可开关')
  // 阴性对照 + 阳性对照：来源标签三档各不相同，不是同一句。
  assert.equal(describeSkillEntry(skill({ source: 'user' })).sourceLabel, '个人', 'zh-CN.ts:3590')
  assert.equal(describeSkillEntry(skill({ source: 'plugin' })).sourceLabel, '插件', 'zh-CN.ts:3591')
  assert.equal(describeSkillEntry(skill({ source: 'workspace' })).sourceLabel, '项目', 'zh-CN.ts:3592')
  assert.equal(describeSkillEntry(skill({ enabled: false })).enabledLabel, '已停用', '逐字对照 zh-CN.ts:3589')
})

test('plugin 档没有开关与删除入口（照 SkillsSection.tsx:621-641 的三元）', () => {
  assert.equal(describeSkillEntry(skill({ source: 'plugin' })).toggleable, false, 'plugin 档由卸载插件管理，不给开关')
  for (const source of ['builtin', 'user', 'workspace']) {
    assert.equal(describeSkillEntry(skill({ source })).toggleable, true, `${source} 档可开关`)
  }
})

test('describeSkillEntry 对垃圾输入不抛（先过一遍单条归一化）', () => {
  for (const raw of [undefined, null, '垃圾', 42, [], {}]) {
    const described = describeSkillEntry(raw)
    assert.equal(described.name, 'skill-1', '垃圾输入也要折出一条合法形状')
    assert.equal(described.description, AGENT_SKILL_NO_DESCRIPTION, '无描述回落「暂无描述」')
    assert.equal(described.injected, null, '注入状态未知')
    assert.equal(described.toggleable, true)
  }
})

test('filterSkills 空查询返回全部（照 normalizedQueryMatches 的空查询分支）', () => {
  const entries = defaultAgentSkillsSettings().entries
  assert.equal(filterSkills(entries, '').length, 3, '空串 → 全部')
  assert.equal(filterSkills(entries, '   ').length, 3, '纯空白 → 全部（先 trim）')
  assert.equal(filterSkills(entries, undefined).length, 3, '非字符串查询不炸，当空查询')
  // 阳性对照：非空查询确实会过滤 —— 证明上面那三条不是"永远返回全部"。
  assert.ok(filterSkills(entries, 'ponytail').length < 3)
})

test('filterSkills 无命中返回空数组（对应 ZCode 的 hasEmptySearchResult 分支）', () => {
  const entries = defaultAgentSkillsSettings().entries
  // SkillsSection.tsx:491 `hasEmptySearchResult = Boolean(query.trim()) && filteredSkillCount === 0`
  assert.deepEqual(filterSkills(entries, '根本不存在的技能名'), [])
  assert.deepEqual(filterSkills(entries, 'zzz'), [])
  assert.deepEqual(filterSkills([], 'ponytail'), [], '空列表 + 有查询 → 仍是空')
  assert.deepEqual(filterSkills(null, 'ponytail'), [], '列表不是数组也不抛')
  assert.deepEqual(filterSkills(undefined, ''), [], '两个都是垃圾 → 空数组而不是抛异常')
})

test('filterSkills 命中 name / description / pluginName 任一，且大小写不敏感', () => {
  const entries = [
    skill({ id: 'a', name: 'Alpha', description: '写代码' }),
    skill({ id: 'b', name: 'beta', description: '设计界面' }),
    skill({ id: 'c', name: 'gamma', description: '', pluginName: 'my-plugin' }),
  ]
  assert.deepEqual(filterSkills(entries, 'alpha').map((e) => e.id), ['a'], '按 name 命中')
  assert.deepEqual(filterSkills(entries, 'ALPHA').map((e) => e.id), ['a'], '转小写后命中（大小写不敏感）')
  assert.deepEqual(filterSkills(entries, '  alpha  ').map((e) => e.id), ['a'], '先 trim 再匹配')
  assert.deepEqual(filterSkills(entries, '设计').map((e) => e.id), ['b'], '按 description 命中（中文子串）')
  assert.deepEqual(filterSkills(entries, 'my-plugin').map((e) => e.id), ['c'], '按 pluginName 命中（pluginManagedResourceGroups.ts:164）')
  assert.deepEqual(filterSkills(entries, 'Gamma').map((e) => e.id), ['c'], '第 3 条也能按 name 命中，不只是靠 pluginName')
  // 过滤不改动原数组。
  assert.equal(entries.length, 3)
})

test('存储往返：写入的键名与内容都对，读回是同一份', () => {
  const storage = createMemoryStorage()
  const settings = defaultAgentSkillsSettings()
  settings.entries.push(skill({ id: 'user-1', name: 'my-skill' }))
  settings.entries[0].enabled = false
  assert.equal(saveAgentSkillsSettings(settings, storage), true, '存得下要返回 true')
  const dump = storage.dump()
  assert.deepEqual(Object.keys(dump), [AGENT_SKILLS_STORAGE_KEY], `只写自己的键，实际：${Object.keys(dump).join(',')}`)
  assert.equal(AGENT_SKILLS_STORAGE_KEY, 'taocode.agent.skills', '与 taocode.agent.settings 同一族')
  const written = JSON.parse(dump[AGENT_SKILLS_STORAGE_KEY])
  assert.equal(written.entries.length, 4)
  assert.equal(written.entries[0].enabled, false, '停用状态真的落盘了')
  assert.equal(written.entries[0].injected, null, '注入状态"未知"也要落盘，不能落成 false')
  const loaded = loadAgentSkillsSettings(storage)
  assert.deepEqual(loaded.entries, settings.entries, '读回逐字段相同')
})

test('存储不可用时静默降级：返回合法默认值、写入返回 false，绝不抛', () => {
  assert.deepEqual(loadAgentSkillsSettings(null), defaultAgentSkillsSettings(), '无存储 → 出厂默认')
  assert.equal(saveAgentSkillsSettings(defaultAgentSkillsSettings(), null), false, '无存储 → 只丢持久化')
  const throwing = createThrowingStorage()
  assert.doesNotThrow(() => loadAgentSkillsSettings(throwing), 'getItem 抛异常必须被兜住')
  assert.deepEqual(loadAgentSkillsSettings(throwing), defaultAgentSkillsSettings(), '读路径也退回默认值')
  assert.equal(saveAgentSkillsSettings(defaultAgentSkillsSettings(), throwing), false, 'setItem 抛异常时返回 false')
  // 坏 JSON 走同一条降级路径。
  assert.deepEqual(
    loadAgentSkillsSettings(createMemoryStorage({ [AGENT_SKILLS_STORAGE_KEY]: '{不是 JSON' })),
    defaultAgentSkillsSettings(),
    '存档不是 JSON 时退回默认值，不把用户锁在外面'
  )
})
