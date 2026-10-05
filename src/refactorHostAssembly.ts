// 桶 1（重构域）的**宿主装配面** —— 上一轮写好的重构模块只有模型与测试、没有生产消费方，
// 这个文件就是那唯一的装配点：`src/App.vue` 里只留 import + 一次调用 + 解构 + 模板行，
// 全部编排逻辑在这里（`tests/module-size.test.mjs` 对 App.vue 的行数上限是唯一权威）。
//
// 接线请求原文：`docs/wiring-requests-2026-10-06-bucket1b.md` A1/A2/A3/A4。
// 请求里写的依赖名有四个在 `src/App.vue` / `src/semanticActions.ts` 里**并不存在**，
// 这里用的是实测到的真实出口（对照表见 `docs/batch-2026-10-06-wiring1.md`）：
//   · `applyEditsToFiles`      → `createSemanticActions()` 的 `applyEditsToFiles`（同名，真的在，App.vue:992）
//   · `renamePreviewOf`        → `src/renamePreview.ts:91` 的同名**纯函数**（不是 createSemanticActions 的出口）
//   · `conflictMessage`        → 本仓真名 `renameConflictMessage`（`src/renamePreview.ts:119`）
//   · `openPreview`            → 本仓真名 `openEditsPreview(label, edits, write)`（`src/semanticActions.ts:658`，
//                                与 `openRefactorPreview` 的区别正是「写盘动作由调用方给」）
//
// **本仓用什么承接了上游的什么**：
//   · 上游 `ChangeSignatureHandler` 的入口 → `refactor.changeSignature` 键位 + 重构菜单那一行；
//   · 上游 `RefactoringDialog` 的「预览 → 重构」→ 既有的 `openEditsPreview` + `RefactorPreviewDialog`；
//   · 上游 `PullUpDialog`/`PushDownDialog` 的 `MemberSelectionPanel` → `RefactorMemberChooserDialog`
//     （勾选表面板次序取 `memberMovePanelTitle()` / `PARAMETER_OBJECT_PANELS`，不另起一套）。
import { ref } from 'vue'
import { request, type LspFileEdits, type LspLocation, type LspReferencesResult, type Workspace } from './bridge.ts'
import { commentStyleFor } from './commentToggle.ts'
import { nonCodeRanges, nonCodeReport } from './nonCodeUsages.ts'
import {
  declarationTarget, defaultSafeDeleteOptions, safeDeletePrompt,
  type SafeDeleteChoice, type SafeDeletePrompt,
} from './safeDelete.ts'
import { renameConflictMessage, renamePreviewOf, type RenamePreview } from './renamePreview.ts'
import { createChangeSignatureFlow, isSignatureSource } from './refactorSignatureFlow.ts'
import {
  KEEP_ABSTRACT_COLUMN, MEMBER_MOVE_TITLES, classMembers, findMemberMoveClasses, memberMoveEdits,
  memberMoveNotice, memberMovePanelTitle, supportsMemberMove,
  type MemberMoveClass, type MemberMoveDirection,
} from './refactorMemberMove.ts'
import {
  KEEP_AS_DELEGATE_LABEL, PARAMETER_OBJECT_PANELS, PARAMETER_OBJECT_TITLE, objectNameFor,
  parameterObjectCommandName, parameterObjectEdits, parseForParameterObject, supportsDelegate,
} from './refactorIntroduceParameterObject.ts'
import type { SignatureFileText } from './refactorSignature.ts'
import type { Tab } from './editorTab.ts'

/** 调用点/成员扫描的工作区文件上限（与 `src/refactorSignatureFlow.ts` 的同一档口径）。 */
export const HOST_SCAN_LIMIT = 200

/** 勾选表的一列（`boolean: true` = 那一格是复选位，上游 `keep.abstract.column.header` 那一列）。 */
export interface ChooserColumn { label: string; boolean?: boolean }
/** 勾选表的一行：`cells` 按列给文本，`checked` 是勾选位，`extra` 是那个布尔列。 */
export interface ChooserRow { id: string; cells: string[]; checked: boolean; extra: boolean; extraEnabled?: boolean }
/** 面板：次序与标题由调用方给（成员搬动两块、引入形参对象三块 = `PARAMETER_OBJECT_PANELS`）。 */
export interface ChooserPanel {
  title: string
  kind: 'text' | 'field' | 'table'
  text?: string
  label?: string
  value?: string
  /** `field` 的候选值（上游 `ClassChooser` 的列表；这里退成可编辑框 + note 里列候选）。 */
  options?: string[]
  columns?: ChooserColumn[]
  rows?: ChooserRow[]
}
/** 上游 `MemberChooser` / `MemberSelectionPanel` 在本仓的等价形态：标题 + 若干面板 + 全局复选 + 确定/取消。 */
export interface RefactorChooserModel {
  title: string
  panels: ChooserPanel[]
  checks: { label: string; checked: boolean; enabled: boolean }[]
  error: string
  note: string
  busy: boolean
}

export interface RefactorHostDeps {
  active: { readonly value: Tab | undefined }
  allTabs: { readonly value: Tab[] }
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => any
  notify: (message: string, error?: boolean) => void
  workspace: () => Workspace | null
  isDesktop: boolean
  languageOf: (path: string) => string
  /** 写盘 + 「更新 N 个文件」那一句（`src/semanticActions.ts:482`）。 */
  applyEditsToFiles: (edits: LspFileEdits[], doneMessage: string) => Promise<number>
  /** 通用重构预览（上游 `RefactoringDialog` 的用法树）；写盘回调由本文件给。 */
  openEditsPreview: (label: string, edits: LspFileEdits[],
    write: (edits: LspFileEdits[]) => Promise<void>) => Promise<void>
  /**
   * 安全删除（A2 的那一半）：删档动作在宿主 App.vue 的 `confirmDelete` 那条链里
   * （`file.delete` + 关标签 + 刷树），本文件只负责**删之前**的那笔用法账与三选一对话框。
   * 树侧入口（`src/treeActions.ts`，桶 14 名下）不在这里动。
   */
  deleteFile: (path: string) => Promise<void> | void
  /** 「查看用法」：把位置交回引用窗口（宿主 `onSemantic({ kind: 'references' })`）。 */
  showUsages: (target: { path: string; line: number; character: number }) => void
  /** 声明符号表：安全删除要先刷新大纲，再按 `declarationTarget` 取那个类符号。 */
  refreshOutline: (path: string) => Promise<unknown>
  outline: () => { name: string; kind: number; startLine: number; startChar: number }[]
}

export function createRefactorHost(deps: RefactorHostDeps) {
  // 冲突文案要的是整份 RenamePreview，而 `ChangeSignatureDeps.conflictMessage` 只声明了
  // `{ conflicts }` 那一半 ⇒ 这里把刚算出来的那一份记住，不重算也不拿类型谎言糊过去。
  let lastPreview: RenamePreview | null = null

  // ── A3 更改签名（Ctrl+F6，`$default.xml:469-471`）────────────────────────────
  const changeSignature = createChangeSignatureFlow({
    active: deps.active,
    findTab: deps.findTab,
    tabs: deps.allTabs,
    editorFor: deps.editorFor,
    notify: deps.notify,
    workspace: () => deps.workspace(),
    isDesktop: deps.isDesktop,
    languageOf: deps.languageOf,
    applyEditsToFiles: deps.applyEditsToFiles,
    renamePreviewOf: edits => { lastPreview = renamePreviewOf(edits); return lastPreview },
    conflictMessage: () => (lastPreview ? renameConflictMessage(lastPreview)
      : '改动清单里有互相覆盖的编辑，已整体拦下，未应用。'),
    openPreview: async (label, edits) => {
      await deps.openEditsPreview(label, edits, async written => {
        await deps.applyEditsToFiles(written, `已应用「${label}」`)
      })
    },
  })
  const openChangeSignature = () => changeSignature.openChangeSignature()

  /**
   * 调用点扫描的文件集（「更改签名」的 `collectFiles` 是私有的，成员上移/引入形参对象
   * 要同一份口径 ⇒ 这里按同一规则再实现一次：打开的缓冲优先拿实时文本，其余读盘，
   * 跳过注释与字符串用的还是 `nonCodeRanges`）。
   */
  async function scanFiles(declPath: string): Promise<{ path: string; text: string; nonCode: { from: number; to: number }[] }[]> {
    const seen = new Map<string, string>()
    for (const tab of deps.allTabs.value) {
      seen.set(tab.path, deps.editorFor(tab.path)?.text?.() ?? tab.content)
    }
    const entries = deps.workspace()?.entries ?? []
    const sources = entries.filter(entry => entry.kind === 'file' && isSignatureSource(entry.path) && !seen.has(entry.path))
    for (const entry of sources.slice(0, HOST_SCAN_LIMIT - seen.size)) {
      try {
        const data = await request<{ content: string }>('file.read', { path: entry.path })
        seen.set(entry.path, data.content)
      } catch { /* 读不到就少扫这一个文件，不猜内容。 */ }
    }
    return [...seen].filter(([path]) => isSignatureSource(path) || path === declPath)
      .map(([path, text]) => ({ path, text, nonCode: nonCodeRanges(text, commentStyleFor(undefined, path)) }))
  }

  // ── A4 成员上移/下移（LangActions.xml:391/392）与引入形参对象（:372）────────────
  // 两者的宿主形态都是上游那一张**勾选表**（`MemberSelectionPanel` / `AbstractIntroduceParameterObjectDialog`
  // 的三块面板），所以共用一个对话框模型 `RefactorChooserModel` 与一个组件。
  const chooser = ref<RefactorChooserModel | null>(null)
  /** 打开勾选表时那一次的上下文（组件无状态，一切回算都在这里）。 */
  let chooserContext: {
    kind: 'move' | 'parameterObject'
    direction?: MemberMoveDirection
    path: string
    text: string
    language: string
    className: string
    parsed?: ReturnType<typeof parseForParameterObject>
    files: SignatureFileText[]
    /** 候选目标类：类名 -> 所在文件与那份文本（上移的父类 / 下推的子类）。 */
    targets: Map<string, { path: string; text: string }>
  } | null = null

  /** 行列 -> 文档内偏移（与 `refactorSignatureFlow.ts` 的同一换算，LSP cursor 是 0 基）。 */
  function offsetOf(text: string, line: number, character: number): number {
    const lines = text.split('\n')
    let offset = 0
    for (let index = 0; index < Math.min(line, lines.length); ++index) offset += lines[index]!.length + 1
    return offset + Math.max(0, character)
  }

  function caretIn(tab: Tab, text: string): number {
    const cursor = deps.editorFor(tab.path)?.getCursor?.()
    return cursor ? offsetOf(text, cursor.line, cursor.ch) : offsetOf(text, (tab.line ?? 1) - 1, (tab.column ?? 1) - 1)
  }

  /** 光标所在的那个类；一个都圈不住时，只有一个类就按它（上游同样以光标处的 PsiClass 为准）。 */
  function classAt(classes: MemberMoveClass[], offset: number): MemberMoveClass | null {
    return classes.find(cls => offset >= cls.from && offset <= cls.bodyTo)
      ?? (classes.length === 1 ? classes[0]! : null)
  }

  /**
   * 找目标类：当前文件 → 打开的标签 → 工作区源文件（有预算，扫不完就在 note 里如实说）。
   * `match` 决定认哪一类边：上移认「名字等于父类名」，下推认「baseName 等于当前类名」。
   */
  async function locateClasses(match: (cls: MemberMoveClass) => boolean, skipPath: string) {
    const found = new Map<string, { path: string; text: string }>()
    const add = (path: string, text: string) => {
      for (const cls of findMemberMoveClasses(text, deps.languageOf(path)))
        if (path !== skipPath && match(cls)) found.set(cls.name, { path, text })
    }
    for (const tab of deps.allTabs.value) { if (tab.path !== skipPath) add(tab.path, deps.editorFor(tab.path)?.text?.() ?? tab.content) }
    const entries = (deps.workspace()?.entries ?? []).filter(entry => entry.kind === 'file' && isSignatureSource(entry.path) && entry.path !== skipPath)
    let truncated = false
    const budget = Math.max(0, HOST_SCAN_LIMIT - deps.allTabs.value.length)
    if (entries.length > budget) truncated = true
    for (const entry of entries.slice(0, budget)) {
      try {
        const data = await request<{ content: string }>('file.read', { path: entry.path })
        add(entry.path, data.content)
      } catch { /* 读不到就少扫这一个文件。 */ }
    }
    return { found, truncated, scanned: Math.min(entries.length, budget) + deps.allTabs.value.length }
  }

  async function openMemberMove(direction: MemberMoveDirection): Promise<void> {
    const tab = deps.active.value
    if (!tab) { deps.notify('请先打开一个文件。', true); return }
    const language = deps.languageOf(tab.path)
    if (!supportsMemberMove(language)) { deps.notify(`「${language}」档没有花括号类成员的文本层落点，不做。`, true); return }
    const text = deps.editorFor(tab.path)?.text?.() ?? tab.content
    const cls = classAt(findMemberMoveClasses(text, language), caretIn(tab, text))
    if (!cls) { deps.notify('光标不在类声明里。请把光标放到要搬成员的那个类中。', true); return }
    if (direction === 'up' && !cls.baseName) { deps.notify(`「${cls.name}」没有父类，无法向上拉取成员。`, true); return }
    const members = classMembers(text, cls)
    if (!members.length) { deps.notify(`「${cls.name}」里没有可搬动的成员。`, true); return }
    // 上移的目标 = 那个父类；下推的目标 = 那些子类。找不到就如实报错，不猜一个。
    const match = direction === 'up'
      ? (candidate: MemberMoveClass) => candidate.name === cls.baseName
      : (candidate: MemberMoveClass) => candidate.baseName === cls.name
    // 先看**同一个文件里**的声明（Java/Kotlin 允许同文件两个类互相继承，上游也认这一种），
    // 再扫其它标签与工作区；同名时以当前文件那份为准（离得最近的那一个）。
    const found = new Map<string, { path: string; text: string }>()
    for (const candidate of findMemberMoveClasses(text, language))
      if (candidate.name !== cls.name && match(candidate)) found.set(candidate.name, { path: tab.path, text })
    const located = await locateClasses(match, tab.path)
    for (const [name, where] of located.found) if (!found.has(name)) found.set(name, where)
    const { truncated, scanned } = located
    if (!found.size) {
      deps.notify(direction === 'up'
        ? `找不到父类「${cls.baseName}」的声明（扫了 ${scanned} 个源码文件）—— 不做猜目标这种事后改不回来的事。`
        : `找不到「${cls.name}」的子类（扫了 ${scanned} 个源码文件）。`, true)
      return
    }
    chooserContext = { kind: 'move', direction, path: tab.path, text, language, className: cls.name, files: await scanFiles(tab.path), targets: found }
    chooser.value = {
      title: MEMBER_MOVE_TITLES[direction],
      panels: [
        { title: memberMovePanelTitle(direction, cls.name), kind: 'field', label: '目标类', value: [...found.keys()][0]!, options: [...found.keys()] },
        {
          title: '成员', kind: 'table',
          columns: [{ label: '成员' }, { label: '种类' }, { label: KEEP_ABSTRACT_COLUMN, boolean: true }],
          rows: members.map(member => ({
            id: member.name, cells: [member.name, member.kind === 'method' ? '方法' : '字段'],
            checked: false, extra: false, extraEnabled: member.kind === 'method',
          })),
        },
      ],
      checks: [],
      error: '',
      note: truncated
        ? `目标类在 ${scanned} 个源码文件里按文本扫描找出（工作区源码文件超过 ${HOST_SCAN_LIMIT} 个，已截断）；勾选表里可能有没列出的候选。`
        : direction === 'up'
          ? `目标类候选：${[...found.keys()].join('、')}（父类「${cls.baseName}」的声明所在文件）。`
          : `目标类候选：${[...found.keys()].join('、')}（「${cls.name}」的子类）。`,
      busy: false,
    }
  }

  /** 勾选表的「确定」：按上下文的种类算编辑，冲突/预览都走既有那条链。 */
  async function applyChooser(): Promise<void> {
    const context = chooserContext
    const model = chooser.value
    if (!context || !model) return
    model.busy = true
    try {
      if (context.kind === 'move') await applyMemberMove(context, model)
      else await applyParameterObject(context, model)
    } finally {
      if (chooser.value) chooser.value = { ...chooser.value, busy: false }
    }
  }

  async function applyMemberMove(context: NonNullable<typeof chooserContext>, model: RefactorChooserModel) {
    const targetName = model.panels[0]?.value?.trim() ?? ''
    const target = context.targets.get(targetName)
    if (!target) { model.error = `找不到类「${targetName}」的声明（候选：${[...context.targets.keys()].join('、')}）。`; return }
    const memberNames = model.panels[1]?.rows?.filter(row => row.checked).map(row => row.id) ?? []
    const keepAbstract = Object.fromEntries((model.panels[1]?.rows ?? []).map(row => [row.id, row.extra]))
    const result = memberMoveEdits({
      direction: context.direction!, language: context.language,
      source: { path: context.path, text: context.text, className: context.className },
      target: { path: target.path, text: target.text, className: targetName },
      memberNames, keepAbstract,
    })
    if (result.errors.length) { model.error = result.errors.join(' '); return }
    if (!result.edits.length) { model.error = `没有搬动任何成员（${result.skipped.length ? `「${result.skipped.join('、')}」目标类里已经有了` : '没有勾选'}）。`; return }
    const label = `${MEMBER_MOVE_TITLES[context.direction!]} ${context.className} → ${result.targetName}`
    await deps.openEditsPreview(label, result.edits, async edits => {
      await deps.applyEditsToFiles(edits, memberMoveNotice(context.direction!, context.className, result.targetName, result))
    })
    closeChooser()
  }

  async function applyParameterObject(context: NonNullable<typeof chooserContext>, model: RefactorChooserModel) {
    const parsed = context.parsed
    if (!parsed) { model.error = '这次会话没能解析出方法声明。'; return }
    const className = model.panels[1]?.value?.trim() ?? ''
    const paramNames = model.panels[2]?.rows?.filter(row => row.checked).map(row => row.id) ?? []
    const keepAsDelegate = model.checks.some(check => check.label === KEEP_AS_DELEGATE_LABEL && check.checked)
    const result = parameterObjectEdits({
      path: context.path, text: context.text, parsed, className, paramNames, keepAsDelegate, files: context.files,
    })
    if (result.errors.length) { model.error = result.errors.join(' '); return }
    if (!result.edits.length) { model.error = '没有可应用的改动。'; return }
    await deps.openEditsPreview(PARAMETER_OBJECT_TITLE, result.edits, async edits => {
      await deps.applyEditsToFiles(edits, parameterObjectCommandName(className, parsed.name))
    })
    closeChooser()
  }

  function closeChooser() { chooser.value = null; chooserContext = null }

  /** 形参类的建议名（**本仓自定的规则**，不冒充上游：上游 `AbstractIntroduceParameterObjectDialog` 预填的具体算法没取证）。 */
  function suggestedParameterClass(methodName: string): string {
    const head = methodName.replace(/[^A-Za-z0-9_$]/g, '')
    return `${head.charAt(0).toUpperCase()}${head.slice(1)}Options`
  }

  async function openIntroduceParameterObject(): Promise<void> {
    const tab = deps.active.value
    if (!tab) { deps.notify('请先打开一个文件。', true); return }
    const language = deps.languageOf(tab.path)
    const text = deps.editorFor(tab.path)?.text?.() ?? tab.content
    const parsed = parseForParameterObject(text, caretIn(tab, text), language)
    if (!parsed) { deps.notify('光标不在可引入形参对象的函数/方法声明上。', true); return }
    if (!parsed.params.length) { deps.notify(`「${parsed.name}」没有形参，没有可打包的东西。`, true); return }
    const files = await scanFiles(tab.path)
    const className = suggestedParameterClass(parsed.name)
    const delegate = supportsDelegate(language)
    chooserContext = { kind: 'parameterObject', path: tab.path, text, language, className: parsed.name, parsed, files, targets: new Map() }
    chooser.value = {
      title: PARAMETER_OBJECT_TITLE,
      // 面板次序 = `PARAMETER_OBJECT_PANELS`（`AbstractIntroduceParameterObjectDialog.java:66-105` 的第 0/1/2 行）。
      panels: [
        { title: PARAMETER_OBJECT_PANELS[0]!, kind: 'text', text: `${parsed.name}(${parsed.params.map(param => param.name).join(', ')})` },
        { title: PARAMETER_OBJECT_PANELS[1]!, kind: 'field', label: '类名', value: className },
        {
          title: PARAMETER_OBJECT_PANELS[2]!, kind: 'table',
          columns: [{ label: '类型' }],
          rows: parsed.params.map(param => ({ id: param.name, cells: [param.type || objectNameFor(parsed.params, className)], checked: false, extra: false, extraEnabled: false })),
        },
      ],
      // 「使方法保持为委托」只在有重载的语言档上给（`supportsDelegate`），其余档连复选框都不出现。
      checks: delegate ? [{ label: KEEP_AS_DELEGATE_LABEL, checked: false, enabled: true }] : [],
      error: '',
      note: `调用点与「更改签名」同一份扫描（${files.length} 个源码文件）；${PARAMETER_OBJECT_PANELS[2]} 里没勾的形参留在参数表里。`,
      busy: false,
    }
  }

  function setChooserField(panel: number, value: string) {
    const model = chooser.value
    if (model?.panels[panel]) model.panels[panel]!.value = value
  }
  function toggleChooserRow(panel: number, row: number) {
    const model = chooser.value
    const entry = model?.panels[panel]?.rows?.[row]
    if (entry) entry.checked = !entry.checked
  }
  function toggleChooserExtra(panel: number, row: number) {
    const model = chooser.value
    const entry = model?.panels[panel]?.rows?.[row]
    if (entry && entry.extraEnabled !== false) entry.extra = !entry.extra
  }
  function toggleChooserCheck(index: number) {
    const model = chooser.value
    const entry = model?.checks[index]
    if (entry) entry.checked = !entry.checked
  }

  // ── A2 安全删除的三选一（Alt+Delete，`$default.xml:999-1001`）───────────────────
  // 上游 `SafeDeleteProcessor.java:449-464` 先算用法账，`UnsafeUsagesDialog.java:35-58` 再弹三选一。
  // 本仓同一笔账 = 语言服务的代码引用 + 注释/字符串里的字面出现（`src/nonCodeUsages.ts`）；
  // 删档本身走宿主既有那条链（App.vue 的 `confirmDelete`：`file.delete` + 关标签 + 刷树），
  // **树侧那个入口（`src/treeActions.ts`，桶 14 名下）一个字没动** —— 这里只是重构菜单/快捷键
  // 这一侧的入口，两个入口共用同一份删档实现。
  const safeDelete = ref<{ prompt: SafeDeletePrompt; path: string; target: { line: number; character: number } | null } | null>(null)

  function fileStem(path: string): string { return (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '') }

  async function openSafeDelete(tab?: Tab): Promise<void> {
    const file = tab ?? deps.active.value
    if (!file) { deps.notify('请先打开一个文件。', true); return }
    if (!deps.isDesktop) { deps.notify('安全删除要桌面宿主（要读盘算账、要删档）。', true); return }
    const name = file.path.split('/').pop() ?? file.path
    await deps.refreshOutline(file.path)
    let refs: LspLocation[] = []
    let target: { line: number; character: number } | null = null
    const declaration = declarationTarget(file.path, deps.outline())
    if (declaration) {
      target = { line: declaration.startLine, character: declaration.startChar }
      try {
        const result = await request<LspReferencesResult>('lsp.request',
          { kind: 'references', path: file.path, line: declaration.startLine, character: declaration.startChar })
        refs = result.available ? (result.refs ?? []) : []
      } catch { /* 语言服务不可用：代码引用那一半账就是空的，对话框里如实写着。 */ }
    }
    // 选项取 `defaultSafeDeleteOptions()`（`SafeDeleteDialog.java:163-165` 的两个框新建为真）；
    // 「搜索文本匹配项」在本仓默认**关**（`src/safeDelete.ts:101` 的既定口径，见接线请求「不做」第 1 条）。
    // `nonCodeReport` 认的是 `FileText{path,text,style}` —— style 必须给，否则注释那一半扫不出来
    //（字符串照样能出，所以少了这一句只会**漏报注释**，是静默的错误账）。
    const scanned = await scanFiles(file.path)
    const nonCode = nonCodeReport(scanned.map(entry => ({
      path: entry.path, text: entry.text, style: commentStyleFor(undefined, entry.path),
    })), fileStem(file.path))
    const prompt = safeDeletePrompt(name, refs, nonCode, defaultSafeDeleteOptions())
    // 一笔用法都没有 ⇒ 上游也是直接删，不弹框（`SafeDeleteProcessor` 只在有问题时进 inuse 分支）。
    if (!prompt.blocked) { await runDelete(file.path); return }
    safeDelete.value = { prompt, path: file.path, target }
  }

  async function runDelete(path: string): Promise<void> {
    safeDelete.value = null
    await deps.deleteFile(path)
  }

  /**
   * 三选一的分派。默认项是「查看用法」（`UnsafeUsagesDialog.java:41-47` + `:98` 的
   * `DEFAULT_ACTION`）⇒ 组件里回车落这一格；「仍然删除」才真的删。
   */
  function safeDeleteChoose(choice: SafeDeleteChoice): void {
    const current = safeDelete.value
    if (!current) return
    if (choice === 'cancel') { safeDelete.value = null; return }
    if (choice === 'deleteAnyway') { void runDelete(current.path); return }
    if (!current.target) { deps.notify('这次没有可跳转的代码引用位置（注释/字符串里的字面出现不进引用窗口）。', true); return }
    safeDelete.value = null
    deps.showUsages({ path: current.path, line: current.target.line, character: current.target.character })
  }

  function closeSafeDelete() { safeDelete.value = null }

  return {
    changeSignature, openChangeSignature,
    /** 对话框的可见状态（App.vue 顶层解构出来，模板里才会自动拆 ref）。 */
    changeSignatureState: changeSignature.changeSignatureState,
    /** 给 A4 的编排用（成员上移/下移、引入形参对象共享同一份工作区扫描）。 */
    scanFiles,
    chooserState: chooser,
    openPullUp: () => openMemberMove('up'),
    openPushDown: () => openMemberMove('down'),
    openIntroduceParameterObject,
    closeChooser, applyChooser, setChooserField, toggleChooserRow, toggleChooserExtra, toggleChooserCheck,
    safeDeleteState: safeDelete, openSafeDelete, safeDeleteChoose, closeSafeDelete,
  }
}
