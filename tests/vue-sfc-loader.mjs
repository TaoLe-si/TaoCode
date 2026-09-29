// 加载真实 .vue / .ts 模块的最小夹具（测试工具，不是生产代码）。
//
// 为什么需要它：仓库里没有 DOM 环境（没有 jsdom/happy-dom），而布局与工具栏的修复必须**真的跑
// 组件**，不能用源码字符串断言代替。所以这里把 SFC 的 script+template 编译成 CommonJS，再用一
// 个会把相对 TS/Vue 依赖也转译执行的 require 桩装起来，从而在 SSR 下渲染真实组件。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { h } from 'vue'
import * as vue from 'vue'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()
/** 运行时 API 必须是真的：只有图标一类的展示件才换成占位组件。 */
const real = { vue }

/** 把一段 TS/JS 源码转成 CommonJS 并就地求值，交给 loader 继续解析相对依赖。 */
function evaluate(source, filename, loader) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  const fn = new Function('require', 'exports', 'module', js)
  try {
    fn(loader, exports, { exports })
  } catch (error) {
    error.message = `${error.message} (while loading ${filename})`
    throw error
  }
  return exports
}

/** 真实的相对依赖（.ts/.vue）会被转译后求值；第三方 bare 模块与子组件一律替换成占位组件。 */
function loader(file) {
  return name => {
    if (!name.startsWith('.')) return name in real ? real[name] : placeholder(name)
    const base = resolve(dirname(file), name)
    const candidates = [base, `${base}.ts`, `${base}.vue`, resolve(base, 'index.ts')]
    for (const candidate of candidates) {
      if (!candidate.startsWith(root)) continue
      let source
      try { source = readFileSync(candidate, 'utf8') } catch { continue }
      if (candidate.endsWith('.vue')) return { default: loadSfc(candidate).component }
      return evaluate(source, candidate, loader(candidate))
    }
    return placeholder(name)
  }
}
function placeholder(name) {
  const component = { name, render: () => h('span', { 'data-stub': name }) }
  return new Proxy(component, {
    // 只有「大写开头的展示件」才算一个占位组件；Vue 内部的探测键（__v_isVNode、normalize…）
    // 必须回 undefined，否则渲染时会被误判成 vnode / 带类型的对象。
    get(target, key) {
      if (key in target || typeof key === 'symbol' || !/^[A-Z]/.test(String(key))) return target[key]
      return placeholder(`${name}.${String(key)}`)
    },
  })
}

/** 编译单个 .vue 文件，返回可渲染的组件（子组件仍会被替换成占位组件）。 */
export function loadSfc(file) {
  if (cache.has(file)) return cache.get(file)
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'))
  const compiled = compileScript(descriptor, { id: file.replace(/[^a-z]/gi, ''), inlineTemplate: true })
  const module = evaluate(compiled.content, file, loader(file))
  const result = { component: module.default }
  cache.set(file, result)
  return result
}

export { placeholder }
