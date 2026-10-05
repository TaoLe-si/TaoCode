// 打开项目时**从上下文发现可运行目标**（IDEA `RunConfigurationProducer` 的项目级那一半）。
//
// 回归重点：打开一个已有项目后，▶ 不能弹"请选择一个运行配置" —— 那正是 2026-09-27 桃报的问题。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MAX_CONTENT_FILES,
  cmakeArtifacts,
  discoverRunTargets,
  filesNeedingContent,
  gradleApplicationTask,
  hasPythonMain,
  packageScripts,
} from '../src/runTargets.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const java = { jdkHome: 'C:\\jdk-21', outputPaths: ['out/production/demo'], classpath: ['lib/a.jar'] }

test('只给"可能含入口"的文件读内容，且有上限', () => {
  const files = ['src/Main.java', 'README.md', 'package.json', 'tool.py', 'build.gradle', 'pom.xml', 'a.txt']
  assert.deepEqual(filesNeedingContent(files),
    ['build.gradle', 'package.json', 'pom.xml', 'src/Main.java', 'tool.py'])
  assert.equal(filesNeedingContent(Array.from({ length: 200 }, (_, i) => `src/C${i}.java`)).length, MAX_CONTENT_FILES)
})

test('package.json 的 scripts', () => {
  assert.deepEqual(packageScripts('{"scripts":{"dev":"vite","build":"vite build","bad":3}}'),
    [{ name: 'dev', command: 'vite' }, { name: 'build', command: 'vite build' }])
  assert.deepEqual(packageScripts('不是 JSON'), [])
  assert.deepEqual(packageScripts('{}'), [])
})

test('Python 入口判定', () => {
  assert.equal(hasPythonMain('if __name__ == "__main__":\n    main()\n'), true)
  assert.equal(hasPythonMain("if __name__ == '__main__': pass"), true)
  assert.equal(hasPythonMain('def main(): pass'), false)
})

test('Gradle 的 application / bootRun 任务', () => {
  assert.equal(gradleApplicationTask('plugins { id("application") }'), 'run')
  assert.equal(gradleApplicationTask("apply plugin: 'application'"), 'run')
  assert.equal(gradleApplicationTask('plugins { id "org.springframework.boot" }'), 'bootRun')
  assert.equal(gradleApplicationTask('plugins { id("java") }'), '', '没有 application 插件就别报 run 任务')
})

test('CMake 构建产物只认 build/ 与 out/ 下的 exe', () => {
  assert.deepEqual(cmakeArtifacts(['build/app.exe', 'out/tool.exe', 'build/CMakeFiles/x.exe', 'src/a.cpp']),
    ['build/app.exe', 'out/tool.exe'])
})

test('Java 源文件有 main 时给出可运行目标，命令与"构建"用同一份输出目录与类路径', () => {
  const targets = discoverRunTargets({
    files: ['src/Main.java'],
    contents: { 'src/Main.java': 'package com.example;\npublic class Main {\n  public static void main(String[] args) {}\n}\n' },
    java,
  })
  assert.equal(targets.length, 1)
  const target = targets[0]
  assert.equal(target.kind, 'java')
  assert.equal(target.name, 'Main（Main.java）')
  assert.equal(target.command, '"C:\\jdk-21\\bin\\java.exe" -cp "out/production/demo;lib/a.jar" com.example.Main')
  assert.equal(target.program, 'C:\\jdk-21\\bin\\java.exe')
  assert.deepEqual(target.args, ['-cp', 'out/production/demo;lib/a.jar', 'com.example.Main'])
  assert.equal(target.source, 'src/Main.java')
})

test('没有 main 的 Java 文件不报候选（宁可少报，也不给点下去就错的项）', () => {
  const targets = discoverRunTargets({
    files: ['src/Util.java'],
    contents: { 'src/Util.java': 'package com.example;\npublic class Util { void help() {} }\n' },
    java,
  })
  assert.deepEqual(targets, [])
})

test('Node / Python / Gradle / CMake 四类目标', () => {
  const targets = discoverRunTargets({
    files: ['package.json', 'tool.py', 'build.gradle', 'build/app.exe', 'gradlew.bat'],
    contents: {
      'package.json': '{"scripts":{"start":"node index.js"}}',
      'tool.py': 'if __name__ == "__main__":\n    pass\n',
      'build.gradle': 'plugins { id("application") }',
    },
    java,
  })
  assert.deepEqual(targets.map(target => target.kind).sort(), ['cmake', 'gradle', 'node', 'python'])
  assert.equal(targets.find(target => target.kind === 'node').command, 'npm run start')
  assert.equal(targets.find(target => target.kind === 'gradle').command, 'gradlew.bat --console=plain run')
  assert.equal(targets.find(target => target.kind === 'cmake').program, 'build/app.exe')
  assert.equal(targets.find(target => target.kind === 'python').program, 'python')
})

test('接线：宿主打开项目时发现候选，无配置时运行按钮回退到上下文', () => {
  const configs = read('src/runConfigurations.ts')
  assert.match(configs, /discoverRunTargetsForProject/)
  assert.match(configs, /filesNeedingContent/)
  assert.match(configs, /allRunConfigNames/)
  // 自动候选**不落盘**：没有走 persistRunConfigs
  // 发现流程只把候选挂进会话表；真正写盘的是 saveRunConfigFromDialog（saveRunConfigFromDialog 之后的那段）。
  const discoverBlock = configs.slice(configs.indexOf('async function discoverRunTargetsForProject'), configs.indexOf('const runWidgetTitle'))
  assert.ok(!persistIn(discoverBlock), '发现流程不能写用户配置')
  // 运行按钮在没有选中配置时**不弹提示**，而是从上下文生成
  const actions = read('src/runActions.ts')
  assert.match(actions, /if \(!found\) \{ await runContextConfiguration\(debug\); return \}/)
  const actionsCode = actions.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  assert.ok(!/请选择一个运行配置/.test(actionsCode), '"请选择一个运行配置"这条拦截必须从代码里消失')
})

/** 片段里有没有调用 `persistRunConfigs(`。 */
function persistIn(block) {
  const end = block.indexOf('\n}\n')
  return (end > 0 ? block.slice(0, end) : block).includes('persistRunConfigs(')
}
