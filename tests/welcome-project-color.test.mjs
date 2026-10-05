// 欢迎页的**项目颜色**（`ChangeProjectColorActionGroup` / `ChangeProjectColorAction`）判据。
//
// 上游依据：
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/projectActions/ChangeProjectColorActionGroup.kt:33-44`
//     —— 九个具名颜色 + 一条分隔线 + 自定义取色器，**以及那九个 index 的次序**；
//   · 同文件 `:79-85` —— 当前这个颜色在菜单里标成「名字（当前）」；
//   · 同文件 `:87-93` —— actionPerformed：清缓存 → 写新 index → 重画；
//   · `platform/platform-impl/src/com/intellij/ide/RecentProjectIconHelper.kt:468-487`
//     —— `ProjectIconPalette.gradients` 的九对渐变（index 就是它的槽位）；
//   · 同文件 `:490-492` —— 没选过时 `gradient(path)` 按路径生成；
//   · `platform/platform-impl/src/com/intellij/ide/ProjectWindowCustomizerService.kt:323-342`
//     —— 有就用存的 index，没有就 `getOrGenerateAssociatedColorIndex` 生成一个。
// 文案：`platform/platform-api/resources/messages/IdeBundle.properties:3219-3229`（中文包取自
// `plugins/localization-zh/lib/localization-zh.jar` 的 `messages/IdeBundle.properties`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROJECT_COLOR_AUTO_LABEL, PROJECT_COLOR_CHOICES, PROJECT_COLOR_CURRENT_LABEL, PROJECT_COLOR_MENU_LABEL,
  PROJECT_ICON_GRADIENTS, avatarTone, clearProjectColorOverride, hasProjectColorOverride, projectColorLabel,
  projectColorOverride, projectGradient, setProjectColorOverride,
} from '../src/welcomeProjectColor.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** localStorage 的内存实现（node 里没有 window）。 */
function memoryStore() {
  const map = new Map()
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

// --- 调色板：九个槽位 + 上游那个次序 ---------------------------------------------------------

test('九对渐变，逐条对上 ProjectIconPalette.gradients（RecentProjectIconHelper.kt:469-486）', () => {
  assert.equal(PROJECT_ICON_GRADIENTS.length, 9)
  assert.deepEqual(PROJECT_ICON_GRADIENTS.map(pair => [...pair]), [
    ['#DB3D3C', '#FF8E42'], // 0 Color1.Avatar
    ['#F57236', '#FCBA3F'], // 1 Color2.Avatar
    ['#2BC8BB', '#36EBAE'], // 2 Color3.Avatar
    ['#359AF2', '#57DBFF'], // 3 Color4.Avatar
    ['#8379FB', '#85A8FF'], // 4 Color5.Avatar
    ['#7E54B5', '#9486FF'], // 5 Color6.Avatar
    ['#D63CC8', '#F582B9'], // 6 Color7.Avatar
    ['#954294', '#C87DFF'], // 7 Color8.Avatar
    ['#E75371', '#FF78B5'], // 8 Color9.Avatar
  ])
})

test('九个可选颜色的**次序**照上游（ChangeProjectColorActionGroup.kt:33-41）', () => {
  // 关键细节：这个次序不是 0..8 —— 是 0,1,2,8,7,3,4,6,5。排错了用户看到的就是另一组颜色。
  assert.deepEqual(PROJECT_COLOR_CHOICES.map(choice => choice.index), [0, 1, 2, 8, 7, 3, 4, 6, 5])
  assert.deepEqual(PROJECT_COLOR_CHOICES.map(choice => choice.name),
    ['琥珀色', 'Rust', '橄榄色', '草绿色', '海蓝色', '天蓝色', '钴蓝色', '紫色', '紫红色'])
})

test('九个 index 与九个槽位一一对上，没有重复也没有漏', () => {
  const indices = PROJECT_COLOR_CHOICES.map(choice => choice.index)
  assert.equal(new Set(indices).size, PROJECT_ICON_GRADIENTS.length)
  assert.deepEqual([...indices].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8])
})

test('Rust 那条上游没翻，保留原样（中文包 messages/IdeBundle.properties 里它仍是 Rust）', () => {
  assert.equal(PROJECT_COLOR_CHOICES[1].name, 'Rust')
})

// --- 当前色的标注 ---------------------------------------------------------------------------

test('当前那个颜色标成「名字（当前）」（:79-85 的 transformToCurrentIfNeeded）', () => {
  const sky = PROJECT_COLOR_CHOICES.find(choice => choice.name === '天蓝色')
  assert.equal(projectColorLabel(sky, sky.index), `天蓝色${PROJECT_COLOR_CURRENT_LABEL}`)
  // 其余只显示名字
  assert.equal(projectColorLabel(sky, 4), '天蓝色')
  // 没存过颜色时（currentIndex undefined）没有"当前"那一个
  assert.equal(projectColorLabel(sky, undefined), '天蓝色')
})

// --- 选 / 不选 -------------------------------------------------------------------------------

test('没选过时按路径自动生成（ProjectWindowCustomizerService.kt:323 的 else 那一支）', () => {
  const store = memoryStore()
  assert.equal(projectColorOverride('D:/code/app', store), undefined)
  assert.equal(hasProjectColorOverride('D:/code/app', store), false)
  assert.deepEqual(projectGradient('D:/code/app', store), PROJECT_ICON_GRADIENTS[avatarTone('D:/code/app')])
})

test('选过之后用选的，并逐项目分开（setAssociatedColorsIndex 是按项目路径存的）', () => {
  const store = memoryStore()
  setProjectColorOverride('D:/code/app', 4, store)
  setProjectColorOverride('D:/code/lib', 7, store)
  assert.equal(projectColorOverride('D:/code/app', store), 4)
  assert.equal(projectColorOverride('D:/code/lib', store), 7)
  assert.deepEqual(projectGradient('D:/code/app', store), PROJECT_ICON_GRADIENTS[4])
  assert.deepEqual(projectGradient('D:/code/lib', store), PROJECT_ICON_GRADIENTS[7])
  assert.equal(hasProjectColorOverride('D:/code/app', store), true)
  // 没碰过的那个仍然走自动生成
  assert.equal(projectColorOverride('D:/code/other', store), undefined)
})

test('恢复自动生成：删键而不是写 -1（clearToolbarColorsAndInMemoryCache 那一支）', () => {
  const store = memoryStore()
  setProjectColorOverride('D:/code/app', 4, store)
  clearProjectColorOverride('D:/code/app', store)
  assert.equal(projectColorOverride('D:/code/app', store), undefined)
  assert.equal(store.getItem('taocode.projectColor'), '{}')
  assert.equal(hasProjectColorOverride('D:/code/app', store), false)
})

test('越界的 index 写不进去（别让它去索引渐变表）', () => {
  const store = memoryStore()
  for (const bad of [9, -1, 1.5, Number.NaN]) {
    setProjectColorOverride('D:/code/app', bad, store)
    assert.equal(projectColorOverride('D:/code/app', store), undefined)
  }
})

test('存坏了一半：只认 0..8 的整数槽位，其余丢掉', () => {
  const store = memoryStore()
  store.setItem('taocode.projectColor', JSON.stringify({
    'D:/a': 3, 'D:/b': 99, 'D:/c': '5', 'D:/d': -2, 'D:/e': 6,
  }))
  assert.equal(projectColorOverride('D:/a', store), 3)
  assert.equal(projectColorOverride('D:/b', store), undefined)
  assert.equal(projectColorOverride('D:/c', store), undefined)
  assert.equal(projectColorOverride('D:/d', store), undefined)
  assert.equal(projectColorOverride('D:/e', store), 6)
})

test('存的不是对象就当没存过（不抛错）', () => {
  const store = memoryStore()
  for (const raw of ['[1,2]', '"x"', 'null']) {
    store.setItem('taocode.projectColor', raw)
    assert.equal(projectColorOverride('D:/a', store), undefined)
  }
})

test('空路径不落盘', () => {
  const store = memoryStore()
  setProjectColorOverride('', 3, store)
  assert.equal(projectColorOverride('', store), undefined)
  assert.equal(store.getItem('taocode.projectColor'), null)
})

// --- 自动生成那一支：Java String 的 hashCode ----------------------------------------------------

test('自动生成走 Java String 的 31 乘法哈希（RecentProjectIconHelper.kt:289-326）', () => {
  // "abc".hashCode() = 96354 → 96354 % 9 = 0（槽位 0 = 琥珀色那一对）
  assert.equal(avatarTone('abc'), 0)
  // "".hashCode() = 0 → 槽位 0
  assert.equal(avatarTone(''), 0)
  for (const path of ['D:/code/app', 'D:/code/lib', 'C:\\Users\\x\\proj', '欢迎']) {
    const tone = avatarTone(path)
    assert.ok(Number.isInteger(tone) && tone >= 0 && tone < PROJECT_ICON_GRADIENTS.length, `${path} → ${tone}`)
  }
})

// --- 接线 -------------------------------------------------------------------------------------

test('接线：欢迎页用的是本模块，头像渐变跟着「选过的 / 自动生成的」切换', () => {
  const page = read('src/components/WelcomePage.vue')
  assert.match(page, /from '\.\.\/welcomeProjectColor'/)
  // 渐变不再从组件内的本地调色板取（那份已经搬走）
  assert.doesNotMatch(page, /RECENT_PROJECT_GRADIENTS/)
  assert.doesNotMatch(page, /function avatarGradient/)
  // 头像绑定走带版本号的那两个包装，于是选了颜色会重算
  assert.match(page, /gradientOf\(project\.path\)/)
  assert.match(page, /toneOf\(project\.path\)/)
})

test('接线：行菜单那一项接上了真的开关（不是装饰）', () => {
  const page = read('src/components/WelcomePage.vue')
  assert.match(page, /@click="pickColor\(project, choice\.index\)"/)
  assert.match(page, /@click="resetColor\(project\)"/)
  assert.match(page, /:disabled="colorAutoDisabled\(project\.path\)"/)
  // 九个色块的数据源就是上游那张表
  assert.match(page, /v-for="choice in PROJECT_COLOR_CHOICES"/)
})

test('菜单与「恢复自动」的文案来自上游', () => {
  assert.equal(PROJECT_COLOR_MENU_LABEL, '项目颜色')
  assert.equal(PROJECT_COLOR_AUTO_LABEL, '自动（按项目路径生成）')
  assert.equal(PROJECT_COLOR_CURRENT_LABEL, '（当前）')
})
