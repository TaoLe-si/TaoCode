// 外部系统工程模型（`src/externalSystemModel.ts`）：ProjectSystemId/Key/DataNode/ProjectKeys/
// ExternalProjectInfo 与“按系统 id 可寻址的登记表”，以及模型与原始纯函数渲染口径的一致性。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PROJECT_KEYS, canonicalExternalPath, createExternalProjectRegistry, createKey, DataNode,
  externalProjectDependencyGroups, externalProjectInfoOf, externalProjectModules, externalProjectPojos,
  externalProjectTaskGroups, findDataNodes, findProjectSystemId, GRADLE_SYSTEM, MAVEN_SYSTEM,
  projectSystemId, sameKey, visitDataNodes,
} from '../src/externalSystemModel.ts'
import { dependenciesByProject, parseGradleDependencies, tasksByGroup } from '../src/gradle.ts'

const root = new URL('..', import.meta.url)

const PROJECTS = [
  { path: ':', name: 'demo', depth: 0 },
  { path: ':app', name: 'app', depth: 1 },
]
const TASKS = [
  { name: 'build', description: 'Assembles', group: 'Build tasks' },
  { name: ':app:build', description: 'Assembles app', group: 'Build tasks' },
  { name: 'run', description: 'Runs', group: 'Application tasks' },
]
const DEPENDENCIES = [
  { configuration: 'compileClasspath', description: 'Compile classpath', unresolved: false, empty: false,
    project: 'Root project demo', dependencies: [{ name: 'g:a:1', depth: 0, duplicate: false, constraint: false, unresolved: false, resolved: '' }] },
  { configuration: 'runtimeClasspath', description: 'Runtime classpath', unresolved: false, empty: false,
    project: ':app', dependencies: [
      { name: 'g:b:2', depth: 0, duplicate: false, constraint: false, unresolved: false, resolved: '2.1' },
      { name: 'g:c:1', depth: 1, duplicate: true, constraint: false, unresolved: false, resolved: '' },
    ] },
]

const infoOf = (extra = {}) => externalProjectInfoOf({
  systemId: GRADLE_SYSTEM, projectPath: 'D:/work/build', projects: PROJECTS, tasks: TASKS,
  dependencies: DEPENDENCIES, importedAt: 100, ...extra,
})

test('路径归一与 ProjectSystemId：反斜杠/尾斜杠归一，按 id intern', () => {
  assert.equal(canonicalExternalPath('D:\\work\\build\\'), 'D:/work/build')
  assert.equal(canonicalExternalPath('/a/b/'), '/a/b')
  assert.equal(projectSystemId('GRADLE', 'Gradle'), GRADLE_SYSTEM)
  assert.equal(projectSystemId('MARVEN'), projectSystemId('MARVEN'))
  assert.equal(projectSystemId('maven').readableName, 'Maven')
  assert.equal(findProjectSystemId('nope'), null)
  assert.equal(GRADLE_SYSTEM.id, 'GRADLE')
  assert.equal(MAVEN_SYSTEM.readableName, 'Maven')
})

test('Key 相等只看 dataClass；ProjectKeys 的权重照上游', () => {
  assert.ok(sameKey(createKey('TaskData', 250), PROJECT_KEYS.TASK))
  assert.ok(!sameKey(PROJECT_KEYS.TASK, PROJECT_KEYS.MODULE))
  assert.deepEqual(Object.values(PROJECT_KEYS).map(key => key.weight), [50, 70, 90, 110, 130, 150, 250, 350, 450, 500])
})

test('DataNode：按键向上查找（本节点 → 祖先），visit 返回 false 剪枝', () => {
  const rootNode = new DataNode(PROJECT_KEYS.PROJECT, { tag: 'project' })
  const module = rootNode.createChild(PROJECT_KEYS.MODULE, { tag: 'module' })
  const task = module.createChild(PROJECT_KEYS.TASK, { tag: 'task' })
  const deep = task.createChild(PROJECT_KEYS.LIBRARY_DEPENDENCY, { tag: 'dep' })
  assert.equal(deep.parent, task)
  assert.equal(task.getData(PROJECT_KEYS.PROJECT)?.tag, 'project')
  assert.equal(task.getDataNode(PROJECT_KEYS.MODULE)?.data.tag, 'module')
  assert.equal(rootNode.getData(PROJECT_KEYS.TASK), null)
  const seen = []
  visitDataNodes(rootNode, node => { seen.push(node.data.tag); return node.key !== PROJECT_KEYS.MODULE })
  assert.deepEqual(seen, ['project', 'module'])
  assert.equal(findDataNodes(rootNode, PROJECT_KEYS.LIBRARY_DEPENDENCY).length, 1)
})

test('ExternalProjectInfo：模块/任务/依赖进树，失败导入保留上次成功的结构与时间戳', () => {
  const info = infoOf()
  assert.equal(info.systemId.id, 'GRADLE')
  assert.equal(info.externalProjectPath, 'D:/work/build')
  assert.equal(info.lastImportTimestamp, 100)
  assert.equal(info.lastSuccessfulImportTimestamp, 100)
  assert.equal(info.buildNumber, '')
  assert.deepEqual(externalProjectModules(info).map(module => [module.id, module.externalName, module.depth]), [[':', 'demo', 0], [':app', 'app', 1]])
  const failed = infoOf({ importedAt: 200, error: 'gradle failed', previous: info })
  assert.equal(failed.lastSuccessfulImportTimestamp, 100)
  assert.equal(failed.lastImportTimestamp, 200)
  assert.equal(failed.structure, info.structure)
  const fresh = externalProjectInfoOf({ systemId: GRADLE_SYSTEM, projectPath: 'D:/none', projects: [], tasks: [], dependencies: [], importedAt: 5, error: 'boom' })
  assert.equal(fresh.structure, null)
  assert.equal(fresh.lastSuccessfulImportTimestamp, 0)
})

test('任务分组/依赖分组与原始纯函数同形同序（模型消费后渲染不变）', () => {
  const info = infoOf()
  assert.deepEqual(externalProjectTaskGroups(info), tasksByGroup(TASKS))
  const parsed = parseGradleDependencies(DEPENDENCIES_OUTPUT)
  const parsedInfo = externalProjectInfoOf({
    systemId: GRADLE_SYSTEM, projectPath: 'D:/work/build', projects: PROJECTS, tasks: [], dependencies: parsed, importedAt: 1,
  })
  assert.deepEqual(externalProjectDependencyGroups(parsedInfo), dependenciesByProject(parsed))
})

test('ExternalProjectPojo 摘要按名字排序；登记表按 (系统, 路径) 可寻址', () => {
  const info = infoOf()
  assert.deepEqual(externalProjectPojos(info), [{ name: 'app', path: ':app' }, { name: 'demo', path: ':' }])
  const registry = createExternalProjectRegistry()
  registry.setExternalProjectInfo(info)
  assert.equal(registry.getExternalProjectInfo(GRADLE_SYSTEM, 'D:\\work\\build\\'), info)
  assert.equal(registry.getExternalProjectInfo('MAVEN', 'D:/work/build'), null)
  assert.equal(registry.getExternalProjects('GRADLE').length, 1)
  assert.equal(registry.getExternalProjects('MAVEN').length, 0)
  registry.removeExternalProjectInfo(GRADLE_SYSTEM, 'D:/work/build')
  assert.equal(registry.getExternalProjects().length, 0)
})

test('消费链：gradleHost 用模型登记并按模型渲染任务/依赖分组', () => {
  const source = readFileSync(new URL('src/gradleHost.ts', root), 'utf8')
  assert.match(source, /from '\.\/externalSystemModel\.ts'/)
  assert.match(source, /createExternalProjectRegistry\(\)/)
  assert.match(source, /externalProjectInfoOf\(\{/)
  assert.match(source, /externalProjectTaskGroups\(/)
  assert.match(source, /externalProjectDependencyGroups\(/)
})

const DEPENDENCIES_OUTPUT = `------------------------------------------------------------
Root project 'demo'
------------------------------------------------------------

compileClasspath - Compile classpath for source set 'main'.
+--- org.jetbrains.kotlin:kotlin-stdlib:1.9.0
|    \\--- org.jetbrains:annotations:13.0
\\--- org.example:lib:1.0 -> 1.2

runtimeClasspath - Runtime classpath of source set 'main'.
\\--- org.example:core:0.5 (*)
`
