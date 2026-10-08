// 本地历史的**用户标签位**（`pv/history` 判词里「`PutLabelAction` 的标签位」那条缺）。
//
// 上游形状（逐个类开过）：
//   · `platform/lvcs-impl/src/com/intellij/history/integration/ui/actions/PutLabelAction.java:29-57`
//     —— 一个输入框（`Messages.showInputDialog`，`NonEmptyInputValidator` 挡空名），
//     拿到名字就 `LocalHistory.getInstance().putUserLabel(p, labelName)`，失败发 ERROR 通知、
//     成功发 INFORMATION 通知并挂一个「查看本地历史」的动作。
//   · `platform/lvcs-impl/src/com/intellij/history/core/LocalHistoryFacade.kt:113-116`
//     —— `putUserLabel(name, projectId)` 往变更流里塞一条 `PutLabelChange`（`nextId()` 取号）。
//   · `platform/lvcs-impl/src/com/intellij/history/core/changes/PutLabelChange.java:38-56`
//     —— 标签**不挂在某个路径上**：`affectsPath` 恒 false、`affectsProject` 按 projectId 判、
//     `getContentsToPurge()` 恒空（标签自己不占存储）。所以标签是「工程级的一个时间点」，
//     不是「某个文件的某条快照」。
//   · `platform/lvcs-impl/src/com/intellij/history/Label.java`（`com.intellij.history.Label`）
//     —— `getName()` / `getTimestamp()` 两个只读成员；`Label.NULL_INSTANCE` 是失败返回值。
//
// 本仓怎么承接（架构不等价处如实写）：
//   · 宿主（`native/history.cpp`）按路径存快照，没有「工程级变更流」，也没有放标签的地方；
//     而新增宿主方法要改 `src/bridge.ts` 的 `Method` union（本批冻结）⇒ 标签落在前端
//     `localStorage`，键 `taocode.localHistoryLabels`，按项目根分桶（`{[root]: Label[]}`）。
//   · 语义与上游一致的那两条：**按工程**（不是按文件）、**只记时间点与名字**（不存内容）。
//     于是「恢复到标签」= 拿标签的时间戳当边界，走既有的 `sessionRevertPlan`（把每个文件
//     回退到该时刻之前最后一版）—— 与上游 `Label` 的用法同义。
//   · 与上游的差异：上游标签活在变更流里，能跟历史一起被 purge；本仓标签独立于快照存在，
//     清空本地历史不会清标签（时间戳指向不存在的快照时，恢复计划自然为空，不报错）。
import type { HistoryEntry } from './bridge.ts'

/** `localStorage` 键（应用级；桶内再按项目根分）。 */
export const HISTORY_LABELS_STORAGE_KEY = 'taocode.localHistoryLabels'

/** 标签名的上限（上游 `NonEmptyInputValidator` 只挡空，不挡长；本仓给个防爆上限）。 */
export const HISTORY_LABEL_MAX = 120

export interface HistoryLabel {
  /** 用户给的名字（`Label.getName()`）。 */
  name: string
  /** 打标签那一刻的时间戳（`Label.getTimestamp()`，毫秒）。 */
  timeMillis: number
  /** 打标签时活动文件的路径（仅用于列表里显示「在哪打的」，不参与恢复语义）。 */
  path: string
}

type LabelBuckets = Record<string, HistoryLabel[]>

/** 名字去空白后的可用形态；空名/全空白按上游 `NonEmptyInputValidator` 拒绝（返回 null）。 */
export function normalizeLabelName(raw: string): string | null {
  const name = raw.trim().slice(0, HISTORY_LABEL_MAX)
  return name ? name : null
}

function readBuckets(storage: Pick<Storage, 'getItem'> | null | undefined): LabelBuckets {
  if (!storage) return {}
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HISTORY_LABELS_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const buckets: LabelBuckets = {}
    for (const [root, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const labels: HistoryLabel[] = []
      for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const label = item as Partial<HistoryLabel>
        if (typeof label.name !== 'string' || !label.name) continue
        if (typeof label.timeMillis !== 'number' || !Number.isFinite(label.timeMillis)) continue
        labels.push({ name: label.name, timeMillis: label.timeMillis, path: typeof label.path === 'string' ? label.path : '' })
      }
      buckets[root] = labels
    }
    return buckets
  } catch {
    return {}
  }
}

function writeBuckets(storage: Pick<Storage, 'setItem'> | null | undefined, buckets: LabelBuckets): void {
  if (!storage) return
  try { storage.setItem(HISTORY_LABELS_STORAGE_KEY, JSON.stringify(buckets)) } catch { /* 存储不可用：只在内存里活 */ }
}

/** 某个项目的标签，按时间**新→旧**（列表与「最近打的在最上面」一致）。 */
export function loadLabels(root: string, storage?: Pick<Storage, 'getItem'> | null): HistoryLabel[] {
  const labels = readBuckets(storage ?? defaultStorage())[root] ?? []
  return [...labels].sort((a, b) => b.timeMillis - a.timeMillis || a.name.localeCompare(b.name))
}

function defaultStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/**
 * 打一个标签（`PutLabelAction` + `putUserLabel`）。同名标签**顶替**旧的（上游同名会各记一条，
 * 但列表里两个同名时间点无法分辨；本仓取「同名 = 更新到此刻」，并把这条差异写在这里）。
 * 返回落盘后的清单（新→旧）；名字不可用（空/全空白）返回 null。
 */
export function putLabel(root: string, rawName: string, timeMillis: number, path: string,
                         storage?: Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'> | null): HistoryLabel[] | null {
  const name = normalizeLabelName(rawName)
  if (!name) return null
  const store = storage ?? (defaultStorage() as (Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'>) | null)
  const buckets = readBuckets(store)
  const labels = (buckets[root] ?? []).filter(label => label.name !== name)
  labels.push({ name, timeMillis, path })
  buckets[root] = labels
  writeBuckets(store, buckets)
  return loadLabels(root, store)
}

/** 删一个标签（上游没有删除入口，这是本仓为了不让 localStorage 无限长而加的；行为面见面板的行菜单）。 */
export function removeLabel(root: string, name: string,
                            storage?: Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'> | null): HistoryLabel[] {
  const store = storage ?? (defaultStorage() as (Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'>) | null)
  const buckets = readBuckets(store)
  buckets[root] = (buckets[root] ?? []).filter(label => label.name !== name)
  writeBuckets(store, buckets)
  return loadLabels(root, store)
}

/**
 * 标签在某条时间线上的位置：**该时刻（含）之前的最后一条快照** —— 与
 * `newestSnapshotBefore`（`src/historySessions.ts`）同一个口径，所以「恢复到此标签」能直接
 * 复用会话恢复的计划函数。找不到（标签比最早的快照还早）返回 null，调用方据此提示。
 */
export function labelEntry(entries: readonly HistoryEntry[], label: HistoryLabel): HistoryEntry | null {
  for (const entry of entries) if (entry.timeMillis <= label.timeMillis) return entry
  return null
}

/** 列表里那一行的显示名（上游只有名字；本仓把时间也带上，因为同名顶替后需要能分辨时刻）。 */
export function labelRowText(label: HistoryLabel): string {
  const time = new Date(label.timeMillis)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${label.name}  ·  ${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} `
    + `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
}