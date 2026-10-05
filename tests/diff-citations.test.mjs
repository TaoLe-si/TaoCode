// 差异/比较/合并这一族的**上游坐标门禁**。
//
// 为什么单独要有这一条（2026-10-06 独立验收 H2 的直接后果）：
// 仓里既有的 `tests/source-citations.test.mjs` 只核「以 platform/… 开头的完整路径 + 行号没超文件长度」，
// 而本域 1295 条新增引用里 **82.6% 是裸文件名**（`ByWordRt.kt:610-630` 这种），一条都不在它覆盖内 ——
// H2 那条错 270 行的引用正是从这道缝里漏出去的，而它当时撑着两条被翻转的产品断言。
// 我今天在参考树里把本域引用逐条按图索骥走了一遍，又抓出 4 处同类（见 `ANCHORS` 里带「订正」的条目）。
//
// 两道检查：
//   ① `ANCHORS`：本域**承重**的上游坐标（撑产品断言的那些），必须在参考树里指定路径、
//      指定范围内命中指定符号 —— 文件对、行号漂 270 行这种就直接拦下；
//   ② `BARE_NAMES`：本域文件里出现的每一个裸文件名引用，都必须在这张已核过的表里；
//      新引用要先在参考树 `find -name` 解析后再登记（`MergedMainMenu.kt` 那种"文件名是编的"就拦下）。
// ③ 反向验证：表里喂一条已知漂移（`ByWordRt.kt:610-630` 配 `class DefaultCorrector`），必须判红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const DIFF = 'platform/util/diff/src/com/intellij/diff/comparison/'
const TOOLS = 'platform/diff-impl/src/com/intellij/diff/tools/util/'
const ACTIONS = 'platform/platform-resources-en/src/messages/ActionsBundle.properties'

/** 承重坐标表：`{ cite, path, from, to, must }` —— `must` 是**那一行区间里必须出现的符号**。 */
export const ANCHORS = [
  { cite: 'ByWordRt.kt:880-906', path: DIFF + 'ByWordRt.kt', from: 880, to: 906, must: /class DefaultCorrector/, why: '默认档让白（diff-chunks/diff-words 两条"标记吃掉相邻空格"的断言就靠它）' },
  { cite: 'ByWordRt.kt:890-893', path: DIFF + 'ByWordRt.kt', from: 890, to: 893, must: /expandWhitespacesBackward[\s\S]*expandWhitespacesForward/, why: '先后向再前向的**次序**本身' },
  { cite: 'ByWordRt.kt:610-623', path: DIFF + 'ByWordRt.kt', from: 610, to: 623, must: /private fun isTrailingSpace/, why: 'H2 被误当成 DefaultCorrector 的那一段，真身是 trim 档用的 isTrailingSpace' },
  { cite: 'ByWordRt.kt:989-1028', path: DIFF + 'ByWordRt.kt', from: 989, to: 1028, must: /class TrimSpacesCorrector/, why: 'isLeadingTrailingSpace 的唯一消费者（diffChars.ts 的 trim 档）' },
  { cite: 'ByWordRt.kt:638-683', path: DIFF + 'ByWordRt.kt', from: 638, to: 683, must: /fun getInlineChunks/, why: '词级 chunk 表只收词/连续文字/换行 —— tokenize 翻转的依据' },
  { cite: 'ByWordRt.kt:695-878', path: DIFF + 'ByWordRt.kt', from: 695, to: 878, must: /class AdjustmentPunctuationMatcher/, why: '标点只在未匹配词之间的空隙配对' },
  { cite: 'ByWordRt.kt:939-963', path: DIFF + 'ByWordRt.kt', from: 939, to: 963, must: /class IgnoreSpacesCorrector/, why: '忽略档"先前向后向"的相反次序' },
  { cite: 'TrimUtil.kt:394-409', path: DIFF + 'TrimUtil.kt', from: 394, to: 409, must: /expandIgnoredForward/, why: '让白循环' },
  { cite: 'TrimUtil.kt:411-424', path: DIFF + 'TrimUtil.kt', from: 411, to: 424, must: /expandIgnoredBackward/, why: '同一对循环；两者的 `start1 < end1 && start2 < end2` 守卫是空半边让不动的原因' },
  { cite: 'TrimUtil.kt:142-147', path: DIFF + 'TrimUtil.kt', from: 142, to: 147, must: /fun expandWhitespacesBackward/, why: '默认档调的那个包装' },
  { cite: 'TrimUtil.kt:16-22', path: DIFF + 'TrimUtil.kt', from: 16, to: 22, must: /fun isPunctuation/, why: '空格不是标点（所以空隙不会被标点匹配吃掉）' },
  { cite: 'ByCharRt.kt:259-270', path: DIFF + 'ByCharRt.kt', from: 259, to: 270, must: /getPunctuationChars/, why: '同上，字符级那条路' },
  { cite: 'ByLineRt.kt:135-166', path: DIFF + 'ByLineRt.kt', from: 135, to: 166, must: /correctChangesSecondStep/, why: '第二步的三条 Idea（1 留等、2 不新增、3 块内重配）' },
  { cite: 'ByLineRt.kt:335-348', path: DIFF + 'ByLineRt.kt', from: 335, to: 348, must: /fun compareSmart/, why: '第一步只对大行做 LCS —— "语义锚点允许少配"的依据' },
  { cite: 'ByLineRt.kt:350-362', path: DIFF + 'ByLineRt.kt', from: 350, to: 362, must: /fun getBigLines/, why: '大行判据（nonSpaceChars > threshold）' },
  { cite: 'ByLineRt.kt:61-81', path: DIFF + 'ByLineRt.kt', from: 61, to: 81, must: /internal fun doCompare/, why: 'DEFAULT 分支一条道走到底，没有"少配退回 LCS"的保底' },
  { cite: 'ChangeCorrector.kt:26-53', path: DIFF + 'ChangeCorrector.kt', from: 26, to: 53, must: /fun execute[\s\S]*abstract fun matchGap/, why: '空隙成对补比，跨不过锚点 ⇒ 配对数可比全局 LCS 少' },
  { cite: 'ChunkOptimizer.kt:90-98', path: DIFF + 'ChunkOptimizer.kt', from: 90, to: 98, must: /Minimise amount of chunks[\s\S]*Minimise amount of modified/, why: '"好/差"两条例子就是 diff-chunks 的期望值' },
  { cite: 'ChunkOptimizer.kt:33-40', path: DIFF + 'ChunkOptimizer.kt', from: 33, to: 40, must: /This should not happen/, why: '上游断言输入必须是 LCS —— 优化器只并不拆' },
  { cite: 'HighlightPolicy.java:27-45', path: TOOLS + 'base/HighlightPolicy.java', from: 27, to: 45, must: /isShouldCompare[\s\S]*isShouldSquash[\s\S]*getFragmentsPolicy/, why: '五个档位的三条正交属性' },
  { cite: 'IgnorePolicy.java:29-43', path: TOOLS + 'base/IgnorePolicy.java', from: 29, to: 43, must: /getComparisonPolicy[\s\S]*isShouldSquash[\s\S]*isShouldTrimChunks/, why: '比较策略映射 + 第四档 isShouldTrimChunks' },
  { cite: 'TextDiffSettingsHolder.kt:30', path: TOOLS + 'base/TextDiffSettingsHolder.kt', from: 30, to: 31, must: /CONTEXT_RANGE_MODES: IntArray = intArrayOf\(1, 2, 4, 8, -1\)/, why: '折叠五档上下文' },
  { cite: 'TextDiffSettingsHolder.kt:59-60', path: TOOLS + 'base/TextDiffSettingsHolder.kt', from: 59, to: 60, must: /EXPAND_BY_DEFAULT: Boolean = true[\s\S]*CONTEXT_RANGE: Int = 4/, why: '默认展开 + 默认档 4' },
  { cite: 'TextDiffSettingsHolder.kt:63', path: TOOLS + 'base/TextDiffSettingsHolder.kt', from: 63, to: 63, must: /ENABLE_SYNC_SCROLL: Boolean = true/, why: '同步滚动开关的默认档（diffFold.ts 原先把它写成 :64，本门控首跑就抓到）' },
  { cite: 'DiffConfig.kt:12', path: 'platform/util/diff/src/com/intellij/util/diff/DiffConfig.kt', from: 12, to: 12, must: /UNIMPORTANT_LINE_CHAR_COUNT: Int = 3/, why: '大行阈值 3' },
  { cite: 'MainMenuWithButton.kt:170-176', path: 'platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainMenuWithButton.kt', from: 170, to: 176, must: /class MergedMainMenu[\s\S]*Cache the item/, why: '宽度缓存注释；`MergedMainMenu.kt` 这个文件**不存在**（本域订正之一）' },
  { cite: 'ActionsBundle.properties:1564', path: ACTIONS, from: 1564, to: 1564, must: /^action\.ChangesView\.CreatePatch\.text=/, why: '补丁导出文案（原先写的 :127 是 Unselect Occurrence）' },
  { cite: 'ActionsBundle.properties:1583', path: ACTIONS, from: 1583, to: 1583, must: /^action\.ChangesView\.CreatePatchToClipboard\.text=/, why: '同上（原先写的 :131 是 Toggle Sticky Selection）' },
  { cite: 'ActionsBundle.properties:1998-2000', path: ACTIONS, from: 1998, to: 2000, must: /action\.CompareDirs\.text[\s\S]*action\.compare\.files\.text[\s\S]*action\.compare\.with\.text/, why: '比较三条文案（原先写的 :2496-2499 落在 ExternalSystem 段）' },
  { cite: 'ActionsBundle.properties:1422', path: ACTIONS, from: 1422, to: 1422, must: /^action\.Vcs\.Diff\.ToggleSearchInChanges\.text=/, why: '差异视图内查找的开关文案' },
  { cite: 'DiffBundle.properties:202', path: 'platform/diff-api/resources/messages/DiffBundle.properties', from: 202, to: 202, must: /^select\.file\.to\.compare=/, why: '选择器标题（原先写的 :252 是 Save and Close）' },
  { cite: 'VcsActions.xml:110-111', path: 'platform/vcs-impl/resources/META-INF/VcsActions.xml', from: 110, to: 111, must: /ChangesView\.ApplyPatch[\s\S]*ChangesView\.ApplyPatchFromClipboard/, why: '应用补丁两条动作的注册处' },
  { cite: 'ApplyPatchAction.java:29', path: 'platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/ApplyPatchAction.java', from: 29, to: 29, must: /class ApplyPatchAction/, why: '是 .java 不是 .kt（本域订正之一）' },
  { cite: 'GitMergeUtil.java:63-67', path: 'plugins/git4idea/backend/src/merge/GitMergeUtil.java', from: 63, to: 67, must: /./, why: '合并自动接受的判定链' },
]

/** 本域出现过的裸文件名 → 参考树里的唯一路径（`find -name` 逐条解析过；两份同名的已选生产那一份）。 */
export const BARE_NAMES = {
  'ByWordRt.kt': DIFF + 'ByWordRt.kt',
  'ByCharRt.kt': DIFF + 'ByCharRt.kt',
  'ByLineRt.kt': DIFF + 'ByLineRt.kt',
  'TrimUtil.kt': DIFF + 'TrimUtil.kt',
  'ChunkOptimizer.kt': DIFF + 'ChunkOptimizer.kt',
  'ChangeCorrector.kt': DIFF + 'ChangeCorrector.kt',
  'ComparisonPolicy.kt': DIFF + 'ComparisonPolicy.kt',
  'MergeResolveUtil.kt': DIFF + 'MergeResolveUtil.kt',
  'DiffIterableUtil.kt': DIFF + 'comparison/iterables/DiffIterableUtil.kt',
  'Diff.kt': 'platform/util/diff/src/com/intellij/util/diff/Diff.kt',
  'MyersLCS.kt': 'platform/util/diff/src/com/intellij/util/diff/MyersLCS.kt',
  'DiffConfig.kt': 'platform/util/diff/src/com/intellij/util/diff/DiffConfig.kt',
  'Enumerator.kt': 'platform/util/diff/src/com/intellij/diff/util/Enumerator.kt',
  'MergeRange.kt': 'platform/util/diff/src/com/intellij/diff/util/MergeRange.kt',
  'MergeRangeUtil.kt': 'platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt',
  'MergeConflictType.kt': 'platform/util/diff/src/com/intellij/diff/util/MergeConflictType.kt',
  'ThreeSide.kt': 'platform/util/diff/src/com/intellij/diff/util/ThreeSide.kt',
  'FoldingModelSupport.java': TOOLS + 'FoldingModelSupport.java',
  'PrevNextDifferenceIterableBase.java': TOOLS + 'PrevNextDifferenceIterableBase.java',
  'HighlightPolicy.java': TOOLS + 'base/HighlightPolicy.java',
  'IgnorePolicy.java': TOOLS + 'base/IgnorePolicy.java',
  'TextDiffSettingsHolder.kt': TOOLS + 'base/TextDiffSettingsHolder.kt',
  'TextDiffViewerUtil.java': TOOLS + 'base/TextDiffViewerUtil.java',
  'TwosideTextDiffProviderBase.java': TOOLS + 'text/TwosideTextDiffProviderBase.java',
  'MergeThreesideViewer.java': 'platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java',
  'CompareFilesAction.java': 'platform/diff-impl/src/com/intellij/diff/actions/CompareFilesAction.java',
  'DiffUserDataKeys.java': 'platform/diff-api/src/com/intellij/diff/util/DiffUserDataKeys.java',
  'GenericPatchApplier.java': 'platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/GenericPatchApplier.java',
  'ApplyPatchAction.java': 'platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/ApplyPatchAction.java',
  'ApplyPatchFromClipboardAction.java': 'platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/ApplyPatchFromClipboardAction.java',
  'GitMergeUtil.java': 'plugins/git4idea/backend/src/merge/GitMergeUtil.java',
  'MainMenuWithButton.kt': 'platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainMenuWithButton.kt',
  'ToolbarFrameHeader.kt': 'platform/platform-impl/src/com/intellij/openapi/wm/impl/customFrameDecorations/header/toolbar/ToolbarFrameHeader.kt',
  'HorizontalLayout.kt': 'platform/platform-api/src/com/intellij/ui/components/panels/HorizontalLayout.kt',
  'JBUI.java': 'platform/util/ui/src/com/intellij/util/ui/JBUI.java',
  'Strings.java': 'platform/util/base/src/com/intellij/openapi/util/text/Strings.java',
  'LivePreviewController.java': 'platform/lang-impl/src/com/intellij/find/impl/livePreview/LivePreviewController.java',
  'FindSettingsBase.java': 'platform/analysis-impl/src/com/intellij/find/impl/FindSettingsBase.java',
  'ActionsBundle.properties': ACTIONS,
  'DiffBundle.properties': 'platform/diff-api/resources/messages/DiffBundle.properties',
  'GitBundle.properties': 'plugins/git4idea/shared/resources/messages/GitBundle.properties',
  'PlatformActions.xml': 'platform/platform-impl/resources/idea/PlatformActions.xml',
  'VcsActions.xml': 'platform/vcs-impl/resources/META-INF/VcsActions.xml',
  'MergedMainMenu.kt': null,
  'ApplyPatchAction.kt': null,
  'ApplyPatchFromClipboardAction.kt': null,
}

const CITE = /(?:^|[^A-Za-z0-9_./$-])([A-Za-z0-9_.$]+)\.(kt|java|xml|properties)(?::(\d+)(?:-(\d+))?)?/g
const DOMAIN_FILE = /^(diff|merge|compare|patch)/
const TEST_FILE = /^(diff|merge|compare|patch)-/

/** 本域的文件清单（src/diff\*…、tests/diff-\*…、三个组件、native 宿主）。 */
export function domainFiles(dir) {
  const out = []
  for (const entry of readdirSync(join(root, dir))) {
    if (dir === 'src' && DOMAIN_FILE.test(entry) && /\.(ts)$/.test(entry)) out.push(`src/${entry}`)
    if (dir === 'tests' && TEST_FILE.test(entry) && entry.endsWith('.test.mjs')) out.push(`tests/${entry}`)
  }
  if (dir === 'src') out.push('components/DiffView.vue', 'components/MergeBar.vue', 'components/ChangedHunks.vue')
  if (dir === 'native') out.push('history_diff.cpp')
  return out.filter(f => existsSync(join(root, 'src', f).replace(/^[^/]*\//, '')) || existsSync(join(root, f)))
}

/** 读参考树里某个文件的行数组；读不到返回 null。 */
export function refLines(path) {
  const file = join(REF, path)
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n') : null
}

/** 核一条锚点，返回**不成立的原因**（null = 成立）。 */
export function checkAnchor(anchor, linesOf) {
  const lines = linesOf(anchor.path)
  if (lines === null) return `${anchor.cite} —— 参考树里没有 ${anchor.path}`
  if (anchor.to > lines.length) return `${anchor.cite} —— 行号超出文件长度（${anchor.to} > ${lines.length}）`
  const range = lines.slice(anchor.from - 1, anchor.to).join('\n')
  if (!anchor.must.test(range)) return `${anchor.cite} —— 该范围内找不到锚点 ${anchor.must}（行号漂移的征兆）`
  return null
}

/** 扫一组文本，返回**没登记**或**登记为不存在**的裸文件名引用。 */
export function bareNameProblems(texts, names = BARE_NAMES) {
  const bad = []
  for (const [file, text] of Object.entries(texts)) {
    for (const match of text.matchAll(CITE)) {
      const name = `${match[1]}.${match[2]}`
      if (name in names) { if (names[name] === null) bad.push(`${file} :: ${name} —— 参考树里没有这个文件（三条路都搜过，见表内说明）`); continue }
      if (/^(platform|plugins|java|kotlin|python|wire|tools)$/.test(name.split('.')[0])) continue
      if (/\.(ts|vue|mjs|cpp|css)$/.test(name)) continue
      if (/^(src|native|docs|tests|App|CodeEditor)$/.test(name.split('.')[0])) continue
      bad.push(`${file} :: ${name} —— 裸文件名引用没登记，先在参考树 find -name 解析再登记`)
    }
  }
  return bad
}

const domainTexts = {}
const SELF = 'diff-citations.test.mjs'
for (const rel of [...domainFiles('src'), ...domainFiles('tests'), ...domainFiles('native')]) {
  // 不扫本文件：表里**必须**留着几条已知编造的名字（`MergedMainMenu.kt` 那种）才能自证门控会响，
  // 把它们当本域的引用核就成了自己绊自己（`tests/source-citations.test.mjs:88` 同处理）。
  if (rel.endsWith(SELF)) continue
  const abs = join(root, rel)
  if (existsSync(abs)) domainTexts[rel] = readFileSync(abs, 'utf8')
}

test('门控自己会响：把 H2 那条 270 行漂移喂进去必须判红（反向验证）', () => {
  const drifted = { ...ANCHORS[0], cite: 'ByWordRt.kt:610-630', from: 610, to: 630 }
  const bad = checkAnchor(drifted, p => refLines(p))
  assert.ok(bad, '反证失败：范围漂了 270 行还能过，说明这条门控是空转的')
  assert.match(bad, /锚点/, `判红的原因不对：${bad}`)
  assert.equal(checkAnchor(ANCHORS[0], p => refLines(p)), null, '同一条把行号改回 880-906 就该成立')
})

test('门控也拦得住编造的文件名', () => {
  const texts = { 'src/example.ts': '上游 MergedMainMenu.kt:171-176 与 ByWordRt.kt:880-906' }
  const bad = bareNameProblems(texts)
  assert.deepEqual(bad.filter(b => b.includes('MergedMainMenu')),
    ['src/example.ts :: MergedMainMenu.kt —— 参考树里没有这个文件（三条路都搜过，见表内说明）'],
    '编造的文件名必须被点名，且只点这一个')
  assert.equal(bad.filter(b => b.includes('ByWordRt')).length, 0, '登记过的真引用不许被误伤')
})

test('承重坐标逐条开得到：范围存在、行号不越界、锚点符号就在那几行里', () => {
  if (!existsSync(REF)) return
  const bad = ANCHORS.map(a => checkAnchor(a, p => refLines(p))).filter(Boolean)
  assert.deepEqual(bad, [], `这些上游引用按图索骥会扑空：\n${bad.join('\n')}`)
})

test('本域每一条裸文件名引用都登记过（新引用要先解析再引）', () => {
  const bad = bareNameProblems(domainTexts)
  assert.deepEqual(bad, [], `这些裸文件名引用没在参考树里解析过：\n${bad.join('\n')}`)
})

test('登记表不是空表：锚点数量与本域引用密度对得上', () => {
  const cited = new Set()
  for (const text of Object.values(domainTexts)) {
    for (const match of text.matchAll(CITE)) cited.add(`${match[1]}.${match[2]}`)
  }
  assert.ok(ANCHORS.length >= 30, `承重坐标只剩 ${ANCHORS.length} 条：门控在被削弱`)
  assert.ok(cited.size >= 35, `本域只扫到 ${cited.size} 个上游文件名：文件清单或正则坏了`)
})
