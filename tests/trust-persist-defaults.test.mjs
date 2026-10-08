// trust5 的判据之三：trust 决定**持久化**的缺键补默认、会话档并集的读点一致性、
// 以及 `trustAll` 的作用域边界（不许出现全局放行）。
//
// 上游基准（基准树逐行打开过，`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`
//     （`getMergedTrustedPaths()`：设置里那一份 + 确认框答应过的那一份并成一张表）、`:80-89`（差集各回各家）；
//   · `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:56-73`
//     —— 判据只有一个 `isProjectTrusted`，读的是**合并后**的状态 ⇒ 本仓不该有「某一处只读持久清单」这种分叉；
//     同文件 `:62`（`isTrustedCheckDisabledForProduct()`：整个产品级关掉检查）与 `:64` + `:117-120`
//     （`isSystemTrusted`：欢迎页那一个目录无条件受信任）是上游**有**、本仓**不采**的两只隐式放行的手
//     —— 下面第三条那组用例钉的就是「本仓不许长出这两只手」；
//   · `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`
//     —— trust-all 只往用户手管的那一份里加**一层父目录**（`:66` 的 `projectRoot.parent != null` 是它唯一的范围约束）；
//   · `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:103-107`
//     —— 父目录在 IDE 自己的配置目录里就不提供这一项。
// 本仓的落点与偏差：
//   · 持久键 `generalSettings.trustedPaths`：默认空数组（`native/settings_schema.cpp:183`）、
//     读盘时**缺键补默认**（`native/project_settings_state.cpp:52-57`：默认表打底再覆盖档上有的键），
//     校验只遍历「这次出现的键」（`validate_general_patch`，`native/settings_schema.cpp:186-188`）
//     ⇒ 按字段数量判损坏那种写法在这里一律是错的（本仓以前拿它坑过用户的 projects.json）；
//   · 本仓的 `trustedLocationParent('/x')` 给空串 ⇒ 根目录下的项目**不提供** trust-all，
//     比上游 `:66`（`parent != null` 就写）更严一格：宁可少一格，也不把「整个根」写进受信任位置。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyTrustDecision, externalLinkPrompt, isProjectLocationOfferedForTrust, mergeTrustEntries,
  normalizeTrustedPath, rememberSessionTrust, rememberTrust, replaceSessionTrust, sessionTrustEntries,
  trustAllLabel, trustDecisionPaths, trustedLocationParent, trustedLocationRows, trustedStateFor,
} from '../src/trustedProjects.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')
/** `sources()` 给的是绝对路径 ⇒ 不能再拼 root。 */
const readAbsolute = file => readFileSync(file, 'utf8')

/** `src/` 下所有 `.ts` / `.vue`（判据要扫全仓，不能只看本域那几个文件）。 */
function sources() {
  const found = []
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, item.name)
      if (item.isDirectory()) walk(full)
      else if (/\.ts$|\.vue$/.test(item.name)) found.push(full)
    }
  }
  walk(join(root, 'src'))
  return found
}

const relOf = file => relative(root, file).replace(/\\/g, '/')

/** 从 `index` 处那个 `(` 起取到配对的 `)`（本仓这些调用点最多嵌一层括号）。 */
function argumentsOf(source, index) {
  let depth = 0
  for (let at = index; at < source.length; at++) {
    const char = source[at]
    if (char === '(') depth++
    else if (char === ')') { depth--; if (depth === 0) return source.slice(index + 1, at) }
  }
  return source.slice(index)
}

test.beforeEach(() => replaceSessionTrust([]))

// ── 一、缺键补默认（不许按字段数判损坏） ──────────────────────────────────

test('读盘那一半：默认表打底再覆盖，缺 trustedPaths 这个键 = 空清单，不是损坏', () => {
  const state = read('native', 'project_settings_state.cpp')
  assert.match(state, /auto general = general_defaults_impl\(\);/, '缺键补默认：先把默认表铺好……')
  assert.match(state, /general\.update\(value\.at\("general"\)\);/, '……再把档上有的键盖上去')
  assert.match(state, /if \(value\.contains\("general"\)\)/, 'general 整段缺着也不报错（旧档就是旧档）')
  const schema = read('native', 'settings_schema.cpp')
  assert.match(schema, /void validate_general_patch\(const Json& patch\) \{/, '校验入口在')
  assert.match(schema, /known_keys\(patch, GENERAL_SETTING_KEYS, "INVALID_SETTINGS"\);/,
    'known_keys 只拒「不认识的键」，不是「少写了的键」（少写一个键必须走默认值，不是判损坏）')
  assert.match(schema, /\{"trustedPaths", Json::array\(\)\}/, '默认值 = 空清单（任何陌生目录第一次打开都要问）')
  const model = read('src', 'settingsModel.ts')
  assert.match(model, /trustedPaths: \[\],/, '前端默认值与 native 那条对齐')
})

test('清单读侧对坏形状宽容：undefined / 坏条目 / 多余字段都不抛错、也不判损坏', () => {
  assert.deepEqual(mergeTrustEntries(undefined, undefined), [])
  assert.deepEqual(trustedLocationRows(undefined), [])
  assert.deepEqual(trustedLocationRows([{ path: 7 }, null, { path: '' }]), [])
  assert.equal(trustedStateFor('D:/work/p', [{ path: 42 }]), 'unknown')
  assert.ok(externalLinkPrompt('https://a', 'D:/work/p', undefined),
    '没有清单 = 谁都不认识 = 要问那一句（不是「当成已信任」）')
  // 以后给条目加字段（比如来源标记）不许让老条目读不出：多余的键不影响判定。
  const withExtra = [{ path: 'd:/work/p', trusted: true, addedLater: 'whatever' }]
  assert.equal(trustedStateFor('D:/work/p', withExtra), 'trusted')
  assert.deepEqual(rememberTrust(withExtra, 'D:/other', false).map(entry => entry.path), ['d:/work/p', 'd:/other'])
})

// ── 二、会话档并集：每个读点都必须吃合并后的那一份 ────────────────────────

test('并集语义：持久 + 会话两张表都在判定里（TrustedHostsConfigurable.kt:66-71 的那一事）', () => {
  rememberSessionTrust('D:/Session/Only', true)
  assert.deepEqual(sessionTrustEntries(), [{ path: 'd:/session/only', trusted: true }])
  const merged = mergeTrustEntries([{ path: 'd:/persisted', trusted: true }], sessionTrustEntries())
  assert.deepEqual(merged.map(entry => entry.path), ['d:/persisted', 'd:/session/only'], '顺序也是先设置里、后对话框里')
  assert.equal(trustedStateFor('D:/Session/Only/sub', merged), 'trusted', '会话里答应过的路径，门禁同样认（祖先也算）')
  assert.equal(trustedStateFor('D:/Session/Only/sub', merged.slice(0, 1)), 'unknown',
    '少了会话那一份就判不出来 ⇒ 这一条就是「读点必须吃并集」的可失败形状')
})

test('全仓每一个信任判定的调用点都必须吃并集（例外名单写死，新增读点偷偷只读持久清单就红）', () => {
  const judgments = ['trustBlockReason', 'isProjectTrusted', 'trustedStateFor', 'needsTrustPrompt', 'externalLinkPrompt']
  const offenders = new Set()
  for (const file of sources()) {
    const rel = relOf(file)
    if (rel === 'src/trustedProjects.ts') continue   // 定义处自己不吃并集
    const source = readAbsolute(file)
    for (const name of judgments) {
      let at = source.indexOf(`${name}(`)
      while (at >= 0) {
        const args = argumentsOf(source, source.indexOf('(', at))
        // 只认「把持久清单直接交进去」这一手：会话那一份必须经 `trustEntries()` / `sessionTrustEntries()`
        // / `mergeTrustEntries(…)` 进来（上游 `TrustedProjects.kt:56-73` 只有一个合并后的判据）。
        if (/generalSettings\.value\??\.trustedPaths/.test(args)
          && !/sessionTrustEntries|mergeTrustEntries|trustEntries\(\)/.test(args)) offenders.add(`${rel}:${name}()`)
        at = source.indexOf(`${name}(`, at + 1)
      }
    }
  }
  // 这两个是**已知未落地**的读点：`src/semanticActions.ts` 的格式化门禁（接线请求 trust4 的 T2）、
  // `src/App.vue` 的 projectContext.trusted（保留文件，接线请求 trust5 的 U2）。
  // T2 / U2 落地时把对应那一名字从这条断言里删掉 —— 它现在红着就说明还有读点没并会话档。
  assert.deepEqual([...offenders].sort(), ['src/App.vue:isProjectTrusted()', 'src/semanticActions.ts:trustBlockReason()'],
    '例外名单之外不许再有「只读持久清单」的信任判定')
})

// ── 三、trustAll 的作用域边界：一次勾选只放开一层父目录，绝不全局 ──────────

test('trust-all 最多两条路径：项目根 + 它的一层父目录，且都不是空串或裸根', () => {
  const two = trustDecisionPaths('trust', 'D:/Work/Proj', true, 'C:/Users/me/.taocode')
  assert.deepEqual(two, [{ path: 'd:/work/proj', trusted: true }, { path: 'd:/work', trusted: true }])
  assert.equal(two.length, 2, '只有一层：绝不写出 d:/ 那种「整个盘」')
  assert.deepEqual(two.filter(entry => !entry.path || entry.path === '/' || entry.path === 'd:/'), [])
  // 父目录是**盘符根**时上游会写 `E:\`（`TrustedProjectsDialog.kt:66-70` 只判 `parent != null`）；
  // 本仓的项目就在盘符根下时仍然只记项目根一条 —— 判据把这一格差异钉住，别哪天当成 bug「补」回去。
  // 父目录是**盘符根**时上游也照样写进去（`TrustedProjectsDialog.kt:66-70` 只判 `projectRoot.parent != null`），
  // 本仓与它逐字一致：勾选框那一句会把这一层点名（`trustAllLabel('E:/proj')` = 信任「E:」文件夹里的所有项目），
  // 所以它是「一次看得见卷级的显式授权」，不是静默放行 —— 这一条钉的是**只多这一条**，别再多。
  assert.deepEqual(trustDecisionPaths('trust', 'E:/proj', true, 'C:/cfg'),
    [{ path: 'e:/proj', trusted: true }, { path: 'e:/', trusted: true }], '整盘那一格由用户勾出来，不是默认')
  assert.equal(trustAllLabel('E:/proj'), '信任「E:」文件夹里的所有项目', '勾的就是这一层，话要说在框里')
  // POSIX 根下的项目**不提供**这一格：`trustedLocationParent('/x')` 给空串 ⇒ 比上游 `:66` 严一格
  // （上游 `Path("/x").getParent()` = `/`，`!= null` 就画得出这一格）。
  assert.equal(trustedLocationParent('/x'), '')
  assert.deepEqual(trustDecisionPaths('trust', '/x', true, '/cfg'), [{ path: '/x', trusted: true }])
  assert.equal(isProjectLocationOfferedForTrust('/x', '/cfg'), false, '整个根绝不进受信任位置')
  // 相对路径：上游 `Path("relative/name").getParent()` = `relative` ⇒ 本仓给同一样东西（不是 null）。
  assert.equal(trustedLocationParent('relative/name'), 'relative')
  // 但它落进清单后**放不了行**：清单里每一条都按段做前缀匹配（`isPathInside`），
  // 一个相对的 `relative` 永远匹配不上宿主的绝对项目根 ⇒ 相对条目是惰性的，不是漏开的门。
  assert.equal(trustedStateFor('D:/Work/Proj', [{ path: 'relative', trusted: true }]), 'unknown')
  assert.equal(trustedStateFor('relative/name', [{ path: 'relative', trusted: true }]), 'trusted',
    '只有相对项目根自己会命中（宿主那条 `require_trusted` 拿的永远是绝对根）')
  assert.equal(trustAllLabel('relative/name'), '信任「relative」文件夹里的所有项目')
})

test('trust-all 不越界：安全模式/取消不吃勾、配置目录内不吃勾、父目录那条是覆盖不是追加', () => {
  assert.deepEqual(trustDecisionPaths('distrust', 'D:/Work/Proj', true, 'C:/cfg'),
    [{ path: 'd:/work/proj', trusted: false }], '上游那段 if 整个在 TRUST_AND_OPEN 分支里')
  assert.deepEqual(trustDecisionPaths('cancel', 'D:/Work/Proj', true, 'C:/cfg'), [])
  assert.deepEqual(trustDecisionPaths('trust', 'C:/Users/me/.taocode/projects/mirror', true, 'C:/Users/me/.taocode'),
    [{ path: 'c:/users/me/.taocode/projects/mirror', trusted: true }],
    '父目录在 IDE 自己的配置目录里 ⇒ 只提供项目根那一条（TrustedProjects.kt:103-107，理由见 :98-102）')
  assert.deepEqual(trustDecisionPaths('trust', 'D:/Work/Proj', false, 'C:/cfg'),
    [{ path: 'd:/work/proj', trusted: true }], '没勾就是一格都没多')
  assert.deepEqual(trustDecisionPaths('trust', '', true, 'C:/cfg'), [], '没有项目根 ⇒ 什么都不记')
  const before = [{ path: 'd:/work', trusted: false }]
  assert.deepEqual(applyTrustDecision(before, trustDecisionPaths('trust', 'D:/Work/Proj', true, 'C:/cfg')),
    [{ path: 'd:/work/proj', trusted: true }, { path: 'd:/work', trusted: true }],
    '父目录那一条覆盖同一路径的旧值，不是再加一条（清单里同一路径只许有一条）')
  assert.equal(applyTrustDecision(before, []).length, 1, '什么都不记时原清单不动')
})

test('本仓不许长出上游那两只隐式放行的手（TrustedProjects.kt:62 与 :64）', () => {
  const banned = [
    ['isTrustedCheckDisabled', '上游 :62 那一档产品级关掉整个检查'],
    ['isSystemTrusted', '上游 :64 + :117-120：欢迎页那一个目录无条件受信任'],
    ['trustEverything', '任何「默认全信任」的形状'],
    ['alwaysTrusted', '任何「默认全信任」的形状'],
  ]
  const hits = []
  for (const file of sources()) {
    const rel = relOf(file)
    const source = readAbsolute(file).toLowerCase()
    for (const [name, why] of banned) if (source.includes(name.toLowerCase())) hits.push(`${rel} → ${name}（${why}）`)
  }
  assert.deepEqual(hits, [], '这条是「让用户决定信任什么」的反面：一个都不许出现')
  // trust-all 的可用态必须由配置目录那一条门禁给出（没有配置目录 = 宁缺一格）。
  const lifecycle = read('src', 'workspaceLifecycle.ts')
  assert.match(lifecycle, /Boolean\(trustConfigDir\.value\) && isProjectLocationOfferedForTrust\(/)
  // 而会话那一档（没勾「以后不再询问」）永远只记项目根：`rememberSessionTrust(root, …)` 传的是 root。
  assert.match(lifecycle, /else rememberSessionTrust\(root, choice === 'trust'\)/)
  assert.equal(normalizeTrustedPath('D:\\Work\\'), 'd:/work', '归一口径与宿主那份一致（native/trusted_paths.cpp:10-24）')
})
