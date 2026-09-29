import type { GitFullCommit } from './bridge'

const palette = ['#4FC1E9', '#A0D468', '#FFCE54', '#FC6E51', '#ED5565', '#AC92EC', '#48CFAD', '#EC87C0', '#5D9CEC', '#E8636F']
export const ROW_H = 26
const LANE_W = 14
export const laneX = (lane: number) => lane * LANE_W + LANE_W / 2
export const lanePath = (from: number, to: number) =>
  `M ${laneX(from)} ${ROW_H / 2} C ${laneX(from)} ${ROW_H * 0.75} ${laneX(to)} ${ROW_H * 0.75} ${laneX(to)} ${ROW_H}`
export function rootColor(root: string): string {
  let hash = 0
  for (let i = 0; i < root.length; i++) hash = ((hash << 5) - hash + root.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]!
}
export interface GraphRow {
  commit: GitFullCommit
  lane: number
  color: string
  down: Array<{ from: number; to: number; color: string }>
  up: Array<{ lane: number; color: string }>
  pass: Array<{ lane: number; color: string }>
}

// Preserve the existing child-before-parent graph; missing parents are not invented.
export function buildLogGraph(list: GitFullCommit[]) {
  if (!list.length) return { rows: [] as GraphRow[], width: 0 }
  const rowOf = new Map<string, number>()
  list.forEach((commit, index) => { if (!rowOf.has(commit.hash)) rowOf.set(commit.hash, index) })
  const laneOf = new Map<string, number>()
  const lanes: Array<string | null> = []
  const claimLane = (hash: string) => {
    const existing = laneOf.get(hash)
    if (existing !== undefined) return existing
    const free = lanes.indexOf(null)
    const lane = free >= 0 ? free : lanes.push(null) - 1
    laneOf.set(hash, lane)
    return lane
  }
  const rows: GraphRow[] = []
  const edges: Array<{ from: number; to: number; fromRow: number; targetRow: number; color: string }> = []
  list.forEach((commit, index) => {
    const lane = claimLane(commit.hash)
    lanes[lane] = null
    for (const parent of commit.parents) {
      const targetRow = rowOf.get(parent)
      if (targetRow === undefined || targetRow <= index) continue
      const parentLane = claimLane(parent)
      lanes[parentLane] = parent
      edges.push({ from: lane, to: parentLane, fromRow: index, targetRow, color: rootColor(parent) })
    }
    rows.push({ commit, lane, color: rootColor(commit.hash), down: [], up: [], pass: [] })
  })
  for (const edge of edges) {
    rows[edge.fromRow]?.down.push({ from: edge.from, to: edge.to, color: edge.color })
    rows[edge.targetRow]?.up.push({ lane: edge.to, color: edge.color })
    for (let row = edge.fromRow + 1; row < edge.targetRow; row++) rows[row]?.pass.push({ lane: edge.to, color: edge.color })
  }
  let laneCount = 1
  for (const row of rows) laneCount = Math.max(laneCount, row.lane + 1)
  for (const edge of edges) laneCount = Math.max(laneCount, edge.to + 1)
  return { rows, width: laneCount * LANE_W }
}
export function logDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
