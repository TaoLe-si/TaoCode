// 受信任位置清单与文件级信任的判据（`src/trustedPathRules.ts`）。
// 每一条用例的注释里写上游 `文件:行号`，与模块里的注释一一对应。
import test from 'node:test'
import assert from 'node:assert/strict'
const {
  settingsStoreEntries, explicitStoreEntries, explicitlyTrustedPaths, replaceExplicitlyTrustedPaths,
  isUnderWelcomeScreenDir, mergedTrustedLocationList, splitMergedTrustedPaths,
  appendTrustedPath, replaceTrustedPaths,
  expandUserHome, pathSyntaxProblem, parseTrustedLocationPath, insertIndexForAdd,
  projectTrustedStateForRoots, overallProjectTrustedState, setProjectTrustedEffect,
  SAFE_MODE_REGISTRY_KEY, SAFE_MODE_DEFAULT, MAX_EXTERNALLY_OPENED,
  isExternallyMarked, markExternallyOpened, computeFileTrusted, fileTrustVerdict,
  isFileTrustDecidedByFile, fileSafeModeBannerShown, FILE_SAFE_MODE_BANNER, FILE_TRUST_LINK_LABEL,
  UNTRUSTED_FILE_HIGHLIGHTING_SETTING, fileHighlightingSetting, FILE_NAVIGATION_PROMPT, fileNavigationMessage,
  fileTrustEntries, fileTrustDecision, fileTrustDialogLayout, FILE_TRUST_DIALOG_WIDTH,
  EXTERNALLY_OPENED_SOURCES, dropMarksExternallyOpened,
  URI_LIST_FLAVOR, GNOME_FILE_LIST_FLAVOR, KDE_CUT_MARK_FLAVOR, FILE_LIST_FLAVORS,
  isFileListFlavorAvailable, fileSourcePreference, isDroppableUriLine, isMoveOperation,
  DROP_TARGET_KINDS, dropTargetAccepts, projectViewDropHandlerKind, DND_ACTION_COPY_OR_MOVE,
  DOCK_CONTENT_RESPONSE, dockResponseCanAccept, dockResponseFor, dockDropOutcome, dragOutKeepsSource,
} = await import('../src/trustedPathRules.ts')
const { trustedStateFor } = await import('../src/trustedProjects.ts')

// ── ① 两个存储的持久形状（TrustedPathsSettings.kt:34-38 / TrustedPaths.kt:30-34）──────────

test('设置那一份是 List<String>，每条隐含信任', () => {
  assert.deepEqual(settingsStoreEntries(['D:/work', 'E:/libs']), [
    { path: 'D:/work', trusted: true },
    { path: 'E:/libs', trusted: true },
  ])
  assert.deepEqual(settingsStoreEntries(undefined), [], '空清单 = 空数组（上游默认 emptyList）')
  assert.deepEqual(settingsStoreEntries([undefined, 'D:/work']), [{ path: 'D:/work', trusted: true }])
})

test('显式那一份是 Map<String, Boolean>，false 表示明确不信任', () => {
  assert.deepEqual(explicitStoreEntries({ 'D:/a': true, 'D:/b': false }), [
    { path: 'D:/a', trusted: true },
    { path: 'D:/b', trusted: false },
  ])
  assert.deepEqual(explicitStoreEntries(undefined), [])
  assert.deepEqual(explicitStoreEntries({ 'D:/c': undefined }), [{ path: 'D:/c', trusted: false }])
})

test('getExplicitlyTrustedPaths：只取 true，且按字符串升序（TrustedPaths.kt:72-74）', () => {
  const entries = [
    { path: 'D:/zeta', trusted: true },
    { path: 'D:/alpha', trusted: true },
    { path: 'D:/mid', trusted: false },
  ]
  assert.deepEqual(explicitlyTrustedPaths(entries), ['D:/alpha', 'D:/zeta'], '不信任的那条不列出来')
  assert.deepEqual(explicitlyTrustedPaths(undefined), [])
})

test('setExplicitlyTrustedPaths：不信任的条目原样保留，信任集合整体替换（TrustedPaths.kt:81-85）', () => {
  const before = [
    { path: 'D:/keep-untrusted', trusted: false },
    { path: 'D:/drop-me', trusted: true },
  ]
  const after = replaceExplicitlyTrustedPaths(before, ['E:/new'])
  assert.deepEqual(after, [
    { path: 'D:/keep-untrusted', trusted: false },
    { path: 'E:/new', trusted: true },
  ])
  assert.deepEqual(replaceExplicitlyTrustedPaths(undefined, []), [])
})

// ── 系统路径与并集（TrustedProjects.kt:118-128 / TrustedHostsConfigurable.kt:66-71）──────

test('欢迎屏目录判定：落在欢迎屏工程目录之下才算（TrustedProjects.kt:118-121）', () => {
  assert.equal(isUnderWelcomeScreenDir('C:/idea/home', 'C:/idea/home'), true, '相等也算')
  assert.equal(isUnderWelcomeScreenDir('C:/idea/home/proj', 'C:/idea/home'), true)
  assert.equal(isUnderWelcomeScreenDir('C:/idea/home2', 'C:/idea/home'), false, '按段判，不是字符串前缀')
  assert.equal(isUnderWelcomeScreenDir('C:/elsewhere', null), false)
  assert.equal(isUnderWelcomeScreenDir('', 'C:/idea/home'), false)
})

// 上游 `:124-128` 由「每个 root 都在欢迎屏目录下」拼出的那只全信任的手（roots 聚合判定）
// 在本仓不移植 —— 禁令与理由见 `tests/trust-persist-defaults.test.mjs`（连名字都不许出现）。

test('并集：先设置那一份，再接显式那一份（去重 + 滤掉系统路径）', () => {
  const merged = mergedTrustedLocationList(
    ['D:/work', 'D:/shared'],
    [{ path: 'D:/shared', trusted: true }, { path: 'E:/explicit', trusted: true }, { path: 'C:/home/proj', trusted: true }],
    'C:/home',
  )
  assert.deepEqual(merged, ['D:/work', 'D:/shared', 'E:/explicit'], '跨存储去重；系统路径不列出来')
})

test('并集只收 true（false 的那条不进表 —— getExplicitlyTrustedPaths 的 filterValues）', () => {
  const merged = mergedTrustedLocationList([], [{ path: 'D:/no', trusted: false }])
  assert.deepEqual(merged, [])
})

test('差集回写：留在原存储，新条目进设置那一份（TrustedHostsConfigurable.kt:88-89）', () => {
  const split = splitMergedTrustedPaths(['D:/settings'], [{ path: 'D:/explicit', trusted: true }], ['D:/settings', 'D:/explicit', 'E:/brand-new'])
  assert.deepEqual(split.settings, ['D:/settings', 'E:/brand-new'], '原本在设置里的留下；两个存储都没有过的新条目算手加的')
  assert.deepEqual(split.explicit, ['D:/explicit'], '只在确认框里答应过的留在原地')
})

test('差集回写：删一条不连带删掉另一份的同名项', () => {
  const split = splitMergedTrustedPaths(['D:/a'], [{ path: 'D:/b', trusted: true }], ['D:/b'])
  assert.deepEqual(split.settings, [], '设置里那条被删掉了')
  assert.deepEqual(split.explicit, ['D:/b'], '显式那份还在')
  const reverse = splitMergedTrustedPaths(['D:/a'], [{ path: 'D:/b', trusted: true }], ['D:/a'])
  assert.deepEqual(reverse.settings, ['D:/a'])
  assert.deepEqual(reverse.explicit, [], '显式那份被删了，设置那条没动')
})

test('差集回写：系统路径的过期记录不进差集（:84 的 filterNot）', () => {
  const split = splitMergedTrustedPaths([], [{ path: 'C:/home/proj', trusted: true }], ['C:/home/proj'], 'C:/home')
  assert.deepEqual(split.settings, ['C:/home/proj'], '它不在 explicitBefore 里，于是被当成新条目进设置')
  assert.deepEqual(split.explicit, [])
})

// ── 存储层增改（TrustedPathsSettings.kt:63-73）───────────────────────────────────────

test('addTrustedPath 是直接追加，存储层不去重（TrustedPathsSettings.kt:69-73）', () => {
  assert.deepEqual(appendTrustedPath(['D:/a'], 'D:/a'), ['D:/a', 'D:/a'], '上游 State(it.trustedPaths + path)')
  assert.deepEqual(appendTrustedPath(undefined, 'D:/a'), ['D:/a'])
})

test('setTrustedPaths 整表替换（TrustedPathsSettings.kt:63-67）', () => {
  assert.deepEqual(replaceTrustedPaths(['E:/x']), ['E:/x'])
  assert.deepEqual(replaceTrustedPaths(undefined), [])
})

// ── 输入规范化（OSAgnosticPathUtil.java:176-186 + TrustedHostsConfigurable.kt:104-122）──

test('expandUserHome：~ / ~\\x / 其余原样', () => {
  assert.equal(expandUserHome('~', 'C:/Users/me'), 'C:/Users/me')
  assert.equal(expandUserHome('~/projects', 'C:/Users/me'), 'C:/Users/me/projects')
  assert.equal(expandUserHome('~\\projects', 'C:/Users/me'), 'C:/Users/me\\projects')
  assert.equal(expandUserHome('D:/work', 'C:/Users/me'), 'D:/work')
  assert.equal(expandUserHome('~foo', 'C:/Users/me'), '~foo', '不带分隔符的波浪号不展开')
})

test('pathSyntaxProblem：空串与 NUL 是两种不同的原因', () => {
  assert.equal(pathSyntaxProblem(''), '请输入要信任的文件夹路径。')
  assert.equal(pathSyntaxProblem('   '), '请输入要信任的文件夹路径。')
  assert.equal(pathSyntaxProblem('D:/a\0b'), '路径里不能包含空字符。')
  assert.equal(pathSyntaxProblem('D:/a'), null)
})

test('parseTrustedLocationPath：先展开 ~，再判语法', () => {
  assert.deepEqual(parseTrustedLocationPath('  ~/p  ', 'C:/Users/me'), { path: 'C:/Users/me/p' })
  assert.deepEqual(parseTrustedLocationPath('  ', 'C:/Users/me'), { error: '请输入要信任的文件夹路径。' })
  assert.deepEqual(parseTrustedLocationPath('D:/x', 'C:/Users/me'), { path: 'D:/x' })
})

test('新增插在哪一格：有选中插在选中之前，否则 max(count-1, 0)（TrustedHostsConfigurable.kt:134-137）', () => {
  assert.equal(insertIndexForAdd(0, -1), 0, '空表 = 0')
  assert.equal(insertIndexForAdd(3, -1), 2, '非空表是最后一行之前，不是末尾')
  assert.equal(insertIndexForAdd(3, 1), 1, '有选中就插在选中行之前')
})

// 上游 `TrustedProjects.kt:136-144` 的三个免检开关判定（all.projects / headless.disabled / 产品级）
// 在本仓不移植 —— 禁令与理由见 `tests/trust-persist-defaults.test.mjs`；六步机的
// `checkDisabled` 事实位宿主恒传 `false`，在下面六步用例里已覆盖。

// ── 多 root 合并与六步判定顺序（TrustedProjectsStateStorage.kt:28-40 / TrustedProjects.kt:59-73）

test('多 root 合并：UNSURE 优先、其次 NO，都相同才 YES（StateStorage.kt:31-37）', () => {
  assert.equal(projectTrustedStateForRoots(['trusted', 'trusted']), 'trusted')
  assert.equal(projectTrustedStateForRoots(['trusted', 'untrusted']), 'untrusted')
  assert.equal(projectTrustedStateForRoots(['trusted', 'unknown']), 'unknown')
  assert.equal(projectTrustedStateForRoots(['untrusted', 'unknown']), 'unknown', 'UNSURE 压过 NO')
  assert.equal(projectTrustedStateForRoots(['trusted']), 'trusted')
})

test('一个 root 都没有时是 YES（:31 的初值），不是 UNSURE', () => {
  assert.equal(projectTrustedStateForRoots([]), 'trusted')
})

test('六步顺序：免检 > 系统路径 > 显式状态 > LightEdit > 设置清单 > UNSURE', () => {
  const base = {
    checkDisabled: false, systemTrusted: false, explicitState: 'unknown',
    lightEditOwns: false, settingsTrusted: false,
  }
  assert.equal(overallProjectTrustedState(base), 'unknown', '⑥ 什么都不命中 = UNSURE（要弹框）')

  // ⑤ 设置清单信任
  assert.equal(overallProjectTrustedState({ ...base, settingsTrusted: true }), 'trusted')
  // ④ LightEdit 自己的项目
  assert.equal(overallProjectTrustedState({ ...base, lightEditOwns: true }), 'trusted')
  // ③ 显式状态：YES 与 NO 都算「用户答过」
  assert.equal(overallProjectTrustedState({ ...base, explicitState: 'trusted', settingsTrusted: false }), 'trusted')
  assert.equal(overallProjectTrustedState({ ...base, explicitState: 'untrusted', settingsTrusted: true }), 'untrusted',
    '显式 NO 压过设置清单里的 YES')
  // ② 系统路径在显式状态之前（:63 的注释：过期的记录不能赢）
  assert.equal(overallProjectTrustedState({ ...base, systemTrusted: true, explicitState: 'untrusted' }), 'trusted',
    '系统路径压过一条过期的「不信任」记录')
  // ① 免检在最前
  assert.equal(overallProjectTrustedState({ ...base, checkDisabled: true, explicitState: 'untrusted' }), 'trusted')
})

test('setProjectTrusted：系统路径不落持久状态，状态没变就不发事件（:79-91）', () => {
  assert.deepEqual(setProjectTrustedEffect({ systemTrusted: true, oldState: 'unknown', isTrusted: true }), { persist: false, event: null })
  assert.deepEqual(setProjectTrustedEffect({ systemTrusted: false, oldState: 'unknown', isTrusted: true }), { persist: true, event: 'trusted' })
  assert.deepEqual(setProjectTrustedEffect({ systemTrusted: false, oldState: 'trusted', isTrusted: true }), { persist: true, event: null })
  assert.deepEqual(setProjectTrustedEffect({ systemTrusted: false, oldState: 'trusted', isTrusted: false }), { persist: true, event: 'untrusted' })
})

// ── 外部打开标记（ExternallyOpenedFiles.kt:29-62）────────────────────────────────────

test('isMarked 是精确字符串比对，不判前缀（ExternallyOpenedFiles.kt:42）', () => {
  assert.equal(isExternallyMarked(['D:/a/b.txt'], 'D:/a/b.txt'), true)
  assert.equal(isExternallyMarked(['D:/a'], 'D:/a/b.txt'), false, '目录标记不覆盖里面的文件')
  assert.equal(isExternallyMarked(undefined, 'D:/a'), false)
})

test('重复标记把这一条挪到最新端，不产生第二条（ExternallyOpenedFiles.kt:53-57）', () => {
  const first = markExternallyOpened(['D:/a', 'D:/b'], 'D:/a')
  assert.deepEqual(first.paths, ['D:/b', 'D:/a'])
  assert.equal(first.evicted, false)
})

test('标记表上限 100，淘汰最旧的一条并报出来（ExternallyOpenedFiles.kt:29,58-59）', () => {
  assert.equal(MAX_EXTERNALLY_OPENED, 100, '上限字面量必须钉死在这里，否则下面的用例会跟着常量一起漂移')
  const paths = []
  for (let index = 0; index < 100; index++) paths.push(`D:/f${index}`)
  const full = markExternallyOpened(paths, 'D:/new')
  assert.equal(full.paths.length, 100)
  assert.equal(full.evicted, true)
  assert.equal(full.paths[0], 'D:/f1', '最旧的 f0 被砍掉')
  assert.equal(full.paths[full.paths.length - 1], 'D:/new')
  const notFull = markExternallyOpened(paths, 'D:/f0')
  assert.equal(notFull.evicted, false, '重标记一条已有的不会触发淘汰')
  assert.equal(notFull.paths.length, 100)
})

test('常量：registry 键与出厂默认（TrustedFiles.kt:53 + registry.properties:1164）', () => {
  assert.equal(SAFE_MODE_REGISTRY_KEY, 'ide.untrusted.files.safe.mode')
  assert.equal(SAFE_MODE_DEFAULT, true)
})

// ── 文件级判词四步（TrustedFiles.kt:226-247）─────────────────────────────────────────

test('文件判词四步：显式位置 > 项目内跟项目 > 未标记=信任 > 外部打开=不信任', () => {
  const base = { pathState: 'unknown', insideProjectRoots: false, projectTrusted: false, externallyMarked: false }
  // ① 显式信任的位置压过项目信任态（:227 的注释）
  assert.equal(computeFileTrusted({ ...base, pathState: 'trusted', insideProjectRoots: true, projectTrusted: false }), true)
  // ② 在项目根里跟项目走
  assert.equal(computeFileTrusted({ ...base, insideProjectRoots: true, projectTrusted: true }), true)
  assert.equal(computeFileTrusted({ ...base, insideProjectRoots: true, projectTrusted: false }), false)
  // ③ 不在项目根、没被标记 ⇒ 信任（IDE 自己开的草稿 / 控制台 / VM options）
  assert.equal(computeFileTrusted({ ...base }), true)
  // ④ 不在项目根、被标记为外部打开 ⇒ 不信任
  assert.equal(computeFileTrusted({ ...base, externallyMarked: true }), false)
})

test('显式不信任一条文件路径：pathState=untrusted 不短路，继续往下走', () => {
  const base = { pathState: 'untrusted', insideProjectRoots: false, projectTrusted: false, externallyMarked: false }
  assert.equal(computeFileTrusted(base), true, '不在项目根且未标记 ⇒ 仍信任（:241-243）')
  assert.equal(computeFileTrusted({ ...base, insideProjectRoots: true, projectTrusted: true }), true)
})

test('三道闸：开关关 / 免检 / 项目自带信任模型，都直接信任（TrustedFiles.kt:66-75）', () => {
  const facts = { pathState: 'unknown', insideProjectRoots: false, projectTrusted: false, externallyMarked: true }
  const off = { safeModeOn: false, checkDisabled: false, projectOwnsOwnTrustModel: false }
  assert.equal(fileTrustVerdict(off, facts), true, 'ide.untrusted.files.safe.mode 关掉 ⇒ 全都信任')
  assert.equal(fileTrustVerdict({ ...off, safeModeOn: true, checkDisabled: true }, facts), true)
  assert.equal(fileTrustVerdict({ ...off, safeModeOn: true, projectOwnsOwnTrustModel: true }, facts), true,
    'default/disposed/LightEdit 项目有自己的信任模型')
  assert.equal(fileTrustVerdict({ safeModeOn: true, checkDisabled: false, projectOwnsOwnTrustModel: false }, facts), false)
})

test('isTrustDecidedByFile：被标记 **且** 在项目根之外（TrustedFiles.kt:104-105）', () => {
  const gate = { safeModeOn: true, checkDisabled: false, projectOwnsOwnTrustModel: false }
  assert.equal(isFileTrustDecidedByFile(gate, { externallyMarked: true, insideProjectRoots: false }), true)
  assert.equal(isFileTrustDecidedByFile(gate, { externallyMarked: true, insideProjectRoots: true }), false, '项目内的文件跟项目走')
  assert.equal(isFileTrustDecidedByFile(gate, { externallyMarked: false, insideProjectRoots: false }), false)
  assert.equal(isFileTrustDecidedByFile({ ...gate, safeModeOn: false }, { externallyMarked: true, insideProjectRoots: false }), false)
  assert.equal(isFileTrustDecidedByFile({ ...gate, checkDisabled: true }, { externallyMarked: true, insideProjectRoots: false }), false)
  assert.equal(isFileTrustDecidedByFile({ ...gate, projectOwnsOwnTrustModel: true }, { externallyMarked: true, insideProjectRoots: false }), false)
})

test('文件横幅：!isTrusted && isTrustDecidedByFile 才画（UntrustedFileNotificationProvider.kt:27）', () => {
  assert.equal(fileSafeModeBannerShown(false, true), true)
  assert.equal(fileSafeModeBannerShown(true, true), false)
  assert.equal(fileSafeModeBannerShown(false, false), false, '项目内的未信任文件画的是项目横幅')
  assert.equal(FILE_SAFE_MODE_BANNER, '安全模式。信任此文件以使用完整的 IDE 功能。')
  assert.equal(FILE_TRUST_LINK_LABEL, '信任文件…')
})

test('未信任文件的高亮档是 SKIP_INSPECTION（UntrustedFileHighlightingSettingProvider.kt:16）', () => {
  assert.equal(fileHighlightingSetting(false), UNTRUSTED_FILE_HIGHLIGHTING_SETTING)
  assert.equal(fileHighlightingSetting(true), null, '信任时返回 null = 不干预默认档')
})

test('从未信任文件跳转前的问话（GotoDeclarationOrUsageHandler2.kt:56-60）', () => {
  assert.equal(FILE_NAVIGATION_PROMPT.title, '从未信任的文件跳转？')
  assert.equal(FILE_NAVIGATION_PROMPT.button, '跳转')
  assert.equal(fileNavigationMessage('a.txt'), '「a.txt」以安全模式打开。跳转会解析引用，可能打开其他文件。')
})

// ── 文件级确认框（TrustedFileDialog.kt:35-102 / TrustedProjectsDialog.kt:164-189）──────

test('fileTrustEntries：只信任文件就是写文件自己的路径', () => {
  assert.deepEqual(fileTrustEntries('D:/work/a.txt', false), [{ path: 'D:/work/a.txt', trusted: true }])
})

test('fileTrustEntries：勾了信任文件夹时父目录在前、文件在后', () => {
  assert.deepEqual(fileTrustEntries('D:/work/a.txt', true), [
    { path: 'D:/work', trusted: true },
    { path: 'D:/work/a.txt', trusted: true },
  ])
  assert.deepEqual(fileTrustEntries('D:/a.txt', true), [
    { path: 'D:/', trusted: true },
    { path: 'D:/a.txt', trusted: true },
  ], '盘符根的父目录就是盘符根本身（上游 Path.getParent() 同口径，:176-177）')
  assert.deepEqual(fileTrustEntries('a.txt', true), [{ path: 'a.txt', trusted: true }],
    '相对路径没有父目录，只剩文件那条')
})

test('fileTrustDecision：答「继续使用安全模式」什么都不写（:175 的 if (answer)）', () => {
  assert.deepEqual(fileTrustDecision(false, false, 'D:/work/a.txt'), [])
  assert.deepEqual(fileTrustDecision(false, true, 'D:/work/a.txt'), [])
  assert.deepEqual(fileTrustDecision(true, true, 'D:/work/a.txt'), [
    { path: 'D:/work', trusted: true },
    { path: 'D:/work/a.txt', trusted: true },
  ])
})

test('确认框文案与按钮档（IdeBundle.properties:2961-2968）', () => {
  const layout = fileTrustDialogLayout({ fileName: 'a.txt', filePath: 'D:/work/a.txt', appName: 'IDEA' })
  assert.equal(layout.title, '信任文件「a.txt」？')
  assert.ok(layout.message.includes('信任只会应用于「D:/work/a.txt」这一个文件。'))
  assert.equal(layout.trustButton, '信任此文件')
  assert.equal(layout.distrustButton, '继续使用安全模式', 'untrusted.project.dialog.distrust.button:2941')
  assert.equal(layout.folderCheckbox, '信任「work」文件夹中的所有文件')
  assert.equal(layout.trustFolderButton, '信任「work」文件夹')
  assert.deepEqual(layout.defaultChoice, { isTrusted: true, isTrustFolder: false }, '主按钮是信任（:93 isDefault）')
  assert.deepEqual(layout.focusedChoice, { isTrusted: false, isTrustFolder: false }, '焦点在安全模式（:98 isFocused）')
  assert.equal(layout.cancelable, false, '上游没有取消按钮（:32-33）')
  assert.equal(layout.width, FILE_TRUST_DIALOG_WIDTH)
})

test('勾选框的两个条件：有父目录 **且** 父目录不在 IDE 配置目录里（:68 + TrustedProjects.kt:104-107）', () => {
  const inConfig = fileTrustDialogLayout({ fileName: 'a.txt', filePath: 'C:/cfg/projects/p/a.txt', appName: 'IDEA', configDir: 'C:/cfg' })
  assert.equal(inConfig.folderCheckbox, null, '父目录落在配置目录里就不画这一格')
  assert.equal(inConfig.trustFolderButton, null)
  const noConfig = fileTrustDialogLayout({ fileName: 'a.txt', filePath: 'C:/cfg/projects/p/a.txt', appName: 'IDEA', configDir: null })
  assert.ok(noConfig.folderCheckbox, '没有配置目录信息时照常画')
})

test('文件夹名的两处截断长度不同：勾选框 40、按钮 18（:71-72）', () => {
  const longName = 'a'.repeat(50)
  const layout = fileTrustDialogLayout({ fileName: 'f', filePath: `D:/${longName}/f`, appName: 'IDEA' })
  assert.equal(layout.folderCheckbox, `信任「${'a'.repeat(39)}…」文件夹中的所有文件`)
  assert.equal(layout.trustFolderButton, `信任「${'a'.repeat(17)}…」文件夹`)
})

test('外部打开的六个入口都指到上游调用行', () => {
  assert.equal(EXTERNALLY_OPENED_SOURCES.length, 6)
  for (const source of EXTERNALLY_OPENED_SOURCES) {
    assert.ok(source.what && source.where.includes(':'), `${source.what} 要带 文件:行号`)
  }
  assert.equal(dropMarksExternallyOpened(), true)
})

// ── ⑧ 拖放：传输类型（LinuxDragAndDropSupport.java:33-35 / FileCopyPasteUtil.java:26-28）──

test('三个 flavor 的字符串，与上游常量逐字一致', () => {
  assert.equal(URI_LIST_FLAVOR, 'text/uri-list')
  assert.equal(GNOME_FILE_LIST_FLAVOR, 'x-special/gnome-copied-files')
  assert.equal(KDE_CUT_MARK_FLAVOR, 'application/x-kde-cutselection')
  assert.deepEqual(FILE_LIST_FLAVORS, ['application/x-java-file-list', 'text/uri-list', 'x-special/gnome-copied-files'])
})

test('isFileListFlavorAvailable：files 非空 或 types 里有 uri-list 族', () => {
  assert.equal(isFileListFlavorAvailable({ types: ['text/plain'] }), false, 'FileCopyPasteUtilTest.kt:14')
  assert.equal(isFileListFlavorAvailable({ types: [URI_LIST_FLAVOR] }), true)
  assert.equal(isFileListFlavorAvailable({ types: [GNOME_FILE_LIST_FLAVOR] }), true)
  assert.equal(isFileListFlavorAvailable({ types: [], files: { length: 2 } }), true, 'javaFileListFlavor 那一档')
  assert.equal(isFileListFlavorAvailable({ types: [], files: { length: 0 } }), false)
  assert.equal(isFileListFlavorAvailable(null), false)
  assert.equal(isFileListFlavorAvailable({}), false)
  assert.equal(isFileListFlavorAvailable({ types: [KDE_CUT_MARK_FLAVOR] }), false,
    'kde 剪切标记不在 FLAVORS 表里（它只用来判是不是剪切）')
})

test('fileSourcePreference：先 files，再 uri-list（FileCopyPasteUtil.java:82-90）', () => {
  assert.equal(fileSourcePreference({ files: { length: 1 }, types: [URI_LIST_FLAVOR] }), 'files')
  assert.equal(fileSourcePreference({ types: [URI_LIST_FLAVOR] }), 'uri-list')
  assert.equal(fileSourcePreference({ types: [GNOME_FILE_LIST_FLAVOR] }), 'uri-list')
  assert.equal(fileSourcePreference({ types: ['text/plain'] }), null)
  assert.equal(fileSourcePreference(null), null)
})

test('isDroppableUriLine：跳过空行、# 注释行、非 file:/ 开头（LinuxDragAndDropSupport.java:60）', () => {
  assert.equal(isDroppableUriLine('file:///D:/a.txt'), true)
  assert.equal(isDroppableUriLine('file:/D:/a.txt'), true, '上游只要求 file:/ 前缀')
  assert.equal(isDroppableUriLine('# comment'), false)
  assert.equal(isDroppableUriLine('   '), false)
  assert.equal(isDroppableUriLine(''), false)
  assert.equal(isDroppableUriLine('http://x'), false)
  assert.equal(isDroppableUriLine('file:D:/a.txt'), false, 'file: 后面必须有斜杠')
})

test('isMoveOperation：gnome 看 cut 前缀，kde 只要标记在（LinuxDragAndDropSupport.java:77-91）', () => {
  assert.equal(isMoveOperation({ hasKdeCutMark: true }), true)
  assert.equal(isMoveOperation({ gnomeContent: 'cut\nfile:///a' }), true)
  assert.equal(isMoveOperation({ gnomeContent: 'copy\nfile:///a' }), false)
  assert.equal(isMoveOperation({}), false)
  assert.equal(isMoveOperation({ gnomeContent: null }), false)
})

// ── 目标可用性判据 ──────────────────────────────────────────────────────────────────

test('落点类别表：每一行都带上游 文件:行号，三档判据都在', () => {
  assert.ok(DROP_TARGET_KINDS.length >= 10)
  const kinds = new Set(DROP_TARGET_KINDS.map(entry => entry.check))
  assert.deepEqual([...kinds].sort(), ['file-list', 'tree-paths'])
  for (const entry of DROP_TARGET_KINDS) {
    assert.ok(/^[^:]+:\d+(-\d+)?$/.test(entry.where), `${entry.kind} 的出处要能指到行：${entry.where}`)
  }
})

test('dropTargetAccepts：外部文件那一档只看 flavor；内部 treePaths 那一档先短路', () => {
  const external = DROP_TARGET_KINDS.find(entry => entry.kind === '编辑器编辑区')
  assert.equal(dropTargetAccepts(external, { transferable: { types: [URI_LIST_FLAVOR] } }), true)
  assert.equal(dropTargetAccepts(external, { transferable: { types: ['text/plain'] } }), false)
  assert.equal(dropTargetAccepts(external, { transferable: { types: [URI_LIST_FLAVOR] }, internalPaths: ['a'] }), true,
    '外部那一档不看 internalPaths')

  const tree = DROP_TARGET_KINDS.find(entry => entry.kind === '项目视图树')
  assert.equal(dropTargetAccepts(tree, { transferable: null, internalPaths: ['a/b'] }), true, '内部拖拽那一支（:88-90）')
  assert.equal(dropTargetAccepts(tree, { transferable: { types: [URI_LIST_FLAVOR] }, internalPaths: null }), true,
    '不是内部拖拽时才判外部文件（:91）')
  assert.equal(dropTargetAccepts(tree, { transferable: { types: ['text/plain'] }, internalPaths: null }), false)
})

test('项目视图落点的动作档：COPY=复制、MOVE/COPY_OR_MOVE=移动、其余 null（ProjectViewDropTarget.java:244-252）', () => {
  assert.equal(projectViewDropHandlerKind(1), 'copy')
  assert.equal(projectViewDropHandlerKind(2), 'move')
  assert.equal(projectViewDropHandlerKind(DND_ACTION_COPY_OR_MOVE), 'move')
  assert.equal(projectViewDropHandlerKind(0x40000000), null, 'LINK 不接受')
  assert.equal(projectViewDropHandlerKind(null), null)
  assert.equal(projectViewDropHandlerKind(undefined), null)
})

// ── 跨窗口那一档（DockManagerImpl.kt:258-327 / DockContainer.java:19-25）──────────────

test('getResponse 择优：第一个能接的赢，都不接 = DENY（DockManagerImpl.kt:258-273）', () => {
  assert.equal(dockResponseFor([DOCK_CONTENT_RESPONSE.DENY, DOCK_CONTENT_RESPONSE.ACCEPT_MOVE]), DOCK_CONTENT_RESPONSE.ACCEPT_MOVE)
  assert.equal(dockResponseFor([DOCK_CONTENT_RESPONSE.ACCEPT_COPY, DOCK_CONTENT_RESPONSE.ACCEPT_MOVE]), DOCK_CONTENT_RESPONSE.ACCEPT_COPY)
  assert.equal(dockResponseFor([DOCK_CONTENT_RESPONSE.DENY, DOCK_CONTENT_RESPONSE.DENY]), DOCK_CONTENT_RESPONSE.DENY)
  assert.equal(dockResponseFor([]), DOCK_CONTENT_RESPONSE.DENY)
})

test('canAccept 只有 DENY 是假（DockContainer.java:22-24）', () => {
  assert.equal(dockResponseCanAccept(DOCK_CONTENT_RESPONSE.ACCEPT_MOVE), true)
  assert.equal(dockResponseCanAccept(DOCK_CONTENT_RESPONSE.ACCEPT_COPY), true)
  assert.equal(dockResponseCanAccept(DOCK_CONTENT_RESPONSE.DENY), false)
})

test('松手：没有容器认领就新建窗口（DockManagerImpl.kt:302-315）', () => {
  assert.equal(dockDropOutcome(null), 'new-window')
  assert.equal(dockDropOutcome(DOCK_CONTENT_RESPONSE.ACCEPT_MOVE), 'into-container')
  assert.equal(dockDropOutcome(DOCK_CONTENT_RESPONSE.ACCEPT_COPY), 'into-container')
})

test('标签拖出：Ctrl 或容器答复制都留下源标签（EditorTabbedContainer.kt:515）', () => {
  assert.equal(dragOutKeepsSource(true, DOCK_CONTENT_RESPONSE.ACCEPT_MOVE), true)
  assert.equal(dragOutKeepsSource(false, DOCK_CONTENT_RESPONSE.ACCEPT_COPY), true)
  assert.equal(dragOutKeepsSource(false, DOCK_CONTENT_RESPONSE.ACCEPT_MOVE), false)
  assert.equal(dragOutKeepsSource(false, DOCK_CONTENT_RESPONSE.DENY), false)
})

// ── 与既有模块连通：清单里加一条文件路径，文件的信任态当场变 ─────────────────────────

test('文件级信任与最近祖先判定连通：加一条文件路径只覆盖它自己', () => {
  const entries = [...fileTrustEntries('D:/work/a.txt', false)]
  assert.equal(trustedStateFor('D:/work/a.txt', entries), 'trusted')
  assert.equal(trustedStateFor('D:/work/b.txt', entries), 'unknown', '同目录的兄弟不受影响')
  const folder = [...fileTrustEntries('D:/work/a.txt', true)]
  assert.equal(trustedStateFor('D:/work/b.txt', folder), 'trusted', '信任整个文件夹才覆盖兄弟')
})