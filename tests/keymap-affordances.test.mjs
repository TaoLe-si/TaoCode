// Alt+F1 / Alt+HOME 这一组：键位绑的必须是**上游那个动作**，提示语说的必须是**代码真做的事**。
//
// 起因（2026-09-28）：空状态提示写着「导航栏 Alt+Home」，但 `keymap.ts` 里**没有任何** Alt+Home 分支
// —— 按下去没反应，等于给用户一个假键位；状态栏那一格又写着「在资源管理器中定位」，
// 而它点的 `selectInTree()` 是在**项目文件树**里定位（IDEA 的 Project Files 目标），不是系统资源管理器。
// 这类"文案与实现不符"不在编译期、也不在视觉测试里暴露，只能把两件事钉在一起机检。
//
// IDEA 侧依据（两条都读过原文）：`platform/platform-resources/src/keymaps/$default.xml:14-15`
// 的 `ShowNavBar` = alt HOME，与同文件 `:968-969` 的 `SelectIn` = alt F1。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const keymap = read('src/keymap.ts')
const app = read('src/App.vue')
const sideViews = read('src/editorSideViews.ts')

test('Alt+HOME 绑到 ShowNavBar，且它真的把焦点交给导航条', () => {
  assert.match(keymap, /event\.key === 'Home' && event\.altKey && !event\.ctrlKey && !event\.shiftKey[\s\S]{0,160}showNavBar\(\)/,
    'Alt+HOME 没有绑到 ShowNavBar（IDEA $default.xml:14-15 就是这一对）')
  // ShowNavBar 的落点：活动编辑器的那一条面包屑，焦点给**最内层目录段**。
  assert.match(sideViews, /\.breadcrumbs\[data-navbar="active"\]/, '找不到活动编辑器的导航条')
  assert.match(sideViews, /segments\[segments\.length - 1\][\s\S]{0,120}target\.focus\(\)/,
    'ShowNavBar 必须聚焦最内层的目录段，而不是把函数写成空壳')
  assert.match(sideViews, /notify\('当前编辑器没有可用的导航条/, '没有导航条时必须说出来，不能静默吞掉按键')
  // 提示语与实现一致：那一条必须点 showNavBar。
  assert.match(app, /@click="showNavBar">导航栏</, '「导航栏」提示语又指回了一个不是导航栏的动作')
  assert.match(app, /:data-navbar="groupActive\(pane\)\?\.path === activePath \? 'active' : undefined"/,
    '多格编辑器下必须先标出**哪一条**是活动编辑器的导航条')
})

test('Alt+F1 打开的是 Select In 目标列表，不再是直达某一项', () => {
  assert.match(keymap, /event\.key === 'F1' && event\.altKey[\s\S]{0,160}openSelectIn\(\)/,
    'Alt+F1 = Select In：上游这一步是**弹窗**（SelectInAction.java:44-48 → :62-72 showInBestPositionFor），不是直达第一项')
  assert.match(sideViews, /function openSelectIn\(\)[\s\S]{0,400}selectInOpen\.value = true/, 'openSelectIn 必须真的把弹窗打开')
  assert.match(app, /<Teleport v-if="selectInOpen" to="body"><SelectInPopup :rows="selectInRows"/,
    '弹窗要 Teleport 到 body 并吃 selectInRows —— 挂在编辑器容器里会被 overflow 裁掉')
  // 状态栏那一格现在真的开列表：文案不能再谎称"在项目文件中定位"（那只是列表里的第 1 项）。
  assert.match(app, /:title="`在…中选择 \$\{active\.path\} \(Alt\+F1\)`" @click="openSelectIn"/,
    '状态栏的 Alt+F1 提示必须与它点下去发生的动作一致')
  assert.doesNotMatch(app, /在项目文件中定位 \$\{active\.path\}/, '旧文案还在谎称直达"项目文件"')
})
