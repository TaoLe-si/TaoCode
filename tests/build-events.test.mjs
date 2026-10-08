// 构建事件模型与「Gradle CLI 输出 → 事件树」折算的判据（`lp/build` 族）。
//
// 上游依据（逐条核过）：
//   · `platform/lang-impl/src/com/intellij/build/BuildEventDispatcher.java:14`
//     （`Appendable` + `Closeable` + `BuildProgressListener`）；
//   · `.../build/events/impl/StartEventImpl.java`（id/parentId/time/message/hint/description）
//     与 `FinishEventImpl.java`（多一个 `EventResult`）；
//   · `.../build/events/impl/ProgressBuildEventImpl.java:29-52`
//     （`total`/`progress` 缺省 -1、`unit` 缺省空串）；
//   · `.../build/events/impl/SuccessResultImpl.java`（`isUpToDate` + 空 warnings 列表）；
//   · `.../build/progress/BuildRootProgressImpl.java:53-63`（根只发一次 start，message =
//     `build.status.running`）；
//   · `.../build/progress/AbstractBuildProgress.java`（`event()` 是唯一出口 ⇒ 每个节点
//     start/finish 成对，且 finish 带同一个 id）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildProgressStripe, buildProgressTree, countFailures, flattenProgress, gradleBuildEvents, progressPercent, stripeProgressOf,
} from '../src/buildEvents.ts'

test('事件按 id/parentId 折成树，根是第一个 start（BuildRootProgressImpl 只发一次）', () => {
  const events = [
    { id: 'build', parentId: null, kind: 'start', time: 0, message: '构建' },
    { id: 't1', parentId: 'build', kind: 'start', time: 1, message: ':app:compileJava' },
    { id: 't1', parentId: 'build', kind: 'finish', time: 2, message: '', result: { kind: 'success' } },
    { id: 't2', parentId: 'build', kind: 'start', time: 3, message: ':app:test' },
    { id: 't2', parentId: 'build', kind: 'finish', time: 4, message: '', result: { kind: 'failure', message: 'boom' } },
    { id: 'build', parentId: null, kind: 'finish', time: 5, message: '', result: { kind: 'failure' } },
  ]
  const tree = buildProgressTree(events)
  assert.ok(tree, '有 start 就该有树')
  assert.equal(tree.id, 'build')
  assert.equal(tree.children.length, 2)
  assert.equal(tree.children[0].id, 't1')
  assert.equal(tree.children[0].result.kind, 'success')
  assert.equal(tree.children[1].result.message, 'boom')
  assert.equal(tree.finishedAt, 5)
})

test('没有 start 时返回 null，不编空树', () => {
  assert.equal(buildProgressTree([{ id: 'x', parentId: null, kind: 'output', time: 0, message: 'hi' }]), null)
})

test('progress 事件带 total/progress/unit，percent 与上游 setIndeterminate 同口径', () => {
  const tree = buildProgressTree([
    { id: 'b', parentId: null, kind: 'start', time: 0, message: 'b' },
    { id: 'b', parentId: null, kind: 'progress', time: 1, message: '', total: 4, progress: 1, unit: 'tasks' },
  ])
  assert.deepEqual(tree.progress, { total: 4, progress: 1, unit: 'tasks' })
  assert.equal(progressPercent(tree), 25)
  const unknown = buildProgressTree([
    { id: 'b', parentId: null, kind: 'start', time: 0, message: 'b' },
    { id: 'b', parentId: null, kind: 'progress', time: 1, message: '', total: -1, progress: 3, unit: '' },
  ])
  assert.equal(progressPercent(unknown), -1, 'total <= 0 就是不确定进度（不编百分比）')
})

test('输出行挂到当前任务下；任务切换后新的行挂新任务', () => {
  const events = gradleBuildEvents({
    output: [
      '> Task :app:compileJava',
      '注: 某些输入文件使用了未经检查的操作',
      '> Task :app:processResources UP-TO-DATE',
      'BUILD SUCCESSFUL in 3s',
    ].join('\n'),
    startedAt: 100,
    label: 'gradle projects tasks',
    running: false,
    finishedAt: 900,
  })
  const tree = buildProgressTree(events)
  assert.ok(tree)
  assert.equal(tree.children.length, 2)
  assert.deepEqual(tree.children[0].output, ['注: 某些输入文件使用了未经检查的操作'])
  assert.equal(tree.children[1].result.upToDate, true, 'UP-TO-DATE 折成 success + upToDate')
  assert.equal(tree.result.kind, 'success')
  assert.equal(tree.finishedAt, 900)
})

test('FAILED 任务与 BUILD FAILED 收口成失败，失败节点计数对得上', () => {
  const events = gradleBuildEvents({
    output: ['> Task :app:compileJava', 'error: cannot find symbol', '> Task :app:test FAILED', 'FAILURE: Build failed with an exception.'].join('\n'),
    startedAt: 0,
    label: 'build',
    running: false,
  })
  const tree = buildProgressTree(events)
  // `countFailures` 数的是整棵子树（含自身）：根也收了 failure ⇒ 2（根 + :app:test）。
  assert.equal(countFailures(tree), 2)
  assert.equal(tree.children.filter(child => child.result?.kind === 'failure').length, 1, '只有 :app:test 是失败任务')
  assert.equal(tree.result.kind, 'failure')
  const flat = flattenProgress(tree)
  assert.equal(flat[0].depth, 0)
  assert.equal(flat[1].depth, 1)
})

test('还在跑时根节点不发 finish（进度树没有收尾结论）', () => {
  const events = gradleBuildEvents({ output: '> Task :app:compileJava\n', startedAt: 0, label: 'build', running: true })
  const tree = buildProgressTree(events)
  assert.equal(tree.finishedAt, null)
  assert.equal(tree.result, null)
})

test('空输出只发一条根 start，不编任务', () => {
  const events = gradleBuildEvents({ output: '', startedAt: 0, label: 'build', running: false })
  const tree = buildProgressTree(events)
  assert.equal(tree.children.length, 0)
  assert.equal(tree.result.kind, 'success')
})

test('宿主给了 error 就按失败收口（即使输出里没有 FAILURE 行）', () => {
  const events = gradleBuildEvents({ output: '> Task :app:compileJava\n', startedAt: 0, label: 'build', running: false, error: 'Gradle 退出码 1' })
  const tree = buildProgressTree(events)
  assert.equal(tree.result.kind, 'failure')
  assert.equal(tree.result.message, 'Gradle 退出码 1')
})

test('Configure project 与告警行是 message，不当任务', () => {
  const events = gradleBuildEvents({
    output: ['> Configure project :', 'Deprecated Gradle features were used in this build'].join('\n'),
    startedAt: 0, label: 'sync', running: false,
  })
  const tree = buildProgressTree(events)
  assert.equal(tree.children.length, 1)
  assert.match(tree.children[0].message, /Configure project/)
  assert.ok(events.some(event => event.kind === 'message' && /Deprecated/.test(event.message)))
})

test('ANSI 转义不参与任务边界识别', () => {
  const events = gradleBuildEvents({
    output: '\u001B[0m> Task :app:compileJava\u001B[0m\n', startedAt: 0, label: 'build', running: false,
  })
  const tree = buildProgressTree(events)
  assert.equal(tree.children.length, 1)
  assert.equal(tree.children[0].message, ':app:compileJava')
})

test('接线：GradlePanel 从 gradleSync.output 折出进度树并画出来', () => {
  const vue = readFileSync(new URL('../src/components/GradlePanel.vue', import.meta.url), 'utf8')
  assert.match(vue, /from '\.\.\/buildEvents\.ts'/, '面板要引 buildEvents')
  assert.match(vue, /gradleBuildEvents\(/, '面板要用输出折事件')
  assert.match(vue, /flattenProgress\(/, '面板要按深度画树')
  assert.match(vue, /gradle-build-tree/, '模板里要有进度树的容器')
})

// ---------------------------------------------------------------------------
// 进度条（`build/console/BuildProgressStripe.java:37-56` 的 `updateProgress(total, progress)`）
// 2026-10-08 lane lp-roots 补：面板头部原来只有节点自己的 progress 事件（CLI 不给数字 ⇒ 一直空着），
// 这条把"任务完成度"这条真实数据接上，判定表逐条照上游。
// ---------------------------------------------------------------------------

test('进度条判定表：progress 为 0 是不确定态而不是 0%，total == progress 收工（:38-55）', () => {
  assert.deepEqual(buildProgressStripe(4, 1), { loading: true, determinate: true, percent: 25 })
  assert.deepEqual(buildProgressStripe(3, 1), { loading: true, determinate: true, percent: 33 }, '整数截断（:49 的 Math.toIntExact）')
  assert.deepEqual(buildProgressStripe(3, 0), { loading: true, determinate: false, percent: 0 }, 'progress 为 0 ⇒ setIndeterminate(true)（:53-55）')
  assert.deepEqual(buildProgressStripe(-1, 3), { loading: true, determinate: false, percent: 0 }, 'total < 0 ⇒ 不确定')
  assert.deepEqual(buildProgressStripe(0, 0), { loading: false, determinate: true, percent: 100 }, '空活儿也走 total == progress 那一支（不做"顺手修正"）')
  assert.deepEqual(buildProgressStripe(5, 5), { loading: false, determinate: true, percent: 100 }, '跑完收工、值置 100（:43-45 + :60-64）')
})

test('无后缀任务在下一条边界处收成功；收口有证据（BUILD SUCCESSFUL 或 exit 0）才收最后一条', () => {
  // 边界反证：`> Task :a` 之后出现 `> Task :b` ⇒ a 执行完了（Gradle 只在失败/跳过时给后缀）。
  // b 之后什么都没发生且没有退出码 ⇒ b 留白。
  const boundary = buildProgressTree(gradleBuildEvents({
    output: ['> Task :a', '> Task :b'].join('\n'), startedAt: 0, label: 'build', running: false,
  }))
  assert.deepEqual(boundary.children.map(child => child.result?.kind ?? null), ['success', null], '只有边界这一条证据')
  // 退出码 0 是"整次构建成功"的硬信号（本仓宿主给的那个数）⇒ 最后一条也收成功。
  const cleanExit = buildProgressTree(gradleBuildEvents({
    output: ['> Task :a', '> Task :b'].join('\n'), startedAt: 0, label: 'build', running: false, exitCode: 0,
  }))
  assert.deepEqual(cleanExit.children.map(child => child.result?.kind ?? null), ['success', 'success'])
  // 被取消时退出码不算证据（进程是被杀掉的）。
  const cancelled = buildProgressTree(gradleBuildEvents({
    output: ['> Task :a'].join('\n'), startedAt: 0, label: 'build', running: false, exitCode: 0, cancelled: true,
  }))
  assert.equal(cancelled.children[0].result, null, '取消不补结论')
  // 成功收口：只有一条无后缀任务时，`BUILD SUCCESSFUL` 就是它的结论。
  const successful = buildProgressTree(gradleBuildEvents({
    output: ['> Task :a', 'BUILD SUCCESSFUL in 3s'].join('\n'), startedAt: 0, label: 'build', running: false,
  }))
  assert.equal(successful.children[0].result.kind, 'success')
  // 失败收口：同样只有一条无后缀任务，但这里没有任何"它成功了"的证据 ⇒ 留白。
  const failed = buildProgressTree(gradleBuildEvents({
    output: ['> Task :a', 'FAILURE: Build failed with an exception.'].join('\n'), startedAt: 0, label: 'build', running: false,
  }))
  assert.equal(failed.children[0].result, null, '不把"没结论"当成成功')
  assert.equal(failed.result.kind, 'failure')
  // 已有结论的任务不被边界收口改写（FAILED 不能变成成功）。
  const failedTask = buildProgressTree(gradleBuildEvents({
    output: ['> Task :a FAILED', '> Task :b'].join('\n'), startedAt: 0, label: 'build', running: false,
  }))
  assert.equal(failedTask.children[0].result.kind, 'failure')
})

test('stripeProgressOf：total = 任务节点数，progress = 已有结论的节点数（本仓对 (total, progress) 的取数）', () => {
  const running = gradleBuildEvents({
    output: ['> Configure project :', '> Task :app:compileJava', '> Task :app:processResources'].join('\n'),
    startedAt: 0, label: 'gradle projects tasks', running: true,
  })
  const runningTree = buildProgressTree(running)
  // 三条深度 1 的节点：Configure 立刻有结论，compileJava 由下一条任务行反证收口，
  // processResources 还在跑（`running: true` 不发总结果）⇒ 3 条里 2 条已有结论。
  const runningCounts = stripeProgressOf(runningTree)
  assert.deepEqual(runningCounts, { total: 3, progress: 2 })
  assert.deepEqual(buildProgressStripe(runningCounts.total, runningCounts.progress), { loading: true, determinate: true, percent: 66 })

  const done = buildProgressTree(gradleBuildEvents({
    output: ['> Task :app:compileJava', '> Task :app:test FAILED'].join('\n'),
    startedAt: 0, label: 'build', running: false,
  }))
  const doneCounts = stripeProgressOf(done)
  // 结论要么来自任务行自己的后缀，要么来自下一条边界行（compileJava 那一档）。
  assert.deepEqual(doneCounts, { total: 2, progress: 2 })
  assert.deepEqual(buildProgressStripe(doneCounts.total, doneCounts.progress), { loading: false, determinate: true, percent: 100 })

  // 折不出任务（空输出）⇒ total === progress === 0，按判定表是「收工 + 满格」，但那时模板整个不渲染。
  const empty = stripeProgressOf(buildProgressTree(gradleBuildEvents({ output: '', startedAt: 0, label: 'sync', running: false })))
  assert.deepEqual(empty, { total: 0, progress: 0 })
})

test('接线：GradlePanel 用判定表画进度条（import + 计算 + 模板里的 progressbar）', () => {
  const vue = readFileSync(new URL('../src/components/GradlePanel.vue', import.meta.url), 'utf8')
  assert.match(vue, /buildProgressStripe,/, '面板要引判定表')
  assert.match(vue, /stripeProgressOf\(/, '面板要从进度树现算 (total, progress)')
  assert.match(vue, /class="gradle-build-stripe" role="progressbar"/, '模板里要有进度条本体')
  assert.match(vue, /\.gradle-build-stripe\b/, '进度条要有样式落点')
})