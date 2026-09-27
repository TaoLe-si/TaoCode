// 「帮助」菜单（IDEA HelpMenu）的规则与接线单测。
//
// 源码依据：
//   · 菜单结构 `platform/platform-impl/resources/idea/PlatformActions.xml:746-775`
//   · `ShowLogAction.java:33-40`（显示日志）、`CollectZippedLogsAction.kt:42-110`（收集日志并打包）
//   · `BrowseSpecialPathsAction.kt`（浏览特殊目录）、`AboutAction.java`（关于）
//   · `CollectTroubleshootingInformationAction`（复制排障信息）
// 本仓的宿主通道在 native/diagnostics.cpp（日志文件 / 特殊目录 / 打包 / 排障文本 / 关于信息）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'

const app = () => readFileSync('src/App.vue', 'utf8')

test('菜单栏有「帮助」组，且按 Git → 窗口 → 帮助 的源码顺序排（menuUi 负责插窗口）', () => {
  const source = app()
  assert.ok(source.includes("{ menu: 'help' as const, label: '帮助', rows: helpMenuRows }"), '主菜单里没有帮助组')
  // 「窗口」是 menuUi 在 git 之后 splice 进去的；帮助跟在 git 后面 ⇒ 最终顺序是 Git → Window → Help。
  const menuUi = readFileSync('src/menuUi.ts', 'utf8')
  // 这里只保「窗口组用的是组装好的行」——布局组在窗口组里的**位置**由 tool-layout.test.mjs 盯着
  // （它原先在这里也钉了 `splice(afterSearch, …)` 的写法，改实现就误报，属于钉实现不钉行为）。
  assert.match(menuUi, /const windowGroup = \{ menu: 'window' as const, label: '窗口', rows: windowRows \}/, '窗口组不再用组装好的行')
  // 窗口组跟在 git 之后；「插件」组存在时它整体后移一位（`at + 3`），所以 Git → Window → Help 不变。
  assert.match(menuUi, /next\.splice\(at \+ \(pluginRows\.length \? 3 : 2\), 0, windowGroup\)/, '窗口组的插入位置变了（帮助的顺序会跟着变）')
  // 「插件」组（启用插件贡献的命令）插在工具组之后、git 之前；没有命令时整组不出现。
  assert.match(menuUi, /if \(pluginRows\.length\) next\.splice\(at \+ 1, 0, \{ menu: 'plugins' as const/, '插件组的插入位置变了')
  assert.ok(source.includes("'window' | 'help' | null"), 'menu 的联合类型里没有 help')
})

test('能落地的五行都在，且都指向真实实现（不是空壳）', () => {
  const rows = readFileSync('src/menus/helpMenu.ts', 'utf8')
  for (const id of ['help.gotoAction', 'help.keymapReference', 'help.showLog', 'help.collectLogs', 'help.about'])
    assert.ok(rows.includes(`id: '${id}'`), `帮助菜单缺少 ${id}`)
  // 每一行的 run 都必须落到 helpActions（或既有的查找操作）上
  assert.ok(rows.includes('run: () => ctx.openActionSearch()'), '查找操作没有落点')
  assert.ok(rows.includes('void ctx.showLog()'), '显示日志没有落点')
  assert.ok(rows.includes('void ctx.collectLogs()'), '收集日志没有落点')
  assert.ok(rows.includes('void ctx.showAbout()'), '关于没有落点')
  assert.ok(rows.includes("id: 'help.diagnosticTools'"), '诊断工具子菜单缺失')
  assert.ok(rows.includes("id: 'help.browseSpecialPaths'"), '浏览特殊目录缺失')
  assert.ok(rows.includes('void ctx.copyTroubleshooting()'), '复制排障信息没有落点')
})

test('待办项不渲染（IDEA 有、本仓没有对应能力的行）', () => {
  const rows = readFileSync('src/menus/helpMenu.ts', 'utf8')
  // 这些行在 IDEA 里指向 JetBrains 的站点/工单/学习插件/性能工具：本仓没有对应能力，
  // 按硬规则 4「没有真实消费链路的设置项不渲染」不造空行；缺的能力在文件头逐条登记。
  for (const absent of ['help.topics', 'help.onlineDoc', 'help.jetbrainsTv', 'help.technicalSupport',
                        'help.reportProblem', 'help.sendFeedback', 'help.learn',
                        'help.activityMonitor', 'help.dumpThreads', 'help.memTester', 'help.logDebugConfigure'])
    assert.equal(rows.includes(`id: '${absent}'`), false, `${absent} 被渲染了，但它没有落点`)
  // 登记必须同时存在（缺的能力 + 排期口径），否则就是"悄悄没做"
  assert.ok(rows.includes('待办'), '待办项没有被登记')
})

test('对话框与宿主通道都接上了', () => {
  const source = app()
  assert.ok(source.includes('<AboutDialog v-if="aboutOpen"'), 'App 没有挂「关于」对话框')
  assert.ok(source.includes('<SpecialPathsDialog v-if="specialPathsOpen"'), 'App 没有挂「浏览特殊目录」对话框')
  assert.ok(source.includes('createHelpActions({'), 'App 没有装配帮助动作')
  // 前端方法白名单（bridge 的 Method union）必须包含这五个宿主方法，否则请求发不出去
  const bridge = readFileSync('src/bridge.ts', 'utf8')
  for (const method of ['app.info', 'app.logPaths', 'app.specialPaths', 'app.collectLogs', 'app.troubleshooting'])
    assert.ok(bridge.includes(`'${method}'`), `Method union 里缺少 ${method}`)
})

test('原生侧提供这五个路由，并且日志/打包能力在 diagnostics 模块里', () => {
  const main = readFileSync('native/main.cpp', 'utf8')
  for (const route of ['app.info', 'app.logPaths', 'app.specialPaths', 'app.collectLogs', 'app.troubleshooting'])
    assert.ok(main.includes(`case "${route}"_h:`), `原生没有 ${route} 路由`)
  const diagnostics = readFileSync('native/diagnostics.cpp', 'utf8')
  assert.ok(diagnostics.includes('Json collect_logs('), '没有打包日志的实现')
  assert.ok(diagnostics.includes('Json troubleshooting('), '没有排障信息的实现')
  // 日志写在 profile/log/taocode.log，且超过阈值轮转成 .1（避免无限增长）
  assert.ok(diagnostics.includes('L"log"') && diagnostics.includes('L"taocode.log"'), '日志路径不对')
  assert.ok(diagnostics.includes('kLogRotateBytes'), '没有轮转阈值')
  // 打包用 store（无压缩）的最小 ZIP 写入器
  const zip = readFileSync('native/zipstore.cpp', 'utf8')
  assert.ok(zip.includes('0x04034b50u') && zip.includes('0x06054b50u'), 'ZIP 结构不完整')
})

test('帮助菜单的源码字符串不会漂移成「谁都能改的空壳」', () => {
  // shellSource 覆盖 App.vue + menus/*.ts；菜单行在 menus/helpMenu.ts 里，必须能被它看到。
  const source = shellSource()
  assert.ok(source.includes("id: 'help.showLog'"), 'shellSource 里没有帮助菜单（说明它没被装进菜单表）')
  assert.ok(source.includes('createHelpMenuRows'), '帮助菜单的工厂没有被调用')
})
