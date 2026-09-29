// 主菜单的**顶层档位**与**检查这一族的落点** —— 按 IDEA master 解析后的组结构钉住。
//
// 依据（都是本仓能直接读到的上游文件，不是记忆）：
//   · `tests/main/testData/actionSystem/groupStructure/actionGroupStructure.txt:2444-2456`
//     `[group MainMenu]` 的 12 个直接子项，按顺序：
//     FileMenu EditMenu ViewMenu GoToMenu CodeMenu RefactoringMenu BuildMenu RunMenu
//     ToolsMenu VcsGroups WindowMenu HelpMenu —— **没有 AnalyzeMenu**。
//   · `java/java-backend/resources/META-INF/JavaActions.xml:61-66`：`AnalyzeMenu` 是 `popup="true"` 的
//     **上下文菜单组**，只 `add-to-group` 到 `ProjectViewPopupMenu` 与 `NavbarPopupMenu`（锚在
//     `ReplaceInPath` 之后）；`:120-124` 的 `EditorPopupMenuAnalyze` 再挂到编辑器右键菜单。
//   · `platform/platform-impl/resources/idea/LangActions.xml:230-259`：主菜单里的检查入口是
//     `CodeMenu` 里的 `InspectCodeInCodeMenuGroup`，位置紧跟 `CodeCompletionGroup`。
//   · 文案：`group.AnalyzeMenu.text=Analy_ze`、`action.InspectCode.text=_Inspect Code…`、
//     `group.AnalyzeActionsPopup.text=Analyze Code`（`ActionsBundle.properties:794/799/1765`）；
//     RunInspection 显示名 `&Run Inspection by Name…`（`IdeBundle.properties:1041`），
//     快捷键 control shift alt I（`keymaps/$default.xml:276-278`），而 InspectCode **没有**默认快捷键。
//
// 曾经的样子：本仓把「分析」做成主菜单第 7 档，并把「查看当前文件问题」「待办事项」也塞进去 ——
// 前者上游根本没有这一档，后两条是工具窗口激活动作（本仓在「窗口」菜单与条纹按钮里已经有）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const app = read('src/App.vue')
const codeMenu = read('src/menus/codeMenu.ts')
const analyze = read('src/menus/analyzeMenu.ts')

/** App.vue 里 `const menus: … = [ … ]` 的顶层档位（id + 标签），按声明顺序。 */
function topLevelMenus() {
  const block = /const menus: \{[^}]*\}\[\] = \[([\s\S]*?)\n\]/.exec(app)
  assert.ok(block, '找不到主菜单数组 `const menus`')
  return [...block[1].matchAll(/\{ menu: '([a-z]+)' as const, label: '([^']+)'/g)]
    .map(([, id, label]) => ({ id, label }))
}

test('主菜单只有上游那 12 档，顺序一致，且没有「分析」', () => {
  // 静态数组给 10 档，工具/窗口两档由 `menuUi.ts` 的 `allMenuGroups` 在 Git 前后插入
  // （工具组是静态行、窗口组要拼进动态的命名布局行，所以不能写死在静态数组里）。
  assert.deepEqual(topLevelMenus(), [
    { id: 'file', label: '文件' },
    { id: 'edit', label: '编辑' },
    { id: 'view', label: '视图' },
    { id: 'navigate', label: '导航' },
    { id: 'code', label: '代码' },
    { id: 'refactor', label: '重构' },
    { id: 'build', label: '构建' },
    { id: 'run', label: '运行' },
    { id: 'git', label: 'Git' },
    { id: 'help', label: '帮助' },
  ])
  const ui = read('src/menuUi.ts')
  const atTools = ui.indexOf('next.splice(at, 0, toolsGroup)')
  const atWindow = ui.indexOf('next.splice(at + (pluginRows.length ? 3 : 2), 0, windowGroup)')
  assert.ok(atTools > 0 && atWindow > atTools,
    '装配顺序必须是 …Run, Tools, [Plugins], Git, Window, Help（`actionGroupStructure.txt` 的 MainMenu 段）')
  // 顶层档位的联合类型里不许再有 'analyze'（`'analyze'` 作为**树右键子菜单**的键是允许的，
  // 那正是上游 AnalyzeMenu 待的地方）。
  const union = /const menu = ref<([^>]*)>\(null\)/.exec(app)
  assert.ok(union, '找不到主菜单开关的类型')
  assert.ok(!union[1].includes("'analyze'"), '主菜单档位里又出现了 analyze')
  assert.deepEqual(union[1].match(/'[a-z]+'/g).length, 12, '顶层档位必须是 12 档')
})

test('检查这一族在代码菜单里，位置紧跟补全组', () => {
  const rows = codeMenu.split('\n')
  const atCompletion = rows.findIndex(line => line.includes("'completion', '代码补全'"))
  const atInspect = rows.findIndex(line => line.includes('createInspectCodeInCodeMenuRows(ctx)'))
  const atTemplate = rows.findIndex(line => line.includes("'template.expand'"))
  assert.ok(atCompletion > 0 && atInspect > atCompletion && atTemplate > atInspect,
    '上游 CodeMenu 顺序是 CodeCompletionGroup → InspectCodeInCodeMenuGroup → InsertLiveTemplate')
})

test('两条动作的文案与快捷键照上游，缺实现的那几条不放', () => {
  // 只看**行标题**：文件头的注释本来就要写出"哪几条没放、为什么"。
  const titles = [...analyze.matchAll(/title: '([^']+)'/g)].map(match => match[1])
  assert.deepEqual(titles, ['检查代码…', '按名称运行检查…', 'Analyze Code'])
  assert.match(analyze, /title: '按名称运行检查…', keys: 'Ctrl Shift Alt I'/,
    'RunInspection = IdeBundle:1041 + keymaps/$default.xml:276-278')
  assert.match(analyze, /title: 'Analyze Code'/, 'group.AnalyzeActionsPopup.text（ActionsBundle:1765）')
  // InspectCode 在 $default.xml 里没有默认快捷键 —— 给它编一个就是假键位。
  assert.doesNotMatch(analyze, /检查代码…', keys:/, 'InspectCode… 不该有快捷键')
  for (const missing of ['代码清理', '静默清理', '配置当前文件分析', '离线检查', '堆栈']) {
    assert.ok(!titles.some(title => title.includes(missing)),
      `${missing} 本仓没有实现，不该出现在菜单里（宁缺勿假）`)
  }
})

test('工具窗口的两条不再有重复入口', () => {
  // 「问题」在窗口菜单与状态栏 chip 里，「待办事项」在工具菜单与条纹按钮里 —— 分析档里那两行是第三份。
  assert.doesNotMatch(analyze, /problemsView|todoTree/, '又加回了一份重复的工具窗口入口')
  assert.match(read('src/menus/windowMenu.ts'), /window\.activateProblems/, '问题窗口的正式入口在「窗口」菜单')
  assert.match(read('src/menus/toolsMenu.ts'), /tools\.taskList/, '待办事项的正式入口在「工具」菜单')
})

test('分析子菜单挂在树右键菜单的 ReplaceInPath 之后（上游锚点）', () => {
  // `JavaActions.xml:61-66` 的锚点是 `relative-to-action="ReplaceInPath"` —— 位置本身就是契约。
  const replaceAt = app.indexOf('在路径中替换…（Replace in Path）')
  const analyzeAt = app.indexOf("treeSubmenu === 'analyze' ? null : 'analyze'")
  assert.ok(replaceAt > 0 && analyzeAt > replaceAt, '「分析」必须紧跟在「在路径中替换…」后面')
  assert.match(app, /v-for="row in analyzeMenuRows"/, '子菜单要渲染同一批行工厂，不是再抄一遍按钮')
  assert.match(app, /const analyzeMenuRows = createAnalyzeMenuRows\(codeMenuContext\)/,
    '树菜单与代码菜单共用同一个 ctx 与同一批行 —— 出现第二份就会各自漂移')
})
