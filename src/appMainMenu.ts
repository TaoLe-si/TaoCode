// 主菜单的顶层档位表 —— App.vue 的 `const menus: {…}[] = [ … ]`（原 1615-1635 行）
// 2026-10-06 逐字搬入本文件：档位的**顺序、标签与 `rows:` 后面引用的名字**都保持原样，
// 因为按字面量钉住档位的断言（`tests/help-menu.test.mjs` 的「帮助」行、
// `tests/main-menu-parity.test.mjs` 的 `topLevelMenus()`）只改了读取的文件，断言体一个字没动。
//
// 为什么能搬：这张表只做「把各域已经造好的行按上游 MainMenu 的顺序与文案排成档位」——
// `(各档的行) => 档位数组`，不读 ref、不碰 DOM、不发宿主请求，装配根里只留一行调用。
//
// 上游坐标（随注释一起搬，未改）：
//   · 档位顺序 = `actionGroupStructure.txt:2444-2456` 的 `[group MainMenu]` 十二档；「分析」不在主菜单里。
//   · 工具/窗口两档不在这张静态表里：由 `src/menuUi.ts` 的 `allMenuGroups` 在 Git 前后插入。
import type { MenuRow } from './menus/types.ts'

/** 主菜单的档位键 = App.vue 里 `menu` 开关的联合类型（`'analyze'` 只是树右键子菜单的键，不在这一族）。 */
export type MainMenuId = 'file' | 'edit' | 'view' | 'navigate' | 'code' | 'refactor' | 'build' | 'run' | 'tools' | 'git' | 'help'

/** 一档一个键：值就是该域的行（`createXxxMenuRows` 的产物，名字沿用装配根里的变量名）。 */
export type MainMenuRows = {
  fileMenuRows: MenuRow[]
  editMenuRows: MenuRow[]
  viewMenuRows: MenuRow[]
  navigateMenuRows: MenuRow[]
  codeMenuRows: MenuRow[]
  refactorMenuRows: MenuRow[]
  buildMenuRows: MenuRow[]
  runMenuRows: MenuRow[]
  gitMenuRows: MenuRow[]
  helpMenuRows: MenuRow[]
}

/** 一个档位：键、标签与行。 */
export type MainMenuGroup = { menu: MainMenuId; label: string; rows: MenuRow[] }

/**
 * 装配顶层档位。下面 `const menus` 的形态与**列 0 的闭合方括号**保持成原样是有原因的：
 * `tests/main-menu-parity.test.mjs` 的 `topLevelMenus()` 按
 * `/const menus: \{[^}]*\}\[\] = \[([\s\S]*?)\n\]/` 切片读档位，改成缩进写法会把那条
 * 已核过的断言判成「找不到主菜单数组」——这里钉的是行为，所以写法一并保住。
 */
export function createMainMenuGroups({
  fileMenuRows, editMenuRows, viewMenuRows, navigateMenuRows, codeMenuRows,
  refactorMenuRows, buildMenuRows, runMenuRows, gitMenuRows, helpMenuRows,
}: MainMenuRows): MainMenuGroup[] {
const menus: { menu: MainMenuId; label: string; rows: MenuRow[] }[] = [
  { menu: 'file' as const, label: '文件', rows: fileMenuRows },
  { menu: 'edit' as const, label: '编辑', rows: editMenuRows },
  { menu: 'view' as const, label: '视图', rows: viewMenuRows },
  { menu: 'navigate' as const, label: '导航', rows: navigateMenuRows },
  { menu: 'code' as const, label: '代码', rows: codeMenuRows },
  { menu: 'refactor' as const, label: '重构', rows: refactorMenuRows },
  // IDEA's Build menu (JavaActions.xml "Java.BuildMenu"): Build Project (CompileDirty,
  // Ctrl+F9), Rebuild (Compile, Ctrl+Shift+F9 — bound here to a full clean rebuild),
  // plus Stop Build. TaoCode builds through the configured shell command.
  { menu: 'build' as const, label: '构建', rows: buildMenuRows },
  { menu: 'run' as const, label: '运行', rows: runMenuRows },
  // IDEA's Git.MainMenu order (intellij.vcs.git.backend.xml): Commit, Push, Update
  // Project, Pull, Fetch | Merge, Rebase, Resolve Conflicts | Branches, New Branch,
  // Tag, Reset | Show Log | Stash/Shelf. Rows without a git4idea-equivalent backend
  // here (Fetch, Rebase, Tag dialog, Reset) are omitted rather than faked.
  { menu: 'git' as const, label: 'Git', rows: gitMenuRows },
  // IDEA 主菜单以「帮助」收尾（PlatformActions.xml:746 的 HelpMenu）。menuUi 会把「窗口」插到
  // Git 与帮助之间，得到 Git → Window → Help 的源码顺序。
  { menu: 'help' as const, label: '帮助', rows: helpMenuRows },
]
return menus
}
