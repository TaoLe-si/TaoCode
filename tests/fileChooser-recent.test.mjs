// 文件选择器左栏「最近」那一档的**真数据源**（桶 14c 接线请求第 1 条的模块侧）。
//
// 上游口径（基准树逐行数过）：
//   · 记：`platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:186-191`
//     （`storeSelection` → `FileChooserUtil.updateRecentPaths`，每选中一次记一条）；
//   · 规则：`impl/FileChooserUtil.java:89-108` —— `Stream.concat(Stream.of(path), 旧表).distinct().limit(30)`，
//     键与上限 `:33-34`（`file.chooser.recent.files` / `RECENT_FILES_LIMIT = 30`）；
//   · 读：`:74-82`（没记过 = **空表**，不是缺省值）；用在路径下拉 `:258`。
// 本仓把它落在选择器宿主自己手里（`src/fileChooserHostState.ts`），宿主**不改也能有真数据**；
// 宿主另外给的那一份（编辑器历史）排在后面，是本仓的适配，上游没有。
//
// 顺带钉住快捷条一行的落点：上游是「在树里选中它」（`FileChooserDialogImpl.java:178-183` 的
// `restoreSelection` → `selectInTree`），**不是**把文件当目录打开。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  CHOOSER_RECENT_LIMIT, mergeRecentPaths, pushRecentPath, shortcutNavigation,
} from '../src/fileChooserModel.ts'
import { CHOOSER_RECENT_KEY, readRecentPaths } from '../src/fileChooserHostState.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

test('记一条：新的排最前、大小写不敏感去重、上限就是上游的 30', () => {
  assert.equal(CHOOSER_RECENT_LIMIT, 30, 'FileChooserUtil.java:34 的 RECENT_FILES_LIMIT')
  assert.deepEqual(pushRecentPath(['a/one.txt', 'a/two.txt'], 'a/three.txt'),
    ['a/three.txt', 'a/one.txt', 'a/two.txt'])
  // 同一条路径再记一次不翻倍（上游 `.distinct()` 是精确比，本仓按大小写不敏感去重，
  // 与 `recentShortcuts` 同一口径），并且**留下最新那一次的写法**（新的排最前）。
  assert.deepEqual(pushRecentPath(['a/one.txt', 'a/two.txt'], 'A/ONE.TXT'), ['A/ONE.TXT', 'a/two.txt'])
  const many = Array.from({ length: CHOOSER_RECENT_LIMIT + 5 }, (_, index) => `d/f${index}.txt`)
  assert.equal(pushRecentPath(many, 'd/new.txt').length, CHOOSER_RECENT_LIMIT, '超过上限丢尾巴')
  assert.equal(pushRecentPath(many, '')[0], many[0], '空路径不进表')
})

test('两档合并：选择器自己记的在前，宿主给的那份在后，仍是一条上限', () => {
  const merged = mergeRecentPaths(['src/B.java'], ['src/A.java', 'src/B.java', 'docs/x.md'])
  assert.deepEqual(merged, ['src/B.java', 'src/A.java', 'docs/x.md'], '去重且顺序不翻')
  assert.equal(mergeRecentPaths([], []).length, 0, '两档都空 = 空表（不是缺省值）')
  const capped = mergeRecentPaths(['a', 'b'], Array.from({ length: 40 }, (_, i) => `c/${i}`))
  assert.equal(capped.length, CHOOSER_RECENT_LIMIT)
})

test('读盘：没有 / 坏形状一律退化成空表，绝不判存档损坏', () => {
  assert.deepEqual(readRecentPaths(null), [], 'store = null（老宿主、隐私模式）')
  assert.deepEqual(readRecentPaths({ getItem: () => null, setItem: () => {} }), [], '没记过')
  assert.deepEqual(readRecentPaths({ getItem: () => '{not json', setItem: () => {} }), [], '坏 JSON')
  assert.deepEqual(readRecentPaths({ getItem: () => '{"a":1}', setItem: () => {} }), [], '不是数组')
  assert.deepEqual(readRecentPaths({ getItem: () => JSON.stringify(['src/A.java', 7, null, 'src/A.java']), setItem: () => {} }),
    ['src/A.java'], '非字符串条目丢掉、重复去掉')
  assert.equal(CHOOSER_RECENT_KEY, 'taocode.fileChooser.recentPaths', 'localStorage 键名钉住（改名要迁移）')
})

test('快捷条一行的落点：目录进那一层，文件进父目录并选中那一行', () => {
  const dir = shortcutNavigation({ label: 'app', path: 'C:/work/app', kind: 'directory' })
  assert.deepEqual(dir, { path: 'C:/work/app', select: null, expand: ['C:', 'C:/work', 'C:/work/app'] })
  const file = shortcutNavigation({ label: 'Main.java', path: 'src/main/Main.java', kind: 'file' })
  assert.equal(file.path, 'src/main', '文件不能当目录列 ⇒ 切到它的父目录')
  assert.equal(file.select, 'src/main/Main.java', '那一行要被选中')
  assert.deepEqual(file.expand, ['src', 'src/main'], '祖先链逐层展开（懒加载的树没列过就没有这一行）')
  const top = shortcutNavigation({ label: 'a.txt', path: 'a.txt', kind: 'file' })
  assert.equal(top.path, '', '工作区根上的文件：落回根那一层')
  assert.deepEqual(top.expand, [])
})

test('宿主与组件真的走这一条（不是又一个只过自己测试的死模块）', () => {
  const host = read('../src/fileChooserHostState.ts')
  assert.match(host, /const chosen = ref<string\[\]>\(readRecentPaths\(\)\)/, '记的那一档从盘上起来')
  assert.match(host, /recordChosen\(path\)\n\s+pending\.resolve\(path, null\)/, '应用内选中成功后才记')
  assert.match(host, /recordChosen\(picked\)/, '走原生对话框选中的也记')
  assert.match(host, /const recentList = \(\) => mergeRecentPaths\(chosen\.value, recentSeed\(\)\)/, '合并的是记的那一档 + 宿主给的那一档')
  assert.match(host, /chooser\.value = \{ descriptor, initial, recent: recentList, favorites,/,
    '数据源跟着这一次调用给出去（宿主挂点写的就是 chooser.recent()）')
  const dialog = read('../src/components/FileChooserDialog.vue')
  assert.match(dialog, /@click="openShortcut\(row\)"/, '左栏那一行走新的落点')
  assert.doesNotMatch(dialog, /@click="openDirectory\(row\.path\)"/, '旧写法（把文件当目录打开）已消失')
})
