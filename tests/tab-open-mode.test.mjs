// 逐文件的**首选打开模式**记忆（`pf/file-editor` 的 `FileEditorStateWithPreferredOpenMode` /
// `FileEditorManagerImpl.OpenMode` 那一档）：用户为某个文件选过哪种打开方式，下次打开还是那一种。
// 本仓唯一存在的这根轴是 Markdown 预览（单窗口、没有"右侧分屏打开"动作）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  OPEN_MODES_KEY, forgetOpenMode, openModeKey, openModeOf, openModeStorage, preferredOpenMode,
  readOpenModes, rememberOpenMode, resetOpenModes, setOpenMode, writeOpenModes,
} from '../src/openFileModes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')

/** 假 localStorage（隐私模式/无存储时的退路也要能测）。 */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return { writes: 0, getItem: key => (map.has(key) ? map.get(key) : null), setItem(key, value) { this.writes += 1; map.set(key, value) }, size: () => map.size }
}

test('持久化键带上项目根（上游那张表在项目目录下的 workspace.xml 里，按项目分）', () => {
  assert.equal(openModeKey('D:/work', 'docs/a.md'), 'D:/work\ndocs/a.md')
  assert.equal(openModeKey('D:\\work\\', 'docs\\a.md'), 'D:/work\ndocs/a.md')
  assert.notEqual(openModeKey('D:/work', 'a.md'), openModeKey('D:/other', 'a.md'))
  assert.equal(OPEN_MODES_KEY, 'taocode.fileOpenModes.v1')
})

test('坏存储不当场崩：坏 JSON / 非对象 / 坏键值 / 超长键一律当空表', () => {
  assert.deepEqual(readOpenModes(fakeStorage({ [OPEN_MODES_KEY]: '{oops' })), {})
  assert.deepEqual(readOpenModes(fakeStorage({ [OPEN_MODES_KEY]: '[1,2,3]' })), {})
  assert.deepEqual(readOpenModes(fakeStorage({ [OPEN_MODES_KEY]: JSON.stringify({ a: 'split', b: 'preview' }) })), { b: 'preview' },
    '未知模式值被丢掉，其余保留')
  assert.deepEqual(readOpenModes(fakeStorage({ [OPEN_MODES_KEY]: JSON.stringify({ ['k'.repeat(1025)]: 'preview' }) })), {})
  assert.deepEqual(readOpenModes(fakeStorage()), {})
  assert.deepEqual(readOpenModes(null), {}, '没有存储 = 不记住')
  assert.equal(openModeStorage(), null, 'Node 里没有 localStorage，测试不依赖它')
})

test('记住 / 读回 / 忘掉（记住的是"选过"，不是"当前"）', () => {
  const storage = fakeStorage()
  assert.equal(preferredOpenMode('D:/work', 'docs/a.md', storage), null, '没选过 = 文件类型的默认')
  rememberOpenMode('D:/work', 'docs/a.md', 'preview', storage)
  assert.equal(preferredOpenMode('D:/work', 'docs/a.md', storage), 'preview')
  assert.equal(preferredOpenMode('D:/other', 'docs/a.md', storage), null, '另一个项目的同名文件不受影响')
  forgetOpenMode('D:/work', 'docs/a.md', storage)
  assert.equal(preferredOpenMode('D:/work', 'docs/a.md', storage), null)
  writeOpenModes({}, storage)
})

test('写盘失败只降级成"会话内记忆"，不抛', () => {
  const broken = { getItem: () => null, setItem() { throw new Error('quota') } }
  writeOpenModes({ a: 'preview' }, broken)
  assert.doesNotThrow(() => rememberOpenMode('D:/work', 'a.md', 'preview', broken))
})

test('响应式门面：逐文件记、换文件各记各的、null 是忘掉', () => {
  resetOpenModes()
  const writes = []
  globalThis.localStorage = { getItem: key => (key === OPEN_MODES_KEY ? (writes.at(-1) ?? null) : null), setItem: (key, value) => { writes.push(value) } }
  try {
    resetOpenModes()
    assert.equal(openModeOf('D:/work', 'docs/a.md'), null)
    setOpenMode('D:/work', 'docs/a.md', 'preview')
    assert.equal(openModeOf('D:/work', 'docs/a.md'), 'preview')
    assert.equal(openModeOf('D:/work', 'docs/b.md'), null, '别的文件不受影响')
    assert.equal(writes.length, 1)
    setOpenMode('D:/work', 'docs/b.md', 'preview')
    assert.equal(openModeOf('D:/work', 'docs/b.md'), 'preview')
    setOpenMode('D:/work', 'docs/b.md', 'preview')
    assert.equal(writes.length, 2, '同样的值不重复落盘（切到非预览文件时的空写会被挡掉）')
    setOpenMode('D:/work', 'docs/a.md', null)
    assert.equal(openModeOf('D:/work', 'docs/a.md'), null)
    assert.equal(openModeOf('D:/work', 'docs/b.md'), 'preview', '忘掉一个不影响另一个')
    assert.equal(openModeOf('D:/work', undefined), null, '没有文件就没有模式')
    setOpenMode('D:/work', undefined, 'preview')
  } finally {
    delete globalThis.localStorage
    resetOpenModes()
  }
})

// —— 接线：App.vue 的 markdownPreviewOn 必须从会话级布尔变成逐文件 ——
test('App.vue 的 Markdown 预览开关逐文件（不再是那个会话级 ref）', () => {
  assert.match(app, /import \{ openModeOf, setOpenMode \} from '\.\/openFileModes'/, 'App.vue 没引入逐文件模式')
  assert.match(app, /const markdownPreviewOn = computed\(\{ get: \(\) => openModeOf\([\s\S]*?set: on => setOpenMode\(/,
    'markdownPreviewOn 仍是会话级布尔：A.md 的预览选择会跟着切到 B.md')
  // 上游那份开关在非预览文件上是空写；这里必须有 markdownCapable 把关，别把 'editor' 记进表里。
  assert.match(app, /on && markdownCapable\.value \? 'preview' : null/, '非 md 文件也记了一次选择')
  // 反证：退回 ref(false) 必须被这条抓到。
  assert.ok(!/openModeOf/.test('const markdownPreviewOn = ref(false)'), '反例本该不合格')
})
