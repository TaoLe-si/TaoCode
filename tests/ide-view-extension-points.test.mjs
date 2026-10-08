// 判据 · projectviews 域的扩展点宿主接线（`src/ideViewExtensionPoints.ts`）—— 上游本来就是 EP 的
// 那几族（TodoIndexer / StructureViewBuilder / ProjectViewPane / NotificationGroup / UndoProvider）
// 的同名方法面，以及内建表作为 bundled 贡献登记后的真实消费（`src/notificationGroups.ts`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NOTIFICATION_GROUP_EP, PROJECT_VIEW_PANE_EP, STRUCTURE_VIEW_BUILDER_EP, TODO_INDEXER_EP,
  UNDO_PROVIDER_EP, availableProjectViewPanes, declareIdeViewExtensionPoints, indexTodoEntries,
  notificationGroupContribution, projectViewPanes, registerIdeViewExtension,
  structureViewRows, todoIndexersFor, undoProvidersFor, unregisterIdeViewExtension,
  EDITOR_NOTIFICATION_PROVIDER_EP, FILE_ICON_PROVIDER_EP, PROJECT_VIEW_NODE_DECORATOR_EP,
  PSI_STRUCTURE_VIEW_FACTORY_EP, STRUCTURE_VIEW_EXTENSION_EP, TODO_EXTRA_PLACES_EP,
  TREE_STRUCTURE_PROVIDER_EP, USAGE_GROUPING_RULE_PROVIDER_EP,
  activeUsageGroupingRules, applyStructureViewExtensions, decorateProjectViewNode,
  editorNotificationsFor, fileIconFor, modifyProjectTreeChildren, structureViewBuilderFor,
  todoExtraPlaceAccepts,
} from '../src/ideViewExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { notificationGroup } from '../src/notificationGroups.ts'
import { DIAGNOSTIC_DECORATOR_ID, decorationForDiagnostics, nodeDecorationFor } from '../src/projectTreeDecorations.ts'
import { BIDI_NOTIFICATION_PANEL_ID, bidiPanelForText } from '../src/bidiNotification.ts'

test('五条 EP 的 id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(TODO_INDEXER_EP, 'com.intellij.todoIndexer')
  assert.equal(STRUCTURE_VIEW_BUILDER_EP, 'com.intellij.structureViewBuilder')
  assert.equal(PROJECT_VIEW_PANE_EP, 'com.intellij.projectViewPane')
  assert.equal(NOTIFICATION_GROUP_EP, 'com.intellij.notificationGroup')
  assert.equal(UNDO_PROVIDER_EP, 'com.intellij.undoProvider')
  for (const id of [TODO_INDEXER_EP, STRUCTURE_VIEW_BUILDER_EP, PROJECT_VIEW_PANE_EP,
                    NOTIFICATION_GROUP_EP, UNDO_PROVIDER_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  declareIdeViewExtensionPoints()
})

test('TodoIndexer：map(FileContent) 同名方法面，按 fileType 过滤、合并多支', () => {
  const ts = registerIdeViewExtension(TODO_INDEXER_EP, 'test.ts', {
    id: 'test.ts', fileType: 'ts',
    map: content => [{ pattern: 'TODO', text: 'TODO x', line: content.text.split('\n').length - 1 }],
  })
  registerIdeViewExtension(TODO_INDEXER_EP, 'test.any', {
    id: 'test.any', map: () => [{ pattern: 'FIXME', text: 'FIXME y', line: 0 }],
  })
  assert.deepEqual(todoIndexersFor('a.ts').map(item => item.id).sort(), ['test.any', 'test.ts'])
  assert.deepEqual(todoIndexersFor('a.py').map(item => item.id), ['test.any'])
  assert.deepEqual(indexTodoEntries('a.ts', 'x\n').map(item => item.pattern).sort(), ['FIXME', 'TODO'])
  ts.dispose()
})

test('StructureViewBuilder：createStructureView / createStructureViewSuspend 同名方法面', () => {
  const handle = registerIdeViewExtension(STRUCTURE_VIEW_BUILDER_EP, 'test.sv', {
    id: 'test.sv',
    createStructureView: ({ symbols }) => symbols.map((symbol, depth) => ({
      name: symbol.name, kind: symbol.kind, depth,
      startLine: symbol.startLine, startChar: symbol.startChar,
      endLine: symbol.endLine, endChar: symbol.endChar,
    })),
  })
  const rows = structureViewRows({ path: 'a.ts', symbols: [
    { name: 'foo', kind: 12, startLine: 0, startChar: 0, endLine: 2, endChar: 1 },
    { name: 'bar', kind: 6, startLine: 3, startChar: 0, endLine: 4, endChar: 1 },
  ] })
  assert.deepEqual(rows.map(row => row.name), ['foo', 'bar'])
  assert.deepEqual(rows.map(row => row.depth), [0, 1])
  handle.dispose()
})

test('ProjectViewPane：getWeight 排序、isAvailable(root) 过滤', () => {
  const light = registerIdeViewExtension(PROJECT_VIEW_PANE_EP, 'test.light', {
    id: 'test.light', getTitle: () => '轻', isInitiallyVisible: () => false, getGroup: () => 'g',
    getWeight: () => 1, isAvailable: () => true,
  })
  const heavy = registerIdeViewExtension(PROJECT_VIEW_PANE_EP, 'test.heavy', {
    id: 'test.heavy', getTitle: () => '重', isInitiallyVisible: () => true, getGroup: () => 'g',
    getWeight: () => 9, isAvailable: root => root === 'D:/p',
  })
  assert.deepEqual(projectViewPanes().map(pane => pane.id), ['test.heavy', 'test.light'])
  assert.deepEqual(availableProjectViewPanes('D:/p').map(pane => pane.id), ['test.heavy', 'test.light'])
  assert.deepEqual(availableProjectViewPanes('D:/q').map(pane => pane.id), ['test.light'])
  light.dispose(); heavy.dispose()
})

test('NotificationGroup：内建表已作为 bundled 贡献登记；第三方按 id 挂的组走同一查询路径', () => {
  // 内建表里真实存在的一条（`src/notificationGroups.ts` 的注册项）在 EP 里也查得到。
  const builtin = notificationGroupContribution('LSP window/showMessage')
  assert.ok(builtin, '内建通知组应作为 bundled 贡献登记进 EP')
  assert.equal(builtin.getDisplayType(), 'BALLOON')

  const handle = registerIdeViewExtension(NOTIFICATION_GROUP_EP, 'ThirdParty', {
    id: 'ThirdParty',
    getDisplayId: () => 'ThirdParty',
    getDisplayType: () => 'STICKY_BALLOON',
    isLogByDefault: () => false,
    getToolWindowId: () => 'Notifications',
    getTitle: () => '第三方组',
  })
  // `notificationGroup()` 是真实消费侧：内建表查不到就查 EP。
  const viaConsumer = notificationGroup('ThirdParty')
  assert.equal(viaConsumer.displayType, 'STICKY_BALLOON')
  assert.equal(viaConsumer.isLogByDefault, false)
  assert.equal(viaConsumer.title, '第三方组')
  assert.equal(viaConsumer.toolWindowId, 'Notifications')
  assert.equal(notificationGroup('NopeNotRegistered'), undefined)
  handle.dispose()
  assert.equal(notificationGroup('ThirdParty'), undefined)
})

test('UndoProvider：同名方法面（undo/redo/isUndoAvailable/…）按 root 过滤', () => {
  const handle = registerIdeViewExtension(UNDO_PROVIDER_EP, 'test.undo', {
    id: 'test.undo',
    undo: async () => true, redo: async () => false,
    isUndoAvailable: root => root === 'D:/p', isRedoAvailable: () => false,
    getUndoActionName: () => '重命名', getRedoActionName: () => null,
  })
  assert.deepEqual(undoProvidersFor('D:/p').map(provider => provider.id), ['test.undo'])
  assert.deepEqual(undoProvidersFor('D:/q').map(provider => provider.id), [])
  assert.equal(undoProvidersFor('D:/p')[0].getUndoActionName('D:/p'), '重命名')
  handle.dispose()
  unregisterIdeViewExtension(UNDO_PROVIDER_EP, 'test.undo')
})

// ── 第二批 EP（2026-10-07 epclose2）：id 逐字取自上游真名 + 同名方法面 + 消费面 ──────────────

test('第二批 EP 的 id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(TREE_STRUCTURE_PROVIDER_EP, 'com.intellij.treeStructureProvider')
  assert.equal(PROJECT_VIEW_NODE_DECORATOR_EP, 'com.intellij.projectViewNodeDecorator')
  assert.equal(FILE_ICON_PROVIDER_EP, 'com.intellij.fileIconProvider')
  assert.equal(USAGE_GROUPING_RULE_PROVIDER_EP, 'com.intellij.usageGroupingRuleProvider')
  assert.equal(STRUCTURE_VIEW_EXTENSION_EP, 'com.intellij.lang.structureViewExtension')
  assert.equal(PSI_STRUCTURE_VIEW_FACTORY_EP, 'com.intellij.lang.psiStructureViewFactory')
  assert.equal(EDITOR_NOTIFICATION_PROVIDER_EP, 'com.intellij.editorNotificationProvider')
  assert.equal(TODO_EXTRA_PLACES_EP, 'com.intellij.todoExtraPlaces')
  for (const id of [TREE_STRUCTURE_PROVIDER_EP, PROJECT_VIEW_NODE_DECORATOR_EP, FILE_ICON_PROVIDER_EP,
                    USAGE_GROUPING_RULE_PROVIDER_EP, STRUCTURE_VIEW_EXTENSION_EP, PSI_STRUCTURE_VIEW_FACTORY_EP,
                    EDITOR_NOTIFICATION_PROVIDER_EP, TODO_EXTRA_PLACES_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  declareIdeViewExtensionPoints()
})

test('TreeStructureProvider：modify 按注册序逐个过，无 provider 时恒等、坏 provider 跳过', () => {
  const node = (id) => ({ id, name: id, isDirectory: false, path: id })
  const base = [node('a'), node('b')]
  // 没有第三方 provider 时原样返回（本仓既有行为零改动）。
  assert.deepEqual(modifyProjectTreeChildren(null, base).map(item => item.id), ['a', 'b'])

  const boom = registerIdeViewExtension(TREE_STRUCTURE_PROVIDER_EP, 'test.boom', {
    id: 'test.boom', modify: () => { throw new Error('bad plugin') },
  })
  const drop = registerIdeViewExtension(TREE_STRUCTURE_PROVIDER_EP, 'test.drop', {
    id: 'test.drop', modify: ({ children }) => children.filter(item => item.id !== 'b'),
  })
  // 注册序：boom 先（抛错 → 跳过，本层保持上一步），drop 后（滤掉 b）。
  assert.deepEqual(modifyProjectTreeChildren(null, base).map(item => item.id), ['a'])
  boom.dispose(); drop.dispose()
  assert.deepEqual(modifyProjectTreeChildren(null, base).map(item => item.id), ['a', 'b'])
})

test('ProjectViewNodeDecorator：内建诊断装饰已登记为 bundled；第三方叠加走同一路径（真实消费点 nodeDecorationFor）', () => {
  const bundled = EXTENSIONS.allEntries(PROJECT_VIEW_NODE_DECORATOR_EP).map(entry => entry.id)
  assert.ok(bundled.includes(DIAGNOSTIC_DECORATOR_ID), '内建诊断装饰器应作为 bundled 贡献登记进 EP')

  // 真实消费点：nodeDecorationFor 走 EP（内建那支按 errors/warnings 给类名）。
  const data = decorationForDiagnostics(
    { id: 'a.ts', name: 'a.ts', path: 'a.ts', isDirectory: false }, [{ severity: 1 }, { severity: 2 }])
  assert.equal(data.className, 'tree-decoration-error')
  assert.equal(data.tooltipSuffix, ' · 1 个错误 · 1 个警告')

  const handle = registerIdeViewExtension(PROJECT_VIEW_NODE_DECORATOR_EP, 'test.third', {
    id: 'test.third',
    decorate: ({ data: presentation }) => { presentation.presentableText = '改过的名字' },
  })
  assert.equal(nodeDecorationFor({ id: 'b.ts', name: 'b.ts', path: 'b.ts', isDirectory: false }).presentableText, '改过的名字')
  handle.dispose()
  assert.equal(nodeDecorationFor({ id: 'b.ts', name: 'b.ts', path: 'b.ts', isDirectory: false }).presentableText, undefined)
})

test('FileIconProvider：第一个给出图标者赢；抛错的 provider 跳过', () => {
  const boom = registerIdeViewExtension(FILE_ICON_PROVIDER_EP, 'test.iconBoom', {
    id: 'test.iconBoom', getIcon: () => { throw new Error('boom') },
  })
  const win = registerIdeViewExtension(FILE_ICON_PROVIDER_EP, 'test.iconWin', {
    id: 'test.iconWin', getIcon: ({ path }) => (path.endsWith('.jar') ? 'archive' : null),
  })
  assert.equal(fileIconFor({ path: 'lib.jar', isDirectory: false }), 'archive')
  assert.equal(fileIconFor({ path: 'a.ts', isDirectory: false }), null)
  boom.dispose(); win.dispose()
})

test('UsageGroupingRuleProvider：getActiveRules 并起来按档号升序（DirectoryGroupingRule 400 在 FileGroupingRule 500 之前）', () => {
  const handle = registerIdeViewExtension(USAGE_GROUPING_RULE_PROVIDER_EP, 'test.rules', {
    id: 'test.rules',
    getActiveRules: () => [
      { id: 'test.file', rank: 500, groupKeyOf: () => 'f', labelOf: () => 'f' },
      { id: 'test.dir', rank: 100, groupKeyOf: () => 'd', labelOf: () => 'd' },
    ],
  })
  assert.deepEqual(activeUsageGroupingRules('D:/p').map(rule => rule.id), ['test.dir', 'test.file'])
  handle.dispose()
  assert.deepEqual(activeUsageGroupingRules('D:/p'), [])
})

test('StructureViewExtension：按 getType 收窄的 kind 过滤后补子行，filterChildren 可拦截', () => {
  const row = (name, depth) => ({ name, kind: 12, depth, startLine: 0, startChar: 0, endLine: 0, endChar: 0 })
  const parent = { path: 'a.ts', symbol: { name: 'C', kind: 5, startLine: 0, startChar: 0, endLine: 9, endChar: 0 }, depth: 0 }
  const handle = registerIdeViewExtension(STRUCTURE_VIEW_EXTENSION_EP, 'test.svExt', {
    id: 'test.svExt',
    getType: () => [5],
    getChildren: () => [row('extra', 1)],
  })
  assert.deepEqual(applyStructureViewExtensions([row('base', 1)], parent).map(item => item.name), ['base', 'extra'])
  // kind 不匹配（父是方法 kind 6）⇒ 不补。
  const method = { path: 'a.ts', symbol: { name: 'm', kind: 6, startLine: 0, startChar: 0, endLine: 1, endChar: 0 }, depth: 0 }
  assert.deepEqual(applyStructureViewExtensions([row('base', 1)], method).map(item => item.name), ['base'])
  handle.dispose()
})

test('PsiStructureViewFactory：按 fileType 取第一支认领的构建器；structureViewRows 优先用它', () => {
  const builder = {
    id: 'test.builder',
    createStructureView: ({ symbols }) => symbols.map((symbol, depth) => ({
      name: symbol.name, kind: symbol.kind, depth,
      startLine: symbol.startLine, startChar: symbol.startChar, endLine: symbol.endLine, endChar: symbol.endChar,
    })),
  }
  const rejected = registerIdeViewExtension(PSI_STRUCTURE_VIEW_FACTORY_EP, 'test.fac.py', {
    id: 'test.fac.py', fileType: 'py', getStructureViewBuilder: () => builder,
  })
  const accepted = registerIdeViewExtension(PSI_STRUCTURE_VIEW_FACTORY_EP, 'test.fac.ts', {
    id: 'test.fac.ts', fileType: 'ts', getStructureViewBuilder: () => builder,
  })
  assert.equal(structureViewBuilderFor('a.py', 'python')?.id, 'test.builder')
  assert.equal(structureViewBuilderFor('a.ts')?.id, 'test.builder')
  assert.equal(structureViewBuilderFor('a.md'), null)
  const rows = structureViewRows({ path: 'a.ts', symbols: [
    { name: 'foo', kind: 12, startLine: 0, startChar: 0, endLine: 2, endChar: 1 },
  ] })
  assert.deepEqual(rows.map(item => item.name), ['foo'])
  rejected.dispose(); accepted.dispose()
})

test('EditorNotificationProvider：collectNotificationData 收集；内建双向文本提示已登记（真实消费点 bidiPanelForText）', () => {
  assert.ok(EXTENSIONS.allEntries(EDITOR_NOTIFICATION_PROVIDER_EP).map(entry => entry.id).includes(BIDI_NOTIFICATION_PANEL_ID))
  assert.equal(bidiPanelForText('hello')?.id ?? null, null)
  assert.equal(bidiPanelForText('\u05e9\u05dc\u05d5\u05dd')?.text, '双向文本的显示布局取决于基础方向（视图 › 文本方向）。')

  const handle = registerIdeViewExtension(EDITOR_NOTIFICATION_PROVIDER_EP, 'test.thirdPanel', {
    id: 'test.thirdPanel',
    collectNotificationData: ({ path }) => (path.endsWith('.gen.ts') ? { id: 'test.thirdPanel', text: '生成文件' } : null),
  })
  assert.deepEqual(editorNotificationsFor({ path: 'a.gen.ts', root: 'D:/p', text: '' }).map(item => item.text), ['生成文件'])
  assert.deepEqual(editorNotificationsFor({ path: 'a.ts', root: 'D:/p', text: '' }), [])
  handle.dispose()
})

test('TodoExtraPlaces：accept 任一为真即真；无检查器时为假', () => {
  assert.equal(todoExtraPlaceAccepts('scratch/x.txt', 'D:/p'), false)
  const handle = registerIdeViewExtension(TODO_EXTRA_PLACES_EP, 'test.extra', {
    id: 'test.extra', accept: ({ path }) => path.startsWith('scratch/'),
  })
  assert.equal(todoExtraPlaceAccepts('scratch/x.txt', 'D:/p'), true)
  assert.equal(todoExtraPlaceAccepts('src/x.ts', 'D:/p'), false)
  handle.dispose()
})
