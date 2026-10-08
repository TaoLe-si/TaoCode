// 文件属性的**两条 BOM 动作** —— 上游 `AddBomAction` / `RemoveBomAction` 的纯规则。
// 零 Vue、零 DOM：给当前 bom 位与编码，算出「该不该可用 / 执行后 bom 变什么 / 该提示什么」。
//
// ---------------------------------------------------------------- 上游落点（2026-10-07 逐行实读）
//
// 树根 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（只读）。
//
//   · `platform/platform-impl/src/com/intellij/openapi/editor/actions/AddBomAction.java`
//     :31-43 `update`：`enabled = file != null && file.getBOM() == null
//       && CharsetToolkit.getPossibleBom(file.getCharset()) != null`（**三条与**）；
//     :41 `setVisible(enabled || ActionPlaces.isMainMenuOrActionSearch(place))`
//       ⇒ 主菜单里是**可见但置灰**，不是隐藏（`ActionPlaces.java:239-242` 认 MainMenu / GoToAction /
//       快捷键位 / `popup@…` 前缀）⇒ 本仓菜单行必须**常驻**，置灰靠 `enabled()`；
//     :42 `description = IdeBundle "add.byte.order.mark.to"`，实参是 `enabled ? file.getName() : null`；
//     :46-50 `actionPerformed` 只取 `CommonDataKeys.VIRTUAL_FILE` —— **单文件**，不是数组；
//     :52-68 `doAddBOM`：`getBOM() != null` 早退（幂等）→ `getPossibleBom(charset) == null` 早退 →
//       **先 `virtualFile.setBOM(possibleBom)`**（内存标记，:59）**再** `setBinaryContent(possibleBom + 原字节)`
//       （立刻写盘，:60-64）；IOException 只记一条 warn（:65-67）⇒ 上游 `update` **不判可写性**。
//
//   · 同目录 `RemoveBomAction.java`（149 行）
//     :43-50 `update`：`fromWhere = computeFromWhere(VIRTUAL_FILE_ARRAY)`，`enabled = fromWhere != null`；
//     :52-69 `computeFromWhere`：空数组 → null；**只看第一个命中的就 `break`** —— 目录一律算命中
//       （:59 注释：精确计算太贵，尤其是排除目录在场时），与「目录里到底有没有带 BOM 的文件」无关；
//       命中文件时要求 `file.getBOM() != null`（:63）；
//     :71-109 `actionPerformed`：`getFilesWithBom` 递归收集有 BOM 的文件（:134-148，目录会展开），
//       收集为空就**什么都不做**（:78，连提示都没有）；然后跑一个后台任务
//       （`IdeBundle "removing.BOM"`，:80，`PerformInBackgroundOption.DEAF`），逐文件：
//       `getMandatoryBom(charset) != null` ⇒ 记进 `filesUnableToProcess`（:91-93），否则 `doRemoveBOM`；
//     :100-106 有失败项就发一条 **ERROR** 通知：组 `notification.group.failed.to.remove.bom`，
//       标题 `notification.title.was.unable.to.remove.bom.in`，正文 `notification.content.mandatory.bom.br`
//       （多文件名用 `<br/>    ` 连接，:103）；
//     :115-125 `doRemoveBOM`：**先 `setBOM(null)`**（:116）**再** `setBinaryContent(去掉 BOM 前缀的字节)`
//       （:117-121）—— 同样是立刻写盘。
//
//   · 编码与 BOM 的关系**全部复用 `src/fileEncodingRules.ts`**，本文件不重列编码清单：
//     那份对着 `platform/util/src/com/intellij/openapi/vfs/CharsetToolkit.java` 写的 ——
//     :79-83 五种 BOM 字节、:86-92 `CHARSET_TO_MANDATORY_BOM` 只收 UTF-16LE/BE + UTF-32BE/LE、
//     :571 `getMandatoryBom`、:579 `getPossibleBom = UTF-8 ? UTF8_BOM : MANDATORY.get(charset)`、
//     :584 `canHaveBom`。
//     ⇒ `encodingHasPossibleBom` ≡ `getPossibleBom != null`（AddBomAction.java:37 的第三条），
//       `encodingMandatoryBom` ≡ `getMandatoryBom != null`（RemoveBomAction.java:112 的判据）。
//     ⇒ **UTF-8 的 BOM 可选**（加得也去得）；**UTF-16/UTF-32 的 BOM 强制**（字节序全靠它标记）
//       ⇒ 去不掉，而且那条失败是**执行时**报的 ERROR，**不是**置灰（`update` 只看 `getBOM() != null`）。
//
//   · 键位：`platform/platform-resources/src/keymaps/` 的 10 份 scheme **一份都没有** Bom/BOM 条目
//     （`grep -rni bom platform/platform-resources/src/keymaps/` 全空，exit 1）⇒ 两条动作**无快捷键**，
//     所以本文件的菜单行不带 `keys`。
//
//   · 菜单归属：`FilePropertiesGroup`（`platform/platform-impl/resources/idea/PlatformActions.xml:400-412`）
//     里 `RemoveBom.Group` 挂在 `ChangeFileEncodingAction` **之后**、`AddBom.Group` 再挂在
//     `RemoveBom.Group` **之后**（`.../idea/LangActions.xml:517-522`）⇒ 顺序是
//       文件编码… → 移除 BOM → 添加 BOM → （关联文件类型）→ 只读 → 行分隔符。
//     两条动作另挂在状态栏编码弹层的 `EncodingPanelActions` 组
//     （`.../resources/intellij.platform.ide.impl.actions.xml:816-819`，用它的
//     `EncodingPanel.java:53`）；本仓那颗芯片开的是编码对话框（`src/App.vue:2394` → `openEncoding`），
//     不是 ActionGroup 弹层 ⇒ 那一处**不接**，理由见报告。
//
// ---------------------------------------------------------------- 与本仓既有 BOM 通道的关系（复用，不重写）
//
//   · 置灰/强制判据：`src/fileEncodingRules.ts:26` `encodingHasPossibleBom`、`:31` `encodingMandatoryBom`
//     —— 唯二来源，本文件不另写编码清单。
//   · 状态位：`src/editorFileOps.ts:206-245` 的 `tab.bom` + 编码对话框
//     （`openEncoding` :208-214 / `reloadWithEncoding` :215-230 / `applyEncodingChoice` :231-245）。
//     本文件的两条动作往**同一个** `tab.bom` 上写，不另建状态；`bomAfterEncodingSwitch`
//     （`src/fileEncodingRules.ts:49`）仍是换编码时那一次派生的唯一入口。
//   · 落盘时机是**如实差异**：上游两条动作立刻 `setBinaryContent` 写盘（AddBomAction.java:60-64、
//     RemoveBomAction.java:117-121）；本仓 BOM 是标签属性，由 `src/App.vue:1177` 的
//     `request('file.write', { …, bom: tab.bom, … })` 在保存时落盘 —— 与 `applyEncodingChoice`
//     （`src/editorFileOps.ts:238-240`「正文不变、标脏让下次保存写出新字节」）同一档。
//     ⇒ 执行后的提示必须说「未保存」，不许说得像已经写进磁盘了（同 `convertIndents` 的
//     `src/editorFileOps.ts:177` 那条文案口径）。
//
// ---------------------------------------------------------------- 本仓范围差异（写进报告，不在这里画假控件）
//
//   上游 `RemoveBomAction` 吃 `VIRTUAL_FILE_ARRAY`，会展开目录递归（:134-148）。本仓的菜单只有
//   单个活动标签这一条通道（`src/menus/fileMenu.ts` 的行都按 `ctx.active` 判），文件树右键也只带
//   单个 entry（`src/editorFileOps.ts:143-148`）⇒ 本文件按**单文件**建模，目录递归那一档不做。

import { encodingHasPossibleBom, encodingMandatoryBom } from './fileEncodingRules.ts'
import type { EncodingKey } from './bridge.ts'
import type { MenuRow } from './menus/types.ts'

// ---------------------------------------------------------------- 文案（资源包原文，逐条给出处）

/**
 * `action.AddBom.text`。英文平台包 `platform/platform-resources-en/src/messages/ActionsBundle.properties:2820`
 * = `Add BOM`；中文包取自安装目录 `D:/IntelliJ IDEA 2026.2/plugins/localization-zh/lib/localization-zh.jar`
 * 内的 `messages/ActionsBundle.properties:32` = `添加 BOM`。
 */
export const ADD_BOM_TEXT = '添加 BOM'
/** `action.RemoveBom.text`（同上，英文 :2819 = `Remove BOM`；中文包 :1640 = `移除 BOM`）。 */
export const REMOVE_BOM_TEXT = '移除 BOM'
/**
 * `removing.BOM`（英文 `platform/platform-api/resources/messages/IdeBundle.properties:1495`
 * = `Removing BOM`；中文包 `messages/IdeBundle.properties:2222` = `正在移除 BOM`）——
 * 上游是那条后台任务的进度文案（RemoveBomAction.java:80）。
 */
export const REMOVING_BOM_PROGRESS = '正在移除 BOM'
/** 失败通知的组名 `notification.group.failed.to.remove.bom`（英文 :1497；中文包 :1647 = `无法移除 BOM`）。 */
export const REMOVE_BOM_FAILED_GROUP = '无法移除 BOM'

/**
 * `add.byte.order.mark.to`（英文 IdeBundle.properties:1494 = `Add byte order mark to {0}`；
 * 中文包 :360 = `向 {0} 添加字节顺序标记`）。
 *
 * 上游在**禁用**档把 `null` 传进同一条消息（AddBomAction.java:42 的
 * `enabled ? file.getName() : null`）；`MessageFormat` 对 null 实参渲染成什么，源码里看不出来
 * ⇒ 本仓禁用档给不带文件名的通用文案，不猜那个结果。
 */
export function addBomDescription(fileName?: string): string {
  return fileName === undefined ? '添加字节顺序标记' : `向 ${fileName} 添加字节顺序标记`
}

/**
 * `remove.byte.order.mark.from`（英文 IdeBundle.properties:1493 = `Remove byte order mark from {0}`；
 * 中文包 :2221 = `从 {0} 中移除字节顺序标记`）。实参是 `computeFromWhere(...)`
 * （RemoveBomAction.java:49）—— 单文件时就是文件名。禁用档同样是 `null`，处理同上。
 */
export function removeBomDescription(fromWhere?: string): string {
  return fromWhere === undefined ? '移除字节顺序标记' : `从 ${fromWhere} 中移除字节顺序标记`
}

/**
 * `notification.title.was.unable.to.remove.bom.in`（英文 :1498；
 * 中文包 `messages/IdeBundle.properties:1693` = `无法移除 {0} {0,choice,1#文件|2#文件}中的 BOM`）——
 * 中文包两个 choice 分支都是「文件」，所以复数与否文案相同。
 */
export function removeBomFailedTitle(count: number): string {
  return `无法移除 ${count} ${count === 1 ? '文件' : '文件'}中的 BOM`
}

/**
 * `notification.content.mandatory.bom.br`（英文 :1499；中文包 :1624 =
 * `{0,choice,1#此文件具有|2#这些文件具有}强制性 BOM:<br/>{1}`）——
 * 上游正文是 HTML（`<br/>` + 四个空格缩进），本仓 `notify` 是纯文本 ⇒ 只保留句子，去掉标记。
 */
export function removeBomMandatoryContent(fileNames: readonly string[]): string {
  const head = fileNames.length === 1 ? '此文件具有' : '这些文件具有'
  return `${head}强制性 BOM：${fileNames.join('、')}`
}

// ---------------------------------------------------------------- 输入形状

/** 一条 BOM 动作要看的全部状态（上游 `VirtualFile` 的那三项 + 本仓的只读档）。 */
export interface BomTarget {
  /** 文件展示名（上游 `VirtualFile.getName()`）。 */
  name: string
  /** 当前 BOM 标记（本仓 `Tab.bom`，来自宿主 `file.read` 的 `bom` 字段）。 */
  bom: boolean
  /** 当前编码（本仓 `Tab.encoding`）。 */
  encoding: EncodingKey
  /**
   * 只读档。**不参与置灰**：上游 `update` 三条与里没有可写性（AddBomAction.java:31-43、
   * RemoveBomAction.java:43-50），写盘失败只在 `:65-67` 记一条 warn。本仓不静默 ⇒
   * 它只影响提示里那句「保存会被拒」。
   */
  readOnly?: boolean
}

/** 置灰的上游理由（每个值指到一条早退/不满足的判据）。 */
export type BomDisabledReason =
  | 'no-file'                 // AddBomAction.java:33 `file != null`
  | 'already-has-bom'         // AddBomAction.java:35 `file.getBOM() == null`
  | 'encoding-has-no-bom'     // AddBomAction.java:37-38 `getPossibleBom(charset) != null`
  | 'no-bom'                  // RemoveBomAction.java:63 `file.getBOM() != null`
  | null

export interface BomActionState {
  enabled: boolean
  /** 可用时为 null。 */
  disabledBecause: BomDisabledReason
  /** `Presentation.setDescription` 的那句话。 */
  description: string
}

export interface BomActionOutcome {
  /** 有没有真的改到标记（上游两个 `do*BOM` 的早退分支 ⇒ false）。 */
  changed: boolean
  /** 执行后的 BOM 标记；`changed === false` 时等于原值。 */
  bom: boolean
  /** 要不要标脏（本仓落盘在保存，见模块头）。 */
  dirty: boolean
  /** 该说的话（成功与失败都有）。 */
  notice: string
  /** 要不要按错误级别说（上游只有那条强制性 BOM 通知是 `NotificationType.ERROR`）。 */
  error: boolean
}

// ---------------------------------------------------------------- 可用性（两条 `update`）

/**
 * `AddBomAction.update`（:31-43）的等价物：三条与，缺一条置灰。
 * 只读**不**在其中（见 `BomTarget.readOnly`）。
 */
export function addBomState(target: BomTarget | undefined): BomActionState {
  if (!target) {
    return { enabled: false, disabledBecause: 'no-file', description: addBomDescription(undefined) }
  }
  if (target.bom) {
    // :35 —— 已经有 BOM 就没有「再加一条」这回事（doAddBOM 也会在 :54-55 早退）。
    return { enabled: false, disabledBecause: 'already-has-bom', description: addBomDescription(undefined) }
  }
  if (!encodingHasPossibleBom(target.encoding)) {
    // :37-38 —— gbk / cp1252 / system 这一类 getPossibleBom 为 null，加不了（勾了也没字节可写）。
    return { enabled: false, disabledBecause: 'encoding-has-no-bom', description: addBomDescription(undefined) }
  }
  return { enabled: true, disabledBecause: null, description: addBomDescription(target.name) }
}

/**
 * `RemoveBomAction.update` + `computeFromWhere`（:43-69）的等价物。
 *
 * ⚠ 与「添加」不对称、且是**上游的真实行为**：这里**不看编码是否强制**
 * （`computeFromWhere` 只问 `file.getBOM() != null`）⇒ UTF-16/UTF-32 带 BOM 时这一项**照样可用**，
 * 强制档那条失败在 `actionPerformed` 里以 ERROR 通知出现（:91-96、:100-106）。
 * 本仓保持同一形状：可用性不置灰，`removeBomOutcome` 给 `error: true` 的那句话。
 */
export function removeBomState(target: BomTarget | undefined): BomActionState {
  if (!target || !target.bom) {
    // :52-56 空数组 → null；:63 文件没有 BOM 就不算命中。
    return { enabled: false, disabledBecause: target ? 'no-bom' : 'no-file', description: removeBomDescription(undefined) }
  }
  return { enabled: true, disabledBecause: null, description: removeBomDescription(target.name) }
}

// ---------------------------------------------------------------- 执行后（两条 `do*BOM` + 那条 ERROR）

/** 只读档要额外说的一句（上游不置灰、失败只记 warn；本仓不静默，见 `BomTarget.readOnly`）。 */
function readOnlyClause(target: BomTarget): string {
  return target.readOnly ? '；文件是只读的，保存会被宿主拒绝（READ_ONLY），先取消只读属性' : ''
}

/**
 * `AddBomAction.doAddBOM`（:52-68）的等价物。
 *
 * 三条早退与上游一一对应：已有 BOM（:54-55）、编码没有 BOM 概念（:56-57）。
 * 成功那一档就是上游的 `setBOM(possibleBom)`（:59）：标记翻成 true；正文一个字都不动
 * （`setBinaryContent` 只把 BOM 字节拼在原有字节前面）。
 */
export function addBomOutcome(target: BomTarget): BomActionOutcome {
  if (target.bom) {
    return {
      changed: false, bom: true, dirty: false,
      notice: `${target.name} 已经带字节顺序标记，无需添加。`, error: false,
    }
  }
  if (!encodingHasPossibleBom(target.encoding)) {
    return {
      changed: false, bom: false, dirty: false,
      notice: `${target.name} 当前编码没有字节顺序标记，加不了；先换成 UTF-8 / UTF-16 / UTF-32 再试。`,
      error: false,
    }
  }
  return {
    changed: true, bom: true, dirty: true,
    notice: `已向 ${target.name} 添加字节顺序标记（未保存，按 Ctrl+S 写入）${readOnlyClause(target)}`,
    error: false,
  }
}

/**
 * `RemoveBomAction.doRemoveBOM` + 那条 ERROR 通知（:91-106、:115-125）的等价物。
 *
 * 强制档（UTF-16/UTF-32）在这里**不改任何东西**并给 `error: true` —— 上游把它们放进
 * `filesUnableToProcess`（:91-93）而不是调用 `doRemoveBOM`，正是这个意思。
 * 非强制档就是 `setBOM(null)`（:116）：标记翻成 false，正文不动。
 */
export function removeBomOutcome(target: BomTarget): BomActionOutcome {
  if (!target.bom) {
    // :78 —— 收集到的待处理文件为空时上游直接 return，连提示都没有；本仓给一句无操作说明。
    return {
      changed: false, bom: false, dirty: false,
      notice: `${target.name} 没有字节顺序标记，无需移除。`, error: false,
    }
  }
  if (encodingMandatoryBom(target.encoding)) {
    return {
      changed: false, bom: true, dirty: false,
      notice: `${removeBomFailedTitle(1)}；${removeBomMandatoryContent([target.name])}`,
      error: true,
    }
  }
  return {
    changed: true, bom: false, dirty: true,
    notice: `${REMOVING_BOM_PROGRESS}：已从 ${target.name} 移除字节顺序标记（未保存，按 Ctrl+S 写入）${readOnlyClause(target)}`,
    error: false,
  }
}

// ---------------------------------------------------------------- 菜单行（FilePropertiesGroup 的两项）

export interface BomMenuContext {
  /**
   * 当前文件。上游这里是 `CommonDataKeys.VIRTUAL_FILE`（AddBom）与 `VIRTUAL_FILE_ARRAY`（RemoveBom）；
   * 本仓两条通道都只有活动标签这一份（见模块头的范围差异）。
   */
  active: { readonly value: BomTarget | undefined }
  /** 执行「添加 BOM」——接线在 `src/editorFileOps.ts`（见报告里的接线请求）。 */
  addBom: () => void
  /** 执行「移除 BOM」——同上。 */
  removeBom: () => void
}

/**
 * `FilePropertiesGroup` 里那两行的等价物（`PlatformActions.xml:400-412` +
 * `LangActions.xml:517-522` 的顺序）：**移除在前、添加在后**，都紧跟在「文件编码…」之后。
 *
 * 两行**常驻**（`enabled()` 变化，不是条件渲染）：上游 `setVisible(enabled || isMainMenuOrActionSearch(place))`
 * 在主菜单里恒真（AddBomAction.java:41、RemoveBomAction.java:48），隐藏就等于擅自改上游行为。
 */
export function createBomMenuRows(ctx: BomMenuContext): MenuRow[] {
  return [
    {
      id: 'file.removeBom',
      title: REMOVE_BOM_TEXT,
      keywords: 'remove bom byte order mark utf 移除 字节顺序标记',
      enabled: () => removeBomState(ctx.active.value).enabled,
      run: () => ctx.removeBom(),
    },
    {
      id: 'file.addBom',
      title: ADD_BOM_TEXT,
      keywords: 'add bom byte order mark utf 添加 字节顺序标记',
      enabled: () => addBomState(ctx.active.value).enabled,
      run: () => ctx.addBom(),
    },
  ]
}