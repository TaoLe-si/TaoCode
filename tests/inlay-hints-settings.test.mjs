// 「编辑器 › 内联提示」（`inlay.hints`）的行为回归。
//
// 上游依据：
//   · 注册行 `intellij.platform.lang.impl.xml:935-941`（`parentId="editor" id="inlay.hints" groupWeight="1"`）；
//   · 页面类 `InlaySettingsConfigurable.kt:15,51`（`INLAY_ID = "inlay.hints"` / `getId()`）；
//   · 面板是按 provider 的清单树，逐节点的开关是 `InlayProviderSettingsModel.isEnabled`
//     （`platform/lang-api/.../settings/InlayProviderSettingsModel.kt:26`）。
//
// 本仓只有一个 provider（LSP `textDocument/inlayHint`），所以那棵树塌成 LSP `kind` 的三档。
// 这条测试钉住三件事：三格开关是真设置（模型声明 + 前端默认 + native 键表 + native 默认 + 预览白名单
// 五处登记，且逐键核对类型/默认值/所属分组）、真的在拉取时被过滤、以及
// **不放假控件**（上游那些按语言分组 / 逐 case 明细 / 排除清单的入口不渲染）。
// 登记那一条按**键名**定位而不是钉源码里的相邻位置 —— 上游设置键的先后不是契约，理由见下面
// 「逐键定位（位置无关）」那一段的两条源码证据。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INLAY_HINT_EXCLUDE_LIST_SETTING_KEY, INLAY_HINT_SETTING_KEYS, inlayHintToggles, inlayHintTogglesKey, shouldShowInlayHint } from '../src/inlayHints.ts'
import { defaultEditorSettings } from '../src/settingsModel.ts'
import { previewSettingsError } from '../src/previewSettings.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// ---------------------------------------------------------------- 逐键定位（位置无关）
// 上游设置键的**顺序不是契约** —— 落盘的每一项都按名字取回，与先后无关：
//   · platform/util/src/com/intellij/util/xmlb/BeanBinding.kt:296
//       `element.attributes.get(binding.name)?.let { binding.setValue(result, it) }`
//       —— 遍历的是 binding 清单，每项按**键名**去已存的 attributes 里拿值，拿不到就保留默认；
//   · platform/util/src/com/intellij/openapi/util/registry/Registry.kt:241
//       `val key = entry.getAttributeValue("key") ?: continue`
//       —— 状态逐条装进 `Map<String, ValueWithSource>`（:239 建表、:248 `map.put(key, …)`），
//       认的是 `key=` 属性，不是 `<entry>` 的排列顺序。
// 所以这一族断言按**键名** `find` 定位，再逐键断言「类型 / 默认值 / 所属分组」。
// 原来那版把三格钉在源码里的相邻位置（含 `… showOtherInlayHints: true \}` 这种带收尾花括号的锚），
// 别的域在 `defaultEditorSettings` 尾部合法加键就会把它顶掉 —— 2026-10-06 那条红正是这样
// （键值一个字没变，只是不再排在末尾）。断言内容没有放松：仍是三把键 × 五处登记的精确相等，
// 并且比原来多查两件事：同名条目**只能有一条**、键**只能属于那一个分组**（不在 general 档里）。
function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      out += ' '
      continue
    }
    if (c === "'" || c === '"') {
      const end = spanEnd(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** text[i] 是引号 ⇒ 返回闭引号之后的下标（跳过转义）。 */
function spanEnd(text, i) {
  const q = text[i]
  let j = i + 1
  while (j < text.length && text[j] !== q) {
    if (text[j] === '\\') j += 1
    j += 1
  }
  return j + 1
}

/** 从 openIndex（指向 `{`）取配对花括号的正文（不含首尾花括号）。 */
function braceBody(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"') { i = spanEnd(text, i) - 1; continue }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  throw new Error('花括号没有闭合')
}

/** 从 from 读到第一个（深度 0 的）分隔符为止。 */
function readValue(text, from, separators) {
  let i = from
  let depth = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "'" || c === '"') { i = spanEnd(text, i); continue }
    if (c === '{' || c === '[' || c === '(') { depth += 1; i += 1; continue }
    if (c === '}' || c === ']' || c === ')') {
      if (depth === 0) break
      depth -= 1
      i += 1
      continue
    }
    if (depth === 0 && separators.includes(c)) break
    i += 1
  }
  return { text: text.slice(from, i), end: i }
}

/** 深度 0 的 `name : value` 清单（嵌套花括号/尖括号里的不算，所以内联对象类型的字段不会混进来）。 */
function topLevelPairs(body, separators) {
  const out = []
  let i = 0
  let depth = 0
  while (i < body.length) {
    const c = body[i]
    if (c === "'" || c === '"') { i = spanEnd(body, i); continue }
    if (c === '{' || c === '[' || c === '(') { depth += 1; i += 1; continue }
    if (c === '}' || c === ']' || c === ')') { depth -= 1; i += 1; continue }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < body.length && /[\w$]/.test(body[j])) j += 1
      let k = j
      while (k < body.length && /\s/.test(body[k])) k += 1
      if (body[k] === '?') { k += 1; while (k < body.length && /\s/.test(body[k])) k += 1 }
      if (body[k] === ':') {
        const value = readValue(body, k + 1, separators)
        out.push({ name: body.slice(i, j), value: value.text.trim() })
        i = value.end
        continue
      }
      i = j
      continue
    }
    i += 1
  }
  return out
}

/** 字面量 token → 类型名（native 默认值表里只有 JSON 字面量可比）。 */
function literalType(token) {
  if (token === 'true' || token === 'false') return 'boolean'
  if (/^-?[\d.]+$/.test(token)) return 'number'
  if (/^".*"$/.test(token) || /^'.*'$/.test(token)) return 'string'
  if (token === 'Json::object()' || token === '{}') return 'object'
  if (token === 'Json::array()' || token === '[]') return 'array'
  return 'other'
}

/** `src/settingsModel.ts` 里**每个** `export interface X { … }` 的深度 0 字段 ⇒ {name, type, group=X}。 */
function modelFieldDecls(source) {
  const clean = stripComments(source)
  const out = []
  for (const m of clean.matchAll(/export interface (\w+)[^{]*\{/g)) {
    const body = braceBody(clean, m.index + m[0].length - 1)
    for (const p of topLevelPairs(body, [';', '\n'])) out.push({ name: p.name, type: p.value, group: m[1] })
  }
  return out
}

/** 每个 `export const defaultXxx … = { … }` 的字面量条目 ⇒ {name, value, group=常量名}。 */
function modelDefaultEntries(source) {
  const clean = stripComments(source)
  const out = []
  for (const m of clean.matchAll(/export const (default\w+)[^=]*=\s*\{/g)) {
    const body = braceBody(clean, m.index + m[0].length - 1)
    for (const p of topLevelPairs(body, [','])) out.push({ name: p.name, value: p.value, group: m[1] })
  }
  return out
}

/** `native/settings_schema.hpp` 的每一张 `std::string_view X[] = { "键", … }` ⇒ {name, group=表名}。 */
function nativeKeyTables(source) {
  const clean = stripComments(source)
  const out = []
  for (const m of clean.matchAll(/std::string_view (\w+)\s*\[\]\s*=\s*\{/g)) {
    const body = braceBody(clean, m.index + m[0].length - 1)
    for (const k of body.matchAll(/"([^"]+)"/g)) out.push({ name: k[1], group: m[1] })
  }
  return out
}

/** `native/settings_schema.cpp` 的每个 `Json X_impl() { … }` 里的 `{"键", 字面量}` ⇒ {name, value, type, group}。 */
function nativeDefaultEntries(source) {
  const clean = stripComments(source)
  const out = []
  for (const m of clean.matchAll(/\bJson (\w+_impl)\s*\(\)\s*\{/g)) {
    const body = braceBody(clean, m.index + m[0].length - 1)
    for (const p of body.matchAll(/\{\s*"([^"]+)"\s*,\s*([^{}]+?)\s*\}/g)) {
      out.push({ name: p[1], value: p[2], type: literalType(p[2]), group: m[1] })
    }
  }
  return out
}

/**
 * `src/previewSettings.ts` 预览态白名单：`const accepted =` 到 `if (!accepted)` 之间的那条
 * `key === '…'` 链 ⇒ {name, group}。链里只出现一次（没有专属校验分支）的键，值规则走收尾那条
 * `: typeof value !== 'boolean')` ⇒ 类型是布尔档。
 */
function previewAcceptedKeys(source) {
  const clean = stripComments(source)
  const from = clean.indexOf('const accepted =')
  const to = clean.indexOf('if (!accepted)')
  assert.ok(from >= 0 && to > from, 'previewSettings.ts 里找不到 accepted 白名单')
  const out = [...clean.slice(from, to).matchAll(/key === '([A-Za-z_]\w*)'/g)].map(m => ({
    name: m[1], group: 'previewSettingsError.accepted', type: 'unknown',
  }))
  for (const entry of out) {
    const hits = clean.match(new RegExp("key === '" + entry.name + "'", 'g')) ?? []
    entry.type = hits.length === 1 ? 'boolean' : 'dedicated-branch'
  }
  return out
}

test('三把键与 LSP kind 的分组一一对应（kind 1 = Type，2 = Parameter，其余第三档）', () => {
  assert.deepEqual(INLAY_HINT_SETTING_KEYS, {
    type: 'showTypeInlayHints', parameter: 'showParameterInlayHints', other: 'showOtherInlayHints',
  })
  // 折叠规则：只有关掉的那一档被过滤掉，其余两档照旧。
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: ': int', kind: 1 }, { type: false, parameter: true, other: true }), false)
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: 'x', kind: 2 }, { type: false, parameter: true, other: true }), true)
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: 'x' }, { type: true, parameter: true, other: false }), false)
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: 'x' }, { type: true, parameter: true, other: true }), true)
  // 空 label 一律不画（与上游 isEnabled 无关，是渲染前提）
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: '' }, { type: true, parameter: true, other: true }), false)
})

test('设置值 → 三档的折算：缺项/坏值都当全开（老 state 上不该整族不显示）', () => {
  // 2026-10-06（inlayparams 批）：`inlayHintToggles` 多了一项 `parameterHintExcludeList`，
  // 这里的期望跟着**变严**（原来只核三个布尔，现在连"缺键 ⇒ 默认空清单"一起核），不是放松。
  assert.deepEqual(inlayHintToggles(defaultEditorSettings), { type: true, parameter: true, other: true, parameterHintExcludeList: [] })
  assert.deepEqual(inlayHintToggles(undefined), { type: true, parameter: true, other: true, parameterHintExcludeList: [] }, '老 state 没这四键 ⇒ 全开 + 不排除')
  assert.deepEqual(inlayHintToggles({ showParameterInlayHints: false }), { type: true, parameter: false, other: true, parameterHintExcludeList: [] })
  // watch 的比较键：三档拼成一行（数组当依赖会每拍都触发）。
  assert.equal(inlayHintTogglesKey(inlayHintToggles({})), 'true,true,true')
  assert.notEqual(inlayHintTogglesKey(inlayHintToggles({ showTypeInlayHints: false })), inlayHintTogglesKey(inlayHintToggles({})))
})

test('三格是真设置：模型 + native 键表/默认值 + 预览白名单都登记（逐键定位，与源码顺序无关）', () => {
  const model = read('src/settingsModel.ts')
  const fields = modelFieldDecls(model)
  const frontDefaults = modelDefaultEntries(model)
  const keyTables = nativeKeyTables(read('native/settings_schema.hpp'))
  const nativeDefaults = nativeDefaultEntries(read('native/settings_schema.cpp'))
  const preview = previewAcceptedKeys(read('src/previewSettings.ts'))

  // 三把键 ↔ 内联提示的三个槽位（槽位 id 就是 INLAY_HINT_SETTING_KEYS 的键，见上面第一条用例）。
  const EXPECTED = [
    { name: 'showTypeInlayHints', slot: 'type' },
    { name: 'showParameterInlayHints', slot: 'parameter' },
    { name: 'showOtherInlayHints', slot: 'other' },
  ]

  const only = (list, name, what) => {
    const hits = list.filter(k => k.name === name)
    assert.equal(hits.length, 1, `${name} 在${what}里应恰好登记一次，实得 ${hits.length} 条` +
      `（${hits.map(h => h.group).join(' / ') || '一条都没有'}）—— 两条就说不清它属于哪一组`)
    return hits[0]
  }

  for (const key of EXPECTED) {
    // ① 模型声明：`EditorSettings` 里恰好一次、类型布尔（原来钉的是「三个字段必须相邻」）。
    only(fields, key.name, ' `export interface` 字段表')
    const decl = fields.find(k => k.name === key.name)
    assert.equal(decl.group, 'EditorSettings', `${key.name} 该登记在编辑器档（EditorSettings），实得 ${decl.group}`)
    assert.equal(decl.type, 'boolean', `${key.name} 的类型：上游那一格是复选框（InlayProviderSettingsModel.isEnabled 是 Boolean）`)

    // ② 前端默认值：`defaultEditorSettings` 里恰好一次、字面量 true（同上游 isEnabled 出厂为真）。
    only(frontDefaults, key.name, ' `export const defaultXxx` 默认值表')
    const front = frontDefaults.find(k => k.name === key.name)
    assert.equal(front.group, 'defaultEditorSettings', `${key.name} 的默认值应在编辑器档账上，实得 ${front.group}`)
    assert.equal(front.value, 'true', `${key.name} 的源码默认必须是 true（关掉的只有用户自己）`)
    assert.equal(defaultEditorSettings[key.name], true, `${key.name} 的运行时默认必须是 true`)
    assert.equal(typeof defaultEditorSettings[key.name], 'boolean')

    // ③ native 键表白名单：必须落在 EDITOR_SETTING_KEYS（漏了 ⇒ known_keys 拒掉整次 settings.update）。
    only(keyTables, key.name, ' native 键表白名单')
    const listed = keyTables.find(k => k.name === key.name)
    assert.equal(listed.group, 'EDITOR_SETTING_KEYS',
      `${key.name} 登记在 ${listed.group} 而不是 EDITOR_SETTING_KEYS ⇒ validate_editor_patch 的 known_keys 会拒`)

    // ④ native 默认值：`editor_defaults_impl()` 里恰好一次、布尔、值 true，并与前端逐项一致
    //（老 state 缺键时 project_settings_state.cpp 只按这张表补洞）。
    only(nativeDefaults, key.name, ' native 默认值表')
    const native = nativeDefaults.find(k => k.name === key.name)
    assert.equal(native.group, 'editor_defaults_impl', `${key.name} 的 native 默认应在 editor_defaults_impl，实得 ${native.group}`)
    assert.equal(native.type, decl.type, `${key.name}：native 默认的类型与模型声明漂了（${native.type} vs ${decl.type}）`)
    assert.equal(native.value, front.value, `${key.name}：native 默认值与前端默认漂了（${native.value} vs ${front.value}）`)

    // ⑤ 预览态白名单：没有专属校验分支 ⇒ 走收尾的 `typeof value !== 'boolean'`，即布尔档。
    only(preview, key.name, ' 预览态 accepted 白名单')
    const pv = preview.find(k => k.name === key.name)
    assert.equal(pv.group, 'previewSettingsError.accepted', `${key.name} 不在预览态 accepted 链里（桌面能存、浏览器不能）`)
    assert.equal(pv.type, 'boolean', `${key.name} 在预览态该按布尔档校验，实得 ${pv.type}`)

    // ⑥ 这一格真的是**读口**：关掉它只有它自己掉，另两档照旧（键名由 INLAY_HINT_SETTING_KEYS 给）。
    assert.equal(Object.keys(INLAY_HINT_SETTING_KEYS).find(g => INLAY_HINT_SETTING_KEYS[g] === key.name), key.slot,
      `${key.name} 归属的内联提示槽位应是 ${key.slot}`)
    const expectedToggles = { type: true, parameter: true, other: true, parameterHintExcludeList: [] }
    expectedToggles[key.slot] = false
    assert.deepEqual(inlayHintToggles({ [key.name]: false }), expectedToggles, `${key.name} 关掉后只该影响 ${key.slot} 一档`)
  }
})

test('消费链路：编辑器把三档交给提示控制器，按开关过滤后再画', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /createInlayHints\(\{[^}]*toggles: \(\) => inlayHintToggles\(props\.settings\)/, '编辑器没有把三档交给控制器')
  // 过滤发生在拉取那一拍（editorInlayHints.ts），不在渲染层。归位/过滤由 layoutInlayHints 一次做完
  // （开关 → 排序 → 同位置去重/优先级，见 src/inlayHintLayout.ts）。
  // 订正留痕（lsfeat 批）：这一条原来钉的是 `layoutInlayHints(attempt.value.hints, toggles, …)`，
  // 接上按文件结果缓存（`inlayHintCache`）之后，画面那份条目改从**缓存**里的那一份归位出来 ——
  // 意图没变（渲染前用当前开关做一次过滤归位），所以这里把"喂给 layout 的是哪一份"钉成新形状，
  // 而不是把断言放松成 includes：过滤仍然只能在 paint() 那一处、仍然带 toggles、仍然显式不设行内上限。
  const host = read('src/editorInlayHints.ts')
  assert.match(host, /const toggles = deps\.toggles\?\.\(\) \?\? DEFAULT_INLAY_HINT_TOGGLES/, '每次拉取都要重取开关')
  assert.match(host, /const layout = layoutInlayHints\(stored\.map\(item => item\.highlightingInfo\), toggles, \{ maxPerLine: NO_INLAY_HINT_LINE_LIMIT \}\)/,
    '渲染前归位必须是「缓存里那份服务器原文 + 当前开关」这一种接法')
  assert.match(host, /const stored = inlayHintCache\.highlightingsFor\(path\)/, '画的那一份必须来自结果缓存')
  // 改设置要能重画：关掉一档得把已经画出来的收走。
  assert.match(editor, /watch\(\(\) => inlayHintTogglesKey\(inlayHintToggles\(props\.settings\)\), \(\) => inlayHints\.schedule\(\)\)/)
})

test('页面：三个复选框挂在编辑器下，排除清单那一格本批是真控件，其余上游入口不渲染', () => {
  const page = read('src/components/InlayHintsSettingsPage.vue')
  assert.match(page, /:checked="settings\[INLAY_HINT_SETTING_KEYS\[group\.id\]\]"/, '复选框要绑到 INLAY_HINT_SETTING_KEYS 的那一格')
  // T-1（threecells 实测出的盲区）：删掉这一行 ⇒ 全门族 0 新增红，三格点了不记账。
  assert.match(page, /@change="toggle\(INLAY_HINT_SETTING_KEYS\[group\.id\], \(\$event\.target as HTMLInputElement\)\.checked\)"/,
    '复选框的 change 必须把这一格写回同名设置键（键名取自 INLAY_HINT_SETTING_KEYS，不许在页面里现抄字符串）')
  assert.match(page, /function toggle\(key: InlayHintSettingKey, checked: boolean\)/)
  assert.match(page, /v-for="group in GROUPS"/)
  // 排除清单那一格（2026-10-08 lane lp-editor 从"刻意不渲染"改成真控件 —— 键在五处登记齐了，
  // 见下面那两条：写回的是同名设置键，不是假格子）：
  assert.match(page, /v-model="excludeText"/, '清单编辑框要绑本地文本')
  assert.match(page, /invalidExcludePatternLines\(excludeText\.value\)/, '坏行要给反馈（上游 HintUtils.kt:44-53）')
  assert.match(page, /:disabled="busy \|\| invalidLines\.length > 0 \|\| !excludeDirty"/, '坏行未改好不许应用（上游用它禁「确定」）')
  assert.match(page, /props\.settings\[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY\] = parseExcludeListText\(excludeText\.value\)/,
    '「应用清单」必须把文本写回那一把真键（键名取自 inlayHints.ts，页面不现抄字符串）')
  assert.match(page, /INLAY_HINT_EXCLUDE_LIST_SETTING_KEY\] = \[\]/, '「清空」也要写回同名键（出厂档）')
  assert.match(page, /watch\(\(\) => props\.settings\[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY\]/, '盘上那份变了编辑框要跟着走')
  // 上游有、本仓**仍然没有对应物**的那两层：按 provider/语言的清单树、逐 `cases` 明细。
  // （不是"还没做"—— 本仓只有一个 LSP provider，这一层不存在，所以不渲染任何控件。）
  assert.ok(!/v-for="(provider|case)\b/.test(page), '按 provider / 逐 case 的清单节点不该被渲染')
  assert.ok(!/cases\s*:/.test(page), '逐 case 明细不该被渲染')
  const tree = read('src/settingsTreeMeta.ts')
  assert.match(tree, /\{ key: 'inlay\.hints', label: '内联提示'[^}]*parent: 'editor'/, '上游是 parentId="editor"，要挂在编辑器下')
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<InlayHintsSettingsPage :settings="editor" :busy="busy" \/>/)
  assert.match(dialog, /data-page="inlay\.hints"/)
  // T-2（threecells 实测出的第二个盲区）：把 `SettingsDialog.vue:302` 那句 emit 注掉 ⇒ 全门族 0 新增红，
  // 于是"三格写了但对话框根本没把编辑器档发给宿主"这件事以前无人报警。
  assert.match(dialog, /function applyEditor\(close = false\) \{[^\n]*\n\s*if \(!props\.busy && validEditor\.value && editorForm\.value\?\.reportValidity\(\)\) emit\('save', \{ \.\.\.editor\.value \}, close\)/,
    '「应用」必须把整份编辑器档（含内联提示那三格）发给宿主 settings.update；载荷是整本账，不是挑三把键发')
})

// ---------------------------------------------------------------- 排除清单那一格（2026-10-08 lane lp-editor）
// 为什么这五处必须一起在：`ParameterHintsSettingsPanel.kt:18-22` 那个入口此前只活在读侧
// （`src/inlayHints.ts` 的键常量 + `src/inlayHintExcludeList.ts` 的规则），页面刻意不放控件 ——
// 键没登记，放上的输入框写进草稿后会被 `known_keys` 拒或 `prune_unknown` 剪掉（假控件）。
test('parameterHintExcludeList 是真设置：模型 + native 键表/默认值 + 预览白名单都登记（五处）', () => {
  const model = read('src/settingsModel.ts')
  const fields = modelFieldDecls(model)
  const frontDefaults = modelDefaultEntries(model)
  const keyTables = nativeKeyTables(read('native/settings_schema.hpp'))
  const nativeDefaults = nativeDefaultEntries(read('native/settings_schema.cpp'))
  const preview = previewAcceptedKeys(read('src/previewSettings.ts'))
  const KEY = 'parameterHintExcludeList'
  assert.equal(INLAY_HINT_EXCLUDE_LIST_SETTING_KEY, KEY, '键名的唯一定义处（src/inlayHints.ts）漂了')

  // ① 模型声明：`EditorSettings` 里恰好一次，类型 string[]（清单是数组，不是勾选框）。
  const decls = fields.filter(f => f.name === KEY)
  assert.equal(decls.length, 1, `${KEY} 在模型里该恰好一次，实得 ${decls.length}`)
  assert.equal(decls[0].group, 'EditorSettings')
  assert.equal(decls[0].type, 'string[]')
  // ② 前端默认：[] —— 上游那份默认清单是方法 FQN 形态，本仓的匹配主题是提示 label（口径差 3）。
  const fronts = frontDefaults.filter(f => f.name === KEY)
  assert.equal(fronts.length, 1, `${KEY} 在默认值表里该恰好一次，实得 ${fronts.length}`)
  assert.equal(fronts[0].group, 'defaultEditorSettings')
  assert.equal(fronts[0].value, '[]')
  assert.deepEqual(defaultEditorSettings[KEY], [])
  // ③ native 键表白名单（漏了 ⇒ known_keys 拒掉整次 settings.update）。
  const listed = keyTables.filter(k => k.name === KEY)
  assert.equal(listed.length, 1, `${KEY} 在 native 键表里该恰好一次，实得 ${listed.length}`)
  assert.equal(listed[0].group, 'EDITOR_SETTING_KEYS')
  // ④ native 默认值（老 state 缺键只按这张表补洞）。
  const native = nativeDefaults.filter(k => k.name === KEY)
  assert.equal(native.length, 1, `${KEY} 在 native 默认值表里该恰好一次，实得 ${native.length}`)
  assert.equal(native[0].group, 'editor_defaults_impl')
  assert.equal(native[0].type, 'array')
  assert.equal(native[0].value, 'Json::array()')
  // ⑤ 预览态白名单 + 专属分支（挂到布尔兜底上会被整条拒掉）。
  const pv = preview.filter(k => k.name === KEY)
  assert.equal(pv.length, 1, `${KEY} 在预览白名单里该恰好一次，实得 ${pv.length}`)
  assert.equal(pv[0].type, 'dedicated-branch', '预览态该有专属校验分支')
})

test('native 校验分支在布尔兜底之前：形状坏拒收，坏 glob 放行（上游对坏模式是静默作废）', () => {
  const validator = read('native/settings_editor_keys.hpp')
  assert.match(validator, /if \(key == "parameterHintExcludeList"\)/, 'settings_editor_keys.hpp 没有这一键的校验分支')
  const cpp = read('native/settings_schema.cpp')
  const call = cpp.indexOf('validate_editor_added_key(it.key(), value)')
  const fallback = cpp.indexOf('Editor flags must be JSON booleans')
  assert.ok(call >= 0 && fallback >= 0 && call < fallback, '新键校验必须在布尔兜底之前调用（写在后面是死代码）')
  // 形状口径与前端 `previewSettings.ts` 那一支同形：32 条 / 200 字节。
  const branch = validator.slice(validator.indexOf('if (key == "parameterHintExcludeList")'))
  assert.match(branch, /value\.size\(\) > 32/, '条数上限与前端不一处')
  assert.match(branch, /pattern\.size\(\) > 200/, '单条上限与前端不一处')
  const preview = read('src/previewSettings.ts')
  const slice = preview.slice(preview.indexOf(": key === 'parameterHintExcludeList' ?"))
  assert.match(slice, /value\.length > 32/, '预览态条数上限漂了')
  assert.match(slice, /pattern\.length > 200/, '预览态单条上限漂了')
  // 原生那侧自己的判据（ctest，`native/settings_editor_keys_test.cpp`）真有用例。
  assert.match(read('native/settings_editor_keys_test.cpp'), /one\("parameterHintExcludeList"/, '原生判据里没有这一键的用例')
})

test('预览态取值校验真的在管排除清单（不是只登记了名字）', () => {
  const languages = ['java', 'cpp', 'typescript', 'other']
  const KEY = 'parameterHintExcludeList'
  for (const value of [[], ['println'], ['key', 'log*', '*Args*'], ['a*b*c']])
    assert.equal(previewSettingsError(KEY, value, languages), null, `${JSON.stringify(value)} 该放行`)
  // 形状坏的四档：不是数组 / 非字符串条目 / 空条目 / 单条超 200 / 超 32 条。
  assert.equal(previewSettingsError(KEY, 'println', languages), `无效设置：${KEY}`)
  assert.equal(previewSettingsError(KEY, [1], languages), `无效设置：${KEY}`)
  assert.equal(previewSettingsError(KEY, [''], languages), `无效设置：${KEY}`)
  assert.equal(previewSettingsError(KEY, ['x'.repeat(201)], languages), `无效设置：${KEY}`)
  assert.equal(previewSettingsError(KEY, Array.from({ length: 33 }, (_, i) => `p${i}`), languages), `无效设置：${KEY}`)
  // 编译不了的 glob（三个星号）**不是**形状坏 —— 上游静默作废，不该让整份设置存不下去。
  assert.equal(previewSettingsError(KEY, ['a*b*c'], languages), null)
})

test('旧存档缺这一键：前端不许凭空造值，toggles 按出厂空清单走', async () => {
  const { normalizeEditorSettings } = await import('../src/bridge.ts')
  const legacy = structuredClone(defaultEditorSettings)
  delete legacy[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]
  const migrated = normalizeEditorSettings(legacy)
  assert.equal(migrated[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY], undefined, '补默认发生在原生 editor_defaults_impl 那一层')
  assert.deepEqual(inlayHintToggles(migrated).parameterHintExcludeList, [], '缺键 ⇒ 不排除任何东西')
})
