// 「按文件选语法高亮」的扩展表（IDEA 的 `Language`/`FileType` 关联在本仓的等价物）。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：一串按扩展名的动态 import，
// 与视图/props 无关，唯一输入是路径与「关联文件类型」的覆盖值（'other' = 纯文本）。
//
// 大文件模式（`src/largeFileMode.ts`）下调用方不加载它 —— 理由是 `heavy` 的判断
// 需要内容长度，那属于宿主；这里只管「哪些扩展名要哪门语言的词法」。
import type { Extension } from '@codemirror/state'

export async function editorLanguageExtension(path: string, language?: string): Promise<Extension> {
  // An "Associate with File Type…" override replaces the extension heuristic;
  // 'other' means plain text on purpose. Without an override, extensions decide.
  const forced = language && language !== 'other' ? language : undefined
  if (language === 'other') return []
  if (forced === 'java' || (!forced && /\.java$/i.test(path))) return (await import('@codemirror/lang-java')).java()
  if (forced === 'cpp' || (!forced && /\.(cpp|cc|c|h|hpp|cxx)$/i.test(path))) return (await import('@codemirror/lang-cpp')).cpp()
  if (forced === 'typescript' || (!forced && /\.(ts|tsx|js|jsx|mjs)$/i.test(path)))
    return (await import('@codemirror/lang-javascript')).javascript({ typescript: forced ? forced === 'typescript' : /\.tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path) })
  if (/\.json$/i.test(path)) return (await import('@codemirror/lang-json')).json()
  if (/\.(html|vue)$/i.test(path)) return (await import('@codemirror/lang-html')).html()
  if (/\.css$/i.test(path)) return (await import('@codemirror/lang-css')).css()
  return []
}
