// SDK 表的判据（`src/rootsSdkTable.ts`，pm/roots ① 与 lp/roots ③ 前半的本体）。
//
// 上游依据（本轮用 sed 复核过同一张文件）：
//   · `platform/projectModel-api/src/com/intellij/openapi/projectRoots/ProjectJdkTable.java:40`
//     `findJdk(name)`、`:42` `findJdk(name, type)`、`:44` `getAllJdks`、`:46` `getSdksOfType`、
//   · 同文件 `:48-50` `findMostRecentSdkOfType` = `getSdksOfType(type).stream().max(versionComparator)`；
//   · 同文件 `:53` `addJdk`、`:66` `removeJdk`、`:69` `updateJdk`；
//   · 同文件 `:71-80` `Listener` 只有 jdkAdded / jdkRemoved / jdkNameChanged 三个回调；
//   · 同文件 `:82-86` `getDefaultSdkType` / `getSdkTypeByName` / `createSdk`；`:90` `preconfigure()`
//     「This method may automatically detect Sdk if none are configured」；
//   · `platform/projectModel-impl/src/com/intellij/openapi/projectRoots/impl/ProjectJdkImpl.java:49-51`
//     构造器 (name, sdkType, homePath, version)。
//   · 建 SDK 的入口与名字去重（2026-10-08 lane lp-roots 补）：
//     `platform/lang-impl/src/com/intellij/openapi/projectRoots/impl/SdkConfigurationUtil.java:269-277`
//     （`createSdk(…)` 先 `createUniqueSdkName` 再 add）、`:429-436`
//     （`createUniqueSdkName` = `UniqueNameGenerator.generateUniqueName(name, "", "", " (", ")", validator)`）、
//     `platform/util/src/com/intellij/util/text/UniqueNameGenerator.java:96-121`（编号从 2 起、
//     原名带 ` (N)` 时从 N+1 接着编、判等走 HashSet 精确串）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compareSdkVersions, createSdk, JAVA_SDK_TYPE, sdkPresentableName, sdkRootsOf, SdkTable, uniqueSdkName } from '../src/rootsSdkTable.ts'

test('createSdk 的默认值（ProjectJdkImpl.java:49-51 的三参构造器）', () => {
  const sdk = createSdk('21', JAVA_SDK_TYPE, 'D:/jdk-21', '21.0.1')
  assert.deepEqual(sdk, { name: '21', type: JAVA_SDK_TYPE, homePath: 'D:/jdk-21', versionString: '21.0.1', roots: {} })
  assert.deepEqual(createSdk('x', JAVA_SDK_TYPE), { name: 'x', type: JAVA_SDK_TYPE, homePath: '', versionString: '', roots: {} })
})

test('版本比较按段取数：21 < 21.0.1 < 22，认不出的形态不假装语义化', () => {
  assert.equal(compareSdkVersions('21', '21.0.1') < 0, true)
  assert.equal(compareSdkVersions('21.0.1', '22') < 0, true)
  assert.equal(compareSdkVersions('1.8.0_392', '1.8.0_400') < 0, true)
  assert.equal(compareSdkVersions('21', '21'), 0)
  assert.equal(compareSdkVersions('', '21') < 0, true, '空版本排在有版本之前（没有可比的大小）')
  assert.equal(compareSdkVersions('', ''), 0)
})

test('SDK 根由家目录派生，显式登记的根优先（ProjectJdkImpl.java:220-225 的结果形态）', () => {
  assert.deepEqual(sdkRootsOf(createSdk('x', JAVA_SDK_TYPE)), { sources: [], classes: [], javadoc: [], annotations: [] },
    '没有家目录就不编根')
  const derived = sdkRootsOf(createSdk('x', JAVA_SDK_TYPE, 'D:\\jdk-21'))
  assert.deepEqual(derived.classes, ['D:\\jdk-21'])
  assert.deepEqual(derived.sources, ['D:/jdk-21/lib/src.zip'], '现代 JDK 的源码在 lib/src.zip，分隔符统一成正斜杠')
  assert.deepEqual(derived.javadoc, [])
  const explicit = sdkRootsOf({ ...createSdk('x', JAVA_SDK_TYPE, '/opt/jdk'), roots: { sources: ['/src/a.zip'], javadoc: ['/doc'] } })
  assert.deepEqual(explicit.sources, ['/src/a.zip'], '用户登记的根覆盖派生根')
  assert.deepEqual(explicit.classes, ['/opt/jdk'])
  assert.deepEqual(explicit.javadoc, ['/doc'])
})

test('表的寻址面：findJdk / findJdk(name,type) / getAllJdks / getSdksOfType（:40-46）', () => {
  const table = new SdkTable()
  assert.equal(table.findJdk('nope'), null)
  table.addJdk(createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21.0.1'))
  table.addJdk(createSdk('21', 'Kotlin', '/kotlin', '2.0'))
  assert.equal(table.findJdk('21').homePath, '/jdk21', '同名时按登记顺序给第一个（上游同样不保证唯一）')
  assert.equal(table.findJdkOfType('21', 'Kotlin').homePath, '/kotlin')
  assert.equal(table.findJdkOfType('21', 'Groovy'), null)
  assert.equal(table.getAllJdks().length, 2)
  assert.deepEqual(table.getSdksOfType(JAVA_SDK_TYPE).map(sdk => sdk.name), ['21'])
  assert.equal(table.getDefaultSdkType(), JAVA_SDK_TYPE)
  assert.equal(table.getSdkTypeByName(JAVA_SDK_TYPE), JAVA_SDK_TYPE)
  assert.equal(table.getSdkTypeByName('IntelliJ Platform'), null, '认不出的类型名不隐式创建')
  assert.deepEqual(table.createSdk('new', JAVA_SDK_TYPE), { name: 'new', type: JAVA_SDK_TYPE, homePath: '', versionString: '', roots: {} })
})

test('findMostRecentSdkOfType：取该类型版本最大的一条（:48-50）', () => {
  const table = new SdkTable()
  table.addJdk(createSdk('a', JAVA_SDK_TYPE, '/a', '17'))
  table.addJdk(createSdk('b', JAVA_SDK_TYPE, '/b', '21.0.1'))
  table.addJdk(createSdk('c', JAVA_SDK_TYPE, '/c', '21'))
  table.addJdk(createSdk('k', 'Kotlin', '/k', '9'))
  assert.equal(table.findMostRecentSdkOfType(JAVA_SDK_TYPE).name, 'b')
  assert.equal(table.findMostRecentSdkOfType('Groovy'), null, '该类型一条都没有 ⇒ null')
  const empty = new SdkTable()
  empty.addJdk(createSdk('u', JAVA_SDK_TYPE, '/u', ''))
  empty.addJdk(createSdk('v', JAVA_SDK_TYPE, '/v', ''))
  assert.equal(empty.findMostRecentSdkOfType(JAVA_SDK_TYPE).name, 'v', '版本都为空时收敛到最后登记的一条')
})

test('addJdk 同 (name,type) 是替换；removeJdk 要名字/类型/家目录都对上（:53/:66）', () => {
  const table = new SdkTable()
  const events = []
  table.addListener(event => events.push(event.type))
  table.addJdk(createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21'))
  table.addJdk(createSdk('21', JAVA_SDK_TYPE, '/other', '22'))
  assert.equal(table.getAllJdks().length, 1, '同名同类型替换而不是并存')
  assert.equal(table.findJdk('21').homePath, '/other')
  assert.equal(table.removeJdk(createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21')), false, '家目录对不上就不删（防误删同名）')
  assert.equal(table.removeJdk(createSdk('21', JAVA_SDK_TYPE, '/other', '21')), true)
  assert.equal(table.removeJdk(createSdk('21', JAVA_SDK_TYPE, '/other', '21')), false)
  assert.deepEqual(events, ['added', 'added', 'removed'])
})

test('updateJdk：原地替换，改名发 jdkNameChanged，不改名沿用上游三回调之一（:69 + :71-80）', () => {
  const table = new SdkTable()
  const events = []
  table.addListener(event => events.push(event))
  const original = createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21')
  table.addJdk(original)
  assert.equal(table.updateJdk(createSdk('别的', JAVA_SDK_TYPE, '/x'), original), false, '表里没有这个对象就什么都不做')
  const renamed = createSdk('JDK 21', JAVA_SDK_TYPE, '/jdk21', '21')
  assert.equal(table.updateJdk(original, renamed), true)
  assert.equal(events[1].type, 'nameChanged')
  assert.equal(events[1].previousName, '21')
  assert.equal(table.findJdk('21'), null, '改名后旧名查不到')
  assert.equal(table.findJdk('JDK 21').homePath, '/jdk21')
  const moved = createSdk('JDK 21', JAVA_SDK_TYPE, '/jdk21u2', '21.0.2')
  table.updateJdk(renamed, moved)
  assert.equal(events[2].type, 'added', '上游 Listener 只有三个方法，本仓不多造第四种')
})

test('按家目录寻址忽略尾斜杠与大小写；空家目录不查（本仓把设置字符串接回表的那条路）', () => {
  const table = new SdkTable()
  const sdk = table.ensureJdkForHome('D:\\Program Files\\Java\\jdk-21\\')
  assert.equal(sdk.name, 'jdk-21', '名字取家目录末段，版本留空（不编）')
  assert.equal(sdk.type, JAVA_SDK_TYPE)
  assert.equal(table.findJdkByHome('d:\\program files\\java\\JDK-21'), sdk)
  assert.equal(table.ensureJdkForHome('   '), null, '没有家目录就返回 null，让调用方走「SDK 默认」')
  assert.equal(table.ensureJdkForHome('D:\\Program Files\\Java\\jdk-21'), sdk, '同家目录不重复登记')
  assert.equal(table.getAllJdks().length, 1)
  assert.equal(table.findJdkByHome(''), null)
})

test('preconfigure 只在一条都没配时装探测结果（:90 的 if none are configured）', () => {
  const table = new SdkTable()
  const detected = [createSdk('17', JAVA_SDK_TYPE, '/jdk17', '17'), createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21')]
  assert.deepEqual(table.preconfigure(detected).map(sdk => sdk.name), ['17', '21'])
  assert.equal(table.getAllJdks().every(sdk => sdk.detected === true), true, '灌进来的都标 detected')
  const configured = new SdkTable()
  configured.addJdk(createSdk('user', JAVA_SDK_TYPE, '/user', '11'))
  assert.deepEqual(configured.preconfigure(detected).map(sdk => sdk.name), ['user'], '已配过就原样返回')
})

test('SDK 行文案的三级取值（OrderEntry.getPresentableName 等价物）', () => {
  assert.equal(sdkPresentableName(createSdk('21', JAVA_SDK_TYPE, '/jdk21', '21')), '21', '有名字用名字')
  assert.equal(sdkPresentableName(createSdk('', JAVA_SDK_TYPE, '/jdk21', '21.0.1')), 'JDK 21.0.1', '没名字用版本')
  assert.equal(sdkPresentableName(createSdk('', JAVA_SDK_TYPE, '/opt/tools/jdk-21')), 'jdk-21', '连版本都没有才退回家目录末段')
  assert.equal(sdkPresentableName(createSdk('', JAVA_SDK_TYPE)), 'JDK', '三条都空时给一个不会渲染成空串的名字')
})

// ---------------------------------------------------------------------------
// 名字去重（`SdkConfigurationUtil.createUniqueSdkName` + `UniqueNameGenerator.generateUniqueName`）
// 这一批是 2026-10-08 lane lp-roots 补的：加之前 `preconfigure` 直接 `addJdk`，
// 两台 JDK 21 安装（`native/jdk.cpp` 的 `suggest_name` 都给 `21`）在表里只剩最后一台。
// ---------------------------------------------------------------------------

test('uniqueSdkName：名字没被占就原样（trim 后）；被占了从 2 编号（UniqueNameGenerator.java:101-108）', () => {
  assert.equal(uniqueSdkName('21', []), '21', '一条都没有 ⇒ 原名')
  assert.equal(uniqueSdkName('21', ['17', '22']), '21')
  assert.equal(uniqueSdkName(' 21 ', ['17']), '21', '第一条分支用的是 trim 过的全名（`:102`）')
  assert.equal(uniqueSdkName('21', ['21']), '21 (2)', '编号从 2 起（`:99` 的 startingNumber）')
  assert.equal(uniqueSdkName('21', ['21', '21 (2)']), '21 (3)')
  assert.equal(uniqueSdkName('21', ['21', '21 (2)', '21 (3)']), '21 (4)')
})

test('uniqueSdkName：原名自己带 ` (N)` 时从 N+1 接着编，数字超过 9 位不认这一支（:110-116）', () => {
  assert.equal(uniqueSdkName('21 (2)', ['21', '21 (2)']), '21 (3)', '不是 "21 (2) (2)"')
  assert.equal(uniqueSdkName('21 (7)', ['21 (7)']), '21 (8)')
  assert.equal(uniqueSdkName('21 (x)', ['21 (x)']), '21 (x) (2)', '非数字后缀不匹配那条正则（`matches()` 要整串）')
  assert.equal(uniqueSdkName('21 (1234567890)', ['21 (1234567890)']), '21 (1234567890) (2)', '正则只吃 1-9 位数字')
  // 上游这一支用的是**未 trim** 的原名当基名（`:109` `baseName = defaultName`）⇒ 尾空格会留在名字里。
  // 行内照抄，不"顺手修正"。
  assert.equal(uniqueSdkName('21 ', ['21', '21  (2)']), '21  (3)')
})

test('uniqueSdkName：判等是精确串（上游 validator 是 HashSet.contains），大小写不同不算撞名', () => {
  assert.equal(uniqueSdkName('21', ['21']), '21 (2)')
  assert.equal(uniqueSdkName('21', [' 21']), '21', '带空格的另一条不算占用')
  assert.equal(uniqueSdkName('JDK 21', ['jdk 21']), 'JDK 21', '大小写不同不撞名')
})

test('createAndAddJdk：上游建 SDK 的入口先去重（:269-277 + :429-436）—— 同名的两台 JDK 都在表里', () => {
  const table = new SdkTable()
  const first = table.createAndAddJdk('21', 'C:/a/jdk-21', '21.0.11')
  const second = table.createAndAddJdk('21', 'D:/b/jdk-21', '21.0.12')
  assert.equal(first.name, '21')
  assert.equal(second.name, '21 (2)', '第二个 21 不顶掉第一个')
  assert.deepEqual(table.getAllJdks().map(sdk => sdk.name), ['21', '21 (2)'])
  assert.equal(table.findJdkOfType('21 (2)', JAVA_SDK_TYPE).homePath, 'D:/b/jdk-21')
  const detected = table.createAndAddJdk('8', 'D:/jdk-8', '1.8.0_392', { detected: true })
  assert.equal(detected.detected, true, 'extra 原样落到构造器上')
})

test('preconfigure：探测到的同名 JDK 各占一条（两台 JDK 21 ⇒ 21 + 21 (2)），同家目录不重复登记', () => {
  const table = new SdkTable()
  const names = table.preconfigure([
    createSdk('21', JAVA_SDK_TYPE, 'C:/adoptium/jdk-21.0.11', '21.0.11'),
    createSdk('17', JAVA_SDK_TYPE, 'C:/adoptium/jdk-17.0.9', '17.0.9'),
    createSdk('21', JAVA_SDK_TYPE, 'D:/Java21', '21.0.12'),
  ]).map(sdk => sdk.name)
  assert.deepEqual(names, ['21', '17', '21 (2)'], '同名不丢：后者编号而不是顶掉前者')
  assert.equal(table.getAllJdks().every(sdk => sdk.detected === true), true)
  assert.deepEqual(table.getAllJdks().map(sdk => sdk.homePath), ['C:/adoptium/jdk-21.0.11', 'C:/adoptium/jdk-17.0.9', 'D:/Java21'])
  // 同一个家目录重复喂进来（宿主清单里有重影/多次预配置）只登记一条。
  const again = new SdkTable()
  again.preconfigure([createSdk('21', JAVA_SDK_TYPE, 'D:/Java21', '21.0.12'), createSdk('21', JAVA_SDK_TYPE, 'D:/Java21', '21.0.12')])
  assert.deepEqual(again.getAllJdks().map(sdk => sdk.name), ['21'])
})

test('ensureJdkForHome：两个同名末段的目录不互相顶掉（名字同样过去重）', () => {
  const table = new SdkTable()
  table.preconfigure([createSdk('jdk-21', JAVA_SDK_TYPE, 'D:/a/jdk-21', '21')])
  const configured = table.ensureJdkForHome('D:\\b\\jdk-21')
  assert.equal(configured.name, 'jdk-21 (2)')
  assert.deepEqual(table.getAllJdks().map(sdk => sdk.name), ['jdk-21', 'jdk-21 (2)'])
  assert.equal(table.ensureJdkForHome('D:\\b\\jdk-21\\'), configured, '同家目录仍然幂等')
})

test('接线：会话装配那条链还在（preconfigure/ensureJdkForHome 被 workspaceLifecycle 调用）', () => {
  const source = readFileSync(new URL('../src/workspaceLifecycle.ts', import.meta.url), 'utf8')
  assert.match(source, /sdkTable\.preconfigure\(/, '探测结果要灌进 SDK 表')
  assert.match(source, /sdkTable\.ensureJdkForHome\(/, '设置里的 jdkHome 要接回同一张表')
})
