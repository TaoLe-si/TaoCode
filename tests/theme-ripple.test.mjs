// 主题切换的水纹（src/themeRipple.ts）：几何 + 「关掉动画就什么都不做」这条硬约定。
//
// 这一组只测**纯逻辑**（DOM 那部分由 `themeRipple` 里的 document/window 守卫兜住）：
// 半径必须盖住整个视口 —— 这是"水纹铺满全屏"这件事唯一容易算错的地方。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rippleRadius, themeRipple } from '../src/themeRipple.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('半径要能盖住视口：点哪儿就从哪儿铺到最远的那个角（+1 容差盖住最后一像素）', () => {
  const viewport = { width: 1000, height: 800 }
  // 正中：到四个角的距离都相等。
  assert.equal(rippleRadius({ x: 500, y: 400 }, viewport), Math.hypot(500, 400) + 1)
  // 左上角：最远的是右下角。
  assert.equal(rippleRadius({ x: 0, y: 0 }, viewport), Math.hypot(1000, 800) + 1)
  // 右下角：最远的是左上角。
  assert.equal(rippleRadius({ x: 1000, y: 800 }, viewport), Math.hypot(1000, 800) + 1)
})

test('偏心的点按「到最远的角」算，不是取 max 边长（后者在非正方形视口盖不住角）', () => {
  const viewport = { width: 1000, height: 800 }
  const radius = rippleRadius({ x: 900, y: 700 }, viewport)
  // 900/700 → 半径必须够到 (0, 0) 那个角，即 hypot(900, 700)。
  assert.equal(radius, Math.hypot(900, 700) + 1)
  // 若错写成 max(dx,dy)+1 = 901，就盖不到那个角 —— 断言它确实更大。
  assert.ok(radius > Math.max(900, 700) + 1, '取 max 边长会漏掉对角，水纹铺不满')
})

test('半径永远为正 —— 0 尺寸的视口不会算出 0（会变成一个看不见也不消失的圆）', () => {
  assert.ok(rippleRadius({ x: 0, y: 0 }, { width: 0, height: 0 }) > 0)
  // NaN 由 `normalizePoint` 挡（它在算半径之前把非法坐标换算成视口中心）——
  // 挡住的是"调用方"这一层，不该在纯函数里重复一份防御。
  assert.match(read('src/themeRipple.ts'), /Number\.isFinite\(event\.clientX\)/, '非法坐标没有在算半径之前被换算')
})

test('两处主题按钮的文案是「月之亮面 / 月之暗面」，且都把点击事件传出去', () => {
  for (const file of ['src/components/SettingsDialog.vue', 'src/components/WelcomePage.vue']) {
    const source = read(file)
    assert.ok(source.includes('月之亮面'), `${file} 没有「月之亮面」`)
    assert.ok(source.includes('月之暗面'), `${file} 没有「月之暗面」`)
    assert.ok(!/>亮色</.test(source) && !/>暗色</.test(source) && !/>浅色</.test(source) && !/>深色</.test(source),
      `${file} 还留着旧的亮/暗/浅/深文案`)
    assert.match(source, /emit\('theme', 'light', \$event\)/, `${file} 的亮面按钮没有把点击位置传出去`)
    assert.match(source, /emit\('theme', 'dark', \$event\)/, `${file} 的暗面按钮没有把点击位置传出去`)
  }
})

function mockDocument(t, reduced = false) {
  const properties = new Map()
  const classes = new Set()
  const root = { dataset: { theme: 'light' },
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) },
    classList: { add: key => classes.add(key), remove: key => classes.delete(key) },
  }
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const document = { documentElement: root }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    innerWidth: 1000, innerHeight: 800,
    matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: reduced } },
  } })
  t.after(() => {
    for (const [key, descriptor] of [['document', originalDocument], ['window', originalWindow]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { document, properties, classes }
}

test('在原生快照更新回调中应用目标主题，完成后清理水纹', async t => {
  assert.match(read('src/App.vue'), /themeRipple\(event \?\? null, value, \(\) => \{\s*theme\.value = value/)
  const { document, properties, classes } = mockDocument(t)
  let update, finish, applied = 0
  document.startViewTransition = callback => {
    update = callback
    return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(),
      finished: new Promise(resolve => { finish = resolve }), skipTransition() {} }
  }
  assert.equal(themeRipple({ clientX: 30, clientY: 40 }, 'dark', () => applied++), true)
  assert.equal(applied, 0, '捕获旧快照前不得先切主题')
  assert.equal(properties.get('--theme-reveal-x'), '30px')
  assert.equal(properties.get('--theme-reveal-y'), '40px')
  assert.equal(properties.get('--theme-reveal-radius'), `${rippleRadius({ x: 30, y: 40 }, { width: 1000, height: 800 })}px`)
  assert.ok(classes.has('theme-transition'))
  await update()
  assert.equal(applied, 1)
  finish()
  await Promise.resolve()
  assert.equal(classes.size, 0)
  assert.equal(properties.size, 0)
})

test('尊重 prefers-reduced-motion：不启动过渡但立即应用主题', t => {
  const { document, properties, classes } = mockDocument(t, true)
  document.startViewTransition = () => assert.fail('减少动态效果时不得启动动画')
  let applied = 0
  assert.equal(themeRipple(null, 'dark', () => applied++), false)
  assert.equal(applied, 1)
  assert.equal(properties.size, 0)
  assert.equal(classes.size, 0)
  assert.match(read('src/style.css'), /@media \(prefers-reduced-motion: reduce\)/)
})
