// `src/editorFolding.ts` 的**本地自定义折叠区域**（`lp/custom-folding` 这一族判决里点名的缺口）：
// `//<region>` / `//region` / `#region` / `#pragma region` 标记解析成 `kind: 'region'` 的折叠区间，
// 再由 `mergeFoldRanges` 并进服务端给的区间（同起止以服务端为准）。
//
// 与 `tests/editor-folding.test.mjs` 同一模块，但那一个走的是命令层；这里锁本轮新增的标记解析。

import test from 'node:test'
import assert from 'node:assert/strict'

import { localRegionFolds, mergeFoldRanges, regionMarker } from '../src/editorFolding.ts'

test('四种注释前缀的 region 标记都认，普通注释不认', () => {
  assert.equal(regionMarker('//<region>'), 'start')
  assert.equal(regionMarker('  // </region>'), 'end')
  assert.equal(regionMarker('//<region desc="属性">'), 'start')
  assert.equal(regionMarker('//region'), 'start')
  assert.equal(regionMarker('//endregion'), 'end')
  assert.equal(regionMarker('// region: 构造'), 'start')
  assert.equal(regionMarker('#region'), 'start')
  assert.equal(regionMarker('#endregion'), 'end')
  assert.equal(regionMarker('#pragma region Foo'), 'start')
  assert.equal(regionMarker('#pragma endregion'), 'end')
  // 不是标记：没有注释前缀、词不完整、region 之后没有边界。
  assert.equal(regionMarker('region'), null, '不是注释行')
  assert.equal(regionMarker('// regional settings'), null, 'regional 不是 region')
  assert.equal(regionMarker('//<regions>'), null)
  assert.equal(regionMarker('// <region> trailing'), null, '标记行只允许空白/说明尾巴')
  assert.equal(regionMarker(''), null)
})

test('配对成区间：支持嵌套，结束标记那一行在区间内（折起来只见开始标记）', () => {
  const text = [
    'class A {',            // 0
    '  //<region>',         // 1
    '  void m() {',         // 2
    '    //region inner',   // 3
    '    int a = 1;',       // 4
    '    //endregion',      // 5
    '  }',                  // 6
    '  //</region>',        // 7
    '}',                    // 8
  ].join('\n')
  assert.deepEqual(localRegionFolds(text), [
    { startLine: 3, endLine: 5, kind: 'region' },
    { startLine: 1, endLine: 7, kind: 'region' },
  ])
})

test('未闭合的开始标记不产生区域；多余的结束标记忽略', () => {
  const text = ['//region 没有结尾', 'int a = 1;'].join('\n')
  assert.deepEqual(localRegionFolds(text), [])
  assert.deepEqual(localRegionFolds(['//endregion', '//region', 'x', '//endregion'].join('\n')),
    [{ startLine: 1, endLine: 3, kind: 'region' }])
  assert.deepEqual(localRegionFolds(''), [])
})

test('换行 CRLF 不影响行号', () => {
  assert.deepEqual(localRegionFolds('a\r\n//region\r\nb\r\n//endregion\r\n'), [{ startLine: 1, endLine: 3, kind: 'region' }])
})

test('mergeFoldRanges：同起止以服务端为准，本地独有的补在后面', () => {
  const remote = [{ startLine: 1, endLine: 7, kind: 'imports' }]
  const local = [
    { startLine: 1, endLine: 7, kind: 'region' },   // 与服务端同块：丢掉本地的
    { startLine: 10, endLine: 12, kind: 'region' },
  ]
  assert.deepEqual(mergeFoldRanges(remote, local), [
    { startLine: 1, endLine: 7, kind: 'imports' },
    { startLine: 10, endLine: 12, kind: 'region' },
  ])
  // 没有本地区间时原样返回（拷贝一份，不共享数组）。
  const copy = mergeFoldRanges(remote, [])
  assert.deepEqual(copy, remote)
  assert.notEqual(copy, remote)
})

test('控制器管道顺序：本地区间进 field 后，`region` 的默认折叠设置才认得出它们', () => {
  // 这一段是契约检查（不驱动真实控制器，那个要 DOM）：
  //   · `localRegionFolds` 产出的 `kind` 必须是 `region` ——
  //     `src/editorFoldingSettings.ts` 的 `autoCollapseKinds({collapseCustomRegions: true})` 就是 'region'；
  //   · 控制器把 `mergeFoldRanges(...)` 的结果 dispatch 进 `setFoldingRanges`。
  const code = localRegionFolds('//region\nx\n//endregion')
  assert.deepEqual(code.map(range => range.kind), ['region'])
})
