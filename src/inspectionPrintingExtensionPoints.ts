// **检查与打印/HTML 导出的扩展点**（上游 `ErrorOptionsProvider` 与 `PrintOption` 一族在本仓的等价物）。
//
// 上游是什么：两条 EP，id 逐字取自各处：
//   · `com.intellij.errorOptionsProvider` —— 声明在
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:126-128`（`beanClass=ErrorOptionsProviderEP`，
//     `with attribute="instance" implements="com.intellij.profile.codeInspection.ui.ErrorOptionsProvider"`）；
//     接口 `ErrorOptionsProvider`（`ErrorOptionsProvider.java:14`，`extends UnnamedConfigurable`），
//     用途见类注释：「在设置 › 编辑器 › 代码编辑 › 错误高亮一节里提供额外选项」。
//   · `com.intellij.printOption` —— 声明在 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:260`；
//     抽象类 `PrintOption`（`PrintOption.java:14-18` 的 `EP_NAME`），方法面
//     `Map<Integer, PsiReference> collectReferences(PsiFile, Map<PsiFile,PsiFile>)`（`:17`）+
//     `UnnamedConfigurable createConfigurable()`（`:18`）；消费点是 HTML 导出
//     `ExportToHTMLManager.java:197-198`（逐条 `collectReferences` 把引用收集进导出报告）。
//
// 本仓此前：
//   · 检查配置面在 `src/inspectionProfile.ts`（配置文件模型）+ `src/components/InspectionProfileSwitcher.vue`，
//     检查器描述在 `src/inspectionDescription.ts`，**没有按 id 挂「错误高亮选项」的注册面**；
//   · HTML 导出在 `src/htmlExport.ts` + `src/components/ExportToHtmlDialog.vue`，
//     **没有 `PrintOption` 那种「导出时给每条引用做一份数据」的注册面**。
//   本文件补上这两条 EP：
//   · 两条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的**可移植子集**（本仓没有 Swing `UnnamedConfigurable`/`PsiFile`/
//     `PsiReference`，换成 `OptionsSection`（一段选项的令牌 + 键值）与
//     `ExportReference`（路径 + 行 + 文本））；
//   · 本仓内建的「行号引用收集」**作为一条 bundled 贡献** 挂进 `printOption`，使
//     `htmlExportOptions()` 从 EP 收表、第三方挂的收集器能被真实消费点拿到。
//
// 与上游的如实差异：① 上游 `ErrorOptionsProvider` 返回 Swing `UnnamedConfigurable`，本仓换成
// `OptionsSection`（给设置页渲染的一段声明式行）；② `PsiFile`/`PsiReference` 换成路径 + 行 + 文本；
// ③ `collectReferences` 的 `Map<Integer, PsiReference>` 在本仓是 `ExportReference[]`（键是引用文本的
// 起始列）。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/inspection-printing-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 两条 EP 的 id（逐字取自上游 xml 的 qualifiedName / 类的 EP_NAME，见文件头逐行出处）。 */
export const ERROR_OPTIONS_PROVIDER_EP = 'com.intellij.errorOptionsProvider'
export const PRINT_OPTION_EP = 'com.intellij.printOption'

/** 设置页里的一段声明式选项（上游 Swing `UnnamedConfigurable` 的可移植替代）。 */
export interface OptionsSection {
  /** 段标题（上游 `getDisplayName()`）。 */
  title: string
  /** 该段里的行（键 + 当前值 + 可选说明）。 */
  rows: readonly { key: string; label: string; value: string; description?: string }[]
}

/** 上游 `ErrorOptionsProvider`（`ErrorOptionsProvider.java:14-21`）的可移植子集。 */
export interface ErrorOptionsProvider {
  id: string
  /** 给「错误高亮」一节补的一段选项（返回 null = 这一档这次不给）。 */
  options: () => OptionsSection | null
}

/** 导出报告里的一条引用（上游 `PsiReference` 的可移植替代：路径 + 行 + 文本 + 起始列）。 */
export interface ExportReference {
  path: string
  line: number
  /** 引用文本。 */
  text: string
  /** 起始列（上游 `Map<Integer, PsiReference>` 的键）。 */
  column: number
}

/** 上游 `PrintOption`（`PrintOption.java:14-18`）的可移植子集。 */
export interface PrintOption {
  id: string
  /** 给一份文件的导出报告收集引用（上游 `collectReferences`；返回空数组 = 这一档没有贡献）。 */
  collectReferences: (path: string, text: string) => readonly ExportReference[]
  /** 这一档有没有导出选项要显示（上游 `createConfigurable()`；返回 null = 无选项）。 */
  options?: () => OptionsSection | null
}

/** 两条 EP 的声明（幂等）。 */
export function declareInspectionPrintingExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: ERROR_OPTIONS_PROVIDER_EP, name: '错误高亮选项提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: PRINT_OPTION_EP, name: 'HTML 导出引用收集器', scope: APPLICATION_SCOPE, dynamic: true })
}

declareInspectionPrintingExtensionPoints()

function register<T extends { id: string }>(ep: string, value: T, options: RegisterExtensionOptions): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, value.id, value, options)
}

export function registerErrorOptionsProvider(value: ErrorOptionsProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(ERROR_OPTIONS_PROVIDER_EP, value, options)
}
export function registerPrintOption(value: PrintOption, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(PRINT_OPTION_EP, value, options)
}

/** 错误高亮一节的全部选项段（上游设置页逐条 `ErrorOptionsProvider` 加段）。 */
export function errorOptionsSections(scope: string = APPLICATION_SCOPE): OptionsSection[] {
  const out: OptionsSection[] = []
  for (const provider of EXTENSIONS.extensionsOf<ErrorOptionsProvider>(ERROR_OPTIONS_PROVIDER_EP, scope)) {
    const section = provider.options()
    if (section) out.push(section)
  }
  return out
}

/**
 * HTML 导出：给一份文件收集全部 `PrintOption` 贡献的引用（上游 `ExportToHTMLManager.java:197-198`
 * 逐条 `collectReferences` 后并进报告）。
 */
export function printOptionReferences(path: string, text: string, scope: string = APPLICATION_SCOPE): ExportReference[] {
  const out: ExportReference[] = []
  for (const option of EXTENSIONS.extensionsOf<PrintOption>(PRINT_OPTION_EP, scope)) {
    out.push(...option.collectReferences(path, text))
  }
  return out
}

/** 导出侧的选项段（各 `PrintOption` 的 `options()` 合起来；没有就空数组）。 */
export function printOptionSections(scope: string = APPLICATION_SCOPE): OptionsSection[] {
  const out: OptionsSection[] = []
  for (const option of EXTENSIONS.extensionsOf<PrintOption>(PRINT_OPTION_EP, scope)) {
    const section = option.options?.()
    if (section) out.push(section)
  }
  return out
}

/* ── bundled：本仓内建一条引用收集器 ─────────────────────────────────────────── */

export const BUILTIN_PRINT_OPTION_ID = 'taocode.printOption.lineReferences'

/**
 * 本仓内建的行号引用收集器：把 `/* ... *​/` 与 `//` 注释里的 `path:line` 形态文本收成引用
 * （本仓没有 PSI 解析，所以按文本形态扫；上游是按 `PsiReference` 取）。
 */
export function builtinPrintOption(): PrintOption {
  return {
    id: BUILTIN_PRINT_OPTION_ID,
    collectReferences: (path, text) => {
      const references: ExportReference[] = []
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const match = /([\w./\\-]+\.[A-Za-z0-9]+):(\d+)/.exec(line)
        if (!match) continue
        references.push({ path, line: index + 1, text: match[0], column: match.index })
      }
      return references
    },
  }
}

/** 把内建引用收集器挂上（返回注销函数）。 */
export function registerBundledPrintOption(): () => void {
  const handle = registerPrintOption(builtinPrintOption(), { source: 'bundled' })
  return () => handle.dispose()
}
