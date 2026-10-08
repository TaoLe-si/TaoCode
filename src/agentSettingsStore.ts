// Agent 设置各分节共用的**存储面**（读 JSON / 写 JSON / 窄接口），2026-10-07。
//
// 为什么单独一个文件：ZCode 的设置面板有十几个分节（记忆 / 子智能体 / 插件 / MCP / 技能 /
// 自动化 / 钩子…），每一节都要存自己那份形状。`src/agentSettings.ts` 已经带了一份
// `getItem/setItem` + try/catch 兜底 + 「存不下就静默降级」的逻辑；再让每个分节各自抄一遍，
// 抄到第 5 份时就会开始漂（有的漏了 JSON.parse 的 try、有的忘了配额满时返回 false）。
//
// 这里只放**机制**，不放任何一节的内容：分节自己管形状与校验，本模块管「怎么安全地
// 读写一个 localStorage 键」。存储不可用（隐私模式 / Node 测试 / 无 localStorage 的环境）
// 一律走 null 路径，调用方拿到的仍是合法默认值 —— 坏存档要能救回来，不许把用户锁在设置外
// （本仓铁律：不许按字段数量判损坏，真出过把用户锁在项目外的事故）。
//
// 测试传内存实现（`createMemoryStorage`），与 `src/analysisScope.ts` / `src/commitOptions.ts`
// 同一口径：窄接口注入，生产才落到真 localStorage。

/** 存储的窄接口。生产 = `localStorage`，测试 = 内存实现。 */
export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 缺省的存储实现。浏览器外（Node / Web Worker）返回 null，不是抛异常。 */
export function defaultSettingsStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Safari 隐私模式下访问 localStorage 本身就会抛 —— 那是「读不到」，不是「崩了」。
    return null
  }
}

/**
 * 读一个 JSON 键并归一化。
 *
 * 任何一层出问题（没有存储 / getItem 抛 / 不是 JSON / 形状不对）都退回 `normalize(null)`
 * 给的默认值，**永不抛、永不返回坏值**。调用方拿到的永远是合法形状。
 */
export function readSettingsJson<T>(storage: SettingsStorage | null, key: string, normalize: (input: unknown) => T): T {
  if (!storage) return normalize(null)
  let raw: string | null = null
  try {
    raw = storage.getItem(key)
  } catch {
    return normalize(null)
  }
  if (!raw) return normalize(null)
  try {
    return normalize(JSON.parse(raw))
  } catch {
    return normalize(null)
  }
}

/**
 * 写一个 JSON 键。返回**有没有真的落盘** —— 配额满 / 隐私模式时静默降级：
 * 只丢持久化，不打断本次会话（调用方据此显示「已保存」还是「本次会话仍生效」）。
 */
export function writeSettingsJson(storage: SettingsStorage | null, key: string, value: unknown): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** 测试用的内存存储（判据里用它断言「存档写了什么」）。 */
export function createMemoryStorage(initial: Record<string, string> = {}): SettingsStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => { map.set(key, value) },
    dump: () => Object.fromEntries(map),
  }
}

/** 一个存储不可用的替身：`getItem` 直接抛 —— 用来钉住「读路径也必须兜底」。 */
export function createThrowingStorage(): SettingsStorage {
  return {
    getItem: () => { throw new Error('存储不可用') },
    setItem: () => { throw new Error('存储不可用') },
  }
}