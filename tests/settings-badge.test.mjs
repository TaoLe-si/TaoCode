import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SHOWS, NEW_BADGE_KEY_PREFIX, NEW_BADGE_TEXT, NEW_OPTION_PAGES,
  badgeStorageKey, isNewOptions, markOpened, parseBadgeCount, showNewBadgeDot,
  showNewOptions, showNewOptionsInGroup,
} from '../src/settingsBadge.ts'

// SettingsNewBadgeRecorder.kt:10-11 — IDEA's own key and its single-shown threshold.
test('the storage key and the shown limit are the ones IDEA writes', () => {
  assert.equal(NEW_BADGE_KEY_PREFIX, 'settings.new.badge.shown.count.')
  assert.equal(MAX_SHOWS, 1)
  assert.equal(badgeStorageKey('editor'), 'taocode.settings.new.badge.shown.count.editor')
})

test('the badge text is the one IdeBundle carries', () => {
  assert.equal(NEW_BADGE_TEXT, '新')
})

// SettingsNewBadgeState.kt:53-56 — only configurables marked NewOptions ever get the dot.
test('only a page that declares itself new qualifies', () => {
  // 本轮 UI 位置整改后，编辑器被拆成 编辑器 › 常规 › 外观 等子页，"新选项"跟着承载新行的那一页。
  const declared = NEW_OPTION_PAGES[0]
  assert.ok(declared, '至少有一页声明自己是新的')
  assert.equal(isNewOptions(declared), true)
  assert.equal(isNewOptions('appearance'), false)
  assert.equal(isNewOptions('commit'), false)
  assert.equal(isNewOptions(declared, ['commit']), false)
  assert.ok(NEW_OPTION_PAGES.includes(declared))
})

// :47-51 — shown fewer than MAX_SHOWS times.
test('a new page keeps the dot until it has been shown once', () => {
  const declared = NEW_OPTION_PAGES[0]
  assert.equal(showNewOptions(declared, {}), true)
  assert.equal(showNewOptions(declared, { [declared]: 0 }), true)
  assert.equal(showNewOptions(declared, { [declared]: MAX_SHOWS }), false)
  // A non-new page never shows it, whatever the counter says.
  assert.equal(showNewOptions('commit', {}), false)
})

// :32-36 — a composite reports new options when one of its children does.
test('a group reports new options when a child page has one pending', () => {
  const declared = NEW_OPTION_PAGES[0]
  assert.equal(showNewOptionsInGroup(['appearance', declared], {}), true)
  assert.equal(showNewOptionsInGroup(['appearance', declared], { [declared]: MAX_SHOWS }), false)
  assert.equal(showNewOptionsInGroup(['appearance', 'structure'], {}), false)
  assert.equal(showNewOptionsInGroup([], {}), false)
})

// SettingsTreeView.java:791 — the dot is on a leaf, or on a collapsed node.
test('the dot is drawn on leaves and on collapsed groups only', () => {
  assert.equal(showNewBadgeDot(true, true, true), true)
  assert.equal(showNewBadgeDot(true, true, false), true)
  assert.equal(showNewBadgeDot(true, false, false), true)
  assert.equal(showNewBadgeDot(true, false, true), false)
  assert.equal(showNewBadgeDot(false, true, false), false)
})

// :39-45 — marking a page writes MAX_SHOWS once and reports whether it changed.
test('opening a new page records it once and reports the change', () => {
  const declared = NEW_OPTION_PAGES[0]
  const first = markOpened(declared, {})
  assert.deepEqual(first.counts, { [declared]: MAX_SHOWS })
  assert.equal(first.changed, true)
  const second = markOpened(declared, first.counts)
  assert.equal(second.changed, false)
  assert.deepEqual(second.counts, first.counts)
})

test('opening a page that is not new changes nothing', () => {
  const declared = NEW_OPTION_PAGES[0]
  const result = markOpened('commit', { [declared]: MAX_SHOWS })
  assert.equal(result.changed, false)
  assert.deepEqual(result.counts, { [declared]: MAX_SHOWS })
})

test('marking keeps the other pages untouched', () => {
  const declared = NEW_OPTION_PAGES[0]
  const result = markOpened(declared, { commit: 3, other: 1 })
  assert.deepEqual(result.counts, { commit: 3, other: 1, [declared]: MAX_SHOWS })
})

// PropertiesComponent.getInt(key, 0) — a missing or broken value means "never shown".
test('an unreadable counter falls back to never shown', () => {
  assert.equal(parseBadgeCount(null), 0)
  assert.equal(parseBadgeCount(''), 0)
  assert.equal(parseBadgeCount('abc'), 0)
  assert.equal(parseBadgeCount('-2'), 0)
  assert.equal(parseBadgeCount('0'), 0)
  assert.equal(parseBadgeCount('1'), 1)
  assert.equal(parseBadgeCount('7'), 7)
})
