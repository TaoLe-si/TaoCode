// IDEA's drag-to-split geometry, ported from TabsUtil.
//
// Dropping an editor tab onto the editor area with the mouse near an edge splits the
// editor instead of just reordering tabs. The decision is pure geometry: the area is cut
// into four trapezoids (one per edge) plus the centre, and the trapezoid the pointer sits
// in names the side. `TabsUtil.java:54-93` builds the four GeneralPath shapes and tests
// them right -> left -> bottom -> top -> centre, and `:95-111` turns the side into the
// half-rectangle used as the drop preview.
//
// The trapezoid ratio is the registry key `ide.tabbedPane.dragToSplitRatio`
// (`platform/util/resources/misc/registry.properties:559` = 0.2), clamped to 0.05..0.45
// exactly like the source clamps it (`TabsUtil.java:55`).

/** registry.properties:559 — ide.tabbedPane.dragToSplitRatio default. */
export const DRAG_TO_SPLIT_RATIO = 0.2

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Swing's `SwingConstants` values the source returns; `null` is the source's `-1`. */
export type DropSide = 'CENTER' | 'TOP' | 'LEFT' | 'BOTTOM' | 'RIGHT'

/** TabsUtil.java:55 — `Math.max(.05, Math.min(.45, ratio))`. */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DRAG_TO_SPLIT_RATIO
  return Math.max(0.05, Math.min(0.45, ratio))
}

/**
 * GeneralPath.contains(point) (TabsUtil.java:88-91): the trapezoids are simple polygons, so
 * a ray-casting test is equivalent. The shapes are closed (closePath at :65, :72, :79, :86),
 * so the boundary is handled the same way on both sides as far as the hit test matters.
 */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const straddles = (a.y > point.y) !== (b.y > point.y)
    if (!straddles) continue
    const crossX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < crossX) inside = !inside
  }
  return inside
}

/** The four trapezoids of TabsUtil.java:60-86, in the order the source tests them. */
export function dropShapes(rect: Rect, ratio: number = DRAG_TO_SPLIT_RATIO) {
  const r = clampRatio(ratio)
  const { x, y, width: w, height: h } = rect
  const right = (px: number) => x + px
  const down = (py: number) => y + py
  return {
    top: [
      { x: right(0), y: down(0) },
      { x: right(w), y: down(0) },
      { x: right(w * (1 - r)), y: down(h * r) },
      { x: right(w * r), y: down(h * r) },
    ],
    left: [
      { x: right(0), y: down(0) },
      { x: right(w * r), y: down(h * r) },
      { x: right(w * r), y: down(h * (1 - r)) },
      { x: right(0), y: down(h) },
    ],
    bottom: [
      { x: right(0), y: down(h) },
      { x: right(w * r), y: down(h * (1 - r)) },
      { x: right(w * (1 - r)), y: down(h * (1 - r)) },
      { x: right(w), y: down(h) },
    ],
    right: [
      { x: right(w), y: down(0) },
      { x: right(w * (1 - r)), y: down(h * r) },
      { x: right(w * (1 - r)), y: down(h * (1 - r)) },
      { x: right(w), y: down(h) },
    ],
  }
}

/**
 * TabsUtil.java:54-93. Returns the side the pointer is in, `null` when it is outside the
 * rectangle altogether (the source's `-1`). Order matters: the edges win over the centre
 * and right is tested before left, bottom before top.
 */
export function dropSideFor(point: Point, rect: Rect, ratio: number = DRAG_TO_SPLIT_RATIO): DropSide | null {
  const shapes = dropShapes(rect, ratio)
  if (pointInPolygon(point, shapes.right)) return 'RIGHT'
  if (pointInPolygon(point, shapes.left)) return 'LEFT'
  if (pointInPolygon(point, shapes.bottom)) return 'BOTTOM'
  if (pointInPolygon(point, shapes.top)) return 'TOP'
  const inside = point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height
  return inside ? 'CENTER' : null
}

/**
 * TabsUtil.java:95-111 — the half-rectangle the dropped file will occupy. Note the source
 * halves TOP by `height /= 2` but computes BOTTOM as `h = height / 2; height -= h; y += h`,
 * which differ by one pixel for odd heights; both are kept as written.
 */
export function updateBoundsWithDropSide(bounds: Rect, side: DropSide): Rect {
  const next = { ...bounds }
  switch (side) {
    case 'TOP':
      next.height = Math.trunc(next.height / 2)
      break
    case 'LEFT':
      next.width = Math.trunc(next.width / 2)
      break
    case 'BOTTOM': {
      const half = Math.trunc(next.height / 2)
      next.height -= half
      next.y += half
      break
    }
    case 'RIGHT': {
      const half = Math.trunc(next.width / 2)
      next.width -= half
      next.x += half
      break
    }
    case 'CENTER':
      break
  }
  return next
}

/** Which editor split a side asks for; the centre is not a split at all. */
export function splitOrientationForSide(side: DropSide): 'horizontal' | 'vertical' | null {
  if (side === 'LEFT' || side === 'RIGHT') return 'horizontal'
  if (side === 'TOP' || side === 'BOTTOM') return 'vertical'
  return null
}

/**
 * The two-pane model puts group 0 on the left/top and group 1 on the right/bottom, while
 * IDEA's drop side can ask for the *new* group to be the first one. `splitTabOut` always
 * moves the dragged tab into the second group, so a LEFT / TOP drop exchanges the two
 * groups' contents afterwards — the model keeps its shape (fixed DOM order) and the
 * dragged tab ends up on the side the pointer asked for.
 */
export function dropSidePutsNewGroupFirst(side: DropSide): boolean {
  return side === 'LEFT' || side === 'TOP'
}
