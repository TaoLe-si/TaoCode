// 判据 · **插件服务面**（`src/pluginServices.ts`）—— 缺失功能要由我们的架构以**与上游同名的
// API** 提供给第三方插件（目标：原版 IDEA 能跑的插件在我们 IDE 上也能跑）。
//
// 钉五件事：
//   ① 五个服务的 FQN 与上游逐字一致（`HttpVirtualFileSystem`/`RemoteFileManager`/
//      `FileEditorManager`(+Listener)/`ShelveChangesManager`(+Listener)/`JavaPsiFacade`(+PsiManager)）；
//   ② 注册进 EP 宿主后 `serviceOf(fqn)`（= `ApplicationManager.getService(Class)`）取得到；
//   ③ HTTP：`isHttpUrl`/`findFileByUrl` 复用 `src/remoteFiles.ts`；`getContents` 先问插件的
//      `RemoteContentProvider`、再退回宿主 `http.get`（注入的 fetch）；
//   ④ 编辑器：`openFile`/`closeFile` 触发 `FileEditorManagerListener`，`getOpenFiles` 反映真实
//      打开集合，`detachFile`/`detachedUrl` 复用 `src/editorWindows.ts`（多窗口还原）；
//   ⑤ 搁架：`getAllLists` 走 `shelfTree.shelfRows`；`unshelveChanges(ref)` 走 `stashPop(ref)`；
//      `deleteList` 没有 `git stash drop` 通道 ⇒ 如实抛错，不假装成功；
//      符号：`findClass`/`getClassesInPackage` 走 `symbolModel` 的包树，`getElementFactory` 给 null。
import test from 'node:test'
import assert from 'node:assert/strict'

import { declareBundledExtensionPoints } from '../src/extensionPoints.ts'
import {
  FILE_EDITOR_MANAGER, FILE_EDITOR_MANAGER_LISTENER, HTTP_VIRTUAL_FILE_SYSTEM, JAVA_PSI_FACADE,
  PSI_MANAGER, REMOTE_FILE_MANAGER, SHELVE_CHANGES_MANAGER, SHELVE_CHANGES_MANAGER_LISTENER, SHELF_POP_ACTION_ID,
  createPluginServices, declaredServiceIds, pluginServiceCatalog, registerPluginServices, serviceOf,
} from '../src/pluginServices.ts'

declareBundledExtensionPoints()
registerPluginServices(createPluginServices())

test('五个服务的 FQN 与上游逐字一致', () => {
  assert.equal(HTTP_VIRTUAL_FILE_SYSTEM, 'com.intellij.openapi.vfs.ex.http.HttpVirtualFileSystem')
  assert.equal(REMOTE_FILE_MANAGER, 'com.intellij.openapi.vfs.impl.http.RemoteFileManager')
  assert.equal(FILE_EDITOR_MANAGER, 'com.intellij.openapi.fileEditor.FileEditorManager')
  assert.equal(FILE_EDITOR_MANAGER_LISTENER, 'com.intellij.openapi.fileEditor.FileEditorManagerListener')
  assert.equal(SHELVE_CHANGES_MANAGER, 'com.intellij.openapi.vcs.changes.shelf.ShelveChangesManager')
  assert.equal(SHELVE_CHANGES_MANAGER_LISTENER, 'com.intellij.openapi.vcs.changes.shelf.ShelveChangesManagerListener')
  assert.equal(JAVA_PSI_FACADE, 'com.intellij.psi.JavaPsiFacade')
  assert.equal(PSI_MANAGER, 'com.intellij.psi.PsiManager')
  // 搁架工具窗口那两个动作 id（上游 `ShelfProvider.kt:38-40`）。
  assert.equal(SHELF_POP_ACTION_ID, 'Vcs.Shelf.Pop')
})

test('注册进 EP 宿主后 serviceOf 按 FQN 取得到（getService 的等价物）', () => {
  const http = serviceOf(HTTP_VIRTUAL_FILE_SYSTEM)
  assert.ok(http, 'HttpVirtualFileSystem 取得到')
  assert.equal(http.scope, 'application')
  assert.ok(http.methods.includes('findFileByUrl'))
  assert.ok(serviceOf(FILE_EDITOR_MANAGER))
  assert.ok(serviceOf(SHELVE_CHANGES_MANAGER))
  assert.ok(serviceOf(JAVA_PSI_FACADE))
  assert.equal(serviceOf('com.intellij.not.a.service'), undefined)
  assert.ok(declaredServiceIds().includes(PSI_MANAGER))
  assert.ok(pluginServiceCatalog().length >= 4, '目录里有服务')
  assert.ok(pluginServiceCatalog().every(entry => entry.upstream.length > 0), '每条都写明上游类')
})

test('HTTP 服务：URL 判定与只读文件句柄复用 remoteFiles；getContents 先 provider 再宿主', async () => {
  const calls = []
  const [http] = createPluginServices({ fetch: async url => { calls.push(url); return { available: true, url, content: 'host', status: 200 } } })
  const fs = http.impl
  assert.equal(fs.getProtocol(), 'http')
  assert.equal(fs.isHttpUrl('https://x/a.ts'), true)
  assert.equal(fs.isHttpUrl('ftp://x/a.ts'), false)
  const handle = fs.findFileByUrl('https://x/dir/a.ts?ref=1')
  assert.deepEqual(handle, { url: 'https://x/dir/a.ts?ref=1', name: 'a.ts', readonly: true, valid: true })
  assert.equal(fs.findFileByUrl('ftp://x/a.ts'), null)
  // 没有 provider 时退回宿主 fetch。
  assert.equal((await fs.getContents('https://x/a.ts')).content, 'host')
  assert.deepEqual(calls, ['https://x/a.ts'])
  // 插件注册 provider 后优先由它供内容。
  const provider = { name: 'p', canProvide: url => url.includes('y/'), contents: async url => ({ available: true, url, content: 'provider' }) }
  fs.addRemoteContentProvider(provider)
  assert.equal((await fs.getContents('https://y/b.ts')).content, 'provider')
  assert.deepEqual(calls, ['https://x/a.ts'], 'provider 认领的 URL 不再打宿主')
  fs.removeRemoteContentProvider(provider)
  assert.equal((await fs.getContents('https://y/b.ts')).content, 'host', '移除后又回落到宿主')
})

test('编辑器服务：open/close 触发监听、OpenFiles 反映集合、多窗口走 editorWindows', () => {
  const opened = []
  const closed = []
  const [http, editor] = createPluginServices({
    openFile: path => opened.push(path),
    closeFile: path => closed.push(path),
    openFiles: () => ['a.ts', 'b.ts'],
    selectedFiles: () => ['a.ts'],
  })
  const seen = []
  const unsubscribe = editor.impl.subscribe({ fileOpened: p => seen.push(`open:${p}`), fileClosed: p => seen.push(`close:${p}`) })
  editor.impl.openFile('c.ts')
  editor.impl.closeFile('a.ts')
  assert.deepEqual(seen, ['open:c.ts', 'close:a.ts'], '监听者收到事件')
  assert.deepEqual(opened, ['c.ts'])
  assert.deepEqual(closed, ['a.ts'])
  assert.equal(editor.impl.isFileOpen('b.ts'), true)
  assert.deepEqual([...editor.impl.getOpenFiles()], ['a.ts', 'b.ts'])
  assert.deepEqual([...editor.impl.getSelectedFiles()], ['a.ts'])
  unsubscribe()
  editor.impl.openFile('d.ts')
  assert.equal(seen.length, 2, '退订后不再收到')
  // 多窗口：detachFile 复用 editorWindows.detachTab；detachedUrl 复用 detachedWindowUrl。
  const plan = editor.impl.detachFile([['a.ts', 'b.ts']], 'b.ts')
  assert.ok(plan && plan.path === 'b.ts', '浮层/新窗口计划来自 editorWindows')
  assert.match(editor.impl.detachedUrl('https://app/', 'b.ts'), /detached/)
  void http
})

test('搁架服务：getAllLists 走 shelfRows、unshelveChanges 走 stashPop(ref)、deleteList 如实抛错', async () => {
  const popped = []
  const saved = []
  const services = createPluginServices({
    stashList: async () => [{ ref: 'stash@{0}', message: 'On main: 甲' }, { ref: 'stash@{1}', message: 'WIP on main: 乙' }],
    stashSave: async message => { saved.push(message) },
    stashPop: async ref => { popped.push(ref) },
  })
  const shelf = services.find(service => service.id === SHELVE_CHANGES_MANAGER)
  const rows = await shelf.impl.getAllLists()
  assert.deepEqual(rows.map(row => row.ref), ['stash@{0}', 'stash@{1}'], '走 shelfTree.shelfRows')
  assert.equal(rows[1].auto, true, 'WIP on 识别为自动储藏')
  await shelf.impl.shelveChanges('我的储藏')
  assert.deepEqual(saved, ['我的储藏'])
  // 非栈顶也能取回（ref 透传，native 已收 ref）。
  await shelf.impl.unshelveChanges('stash@{1}', true)
  assert.deepEqual(popped, ['stash@{1}'])
  // pop 动作 id 也走同一条。
  await shelf.impl[SHELF_POP_ACTION_ID]('stash@{0}')
  assert.deepEqual(popped, ['stash@{1}', 'stash@{0}'])
  // deleteList 没有通道 ⇒ 如实抛错。
  await assert.rejects(() => shelf.impl.deleteList('stash@{0}'), /没有落点/)
})

test('符号服务：findClass/getClassesInPackage 走包树，getElementFactory 给 null（没有 PSI 工厂）', () => {
  const pkg = (name, files, children = []) => ({ name, files, children, middle: false })
  const roots = [pkg('com.demo', [], [pkg('com.demo.util', ['src/com/demo/util/Helper.java', 'src/com/demo/util/Other.java'])])]
  const psi = createPluginServices({ packageRoots: () => roots }).find(service => service.id === JAVA_PSI_FACADE)
  assert.ok(psi)
  assert.ok(psi.impl.findPackage('com.demo.util'))
  assert.deepEqual(psi.impl.getClassesInPackage('com.demo.util'), ['Helper', 'Other'])
  assert.deepEqual(psi.impl.findClass('com.demo.util.Helper'), { name: 'com.demo.util.Helper', path: 'src/com/demo/util/Helper.java' })
  assert.equal(psi.impl.findClass('com.demo.util.Nope'), null)
  assert.equal(psi.impl.getElementFactory(), null, '没有 PSI 工厂，如实给 null 而不是假造一个')
  assert.ok(psi.impl.findFile('src/A.java'))
})
