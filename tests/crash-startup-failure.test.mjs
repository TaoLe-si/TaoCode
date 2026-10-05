// 启动失败面（`src/platformIdeStartupFailure.ts`）：报告拼装（照上游 `StartupErrorReporter.showError`
// 与 `jreDetails()` 的形状）、异常链展开、运行时四格的兜底写法，以及消费链
// （`src/main.ts` 挂载失败真的报出来、面板不抢按键、样式只走 tokens）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STARTUP_FAILURE_APPENDIX_LABEL, STARTUP_FAILURE_PREFIX, STARTUP_FAILURE_SEPARATOR, STARTUP_FAILURE_TITLE,
  UNKNOWN_ARCH, UNKNOWN_HOME, UNKNOWN_VENDOR,
  detectStartupRuntime, startupFailureDetail, startupFailureReport, startupRuntimeLine,
} from '../src/platformIdeStartupFailure.ts'

const root = new URL('..', import.meta.url)
const source = readFileSync(new URL('src/platformIdeStartupFailure.ts', root), 'utf8')

const RUNTIME = {
  version: '126.0.6478.127', arch: 'Win32', vendor: '(unknown vendor)',
  home: 'file:///C:/TaoCode/ui/', userAgent: 'Mozilla/5.0 Chrome/126.0.6478.127',
}

test('上游文案照抄：标题/前缀/分隔线/附录标签（BootstrapBundle.properties:1,7,8）', () => {
  assert.equal(STARTUP_FAILURE_TITLE, '启动失败')
  assert.equal(STARTUP_FAILURE_PREFIX, '内部错误')
  assert.equal(STARTUP_FAILURE_SEPARATOR, '-----')
  assert.equal(STARTUP_FAILURE_APPENDIX_LABEL, '运行时')
  assert.equal(UNKNOWN_VENDOR, '(unknown vendor)')
  assert.equal(UNKNOWN_ARCH, '(unknown arch)')
  assert.equal(UNKNOWN_HOME, '(unknown home)')
})

test('报告拼装：标题 → 前缀 → 异常栈 → ----- → 附录（showError :122-141 + jreDetails :143-150）', () => {
  const report = startupFailureReport(new Error('挂载失败'), RUNTIME)
  const lines = report.split('\n')
  assert.equal(lines[0], '启动失败')
  assert.equal(lines[1], '')
  assert.equal(lines[2], '内部错误')
  assert.equal(lines[3], '')
  // 末尾四行固定：分隔线 + 附录三行（异常栈本身有多少行不固定）。
  const appendix = lines.slice(-4)
  assert.equal(appendix[0], '-----')
  assert.equal(appendix[1], '运行时：126.0.6478.127 Win32 ((unknown vendor))')
  assert.equal(appendix[2], '主目录：file:///C:/TaoCode/ui/')
  assert.equal(appendix[3], 'User-Agent：Mozilla/5.0 Chrome/126.0.6478.127')
  const separator = lines.indexOf('-----')
  assert.ok(separator === lines.length - 4, `分隔线不在附录前一行：${lines.slice(0, separator).join(' / ')}`)
  assert.ok(lines.slice(0, separator).join('\n').includes('挂载失败'), '异常文本没进报告')
  assert.equal(lines[separator - 1], '', '分隔线前要留一个空行')
})

test('异常链按 Caused by 逐层展开（上游 findCause :433-441 走的是同一条 cause 链）', () => {
  const bottom = new Error('底层失败')
  const wrapped = new Error('外层失败', { cause: bottom })
  const detail = startupFailureDetail(wrapped)
  assert.ok(detail.startsWith('Error: 外层失败'), detail)
  const marked = detail.indexOf('Caused by:')
  assert.ok(marked > 0, detail)
  assert.ok(detail.includes('底层失败') && detail.indexOf('底层失败') > marked, 'cause 链要逐层写出')
  // 自引用的 cause 不能把报告写成死循环。
  const loop = { message: '自引用', cause: null }
  loop.cause = loop
  assert.equal(startupFailureDetail(loop), '自引用')
})

test('运行时四格：Chromium 版本取自 UA，拿不到的一律照上游写 (unknown …) 兜底', () => {
  const detected = detectStartupRuntime({ userAgent: 'Mozilla/5.0 Chrome/126.0.6478.127 Safari/537', platform: 'Win32' })
  assert.equal(detected.version, '126.0.6478.127')
  assert.equal(detected.arch, 'Win32')
  assert.equal(detected.vendor, UNKNOWN_VENDOR)
  assert.equal(startupRuntimeLine(detected), `${STARTUP_FAILURE_APPENDIX_LABEL}：126.0.6478.127 Win32 (${UNKNOWN_VENDOR})`)

  const bare = detectStartupRuntime({})
  assert.equal(bare.version, '(unknown)')
  assert.equal(bare.arch, '(unknown arch)')
  assert.equal(bare.home || '(unknown home)', '(unknown home)')
  assert.equal(bare.userAgent, '(unknown)')
})

test('消费链：main.ts 挂载失败报出来、复制与日志两个动作都走真通道、面板不抢按键', () => {
  const main = readFileSync(new URL('src/main.ts', root), 'utf8')
  assert.match(main, /import \{ showStartupFailure \} from '\.\/platformIdeStartupFailure\.ts'/)
  assert.match(main, /try \{ createApp\(App\)\.mount\('#app'\) \} catch \(error\) \{ showStartupFailure\(error\) \}/)
  // SafeActionTextPane（:443-451）吞掉所有按键：面板不许挂键盘监听。
  assert.doesNotMatch(source, /addEventListener\('key(?!down'\s*,\s*this)/)
  assert.doesNotMatch(source, /onkeydown/)
  // 两个留下的选项都必须是真动作：剪贴板 / 宿主通道。
  assert.match(source, /copyToClipboard\(report\)/)
  assert.match(source, /request<\{ dir: string \}>\('app\.logPaths'\)/)
  assert.match(source, /request\('file\.reveal', \{ path: paths\.dir \}\)/)
})

test('面板样式只走 tokens 里的变量（不写裸 hex / 硬编码毫秒）', () => {
  const style = /const PANEL_STYLE = `([\s\S]*?)`/.exec(source)?.[1] ?? ''
  assert.ok(style.length > 0, '找不到 PANEL_STYLE')
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}/i)
  assert.doesNotMatch(style, /\d+ms\b/)
  assert.doesNotMatch(style, /cubic-bezier/)
  for (const token of ['--space-3', '--space-4', '--elevated', '--line-strong', '--radius-lg', '--shadow-3', '--font-mono'])
    assert.ok(style.includes(`var(${token}`), `样式没用 ${token}`)
})
