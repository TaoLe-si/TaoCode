# 一次性脚本：把 App.vue 的「运行 / 构建 / 调试 / 外部工具」域搬到 src/runActions.ts
# 两段不连续区间：A = 运行配置的启动与调试（3268-3392），B = 构建/外部工具/停止（3453-3492）。
# 中间夹着的 Git 菜单动作（3393-3452）属于别的域，原地留下。
# 安全规程见 skill: scripted-refactor-safety —— 锚点必须唯一，数量断言失败即中止。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\runActions.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

A_START = '// The whole configuration is sent, not just the command:'
A_END = "// IDEA's Build menu: CompileDirty"
B_START = 'async function startBuild(rebuild: boolean) {'
B_END = 'let lastShiftAt = 0'

for anchor in (A_START, A_END, B_START, B_END):
    assert text.count(anchor) == 1, ('anchor not unique: ' + anchor, text.count(anchor))

a = next(i for i, l in enumerate(lines) if l.startswith(A_START))
b = next(i for i, l in enumerate(lines) if A_END in l)
c = next(i for i, l in enumerate(lines) if l.startswith(B_START))
d = next(i for i, l in enumerate(lines) if l.startswith(B_END))
assert a < b < c < d, (a, b, c, d)
assert (a, b, c, d) == (3267, 3392, 3452, 3492), ('unexpected anchors', a + 1, b + 1, c + 1, d + 1)

blockA = lines[a:b]
blockB = lines[c:d]
assert blockA[-1].strip() == '}', ('A tail', blockA[-1])
assert blockB[-1].strip() == '}', ('B tail', blockB[-1])
for must in ('runStartParams', 'startRun', 'runSelectedConfig', 'runContextConfiguration'):
    assert must in '\n'.join(blockA), 'A missing ' + must
for must in ('startBuild', 'runExternalTool', 'stopRun', 'stopAnyProcess', 'sendRunInput'):
    assert must in '\n'.join(blockB), 'B missing ' + must
# 中间那段必须真的是 Git 菜单，没有被误并进来
mid = '\n'.join(lines[b:c])
assert 'updateProject' in mid and 'gitMenuAction' in mid and 'startRun(' not in mid, 'middle range is not the git block'

ASSEMBLY = '''// 控制台标签页里的构建动作是同一个域的另一半（含内联终端）。见 src/runActions.ts。
const {
  runStartParams, runToExit, startRun, runSelectedConfig, envArrayToObject, debugKindFor,
  runContextConfiguration, startBuild, runExternalTool, stopRun, debugButtonTitle, stopAnyProcess,
  sendRunInput, lastRunParams,
} = createRunActions({
  notify, isDesktop, workspace, active, runCommand, runConfigProgram, runConfigName, runConfigs, projectSettings,
  currentRunConfig, showOutput, explorer, leftView, runInput,
  // 惰性：`saveAll` 是骨架里的函数（本块之后），必须延后调用。
  saveAll: () => saveAll(),
})'''

HEADER = '''// 运行 / 构建 / 调试 / 外部工具 —— 从 App.vue 搬出的一域（165 行，18 个依赖）。
//
// 判据：这是一条完整的「启动链路」—— `runStartParams` 把当前运行配置整形成 `run.start` 的参数，
// `runToExit` 把事件流变成可等待的退出码（IDEA 的 Before launch 语义），`startRun` / `startBuild` /
// `runExternalTool` 都走同一条链路，`stopRun` / `stopAnyProcess` 负责收尾。调试走 DAP，
// 但选哪条配置、要不要先跑 before-launch，和运行是同一套判断，所以不拆开。
// IDEA 对应物：Run/Debug 工具窗口 + Build 菜单（CompileDirty / Compile）+ tools.externalTools。
import { computed, watch, type Ref } from 'vue'
import { beginRun, dapStart, dapState, endRun, request, runState, type DocumentData, type GitAheadBehind,
         type ProjectSettings, type RunConfig, type RunStartParams, type Workspace } from './bridge'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface RunActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  workspace: Ref<Workspace | null>
  active: { readonly value: Tab | undefined }
  /** 控制台里手输的命令（宿主更早的阶段就要读写，所以留在宿主）。 */
  runCommand: Ref<string>
  runConfigProgram: Ref<string>
  runConfigName: Ref<string>
  runConfigs: { readonly value: RunConfig[] }
  projectSettings: Ref<ProjectSettings>
  /** 把「草稿态」的运行配置整形成一条完整配置（宿主更早的阶段就要用）。 */
  currentRunConfig: () => RunConfig
  showOutput: (id: 'run') => void
  /** 调试要把左栏切到 Debug 视图。 */
  explorer: Ref<boolean>
  leftView: Ref<any>
  runInput: Ref<HTMLInputElement | undefined>
  /** 启动前必须落盘，所以它是骨架里的函数 —— 必须惰性调用。 */
  saveAll: () => Promise<boolean>
}

export function createRunActions(deps: RunActionsDeps) {
  const { notify, isDesktop, workspace, active, runCommand, runConfigProgram, runConfigName, runConfigs,
          projectSettings, currentRunConfig, showOutput, explorer, leftView, runInput, saveAll } = deps
  // IDEA 的「重新运行上一次」快照。原先声明在 App.vue（`let lastRunParams`），只有本域写它。
  let lastRunParams: RunStartParams | null = null
'''

FOOTER = '''
  return {
    runStartParams, runToExit, startRun, runSelectedConfig, envArrayToObject, debugKindFor,
    runContextConfiguration, startBuild, runExternalTool, stopRun, debugButtonTitle, stopAnyProcess,
    sendRunInput,
  }
}
'''

module_text = HEADER + '\n'.join(blockA) + '\n' + '\n'.join(blockB) + FOOTER
io.open(MOD, 'w', encoding='utf-8', newline='\n').write(module_text)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[b:c] + lines[d:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('A:', len(blockA), 'B:', len(blockB))
print('App.vue:', len(lines), '->', len(new_lines))
