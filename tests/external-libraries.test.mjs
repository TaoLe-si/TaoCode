// 「外部库」节点的内容（src/externalLibraries.ts）的判决测试。
//
// 2026-10-03 用户原话：「外部库现在是空的，什么都没有」—— 展开后只有一行
// `lib/**/*.jar`（glob 字符串本身）。那既不是 jar、也不是库名：点不开、读不懂，
// 而 glob 命中的 jar 文件其实就在磁盘上。
//
// 上游口径（`platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/`）：
//   · `ExternalLibrariesNode.java:49` + `ProjectViewProjectNode.java:89` ⇒ 容器**无条件存在**，
//     没有空状态占位（无库项目下 `ProjectViewPaneTest.kt:47-56` 断言的就是光秃秃一行）；
//   · `:109-116` ⇒ SDK 与库**并列**，各占一行，用 `SdkType.getIcon()`；
//   · `:101-104` ⇒ **库没有名字时根直接挂容器下**（摊平），不建中间节点。
// 本仓没有"库"这个实体（只有 glob），所以按"摊平"那条走：命中的 jar 各自是叶子。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { externalLibraryEntries, isSyntheticLibraryRow, matchedJars, SDK_ENTRY_PATH } from '../src/externalLibraries.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('glob 真的展开成磁盘上存在的 jar，而不是显示 glob 字符串本身', () => {
  const files = ['libs/core.jar', 'libs/util.jar', 'libs/core-sources.jar', 'src/Main.java', 'libs/notes.txt']
  assert.deepEqual(matchedJars(files, ['libs/**/*.jar']), ['libs/core-sources.jar', 'libs/core.jar', 'libs/util.jar'],
    '只留 jar、去掉非 jar、按路径字母序（上游子节点继承 UNSPECIFIED 的字母序）')
  assert.deepEqual(matchedJars(files, []), [], '没配 glob 就没有 jar —— 不能偷偷放宽成默认 glob')
})

test('glob 语义沿用 PathMatcher：**/ 能跨零层目录', () => {
  // `libs/**/*.jar` 要能命中 `libs/x.jar`（`**` 匹配零层，这是 IDEA PathMatcher 的行为），
  // 否则 AE2 那种把 jar 放根、其它项目放子目录的写法会漏。
  assert.deepEqual(matchedJars(['libs/a.jar'], ['libs/**/*.jar']), ['libs/a.jar'])
  assert.deepEqual(matchedJars(['other/libs/a.jar'], ['libs/**/*.jar']), [], '不该越出 glob 的根目录')
  assert.deepEqual(matchedJars(['LIBS/A.JAR'], ['libs/**/*.jar']), ['LIBS/A.JAR'], '大小写不敏感（上游 PathMatcher 默认）')
})

test('排序放在 externalLibraryEntries 之外：matchedJars 只负责命中与排序', () => {
  const out = matchedJars(['b.jar', 'a.jar'], ['*.jar'])
  assert.deepEqual(out, ['a.jar', 'b.jar'])
})

test('SDK 行在最前，jar 行随后；SDK 没有名字时退回版本、再退回家目录末段', () => {
  const out = externalLibraryEntries({
    files: ['libs/core.jar'],
    patterns: ['libs/**/*.jar'],
    jdk: { name: '', version: '21', home: 'C:\\Program Files\\Java\\jdk-21' },
  })
  assert.equal(out[0].path, SDK_ENTRY_PATH)
  assert.equal(out[0].name, 'JDK 21')
  assert.equal(out[1].name, 'core.jar')
  assert.ok(out.every(entry => entry.kind === 'file'),
    '合成行不对应磁盘路径，必须报 file；报成目录会让 FileTree 去展开一个查不到的东西')

  const named = externalLibraryEntries({ files: [], patterns: [], jdk: { name: 'IDEA JDK', version: '21', home: 'D:\\j' } })
  assert.equal(named[0].name, 'IDEA JDK', '有名字就用名字（OrderEntry.getPresentableName）')

  const homed = externalLibraryEntries({ files: [], patterns: [], jdk: { name: '', version: '', home: 'D:\\tools\\zulu21\\' } })
  assert.equal(homed[0].name, 'zulu21', '都没给就取家目录最后一段（去掉尾部分隔符）')
})

test('没有任何 SDK 探测结果时，容器还在，只是少一行', () => {
  assert.deepEqual(externalLibraryEntries({ files: [], patterns: [], jdk: null }), [])
  const withJar = externalLibraryEntries({ files: ['libs/a.jar'], patterns: ['libs/**/*.jar'], jdk: null })
  assert.equal(withJar.length, 1, '没有 SDK 也要照常给 jar 行')
})

test('合成行都带"不落到磁盘"的前缀，FileTree 靠它认出来并换图标', () => {
  const out = externalLibraryEntries({
    files: ['libs/core.jar'], patterns: ['libs/**/*.jar'], jdk: { name: 'JDK', version: '', home: '' },
  })
  assert.ok(out.every(entry => isSyntheticLibraryRow(entry.path)), '每一行都要能被 FileTree 认成合成行')
  assert.ok(!out.some(entry => isSyntheticLibraryRow(entry.path.replace(/\0[^:]*:?/, ''))), '别把真实路径也标成合成行')
  const jar = out.find(entry => entry.name === 'core.jar')
  assert.ok(jar.path.endsWith('libs/core.jar'), 'jar 行的 path 要能还原出真实相对路径（tooltip 用）')
})

test('这个文件里一个控制字符都没有 —— NUL 会让 git diff 与编辑器把它当二进制', () => {
  const source = readFileSync(join(root, 'src/externalLibraries.ts'), 'utf8')
  assert.equal([...source].filter(ch => ch.codePointAt(0) < 9).length, 0, '源码里出现了控制字符（NUL 会让 git diff 把它当二进制）；应写成 String.fromCharCode(0)')
  assert.ok(source.includes('String.fromCharCode(0)'), 'off-disk 前缀应当用 fromCharCode 构造并解释原因')
})