// 自定义折叠的 **provider 表**（`lp/custom-folding` 判决缺项之三「按 provider 的标记配置面」）：
// 上游那条扩展点在社区树里只注册了两条实现，本仓把「标记 / 占位文字 / 描述 / 默认折叠」做成一张数据表，
// 由折叠区间、区域列表与占位三处共同读。
//
// 逐条对的上游坐标：
//   · 注册表 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466-1467`
//     （NetBeans 在前、VisualStudio 在后）与 EP 声明 `platform/core-api/resources/intellij.platform.core.xml:40`；
//   · 判定 `NetBeansCustomFoldingProvider.java:14-21`（`contains`）/
//     `VisualStudioCustomFoldingProvider.java:13-20`（前导字符类 `[/*#-]*\s*region`）；
//   · 占位 `NetBeansCustomFoldingProvider.java:23-27` / `VisualStudioCustomFoldingProvider.java:22-27`
//     （两个空值分支都是 `...`，`CustomFoldingBuilder.java:117-119` 的单参数重载也是）；
//   · 描述 `platform/lang-api/resources/messages/LangBundle.properties:294-295`，
//     中文取 `localization-zh.jar` 的 `messages/LangBundle.properties:113-114`；
//   · 生成用的标记串 `getStartString`/`getEndString`：`NetBeansCustomFoldingProvider.java:36-43`、
//     `VisualStudioCustomFoldingProvider.java:36-43`，`?` → `Description` 见
//     `CustomFoldingSurroundDescriptor.java:47`（`DEFAULT_DESC_TEXT`）与 `:300-304`（替换并把那段选上）；
//   · 默认折叠 `NetBeansCustomFoldingProvider.java:46-48`（`defaultstate="collapsed"`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CUSTOM_FOLDING_PROVIDERS, collapsedByDefaultMarker, commentMarkerBody, markerKindOf, placeholderOf,
} from '../src/customFoldingProviders.ts'
import { localRegionFolds, regionMarker } from '../src/editorFolding.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('表就是上游那两条 provider，顺序照注册表，第三条是本仓的默认标记', () => {
  assert.deepEqual(CUSTOM_FOLDING_PROVIDERS.map(provider => provider.id), [
    'NetBeansCustomFoldingProvider', 'VisualStudioCustomFoldingProvider', '',
  ], '注册顺序 = intellij.platform.lang.impl.xml:1466-1467；`<region>` 一族社区树里没有实现类')
  // 描述逐字取随 IDE 发货的中文包（LangBundle.properties:113-114）。
  assert.deepEqual(CUSTOM_FOLDING_PROVIDERS.map(provider => provider.description), [
    '<editor-fold…> 注释', 'region…endregion 注释', '折叠区域 //<region>',
  ])
  // getStartString/getEndString 原样照 provider（`?` 是说明占位符）。
  assert.deepEqual(CUSTOM_FOLDING_PROVIDERS.map(provider => [provider.startString, provider.endString]), [
    ['<editor-fold desc="?">', '</editor-fold>'],
    ['region ?', 'endregion'],
    ['<region ?>', '</region>'],
  ])
})

test('标记识别：两条 provider 各自的判定口径', () => {
  // NetBeans 用 contains（`:14-21`），行首锚定不住 —— 前缀剥完仍然认。
  assert.equal(markerKindOf(commentMarkerBody('// <editor-fold desc="状态机">'))?.kind, 'start')
  assert.equal(markerKindOf(commentMarkerBody('// </editor-fold>'))?.kind, 'end')
  assert.equal(markerKindOf(commentMarkerBody('/* <editor-fold desc="x"> */'))?.provider.id, 'NetBeansCustomFoldingProvider',
    '块注释形态也算：上游判的是整个注释 token 文本')
  // VS 的前导字符类 `[/*#-]*`（`:14`）：`#`、`//`、`/*`、`--` 与它们的混合都吃。
  for (const line of ['#region 模型', '//#region 模型', '/* region 模型 */', '--region 模型', ';#region 模型']) {
    assert.equal(markerKindOf(commentMarkerBody(line))?.kind, 'start', `${line} 该是开始标记`)
  }
  for (const line of ['#endregion', '//#endregion', '/* endregion */', '--endregion']) {
    assert.equal(markerKindOf(commentMarkerBody(line))?.kind, 'end', `${line} 该是结束标记`)
  }
  // `#pragma region` 那一支（`:21` 的形态）与尾注（`region: 说明`）。
  assert.equal(markerKindOf(commentMarkerBody('#pragma region Foo'))?.kind, 'start')
  assert.equal(markerKindOf(commentMarkerBody('// region: 构造'))?.kind, 'start')
  // 认不出来的：没有注释前缀、词不完整、`<region>` 一族以外的尖括号形态。
  assert.equal(markerKindOf(commentMarkerBody('region')), null, '不是注释行')
  assert.equal(markerKindOf(commentMarkerBody('// regional settings')), null)
  assert.equal(markerKindOf(commentMarkerBody('//<regions>')), null)
  assert.equal(markerKindOf(commentMarkerBody('')), null)
})

test('占位文字：两个 provider 的取法与同一个 `...` 空值分支', () => {
  assert.equal(placeholderOf(commentMarkerBody('//<editor-fold desc="状态机">')), '状态机')
  // `desc=""` —— 正则匹配但捕获为空，走 `:26` 那条空值分支（上游 replaceFirst 后 trim 得空串）。
  assert.equal(placeholderOf(commentMarkerBody('//<editor-fold desc="">')), '...')
  assert.equal(placeholderOf(commentMarkerBody('#pragma region Foo')), 'Foo')
  assert.equal(placeholderOf(commentMarkerBody('//#region render')), 'render')
  assert.equal(placeholderOf(commentMarkerBody('/* region 块 */')), '块', '`startsWith("/*")` 那一支要去掉尾巴的 `*/`（:25）')
  assert.equal(placeholderOf(commentMarkerBody('//<region 构造>')), '构造')
  assert.equal(placeholderOf(commentMarkerBody('//<region desc="属性">')), '属性')
  assert.equal(placeholderOf(commentMarkerBody('//<region>')), '...')
  assert.equal(placeholderOf(commentMarkerBody('// 与 region 无关')), '...', '不是标记 → 没有占位可取')
  // 结束标记不产占位：上游只对开始标记问 provider（`CustomFoldingBuilder.java:131-136`）。
  assert.equal(placeholderOf(commentMarkerBody('//</region>')), '...')
  // **正则不匹配 ≠ 捕获为空**：Java 的 `replaceFirst` 不匹配时原样返回入参
  // （`NetBeansCustomFoldingProvider.java:25-26`）⇒ 没有 `desc` 属性时占位就是整段元素文本。
  assert.equal(placeholderOf(commentMarkerBody('//<editor-fold>')), '<editor-fold>',
    '没给元素文本时退回剥过前缀的正文（本仓的旧调用形状），同样是「原样返回入参」那一档')
  assert.equal(placeholderOf(commentMarkerBody('//<editor-fold>'), '//<editor-fold>'), '//<editor-fold>')
  assert.equal(placeholderOf(commentMarkerBody('//<editor-fold desc="">'), '//<editor-fold desc="">'), '...',
    '正则**匹配**但捕获为空才是 `...` 那一档（`:26` 的 isEmpty 分支）')
  // `defaultstate="collapsed"` 不影响占位：那条正则里没有 desc ⇒ 回吐整段文本（与上游同）。
  assert.equal(placeholderOf(commentMarkerBody('//<editor-fold defaultstate="collapsed">'),
    '//<editor-fold defaultstate="collapsed">'), '//<editor-fold defaultstate="collapsed">')
  assert.equal(placeholderOf(commentMarkerBody('#region 说明'), '#region 说明'), '说明',
    'VS 那一支的正则总能匹配 ⇒ 第二实参用不上（`:24`）')
})

test('defaultstate="collapsed" 单独认：全局开关关着也默认折', () => {
  assert.equal(collapsedByDefaultMarker(commentMarkerBody('//<editor-fold desc="x" defaultstate="collapsed">')), true)
  assert.equal(collapsedByDefaultMarker(commentMarkerBody('//<editor-fold desc="x">')), false)
  assert.equal(collapsedByDefaultMarker(commentMarkerBody('//</editor-fold>')), false, '结束标记不问这条')
  const folds = localRegionFolds('//<editor-fold desc="x" defaultstate="collapsed">\na\n//</editor-fold>\n//<region y>\nb\n//</region>')
  assert.deepEqual(folds, [
    { startLine: 0, endLine: 2, kind: 'region', collapseByDefault: true },
    { startLine: 3, endLine: 5, kind: 'region' },
  ], '只有带 defaultstate 的那条带这个字段')
})

test('编辑器里的标记识别只有一处：regionMarker 读的就是这张表', () => {
  assert.equal(regionMarker('//#region render'), 'start', '上一版漏了 `//` 之后的 `#`，这条现在认了')
  assert.equal(regionMarker('//#endregion'), 'end')
  const folding = read('src/editorFolding.ts')
  assert.match(folding, /import \{ collapsedByDefaultMarker, commentMarkerBody, markerKindOf \} from '\.\/customFoldingProviders\.ts'/)
  assert.match(folding, /return markerKindOf\(regionMarkerBody\(line\)\)\?\.kind \?\? null/, '判定只有表里那一份')
  assert.match(folding, /out\.push\(collapsedByDefaultMarker\(regionMarkerBody\(lines\[start\]\)\)/)
  // 管道里那一步：按 kind 折完族之后，再逐条问 defaultstate（顺序在两族之间，不破坏既有的六步判据）。
  const controller = read('src/editorFoldingController.ts')
  assert.match(controller, /for \(const entry of deps\.foldingKinds\(\)\) foldKinds\(view, \[entry\.kind\], entry\.collapse\)\s*\n\s*foldDefaultCollapsed\(view\)/)
  assert.match(read('src/editorFolding.ts'), /export function foldDefaultCollapsed\(view: EditorView\): boolean/)
})
