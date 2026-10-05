// 重构菜单（IDEA `RefactoringMenu`）—— TaoCode 的对应物。
//
// **权威来源是 `platform/platform-impl/resources/idea/LangActions.xml:355-395`**，
// 而不是直觉。IDEA 的动作 XML 里主菜单**没有** RefactoringMenu 这一组（它不在
// `PlatformActions.xml` 里）；`RefactoringMenu` 定义在 LangActions.xml，末行
// `:394` 用 `<add-to-group group-id="MainMenu" anchor="after" relative-to-action="CodeMenu"/>`
// 挂到主菜单（排在「代码」之后）。解析后的权威清单见
// `tests/main/testData/actionSystem/groupStructure/actionGroupStructure.txt:2797-2822`。
//
// 上游顺序（LangActions.xml:356-393）逐条对：
//   :356 Refactorings.QuickListPopupAction → ✅ 重构…（打开代码动作列表）
//   :357 RenameElement                    → ✅ 重命名
//   :358 ChangeSignature                  → ✅ 更改签名（本仓是文本层：`src/refactorSignature.ts`
//                                           + `src/refactorSignatureFlow.ts`，键位 `$default.xml:469-471`）
//   :359 <separator/>
//   :360-383 IntroduceActionsGroup popup   → ✅ 提取/引入（**子菜单**，见下）+ 引入形参对象
//   :384 Inline                           → ✅ 内联
//   :385 <separator/>
//   :386 Move                             → ✅ 移动文件…
//   :387 CopyElement                      → ✅ 复制文件…
//   :388 SafeDelete                       → ✅ 安全删除…（`src/safeDelete.ts` 的三选一对话框）
//   :389 <separator/>
//   :391-393 MembersPullUp / MemberPushDown / InvertBoolean
//                                          → ✅ 向上拉取成员 / 向下推送成员（`src/refactorMemberMove.ts`）
//                                            · InvertBoolean 需要表达式级 PSI，本仓不做（见报告）
// 没有后端的一律**不放**（不放假控件）。
//
// **`ReformatCode` 不在这个菜单里**：它在上游属于 `CodeFormatGroup`
// （`LangActions.xml:314-322`，挂在**代码**菜单），TaoCode 已经在
// `src/menus/codeMenu.ts:108` 那一行。原先本文件底部还挂了一份「重新格式化代码」
// —— 放错家；而且 `semantic()` 的 `id` 就取第一个参数（`App.vue:1443-1445`），
// 两边都叫 `'format'`，属于**重号**，本轮删除。
//
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，成员先用 any。
import type { MenuRow } from './types'

export interface RefactorMenuContext {
  active: any
  lspReady: any
  isDesktop: boolean
  caretPayload: (arg?: any) => any
  openCodeActions: (arg?: any, flag?: any) => any
  extractVariable: () => any
  extractConstant: () => any
  extractMethod: () => any
  inlineVariable: () => any
  moveActiveFile: () => any
  copyActiveFile: () => any
  /**
   * 更改签名（`LangActions.xml:358` ChangeSignature，键位 `$default.xml:469-471`）。
   * **可选**：宿主没给出处理函数就不渲染那一行（见下面的「按能力渲染」）。
   */
  openChangeSignature?: () => any
  /** 安全删除三选一对话框（`LangActions.xml:388` SafeDelete，键位 `$default.xml:999-1001` = Alt+Delete）。 */
  openSafeDelete?: (arg?: any) => any
  /** 成员上移/下移（`LangActions.xml:391/392`）。上游这两条**没有默认键位**（`$default.xml` 里查不到 id）。 */
  openPullUp?: () => any
  openPushDown?: () => any
  /** 引入形参对象（`LangActions.xml:372`）。 */
  openIntroduceParameterObject?: () => any
  semantic: (kind: any, title: any, keys: any, keywords: any) => MenuRow
}

/**
 * 宿主侧有没有这条链路的判据：`ctx` 上那个处理函数**真的存在**才算有。
 *
 * 为什么要这一层闸门（本仓铁律：没有消费链路就不渲染）：本批把 ChangeSignature /
 * SafeDelete 三选一 / PullUp / PushDown / IntroduceParameterObject 的**模型**落到了
 * `src/refactorSignature.ts`+`refactorSignatureFlow.ts`、`src/safeDelete.ts`、
 * `src/refactorMemberMove.ts`、`src/refactorIntroduceParameterObject.ts`，
 * 但它们的宿主装配点在保留文件 `src/App.vue`（`refactorMenuContext` 那一个对象字面量，
 * App.vue:1537）与 `src/keymap.ts`/`src/keymapBindings.ts` —— 桶 1 只读。
 * 若把这些行**无条件**渲染，`run: () => ctx.openX()` 就会在点下去时取到 undefined，
 * 那正是「画一条点了没反应的菜单行」的假控件；把类型写成必填还会让 App.vue
 * 那个字面量直接 TS2739。所以：**必填改可选 + 逐行按能力渲染**，宿主接上哪个就出现哪条，
 * 接不上的那条既不存在也进不了快捷键表。接线请求见
 * `docs/wiring-requests-2026-10-06-bucket1b.md`。
 */
const hosted = (handler: (() => any) | undefined): boolean => typeof handler === 'function'

// IDEA RefactorMenu 的 TaoCode 对应物。成员顺序与分隔线照 LangActions.xml:356-393。
export function createRefactorMenuRows(ctx: RefactorMenuContext): MenuRow[] {
  return [
    // :356 Refactorings.QuickListPopupAction（Ctrl+Alt+Shift+T）—— 本仓打开代码动作列表。
    { id: 'refactor.this', title: '重构…', keys: 'Ctrl Alt Shift T', keywords: 'refactor this 重构', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.openCodeActions(ctx.caretPayload()) },
    // :357 RenameElement。
    ctx.semantic('rename', '重命名', 'Shift F6', 'rename refactor symbol 重命名'),
    // :358 ChangeSignature（Ctrl+F6，`$default.xml:469-471`）。本仓是文本层改签名 +
    // 工作区文本调用点扫描（`src/refactorSignature.ts` / `src/refactorSignatureFlow.ts`）。
    // 只有宿主提供了 `openChangeSignature` 才出现这一行（宿主未接线时它是假控件）。
    ...(hosted(ctx.openChangeSignature) ? [{
      id: 'refactor.changeSignature', title: '更改签名', keys: 'Ctrl F6', keywords: 'change signature 更改签名 方法签名',
      enabled: () => Boolean(ctx.active.value), run: () => void ctx.openChangeSignature!(),
    }] : []),
    // :359 <separator/>。
    { id: 'refactor.rule1', rule: true },
    // :360-383 `<group id="IntroduceActionsGroup" popup="true">` —— 上游是**子菜单**，
    // 标题取 `ActionsBundle.properties:885` `group.IntroduceActionsGroup.text=E_xtract/Introduce`。
    // 成员里本仓真接得住的按上游相对次序：IntroduceVariable(:361) · IntroduceConstant(:364) ·
    // IntroduceParameterObject(:372) · ExtractMethod(:373)。
    // **子菜单内不画分隔线**：上游那几个 `<separator/>` 隔的是 IntroduceField/IntroduceParameter
    // （`:367/368`）与 ExtractClass/Interface/Superclass/Module 一簇（`:378-382`）。
    // ExtractInterface/ExtractSuperclass 本仓**有**落点（成员选择面板 + 新建声明文件），
    // 落在「向上拉取成员」那条里（同一个 MemberChooser），所以不在这里重复出现。
    { id: 'refactor.introduce', title: '提取/引入', keywords: 'extract introduce refactor 提取 引入 重构', children: [
      { id: 'refactor.extractVariable', title: '提取变量', keys: 'Ctrl Alt V', keywords: 'extract variable local 提取变量', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.extractVariable },
      { id: 'refactor.ExtractConstant', title: '提取常量', keys: 'Ctrl Alt C', keywords: 'extract constant field 提取常量', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.extractConstant },
      // :372 IntroduceParameterObject —— zh 文案 `RefactoringBundle.properties:350`
      // `refactoring.introduce.parameter.object.title` = 引入形参对象。
      // 与 ChangeSignature 同一个闸门：本仓的落点是 `src/refactorIntroduceParameterObject.ts`
      // （文本层：形参表 → 参数对象声明 + 声明/调用点两处改写），宿主没接就不出现。
      ...(hosted(ctx.openIntroduceParameterObject) ? [{
        id: 'refactor.introduceParameterObject', title: '引入形参对象',
        keywords: 'introduce parameter object 引入形参对象 形参类',
        enabled: () => Boolean(ctx.active.value), run: () => void ctx.openIntroduceParameterObject!(),
      }] : []),
      { id: 'refactor.ExtractMethod', title: '提取方法', keys: 'Ctrl Alt M', keywords: 'extract method function 提取方法', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.extractMethod },
    ] },
    // :384 Inline。
    { id: 'refactor.inline', title: '内联', keys: 'Ctrl Alt N', keywords: 'inline variable method constant 内联', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.inlineVariable },
    // :385 <separator/>。
    { id: 'refactor.rule2', rule: true },
    // :386-387 Move / CopyElement（IDEA RefactorMenu file rows: 移动文件 F6 / 复制文件 F5）。
    { id: 'refactor.moveFile', title: '移动文件…', keys: 'F6', keywords: 'move file refactor 移动文件', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.moveActiveFile() },
    { id: 'refactor.copyFile', title: '复制文件…', keys: 'F5', keywords: 'copy file refactor 复制文件', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.copyActiveFile() },
    // :388 SafeDelete（`$default.xml:999-1001` = Alt+Delete）。上游是删除前的三选一对话框
    // （`UnsafeUsagesDialog.java:47` 的 查看用法 / 仍然删除 / 取消），本仓的模型在 `src/safeDelete.ts`。
    // 模型已在生产链路上（`src/treeActions.ts:14` 的删前提示），但**那条对话框**的宿主处理函数
    // `openSafeDelete` 还没进 App.vue —— 没接就不出现这行。
    ...(hosted(ctx.openSafeDelete) ? [{
      id: 'refactor.safeDelete', title: '安全删除…', keys: 'Alt Delete', keywords: 'safe delete 安全删除 删除',
      enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.openSafeDelete!(ctx.active.value),
    }] : []),
    // :389 <separator/>。
    { id: 'refactor.rule3', rule: true },
    // :391-392 MembersPullUp / MemberPushDown —— 上游这两条在 `$default.xml` 里**没有**默认键位
    // （已逐条 grep 过 10 个键位文件，只有动作 XML 里的 id），所以这里不写 keys，不冒充。
    // zh 标题取 `RefactoringBundle.properties:314` `pull.members.up.title` 与 `:320` `push.members.down.title`。
    // 落点是 `src/refactorMemberMove.ts`（文本层的成员选择 + 跨类搬动 + 父类声明补全）。
    ...(hosted(ctx.openPullUp) ? [{
      id: 'refactor.pullMembers', title: '向上拉取成员…',
      keywords: 'pull up members 向上拉取 成员 上移 提取超类',
      enabled: () => Boolean(ctx.active.value), run: () => void ctx.openPullUp!(),
    }] : []),
    ...(hosted(ctx.openPushDown) ? [{
      id: 'refactor.pushMembers', title: '向下推送成员…',
      keywords: 'push down members 向下推送 成员 下移',
      enabled: () => Boolean(ctx.active.value), run: () => void ctx.openPushDown!(),
    }] : []),
    // :393 InvertBoolean 需要表达式级 PSI（`invertBoolean/` 那一族在 `PsiExpression` 上取反），
    // 本仓没有可依靠的等价物 —— 不放这一条（不放假控件），判词里如实登记。
  ]
}
