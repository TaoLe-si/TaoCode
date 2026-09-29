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
  // DefaultTodoDefaultPatternProvider.getDefaultPatterns 只发两条，正则逐字照抄。
  assert.deepEqual(initial.todoPatterns.map(entry => entry.pattern), ['\\btodo\\b.*', '\\bfixme\\b.*'], 'the preview starts from the built-in markers')
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

const { applyDapEvent, dapBreakpoints, dapConsole, dapLoadedSources, dapModules, dapProgress, dapState, dapThreadSignal } = preview

function resetDap() {
  dapProgress.splice(0); dapModules.splice(0); dapLoadedSources.splice(0); dapConsole.splice(0)
  dapState.exitCode = null
  dapBreakpoints.clear()
  dapThreadSignal.reason = null; dapThreadSignal.threadId = null
}

test('dap exited keeps the debuggee exit code and says it in the console', () => {
  resetDap()
  applyDapEvent({ event: 'exited', exitCode: 3 })
  assert.equal(dapState.exitCode, 3, 'a non-zero exit is kept so the UI can show it')
  applyDapEvent({ event: 'exited', exitCode: 0 })
  assert.equal(dapState.exitCode, 0, 'a clean exit overwrites the previous run\'s code')
  const texts = dapConsole.map(line => `${line.category}|${line.text}`)
  assert.ok(texts.includes('stderr|程序已退出，退出码 3。'), 'a non-zero exit is an error line')
  assert.ok(texts.includes('telemetry|程序已退出，退出码 0。'), 'exit code 0 is not an error line')
  applyDapEvent({ event: 'exited' })
  assert.equal(dapState.exitCode, 0, 'an event with no code reads as 0 instead of NaN')
})

test('dap progress runs start -> update -> end without duplicating ids', () => {
  resetDap()
  applyDapEvent({ event: 'progress', phase: 'start', progressId: 'boot', title: '启动适配器', message: '连接中', percentage: 0 })
  assert.equal(dapProgress.length, 1)
  assert.deepEqual(dapProgress[0], { id: 'boot', requestId: null, title: '启动适配器', message: '连接中', percentage: 0 })

  applyDapEvent({ event: 'progress', phase: 'update', progressId: 'boot', message: '加载符号', percentage: 42 })
  assert.equal(dapProgress.length, 1, 'an update touches the existing row')
  assert.equal(dapProgress[0].message, '加载符号')
  assert.equal(dapProgress[0].percentage, 42)

  applyDapEvent({ event: 'progress', phase: 'start', progressId: 'boot', title: '启动适配器', message: '连接中' })
  assert.equal(dapProgress.length, 1, 'a repeated start for a live id cannot insert a second row')

  applyDapEvent({ event: 'progress', phase: 'end', progressId: 'boot' })
  assert.equal(dapProgress.length, 0, 'end removes the row')
  applyDapEvent({ event: 'progress', phase: 'end', progressId: 'boot' })
  assert.equal(dapProgress.length, 0, 'a duplicate end is a no-op, not a crash')

  // A partial update keeps what it does not mention, and unknown ids are ignored.
  applyDapEvent({ event: 'progress', phase: 'start', progressId: 'x', title: '索引', percentage: 10 })
  applyDapEvent({ event: 'progress', phase: 'update', progressId: 'x', message: '仍在索引' })
  assert.equal(dapProgress[0].percentage, 10, 'an update without a percentage keeps the last one')
  applyDapEvent({ event: 'progress', phase: 'update', progressId: 'nope', message: '幽灵' })
  assert.equal(dapProgress.length, 1, 'an update for an unknown id adds nothing')
  applyDapEvent({ event: 'progress', phase: 'update', message: '没有 id' })
  assert.equal(dapProgress[0].message, '没有 id', 'an update with no id addresses the newest operation')
  applyDapEvent({ event: 'progress', phase: 'start', title: '无 id 启动' })
  assert.equal(dapProgress.length, 2, 'a start with no id still opens a row instead of being dropped')
  applyDapEvent({ event: 'progress', phase: 'end' })
  assert.equal(dapProgress.length, 1, 'end with no id closes the newest row')
})

test('dap module and loadedSource apply new / changed / removed', () => {
  resetDap()
  applyDapEvent({ event: 'module', reason: 'new', module: { id: 7, name: 'libcore.so' }, path: 'build/libcore.so' })
  applyDapEvent({ event: 'module', reason: 'new', module: { id: 7, name: 'libcore.so' }, path: 'build/libcore.so' })
  assert.equal(dapModules.length, 1, 'the same id is never inserted twice')
  applyDapEvent({ event: 'module', reason: 'changed', module: { id: 7, name: 'libcore.so', type: 'native' }, path: 'build/libcore.so' })
  assert.equal(dapModules[0].type, 'native', 'changed updates the row in place')
  applyDapEvent({ event: 'module', reason: 'new', module: { id: '8', name: 'app.exe' } })
  assert.equal(dapModules.length, 2, 'a string id is accepted too')
  applyDapEvent({ event: 'module', reason: 'removed', module: { id: 7 } })
  assert.deepEqual(dapModules.map(entry => entry.id), ['8'], 'removed drops exactly that id')
  applyDapEvent({ event: 'module', reason: 'new' })
  assert.equal(dapModules.length, 1, 'an event with no usable id is ignored')

  applyDapEvent({ event: 'loadedSource', reason: 'new', source: { name: 'main.cpp', sourceReference: 11 }, path: 'src/main.cpp' })
  applyDapEvent({ event: 'loadedSource', reason: 'new', source: { name: 'main.cpp', sourceReference: 11 }, path: 'src/main.cpp' })
  assert.equal(dapLoadedSources.length, 1, 'the source reference is the identity')
  applyDapEvent({ event: 'loadedSource', reason: 'changed', source: { name: 'Main.cpp', sourceReference: 11 }, path: 'src/main.cpp' })
  assert.equal(dapLoadedSources[0].name, 'Main.cpp')
  applyDapEvent({ event: 'loadedSource', reason: 'new', source: { name: 'helper.cpp' }, path: 'src/helper.cpp' })
  assert.equal(dapLoadedSources.length, 2, 'no reference: the path identifies it')
  applyDapEvent({ event: 'loadedSource', reason: 'removed', source: { name: 'Main.cpp', sourceReference: 11 }, path: 'src/main.cpp' })
  assert.deepEqual(dapLoadedSources.map(entry => entry.key), ['path:src/helper.cpp'], 'removed drops exactly that source')
})

test('dap breakpoint reports the line the adapter really bound', () => {
  resetDap()
  // The user asked for line 10; the adapter moved it to 12 and says so.
  dapBreakpoints.set('src/main.cpp', [{ line: 10 }])
  applyDapEvent({ event: 'breakpoint', verified: true, line: 12, path: 'src/main.cpp' })
  assert.deepEqual(dapBreakpoints.get('src/main.cpp'), [{ line: 12, verified: true }],
    'the gutter row moves to the bound line instead of keeping the requested one')

  // A later report about the same line only updates the verdict.
  applyDapEvent({ event: 'breakpoint', verified: false, line: 12, path: 'src/main.cpp' })
  assert.deepEqual(dapBreakpoints.get('src/main.cpp'), [{ line: 12, verified: false }])

  // Two unconfirmed breakpoints: which one moved is unknowable, so nothing is moved.
  dapBreakpoints.set('src/main.cpp', [{ line: 4 }, { line: 8 }])
  applyDapEvent({ event: 'breakpoint', verified: true, line: 9, path: 'src/main.cpp' })
  assert.deepEqual(dapBreakpoints.get('src/main.cpp'), [{ line: 4 }, { line: 8 }, { line: 9, verified: true }],
    'an ambiguous move adds the adapter\'s line rather than guessing')

  // A breakpoint this client never set is still shown, because the adapter has it.
  dapBreakpoints.set('src/other.cpp', [])
  applyDapEvent({ event: 'breakpoint', verified: true, line: 3, path: 'src/other.cpp' })
  assert.deepEqual(dapBreakpoints.get('src/other.cpp'), [{ line: 3, verified: true }])

  // An unverified line nobody asked for is not invented, and no path means no target.
  dapBreakpoints.delete('src/other.cpp')
  applyDapEvent({ event: 'breakpoint', verified: false, line: 77, path: 'src/other.cpp' })
  assert.equal(dapBreakpoints.has('src/other.cpp'), false, 'unverified reports do not create rows')
  applyDapEvent({ event: 'breakpoint', verified: true, line: 5 })
  assert.equal(dapBreakpoints.size, 1, 'a report with no path is ignored')
  applyDapEvent({ event: 'breakpoint', verified: true, path: 'src/main.cpp' })
  assert.equal(dapBreakpoints.get('src/main.cpp').length, 3, 'a report with no line is ignored')
})

test('dap breakpoint uses the adapter id to place a moved breakpoint exactly', () => {
  resetDap()
  // The adapter's own handle makes "which breakpoint moved" a fact: the first
  // report says where it was asked for, the second where it actually landed.
  dapBreakpoints.set('src/moved.cpp', [{ line: 20 }])
  applyDapEvent({ event: 'breakpoint', verified: false, line: 20, path: 'src/moved.cpp', id: 91 })
  assert.deepEqual(dapBreakpoints.get('src/moved.cpp'), [{ line: 20, verified: false }], 'the requested line stays while unconfirmed')
  applyDapEvent({ event: 'breakpoint', verified: true, line: 24, path: 'src/moved.cpp', id: 91 })
  assert.deepEqual(dapBreakpoints.get('src/moved.cpp'), [{ line: 24, verified: true }], 'the same id moves that row to the bound line')

  // Ids are what disambiguate: without one, two unconfirmed breakpoints would make
  // the move unknowable and nothing would be touched. Here line 8 is the one.
  dapBreakpoints.set('src/two.cpp', [{ line: 4 }, { line: 8 }])
  applyDapEvent({ event: 'breakpoint', verified: false, line: 8, path: 'src/two.cpp', id: 7 })
  applyDapEvent({ event: 'breakpoint', verified: true, line: 9, path: 'src/two.cpp', id: 7 })
  assert.deepEqual(dapBreakpoints.get('src/two.cpp'), [{ line: 4 }, { line: 9, verified: true }],
    'the id says it was line 8, so line 4 is left alone')

  // A string id works the same as a numeric one.
  dapBreakpoints.set('src/str.cpp', [{ line: 30 }])
  applyDapEvent({ event: 'breakpoint', verified: true, line: 31, path: 'src/str.cpp', id: 'bp-a' })
  assert.deepEqual(dapBreakpoints.get('src/str.cpp'), [{ line: 31, verified: true }])

  // The remembered place is per file: an id last seen in another file is not used
  // to move a row here, it falls back to the normal single-unconfirmed rule.
  dapBreakpoints.set('src/other-file.cpp', [{ line: 50 }])
  applyDapEvent({ event: 'breakpoint', verified: true, line: 60, path: 'src/other-file.cpp', id: 'bp-a' })
  assert.deepEqual(dapBreakpoints.get('src/other-file.cpp'), [{ line: 60, verified: true }],
    'no cross-file move: the id only identifies a row inside its own file')
})

test('dap thread events signal the panel to refetch', () => {
  resetDap()
  const before = dapThreadSignal.version
  applyDapEvent({ event: 'thread', reason: 'started', threadId: 3 })
  assert.equal(dapThreadSignal.version, before + 1, 'the panel watches version, not the payload')
  assert.equal(dapThreadSignal.reason, 'started')
  assert.equal(dapThreadSignal.threadId, 3)

  // The native layer forwards the raw body for `thread`, so both shapes must work.
  applyDapEvent({ event: 'thread', body: { reason: 'exited', threadId: 9 } })
  assert.equal(dapThreadSignal.version, before + 2)
  assert.equal(dapThreadSignal.reason, 'exited')
  assert.equal(dapThreadSignal.threadId, 9)

  applyDapEvent({ event: 'thread' })
  assert.equal(dapThreadSignal.version, before + 3, 'an empty event is still a change to refetch for')
  assert.equal(dapThreadSignal.reason, null)
  assert.equal(dapThreadSignal.threadId, null)
})

test('unknown dap events still change nothing', () => {
  resetDap()
  const version = dapThreadSignal.version
  applyDapEvent({ event: 'capability', body: { capabilities: { supportsRestart: true } } })
  applyDapEvent({ event: 'memory' })
  applyDapEvent({ event: 'invalidated' })
  assert.equal(dapProgress.length, 0)
  assert.equal(dapModules.length, 0)
  assert.equal(dapLoadedSources.length, 0)
  assert.equal(dapConsole.length, 0)
  assert.equal(dapState.exitCode, null)
  assert.equal(dapBreakpoints.size, 0)
  assert.equal(dapThreadSignal.version, version, 'unknown events do not ask the panel to refetch')
})

test('tree mutations, sessions and reveal stay desktop-only in the preview', async () => {
  for (const call of [
    () => preview.request('file.copy', { from: 'a.txt', to: 'b.txt' }),
    () => preview.request('file.reveal', { path: 'a.txt' }),
    () => preview.request('session.save', { state: { tabs: [] } }),
    () => preview.request('session.load'),
    () => preview.request('session.clear'),
  ]) {
    await assert.rejects(call, error => error.code === 'DESKTOP_REQUIRED')
  }
})

test('host events reach their stores, and only via handleHostEvent', () => {
  const before = preview.fsChanges.version
  assert.equal(preview.handleHostEvent({ event: 'fs.changed', paths: ['src/a.ts'] }), true)
  assert.equal(preview.fsChanges.version, before + 1)
  assert.deepEqual(preview.fsChanges.paths, ['src/a.ts'])

  const watch = preview.watchStopped.version
  assert.equal(preview.handleHostEvent({ event: 'fs.watchStopped', reason: 'overflow', restarting: true, attempt: 2 }), true)
  assert.deepEqual({ reason: preview.watchStopped.reason, restarting: preview.watchStopped.restarting, attempt: preview.watchStopped.attempt },
    { reason: 'overflow', restarting: true, attempt: 2 })
  assert.equal(preview.watchStopped.version, watch + 1)

  const edited = preview.lspEdited.version
  preview.handleHostEvent({ event: 'lsp.edited', path: 'src/b.ts' })
  assert.equal(preview.lspEdited.path, 'src/b.ts')
  assert.equal(preview.lspEdited.version, edited + 1)

  // 形状不对的事件必须原样落地：不能因为字段缺失就把 store 写坏。
  assert.equal(preview.handleHostEvent({ event: 'lsp.edited' }), false)
  assert.equal(preview.lspEdited.path, 'src/b.ts')
  assert.equal(preview.handleHostEvent({ event: 'fs.changed', paths: 'not-an-array' }), false)
  assert.equal(preview.fsChanges.version, before + 1)
  // 既不是事件、也不是待处理请求的回包
  assert.equal(preview.handleHostEvent(undefined), false)
  assert.equal(preview.handleHostEvent({ id: 999999 }), false)
})

test('a pull-managed file ignores pushed diagnostics until the mark is dropped', () => {
  const path = 'src/diagnostic.rs'
  assert.equal(preview.isPullDiagnostics(path), false)

  // 先来一条推送：正常落地。
  assert.equal(preview.applyPushedDiagnostics(path, [{ severity: 1, message: 'push', startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 4 }]), true)
  assert.equal(preview.lspDiagnostics.get(path)[0].message, 'push')

  // 走一次 pull：标记生效，后续推送被丢弃。
  preview.setPullDiagnostics(path, [{ severity: 2, message: 'pull', startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 3 }])
  assert.equal(preview.isPullDiagnostics(path), true)
  assert.equal(preview.lspDiagnostics.get(path)[0].message, 'pull')
  assert.equal(preview.applyPushedDiagnostics(path, [{ severity: 1, message: 'push-again', startLine: 3, startCharacter: 0, endLine: 3, endCharacter: 1 }]), false)
  assert.equal(preview.lspDiagnostics.get(path)[0].message, 'pull', 'a push must not overwrite a pull result')

  // 同一条规则也要在真正的宿主事件入口上成立（handleHostEvent 是唯一入口）。
  assert.equal(preview.handleHostEvent({ event: 'lsp.diagnostics', path, diagnostics: [] }), true)
  assert.equal(preview.lspDiagnostics.get(path)[0].message, 'pull', 'the push event is consumed but ignored')

  // 服务器只推送时（supported=false）标记必须能撤掉，否则该文件永远收不到诊断。
  preview.clearPullDiagnostics(path)
  assert.equal(preview.isPullDiagnostics(path), false)
  assert.equal(preview.applyPushedDiagnostics(path, [{ severity: 1, message: 'recovered', startLine: 4, startCharacter: 0, endLine: 4, endCharacter: 2 }]), true)
  assert.equal(preview.lspDiagnostics.get(path)[0].message, 'recovered')

  // 清空诊断时标记一并丢弃，下一次推送还能写进这张表。
  preview.setPullDiagnostics(path, [])
  assert.equal(preview.isPullDiagnostics(path), true)
  preview.clearLspDiagnostics(path)
  assert.equal(preview.lspDiagnostics.has(path), false)
  assert.equal(preview.isPullDiagnostics(path), false)
  assert.equal(preview.applyPushedDiagnostics(path, [{ severity: 3, message: 'after-clear', startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 1 }]), true)
  assert.equal(preview.lspDiagnostics.get(path)[0].message, 'after-clear')

  preview.clearLspDiagnostics(path)
})

test('diagnostic push with a non-array payload clears instead of corrupting the store', () => {
  const path = 'src/legacy.ts'
  preview.applyPushedDiagnostics(path, null)
  assert.deepEqual(preview.lspDiagnostics.get(path), [])
  preview.applyPushedDiagnostics(path, [{ severity: 4, message: 'ok', startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 }])
  assert.equal(preview.lspDiagnostics.get(path).length, 1)
  preview.applyPushedDiagnostics(path, 'garbage')
  assert.deepEqual(preview.lspDiagnostics.get(path), [], 'a malformed payload resets the file rather than throwing')
  preview.clearLspDiagnostics(path)
})
