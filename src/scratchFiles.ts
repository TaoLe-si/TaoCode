// 临时文件（IDEA 的 `NewScratchFileAction`，Ctrl+Alt+Shift+Insert）—— 从 App.vue 拆出的
// 创建序列，只为把这段有重试的 IO 挪出组装层（判据见 tests/scratch-files.test.mjs）。
//
// 上游 `ScratchFileService` 把临时文件放在 IDE 配置目录；本仓落在**工作区内的 `scratch/`**
// （产品选择：临时文件跟着项目走，才看得到也才存得进本地历史）。
// 名字冲突的处理逐条照搬运前的行为：目录已存在不算错，文件名按 `scratch-N.txt` 递增重试
// （`file.create` 的 `EXISTS` 是宿主给的冲突信号，不是错误）。
import { BridgeError, request } from './bridge.ts'
import { errorMessage } from './errors.ts'

export interface ScratchFileDeps {
  /** 没有工作区就不创建（上游没有项目时临时文件也没有落点）。 */
  workspaceOpen: () => boolean
  closeMenu: () => void
  refreshTree: () => Promise<unknown> | unknown
  openFile: (path: string) => Promise<unknown>
  notify: (message: string, error?: boolean) => void
}

/** 创建并打开 `scratch/scratch-N.txt`；返回创建出的路径（失败返回 null）。 */
export async function createScratchFile(deps: ScratchFileDeps): Promise<string | null> {
  if (!deps.workspaceOpen()) return null
  deps.closeMenu()
  try {
    try { await request('file.create', { path: 'scratch', directory: true }) } catch { /* scratch/ may already exist */ }
    let index = 1
    let path = `scratch/scratch-${index}.txt`
    while (true) {
      try { await request('file.create', { path }); break }
      catch (e) {
        if (e instanceof BridgeError && e.code === 'EXISTS') { index++; path = `scratch/scratch-${index}.txt` }
        else throw e
      }
    }
    await deps.refreshTree()
    await deps.openFile(path)
    deps.notify(`已创建临时文件 ${path}`)
    return path
  } catch (error) {
    deps.notify(errorMessage(error), true)
    return null
  }
}
