// 编辑器里的 TODO 高亮 —— 上游 `TodoHighlightVisitor`（`platform/todo/src/com/intellij/ide/todo/TodoHighlightVisitor.java`）
// 在本仓的落点。判词 `pv/todo` 里「编辑器内的 TODO 高亮」那条缺的就是它：
// 面板预览一直有（`src/components/TodoPanel.vue` 的标记上色），编辑器注释里的标记此前不着色。
//
// 上游逐条对照：
//   · `TodoHighlightVisitor.java:91-93`：拿模式的 `getWordToHighlight()`（= `IndexPattern` 抽出的
//     字面词）在**行文本**里 `Strings.indexOfIgnoreCase` 定位标记词，只给那个词上色 ——
//     本仓同一口径复用 `src/todoMultiLine.ts` 的 `todoMarkerRegions()`（它已经是
//     `TodoHighlightVisitor.java:91-93` 的等价物，面板预览与这里同一份实现，不写第二遍）。
//   · `TodoHighlightVisitor.java:106-111` 的 `formatDescription`：描述 = 主行 + 续行按 `\n` 连接
//     ⇒ 本仓复用 `todoContinuationLines()`（`IndexPatternSearcher.findContinuation` 的等价物）
//     与 `todoFullText()`。注：不是每行都算续行（那要多跑一遍扫描），只在**命中标记的那一行**上算。
//   · 颜色：上游取该模式在颜色方案里的 `TodoAttributes`（`TodoPattern.getColor()`），
//     出厂 `CodeInsightColors.TODO_DEFAULT_ATTRIBUTES` = FOREGROUND `0073bf` + FONT_TYPE 2/3
//     （`DefaultColorSchemesManager.xml:1045-1049`，即**斜体**）；new UI 浅色方案另给一档
//     （`themes/expUI/expUI_lightScheme.xml:462-466`）。本仓没有色板页，模式的颜色自带在模式表里
//     （`TodoPattern.color`，设置页那一列），有颜色就按它上色，没有就落主题 class（见下面的 `cm-todoMarker`）。
//   · 严重度：上游那条 HighlightInfo 是 `HighlightInfoType.INFORMATION`。
//
// 与上游的架构差异（如实写明）：上游靠索引/PSI 的注释 token 划定「哪些位置要建 TODO」
//（`com.intellij.todoExtraPlaces` 那一档），本仓没有 token 流，注解器按**整行文本**跑
//（与面板的 `search.run` 文本扫描同一口径）；`dirtyLines` 给了就只算脏行
//（`GeneralHighlightingPass` 的 `myUpdateAll=false` 那一条路，与 `src/annotatorHighlights.ts`
// 里另外两条内建注解器同一写法）。
//
// 模式表的来源（三条真实喂值链路，缺一条也不至于空转）：
//   1) 出厂默认 = `defaultProjectSettings.todoPatterns`（与原生 `validate_todo_patterns` 同一张表）；
//   2) `src/toolViewContext.ts` 建工具窗口上下文时按项目设置灌一次（computed ⇒ 设置一变就重灌）；
//   3) `src/components/TodoPanel.vue` 挂载/模式表变化时灌一次（它本来就拿到了 `props.patterns`）。
// 已知限制（不粉饰）：本仓注解层按**文档内容**短路（`src/highlightPasses.ts` 的
// `runGeneralHighlightingPass` 内容未变即整拍跳过）⇒ 只改模式表、不碰文档时，已打开的编辑器要等
// 下一次编辑（或诊断推送）才按新表重画。上游是 `TodoConfiguration` 变更直接触发整套重算。
import type { Annotator, AnnotatorInput } from './annotatorRegistry.ts'
import { defaultProjectSettings, type TodoPattern } from './settingsModel.ts'
import { todoContinuationLines, todoFullText, todoMarkerRegions } from './todoMultiLine.ts'

/** 上游的注解器类名（`HighlightInfo.fromAnnotation` 的第一个参数就是它）。 */
export const TODO_ANNOTATOR_ID = 'todoHighlightVisitor'
/** `HighlightInfoType.INFORMATION`（`HighlightInfoType.java:44-46`）。 */
export const TODO_ANNOTATOR_SEVERITY = 'information' as const

export interface TodoHighlightPattern { pattern: string; caseSensitive?: boolean; color?: string }

/** 出厂表 = 项目设置的默认值（`defaultProjectSettings.todoPatterns`，同一张表）。 */
const FALLBACK_PATTERNS: readonly TodoHighlightPattern[] = defaultProjectSettings.todoPatterns

let patterns: readonly TodoHighlightPattern[] = FALLBACK_PATTERNS

/**
 * 灌入当前项目的 TODO 模式表（宿主的真实喂值口，见模块头的三条链路）。
 * 收 `readonly TodoPattern[]` 但只留三个字段：注解层只关心「怎么匹配 / 什么颜色」。
 */
export function setTodoHighlightPatterns(next: readonly TodoPattern[] | readonly TodoHighlightPattern[]): void {
  const kept: TodoHighlightPattern[] = []
  for (const entry of next ?? []) {
    if (!entry || typeof entry.pattern !== 'string' || !entry.pattern.trim()) continue
    kept.push({ pattern: entry.pattern, caseSensitive: entry.caseSensitive === true,
      color: typeof entry.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.color) ? entry.color : undefined })
  }
  patterns = kept.length ? kept : FALLBACK_PATTERNS
}

/** 当前生效的模式表（判据用它钉住「灌进去的真的被用了」）。 */
export function todoHighlightPatterns(): readonly TodoHighlightPattern[] { return patterns }

export interface TodoHighlightInput {
  text: string
  patterns?: readonly TodoHighlightPattern[]
  /** 增量拍只算脏行（同 `src/annotatorHighlights.ts` 的收法）。 */
  dirtyLines?: readonly { start: number; end: number }[] | null
}

export interface TodoHighlightRegion {
  /** 文档绝对偏移（半开）。 */
  from: number
  to: number
  /** 命中的标记词（上游 `getWordToHighlight()` 抽出来的那一段）。 */
  text: string
  color?: string
  /** `formatDescription`：主行 + 续行（`todoFullText`）。 */
  description: string
}

/**
 * 一份文档里的全部 TODO 标记区间（上游 `TodoHighlightVisitor` 的可见面）。
 * 行首偏移自己走一遍（不引 `annotatorHighlights.ts` 的 `offsetOfLine`：那是逐行 `indexOf`，
 * 这里是顺序切分，一次遍历出全部行；两者口径都是"`\n` 分行的下一行行首"）。
 */
export function todoHighlightRegions(input: TodoHighlightInput): TodoHighlightRegion[] {
  const active = input.patterns ?? patterns
  if (!active.length) return []
  const lines = input.text.split('\n')
  const out: TodoHighlightRegion[] = []
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    // 增量拍：不在脏行里的跳过（脏行边界 0 基，闭区间 —— 与另外两条注解器同一形状）。
    const dirty = input.dirtyLines
    if (dirty && !dirty.some(range => range.start <= index && index <= range.end)) { offset += line.length + 1; continue }
    for (const region of todoMarkerRegions(line, active)) {
      const word = line.slice(region.start, region.start + region.length)
      const pattern = active.find(entry => entry.color !== undefined && matchesWord(entry, word, line, region.start))
      const additional = todoContinuationLines(lines, index + 1, region.start, active)
      out.push({
        from: offset + region.start,
        to: offset + region.start + region.length,
        text: word,
        color: pattern?.color,
        description: todoFullText(line.trim(), additional),
      })
    }
    offset += line.length + 1
  }
  return out.sort((left, right) => left.from - right.from || left.to - right.to)
}

/** 这一条模式是不是那一段标记词的主人（颜色只该来自真正命中的那一条）。 */
function matchesWord(pattern: TodoHighlightPattern, word: string, line: string, start: number): boolean {
  const source = pattern.pattern.trim()
  if (!source) return false
  try {
    const expression = new RegExp(source, pattern.caseSensitive === true ? '' : 'i')
    const match = expression.exec(line.slice(start))
    return match !== null && word.toLowerCase() === (match[0].slice(0, word.length)).toLowerCase()
  } catch { return line.slice(start, start + word.length).toLowerCase() === source.toLowerCase() }
}

/**
 * `TodoHighlightVisitor` 的注解器形态：产出 `kind: 'todo'` 的注解（`src/annotatorHighlights.ts`
 * 的内建注册表收编它 ⇒ `src/components/CodeEditor.vue` 的注解层自动消费）。
 */
export const todoAnnotator: Annotator = {
  id: TODO_ANNOTATOR_ID,
  languages: ['*'],
  displayName: 'TODO',
  annotate(input: AnnotatorInput) {
    return todoHighlightRegions({
      text: input.text,
      dirtyLines: input.dirtyLines ?? null,
    }).map(region => ({
      from: region.from,
      to: region.to,
      severity: TODO_ANNOTATOR_SEVERITY,
      kind: 'todo' as const,
      description: region.description,
      color: region.color,
    }))
  },
}
