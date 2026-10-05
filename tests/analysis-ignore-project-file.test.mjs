// 分析忽略的**接线**（`src/analysisIgnore.ts`）：工程里的 `.analysisignore` 会不会真的把诊断挡在
// 问题表之外，以及换工程/清空后规则会不会重读。
// 上游依据：`AnalysisIgnoreService.kt`（每个 `.analysisignore` 按 baseDir 存一条记录）与
// `findAnalysisIgnoreExclusions.kt`（逐层向上判定），行号写在 `src/analysisIgnoreFile.ts` 文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import {
  clearAnalysisIgnore, isAnalysisIgnored, projectIgnoreRecords, refreshProjectAnalysisIgnore, resetProjectAnalysisIgnore, setAnalysisIgnoreHost,
} from '../src/analysisIgnore.ts'

/** 假宿主：只认这两个方法，其余（分析门控不会调别的）一律报错。
 *  类型用 JSDoc 而不是 TS 标注 —— `.mjs` 走纯 JS 解析（`npm test` 不带
 *  `--experimental-strip-types`），写了类型标注整个文件就加载失败。
 *  @param {Record<string, string>} files
 */
function fakeHost(files) {
  /** @type {string[]} */
  const calls = []
  setAnalysisIgnoreHost({
    listFiles: () => ({ files: Object.keys(files), truncated: false }),
    readFile: async (/** @type {string} */ path) => {
      calls.push(path)
      if (!(path in files)) throw new Error(`没有这个文件: ${path}`)
      // 返回形状必须是 `{ content }` —— 生产代码读的是 `document?.content`。
      return { content: files[path] }
    },
  })
  return calls
}

test('工程根的 .analysisignore 挡住子树里的诊断；不在子树里的不受影响', async () => {
  clearAnalysisIgnore()
  fakeHost({ '.analysisignore': 'gen\n', 'src/gen/a.ts': '', 'src/main.ts': '' })
  await refreshProjectAnalysisIgnore()
  assert.equal(projectIgnoreRecords.value.length, 1)
  assert.ok(isAnalysisIgnored('src/gen/a.ts'), 'gen 目录下的文件被忽略')
  assert.ok(!isAnalysisIgnored('src/main.ts'), '没命中任何规则')
})

test('子目录里的 .analysisignore 只管自己那棵子树', async () => {
  clearAnalysisIgnore()
  fakeHost({ 'sub/.analysisignore': 'tmp\n', 'sub/tmp/x.ts': '', 'tmp/x.ts': '' })
  await refreshProjectAnalysisIgnore()
  assert.equal(projectIgnoreRecords.value[0]?.baseDir, 'sub')
  assert.ok(isAnalysisIgnored('sub/tmp/x.ts'))
  assert.ok(!isAnalysisIgnored('tmp/x.ts'))
})

test('不打开工作区时读盘失败按"没有规则"处理，诊断不被吞掉', async () => {
  clearAnalysisIgnore()
  setAnalysisIgnoreHost({
    listFiles: () => { throw new Error('没有打开工作区') },
    readFile: async () => { throw new Error('不该被调用') },
  })
  assert.equal(await refreshProjectAnalysisIgnore(), 0)
  assert.equal(projectIgnoreRecords.value.length, 0)
  assert.ok(!isAnalysisIgnored('src/gen/a.ts'))
})

test('一个文件读失败只丢它自己，其它规则照常', async () => {
  clearAnalysisIgnore()
  fakeHost({ '.analysisignore': 'gen\n', 'sub/.analysisignore': 'tmp\n' })
  setAnalysisIgnoreHost({
    listFiles: () => ({ files: ['.analysisignore', 'sub/.analysisignore'], truncated: false }),
    readFile: async (/** @type {string} */ path) => {
      if (path === 'sub/.analysisignore') throw new Error('读不了')
      return { content: 'gen\n' }
    },
  })
  assert.equal(await refreshProjectAnalysisIgnore(), 1)
  assert.ok(isAnalysisIgnored('src/gen/a.ts'))
  assert.ok(!isAnalysisIgnored('sub/tmp/x.ts'))
})

test('reset 之后重新武装：下一次门控会再读一次', async () => {
  clearAnalysisIgnore()
  const calls = fakeHost({ '.analysisignore': 'gen\n' })
  await refreshProjectAnalysisIgnore()
  assert.deepEqual(calls, ['.analysisignore'])
  resetProjectAnalysisIgnore()
  assert.equal(projectIgnoreRecords.value.length, 0)
  isAnalysisIgnored('src/gen/a.ts')          // 触发一次新的加载
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  assert.deepEqual(calls, ['.analysisignore', '.analysisignore'])
  assert.ok(isAnalysisIgnored('src/gen/a.ts'))
})
