// 「未知/失效 SDK」检测与修复建议（`src/unknownSdk.ts`）的判据 ——
// 上游 `platform/lang-impl/src/com/intellij/openapi/projectRoots/impl/` 的
// `UnknownSdkCollector`/`UnknownMissingSdk`/`UnknownInvalidSdk`/`UnknownSdkFix`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIGURE_SDK_ACTION_TEXT,
  UNKNOWN_SDK_NO_NAME,
  collectUnknownSdks,
  configureMissingSdkText,
  invalidSdkNotificationText,
  localFixFor,
  projectUnknownSdkSnapshot,
  sdkFixPatch,
  sdkNameForUi,
  unknownSdkFix,
  unknownSdkNotificationText,
  useExistingSdkText,
} from '../src/unknownSdk.ts'
import { JAVA_SDK_TYPE, createSdk } from '../src/rootsSdkTable.ts'

const req = (name, extra = {}) => ({ name, type: JAVA_SDK_TYPE, ...extra })
const cand = (home, version, suggestedName) => ({ home, version, suggestedName })

test('无名字的诉求显示 <unknown>（UnknownMissingSdk.getSdkNameForUi + ProjectBundle:283）', () => {
  assert.equal(UNKNOWN_SDK_NO_NAME, '<unknown>')
  assert.equal(sdkNameForUi(req(null)), '<unknown>')
  assert.equal(sdkNameForUi(req('  ')), '<unknown>')
  assert.equal(sdkNameForUi(req('JavaSE-17')), 'JavaSE-17')
})

test('文案照 ProjectBundle 的键（:187/:188/:196/:197/:282 与 :189）', () => {
  assert.match(unknownSdkNotificationText(req('Foo')), /Foo.*缺失/)
  assert.match(invalidSdkNotificationText(req('Foo')), /Foo.*不存在或已损坏/)
  assert.match(configureMissingSdkText(req('Foo')), /配置缺失的.*Foo/)
  assert.equal(CONFIGURE_SDK_ACTION_TEXT, '配置…')
  assert.match(useExistingSdkText(cand('D:/jdk-21', '21.0.1')), /使用已探测到的.*21\.0\.1/)
})

test('collectUnknownSdks：已知的（名字 + 类型都对上）不算 unknown', () => {
  const known = [createSdk('JavaSE-17', JAVA_SDK_TYPE, 'D:/jdk-17', '17')]
  const snap = collectUnknownSdks([req('JavaSE-17')], known)
  assert.deepEqual(snap.resolvableSdks, [])
  assert.deepEqual(snap.totallyUnknownSdks, [])
  assert.equal(snap.knownSdks.length, 1)
})

test('collectUnknownSdks：同名多类型 ⇒ totallyUnknown（给不出建议）', () => {
  const snap = collectUnknownSdks([req('Shared', { type: 'JavaSDK' }), req('Shared', { type: 'KotlinSDK' })], [])
  assert.deepEqual(snap.totallyUnknownSdks, ['Shared'])
  assert.deepEqual(snap.resolvableSdks, [])
})

test('collectUnknownSdks：名字大小写不敏感归并，且按名字序排（TreeSet(CASE_INSENSITIVE_ORDER)）', () => {
  const snap = collectUnknownSdks([req('beta'), req('Alpha'), req('ALPHA')], [])
  assert.deepEqual(snap.resolvableSdks.map(item => item.name), ['Alpha', 'beta'], 'ALPHA 与 Alpha 归并成一条')
})

test('localFixFor：给了期望版本 ⇒ 同主版本里取最高的；没给 ⇒ 取版本最高的', () => {
  const candidates = [cand('D:/jdk-17', '17.0.2'), cand('D:/jdk-21', '21.0.1'), cand('D:/jdk-21b', '21.0.5')]
  assert.equal(localFixFor(req('X', { expectedVersion: '17.0.9' }), candidates).home, 'D:/jdk-17')
  assert.equal(localFixFor(req('X', { expectedVersion: '21' }), candidates).home, 'D:/jdk-21b', '同主版本取最高')
  assert.equal(localFixFor(req('X'), candidates).home, 'D:/jdk-21b', '没期望版本取最高')
  assert.equal(localFixFor(req('X'), []), null)
  assert.equal(localFixFor(req('X'), [cand('', '21')]), null, '家目录空的不算候选')
})

test('unknownSdkFix：本地候选优先（有候选才给建议按钮，没有只留「配置…」）', () => {
  const withCandidate = unknownSdkFix(req('Foo'), [cand('D:/jdk-21', '21', 'jdk-21')])
  assert.equal(withCandidate.configureActionText, '配置…')
  assert.ok(withCandidate.suggested, '有本地候选就有建议')
  assert.match(withCandidate.suggestedLabel, /使用已探测到的/)
  const without = unknownSdkFix(req('Foo'), [])
  assert.equal(without.suggested, null)
  assert.equal(without.suggestedLabel, '', '没有候选就没有按钮（不画点不动的假控件）')
  // invalid 档文案不同。
  assert.match(unknownSdkFix(req('Foo'), [], true).notificationText, /不存在或已损坏/)
})

test('projectUnknownSdkSnapshot：jdkHome 指向不存在的目录 ⇒ invalid 诉求', () => {
  const snap = projectUnknownSdkSnapshot({
    jdkHome: 'D:/gone', jdkName: 'JavaSE-17', detected: [cand('D:/jdk-21', '21')], known: [],
    homeExists: () => false,
  })
  assert.equal(snap.resolvableSdks.length, 1)
  assert.equal(snap.resolvableSdks[0].name, 'JavaSE-17', '名字取 jdkName')
})

test('projectUnknownSdkSnapshot：jdkHome 是探测到的候选 ⇒ 不报 invalid（大小写/尾斜杠归一）', () => {
  const snap = projectUnknownSdkSnapshot({
    jdkHome: 'D:/JDK-21/', jdkName: 'JavaSE-21', detected: [cand('D:/jdk-21', '21')], known: [],
    homeExists: () => false,
  })
  assert.deepEqual(snap.resolvableSdks, [], '候选里有这个家目录（归一后）⇒ 不报 unknown')
})

test('projectUnknownSdkSnapshot：没有 missing（按名）这一支 —— jdkName 是语言级别标签不是要求的 SDK 名', () => {
  // 每个健康项目都写着 `JavaSE-17` 这种语言级别，拿它当名字要求会恒报「缺失」（假告警）。
  const snap = projectUnknownSdkSnapshot({ jdkHome: '', jdkName: 'JavaSE-17', detected: [], known: [] })
  assert.deepEqual(snap.resolvableSdks, [])
  const empty = projectUnknownSdkSnapshot({ jdkHome: '', jdkName: '', detected: [], known: [] })
  assert.deepEqual(empty.resolvableSdks, [])
})

test('projectUnknownSdkSnapshot：jdkHome 全空 ⇒ 无 unknown（语言服务自动检测）', () => {
  const empty = projectUnknownSdkSnapshot({ jdkHome: '', jdkName: 'JavaSE-17', detected: [], known: [] })
  assert.deepEqual(empty.resolvableSdks, [])
})

test('sdkFixPatch：写回 jdkHome/jdkName（UnknownInvalidSdk.copySdk 的等价物）', () => {
  assert.deepEqual(sdkFixPatch(cand('D:/jdk-21', '21', 'jdk-21')), { jdkHome: 'D:/jdk-21', jdkName: 'jdk-21' })
  assert.deepEqual(sdkFixPatch(cand('D:/tools/jdk-21', '21')), { jdkHome: 'D:/tools/jdk-21', jdkName: 'jdk-21' }, '没建议名取家目录末段')
})