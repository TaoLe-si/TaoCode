// 「忽略的文件与目录」清单的判据 —— 上游
// `platform/lang-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFilesAndFoldersPanel.java`
// 那个面板的四条判定（增/改/删/校验）+ `FileTypeManagerImpl` 的默认清单与「按集合比改动」。
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

import {
  DEFAULT_IGNORED_FILES,
  IGNORED_LIST_KEY,
  IGNORE_ERROR_EXISTS,
  IGNORE_ERROR_INVALID,
  applyIgnoredPatterns,
  editIgnoredPattern,
  ignoredPatterns,
  ignoreListText,
  ignorePatternsFromList,
  isIgnoreListEqualToCurrent,
  isIgnoredName,
  isPathIgnored,
  isEqualToDefaultIgnoreList,
  isValidIgnorePattern,
  removeIgnoredPattern,
  restoreDefaultIgnoredPatterns,
  sortIgnoredPatterns,
} from '../src/fileTypeIgnoredList.ts'
import { fileTypeManager } from '../src/fileTypeRegistry.ts'

test('默认清单就是上游 DEFAULT_IGNORED 那 17 条，且必须是已排序的（FileTypesTest.java:1127-1130 同款断言）', () => {
  assert.equal(DEFAULT_IGNORED_FILES.length, 17)
  assert.deepEqual(
    DEFAULT_IGNORED_FILES,
    ['*.pyc', '*.pyo', '*.rbc', '*.yarb', '*~', '.DS_Store', '.git', '.hg', '.mypy_cache', '.pytest_cache',
      '.ruff_cache', '.svn', 'CVS', '__pycache__', '_svn', 'vssver.scc', 'vssver2.scc'])
  assert.deepEqual([...DEFAULT_IGNORED_FILES].sort(), [...DEFAULT_IGNORED_FILES])
  // 没存过时清单 = 默认（`new IgnoredPatternSet(DEFAULT_IGNORED)`，FileTypeManagerImpl.java:165）。
  assert.deepEqual(ignoredPatterns(), [...DEFAULT_IGNORED_FILES])
})

test('校验按上游那条链：空白/分隔符/保留名非法，通配符先换成 a 再判（IgnoredFilesAndFoldersPanel.java:238-243）', () => {
  assert.equal(isValidIgnorePattern(''), false, '上游 `if (value.isBlank()) return false`')
  assert.equal(isValidIgnorePattern('   '), false)
  assert.equal(isValidIgnorePattern('*.pyc'), true)
  assert.equal(isValidIgnorePattern('build?'), true)
  assert.equal(isValidIgnorePattern('node_modules'), true)
  // 带路径的模式在编辑期就非法：`isValidFileNameChar` 第一条就是分隔符（PathUtilRt.java:221-223）。
  assert.equal(isValidIgnorePattern('out/Debug'), false)
  assert.equal(isValidIgnorePattern('out\\Debug'), false)
  // strict 还禁 `<>:"|?*`、控制字符与 `;`（`;` 是清单的分隔符）。
  assert.equal(isValidIgnorePattern('a:b'), false)
  assert.equal(isValidIgnorePattern('a;b'), false)
  assert.equal(isValidIgnorePattern('a<b'), false)
  // Windows 保留名：只在长度 3-4 时判（PathUtilRt.java:214-216）。
  assert.equal(isValidIgnorePattern('NUL'), false)
  assert.equal(isValidIgnorePattern('COM1'), false)
  assert.equal(isValidIgnorePattern('LPT9'), false)
  assert.equal(isValidIgnorePattern('nulls'), true, '长度不是 3-4 就不算保留名')
  assert.equal(isValidIgnorePattern('.'), false)
  assert.equal(isValidIgnorePattern('..'), false)
})

test('新增一条：合法就写入并重排、选中它；重复报「已经有了」；非法报「无效的文件模式」（trySave 的三条判定）', () => {
  const base = ['*.bak', 'tmp']
  const added = editIgnoredPattern(base, null, 'zzz')
  assert.equal(added.accepted, true)
  assert.deepEqual(added.patterns, ['*.bak', 'tmp', 'zzz'])
  assert.equal(added.selected, 'zzz')
  assert.equal(added.index, 2, '刚写入的那条要被选中（:183-185 + reorderList）')

  const duplicated = editIgnoredPattern(base, null, 'tmp')
  assert.equal(duplicated.accepted, false)
  assert.equal(duplicated.problem, IGNORE_ERROR_EXISTS)
  assert.deepEqual(duplicated.patterns, base, '被拒时清单一个字都不动')

  const invalid = editIgnoredPattern(base, null, 'a/b')
  assert.equal(invalid.accepted, false)
  assert.equal(invalid.problem, IGNORE_ERROR_INVALID)

  const same = editIgnoredPattern(base, 'tmp', 'tmp')
  assert.equal(same.accepted, true, '与旧值相同直接放过（:160-162）')
  assert.deepEqual(same.patterns, base)
})

test('改一条：原地替换后重排；清单里没有这条旧值时不会误删别的（:178-182）', () => {
  const edited = editIgnoredPattern(['*.bak', 'tmp', 'zzz'], 'tmp', 'build')
  assert.equal(edited.accepted, true)
  assert.deepEqual(edited.patterns, ['*.bak', 'build', 'zzz'])
  assert.equal(edited.selected, 'build')
})

test('删一条：选中位置跟着走，越界退到最后一条，删空就没有选中项（removePattern，:76-87）', () => {
  const list = ['a', 'b', 'c']
  assert.deepEqual(removeIgnoredPattern(list, 1).patterns, ['a', 'c'])
  assert.equal(removeIgnoredPattern(list, 1).selected, 'c')
  assert.equal(removeIgnoredPattern(list, 1).index, 1, '删掉中间那条后选中原来的下一个位置')
  assert.equal(removeIgnoredPattern(list, 2).selected, 'b', '删最后一条时越界退回最后一条')
  const emptied = removeIgnoredPattern(['a'], 0)
  assert.deepEqual(emptied.patterns, [])
  assert.equal(emptied.selected, '')
  assert.equal(emptied.index, -1)
  assert.equal(removeIgnoredPattern(list, 9).accepted, false, '下标不存在时不动清单')
})

test('存储是一串分号分隔的模式；空清单存空串而不是分号（getValues / getIgnoredFilesList）', () => {
  assert.equal(ignoreListText(['*.pyc', '.git']), '*.pyc;.git')
  assert.equal(ignoreListText([]), '')
  assert.deepEqual(ignorePatternsFromList('*.pyc; .git ;;*.pyc'), ['*.pyc', '.git'], 'tokenizer 跳空词条、重复词条只留一条')
  assert.deepEqual(sortIgnoredPatterns(['b', 'A', '*']), ['*', 'A', 'b'], 'Java 的 compareTo 是码元序')
})

test('「有没有改动」按集合比，不按串比（isIgnoredFilesListEqualToCurrent，:1154-1163）', () => {
  assert.equal(isIgnoreListEqualToCurrent('a;b', ['b', 'a']), true, '顺序不同算没改')
  assert.equal(isIgnoreListEqualToCurrent('a;a;b', ['a', 'b']), true, '重复词条算没改')
  assert.equal(isIgnoreListEqualToCurrent('a;b;c', ['a', 'b']), false)
  assert.equal(isIgnoreListEqualToCurrent('', []), true)
})

test('应用到注册表后 isFileIgnored 立刻按新清单判；恢复默认能回来', () => {
  const before = fileTypeManager.getIgnoredFilesList()
  try {
    const changed = applyIgnoredPatterns(['mytmp', '*.zzz'])
    assert.equal(changed, true)
    assert.equal(isIgnoredName('mytmp'), true)
    assert.equal(isIgnoredName('a.zzz'), true)
    assert.equal(isIgnoredName('a.py'), false)
    // 再应用一次同一份清单：按集合相等 ⇒ 不重复写注册表（上游 apply() 也是先问再写）。
    assert.equal(applyIgnoredPatterns(['*.zzz', 'mytmp']), false)
    assert.deepEqual(restoreDefaultIgnoredPatterns(), [...DEFAULT_IGNORED_FILES])
    assert.equal(isIgnoredName('__pycache__'), true)
  } finally {
    fileTypeManager.setIgnoredFilesList(before)
  }
})

test('路径判定按段问注册表（上游只按文件名判：IgnoredFileCache.java:80-82）', () => {
  const before = fileTypeManager.getIgnoredFilesList()
  try {
    applyIgnoredPatterns(['node_modules'])
    assert.equal(isPathIgnored('src/../node_modules'), true, '路径里任何一段命中都算（逐段问注册表）')
    assert.equal(isPathIgnored('a\\node_modules\\b.json'), true)
    assert.equal(isPathIgnored('src/main.ts'), false)
  } finally {
    fileTypeManager.setIgnoredFilesList(before)
  }
})

// 启动钩子（接线请求 docs/wiring-requests-2026-10-06-bucket15.md W3）：忽略清单必须在界面挂起来
// **之前**就灌进进程内注册表。上游那张表是 `FileTypeManagerImpl` 的组件字段
// （platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:165
// `new IgnoredPatternSet(DEFAULT_IGNORED)`，默认表同文件 :142），存过的那份在 loadState 里直接
// `ignoredPatterns.setIgnoreMasks(...)`（同文件 :1236-1238）—— 都不是某个设置页的副作用。
// 订正：请求原文引的第二处坐标「:1363-1364」实际是 `setFileTypes` 里的 `readHashBangs`，指不到
// 忽略清单 ⇒ 改成 :1236-1238；原文给的代码 `applyIgnoredPatterns(loadIgnoredPatterns())` 会多写
// 一次 localStorage（`loadIgnoredPatterns()` 自己已经 apply，src/fileTypeIgnoredList.ts:226-230）
// ⇒ 落地的只有 `loadIgnoredPatterns()` 这一句。
test('main.ts 在挂界面之前灌忽略清单（不是等用户第一次进设置页）', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /import \{ loadIgnoredPatterns \} from '\.\/fileTypeIgnoredList\.ts'/,
    '值 import 必须带 .ts 扩展名（本仓的语法坑）')
  const call = main.match(/^[ \t]*loadIgnoredPatterns\(\)[ \t]*$/m)
  assert.ok(call, 'main.ts 要真的把 loadIgnoredPatterns() 当语句调起来（只在注释里提到不算）')
  const mountAt = main.indexOf("createApp(App).mount('#app')")
  assert.ok(mountAt >= 0, '没有启动命令时仍要挂界面')
  assert.ok(call.index < mountAt, '灌清单要排在挂界面之前，否则启动到第一次进设置页之间判定用的是内置默认表')
  // 不能再套一层 applyIgnoredPatterns（它会多写一次 localStorage，语义还是「用户改了清单」）：
  // 只看**行首的调用**，注释里那句「原写 applyIgnoredPatterns(loadIgnoredPatterns())」不算。
  assert.doesNotMatch(main, /^[ \t]*applyIgnoredPatterns\(/m)
})

// ── 默认表与上游**逐字**一致（本轮补的门）────────────────────────────────────────
// 原来这条只钉了「17 条 + 已排序 + 与本文件里手抄的第二份相等」—— 那第二份和断言里的表是同一个
// 人同一轮抄的，抄漏一条会两份一起错。这里改成**直接解析上游源码**：
// `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:142-144`
// 的 `DEFAULT_IGNORED = List.of(…)`（`:139` 那句 `// must be sorted`、
// 排序断言在 `platform/platform-tests/testSrc/com/intellij/openapi/fileTypes/impl/FileTypesTest.java:1127-1130`）。
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const MANAGER_SOURCE = 'platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java'

test('DEFAULT_IGNORED_FILES 与上游 DEFAULT_IGNORED 逐字一致（条数、顺序、大小写都不许漂）', () => {
  if (!existsSync(`${REF}/${MANAGER_SOURCE}`)) return   // 参考树不在本机时跳过（与引用门同口径）
  const source = readFileSync(`${REF}/${MANAGER_SOURCE}`, 'utf8')
  const decl = source.match(/DEFAULT_IGNORED = List\.of\(([^;]*)\);/)
  assert.ok(decl, '上游 DEFAULT_IGNORED 的声明形状变了 ⇒ 这条门要跟着人工核对，不许直接删')
  const upstream = [...decl[1].matchAll(/"([^"]*)"/g)].map(item => item[1])
  assert.deepEqual([...DEFAULT_IGNORED_FILES], upstream, '本仓那张默认表与上游源码里的字面表不一致')
  assert.equal(upstream.length, 17)
  assert.deepEqual([...upstream].sort(), upstream, '上游自己断言它已排序（FileTypesTest 那条），解析出来的也必须已排序')
})

test('与默认表「整表排序后逐位大小写不敏感」相等才算默认（isEqualToDefaultIgnoreMasks，:1494-1504）', () => {
  assert.equal(isEqualToDefaultIgnoreList(DEFAULT_IGNORED_FILES), true)
  assert.equal(isEqualToDefaultIgnoreList([...DEFAULT_IGNORED_FILES].reverse()), true, '上游先 sort(null) 再比 ⇒ 顺序不算差异')
  assert.equal(isEqualToDefaultIgnoreList(DEFAULT_IGNORED_FILES.map(item => (item === '.git' ? '.GIT' : item))), true,
    '比法是 equalsIgnoreCase ⇒ `.git` 与 `.GIT` 算同一张表（它排在 `.DS_Store` 与 `.hg` 之间，改大小写不动位置）')
  assert.equal(isEqualToDefaultIgnoreList(DEFAULT_IGNORED_FILES.map(item => (item === 'CVS' ? 'cvs' : item))), false,
    '反证「先排序再逐位」这条纪律：`cvs` 排到 `__pycache__` 后面 ⇒ 位置对不上就判不等（上游同理会 false）')
  assert.equal(isEqualToDefaultIgnoreList(DEFAULT_IGNORED_FILES.slice(0, 16)), false, '少一条就不是默认表（先比 size）')
  assert.equal(isEqualToDefaultIgnoreList([...DEFAULT_IGNORED_FILES, 'x']), false, '多一条同样判不等')
  assert.equal(isEqualToDefaultIgnoreList(DEFAULT_IGNORED_FILES.map(item => (item === 'CVS' ? 'DVS' : item))), false,
    '同条数、位置对上但内容不同 ⇒ false（不是按集合比的近似品）')
})

// 落盘的两条上游纪律：① 存的是**生效后**的表（被遮蔽闸挡掉的词条上游 `getState` 也拿不到，
// `FileTypeManagerImpl.java:1434`）；② 与默认表相同 ⇒ 连 `ignoreFiles` 元素都不写（`:1436-1438`），
// 本仓等价 = 清掉存储键 ⇒ `ignoredPatterns()` 回默认表（同文件 `:165` 的初值）。
test('落盘的是生效后的那张表；与默认表相同就不留键；空清单要能跟「没存过」区分', () => {
  const store = new Map()
  const backup = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  }
  const before = fileTypeManager.getIgnoredFilesList()
  try {
    assert.equal(applyIgnoredPatterns(['*.pyc', 'build.pyc']), true)
    assert.equal(store.get(IGNORED_LIST_KEY), '*.pyc', '被 `*.pyc` 盖住的 build.pyc 不该留在盘上（上游那张表里就没有它）')
    assert.deepEqual(ignoredPatterns(), ['*.pyc'])
    assert.equal(isIgnoredName('build.pyc'), true, '虽然没落盘，判定照常生效（是同一张表的匹配结果）')

    applyIgnoredPatterns(DEFAULT_IGNORED_FILES)
    assert.equal(store.has(IGNORED_LIST_KEY), false, '和默认表一样 ⇒ 清掉键，别把 17 条抄进存储')
    assert.deepEqual(ignoredPatterns(), [...DEFAULT_IGNORED_FILES], '没键就是上游那份 DEFAULT_IGNORED')

    assert.equal(applyIgnoredPatterns([]), true)
    assert.equal(store.get(IGNORED_LIST_KEY), '', '上游注释：empty means empty list —— 空清单要存成空串，与「没存过」区分')
    assert.deepEqual(ignoredPatterns(), [], '空清单不回落默认表')
  } finally {
    fileTypeManager.setIgnoredFilesList(before)
    if (backup === undefined) delete globalThis.localStorage
    else globalThis.localStorage = backup
    store.clear()
  }
})
