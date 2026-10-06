// 自定义折叠的 **provider 表**（`lp/custom-folding` 判决点名的缺口之三「按 provider 的标记配置面」）。
//
// 上游那一族是扩展点，不是一个设置页：
//   · EP 声明 `platform/core-api/resources/intellij.platform.core.xml:40`
//     （`com.intellij.customFoldingProvider`，接口 `com.intellij.lang.folding.CustomFoldingProvider`）；
//   · 社区树里**只注册了两条**：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466`
//     （`NetBeansCustomFoldingProvider`）与 `:1467`（`VisualStudioCustomFoldingProvider`）。
//     按包路径 / 语义 / XML 里的 id 三条路各搜过一遍：`grep customFolding --include=*.xml platform/*/resources/`
//     只有那两行注册 + `intellij.platform.lang.impl.actions.xml:378` 的 `GotoCustomRegion` 动作，
//     全树也没有 `<region` 这个字面量 ⇒ **provider 设置页在上游不存在**，
//     本仓就不造一个没有后端的页面（禁止假控件），把 provider 落成**数据表**：
//     「标记识别 / 占位文字 / 默认折叠 / Surround 标题」四处共同读这一张表。
//   · 一个 provider 的五个面（`CustomFoldingProvider.java` 的抽象方法 + `getStartString`/`getEndString` 契约）：
//     `isCustomRegionStart` / `isCustomRegionEnd` / `getPlaceholderText` / `getDescription` /
//     `getStartString`+`getEndString`，本表逐字段对应。
//   · 判定入口在上游是 `CustomFoldingBuilder.java:164-187`（`isCustomRegionStart/End(node)` 各问一次
//     provider），provider 的挑选是 `:194-203`（循环**没有 break** ⇒ 取**最后一个**认领的，
//     并缓存在 `myDefaultProvider` 字段里给整次构建复用；逐条对应见下面 `markersPair` 的注释）。
//
// 文案出处：中文取随 IDE 发货的语言包 `plugins/localization-zh/lib/localization-zh.jar` 的
// `messages/LangBundle.properties:113-114`（`<editor-fold…> 注释` / `region…endregion 注释`），
// 对应上游英文原文 `platform/lang-api/resources/messages/LangBundle.properties:294-295`。
//
// **无法核实**：`//<region>` / `//</region>` 这一族在社区树里没有 provider（注册表只有上面两条），
// 判决却把它写作「默认标记」。本表保留它（`src/editorFolding.ts` 早就认这个形态，
// `src/surround.ts` 的「折叠区域」模板也在用它），但它的 `getDescription` 按标记原文列、
// `getPlaceholderText` 复用「取标记之后的说明，取不到就是 `...`」这条**能从两个真 provider 核到**的规则，
// 不另外编一条。

/** 一个 provider 认哪些标记、折起来显示什么、在 Surround 列表里叫什么。 */
export interface CustomFoldingProviderInfo {
  /** 上游 EP 实现类的简名；`region` 那一族是空串（社区树里没有实现类）。 */
  readonly id: string
  /** 上游 `getDescription()`：Surround With 列表里那一行的标题。 */
  readonly description: string
  /**
   * 上游 `getStartString()`：`?` 是说明文字的占位符，生成时换成 `Description`
   * （`CustomFoldingSurroundDescriptor.java:51` 的 `DEFAULT_DESC_TEXT`、`:262-271` 的替换与选中）。
   */
  readonly startString: string
  /** 上游 `getEndString()`。 */
  readonly endString: string
  /** 开始标记（对**去掉注释前缀的正文**判定；上游判的是整个注释 token 文本）。 */
  readonly start: RegExp
  /** 结束标记。 */
  readonly end: RegExp
  /** `getPlaceholderText` 的那条正则（`$1` 就是标记之后的说明）。 */
  readonly placeholder: RegExp
  // 块注释收尾（`VisualStudioCustomFoldingProvider.java:25` 的 `startsWith("/*")` → `trimEnd(…, "*/")`）。
  // 这里必须用行注释：TypeScript 的块注释**不嵌套**（实测 `build-tmp/probe.ts`：`/** a /* b */` 后面的代码仍然是活的），
  // 但正文里出现裸的两个字符收尾序列就会**提前闭合**注释 —— 剩下的中文被当代码读，报 TS1002/TS1161，
  // 而语法错会中断整棵树的语义检查。讲注释词法的模块一律用 `//`。
  readonly blockCommentTail?: RegExp
}

/** 表顺序 = 上游 EP 的注册顺序（`intellij.platform.lang.impl.xml:1466-1467`）。 */
export const CUSTOM_FOLDING_PROVIDERS: readonly CustomFoldingProviderInfo[] = [
  {
    // `NetBeansCustomFoldingProvider.java:14-27`（判定用 `contains`，不是行首锚定）与 `:36-43`。
    id: 'NetBeansCustomFoldingProvider',
    description: '<editor-fold…> 注释',
    startString: '<editor-fold desc="?">',
    endString: '</editor-fold>',
    start: /<editor-fold\b/,
    end: /<\/editor-fold\b/,
    // `:25` 的 `.*desc\s*=\s*"([^"]*)".*` 的 `$1`；空则 `...`（`:26`）。
    placeholder: /.*desc\s*=\s*"([^"]*)".*/,
  },
  {
    // `VisualStudioCustomFoldingProvider.java:13-27` 与 `:36-43`。
    id: 'VisualStudioCustomFoldingProvider',
    description: 'region…endregion 注释',
    startString: 'region ?',
    endString: 'endregion',
    // `:14` 的 `[/*#-]*\s*region.*`：前导字符类含 `/`、`*`、`#`、`-`，所以 `#region`、`//#region`、
    // `/* region */`、`-- region` 都算；`region` 之后允许任何尾注（`region: 说明`）。
    // **本仓比上游宽的一处**：`(?:pragma\s*)?` 让 C++ 的 `#pragma region` 也认。上游那条正则
    // 里没有 `pragma`（`VisualStudioCustomFoldingProvider.java:14` 原样），但 `src/editorFolding.ts`
    // 从上一批起就认这个形态（判决的族描述里也写着「`#region`/`#pragma region`」）⇒
    // 收紧会静默弄坏已有的折叠，故保留并在判决表里登记为**有意的超集**。
    start: /^[/*#-]*\s*(?:pragma\s*)?\s*region\b/,
    end: /^[/*#-]*\s*(?:pragma\s*)?\s*endregion\b/,
    // `:24` 的 `[/*#-]*\s*region(.*)` 的 `$1`。
    placeholder: /^[/*#-]*(?:\s*pragma)?\s*region([\s\S]*)$/,
    blockCommentTail: /\s*\*\/\s*$/,
  },
  {
    // 判决里的「默认标记」，社区树里没有它的 provider ⇒ id 空、描述按标记原文、占位复用上一条的规则。
    id: '',
    description: '折叠区域 //<region>',
    startString: '<region ?>',
    endString: '</region>',
    start: /^<region(?:\s[^>]*)?>$/,
    end: /^<\/region(?:\s[^>]*)?>$/,
    placeholder: /^<region\b([\s\S]*)$/,
  },
]

// 去掉注释前缀后的 region 标记正文；不是注释行时返回 null。
// 上游判的是整个注释 token（`CustomFoldingBuilder.java:211-213` 只放 `PsiComment` 进来），
// 本仓按行取，所以先剥前缀。块注释要**还原成上游那种带 `/*`…`*/` 的整段文本** ——
// `VisualStudioCustomFoldingProvider.java:25` 那个 `startsWith("/*")` 分支量的就是这两头，
// 提前剥掉尾巴它就没得判了。
export function commentMarkerBody(line: string): string | null {
  const text = line.trim()
  const marker = /^(?:\/\/+|#(?:\s*pragma)?|--|;)([\s\S]*)$/.exec(text)
  if (marker) return marker[1]!.trim()
  // 单行闭合的块注释：`*` 在上游那个前导字符类里，认。多行块注释不认 —— 本仓按行扫，
  // 把注释中间的普通文字当标记会误折。
  const block = /^\/\*[\s\S]*\*\/$/.exec(text)
  return block ? text : null
}

/** 这一行正文是哪个 provider 的哪种标记（`CustomFoldingBuilder.java:164-187` 的那两次询问）。 */
export function markerKindOf(body: string | null): { provider: CustomFoldingProviderInfo; kind: 'start' | 'end' } | null {
  if (!body) return null
  for (const provider of CUSTOM_FOLDING_PROVIDERS) {
    if (provider.start.test(body)) return { provider, kind: 'start' }
    if (provider.end.test(body)) return { provider, kind: 'end' }
  }
  return null
}

/** 一条 region 标记（开始或结束）连同认它的那个 provider —— 配对要比较 provider 身份。 */
export type RegionMarker = { provider: CustomFoldingProviderInfo; kind: 'start' | 'end' }

// 区域配对必须**同族**（两条 provider 各自的 `isCustomRegionStart`/`isCustomRegionEnd` 是一对，
// 上游一次构建里 start/end 问的是**同一份** provider —— `CustomFoldingBuilder.java:194-203`
// 把认下来的 provider 缓存在 `myDefaultProvider` 字段，`:79-92` 的入栈/出栈都走这一个 provider）。
//
// 留痕：原注释写的是「按注册顺序问过去，取**第一个**认领的」。实际 `:196-200` 那个循环**没有 break**，
// 命中的是**最后一个**认领该文本的 provider，而且结果按 builder 实例缓存、对后续所有注释复用
// （`myDefaultProvider != null` 就不再重问，直到下一次 `buildFoldRegions` 在 `:38` 清空）。
// 这是上游的取巧写法：一个文件里混用两族标记时它只认其中一族。本仓逐行认 provider
// （不复制那份缓存），但**保留可核实的那一条后果 —— 开始与结束标记不同族就不配对**：
// `//<region>` 不该被 `//endregion` 关掉、`#region` 也不该被 `//</region>` 关掉，
// 否则一次手误的混用会让整段代码从错的那一行折到底。
/** 两条标记能否配成同一个区域（同族才算，异族的那条按「不是区域收尾」处理，与上游同果）。 */
export function markersPair(start: RegionMarker, end: RegionMarker): boolean {
  return start.kind === 'start' && end.kind === 'end' && start.provider === end.provider
}

// 栈里**最近的同族开始标记**（自顶向下找，找不到返回 -1）。
// 上游一次构建只有一份 provider（`CustomFoldingBuilder.java:194-203` 的那份缓存），
// 所以它的 `FoldingStack` 里天然只有同族开始标记，`:83-84` 的 `pop()` 就等于「最近的那个」；
// 本仓逐行认 provider ⇒ 栈里可能混着两族，得按同族找。
// 压在它上面的**异族**开始标记因此被丢弃 —— 那些是没闭合的标记，上游的规则是不产生区域
// （`CustomFoldingBuilder.java:82-91` 只在配到结束标记时才 `descriptors.add`）。
/** 自顶向下找与这条结束标记同族的开始标记，返回它在栈里的下标（没有则 -1）。 */
export function matchingStartIndex(stack: readonly RegionMarker[], end: RegionMarker): number {
  for (let index = stack.length - 1; index >= 0; --index) {
    if (markersPair(stack[index]!, end)) return index
  }
  return -1
}

// 上游 `getPlaceholderText(elementText)`（`CustomFoldingBuilder.java:102-111` 转发的就是它）。
// 两个 provider 的实现都是 `elementText.replaceFirst(正则, "$1").trim()`，空则 `...`
// （`VisualStudioCustomFoldingProvider.java:23-27`、`NetBeansCustomFoldingProvider.java:24-27`），
// `CustomFoldingBuilder.java:117-119` 那个单参数重载也直接返回 `...`。
//
// **2026-10-06 本轮补的一条**：Java 的 `replaceFirst` 在**正则不匹配时原样返回入参**，
// 所以「开始标记里根本没有那个捕获组」时占位文字是**整段元素文本**（trim 后），不是 `...`。
// 能核实的只有 NetBeans 一支 —— 它的正则要 `desc="…"`（`:25`），写成
// `<editor-fold>` / `<editor-fold defaultstate="collapsed">` 时上游折出来就是整条注释
// （形如 `// <editor-fold defaultstate="collapsed">`）。原写法是「取不到就 `...`」，
// 那是把「捕获为空」与「正则不匹配」两档合并了 ⇒ 现在分开：
//   · 匹配且捕获为空 → `...`（两个 provider 的 `isEmpty()` 分支，`:26`）；
//   · 正则不匹配 → 整段元素文本（没有它时退回正文），仍空才 `...`。
// `elementText` 传的就是上游 `node.getText()` 在本仓的替身：**去掉行首缩进的整条注释行**
// （含注释前缀），不是剥了前缀的正文 —— 前缀在上游那段文本里，折起来时它也在折线里。
export function placeholderOf(body: string | null, elementText?: string): string {
  if (!body) return '...'
  const marker = markerKindOf(body)
  if (!marker || marker.kind !== 'start') return '...'
  const matched = marker.provider.placeholder.exec(body)
  if (!matched) {
    const whole = (elementText ?? body).trim()
    return whole || '...'
  }
  // 尖括号形态的收尾 `>` 不算说明（`<region 构造>` → `构造`）。
  const tail = (marker.provider.blockCommentTail && body.startsWith('/*')
    ? matched[1]!.replace(marker.provider.blockCommentTail, '')
    : matched[1]!.replace(/>\s*$/, '')).trim()
  // `<region desc="…">` 与 `<editor-fold desc="…">` 是同一个属性写法：有 `desc` 就取它。
  // 这一条对 `<region>` 一族属于**借用**（它的 provider 无法核实），对 NetBeans 是原样照搬。
  const attribute = /\bdesc\s*=\s*"([^"]*)"/.exec(tail)
  return (attribute ? attribute[1]!.trim() : tail) || '...'
}

// 这个区域是否**默认折起**（`CustomFoldingProvider.java:112-114` 的 `isCollapsedByDefault(text)`，
// 由 `CustomFoldingBuilder.java:138-142` 在区间落地时逐条问）。
// 基类那一半就是设置项 `COLLAPSE_CUSTOM_FOLDING_REGIONS`（本仓的 `collapseCustomRegions`，
// 已经走 `src/editorFoldingSettings.ts` 的 kind 映射）；这里只补 **NetBeans 多认的那一条**：
// `NetBeansCustomFoldingProvider.java:46-48` —— 开始标记里带 `defaultstate="collapsed"` 的区域，
// 即使全局开关关着也默认折。
export function collapsedByDefaultMarker(body: string | null): boolean {
  if (!body) return false
  // 上游只在「这一行是开始标记」时才问 provider（`CustomFoldingBuilder.java:131-136`）。
  const marker = markerKindOf(body)
  if (!marker || marker.kind !== 'start') return false
  return /defaultstate\s*=\s*"collapsed"/.test(body)
}
