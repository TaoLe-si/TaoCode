// exec/coverage 本轮的判据：报告位置识别（Gradle/Maven/Kover/coverage 目录）、
// JaCoCo XML 解析（sourcefile LINE 计数器 + 根计数器兜底）与 RunConsole 的接线。
// 判词同时说明采集通道（JVM -javaagent / DAP 覆盖率事件）在本仓不存在。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectCoverageReportPath, isCoverageReportPath, MAX_COVERAGE_FILES, parseJacocoXml } from '../src/coverageReport.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('报告位置：认 Gradle/Maven/Kover/coverage 的标准 XML，不认无关 xml', () => {
  assert.ok(isCoverageReportPath('build/reports/jacoco/test/jacocoTestReport.xml'))
  assert.ok(isCoverageReportPath('app/build\\reports\\kover\\report.xml'))
  assert.ok(isCoverageReportPath('target/site/jacoco/jacoco.xml'))
  assert.ok(isCoverageReportPath('coverage/coverage.xml'))
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

test('接线：RunConsole 运行结束自动读报告、展示报告路径与逐文件表；DAP 没有覆盖率通道', () => {
  const console = read('src/components/RunConsole.vue')
  assert.match(console, /collectCoverageReportPath\(listing\?\.files \?\? \[\]\)/)
  assert.match(console, /parseJacocoXml\(doc\.content \?\? '', report\)/)
  assert.match(console, /setInstanceCoverage\(instanceId, summary\)/)
  assert.match(console, /watch\(anyRunning, \(running, wasRunning\) => \{\s*\n\s*if \(wasRunning && !running\) void loadCoverage\(\)/)
  assert.match(console, /aria-label="读取覆盖率报告"/)
  assert.match(console, /run-coverage-path/)
  const dap = read('native/dap.cpp')
  assert.ok(!/coverage/i.test(dap), 'DAP 客户端没有覆盖率面的请求/事件（判词里的「没有采集通道」以此为准）')
})
