# lane visual-leftovers（2026-10-08）—— 7 个测试文件收红

10 条红修掉 5 条：`icon-glyph-role` 5/5、`b2-verdict` 6/6、`run-startup-focus` 14/14 全绿，`ui-icons` 4 红 → 2 红。
剩 5 条红的根**全部**在禁改或别 lane 名下文件（SourceControl / AgentPanel / AgentMessageContent / agent-settings / App.vue），
这四条判据一条都没放宽。`src/tokens.css`、`src/style.css` 我这边**净 0 行**（无需新令牌）。

## 逐文件根因与改动

**1. `tests/b2-verdict.test.mjs`（1 红 → 6/6）** §G 真值变了、抄在别处的数字没跟：vc-nav 行分隔符批次把
`LineSeparatorWidgetFactory` 的 §G 行改成 `[x]`（`src/components/LineSeparatorStatusWidget.vue` 的 CRLF/LF/CR 徽标 + 弹层 +
SPEEDSEARCH，复用 `src/speedSearch.ts`；消费点 `src/App.vue` 状态栏 `showWidget('lineSeparator')`），文档头与 §A/§B 表头停在 22/94。
实测重数 §G：`[x]23 / [~]93 / [ ]0 / [-]234 = 350`。改动：`docs/inventory/verdict-toolwindow-openapi.md:7`（合计）、`:40`（§A 23 类）、
`:52`（§B 93 类）、新增复核段；`tests/b2-verdict.test.mjs:52-77` 判据不再自己印数字 —— **从 §G 重数**再核文档四处表头 + 档位健全性下限
（教训：档位数是 §G 派生量，抄第二份必漂，21/95 → 22/94 → 23/93 三轮）。反向验证：文档头改回 `22 + 94 + 0 + 234` ⇒ 红，恢复后绿。

**2. `tests/run-startup-focus.test.mjs`（1 红 → 14/14）** 判据锚点过时（post-baseline 回归：16:48 基线清单里没有本文件）。
pf-lifecycle 17:22 从 `native/settings_schema.cpp` 拆出 `native/settings_project_schema.cpp`，两个运行配置键的白名单与布尔闸只在后者
（`:551` / `:555` 的 `is_boolean()`），判据只读老文件 ⇒ 假红。改动：`tests/run-startup-focus.test.mjs:186-209` 宿主 schema 按**两份并集**读
（同 html-export 等三个判据的跟搬口径），并把"脏值报错"钉强成两件：两键同处一份初始列表 + 同一变量 `contains/at` + `is_boolean()`；
`:222-224` 注释跟着改。（第一版写成 `"key"[\s\S]{0,600}?is_boolean()`，实测会误命中 200 字符处 `allowRunningInParallel` 的闸 ⇒ 作废重写。）
反向验证：(a) 锚点改回只读老文件 ⇒ 红；(b) 内存扰动 host 文本（`is_boolean()`→`is_text()`、键表拆单个）⇒ 两个正则都 false ⇒ 会红。

**3. `tests/icon-glyph-role.test.mjs`（1 红 → 5/5）** 判据**字面口径**要求"纯图标按钮必须渲染 svg/组件"，但 `AgentSettingsSwitch.vue`
是 ZCode 开关移植、上游没有图标：`.tools/ZCode/packages/ui/src/components/ui/switch.tsx`（Radix Switch = 轨道 + Thumb）、
`.tools/ZCode/packages/ui/src/settings/AutomationSwitchToggle.tsx:22-38`（`<button role="switch" aria-checked>` + 轨道 + 圆形 `<span>` 滑块）。
状态由轨道 + aria-checked 表达，补矢量图就是发明形状（该判据文件头的前提是"只剩一个文本节点 ⇒ 字形冒充图标"，这按钮一个字符都没有）。
改动：`tests/icon-glyph-role.test.mjs:16-34`（豁免依据 + `attrOf`/`hasProp`）、`:165-166`（静态 `role="switch"` **且** 有 `aria-checked` 才算开关）、
`:192-194`（反向守卫：全仓找不到开关按钮 ⇒ 删掉豁免）。未动那个 .vue。反向验证：临时删 `:aria-checked` ⇒ 同按钮立刻红；`git diff` 为空（已复原）。

**4. `tests/ui-icons.test.mjs`（4 红 → 2 红）** gap 条（我修）：判据把**祖先类**也算成"写了 gap 的类"（`.a .b { gap }` 只作用在 `.b`），
于是 `ModelMetadataSection.vue:186` 的 `.model-metadata .settings-fields .model-metadata-block { gap }` 把只有 margin-top 的外层
`.model-metadata` 判红（假阳），同时**掩盖**真缺陷；改成只取最后一个复合选择器：`tests/ui-icons.test.mjs:244-256`。修完暴露真缺陷 ——
`src/components/InternalErrorsDialog.vue:78` 的 `.palette-footer errors-actions`：`.errors-actions` 只写 `align-items`/`gap`、
`.errors-note { flex: 1 }`，而 `.palette-footer` 全仓无定义 ⇒ 三条声明全是空操作。改动：`src/components/InternalErrorsDialog.vue:104-106` 补
`display: flex`（未发明内边距，见"仍缺"）。SFC 结构条：基线只红 `agent-settings/ComputerUseSettingsSection.vue`（22 字节空壳，协调代理名下）——
**确认它是当时唯一被这条判红的文件**，本轮实测该条已绿（文件 18:20 被补成完整组件）。剩 2 条红在禁改/别 lane 文件（W4/W5/W6）。
反向验证：(a) 往 `src/style.css:1046` 的 `.palette-empty`（非 flex）临时塞 `gap: var(--space-1)` ⇒ 该条在 `App.vue:2519/2618/2625` 报出（已撤）；
(b) 临时还原旧 subject 写法 ⇒ `.model-metadata` 假阳回来、`.errors-actions` 被掩盖（已复原）。

**5. `tests/aria-widget-handlers.test.mjs`（1 红，未修：禁改文件）** `src/components/SourceControl.vue:693` 的 `.sc-checks-progress-trigger`
有 `aria-haspopup`/`:aria-expanded` 却没有自己的处理器：开关挂在父 div（`:692`）。靠冒泡**能**用（键盘 Enter 也冒泡），属"可达性写法不达标"
而非"点不开"；判据要求处理器在按钮上，不放宽。接线 W1。

**6. `tests/focus-ring-ownership.test.mjs`（1 红，未修：别 lane 文件）** `src/components/AgentPanel.vue:865`
`.agent-composer:focus-within { border-color: var(--accent); box-shadow: inset 2px 0 0 var(--accent); }` 用 box-shadow 画焦点环。接线 W2。

**7. `tests/menu-check-icon.test.mjs`（1 红，未修：别 lane 文件）** `src/components/AgentMessageContent.vue:3` 从 lucide 导入 `Check`、
`:123` 渲染 `<Check>`（复制代码成功态）。判据声明口径是**全仓**只留 SourceControl 空状态那一处，按它应换 `IdeaCheckedIcon`（W3）。
**需协调代理权衡**：ZCode 自己的代码块就是 lucide `CheckIcon`（`.tools/ZCode/packages/ui/src/components/ai-elements/code-block.tsx:12`、`:495`
`isCopied ? CheckIcon : CopyIcon`）；若以 ZCode 保真优先，应改判据口径（收窄到菜单槽）——那是缩小覆盖面，我没有替它改。

## 门禁实测读数（2026-10-08 18:41，`node --test` 逐文件）
- aria-widget-handlers 2 条：pass 1 / fail 1（`SourceControl.vue:693`）
- focus-ring-ownership 3 条：pass 2 / fail 1（`AgentPanel.vue:865`）
- icon-glyph-role 5 条：pass 5 / fail 0　·　b2-verdict 6 条：pass 6 / fail 0　·　run-startup-focus 14 条：pass 14 / fail 0
- menu-check-icon 6 条：pass 5 / fail 1（`AgentMessageContent.vue`）
- ui-icons 19 条：pass 17 / fail 2（`App.vue:2268` + `AgentSettingsSwitch.vue:15` 缺 title；`AgentPanel.vue` 三条 `> svg` 覆盖 `:size`）
- `node --test tests/module-size.test.mjs`：pass 5 / fail 0　·　`npx vue-tsc --noEmit`：RC=0（0 错）　·　`tests/internal-errors.test.mjs` 7/7（我改了它的组件）；`src/style.css`、`src/tokens.css` 侧我净 0 行

## 仍缺什么（如实）
1. 上述 5 条红都在禁改或别 lane 名下文件，需接线；没有为绿去放宽这四条判据。
2. `InternalErrorsDialog.vue` 底栏只补 `display: flex`：横向/底部内边距仍缺（`.palette-footer` 全仓无定义，IDEA `DialogWrapper`
   动作面板的内边距我这条 lane 拿不到 line 级依据）⇒ 不发明数值。
3. §B 的 B-1…B-6 括号数（19/7/16/8/7/3）来源不明：与表行数（20/7/18/8/7/3）、§G 档位数都不等，`git show 861ba98` 里就是这值 ⇒ 未动。
4. W4 那个 title 在最后一轮读数时仍在；有别的 lane 正给 agent-settings 补 title（`McpSettingsSection.vue` 两处本轮内被补上）⇒ 接线前复读该文件。

## 需要协调代理接线（文件 + 行 + 改法）
- **W1** `src/components/SourceControl.vue:692` 去掉 div 上的 `@click="checksPopupOpen = !checksPopupOpen"`，改挂到 `:693` 的 trigger 按钮
  （两处都留会冒泡双触发、互抵）。状态链已核：`src/sourceControlCommitChecks.ts:302` 的 `checksPopup = computed(() => checksProgressPopup(p, checksPopupOpen))`
  ⇒ `:aria-expanded="checksPopup.visible"` 随之正确；外部点击收起（`:525-526` 的 `contains()` 守卫）不受影响。⇒ 修 aria-widget-handlers。
- **W2** `src/components/AgentPanel.vue:865`：`box-shadow: inset 2px 0 0 var(--accent)` → `outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset)`
  （保留 `border-color: var(--accent)`）。⇒ 修 focus-ring-ownership。
- **W3** `src/components/AgentMessageContent.vue:3` 去掉 lucide `Check`、加 `import { IdeaCheckedIcon } from './icons/toolWindowIcons'`；`:123`
  `<Check …>` → `<IdeaCheckedIcon …>`（`:size="iconSize.control"`、`aria-hidden` 原样）。⇒ 修 menu-check-icon（先看上面的保真权衡）。
- **W4** `src/components/agent-settings/AgentSettingsSwitch.vue:21` 在 `:aria-label` 旁加 `:title="props.accessibleName"`。⇒ 修 ui-icons title 条。
- **W5** `src/App.vue:2268`（该行第 533 列起）`<button v-if="bottomTabIsToolWindow" class="icon-button output-tabs-options"
  aria-label="调整此工具窗口的停靠位置" …>` 加 `:title="'调整此工具窗口的停靠位置'"`。⇒ 修 ui-icons title 条（App.vue 禁改）。
- **W6** `src/components/AgentPanel.vue:876/877/893` 三条 `> svg` 宽度规则加 `:not(.lucide):not(.idea-icon)`（同 `src/style.css:272` 写法），或删掉这三行的
  width/height：模板里 first-child=`iconSize.menu`(13)、last-child=`iconSize.dense`(12)、`.agent-send`=`iconSize.menu`(13)，CSS 现强改成 16/14/16
  （正是判据护的"源码在骗人"）。若设计真要 16/14，请改模板的 `:size` 角色，不要留 CSS 覆盖。⇒ 修 ui-icons 第二条。
