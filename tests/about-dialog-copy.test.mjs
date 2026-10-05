// 「关于」对话框的接线行为 —— 验 `src/components/AboutDialog.vue` 真的在用 `src/aboutInfo.ts`。
//
// 验的不是「import 成功」，而是上游那条纪律本身：`AboutDialog.myInfo` 让**显示的那几行**与
// **复制出去的那份文本**同源（见 `src/aboutInfo.ts` 模块头）。所以这里把组件真渲染出来
// （`loadSfc` + `renderToString`），再拿它的输出跟模块的两个函数对账：
//   1. 屏幕上的 `dt/dd` 网格 === `aboutRows(info, entryScript)`（含缺值时的 `—` 占位）；
//   2. 复制按钮存在，文案/aria 全部取自模块常量（上游 `createDefaultActions` :140-155）；
//   3. 复制载荷 `extendedAboutText(...)` 含有屏幕上的每一个值 + 上游那几行扩展信息
//      （OS / Toolkit / Config directory / Entry bundle / Cores）。
// 断言 1 与 3 合起来就是「不会各说各话」；断言 2 保证那个按钮不是画出来的摆设。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

const { component: aboutDialog } = loadSfc('src/components/AboutDialog.vue')
const { ABOUT_APP_NAME, ABOUT_COPY_BUTTON, ABOUT_COPY_DESCRIPTION, aboutRows, extendedAboutText } =
  await import('../src/aboutInfo.ts')

/** 一份取得到每一项的 `AppInfo`（形状见 `src/helpActions.ts` 的 `AppInfo`）。 */
const FULL_INFO = { version: '0.1.0', platform: 'Windows', arch: 'x64', webview2: '138.0.7204.50', profile: 'C:/Users/dev/AppData/Roaming/TaoCode' }

async function renderDialog(info) {
  // 无 DOM 环境下组件里的 `entryScript` 走 `typeof document` 守卫取空串，所以这里确定性地传 ''。
  return renderToString(createSSRApp(aboutDialog, { info, onClose: () => {} }))
}

/** 把渲染出的 `<dl>` 拆成 [label, value] 序列（渲染顺序即上游 `getText()` 的顺序）。 */
function gridPairs(html) {
  return [...html.matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(match => [match[1], match[2]])
}

test('「关于」对话框显示的那几行就是 aboutRows 的输出（缺值写 — 占位，不写空串）', async () => {
  const html = await renderDialog(FULL_INFO)
  const rows = aboutRows(FULL_INFO, '')
  assert.deepEqual(gridPairs(html), rows.map(row => [row.label, row.value]),
    '渲染出来的 dt/dd 必须与 aboutRows 逐行相等（含顺序）')
  // 上游缺值用 `…` 口径；本仓的占位符是 `—`。空串会让这一行看不出是"没取到"还是"就是空的"。
  assert.ok(!html.includes('<dd></dd>'), '不允许出现空的 dd（缺值必须走占位符）')
})

test('info 为 null 时整列退化成占位符，且不会出现空值格', async () => {
  const html = await renderDialog(null)
  const rows = aboutRows(null, '')
  assert.deepEqual(gridPairs(html), rows.map(row => [row.label, row.value]))
  for (const [, value] of gridPairs(html)) assert.equal(value, '—', '拿不到的行一律写 —')
})

test('复制按钮是真实的动作按钮：文案与 aria 都取自 aboutInfo 的常量（上游 button.copy.and.close）', async () => {
  const html = await renderDialog(FULL_INFO)
  assert.ok(html.includes(`>${ABOUT_COPY_BUTTON}<`) || html.includes(`${ABOUT_COPY_BUTTON}</button>`),
    `复制按钮的文案必须是 ABOUT_COPY_BUTTON = ${ABOUT_COPY_BUTTON}`)
  assert.ok(html.includes(`aria-label="${ABOUT_COPY_DESCRIPTION}"`), '复制按钮必须有 aria-label（playbook §5.3）')
  assert.ok(html.includes(`title="${ABOUT_COPY_DESCRIPTION}"`), '复制按钮必须有 title（playbook §5.3）')
  // 标题用模块里的产品名常量，不另写一份字符串。
  assert.ok(html.includes(`关于 ${ABOUT_APP_NAME}`), '对话框标题用 ABOUT_APP_NAME')
})

test('复制载荷与显示同源：extendedAboutText 含有屏幕上的每一个真实值 + 上游那几行扩展信息', async () => {
  const cores = 16
  // 入口包名由组件从 DOM 读（SSR 下取不到），这里直接给一个真值来验同源那条不变式 ——
  // `aboutRows` 与 `extendedAboutText` 是同一份数据的两个投影，入口包名是它们唯一的额外输入。
  const entryScript = 'index-a1b2c3d4.js'
  const html = await renderDialog(FULL_INFO)
  const copied = extendedAboutText(FULL_INFO, entryScript, cores)
  for (const row of aboutRows(FULL_INFO, entryScript)) {
    // `—` 是**显示**的占位符（上游 `…` 口径），不是数据，所以不进复制文本；其余每一个真实值都必须同源。
    if (row.value === '—') continue
    // 「配置目录」在扩展文本里换成了上游的 `Config directory:` 标签，「平台」换成了
    // `OS: <平台> (<架构>)` —— 这两行显示与复制的**拼写**本来就不同（照抄上游 `getText()` 与
    // `getExtendedAboutText()` 的不对称），所以「同源」那条不变式落在**数据**上：
    // 复制文本必须含有这一行背后的那几个字段值，而不是显示那一行的拼接结果。
    if (row.label === '平台') {
      assert.ok(copied.includes(FULL_INFO.platform) && copied.includes(FULL_INFO.arch),
        `复制文本必须含有平台与架构两个字段（显示拼成 "${row.value}"，复制用上游 OS: 格式）`)
      continue
    }
    assert.ok(copied.includes(row.value), `复制文本必须含有屏幕上的值：${row.label} = ${row.value}`)
  }
  assert.ok(copied.includes(`Entry bundle: ${entryScript}`), '入口包名那一行也进复制文本（配置定位用）')
  assert.ok(copied.includes('Build: #0.1.0'), 'Build 行的格式照上游 buildInfoNonLocalized 的口径')
  assert.ok(copied.startsWith(ABOUT_APP_NAME), '第一行是产品名（上游 myInfo 的头）')
  assert.ok(copied.includes('OS: Windows (x64)'), 'OS 那一行照上游 getExtendedAboutText 的格式')
  assert.ok(copied.includes('Toolkit: WebView2 138.0.7204.50'), 'Toolkit 那一行带上 WebView2 版本')
  assert.ok(copied.includes('Cores: 16'), 'cores 拿得到时写 Cores 那一行')
  // 反向：拿不到 cores 就不写这一行，不写 0（上游没有这个量的等价物时宁可少写）。
  assert.ok(!extendedAboutText(FULL_INFO, '', null).includes('Cores'), 'cores 为 null 时不写 Cores 行')
  assert.ok(copied.split('\n').length > aboutRows(FULL_INFO, entryScript).length, '复制文本比显示的那几行更长（有扩展段）')
  assert.ok(html.includes(FULL_INFO.profile), '配置目录在屏幕上也显示（那一行带换行样式）')
})

test('info 为 null 时复制文本仍然可用（不是空串），只保留产品名那一行', async () => {
  const copied = extendedAboutText(null, '', null)
  assert.equal(copied, ABOUT_APP_NAME, '没有任何信息时复制文本就是产品名，不写一堆 — 的假数据')
  assert.ok(copied.length > 0)
})
