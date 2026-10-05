// 外部系统任务执行的模型（`src/externalSystemTask.ts`）：任务名解析/脚本参数切分/运行配置命名/
// 前置任务名/JDK 四档解析/任务标识。判据对应上游 `ExternalSystemTaskExecutionSettings`、
// `AbstractExternalSystemTaskConfigurationType.generateName`、`ExternalSystemJdkUtil.matchJdkName`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTERNAL_SYSTEM_USE_INTERNAL_JAVA, EXTERNAL_SYSTEM_USE_JAVA_HOME, EXTERNAL_SYSTEM_USE_PROJECT_JDK,
  externalSystemBeforeRunTaskName, externalSystemTaskArguments, externalSystemTaskIdString,
  externalSystemTaskLocation, externalSystemTaskNames, generateExternalSystemTaskName,
  isRunConfigurationTaskName, normalizeExternalSystemTaskSettings, resolveExternalSystemJdk,
  runConfigurationActivationTaskName, splitScriptParameters,
} from '../src/externalSystemTask.ts'

test('任务名按空格/逗号切分并去掉空项（setTaskNames 的 StringUtil.split 口径）', () => {
  assert.deepEqual(externalSystemTaskNames('build test   :app:assemble'), ['build', 'test', ':app:assemble'])
  assert.deepEqual(externalSystemTaskNames('build,test'), ['build', 'test'])
  assert.deepEqual(externalSystemTaskNames('   '), [])
})

test('脚本参数按引号切分（单双引号与反斜杠转义）', () => {
  assert.deepEqual(splitScriptParameters('--tests "com.acme.Foo Bar" --info'), ['--tests', 'com.acme.Foo Bar', '--info'])
  assert.deepEqual(splitScriptParameters("--msg 'a b' --flag"), ['--msg', 'a b', '--flag'])
  assert.deepEqual(splitScriptParameters('--x a\\"b'), ['--x', 'a"b'])
  assert.deepEqual(splitScriptParameters(''), [])
})

test('任务 + 脚本参数合成命令行参数表', () => {
  assert.deepEqual(externalSystemTaskArguments({ systemId: 'GRADLE', taskNames: ['build', 'test'], scriptParameters: '--tests "A B"' }),
    ['build', 'test', '--tests', 'A B'])
  assert.deepEqual(externalSystemTaskArguments({ systemId: 'GRADLE', taskNames: [] }), [])
})

test('运行配置命名：工程名 [任务短名]；executionName 优先；空给未命名（generateName）', () => {
  assert.equal(generateExternalSystemTaskName({ projectName: 'app', taskNames: ['build'] }), 'app [build]')
  assert.equal(generateExternalSystemTaskName({ projectName: 'app', taskNames: ['build', 'test'] }), 'app [build test]')
  assert.equal(generateExternalSystemTaskName({ projectName: 'app', taskNames: ['build'], executionName: '我的构建' }), '我的构建')
  assert.equal(generateExternalSystemTaskName({ externalProjectPath: '/abs/app', taskNames: ['clean'] }), '/abs/app [clean]')
  assert.equal(generateExternalSystemTaskName({}), '未命名')
})

test('前置任务名与激活项名（ExternalSystemBeforeRunTaskProvider / RUN_CONFIGURATION_TASK_PREFIX）', () => {
  assert.equal(externalSystemBeforeRunTaskName('Gradle'), '运行 Gradle 任务')
  assert.equal(runConfigurationActivationTaskName('我的构建'), 'run: 我的构建')
  assert.equal(isRunConfigurationTaskName('run: 我的构建'), true)
  assert.equal(isRunConfigurationTaskName('build'), false)
})

test('任务标识：三段字符串形状', () => {
  const location = externalSystemTaskLocation('GRADLE', 'D:/proj/app', ':app:build')
  assert.equal(externalSystemTaskIdString(location), 'GRADLE:D:/proj/app::app:build')
  assert.deepEqual(location, { systemId: 'GRADLE', externalProjectPath: 'D:/proj/app', taskName: ':app:build' })
})

test('设置规范化：路径归一、空值字段不落', () => {
  assert.deepEqual(normalizeExternalSystemTaskSettings({ systemId: 'GRADLE', taskNames: [' build ', ''], externalProjectPath: 'a\\b', vmOptions: '  ', scriptParameters: '--x' }),
    { systemId: 'GRADLE', externalProjectPath: 'a/b', taskNames: ['build'], scriptParameters: '--x' })
})

test('JDK 四档解析（#USE_PROJECT_JDK / #JAVA_HOME / #JAVA_INTERNAL / 显式路径）', () => {
  const exists = path => path === 'C:/jdk/17'
  assert.deepEqual(resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_PROJECT_JDK, { projectJdkHome: 'C:/jdk/17' }), { ok: true, home: 'C:/jdk/17' })
  assert.equal(resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_PROJECT_JDK, {}).code, 'PROJECT_JDK_NOT_FOUND')
  assert.deepEqual(resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_JAVA_HOME, { javaHome: 'C:/jdk/17', exists }), { ok: true, home: 'C:/jdk/17' })
  assert.equal(resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_JAVA_HOME, {}).code, 'UNDEFINED_JAVA_HOME')
  assert.equal(resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_JAVA_HOME, { javaHome: 'C:/gone', exists }).code, 'INVALID_JAVA_HOME')
  assert.equal(resolveExternalSystemJdk(EXTERNAL_SYSTEM_USE_INTERNAL_JAVA, {}).ok, false)
  assert.deepEqual(resolveExternalSystemJdk('C:/jdk/17', { exists }), { ok: true, home: 'C:/jdk/17' })
  assert.equal(resolveExternalSystemJdk('C:/gone', { exists }).code, 'UNKNOWN_JDK')
  // 空值按 `#USE_PROJECT_JDK`（GradleProjectSettings 的默认值）处理。
  assert.deepEqual(resolveExternalSystemJdk('', { projectJdkHome: 'C:/jdk/17' }), { ok: true, home: 'C:/jdk/17' })
})
