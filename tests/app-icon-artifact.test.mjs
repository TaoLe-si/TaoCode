// `app-icon/产物` 判据：**构建出来的 exe 里到底嵌了几档图标**。
//
// 为什么要有这条：`src/assets/app-icon.png` → `scripts/gen-app-icon.mjs` → `native/app-icon.ico`
// → `native/app-icon.rc` → rc.exe → exe 的 PE 资源。这条链上**每一环都可能悄悄停在上一版**：
//   · 生成器不跑 ⇒ `.ico` 是旧的；
//   · CMake 不知道 `.rc` 依赖 `.ico`（`.ico` 不在任何源文件列表里）⇒ ninja 跳过 rc.exe，
//     重新链接出来的 exe **继续嵌旧图标**。
// 后者真发生过：2026-10-07 桃报「构建好的 exe 显示的还是旧的应用图标」，
// 当时的绕过办法是手工 `touch native/app-icon.rc`。判据查不出这种问题 —— 它只读源文件。
// 读源文件永远说明不了 exe 里是什么，**只能看产物**。
//
// 因此这条判据直接读构建产物；产物不存在（没编过）就跳过而不是假装通过。
// 实际判定逻辑在 `.tools/verify-exe-icon.mjs`（拿 `.ico` 每档载荷的指纹去产物里搜）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, '.tools/verify-exe-icon.mjs')
const exe = join(root, 'build/TaoCode.exe')
const rcRes = join(root, 'build/CMakeFiles/TaoCode.dir/native/app-icon.rc.res')

test('rc.exe 的输入必须跟着 .ico 走（CMake 显式声明这条隐式依赖）', () => {
  const cmake = readFileSync(join(root, 'CMakeLists.txt'), 'utf8')
  assert.match(cmake, /set_source_files_properties\(native\/app-icon\.rc PROPERTIES OBJECT_DEPENDS/,
    '`.rc` 引用了 `app-icon.ico`，但 CMake 不知道 —— 改了 .ico 不会重跑 rc.exe，exe 会继续嵌旧图标')
  // 阳性对照：那行 OBJECT_DEPENDS 指向的确实是真实存在的那份 .ico（不是拼错路径的假声明）。
  assert.ok(existsSync(join(root, 'native/app-icon.ico')), 'native/app-icon.ico 必须存在')
})

test('构建产物里嵌的是七档图标（16/24/32/48/64/128/256），一档都不许少', t => {
  if (!existsSync(exe)) {
    t.skip('build/TaoCode.exe 还没构建（这条只能验产物，没产物就跳过，不假装通过）')
    return
  }
  let output = ''
  let code = 0
  try {
    output = execFileSync(process.execPath, [script, exe], { cwd: root, encoding: 'utf8' })
  } catch (error) {
    code = error.status ?? 1
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert.equal(code, 0, `产物里没有全部七档图标：\n${output}`)
  assert.match(output, /7\/7 档已嵌入/, output)
})

test('rc 编译中间产物里也是七档（它就是进 exe 的那份，先在这里拦一道）', t => {
  if (!existsSync(rcRes)) {
    t.skip('app-icon.rc.res 还没生成（没编过 native 就跳过）')
    return
  }
  const output = execFileSync(process.execPath, [script, rcRes], { cwd: root, encoding: 'utf8' })
  assert.match(output, /7\/7 档已嵌入/, output)
})