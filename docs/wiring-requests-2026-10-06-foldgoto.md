# 接线请求 2026-10-06 · 代号 `foldgoto`

批次：`docs/batch-2026-10-06-foldgoto.md`。
本批只动了 `src/customFoldingRegions.ts` 与新增 `tests/custom-folding-regions.test.mjs`；
下面两条的落点都在保留文件（`src/components/CodeEditor.vue`）或别人的模块（`src/customFoldingPopup.ts`）里，
所以只写请求，不改。行号是 2026-10-06 实测（`wc -l src/components/CodeEditor.vue` = 1144，
登记上限 1147，见 `tests/module-size.test.mjs:135-136` ⇒ **净增不能超过 3 行**）。

## W-1 「跳到上/下一个自定义折叠区域」没有命令入口

现状：`nextCustomRegion` 只在弹层里用来决定初始高亮（`src/customFoldingPopup.ts:114`），
**没有任何键或命令能直接跳上/下一个区域**；用户必须先按 `Ctrl-Alt-.` 开列表再选。

上游依据（本地参考树逐行开过）：上游**只有**列表那一个动作 ——
`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:378` 只有 `GotoCustomRegion` 一条，
参考树全树 `grep CustomRegion` 里与"动作"相关的只有它（其余命中是 `CustomFoldingBuilder` 的
`ourCustomRegionElements` 与 `FoldingModelImpl` 的内部字段）⇒ **上/下一条是本仓自定的便利键，
不能挂上游动作名**，也不冒充上游键位。键选 `Ctrl-Alt-[` / `Ctrl-Alt-]`：
上游 `$default.xml` 里 `control alt BRACKETLEFT/BRACKETRIGHT` 零命中，本仓 `src/` 里
`Ctrl-Alt-[` 与 `Ctrl-Alt-]` 也零命中 ⇒ 不撞车。

先给控制器补一个方法（`src/customFoldingPopup.ts`，该文件不在体积登记的名单里）——
在 `show()` 之后、`const extension = [`（现 :140）之前插入：

```ts
  // old（:151，本行是返回值）
  return { extension, show, close }

  // new（新方法 + 返回值多一项）
  /** 跳到光标之后（`forward`）/ 之前第一个区域；没有区域返回 false（本仓自定，见 W-1）。 */
  function moveToNearest(forward: boolean) {
    const view = getView()
    if (!view) return false
    const regions = regionEntries(view.state.doc.toString())
    const target = nextCustomRegion(regions, view.state.doc.lineAt(view.state.selection.main.head).number - 1, forward)
    if (!target) return false
    navigate(target)
    return true
  }

  return { extension, show, close, moveToNearest }
```

宿主两行（`src/components/CodeEditor.vue`，插在现代码 `919` 与 `920` 的 `        ]),` 之间；
`915-919` 就是现有的 `Ctrl-Alt-.`）：

```ts
          // old（:915-920）
          { key: 'Ctrl-Alt-.', preventDefault: true, run: () => {
            if (customRegions.show()) return true
            showErrorHint('这个文件里没有自定义折叠区域')
            return true
          } },
        ]),

          // new（同样的五条 + 尾随两条，净增 2 行）
          { key: 'Ctrl-Alt-.', preventDefault: true, run: () => {
            if (customRegions.show()) return true
            showErrorHint(NO_CUSTOM_REGIONS_IN_FILE)
            return true
          } },
          // 上/下一个自定义折叠区域（本仓自定，上游只有列表动作 ⇒ 不叫 Goto* 的键位）。
          { key: 'Ctrl-Alt-]', preventDefault: true, run: () => customRegions.moveToNearest(true) },
          { key: 'Ctrl-Alt-[', preventDefault: true, run: () => customRegions.moveToNearest(false) },
        ]),
```

判据建议（宿主接线后补，纯函数那一半已由 `tests/custom-folding-regions.test.mjs` 覆盖）：
`moveToNearest` 走的是 `regionNavigateSpec` ⇒ 光标必须落在**开始标记那一行的行首**
（`CustomFoldingRegionsPopup.java:84` 的 `moveToOffset`），CRLF 文档同样（这条正是本批修的）。

## W-2 提示文案有两条，模块里那份才是带上游出处的

`src/components/CodeEditor.vue:917` 硬编码 `'这个文件里没有自定义折叠区域'`，
而 `src/customFoldingPopup.ts:29` 已经导出 `NO_CUSTOM_REGIONS_IN_FILE = '当前文件中没有自定义的折叠'`，
且没有任何消费方（`grep -rn NO_CUSTOM_REGIONS_IN_FILE src` 只命中定义那一行）⇒
同一个上游提示在仓里有两种文字，导出那份是死的。
上游英文原值已核实：`platform/platform-api/resources/messages/IdeBundle.properties:1066`
`goto.custom.region.message.unavailable=There are no custom foldings in the current file.`
（菜单项 `:1062`、命令名 `:1063`、笨模式 `:1064`、Light 模式 `:1065` 同文件）。
改法就是 W-1 代码块里那一行（`:82` 的 import 同一行加上这个导出即可，**净增 0 行**）：

```ts
// old（:82）
import { createCustomRegionsPopup } from '../customFoldingPopup'
// new
import { createCustomRegionsPopup, NO_CUSTOM_REGIONS_IN_FILE } from '../customFoldingPopup'
```

**无法核实**：`src/customFoldingPopup.ts:20-27` 把中文文案的出处写成
`plugins/localization-zh/lib/localization-zh.jar` —— 本地参考树里**没有这个插件**
（`ls plugins/` 无 `localization*`，`find . -iname "*localization*" -maxdepth 4` 零命中），
本机也没找到带该 jar 的 IDE 安装 ⇒ 那句中文到底是 jar 里的原值还是意译，本批判不了，
只登记「上游英文键与行号已核实、中文出处不可核」。要收紧就得同时动那个模块（不是本批的落点）。

## 处理结果（wiring-backlog lane，2026-10-06）

- 目标 `src/components/CodeEditor.vue`（禁改清单）。命令入口在编辑器侧。需 CodeEditor owner。

结论：零接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
