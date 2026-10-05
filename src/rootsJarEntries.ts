// jar 内容的**行模型** —— 把宿主列出来的归档条目整成树/详情面板能画的一行行。
// 通道在 `file.archiveEntries`（实现 `native/file_queries.cpp` 的 `archive_entries`，
// 实机跑 `bsdtar -tf <archive>`；答复形状见 `native/file_queries.hpp`），
// 消费点：`src/jarEntriesSource.ts`（取数与通道判定）→ `src/components/JarEntriesPane.vue`
// → `src/components/ProjectStructurePane.vue` 的「依赖库」一节。
//
// 上游对应的是 `JarFileSystem` 那套「归档当一个目录」（lp/roots ②、pf/vfs ①、ic/vfs 那一串）：
//   · `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9-12`
//     `JarFileSystem extends ArchiveFileSystem implements VirtualFilePointerCapableFileSystem`；
//     `:10` `PROTOCOL`、`:11` `PROTOCOL_PREFIX`、`:12` `JAR_SEPARATOR`。
//     **订正**（上一轮这里写的是 `JAR_SEPARATOR = !`）：常量的真值在
//     `platform/util/src/com/intellij/util/io/URLUtil.java:39` = **`!/`**（`:37` `JAR_PROTOCOL = "jar"`），
//     所以根路径是 `…jar!/`（`JarFileSystemImpl.java:53` 就是 `localPath + JAR_SEPARATOR`）；
//   · `platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:32`
//     「Common interface of archive-based file systems (jar://, phar://, etc.)」（`:34` 是类声明那一行）；
//     `:50` 的 `getRootPathByLocal`（`"/x/y.jar" -> "/x/y.jar!/"`）；`:68` `getLocalByEntry`
//     （`jar:///path/to/jar.jar!/resource.xml => file:///path/to/jar.jar`）；`:86` `extractLocalPath`、
//     `:92` `composeRootPath` —— 本仓的 `jarUrl` / `parseJarUrl` 就是这两条的字符串形态；
//   · `platform/platform-impl/src/com/intellij/openapi/vfs/impl/jar/JarFileSystemImpl.java:23`
//     实现本体（`:25` getProtocol、`:30` extractPresentableUrl、`:69` findFileByPath）；
//   · 档案内路径恒用 `/`（上面 `getLocalByEntry` 的 javadoc 例子就是 `!/resource.xml`）。
//
// 为什么这一层是纯函数：条目清单来自宿主（真数据），形状是死的（`a/b/C.class` 这种档案内路径），
// 把「排序 / 目录在前 / 层级」这类呈现规则放在这里，native 与 UI 才能各自独立测，
// 也避免渲染层去猜档案内的结构。
//
// 与上游的不等价（如实）：本仓**不解压整档**、也没有 `VirtualFile` 对象，所以这里只给「清单 +
// 行形状」；条目文本走已有的 `file.librarySource`（限定名 → `*-sources.jar` 里的 `.java`），
// **任意**档案内条目的读取通道还没有（上游 `ArchiveFileSystem.java:99-100`、`:114-115` 对归档的
// 写操作一律抛「不支持修改」，所以缺的只是读，不影响这一面的形状）。

/** 档案内的一条条目（宿主 `bsdtar -tf` 的一行）。 */
export interface JarEntry {
  /** 档案内路径，恒用 `/` 分隔（`ArchiveRootWindow.java:24`）。 */
  readonly path: string
  /** 是否目录：档案里目录条目以 `/` 结尾，或由子条目隐含。 */
  readonly directory: boolean
}

/** 一行档案视图。 */
export interface JarRow {
  /** 稳定的树键：`<档案路径>!/<档案内路径>`（上游 `jar://` url 去掉协议头的形状）。 */
  readonly key: string
  /** 这一行显示的名字（末段）。 */
  readonly name: string
  /** 档案内完整路径（要读这一条时传给它）。 */
  readonly path: string
  readonly directory: boolean
  /** 相对档案根的层级（缩进用）。 */
  readonly depth: number
  /** `.java` 条目：本仓的库源码通道读得了它。 */
  readonly source?: boolean
  /** `.class` 条目对应的全限定名（能跳到源码时 UI 用它）。 */
  readonly className?: string
}

const basename = (path: string) => {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/**
 * `bsdtar -tf` 的输出 → 条目表。
 *
 * 档案里的目录条目**可能**带尾斜杠也可能不带（取决于打包工具），所以这里既认「尾斜杠 ⇒ 目录」，
 * 也把由子条目隐含出来的中间目录补齐（否则 `com/intellij/openapi` 这种深层路径在树上会断）。
 * 顺序跟随输入；重复条目只留第一条。
 */
export function parseJarListing(lines: readonly string[]): JarEntry[] {
  const out: JarEntry[] = []
  const seen = new Set<string>()
  const add = (path: string, directory: boolean) => {
    if (!path || seen.has(path)) return
    seen.add(path)
    out.push({ path, directory })
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const directory = line.endsWith('/')
    add(directory ? line.slice(0, -1) : line, directory)
    // 中间层级：`a/b/c.txt` 隐含目录 `a` 与 `a/b`。
    const parts = line.split('/')
    let acc = ''
    for (let index = 0; index < parts.length - 1; index++) {
      acc = acc ? `${acc}/${parts[index]}` : parts[index]!
      if (acc) add(acc, true)
    }
  }
  return out
}

export interface JarRowOptions {
  /** 档案在工作区里的路径（进 `key` 用；宿主给绝对路径时传它也行）。 */
  archive: string
  /** 只列文件（上游档案视图默认显示目录，所以缺省 false）。 */
  filesOnly?: boolean
}

/**
 * 条目清单 → 可渲染的行：目录在前、各自按路径字典序（上游子节点是字母序，
 * `ProjectViewNode.java:287` 的 `UNSPECIFIED`，与 `src/externalLibraries.ts` 同一口径）。
 */
export function jarRows(entries: readonly JarEntry[], options: JarRowOptions): JarRow[] {
  const sorted = [...entries].sort((left, right) => {
    if (left.directory !== right.directory) return left.directory ? -1 : 1
    return left.path.localeCompare(right.path)
  })
  const rows: JarRow[] = []
  for (const entry of sorted) {
    if (options.filesOnly && entry.directory) continue
    const className = classNameOfEntry(entry.path)
    rows.push({
      key: `${options.archive}!/${entry.path}`,
      name: basename(entry.path),
      path: entry.path,
      directory: entry.directory,
      depth: entry.path.split('/').length - 1,
      source: !entry.directory && /\.java$/i.test(entry.path),
      className: className ?? undefined,
    })
  }
  return rows
}

/** 一行快捷方式：宿主的清单直接变成行（跳过调用方自己拼 parseJarListing）。 */
export function jarRowsFromListing(lines: readonly string[], archive: string, options: Omit<JarRowOptions, 'archive'> = {}): JarRow[] {
  return jarRows(parseJarListing(lines), { archive, ...options })
}

/** 上游 `jar://` url 的本仓等价形式：`jar://<档案路径>!/<档案内路径>`（`ArchiveFileSystem.java:56-67` 的 javadoc 形状）。 */
export function jarUrl(archive: string, entryPath: string): string {
  return `jar://${archive}!/${entryPath}`
}

/** 从 `jar://` url 取回 (档案路径, 档案内路径)（`ArchiveFileSystem.java:68` `getLocalByEntry` 的字符串形态）。 */
export function parseJarUrl(url: string): { archive: string; entry: string } | null {
  if (!url.startsWith('jar://')) return null
  const body = url.slice('jar://'.length)
  const bang = body.indexOf('!')
  if (bang < 0) return { archive: body, entry: '' }
  return { archive: body.slice(0, bang), entry: body.slice(bang + 1).replace(/^\//, '') }
}

/** 一个类文件条目 → 全限定名（`a/b/C.class` → `a.b.C`；内部类 `C$D` 保留 `$`）。 */
export function classNameOfEntry(entryPath: string): string | null {
  if (!/\.class$/i.test(entryPath)) return null
  const trimmed = entryPath.replace(/\\/g, '/')
  const body = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed.replace(/\.class$/i, '')
  if (!body) return null
  return body.split('/').filter(Boolean).join('.')
}

/** 档案内一条路径的父目录（'' = 档案根）；渲染层展开某一层时靠它筛。 */
export function jarEntryParent(entryPath: string): string {
  return parentOf(entryPath.replace(/\/+$/, ''))
}
