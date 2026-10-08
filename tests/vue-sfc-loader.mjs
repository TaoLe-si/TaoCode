// 加载真实 .vue / .ts 模块的最小夹具（测试工具，不是生产代码）。
//
// 为什么需要它：仓库里没有 DOM 环境（没有 jsdom/happy-dom），而布局与工具栏的修复必须**真的跑
// 组件**，不能用源码字符串断言代替。所以这里把 SFC 的 script+template 编译成 CommonJS，再用一
// 个会把相对 TS/Vue 依赖也转译执行的 require 桩装起来，从而在 SSR 下渲染真实组件。
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import { h } from 'vue'
import * as vue from 'vue'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = new Map()
/** 相对 .ts 依赖的求值结果：一个模块只转译/求值一次。
 *  没有这张表时，每个 importer 都会把同一个 `src/*.ts` 重新 `ts.transpileModule` 一遍再跑一遍
 *  模块体 —— ToolWindowView 一条链就有几十个共享模块，实测 12 s 里几乎全是这份重复。
 *  真实 ESM 里模块本来就是单例，所以缓存同时让夹具的语义**更**接近生产。 */
const modules = new Map()
/** 运行时 API 必须是真的：只有图标一类的展示件才换成占位组件。
 *  CodeMirror 的 `@codemirror/state`/`@codemirror/view` 也要真的：`src/editorDebugLine.ts` 等模块在
 *  **模块求值期**就调 `StateEffect.define()`，换成 Proxy 占位件会得到 `define is not a function`。 */
const real = {
  vue,
  '@codemirror/state': createRequire(import.meta.url)('@codemirror/state'),
  '@codemirror/view': createRequire(import.meta.url)('@codemirror/view'),
}

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

/** 会被求值的代码扩展名。其余（`.svg`/`.png`/`.css`…）是资源，按打包器语义给 URL 字符串。 */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const isCodeModule = candidate => CODE_EXTENSIONS.some(extension => candidate.endsWith(extension))

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
      // 资源 import（`import logo from '../assets/x.svg'`）在打包器里得到的是一个 URL 字符串。
      // 早先这里把 SVG 当 .ts 求值 ⇒ `new Function` 在 `fill="url(#…)"` 上报语法错，
      // 整条 import 链（ToolWindowView → AgentPanel）连同测试文件一起炸。
      if (!isCodeModule(candidate)) {
        return { default: `/${relative(root, candidate).split('\\').join('/')}` }
      }
      // 同一个 .ts 被多个组件 import 时只转译并求值一次（求值有副作用：模块级 ref / 常量表）。
      if (!modules.has(candidate)) modules.set(candidate, evaluate(source, candidate, loader(candidate)))
      return modules.get(candidate)
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
  // `filename` 必须给：compiler-sfc 解析「导入进来的类型」（`defineProps<ImportedType>()`）时
  // 是拿 `path.dirname(descriptor.filename)` 去拼相对 import 的。缺它时 filename 退化成
  // `anonymous.vue` → dirname 是 `.` → 拼出 `..\vcsLogGraphOptions.ts` 这种**相对 cwd** 的假路径，
  // 于是报 "Failed to resolve import source"，整测试文件加载失败（2026-10-06 踩过）。
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  // `fs` 必须给：`@vue/compiler-sfc` 3.5.x 在 `<script setup>` 里有**导入的类型**时要去解析它，
  // 缺 fs 就抛 "No fs option provided to compileScript in non-Node environment"（踩过）。
  const compiled = compileScript(descriptor, {
    filename: file,
    id: file.replace(/[^a-z]/gi, ''),
    inlineTemplate: true,
    fs: { fileExists: path => existsSync(path), readFile: path => readFileSync(path, 'utf8') },
  })
  const module = evaluate(compiled.content, file, loader(file))
  const result = { component: module.default }
  cache.set(file, result)
  return result
}

/**
 * 「模板不内联」地编译一个 SFC，把编译产物里那份 `setup()` **真调起来**，
 * 返回它的绑定表与捕获到的 emit 序列。
 *
 * 为什么需要：仓库里没有 DOM，SSR 只能渲染、点不动，所以 `<script setup>` 里的派发函数
 * （Run Anything 弹层的 `pick()` 那一类）在 SSR 里没法验行为。`inlineTemplate: false` 时
 * compiler-sfc 会把 setup 的绑定原样返回（`__returned__`），于是判据可以拿**组件真实的同一段源码**
 * 跑：改错 emit 形状 → 判据变红。这仍然是测试夹具、不是生产代码；控件是否真的渲染出来
 * 由 `loadSfc` + `renderToString` 那条路验。
 *
 * 注意：`onMounted` 一类钩子在这里没有组件实例，Vue 会打一条 dev 警告并直接返回（钩子不跑）。
 */
export function loadSetup(file, props = {}) {
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  const compiled = compileScript(descriptor, {
    filename: file,
    id: `${file.replace(/[^a-z]/gi, '')}setup`,
    inlineTemplate: false,
    fs: { fileExists: path => existsSync(path), readFile: path => readFileSync(path, 'utf8') },
  })
  const module = evaluate(compiled.content, file, loader(file))
  const emitted = []
  const bindings = module.default.setup(props, {
    expose: () => {},
    emit: (event, payload) => { emitted.push({ event, payload }) },
  })
  return { bindings, emitted, component: module.default }
}

export { placeholder }

/**
 * 用**与组件同一份**模块缓存求值一个相对仓库根的 .ts（判据与组件必须看到同一个模块级状态）。
 *
 * 为什么需要：`await import('../src/foo.ts')` 走的是 Node 的 ESM 装载器，夹具这边是
 * `ts.transpileModule` + CommonJS，两边各一份实例 —— 组件读的模块级 ref 与测试灌进去的
 * 那份不是同一个对象（`runAnythingRecentDirectories` 那一份缓存就是这么被喂的）。
 */
export function loadModule(file) {
  const target = resolve(root, file)
  if (!modules.has(target)) modules.set(target, evaluate(readFileSync(target, 'utf8'), target, loader(target)))
  return modules.get(target)
}
