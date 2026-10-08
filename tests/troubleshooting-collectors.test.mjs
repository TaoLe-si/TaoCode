// `pf/troubleshooting` 的收集器判据（`src/troubleshootingCollectors.ts` + `src/helpActions.ts` 接线）。
//
// 上游依据：
//   · `GeneralTroubleInfoCollector`（`getTitle`/`collectInfo`）与
//     `CompositeGeneralTroubleInfoCollector.collectInfo` 的 `=== Title ===\n<trim>\n\n` 拼接；
//   · `SystemTroubleInfoCollector`（CPU/内存数字）、`PluginTroubleInfoCollector`
//     （`Custom plugins: [...]` / `Disabled plugins:[...]`）、`DisplayTroubleInfoCollector`
//     （`Display N: WxH; scale: P%, bounds: WxH @ (x; y)`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectTroubleshootingReport, compositeCollectInfo, createGeneralTroubleInfoCollectors } from '../src/troubleshootingCollectors.ts'

const snapshot = {
  info: { version: '1.2.3', platform: 'Windows 10', arch: 'x64', webview2: '120.0', profile: 'C:/Users/x/AppData' },
  memory: { workingSetMb: 512, peakWorkingSetMb: 700, privateMb: 400 },
  plugins: [
    { name: 'Alpha', version: '2.0', enabled: true },
    { name: 'Beta', version: '', enabled: false },
  ],
  screens: [{ width: 2560, height: 1440, scalePercent: 150 }],
  cpuCount: 16,
}

test('复合拼接：=== 标题 === 两行一段，空段跳过、结尾不留空段', () => {
  const text = compositeCollectInfo([
    { title: 'A', collectInfo: () => 'value' },
    { title: 'Empty', collectInfo: () => '   ' },
    { title: 'B', collectInfo: () => 'line1\nline2' },
  ])
  assert.equal(text, '=== A ===\nvalue\n\n=== B ===\nline1\nline2')
  assert.equal(compositeCollectInfo([]), '')
})

test('四条收集器：字段格式照上游（About/System/Plugins/Displays）', () => {
  const collectors = createGeneralTroubleInfoCollectors(() => snapshot)
  const byTitle = Object.fromEntries(collectors.map(collector => [collector.title, collector.collectInfo()]))
  assert.match(byTitle.About, /^Build version: TaoCode 1\.2\.3\n/)
  assert.match(byTitle.About, /Operating System: Windows 10 \(x64\)/)
  assert.match(byTitle.About, /WebView2: 120\.0/)
  assert.equal(byTitle.System, 'Number of CPU: 16\nWorking set: 512Mb\nPeak working set: 700Mb\nPrivate memory: 400Mb\n')
  assert.equal(byTitle.Plugins, 'Custom plugins: [Alpha (2.0)]\nDisabled plugins:[Beta]\n')
  assert.equal(byTitle.Displays, 'Display 0: 2560x1440; scale: 150%, bounds: 2560x1440 @ (0; 0)')
})

test('数据缺失的段省略（不写空话）；整份报告按标题顺序排列', () => {
  const report = collectTroubleshootingReport(() => ({ screens: [] }))
  assert.equal(report, '', '全缺时不出报告')
  const partial = collectTroubleshootingReport(() => ({
    info: snapshot.info, memory: null, plugins: [], screens: [], cpuCount: 8,
  }))
  assert.ok(partial.startsWith('=== About ==='), 'About 在前')
  assert.ok(!partial.includes('=== System ==='), '没有内存数据就不出 System 段')
  assert.ok(partial.includes('=== Plugins ==='), '插件列表为空数组仍然出段（明确写出两个空表）')
  assert.ok(partial.includes('Custom plugins: []'))
  assert.ok(!partial.includes('=== Displays ==='), '没有屏幕数据不出 Displays 段')
})

test('接线：复制排障信息把宿主文本与前端收集器拼起来', () => {
  const source = readFileSync('src/helpActions.ts', 'utf8')
  // 只锚定「从 troubleshootingCollectors 引入收集器」这一条 —— 具名导入表会随
  // `ProjectTroubleContext` 之类的补充导入变长，锚整个列表会在无关改动上误报。
  assert.match(source, /import \{[^}]*collectTroubleshootingReport[^}]*\} from '\.\/troubleshootingCollectors\.ts'/s,
    'helpActions 没有引入收集器')
  assert.ok(source.includes("await request<{ text: string }>('app.troubleshooting')"), '宿主排障文本通道被替换掉了')
  assert.ok(source.includes('copyToClipboard(report ? `${host.text}\\n\\n${report}` : host.text)'),
    '没有把前端收集器的一段拼到宿主文本后面')
  assert.ok(source.includes("request<ProcessMemory>('app.memory')"), 'System 段没有内存数据来源')
  assert.ok(source.includes("request<PluginList>('plugin.list')"), 'Plugins 段没有插件数据来源')
  // Project 段（`ProjectTroubleInfoCollector.java:11-18`）：宿主注入的 `projectContext` 必须真被喂进
  // 快照 —— 2026-10-06 本 lane 发现它此前只是注入了 deps 字段却没人读，Project 段永远不出现。
  assert.ok(source.includes('project: deps.projectContext?.() ?? null'),
    'Project 段的数据源（deps.projectContext）没有喂进 collectTroubleshootingReport 的快照')
})
