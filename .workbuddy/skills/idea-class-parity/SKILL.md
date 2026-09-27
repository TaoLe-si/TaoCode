---
name: idea-class-parity
description: 把 IntelliJ IDEA 源码的类逐个对照移植进 TaoCode（Windows C++20 宿主 + WebView2 + Vue3）。当用户提到"源码有什么类就移植什么类""类级对照""补全 IDEA 功能""枚举 IDEA 类清单""TaoCode 移植"时使用。内含真实枚举脚本、机检口径、四档判决规则、六条验证口径，以及本项目踩过的 C++/构建坑。
agent_created: true
---

# IDEA → TaoCode 类级对移植

## 何时用

用户要求"严格对照 IDEA 源码""源码有什么类就移植什么类""一次性列出全部 TODO 并实现"。
基准源码根固定为：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`

## 核心原则（违反任何一条都等于交假活）

1. **清单必须机械枚举**，不许凭记忆写类名。每个类都要能指回真实文件路径。
2. **「未出现」才是缺口**。名字出现过 ≠ 已移植（很多命中只是文档里的"判定不做"记录）。
3. **`[-]` 不适用必须附源码路径 + 行号理由**，禁止只写"不适用"三个字。
4. **不要用整体代替分层**：`AbstractProjectViewPSIPane` 依赖 PSI，不等于"项目视图域"整体不适用。
   要拆成「数据结构/行为层」（可移植）与「PSI 绑定层」（不适用）。
5. **不要造第二张脸**：同一动作若已有唯一入口，再放一份就是重复，判 `[-]` 并说明。
6. **动手前先查并发写入者**（本项目踩过，构建直接被搞挂）：
   ```
   git status --short
   find src native tests -newermt '-30 minutes' -type f
   ```

## 标准流程

### 第 1 步 · 枚举（真实、可重跑）

把域目录列进一个 dict，遍历出全部 `.java/.kt`，每个域写一份 `docs/inventory/<域>.txt`（一行一个相对源码根的路径）。
参考已落地脚本 `scripts/parity_scan.py` 与 `docs/inventory/_summary.json` 的形状。

### 第 2 步 · 机检对照

`python scripts/parity_scan.py [域 ...]` —— 把每个类名拿去 TaoCode 全文做**标识符级**匹配
（扫描 `src native tests docs scripts`，跳过 `node_modules build dist .git third-party`）。
产出 `docs/inventory/<域>_scan.md`（逐类表格）与 `_scan.json`（汇总）。

### 第 3 步 · 判决（逐类，四档）

`[x]` 已移植（附 `文件:行号`）/ `[~]` 部分（写清缺什么）/ `[ ]` 未移植（TODO）/ `[-]` 不适用（附理由+行号）。

### 第 4 步 · 实现（每批一个闭环）

一批 = 一个包或一个组件的全部类。优先级 = 「用户能不能看见」× 「能不能独立验证」。

### 第 5 步 · 六条验证（缺一不可）

```bash
npx vue-tsc --noEmit -p tsconfig.json                        # exit 0 / 0 错误
npm test                                                      # fail 0
npx vite build --emptyOutDir false                            # exit 0 —— tsc 不报模板错误，只有 vite 报
python -c "import subprocess;subprocess.run(['cmd','/c',r'D:\TaoCode\scripts\build-native-locked.bat'])"   # RC 0 且 0 error/0 warning
cd build && ctest.exe --output-on-failure                     # 全绿
cd build && python -c "import subprocess;
try: subprocess.run(['./TaoCode.exe'], timeout=15)
except subprocess.TimeoutExpired: print('ALIVE')"             # 必须在 build/ 下跑
```

## 本项目的坑（都是真实踩过的）

| 坑 | 现象 | 解法 |
|---|---|---|
| 匿名 namespace 注入外层 | `native/projects.cpp` 里"前置声明在匿名 namespace、定义在 `taocode` 作用域" → **MSVC C2668 同名同签名重载歧义** | 用 `namespace { ... }` 把定义重开回同一个匿名 namespace |
| `vue-tsc` 不报模板错误 | `<section>` 未闭合只有 `vite build` 报 `Element is missing end tag` | `vite build` 必须跑 |
| 冒烟必须 `cd build` | 从仓库根跑 `./TaoCode.exe` 直接 `WinError 2`，会误判成崩溃 | 冒烟前 `cd build`；构建前先 `taskkill //IM TaoCode.exe //F` |
| 测试别读 `D:/Backup/...` | 会让 `npm test` 依赖本机绝对路径 | 用 `existsSync` 包住那一半断言（有则校验、无则跳过） |
| 源码级断言别假设相邻行 | 中间插注释后 `all === other + 1` 会失败 | 断言"夹在其间的行只能是注释/空行" |
| 临时 Json 上做 range-for | `f(x).at("k")` 的 range-for 迭代的是已析构对象（UB，表现为空） | 先 `const auto v = f(x).at("k");` 拷贝 |
| DOM 菜单按钮抢焦点 | 菜单一打开，"按当前焦点判断上下文"的动作全部置灰 | 补 `lastDockFocus` + `activeToolWindowFocus()` 一层"最近真实焦点" |
| **双键并存（本项目反复踩）** | 新增 IDEA 的 `GeneralSettings` 键时没先查 TaoCode 是否已有同义键 → 变成「新增装饰键 + 旧键继续被消费」 | **判定法**：拿到 IDEA 的语义 getter（`GeneralSettings.kt` 里的 `isXxx`，如 `isSyncOnFrameActivation`↔`state.autoSyncFiles`、`isDeletingToBin`↔`state.deleteToBin`、`isReopenLastProject`↔`state.reopenLastProject`），用 `grep -rn "\.isXxx\b"` 找真实消费者；然后看 TaoCode 是否已有等价键 —— **有则合并（删旧键），无则接通（加消费点），不允许双键并存** |
| **布尔链里删元素** | 按行删除 `key === 'a' \|\| key === 'b' \|\|` 中间一行 → 悬空 `\|\|` → `TS1109`；把一行当锚点替换时，若该行**行尾还有别的语法元素**（闭括号 `}`、分号、逗号），会一并被吃掉 → `TS1131`；用标题行当锚点时会把标题吃掉（同一个错误我在日志里犯了两次） | 替换前先看整行内容，**行尾的 `}` `;` `,` 必须显式写进 `new_string`**；替换后立刻 `vue-tsc` + 检查文档 `^### ` 标题数 |
| **改字段归属别只改记住的几处** | 把 `supportScreenReaders` 从 `EditorSettings` 搬到 `GeneralSettingsState` 时，漏了第三个消费者（状态栏 `NoticeList` 的 `:live`），是 tsc 之后全仓 grep 才发现的 | 字段搬家后按**字段名全仓 grep**（`grep -rn "<字段名>" src/ native/`），逐条确认消费者都改了；`grep "editor.<字段>"` 归零才算完 |
| 匿名 namespace 注入外层 | 见上 | 见上 |
| **装饰性设置自检** | 设置页渲染了控件、能存下来，但全程无人读取 | 查法：`grep "<状态变量>\.value\."` 统计读取点；只有赋值没有读取 = 装饰性 |
| **源码断言钉的是不变量，不是写法**（2026-09-27 踩） | 修 `menuUi.ts` 的窗口菜单顺序时，逻辑改对了，但 `tool-layout.test.mjs` / `help-menu.test.mjs` 各有一条 `assert.match(shellSource(), /windowRows\.splice\(afterSearch, 0, \.\.\.layoutMenuRows\.value\)/)` 断言**把旧实现原样钉死**，改写法就两条红 | 断言要指向**标识符或不变量**，不要指向语法。✗ 钉 `splice(afterSearch, 0, ...)` → ✓ 钉"布局组必须在窗口菜单最顶上"（`/\[\.\.\.layoutMenuRows\.value, \.\.\.windowMenuRows\]/`，附 `PlatformActions.xml:637-651` 出处）。**保留**那些钉住"别重新实现条件"的调用（`canHideAllToolWindows(currentChrome(), …)` 这类复用守卫有价值）；只改钉**语法形式**的。判据：把这段实现换成等价写法，测试还该绿吗？该红就说明钉错了 |
| **枚举脚本要能失败** | 上一版枚举把源码根写死成模块路径，基准源码升到 263.SNAPSHOT 后包搬家 → **静默跳过**，只记进 `_summary.json` 的 `missing_roots`，没人看 ⇒ 清单 5051 少算了 5349 类 | 凡是"声称已经全了"的脚本，**必须有非零退出码表示它不全**：`enumerate_inventory.py`（任一定义好的包零匹配 → exit 1）、`inventory_gaps.py`（有缺口 → exit 1）。另外域定义要收进 `_domains.json` 一处，可审计；**匹配按包路径后缀，不按模块路径** |

## 判断 IDEA 类归属的三条实用技巧

1. **默认布局/实现靠 `createXxx()` 找**：例如编辑器标签条默认用哪个布局，看 `JBTabsImpl.createRowLayout`（`JBTabsImpl.kt:766-772`），不要猜。
2. **常量先 grep `registry.properties`**：如 `ide.tabbedPane.dragToSplitRatio=0.2`、`ide.windowSystem.hScrollChars=5`；源码里往往是 `Registry.doubleValue(...)` 再钳位。
3. **接口先看返回类型再下判断**：`TabsListener.beforeSelectionChanged` 返回 `void` 是**通知**不是否决 —— 我曾按名字误判成"可否决"，被源码打脸。**任何"它应该能阻止…"的结论，必须先在源码里看到 `boolean` 返回或 `throw`。**
4. **判 `[-]` 前先查平台门控**：`GeneralSettings.isShowWelcomeScreen` 的唯一消费者里写死 `isMacSystemMenu && …`，而 `MacMenuSettings.java:13` 是 `OS.CURRENT == OS.macOS && …` ⇒ 该键在 Windows 上**连 IDEA 自己都不生效**。看到 `isMacSystemMenu` / `PlatformUtils.isMac` / `SystemInfo.isWindows` 这类门控，先确认当前平台会不会走进该分支，再决定是"未接通"还是"不适用"。
5. **`putUserData` 会翻转算法分支**：`TerminateRemoteProcessDialog.canDisconnect` 读的是 `ALWAYS_USE_DEFAULT_STOPPING_BEHAVIOUR_KEY`；终端把它置 true（`TerminalTabCloseListener.kt:87`）⇒ 终端 `canDisconnect=false` ⇒ 对话框只有「终止/取消」、`DISCONNECT` 设置会退化成 `TERMINATE`。**这类"标记型 user data"必须按 key 名全局 grep**，光看调用方会得出相反的结论。
6. **文案键名与语义可能不一致**：`SafeWriteRequestor` 的注释说的是"失败时不要覆盖原内容"，而文案键 `IdeBundle.properties:85` 是 `Back up files before saving` —— 机制是"先写临时文件再替换"，用户可见的说法就是"备份"。**别用自己的理解去改文案，先查 `*.properties` 的原句。**



## 当前进度（每批更新）

- 域枚举：7 域 5051 类（`docs/inventory/`），platform 全量 32352（`platform_rest.txt`）
- 机检：184 提及 / **4867 从未出现**
- 总控与执行顺序 B1..B12：`docs/class-parity-todo.md`
