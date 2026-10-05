// 按包名/带分隔符的路径新建目录 —— 上游
//   · `platform/lang-impl/src/com/intellij/ide/actions/CreateDirectoryOrPackageAction.java`
//   · `platform/lang-impl/src/com/intellij/ide/actions/CreateDirectoryOrPackageHandler.java`
//     （分隔符可配；`~`（首个）、`.`、`..` 都认；错误与警告分两个口）
//   · `platform/lang-impl/src/com/intellij/ide/actions/CreatePackageHandler.java`
//     （`.` 分隔 + 包名合法性 + 「已存在」判定 + 输入框预填文本）
// 真正建目录的遍历在 `platform/lang-impl/src/com/intellij/ide/util/DirectoryUtil.java:103-136`
// 的 `createSubdirectories`（`lp/ide-shell` 的 `DirectoryUtil`）。
//
// 本仓现状：新建目录/文件只走 `src/explorerActions.ts` 的**单个固定名字**，
// 不推导包名、也不认「a/b/c」这种一串子目录 —— 判词里 `lp/ide-actions` 记的
// 「`CreateDirectoryOrPackageAction`/`CreatePackageHandler` 按包路径建目录，本仓建目录不推导包名」。
// 这个模块把那三条规则落成纯函数：校验（error/warning 两级）→ 要建哪几级目录 → 名字像文件时的改建议。
//
// **没有宿主**：新建对话框在 `src/App.vue`（本批冻结），所以这里只出规则与文案，
// 按钮不渲染（playbook §3）。文案中文是本仓口径，英文原文与 bundle key 记在常量注释里。

/** 上游 `IdeBundle.properties` 的英文原文（`platform/platform-api/resources/messages/IdeBundle.properties`）。 */
export const CREATE_BUNDLE = {
  // L357 ''{0}'' is an invalid directory name
  invalidDirectoryName: (token: string) => `“${token}” 不是合法的目录名`,
  // L358 Invalid package name; it's impossible to create a Java class inside
  invalidPackageName: '非法的包名：无法在里面创建 Java 类',
  // L359 Invalid package name format; it's impossible to create a Java class inside
  invalidPackageNameFormat: '非法的包名格式：无法在里面创建 Java 类',
  // L360 A file with the name ''{0}'' already exists
  fileAlreadyExists: (token: string) => `已存在同名文件：${token}`,
  // L361 A directory with the name ''{0}'' already exists
  directoryAlreadyExists: (token: string) => `已存在同名目录：${token}`,
  // L362 A package with the name ''{0}'' already exists
  packageAlreadyExists: (token: string) => `已存在同名包：${token}`,
  // L363 Invalid directory: ''{0}''
  invalidDirectory: (token: string) => `非法的目录：${token}`,
  // L364 User home directory not found
  userHomeNotFound: '找不到用户主目录',
  // L365 Trying to create a package with an ignored name (''{0}''); the result will not be visible
  ignoredPackageName: (token: string) => `要创建的包名被忽略（${token}），结果不会可见`,
  // L366 Trying to create a directory with an ignored name (''{0}''); the result will not be visible
  ignoredDirectoryName: (token: string) => `要创建的目录名被忽略（${token}），结果不会可见`,
  // L367 Note: "." in the name is treated as a regular character. Use "/" instead if you mean to create nested directories
  directoryWithDot: '提示：名字里的「.」只当作普通字符；要建多级目录请用「/」',
  // L370 Creating package {0}.{1}
  creatingPackage: (dir: string, name: string) => `正在创建包 ${dir}.${name}`,
  // L369 Creating directory {0}{1}{2}
  creatingDirectory: (dir: string, sep: string, name: string) => `正在创建目录 ${dir}${sep}${name}`,
} as const

/**
 * `StringTokenizer(str, delims)` 的语义：**delims 里每个字符**都是分隔符，且**空 token 被跳过**。
 * 上游两条链都用它分词（`CreateDirectoryOrPackageHandler.java:77`、`:119`；
 * `DirectoryUtil.java:104`；`CreatePackageHandler.java:52` 用的是 `split(Pattern.quote("."))`，
 * 那条**保留**空 token，所以它的空段判定与本函数不同，见 `packageInputCheck`）。
 */
export function tokenizeWithDelimiters(input: string, delims: string): string[] {
  const isDelim = (ch: string) => delims.includes(ch)
  const out: string[] = []
  let current = ''
  for (const ch of input) {
    if (isDelim(ch)) {
      if (current) out.push(current)
      current = ''
    } else current += ch
  }
  if (current) out.push(current)
  return out
}

/** `CreateDirectoryOrPackageAction` 传给 handler 的分隔符集（本仓只用到这两档）。 */
export const PACKAGE_DELIMITER = '.'
/** 「新建目录」在上游是 `DirectoryUtil.SLASH_TERNARY`（`/` 优先，兼收 `\`）。 */
export const DIRECTORY_DELIMITERS = '/\\'

/** 上游查文件系统用的那几件事 —— 本仓由调用方注入（宿主才有盘）。 */
export interface CreateTargetFs {
  /** 用户主目录（`VfsUtil.getUserHomeDir()`）；null = 找不到（上游报 `error.user.home.directory.not.found`）。 */
  userHome: string | null
  /** `VirtualFile.getParent()`；null = 已在盘根（上游报 `error.invalid.directory`）。 */
  parentOf: (path: string) => string | null
  /** `VirtualFile.findChild(name)`：命中返回 `{ isDirectory }`，未命中 null。 */
  findChild: (dirPath: string, name: string) => { isDirectory: boolean } | null
  /** `FileTypeManager.isFileIgnored(name)`。 */
  isFileIgnored: (name: string) => boolean
  /** `FileTypeManager.getFileTypeByFileName(name)` 不是 `UnknownFileType`（`CreateDirectoryOrPackageHandler.java:207-210`）。 */
  isFileTypeBound: (name: string) => boolean
}

export interface CreateTargetInput {
  /** 用户输入的原文。 */
  input: string
  /** 当前目录（工作区相对路径，根是空串）。 */
  basePath: string
  /** `isDirectory`：true = 建目录，false = 建包。 */
  isDirectory: boolean
  /** 分隔符集。 */
  delimiters: string
  fs: CreateTargetFs
  /** `PsiDirectoryFactory.isValidPackageName(token)`；只在建包时用。 */
  isValidPackageName?: (token: string) => boolean
}

export interface CreateTargetResult {
  /** 上游 `errorText`（致命，`canClose` 不该放行）。 */
  error: string | null
  /** 上游 `warningText`（提示，可放行）。 */
  warning: string | null
  /** 逐级走完后的目录路径（工作区相对）；走位失败时是最后成功的那一级。 */
  path: string
  /**
   * **需要新建**的目录名，逐级（`DirectoryUtil.createSubdirectories` 里真正
   * `createSubdirectory` 的那些，`:126-133`）。已存在的段与 `~`/`.`/`..` 不在里面。
   */
  created: string[]
}

const joinPath = (base: string, name: string): string => (base ? `${base}/${name}` : name)

/**
 * `CreateDirectoryOrPackageHandler.checkForErrors`（`:76-116`）+
 * `checkForWarnings`（`:118-134`）+ `DirectoryUtil.createSubdirectories` 的遍历（`:103-136`）。
 *
 * 逐条照抄的地方：
 *   · `~` 只在**首个 token** 上生效，且要走 userHome（`:86-92`）；userHome 为 null 报错。
 *   · `..` 往上走，走到盘根报错（`:93-99`，报的是 `dir + File.separatorChar + ".."`）。
 *   · `.` 原地不动（`:100`）。
 *   · 中间层已存在**不是**错；只有**最后一段**已存在才报「已存在同名目录」（`:106-108`）。
 *   · 命中同名**文件**一律错（`:103-105`），不分位置。
 *   · 建包时逐段查包名合法性（`:126-128`）—— 注意上游把它塞进 **warningText** 这个口，
 *     不是 errorText，这个不对称是照抄的。
 *   · 建目录时若输入含「.」但一个分隔符都没出现，提示「点只是普通字符」（`:130-132`）。
 */
export function createTargetCheck(input: CreateTargetInput): CreateTargetResult {
  const { fs, isDirectory, delimiters, basePath } = input
  const tokens = tokenizeWithDelimiters(input.input, delimiters)
  const created: string[] = []
  let path = basePath
  let error: string | null = null
  let firstToken = true

  for (let index = 0; index < tokens.length; ++index) {
    const token = tokens[index]
    const last = index === tokens.length - 1
    if (last && (token === '.' || token === '..')) {
      error = CREATE_BUNDLE.invalidDirectoryName(token)
      break
    }
    if (firstToken && token === '~') {
      if (fs.userHome === null) { error = CREATE_BUNDLE.userHomeNotFound; break }
      path = fs.userHome
    } else if (token === '..') {
      const parent = fs.parentOf(path)
      if (parent === null) { error = CREATE_BUNDLE.invalidDirectory(`${path}/..`); break }
      path = parent
    } else if (token === '.') {
      // 上游 `else if (!".".equals(token))`（`:100`）：`.` 什么都不做，游标不动。
    } else {
      const child = fs.findChild(path, token)
      if (child) {
        if (!child.isDirectory) { error = CREATE_BUNDLE.fileAlreadyExists(token); break }
        if (last) { error = CREATE_BUNDLE.directoryAlreadyExists(token); break }
      } else created.push(token)
      path = joinPath(path, token)
    }
    firstToken = false
  }

  if (error) return { error, warning: null, path, created: [] }

  for (const token of tokens) {
    if (fs.isFileIgnored(token)) {
      return {
        error: null,
        warning: isDirectory ? CREATE_BUNDLE.ignoredDirectoryName(token) : CREATE_BUNDLE.ignoredPackageName(token),
        path, created,
      }
    }
    if (!isDirectory && token && input.isValidPackageName && !input.isValidPackageName(token)) {
      return { error: null, warning: CREATE_BUNDLE.invalidPackageName, path, created }
    }
  }
  if (isDirectory && input.input.includes(PACKAGE_DELIMITER) && !hasAnyDelimiter(input.input, delimiters))
    return { error: null, warning: CREATE_BUNDLE.directoryWithDot, path, created }
  return { error: null, warning: null, path, created }
}

/** `hasNoPathDelimiters`（`:136-144`）取反。 */
function hasAnyDelimiter(input: string, delimiters: string): boolean {
  for (const delimiter of delimiters) if (input.includes(delimiter)) return true
  return false
}

/**
 * `CreateDirectoryOrPackageHandler.canClose` 的两个前置判定（`:157-181`）：
 *   · 空串不放行（`:158-160`）；
 *   · **单段**才走 `checkCreateSubdirectory`（`:162-171`）—— 多段时整串的合法性由
 *     `checkInput` 的逐段 `findChild` 兜住了，上游在这里不再逐级查。
 *   · `suggestCreatingFileInstead`（`:183-205`）：名字里**恰好一个**「.」、
 *     注册表开关 `ide.suggest.file.when.creating.filename.like.directory` 打开、
 *     且该名字绑定了已知文件类型 ⇒ 弹「要不要建成文件」。本仓宿主没有这个对话框，
 *     所以只把「该不该问」算出来，**不代答**（返回 null 即上游的 CANCEL 语义）。
 */
export function createTargetCanClose(
  input: CreateTargetInput,
  options: { suggestFileInstead?: boolean } = {},
): { proceed: boolean; paths: string[]; askCreateFile: boolean } {
  if (!input.input) return { proceed: false, paths: [], askCreateFile: false }
  const result = createTargetCheck(input)
  if (result.error) return { proceed: false, paths: [], askCreateFile: false }
  const dots = [...input.input].filter(ch => ch === PACKAGE_DELIMITER).length
  const askCreateFile = dots === 1 && (options.suggestFileInstead ?? false) && input.fs.isFileTypeBound(input.input)
  return { proceed: true, paths: result.created, askCreateFile }
}

// ——— CreatePackageHandler：`.` 分隔 + 预填文本 ——

/**
 * `CreatePackageHandler.buildInitialText`（`:118-125`）：
 * 当前目录就是包根时预填空串；否则把**相对包根**的那段路径把 `/` 换成 `.` 再补一个尾点
 * （补尾点是为了让用户接着往下打）。
 */
export function packageInitialText(packageRootPath: string, currentPath: string): string {
  if (packageRootPath === currentPath) return ''
  const relative = currentPath.slice(packageRootPath.length + 1)
  return `${relative.replace(/\//g, PACKAGE_DELIMITER)}${PACKAGE_DELIMITER}`
}

/**
 * `CreatePackageHandler.getPackageRoot`（`:127-138`）：从当前目录往上，**只要父目录还是包**就继续上溯。
 * 本仓的「是不是包」没有 `PsiDirectoryFactory.isPackage`（没有 PSI），
 * 判据由调用方给（`isPackageDir`：本仓可用「在已识别源根下」这条，见 `src/projectRoots.ts`）。
 */
export function packageRootPath(currentPath: string, parentOf: (path: string) => string | null, isPackageDir: (path: string) => boolean): string {
  let directory = currentPath
  let parent = parentOf(directory)
  while (parent !== null && isPackageDir(parent)) {
    directory = parent
    parent = parentOf(directory)
  }
  return directory
}

export interface PackageInputInput {
  input: string
  /** `myPackageRoot` 的工作区相对路径。 */
  packageRootPath: string
  /** 输入框的预填文本（`getInitialText()`，`:112-116`）。 */
  initialText: string
  fs: Pick<CreateTargetFs, 'findChild' | 'isFileIgnored'>
  isValidPackageName: (token: string) => boolean
}

export interface PackageInputResult {
  /** `checkInput` 的**返回值**（`false` = 致命，别放行）。 */
  accepted: boolean
  /**
   * 上游的 `errorText` **字段**（`CreateGroupHandler` 的那个，只负责显示）。
   * 注意它与 `accepted` **不等价**：见下面 `:66-72` 那两处只赋值不 return 的分支 ——
   * 「非法包名」与「被忽略的名字」只写文案，`checkInput` 仍然返回 `true`（`:80`）。
   * 这是上游照抄的行为（对话框把 errorText 显示出来，但 OK 仍可按），不是本仓的宽松判定。
   */
  errorText: string | null
  /** 走完之后的包路径（工作区相对）。 */
  path: string
}

/**
 * `CreatePackageHandler.checkInput`（`:36-81`）。
 *
 * 与 `createTargetCheck` 的三处**真实**差异，都照抄：
 *   1. 末尾是「.」直接报**格式错并 return false**（`:43-46`）—— 包名不能以分隔符收尾；
 *      目录链那边没有这条。
 *   2. 分词用 `split(Pattern.quote("."))`（`:52`），**保留空 token**，
 *      所以「a..b」「.a」这类空段会命中 `:53-56` 的格式错；
 *      而 `createTargetCheck` 用的 `StringTokenizer` 把空段直接跳过了。
 *   3. `file` **从包根本身起步**（`:49` 的 `myPackageRoot.getVirtualFile()`，包根必然存在），
 *      逐级 `findChild` 下钻（`:58-60`）：一旦某级没命中就变 null，后面不再查
 *      （`if (file != null)` 守着）；循环结束后 `file` 仍非 null = **最后一级已存在**
 *      ⇒ 报「已存在同名包」（`:75-78`）。
 */
export function packageInputCheck(input: PackageInputInput): PackageInputResult {
  const at = (path: string) => ({ errorText: null as string | null, path })
  const text = input.input
  if (text === '' || text === input.initialText) return { accepted: true, ...at(input.packageRootPath) }
  if (text.endsWith(PACKAGE_DELIMITER)) return { accepted: false, errorText: CREATE_BUNDLE.invalidPackageNameFormat, path: input.packageRootPath }

  const tokens = text.split(PACKAGE_DELIMITER)
  let errorText: string | null = null
  // 下钻用的游标：包根本身（DirectoryUtil 那边是 PsiDirectory，这里是路径）。
  let dirPath = input.packageRootPath
  let file: { isDirectory: boolean } | null = { isDirectory: true }
  for (const token of tokens) {
    if (token === '') return { accepted: false, errorText: CREATE_BUNDLE.invalidPackageNameFormat, path: input.packageRootPath }
    if (file) {
      file = input.fs.findChild(dirPath, token)
      dirPath = joinPath(dirPath, token)
      if (file && !file.isDirectory) return { accepted: false, errorText: CREATE_BUNDLE.fileAlreadyExists(token), path: input.packageRootPath }
    }
    if (!input.isValidPackageName(token)) errorText = CREATE_BUNDLE.invalidPackageName
    if (input.fs.isFileIgnored(token)) errorText = CREATE_BUNDLE.ignoredPackageName(token)
  }
  if (file) return { accepted: false, errorText: CREATE_BUNDLE.packageAlreadyExists(tokens[tokens.length - 1] ?? ''), path: input.packageRootPath }
  // 上游 `checkInput` 不产出路径（路径在 canClose 的 `DirectoryUtil.createSubdirectories` 里算），
  // 这里给出「这次要建的包落在哪」，与下钻游标无关（中间层缺失时游标会停在半路）。
  return { accepted: true, errorText, path: tokens.reduce((base, token) => joinPath(base, token), input.packageRootPath) }
}
