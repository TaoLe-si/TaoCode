// rf/core 的判据：最近文件模型（上游 `RecentFilesMutableState.kt` / `FileSwitcherApi.kt` /
// `RecentFilesExcluder.kt` 的移植口径）与 `src/explorerActions.ts` 的装配链路。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  addEvent, emptyRecentFilesState, isAllowedInRecentFiles, parseRecentFiles, recentFilesRows,
  removeAllEvent, removeEvent, removeFromAll, serializeRecentFiles, stateKeyForKind, SWITCHER_ELEMENTS_LIMIT,
  updateEvent,
} from '../src/recentFilesModel.ts'

const here = dirname(fileURLToPath(import.meta.url))

test('addEvent 把 batch 整体置顶并删掉旧表里的同值项（RecentFilesMutableState.kt:31-39）', () => {
  assert.deepEqual(addEvent(['b', 'a', 'c'], ['a']), ['a', 'b', 'c'])
  assert.deepEqual(addEvent(['c', 'b', 'a'], ['d', 'b']), ['d', 'b', 'c', 'a'])
  assert.deepEqual(addEvent([], ['x']), ['x'])
  // 空 batch 不改变表（上游事件不会发空批，这里仍保持同一契约）。
  assert.deepEqual(addEvent(['x'], []), ['x'])
})

test('addEvent 超过 SWITCHER_ELEMENTS_LIMIT=30 从尾部截断', () => {
  assert.equal(SWITCHER_ELEMENTS_LIMIT, 30)
  const long = Array.from({ length: 40 }, (_, i) => `f${i}`)
  const next = addEvent(long, ['top'])
  assert.equal(next.length, 30)
  assert.equal(next[0], 'top')
  assert.equal(next[29], 'f28')
})

test('updateEvent 的 putOnTop 语义（:41-60）：命中项按旧表顺序整体前移', () => {
  assert.deepEqual(updateEvent(['a', 'b', 'c', 'd'], ['c', 'a'], true), ['a', 'c', 'b', 'd'])
  // 本仓的值是字符串：不置顶时就地替换与顺序不变等价。
  assert.deepEqual(updateEvent(['a', 'b', 'c'], ['b'], false), ['a', 'b', 'c'])
})

test('removeEvent / removeAllEvent（:62-78）', () => {
  assert.deepEqual(removeEvent(['a', 'b', 'c'], ['b', 'z']), ['a', 'c'])
  assert.deepEqual(removeEvent(['a'], []), ['a'])
  assert.deepEqual(removeAllEvent(), [])
})

test('类别 → 容器字段：RECENTLY_OPENED_UNPINNED 写 pinned 那份（:24-29 的上游名实对调照抄）', () => {
  assert.equal(stateKeyForKind('recentlyOpened'), 'recentlyOpened')
  assert.equal(stateKeyForKind('recentlyEdited'), 'recentlyEdited')
  assert.equal(stateKeyForKind('recentlyOpenedUnpinned'), 'recentlyOpenedPinned')
})

test('isAllowedInRecentFiles：excluder 命中即拒（RecentFilesExcluder.kt:31-42）', () => {
  const generated = (kind, path) => kind === 'recentlyOpened' && path.endsWith('.class')
  assert.equal(isAllowedInRecentFiles('recentlyOpened', 'build/A.class', [generated]), false)
  assert.equal(isAllowedInRecentFiles('recentlyOpened', 'src/A.java', [generated]), true)
  // 文件清单里找不到（等价于上游 file.isValid 为假）也不进表。
  assert.equal(isAllowedInRecentFiles('recentlyOpened', 'src/gone.java', [], new Set(['src/gone.java'])), false)
  assert.equal(isAllowedInRecentFiles('recentlyOpened', ''), false)
})

test('removeFromAll：三个表一起减法；无变化时原样返回（RecentFilesVfsListener）', () => {
  const state = { recentlyOpened: ['a', 'b'], recentlyEdited: ['b'], recentlyOpenedPinned: ['a'] }
  const next = removeFromAll(state, ['b'])
  assert.deepEqual(next, { recentlyOpened: ['a'], recentlyEdited: [], recentlyOpenedPinned: ['a'] })
  assert.equal(removeFromAll(state, ['zzz']), state)
})

test('recentFilesRows：pinned 在前、跨表去重、按上限截断', () => {
  const state = { recentlyOpened: ['a', 'b', 'c'], recentlyEdited: [], recentlyOpenedPinned: ['c', 'p'] }
  assert.deepEqual(recentFilesRows(state), ['c', 'p', 'a', 'b'])
  assert.deepEqual(recentFilesRows(state, 'recentlyEdited'), [])
})

test('parse: 坏数据整份丢弃、去重并截断；serialize 能往返', () => {
  assert.deepEqual(parseRecentFiles(null), emptyRecentFilesState())
  assert.deepEqual(parseRecentFiles('{not json'), emptyRecentFilesState())
  assert.deepEqual(parseRecentFiles('[1,2]'), emptyRecentFilesState())
  const parsed = parseRecentFiles(JSON.stringify({ recentlyOpened: ['a', 'a', 7, '', 'b'], recentlyEdited: 'x' }))
  assert.deepEqual(parsed, { recentlyOpened: ['a', 'b'], recentlyEdited: [], recentlyOpenedPinned: [] })
  const state = { recentlyOpened: ['a'], recentlyEdited: ['b'], recentlyOpenedPinned: ['c'] }
  assert.deepEqual(parseRecentFiles(serializeRecentFiles(state)), state)
})

test('explorerActions 真的把模型接进了 Ctrl+E 面板的数据源（不是只加了个模块）', () => {
  const source = readFileSync(join(here, '..', 'src', 'explorerActions.ts'), 'utf8')
  // 值 import 必须带 `.ts` 扩展名（Node ESM 直跑 `.ts`，漏扩展名会让整个测试文件加载失败 ——
  // `docs/agent-playbook-parity.md` 的三条系统性禁令之一）。原先这条写的是无扩展名形态，
  // 宿主按规则补上 `.ts` 之后就把它顶掉了，这里改成守"带扩展名"这一档。
  assert.match(source, /from '\.\/recentFilesModel\.ts'/)
  assert.match(source, /rememberRecent\(path: string\)/)
  assert.match(source, /addEvent\(recentFilesState\.value\.recentlyOpened, \[path\]\)/)
  assert.match(source, /localStorage\.setItem\(RECENT_FILES_STORAGE_KEY/)
  assert.match(source, /recentFilesRows\(next\)/)
  // 上限不再是写死的 40。
  assert.doesNotMatch(source, /slice\(0, 40\)/)
})
