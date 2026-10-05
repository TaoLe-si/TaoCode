// 编辑器标签标题（`ici/file-editor` + `lp/file-editor` 的「标签标题扩展 / 同名文件带目录」）。
//
// 上游顺序 `EditorTabPresentationUtil.kt:18-22`：自定义标题（EP）→ 同名文件带目录（唯一名）→ 裸文件名。
// 接线判据盯的是「标签上那行字是不是真的走了这条链」—— 规则再好，模板里写死
// `tab.path.split('/').pop()` 就等于永远只有第 ③ 档（同一次改之前 App.vue 就是那样）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HIDE_KNOWN_EXTENSION_IN_TABS_DEFAULT, SHOW_DIRECTORY_FOR_NON_UNIQUE_FILENAMES_DEFAULT,
  defaultTabTitleOptions, editorTabText, editorTabTitle, getCustomEditorTabTitle, uniqueEditorTabTitle,
} from '../src/tabTitle.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')

// UISettingsState.kt:218-219 / :137-138 —— 两个开关的出厂值。
test('两个开关的默认档就是 IDEA 的出厂值', () => {
  assert.equal(SHOW_DIRECTORY_FOR_NON_UNIQUE_FILENAMES_DEFAULT, true)
  assert.equal(HIDE_KNOWN_EXTENSION_IN_TABS_DEFAULT, false)
  assert.deepEqual(defaultTabTitleOptions(), { showDirectoryForNonUniqueFilenames: true, hideKnownExtensionInTabs: false })
})

// EditorTabPresentationUtil.kt:18-22 —— 裸文件名是兜底那一档。
test('没有同名文件时就是裸文件名（presentableName）', () => {
  assert.equal(editorTabTitle('src/components/App.vue'), 'App.vue')
  assert.equal(editorTabTitle('src/components/App.vue', ['src/other/main.ts']), 'App.vue', 'peers 里没有同名文件')
})

// UniqueNameEditorTabTitleProvider.kt:34-56 + UniqueVFilePathBuilderImpl.kt:56-64：唯一性只在已打开的标签里算。
test('同名文件带最短唯一目录后缀', () => {
  const peers = ['src/main.cpp', 'lib/main.cpp', 'docs/readme.md']
  assert.equal(editorTabTitle('src/main.cpp', peers), 'src/main.cpp')
  assert.equal(editorTabTitle('lib/main.cpp', peers), 'lib/main.cpp')
  assert.equal(editorTabTitle('docs/readme.md', peers), 'readme.md')
  // peers 是**已打开**的标签：没打开的同名文件不参与。
  assert.equal(editorTabTitle('tools/main.cpp', ['src/main.cpp']), 'tools/main.cpp',
    '另一个同名标签开着时带目录（UniqueVFilePathBuilderImpl.kt:220-224 把同名的已打开文件都收进 builder）')
  assert.equal(editorTabTitle('tools/main.cpp', ['src/other.ts']), 'main.cpp', '没有同名标签就只给文件名')
})

// UniqueNameEditorTabTitleProvider.kt:36-38：开关关着整条跳过。
test('关掉「同名文件带目录」就退回裸文件名', () => {
  const peers = ['src/main.cpp', 'lib/main.cpp']
  assert.equal(uniqueEditorTabTitle('src/main.cpp', peers, { showDirectoryForNonUniqueFilenames: false }), null)
  assert.equal(editorTabTitle('src/main.cpp', peers, { showDirectoryForNonUniqueFilenames: false }), 'main.cpp')
})

// getEditorTabText（UniqueNameEditorTabTitleProvider.kt:23-31）+ FileUtilRt.java:439-442（取最后一个点）。
test('隐藏已知扩展名：去最后一个点，空结果或以分隔符结尾时原样返回', () => {
  assert.equal(editorTabText('src/main.cpp'), 'src/main.cpp', '默认关着（UISettingsState.kt:137-138）')
  assert.equal(editorTabText('src/main.cpp', true), 'src/main')
  assert.equal(editorTabText('src/my.config.json', true), 'src/my.config')
  assert.equal(editorTabText('src/main', true), 'src/main', '没有点可去')
  assert.equal(editorTabText('.gitignore', true), '.gitignore', '去空了就原样返回（:26-27）')
  assert.equal(editorTabText('src/', true), 'src/', '以分隔符结尾原样返回（:27）')
})

// EditorTabPresentationUtil.kt:33-47 + EditorTabTitleProvider.kt:23-30：第一个非空胜出。
test('自定义标题提供者按顺序取第一个非空；空值与抛错都跳到下一条', () => {
  const providers = [
    { id: 'empty', getEditorTabTitle: () => '' },
    { id: 'null', getEditorTabTitle: () => null },
    { id: 'boom', getEditorTabTitle: () => { throw new Error('provider 挂了') } },
    { id: 'readme', getEditorTabTitle: path => (path.endsWith('README.md') ? '说明' : null) },
    { id: 'later', getEditorTabTitle: path => (path.endsWith('main.cpp') ? '不该轮到我' : null) },
  ]
  assert.equal(getCustomEditorTabTitle('docs/README.md', providers), '说明')
  assert.equal(getCustomEditorTabTitle('src/main.cpp', providers), '不该轮到我', '前四条都空/抛错，轮到第五条')
  assert.equal(getCustomEditorTabTitle('src/other.ts', providers), null)
  assert.equal(editorTabTitle('docs/README.md', [], { providers }), '说明', '自定义标题压过唯一名（:19-20）')
  assert.equal(editorTabTitle('src/main.cpp', ['lib/main.cpp'], { providers }), '不该轮到我', '自定义标题压过目录后缀')
  assert.equal(editorTabTitle('src/main.cpp', ['lib/main.cpp']), 'src/main.cpp', '没有 provider 才轮到唯一名（:20-21）')
  assert.equal(getCustomEditorTabTitle('x'), null, '没有 provider 就是没有自定义标题')
})

// —— 接线：标签按钮那行字 ——
test('标签标题走 editorTabTitle，且不再写死 split(\'/\').pop()', () => {
  assert.match(app, /import \{ editorTabTitle \} from '\.\/tabTitle'/, 'App.vue 没有引入标签标题规则')
  assert.match(app, /\{\{ editorTabTitle\(tab\.path, allTabs\.map\(t => t\.path\)\) \}\}/,
    '标签按钮没有消费 editorTabTitle：规则再对，屏幕上还是裸文件名')
  assert.doesNotMatch(app, /<span>\{\{ tab\.path\.split\('\/'\)\.pop\(\) \}\}<\/span>/,
    '模板里还留着裸文件名短路，前面那条链根本走不到')
  // 反证：把消费换成裸文件名必须被这条抓到。
  assert.ok(!/editorTabTitle\(tab\.path/.test("{{ tab.path.split('/').pop() }}"), '反例本该不合格')
})
