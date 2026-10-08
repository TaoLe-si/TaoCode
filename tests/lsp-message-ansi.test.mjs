// 判据：语言服务（LSP）服务器发来的消息正文里那些 **ANSI 转义**，在"给用户看的那一份"里必须被剥掉。
//
// 为什么这条值得单独钉（lane msgpanel，2026-10-06）：服务器正文走的是管道文本，`native/lsp.cpp`
// 原样透传（不剥转义），而这条通道的两个用户可见出口 —— 通知中心里那一行（`src/progressNotices.ts`
// 读 `lspServerMessages` 队列）与「语言服务」日志尾部（`src/lspServerLog.ts` 的 `lspLogTail`，
// 它同时是日志通知的 detail）—— 读的都是**同一个** `envelope.message`。以前没有任何一处解过 ANSI，
// 于是带色的正文在界面上就是一行 `\u001b[31m…\u001b[0m` 转义垃圾（同一个正文里的 `\u001b` 也照样进了
// 「复制日志」导出的文本）。
//
// 上游坐标（本机参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`，
// 逐行 `sed -n` 数过，没有编造行号；这三个文件的行数分别 478 / 157 / 204）：
//   · `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt`
//     `:75`（`private val ansiDecoder = AnsiEscapeDecoder()`）、`:424`（`private fun doNotify(`）、
//     `:432-436`（`var cleanedMessage = ""` + `ansiDecoder.escapeText(message, ProcessOutputTypes.STDOUT) { text, _ -> cleanedMessage += text }`）、
//     `:438`（用 cleanedMessage 拼 presentableMessage）、`:441`（`createNotification(presentableMessage, type)`）
//     ⇒ **通知正文是解过转义的那一份**，且上游注释自己点名用 STDOUT 这一档（"the most appropriate option as we are processing notification messages"）。
//   · `platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt`
//     `:40`（同一台 `AnsiEscapeDecoder`）、`:82-97`（`print(..., decodeAnsi: Boolean = true)`：
//     `:83-88` 解出 cleanedMessage、`:93` 拼进整行、`:96` 才 `console.print(...)`）
//     ⇒ **语言服务输出那一半也解**（`:47-54` 的 printLogMessage / printShowMessage / printTrace 全走这个 print）。
//   · 词法边界照 `platform/platform-util-io/src/com/intellij/execution/process/AnsiStreamingLexer.java`
//     `:15`（`ESCAPE = '\u001b'`）、`:17`（`SGR_SUFFIX = 'm'`）、`:132`（终结字节是 `m` 才当 SGR）；
//     本仓那台词法器是 `src/consoleAnsi.ts`（同一上游族已移植并带判据 `tests/console-ansi.test.mjs`），
//     本文件**只核复用**，不在这里重讲一遍词法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleLspServerMessageEvent, lspMessageVisibleText, lspServerMessages } from '../src/lspServerMessages.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = rel => readFileSync(join(root, rel), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const ESC = String.fromCharCode(0x1b)

/** 排空队列并返回这一拍被推进来的那些条（`progressNotices.ts` 消费时同样是 splice 走）。 */
function drainQueue() {
  const drained = [...lspServerMessages]
  lspServerMessages.splice(0, lspServerMessages.length)
  return drained
}

test('正文里的 SGR 转义被剥掉，只留下看得见的字', () => {
  assert.equal(lspMessageVisibleText(`${ESC}[31mboom${ESC}[0m`), 'boom')
  // 没有转义就原样返回（不"顺手"改动一个字，界面上的既有判据才不会被这次改动波及）
  assert.equal(lspMessageVisibleText('一条普通消息'), '一条普通消息')
  assert.equal(lspMessageVisibleText(''), '')
})

test('词法边界照上游：CONTROL 忽略、OSC 不当转义、状态跨行延续', () => {
  // 非 `m` 终结的 CSI（`2K` 清行）在上游是 CONTROL ⇒ 整段丢掉、文本留下
  assert.equal(lspMessageVisibleText(`${ESC}[2K保留`), '保留')
  // 上游词法器只认 ESC[ / ESC= / ESC>；OSC 走 default 返回 false ⇒ 原样留在正文里，不"多清一层"
  const osc = `${ESC}]0;窗口标题${ESC}\\`
  assert.equal(lspMessageVisibleText(osc), osc)
  // 一条消息按行喂同一台机器 ⇒ 颜色状态跨行延续（第二行仍带着第一行开的 32）
  assert.equal(lspMessageVisibleText(`a${ESC}[32m\nb${ESC}[0mc`), 'a\nbc')
  // 解不出整数的 SGR 参数（999）不改状态，序列本身仍被吃掉
  assert.equal(lspMessageVisibleText(`${ESC}[999m怪值`), '怪值')
  // 尾随空格不是转义，不动它（上游 print 那边才有 trimEnd，通知正文没有）
  assert.equal(lspMessageVisibleText(`结尾${ESC}[0m   `), '结尾   ')
})

test('端到端：showMessage 的带色正文进通知队列时已经是干净文本', () => {
  assert.equal(handleLspServerMessageEvent({
    language: 'java', severity: 1, method: 'window/showMessage', message: `${ESC}[31m编译失败${ESC}[0m`,
  }), true)
  const queued = drainQueue()
  assert.equal(queued.length, 1)
  assert.equal(queued[0].message, '编译失败')
  assert.ok(!queued[0].message.includes(ESC), '通知正文里不许残留 ESC')
})

test('端到端：logMessage 的 Error 档同样干净（进队列的那一条），Info 档仍不进队列', () => {
  assert.equal(handleLspServerMessageEvent({
    language: 'java', severity: 1, method: 'window/logMessage', message: `${ESC}[1;31m坏了${ESC}[0m`,
  }), true)
  const errors = drainQueue()
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, '坏了')
  assert.equal(errors[0].displayId, 'lsp:log:message:java')
  // 这一条不是本批改的、但是同一条链上的分档：Info/Log 级只写「语言服务」日志，不进通知队列
  // （上游 :401-403 那条 doNotify 落的是 isLogByDefault=false 的组，默认同样看不见 ⇒ 不许把它"改好"成弹出来）
  assert.equal(handleLspServerMessageEvent({
    language: 'java', severity: 4, method: 'window/logMessage', message: `${ESC}[37m例行日志${ESC}[0m`,
  }), true)
  assert.deepEqual(drainQueue(), [])
})

test('端到端：showMessageRequest 的正文与选项标题都不带转义', () => {
  assert.equal(handleLspServerMessageEvent({
    language: 'java', severity: 2, method: 'window/showMessageRequest',
    message: `${ESC}[33m要不要重新导入？${ESC}[0m`, id: 77,
    actions: [{ title: `${ESC}[1m确定${ESC}[0m` }, { title: '取消' }],
  }), true)
  const queued = drainQueue()
  assert.equal(queued.length, 1)
  assert.equal(queued[0].message, '要不要重新导入？')
  // 选项标题由服务器给，上游 doNotify 直接拿它当动作标签（`:443-451`）⇒ 本仓不替它剥，
  // 只保证正文这一侧干净；这条断言钉的是"没有多做"，不是"已经做了按钮"（按钮那半见 :193 的开关与 R1）。
  assert.ok(queued[0].requestKey)
})

test('用户可见链：通知正文读的就是队列里那条 message', () => {
  // 剥转义这一步必须落在"真被界面读走"的那条链上，否则就是一个没人调的纯函数。
  const notices = read('src/progressNotices.ts')
  assert.match(notices, /for \(const message of lspServerMessages\.splice\(/)
  assert.match(notices, /message: message\.message,/)
  // 宿主事件 → 分派 → 本模块入口（`bridge.ts` 的 `lsp.message` 三支与 `lspProgress.ts` 的转发）
  assert.match(read('src/bridge.ts'), /case 'lsp\.progress': case 'lsp\.progressReset': case 'lsp\.message':\s*\n\s*return handleLspProgressEvent/)
  assert.match(read('src/lspProgress.ts'), /if \(event === 'lsp\.message'\) return handleLspServerMessageEvent\(data\)/)
  // 入口那一条必须真的过 `lspMessageVisibleText`（否则前面几条端到端断言就只是测了这个函数本身）
  assert.match(read('src/lspServerMessages.ts'), /const text = typeof data\.message === 'string' \? lspMessageVisibleText\(data\.message\) : ''/)
})

test('上游锚点逐行核内容：那两处剥转义的代码确实长在这些行上', (t) => {
  const handlerPath = 'platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt'
  const consolePath = 'platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt'
  const lexerPath = 'platform/platform-util-io/src/com/intellij/execution/process/AnsiStreamingLexer.java'
  if (!existsSync(join(REF, handlerPath))) { t.skip('参考树不在本机'); return }
  const at = rel => readFileSync(join(REF, rel), 'utf8').split('\n')
  const handler = at(handlerPath)
  const clientConsole = at(consolePath)
  const lexer = at(lexerPath)
  // 1-based 行号
  assert.match(handler[74], /ansiDecoder = AnsiEscapeDecoder\(\)/, ':75 那台解码器')
  assert.match(handler[423], /private fun doNotify\(/, ':424 doNotify 的签名')
  assert.match(handler[431], /var cleanedMessage = ""/, ':432 cleanedMessage 起')
  assert.match(handler[433], /ansiDecoder\.escapeText\(message, ProcessOutputTypes\.STDOUT\)/, ':434 escapeText(STDOUT)')
  assert.match(handler[437], /presentableMessage.*cleanedMessage/, ':438 用剥完的正文拼通知文案')
  assert.match(handler[440], /createNotification\(presentableMessage, type\)/, ':441 通知用的就是它')
  assert.match(clientConsole[39], /private val ansiDecoder = AnsiEscapeDecoder\(\)/, 'LspClientConsole :40')
  assert.match(clientConsole[81], /decodeAnsi: Boolean = true/, 'LspClientConsole :82 默认解')
  assert.match(clientConsole[84], /ansiDecoder\.escapeText\(message, ProcessOutputTypes\.STDOUT\)/, 'LspClientConsole :85')
  assert.match(clientConsole[95], /console\.print\(line, contentType\)/, 'LspClientConsole :96 剥完才打印')
  assert.match(lexer[14], /ESCAPE = '\\u001b'/, 'AnsiStreamingLexer :15')
  assert.match(lexer[131], /lastChar == SGR_SUFFIX/, 'AnsiStreamingLexer :132')
})
