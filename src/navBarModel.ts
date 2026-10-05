// 导航栏模型与扩展 —— 上游 `platform/platform-impl/src/com/intellij/ide/navigationToolbar/`
// 的 `NavBarModelExtension`（EP：`com.intellij.navbar`，自定义扩展先于默认扩展调用）、
// `AbstractNavBarModelExtension`（adjustElement 原样返回、getParent 返回 null、additionalRoots 空）、
// `DefaultNavBarExtension`（文件 → 所在目录、目录 → 上级、名字取 presentable name）
// 与 `NavBarLeftSideExtension`（左侧根切换）。
//
// 本仓现状：面包屑在 `src/App.vue` 模板里按 `path.split('/')` 现算，`src/editorSideViews.ts`
// 的 `openBreadcrumb(index)` 也只按下标切路径 —— 没有「元素链 + 扩展点」这一层，
// 于是「面包屑显示什么、点它跳到哪」两处各算各的。这个模块把链模型与扩展点落成纯规则：
//   · 元素 = 根 / 目录 / 文件（本仓没有 PSI，符号段见 `src/breadcrumbs.ts` 的 symbolBreadcrumbs）；
//   · 扩展示例顺序照上游：自定义在前，默认扩展兜底（label/parent/children 三处都是首个非空命中）；
//   · `additionalRoots` 与左侧根扩展：默认只有一个工作区根（本仓单根）。
//
// 明确不做（上游有、本仓没有）：PSI 元素与注入片段（`PsiFileSystemItem`/`InjectedLanguageManager`）、
// 库/SDK/模块元素（`LibraryOrderEntry`/`JdkOrderEntry`/`ModuleOrderEntry`，本仓外部库树是合成行）、
// 真扩展点宿主（`com.intellij.navbar` EP；本仓的扩展表由调用方注入）。

/** 导航栏上的一个元素（本仓的 PSI 替代物）。 */
export interface NavBarElement {
  kind: 'root' | 'dir' | 'file'
  /** 工作区相对路径；根是空串。 */
  path: string
  /** 显示名。 */
  name: string
}

/** 上游 `NavBarModelExtension` 的本仓子集。 */
export interface NavBarModelExtension {
  /** `getPresentableText`：返回 null 表示让下一个扩展处理。 */
  getPresentableText?: (element: NavBarElement) => string | null
  /** `getParent`：返回 null 表示让下一个扩展处理。 */
  getParent?: (element: NavBarElement) => NavBarElement | null
  /** `adjustElement`：本仓无 PSI，默认原样返回；自定义扩展可把文件调成别的元素。 */
  adjustElement?: (element: NavBarElement) => NavBarElement
  /** `additionalRoots`：额外根（默认扩展返回「无」）。 */
  additionalRoots?: () => NavBarElement[]
  /** `processChildren`：列子元素；默认扩展用调用方给的目录清单。 */
  processChildren?: (element: NavBarElement) => NavBarElement[]
}

export interface NavBarModelOptions {
  /** 工作区根的显示名（上游 `Project.getName()`）。 */
  rootName: string
  /** 扩展表：**自定义在前，默认扩展在最后兜底**（上游 EP 的调用顺序）。 */
  extensions: readonly NavBarModelExtension[]
  /** 目录清单（工作区相对路径 → 子元素）；默认扩展的 children 用它。 */
  listDir?: (path: string) => readonly NavBarElement[]
}

export interface NavBarModel {
  /** 含根元素的完整链（根在前），末项是选中元素（上游 NavBarModel 的「地址栏」）。 */
  chain(selected: NavBarElement): NavBarElement[]
  presentableText(element: NavBarElement): string
  parentOf(element: NavBarElement): NavBarElement | null
  adjust(element: NavBarElement): NavBarElement
  roots(): NavBarElement[]
  childrenOf(element: NavBarElement): NavBarElement[]
}

const dirOf = (path: string): string => {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}
const baseOf = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? ''

/** 工作区路径 → 元素链（根 + 逐级目录 + 文件），不依赖扩展表 —— 默认扩展的等价物。 */
export function navBarCrumbs(path: string, rootName: string): NavBarElement[] {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = normalized.split('/').filter(Boolean)
  const chain: NavBarElement[] = [{ kind: 'root', path: '', name: rootName }]
  let current = ''
  segments.forEach((segment, index) => {
    current = current ? `${current}/${segment}` : segment
    chain.push({ kind: index === segments.length - 1 ? 'file' : 'dir', path: current, name: segment })
  })
  return chain
}

function defaultParent(element: NavBarElement): NavBarElement | null {
  if (element.kind === 'root') return null
  const parentPath = dirOf(element.path)
  if (parentPath === '') return { kind: 'root', path: '', name: '' }
  return { kind: 'dir', path: parentPath, name: baseOf(parentPath) }
}

/** 默认扩展（`DefaultNavBarExtension`）：名字取路径末段、父级取上级目录、无额外根。 */
export function defaultNavBarExtension(): NavBarModelExtension {
  return {
    getPresentableText: element => element.name || null,
    getParent: element => defaultParent(element),
    adjustElement: element => element,
    additionalRoots: () => [],
  }
}

export function createNavBarModel(options: NavBarModelOptions): NavBarModel {
  const extensions = [...options.extensions, defaultNavBarExtension()]

  const firstNonNull = <T>(pick: (extension: NavBarModelExtension) => T | null | undefined, fallback: T): T => {
    for (const extension of extensions) {
      const value = pick(extension)
      if (value !== null && value !== undefined) return value
    }
    return fallback
  }

  const presentableText = (element: NavBarElement): string =>
    firstNonNull(extension => extension.getPresentableText?.(element) ?? null, element.name)

  const parentOf = (element: NavBarElement): NavBarElement | null => {
    for (const extension of extensions) {
      const parent = extension.getParent?.(element)
      if (parent) return parent
    }
    return null
  }

  const adjust = (element: NavBarElement): NavBarElement => {
    let current = element
    // 上游 adjustElement 的遍历顺序与其它方法相反（默认扩展先跑），这里照抄：倒序调用、首个改变生效。
    for (let index = extensions.length - 1; index >= 0; --index) {
      const adjusted = extensions[index].adjustElement?.(current)
      if (adjusted && adjusted !== current) { current = adjusted; break }
    }
    return current
  }

  const roots = (): NavBarElement[] => {
    const extra: NavBarElement[] = []
    for (const extension of extensions) {
      const value = extension.additionalRoots?.()
      if (value?.length) { extra.push(...value); break }
    }
    const base: NavBarElement = { kind: 'root', path: '', name: options.rootName }
    return [base, ...extra.filter(root => root.path !== base.path)]
  }

  const childrenOf = (element: NavBarElement): NavBarElement[] => {
    for (const extension of extensions) {
      const children = extension.processChildren?.(element)
      if (children) return children
    }
    if (!options.listDir) return []
    const dirPath = element.kind === 'file' ? dirOf(element.path) : element.path
    return options.listDir(dirPath).map(child => ({
      kind: child.kind,
      path: child.path.replace(/\\/g, '/'),
      name: child.name || baseOf(child.path),
    }))
  }

  const chain = (selected: NavBarElement): NavBarElement[] => {
    const adjusted = adjust(selected)
    const reversed: NavBarElement[] = [adjusted]
    const seen = new Set([adjusted.path])
    for (let current = adjusted; ;) {
      const parent = parentOf(current)
      if (!parent || seen.has(parent.path)) break
      seen.add(parent.path)
      reversed.push(parent)
      current = parent
    }
    return reversed.reverse()
  }

  return { chain, presentableText, parentOf, adjust, roots, childrenOf }
}
