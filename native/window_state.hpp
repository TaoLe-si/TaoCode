// 窗口态（全屏）—— IDEA 的 `ToggleFullScreenAction` 需要的**宿主能力**。
//
// 依据（已核实）：
//   · 动作 `platform/platform-impl/src/com/intellij/ide/actions/ToggleFullScreenAction.java`
//     —— `:21` `actionPerformed` 切全屏；`:33` 用 `WindowManager.isFullScreenSupportedInCurrentOS()`
//     决定动作是否可用；`:56` 通过 `WindowManagerEx.findFrameHelper(project)` 找窗口。
//   · 动作 id `ToggleFullScreen`，菜单位置 `View → Appearance → ToggleFullScreenGroup`
//     （`platform/platform-impl/resources/idea/PlatformActions.xml:524-528`，与 `ToggleDistractionFreeMode`
//      和 `ToggleZenMode` 并列 —— 它们是**三个独立开关**，不是同一个功能的别名）。
//
// TaoCode 没有"窗口管理器"这一层，直接在 Win32 窗口上做。全屏的语义：
//   · 进入：去掉窗口装饰（`WS_CAPTION`/`WS_THICKFRAME` 等），把窗口铺满**整个显示器**
//     （`rcMonitor` 而不是 `rcWork` —— 后者会把任务栏留在上面，那不是全屏）；
//   · 退出：**恢复**进入前的样式与位置。不恢复的话用户退出全屏就丢了窗口大小/位置。
//
// 窗口句柄由主循环在创建窗口后注册（`register_window`）—— 这样本模块不需要 include
// 主程序的任何东西，主程序也只需要两行（注册 + 消息路由）。

#pragma once

#include "lsp.hpp"

namespace taocode {

/** 主循环创建窗口后调用一次。重复调用会重置全屏状态（等于换了个窗口）。 */
void register_window(void* window);

/**
 * 切到/退出全屏。
 * Reply: `{fullScreen: bool, changed: bool}`；没有注册窗口（例如在无窗口的测试进程里）时抛
 * `NO_WINDOW` —— 不静默返回一个假的成功。
 */
Json set_full_screen(bool full_screen);

/** 当前是否全屏。Reply: `{fullScreen: bool}`。 */
Json full_screen_state();

}  // namespace taocode
