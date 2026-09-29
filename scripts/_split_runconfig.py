# 一次性脚本：把 App.vue 的「运行/调试配置」域搬到 src/runConfigurations.ts
# 三段不连续区间：R1 = runConfigs..runConfigsOpen，R2 = runConfigDraft..openRunConfigurations，
# R3 = removeRunConfigFromDialog..removeConfig。中间夹着 Git 分支弹窗与「项目结构」对话框，原地留下。
# 安全规程见 skill: scripted-refactor-safety —— 锚点必须唯一，数量断言失败即中止。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\runConfigurations.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

R1 = ('const runConfigs = computed<RunConfig[]>(() => projectSettings.value.runConfigs)',
      "const runConfigsOpen = ref(false)")
R2 = ('const runConfigDraft = computed<RunConfig>(() => ({',
      "function openRunConfigurations() { runConfigsOpen.value = true; menu.value = null }")
R3 = ('async function removeRunConfigFromDialog(name: string) {',
      'function removeConfig() {')

for a, b in (R1, R2, R3):
    assert text.count(a) == 1, ('anchor not unique', a, text.count(a))
    assert text.count(b) == 1, ('anchor not unique', b, text.count(b))

idx = lambda s: next(i for i, l in enumerate(lines) if l.startswith(s) or s in l)
a1, b1 = idx(R1[0]), idx(R1[1])
a2, b2 = idx(R2[0]), idx(R2[1])
a3, b3 = idx(R3[0]), idx(R3[1])
assert a1 < b1 < a2 < b2 < a3, (a1, b1, a2, b2, a3)
assert (a1, b1, a2, b2, a3, b3) == (2456, 2550, 2554, 2589, 2653, 2671), ('unexpected anchors', a1 + 1, b1 + 1, a2 + 1, b2 + 1, a3 + 1, b3 + 1)

# R3 的结束要包到 removeConfig 的函数体结束（下一个顶层声明之前）
r3_end = next(i for i in range(b3, len(lines)) if lines[i] == '}')
assert lines[r3_end - 1].strip() == "void persistRunConfigs(runConfigs.value.filter(config => config.name !== name), `已删除运行配置「${name}」`)", lines[r3_end - 1]
r3 = lines[a3:r3_end + 1]
r3 = r3[:]
r3[-1] = '}'

blockR1 = lines[a1:b1 + 1]
blockR2 = lines[a2:b2 + 1]
blockR3 = lines[a3:r3_end + 1]
assert len(blockR1) == 95 and len(blockR2) == 36 and len(blockR3) == 22, (len(blockR1), len(blockR2), len(blockR3))
assert blockR3[-1] == '}'

ASSEMBLY = '''// 运行/调试配置是一个域（IDEA 的 RunManager + RunConfigurationsDialog，含草稿编辑表单）。
const {
  runConfigs, runConfigName, runWidgetTitle, configChooser, configIndex, openConfigChooser, moveConfig,
  applyConfigChoice, runConfigType, runConfigProgram, runConfigDebugAdapter, runConfigArgs, runConfigCwd,
  runConfigEnv, runConfigBefore, runConfigFolder, runConfigEditorOpen, runConfigDebug, runConfigsOpen,
  runConfigDraft, loadRunConfigDraft, saveRunConfigFromDialog, openRunConfigurations,
  linesToArray, arrayToLines, currentRunConfig, selectRunConfig, pickConfig, persistRunConfigs,
  addBeforeLaunchStep, removeBeforeLaunchStep, removeRunConfigFromDialog, saveConfig, removeConfig,
} = createRunConfigurations({
  notify, workspace, projectSettings, runCommand, menu,
  // 惰性：`runSelectedConfig` 由运行动作模块提供（装配在本块之后）。
  runSelectedConfig: (...a) => runSelectedConfig(...a),
})'''

HEADER = '''// 运行 / 调试配置 —— 从 App.vue 搬出的一域（153 行，6 个依赖）。
//
// 判据：IDEA 的 `RunManager` 把「配置是什么」（类型/程序/参数/工作目录/环境/启动前步骤/文件夹）
// 和「配置怎么被挑出来并落盘」（选择、草稿、保存、删除、Alt+Shift+F10 选择弹窗）放在同一个
// `RunConfigurationsDialog` 里；两半共享同一批草稿 ref（`runConfigProgram` / `runConfigArgs`…），
// 拆开就会变成两个模块互相读对方的 ref。所以这里一起收：**配置的整形与持久化**。
// 真正的启动动作在 src/runActions.ts（消费 `currentRunConfig()`）。
import { computed, ref, watch, type Ref } from 'vue'
import { request, type Entry, type ProjectSettings, type RunConfig, type Workspace } from './bridge'
import { errorMessage } from './errors'

export interface RunConfigurationsDeps {
  notify: (message: string, error?: boolean) => void
  workspace: Ref<Workspace | null>
  projectSettings: Ref<ProjectSettings>
  /** 控制台里手输的当前命令（宿主更早的阶段就要读写，所以留在宿主）。 */
  runCommand: Ref<string>
  menu: Ref<any>
  /** 由运行动作模块提供 —— 必须惰性调用。 */
  runSelectedConfig: (debug: boolean) => unknown
}

export function createRunConfigurations(deps: RunConfigurationsDeps) {
  const { notify, workspace, projectSettings, runCommand, menu, runSelectedConfig } = deps
'''

FOOTER = '''
  return {
    runConfigs, runConfigName, runWidgetTitle, configChooser, configIndex, openConfigChooser, moveConfig,
    applyConfigChoice, runConfigType, runConfigProgram, runConfigDebugAdapter, runConfigArgs, runConfigCwd,
    runConfigEnv, runConfigBefore, runConfigFolder, runConfigEditorOpen, runConfigDebug, runConfigsOpen,
    runConfigDraft, loadRunConfigDraft, saveRunConfigFromDialog, openRunConfigurations,
    linesToArray, arrayToLines, currentRunConfig, selectRunConfig, pickConfig, persistRunConfigs,
    addBeforeLaunchStep, removeBeforeLaunchStep, removeRunConfigFromDialog, saveConfig, removeConfig,
  }
}
'''

module_text = HEADER + '\n'.join(blockR1) + '\n' + '\n'.join(blockR2) + '\n' + '\n'.join(blockR3) + FOOTER
io.open(MOD, 'w', encoding='utf-8', newline='\n').write(module_text)

new_lines = (lines[:a1] + ASSEMBLY.split('\n') + lines[b1 + 1:a2] + lines[b2 + 1:a3] + lines[r3_end + 1:])
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('R1/R2/R3:', len(blockR1), len(blockR2), len(blockR3))
print('App.vue:', len(lines), '->', len(new_lines))
