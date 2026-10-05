// 「附加根时识别根」整条流程的判据（`src/libraryRootDetection.ts`，lp/roots ② 的另一半）。
//
// 上游依据（与源文件头同源）：
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/impl/LibraryRootsDetectorImpl.java:40-59`
//   · `java/idea-ui/src/com/intellij/openapi/roots/ui/configuration/JavaVfsSourceRootDetectionUtil.java:36-101`
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/impl/RootDetectionUtil.java:53-158`
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/impl/DetectedRootsChooserDialog.java:133-210`
import test from 'node:test'
import assert from 'node:assert/strict'
import { allRootsUnambiguous, attachChosenSuggestions, attachRootsPrompt, attachWithChosenType,
         chooseRootTypesText, detectedRootsChooserText, detectedRootsTree, detectRoots, detectRootsForAttach,
         isSkippedScanDirectory, JAVA_SOURCE_ROOT_DETECTOR, libraryRootTypeKeyOf, rootTypeName, SCANNING_ROOTS_PROGRESS,
         selectSuggestedRootType, sourceRootForJavaFile, suggestedRootTypeNames, suggestJavaSourceRoots } from '../src/libraryRootDetection.ts'
import { libraryRootType } from '../src/libraryModel.ts'

const pkg = name => `package ${name};\n\npublic class A {}\n`
const textOfMap = map => path => (Object.prototype.hasOwnProperty.call(map, path) ? map[path] : null)

test('包名解析只认 package 声明（JavaVfsSourceRootDetectionUtil 的 getPackageName 口径）', () => {
  assert.equal(sourceRootForJavaFile('x/p/A.java', textOfMap({ 'x/p/A.java': pkg('p') })), 'x')
  assert.equal(sourceRootForJavaFile('x/a/b/A.java', textOfMap({ 'x/a/b/A.java': pkg('a.b') })), 'x')
  assert.equal(sourceRootForJavaFile('x/a/b/A.java', textOfMap({ 'x/a/b/A.java': pkg('a.c') })), null,
    '任一段对不上就整条放弃（猜错会把整棵子树当源码根）')
  assert.equal(sourceRootForJavaFile('x/A.java', textOfMap({ 'x/A.java': pkg('p') })), null,
    '推出来是工作区根本身时不报（本仓 sourcePaths 存不下空路径，见 isUsableRootPath）')
  assert.equal(sourceRootForJavaFile('x/p/A.java', textOfMap({})), null, '读不到文本不当根，也不当「无包名」')
  assert.equal(sourceRootForJavaFile('x/p/A.java', textOfMap({ 'x/p/A.java': 'public class A {}' })), null, '没有 package 声明不算根')
})

test('包名与目录名按大小写不敏感比对（Windows 宿主，:87 的口径）', () => {
  assert.equal(sourceRootForJavaFile('X/P/A.java', textOfMap({ 'X/P/A.java': pkg('p') })), 'X')
  assert.equal(sourceRootForJavaFile('X/P/A.java', textOfMap({ 'X/P/A.java': pkg('P') })), 'X')
})

test('testData 前缀的目录整棵跳过（:50-52 的 SKIP_CHILDREN）', () => {
  assert.equal(isSkippedScanDirectory('testData'), true)
  assert.equal(isSkippedScanDirectory('TestData-2'), true)
  assert.equal(isSkippedScanDirectory('data'), false)
  const files = ['lib/p/A.java', 'lib/testData/p/B.java', 'lib/inner/testDataX/p/C.java']
  const map = { 'lib/p/A.java': pkg('p'), 'lib/testData/p/B.java': pkg('p'), 'lib/inner/testDataX/p/C.java': pkg('p') }
  assert.deepEqual(suggestJavaSourceRoots('lib', files, textOfMap(map)), ['lib'],
    '命中 testData 的那棵子树不参与检出，其它兄弟目录照收')
})

test('同一棵子树不重复收根（skipTo(root) 的等价物）', () => {
  const files = ['lib/x/p/A.java', 'lib/x/p/B.java', 'lib/x/q/C.java']
  const map = { 'lib/x/p/A.java': pkg('p'), 'lib/x/p/B.java': pkg('p'), 'lib/x/q/C.java': pkg('q') }
  assert.deepEqual(suggestJavaSourceRoots('lib', files, textOfMap(map)), ['lib/x'])
})

test('非目录候选（jar 文件）检不出根', () => {
  assert.deepEqual(suggestJavaSourceRoots('lib/a.jar', ['lib/a.jar'], textOfMap({})), [])
})

test('LibraryRootsDetectorImpl.detectRoots：逐候选逐检测器平铺，同文件多类型合成一条（:40-49）', () => {
  const classesFile = () => ({
    rootType: libraryRootType('classes', false),
    presentableRootTypeName: 'classes',
    detectRoots: (current, under) => under.filter(file => file === `${current}/x`),
  })
  const sourcesFile = () => ({
    rootType: libraryRootType('sources', false),
    presentableRootTypeName: 'sources',
    detectRoots: (current, under) => under.filter(file => file === `${current}/x`),
  })
  const single = detectRoots([JAVA_SOURCE_ROOT_DETECTOR], ['lib'], ['lib/p/A.java'], textOfMap({ 'lib/p/A.java': pkg('p') }))
  assert.deepEqual(single, [{ candidate: 'lib', file: 'lib', types: [libraryRootType('sources')] }])
  const merged = detectRoots([sourcesFile(), classesFile()], ['lib'], ['lib/x'], () => null)
  assert.equal(merged.length, 1, '同一 (候选, 文件) 只有一条记录')
  assert.deepEqual(merged[0].types.map(item => item.type), ['sources', 'classes'], '类型按检测器顺序累积')
  assert.deepEqual(detectRoots([classesFile()], ['lib', 'app'], ['lib/x', 'app/x'], () => null).map(item => [item.candidate, item.file]),
    [['lib', 'lib/x'], ['app', 'app/x']], '逐候选平铺，顺序跟随候选')
  assert.deepEqual(detectRoots([classesFile()], ['lib'], ['other/x', 'libprefix/x'], () => null), [],
    '候选下的清单按 `${candidate}/` 前缀取，兄弟目录同前缀不算')
  assert.equal(rootTypeName([JAVA_SOURCE_ROOT_DETECTOR], libraryRootType('sources', true)), null,
    '按 (类型, jarDirectory) 查名，查不到就 null（:52-59）')
  assert.equal(rootTypeName([JAVA_SOURCE_ROOT_DETECTOR], libraryRootType('sources')), 'sources')
  assert.equal(libraryRootTypeKeyOf(libraryRootType('classes', true)), 'classes|1')
})

test('allRootsUnambiguous：类型唯一且根等于候选或其直接子目录（:151-158）', () => {
  const one = [{ candidate: 'lib', file: 'lib', types: [libraryRootType('sources')] }]
  assert.equal(allRootsUnambiguous(one, 'lib'), true)
  assert.equal(allRootsUnambiguous([{ candidate: 'lib', file: 'lib/x', types: [libraryRootType('sources')] }], 'lib'), true)
  assert.equal(allRootsUnambiguous([{ candidate: 'lib', file: 'lib/x/y', types: [libraryRootType('sources')] }], 'lib'), false)
  assert.equal(allRootsUnambiguous([{ candidate: 'lib', file: 'lib', types: [libraryRootType('sources'), libraryRootType('classes')] }], 'lib'), false)
})

test('detectRootsForAttach：能直接收就不弹框（:64-69）', () => {
  const outcome = detectRootsForAttach({
    detectors: [JAVA_SOURCE_ROOT_DETECTOR], candidates: ['lib/srcs'], files: ['lib/srcs/p/A.java'],
    textOf: textOfMap({ 'lib/srcs/p/A.java': pkg('p') }),
  })
  assert.equal(outcome.kind, 'auto')
  assert.deepEqual(outcome.roots, [{ file: 'lib/srcs', type: libraryRootType('sources') }])
})

test('detectRootsForAttach：检出深一层就整批转成建议（:70-80 + :88-99）', () => {
  const outcome = detectRootsForAttach({
    detectors: [JAVA_SOURCE_ROOT_DETECTOR], candidates: ['lib'], files: ['lib/x/y/p/A.java'],
    textOf: textOfMap({ 'lib/x/y/p/A.java': pkg('p') }),
  })
  assert.equal(outcome.kind, 'choose')
  assert.deepEqual(outcome.suggestions.map(item => [item.rootCandidate, item.detectedRoot.file]), [['lib', 'lib/x/y']])
  assert.deepEqual(attachChosenSuggestions(outcome.suggestions), [{ file: 'lib/x/y', type: libraryRootType('sources') }])
  assert.deepEqual(attachChosenSuggestions([]), [], '用户取消 ⇒ 什么都不附加')
})

test('detectRootsForAttach：什么都没检出时的两级兜底（:101-146）', () => {
  const single = detectRootsForAttach({ detectors: [JAVA_SOURCE_ROOT_DETECTOR], candidates: ['lib'], files: [], allowedTypes: [libraryRootType('sources')] })
  assert.deepEqual(single, { kind: 'askSingleType', typeName: 'sources', type: libraryRootType('sources') })
  const jarPair = [
    { rootType: libraryRootType('classes', false), presentableRootTypeName: 'classes', detectRoots: () => [] },
    { rootType: libraryRootType('classes', true), presentableRootTypeName: 'classes (jar directories)', detectRoots: () => [] },
  ]
  const many = detectRootsForAttach({ detectors: jarPair, candidates: ['lib'], files: [], allowedTypes: [libraryRootType('classes')] })
  assert.deepEqual(many, { kind: 'askTypes', typeNames: ['classes', 'classes (jar directories)'] })
  assert.deepEqual(detectRootsForAttach({ detectors: [JAVA_SOURCE_ROOT_DETECTOR], candidates: ['lib'], files: [] }), { kind: 'none' },
    '没给 allowedTypes 就是什么都不问')
  assert.deepEqual(attachWithChosenType(['a', 'b'], libraryRootType('classes'), ['classes']),
    [{ file: 'a', type: libraryRootType('classes') }, { file: 'b', type: libraryRootType('classes') }],
    '用户选的类型套到**全部**候选上（:121-126）')
  assert.deepEqual(attachWithChosenType(['a'], libraryRootType('classes'), []), [], '取消 ⇒ 空')
})

test('建议行的类型切换按可显示名反查（SuggestedChildRootInfo.java:23/:42-55）', () => {
  const classesType = libraryRootType('classes')
  const sourcesType = libraryRootType('sources')
  const outcome = detectRootsForAttach({
    detectors: [
      { rootType: sourcesType, presentableRootTypeName: 'sources', detectRoots: (candidate, under) => under.filter(file => file === `${candidate}/x`) },
      { rootType: classesType, presentableRootTypeName: 'classes', detectRoots: (candidate, under) => under.filter(file => file === `${candidate}/x`) },
    ],
    candidates: ['lib'], files: ['lib/x'], textOf: () => null,
  })
  assert.equal(outcome.kind, 'choose', '多类型 ⇒ 不是「唯一类型」，必须让用户挑')
  assert.equal(outcome.suggestions.length, 1)
  const info = outcome.suggestions[0]
  assert.deepEqual(info.detectedRoot.types.map(item => item.type), ['sources', 'classes'])
  assert.deepEqual(info.typeNames, { 'sources|0': 'sources', 'classes|0': 'classes' })
  assert.equal(info.selectedType.type, 'sources', '默认选中第一个类型')
  assert.deepEqual(suggestedRootTypeNames(info), ['classes', 'sources'], '可显示名大小写不敏感排序')
  assert.equal(selectSuggestedRootType(info, 'classes').selectedType, classesType)
  assert.equal(selectSuggestedRootType(info, '没有这个类型').selectedType, info.selectedType, '认不出的名字不改选区')
  assert.deepEqual(attachChosenSuggestions([selectSuggestedRootType(info, 'classes')]), [{ file: 'lib/x', type: classesType }])
})

test('DetectedRootsChooserDialog 的树：候选按 presentable url 排序，叶子是相对路径（:133-210）', () => {
  const suggestions = [
    { rootCandidate: 'lib', detectedRoot: { candidate: 'lib', file: 'lib', types: [libraryRootType('classes')] }, typeNames: { 'classes|0': 'classes' }, selectedType: libraryRootType('classes') },
    { rootCandidate: 'app', detectedRoot: { candidate: 'app', file: 'app/src', types: [libraryRootType('sources')] }, typeNames: { 'sources|0': 'sources' }, selectedType: libraryRootType('sources') },
    { rootCandidate: 'app', detectedRoot: { candidate: 'app', file: 'app/res', types: [libraryRootType('resources')] }, typeNames: { 'resources|0': 'resources' }, selectedType: libraryRootType('resources') },
  ]
  const tree = detectedRootsTree(suggestions)
  assert.equal(tree.file, null, '假根不渲染')
  assert.deepEqual(tree.children.map(node => node.file), ['app', 'lib'])
  assert.deepEqual(tree.children.map(node => node.path), ['app', 'lib'], '候选节点带完整路径（渲染层落库用它）')
  assert.deepEqual(tree.children[0].children.map(node => node.path), ['app/res', 'app/src'], '叶子的 path 是完整路径、file 是相对形式')
  assert.deepEqual(tree.children[0].children.map(node => node.file), ['res', 'src'], '同一候选下的检出根按自己的 url 排')
  assert.deepEqual(tree.children[0].children.map(node => node.typeName), ['resources', 'sources'])
  assert.equal(tree.children[1].children[0].file, '/', '检出根就是候选本身时退成根分隔符')
  assert.equal(tree.children[0].children[0].editableType, false, '单类型行不可编辑（:97）')
  const out = detectedRootsTree([
    { rootCandidate: 'lib/srcs', detectedRoot: { candidate: 'lib/srcs', file: 'lib', types: [libraryRootType('classes')] }, typeNames: { 'classes|0': 'classes' }, selectedType: libraryRootType('classes') },
  ])
  assert.equal(out.children[0].children[0].invalid, true, '相对形式取不到 ⇒ 标 [无效]（:154-157）')
  assert.equal(out.children[0].children[0].file, 'lib')
  const many = detectedRootsTree([
    { rootCandidate: 'lib', detectedRoot: { candidate: 'lib', file: 'lib/x', types: [libraryRootType('classes'), libraryRootType('sources')] }, typeNames: { 'classes|0': 'classes' }, selectedType: libraryRootType('classes') },
  ])
  assert.equal(many.children[0].children[0].editableType, true)
})

test('对话框文案与进度标题（bundle 中文字符串，不猜）', () => {
  assert.deepEqual(detectedRootsChooserText('TaoCode', 1), {
    title: '检测到的根', section: '选择根',
    description: 'TaoCode 刚刚扫描了文件，检测到以下1 个根。<br>选择下面树中的项或按“取消”取消操作。',
  })
  assert.match(detectedRootsChooserText('TaoCode', 3).description, /以下3 个根/)
  assert.deepEqual(attachRootsPrompt('TaoCode', 'sources'), {
    title: '附加根', message: "TaoCode 无法确定所选项包含的文件种类。是否要将它们附加为 'sources'?",
  })
  assert.equal(chooseRootTypesText('TaoCode').title, '选择所选文件的类别')
  assert.equal(SCANNING_ROOTS_PROGRESS, '正在扫描根…')
})
