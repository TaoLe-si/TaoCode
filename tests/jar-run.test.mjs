// JAR 运行配置（`src/jarRun.ts`）—— 上游 `java/execution/impl/src/com/intellij/execution/jar/`
// 的可移植部分。断言体守**意图**（上游哪一条判据），坐标见 src/jarRun.ts 的文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  JAR_APPLICATION_TYPE_DESCRIPTION, JAR_APPLICATION_TYPE_ID, JAR_APPLICATION_TYPE_LABEL, JAR_FORM_FIELDS,
  jarCanRunOn, jarEnvironment, jarRunArgs, jarRunCommand, jarTemplateConfiguration, jarValidation, splitParameters,
} from '../src/jarRun.ts'
import { javaExecutable } from '../src/javaRun.ts'

const withJar = (over = {}) => ({ ...jarTemplateConfiguration('C:/proj'), jarPath: 'C:/proj/app.jar', ...over })

const envWith = (files, dirs = files) => ({
  fileExists: path => files.includes(path),
  isDirectory: path => dirs.includes(path),
})

test('类型描述符与上游 bundle 一致（JarApplicationConfigurationType:19-23 / ExecutionBundle:54-55）', () => {
  assert.equal(JAR_APPLICATION_TYPE_ID, 'JarApplication')
  assert.equal(JAR_APPLICATION_TYPE_LABEL, 'JAR Application')
  assert.equal(JAR_APPLICATION_TYPE_DESCRIPTION, "Configuration to run a JAR file using the 'java-jar' command")
})

test('模板配置：jarPath 空串、passParentEnvs 默认 true、工作目录 = 项目 base path（:26-28 / :277 / :241-248）', () => {
  const template = jarTemplateConfiguration('C:\\work\\proj')
  assert.equal(template.jarPath, '')
  assert.equal(template.passParentEnvs, true, '上游 PASS_PARENT_ENVS 默认 true')
  assert.equal(template.workingDirectory, 'C:/work/proj', 'toSystemIndependentName')
  assert.equal(template.alternativeJrePathEnabled, false)
})

test('表单字段顺序与上游 GridConstraints 行序一致；模块 classpath 那一格如实标为不可用', () => {
  assert.deepEqual(JAR_FORM_FIELDS.map(field => field.id), [
    'jarPath', 'programParameters', 'vmParameters', 'workingDirectory', 'alternativeJrePath', 'moduleClasspath',
  ])
  assert.deepEqual(JAR_FORM_FIELDS[0].browse, { title: 'Choose JAR File', extensions: ['jar'] })
  assert.equal(JAR_FORM_FIELDS.at(-1).available, false, '没有 Module/依赖图就不画那一格')
  assert.equal(JAR_FORM_FIELDS.slice(0, -1).every(field => field.available), true)
})

test('校验顺序与 checkConfiguration 一致：备选 JRE → 工作目录 → jar 文件（:125-133）', () => {
  const env = envWith(['C:/proj/app.jar'], ['C:/proj', 'C:/jdk'])
  assert.deepEqual(jarValidation(withJar(), env), [], '全都齐了没有告警')

  // ① 备选 JRE 开了却没填 → `'' is not a valid JRE home`（JavaParametersUtil:214-220 / ExecutionBundle:249）
  const jre = jarValidation(withJar({ alternativeJrePathEnabled: true, alternativeJrePath: '' }), env)
  assert.equal(jre[0].field, 'alternativeJrePath')
  assert.equal(jre[0].message, "'' is not a valid JRE home")

  // ② 工作目录空 → `Working directory is not specified`（ExecutionBundle:191）
  const emptyCwd = jarValidation(withJar({ workingDirectory: '' }), env)
  assert.equal(emptyCwd[0].field, 'workingDirectory')
  assert.equal(emptyCwd[0].message, 'Working directory is not specified')

  // ② 工作目录填了但不存在 → 也是这一格先报（顺序在 jar 文件之前）
  const badCwd = jarValidation(withJar({ workingDirectory: 'C:/nope' }), env)
  assert.equal(badCwd.length, 1, 'jar 本身存在，只报工作目录这一条')
  assert.equal(badCwd[0].field, 'workingDirectory')
  assert.equal(badCwd[0].message, "Working directory 'C:/nope' doesn't exist")
  // 两处都不对时，顺序必须是「工作目录在 jar 文件之前」（上游 checkConfiguration 的调用序）
  const both = jarValidation(withJar({ workingDirectory: 'C:/nope', jarPath: 'C:/proj/gone.jar' }), env)
  assert.deepEqual(both.map(problem => problem.field), ['workingDirectory', 'jarPath'])

  // ③ jar 文件不存在 → 文案逐字对齐 dialog.message.jar.file.doesn.t.exist（JavaCompilerBundle:282）
  const noJar = jarValidation(withJar({ jarPath: 'C:/proj/gone.jar' }), env)
  assert.equal(noJar[0].field, 'jarPath')
  assert.equal(noJar[0].message, "JAR file 'C:/proj/gone.jar' doesn't exist")
  assert.equal(noJar[0].severity, 'warning', '上游抛的是 RuntimeConfigurationWarning')
})

test('没选 jar 也报「不存在」那一条（上游 :128-131 无短路，空路径的 File 同样不存在）', () => {
  const problems = jarValidation(jarTemplateConfiguration('C:/proj'), envWith([]))
  assert.equal(problems.at(-1).message, "JAR file '' doesn't exist")
})

test('canRunOn：目标没有 Java 语言运行时就不能跑（JarApplicationConfiguration:251-253）', () => {
  assert.equal(jarCanRunOn(null), true, '没给目标 = 本机，本仓的本机目标带 java')
  assert.equal(jarCanRunOn({ hasJavaRuntime: true }), true)
  assert.equal(jarCanRunOn({ hasJavaRuntime: false }), false)
})

test('命令行：<jdk>/bin/java [vm] -jar <jar> <program args>（JarApplicationCommandLineState:24-32）', () => {
  const args = jarRunArgs({ config: withJar({ vmParameters: '-Xmx512m', programParameters: '--port 8080 data.json' }), jdkHome: 'C:/jdk' })
  assert.deepEqual(args, [javaExecutable('C:/jdk'), '-Xmx512m', '-jar', 'C:/proj/app.jar', '--port', '8080', 'data.json'])
  // 备选 JRE 打开时优先用它（JavaParametersUtil.createProjectJdk(project, jreHome)）
  const alt = jarRunArgs({ config: withJar({ alternativeJrePathEnabled: true, alternativeJrePath: 'C:/jdk17' }), jdkHome: 'C:/jdk' })
  assert.equal(alt[0], javaExecutable('C:/jdk17'))
  // 两个都没有 ⇒ 不产出命令（调用方据此不启动）
  assert.deepEqual(jarRunArgs({ config: withJar() }), [])
})

test('命令行文本给含空格的路径加引号（与 src/javaRun.ts 的 javaRunCommand 同规则）', () => {
  const command = jarRunCommand({
    config: withJar({ jarPath: 'C:/my proj/app.jar', programParameters: 'a b' }),
    jdkHome: 'C:/jdk',
  })
  assert.equal(command, `${javaExecutable('C:/jdk')} -jar "C:/my proj/app.jar" a b`)
  assert.equal(jarRunCommand({ config: withJar() }), '')
})

test('参数串按 ParametersListUtil.parse 口径切：成对引号内的空白算一段、转义引号', () => {
  assert.deepEqual(splitParameters('--a "b c" d'), ['--a', 'b c', 'd'])
  assert.deepEqual(splitParameters('  '), [])
  assert.deepEqual(splitParameters('a\\"b'), ['a"b'])
  assert.deepEqual(splitParameters('--p ""'), ['--p', ''], '空引号是一段空参数，不丢')
})

test('环境变量：passParentEnvs=false 时只留配置里显式给的（JarApplicationConfiguration:230-238）', () => {
  const config = withJar()
  assert.deepEqual(
    jarEnvironment(config, ['A=1'], ['PATH=x', 'A=1']),
    ['PATH=x', 'A=1'],
    '默认继承父进程，去重后保持顺序',
  )
  assert.deepEqual(jarEnvironment({ ...config, passParentEnvs: false }, ['A=1'], ['PATH=x']), ['A=1'])
})
