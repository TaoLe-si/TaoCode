// `src/documentLinks.ts`：LSP `documentLink` 的命中判定与目标分类。
// IDEA 侧的依据是 `GotoDeclarationHandler`（Ctrl+Click 跳转）+ `HyperlinkInfo.navigate`
// （点一下导航，走浏览器还是编辑器由实现决定）—— 本模块就是那个"由实现决定"的部分。

import test from 'node:test'
import assert from 'node:assert/strict'

const { classifyLinkTarget, describeLink, filePathFromUri, linkAt } =
  await import('../src/documentLinks.ts')

test('file: URI 还原成路径并取出 #L 行号', () => {
  assert.deepEqual(filePathFromUri('file:///C:/work/a.ts'), { path: 'C:/work/a.ts', line: 0 })
  // `/C:/...` 会把开头的斜杠留下，那是个不存在的路径，必须去掉。
  assert.equal(filePathFromUri('file:///C:/work/a.ts').path.startsWith('/'), false)
  assert.deepEqual(filePathFromUri('file:///C:/work/a.ts#L12'), { path: 'C:/work/a.ts', line: 12 })
  assert.deepEqual(filePathFromUri('file:///C:/work/a.ts#L12-L15'), { path: 'C:/work/a.ts', line: 12 },
    '区间形式只取起始行')
  assert.deepEqual(filePathFromUri('file:///home/dev/a.ts'), { path: '/home/dev/a.ts', line: 0 }, 'Unix 路径保留前导斜杠')
  assert.equal(filePathFromUri('file:///C:/my%20dir/a.ts').path, 'C:/my dir/a.ts')
  assert.equal(filePathFromUri('file:///C:/a.ts?x=1').path, 'C:/a.ts', '查询串不属于路径')
  // 不是 file: 的东西不是路径。
  assert.deepEqual(filePathFromUri('https://example.com/a'), { path: '', line: 0 })
})

test('目标分类：外部链接 / 文件 / 无目标', () => {
  assert.deepEqual(classifyLinkTarget('https://example.com/x'), { kind: 'external', url: 'https://example.com/x' })
  assert.deepEqual(classifyLinkTarget('mailto:a@b.c'), { kind: 'external', url: 'mailto:a@b.c' })
  assert.deepEqual(classifyLinkTarget('file:///C:/a.ts#L3'), { kind: 'file', path: 'C:/a.ts', line: 3 })
  // 规范说 target 是 URI，但真实服务器也给相对/绝对路径 —— 当"点不动"会让一半链接失效。
  assert.deepEqual(classifyLinkTarget('src/a.ts'), { kind: 'file', path: 'src/a.ts', line: 0 })
  assert.deepEqual(classifyLinkTarget('C:/work/a.ts'), { kind: 'file', path: 'C:/work/a.ts', line: 0 })
  assert.deepEqual(classifyLinkTarget('.\\\\a.md'), { kind: 'file', path: '.\\\\a.md', line: 0 })
  // 没有目标的链接不是错误，只是点不动。
  assert.deepEqual(classifyLinkTarget(undefined), { kind: 'none' })
  assert.deepEqual(classifyLinkTarget(''), { kind: 'none' })
  // 既没有协议也不像路径的字符串：**不要**猜成文件去打开。
  assert.deepEqual(classifyLinkTarget('SomeSymbol'), { kind: 'none' })
  // 只有协议没有主体的 `file:` 也不该被当成路径。
  assert.deepEqual(classifyLinkTarget('file:'), { kind: 'none' })
})

test('linkAt 的区间是半开的，末尾不算命中', () => {
  const links = [{ startLine: 0, startChar: 2, endLine: 0, endChar: 5, target: 'x' }]
  assert.equal(linkAt(links, 0, 1), undefined, '起点之前不算')
  assert.equal(linkAt(links, 0, 2)?.target, 'x', '起点算')
  assert.equal(linkAt(links, 0, 4)?.target, 'x', '区间内算')
  assert.equal(linkAt(links, 0, 5), undefined, '**终点不算** —— 否则相邻两个链接会在边界上互相抢')
  assert.equal(linkAt(links, 1, 0), undefined, '下一行不算')
})

test('linkAt 支持跨行区间，同一位置取最短的一条', () => {
  const multi = [{ startLine: 1, startChar: 4, endLine: 3, endChar: 2, target: 'multi' }]
  assert.equal(linkAt(multi, 1, 9)?.target, 'multi')
  assert.equal(linkAt(multi, 2, 0)?.target, 'multi', '中间的行整行都算')
  assert.equal(linkAt(multi, 3, 1)?.target, 'multi')
  assert.equal(linkAt(multi, 3, 2), undefined, '终点列不算')
  assert.equal(linkAt(multi, 0, 9), undefined)
  // 外层宽泛区间 + 内层真链接：取内层（IDEA 也是让更精确的目标胜出）。
  const nested = [
    { startLine: 0, startChar: 0, endLine: 0, endChar: 40, target: 'outer' },
    { startLine: 0, startChar: 10, endLine: 0, endChar: 20, target: 'inner' },
  ]
  assert.equal(linkAt(nested, 0, 15)?.target, 'inner')
  assert.equal(linkAt(nested, 0, 5)?.target, 'outer', '没被内层覆盖的位置仍然命中外层')
})

test('linkAt 对坏输入不抛异常', () => {
  assert.equal(linkAt(undefined, 0, 0), undefined)
  assert.equal(linkAt([], 0, 0), undefined)
  assert.equal(linkAt([undefined], 0, 0), undefined)
})

test('提示文案不会把「点不动」说成一条可用链接', () => {
  assert.equal(describeLink({ startLine: 0, startChar: 0, endLine: 0, endChar: 1, tooltip: '说明', target: 'https://x' }), '说明')
  assert.equal(describeLink({ startLine: 0, startChar: 0, endLine: 0, endChar: 1, target: 'https://x' }), 'https://x')
  assert.match(describeLink({ startLine: 0, startChar: 0, endLine: 0, endChar: 1 }), /没有目标/)
  assert.equal(describeLink(undefined), '')
})
