// 左右两条 dock **各自独立**的判据 —— 用户报的「打开右侧边栏，左侧边栏自动消失」回归护栏。
//
// 上游依据（`createToolWindowDockSide` 的文件头有出处）：IDEA 每条 `ToolWindowAnchor` 一份 dock 状态，
// 两条 dock 可同时可见。本仓原先只有一个 `activeAnchor`（当前激活视图的锚点），左右互斥 ⇒ 本 bug。
// 本文件一律纯 JavaScript（规约 §4.2），值 import 一律带全扩展名（规约 §4.1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

import { createToolWindowDockSide } from '../src/toolWindowDockSide.ts'
import { DEFAULT_TOOL_ANCHORS, toolWindowOrder } from '../src/toolWindowMeta.ts'

const FIRST_RIGHT = toolWindowOrder.find(id => DEFAULT_TOOL_ANCHORS[id] === 'right')

/** 夹具：真锚点表（`DEFAULT_TOOL_ANCHORS`）+ 左 dock 初态（与宿主 App.vue 的 explorer/leftView 同形）。 */
function host() {
  const leftView = ref('files')
  const explorer = ref(true)
  const made = createToolWindowDockSide({ toolAnchors: { ...DEFAULT_TOOL_ANCHORS }, leftView, explorer })
  return { ...made, leftView, explorer }
}

test('右锚窗口的初值取注册表里第一个右锚窗口，且默认不可见', () => {
  const h = host()
  assert.equal(DEFAULT_TOOL_ANCHORS[FIRST_RIGHT], 'right', '夹具前提：确实有一个右锚窗口')
  assert.equal(h.rightView.value, FIRST_RIGHT, '右 dock 的初值 = 注册表里第一个右锚窗口')
  assert.equal(h.rightVisible.value, false, '右 dock 初值不可见')
})

test('打开右锚窗口不动 explorer / leftView（本 bug 的回归护栏）', () => {
  const h = host()
  assert.equal(DEFAULT_TOOL_ANCHORS.agent, 'right', '夹具前提：agent 是右锚')
  assert.equal(h.routeToDock('agent'), 'right', '右锚派发到右 dock')
  assert.equal(h.rightVisible.value, true, '右 dock 打开')
  assert.equal(h.rightView.value, 'agent', '右 dock 装的是 agent')
  assert.equal(h.explorer.value, true, '左 dock 可见性一字不动')
  assert.equal(h.leftView.value, 'files', '左 dock 装的内容一字不动')
})

test('打开左锚窗口不动 rightVisible / rightView', () => {
  const h = host()
  assert.equal(h.routeToDock('git'), 'left', '左锚派发到左 dock')
  assert.equal(h.explorer.value, true, '左 dock 打开')
  assert.equal(h.leftView.value, 'git', '左 dock 装的是 git')
  assert.equal(h.rightVisible.value, false, '右 dock 可见性一字不动')
  assert.equal(h.rightView.value, FIRST_RIGHT, '右 dock 装的内容一字不动')
})

test('两条 dock 可同时可见（左右各自一份状态）', () => {
  const h = host()
  h.routeToDock('files')
  h.routeToDock('agent')
  assert.equal(h.showLeftDock.value, true, '左 dock 在')
  assert.equal(h.showRightDock.value, true, '右 dock 也在')
})

test('同一窗口再次 routeToDock 是「带到前面」而不是关掉（上游 activate 语义）', () => {
  // toggle 那半在 `createToolWindowActivation`（stripe 的第二次点击）；`routeToDock` 只负责
  // 「按锚点送进哪条 dock」，重复调用是幂等的带到前面（上游 `activateToolWindow` 不 toggle）。
  const h = host()
  h.routeToDock('agent')
  h.routeToDock('agent')
  assert.equal(h.rightVisible.value, true, '重复调用不收起右 dock')
  assert.equal(h.rightView.value, 'agent', '仍然是它')
  h.routeToDock('git')
  h.routeToDock('git')
  assert.equal(h.explorer.value, true, '重复调用不收起左 dock')
  assert.equal(h.leftView.value, 'git', '仍然是它')
})

test('关掉右 dock 之后左 dock 状态不变', () => {
  const h = host()
  h.routeToDock('git')
  h.routeToDock('agent')
  h.rightVisible.value = false
  assert.equal(h.showRightDock.value, false, '右 dock 收起')
  assert.equal(h.explorer.value, true, '左 dock 可见性不变')
  assert.equal(h.leftView.value, 'git', '左 dock 内容不变')
  assert.equal(h.showLeftDock.value, true, '左 dock 仍然在')
})

test('bottom 锚点原样交给调用方，本模块不写任何状态', () => {
  const h = host()
  assert.equal(DEFAULT_TOOL_ANCHORS.vcslog, 'bottom', '夹具前提：vcslog 是底部锚')
  assert.equal(h.routeToDock('vcslog'), 'bottom', '底部锚交回宿主走底部那条路')
  assert.equal(h.explorer.value, true, '不碰左 dock')
  assert.equal(h.leftView.value, 'files', '不碰左 dock 内容')
  assert.equal(h.rightVisible.value, false, '不碰右 dock')
})