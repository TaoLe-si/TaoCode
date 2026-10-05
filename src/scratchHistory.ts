// 临时文件的历史与语言推断（上游 `platform/lang-impl/src/com/intellij/ide/scratch/`：
// `ScratchFileService` 记忆每个 scratch 的**语言/类型**（按文件名后缀与内容推），
// 「新建临时文件」对话框里的类型列表来自 `LanguageFileType` 的注册；历史（最近用过的）由
// `ScratchFileHistory` 维护）。
//
// 本仓现状：File 菜单能建临时文件（`src/menus/fileMenu.ts` + App.vue 的 createScratch），
// 但没有历史、没有语言推断对话框 —— scratch 的扩展名是固定生成的。这个模块补纯规则：
// 历史模型（去重、上限、LRU）与「文件名/内容 → 语言」的推断（复用 fileTypeDetection 的 shebang）。

import { detectByShebang, detectByContent } from './fileTypeDetection.ts'

/** 一条 scratch 记录（`ScratchFileService` 的 `ScratchFileInfo` 最小字段集）。 */
export interface ScratchFile {
  /** 工作区相对路径（scratch 也落在工作区下的 `.taocode/scratch/` 之类的目录里）。 */
  path: string
  name: string
  /** 编辑器语言 id（`languages.ts` 的四种之一）。 */
  language: string
  /** 最近使用时间（毫秒；由调用方给，测试可注入）。 */
  usedAt: number
}

export const SCRATCH_HISTORY_LIMIT = 20

/** 推入一条历史：同路径顶到最前（LRU），超过上限砍尾部。返回新数组。 */
export function pushScratchHistory(history: readonly ScratchFile[], entry: ScratchFile, limit = SCRATCH_HISTORY_LIMIT): ScratchFile[] {
  const rest = history.filter(item => item.path !== entry.path)
  return [entry, ...rest].slice(0, Math.max(1, limit))
}

/** 按名字找历史项（「新建临时文件」下拉里选一个之前用过的名字）。 */
export function findScratchByName(history: readonly ScratchFile[], name: string): ScratchFile | undefined {
  return history.find(item => item.name === name)
}

/** 清掉已不存在的 scratch（宿主删了文件，历史不该再留）。 */
export function pruneScratchHistory(history: readonly ScratchFile[], exists: (path: string) => boolean): ScratchFile[] {
  return history.filter(item => exists(item.path))
}

/** 扩展名 → 语言（scratch 只落四种编辑器语言；其它按 other）。 */
const SCRATCH_EXTENSIONS: Record<string, string> = {
  java: 'java', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
}

/** scratch 的默认文件名：`scratch-1.java` 这类（前端只给后缀，宿主落盘时再保证唯一）。 */
export function scratchFileName(index: number, extension: string): string {
  const suffix = extension.replace(/^\./, '')
  return suffix ? `scratch-${Math.max(1, Math.floor(index))}.${suffix}` : `scratch-${Math.max(1, Math.floor(index))}`
}

/**
 * 推断临时文件用什么语言：扩展名优先，shebang 次之（无扩展名的粘贴脚本），内容特征兜底。
 * 返回 `null` 表示认不出 —— 对话框让用户自己选，而不是默认给个错误的语言。
 */
export function inferScratchLanguage(fileName: string, content = ''): string | null {
  const dot = fileName.lastIndexOf('.')
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  if (extension && SCRATCH_EXTENSIONS[extension]) return SCRATCH_EXTENSIONS[extension]
  if (content) {
    const shebang = detectByShebang(content.trimStart().split('\n')[0] ?? '')
    if (shebang && shebang.language !== 'other') return shebang.language
    const detected = detectByContent(content)
    if (detected && detected.language !== 'other') return detected.language
  }
  return null
}

/** 历史项的展示副标题：`Java · 2026/10/4 9:05`（对话框列表）。 */
export function scratchSubtitle(file: ScratchFile): string {
  const date = new Date(file.usedAt)
  const stamp = Number.isNaN(date.getTime()) ? '' : ` · ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${file.language}${stamp}`
}
