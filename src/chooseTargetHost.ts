// 「选择声明」弹层的宿主（声明侧）：状态 + 行内容加载 + 挑选回调。
//
// 与 `src/quickDefinitionHost.ts` 同一形状，也是同一个理由：`CodeEditor.vue` 贴着机检上限，
// 编辑器里只留"建一次 + 一条命令 + 一段 Teleport"。行模型/过滤/移动在 `src/chooseTarget.ts`（纯函数）。
import { ref } from 'vue'
import { chooseTargetRows, loadTargetContents, type ChooseTargetRow, type TargetLocation } from './chooseTarget.ts'

export interface ChooseTargetHostDeps {
  /** 当前编辑器里的文件路径与缓冲（目标就在本文档时用它，免得读到磁盘旧版）。 */
  path: () => string
  buffer: () => string | undefined
  /** 只读工程内文件（宿主 `file.read`）。 */
  readFile: (path: string) => Promise<string>
}

export function createChooseTargetHost(deps: ChooseTargetHostDeps) {
  const chooseTarget = ref<{ rows: ChooseTargetRow[]; x?: number; y?: number } | null>(null)
  /** 目标文件的内容用来取声明点的名字（主文本），读不到就退到文件名。 */
  async function open(targets: readonly TargetLocation[], at: { x?: number; y?: number } | undefined) {
    const contents = await loadTargetContents(targets,
      path => (path === deps.path() ? deps.buffer() ?? null : null),
      async path => (await deps.readFile(path)))
    chooseTarget.value = { rows: chooseTargetRows(targets, contents), x: at?.x, y: at?.y }
  }
  function close() { chooseTarget.value = null }
  return { chooseTarget, open, close }
}
