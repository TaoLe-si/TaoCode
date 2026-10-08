// ZCode「记忆」节（section id `memory`）判据 —— 目录形状、清单、读正文、搜索、条数、时间。
//
// 判据里引的 ZCode 出处都能在 `.tools/ZCode` 指到：
//   · packages/services/src/memory/memory.ts:8-22    清单形状
//   · packages/services/src/memory/memory.ts:24-33   IMemoryService 只有 list/read（无删除无写入）
//   · packages/services/src/memory/memoryService.ts:11-12  MEMORY.md / memory
//   · packages/services/src/memory/memoryService.ts:23-44  路径段与文件名校验、label 还原
//   · packages/services/src/memory/memoryService.ts:102-110 文件排序
//   · packages/services/src/memory/memoryService.ts:113-199 清单（跳空工作区/排序）
//   · packages/services/src/memory/memoryService.ts:201-232 读文件
//   · packages/services/src/memory/projectMemoryStableRead.ts:8,38,48-53,86-97 5 MiB 与两个错误码
//   · packages/ui/src/settings/MemorySettingsViewer.tsx:52-58  条数文案
//   · packages/ui/src/settings/MemorySettingsViewer.tsx:59-66  搜索过滤
//   · packages/ui/src/settings/MemorySettingsSection.tsx:15-40,104-125 显示名 slug / 顺序
//   · packages/ui/src/settings/memoryUpdatedAt.ts:62-120  更新时间分支
//   · packages/ui/src/i18n/locales/zh-CN.ts:2012-2051,3702  文案原文
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_MEMORY_STORE_STORAGE_KEY,
  MEMORY_SETTINGS_TEXT,
  PROJECT_MEMORY_DIRECTORY_NAME,
  PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
  PROJECT_MEMORY_INDEX_FILE_NAME,
  PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE,
  PROJECT_MEMORY_PREVIEW_MAX_BYTES,
  buildWorkspaceDisplayNameMap,
  compareProjectMemoryFiles,
  defaultMemoryFormatMessage,
  deriveMemoryFilePath,
  filterMemoryFiles,
  formatMemoryCount,
  formatMemoryUpdatedAt,
  isProjectMemoryFileName,
  isValidMemoryPathSegment,
  listProjectMemories,
  loadMemoryCatalog,
  memoryFileByteSize,
  memoryText,
  normalizeMemoryCatalog,
  normalizeWorkspaceDisplayName,
  orderMemoryWorkspaces,
  readProjectMemoryFile,
  resolveWorkspaceLabel,
  saveMemoryCatalog,
} from '../src/agentMemoryStore.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 逐次返回不同 payload 的存储：用来触发「读取期间文件已变」。 */
function createSequencedStorage(payloads) {
  let index = 0
  return {
    getItem() {
      const value = payloads[Math.min(index, payloads.length - 1)]
      index += 1
      return value === undefined ? null : JSON.stringify(value)
    },
    setItem() {},
  }
}

const WORKSPACE_A = 'taocode-0123456789abcdef'
const WORKSPACE_B = 'other-ffffffffffffffff'

function catalogOf(...workspaces) {
  return { workspaces }
}

test('存储键与 ZCode 常量逐字对齐', () => {
  assert.equal(AGENT_MEMORY_STORE_STORAGE_KEY, 'taocode.agent.memoryStore')
  // memoryService.ts:11-12
  assert.equal(PROJECT_MEMORY_INDEX_FILE_NAME, 'MEMORY.md')
  assert.equal(PROJECT_MEMORY_DIRECTORY_NAME, 'memory')
  // projectMemoryStableRead.ts:8
  assert.equal(PROJECT_MEMORY_PREVIEW_MAX_BYTES, 5 * 1024 * 1024)
  // memory.ts:4-6
  assert.equal(PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE, 'PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED')
  assert.equal(PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE, 'PROJECT_MEMORY_FILE_CHANGED')
})

test('文案逐字取自 zh-CN.ts:2012-2051,3702（含任务点名的那些）', () => {
  // 逐个键断言原文，改一个字就红
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory'], '记忆')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.workspaceMemory'], '工作区记忆')
  assert.equal(
    MEMORY_SETTINGS_TEXT['settings.memoryDescription'],
    '在工作区中保存并复用长期上下文，新会话生效。开启后可能增加模型调用和 Token 成本。',
  )
  assert.equal(
    MEMORY_SETTINGS_TEXT['settings.memory.viewer.localOnly'],
    '记忆详情仅支持在本地桌面端查看，请前往本地桌面端的“记忆”设置。',
  )
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.title'], '已保存的工作区记忆')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.description'], '查看此设备上按工作区保存的记忆。')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.projectsDescription'], '选择一个项目，查看该项目保存的全部记忆。')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.refresh'], '刷新')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.loading'], '正在加载记忆…')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.empty'], '暂无已保存的工作区记忆')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.workspaces'], '工作区')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.files'], '文件')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.searchPlaceholder'], '搜索记忆文件…')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.searchEmpty'], '没有匹配的记忆文件。')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.workspaceSearchPlaceholder'], '搜索工作区…')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.workspaceSearchEmpty'], '没有匹配的工作区。')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.itemCount.one'], '{count} 条')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.itemCount.other'], '{count} 条')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.memoryCount.one'], '{count} 条记忆')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.memoryCount.other'], '{count} 条记忆')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.justNow'], '刚刚')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.minutesAgo'], '{count} 分钟前')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.today'], '今天 {time}')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.yesterday'], '昨天 {time}')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.weekday'], '{weekday} {time}')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.weekdayZh'], '周{weekday}')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.date'], '{date} {time}')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.dateMonthDay'], '{month} 月 {day} 日')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.updated.dateYearMonthDay'], '{year} 年 {month} 月 {day} 日')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.tree'], '记忆文件')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.indexMissing'], 'MEMORY.md（未生成）')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.collapse'], '收起记忆条目')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.expand'], '展开记忆条目')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.fileLoading'], '正在加载文件…')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.fileDeleted'], '该记忆文件已被删除，请刷新文件列表。')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.fileTooLarge'], '该记忆文件超过 5 MiB 预览上限。')
  assert.equal(
    MEMORY_SETTINGS_TEXT['settings.memory.viewer.fileChanged'],
    '该记忆文件在读取期间已更新，请重新打开或刷新文件列表。',
  )
  assert.equal(MEMORY_SETTINGS_TEXT['settings.memory.viewer.noSelection'], '选择一个记忆文件以查看内容。')
  assert.equal(MEMORY_SETTINGS_TEXT['settings.search.clear'], '清空搜索')
  // memoryText 是同一张表的读取口
  assert.equal(memoryText('settings.memory.viewer.files'), '文件')
  assert.equal(memoryText('settings.search.clear'), '清空搜索')
})

test('路径段与文件名校验照 memoryService.ts:23-39', () => {
  assert.equal(isValidMemoryPathSegment('memory'), true)
  assert.equal(isValidMemoryPathSegment('a.b-c_d'), true)
  assert.equal(isValidMemoryPathSegment(''), false)
  assert.equal(isValidMemoryPathSegment('.'), false)
  assert.equal(isValidMemoryPathSegment('..'), false)
  assert.equal(isValidMemoryPathSegment('a/b'), false)
  assert.equal(isValidMemoryPathSegment('a\\b'), false)
  // 文件名白名单：MEMORY.md 或除它以外的 *.md
  assert.equal(isProjectMemoryFileName('MEMORY.md'), true)
  assert.equal(isProjectMemoryFileName('workflow.md'), true)
  assert.equal(isProjectMemoryFileName('notes.txt'), false)
  assert.equal(isProjectMemoryFileName('MEMORY.MD'), false)
  assert.equal(isProjectMemoryFileName(''), false)
})

test('工作区标签剥掉尾部 16 位 hex（memoryService.ts:41-44）', () => {
  assert.equal(resolveWorkspaceLabel(WORKSPACE_A), 'taocode')
  assert.equal(resolveWorkspaceLabel('My-Project-abcdef0123456789'), 'My-Project')
  // 后缀不匹配时原样返回
  assert.equal(resolveWorkspaceLabel('taocode'), 'taocode')
  assert.equal(resolveWorkspaceLabel('taocode-0123456789abcde'), 'taocode-0123456789abcde')
})

test('展示路径按 ZCode 布局推出（<id>/memory/<name>）', () => {
  assert.equal(deriveMemoryFilePath(WORKSPACE_A, 'MEMORY.md'), 'taocode-0123456789abcdef/memory/MEMORY.md')
})

test('文件排序：index 在前，其余按名称 en 排序（memoryService.ts:102-110）', () => {
  const files = [
    { name: 'zeta.md', path: '', kind: 'item', size: 0, updatedAt: 0 },
    { name: 'MEMORY.md', path: '', kind: 'index', size: 0, updatedAt: 0 },
    { name: 'alpha.md', path: '', kind: 'item', size: 0, updatedAt: 0 },
  ]
  files.sort(compareProjectMemoryFiles)
  assert.deepEqual(files.map(f => f.name), ['MEMORY.md', 'alpha.md', 'zeta.md'])
})

test('目录归一：垃圾条目只丢自己，同名/同工作区去重（坏档永不抛）', () => {
  const normalized = normalizeMemoryCatalog({
    workspaces: [
      '不是对象',
      { id: 'bad/id', files: [{ name: 'MEMORY.md', content: 'x' }] },
      { id: WORKSPACE_A, files: ['垃圾', { name: 'notes.txt' }, { name: 'MEMORY.md', content: '# A' }] },
      {
        id: WORKSPACE_A,
        files: [{ name: 'MEMORY.md', content: '重复工作区' }],
      },
      {
        id: WORKSPACE_B,
        files: [
          { name: 'MEMORY.md', content: '# B', updatedAt: '不是数字' },
          { name: 'MEMORY.md', content: '同名第二条' },
          { name: 'workflow.md', content: 42 },
        ],
      },
    ],
  })
  // 坏 id 与非法文件名被丢掉；WORKSPACE_A 只留第一条
  assert.deepEqual(normalized.workspaces.map(w => w.id), [WORKSPACE_A, WORKSPACE_B])
  assert.deepEqual(normalized.workspaces[0].files.map(f => f.name), ['MEMORY.md'])
  assert.equal(normalized.workspaces[0].files[0].content, '# A')
  // 同名文件只留第一条；content 非字符串退空串；updatedAt 非法退 0
  const b = normalized.workspaces[1].files
  assert.deepEqual(b.map(f => f.name), ['MEMORY.md', 'workflow.md'])
  assert.equal(b[0].content, '# B')
  assert.equal(b[0].updatedAt, 0)
  assert.equal(b[1].content, '')
})

test('归一永不抛：null/字符串/数组都退成空目录', () => {
  assert.deepEqual(normalizeMemoryCatalog(null), { workspaces: [] })
  assert.deepEqual(normalizeMemoryCatalog('坏档'), { workspaces: [] })
  assert.deepEqual(normalizeMemoryCatalog([]), { workspaces: [] })
  assert.deepEqual(normalizeMemoryCatalog({ workspaces: '不是数组' }), { workspaces: [] })
})

test('存档往返；无存储/抛存储静默降级（本仓铁律：不许抛）', () => {
  const storage = createMemoryStorage()
  assert.equal(
    saveMemoryCatalog(catalogOf({ id: WORKSPACE_A, files: [{ name: 'MEMORY.md', content: '# A', updatedAt: 1 }] }), storage),
    true,
  )
  const loaded = loadMemoryCatalog(storage)
  assert.deepEqual(loaded.workspaces.map(w => w.id), [WORKSPACE_A])
  assert.equal(loaded.workspaces[0].files[0].content, '# A')
  // 存储不可用：读退空目录、写返回 false
  assert.deepEqual(loadMemoryCatalog(null), { workspaces: [] })
  assert.deepEqual(loadMemoryCatalog(createThrowingStorage()), { workspaces: [] })
  assert.equal(saveMemoryCatalog(catalogOf(), createThrowingStorage()), false)
  assert.equal(saveMemoryCatalog(catalogOf(), null), false)
})

test('清单：跳空工作区、index 优先、工作区按 updatedAt 降序再 id 升序（memoryService.ts:182-197）', () => {
  const storage = createMemoryStorage({
    [AGENT_MEMORY_STORE_STORAGE_KEY]: JSON.stringify(
      catalogOf(
        { id: WORKSPACE_A, files: [{ name: 'zeta.md', content: 'z', updatedAt: 10 }, { name: 'MEMORY.md', content: 'a', updatedAt: 20 }] },
        { id: WORKSPACE_B, files: [] },
        { id: 'ccc-0000000000000000', files: [{ name: 'MEMORY.md', content: 'c', updatedAt: 20 }] },
        { id: 'aaa-0000000000000000', files: [{ name: 'MEMORY.md', content: 'x', updatedAt: 20 }] },
      ),
    ),
  })
  const workspaces = listProjectMemories(storage)
  // 空工作区 WORKSPACE_B 被跳过
  assert.equal(workspaces.some(w => w.id === WORKSPACE_B), false)
  // updatedAt 同为 20 时按 id 升序
  assert.deepEqual(workspaces.map(w => w.id), ['aaa-0000000000000000', 'ccc-0000000000000000', WORKSPACE_A])
  // label 由 id 还原
  assert.equal(workspaces[2].label, 'taocode')
  // 文件 index 优先
  assert.deepEqual(workspaces[2].files.map(f => f.name), ['MEMORY.md', 'zeta.md'])
  // kind 与 size（ZCode 取 mtimeMs 与 size）
  assert.equal(workspaces[2].files[0].kind, 'index')
  assert.equal(workspaces[2].files[1].kind, 'item')
  assert.equal(workspaces[2].files[0].size, 1)
  assert.equal(workspaces[2].updatedAt, 20, '工作区 updatedAt = 文件里最新那个')
})

test('size 按 UTF-8 字节数（中文一个字 3 字节）', () => {
  assert.equal(memoryFileByteSize('abc'), 3)
  assert.equal(memoryFileByteSize('记忆'), 6)
  assert.equal(memoryFileByteSize(''), 0)
})

test('搜索过滤逐字对齐 MemorySettingsViewer.tsx:59-66', () => {
  const files = [
    { name: 'MEMORY.md', path: '', kind: 'index', size: 0, updatedAt: 0 },
    { name: 'Workflow.md', path: '', kind: 'item', size: 0, updatedAt: 0 },
  ]
  // 空查询命中全部
  assert.equal(filterMemoryFiles(files, '').length, 2)
  assert.equal(filterMemoryFiles(files, '   ').length, 2)
  // 查询 trim + 小写；文件名也小写
  assert.deepEqual(filterMemoryFiles(files, '  workflow ').map(f => f.name), ['Workflow.md'])
  assert.deepEqual(filterMemoryFiles(files, 'memory').map(f => f.name), ['MEMORY.md'])
  assert.deepEqual(filterMemoryFiles(files, '没有这个'), [])
})

test('显示名 slug 与歧义 slug（MemorySettingsSection.tsx:15-40）', () => {
  assert.equal(normalizeWorkspaceDisplayName('My Project!'), 'my-project')
  assert.equal(normalizeWorkspaceDisplayName('  TaoCode  '), 'taocode')
  assert.equal(normalizeWorkspaceDisplayName(''), 'project')
  assert.equal(normalizeWorkspaceDisplayName('!!!'), 'project')
  assert.equal(normalizeWorkspaceDisplayName('a'.repeat(80)).length, 48)
  // slug 相同但显示名不同 ⇒ 整条删除
  const map = buildWorkspaceDisplayNameMap(['Tao Code', 'tao-code', 'Other'])
  assert.equal(map.has('tao-code'), false)
  assert.equal(map.get('other'), 'Other')
})

test('工作区排序：名单内按序、名单外排最后、label 换成显示名（MemorySettingsSection.tsx:104-125）', () => {
  const workspaces = [
    { id: WORKSPACE_A, label: 'taocode', updatedAt: 1, files: [] },
    { id: WORKSPACE_B, label: 'other', updatedAt: 2, files: [] },
    { id: 'zzz-0000000000000000', label: 'zzz', updatedAt: 3, files: [] },
  ]
  // 名单项的 slug 必须与工作区 label 的 slug 相同（'other' / 'taocode'）才会命中
  const ordered = orderMemoryWorkspaces(workspaces, ['Other', 'TaoCode'])
  // other 命中名单第 0 位、taocode 命中第 1 位，zzz 未命中排最后
  assert.deepEqual(ordered.map(w => w.id), [WORKSPACE_B, WORKSPACE_A, 'zzz-0000000000000000'])
  // 命中的 label 换成显示名
  assert.equal(ordered[0].label, 'Other')
  assert.equal(ordered[1].label, 'TaoCode')
  // 未命中保持原 label
  assert.equal(ordered[2].label, 'zzz')
})

test('条数文案照 MemorySettingsViewer.tsx:52-58', () => {
  assert.equal(formatMemoryCount(1), '1 条记忆')
  assert.equal(formatMemoryCount(0), '0 条记忆')
  assert.equal(formatMemoryCount(5), '5 条记忆')
  // 单复数两个 id 在 zh-CN 里同文（zh-CN.ts:2032-2033）
  assert.equal(
    formatMemoryCount(1, descriptor => descriptor.id),
    'settings.memory.viewer.memoryCount.one',
  )
  assert.equal(
    formatMemoryCount(2, descriptor => descriptor.id),
    'settings.memory.viewer.memoryCount.other',
  )
})

// 锚点：2026-01-07 是周三（本地时区）；下面各分支据此推导，不依赖运行时的「今天」。
const NOW = new Date(2026, 0, 7, 15, 0, 0).getTime()

test('更新时间逐分支对齐 memoryUpdatedAt.ts:62-120', () => {
  const zh = (updatedAt) => formatMemoryUpdatedAt({ locale: 'zh-CN', now: NOW, updatedAt })
  // 不足 1 分钟 / updatedAt 非有限值 ⇒ 刚刚（:66-69）
  assert.equal(zh(NOW - 30_000), '刚刚')
  assert.equal(zh(Number.NaN), '刚刚')
  // 30 分钟以内 ⇒ N 分钟前（:72-78）
  assert.equal(zh(NOW - 5 * 60_000), '5 分钟前')
  assert.equal(zh(NOW - 29 * 60_000), '29 分钟前')
  // 今天（:80-85）：h23 两位
  assert.equal(zh(new Date(2026, 0, 7, 9, 30, 0).getTime()), '今天 09:30')
  // 昨天（:87-91）
  assert.equal(zh(new Date(2026, 0, 6, 22, 0, 0).getTime()), '昨天 22:00')
  // 本周内（周一为一周之始，:93-101）：2026-01-05 是周一
  assert.equal(zh(new Date(2026, 0, 5, 8, 0, 0).getTime()), '周一 08:00')
  // 更早且跨年 ⇒ 带年（:103-120 + formatDate :41-56）
  assert.equal(zh(new Date(2025, 11, 31, 12, 0, 0).getTime()), '2025 年 12 月 31 日 12:00')
  // 更早但同年 ⇒ 不带年
  assert.equal(zh(new Date(2026, 0, 1, 10, 0, 0).getTime()), '1 月 1 日 10:00')
})

test('更新时间：非 zh-CN 走 Intl 日期分支（memoryUpdatedAt.ts:29-34,41-56）', () => {
  const text = formatMemoryUpdatedAt({
    locale: 'en-US',
    now: NOW,
    updatedAt: new Date(2025, 11, 31, 12, 0, 0).getTime(),
  })
  assert.equal(text.includes('2025'), true)
  assert.equal(text.includes('12:00'), true)
  assert.equal(text.includes('年'), false)
})

test('formatMessage 缺省实现只替换给定占位，缺键原样返回 id', () => {
  assert.equal(defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.today' }, { time: '09:30' }), '今天 09:30')
  assert.equal(defaultMemoryFormatMessage({ id: '不存在.键' }), '不存在.键')
  // 未提供的占位保持原样
  assert.equal(defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.date' }, { time: '10:00' }), '{date} 10:00')
})

test('读正文：正常路径返回 content 与 updatedAt', () => {
  const storage = createMemoryStorage({
    [AGENT_MEMORY_STORE_STORAGE_KEY]: JSON.stringify(
      catalogOf({ id: WORKSPACE_A, files: [{ name: 'workflow.md', content: 'Use the current project workflow.\n', updatedAt: 123 }] }),
    ),
  })
  const file = readProjectMemoryFile({ workspaceId: WORKSPACE_A, fileName: 'workflow.md' }, storage)
  assert.equal(file.content, 'Use the current project workflow.\n')
  assert.equal(file.updatedAt, 123)
})

test('读正文：非法路径段/文件名一律 EINVAL（memoryService.ts:205-211）', () => {
  const storage = createMemoryStorage()
  const cases = [
    { workspaceId: '../x', fileName: 'MEMORY.md' },
    { workspaceId: WORKSPACE_A, fileName: '../MEMORY.md' },
    { workspaceId: WORKSPACE_A, fileName: 'notes.txt' },
    { workspaceId: '', fileName: 'MEMORY.md' },
  ]
  for (const params of cases) {
    assert.throws(() => readProjectMemoryFile(params, storage), (error) => error.code === 'EINVAL')
  }
})

test('读正文：工作区/文件不存在透传 ENOENT（memoryService.ts:79-82）', () => {
  const storage = createMemoryStorage({
    [AGENT_MEMORY_STORE_STORAGE_KEY]: JSON.stringify(
      catalogOf({ id: WORKSPACE_A, files: [{ name: 'MEMORY.md', content: '# A', updatedAt: 1 }] }),
    ),
  })
  assert.throws(
    () => readProjectMemoryFile({ workspaceId: WORKSPACE_B, fileName: 'MEMORY.md' }, storage),
    (error) => error.code === 'ENOENT',
  )
  assert.throws(
    () => readProjectMemoryFile({ workspaceId: WORKSPACE_A, fileName: 'missing.md' }, storage),
    (error) => error.code === 'ENOENT',
  )
})

test('读正文：超过 5 MiB 预览上限报专用错误码（projectMemoryStableRead.ts:38,86-91）', () => {
  const storage = createMemoryStorage({
    [AGENT_MEMORY_STORE_STORAGE_KEY]: JSON.stringify(
      catalogOf({
        id: WORKSPACE_A,
        files: [{ name: 'big.md', content: 'a'.repeat(PROJECT_MEMORY_PREVIEW_MAX_BYTES + 1), updatedAt: 1 }],
      }),
    ),
  })
  assert.throws(
    () => readProjectMemoryFile({ workspaceId: WORKSPACE_A, fileName: 'big.md' }, storage),
    (error) => error.code === PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE,
  )
})

test('读正文：读取期间文件已变报 FILE_CHANGED（projectMemoryStableRead.ts:27-36,45-47,93-97）', () => {
  const before = catalogOf({ id: WORKSPACE_A, files: [{ name: 'MEMORY.md', content: '# A', updatedAt: 1 }] })
  const after = catalogOf({ id: WORKSPACE_A, files: [{ name: 'MEMORY.md', content: '# A v2', updatedAt: 2 }] })
  const storage = createSequencedStorage([before, after])
  assert.throws(
    () => readProjectMemoryFile({ workspaceId: WORKSPACE_A, fileName: 'MEMORY.md' }, storage),
    (error) => error.code === PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
  )
  // 文件在复核时消失也算已变（同一分支）
  const gone = catalogOf({ id: WORKSPACE_A, files: [] })
  assert.throws(
    () => readProjectMemoryFile({ workspaceId: WORKSPACE_A, fileName: 'MEMORY.md' }, createSequencedStorage([before, gone])),
    (error) => error.code === PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
  )
})

test('读正文：无存储时报 ENOENT 而不是抛未捕获异常', () => {
  assert.throws(
    () => readProjectMemoryFile({ workspaceId: WORKSPACE_A, fileName: 'MEMORY.md' }, createThrowingStorage()),
    (error) => error.code === 'ENOENT',
  )
})