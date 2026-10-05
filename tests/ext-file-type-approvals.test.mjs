// 「关联冲突的审批」与「按文件覆盖成任意类型」两族行为（桶 15 · ic/file-types + pf/file-types + lp/exclude）。
//
// 上游依据（逐条对着读）：
//   · `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/RemovedMappingTracker.java:98-114`
//     （add 覆盖同 (matcher,type)）、`:129-149`（read：ext 优先、缺 type 跳过）、
//     `:151-160`（save 的排序）、`:197-215`（removeIf 返回被删的那些）、`:217-224`（整批批准）
//   · `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:1591-1623`
//     （associate 的四处账本判定）与 `:1849-1852`（认领成功即撤销摘除记录）、`:1864-1874`（removeAssociation 本身不记账）
//   · `platform/lang-impl/src/com/intellij/openapi/file/exclude/OverrideFileTypeManager.java:48-54/:69-78/:83-90`
//     `OverrideFileTypeAction.java:53-76`（列表按显示名大小写不敏感排序、只列可当目标的、重名提示）
//     `UserFileTypeOverrider.java:17-24` + `FileTypeManagerImpl.java:916-923`（覆盖优先于按名字/内容的判定）
//   · `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/ReparseUtil.kt:11-17`
//     + `PersistentFileSetManager.java:90-96`（clearCache + reparseFiles）
//   · `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeDetectionService.java:330-340`
//     （探测器表一变，缓存整批作废）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RemovedMappingTracker, approveUnapprovedAfterLoad, fromRecord, removedMappingText, sameRemovedMapping,
} from '../src/fileTypeRemovedMappings.ts'
import {
  FileTypeManager, NATIVE_FILE_TYPE_ID, STANDARD_FILE_TYPES, fileTypeManager, parseFileNameMatcher,
  presentableMatcher, resolveFileTypeConflict, userFileType,
} from '../src/fileTypeRegistry.ts'
import {
  clearFileTypeDetectionCache, detectFileType, detectFileTypeCached, fileTypeDetectionCacheSize,
  fileTypeRevision, reparseFileTypes, resolveEditorLanguage,
} from '../src/fileTypeDetection.ts'
import {
  changeFileTypeOverride, clearFileTypeOverrides, fileTypeOverrideRows, isAvailableForOverride, isOverridableType,
  overridableFileTypes, overrideFailureReason, overrideFileType, overrideTargetOf, PLAIN_TEXT_TYPE, revertFileType,
} from '../src/fileTypeOverrides.ts'

const ext = name => ({ kind: 'extension', extension: name })
/** 每次造一份**新**的注册表：冲突与账本判定要互不污染（进程内单例只在最后两条测试里动）。 */
const freshManager = () => new FileTypeManager(STANDARD_FILE_TYPES.map(type => ({ ...type })))

// ── RemovedMappingTracker 本体 ────────────────────────────────────────────────────────

test('add：同 (匹配器, 类型) 是**替换**而不是并存（上游 :98-114）', () => {
  const tracker = new RemovedMappingTracker()
  tracker.add(ext('foo'), 'JSON', false)
  tracker.add(ext('foo'), 'JSON', true)
  assert.equal(tracker.getRemovedMappings().length, 1)
  assert.equal(tracker.isApproved(ext('foo'), 'JSON'), true)
  // 同一匹配器、不同类型各留一条（上游是 MultiMap<matcher, RemovedMapping>，`:85`）。
  tracker.add(ext('foo'), 'XML', false)
  assert.equal(tracker.getRemovedMappings().length, 2)
  assert.deepEqual(tracker.getMappingsForFileType('XML').map(presentableMatcher), ['*.foo'])
  assert.equal(tracker.hasRemovedMapping(parseFileNameMatcher('Makefile')), false)
})

test('equals 不看 approved；文案照上游 toString（:61-75）', () => {
  const left = { matcher: ext('bar'), typeName: 'JSON', approved: false }
  const right = { matcher: ext('bar'), typeName: 'JSON', approved: true }
  assert.equal(sameRemovedMapping(left, right), true)
  assert.equal(removedMappingText(left), "Removed mapping '*.bar' -> JSON")
  assert.equal(sameRemovedMapping(left, { ...left, typeName: 'XML' }), false)
})

test('approveUnapprovedMappings 只动未批准的，批完待确认为 0（:217-224）', () => {
  const tracker = new RemovedMappingTracker()
  tracker.add(ext('a'), 'JSON', false)
  tracker.add(ext('b'), 'XML', true)
  const flipped = approveUnapprovedAfterLoad(tracker)
  assert.deepEqual(flipped.map(mapping => mapping.typeName), ['JSON'])
  assert.deepEqual(tracker.unapprovedMappings(), [])
  assert.equal(tracker.isApproved(ext('a'), 'JSON'), true)
  assert.equal(tracker.isApproved(ext('b'), 'XML'), true)
})

test('removeIf 返回被删掉的那些（:197-215）', () => {
  const tracker = new RemovedMappingTracker()
  tracker.add(ext('a'), 'JSON', false)
  tracker.add(ext('b'), 'XML', false)
  const removed = tracker.removeIf(mapping => mapping.typeName === 'XML')
  assert.deepEqual(removed.map(mapping => mapping.typeName), ['XML'])
  assert.equal(tracker.getRemovedMappings().length, 1)
})

test('序列化字段名照上游的三个属性：ext / pattern / type / approved（:151-160 + AbstractFileType.java:297-345）', () => {
  const tracker = new RemovedMappingTracker()
  tracker.add(ext('zz'), 'JSON', true)
  tracker.add(ext('aa'), 'JSON', false)
  tracker.add(parseFileNameMatcher('Makefile'), 'XML', true)
  const records = tracker.serialize()
  // 先按 presentable matcher 的**码元序**排、再按类型名（`:153` 用的是 String.compareTo，
  // 不是 locale 序 —— `*`(U+002A) 一定排在字母前面）。
  assert.deepEqual(records.map(record => record.ext ?? record.pattern), ['aa', 'zz', 'Makefile'])
  assert.deepEqual(records.find(record => record.ext === 'zz'), { ext: 'zz', type: 'JSON', approved: true })
  // 未批准时**不写** approved 字段（上游只在 true 时写那个属性，`:234-236`）。
  assert.deepEqual(records.find(record => record.ext === 'aa'), { ext: 'aa', type: 'JSON' })
})

test('反解：ext 优先于 pattern、缺 type 的条目整条跳过（:129-149）', () => {
  assert.deepEqual(fromRecord({ ext: 'foo', pattern: 'x', type: 'JSON' }), { matcher: ext('foo'), typeName: 'JSON', approved: false })
  assert.equal(fromRecord({ ext: 'foo' }), null)
  assert.equal(fromRecord({ pattern: '*.foo', type: 'XML' }).matcher.kind, 'wildcard')
  assert.equal(fromRecord({ pattern: 'Makefile', type: 'XML' }).matcher.kind, 'exact')
  assert.equal(fromRecord({ pattern: 'Makefile', type: 'XML', approved: true }).approved, true)
  assert.equal(fromRecord(null), null)
})

test('load 对重复记录告警但只落一条（上游 LOG.warn + 去重，:116-127）', () => {
  const warnings = []
  const tracker = RemovedMappingTracker.load([
    { ext: 'foo', type: 'JSON' },
    { ext: 'foo', type: 'JSON', approved: true },
    { ext: 'bar', type: 'XML' },
  ], text => warnings.push(text))
  assert.equal(tracker.getRemovedMappings().length, 2)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /重复的 removed_mapping/)
  // 重复的那条按 Map 覆盖取**后者**（approved 生效）—— 判据固定住这条口径，别再改语义。
  assert.equal(tracker.isApproved(ext('foo'), 'JSON'), true)
})

test('坏数据整批不吃：非数组、缺字段、类型名不是字符串（:116-127 的宽容面）', () => {
  const tracker = RemovedMappingTracker.load(['x', 7, null, { ext: 'foo', type: 5 }, { pattern: ' ', type: 'JSON' }])
  assert.deepEqual(tracker.getRemovedMappings(), [])
})

// ── 注册表消费：associate 的四处判定 ──────────────────────────────────────────────────

test('摘除过的类型**抢不回**那条模式（FileTypeManagerImpl.java:1591-1595 的注册路径）', () => {
  const manager = freshManager()
  manager.register(userFileType('MyType', 'MyType', 'other', [ext('ziz')]))
  assert.equal(manager.getFileTypeByFileName('a.ziz').id, 'MyType')
  // 用户把 *.ziz 从 MyType 摘掉（approved=true 就是「用户点的头」那条 add(…, true)）。
  manager.removeAssociation('MyType', ext('ziz'), true)
  assert.deepEqual(manager.getAssociations('MyType').map(presentableMatcher), [])
  // 该类型**重新注册**（EP/插件声明那条路）也抢不回来。
  manager.register(userFileType('MyType', 'MyType', 'other', [ext('ziz'), ext('zuz')]))
  assert.deepEqual(manager.getAssociations('MyType').map(presentableMatcher), ['*.zuz'])
  assert.equal(manager.removedMappings().wasRemovedFrom(ext('ziz'), 'MyType'), true)
  // 但**显式** associate（上游 `:1849-1852` 那条内部 associate）就是撤销摘除：认领成功 + 记录作废。
  assert.equal(manager.associate('MyType', ext('ziz')), null)
  assert.equal(manager.getFileTypeByFileName('a.ziz').id, 'MyType')
  assert.equal(manager.removedMappings().wasRemovedFrom(ext('ziz'), 'MyType'), false)
})

test('旧类型名下有摘除记录 ⇒ 不算冲突、新类型直接赢（:1597-1603）', () => {
  const manager = freshManager()
  manager.register(userFileType('Old', 'Old', 'other', [ext('qqq')]))
  manager.removedMappings().add(ext('qqq'), 'Old', true)
  manager.register(userFileType('New', 'New', 'typescript', [ext('qqq')]))
  assert.equal(manager.getFileTypeByFileName('a.qqq').id, 'New')
  // 「不算冲突」= 这条判定不进冲突表（上游那个 result 的 message 是空串且不上报消费者）。
  assert.deepEqual(manager.getConflicts().filter(entry => presentableMatcher(entry.matcher) === '*.qqq'), [])
})

test('判赢且已批准 ⇒ 给落败的旧类型记一条 approved（:1615-1619）', () => {
  const manager = freshManager()
  // 第三方声明（非 bundled）抢平台自带的 *.json ⇒ 上游 `:93-98` 新方赢、approved = 旧方是 bundled = 真。
  manager.register(userFileType('Jsonish', 'Jsonish', 'other', [ext('json')]))
  assert.equal(manager.getFileTypeByFileName('a.json').id, 'Jsonish')
  const conflict = manager.getConflicts().find(entry => presentableMatcher(entry.matcher) === '*.json')
  assert.equal(conflict.approved, true)
  assert.equal(conflict.resolved, 'Jsonish')
  assert.equal(manager.removedMappings().isApproved(ext('json'), 'JSON'), true)
  // 之后平台自带类型重注册也抢不回去（账本在这条链上是真的）。
  manager.register({ ...STANDARD_FILE_TYPES.find(type => type.id === 'JSON') })
  assert.equal(manager.getFileTypeByFileName('a.json').id, 'Jsonish')
})

test('认领成功会撤销本类型名下的摘除记录（:1849-1852）', () => {
  const manager = freshManager()
  manager.register(userFileType('Md', 'Md', 'other', [ext('markdown')]))
  assert.equal(manager.getFileTypeByFileName('a.markdown').id, 'Md')
  manager.removeAssociation('Md', ext('markdown'), true)
  assert.equal(manager.removedMappings().wasRemovedFrom(ext('markdown'), 'Md'), true)
  manager.associate('Md', ext('markdown'))
  assert.equal(manager.removedMappings().wasRemovedFrom(ext('markdown'), 'Md'), false)
  assert.equal(manager.getFileTypeByFileName('a.markdown').id, 'Md')
})

test('旧类型是用户自定义类型且已批准 ⇒ 两边都认领（:1621-1623 的 AbstractFileType 分支）', () => {
  const manager = freshManager()
  manager.register(userFileType('User', 'User', 'other', [ext('uvw')]))
  manager.register(userFileType('Other', 'Other', 'typescript', [ext('uvw')]))
  // 两个都非 bundled：`!newFtd.bundled` 那条直接判新方赢、approved = 旧方 bundled = **假**
  // ⇒ 不双认领，*.uvw 归 Other。
  assert.equal(manager.getFileTypeByFileName('a.uvw').id, 'Other')
  assert.equal(manager.removedMappings().wasRemovedFrom(ext('uvw'), 'User'), false)
  // 旧方 bundled、新方非 bundled ⇒ 新方赢 + approved=true + 旧方记账。
  manager.register(userFileType('Third', 'Third', 'typescript', [ext('json')]))
  assert.equal(manager.getFileTypeByFileName('a.json').id, 'Third')
  assert.equal(manager.removedMappings().isApproved(ext('json'), 'JSON'), true)
})

test('不传 approved 时 removeAssociation **不记账**（上游 removeAssociation 只摘表，:1864-1874）', () => {
  const manager = freshManager()
  manager.removeAssociation('JSON', ext('json'))
  assert.deepEqual(manager.getRemovedMappings(), [])
  assert.equal(manager.getFileTypeByFileName('a.json'), null)
})

test('反向验证的参照：resolveFileTypeConflict 的五档判定没被账本改动带偏', () => {
  const bundled = { id: 'B', name: 'B', language: 'other', bundled: true, core: true, vendor: 'JetBrains' }
  const thirdParty = { id: 'T', name: 'T', language: 'other', bundled: false }
  assert.equal(resolveFileTypeConflict(ext('c'), bundled, thirdParty).resolved, 'T')
  assert.equal(resolveFileTypeConflict(ext('c'), bundled, thirdParty).approved, true)
  // 两条同向的调用不该互相「换边」后再判：新方是 bundled、旧方非 bundled ⇒ 仍归第三方。
  assert.equal(resolveFileTypeConflict(ext('c'), thirdParty, bundled).resolved, 'T')
  const native = { ...bundled, id: NATIVE_FILE_TYPE_ID, name: 'Native' }
  assert.equal(resolveFileTypeConflict(ext('c'), native, thirdParty).resolved, 'T')
  assert.equal(resolveFileTypeConflict(ext('c'), native, thirdParty).approved, true)
})

// ── 覆盖成任意类型（OverrideFileTypeAction 的列表 + UserFileTypeOverrider 的生效）──────

test('覆盖目标列表：按显示名大小写不敏感排序、排除「认不出」那一档（:53-76 + OverrideFileTypeManager.java:83-90）', () => {
  const labels = overridableFileTypes()
  assert.equal(labels.some(entry => entry.id === NATIVE_FILE_TYPE_ID), false)
  const lower = labels.map(entry => entry.label.toLowerCase())
  assert.deepEqual(lower, [...lower].sort())
  assert.equal(labels.some(entry => entry.id === PLAIN_TEXT_TYPE), true)
})

test('覆盖值校验：不存在的类型与不可当目标的类型都拒（OverrideFileTypeManager.java:48-54）', () => {
  assert.equal(overrideFailureReason('src/A.java', 'NO_SUCH_TYPE'), '注册表里没有「NO_SUCH_TYPE」这个文件类型，覆盖不会生效。')
  assert.match(overrideFailureReason('src/A.java', NATIVE_FILE_TYPE_ID), /不能当覆盖目标/)
  assert.equal(overrideFailureReason('src/A.java', 'TypeScript'), '')
  assert.notEqual(overrideFailureReason('src/', 'TypeScript'), '')
  assert.equal(overrideFileType('src/', 'TypeScript'), false)
  assert.equal(isAvailableForOverride({ id: 'x', name: 'X', language: 'other', binary: true }), false)
  assert.equal(isOverridableType(null), true)
  assert.equal(isOverridableType({ id: NATIVE_FILE_TYPE_ID, name: 'Native', language: 'other' }), false)
})

test('覆盖成 PlainText 以外的类型：编辑器语言按覆盖走（FileTypeManagerImpl.java:916-923）', () => {
  clearFileTypeOverrides()
  assert.equal(detectFileType('weird.unknown').kind, 'none')
  assert.equal(overrideFileType('weird.unknown', 'TypeScript'), true)
  const guess = detectFileType('weird.unknown')
  assert.equal(guess.kind, 'override')
  assert.equal(guess.type, 'TypeScript')
  assert.equal(resolveEditorLanguage('weird.unknown', ''), 'typescript')
  assert.equal(overrideTargetOf('weird.unknown').id, 'TypeScript')
  clearFileTypeOverrides()
})

test('覆盖成纯文本 = 明确「没有语言」；本仓没有词法层的类型也退到纯文本档', () => {
  clearFileTypeOverrides()
  assert.equal(overrideFileType('src/Legacy.java', PLAIN_TEXT_TYPE), true)
  assert.equal(resolveEditorLanguage('src/Legacy.java', 'class Foo {}'), 'other')
  assert.equal(detectFileType('src/Legacy.java').kind, 'override')
  assert.equal(changeFileTypeOverride('src/Legacy.java', 'Markdown'), true)
  assert.equal(resolveEditorLanguage('src/Legacy.java', ''), 'other')
  assert.equal(detectFileType('src/Legacy.java').type, 'Markdown')
  clearFileTypeOverrides()
})

test('覆盖值指向已注销的类型时整条忽略（上游 findFileTypeByName 为空就继续往下判）', () => {
  clearFileTypeOverrides()
  // 「先覆盖、后注销」才是这条判据的来路：覆盖值是字符串，注销类型后它就悬空
  // （上游 `UserFileTypeOverrider.java:19-23` 拿 `findFileTypeByName` 的结果，为空就当没覆盖）。
  fileTypeManager.register(userFileType('GhostType', 'GhostType', 'typescript', [ext('ghostext')]))
  assert.equal(overrideFileType('src/Ghost.ghostext', 'GhostType'), true)
  assert.equal(resolveEditorLanguage('src/Ghost.ghostext', ''), 'typescript')
  fileTypeManager.unregister('GhostType')
  assert.equal(overrideTargetOf('src/Ghost.ghostext'), null)
  assert.notEqual(detectFileType('src/Ghost.ghostext').kind, 'override')
  const row = fileTypeOverrideRows().find(entry => entry.path === 'src/Ghost.ghostext')
  assert.equal(row.resolved, false)
  assert.match(row.typeLabel, /已注销/)
  assert.equal(row.effective, false)
  clearFileTypeOverrides()
})

test('撤销覆盖后判定复原；改目标要走校验（ReverteOverrideFileTypeAction 的等价物）', () => {
  clearFileTypeOverrides()
  overrideFileType('notes.txt', 'TypeScript')
  assert.equal(resolveEditorLanguage('notes.txt', ''), 'typescript')
  assert.equal(changeFileTypeOverride('notes.txt', 'NO_SUCH'), false)
  assert.equal(changeFileTypeOverride('other/path.txt', 'JSON'), false)
  assert.equal(resolveEditorLanguage('notes.txt', ''), 'typescript')
  revertFileType('notes.txt')
  assert.equal(resolveEditorLanguage('notes.txt', ''), undefined)
})

// ── 探测缓存与「重新解析」（ReparseUtil.kt:11-17 + FileTypeDetectionService.java:330-340）──

test('缓存：同一输入第二次不再重算；换内容 / 换关联表都自然 miss', () => {
  clearFileTypeDetectionCache()
  const first = detectFileTypeCached('Cache.java', 'class A {}')
  assert.equal(fileTypeDetectionCacheSize(), 1)
  assert.equal(detectFileTypeCached('Cache.java', 'class A {}'), first)
  assert.equal(fileTypeDetectionCacheSize(), 1)
  assert.notEqual(detectFileTypeCached('Cache.java', 'class A {} // 改了'), first)
  assert.equal(fileTypeDetectionCacheSize(), 2)
  assert.notEqual(detectFileTypeCached('Cache.java', 'class A {}', { java: 'cpp' }), first)
})

test('改一条覆盖就让那个文件的判定重算（缓存键含覆盖值，等价于上游 clearCache + reparse）', () => {
  clearFileTypeDetectionCache()
  detectFileTypeCached('Flip.java', 'class A {}')
  assert.equal(fileTypeDetectionCacheSize(), 1)
  clearFileTypeOverrides()
  overrideFileType('Flip.java', 'TypeScript')
  assert.notEqual(detectFileTypeCached('Flip.java', 'class A {}').kind, 'extension')
  assert.equal(fileTypeDetectionCacheSize(), 2)
  clearFileTypeOverrides()
})

test('reparseFileTypes：清缓存 + 版本号自增', () => {
  clearFileTypeDetectionCache()
  const before = reparseFileTypes()
  assert.equal(before.dropped, 0)
  detectFileTypeCached('One.java', '')
  assert.equal(fileTypeDetectionCacheSize(), 1)
  const after = reparseFileTypes()
  assert.equal(after.dropped, 1)
  assert.equal(fileTypeDetectionCacheSize(), 0)
  assert.ok(after.revision > before.revision)
  assert.equal(fileTypeRevision.value, after.revision)
})

test('进程内单例的类型一变，探测缓存整批作废（真实消费链，上游 :338-340）', () => {
  clearFileTypeDetectionCache()
  detectFileTypeCached('Watch.java', '')
  assert.equal(fileTypeDetectionCacheSize(), 1)
  fileTypeManager.register(userFileType('ProbeType', 'ProbeType', 'other', [ext('probext')]))
  assert.equal(fileTypeDetectionCacheSize(), 0)
  assert.equal(fileTypeManager.getFileTypeByFileName('a.probext').id, 'ProbeType')
  fileTypeManager.unregister('ProbeType')
  clearFileTypeOverrides()
})
