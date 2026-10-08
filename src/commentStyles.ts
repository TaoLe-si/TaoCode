// 注释标记表（扩展名/语言 id → 行、块标记）—— 上游 `Commenter` 的「语言 → 注释词法」在本仓的纯数据落点。
//
// 为什么单拆一个文件（本批 live-template 宏的依赖约束，判词与坐标见 `docs/batch-2026-10-06-templ2.md`）：
//   · 这张表原先长在 `src/commentToggle.ts` 里，而那个模块顶层 value-import 了 `@codemirror/state`（给
//     注释切换的 CodeMirror 命令用）。`src/templates.ts` 的既有契约是「展开规则**不依赖 CodeMirror**、
//     可独立单测」（`tests/templates.test.mjs`），所以 `src/templateMacros.ts` 的 comment 宏
//     （上游 `CommentMacro.java:38-64`）不能去 `commentToggle.ts` 取这张表 —— 一取就把 CodeMirror 拽进
//     templates 的依赖图。
//   · 解法：把纯数据搬到这里（零运行时依赖），`commentToggle.ts` 反过来从这里取用并原样再导出
//     `commentStyleFor`，既有 ~10 个 consumer 的 `import { commentStyleFor } from './commentToggle.ts'`
//     一行不改；`templateMacros.ts` 直接 import 本模块。**只有一份表**，不会出现两套口径。
//   · `CommentStyle` 这个类型仍由 `commentToggle.ts` 导出，这里只做 `import type`（编译期擦除，
//     不产生运行期边，CodeMirror 因此不会经由类型传递进来）。
//
// 对照上游：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/CommentMacro.java:31-35` 用
// `LanguageCommenters.forLanguage(editor 的 PSI 语言)`；本仓没有 PSI，改按**文件扩展名**查这张表
// （与已经落地的 `filePath` 宏同一条「从 `context.path` 取原料」的路数，见 `src/templateMacros.ts`）。
// 查不到（未知扩展名 / 只有块注释却没有行注释等）返回 null，语义等同上游「没有 Commenter」。

import type { CommentStyle } from './commentToggle.ts'

/** 语言 id → 注释标记（`language` 命中优先于扩展名）。 */
const BY_LANGUAGE: Record<string, CommentStyle> = {
  java: { line: '//', block: ['/*', '*/'] },
  cpp: { line: '//', block: ['/*', '*/'] },
  typescript: { line: '//', block: ['/*', '*/'] },
}

/** 扩展名 → 注释标记（与 `src/fileTypes.ts` 的关联表无关的一张只读表；`language` 命中优先）。 */
const BY_EXTENSION: Record<string, CommentStyle> = {
  java: { line: '//', block: ['/*', '*/'] },
  c: { line: '//', block: ['/*', '*/'] }, h: { line: '//', block: ['/*', '*/'] },
  cpp: { line: '//', block: ['/*', '*/'] }, cc: { line: '//', block: ['/*', '*/'] }, cxx: { line: '//', block: ['/*', '*/'] },
  hpp: { line: '//', block: ['/*', '*/'] }, hh: { line: '//', block: ['/*', '*/'] },
  cs: { line: '//', block: ['/*', '*/'] }, go: { line: '//', block: ['/*', '*/'] }, rs: { line: '//', block: ['/*', '*/'] },
  kt: { line: '//', block: ['/*', '*/'] }, kts: { line: '//', block: ['/*', '*/'] }, scala: { line: '//', block: ['/*', '*/'] },
  swift: { line: '//', block: ['/*', '*/'] }, dart: { line: '//', block: ['/*', '*/'] }, php: { line: '//', block: ['/*', '*/'] },
  m: { line: '//', block: ['/*', '*/'] }, js: { line: '//', block: ['/*', '*/'] }, jsx: { line: '//', block: ['/*', '*/'] },
  ts: { line: '//', block: ['/*', '*/'] }, tsx: { line: '//', block: ['/*', '*/'] }, css: { block: ['/*', '*/'] },
  py: { line: '#' }, rb: { line: '#' }, pl: { line: '#' }, pm: { line: '#' }, sh: { line: '#' },
  bash: { line: '#' }, zsh: { line: '#' }, fish: { line: '#' }, yml: { line: '#' }, yaml: { line: '#' },
  toml: { line: '#' }, r: { line: '#' }, ps1: { line: '#' }, makefile: { line: '#' }, cmake: { line: '#' },
  properties: { line: '#' }, conf: { line: '#' }, ini: { line: ';' }, el: { line: ';' },
  lua: { line: '--', block: ['--[[', ']]'] }, sql: { line: '--', block: ['/*', '*/'] },
  hs: { line: '--', block: ['{-', '-}'] }, adb: { line: '--' }, vhdl: { line: '--' },
  tex: { line: '%' }, erl: { line: '%' }, ml: { block: ['(*', '*)'] },
  html: { block: ['<!--', '-->'] }, htm: { block: ['<!--', '-->'] }, xml: { block: ['<!--', '-->'] },
  svg: { block: ['<!--', '-->'] }, vue: { block: ['<!--', '-->'] }, md: { block: ['<!--', '-->'] },
  markdown: { block: ['<!--', '-->'] },
}

/** 语言 id / 文件路径 → 注释标记；两者都认不出时返回 null（与没有 Commenter 同义）。 */
export function commentStyleFor(language: string | undefined, path = ''): CommentStyle | null {
  const byLanguage = language ? BY_LANGUAGE[language] : undefined
  if (byLanguage) return byLanguage
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase()
  return BY_EXTENSION[extension] ?? null
}
