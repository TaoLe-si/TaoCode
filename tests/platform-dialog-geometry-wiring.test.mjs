// 「对话框尺寸记忆」这条链路的接线门禁（桶 7 · ic/dialogs ② / pf/openapi-ui 的 DialogWrapper）。
//
// 上游一个 DialogWrapper 对话框对用户的三件事是一个整体：能拖角改大小
// （`platform/platform-impl/src/com/intellij/openapi/ui/impl/DialogWrapperPeerImpl.java:442-443`）、
// 打开时按 key 读回尺寸（同文件 `:946-958`）、关闭时写回（`:1161-1172`）。
// 本仓只做了后两件的话，读回来的永远是样式里那个默认宽 —— 等于接了个假的。
// 所以这条门禁是**动态扫**的：任何引了 `src/dialogGeometry.ts` 的对话框都必须
//   ① 真的既 load 又 save（同一个键常量）；
//   ② 样式里真的给了 `resize`（且 overflow 不是 visible，否则 resize 不生效）。
// 新增对话框忘了任一件 → 这里变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 全仓引了 dialogGeometry 的组件（.vue 才算消费方：模块自己不算）。 */
function consumers() {
  const dir = join(root, 'src/components')
  return readdirSync(dir).filter(name => name.endsWith('.vue')).filter(name => {
    const text = read(`src/components/${name}`)
    return /from '\.\.\/dialogGeometry(\.ts)?'/.test(text)
  }).map(name => ({ file: `src/components/${name}`, text: read(`src/components/${name}`) }))
}

test('引了尺寸记忆的对话框至少有两个（这条门禁不是在空转）', () => {
  assert.ok(consumers().length >= 2, `只有 ${consumers().length} 个对话框接了 src/dialogGeometry.ts`)
})

test('每个消费方都既读回又写回，且用的是同一个键', () => {
  for (const { file, text } of consumers()) {
    assert.match(text, /dialogGeometryKey\('[a-z0-9-]+'\)/, `${file} 没有声明尺寸键`)
    assert.match(text, /loadDialogSize\(/, `${file} 只存不读：打开时没还原尺寸`)
    assert.match(text, /saveDialogSize\(/, `${file} 只读不存：关闭时没写回尺寸`)
    assert.match(text, /clampDialogSize\(/, `${file} 还原时没夹进视口（小窗口下会溢出）`)
    assert.match(text, /getBoundingClientRect\(\)/, `${file} 写回的不是渲染出来的矩形`)
  }
})

test('消费方的尺寸键全局唯一（两个对话框共用一个键 = 互相覆盖）', () => {
  const keys = consumers().flatMap(({ text }) => [...text.matchAll(/dialogGeometryKey\('([a-z0-9-]+)'\)/g)].map(m => m[1]))
  assert.ok(keys.length >= 2)
  assert.equal(new Set(keys).size, keys.length, `尺寸键重复：${keys.join('、')}`)
})

test('接了尺寸记忆的对话框样式必须真的能改大小（resize + 非 visible overflow）', () => {
  for (const { file, text } of consumers()) {
    const style = text.split('<style')[1] ?? ''
    assert.match(style, /resize:\s*(both|vertical|horizontal)/,
      `${file} 没有 resize —— 用户改不了大小，记忆的尺寸永远是默认值`)
    // CSS 事实：overflow: visible 的元素不会有拖拽角，所以 resize 必须配非 visible 的 overflow。
    assert.match(style, /overflow:\s*(hidden|auto|scroll)/,
      `${file} 的 resize 缺非 visible 的 overflow，浏览器不会画出拖拽角`)
    assert.match(style, /min-(width|height):/, `${file} 没有最小尺寸下限，能拖没内容`)
  }
})

test('上游那三条链路在代码注释里有坐标（判词可复核）', () => {
  assert.match(read('src/dialogGeometry.ts'), /DialogWrapperPeerImpl\.java:442-443/,
    '模块头必须记下"对话框可缩放"这条上游依据')
  for (const { file, text } of consumers()) {
    assert.match(text, /:946-958/, `${file} 少了「打开时读回尺寸」的上游坐标`)
    assert.match(text, /:1161-1172/, `${file} 少了「关闭时写回尺寸」的上游坐标`)
  }
})
