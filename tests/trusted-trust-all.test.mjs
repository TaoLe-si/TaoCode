// 确认框里的「始终信任来自此来源的项目」（trust-all）—— 上游
// `TrustedProjectStartupDialog` 的那个勾选与 `TrustedProjectsDialog.kt:64-71` 的落库规则。
//
// 上游依据：
//   · `TrustedProjectsDialog.kt:64-71` —— 只有「信任并打开」分支才看 `dialog.isTrustAll`，
//     且把 `projectRoot.parent` 写进**用户手管的** `TrustedPathsSettings`（不是确认框那份 `TrustedPaths`）。
//   · `TrustedProjects.kt:103-107` `isProjectLocationOfferedForTrust` —— 父目录落在 IDE 自己的
//     配置目录里时**不提供**这一项（理由在 `:98-102`）。
//   · `TrustedPathsSettings.kt:34-49` —— 那个存储是 `List<String>`，条目隐式全为 true；
//     `TrustedHostsConfigurable.getMergedTrustedPaths()`（`:66-71`）把它并进「受信任位置」表。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTrustDecision,
  isProjectLocationOfferedForTrust,
  TRUST_ALL_LABEL,
  trustDecisionPaths,
  trustedLocationParent,
  trustedLocationRows,
} from '../src/trustedProjects.ts'

test('父目录就是 projectRoot.parent（盘符根要补回斜杠）', () => {
  assert.equal(trustedLocationParent('D:/Work/Proj'), 'D:/Work')
  assert.equal(trustedLocationParent('D:\\Work\\Proj\\'), 'D:/Work')
  assert.equal(trustedLocationParent('C:/Proj'), 'C:/', '裸盘符就是根')
  assert.equal(trustedLocationParent('relative/dir'), 'relative')
  assert.equal(trustedLocationParent('noslash'), null, '没有父目录')
  assert.equal(trustedLocationParent(''), null)
})

test('isProjectLocationOfferedForTrust：父目录在配置目录里就不提供（TrustedProjects.kt:104-107）', () => {
  const configDir = 'C:/Users/me/AppData/Roaming/TaoCode'
  assert.equal(isProjectLocationOfferedForTrust('D:/Work/Proj', configDir), true)
  // 上游理由（:98-102）：配置目录里的项目与所有同类项目共用父目录，信任它会连带信任全部。
  assert.equal(isProjectLocationOfferedForTrust(`${configDir}/scratch/proj`, configDir), false)
  assert.equal(isProjectLocationOfferedForTrust(`${configDir}/proj`, configDir), false, '父目录正好就是配置目录也要挡')
  assert.equal(isProjectLocationOfferedForTrust('C:/Users/me/other/proj', configDir), true, '同盘符不同目录不算')
  assert.equal(isProjectLocationOfferedForTrust('D:/Work/Proj', null), true, '没给配置目录就默认可提供')
  assert.equal(isProjectLocationOfferedForTrust('noslash', configDir), false, '没有父目录就没有这一项')
})

test('只记「信任并打开」：项目根记为信任，trust-all 再加一条父目录（TrustedProjectsDialog.kt:64-71）', () => {
  assert.deepEqual(trustDecisionPaths('trust', 'D:/Work/Proj', false), [{ path: 'd:/work/proj', trusted: true }])
  assert.deepEqual(trustDecisionPaths('trust', 'D:/Work/Proj', true), [
    { path: 'd:/work/proj', trusted: true },
    { path: 'd:/work', trusted: true },
  ], '勾了就把父目录一并写进用户手管的清单')
})

test('「以安全模式打开」记为不信任，且不吃 trust-all；取消什么都不记', () => {
  // 上游那段 if 整个在 TRUST_AND_OPEN 分支里（:64-71），distrust 分支只 setProjectTrusted(false)。
  assert.deepEqual(trustDecisionPaths('distrust', 'D:/Work/Proj', false), [{ path: 'd:/work/proj', trusted: false }])
  assert.deepEqual(trustDecisionPaths('distrust', 'D:/Work/Proj', true), [{ path: 'd:/work/proj', trusted: false }])
  // :95 直接 return false，不碰状态。
  assert.deepEqual(trustDecisionPaths('cancel', 'D:/Work/Proj', true), [])
})

test('配置目录里的项目不给这一项：勾了也不会把父目录写进去', () => {
  const configDir = 'C:/Users/me/AppData/Roaming/TaoCode'
  const paths = trustDecisionPaths('trust', `${configDir}/scratch/proj`, true, configDir)
  assert.deepEqual(paths, [{ path: 'c:/users/me/appdata/roaming/taocode/scratch/proj', trusted: true }])
  assert.ok(!paths.some(item => item.path === normalize(configDir)), '配置目录本身不该进受信任位置')
})

test('落库后立刻出现在「受信任位置」那张表里（getMergedTrustedPaths 的并集语义）', () => {
  const entries = applyTrustDecision([], trustDecisionPaths('trust', 'D:/Work/Proj', true))
  // 勾了 trust-all ⇒ 兄弟项目打开时不再询问（最近祖先判定，TrustedProjectsStateStorage.kt:29-38）。
  assert.deepEqual(entries.map(entry => entry.path), ['d:/work/proj', 'd:/work'])
  assert.deepEqual(trustedLocationRows(entries).map(row => row.path), ['d:/work/proj', 'd:/work'])
  // 父目录已在清单里时不重复加（同一条路径后写的赢，rememberTrust 就地替换）。
  const again = applyTrustDecision(entries, trustDecisionPaths('trust', 'D:/Work/Other', true))
  assert.deepEqual(again.map(entry => entry.path), ['d:/work/proj', 'd:/work/other', 'd:/work'])
  assert.equal(again.filter(entry => entry.path === 'd:/work').length, 1, '父目录只留一条')
})

test('勾选框文案是一个常量（页面上要按它渲染这一项）', () => {
  assert.equal(typeof TRUST_ALL_LABEL, 'string')
  assert.ok(TRUST_ALL_LABEL.length > 0)
})

function normalize(path) { return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
