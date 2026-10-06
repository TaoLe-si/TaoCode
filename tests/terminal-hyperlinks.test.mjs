// `src/terminalHyperlinks.ts` 的判据：终端行里的 URL 命中、落点判定、以及「面板能不能真的点开」。
//
// 上游依据（逐条对照的判定规则）：
//   · `platform/util/src/com/intellij/util/io/URLUtil.java:50`（`URL_PATTERN_OPTIMIZED`）、
//     `:52`（`FILE_URL_PATTERN_OPTIMIZED`）、`:60-62`（`canContainUrl` 的四种含串）。
//   · `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:54-79`（先预检、
//     再 `file:` 后 URL 的顺序、单命中与多命中）、`:81-87`（`isPotentialUrl` 五个词）、
//     `:89-92`（`buildHyperlinkInfo` 的两个分支）、`:94-123`（`.html` 不当文件、`:行` 与 `:行:列` 的解析）、
//     `:125-133`（协议前缀）、`:135-141`（`/C:/x` 去前导斜杠）、`:143-150`（百分号解码，解不动原样）。
//   · OSC 8 也要过同一个过滤器：`platform/execution-impl/src/com/intellij/terminal/Osc8UrlHyperlinkFilter.kt:10-17`。
//   · 挂载点：`platform/execution-impl/src/com/intellij/terminal/JBTerminalWidget.java:87-90`。
//   · 点击后是「交给浏览器」：`platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:69-72`。
//   · 本仓没有编辑器通道那一条在 `src/terminalHyperlinks.ts` 文件头第 4 条，接线请求 T1。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  terminalHyperlinkRanges, terminalLineMayContainUrl, terminalLinkActivatable, terminalLinkTarget,
  terminalLinkTooltip, terminalOsc8Target, terminalPathLinkRanges, terminalPathPosition,
  TERMINAL_FILENAME_MAX, TERMINAL_PATH_MIN, terminalUrlWordPresent,
} from '../src/terminalHyperlinks.ts'
import { terminalCopyOnSelect, terminalIsMiddleButton, terminalPasteOnMiddleClick } from '../src/terminalClipboard.ts'

test('预检两条都按上游的含串清单（URLUtil.java:60-62 与 UrlFilter.java:81-87）', () => {
  assert.equal(terminalLineMayContainUrl('see http://a.example/x'), true)
  assert.equal(terminalLineMayContainUrl('mailto:a@b.example'), true)
  assert.equal(terminalLineMayContainUrl('www.example.org'), true)
  assert.equal(terminalLineMayContainUrl('file:D:/x.txt'), true)
  assert.equal(terminalLineMayContainUrl('nothing here at all'), false)
  // 上游的两个预检不是一回事：`news` 只让 isPotentialUrl 过，不让 canContainUrl 过。
  assert.equal(terminalUrlWordPresent('news is today'), true)
  assert.equal(terminalLineMayContainUrl('news is today'), false)
})

test('没有协议前缀的行直接不跑正则（UrlFilter.java:56 的那条早退）', () => {
  assert.deepEqual(terminalHyperlinkRanges('plain text no url here'), [])
})

test('URL 命中：协议、端口、查询串都照 URL_PATTERN_OPTIMIZED 收（URLUtil.java:50）', () => {
  const hit = (line) => terminalHyperlinkRanges(line).map(row => row.text)
  assert.deepEqual(hit('see https://example.com/a/b?c=1 and done'), ['https://example.com/a/b?c=1'])
  assert.deepEqual(hit('curl http://localhost:8080/status'), ['http://localhost:8080/status'])
  assert.deepEqual(hit('mail me at mailto:someone@example.com now'), ['mailto:someone@example.com'])
  assert.deepEqual(hit('ftp://files.example/pub readme'), ['ftp://files.example/pub'])
  assert.deepEqual(hit('news://example.invalid/group tail'), ['news://example.invalid/group'])
})

test('行尾标点不算进链接（末字符类不含 . , ; : 等，URLUtil.java:50）', () => {
  const hit = (line) => terminalHyperlinkRanges(line).map(row => row.text)
  assert.deepEqual(hit('read https://a.example/x. Then go'), ['https://a.example/x'])
  assert.deepEqual(hit('read https://a.example/x, then go'), ['https://a.example/x'])
})

test('www. 前不能贴着字母数字或点（正则里的 (?<![\\p{L}0-9_.]) 那条后顾）', () => {
  const hit = (line) => terminalHyperlinkRanges(line).map(row => row.text)
  assert.deepEqual(hit('host notwww.example.org here'), [])
  assert.deepEqual(hit('v1.www.example.org'), [])
  assert.deepEqual(hit('go to www.example.org now'), ['www.example.org'])
})

test('多个命中按上游顺序：先 file: 再 URL，重叠的后者丢掉（UrlFilter.java:61-67）', () => {
  const ranges = terminalHyperlinkRanges('open file:///D:/a.txt:3:4 then https://b.example/y end')
  assert.equal(ranges.length, 2)
  assert.equal(ranges[0].text.startsWith('file:'), true, 'file: 命中排在前面')
  assert.equal(ranges[1].text, 'https://b.example/y')
  // 区间偏移要对得上原文，面板据此排 xterm 的列。
  const line = 'open file:///D:/a.txt:3:4 then https://b.example/y end'
  for (const range of ranges) assert.equal(line.slice(range.start, range.end), range.text)
})

test('file: 前缀两种写法与一条排除（UrlFilter.java:125-133）', () => {
  const full = terminalLinkTarget(terminalHyperlinkRanges('file:///home/user/a.txt')[0].text)
  assert.equal(full.kind, 'file')
  assert.equal(full.path, '/home/user/a.txt', 'PROTOCOL_PREFIX 是 file://，剥完留着开头的斜杠')
  const minimal = terminalLinkTarget(terminalHyperlinkRanges('file:D:/a.txt')[0].text)
  assert.equal(minimal.kind, 'file')
  assert.equal(minimal.path, 'D:/a.txt')
  // `file://host/share`（两个斜杠、不是三斜杠也不是最小式）上游认不出前缀 ⇒ 走浏览器分支。
  assert.deepEqual(terminalLinkTarget('file://host/share/a.txt'), { kind: 'browser', url: 'file://host/share/a.txt' })
})

test('/C:/x 去掉那根前导斜杠（UrlFilter.java:135-141）', () => {
  const windows = terminalLinkTarget(terminalHyperlinkRanges('file:///C:/src/App.ts')[0].text)
  assert.equal(windows.kind, 'file')
  assert.equal(windows.path, 'C:/src/App.ts')
})

test('末尾的 :行 与 :行:列 只有整数才算，行号列号都转 0 基（UrlFilter.java:100-117）', () => {
  const one = terminalLinkTarget(terminalHyperlinkRanges('file:///tmp/a.txt:12')[0].text)
  assert.equal(one.line, 11)
  assert.equal(one.column, null)
  const two = terminalLinkTarget(terminalHyperlinkRanges('file:///tmp/a.txt:12:5')[0].text)
  assert.equal(two.line, 11, '有两段时前一段才是行号')
  assert.equal(two.column, 4)
  const notNumber = terminalLinkTarget(terminalHyperlinkRanges('file:///tmp/a.txt:abc')[0].text)
  assert.equal(notNumber.line, null)
  assert.equal(notNumber.path, '/tmp/a.txt:abc', '解析不动就整串当路径（filePathEndIndex 保持行尾）')
})

test('.html 的 file: 串不当文件（UrlFilter.java:95 的那条例外）', () => {
  const html = terminalLinkTarget(terminalHyperlinkRanges('file:D:/site/page.html')[0].text)
  assert.deepEqual(html, { kind: 'browser', url: 'file:D:/site/page.html' })
})

test('百分号解码，解不动时原样（UrlFilter.java:143-150）', () => {
  const decoded = terminalLinkTarget(terminalHyperlinkRanges('file:///D:/my%20file.txt')[0].text)
  assert.equal(decoded.path, 'D:/my file.txt')
  const broken = terminalLinkTarget(terminalHyperlinkRanges('file:///D:/100%2')[0].text)
  assert.equal(broken.path, 'D:/100%2', '坏转义不抛错，除前导斜杠外照原文（toWindowsPath 仍然要跑）')
  const unix = terminalLinkTarget(terminalHyperlinkRanges('file:///tmp/my%20dir/a.txt')[0].text)
  assert.equal(unix.path, '/tmp/my dir/a.txt', '非盘符的绝对路径那根前导斜杠要留着')
})

test('OSC 8 的 URI 走同一个判定（Osc8UrlHyperlinkFilter.kt:10-17）', () => {
  assert.deepEqual(terminalOsc8Target('https://a.example/x'), { kind: 'browser', url: 'https://a.example/x' })
  assert.equal(terminalOsc8Target('file:///D:/a.txt:3').kind, 'file')
})

test('能不能点开：三条真实的否分支（面板据此不画点不动的链接）', () => {
  const browser = terminalLinkTarget('https://a.example/x')
  assert.deepEqual(terminalLinkActivatable(browser, true), { ok: true, reason: '' })
  assert.equal(terminalLinkActivatable(browser, false).ok, false, '浏览器预览没有 shell.openUrl 这条宿主通道')
  assert.match(terminalLinkActivatable(browser, false).reason, /浏览器预览/)
  assert.equal(terminalLinkActivatable(terminalLinkTarget('file:///D:/a.txt'), true).ok, false)
  assert.match(terminalLinkActivatable(terminalLinkTarget('file:///D:/a.txt'), true).reason, /编辑器/)
  // 没有协议前缀的 www.：宿主 open_external 直接拒（native/file_queries.cpp:234-236）。
  assert.equal(terminalLinkActivatable(terminalLinkTarget('www.example.org'), true).ok, false)
  assert.match(terminalLinkActivatable(terminalLinkTarget('www.example.org'), true).reason, /协议前缀/)
})

test('悬停提示把动作说清楚（上游右键菜单在本仓缩成一行 title）', () => {
  assert.match(terminalLinkTooltip(terminalLinkTarget('https://a.example/x'), true), /Ctrl\+单击/)
  assert.match(terminalLinkTooltip(terminalLinkTarget('file:///D:/a.txt'), false), /打不开编辑器/)
})

test('消费链：面板装了 link provider、OSC 8 handler、中键粘贴与 Linux 选中即复制', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  // 只认**行首语句**：整行注释掉的调用长得一模一样，用宽松正则会被自己的注释骗过（假绿）。
  assert.match(panel, /^[ \t]*attachLinkProvider\(instance\)$/m, '每个窗格都要挂行内链接判定')
  assert.match(panel, /linkHandler: osc8LinkHandler\(\)/, 'OSC 8 不能用 xterm 默认的 confirm + window.open')
  assert.match(panel, /instance\.registerLinkProvider\(/)
  assert.match(panel, /terminalHyperlinkRanges\(text\)/)
  assert.match(panel, /terminalLinkActivatable\(target, isDesktop\)/, '点不开的命中不画成链接')
  // 原钉的是面板里那一行 `request('shell.openUrl', { url })`（那时每条出口各自直连宿主）。
  // 2026-10-06 welcome3 把 URL 出口收成一条（`src/externalLinkLauncher.ts`，上游只有一个
  // `browse()`、判定就长在它里面）⇒ 运输那一行搬了家：按规约把锚点指向新文件，断言体一字不动，
  // 面板这一侧改钉「调用的是那一条出口」。
  const launcher = readFileSync(new URL('../src/externalLinkLauncher.ts', import.meta.url), 'utf8')
  assert.match(launcher, /request\('shell\.openUrl', \{ url \}\)/, '打开链接的唯一出口是宿主')
  assert.match(panel, /await openExternalUrl\(url\)/, '面板不再自己直连宿主：未信任项目里点链接也先过那一句')
  assert.match(panel, /addEventListener\('mousedown', \(event\) => onMiddleClick\(pane, event as MouseEvent\), true\)/,
    '中键粘贴要在捕获阶段抢在 xterm 之前')
  assert.match(panel, /ON_LINUX && terminalCopyOnSelect\(true\)/, '选中即复制只有 Linux')
})

test('中键与选中即复制的门（JBTerminalSystemSettingsProviderBase.java:297-304）', () => {
  assert.equal(terminalPasteOnMiddleClick(), true, '上游那条覆写没有条件')
  assert.equal(terminalIsMiddleButton({ button: 1 }), true)
  assert.equal(terminalIsMiddleButton({ button: 0 }), false, '左键不算')
  assert.equal(terminalIsMiddleButton({}), false, '事件没有 button 字段时不算')
  assert.equal(terminalCopyOnSelect(true), true)
  assert.equal(terminalCopyOnSelect(false), false, '上游就是 SystemInfo.isLinux，Windows/macOS 不复制')
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /if \(!terminalIsMiddleButton\(event\) \|\| !terminalPasteOnMiddleClick\(\)\) return/,
    '面板先认中键、再问上游那条门')
})

// 终端输出里的裸文件路径 → 行号（`TerminalGenericFileFilter` 一族的可判定部分）。
// 上游：`plugins/terminal/src/org/jetbrains/plugins/terminal/hyperlinks/filter/TerminalGenericFileFilter.kt:20-30/59-68/95`、
// `TerminalAbsolutePathLinkFinder.kt:77-93/107-114/116-133`、`TerminalRelativePathLinkFinder.kt:169-218/226-238`、
// 注册 `plugins/terminal/resources/META-INF/terminal.xml:84`，过滤器确实跑在终端每行输出上
// （`CompositeFilterWrapper.java:51-62` + `ConsoleViewUtil.java:315-335`）。
const seen = (paths, extra = {}) => ({ exists: path => paths.includes(path), ...extra })

test('常量钉住上游那两个门槛（TerminalGenericFileFilter.kt:59-68）', () => {
  assert.equal(TERMINAL_FILENAME_MAX, 255)
  assert.equal(TERMINAL_PATH_MIN, 2)
})

test('parsePosition 的三种形状与「数字吃到行尾就不算」（TerminalRelativePathLinkFinder.kt:169-238）', () => {
  assert.deepEqual(terminalPathPosition('a.c:12 tail', 3), { line: 12, column: 1, linkEnd: 6 })
  assert.deepEqual(terminalPathPosition('a.c:12:3 tail', 3), { line: 12, column: 3, linkEnd: 8 })
  assert.deepEqual(terminalPathPosition('a.c:12-15 tail', 3), { line: 12, column: 1, linkEnd: 9 }, '范围跳到 start')
  assert.deepEqual(terminalPathPosition('a.c: (7, 9) tail', 3), { line: 7, column: 9, linkEnd: 11 })
  // 上游的 takeNumberFromIndex 走完整个行尾就 return null ⇒ 行尾的裸数字**不认**成行号。
  assert.equal(terminalPathPosition('a.c:12', 3), null)
  assert.equal(terminalPathPosition('a.c: tail', 3), null, '冒号后没有数字')
  assert.equal(terminalPathPosition('a.c:12,x', 3).column, 1, '不是 :列 就只认行')
  // 7 位以上当不可能行号（:228-231）：**恰好 7 位也不算**（`i - startIndex >= 7` 是在读到第 8 个字符时才触发）。
  assert.equal(terminalPathPosition('a.c:12345678 tail', 3), null)
  assert.equal(terminalPathPosition('a.c:1234567 tail', 3), null, '7 位数也算不可能行号')
  assert.equal(terminalPathPosition('a.c:123456 tail', 3).line, 123456, '6 位数还在范围内')
  // `path: (行, 列)` 少一样就不算（:171-188）。
  assert.equal(terminalPathPosition('a.c: (7 tail', 3), null)
  assert.equal(terminalPathPosition('a.c: (7, 9 tail', 3), null, '缺右括号')
})

test('路径链接只在 exists 查得到时才算（TerminalGenericFileFilter.kt:25-27 + :77-93）', () => {
  const unix = 'error: /work/a.c:12 oops'
  assert.deepEqual(terminalPathLinkRanges(unix, seen(['/work/a.c'])), [
    { start: 7, end: 19, path: '/work/a.c', line: 11, column: 0 },
  ], '行号 1 基换算成 0 基（TerminalAbsolutePathLinkFinder.kt:113）')
  assert.deepEqual(terminalPathLinkRanges(unix, seen(['/other.c'])), [], '查不到文件就不是链接')
  // 纯分隔符与过短的路径一律不算（:82-86 与 PATH_MIN）。
  assert.deepEqual(terminalPathLinkRanges('progress [10 / 1000]', seen(['/', '/ 1000'])), [])
  assert.deepEqual(terminalPathLinkRanges('//', seen(['//'])), [])
  // 盘符路径（:129 的那条：大写字母紧跟 `:\` 或 `:/`）。
  const win = 'at C:\\\\work\\\\a.ts:5 x'
  assert.equal(terminalPathLinkRanges(win, seen(['C:\\\\work\\\\a.ts'])).length, 1)
  assert.equal(terminalPathLinkRanges(win, seen(['C:/work/a.ts'])).length, 0, '拼出来的原文是反斜杠那条')
  // 家目录：没有 home 时 `~/x` 不算（:87-90）。
  assert.deepEqual(terminalPathLinkRanges('~/notes/x.md tail', seen(['/home/me/notes/x.md'])), [])
  assert.equal(terminalPathLinkRanges('~/notes/x.md tail', seen(['/home/me/notes/x.md'], { home: '/home/me' })).length, 1)
  assert.equal(terminalPathLinkRanges('~/notes/x.md tail', seen(['~/notes/x.md'], { home: '/home/me' })).length, 0,
    '展开后才去查，原文不查')
  // 段长超过 FILENAME_MAX 不算（:78）。
  const huge = `/${'a'.repeat(256)}.c tail`
  assert.deepEqual(terminalPathLinkRanges(huge, seen([huge.slice(0, 257)])), [])
})

test('这一层还没接进面板：没有廉价的 exists 通道就不画点不动的链接', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /terminalPathLinkRanges/,
    '宿主给了 fs.exists / 工作区清单之后才允许接（docs/wiring-requests-2026-10-06-term3.md 的 R2/N3）')
})
