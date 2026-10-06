// JAR 运行配置（`src/jarRun.ts`）—— 上游 `java/execution/impl/src/com/intellij/execution/jar/`
// 的可移植部分。断言体守**意图**（上游哪一条判据），坐标见 src/jarRun.ts 的文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  JAR_APPLICATION_TYPE_DESCRIPTION, JAR_APPLICATION_TYPE_ID, JAR_APPLICATION_TYPE_LABEL, JAR_FORM_FIELDS,
  isJarRunConfig, jarCanRunOn, jarEnvironment, jarRunArgs, jarRunCommand, jarRunConfigParams, jarRunConfigPath,
  jarRunConfigProblem, jarRunConfigWorkingDirectory, jarTemplateConfiguration, jarValidation, JAR_RUN_CONFIG_TYPE_ID, splitParameters,
} from '../src/jarRun.ts'
import { javaExecutable } from '../src/javaRun.ts'

const withJar = (over = {}) => ({ ...jarTemplateConfiguration('C:/proj'), jarPath: 'C:/proj/app.jar', ...over })
/** 本仓 `RunConfig` 形状的那条 JAR 记录（`src/settingsModel.ts` 的字段，不新增键）。 */
const jarRecord = (over = {}) => ({
  name: '跑 app.jar', type: JAR_RUN_CONFIG_TYPE_ID, command: '',
  program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'], ...over,
})

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

// ── 本仓 `RunConfig` 形状那一套（表单 / schema / 持久化 / 执行参数 共用的单一来源） ──────────
//
// 上面那半守的是**上游 bean**（`JarApplicationConfiguration.java:270-278` 的七个字段），这一半守的是
// 本仓把 JAR 折算成现成字段后的形状：`program` = Java 可执行文件（上游 JRE 那一格，
// `JarApplicationConfigurable.java:67-71` 的 `JrePathEditor`）、`args` = VM 参数 → `-jar` → 路径 → 程序参数
// （与 `jarRunArgs():187` 产出的 argv 同形）。五处一致的判据本体在 tests/run-config-types.test.mjs，
// 这里只核这几个纯函数自己。

test('类型判定按字符串：联合里还没加 jar 时也要能认出 jar 记录（绕开 TS2367 的那个形状）', () => {
  assert.equal(isJarRunConfig(jarRecord()), true)
  assert.equal(isJarRunConfig({ name: 'a', type: 'application', command: '', program: 'a.exe' }), false)
  assert.equal(isJarRunConfig({ name: 'a', command: 'x' }), false, 'type 缺省不是 jar')
  assert.equal(JAR_RUN_CONFIG_TYPE_ID, 'jar', '本仓前端的 id；上游注册的 id 是 JarApplication（JAR_APPLICATION_TYPE_ID）')
})

test('JAR 路径取 args 里的 -jar 那一段；只有命令串时按 parse 口径切', () => {
  assert.equal(jarRunConfigPath(jarRecord()), 'build/app.jar')
  assert.equal(jarRunConfigPath(jarRecord({ args: ['-Xmx512m', '-jar', 'C:/my proj/app.jar', '--port', '8080'] })), 'C:/my proj/app.jar')
  assert.equal(jarRunConfigPath(jarRecord({ args: [], command: 'java -jar "build/my app.jar" --x' })), 'build/my app.jar')
  assert.equal(jarRunConfigPath(jarRecord({ args: ['-jar'] })), '', '末尾光一个 -jar = 没填路径，不算路径')
  assert.equal(jarRunConfigPath(jarRecord({ args: ['-jar', ''] })), '', '空串路径同样算没填')
  assert.equal(jarRunConfigPath(jarRecord({ args: [], command: '' })), '')
})

test('缺 JAR 路径 ⇒ 明确报错；非 jar 类型一律不报（这条不能把别的类型也拦了）', () => {
  assert.match(jarRunConfigProblem(jarRecord({ args: ['-jar'] })), /没有 JAR 路径/)
  assert.ok(jarRunConfigProblem(jarRecord({ args: ['-jar'] })).includes('跑 app.jar'), '报错要点出是哪条配置')
  assert.ok(jarRunConfigProblem(jarRecord({ args: ['-jar'] })).includes('Path to JAR'), '文案指得到上游表单那一格（ExecutionBundle.properties:564）')
  assert.equal(jarRunConfigProblem(jarRecord()), null)
  assert.equal(jarRunConfigProblem({ name: 'a', type: 'shell', command: 'echo hi' }), null)
})

test('执行参数：program + args + shell=false，顺序与 jarRunArgs 同形（VM 参数 → -jar 路径 → 程序参数）', () => {
  assert.deepEqual(jarRunConfigParams(jarRecord()), { program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'], shell: false })
  assert.deepEqual(
    jarRunConfigParams(jarRecord({ args: ['-Xmx512m', '-jar', 'app.jar', '--port', '8080'] })),
    { program: 'C:/jdk/bin/java.exe', args: ['-Xmx512m', '-jar', 'app.jar', '--port', '8080'], shell: false },
  )
  // 只有命令串（整行写在命令格）：剥掉开头那个 java 启动器，因为可执行文件单独走 program。
  assert.deepEqual(
    jarRunConfigParams(jarRecord({ program: 'C:/jdk/bin/java.exe', args: [], command: 'java -jar app.jar -x' })),
    { program: 'C:/jdk/bin/java.exe', args: ['-jar', 'app.jar', '-x'], shell: false },
  )
  // 开头不是 java/javaw（自己包的 wrapper）⇒ **不剥**，用户的参数一个字都不能被吃掉。
  assert.deepEqual(jarRunConfigParams(jarRecord({ program: 'C:/jdk/bin/java.exe', args: [], command: 'wrapper.exe -jar app.jar' })).args,
    ['wrapper.exe', '-jar', 'app.jar'])
})

test('执行参数不许静默：缺 JAR 路径 / 既没填可执行文件也没有项目 JDK 都抛错', () => {
  assert.throws(() => jarRunConfigParams(jarRecord({ args: ['-jar'] })), /没有 JAR 路径/)
  assert.throws(() => jarRunConfigParams(jarRecord({ program: '' })), /没有 Java 可执行文件/)
  // JRE 那格留空 ⇒ 退到项目 JDK（上游 JarApplicationCommandLineState.java:20-21 的 createProjectJdk(project, jreHome)）。
  assert.deepEqual(jarRunConfigParams(jarRecord({ program: '' }), { jdkHome: 'C:/jdk' }),
    { program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'], shell: false })
  assert.deepEqual(jarRunConfigParams(jarRecord(), { jdkHome: 'C:/ignored' }).program, 'C:/jdk/bin/java.exe',
    '配置自己填了就用配置的，不被项目 JDK 覆盖')
  // 对照：bean 版 jarRunArgs 在 JDK 空时给的是**空数组**（静默），本仓启动链路要的是原因，所以两层并存。
  assert.deepEqual(jarRunArgs({ config: withJar() }), [])
})

test('工作目录：cwd 空就空（上游 WORKING_DIRECTORY 空不擅自填项目根，见 jarTemplateConfiguration 的 onNewConfigurationCreated）', () => {
  assert.equal(jarRunConfigWorkingDirectory(jarRecord({ cwd: 'C:/proj/out ' })), 'C:/proj/out')
  assert.equal(jarRunConfigWorkingDirectory(jarRecord({ cwd: '' })), '')
  assert.equal(jarRunConfigWorkingDirectory(jarRecord()), '')
})
