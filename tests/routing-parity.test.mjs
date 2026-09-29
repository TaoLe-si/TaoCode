// 三张 hand-maintained 的「方法名清单」必须互相一致，否则会造出**只在运行时暴露的空功能**：
//
//   1. `src/bridge.ts` 的 `Method` union   —— 前端能发的方法名
//   2. `native/main.cpp` 的桥接分派         —— 原生真正处理的方法名（switch 的 case + `routes` 小表）
//   3. `native/main.cpp` 的 `is_git_method` —— 必须走工作线程的方法名白名单
//
// 同一个坑已经踩过两次：
//   · `lsp.request` 的参数白名单漏了 `newPath` / `command` / `previousResultId`，
//     于是 willRenameFiles、executeCommand、pull 诊断全都收到空参数；
//   · `main.cpp` 的 kind 清单漏了 completionItemResolve / diagnostic / prepareRename /
//     foldingRange，四个 kind 被打到不认识的入口回 LSP_BAD_KIND，而前端各自 catch 掉了错误，
//     所以「功能已实现」在测试里全绿、在界面上全哑。
//
// 这个测试把这三张清单钉在一起。清单是机检的，不是靠人记。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const bridge = read('src/bridge.ts')
const main = read('native/main.cpp')
const session = read('native/lsp_session.cpp')
const codeActions = read('native/lsp_code_actions.cpp')

/** `export type X = 'a' | 'b'` 单行联合类型里的全部字面量。 */
function unionMembers(source, name) {
  const line = source.match(new RegExp(`^export type ${name} =(.+)$`, 'm'))
  assert.ok(line, `找不到 ${name} 的定义`)
  return [...line[1].matchAll(/'([^']+)'/g)].map(match => match[1])
}

/** `switch (fnv1a(method))` 里的全部 case 标签（UDL 哈希 ⇒ 方法名原样保留在源码里）。 */
function nativeCases() {
  const labels = [...main.matchAll(/case "([^"]+)"_h:/g)].map(match => match[1])
  assert.ok(labels.length > 50, `原生分派只解析出 ${labels.length} 个 case，正则可能已失效`)
  return labels
}

/** `routes.emplace("x", …)` 的小表。 */
function routeKeys() {
  return [...main.matchAll(/routes\.emplace\("([^"]+)"/g)].map(match => match[1])
}

/** `is_git_method` 里的方法名白名单。 */
function gitMethodList() {
  const start = main.indexOf('static bool is_git_method')
  assert.ok(start >= 0, '找不到 is_git_method')
  const body = main.slice(start, main.indexOf('\n    }', start))
  const names = [...body.matchAll(/"([a-z]+\.[A-Za-z.]+)"/g)].map(match => match[1])
  assert.ok(names.length > 20, `is_git_method 只解析出 ${names.length} 个名字`)
  return names
}

test('每个前端能发的方法名，原生都有一条真正的分支', () => {
  const methods = unionMembers(bridge, 'Method')
  const handled = new Set([...nativeCases(), ...routeKeys()])
  assert.ok(methods.length > 100, `Method union 只解析出 ${methods.length} 个成员`)
  const unhandled = methods.filter(name => !handled.has(name))
  assert.deepEqual(unhandled, [], `这些方法名会撞上 UNKNOWN_METHOD：${unhandled.join(', ')}`)
})

test('原生没有前端不认识的方法名（拼写漂移会在运行时才暴露）', () => {
  const methods = new Set(unionMembers(bridge, 'Method'))
  const orphans = [...new Set([...nativeCases(), ...routeKeys()])].filter(name => !methods.has(name))
  assert.deepEqual(orphans, [], `原生实现了前端从不发送的方法名：${orphans.join(', ')}`)
})

test('git 方法名白名单与实际分支完全对齐', () => {
  // 名单里多一个名字 = 那个方法走工作线程但没人处理（回 UNKNOWN_METHOD）；
  // 少一个名字 = 一个会阻塞 UI 线程的 git 请求。
  //
  // `git.cancel` 是**唯一有意**不在名单里的：它只置一个取消标志，必须立刻执行 ——
  // 排到工作线程后面就等于排在它正要取消的那个操作后面（`search.cancel` 同理，但它不是 git.*）。
  const IMMEDIATE = new Set(['git.cancel'])
  const branches = new Set(nativeCases().filter(name => name.startsWith('git.')))
  const listed = new Set(gitMethodList())
  for (const name of IMMEDIATE) assert.ok(branches.has(name), `${name} 的分支不见了`)
  const expected = [...branches].filter(name => !IMMEDIATE.has(name)).sort()
  assert.deepEqual([...listed].sort(), expected)
  for (const name of IMMEDIATE) assert.ok(!listed.has(name), `${name} 不能被放进工作线程名单`)
})

test('每个 LSP kind 至少被一个分派函数认识', () => {
  // `Session::request` 与 `Session::semantic` 互为兜底：从哪个入口进来都必须能到达一个分支。
  // 代码操作一族（codeAction / codeActionResolve / executeCommand）住在
  // native/lsp_code_actions.cpp，由 `semantic()` 转交 —— 那是第三张表，也要算进来。
  const body = (source, signature) => {
    const start = source.indexOf(signature)
    assert.ok(start >= 0, `找不到 ${signature}`)
    return source.slice(start, source.indexOf('\n}\n', start))
  }
  const kindsOf = text => [...text.matchAll(/kind == "([A-Za-z]+)"/g)].map(match => match[1])
  const known = new Set([
    ...kindsOf(body(session, 'void Session::request(')),
    ...kindsOf(body(session, 'void Session::semantic(')),
    ...kindsOf(body(codeActions, 'bool Session::dispatch_code_action(')),
  ])
  assert.ok(known.size > 20, `LSP 分派只解析出 ${known.size} 个 kind`)
  // 转交必须真的存在且**不带走处理器**：按值转交会让下面十余个 kind 拿到空的
  // std::function（std::bad_function_call），而这一族的 kind 看起来仍"被认识"。
  assert.match(session, /dispatch_code_action\(kind,[^)]*\bon_result\)\)\s*return;/,
    'semantic() 不再把不认识的 kind 交给代码操作一族，或转交方式改成了带走处理器')
  const missing = unionMembers(bridge, 'LspRequestKind').filter(kind => !known.has(kind))
  assert.deepEqual(missing, [], `这些 kind 会回 LSP_BAD_KIND：${missing.join(', ')}`)
})
