# 接线请求 · 2026-10-06 · codeactionpopup（把 Alt+Enter 的弹层换成 `CodeActionPopup`）

本轮（`docs/batch-2026-10-06-codeactionpopup.md`）落了**组件本体 + 模块侧数据形状**：

- `src/components/CodeActionPopup.vue`（102 行）
- `src/codeActionPopupModel.ts`（110 行）
- `tests/code-action-popup.test.mjs`（206 行 / 15 条：9 条真执行 + 6 条源码形状）

**唯一剩下的是宿主那一行** —— 本 lane 不能写 `src/App.vue`。这一份是给能改它的人（主代理）的。

它不是"做不到"：`src/App.vue` 是保留的组装层，装配逻辑必须进新文件（已进），App.vue 只留 import + 一次挂载。

---

## 0. 现场数字（`grep -n` / `wc -l` 实测，别照抄派单）

| 项 | 实测值 | 什么时候变的 |
| --- | --- | --- |
| `src/App.vue` 行数 | **2713** | 本轮**开单时是 2706**（`docs/wiring-requests-2026-10-06-intentw.md:9` 说的 2706/31 行余量），落码期间有别的 lane 又加了 7 行 |
| `tests/module-size.test.mjs:107-108` 登记的 App.vue 上限 | **2737** | — |
| 余量 | **24 行**（2737 − 2713） | 还在缩；本请求全程只**净 +1 行**，余量真掉到 0 时有零行的兜底写法（§3-1） |
| 弹层那一行 | **`src/App.vue:2682`**（intentw 那份写的 2675 已经漂了 7 行） | 同上 |
| 外壳那一行 | **`src/App.vue:2681`** | 同上 |

**行号会漂，别照抄**：落之前先 `grep -n 'v-if="actionPrompt"' src/App.vue`（外壳）与
`grep -n 'in codeActions' src/App.vue`（弹层那一行）自己取一次；上面的数字是本轮 16:5x 的实测。

**宿主出口名逐个核过，三个都真实存在**（这是派单点名要的"真实存在的宿主出口名"）：

| 名字 | 声明处 | 现在谁在用 |
| --- | --- | --- |
| `codeActions` | `src/App.vue:545` `const codeActions = ref<LspCodeAction[]>([])` | `:2682` 的 `v-for`；写方是 `src/semanticActions.ts:487` |
| `actionPrompt` | `src/App.vue:546` `const actionPrompt = ref<{ path: string } \| null>(null)` | `:2681` 的 `v-if` 与 `:2682` 的 `actionPrompt.path` |
| `applyCodeAction` | `src/App.vue:973` 从 `createSemanticActions` 解构、`:1391` 进 ctx | `:2682` 的 `@click`；本体在 `src/semanticActions.ts:522` |

`trapFocus` 也在 App.vue 的作用域里（`:1880` 解构，本体 `src/diskSync.ts:239-246`）——**它搬不进组件**，所以第 1 处改动必需（下面 W1-1）。

组件的 props 名字与这三个出口一一对上：`defineProps<{ actions, path }>` + `defineEmits<{ apply: [action: LspCodeAction] }>`，
不需要新状态、不需要新 handler。

---

## W1 · 两处改动，净 +1 行

### W1-1 · `src/App.vue:2682` 整行换成一行（净 0 行）

```html
<!-- 现在（一整行约 620 字符，trapFocus 挂在这个 <section> 上） -->
<section class="command-palette" role="dialog" aria-modal="true" aria-label="代码操作" @keydown="trapFocus"><div class="palette-scope">代码操作 / 快速修复 · {{ actionPrompt.path }}</div><div class="palette-results"><button v-for="(action, index) in codeActions" :key="`${action.title}:${index}`" :class="{ highlighted: index === 0 }" @click="applyCodeAction(action)"><Sparkles :size="iconSize.toolbar" /><span>{{ action.title }}</span><span v-if="action.kind" class="small-muted">{{ action.kind }}</span><span v-if="action.command" class="small-muted">由语言服务执行</span><span v-else-if="!action.edits.length" class="small-muted">需解析</span></button></div></section>
<!-- 改成 -->
<CodeActionPopup :actions="codeActions" :path="actionPrompt.path" @apply="applyCodeAction" @keydown="trapFocus" />
```

**`@keydown="trapFocus"` 必须跟着走**：`trapFocus` 现在挂在被搬走的那个 `<section>` 上
（`:2682` 内部），少了它，弹层里的 **Tab 焦点圈静默失效**（`trapFocus` 是 App.vue 作用域里的函数，
`:1880` 解构、本体 `src/diskSync.ts:239-246`，搬不进组件）。挂在组件标签上 = 它仍落在**今天同一个 DOM 节点**上
（组件根 `<section>`），与 App.vue 里其余 21 处 `@keydown="trapFocus"` 的位置一致（22 处里 0 处挂在 `.modal-backdrop` 外壳上）。

这一条不是"想当然的 Vue 魔法"，**本轮开过装机版的运行时**（`node_modules/@vue/runtime-core/dist/runtime-core.cjs.js`）：

- `:4707-4718` 单根元素组件走 `root = cloneVNode(root, fallthroughAttrs, …)`，且受 `inheritAttrs !== false` 控制；
- `:7898` `cloneVNode` 用 `mergeProps(vnode.props, extraProps)`；
- `:8049-8053` `isOn(key)` 那一档：`ret[key] = existing ? [].concat(existing, incoming) : incoming`
  ⇒ 宿主的 `onKeydown` 与组件自己的 `@keydown="onKeydown"` **合并成数组、两个都跑**，不是覆盖。

三个前提也都成立：组件根节点是**单个元素**（`<section>`）、组件没写 `defineOptions({ inheritAttrs: false })`、
`keydown` **不在** `defineEmits` 里（那里只有 `apply`，声明过的事件名会被从 attrs 里摘掉）。
⇒ 若将来有人给组件加多根、关掉 `inheritAttrs`，或把 `keydown` 写进 `defineEmits`，`trapFocus` 会**静默失效** ——
所以下面 §2 的判据里有一条专门钉它。

**兜底写法**（若不想依赖上面那条合并）：把它挂在外壳上靠冒泡，`src/App.vue:2681` 就地改一行，同样净 0 行：

```html
<div v-if="actionPrompt" class="modal-backdrop" @click.self="actionPrompt = null" @keydown="trapFocus">
```

两种都行，**选一种，别两边都挂**（那会变成 Tab 走到边界时两个处理器各转一圈）。
选 W1-1 主写法是因为它与既有 22 处的位置一致；选兜底是因为它与组件内部零耦合。

搬过去的东西**一件不少**：`command-palette` / `palette-scope` / `palette-results` 三个类、
`role="dialog" aria-modal="true" aria-label="代码操作"`、`Sparkles :size="iconSize.toolbar"`、
三段既有文案（`代码操作 / 快速修复`、`由语言服务执行`、`需解析`）都在组件里，
`tests/code-action-popup.test.mjs` 逐条钉着（不许在搬的过程中顺手改措辞）。

### W1-2 · 加 import（**净 +1 行**，全请求唯一的那一行）

在组件 import 群里加（`src/App.vue:84` / `:125` 就是这种一行的邻居）：

```ts
import CodeActionPopup from './components/CodeActionPopup.vue'
```

**净行数核算**：W1-1 = 0（1 行换 1 行）、W1-2 = **+1** ⇒ **App.vue 净 +1，2713 → 2714，余量 24 → 23**。
`Sparkles` 在 App.vue 里还有两处用（`:2666`、`:2669`）⇒ 搬走 `:2682` **不会**留下死 import，`lucide-vue-next` 那一行不用动。

---

## 2. 必须同批加的判据（否则等于没判据）

W1-1/W1-2 落地时，把这一段追加到 `tests/code-action-popup.test.mjs` 末尾（本轮不预置，
因为现在加进去就是一句恒红的空判据）：

```js
test('Alt+Enter 的弹层真的挂上了组件，trapFocus 还跟着（宿主那一半）', () => {
  const app = read('src/App.vue')
  assert.match(app, /<CodeActionPopup :actions="codeActions" :path="actionPrompt\.path" @apply="applyCodeAction"/)
  // 焦点圈：搬走 <section> 就等于搬走 trapFocus，这一条专门钉它没被静默摘掉
  // （挂在组件标签上 = 合并进组件根的 @keydown，见 runtime-core.cjs.js:8049-8053）。
  assert.match(app, /<CodeActionPopup[^>]*@keydown="trapFocus"/,
    'trapFocus 没了 = 弹层里 Tab 跑出对话框，且不报任何错')
  assert.doesNotMatch(app, /v-for="\(action, index\) in codeActions"/,
    '旧的那一整行还在 = 同时存在两个弹层，或者新的那个根本没挂上')
  assert.match(app, /import CodeActionPopup from '\.\/components\/CodeActionPopup\.vue'/)
  // 只准挂一处：两处都挂 = Tab 到边界时两个处理器各转一圈。
  assert.equal(app.match(/v-if="actionPrompt" class="modal-backdrop"[^>]*@keydown/g)?.length ?? 0, 0,
    'backdrop 上又挂了一遍 = 两处焦点圈')
})
```

**这条判据要能失败**（正/反对照都指给落它的人）：

- 只加 import、不换 `:2682` ⇒ 第 1、2、3 条一起红（第 3 条钉的就是"新旧并存"这个形状）。
- 换了 `:2682` 但漏掉 `@keydown="trapFocus"` ⇒ 第 2 条红。
- 把 `:path="actionPrompt.path"` 写成 `:path="activePath"` ⇒ 第 1 条红
  （`applyCodeAction` 读的是 `actionPrompt.value?.path`，`src/semanticActions.ts:523`）。
- 改用 §1 的**兜底写法**（挂 backdrop）⇒ 上面第 2、5 条要跟着换成 `assert.match(app, /v-if="actionPrompt" class="modal-backdrop"[^>]*@keydown="trapFocus"/)` 与"组件标签上不许再挂一遍"，
  两条互斥地红，**不要**把两套断言同时留着。

## 3. 如果挂不上会退化成什么样（按顺序试，别抬上限）

1. **余量掉到 0 行**（本请求要 1 行，而 App.vue 在飞期间每轮都在缩）⇒ 把 W1-3 拼进**既有那一行**，
   净 **0** 行，仓库里已有同款写法：`src/App.vue:84` 与 `:125` 都是 `import …; import …` 两条挤一行。
   ```ts
   import RunConsole from './components/RunConsole.vue'; import CodeActionPopup from './components/CodeActionPopup.vue'
   ```
2. **连 W1-1/W1-2 都塞不进**（比如 `:2681-2682` 正在被别的 lane 改）⇒ **本轮不落**，保持现状：
   孤儿门禁继续红（`✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue`），
   弹层维持旧形状 —— 换档没分隔线、"服务端只列不给编辑"的那几条照旧可点、
   点下去才在 `src/semanticActions.ts` 报一句「语言服务没有为「…」返回编辑。」、
   并且**完全没有 ↑↓/Enter**（`:2682` 上没有任何按键处理，`highlighted` 写死第 0 行）。
   组件与模型留着不会被判死：`codeActionPopupModel.ts` 已经由组件消费，红点只有那一个。
3. **绝对不要**为了塞进去把 `tests/module-size.test.mjs:108` 的 2737 往上抬 —— 那份文件头上写着
   「上限只能靠拆降」。要抬得先有人把 `:2682` 那 620 字符真的搬走，而那正是本请求在做的事。

## 4. 落完之后的收摊（同一批或下一批，都归口主代理）

- `docs/inventory/*` 与判决表：本 lane 没碰（黑名单）。
- 真机一项（本轮**没有**真机渲染证据，B 组判据是源码形状）：Alt+Enter 打开一个"服务端只列不给编辑"的位置
  ⇒ 该条发灰、点不动、悬停出理由；换档处一条线；↑↓ 跳过灰行、Enter 应用当前行；Esc 关（走
  `src/keymap.ts:223`，组件里没有第二条关闭路径）。
- `docs/wiring-requests-2026-10-06-intentw.md` 的 W1 可以标"已被本请求取代"：那份草稿有三处与上游不符
  （初始选中写死第 0 行 / 没有键盘 / 抑制行的置灰说法对不上 `localIntentions.ts:105-106`），
  差异表在 `docs/batch-2026-10-06-codeactionpopup.md` §4。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1 已接线**：`src/App.vue:2664` 的整行 `<section class="command-palette" …>` 已换成 `<CodeActionPopup :actions="codeActions" :path="actionPrompt.path" @apply="applyCodeAction" @keydown="trapFocus" />`（`@keydown="trapFocus"` 跟着走，Tab 焦点圈不失效）；import 加在 `:18`（与 TestRunnerPanel 同一行）。外壳 `:2663` 的 `.modal-backdrop` 未动。

App.vue 行数：2695 → 2695（净 0：一行换一行）。
