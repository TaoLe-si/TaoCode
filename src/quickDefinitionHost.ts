// 「快速定义」的宿主：状态 + 取坐标 + 走解析链。逻辑全在 `src/quickDefinition.ts`（纯函数）。
//
// 单独一个文件的原因与这个仓库其它宿主一致：`CodeEditor.vue` 贴着机检上限
// （tests/module-size.test.mjs 登记在册，只降不升），编辑器里只留"建一次 + 一条命令 + 一段 Teleport"。
import { ref } from 'vue'
import type { EditorView } from '@codemirror/view'
import { resolveQuickDefinition, wordAtPosition, type QuickDefinitionSource } from './quickDefinition.ts'

export interface QuickDefinitionHostDeps {
  /** 这条文件上语言服务是否可用（没开就不接管这个键位）。 */
  enabled: () => boolean
  /** 当前文件路径与缓冲（打开的缓冲优先读它，免得弹的是磁盘旧版）。 */
  path: () => string
  buffer: () => string | undefined
  /** 光标处的坐标（拿不到就不给，弹层自己居中）。 */
  coords: (pos: number) => { left?: number; bottom?: number } | null | undefined
  /** 只读工程内文件（宿主 `file.read`）。 */
  readFile: (path: string) => Promise<string>
  request: <T>(method: 'lsp.request', params: Record<string, unknown>) => Promise<T>
  /** 宿主 `file.librarySource`（库源码来自工程里的 *-sources.jar）。 */
  librarySource: (qualifier: string) => Promise<{ available: boolean; path?: string; jar?: string; entry?: string; content?: string }>
  /** 什么都没得看时的提示（与 IDEA 的提示同义：这里没有可显示的定义）。 */
  report: (message: string) => void
}

export function createQuickDefinitionHost(deps: QuickDefinitionHostDeps) {
  const quickDefinition = ref<{ source: QuickDefinitionSource; x?: number; y?: number } | null>(null)
  async function show(pos: number, line: number, character: number, word: string) {
    const source = await resolveQuickDefinition({
      readBuffer: path => (path === deps.path() ? deps.buffer() ?? null : null),
      readFile: deps.readFile,
      request: deps.request,
      librarySource: deps.librarySource,
    }, { path: deps.path(), line, character, word })
    if (!source) { deps.report('此处没有可显示的定义。'); return }
    const coords = deps.coords(pos)
    quickDefinition.value = { source, x: coords?.left, y: coords?.bottom }
  }
  /** 编辑器命令：光标处的词 + 位置交给解析链（返回 false = 这个键位不归我）。 */
  function command(editor: EditorView): boolean {
    if (!deps.enabled()) return false
    const pos = editor.state.selection.main.head
    const info = editor.state.doc.lineAt(pos)
    void show(pos, info.number - 1, pos - info.from, wordAtPosition(info.text, pos - info.from))
    return true
  }
  return { quickDefinition, show, command }
}
