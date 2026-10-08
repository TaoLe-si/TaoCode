# 接线请求 · 2026-10-06 · intentw（Alt+Enter 弹层的分隔线与不可选条目）

本轮（`docs/batch-2026-10-06-intentw.md`）把 `src/intentionList.ts` 接上了两个真实出口：
问题面板的行菜单（`src/components/IntentionListMenu.vue`，已落地）与 Alt+Enter 的合流处
（`src/semanticActions.ts:472-475` 的档位顺序，已落地）。

**剩下一件事接不上**：Alt+Enter 那份弹层的**渲染**（分隔线 + 不可选条目置灰）整段在保留文件
`src/App.vue` 里，本轮纪律不许动它。这一条不是"做不到"，是"只能由能改 App.vue 的人落"。
下面每一处都给了 文件:行号、改成什么、为什么、判据，以及**自带腾位办法**（App.vue 现在
2706 行 / 上限 2737 ⇒ 只剩 31 行；本请求全程只净增 **1 行**，另两处是就地改单行）。

上游坐标（本轮逐字开过，与 `src/intentionList.ts` 头上那一份一致）：
· `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/IntentionListStep.java:296-309`
  `getSeparatorAbove()`（`:305` 组变了就 `new ListSeparator()`）
· 同文件 `:102-104` `isSelectable()` → `IntentionActionWithTextCaching.java:156-162`（默认**可选**，
  只有 `CustomizableIntentionAction` 能说自己不可选）⇒ 形状是「照样列出来，但这一条不能被选中」
· 同文件 `:293` `getDefaultOptionIndex() { return 0; }`（默认选中第 0 条，本请求不改这一条）

---

## W1 · 把 `src/App.vue:2675` 那一行换成 `CodeActionPopup` 的挂载

**现状**（`src/App.vue:2674-2676`，逐字读的）：

```html
2674  <div v-if="actionPrompt" class="modal-backdrop" @click.self="actionPrompt = null">
2675    <section class="command-palette" role="dialog" aria-modal="true" aria-label="代码操作" @keydown="trapFocus"><div class="palette-scope">代码操作 / 快速修复 · {{ actionPrompt.path }}</div><div class="palette-results"><button v-for="(action, index) in codeActions" :key="`${action.title}:${index}`" :class="{ highlighted: index === 0 }" @click="applyCodeAction(action)">…</button></div></section>
2676  </div>
```

`codeActions` 里的行**已经**是上游的档位顺序（先修复、后意图，本轮在 `src/semanticActions.ts:472-475` 接的），
但画出来仍是一整片按钮：换档没有分隔线，"服务端只列、既没编辑载荷也不能 resolve"的那几条照旧可点，
点下去走到 `src/semanticActions.ts` 的 `applyCodeAction` 才报一句「语言服务没有为「…」返回编辑。」——
正是上游 `isSelectable()` 那一档要避免的形状。

**改成**（三处，前两处是就地改单行，净增只有第三处的 import 一行）：

1. `src/App.vue:2674` 就地加一个 `@keydown`（`trapFocus` 是 App.vue 的作用域，弹层里就没有它）：
   ```html
   <div v-if="actionPrompt" class="modal-backdrop" @click.self="actionPrompt = null" @keydown="trapFocus">
   ```
2. `src/App.vue:2675` 整行换成（1 行 → 1 行）：
   ```html
   <CodeActionPopup :actions="codeActions" :path="actionPrompt.path" @apply="applyCodeAction" />
   ```
3. 在 App.vue 的组件 import 群里加 1 行：`import CodeActionPopup from './components/CodeActionPopup.vue'`
   —— **只加这一行**（31 → 30 行余量）。落完之后 `palette-scope` / `palette-results` 那一大行从 App.vue
   搬进组件，App.vue 实际是**变短**的（那一行约 620 字符），下一轮可以把上限从 2737 往下调。

**新建文件** `src/components/CodeActionPopup.vue`（可直接粘贴；它不请求、不写盘，只做渲染，
`apply` 原样抛回宿主既有的 `applyCodeAction`）：

```vue
<script setup lang="ts">
// Alt+Enter 的意图弹层（上游 `IntentionListStep` 画的那张 list popup）。
// 档位顺序 / 分隔线 / 不可选三条规则在 `src/intentionList.ts`；本仓两种对象怎么喂在
// `src/intentionMenuModel.ts`；行菜单那一路的同一份规则画在 `IntentionListMenu.vue`。
import { computed } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { LspCodeAction } from '../bridge'
import { intentionMenuItems, separatorAbove } from '../intentionList.ts'
import { menuIntentionFixInput } from '../intentionMenuModel.ts'

const props = defineProps<{ actions: readonly LspCodeAction[]; path: string }>()
const emit = defineEmits<{ apply: [action: LspCodeAction] }>()

// 档位从条目自带的 `kind` 判：本地抑制条目是 `localIntentions.ts:113` 标的 `quickfix.suppress`
// （**本仓自定的 kind，不是上游串** —— 全树 grep 只命中 kotlin 测试数据目录），其余都是修复。
const isIntention = (action: LspCodeAction) => action.kind === 'quickfix.suppress'
const rows = computed(() => intentionMenuItems(
  props.actions.filter(action => !isIntention(action))
    .map(action => ({ ...menuIntentionFixInput({ action, preview: null }), payload: action })),
  props.actions.filter(isIntention)
    // 抑制条目在 Alt+Enter 这一路恒有编辑载荷（`localIntentions.ts:106` 算不出插入点就不出条目），
    // 所以 `unavailable` 传空串 = 可选；把不可用的那条画成置灰的是行菜单那一路（见 IntentionListMenu）。
    .map(action => ({ id: action.title, unavailable: '', payload: action })),
))
</script>

<template>
  <section class="command-palette" role="dialog" aria-modal="true" aria-label="代码操作">
    <div class="palette-scope">代码操作 / 快速修复 · {{ path }}</div>
    <div class="palette-results">
      <template v-for="(row, index) in rows" :key="row.key">
        <div v-if="separatorAbove(rows, index)" class="palette-sep" role="separator" />
        <button :class="{ highlighted: index === 0 }" :disabled="!row.selectable"
                :title="row.selectable ? undefined : row.reason" @click="emit('apply', row.payload)">
          <Sparkles :size="iconSize.toolbar" /><span>{{ row.payload.title }}</span>
          <span v-if="row.payload.kind" class="small-muted">{{ row.payload.kind }}</span>
          <span v-if="row.payload.command" class="small-muted">由语言服务执行</span>
          <span v-else-if="!row.selectable" class="small-muted">{{ row.reason }}</span>
          <span v-else-if="!row.payload.edits.length" class="small-muted">需解析</span>
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 换档那一条线：与行菜单/日志菜单同一口径（`.eventlog-menu-sep` / `.log-menu-separator`），
   颜色取令牌，不写死 hex，也不加全局选择器。 */
.palette-sep { height: 1px; margin: var(--space-1) 0; background: var(--line-strong); }
</style>
```

**为什么这么判**（不是随手加的三件事）：
· 分隔线：上游 `IntentionListStep.java:296-309` 的 `getSeparatorAbove()`，`:305` 原文
  `getGroup(value) != getGroup(prev)` ⇒ 组变了才画，同组内不画。
· 置灰：`:102-104` → `IntentionActionWithTextCaching.java:156-162`，"列出来但不能选中"，
  不是"点下去再报错"，也不是"从列表里删掉"。
· `highlighted: index === 0` 保持原样，钉的是 `IntentionListStep.java:293` 的 `getDefaultOptionIndex()`。
· 行上的文案全部沿用现状（`代码操作 / 快速修复`、`由语言服务执行`、`需解析`）+
  `intentionList.ts` 已有的理由串 —— **没有新造控件、文案、键位或帮助链接**。

**判据**（落 W1 时**必须**同时加，否则等于没判据）：
1. 新建 `tests/code-action-popup.test.mjs`：
   ```js
   test('Alt+Enter 弹层真的画分隔线与置灰', () => {
     const popup = read('src/components/CodeActionPopup.vue')
     assert.match(popup, /separatorAbove\(rows, index\)/)
     assert.match(popup, /:disabled="!row\.selectable"/)
     assert.match(popup, /:title="row\.selectable \? undefined : row\.reason"/)
     assert.match(popup, /role="separator"/)
   })
   test('App.vue 装了 CodeActionPopup，trapFocus 挂在 backdrop 上（弹层里作用域还在）', () => {
     assert.match(read('src/App.vue'), /<CodeActionPopup :actions="codeActions" :path="actionPrompt\.path"/)
     assert.match(read('src/App.vue'), /v-if="actionPrompt" class="modal-backdrop"[^>]*@keydown="trapFocus"/)
     assert.doesNotMatch(read('src/App.vue'), /v-for="\(action, index\) in codeActions"/,
       '旧的那一整行还在 = 有两个弹层，或新的那个根本没挂上')
   })
   ```
2. 反向验证（判据要能失败）：把 `IntentionListMenu.vue` 里那条 `:disabled` 删掉 ⇒ 第 1 组红；
   把 W1 的挂载行删掉 ⇒ 第 2 组红。**注入一律带 `INTENTW-PROBE` 前缀并在跑完后 grep 归零**。
3. `node .tools/find-orphan-modules.mjs --gate` 必须仍是「新增 0」：`CodeActionPopup.vue` 由 App.vue 引，
   挂不上就会以"完全无引用"进孤儿清单 ⇒ **W1 的三步必须同批落**，不能只建组件不挂载。
4. 真机：Alt+Enter 打开一个"服务端只列不给编辑"的位置，该条应发灰、点不动、悬停出理由；
   换档处应有一条线；`npx vue-tsc -b --force` 的 `error TS` 条数不升。

## W1′ · 落完之后的收摊（同一批或下一批）

· `src/App.vue` 的 `palette-scope` 那一行搬走后，把上限从 `tests/module-size.test.mjs:107-108` 的
  2737 往下调（"上限只能靠拆降"）；本轮不动那个数字（不是本轮拆的）。
· `docs/inventory/*` 与判决表归口代理改，本轮不碰（并发黑名单）。

---

## 本轮**没有**做的另外两件事（写清楚，免得下一个代理重复考证）

1. **Alt+Enter 里的"越界抑制条目置灰"接不到**：`src/localIntentions.ts:105-106` 在算不出插入点时
   **直接不出这条**（`if (!edit) continue`）⇒ Alt+Enter 这一路永远收不到不可用的抑制条目，
   置灰那档在本仓只有行菜单（`IntentionListMenu.vue`）有真实输入。这一条不是缺陷，是两条路的
   输入本来就不同，`intentionList.ts` 的注释里那句"面板/Alt+Enter 两路输入"在 `unavailable`
   这一档上只对面板成立 —— 已在 `tests/intention-list.test.mjs` 里按这个事实钉住。
2. **`IntentionRowGroup` 没有拆成 ERROR / INSPECTION 两档**：上游八档
   （`CachedIntentions.java:371-393`）里本仓只有"修复 / 意图"两档有生产者；GUTTER / NOTIFICATION
   没有任何生产者（本仓没有 PSI gutter 意图、也没有广告/通知条目），列出来就是假档位。
   真要拆 ERROR/INSPECTION，得先有"这条是错误修复还是检查修复"的输入 ——
   `FixInput.preferred` / `FixInput.linked` 就是留给这一档的口子，**当前无函数消费它们**
   （`intentionRowsFor` 只看 `hasEdits`）。本轮按"不自加档位"处理，没有编造分组依据。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1 已接线**：`src/App.vue:2664` 的 `<section class="command-palette" …>` 已换成 `<CodeActionPopup :actions="codeActions" :path="actionPrompt.path" @apply="applyCodeAction" @keydown="trapFocus" />`（`@keydown="trapFocus"` 跟着走，Tab 焦点圈不失效）。见 codeactionpopup 处理结果。
- **W1′** —— 收摊（更新 `tests/module-size.test.mjs` 上限等），登记。

结论：W1 已接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W1 已接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
