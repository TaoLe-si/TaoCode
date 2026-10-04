// 「复制路径/引用…」那一组（上游 `CopyReferencePopupGroup`）的**全部入口与文案**。
//
// **三个宿主**（上游都注册着，逐条核过 `PlatformActions.xml`）：
//   · 编辑菜单：`:445` 的 `EditMenu` → `:450` 的 `CutCopyPasteGroup`，而 `:1279`
//     `<add-to-group group-id="CutCopyPasteGroup" anchor="after" relative-to-action="CopyPaths"/>`
//     —— 即插在 `CopyPaths` 之后（本仓的 `CopyPaths` 按源码**不渲染菜单行**，见 `src/menus/editMenu.ts`
//     的说明，所以这一组在编辑菜单里紧跟在「复制」之后）；
//   · 编辑器标签右键：`:1280` 同样加进 `EditorTabPopupMenu`（本仓标签右键是手写模板且 App.vue 贴着行数上限，
//     目前只有一条「复制路径」，**缺口已记进判决书**）；
//   · 查找结果右键：`:1330-1332` 的 `FindInFiles.Results.ContextMenu` 里只有这一条引用（第一百零六批已落）。
//
// 而 `CopyReferencePopupGroup`（`:1266-1281`，`popup="true"`）里是：
//   `CopyFileReference` 组 → 绝对路径 · 文件名 · (分隔) · 带行号的路径 · 来自内容根的路径 · 来自源根的路径
//   `CopyExternalReferenceGroup` 组 → 工具箱 URL
// 组名取 `group.CopyReferencePopupGroup.text` = 「复制路径/引用…」（`ActionsBundle.properties:2561`）。
//
// 每条文案取随 IDE 发货的中文包（`ActionsBundle.properties`）：
//   `:334` 绝对路径 / `:342` 文件名 / `:343` 带行号的路径 / `:339` 来自内容根的路径。
//
// 各条的实现口径（逐条核过 `platform/lang-impl/src/com/intellij/ide/actions/CopyPathProvider.kt`）：
//   · 绝对路径   `CopyAbsolutePathProvider:117` → `virtualFile.presentableUrl`
//                （本仓用工作区根 + 相对路径拼，与项目视图/标签页右键那条「复制路径」同一口径）
//   · 文件名     `CopyFileNameProvider` → 取文件名本身
//   · 带行号的路径 `CopyFileWithLineNumberPathProvider:133-139` → `FqnUtil.getVirtualFileFqn(...) + ":" + 行号`；
//                `FqnUtil.getVirtualFileFqn`（`platform/refactoring/.../FqnUtil.java:59-73`）先问语言提供的
//                限定名，问不到就退回**相对基目录的路径**——本仓没有语言限定名这一层，
//                走的就是那条退路：工作区相对路径 + `:` + 行号
//   · 来自内容根的路径 `CopyContentRootPathProvider:121-129` → 相对内容根的路径（本仓的内容根 = 工作区根）
//
// **两条不做，理由如下**（判决书 §C 同款，不留假菜单项）：
//   · 「来自源根的路径」（`CopySourceRootPathProvider:143-148`）要**源根**模型
//     （`ProjectFileIndex.getSourceRootForFile`）。本仓的文件与语言的关系由 LSP 管，
//     工程里没有"源码根"这一层 —— 做了就是发明一个不存在的概念。
//   · 「工具箱 URL」（`CopyTBXReferenceProvider:151-157` → `CopyTBXReferenceAction.createJetBrainsLink`）
//     生成的是 JetBrains Toolbox 的 `jetbrains://` 链接。本仓不是 JetBrains 那条产品线，
//     生成这种链接对用户没有意义。

/** 复制那一组的组名（`group.CopyReferencePopupGroup.text`）。 */
export const COPY_REFERENCE_GROUP = '复制路径/引用…'

/** 一次复制的对象：某个文件里的一个位置（行号 1 基）。 */
export interface FindResultTarget { path: string; line: number }

export type FindCopyActionId = 'absolute' | 'fileName' | 'pathWithLine' | 'contentRootPath'

export interface FindCopyAction {
  id: FindCopyActionId
  /** 菜单行文案（上游 `action.Copy*.text`）。 */
  label: string
}

/**
 * 菜单顺序与上游 `CopyFileReference` 组一致（绝对路径 · 文件名 · (分隔) · 带行号的路径 · 来自内容根的路径 ·
 * 来自源根的路径）。本仓少了最后一条（要源根模型，见文件头）。
 */
export const FIND_COPY_ACTIONS: readonly FindCopyAction[] = [
  { id: 'absolute', label: '绝对路径' },
  { id: 'fileName', label: '文件名' },
  { id: 'pathWithLine', label: '带行号的路径' },
  { id: 'contentRootPath', label: '来自内容根的路径' },
]

/** 绝对路径：工作区根 + 相对路径（与 `src/explorerActions.ts` 的「复制路径」同一拼法）。 */
export function absoluteResultPath(target: FindResultTarget, root: string): string {
  return root ? `${root}/${target.path}` : target.path
}

/** 文件名（最后一段）。 */
export function resultFileName(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * 带行号的路径：`<相对路径>:<行号>`（上游 `FqnUtil` 问不到语言限定名时的退路 + `":" + 行号`）。
 * 行号是 1 基 —— 结果里的 `line` 本来就是 1 基。
 */
export function resultPathWithLine(target: FindResultTarget): string {
  return `${target.path}:${target.line}`
}

/** 一条复制动作最终写进剪贴板的文本。 */
export function findResultClipboardText(action: FindCopyActionId, target: FindResultTarget, root: string): string {
  switch (action) {
    case 'absolute': return absoluteResultPath(target, root)
    case 'fileName': return resultFileName(target.path)
    case 'pathWithLine': return resultPathWithLine(target)
    case 'contentRootPath': return target.path
  }
}

/**
 * 这一组的**菜单行**（给 `menuUi` 的 `popupExtras` 用：这些动作只在菜单里出现，
 * 不在主菜单索引里）。`target()` 返回 null 时整组禁用 —— 上游 `CopyPathProvider` 对
 * "没有 VirtualFile / 没有 editor"的场合返回 null，动作因此不可用。
 */
export function copyPathMenuRows(deps: {
  target: () => FindResultTarget | null
  root: () => string
  copy: (text: string) => void
}): { id: string; title: string; enabled: () => boolean; run: () => void }[] {
  return FIND_COPY_ACTIONS.map(action => ({
    id: `copyPath.${action.id}`,
    title: action.label,
    enabled: () => deps.target() !== null,
    run: () => {
      const target = deps.target()
      if (target) deps.copy(findResultClipboardText(action.id, target, deps.root()))
    },
  }))
}
