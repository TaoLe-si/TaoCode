// 接线门禁：文件选择描述件与任务激活必须接在**真实消费链路**上，不能只是新模块。
//   · `src/fileChooserDescriptor.ts` → `src/projectExtras.ts`（插件包/插件目录）、
//     `src/settingsPersistence.ts`（项目结构 JDK/输出目录）；
//   · `src/externalProjectModel.ts` + `src/externalTasksActivation.ts` → `src/components/GradlePanel.vue`
//     （右键菜单、任务 tooltip、持久化）与 `src/components/ExternalTasksActivationDialog.vue`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('插件安装的文件/目录选择走描述件与选后复核', () => {
  const extras = read('src/projectExtras.ts')
  assert.match(extras, /import \{ chooseWithDescriptor, singleDirDescriptor, singleFileDescriptor, withExtensionFilter, withTitle,/)
  assert.match(extras, /withExtensionFilter\(singleFileDescriptor\(\), '插件包', \['zip', 'jar'\]\)/)
  assert.match(extras, /chooseWithDescriptor\(chooserHost, pluginArchiveDescriptor\)/)
  assert.match(extras, /chooseWithDescriptor\(chooserHost, pluginDirectoryDescriptor\)/)
  assert.ok(!/dialog\.pickFile', \{\s*filters:/.test(extras), '插件包过滤不再手写宿主过滤串')
})

test('项目结构 JDK/输出目录的浏览带上描述件标题', () => {
  const settings = read('src/settingsPersistence.ts')
  assert.match(settings, /import \{ chooseWithDescriptor, singleDirDescriptor, withTitle, type FileChooserHost \}/)
  assert.match(settings, /withTitle\(singleDirDescriptor\(\), field === 'jdkHome' \? '选择 JDK 目录' : '选择输出目录'\)/)
  assert.match(settings, /chooseWithDescriptor\(structureDirHost, descriptor, start\)/)
})

test('GradlePanel 挂上任务激活：状态持久化、动作矩阵、右键入口、任务 tooltip', () => {
  const panel = read('src/components/GradlePanel.vue')
  assert.match(panel, /import ExternalTasksActivationDialog from '\.\/ExternalTasksActivationDialog\.vue'/)
  assert.match(panel, /loadTasksActivation\(activationStore, root \?\? ''\)/)
  assert.match(panel, /saveTasksActivation\(activationStore, props\.result\.workspaceRoot \?\? '', next\)/)
  assert.match(panel, /tasksActivationForLinkedBuilds\(activationMap\.value, dirs\)/)
  assert.match(panel, /if \(row\.id === 'OpenTasksActivationManagerAction'\) activationOpen\.value = true/)
  assert.match(panel, /if \(row\.id\.startsWith\('ToggleTaskActivationAction\.'\) && row\.phase && target\.task\)/)
  assert.match(panel, /function toggleActivation\(directory: string, taskName: string, phase: TaskPhase, checked: boolean\)/)
  assert.match(panel, /:title="taskActivationTitle\(task, build\.directory\)"/)
  assert.match(panel, /<ExternalTasksActivationDialog v-if="activationOpen" :builds="activationNodes" :summary="activationSummary"/)
})

test('任务激活对话框是纯展示：增删移全部 emit 给宿主', () => {
  const dialog = read('src/components/ExternalTasksActivationDialog.vue')
  assert.match(dialog, /\(event: 'add', directory: string, phase: TaskPhase, task: string\): void/)
  assert.match(dialog, /\(event: 'move', directory: string, phase: TaskPhase, task: string, delta: number\): void/)
  assert.match(dialog, /emit\('remove', build\.directory, phase\.phase, task\)/)
  assert.match(dialog, /activationTaskOptions\(build\.value, query\.value\)/)
})
