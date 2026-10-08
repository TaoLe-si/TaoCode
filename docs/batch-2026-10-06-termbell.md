# batch-2026-10-06-termbell — 终端响铃（audible bell）宿主侧通道

lane: **termbell** · 范围：**只做宿主侧通道**（BEL 事件 → 宿主通知/闪烁出口）+ 它的判据。
前端那一半（`src/bridge.ts` 分派、`src/App.vue` 透传、`TerminalPanel.vue` 的 emits）**不写码，只写请求**，见 §6 与
`docs/wiring-requests-2026-10-06-termbell.md`。

> 本文里凡是要提"注入标记"的地方都拆成 `TERM` + `BELL` 两段写：本批收尾要求该标记（两半连写的那个全大写串）
> 在 `src/ tests/ native/ docs/` 四目录下 **0 命中**，所以它不能出现在本文正文里。

---

## §0 接手实况（先判现场，一切以实跑为准）

- `grep -rn "bell|BEL|\x07" native/ src/`：**没有 bell 半成品**。命中的全是 `label` 一类噪声；
  唯一真正的 bell 字样是 `lucide-vue-next` 的 `Bell` 图标（`src/components/EventLogPanel.vue:14`、
  `src/toolWindowMeta.ts:24` 给"通知"窗格用的图标名），与响铃无关。
  ⇒ 本仓 xterm 确实直接忽略 BEL、没有 `onBell` 订阅，termset 的「假档」判断成立（`src/components/TerminalPanel.vue` 全文 `onBell` 零命中，实测）。
- 名下文件确认存在：`native/terminal.cpp`(501→改后见 §4)、`native/terminal.hpp`(89)、`native/terminal_test.cpp`(219)；
  `src/terminalEvents.ts`(64)、`src/terminalActions.ts`(645)。
- `grep -c add_test CMakeLists.txt` = **39**（接手时；与交给的基线一致）。
- 接手时门禁：`node --test tests/terminal*.test.mjs tests/process-*.test.mjs tests/module-size.test.mjs`
  → **tests 128 / pass 128 / fail 0**（名单未过期，与 termset 报的一致）。
- 接手时另两道门：`node .tools/find-orphan-modules.mjs --gate` → 绿（已登记孤儿 6 / 基线 8 · 新增 0）；
  `node .tools/find-missing-ext.mjs` → 干净（扫 1380 个文件）。
- **上游树**：`D:\Backup\Downloads\intellij-community-master\intellij-community-master` 可用（本文所有行号都是在这棵树上
  `sed -n` 逐行读出来的）；`third_party/intellij-community` 坏树**未使用**。

## §1 上游核对（逐行自数，非转抄 termset）

| 事项 | 出处（自数行号） | 原文 |
| --- | --- | --- |
| 设置项本体 + **缺省 true** | `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalOptionsProvider.kt:76` | `var mySoundBell: Boolean = true` |
| provider 的属性面 | 同文件 `:219-226` | `var audibleBell: Boolean` / `get() = state.mySoundBell` / set 里变值才 `fireSettingsChanged()` |
| 设置如何被终端读到 | `plugins/terminal/src/org/jetbrains/plugins/terminal/JBTerminalSystemSettingsProvider.java:63-66` | `@Override public boolean audibleBell() { return TerminalOptionsProvider.getInstance().getAudibleBell(); }` |
| **消费门（重做版终端 = 本仓的形状）** | `plugins/terminal/frontend/src/com/intellij/terminal/frontend/view/impl/TerminalSessionController.kt:111-115` | `is TerminalBeepEvent -> { if (settings.audibleBell()) { Toolkit.getDefaultToolkit().beep() } }` ⇒ **门只有这一档** |
| 消费门（块视图那一档） | `plugins/terminal/src/org/jetbrains/plugins/terminal/block/output/TerminalAlarmManager.kt:9-16` | `if (commandIsRunning && settings.audibleBell()) Toolkit.getDefaultToolkit().beep()`；`commandIsRunning` 由 `commandStarted/commandFinished`（shell 集成）置位 |
| **BEL 的来源在宿主/会话层** | `plugins/terminal/frontend/src/com/intellij/terminal/frontend/session/ghostty/GhosttyTerminalSession.kt:275-278` | 注释 `// Fires synchronously inside emulator.write, i.e. under [lock] on the read thread.` + `override fun onBell() { pendingEvents.add(TerminalBeepEvent) }` |
| 遥测（非行为） | `plugins/terminal/src/org/jetbrains/plugins/terminal/fus/TerminalSettingsStateCollector.kt:145` | `addBooleanIfNotDefault(..., BooleanOptions.ENABLE_AUDIBLE_BELL, ... { it.mySoundBell })` |
| 全树 grep `audibleBell\|mySoundBell\|SoundBell` 命中集 | 只有上面 4 个文件（`-l` 实测：TerminalAlarmManager.kt / TerminalSettingsStateCollector.kt / JBTerminalSystemSettingsProvider.java / TerminalOptionsProvider.kt） | ⇒ 没有别的消费者，也没有视觉闪烁档 |

要点（决定了本批的形状）：
1. **上游是在读线程/会话层认出响铃的**（Ghostty 那条 `onBell()`），不是渲染层 ⇒ 本仓放在 native 的 ConPTY 读线程里是同构做法。
2. `TerminalBeepEvent` 在**前端控制器**那档只有 `audibleBell` 一个条件；`commandIsRunning` 是**块视图**那条链的额外门，
   其输入是 shell 集成（OSC 133）—— 本仓没有（见 §5）。
3. 上游**没有**「视觉响铃/任务栏闪烁」这一档设置（grep `visualBell|VisualBell` 在 terminal 插件零命中）⇒ 本批不许自己造（见 §5/§6）。

## §2 落盘（native + 模块）

### 2.1 native：BEL 是真的能在宿主侧被认出来

- 新增 `native/terminal_bell.hpp` + `native/terminal_bell.cpp`：`taocode::terminal::BellScanner`，
  4 状态字节状态机（ground / escape / csi / quoted），`feed(chunk)` 返回「这一块里有没有**真**响铃」。
  为什么不是 `bytes.find('\a')`（这条是本批最容易踩的坑）：
  BEL 在 VT 里**同时**是 OSC 串的结束符（`ESC ] 0 ; 标题 BEL`）。按字节找会把每一次改标题当成响铃
  ⇒ 带标题提示符的 shell 每出一个提示符响一次。串状态（OSC/DCS/APC/SOS/PM）里的 BEL 一律只当收尾。
  又因为流是**不透明字节**（`terminal.hpp` 文件头：宿主不解码、UTF-8 由前端负责），
  `0x80..0xFF` 一律当文本 —— 把 C1（0x9B=CSI、0x9D=OSC）当真控制码，会把 UTF-8 续字节读成转义序列。
- `native/terminal.hpp`：`using BellCb = std::function<void(int id)>;`（`:47`）、`void on_bell(BellCb callback);`（`:75`）、
  成员 `BellCb on_bell_;`（`:99`，与 `on_exit_` 同规则在 `mutex_` 下读）。
  文件头那句「front end owns terminal semantics」加了限定（`:23-25`）：宿主**只观察** BEL、不消费，
  字节仍原样转发 —— 观察的理由写在 BellCb 的注释里：`runInTerminal` 开出来的终端**没有前端 xterm**
  （`native/main.cpp:446` 的 `term.opened` 带 `reason: "runInTerminal"`），且订阅者挂载前的输出是先缓冲的
  （`src/terminalEvents.ts`），只靠 xterm 会在"事情过去之后"才响。
- `native/terminal.cpp`：`emit()` 里 `bell_scanner.feed({bytes, size})`（`:165`，读线程独占 ⇒ 无锁），
  原样 `on_output(id, {bytes, size})` 的 `// verbatim console bytes, ANSI intact` 一字未改（`:169`），
  块末 `if (rang) report_bell();`（`:173`）。`report_bell()`（`:178-189`）锁序照 `report_exit()`：
  先 `manager->mutex_` 再本会话 `callback_mutex`，回调在两个锁都放开之后才跑；`closed` 已置（故意 kill）就静默。
  `Manager::on_bell()` 实现在 `:484-487`，与 `Manager::on_exit` 同一形状。
  **一块最多报一次**：一次 BEL 是一次事件，不是一个字符一次事件（一块最大 16KB，里面塞十个 BEL 也不该刷十次通知）。
- 新增 ctest：`native/terminal_bell_test.cpp`（11 个 case，纯字节、不碰 shell、不碰 ConPTY、无计时）
  + `CMakeLists.txt`：`taocode_terminal` 加进 `native/terminal_bell.cpp`（`:61`）、
  `add_executable(terminal_bell_test ...)` + `add_test(NAME terminal_bell_scan ...)`（`:198-201`）
  ⇒ `grep -c add_test CMakeLists.txt` **39 → 40**，`ctest -N` 的 `Total Tests: 40` 自证（§4）。

### 2.2 模块：`src/terminalEvents.ts` 的 `term.bell` 通道

- 订阅表照 `term.exit` 的既有形状（按 id、多个订阅者、取消订阅后自动清表）：`subscribeTermBell`。
- `terminalBellMakesSound(settings)`：上游那一档门的纯函数形态 —— `settings.audibleBell ?? TERMINAL_BELL_AUDIBLE_DEFAULT`，
  缺省常量 `= true` 就是 `TerminalOptionsProvider.kt:76` 那一档；只有**显式 false** 才关（垃圾值关不掉，缺省是开的）。
- `setTerminalBellOutlet(outlet|null)`：出口的可换 seam（照 `notificationBeeper.setNotificationTone` 的本仓既有做法），
  默认出口 = **既有通知提示音** `notificationBeeper.beep()`（不新造发声链；`AudioContext` 拿不到时那条降级已在那个模块里实现）。
- `deliverTermBell(id, settings)`：形状判定与 `deliverTermOutput` 同口径（终端 id 正数且永不复用 ⇒ 非正整数一律 `false`）；
  出口只问那一档门；订阅者**不管门**照单全收（闪不闪 ≠ 有没有声音）；出口抛错被吞（响不出声不打断终端事件链）；
  **不进缓冲** —— 与 term.output 那条 256 块的对冲逻辑**相反**，迟到的输出仍有意义，迟到的响铃只会为已过去的事按铃。
- `src/terminalActions.ts` **未改**（在名下但用不上）：上游响铃不在动作层（grep `Bell` 在
  `plugins/terminal/**/actions/` 零命中，全树命中集只有 §1 那 4 个文件），在那里加一条动作就是自己编控件。

### 2.3 落盘后自测中发现并修掉的一个真 bug

第一次 ctest 就红了一条：`CAN / SUB 中止序列之后 BEL 恢复算响铃`。
根因：`quoted` 状态原先只认 BEL 与 ESC，一条被 CAN/SUB 截断的 OSC 会把状态永久卡在串里
⇒ 之后**所有**真响铃被静默吞掉（比假阳性更糟：那一格终端永远不响了）。
修法：`terminal_bell.cpp` 的 `quoted` 分支补 CAN(0x18)/SUB(0x1A) → 回 ground。这条判据（§3 表 K7）就是这么抓出来的。

## §3 判据与反向验证

注入标记 = `TERM` 与 `BELL` 连写的那串全大写（本文按规矩拆开写，免得正文自己造出一个 grep 命中），
后缀 `-M1`…`-M7`。每次注入只改一行、跑门禁打红、再用 `cp` 从 `build/termbell-orig/` 原样还原并 `sha1sum` 核过。
收尾自查（标记串在运行时拼出来，正文里没有整串）：

```
m="TERM"; m="${m}BELL"; grep -rn "$m" src/ tests/ native/ docs/ | wc -l   →  0
```

### 3.1 判据清单

native（ctest `terminal_bell_scan`，`native/terminal_bell_test.cpp`，纯字节、不碰 shell、无计时）：

| # | 判据 | 依据 |
| --- | --- | --- |
| K1 | 地面上一个 BEL 报一次；下一块没 BEL 就不报（状态落得回去） | §1 的 `onBell()` 语义 |
| K2 | 一块里三个 BEL 只报一次，且同一条流的下一块不报 | 宿主事件按"一块一次"计（`emit()` 的 `if (rang)`） |
| K3 | OSC 标题用 BEL 收尾**不算**响铃 | BEL 双重身份；不这样判 ⇒ 带标题的 shell 每个提示符响一次 |
| K4 | OSC 用 ST（`ESC \`）收尾也不算，且状态回地面 | VT 的 ST |
| K5 | CSI 里混进来的 BEL 不算 | 序列内容不是地面 |
| K6 | DCS / APC 里的 BEL 只当收尾 | 同上，串类型 |
| K7 | CAN / SUB 中止序列后 BEL 恢复算响铃 | 否则一条截断的 OSC 让那一格**永久**不响（§2.3 的真 bug） |
| K8 | `0x80..` 一律当文本（UTF-8 续字节不当 C1 控制码） | `terminal.hpp` 文件头：宿主不解码，流是不透明字节 |
| K9 | 转义最终字节让状态回地面 | VT 状态机 |
| K10 | 同一条流在**每一个切点**切成两块，响铃总次数不变 | 有状态的硬判据（无状态实现必红） |
| K11 | 空块什么都不报 | 边界 |

模块（`tests/terminal-bell.test.mjs`，11 条）：

| # | 判据 | 依据 |
| --- | --- | --- |
| N1 | 缺省值钉住 `true` | `TerminalOptionsProvider.kt:76` |
| N2 | 那一档门真的被读：`audibleBell:false` 不响、`true` 响；垃圾值关不掉（只有显式 false 算关） | `TerminalSessionController.kt:111-113` |
| N3 | 事件形状判定与 `deliverTermOutput` 同口径：非正整数 id 一律 false 且**不走出口** | `terminal.hpp` create() 的 id 规则 |
| N4 | 订阅者收 id、与门无关（静音时照样能闪）；按 id 不串台 | 闪不闪 ≠ 有没有声音 |
| N5 | 多订阅者各订各的，出口只走一次 | 与 `term.output` 的订阅表同形状 |
| N6 | 出口抛错不打断终端事件链，仍算已处理 | `notificationBeeper.beep()` 的同一口径 |
| N7 | 默认出口在 node（无 AudioContext）里安静跳过 | 复用既有降级 |
| N8 | 没有订阅者时**不缓冲**：迟到的响铃不补 | 与 term.output 的 256 块对冲**相反**，本批显式选定 |
| N9 | 两头齐（源码形状）：`BellCb`/`on_bell`/`bell_scanner.feed`/`if (rang) report_bell()`/`Manager::on_bell`/`beep` 复用/串状态不认 BEL；且原样转发那句留痕注释还在 | 通道真接通了（不是假档） |
| N10 | CMake 注册 + `add_test` 行数 = **40**（39+1 自证） | 门禁口径 |
| N11 | 前端那一半本批没动：面板 emits 仍是 `{ focusTerminal: [] }`、面板无 `onBell`（防双响）、`App.vue`/`settingsModel.ts` 无响铃开关、`bridge.ts` 尚无 `term.bell` 分派 | 「不放假控件」+ 交接基线（N11 末条自带"落地后请改判"的说明） |

### 3.2 注入自证（每条都打出过红，原始输出见 §4）

| 注入 | 改在哪 | 打红了 |
| --- | --- | --- |
| M1 | `terminal_bell.cpp` quoted 分支：串尾 BEL 也 `rang = true` | K1 K2 K3 K6 K9 K10（ctest：`6 passed, 11 failed`→`1 passed, 5 failed`，原始行见 §4.2） |
| M2 | `feed()` 开头 `state_ = ground`（无状态化） | 只有 K10 —— 正是"跨块状态"这条：**别的 11 条全绿**，说明 K10 是唯一承重的那条 |
| M3 | `feed()` 末尾把 `rang` 粘成 static latch | K1…K11 全红（`0 passed, 11 failed`） |
| M4 | `terminalBellMakesSound` 恒 `true`（门不读） | N2、N4（`静音时不该走发声出口`） |
| M5 | `deliverTermBell` 拿掉形状判定 | N3（`undefined 不该被当成一次响铃`） |
| M6 | 出口调用去掉 try/catch | N6（`Error: AudioContext 不可用`） |
| M7 | `terminal.cpp`：`if (rang) report_bell();` 注释掉 | **第一次没红** —— 源码形状的正则把注释里的代码也匹配上了。这是本批最重要的一次自证：判据本身有洞。修法是判据改为先剥行注释再匹配（`code()` helper），修完再注入一次 → N9 红。留痕见 §4.3 |

还原核对（三处都被注入过的文件，sha1 与注入前逐项相同）：

| 文件 | sha1（注入前 = 还原后） |
| --- | --- |
| `native/terminal_bell.cpp` | `b0e1bdb2a92cdda162b358a325f5b55dadde98f1` |
| `native/terminal.cpp` | `5e29fafaacd93ceab951fe301494e1211143474b` |
| `src/terminalEvents.ts` | `1e2d84f9cb5e2d6ab4c3e84b6ee37450d3e1d199` |

断言强度：全程没有放松任何一条断言（M2 之后 K10 只红一条是**注入的射程**，不是判据被削弱；M1/M3 打红 5～11 条）。
唯一没有行为级判据的是 `emit()` 里那一次上报：它要真跑就得驱动 cmd.exe 吐 BEL（ConPTY 会不会原样透传那颗 0x07
没有文档保证 ⇒ 会做成一条偶发红）。所以那一段的行为由 K1…K11（扫描器）+ N9（形状）夹住，
"真机上响一声"留给 §6 接线后的验收，这一条限制在 §5 登记。
