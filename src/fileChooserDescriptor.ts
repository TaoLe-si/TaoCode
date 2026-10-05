// 文件/目录选择的**描述件语义**（上游 `platform/ide-core/src/com/intellij/openapi/fileChooser/`：
// `FileChooserDescriptor.java` 的 chooseFiles/chooseFolders/chooseMultiple/roots/extensionFilter，
// 与 `FileChooserDescriptorFactory.java` 的一组预设）。
//
// 本仓宿主没有桌面对话框树：每次选择是一次落盘的 Win32 调用（`native/dialogs.cpp` 的
// `dialog.pickFile`/`dialog.pickDirectory`，参数只有 title/filters/initial）。所以这里只实现
// **能落到这两条宿主参数与返回校验上的那部分** —— 描述件决定：
//   · 用哪个宿主方法（选文件还是选目录，上游 `FileChooserAction` 的形态在这里折叠成方法名）；
//   · `withExtensionFilter(label, extensions)` 折算成宿主过滤串，形如
//     `插件包 (*.zip;*.jar)|*.zip;*.jar|所有文件 (*.*)|*.*`（与 `src/projectExtras.ts` 里手写的同形）；
//   · 选完对返回路径做「可选中」复核（文件/目录、扩展名、根约束），不合格报错而不是静默接受。
//
// 明确不做（上游有、本子集没有，族判词里同样点名）：多选（宿主是一趟单选，`chooseMultiple` 只留在
// 描述件上供文案/校验用）、`FileElement` 树形浏览与 `FileChooserDialogImpl`、`FileChooserAction`
// 的弹层形态、`UniversalFileChooserContributor` 插件贡献点、jar **内部**条目选择
// （`isChooseJarContents` 只做到"归档本身可选"，`isFileSelectable` 里 `isArchive(file)` 那一支
// 指的是选中归档后展开它的内容 —— 宿主没有这条通道）。
//
// 本批补的：**隐藏/忽略项的可见性与可选性**（上游 `FileChooserDescriptor.isFileVisible` :296-320 /
// `isHidden` :341-343 / `isFileSelectable` :326-337 + `FileElement.isFileHidden` :89-94），
// 忽略清单直接查 `src/fileTypeRegistry.ts` 的 `isFileIgnored` —— 这正是上游 `:310` 那一句
// `isHideIgnored() && FileTypeManager.getInstance().isFileIgnored(file)`。
// 宿主补不了这一段（Win32 `IFileDialog` 按通配符列目录、不带掩码），所以落在**选后复核**上。

import { fileTypeManager } from './fileTypeRegistry.ts'
import { checkOverwrite, type ChooserListing } from './fileChooserModel.ts'

/** 路径统一按 `/` 存放（与工作区其余部分一致），显示时由调用方决定分隔符。 */
const normalize = (path: string) => path.replace(/\\/g, '/')

export interface FileTypeFilter {
  /** 过滤条目的标签（上游 `withExtensionFilter(label, …)` 的 label，显示在宿主文件类型下拉里）。 */
  label: string
  /** 小写扩展名（不含点）；空数组表示不过滤。 */
  extensions: readonly string[]
}

export interface FileChooserDescriptor {
  /** 对话框标题（上游 `withTitle`）。 */
  title: string
  /** 选项说明（上游 `withDescription`；本仓没有对话框内说明区，保留给调用方做提示文案）。 */
  description: string
  chooseFiles: boolean
  chooseFolders: boolean
  /** 允许选中归档内部条目（上游 `isChooseJarContents`）。默认 false。 */
  chooseJarContents: boolean
  /** 上游 `isChooseMultiple`。宿主一趟只选一个，这里作为校验/文案口径保留。 */
  chooseMultiple: boolean
  /** 上游 `withRoots`：可选中路径必须落在这些根之下（空数组 = 不限制）。 */
  roots: readonly string[]
  /** 上游 `withExtensionFilter`：只对文件生效，大小写不敏感。 */
  extensionFilter: FileTypeFilter | null
  /**
   * 隐藏被忽略清单命中的文件（上游 `isHideIgnored`，`FileChooserDescriptor.java:60` 默认 **true**，
   * `:167-177` 是它的取值与 `withHideIgnored`）。消费点在 `isFileVisible`。
   */
  hideIgnored: boolean
  /** 显示隐藏文件/以点开头的名字（上游 `isShowHiddenFiles`，`:64` 默认 false，`:225-231`）。 */
  showHiddenFiles: boolean
}

// ── FileChooserDescriptorFactory 的预设（名字与上游一一对应）────────────────────────────

/**
 * 一张新描述件的公共底座。`hideIgnored` 的默认值 **true** 是上游的默认
 * （`platform/ide-core/src/com/intellij/openapi/fileChooser/FileChooserDescriptor.java:60`
 * `private boolean myHideIgnored = true;`），`showHiddenFiles` 默认 false（同文件 `:64`）。
 */
function descriptorBase(): Omit<FileChooserDescriptor, 'title' | 'chooseFiles' | 'chooseFolders'> {
  return {
    description: '', chooseJarContents: false, chooseMultiple: false,
    roots: [], extensionFilter: null, hideIgnored: true, showHiddenFiles: false,
  }
}

/** `FileChooserDescriptorFactory.singleFile()`。 */
export function singleFileDescriptor(): FileChooserDescriptor {
  return { ...descriptorBase(), title: '选择文件', chooseFiles: true, chooseFolders: false }
}

/** `FileChooserDescriptorFactory.singleDir()`。 */
export function singleDirDescriptor(): FileChooserDescriptor {
  return { ...descriptorBase(), title: '选择目录', chooseFiles: false, chooseFolders: true }
}

/** `FileChooserDescriptorFactory.singleFileOrDir()`。 */
export function singleFileOrDirDescriptor(): FileChooserDescriptor {
  return { ...descriptorBase(), title: '选择文件或目录', chooseFiles: true, chooseFolders: true }
}

/** `FileChooserDescriptorFactory.multiFiles()`（宿主单选，`chooseMultiple` 只登记语义）。 */
export function multiFilesDescriptor(): FileChooserDescriptor {
  return { ...singleFileDescriptor(), title: '选择文件（可多选）', chooseMultiple: true }
}

/** `FileChooserDescriptorFactory.multiDirs()`。 */
export function multiDirsDescriptor(): FileChooserDescriptor {
  return { ...singleDirDescriptor(), title: '选择目录（可多选）', chooseMultiple: true }
}

/** `FileChooserDescriptorFactory.multiFilesOrDirs()`。 */
export function multiFilesOrDirsDescriptor(): FileChooserDescriptor {
  return { ...singleFileOrDirDescriptor(), title: '选择文件或目录（可多选）', chooseMultiple: true }
}

/** `createSingleFileDescriptor(extension)`：单扩展名的便捷形态，标签按上游取大写扩展名。 */
export function singleFileDescriptorOfExtension(extension: string): FileChooserDescriptor {
  return withExtensionFilter(singleFileDescriptor(), `${extension.replace(/^\./, '').toUpperCase()} 文件`, [extension])
}

/** `createSingleFileOrFolderDescriptor(extension)`。 */
export function singleFileOrFolderDescriptorOfExtension(extension: string): FileChooserDescriptor {
  return withExtensionFilter(singleFileOrDirDescriptor(), `${extension.replace(/^\./, '').toUpperCase()} 文件`, [extension])
}

/**
 * `FileChooserDescriptorFactory.createAllButJarContentsDescriptor()`（`…/FileChooserDescriptorFactory.java:68`）
 * 与 `multiJarsOrDirs()`（`:62`）合流：可多选、可选文件/目录，且**允许选中归档本身**。
 * 归档内部条目仍不可选（`isFileSelectable` 的 `isChooseJarContents && isArchive(file)` 只在
 * 「选中的那个就是归档」时成立，本仓的归档是磁盘上的 `.zip/.jar`，`file.readBinary` 读不了它内部）。
 */
export function createAllButJarContentsDescriptor(multiple = true): FileChooserDescriptor {
  const base = multiple ? multiFilesOrDirsDescriptor() : singleFileOrDirDescriptor()
  return withTitle({ ...base, chooseJarContents: true }, multiple ? '选择文件、目录或归档（可多选）' : '选择文件、目录或归档')
}

// ── with* 构造器（与上游同名；返回新对象，避免隐式共享）─────────────────────────────────

export function withTitle(descriptor: FileChooserDescriptor, title: string): FileChooserDescriptor {
  return { ...descriptor, title }
}

export function withDescription(descriptor: FileChooserDescriptor, description: string): FileChooserDescriptor {
  return { ...descriptor, description }
}

export function withRoots(descriptor: FileChooserDescriptor, roots: readonly string[]): FileChooserDescriptor {
  return { ...descriptor, roots: roots.map(normalize).filter(Boolean) }
}

/** `withHideIgnored`（`FileChooserDescriptor.java:175-177`）。 */
export function withHideIgnored(descriptor: FileChooserDescriptor, hideIgnored: boolean): FileChooserDescriptor {
  return { ...descriptor, hideIgnored }
}

/** `withShowHiddenFiles`（`FileChooserDescriptor.java:229-231`）。 */
export function withShowHiddenFiles(descriptor: FileChooserDescriptor, showHiddenFiles: boolean): FileChooserDescriptor {
  return { ...descriptor, showHiddenFiles }
}

/** `withChooseJarContents` 的等价入口（上游在 `FileChooserDescriptor` 的构造器里，`:108`）。 */
export function withChooseJarContents(descriptor: FileChooserDescriptor, chooseJarContents: boolean): FileChooserDescriptor {
  return { ...descriptor, chooseJarContents }
}

/** 上游 `withExtensionFilter(label, extensions…)`：扩展名统一去掉前导点并转小写。 */
export function withExtensionFilter(descriptor: FileChooserDescriptor, label: string, extensions: readonly string[]): FileChooserDescriptor {
  const normalized = extensions.map(extension => extension.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
  return { ...descriptor, extensionFilter: normalized.length ? { label, extensions: normalized } : null }
}

// ── 宿主参数折算与返回校验 ───────────────────────────────────────────────────────────

export type FileChooserHostMethod = 'dialog.pickFile' | 'dialog.pickDirectory'

/** 描述件 → 宿主方法。两条都不可选（构造错了）时抛出，避免静默退化成选文件。 */
export function chooseHostMethod(descriptor: FileChooserDescriptor): FileChooserHostMethod {
  if (descriptor.chooseFiles) return 'dialog.pickFile'
  if (descriptor.chooseFolders) return 'dialog.pickDirectory'
  throw new Error('文件选择描述件没有声明可选的类型（至少 chooseFiles 或 chooseFolders 之一）。')
}

/** 宿主过滤串：`标签 (模式)|模式|…`。`|` 是宿主的分隔符，标签里出现时替换成 `/`。 */
export function hostFilterSpec(descriptor: FileChooserDescriptor): string {
  const filter = descriptor.extensionFilter
  if (!filter || !filter.extensions.length) return '所有文件 (*.*)|*.*'
  const patterns = filter.extensions.map(extension => `*.${extension}`).join(';')
  const label = filter.label.replace(/\|/g, '/').trim() || patterns
  return `${label} (${patterns})|${patterns}|所有文件 (*.*)|*.*`
}

/** 路径的扩展名（小写、不含点）；没有扩展名返回空串。 */
export function fileExtensionOf(path: string): string {
  const name = normalize(path).split('/').pop() ?? ''
  const index = name.lastIndexOf('.')
  // 前导点（`.gitignore`）与结尾点都不算扩展名。
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : ''
}

/** 扩展名命中过滤（大小写不敏感）；没有配过滤件时一律通过。 */
export function matchesExtensionFilter(descriptor: FileChooserDescriptor, path: string): boolean {
  const filter = descriptor.extensionFilter
  if (!filter || !filter.extensions.length) return true
  return filter.extensions.includes(fileExtensionOf(path))
}

/** 路径是否落在某个根之下（边界安全：`/work` 不匹配 `/workshop`）。 */
export function isUnderRoots(path: string, roots: readonly string[]): boolean {
  if (!roots.length) return true
  const target = normalize(path)
  return roots.some(raw => {
    const root = normalize(raw).replace(/\/+$/, '')
    return Boolean(root) && (target === root || target.startsWith(`${root}/`))
  })
}

/** 路径的基名（`FileElement.getName`/`getPath` 那侧的取名，`:41`/`:45`）。 */
export function fileNameOf(path: string): string {
  return normalize(path).split('/').pop() ?? ''
}

/** 归档扩展名（`FileElement.isArchive`，`…/fileChooser/FileElement.java:85-87,106`）。 */
const ARCHIVE_EXTENSIONS = new Set(['zip', 'jar', 'war', 'ear', 'aar', 'apk', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar'])

/** 这个文件是不是归档（`FileElement.isArchive`）。 */
export function isArchivePath(path: string): boolean {
  return ARCHIVE_EXTENSIONS.has(fileExtensionOf(path))
}

/**
 * `FileElement.isFileHidden`（`platform/ide-core/src/com/intellij/openapi/fileChooser/FileElement.java:89-94`）：
 * 隐藏属性 **或** 以点开头的名字。**不接受**"非隐藏位"这个入参 —— Win32 的 `IFileDialog`
 * 不回传 `FILE_ATTRIBUTE_HIDDEN`，所以本仓只能判以点开头那一半（`hidden?: boolean` 是
 * 调用方从 `Entry` 上拿到的宿主标记，有就一起算）。
 */
export function isFileHidden(name: string, hidden?: boolean): boolean {
  return hidden === true || name.startsWith('.')
}

/**
 * `FileChooserDescriptor.isFileVisible`（`…/fileChooser/FileChooserDescriptor.java:296-320`）+ `isHidden`（`:341-343`）：
 * 隐藏/以点开头 **或** `isHideIgnored() && FileTypeManager.getInstance().isFileIgnored(file)`。
 * 忽略清单那一项就是本族判词里「隐藏/忽略文件过滤」的上游落点。
 */
export function isFileVisible(descriptor: FileChooserDescriptor, name: string, hidden?: boolean): boolean {
  if (descriptor.hideIgnored && fileTypeManager.isFileIgnored(name)) return false
  if (!descriptor.showHiddenFiles && isFileHidden(name, hidden)) return false
  return true
}

/**
 * `FileChooserDescriptor.isFileSelectable`（同文件 `:326-337`）的宿主侧子集：目录看 `isChooseFolders`，
 * 文件要过过滤件，再看 `isChooseFiles || isChooseJarContents && isArchive(file)`。
 * `hidden`/`ignored` 那两半是 `isFileVisible` 的职责（可见 ≠ 可选），这里不再重复。
 */
export function isFileSelectable(descriptor: FileChooserDescriptor, path: string, kind: 'file' | 'directory', hidden?: boolean): boolean {
  if (!path || !path.trim()) return false
  if (kind === 'directory') return descriptor.chooseFolders
  if (!isFileVisible(descriptor, fileNameOf(path), hidden)) return false
  if (!matchesExtensionFilter(descriptor, path)) return false
  return descriptor.chooseFiles || (descriptor.chooseJarContents && isArchivePath(path))
}

/**
 * 「可选中」复核（上游 `isFileSelectable` 的宿主侧子集 + `validateSelectedFiles`，`:378-380`）。
 * `kind` 由调用方按宿主方法给出；返回 null 表示通过，否则是给用户看的拒绝原因。
 *
 * **隐藏/忽略这一段是宿主补不了的**：Win32 的 `IFileDialog` 自己按通配符列目录，不带掩码
 * （`native/dialogs.cpp` 的 `pick_file` 只 `SetFileTypes`，没有过滤层），所以选完之后
 * 在这里复核并说明为什么被拒 —— 不静默接受。
 */
export function selectionProblem(descriptor: FileChooserDescriptor, path: string, kind: 'file' | 'directory', hidden?: boolean): string | null {
  if (!path || !path.trim()) return '没有选择任何路径。'
  if (kind === 'directory' && !descriptor.chooseFolders) return `「${descriptor.title}」只能选文件，不能选目录。`
  if (kind === 'file' && !descriptor.chooseFiles && !(descriptor.chooseJarContents && isArchivePath(path)))
    return `「${descriptor.title}」只能选目录，不能选文件。`
  if (!isUnderRoots(path, descriptor.roots)) return `所选路径不在限定范围（${descriptor.roots.join('、')}）之内。`
  if (kind === 'file') {
    const name = fileNameOf(path)
    if (descriptor.hideIgnored && fileTypeManager.isFileIgnored(name))
      return `所选文件「${name}」在忽略清单里（${fileTypeManager.getIgnoredFilesList() || '空清单'}），按设置不参与选择。`
    if (!descriptor.showHiddenFiles && isFileHidden(name, hidden))
      return `所选文件「${name}」是隐藏文件，本对话框不显示隐藏项。`
    if (!matchesExtensionFilter(descriptor, path)) {
      const filter = descriptor.extensionFilter
      const patterns = filter ? filter.extensions.map(extension => `*.${extension}`).join('、') : ''
      return `所选文件不符合「${filter?.label ?? '扩展名'}」过滤（${patterns}）。`
    }
  }
  return null
}

/** 描述件的一句话说明（上游标题栏/说明栏折叠成一行，给通知与提示用）。 */
export function describeDescriptor(descriptor: FileChooserDescriptor): string {
  const kinds = [descriptor.chooseFiles ? '文件' : '', descriptor.chooseFolders ? '目录' : ''].filter(Boolean).join('或')
  const multiple = descriptor.chooseMultiple ? '，可多选' : ''
  const archives = descriptor.chooseJarContents ? '或归档' : ''
  const filter = descriptor.extensionFilter ? `，过滤 ${descriptor.extensionFilter.extensions.map(extension => `*.${extension}`).join('/')}` : ''
  const hidden = descriptor.showHiddenFiles ? '，显示隐藏项' : ''
  return `${descriptor.title}：选择${kinds}${archives}${multiple}${filter}${hidden}`
}

/** `chooseWithDescriptor` 的宿主接口（生产端是 `request('dialog.pickFile' | 'dialog.pickDirectory')`）。 */
export interface FileChooserHost {
  pickFile: (params: { title: string; filters: string; initial: string }) => Promise<string | null>
  pickDirectory: (params: { title: string; initial: string }) => Promise<string | null>
}

/**
 * 按描述件打开宿主对话框并复核结果。
 * 取消（宿主返回 null）不算失败，原样返回 null；选中但不符合描述件时抛错，由调用方提示。
 */
export async function chooseWithDescriptor(host: FileChooserHost, descriptor: FileChooserDescriptor, initial = ''): Promise<string | null> {
  const method = chooseHostMethod(descriptor)
  const path = method === 'dialog.pickFile'
    ? await host.pickFile({ title: descriptor.title, filters: hostFilterSpec(descriptor), initial })
    : await host.pickDirectory({ title: descriptor.title, initial })
  if (path === null) return null
  const problem = selectionProblem(descriptor, path, method === 'dialog.pickFile' ? 'file' : 'directory')
  if (problem) throw new Error(problem)
  return path
}

// ── 覆盖确认的宿主侧接线（`src/fileChooserModel.ts` 的 `checkOverwrite`）────────────

/** 选完之后要写盘时，问的那两句（覆盖 + 大小写冲突）的宿主侧封装。 */
export interface OverwriteHost {
  /** 列出目标所在目录（宿主 `workspace.list`）；列不到就给 null（那一问如实说判不了）。 */
  listDirectory: (path: string) => Promise<ChooserListing | null>
  /** 问用户「已存在，要替换吗」。true = 替换。 */
  confirm: (question: string) => Promise<boolean>
}

/**
 * 写盘之前的覆盖确认：**没有这一步就不许写**。
 *
 * 上游是 `FileChooserDialog` 选完之后的那一串确认（已存在 → 替换？；同名不同大小写 → 仍是同一个文件），
 * 本仓把它收成 `checkOverwrite`（`src/fileChooserModel.ts`）的一次判定 + 一次 `confirm`。
 * 判定说「不需要确认」时直接放行；用户答否时返回 false 让调用方放弃写入。
 */
export async function confirmOverwrite(host: OverwriteHost, targetPath: string): Promise<boolean> {
  const slash = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
  const directory = slash > 0 ? targetPath.slice(0, slash) : ''
  const check = checkOverwrite(await host.listDirectory(directory), targetPath)
  if (!check.needsConfirmation) return true
  return host.confirm(check.question)
}
