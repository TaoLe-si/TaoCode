import test from 'node:test'
import assert from 'node:assert/strict'

const preview = await import('../src/bridge.ts')

test('preview read/write uses memory and rejects stale versions', async () => {
  assert.equal(preview.isDesktop, false)
  const workspace = await preview.request('workspace.open')
  assert.match(workspace.root, /不访问本地磁盘/)
  const source = await preview.request('workspace.list', { path: 'src' })
  assert.equal(source.length, 2)
  const file = await preview.request('file.read', { path: 'src/main.cpp' })
  const saved = await preview.request('file.write', { path: file.path, content: '中文\r\n', expectedVersion: file.version })
  assert.equal(saved.bytes, Buffer.byteLength('中文\r\n'))
  await assert.rejects(preview.request('file.write', { path: file.path, content: 'overwrite', expectedVersion: file.version }), error => error.code === 'CONFLICT')
  assert.equal((await preview.request('file.read', { path: file.path })).content, '中文\r\n')
  assert.ok(preview.traces.some(trace => trace.status === 'error' && trace.code === 'CONFLICT'))
  assert.ok(!JSON.stringify(preview.traces).includes('overwrite'))
})

test('project settings patch one key without dropping the other', async () => {
  const seeded = await preview.request('project.settings.update', { runConfigs: [{ name: '构建', command: 'cmake --build build' }] })
  assert.deepEqual(seeded.settings.runConfigs, [{ name: '构建', command: 'cmake --build build' }])
  assert.equal(seeded.settings.excludedDirs.length, 4, 'seeding configs must keep the default exclusions')
  const patched = await preview.request('project.settings.update', { excludedDirs: ['.git', 'out'] })
  assert.deepEqual(patched.settings.excludedDirs, ['.git', 'out'])
  assert.equal(patched.settings.runConfigs.length, 1, 'an exclusion-only patch must keep the run configurations')
  assert.ok(Array.isArray(patched.entries) && patched.entries.length, 'the tree is echoed back for the caller')
  const rejected = [
    { runConfigs: [{ name: 'a', command: '' }] },
    { runConfigs: [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }] },
    { runConfigs: [{ name: 'a' }] },
    { runConfigs: { name: 'a', command: 'x' } },
  ]
  for (const patch of rejected)
    await assert.rejects(preview.request('project.settings.update', patch), error => error.code === 'INVALID_SETTINGS')
  assert.equal((await preview.request('project.settings.get')).runConfigs.length, 1, 'rejected writes must not change state')
  assert.deepEqual((await preview.request('project.settings.update', { runConfigs: [] })).settings.runConfigs, [],
    'an empty list is a valid write')
})

test('todo markers are a project list of pattern plus description', async () => {
  const initial = await preview.request('project.settings.get')
  assert.deepEqual(initial.todoPatterns.map(entry => entry.pattern), ['TODO', 'FIXME', 'XXX', 'HACK'], 'the preview starts from the built-in markers')
  const custom = [{ pattern: 'REVIEW', description: '待评审' }, { pattern: 'TODO[:\\s]', description: '带冒号' }]
  const saved = await preview.request('project.settings.update', { todoPatterns: custom })
  assert.deepEqual(saved.settings.todoPatterns, custom)
  const patched = await preview.request('project.settings.update', { bookmarks: [{ path: 'src/main.cpp', line: 4 }] })
  assert.deepEqual(patched.settings.todoPatterns, custom, 'a bookmark-only patch keeps the marker list')
  const rejected = [
    { todoPatterns: [{ pattern: 'TODO' }] },
    { todoPatterns: [{ pattern: '', description: 'x' }] },
    { todoPatterns: [{ pattern: 'TODO', description: '' }] },
    { todoPatterns: [{ pattern: 'A' }, { pattern: 'A' }] },
    { todoPatterns: [{ pattern: 'A\nB', description: 'x' }] },
    { todoPatterns: { pattern: 'A', description: 'b' } },
  ]
  for (const patch of rejected)
    await assert.rejects(preview.request('project.settings.update', patch), error => error.code === 'INVALID_SETTINGS')
  assert.deepEqual((await preview.request('project.settings.get')).todoPatterns, custom, 'rejected writes change nothing')
  assert.deepEqual((await preview.request('project.settings.update', { todoPatterns: [] })).settings.todoPatterns, [],
    'clearing the marker list is a valid write')
  await preview.request('project.settings.update', { todoPatterns: custom })
})

test('bookmarks ride on the same project settings record', async () => {
  const marks = [{ path: 'src/main.cpp', line: 12 }, { path: 'src/app.vue', line: 3, mnemonic: 0 }]
  const saved = await preview.request('project.settings.update', { bookmarks: marks })
  assert.deepEqual(saved.settings.bookmarks, marks)
  assert.equal(saved.settings.runConfigs.length, 0, 'the bookmark write must not invent run configs')
  const patched = await preview.request('project.settings.update', { excludedDirs: ['.git'] })
  assert.deepEqual(patched.settings.bookmarks, marks, 'patching exclusions keeps the bookmark list')
  const rejected = [
    { bookmarks: [{ path: '', line: 3 }] },
    { bookmarks: [{ path: '/abs/x.cpp', line: 3 }] },
    { bookmarks: [{ path: '../x.cpp', line: 3 }] },
    { bookmarks: [{ path: 'src\\x.cpp', line: 3 }] },
    { bookmarks: [{ path: 'src/x.cpp', line: 0 }] },
    { bookmarks: [{ path: 'src/x.cpp' }] },
    { bookmarks: [{ path: 'src/x.cpp', line: 3, mnemonic: 10 }] },
    { bookmarks: { path: 'src/x.cpp', line: 3 } },
  ]
  for (const patch of rejected)
    await assert.rejects(preview.request('project.settings.update', patch), error => error.code === 'INVALID_SETTINGS')
  assert.deepEqual((await preview.request('project.settings.get')).bookmarks, marks, 'rejected writes change nothing')
})

test('template settings accept partial patches and reject malformed data without writes', async () => {
  const custom = { key: 'logger', body: 'log($END$)', description: '日志', languages: ['java'] }
  const saved = await preview.request('project.settings.update', { templates: { customs: [custom] } })
  assert.deepEqual(saved.settings.templates, { overrides: [], customs: [custom] })
  await preview.request('project.settings.update', { templates: {} })
  const invalid = [null, [], { unknown: [] }, { overrides: null }, { customs: null },
    { customs: [custom, null] }, { customs: [custom, custom] },
    { customs: [{ ...custom, description: '中'.repeat(41) }] },
    { customs: [{ ...custom, body: '中'.repeat(2667) }] },
    { customs: [{ ...custom, key: 123 }] }, { customs: [{ ...custom, postfix: true }] },
    { overrides: [{ pattern: 'x' }] }, { overrides: [{ pattern: 'x', disabled: true }, null] }]
  for (const templates of invalid) {
    await assert.rejects(preview.request('project.settings.update', { templates }), error => error.code === 'INVALID_SETTINGS')
    assert.deepEqual((await preview.request('project.settings.get')).templates, saved.settings.templates)
  }
})

test('Java project settings migrate and reach the LSP configuration shape', async () => {
  const java = { jdkHome: 'C:\\Program Files\\Java\\jdk-21', jdkName: 'JavaSE-21', sourcePaths: ['src', 'test/src'], outputPath: 'out', referencedLibraries: ['lib/**/*.jar'] }
  const saved = await preview.request('project.settings.update', { java })
  assert.deepEqual(saved.settings.java, java)
  const patched = await preview.request('project.settings.update', { excludedDirs: ['.git'] })
  assert.deepEqual(patched.settings.java, java, 'an unrelated patch keeps Java settings')
  for (const bad of [{ jdkHome: 'relative' }, { jdkName: '17' }, { sourcePaths: '../outside' }, { sourcePaths: 'src' },
    { sourcePaths: ['src', 'src'] }, { referencedLibraries: ['**/..'] }, { unknown: true }]) {
    await assert.rejects(preview.request('project.settings.update', { java: bad }), error => error.code === 'INVALID_SETTINGS')
    assert.deepEqual((await preview.request('project.settings.get')).java, java)
  }
})

test('native bridge correlates out-of-order replies and keeps failures visible', async () => {
  const sent = []
  let receive
  globalThis.window = { chrome: { webview: {
    postMessage: message => sent.push(message),
    addEventListener: (_event, callback) => { receive = callback },
  } } }
  const native = await import('../src/bridge.ts?native-test')
  assert.equal(native.isDesktop, true)
  const read = native.request('file.read', { path: 'src/main.cpp' })
  const list = native.request('workspace.list', { path: 'src' })
  assert.equal(native.traces[0].status, 'pending')
  receive({ data: { id: sent[1].id, ok: true, result: [], durationMs: 2.5 } })
  receive({ data: { id: sent[0].id, ok: true, result: { content: 'private source' }, durationMs: 1.25 } })
  assert.deepEqual(await list, [])
  assert.equal((await read).content, 'private source')
  assert.equal(native.traces[0].durationMs, 2.5)
  assert.ok(!JSON.stringify(native.traces).includes('private source'))
  const write = native.request('file.write', { path: 'src/main.cpp', content: 'new source', expectedVersion: 'old' })
  receive({ data: { id: sent[2].id, ok: false, error: { code: 'CONFLICT', message: '磁盘文件已改变' }, durationMs: 0.7 } })
  await assert.rejects(write, error => error.code === 'CONFLICT')
  assert.equal(native.traces[0].status, 'error')
  const open = native.request('workspace.open')
  receive({ data: { id: sent[3].id, ok: true, result: null } })
  assert.equal(await open, null)
  assert.match(native.traces[0].message, /取消/)
  native.setNativeDirty(true)
  assert.deepEqual(sent.at(-1), { type: 'documentState', dirty: true })
  native.setNativeTheme('light')
  assert.deepEqual(sent.at(-1), { type: 'appearance', theme: 'light' })
  receive({ data: null })
  receive({ data: { id: 999, ok: true } })
  delete globalThis.window
})

test('file associations map an extension to a language and patch independently', async () => {
  const initial = await preview.request('project.settings.get')
  assert.deepEqual(initial.fileAssociations, {}, 'a fresh project has no associations')
  const saved = await preview.request('project.settings.update', { fileAssociations: { conf: 'typescript', h: 'cpp' } })
  assert.deepEqual(saved.settings.fileAssociations, { conf: 'typescript', h: 'cpp' })
  const patched = await preview.request('project.settings.update', { excludedDirs: ['.git'] })
  assert.deepEqual(patched.settings.fileAssociations, { conf: 'typescript', h: 'cpp' }, 'an exclusion-only patch keeps the associations')
  const rejected = [
    { fileAssociations: [] },
    { fileAssociations: 'conf=typescript' },
    { fileAssociations: { conf: 'kotlin' } },
    { fileAssociations: { Conf: 'java' } },
    { fileAssociations: { '.conf': 'java' } },
    { fileAssociations: { conf: 7 } },
  ]
  for (const patch of rejected)
    await assert.rejects(preview.request('project.settings.update', patch), error => error.code === 'INVALID_SETTINGS')
  assert.deepEqual((await preview.request('project.settings.get')).fileAssociations, { conf: 'typescript', h: 'cpp' },
    'rejected writes change nothing')
})
