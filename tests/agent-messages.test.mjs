// `agent/messages` 判据：把一段助手回复切成渲染单元，并从中认出可点的文件引用。
//
// 起因：ZCode 形态的对话里「提到文件」要能点进左侧编辑器，所以文件引用必须是结构化的一格，
// 而不是纯文本。这里同时钉住**不该被当成文件**的那些形状（散文、快捷键、版本号、代码块内）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectReferencedFiles, parseAgentMessage, parseFileReference } from '../src/agentMessages.ts'

test('路径形状：认仓库内相对路径，带不带行号都认', () => {
  assert.deepEqual(parseFileReference('src/App.vue'), { path: 'src/App.vue', line: null })
  assert.deepEqual(parseFileReference('src/App.vue:120'), { path: 'src/App.vue', line: 120 })
  assert.deepEqual(parseFileReference('native/main.cpp:1846'), { path: 'native/main.cpp', line: 1846 })
  // 列号后缀要剥掉，否则路径会带上 `:5` 指不到文件
  assert.deepEqual(parseFileReference('src/agent.ts:30:5'), { path: 'src/agent.ts', line: 30 })
  // 只有扩展名、没有目录层级的也认（`README.md`）
  assert.deepEqual(parseFileReference('README.md'), { path: 'README.md', line: null })
})

test('不该被当成文件：散文、快捷键、绝对路径、URL、目录', () => {
  assert.equal(parseFileReference('float'), null)
  assert.equal(parseFileReference('v1.2'), null, '版本号不是文件')
  assert.equal(parseFileReference('Ctrl+Alt+O'), null)
  assert.equal(parseFileReference('这是一个 带空格的句子'), null)
  assert.equal(parseFileReference('/abs/path/file.ts'), null, '绝对路径不在正文里点')
  assert.equal(parseFileReference('C:\\TaoCode\\src\\App.vue'), null)
  assert.equal(parseFileReference('https://github.com/zai-org/ZCode'), null)
  assert.equal(parseFileReference('src/components/'), null, '目录不是文件')
  assert.equal(parseFileReference('src/foo'), null, '有层级但没有扩展名的不认')
  assert.equal(parseFileReference(''), null)
})

test('切分：围栏代码块独立成格，且代码块内不再解析文件引用', () => {
  const reply = '看这个：\n```ts\nimport x from "./foo.ts"\n```\n然后改 `src/App.vue:12`。'
  const segments = parseAgentMessage(reply)
  const code = segments.find(segment => segment.kind === 'code')
  assert.ok(code, '必须切出代码块')
  assert.equal(code.language, 'ts')
  assert.match(code.text, /foo\.ts/)
  const files = segments.filter(segment => segment.kind === 'file')
  assert.equal(files.length, 1, '代码块里的 `./foo.ts` 不能被当成可点引用')
  assert.deepEqual(files[0], { kind: 'file', path: 'src/App.vue', line: 12 })
})

test('切分：连续列表行收成一个计划单元，散文里的列表不会被误收', () => {
  const reply = '先做这几步：\n1. 读 src/agent.ts\n2. 改 native/main.cpp:10\n- 补测试\n\n另外注意 `README.md` 也要更新。'
  const segments = parseAgentMessage(reply)
  const plan = segments.find(segment => segment.kind === 'plan')
  assert.deepEqual(plan.steps, ['读 src/agent.ts', '改 native/main.cpp:10', '补测试'])
  const files = segments.filter(segment => segment.kind === 'file').map(segment => segment.path)
  assert.deepEqual(files, ['README.md'], '计划单元里的路径不再重复产出 file 格')
})

test('行内引用：反引号里不是文件时保留反引号原文，不改排版', () => {
  const segments = parseAgentMessage('按 `Ctrl+Alt+O` 整理导入。')
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'text')
  assert.equal(segments[0].text, '按 `Ctrl+Alt+O` 整理导入。')
})

test('collectReferencedFiles 去重且保序', () => {
  const reply = '先看 `src/a.ts`，再看 `src/b.ts:5`，最后回到 `src/a.ts`。'
  assert.deepEqual(collectReferencedFiles(reply), [
    { path: 'src/a.ts', line: null },
    { path: 'src/b.ts', line: 5 },
  ])
})

test('空输入不产出空文本格', () => {
  assert.deepEqual(parseAgentMessage(''), [])
  assert.deepEqual(parseAgentMessage('   \n  '), [])
  assert.deepEqual(collectReferencedFiles(''), [])
})
