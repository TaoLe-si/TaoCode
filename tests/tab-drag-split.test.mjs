import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAG_TO_SPLIT_RATIO, clampRatio, dropShapes, dropSideFor, dropSidePutsNewGroupFirst,
  pointInPolygon, splitOrientationForSide, updateBoundsWithDropSide,
} from '../src/tabDragSplit.ts'

const RECT = { x: 0, y: 0, width: 1000, height: 500 }

// TabsUtil.java:55 — `Math.max(.05, Math.min(.45, ratio))`.
test('the drag-to-split ratio is clamped to 0.05..0.45', () => {
  assert.equal(DRAG_TO_SPLIT_RATIO, 0.2, 'registry.properties:559 ide.tabbedPane.dragToSplitRatio=0.2')
  assert.equal(clampRatio(0.2), 0.2)
  assert.equal(clampRatio(0), 0.05)
  assert.equal(clampRatio(1), 0.45)
  assert.equal(clampRatio(Number.NaN), DRAG_TO_SPLIT_RATIO, 'a missing registry value falls back to the default')
})

// The four shapes of TabsUtil.java:60-86, expressed against the source's own point lists.
test('the four drop shapes are the trapezoids the source builds', () => {
  const shapes = dropShapes(RECT)
  assert.deepEqual(shapes.top, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 800, y: 100 }, { x: 200, y: 100 }])
  assert.deepEqual(shapes.left, [{ x: 0, y: 0 }, { x: 200, y: 100 }, { x: 200, y: 400 }, { x: 0, y: 500 }])
  assert.deepEqual(shapes.bottom, [{ x: 0, y: 500 }, { x: 200, y: 400 }, { x: 800, y: 400 }, { x: 1000, y: 500 }])
  assert.deepEqual(shapes.right, [{ x: 1000, y: 0 }, { x: 800, y: 100 }, { x: 800, y: 400 }, { x: 1000, y: 500 }])
})

test('point-in-polygon matches a closed quad, boundary included via the ray test', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true)
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false)
  assert.equal(pointInPolygon({ x: 5, y: 20 }, square), false)
  // A degenerate (zero-area) quad contains nothing, like an empty GeneralPath.
  assert.equal(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]), false)
})

// TabsUtil.java:88-92 — edges are tested right, left, bottom, top, then the centre wins.
test('the pointer decides the side by the trapezoid it sits in', () => {
  assert.equal(dropSideFor({ x: 990, y: 250 }, RECT), 'RIGHT')
  assert.equal(dropSideFor({ x: 10, y: 250 }, RECT), 'LEFT')
  assert.equal(dropSideFor({ x: 500, y: 495 }, RECT), 'BOTTOM')
  assert.equal(dropSideFor({ x: 500, y: 5 }, RECT), 'TOP')
  assert.equal(dropSideFor({ x: 500, y: 250 }, RECT), 'CENTER')
  assert.equal(dropSideFor({ x: 1100, y: 250 }, RECT), null, 'outside the rectangle is the source -1')
  assert.equal(dropSideFor({ x: 500, y: -20 }, RECT), null)
})

// The zones must tile the rectangle: any point inside it lands in exactly one of the five.
test('the five zones tile the whole editor area with no gap', () => {
  const width = 400
  const height = 300
  const rect = { x: 0, y: 0, width, height }
  for (let x = 0; x <= width; x += 20) {
    for (let y = 0; y <= height; y += 20) {
      const side = dropSideFor({ x, y }, rect)
      assert.notEqual(side, null, `(${x},${y}) must land in a zone`)
    }
  }
})

// Offsets must be honoured — the source tests against the component's own coordinate space.
test('the rectangle origin is respected', () => {
  const offset = { x: 100, y: 50, width: 1000, height: 500 }
  assert.equal(dropSideFor({ x: 1090, y: 300 }, offset), 'RIGHT')
  assert.equal(dropSideFor({ x: 110, y: 300 }, offset), 'LEFT')
  assert.equal(dropSideFor({ x: 600, y: 300 }, offset), 'CENTER')
  assert.equal(dropSideFor({ x: 600, y: 300 }, { x: 0, y: 0, width: 1000, height: 500 }), 'CENTER')
})

// TabsUtil.java:95-111, including the off-by-one the source itself has on odd sizes.
test('the drop preview is the half of the rectangle the side names', () => {
  assert.deepEqual(updateBoundsWithDropSide(RECT, 'TOP'), { x: 0, y: 0, width: 1000, height: 250 })
  assert.deepEqual(updateBoundsWithDropSide(RECT, 'LEFT'), { x: 0, y: 0, width: 500, height: 500 })
  assert.deepEqual(updateBoundsWithDropSide(RECT, 'BOTTOM'), { x: 0, y: 250, width: 1000, height: 250 })
  assert.deepEqual(updateBoundsWithDropSide(RECT, 'RIGHT'), { x: 500, y: 0, width: 500, height: 500 })
  assert.deepEqual(updateBoundsWithDropSide(RECT, 'CENTER'), RECT, 'the centre keeps the whole rectangle')
})

test('an odd height keeps the source arithmetic on the bottom half', () => {
  const odd = { x: 0, y: 0, width: 100, height: 5 }
  // TOP truncates 5/2 = 2; BOTTOM leaves 5 - 2 = 3 and moves down by 2 — the source does
  // `height /= 2` in one branch and `h = height / 2; height -= h` in the other.
  assert.deepEqual(updateBoundsWithDropSide(odd, 'TOP'), { x: 0, y: 0, width: 100, height: 2 })
  assert.deepEqual(updateBoundsWithDropSide(odd, 'BOTTOM'), { x: 0, y: 2, width: 100, height: 3 })
})

test('a side maps onto an editor split direction, the centre onto none', () => {
  assert.equal(splitOrientationForSide('LEFT'), 'horizontal')
  assert.equal(splitOrientationForSide('RIGHT'), 'horizontal')
  assert.equal(splitOrientationForSide('TOP'), 'vertical')
  assert.equal(splitOrientationForSide('BOTTOM'), 'vertical')
  assert.equal(splitOrientationForSide('CENTER'), null)
})

// IDEA can ask for the new group to be the first one; the two-pane model always puts the
// moved tab in group 1, so those two sides need the contents exchanged afterwards.
test('left and top ask for the new group to come first', () => {
  assert.equal(dropSidePutsNewGroupFirst('LEFT'), true)
  assert.equal(dropSidePutsNewGroupFirst('TOP'), true)
  assert.equal(dropSidePutsNewGroupFirst('RIGHT'), false)
  assert.equal(dropSidePutsNewGroupFirst('BOTTOM'), false)
  assert.equal(dropSidePutsNewGroupFirst('CENTER'), false)
})
