// EP 判据：`com.intellij.appStarter` 的宿主（`src/applicationStarters.ts`）。
//
// 上游依据：EP 声明 `platform/ide-core/resources/intellij.platform.ide.core.xml:51`
// `<extensionPoint qualifiedName="com.intellij.appStarter"
//  beanClass="com.intellij.openapi.application.ApplicationStarterEP" dynamic="true"/>`。
// 三件事：① 内置启动命令仍在；② 第三方按 EP id 挂的命令被 `applicationStarters.find()` 与
// `runApplicationStarter()` 真实拿到；③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  APPLICATION_STARTER_EP, applicationStarters, applicationStartersFromExtensions,
  registerApplicationStarter, runApplicationStarter, unregisterApplicationStarter,
} from '../src/applicationStarters.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(APPLICATION_STARTER_EP, 'com.intellij.appStarter')
})

test('bundled 启动命令仍在 EP 上且 find 拿得到', () => {
  const commands = applicationStartersFromExtensions().map(starter => starter.command)
  assert.ok(commands.includes('list-commands'), '内置 list-commands 挂在 EP 上')
  assert.ok(commands.includes('generateEnvironmentKeysFile'), '环境键存根启动器挂在 EP 上')
  assert.ok(applicationStarters.find('list-commands'), 'find 走内置表/EP 拿得到')
})

test('第三方按 EP id 注册后被真实消费点拿到', async () => {
  const handle = registerApplicationStarter({
    command: 'acme-hello', description: 'Third-party starter.', main: () => 'hello-from-plugin',
  })
  try {
    assert.equal(applicationStarters.find('acme-hello')?.command, 'acme-hello', 'find 拿到第三方命令')
    assert.ok(applicationStarters.listCommands().some(line => line.startsWith('acme-hello')), 'list-commands 列出')
    const result = await runApplicationStarter('acme-hello')
    assert.equal(result.handled, true)
    assert.equal(result.output, 'hello-from-plugin', '真实消费点跑到第三方 main')
  } finally {
    handle.dispose()
  }
  assert.equal(applicationStarters.find('acme-hello'), null, '注销后 find 回 null')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterApplicationStarter('does-not-exist'), false)
})
