// 判据 · 提交域的三条 EP（`src/commitExtensionPoints.ts` + `src/commitMessageInspection.ts` 的接线）——
// 上游 `com.intellij.vcs.commitMessageInspection` /
// `com.intellij.vcs.commitSuccessNotificationActionProvider` / `com.intellij.vcs.pathsToRefreshProvider`
// 的同名方法面。
//
// 钉五件事：
//   ① 三条 EP id 逐字等于上游 qualifiedName，且已声明；
//   ② 三条内建检查作为 bundled 贡献挂在检查 EP 上（id = 上游实现类名），聚合消费点看得见；
//   ③ 提交信息检查的**真实消费侧**：`inspectCommitMessage` 走 EP，第三方贡献能加问题；
//   ④ 通知动作 / 刷新路径两条的聚合问法与上游逐条同形（逐条取动作、按 VCS 名过滤 + flatMap）；
//   ⑤ 没有第三方贡献时行为与从前一字不差。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  COMMIT_MESSAGE_INSPECTION_EP, COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP,
  VCS_PATHS_TO_REFRESH_PROVIDER_EP, collectPathsToRefreshForVcs, commitMessageInspections,
  commitSuccessActions, commitSuccessNotificationActionProviders, declareCommitExtensionPoints,
  registerCommitMessageInspection, registerCommitSuccessNotificationActionProvider,
  registerVcsPathsToRefreshProvider, runCommitMessageInspections,
  unregisterCommitMessageInspection, unregisterCommitSuccessNotificationActionProvider,
  unregisterVcsPathsToRefreshProvider, vcsPathsToRefreshProviders,
} from '../src/commitExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUILTIN_COMMIT_MESSAGE_INSPECTION_IDS, DEFAULT_INSPECTION_SETTINGS, inspectCommitMessage,
} from '../src/commitMessageInspection.ts'

const root = new URL('../', import.meta.url)
const read = rel => readFileSync(new URL(rel, root), 'utf8')

test('三条 EP id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(COMMIT_MESSAGE_INSPECTION_EP, 'com.intellij.vcs.commitMessageInspection')
  assert.equal(COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP, 'com.intellij.vcs.commitSuccessNotificationActionProvider')
  assert.equal(VCS_PATHS_TO_REFRESH_PROVIDER_EP, 'com.intellij.vcs.pathsToRefreshProvider')
  for (const id of [COMMIT_MESSAGE_INSPECTION_EP, COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP, VCS_PATHS_TO_REFRESH_PROVIDER_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  declareCommitExtensionPoints()
  declareCommitExtensionPoints()
})

test('三条内建检查作为 bundled 贡献挂在检查 EP 上，id 是上游实现类名', () => {
  const ids = commitMessageInspections().map(entry => entry.id)
  for (const id of Object.values(BUILTIN_COMMIT_MESSAGE_INSPECTION_IDS)) {
    assert.ok(ids.includes(id), `EP 上应有内建检查 ${id}`)
  }
  // 顺序照上游 `VcsExtensions.xml:147-149`：separation → subject → body。
  assert.deepEqual(ids, [
    BUILTIN_COMMIT_MESSAGE_INSPECTION_IDS.subjectBodySeparation,
    BUILTIN_COMMIT_MESSAGE_INSPECTION_IDS.subjectLimit,
    BUILTIN_COMMIT_MESSAGE_INSPECTION_IDS.bodyLimit,
  ])
})

test('检查的聚合消费点：第三方贡献真的能加一条问题', () => {
  const before = inspectCommitMessage('short subject\n\nbody', DEFAULT_INSPECTION_SETTINGS)
  assert.deepEqual(before, [], '内建三条对干净信息不报问题')

  const handle = registerCommitMessageInspection({
    id: 'test.no-ticket',
    run: lines => (lines[0]?.includes('TICKET') ? [] : [{
      kind: 'subject', line: 0, start: 0, end: 5, message: '主题必须带 TICKET', fixes: [],
    }]),
  })
  const after = inspectCommitMessage('short subject\n\nbody', DEFAULT_INSPECTION_SETTINGS)
  assert.equal(after.length, 1)
  assert.equal(after[0].message, '主题必须带 TICKET')
  unregisterCommitMessageInspection('test.no-ticket')
  assert.deepEqual(inspectCommitMessage('short subject\n\nbody', DEFAULT_INSPECTION_SETTINGS), [])
  void handle
})

test('enabled 为假的内建检查不参与（设置一关就不报）', () => {
  const long = 'x'.repeat(80)
  assert.equal(inspectCommitMessage(long, DEFAULT_INSPECTION_SETTINGS).length, 1)
  const off = { ...DEFAULT_INSPECTION_SETTINGS, subjectLimit: false }
  assert.deepEqual(inspectCommitMessage(long, off), [])
  // 直接问聚合函数也一样（不走 EP 上那三条 enabled）。
  assert.deepEqual(runCommitMessageInspections([long], off), [])
})

test('提交成功通知动作：逐条取动作、首尾相接；无 provider 时为空', () => {
  const notification = { title: '提交完成', rows: ['1 个文件'] }
  assert.deepEqual(commitSuccessActions(notification), [])
  const h1 = registerCommitSuccessNotificationActionProvider({
    id: 'test.push', getActions: () => [{ title: '推送' }],
  })
  const h2 = registerCommitSuccessNotificationActionProvider({
    id: 'test.mr', getActions: () => [{ title: '创建合并请求' }, { title: '在浏览器中打开' }],
  })
  assert.equal(commitSuccessNotificationActionProviders().length, 2)
  assert.deepEqual(commitSuccessActions(notification).map(action => action.title),
    ['推送', '创建合并请求', '在浏览器中打开'])
  unregisterCommitSuccessNotificationActionProvider('test.push')
  unregisterCommitSuccessNotificationActionProvider('test.mr')
  assert.deepEqual(commitSuccessActions(notification), [])
  void h1
  void h2
})

test('刷新路径：只问 VCS 名相符的那些，逐个 flatMap（上游 collectPathsToRefreshForVcs）', () => {
  assert.deepEqual(collectPathsToRefreshForVcs('git', '/w'), [])
  const h1 = registerVcsPathsToRefreshProvider({
    id: 'test.git', getVcsName: () => 'git', collectPathsToRefresh: root => [`${root}/.git/index`],
  }, '/w')
  const h2 = registerVcsPathsToRefreshProvider({
    id: 'test.svn', getVcsName: () => 'svn', collectPathsToRefresh: root => [`${root}/.svn`],
  }, '/w')
  const h3 = registerVcsPathsToRefreshProvider({
    id: 'test.git2', getVcsName: () => 'git', collectPathsToRefresh: root => [`${root}/.git/refs`],
  }, '/w')
  assert.equal(vcsPathsToRefreshProviders('/w').length, 3)
  // 项目级 EP：挂到别的根上的 provider 在本次作用域里看不见（上游 `getExtensions(project)` 同口径）。
  assert.equal(vcsPathsToRefreshProviders('/other').length, 0)
  assert.deepEqual(collectPathsToRefreshForVcs('git', '/w'), ['/w/.git/index', '/w/.git/refs'])
  assert.deepEqual(collectPathsToRefreshForVcs('svn', '/w'), ['/w/.svn'])
  assert.deepEqual(collectPathsToRefreshForVcs('hg', '/w'), [])
  unregisterVcsPathsToRefreshProvider('test.git')
  unregisterVcsPathsToRefreshProvider('test.svn')
  unregisterVcsPathsToRefreshProvider('test.git2')
  assert.deepEqual(collectPathsToRefreshForVcs('git', '/w'), [])
  void h1
  void h2
  void h3
})

test('模块被真实消费（不是只被自己调）', () => {
  const cmi = read('src/commitMessageInspection.ts')
  assert.match(cmi, /from '\.\/commitExtensionPoints\.ts'/, 'commitMessageInspection 要 import EP 模块')
  assert.match(cmi, /runCommitMessageInspections\(/, 'inspectCommitMessage 要走聚合消费点')
  assert.match(cmi, /registerCommitMessageInspection\(/, '三条内建检查要注册成贡献')
  const mod = read('src/commitExtensionPoints.ts')
  for (const coord of ['VcsExtensionPoints.xml:241', 'VcsExtensionPoints.xml:61', 'VcsExtensionPoints.xml:103']) {
    assert.ok(mod.includes(coord), `模块头应记下上游坐标 ${coord}`)
  }
  assert.match(mod, /VcsExtensions\.xml:147-149/, '内建三条的注册出处要写进模块头')
})
