// 外部系统自动导入 API 的判据（`src/externalSystemAutoImport.ts`）。
//
// 上游依据：
//   · `ExternalSystemProjectTracker.kt`（markDirty/markDirtyInternal 的档位矩阵 +
//     scheduleProjectRefresh 不看设置 + register/activate/remove）；
//   · `ExternalSystemSettingsFilesModificationContext.kt`（事件聚合与 ReloadStatus）；
//   · `ExternalSystemProjectAware.kt`（isIgnoredSettingsFileEvent 默认分支、adjustModificationType、
//     isDisabledReload/isDisabledAutoReload）；
//   · `ExternalSystemProjectNotificationAware.kt`（notify/expire/expire(id)/isNotificationVisible）；
//   · `ExternalSystemAutoImportAwareListener.kt`（操作开始/结束）；
//   · `autolink/ExternalSystemUnlinkedProjectAware.kt`（unlinkOtherLinkedProjects）与
//     `ExtensionPointUtil.kt`（runExtensionSafe）；`ExternalSystemUnlinkedProjectSettings`（isEnabledAutoLink，默认 true）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_LINK_DEFAULT, autoReloadDecision, createExternalSystemProjectTracker, createUnlinkedProjectRegistry,
  isIgnoredSettingsFileEventDefault, mergeSettingsFileEvent, normalizeProjectPath, projectIdEquals, projectIdLabel,
  projectIdOf, projectNameOf, runExtensionsSafely,
} from '../src/externalSystemAutoImport.ts'

const ID = projectIdOf('GRADLE', 'D:/ws/demo')
const id2 = projectIdOf('MAVEN', 'D:/ws/other')

test('工程 id：路径归一、项目名取末段、标签是「系统可读名 (项目名)」', () => {
  assert.equal(normalizeProjectPath('D:\\ws\\demo\\'), 'D:/ws/demo')
  assert.deepEqual(projectIdOf('GRADLE', 'D:/ws/demo/'), { systemId: 'GRADLE', externalProjectPath: 'D:/ws/demo' })
  assert.equal(projectNameOf(ID), 'demo')
  assert.equal(projectIdLabel(ID, 'Gradle'), 'Gradle (demo)')
  assert.equal(projectIdLabel(ID), 'GRADLE (demo)')
  assert.equal(projectIdEquals(ID, projectIdOf('GRADLE', 'D:/ws/demo')), true)
  assert.equal(projectIdEquals(ID, id2), false)
})

test('设置文件事件聚合：CREATE+UPDATE→CREATE、UPDATE+DELETE→DELETE、CREATE+DELETE 抵消', () => {
  assert.equal(mergeSettingsFileEvent(null, 'CREATE'), 'CREATE')
  assert.equal(mergeSettingsFileEvent('CREATE', 'UPDATE'), 'CREATE')
  assert.equal(mergeSettingsFileEvent('UPDATE', 'CREATE'), 'CREATE')
  assert.equal(mergeSettingsFileEvent('UPDATE', 'DELETE'), 'DELETE')
  assert.equal(mergeSettingsFileEvent('DELETE', 'UPDATE'), 'DELETE')
  assert.equal(mergeSettingsFileEvent('CREATE', 'DELETE'), null)
  assert.equal(mergeSettingsFileEvent('DELETE', 'CREATE'), 'UPDATE')
  assert.equal(mergeSettingsFileEvent('UPDATE', 'UPDATE'), 'UPDATE')
})

test('档位矩阵：ALL 对内外都重载；SELECTIVE 只对外部；NONE 全出通知；HIDDEN 只记脏', () => {
  assert.equal(autoReloadDecision('ALL', 'EXTERNAL', false), 'reload')
  assert.equal(autoReloadDecision('ALL', 'INTERNAL', true), 'reload')
  assert.equal(autoReloadDecision('SELECTIVE', 'EXTERNAL', false), 'reload')
  assert.equal(autoReloadDecision('SELECTIVE', 'INTERNAL', true), 'notify')
  assert.equal(autoReloadDecision('NONE', 'EXTERNAL', false), 'notify')
  assert.equal(autoReloadDecision('NONE', 'INTERNAL', true), 'notify')
  assert.equal(autoReloadDecision('ALL', 'HIDDEN', true), 'ignore')
  assert.equal(autoReloadDecision('NONE', 'HIDDEN', true), 'ignore')
})

test('默认忽略规则：JUST_STARTED 与「JUST_FINISHED 且 CREATE」', () => {
  assert.equal(isIgnoredSettingsFileEventDefault('x', { event: 'UPDATE', modificationType: 'EXTERNAL', reloadStatus: 'JUST_STARTED' }), true)
  assert.equal(isIgnoredSettingsFileEventDefault('x', { event: 'CREATE', modificationType: 'EXTERNAL', reloadStatus: 'JUST_FINISHED' }), true)
  assert.equal(isIgnoredSettingsFileEventDefault('x', { event: 'UPDATE', modificationType: 'EXTERNAL', reloadStatus: 'JUST_FINISHED' }), false)
  assert.equal(isIgnoredSettingsFileEventDefault('x', { event: 'UPDATE', modificationType: 'EXTERNAL', reloadStatus: 'IDLE' }), false)
})

function makeTracker(type = 'SELECTIVE') {
  const reloads = []
  let changes = 0
  const events = []
  const tracker = createExternalSystemProjectTracker({
    autoReloadType: () => type,
    onNotificationChanged: () => { ++changes },
  })
  tracker.register({
    projectId: ID,
    settingsFiles: () => ['D:/ws/demo/build.gradle'],
    reloadProject: context => reloads.push(context),
    subscribe: listener => events.push(listener),
  })
  tracker.activate(ID)
  return { tracker, reloads, events, changes: () => changes }
}

test('tracker：register/activate 可查；markDirty 在 SELECTIVE 下重载并带上下文', () => {
  const { tracker, reloads } = makeTracker('SELECTIVE')
  assert.deepEqual(tracker.registeredProjects(), [ID])
  assert.deepEqual(tracker.activatedProjects(), [ID])
  tracker.beginReload(ID)
  tracker.finishReload(ID, 'SUCCESS')
  assert.equal(tracker.markDirty(ID), 'reload')
  assert.equal(reloads.length, 1)
  assert.equal(reloads[0].isExplicitReload, false)
  assert.equal(reloads[0].hasUndefinedModifications, true, 'markDirty 的语义就是「有未定义修改」')
  tracker.remove(ID)
  assert.deepEqual(tracker.registeredProjects(), [])
  assert.equal(tracker.markDirty(ID), 'ignore', '摘除后不再调度')
})

test('tracker：NONE 出通知不重载；scheduleProjectRefresh 不看设置强制重载', () => {
  const { tracker, reloads, changes } = makeTracker('NONE')
  assert.equal(tracker.markDirty(ID), 'notify')
  assert.equal(reloads.length, 0)
  assert.equal(tracker.isNotificationVisible(), true)
  assert.equal(tracker.isNotificationVisible('GRADLE'), true)
  assert.equal(tracker.isNotificationVisible('MAVEN'), false)
  const before = changes()
  assert.deepEqual(tracker.scheduleProjectRefresh(), [ID], '强制刷新只刷已脏的')
  assert.equal(reloads.length, 1)
  assert.equal(tracker.isNotificationVisible(), false, '重载排上就撤下通知')
  assert.ok(changes() > before)
  tracker.notificationNotify(ID)
  assert.equal(tracker.isNotificationVisible(), true)
  tracker.notificationExpireFor(ID)
  assert.equal(tracker.isNotificationVisible(), false)
  tracker.notificationNotify(ID)
  tracker.notificationExpire()
  assert.equal(tracker.isNotificationVisible(), false)
})

test('tracker：markDirtyInternal 在 SELECTIVE 下只出通知，在 ALL 下重载', () => {
  const selective = makeTracker('SELECTIVE')
  assert.equal(selective.tracker.markDirtyInternal(ID), 'notify')
  assert.equal(selective.reloads.length, 0)
  const all = makeTracker('ALL')
  assert.equal(all.tracker.markDirtyInternal(ID), 'reload')
  assert.equal(all.reloads.length, 1)
})

test('tracker：settingsFileChanged 聚合事件、跑钩子、按修改类型调度', () => {
  const { tracker, reloads } = makeTracker('SELECTIVE')
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'CREATE', 'EXTERNAL'), 'reload')
  tracker.beginReload(ID)
  // IN_PROGRESS 不在默认忽略里（只忽略 JUST_STARTED 与 JUST_FINISHED+CREATE，见默认函数判据）：
  // 重载期间新到的改动照常处理。
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/settings.gradle', 'CREATE', 'EXTERNAL'), 'reload')
  tracker.finishReload(ID, 'SUCCESS')
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'UPDATE', 'EXTERNAL'), 'reload')
  tracker.beginReload(ID)
  tracker.finishReload(ID, 'SUCCESS')
  const context = tracker.reloadContext(ID)
  assert.deepEqual(context.settingsFilesContext, { updated: [], created: [], deleted: [] }, '重载结束清掉上轮文件账')
  // IDE 内改动在 SELECTIVE 下只出通知。
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'UPDATE', 'INTERNAL'), 'notify')
  // HIDDEN 只记脏，不重载也不通知。
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'UPDATE', 'HIDDEN'), 'ignore')
  assert.equal(tracker.reloadContext(ID).hasUndefinedModifications, true)
  assert.equal(reloads.length, 3, '三次：CREATE（重载中那次也算）、UPDATE、UPDATE')
})

test('tracker：事件账在重载前可见；adjustModificationType 可把 INTERNAL 降成 HIDDEN', () => {
  const reloads = []
  const tracker = createExternalSystemProjectTracker({ autoReloadType: () => 'ALL' })
  tracker.register({
    projectId: ID,
    settingsFiles: () => [],
    reloadProject: context => reloads.push(context),
    adjustModificationType: (_path, type) => type === 'INTERNAL' ? 'HIDDEN' : type,
  })
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'CREATE', 'INTERNAL'), 'ignore', '被调成 HIDDEN 后不自动重载')
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'CREATE', 'EXTERNAL'), 'reload', 'EXTERNAL 不受该钩子影响')
  assert.equal(reloads.length, 1)
})

test('tracker：isDisabledReload / isDisabledAutoReload 钩子挡住调度但保持脏', () => {
  const reloads = []
  const tracker = createExternalSystemProjectTracker({ autoReloadType: () => 'ALL' })
  tracker.register({ projectId: ID, settingsFiles: () => [], reloadProject: ctx => reloads.push(ctx), isDisabledReload: () => true })
  assert.equal(tracker.markDirty(ID), 'ignore')
  assert.equal(reloads.length, 0)
  const disabledAuto = createExternalSystemProjectTracker({ autoReloadType: () => 'ALL' })
  disabledAuto.register({ projectId: ID, settingsFiles: () => [], reloadProject: ctx => reloads.push(ctx), isDisabledAutoReload: () => true })
  assert.equal(disabledAuto.markDirty(ID), 'ignore')
  assert.equal(reloads.length, 0)
  assert.equal(disabledAuto.reloadContext(ID).hasUndefinedModifications, true, '被禁也是脏的，等显式刷新')
})

test('tracker：重载生命周期驱动监听器；长操作期间的改动延到操作结束', () => {
  const { tracker, events, reloads } = makeTracker('SELECTIVE')
  const seen = []
  const listener = {
    onProjectReloadStart: () => seen.push('start'),
    onProjectReloadFinish: status => seen.push(`finish:${status}`),
    onSettingsFilesListChange: () => seen.push('files'),
  }
  // subscribe 是登记项自己的钩子：本仓的登记项把它记进表，tracker 只存监听器列表。
  events.push(listener)
  // 直接走公开入口驱动一次（真实链路由 gradleHost 调 begin/finish）。
  tracker.beginReload(ID)
  tracker.finishReload(ID, 'FAILURE')
  assert.ok(events.includes(listener))
  // 长操作：开始后改动只记脏，结束时按当时类型调度一次。
  tracker.operationStarted()
  assert.equal(tracker.operationInProgress(), true)
  assert.equal(tracker.settingsFileChanged(ID, 'D:/ws/demo/build.gradle', 'UPDATE', 'EXTERNAL'), 'ignore')
  assert.equal(reloads.length, 0)
  tracker.operationCompleted()
  assert.equal(tracker.operationInProgress(), false)
  assert.equal(reloads.length, 1, '操作结束补齐调度')
})

test('autolink：登记表按 systemId 寻址、链接判定、解除其它系统、扩展安全调用', () => {
  const registry = createUnlinkedProjectRegistry()
  const linked = []
  const unlinked = []
  registry.register({
    systemId: 'GRADLE',
    isBuildFile: path => path.endsWith('.gradle'),
    isLinkedProject: (state, path) => state.linkedProjects.includes(path),
    linkAndLoadProject: path => linked.push(path),
    unlinkProject: path => unlinked.push(path),
    subscribe: () => undefined,
  })
  registry.register({
    systemId: 'MAVEN',
    isBuildFile: path => path.endsWith('pom.xml'),
    isLinkedProject: (state, path) => path.endsWith('demo') && state.linkedProjects.includes(path),
    linkAndLoadProject: () => undefined,
    unlinkProject: path => unlinked.push(`maven:${path}`),
    subscribe: () => undefined,
  })
  const aware = registry.get('GRADLE')
  assert.ok(aware)
  assert.equal(aware.isBuildFile('demo/build.gradle'), true)
  assert.equal(aware.isBuildFile('demo/pom.xml'), false)
  assert.equal(aware.isLinkedProject({ linkedProjects: ['D:/ws/demo'] }, 'D:/ws/demo'), true)
  assert.deepEqual(registry.unlinkOtherLinkedProjects(['D:/ws/demo'], 'D:/ws/demo', 'GRADLE'), ['MAVEN'],
    '链接 Gradle 时解除同路径上别的系统的链接')
  assert.deepEqual(unlinked, ['maven:D:/ws/demo'])
  assert.equal(registry.shouldShowUnlinkedNotification('GRADLE', AUTO_LINK_DEFAULT), true)
  assert.equal(registry.shouldShowUnlinkedNotification('GRADLE', false), false, 'isEnabledAutoLink 关掉就不提示')
  assert.equal(registry.shouldShowUnlinkedNotification('UNKNOWN', true), false)
  const results = runExtensionsSafely([1, 2, 3], value => {
    if (value === 2) throw new Error('bad')
    return value * 10
  })
  assert.deepEqual(results, [10, 30], '坏扩展被跳过，好扩展照常')
})
