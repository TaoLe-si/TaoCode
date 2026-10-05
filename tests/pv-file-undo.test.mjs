// `pv/command` 族的文件侧：`FileUndoProvider` 的等价物跑在内存文件系统上。
// 判据不是「函数存在」，而是「删掉的文件撤销之后内容真回来了」。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createFileUndoProvider, MAX_DELETE_SNAPSHOT_FILES, recordFileCommand } from '../src/pvFileUndoProvider.ts'
import { getCommandProcessor, resetCommandProcessor } from '../src/pvCommandProcessor.ts'

/** 内存版宿主：只实现 `FileIo` 那七个动作，路径一律相对、`/` 分隔。 */
function memoryIo(seed = {}) {
  const files = new Map(Object.entries(seed).map(([path, text]) => [path, { text, encoding: 'utf-8', bom: false, kind: 'file' }]))
  const directories = new Set()
  let version = 0
  const nextVersion = () => `v${++version}`
  function ensureDirectories(path) {
    const parts = path.split('/')
    let current = ''
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = current ? `${current}/${parts[index]}` : parts[index]
      directories.add(current)
    }
  }
  function listing(path) {
    const prefix = path ? `${path}/` : ''
    const out = []
    const seen = new Set()
    for (const key of [...files.keys(), ...directories]) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (!rest) continue
      const name = rest.split('/')[0]
      if (seen.has(name)) continue
      seen.add(name)
      out.push({ name, kind: rest.includes('/') || directories.has(prefix + name) ? 'directory' : 'file' })
    }
    return out
  }
  return {
    files,
    io: {
      async list(path) { return listing(path) },
      async read(path) {
        const file = files.get(path)
        if (!file) throw new Error(`ENOENT ${path}`)
        return { content: file.text, version: file.version ?? nextVersion(), encoding: file.encoding, bom: file.bom }
      },
      async create(path, directory = false) {
        if (directory) { directories.add(path); return { ok: true } }
        ensureDirectories(path)
        if (!files.has(path)) files.set(path, { text: '', encoding: 'utf-8', bom: false, kind: 'file', version: nextVersion() })
        return { ok: true }
      },
      async write(path, content, expectedVersion, encoding, bom) {
        if (!files.has(path)) throw new Error(`ENOENT ${path}`)
        files.set(path, { text: content, encoding, bom, kind: 'file', version: nextVersion() })
        return { ok: true }
      },
      async remove(path) {
        files.delete(path)
        for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key)
        for (const key of [...directories]) if (key === path || key.startsWith(`${path}/`)) directories.delete(key)
        return { ok: true }
      },
      async copy(from, to) {
        const source = files.get(from)
        if (!source) throw new Error(`ENOENT ${from}`)
        ensureDirectories(to)
        files.set(to, { ...source, version: nextVersion() })
        return { ok: true }
      },
      async rename(from, to) {
        const source = files.get(from)
        if (!source) throw new Error(`ENOENT ${from}`)
        ensureDirectories(to)
        files.delete(from)
        files.set(to, { ...source, version: nextVersion() })
        return { ok: true }
      },
    },
  }
}

const providerOf = seed => {
  const host = memoryIo(seed)
  return { host, provider: createFileUndoProvider(host.io) }
}

test('删除文本文件后撤销：内容、编码、BOM 原样回来', async () => {
  const { host, provider } = providerOf({ 'src/a.txt': '第一行' })
  const capture = await provider.captureForDelete('src/a.txt', false)
  assert.equal(capture.undoable, true)
  assert.equal(capture.files.length, 1)
  await host.io.remove('src/a.txt')
  assert.equal(await provider.existsOnDisk('src/a.txt'), false)
  await provider.deleteStep('src/a.txt', capture.files, false).undo()
  assert.equal(host.files.get('src/a.txt')?.text, '第一行')
  assert.equal(host.files.get('src/a.txt')?.encoding, 'utf-8')
})

test('GBK 与带 BOM 的文件不按 UTF-8 写回', async () => {
  const { host, provider } = providerOf({ 'g.txt': '中文' })
  host.files.set('g.txt', { text: '中文', encoding: 'gbk', bom: true, kind: 'file', version: 'v1' })
  const capture = await provider.captureForDelete('g.txt', false)
  assert.equal(capture.files[0].encoding, 'gbk')
  assert.equal(capture.files[0].bom, true)
  await host.io.remove('g.txt')
  await provider.deleteStep('g.txt', capture.files, false).undo()
  assert.equal(host.files.get('g.txt').encoding, 'gbk')
  assert.equal(host.files.get('g.txt').bom, true)
})

test('读不出来的文件标成不可撤（上游的 registerNonUndoableAction）', async () => {
  const { provider } = providerOf({})
  const capture = await provider.captureForDelete('missing.bin', false)
  assert.equal(capture.undoable, false)
  assert.ok(capture.reason)
})

test('目录删除抓的是整棵子树，超过 200 个文件就整体标不可撤', async () => {
  const seed = {}
  for (let index = 0; index <= MAX_DELETE_SNAPSHOT_FILES; index += 1) seed[`d/f${index}.txt`] = 'x'
  const { provider } = providerOf(seed)
  const capture = await provider.captureForDelete('d', true)
  assert.equal(capture.undoable, false)
  assert.match(capture.reason, /无法整体恢复/)

  const small = providerOf({ 'e/a.txt': 'a', 'e/sub/b.txt': 'b' })
  const ok = await small.provider.captureForDelete('e', true)
  assert.equal(ok.undoable, true)
  assert.deepEqual(ok.files.map(file => file.path).sort(), ['e/a.txt', 'e/sub/b.txt'])
})

test('复制副本的撤销删掉副本；副本已经不在了就报冲突而不是假装成功', async () => {
  const { host, provider } = providerOf({ 'a.txt': '原文件' })
  await host.io.copy('a.txt', 'a copy.txt')
  const step = provider.copyStep('a.txt', 'a copy.txt')
  assert.equal(await step.stillMatches('undo'), true)
  await step.undo()
  assert.equal(host.files.has('a copy.txt'), false)
  await host.io.copy('a.txt', 'a copy.txt')
  await host.io.remove('a copy.txt')
  assert.equal(await step.stillMatches('undo'), false, '副本被外部删掉了，不能再去删第二遍')
})

test('移动的撤销是反着 rename 回去；旧路径被占用就报冲突', async () => {
  const { host, provider } = providerOf({ 'old/name.txt': '内容' })
  await host.io.rename('old/name.txt', 'new/name.txt')
  const step = provider.moveStep('old/name.txt', 'new/name.txt')
  assert.equal(await step.stillMatches('undo'), true)
  await step.undo()
  assert.equal(host.files.get('old/name.txt')?.text, '内容')
  assert.equal(host.files.has('new/name.txt'), false)
  assert.equal(await step.stillMatches('redo'), true, '撤完之后重做的条件正好相反')
  await host.io.rename('old/name.txt', 'new/name.txt')
  await host.io.create('old/name.txt')
  assert.equal(await step.stillMatches('undo'), false, '旧路径上已经有别的东西了')
})

test('命令栈 + 文件步骤：撤销一次 = 磁盘回到上一步，重做再走一遍', async () => {
  const { host, provider } = providerOf({ 'x.txt': 'X' })
  const root = `undo-fs:${Math.random()}`
  const processor = getCommandProcessor(root)
  await host.io.copy('x.txt', 'y.txt')
  recordFileCommand(processor, { name: '粘贴副本', steps: [provider.copyStep('x.txt', 'y.txt')] })
  assert.equal(processor.canUndo(['y.txt']), true)
  assert.equal(processor.menuText('undo', ['y.txt']), '撤消粘贴副本')
  const undone = await processor.undo(['y.txt'])
  assert.equal(undone.ok, true)
  assert.equal(host.files.has('y.txt'), false)
  const redone = await processor.redo(['y.txt'])
  assert.equal(redone.ok, true)
  assert.equal(host.files.get('y.txt')?.text, 'X')
  resetCommandProcessor(root)
})

test('撤销时磁盘已变，给的是那份「其它文件已更改」的报告且不搬栈', async () => {
  const { host, provider } = providerOf({ 'p.txt': 'P' })
  const root = `undo-conflict:${Math.random()}`
  const processor = getCommandProcessor(root)
  await host.io.copy('p.txt', 'q.txt')
  recordFileCommand(processor, { name: '粘贴副本', steps: [provider.copyStep('p.txt', 'q.txt')] })
  await host.io.remove('q.txt')
  const result = await processor.undo(['q.txt'])
  assert.equal(result.ok, false)
  assert.match(result.report.problem, /受此操作影响的以下文件已更改/)
  assert.equal(processor.size().redo, 0, '失败的撤销不该把组挪进重做栈')
  resetCommandProcessor(root)
})
