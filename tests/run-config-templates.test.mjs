// exec/run-configs + exec/target 本轮的判据：
// 模板配置（上游 RunManagerImpl.getConfigurationTemplate / TemplateConfigurable）与
// 运行目标（ExecutionTarget / RunTargetsEnabled 注册表开关、JavaLanguageRuntime 的 JDK 目标）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyTemplate, hasTemplateContent, loadRunConfigTemplates, removeRunConfigTemplate,
  saveRunConfigTemplate, templateFor, templatesStoreKey,
} from '../src/runConfigTemplates.ts'
import {
  applyTargetToTemplateProgram, describeExecutionTarget, jdkExecutionTargets, listExecutionTargets,
  LOCAL_TARGET_ID, readRunTargetsEnabled, targetById, writeRunTargetsEnabled,
} from '../src/executionTargets.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function memoryStore() {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
}

test('模板存取：按项目根分键、坏数据当空、空模板即删除', () => {
  const store = memoryStore()
  assert.deepEqual(loadRunConfigTemplates(store, 'D:/p'), {})
  saveRunConfigTemplate(store, 'D:/p', 'shell', { command: 'cmake --build build', allowRunningInParallel: true })
  saveRunConfigTemplate(store, 'D:/p', 'application', { program: 'build/app.exe', args: ['--fast'] })
  const loaded = loadRunConfigTemplates(store, 'D:/p')
  assert.equal(loaded.shell.command, 'cmake --build build')
  assert.equal(loaded.shell.allowRunningInParallel, true)
  assert.deepEqual(loaded.application.args, ['--fast'])
  assert.deepEqual(loadRunConfigTemplates(store, 'D:/other'), {}, '别的项目看不到')
  assert.equal(templatesStoreKey('D:/p').includes('D:/p'), true)
  // 空字段模板 = 清除。
  saveRunConfigTemplate(store, 'D:/p', 'shell', {})
  assert.equal(templateFor(loadRunConfigTemplates(store, 'D:/p'), 'shell'), undefined)
  // 坏 JSON 不抛。
  store.setItem(templatesStoreKey('D:/p'), '{oops')
  assert.deepEqual(loadRunConfigTemplates(store, 'D:/p'), {})
  assert.deepEqual(loadRunConfigTemplates(undefined, 'D:/p'), {})
})

test('新建配置从模板取初值：字段覆盖、名字唯一化、类型与文件夹保留', () => {
  const template = { command: 'python app.py', args: ['--port', '8080'], cwd: 'tools', env: ['A=1'], beforeLaunch: [{ name: '构建', command: 'make' }], allowRunningInParallel: true }
  const draft = { name: '旧草稿', type: 'shell', command: '残留命令', program: 'zzz', args: ['stale'], cwd: '/', env: [], beforeLaunch: [], folder: '组' }
  const seeded = applyTemplate(draft, template, 'app')
  assert.equal(seeded.name, 'app')
  assert.equal(seeded.type, 'shell')
  assert.equal(seeded.command, 'python app.py')
  assert.equal(seeded.program, '', '模板没给的字段清空，不带草稿残留')
  assert.deepEqual(seeded.args, ['--port', '8080'])
  assert.equal(seeded.cwd, 'tools')
  assert.deepEqual(seeded.env, ['A=1'])
  assert.deepEqual(seeded.beforeLaunch, [{ name: '构建', command: 'make' }])
  assert.equal(seeded.allowRunningInParallel, true)
  assert.equal(seeded.folder, '组')
  // 没有模板 = 空表单。
  const blank = applyTemplate({ name: 'x', type: 'shell' }, undefined, '新配置')
  assert.equal(blank.command, '')
  assert.deepEqual(blank.args, [])
  assert.equal(hasTemplateContent({}), false)
  assert.equal(hasTemplateContent(undefined), false)
  assert.equal(hasTemplateContent({ cwd: 'x' }), true)
  // remove 幂等。
  const store = memoryStore()
  saveRunConfigTemplate(store, '', 'shell', { cwd: 'x' })
  removeRunConfigTemplate(store, '', 'shell')
  assert.equal(templateFor(loadRunConfigTemplates(store, ''), 'shell'), undefined)
})

test('目标模型：本机 + JDK 目标；注册表开关读写；JDK 目标只在 Java 形态替换程序', () => {
  const jdks = [{ home: 'D:\\Java21', name: 'java 21', version: '21' }]
  const targets = listExecutionTargets(jdks)
  assert.equal(targets[0].id, LOCAL_TARGET_ID)
  assert.equal(targets.length, 2)
  assert.equal(targets[1].kind, 'jdk')
  assert.equal(targets[1].javaExecutable, 'D:\\Java21\\bin\\java.exe', 'Windows home 用反斜杠拼')
  assert.equal(describeExecutionTarget(targets[1]).includes('D:\\Java21'), true)
  assert.equal(jdkExecutionTargets([{ home: '' }]).length, 0)
  assert.equal(targetById(targets, 'jdk:D:\\Java21').name.startsWith('JDK'), true)
  assert.equal(targetById(targets, '不存在'), undefined)

  const store = memoryStore()
  assert.equal(readRunTargetsEnabled(store), true, '缺省开')
  writeRunTargetsEnabled(store, false)
  assert.equal(readRunTargetsEnabled(store), false)
  writeRunTargetsEnabled(store, true)
  assert.equal(readRunTargetsEnabled(store), true)

  const jdk = targets[1]
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'java', command: '' }, jdk), { program: 'D:\\Java21\\bin\\java.exe' })
  assert.deepEqual(applyTargetToTemplateProgram({ program: '', command: 'java -cp out Main' }, jdk), { program: 'D:\\Java21\\bin\\java.exe' })
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'build/app.exe', command: '' }, jdk), {}, '非 Java 程序不替换')
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'java' }, targets[0]), {}, '本机目标不替换')
})

test('接线：对话框点类型节点进模板编辑器、新建配置吃模板与目标；树上有模板徽标', () => {
  const dialog = read('src/components/RunConfigurationsDialog.vue')
  assert.match(dialog, /const template = type \? templateFor\(templates\.value, type\) : undefined/)
  assert.match(dialog, /applyTemplate\(\{ name, type, command: '', program: '', args: \[\], cwd: '', env: \[\], beforeLaunch: \[\], folder \}, template, name\)/)
  assert.match(dialog, /applyTargetToTemplateProgram\(template \?\? \{\}, targetById\(templateTargets\.value, template\?\.target\)\)/)
  assert.match(dialog, /saveRunConfigTemplate\(storage\(\), projectRoot\.value, type, templateForm\.value\)/)
  assert.match(dialog, /request<\{ lastProject\?: string \| null \}>\('app\.state'\)/)
  assert.match(dialog, /request<\{ jdks\?: JdkInfo\[\] \}>\('app\.jdks'\)/)
  assert.match(dialog, /aria-label="运行目标"/)
  assert.match(dialog, /RunTargetsEnabled 注册表开关/)
  assert.match(dialog, /rc-template-badge/)
  assert.match(dialog, /templateFor\(templates, node\.id\)/)
})
