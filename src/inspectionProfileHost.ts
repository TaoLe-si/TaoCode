// 检查配置档落盘的**宿主通道** —— 把 `src/inspectionProfileIo.ts` 那套 deps 接到真实桥上。
//
// 为什么单独一个文件、且**不 import 桥**：`inspectionProfileIo.ts` 与本文件都不引桥，
// `node --test` 能直接测（见 `tests/inspection-profile-disk-wiring.test.mjs`），
// 真桥由调用方（`src/components/ProblemsPanel.vue`）把 `request` 传进来 —— 与
// `src/inspectionProfileIo.ts` 头里那套「依赖经 deps 注入」的约定一致。
//
// 通道（`src/bridge.ts:109` 的 Method 清单）：
//   · `workspace.files` → `{ files: string[] }` —— 注意是**字符串数组**，`ProfileDiskDeps.list`
//     要的是 `{ path }[]`，映射在这一层做；
//   · `file.create`（`{ path, directory? }`，已存在不报错，见 `native/main.cpp:985-990`）——
//     `directory` 键**只在要建目录时带**，桥那边按有没有这个键判目录/文件；
//   · `file.read` → `{ path, content, version }`；
//   · `file.write`（`{ path, content, expectedVersion }`，CAS 写，见 `native/main.cpp:971-983`）。
// 不用 `app.writeExportFiles` —— 那条只放行 `.html`/`.htm`（`native/export_file.cpp`），写不出 `.xml`。
import type { Method } from './bridge'
import type { ProfileDiskDeps } from './inspectionProfileIo.ts'

/** 真桥的 `request` 形状（这里只用到它需要的那部分，方便测试塞假实现）。 */
export type ProfileSend = <T>(method: Method, params?: Record<string, unknown>) => Promise<T>

/** 把桥包装成 `ProfileDiskDeps`。`send` 由调用方注入（生产传 `request`）。 */
export function bridgeProfileDiskDeps(send: ProfileSend): ProfileDiskDeps {
  return {
    create: (path, directory) => send('file.create', { path, ...(directory ? { directory: true } : {}) }),
    read: path => send<{ content?: string; version?: string }>('file.read', { path }),
    write: (path, content, expectedVersion) => send('file.write', { path, content, expectedVersion }),
    // 桥给的是 `string[]`，`ProfileDiskDeps` 那一侧要 `{ path }[]`；顺手去掉前导 `./`。
    list: async () => ((await send<{ files: string[] }>('workspace.files')).files ?? [])
      .map(path => ({ path: path.replace(/^\.\//, '') })),
  }
}
