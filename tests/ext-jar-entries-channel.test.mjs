// 归档条目通道 + 行模型的判据（桶 15j：`src/rootsJarEntries.ts` 接上真生产链路）。
//
// 三件事各管一段，缺一件就是"半截"：
//   ① 宿主通道真的存在（`native/file_queries.cpp` 认领 `file.archiveEntries`，实机跑 bsdtar）；
//   ② 行模型有消费方，而且消费方挂在**已经在画的**那一面（项目结构 → 依赖库 → JarEntriesPane）；
//   ③ 拿不到数据时**整块不渲染**：`loadJarListing` 返回 null 而不是空数组，组件里没有"（空）"占位。
//
// 上游依据（逐条核过，行号可复现）：
//   · `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9-12`
//     `JarFileSystem extends ArchiveFileSystem …`，`:10` PROTOCOL、`:11` PROTOCOL_PREFIX、`:12` JAR_SEPARATOR；
//   · `platform/util/src/com/intellij/util/io/URLUtil.java:37` `JAR_PROTOCOL = "jar"`、
//     `:39` `JAR_SEPARATOR = "!/"`（**两个字符**，所以根 url 结尾是 `jar!/`）；
//   · `platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:86`
//     `extractLocalPath` / `:92` `composeRootPath`（`"/x/y.jar" -> "/x/y.jar!/"`，见 `:47-48` 的 javadoc）；
//   · 同文件 `:99-100`（`copyFile`）与 `:114-115`（`deleteFile`）对归档一律抛
//     "jar.modification.not.supported.error" —— 这一面只有读，所以 UI 里不该出现任何写入口。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jarEntryParent, jarRows, jarRowsFromListing, jarUrl, parseJarListing, parseJarUrl, classNameOfEntry } from '../src/rootsJarEntries.ts'
import { archiveAbsolutePath, jarChannelStatus, loadJarListing, resetJarListings } from '../src/jarEntriesSource.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
/** 只取 import 行：注释里提一嘴某个模块不算接线（与 .tools/find-orphan-modules.mjs 同一口径）。 */
const importLines = text => text.split('\n').filter(line => line.startsWith('import ')).join('\n')

/** 一份真实的 `bsdtar -tf` 输出（目录条目带尾斜杠，深层目录只由子条目隐含）。 */
const LISTING = [
  'META-INF/MANIFEST.MF',
  'com/example/Greeter.class',
  'com/example/Greeter.java',
  'com/example/Greeter$Inner.class',
]

test('bsdtar 清单 → 条目表：补出隐含目录、去重、顺序跟随输入', () => {
  const entries = parseJarListing(LISTING)
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  assert.equal(byPath.get('com').directory, true, 'com 由子条目隐含成目录')
  assert.equal(byPath.get('com/example').directory, true, '深层中间目录不能断（否则树上看不到）')
  assert.equal(byPath.get('com/example/Greeter.class').directory, false, '.class 是文件')
  assert.equal(byPath.get('META-INF').directory, true, 'META-INF 同样是隐含目录')
  assert.deepEqual(parseJarListing(['a/', 'a/', 'a/b']), [{ path: 'a', directory: true }, { path: 'a/b', directory: false }],
    '重复条目只留第一条，尾斜杠即目录')
})

test('行模型：目录在前、组内走 localeCompare、depth 按档案内层级', () => {
  const rows = jarRowsFromListing(LISTING, '/lib/demo.jar')
  assert.deepEqual(rows.filter(row => row.directory).map(row => row.path), ['com', 'com/example', 'META-INF'],
    '目录排在文件前面；组内是不分大小写的字母序（localeCompare，不是 ASCII 码序：META-INF 的 M 在 c 后面）')
  assert.deepEqual(rows.filter(row => !row.directory).map(row => row.path), [
    'com/example/Greeter.class',
    'com/example/Greeter.java',
    'com/example/Greeter$Inner.class',
    'META-INF/MANIFEST.MF',
  ], '同一目录内的文件按路径序；内部类的 $ 排在同名文件之后（这是 localeCompare 的真实行为，钉住它）')
  assert.equal(rows.find(row => row.path === 'com/example/Greeter.class').depth, 2, '档案内两层 ⇒ depth 2')
  assert.equal(rows.find(row => row.path === 'META-INF').depth, 0)
  assert.equal(rows.find(row => row.name.endsWith('.java')).source, true, '.java 标 source（库源码通道读得了它）')
  assert.equal(rows.find(row => row.path === 'com/example/Greeter.class').className, 'com.example.Greeter')
  assert.equal(rows.find(row => row.path === 'com/example/Greeter$Inner.class').className, 'com.example.Greeter$Inner',
    '内部类保留 $')
  assert.equal(rows.every(row => row.key === `/lib/demo.jar!/${row.path}`), true, '树键 = 档案路径 + !/ + 条目路径')
  assert.equal(jarRows([], { archive: '/lib/demo.jar' }).length, 0, '没有条目就是零行（不是假行）')
  assert.equal(jarRowsFromListing(LISTING, '/lib/demo.jar', { filesOnly: true }).every(row => !row.directory), true)
})

test('jar:// url 与本仓形状互为反函数（ArchiveFileSystem.java:86/:92）', () => {
  const url = jarUrl('D:/p/lib/demo.jar', 'com/example/Greeter.class')
  assert.equal(url, 'jar://D:/p/lib/demo.jar!/com/example/Greeter.class')
  assert.deepEqual(parseJarUrl(url), { archive: 'D:/p/lib/demo.jar', entry: 'com/example/Greeter.class' })
  assert.equal(parseJarUrl('file:///D:/p/lib/demo.jar'), null, '不是 jar:// 就拒，不猜')
  assert.equal(jarUrl('a.jar', 'b').indexOf('!/', 0) > 0, true, '分隔符是上游那两个字符 !/（URLUtil.java:39）')
})

test('条目路径的父目录（渲染层展开某一层时靠它筛）', () => {
  assert.equal(jarEntryParent('com/example/Greeter.class'), 'com/example')
  assert.equal(jarEntryParent('com/example/'), 'com')
  assert.equal(jarEntryParent('README.md'), '', '档案根的父是空串')
  assert.equal(classNameOfEntry('com/example/Greeter.java'), null, '只给 .class 出全限定名')
})

test('宿主通道：loadJarListing 把清单整成行，并记住通道在不在', async () => {
  resetJarListings()
  const calls = []
  const lister = async archive => {
    calls.push(archive)
    return { available: true, archive, lines: LISTING, truncated: false }
  }
  const listing = await loadJarListing('/lib/demo.jar', lister)
  assert.ok(listing, '通道在、清单真 ⇒ 有行')
  assert.equal(listing.rows.length, 7)
  assert.equal(listing.truncated, false)
  assert.equal(jarChannelStatus(), 'live')
  await loadJarListing('/lib/demo.jar', lister)
  assert.equal(calls.length, 1, '同一个归档只问宿主一次')
})

test('通道不存在 ⇒ null 而不是空数组（前端据此整块不渲染，不画"（空）"）', async () => {
  resetJarListings()
  const missing = await loadJarListing('/lib/demo.jar', async () => { throw new Error('UNKNOWN_METHOD') })
  assert.equal(missing, null, '桥抛错 = 宿主没这条通道，不能给一个空清单当真数据')
  assert.equal(jarChannelStatus(), 'absent')
  resetJarListings()
  const refused = await loadJarListing('/lib/notes.txt', async () => ({ available: false, archive: '/lib/notes.txt', reason: '不是可列出的归档类型' }))
  assert.equal(refused, null, '宿主答"拿不到"也是拿不到')
  assert.equal(jarChannelStatus(), 'live', '但通道本身是在的（下一个归档照问）')
  assert.equal(await loadJarListing('', async () => ({ available: true, lines: ['a'] })), null, '没给路径就不问宿主')
})

test('绝对路径拼接（工作区根 + 项目内相对路径）', () => {
  assert.equal(archiveAbsolutePath('D:/TaoCode', 'lib/demo.jar'), 'D:/TaoCode/lib/demo.jar')
  assert.equal(archiveAbsolutePath('D:\\TaoCode\\', 'lib/demo.jar'), 'D:/TaoCode/lib/demo.jar', '反斜杠与尾斜杠都归一')
  assert.equal(archiveAbsolutePath('', 'lib/demo.jar'), 'lib/demo.jar')
})

test('接线①：宿主真的认领 file.archiveEntries（native/file_queries.cpp）', () => {
  const cpp = read('native/file_queries.cpp')
  assert.match(cpp, /method == "file\.archiveEntries"/, '分派表里要有这一条')
  assert.match(cpp, /-tf/, '清单交给 bsdtar -tf，不在原生层自己解 zip')
  assert.match(cpp, /CreateProcessW/, '参数走 CreateProcessW，不拼 shell 字符串')
  assert.match(cpp, /kMaxArchiveEntries/, '条目数有上限（不能把桥撑爆）')
})

test('接线②：行模型在真生产链路上（不是只有测试在 import）', () => {
  const source = read('src/jarEntriesSource.ts')
  const pane = read('src/components/JarEntriesPane.vue')
  const host = read('src/components/ProjectStructurePane.vue')
  assert.match(importLines(source), /from '\.\/rootsJarEntries\.ts'/, '取数面 import 行模型')
  assert.match(importLines(source), /jarRowsFromListing/, '并且真的用它出行')
  assert.match(importLines(pane), /from '\.\.\/rootsJarEntries\.ts'/, '组件用 url 那一半')
  assert.match(importLines(pane), /from '\.\.\/jarEntriesSource/, '组件的数来自取数面')
  assert.match(importLines(host), /from '\.\/JarEntriesPane\.vue'/, '项目结构面板挂上这个组件')
  assert.match(host, /<JarEntriesPane/, '而且真的画它（不是 import 了就完事）')
  assert.match(host, /jarChannel === 'live'/, '通道不在就整段不画')
})

test('接线③：没有假控件 —— 拿不到不渲染，也不给归档写入口', () => {
  const pane = read('src/components/JarEntriesPane.vue')
  const template = pane.slice(pane.indexOf('<template>'))
  assert.match(template, /v-if="rows\.length"/, '一行都没有 ⇒ 整块不渲染')
  for (const fake of ['（空）', '暂无', '没有条目', '加载中…']) {
    assert.equal(template.includes(fake), false, `不许出现占位文案 ${fake}`)
  }
  assert.equal(template.includes('@click'), false, '条目行没有点击语义（本仓读不了任意档案内条目，不给假反应）')
  for (const write of ['删除', '重命名', '新建', '保存']) {
    assert.equal(template.includes(write), false, `归档在上游是只读的（ArchiveFileSystem.java:99-100），不该出现「${write}」`)
  }
})
