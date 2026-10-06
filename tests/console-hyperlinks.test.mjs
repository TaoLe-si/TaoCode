// `src/consoleHyperlinks.ts` 的判据：控制台一行里**能点开**的 URL 命中、`file:` 命中跳编辑器、
// 以及切片渲染的两条不变量（覆盖整行 / 与既有 splitRunLine 排法一致）。
//
// 上游依据（本轮逐个文件开过、行号自己数）：
//   · 控制台默认带 URL 过滤器：`platform/execution-impl/resources/intellij.platform.execution.impl.xml:63`
//     （`consoleFilterProvider` = `UrlFilter$UrlFilterProvider`），provider 本体
//     `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:152-161`。
//   · 构建控制台再显式挂一次：`java/compiler/impl/src/com/intellij/compiler/progress/BuildOutputService.java:131`。
//   · 单击即跳（不需要 Ctrl）：`platform/platform-impl/src/com/intellij/execution/impl/EditorHyperlinkSupport.java:113-130`，
//     取区间在 `:254-279`，末端那一格不算在 `:263`。
//   · 重叠区间上游在点击时按「同层更短的区间优先」（`IterationState.java:888-897` 的 prefer more specific region），
//     本仓切片渲染改成建表时的确定政策（见 `src/consoleHyperlinks.ts` 文件头）。
//   · 两分支落点：`UrlFilter.java:89-92`（先试文件、否则 OpenUrlHyperlinkInfo）、
//     浏览器那条 `platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:69-72`。
//   · 找不到文件也照样画、点开才报错：`UrlFilter.java:186-195`。
//   · URL / `file:` 两条正则与预检、`.html` 例外、百分号解码等**判定本体**在 `src/terminalHyperlinks.ts`
//     （`UrlFilter.java:54-79`、`:94-123`、`:143-150` 与 `URLUtil.java:50-62`），本文件不重算，只测合成。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { consoleLinkAction, consoleLinkMenuItems, consoleSegments, consoleUrlLinks } from '../src/consoleHyperlinks.ts'
import { splitRunLine } from '../src/runHyperlinks.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('控制台里的 URL 命中可点：协议、端口、查询串都照上游那条正则收', () => {
  const hit = line => consoleUrlLinks(line, [], true).map(row => row.text)
  assert.deepEqual(hit('visit https://example.com/a/b?c=1 now'), ['https://example.com/a/b?c=1'])
  assert.deepEqual(hit('server started at http://localhost:8080/status'), ['http://localhost:8080/status'])
  assert.deepEqual(hit('contact mailto:someone@example.com'), ['mailto:someone@example.com'])
  assert.deepEqual(hit('see ftp://files.example/pub tail'), ['ftp://files.example/pub'])
})

test('点不开的命中不画成链接：无协议前缀的 www. 与浏览器预览没有宿主通道（两条都是真否分支）', () => {
  assert.deepEqual(consoleUrlLinks('go to www.example.org now', [], true), [],
    '宿主 open_external 拒无协议前缀的串（native/file_queries.cpp:234-236）')
  const browser = consoleUrlLinks('visit https://example.com/x', [], true)
  assert.equal(browser.length, 1)
  assert.deepEqual(consoleUrlLinks('visit https://example.com/x', [], false), [],
    '浏览器预览没有 shell.openUrl 这条通道 ⇒ 整条不渲染')
})

test('file: 命中在控制台是跳转（终端面板做不到的那一条，这里通道是现成的）', () => {
  const rows = consoleUrlLinks('report at file:///D:/a/B.java:12 done', [], true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, 'file:///D:/a/B.java:12')
  assert.deepEqual(rows[0].issue, { path: 'D:/a/B.java', line: 12, column: 1 },
    '上游是 0 基（UrlFilter.java:106 的 lastValue - 1），本仓跳转载荷 1 基')
  assert.equal(rows[0].href, 'file:///D:/a/B.java:12')
  assert.match(rows[0].tooltip, /^跳转到 D:\/a\/B\.java:12$/)
})

test('浏览器命中的提示是单击语义（控制台不需要 Ctrl，EditorHyperlinkSupport.java:113-130）', () => {
  const rows = consoleUrlLinks('visit https://example.com/x', [], true)
  assert.equal(rows[0].tooltip, '在浏览器中打开 https://example.com/x')
  assert.equal(rows[0].issue, null)
  assert.doesNotMatch(rows[0].tooltip, /Ctrl/, '提示里不出现 Ctrl —— 那是终端那一侧的手势')
})

test('.html 的 file: 串在控制台也走浏览器分支（继承 UrlFilter.java:95 那条例外）', () => {
  const rows = consoleUrlLinks('open file:D:/site/page.html now', [], true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].issue, null, '不当文件 ⇒ 没有跳转载荷')
  assert.equal(rows[0].href, 'file:D:/site/page.html')
})

test('找不到文件也照样画、点开才报错（UrlFilter.java:186-195）：这里不查磁盘', () => {
  const rows = consoleUrlLinks('file:///no/such/place/anywhere.txt:5', [], true)
  assert.equal(rows.length, 1, '判定是纯文本的，不因为路径不存在就吞掉链接')
  assert.deepEqual(rows[0].issue, { path: '/no/such/place/anywhere.txt', line: 5, column: 1 },
    '文本里写的行号原样落进跳转载荷（上游内部转 0 基，本仓的 RunIssue 是 1 基）')
})

test('与文件位置区间重叠的 URL 命中丢掉（一格一动作的确定政策）', () => {
  const line = 'see https://a.example/x end'
  const urls = consoleUrlLinks(line, [], true)
  assert.deepEqual(urls.map(row => [row.start, row.end]), [[4, 23]])
  const overlap = [{ path: 'a.example', line: 1, column: 1, start: 4, end: 23 }]
  assert.deepEqual(consoleUrlLinks(line, overlap, true), [], '整段被文件链接占住时不再画 URL')
  const clipped = [{ path: 'x', line: 1, column: 1, start: 0, end: 5 }]
  assert.deepEqual(consoleUrlLinks(line, clipped, true), [], '只碰到一端也算重叠（上游区间是左闭右开）')
  const apart = [{ path: 'src/A.java', line: 3, column: 1, start: 24, end: 27 }]
  assert.equal(consoleUrlLinks(line, apart, true).length, 1, '不相交时两族各画各的')
})

test('切片覆盖整行，且没有 URL 命中时与 splitRunLine 的排法逐字段相同', () => {
  const line = 'error at src/A.java:7 and https://b.example/y tail'
  const links = [{ path: 'src/A.java', line: 7, column: 1, start: 9, end: 21 }]
  const base = splitRunLine(line, links)
  const segments = consoleSegments(line, base, true)
  assert.equal(segments.map(segment => segment.text).join(''), line, '片段拼回去必须是整行')
  assert.equal(segments.filter(segment => segment.link).length, 1, '文件位置那一族原样保留')
  assert.equal(segments.filter(segment => segment.url).length, 1)
  assert.equal(segments.find(segment => segment.link).text, 'src/A.java:7')
  // 无命中的两种行：与既有实现同一张表（不引入第二种排法）。
  for (const plain of ['nothing here', 'error at src/A.java:7']) {
    const plainLinks = plain === 'nothing here' ? [] : links
    const expected = splitRunLine(plain, plainLinks)
      .map(segment => (segment.link ? { text: segment.text, link: segment.link } : { text: segment.text }))
    assert.deepEqual(consoleSegments(plain, splitRunLine(plain, plainLinks), false), expected)
  }
})

test('纯文本段里的多个 URL 命中按起点升序切开，中间的文字不丢', () => {
  const line = 'a https://x.example/1 b http://y.example/2 c'
  const segments = consoleSegments(line, splitRunLine(line, []), true)
  assert.equal(segments.map(segment => segment.text).join(''), line)
  assert.deepEqual(segments.filter(segment => segment.url).map(segment => segment.text),
    ['https://x.example/1', 'http://y.example/2'])
  assert.deepEqual(segments.filter(segment => !segment.url).map(segment => segment.text), ['a ', ' b ', ' c'])
})

test('落点动作只有两条出口：有跳转载荷走 jump，否则走宿主的 openUrl', () => {
  const jump = consoleUrlLinks('see file:///D:/a/B.txt:3', [], true)[0]
  assert.deepEqual(consoleLinkAction(jump), { channel: 'jump', payload: { path: 'D:/a/B.txt', line: 3, column: 1 } },
    '文本里写的 :3 是 1 基；上游转 0 基（UrlFilter.java:106），本仓跳转载荷又回到 1 基')
  const open = consoleUrlLinks('see https://a.example/x', [], true)[0]
  assert.deepEqual(consoleLinkAction(open), { channel: 'open', payload: 'https://a.example/x' })
})

test('右键菜单两格都有真实落点：浏览器命中给「打开 + 复制」，file: 命中只给「复制」', () => {
  const open = consoleUrlLinks('see https://a.example/x', [], true)[0]
  assert.deepEqual(consoleLinkMenuItems(open).map(row => row.id), ['activate', 'copy'])
  assert.deepEqual(consoleLinkMenuItems(open).map(row => row.label), ['在浏览器中打开', '复制 URL'],
    '复制那行的文案直译自 IdeBundle.properties:1263 的 Copy URL')
  assert.equal(consoleLinkMenuItems(open)[0].description, 'https://a.example/x')
  assert.equal(consoleLinkMenuItems(open)[1].description, '将 URL 复制到剪贴板')
  const jump = consoleUrlLinks('see file:///D:/a.txt:3', [], true)[0]
  assert.deepEqual(consoleLinkMenuItems(jump).map(row => row.id), ['copy'],
    '文件命中那份菜单里上游也没有「跳转」这一行（跳转是正文单击的动作），逐浏览器那行本仓没有通道')
  assert.equal(consoleLinkMenuItems(jump)[0].description, '将 URL 复制到剪贴板')
})

test('消费链：面板用这一层的切片表，两类链接各自可点，且既有 splitRunLine 调用点还在', () => {
  const panel = read('src/components/RunConsole.vue')
  assert.match(panel, /^[ \t]*const segments = consoleSegments\(text, splitRunLine\(text, links\), props\.isDesktop\)$/m,
    '每一行都过这一层（只认行首语句：宽松正则会被注释里的同款文字骗过）')
  assert.match(panel, /splitRunLine\(text, links\)/, '既有那一族的调用点没被换掉（run-filters 的门禁钉着这条）')
  assert.match(panel, /hyperlinked: segments\.some\(segment => Boolean\(segment\.link \|\| segment\.url\)\)/,
    '有任一可点片段才走切片分支，否则仍是 issue / 纯文本那两条旧路')
  assert.match(panel, /consoleLinkAction\(link\)/, '点击只走这一条派发')
  assert.match(panel, /request\('shell\.openUrl', \{ url \}\)/, '浏览器命中的唯一出口是宿主')
  assert.match(panel, /emit\('jump', action\.payload\)/, 'file: 命中复用控制台现成的 jump 通道')
  assert.match(panel, /v-else-if="segment\.url" class="run-issue-link"/,
    'URL 片段有独立的渲染分支，但样式与文件链接同一个（上游也是同一个 HYPERLINK 属性）')
  assert.match(panel, /@contextmenu\.prevent="openLinkMenu\(segment\.url, \$event\)"/,
    '右键出菜单（上游那张 ActionGroup），左键仍是打开/跳转')
  assert.match(panel, /consoleLinkMenuItems\(linkMenu\.link\)/, '菜单条目由这一层判定，组件不自己列')
  assert.match(panel, /copyToClipboard\(link\.href\)/, '复制的是命中的原文那一串')
  assert.match(panel, /import AnchoredMenu from '\.\/AnchoredMenu\.vue'/, '弹层外壳复用既有的 AnchoredMenu，不自建')
})
