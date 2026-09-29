// Java launch regressions: real javac/java processes plus the console event lifecycle.
// This suite does not build or execute the native host; its process-boundary checks
// use the same generated build/run commands with a correctly framed cmd /s /c payload.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildPlan, javacArgFilePath, runtimeOutputPaths } from '../src/projectBuild.ts'
import { javaRunCommand, mainClassFor } from '../src/javaRun.ts'
import { GRADLE_RUN_DEFAULTS } from '../src/gradle.ts'
import { discoverRunTargets } from '../src/runTargets.ts'
import {
  activeRunInstance, beginRun, focusRunInstance, handleRunExit, handleRunOutput,
  handleRunStarted, runInstances, runOutput, runState,
} from '../src/runInstances.ts'

function resetRuns() {
  runInstances.clear()
  activeRunInstance.value = 0
  runOutput.splice(0)
  runState.running = false
  runState.exit = null
}

test('run.start reply arriving after output/exit preserves Main output and terminal state', () => {
  resetRuns()
  handleRunStarted({ instance: 1, label: 'Main' })
  handleRunOutput(1, 'HELLO_MAIN\r\n')
  handleRunExit({ instance: 1, code: 0, remaining: 0 })
  beginRun(1) // runActions receives the run.start reply after the events
  assert.deepEqual([...runOutput], ['HELLO_MAIN\r\n'])
  assert.equal(runState.running, false)
  assert.equal(runState.exit, 0)
  assert.equal(runInstances.get(1).label, 'Main')
})

test('pending new run does not erase another instance console', () => {
  resetRuns()
  handleRunStarted({ instance: 1, label: 'Main' })
  handleRunOutput(1, 'previous diagnostics\r\n')
  handleRunExit({ instance: 1, code: 1 })
  beginRun()
  assert.deepEqual([...runOutput], ['previous diagnostics\r\n'])
})

test('duplicate run.started is idempotent, including after process exit', () => {
  resetRuns()
  handleRunStarted({ instance: 1, label: 'Main' })
  handleRunOutput(1, 'HELLO_MAIN\r\n')
  handleRunExit({ instance: 1, code: 0 })
  handleRunStarted({ instance: 1, label: 'Main' })
  assert.deepEqual([...runOutput], ['HELLO_MAIN\r\n'])
  assert.equal(runState.running, false)
  assert.equal(runState.exit, 0)
})

test('switching console switches its aggregate exit code', () => {
  resetRuns()
  handleRunStarted({ instance: 1, label: 'compile' })
  handleRunExit({ instance: 1, code: 3 })
  handleRunStarted({ instance: 2, label: 'other task' })
  focusRunInstance(1)
  assert.equal(runState.exit, 3)
  assert.equal(runState.running, true)
})

test('discovery does not offer a helper merely because a comment mentions main', () => {
  assert.deepEqual(discoverRunTargets({
    files: ['Helper.java'],
    contents: { 'Helper.java': 'class Helper { /* used by main */ }' },
    java: { jdkHome: '', outputPaths: ['out'], classpath: [] },
  }), [])
})

const fixtures = []
let fixtureRoot
function fixture() {
  if (fixtureRoot) return fixtureRoot
  fixtureRoot = mkdtempSync(join(tmpdir(), 'taocode-java-run-'))
  fixtures.push(fixtureRoot)
  return fixtureRoot
}
process.on('exit', () => { for (const dir of fixtures) rmSync(dir, { recursive: true, force: true }) })
function jdkHome() {
  // Resolve the real installed javac from PATH; do not invent or install a JDK.
  const paths = execFileSync('where.exe', ['javac.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)
  assert.ok(paths[0], 'A JDK on PATH is required for this integration test')
  return dirname(dirname(paths[0]))
}
function shell(command, cwd) {
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
    cwd, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 15000,
  })
}
function requireSuccess(result, label) {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${label}\n${result.stdout}\n${result.stderr}`)
}

test('real Main: backslash source paths survive javac argfile, package and output paths survive java', {
  skip: process.platform !== 'win32' ? 'Windows run host contract' : false,
}, () => {
  const cwd = fixture()
  mkdirSync(join(cwd, 'src', 'test'), { recursive: true })
  const source = 'package app; public class Main { public static void main(String[] args) { System.out.println("HELLO_MAIN:" + Helper.value()); } }'
  writeFileSync(join(cwd, 'src', 'test', 'Main.java'), source, 'utf8')
  writeFileSync(join(cwd, 'src', 'test', 'Helper.java'), 'package app; class Helper { static String value() { return "dependency"; } }', 'utf8')
  const request = {
    layout: { gradle: false, maven: false, java: true, cmake: false },
    rebuild: false, detection: null, gradle: GRADLE_RUN_DEFAULTS, gradleDelegated: false,
    jdkHome: jdkHome(), outputPath: 'classes with spaces', classpath: [],
    sources: ['src\\test\\Main.java', 'src\\test\\Helper.java'], projectName: 'Main demo', fallback: '',
  }
  const plan = buildPlan(request)
  writeFileSync(join(cwd, javacArgFilePath()), plan.argFile, 'utf8')
  requireSuccess(shell(plan.command, cwd), 'javac must compile Main and Helper')
  const command = javaRunCommand({
    mainClass: mainClassFor(source, request.sources[0]),
    outputPaths: runtimeOutputPaths(request), classpath: request.classpath, jdkHome: request.jdkHome,
  })
  const result = shell(command, cwd)
  requireSuccess(result, 'java must load app.Main from the exact javac output directory')
  assert.equal(result.stdout.trim(), 'HELLO_MAIN:dependency')
  resetRuns()
  handleRunStarted({ instance: 10, label: 'app.Main' })
  handleRunOutput(10, result.stdout)
  handleRunExit({ instance: 10, code: result.status })
  beginRun(10)
  assert.equal(runOutput.join('').trim(), 'HELLO_MAIN:dependency')
  assert.equal(runState.running, false)
  assert.equal(runState.exit, 0)
})
