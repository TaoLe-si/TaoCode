// exec/coverage 本轮的判据：报告位置识别（Gradle/Maven/Kover/coverage 目录）、
// JaCoCo XML 解析（sourcefile LINE 计数器 + 根计数器兜底）与 RunConsole 的接线。
// 判词同时说明采集通道（JVM -javaagent / DAP 覆盖率事件）在本仓不存在。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectCoverageReportPath, coverageAvailableGroupings, coverageFormatOf, coveragePercentText, coverageViewSection, isCoverageReportPath, MAX_COVERAGE_FILES, MAX_COVERAGE_METHODS, parseCoberturaXml, parseCoverageReport, parseJacocoXml, parseLcovInfo } from '../src/coverageReport.ts'
import { COVERAGE_EXPORT_DIALOG_TITLE, COVERAGE_EXPORT_FILE_NAME, coverageReportExportAvailable, coverageReportExportPath, coverageReportHtml } from '../src/coverageExport.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('报告位置：认 Gradle/Maven/Kover/coverage 的标准 XML 与 LCOV .info，不认无关 xml', () => {
  assert.ok(isCoverageReportPath('build/reports/jacoco/test/jacocoTestReport.xml'))
  assert.ok(isCoverageReportPath('app/build\\reports\\kover\\report.xml'))
  assert.ok(isCoverageReportPath('target/site/jacoco/jacoco.xml'))
  assert.ok(isCoverageReportPath('coverage/coverage.xml'))
  assert.ok(isCoverageReportPath('coverage/lcov.info'))
  assert.ok(isCoverageReportPath('lcov.info'))
  assert.ok(!isCoverageReportPath('build/reports/tests/test/index.html'))
  assert.ok(!isCoverageReportPath('src/main/resources/report.xml'))
  assert.equal(collectCoverageReportPath(['a/b.xml']), null)
  assert.equal(
    collectCoverageReportPath(['coverage/x.xml', 'build/reports/jacoco/test/jacocoTestReport.xml']),
    'build/reports/jacoco/test/jacocoTestReport.xml',
    '默认产物名优先',
  )
  assert.equal(collectCoverageReportPath(['target/site/jacoco/jacoco.xml', 'coverage/x.xml']), 'target/site/jacoco/jacoco.xml')
})

test('格式判定：jacoco/cobertura/lcov/unknown，且分发入口按内容兜底', () => {
  assert.equal(coverageFormatOf('build/reports/jacoco/test/jacocoTestReport.xml'), 'jacoco')
  assert.equal(coverageFormatOf('build/reports/kover/report.xml'), 'jacoco')
  assert.equal(coverageFormatOf('coverage/cobertura.xml'), 'cobertura')
  assert.equal(coverageFormatOf('coverage/lcov.info'), 'lcov')
  assert.equal(coverageFormatOf('coverage/something.xml'), 'unknown')
  // 内容兜底：名字认不出时看首行。
  assert.equal(parseCoverageReport('SF:/a/b.c\nDA:1,1\nend_of_record\n', 'coverage/unknown.xml').format, 'lcov')
  assert.equal(parseCoverageReport('<coverage><packages/></coverage>', 'coverage/unknown.xml').format, 'cobertura')
  assert.equal(parseCoverageReport('<report><counter type="LINE" missed="1" covered="1"/></report>', 'coverage/unknown.xml').format, 'jacoco')
})

test('JaCoCo 解析：包路径 + sourcefile 的 LINE 计数器 → 逐文件与总计的行覆盖率', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<report name="demo">
  <package name="com/example">
    <sourcefile name="Main.java">
      <counter type="INSTRUCTION" missed="3" covered="7"/>
      <counter type="LINE" missed="1" covered="9"/>
      <counter type="METHOD" missed="0" covered="2"/>
    </sourcefile>
    <sourcefile name="Util.java">
      <counter type="LINE" missed="4" covered="0"/>
    </sourcefile>
  </package>
  <package name="com/example/sub">
    <sourcefile name="Deep.java">
      <counter type="LINE" missed="0" covered="5"/>
    </sourcefile>
  </package>
  <counter type="LINE" missed="5" covered="14"/>
</report>`
  const summary = parseJacocoXml(xml, 'build/reports/jacoco/test/jacocoTestReport.xml')
  assert.equal(summary.reportPath, 'build/reports/jacoco/test/jacocoTestReport.xml')
  assert.deepEqual(summary.files.map(file => file.path), ['com/example/Main.java', 'com/example/Util.java', 'com/example/sub/Deep.java'])
  assert.equal(summary.files[0].percent, 90)
  assert.equal(summary.files[1].percent, 0)
  assert.equal(summary.coveredLines, 14)
  assert.equal(summary.missedLines, 5)
  assert.equal(summary.percent, 73.7)
  assert.equal(summary.truncated, false)
})

test('JaCoCo 解析：没有 sourcefile 的报告退回根 LINE 计数器；实体解码；超限截断', () => {
  const total = parseJacocoXml('<report><counter type="LINE" missed="2" covered="6"/></report>', 'coverage/total.xml')
  assert.deepEqual([total.coveredLines, total.missedLines, total.percent], [6, 2, 75])
  assert.deepEqual(total.files, [])
  const escaped = parseJacocoXml('<report><package name="a&amp;b"><sourcefile name="X&lt;Y&gt;.java"><counter type="LINE" missed="0" covered="1"/></sourcefile></package></report>', 'coverage/x.xml')
  assert.equal(escaped.files[0].path, 'a&b/X<Y>.java')
  const many = Array.from({ length: MAX_COVERAGE_FILES + 3 }, (_, index) =>
    `<sourcefile name="F${index}.java"><counter type="LINE" missed="0" covered="1"/></sourcefile>`).join('')
  const truncatedXml = `<report><package name="p">${many}</package></report>`
  const truncated = parseJacocoXml(truncatedXml, 'coverage/big.xml')
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.files.length, MAX_COVERAGE_FILES)
  assert.equal(truncated.coveredLines, MAX_COVERAGE_FILES + 3, '总计仍按全部文件算')
})

test('接线：RunConsole 运行结束自动读报告 → 委托 CoverageReportPane（不再内联解析）；DAP 没有覆盖率通道', () => {
  const console = read('src/components/RunConsole.vue')
  // 展示面（四档聚合 + 三格式分发）整个搬进 CoverageReportPane.vue；RunConsole 只挂它、喊它 load()。
  assert.match(console, /import CoverageReportPane from '\.\/CoverageReportPane\.vue'/, '覆盖率展示面委托给 CoverageReportPane')
  assert.match(console, /<CoverageReportPane v-if="activeRecord" ref="coveragePane" :instance="activeRecord\.id" :ready="isDesktop"/, '把当前实例与桌面就绪传给面板')
  // 运行结束的那一刻自动读一次（测试任务会在退出前写好报告文件）。
  assert.match(console, /if \(wasRunning && !running\) void coveragePane\.value\?\.load\(\)/, '运行结束自动读报告')
  // 切换当前实例也重读（否则面板还停在上一条实例的报告上）。
  assert.match(console, /else if \(active !== prevActive && active\) void coveragePane\.value\?\.load\(\)/, '切换实例重读报告')
  // 读报告半边（位置识别 / 解析 / 落进实例）**不在** RunConsole 里重写：那三件事分别在
  // src/coverageReport.ts（collectCoverageReportPath / parseCoverageReport）与 CoverageReportPane.vue（setInstanceCoverage）。
  assert.ok(!/parseJacocoXml|collectCoverageReportPath|setInstanceCoverage/.test(console),
    'RunConsole 不该再自己解析覆盖率报告（已委托给 CoverageReportPane）')
  const dap = read('native/dap.cpp')
  assert.ok(!/coverage/i.test(dap), 'DAP 客户端没有覆盖率面的请求/事件（判词里的「没有采集通道」以此为准）')
})

test('逐包/逐类聚合：<package> 分组与 <class> 的 LINE 计数器', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<report name="demo">
  <package name="com/example">
    <class name="com/example/Main" sourcefilename="Main.java"><counter type="LINE" missed="1" covered="9"/></class>
    <class name="com/example/Util" sourcefilename="Util.java"><counter type="LINE" missed="4" covered="0"/></class>
    <sourcefile name="Main.java"><counter type="LINE" missed="1" covered="9"/></sourcefile>
    <sourcefile name="Util.java"><counter type="LINE" missed="4" covered="0"/></sourcefile>
  </package>
  <package name="com/example/sub">
    <class name="com/example/sub/Deep" sourcefilename="Deep.java"><counter type="LINE" missed="0" covered="5"/></class>
    <sourcefile name="Deep.java"><counter type="LINE" missed="0" covered="5"/></sourcefile>
  </package>
  <counter type="LINE" missed="5" covered="14"/>
</report>`
  const summary = parseJacocoXml(xml, 'build/reports/jacoco/test/jacocoTestReport.xml')
  assert.deepEqual(summary.packages.map(p => p.name), ['com/example', 'com/example/sub'], '按包名排序')
  const main = summary.packages[0]
  assert.equal(main.files.length, 2)
  assert.equal(main.coveredLines, 9)
  assert.equal(main.missedLines, 5)
  assert.equal(main.percent, 64.3)
  assert.equal(summary.packages[1].percent, 100)
  assert.deepEqual(summary.classes.map(c => c.name), ['com/example/Main', 'com/example/Util', 'com/example/sub/Deep'], '按类名排序')
  assert.equal(summary.classes[0].sourceFile, 'Main.java')
  assert.equal(summary.classes[0].percent, 90)
  assert.equal(summary.classesTruncated, false)
})

test('逐类：同一个类出现多次时合并计数；没有 <class> 时是空表', () => {
  const xml = `<report><package name="p">
    <class name="p/A" sourcefilename="A.java"><counter type="LINE" missed="1" covered="1"/></class>
    <class name="p/A" sourcefilename="A.java"><counter type="LINE" missed="2" covered="2"/></class>
  </package></report>`
  const summary = parseJacocoXml(xml, 'coverage/x.xml')
  assert.equal(summary.classes.length, 1, '同名类合并成一条')
  assert.deepEqual([summary.classes[0].coveredLines, summary.classes[0].missedLines], [3, 3])
  assert.equal(summary.classes[0].percent, 50)
  const noClasses = parseJacocoXml('<report><package name="p"><sourcefile name="A.java"><counter type="LINE" missed="0" covered="1"/></sourcefile></package></report>', 'coverage/y.xml')
  assert.deepEqual(noClasses.classes, [])
})

test('JaCoCo 方法级聚合：<method> 的 LINE 计数器（CoverageSuite 的方法级汇总）', () => {
  const xml = `<report><package name="com/example">
    <class name="com/example/Main" sourcefilename="Main.java">
      <method name="run" desc="()V"><counter type="LINE" missed="1" covered="4"/></method>
      <method name="stop" desc="()V"><counter type="LINE" missed="2" covered="0"/></method>
      <counter type="LINE" missed="3" covered="4"/>
    </class>
    <sourcefile name="Main.java"><counter type="LINE" missed="3" covered="4"/></sourcefile>
  </package></report>`
  const summary = parseJacocoXml(xml, 'build/reports/jacoco/test/jacocoTestReport.xml')
  assert.deepEqual(summary.methods.map(m => m.name), ['run', 'stop'], '按方法名排序')
  assert.equal(summary.methods[0].className, 'com/example/Main')
  assert.equal(summary.methods[0].sourceFile, 'Main.java')
  assert.deepEqual([summary.methods[0].coveredLines, summary.methods[0].missedLines], [4, 1])
  assert.equal(summary.methods[0].percent, 80)
  assert.equal(summary.methods[1].percent, 0)
  assert.equal(summary.methodsTruncated, false)
  assert.equal(summary.format, 'jacoco')
  // 没有 <method> 时是空表（不编造方法）。
  const noMethods = parseJacocoXml('<report><package name="p"><class name="p/A" sourcefilename="A.java"><counter type="LINE" missed="0" covered="1"/></class></package></report>', 'coverage/x.xml')
  assert.deepEqual(noMethods.methods, [])
})

test('LCOV .info：SF/DA 段 → 逐文件行覆盖；无包/类/方法层级', () => {
  const info = [
    'TN:',
    'SF:/src/main.c',
    'DA:1,1',
    'DA:2,1',
    'DA:3,0',
    'DA:4,0',
    'LF:4',
    'LH:2',
    'end_of_record',
    'SF:src/util.c',
    'DA:10,5',
    'DA:11,0',
    'end_of_record',
  ].join('\n')
  const summary = parseLcovInfo(info, 'coverage/lcov.info')
  assert.equal(summary.format, 'lcov')
  assert.deepEqual(summary.files.map(f => f.path), ['/src/main.c', 'src/util.c'])
  assert.deepEqual([summary.files[0].coveredLines, summary.files[0].missedLines], [2, 2])
  assert.equal(summary.files[0].percent, 50)
  assert.deepEqual([summary.files[1].coveredLines, summary.files[1].missedLines], [1, 1])
  assert.deepEqual([summary.coveredLines, summary.missedLines, summary.percent], [3, 3, 50])
  assert.deepEqual(summary.packages, [], 'LCOV 没有包层级，不编造')
  assert.deepEqual(summary.classes, [])
  assert.deepEqual(summary.methods, [])
  // 反斜杠路径归一化；没有 end_of_record 时最后一段也要收尾。
  const trailing = parseLcovInfo('SF:a\\b\\c.c\nDA:1,0\n', 'coverage/lcov.info')
  assert.equal(trailing.files[0].path, 'a/b/c.c')
  assert.equal(trailing.files[0].missedLines, 1)
  assert.equal(trailing.percent, 0)
})

test('Cobertura XML：<class filename> 的 <line hits> → 逐文件/逐包/逐类/逐方法', () => {
  const xml = `<coverage line-rate="0.5" version="1.9">
    <packages>
      <package name="app" line-rate="0.5">
        <classes>
          <class name="app.Main" filename="app/main.py" line-rate="0.5">
            <methods>
              <method name="run" signature="()">
                <lines><line number="3" hits="1"/><line number="4" hits="0"/></lines>
              </method>
            </methods>
            <lines><line number="3" hits="1"/><line number="4" hits="0"/><line number="5" hits="0"/></lines>
          </class>
        </classes>
      </package>
    </packages>
  </coverage>`
  const summary = parseCoberturaXml(xml, 'coverage/cobertura.xml')
  assert.equal(summary.format, 'cobertura')
  assert.deepEqual(summary.files.map(f => f.path), ['app/app/main.py'])
  // 类级行数不含方法段里的重复行（3 hits=1, 4 hits=0, 5 hits=0 → covered 1, missed 2）。
  assert.deepEqual([summary.files[0].coveredLines, summary.files[0].missedLines], [1, 2])
  assert.equal(summary.files[0].percent, 33.3)
  assert.deepEqual(summary.packages.map(p => p.name), ['app'])
  assert.deepEqual(summary.classes.map(c => c.name), ['app.Main'])
  assert.equal(summary.classes[0].sourceFile, 'app/main.py')
  assert.deepEqual(summary.methods.map(m => m.name), ['run'])
  assert.deepEqual([summary.methods[0].coveredLines, summary.methods[0].missedLines], [1, 1])
  assert.equal(summary.methodsTruncated, false)
  // 只有根 <line>（没有 <class>）的总览报告：按根行计数，files 为空。
  const rootOnly = parseCoberturaXml('<coverage><packages/><line number="1" hits="1"/><line number="2" hits="0"/></coverage>', 'coverage/cobertura.xml')
  assert.deepEqual(rootOnly.files, [])
  assert.deepEqual([rootOnly.coveredLines, rootOnly.missedLines], [1, 1])
})

test('方法级超限截断（MAX_COVERAGE_METHODS）', () => {
  const methods = Array.from({ length: MAX_COVERAGE_METHODS + 2 }, (_, index) =>
    `<method name="m${index}"><counter type="LINE" missed="0" covered="1"/></method>`).join('')
  const xml = `<report><package name="p"><class name="p/A" sourcefilename="A.java">${methods}<counter type="LINE" missed="0" covered="1"/></class></package></report>`
  const summary = parseJacocoXml(xml, 'coverage/big.xml')
  assert.equal(summary.methodsTruncated, true)
  assert.equal(summary.methods.length, MAX_COVERAGE_METHODS)
})

// ── 展示面的视图模型（CoverageReportPane.vue 的四档聚合；规则在 src/coverageReport.ts）──

test('四档视图：文件/包/类/方法各取各的行，空档 available=false（LCOV 只有文件级）', () => {
  const xml = `<report><package name="com/example"><sourcefile name="Main.java"><counter type="LINE" missed="2" covered="8"/></sourcefile>`
    + `<class name="com/example/Main" sourcefilename="Main.java"><method name="run"><counter type="LINE" missed="1" covered="4"/></method><method name="stop"><counter type="LINE" missed="1" covered="0"/></method><counter type="LINE" missed="2" covered="4"/></class></package></report>`
  const summary = parseCoverageReport(xml, 'build/reports/jacoco/test/jacocoTestReport.xml')
  assert.deepEqual(coverageAvailableGroupings(summary), { file: true, package: true, class: true, method: true })
  const files = coverageViewSection(summary, 'file')
  assert.deepEqual(files.rows.map(row => row.label), ['com/example/Main.java'])
  const packages = coverageViewSection(summary, 'package')
  assert.deepEqual(packages.rows.map(row => [row.label, row.detail]), [['com/example', '1 个文件']])
  const classes = coverageViewSection(summary, 'class')
  assert.deepEqual(classes.rows.map(row => [row.label, row.detail]), [['com/example/Main', 'Main.java']])
  const methods = coverageViewSection(summary, 'method')
  assert.deepEqual(methods.rows.map(row => row.label), ['run', 'stop'], '按方法名排序（解析器保证）')
  assert.deepEqual(methods.rows.map(row => row.detail), ['com/example/Main', 'com/example/Main'], '方法行带所属类')
  assert.deepEqual(methods.rows.map(row => row.percent), [80, 0])
  // 每档的 key 唯一（v-for 需要）。
  const keys = methods.rows.map(row => row.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('LCOV / Cobertura 走同一套视图：LCOV 只有文件级，Cobertura 有包/类/方法', () => {
  const lcov = parseLcovInfo('SF:/a/b.c\nDA:1,1\nDA:2,0\nend_of_record\n', 'coverage/lcov.info')
  assert.deepEqual(coverageAvailableGroupings(lcov), { file: true, package: false, class: false, method: false })
  assert.equal(coverageViewSection(lcov, 'package').available, false)
  assert.deepEqual(coverageViewSection(lcov, 'file').rows.map(row => row.label), ['/a/b.c'])
  // Cobertura 的方法行归属由所在的 `<class>` 决定（className = `A`，sourceFile = `a.py`），
  // 与 JaCoCo 那一支同一条规则。
  const cobertura = parseCoberturaXml(
    '<coverage><packages><package name="pkg"><classes><class name="A" filename="a.py"><methods>'
    + '<method name="m"><lines><line number="1" hits="1"/><line number="2" hits="0"/></lines></method></methods>'
    + '<lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>',
    'coverage/cobertura.xml')
  const methods = coverageViewSection(cobertura, 'method')
  assert.deepEqual(methods.rows.map(row => [row.label, row.detail, row.percent]), [['m', 'A', 50]])
})

test('空汇总：四档全不可用，不给"0%"冒充一行都没覆盖', () => {
  const empty = parseCoverageReport('', 'coverage/lcov.info')
  assert.deepEqual(coverageAvailableGroupings(empty), { file: false, package: false, class: false, method: false })
  assert.deepEqual(coverageViewSection(empty, 'file').rows, [])
  assert.deepEqual(coverageAvailableGroupings(null), { file: false, package: false, class: false, method: false })
  assert.equal(coveragePercentText(0, 0), '—', '没有行总数时不是 0%')
  assert.equal(coveragePercentText(3, 1), '75%')
})

test('接线：CoverageReportPane 走三格式分发入口与四档行模型，不自己重写规则', () => {
  const pane = read('src/components/CoverageReportPane.vue')
  assert.match(pane, /collectCoverageReportPath\(listing\?\.files \?\? \[\]\)/, '报告位置识别')
  assert.match(pane, /parseCoverageReport\(doc\?\.content \?\? '', report\)/, '三格式分发入口（不是只 parseJacocoXml）')
  assert.match(pane, /coverageViewSection\(summary\.value, grouping\.value\)/, '四档行模型')
  assert.match(pane, /coverageAvailableGroupings\(summary\.value\)/, '档位可用性')
  assert.match(pane, /setInstanceCoverage\(props\.instance, parsed\)/, '读到报告同时记进实例')
  assert.match(pane, /aria-label="读取覆盖率报告"/)
  assert.match(pane, /按方法 \(/, '方法级切换按钮')
  assert.match(pane, /COVERAGE_FORMAT_LABELS/, '标题显示读的是哪种格式')
})

// ── 导出（上游 `GenerateCoverageReportAction` → `ExportToHTMLDialog`） ─────────────────
// 门、文件名、自包含 HTML、落盘接线四件事都核：判据要能红在"门放行了空报告"、
// "导出里夹带外部资源"、"面板没接宿主那两条通道"这几种真缺陷上。

test('导出：门 = 有报告内容才可用（没有报告/空报告一律 false）', () => {
  assert.equal(coverageReportExportAvailable(null), false)
  assert.equal(coverageReportExportAvailable(undefined), false)
  assert.equal(coverageReportExportAvailable(parseCoverageReport('', 'coverage/lcov.info')), false,
    '空报告（0 文件 0 行）不许导出 —— 那是"生成一份空报告"')
  assert.equal(coverageReportExportAvailable(parseLcovInfo('SF:/a/b.c\nDA:1,1\nend_of_record\n', 'coverage/lcov.info')), true)
  const rootOnly = parseJacocoXml('<report><counter type="LINE" missed="2" covered="3"/></report>', 'coverage/jacoco.xml')
  assert.equal(coverageReportExportAvailable(rootOnly), true, '只有根计数器的总览报告也算有内容')
})

test('导出：自包含 HTML —— 四档表都在、没有外部资源/脚本、路径与内容都转义', () => {
  const summary = parseJacocoXml(
    '<report><package name="p"><sourcefile name="A.java"><counter type="LINE" missed="1" covered="3"/></sourcefile>'
    + '<class name="p/A" sourcefilename="A.java"><counter type="LINE" missed="1" covered="3"/>'
    + '<method name="run" desc="()V"><counter type="LINE" missed="1" covered="3"/></method></class>'
    + '<class name="p/B" sourcefilename="B.java"><counter type="LINE" missed="2" covered="0"/></class></package></report>',
    'coverage/jacoco.xml')
  const html = coverageReportHtml(summary, { generatedAt: new Date('2026-10-08T00:00:00Z') })
  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /<meta charset="utf-8" \/>/)
  assert.match(html, /p\/A\.java/, '逐文件表')
  for (const heading of ['按文件（1）', '按包（1）', '按类（2）', '按方法（1）']) {
    assert.ok(html.includes(heading), `缺 ${heading} 那张表`)
  }
  assert.match(html, /行覆盖 75%/, '总计百分比')
  assert.match(html, /JaCoCo \/ Kover/, '格式标签')
  assert.match(html, /2026-10-08T00:00:00\.000Z/, '生成时间进导出的元信息')
  // 自包含：不许有脚本、外链、img/iframe（导出的文件要能离线双击打开）。
  assert.equal(/<script/i.test(html), false)
  assert.equal(/<img|<iframe|<link\b/i.test(html), false)
  assert.equal(/https?:\/\//i.test(html), false, '不许引用外部地址')

  // 转义：路径/类名里的尖括号与 & 不许原样进 HTML（否则报告文件本身就是注入面）。
  const nasty = parseLcovInfo('SF:/tmp/<script>alert(1)</script> & co.c\nDA:1,1\nend_of_record\n', 'coverage/lcov.info')
  const escaped = coverageReportHtml(nasty)
  assert.equal(escaped.includes('<script>'), false, '原始 <script> 不许出现')
  assert.ok(escaped.includes('&lt;script&gt;'), '必须转义成实体')
  assert.ok(escaped.includes('&amp;'), '& 也要转义')
})

test('导出：LCOV 只写文件表（空档不写空表），文件名与落盘路径照上游那棵树', () => {
  const lcov = parseLcovInfo('SF:/a/b.c\nDA:1,1\nend_of_record\n', 'coverage/lcov.info')
  const html = coverageReportHtml(lcov)
  assert.ok(html.includes('按文件（1）'))
  for (const heading of ['按包（', '按类（', '按方法（']) {
    assert.equal(html.includes(heading), false, `LCOV 没有 ${heading} 那一档，不许写空表`)
  }
  assert.equal(COVERAGE_EXPORT_FILE_NAME, 'index.html')
  assert.equal(coverageReportExportPath('C:/out'), 'C:/out/index.html')
  assert.equal(coverageReportExportPath('C:\\out\\'), 'C:\\out/index.html', '结尾斜杠要去掉（不多写一层）')
  assert.equal(COVERAGE_EXPORT_DIALOG_TITLE, 'Export', '上游 InspectionsBundle.properties:56')
})

test('接线：CoverageReportPane 的「生成报告」走 pickDirectory + writeExportFiles，门与上游同义', () => {
  const pane = read('src/components/CoverageReportPane.vue')
  assert.match(pane, /coverageReportExportAvailable\(summary\.value\)/, '按钮可用性 = 上游 isReportGenerationAvailable')
  assert.match(pane, /request<string \| null>\('dialog\.pickDirectory', \{ title: COVERAGE_EXPORT_DIALOG_TITLE/, '先选目录（上游 ExportToHTMLDialog）')
  assert.match(pane, /request\('app\.writeExportFiles', \{ files: \[\{ path, content: coverageReportHtml\(current, \{ generatedAt: new Date\(\) \}\) \}\] \}\)/,
    '写盘走既有 .html 通道，内容来自 coverageReportHtml')
  assert.match(pane, /coverageReportExportPath\(directory\)/, '路径拼接走模块里的那一条')
  assert.match(pane, /aria-label="生成覆盖率报告"/)
  assert.match(pane, /没有可导出的报告内容/, '不可用时标题要写明原因（不假装能导出）')
  const module = read('src/coverageExport.ts')
  for (const coordinate of ['GenerateCoverageReportAction.java:22-40', 'ExportToHTMLDialog.kt:19-52', 'InspectionsBundle.properties:55-57']) {
    assert.ok(module.includes(coordinate), `模块注释缺上游坐标 ${coordinate}`)
  }
})
