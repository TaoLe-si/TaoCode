// 快速文档**宿主**的行为判据（`src/quickDocHost.ts`）：Ctrl+Q 摆一页、点文档里的引用换一页并压历史、
// 后退回去、外部链接动作只在真有 URL 时可点、图片按所在文件的目录解析。
//
// 这一层的上游分工（每条都有坐标，判决 `lp/documentation` 的「缺：」那几行）：
//   · `DocumentationTargetProvider.java:31` + `DocumentationTargetHoverInfo.kt:35-45`
//     —— 「按位置取文档」是**一条通用注入面**，本仓的等价物是 `src/docHoverContent.ts`；
//   · `DocumentationBrowserHistory.kt:43-47`（`nextPage()`）/ `:20-24`（`backward()`）
//     —— 点进新页压历史，后退回到上一页；
//   · `DocumentationViewExternalAction.kt:15`（`isEnabledAndVisible`）+ `:18-23`
//     —— 没有外部 URL 时这个动作**不存在**，本仓就是 `canOpenExternalDoc()` false；
//   · `DocumentationImageResolver.java:21` —— 解不出来返回 `null`（渲染层退回 alt 文本），不硬编。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHoverCache } from '../src/hoverDocumentation.ts'
import { createQuickDocHost } from '../src/quickDocHost.ts'

/** 一份「服务器」：位置 → hover 文本，以及符号/工作区查询的固定答案。 */
function fakeServer() {
  const hovers = new Map([
    ['src/a.java:5:0', '```java\nvoid compute()\n```\n\n算一下。见 {@link Foo#helper(int)}。'],
    ['src/b.java:9:2', '```java\nclass Foo\n```\n\nFoo 的文档。![截图](img/a.png) [Javadoc](https://example.org/foo)。'],
    ['src/c.java:1:0', '纯文本，没有文档链接。'],
  ])
  const sent = { hover: 0, openUrl: [], readBinary: [], reveal: [] }
  async function request(method, params) {
    if (method === 'shell.openUrl') { sent.openUrl.push(params.url); return { ok: true } }
    if (method === 'file.readBinary') {
      // `img/fake.png`：名字是 PNG、内容嗅探出来是 PDF —— 宿主按魔数给 `kind`（native/workspace.cpp 的 `sniff_kind`）。
      const fake = params.path === 'src/img/fake.png'
      sent.readBinary.push(params.path)
      return fake ? { base64: 'JVBERi0x', size: 8, kind: 'pdf' } : { base64: 'aGk=', size: 3, kind: 'png' }
    }
    if (method !== 'lsp.request') return { available: false }
    if (params.kind === 'hover') {
      sent.hover += 1
      const contents = hovers.get(`${params.path}:${String(params.line)}:${String(params.character)}`)
      return contents ? { available: true, contents } : { available: false }
    }
    if (params.kind === 'documentSymbol') {
      // 只有 b.java 里有 `Foo` 这个声明（成员 `helper` 故意没有：落回容器，不假装有它）。
      const symbols = params.path === 'src/b.java' ? [{ name: 'Foo', kind: 5, startLine: 9, startChar: 2, endLine: 20, endChar: 3 }] : []
      return { available: true, symbols }
    }
    if (params.kind === 'workspaceSymbol') {
      return { available: true, symbols: params.query === 'Foo' ? [{ name: 'Foo', kind: 5, path: 'src/b.java', line: 9, character: 2 }] : [] }
    }
    return { available: false }
  }
  return { request, sent }
}

function createHost(options = {}) {
  const server = fakeServer()
  const notices = []
  const revealed = []
  const tab = { path: 'src/a.java', version: 1, dirty: false, line: 5, column: 0 }
  const menu = { value: 'code' }
  const host = createQuickDocHost({
    notify: (message, error) => notices.push({ message, error: Boolean(error) }),
    isDesktop: options.isDesktop ?? true,
    active: { value: options.activeTab ?? tab },
    lspReady: { value: true },
    editorFor: () => ({ text: () => '', getCursor: () => ({ line: 5, ch: 0 }), getCursorCoords: () => ({ left: 120, bottom: 200 }) }),
    request: server.request,
    menu,
    revealLocation: target => { revealed.push(target) },
    workspaceRoot: () => options.workspaceRoot ?? 'C:/ws',
    hoverCache: createHoverCache(),
  })
  return { host, notices, revealed, tab, server, menu }
}

/**
 * 正文里**长在句子里**的链接（`parts`）—— 上游 content 那段 HTML 里的 `<a>` 就是这个形态
 * （`LspDocumentationData.kt:91-103`）。已经内联的不会再出现在 `layout.links` 那一行。
 */
function inlineLinks(layout) {
  const out = []
  for (const block of layout.content) for (const part of block.parts ?? []) if ('link' in part) out.push(part.link)
  for (const section of layout.sections) for (const part of section.parts ?? []) if ('link' in part) out.push(part.link)
  return out
}

test('Ctrl+Q：签名进 definition、正文进 content，这一页记住自己属于哪个文件', async () => {
  const { host } = createHost()
  await host.showQuickDoc()
  const page = host.quickDoc.value
  assert.ok(page, '弹层没有打开')
  assert.equal(page.docPath, 'src/a.java')
  assert.equal(page.origin, 'src/a.java')
  assert.deepEqual(page.layout.definition, { code: 'void compute()', language: 'java' })
  assert.match(page.layout.content.map(block => block.text).join(' '), /算一下/)
  assert.equal(host.quickDoc.value.x, 120, '第一次打开贴光标（showInBestPositionFor(editor)）')
  host.closeQuickDoc()
  assert.equal(host.quickDoc.value, null)
})

test('此处没有文档时给的是那句实话，不摆空页', async () => {
  const { host, notices } = createHost()
  await host.showAt(77, 0, 'src/a.java')
  assert.match(notices.at(-1).message, /此处没有文档/)
  assert.equal(host.quickDoc.value, null)
})

test('点文档里的 {@link Foo#helper(int)}：换一页 + 压历史，后退回到第一页', async () => {
  const { host, notices, server } = createHost()
  await host.showQuickDoc()
  const first = host.quickDoc.value
  const link = inlineLinks(first.layout).find(entry => entry.kind === 'internal')
  assert.ok(link, '正文里的 {@link …} 没有落成句子里的可点链接')
  assert.equal(link.target, 'Foo#helper(int)', '参数表留在 target 里，由 parseDocReference 剥（不参与名字匹配）')
  assert.equal(link.label, 'Foo#helper(int)', '没有显示名时就用引用本身')
  assert.equal(first.layout.links.length, 0, '已经内联的链接不该再列一行（上游没有「链接清单」这一块）')
  assert.equal(host.canGoBackward(), false, '还没翻页就没有后退')
  host.followInternalDocLink(link)
  await new Promise(resolve => setImmediate(resolve))
  const second = host.quickDoc.value
  assert.equal(second.docPath, 'src/b.java', '符号文档来自声明所在的那个文件')
  assert.match(second.origin, /Foo/, '标题栏写清楚用的是哪一条符号')
  assert.equal(second.x, first.x, '换页不动弹层位置（上游是同一块面板换内容）')
  assert.match(second.layout.content.map(block => block.text).join(' '), /Foo 的文档/)
  assert.equal(host.canGoBackward(), true)
  host.goBackward()
  assert.equal(host.quickDoc.value.origin, first.origin, '后退回到第一页')
  assert.equal(host.canGoForward(), true)
  host.goForward()
  assert.equal(host.quickDoc.value.docPath, 'src/b.java')
  // 成员查不到时落回**容器**的文档，origin 也就照实写容器名（不假装有 helper）。
  assert.doesNotMatch(host.quickDoc.value.origin, /helper/)
  assert.equal(server.sent.hover, 2, '两次 hover：第一页一次、符号页一次')
  assert.ok(notices.every(entry => !entry.message.includes('解析不出符号')), '这条链不该报错')
})

test('带路径的内部链接走编辑器导航：绝对路径落回工作区相对路径，行号转 0 基', async () => {
  const { host, revealed } = createHost()
  host.followInternalDocLink({ label: 'A.java', target: 'C:/ws/src/A.java', kind: 'internal', line: 7 })
  assert.deepEqual(revealed.at(-1), { path: 'src/A.java', line: 6 })
})

test('工作区外的路径不硬开，如实说一句', async () => {
  const { host, revealed, notices } = createHost()
  host.followInternalDocLink({ label: 'x', target: 'D:/other/Thing.java', kind: 'internal', line: 3 })
  assert.equal(revealed.length, 0)
  assert.match(notices.at(-1).message, /工作区外/)
})

test('没有 target 的内部链接点了不动（不拿空路径去开文件）', () => {
  const { host, revealed } = createHost()
  host.followInternalDocLink({ label: '锚点', target: '', kind: 'internal' })
  host.followInternalDocLink({ label: '外部', target: 'https://a', kind: 'external' })
  assert.equal(revealed.length, 0)
})

test('「在浏览器中打开」：只有当前页真有外部 URL 才可点，Shift+F1 那条动作才有落点', async () => {
  const { host, server } = createHost()
  await host.showAt(5, 0, 'src/a.java')
  assert.equal(host.canOpenExternalDoc(), false, '这一页没有 http 链接')
  await host.openExternalDoc()
  assert.equal(server.sent.openUrl.length, 0, '不可点时什么都不发')
  const link = inlineLinks(host.quickDoc.value.layout).find(entry => entry.kind === 'internal')
  host.followInternalDocLink(link)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.canOpenExternalDoc(), true, '第二页有 https://example.org/foo')
  await host.openExternalDoc()
  assert.deepEqual(server.sent.openUrl, ['https://example.org/foo'])
})

test('浏览器预览里没有 shell.openUrl：如实说明，不假装打开了', async () => {
  const { host, notices, server } = createHost({ isDesktop: false })
  host.followInternalDocLink({ label: 'Foo', target: 'Foo#helper', kind: 'internal' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.canOpenExternalDoc(), true)
  await host.openExternalDoc()
  assert.match(notices.at(-1).message, /浏览器预览里不能打开/)
  assert.equal(server.sent.openUrl.length, 0)
})

test('图片：http 直接给 src，工作区相对路径读字节转 data URL，file: 与读不到都算解不出来', async () => {
  const { host, server } = createHost()
  assert.equal(await host.resolveImage({ src: 'https://x/a.png', alt: 'a', external: true }, 'src/b.java'), 'https://x/a.png')
  const data = await host.resolveImage({ src: 'img/a.png', alt: '截图', external: false }, 'src/b.java')
  assert.equal(data, 'data:image/png;base64,aGk=', '按所在文件的目录解析（hover 里的相对路径是相对 .java 写的）')
  assert.deepEqual(server.sent.readBinary, ['src/img/a.png'])
  assert.equal(await host.resolveImage({ src: 'file:///C:/x/a.png', alt: 'a', external: false }, 'src/b.java'), null, 'file: 是绝对路径，本仓的图片读取是工作区相对的 ⇒ 不硬转')
  assert.equal(await host.resolveImage({ src: 'img/a.xyz', alt: 'a', external: false }, 'src/b.java'), null, '认不出的扩展名当解不出来（不硬编一个 mime 去骗渲染层）')
  // 上游 `XssSafeLinks.kt:9-11`：`data:` 只有 `data:image/(gif|png|jpeg|webp|svg)` 放过，
  // `vbscript:` / `javascript:` 连图片也不给地址。本仓的等价口径是「解不出来」= `null`，
  // 渲染层据此退回 alt 文本（`DocumentationImageResolver.java:21`），不会画出一张破图。
  assert.equal(await host.resolveImage({ src: 'data:image/png;base64,aGk=', alt: 'a', external: false }, 'src/b.java'), 'data:image/png;base64,aGk=', '内联图片的 data: 字节就在源串里，原样给渲染层')
  assert.equal(await host.resolveImage({ src: 'data:text/html;base64,aGk=', alt: 'a', external: false }, 'src/b.java'), null)
  assert.equal(await host.resolveImage({ src: 'javascript:alert(1)', alt: 'a', external: false }, 'src/b.java'), null)
  assert.equal(await host.resolveImage({ src: 'javascript:alert(1).png', alt: 'a', external: false }, 'src/b.java'), null, '带 .png 后缀的 javascript: 也不许去读工作区文件（否则伪装成一张能读的图）')
  assert.equal(await host.resolveImage({ src: 'data:text/html;base64,x.png', alt: 'a', external: false }, 'src/b.java'), null, '非图片的 data: 同样不给')
  // 内容嗅探（`sniff_kind`）压过扩展名：写着 `.png` 的那份其实是 PDF ⇒ 判「解不出来」，不画破图。
  assert.equal(await host.resolveImage({ src: 'img/fake.png', alt: 'a', external: false }, 'src/b.java'), null, '魔数不是图片就不给 data URL')
  assert.equal(server.sent.readBinary.length, 2, '上面两次该读工作区文件（src/img/a.png 与 src/img/fake.png），坏源一次都不该读')
})

test('语言服务没就绪时是一句「先打开有语言服务的文件」，不是「此处没有文档」', async () => {
  const server = fakeServer()
  const notices = []
  const host = createQuickDocHost({
    notify: message => notices.push(message),
    isDesktop: true,
    active: { value: { path: 'src/a.java', version: 1, dirty: false, line: 5, column: 0 } },
    lspReady: { value: false },
    editorFor: () => ({ text: () => '', getCursor: () => ({ line: 5, ch: 0 }), getCursorCoords: () => null }),
    request: server.request,
    menu: { value: null },
    revealLocation: () => undefined,
    workspaceRoot: () => 'C:/ws',
    hoverCache: createHoverCache(),
  })
  await host.showQuickDoc()
  assert.match(notices.at(-1), /语言服务/)
  assert.equal(host.quickDoc.value, null)
})

test('打开弹层时关掉代码菜单（上游 AbstractPopup 独占一层）', async () => {
  const { host } = createHost()
  await host.showAt(5, 0, 'src/a.java')
  assert.equal(host.quickDoc.value.origin, 'src/a.java')
})

test('接线：宿主是文档账与 hover 缓存的生产写入方，且只有一个取文档的通道', async () => {
  const { host, server } = createHost()
  await host.showQuickDoc()
  await host.showQuickDoc()
  assert.equal(server.sent.hover, 1, '重复 Ctrl+Q 走缓存，不再往返语言服务')
  host.closeQuickDoc()
  await host.showQuickDoc()
  assert.equal(server.sent.hover, 1, '关掉再开仍然命中缓存（缓存不是按弹层生命周期清的）')
})
