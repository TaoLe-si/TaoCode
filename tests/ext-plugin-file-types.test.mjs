// 插件声明文件类型（`com.intellij.fileType` EP / `FileTypeBean`）在本仓的装载与回收。
// 判据逐条对着 `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java`：
// 两种用法（:26-43）、重名是错误（:49-54）、声明方插件跟着走（:57）。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPluginFileTypes,
  pluginFileTypeContributions,
  pluginFileTypeOwner,
  pluginIsLoadable,
  resetPluginFileTypeContributions,
} from '../src/fileTypePluginBeans.ts'
import { fileTypeManager } from '../src/fileTypeRegistry.ts'
import { detectFileType } from '../src/fileTypeDetection.ts'
import { overridableFileTypes } from '../src/fileTypeOverrides.ts'

function cleanup() {
  resetPluginFileTypeContributions()
}

test('新类型：插件声明带 implementationClass 的文件类型，注册表当场认领它的关联', () => {
  resetPluginFileTypeContributions()
  const plugin = { id: 'tpl', name: '模板工具', enabled: true, fileTypes: [
    { name: 'Groovy', implementationClass: 'org.example.GroovyFileType', extensions: 'groovy;gy', language: 'other' },
  ] }
  try {
    const report = applyPluginFileTypes([plugin])
    assert.equal(report.added.length, 1)
    assert.equal(report.added[0].kind, 'type')
    assert.deepEqual(report.added[0].associations, ['*.groovy', '*.gy'])
    assert.equal(fileTypeManager.getFileTypeByFileName('Jenkins.groovy')?.name, 'Groovy')
    assert.equal(fileTypeManager.getFileTypeByFileName('Main.gy')?.name, 'Groovy')
    // 声明方插件名跟着类型走（上游 PluginAware，FileTypeBean.java:57）。
    assert.equal(fileTypeManager.getType('Groovy')?.vendor, '模板工具')
    assert.deepEqual(pluginFileTypeContributions(), [{ pluginName: '模板工具', typeName: 'Groovy', kind: 'type' }])
  } finally {
    fileTypeManager.unregister('Groovy')
    cleanup()
  }
})

test('幂等：同一份清单连调两次不会重复认领，也不会把用户改过的关联抢回来', () => {
  resetPluginFileTypeContributions()
  const plugin = { id: 'p2', name: 'P2', enabled: true, fileTypes: [{ name: 'Conf2', extensions: 'conf2' }] }
  try {
    assert.equal(applyPluginFileTypes([plugin]).added.length, 1)
    const second = applyPluginFileTypes([plugin])
    assert.equal(second.added.length, 0, '已认领过的不再认领')
    assert.equal(second.removed.length, 0)
  } finally {
    fileTypeManager.unregister('Conf2')
    resetPluginFileTypeContributions()
  }
})

test('只补关联的用法：目标类型已存在时不新建类型，收回时也不注销它（FileTypeBean.java:36-41）', () => {
  resetPluginFileTypeContributions()
  const plugin = { id: 'p3', name: 'P3', enabled: true, fileTypes: [{ name: 'JSON', fileNames: 'jsonl' }] }
  try {
    const report = applyPluginFileTypes([plugin])
    assert.equal(report.added[0].kind, 'association')
    assert.deepEqual(report.added[0].associations, ['jsonl'])
    assert.equal(fileTypeManager.getFileTypeByFileName('jsonl')?.id, 'JSON')
    assert.equal(applyPluginFileTypes([{ ...plugin, enabled: false }]).removed[0].kind, 'association')
    assert.ok(fileTypeManager.getType('JSON'), '标准类型不该被收回')
    assert.equal(fileTypeManager.getFileTypeByFileName('jsonl'), null, '补的关联已摘掉')
    assert.equal(fileTypeManager.getFileTypeByFileName('a.json')?.id, 'JSON', 'JSON 自己名下的关联还在')
  } finally {
    resetPluginFileTypeContributions()
  }
})

test('停用 / 坏清单 / 依赖不满足的插件都不贡献（上游不加载就没有 EP）', () => {
  assert.equal(pluginIsLoadable({ id: 'a', name: 'A', enabled: false }), false)
  assert.equal(pluginIsLoadable({ id: 'a', name: 'A', error: '坏清单' }), false)
  assert.equal(pluginIsLoadable({ id: 'a', name: 'A', broken: '缺依赖' }), false)
  assert.equal(pluginIsLoadable({ id: 'a', name: 'A', enabled: true }), true)
  resetPluginFileTypeContributions()
  const plugin = { id: 'p4', name: 'P4', enabled: true, fileTypes: [{ name: 'Tpl4', extensions: 'tpl4' }] }
  try {
    applyPluginFileTypes([plugin])
    assert.equal(fileTypeManager.getFileTypeByFileName('x.tpl4')?.name, 'Tpl4')
    const off = applyPluginFileTypes([{ ...plugin, enabled: false }])
    assert.deepEqual(off.removed[0].associations, ['*.tpl4'])
    assert.equal(fileTypeManager.getFileTypeByFileName('x.tpl4'), null)
  } finally {
    fileTypeManager.unregister('Tpl4')
    resetPluginFileTypeContributions()
  }
})

test('重名的两条声明：只让第一条生效，第二条按上游那条错误报出来（:49-54）', () => {
  resetPluginFileTypeContributions()
  const first = { id: 'p5a', name: 'P5A', enabled: true, fileTypes: [{ name: 'Dup', extensions: 'dup' }] }
  const second = { id: 'p5b', name: 'P5B', enabled: true, fileTypes: [{ name: 'Dup', extensions: 'dup2' }] }
  try {
    const report = applyPluginFileTypes([first, second])
    assert.equal(report.rejected.length, 1)
    assert.equal(report.rejected[0].pluginName, 'P5B')
    assert.match(report.rejected[0].reason, /同一个名字只能有一个类型/)
    assert.equal(fileTypeManager.getFileTypeByFileName('a.dup2'), null)
  } finally {
    fileTypeManager.unregister('Dup')
    resetPluginFileTypeContributions()
  }
})

test('插件不能重新声明平台自带的类型（上游重名即 PluginException）', () => {
  resetPluginFileTypeContributions()
  const plugin = { id: 'p6', name: 'P6', enabled: true, fileTypes: [{ name: 'JAVA', implementationClass: 'x.JavaFileType', extensions: 'j' }] }
  try {
    const report = applyPluginFileTypes([plugin])
    assert.equal(report.added.length, 0)
    assert.match(report.rejected[0].reason, /平台自带的类型/)
    assert.equal(fileTypeManager.getFileTypeByFileName('a.j'), null)
    assert.equal(fileTypeManager.getType('JAVA')?.vendor, 'JetBrains', '标准类型的厂商没被插件顶掉')
  } finally {
    resetPluginFileTypeContributions()
  }
})

test('hashBangs 也一起贡献与回收：带 shebang 的文件当场按它认类型', () => {
  resetPluginFileTypeContributions()
  const plugin = { id: 'p7', name: 'P7', enabled: true, fileTypes: [{ name: 'Ruby', extensions: 'rb', hashBangs: 'ruby' }] }
  const content = '#!/usr/bin/env ruby\nputs 1\n'
  try {
    assert.equal(detectFileType('script', content).type, 'Script', '没插件时走内置解释器表')
    const report = applyPluginFileTypes([plugin])
    assert.deepEqual(report.added[0].associations, ['*.rb', '#!ruby'])
    assert.equal(detectFileType('script', content).type, 'Ruby')
    assert.equal(pluginFileTypeOwner('Ruby'), 'P7')
    applyPluginFileTypes([{ ...plugin, enabled: false }])
    assert.equal(detectFileType('script', content).type, 'Script', 'hashbang 随插件一起收回，不留孤儿模式')
  } finally {
    fileTypeManager.unregister('Ruby')
    resetPluginFileTypeContributions()
  }
})

test('插件带进来的类型在「覆盖文件类型」列表里标出来源（OverrideFileTypeAction.java:64-72）', () => {
  resetPluginFileTypeContributions()
  const plugins = [
    { id: 'p8', name: 'P8', enabled: true, fileTypes: [{ name: 'Zeta', extensions: 'zt1' }] },
    { id: 'p9', name: 'P9', enabled: true, fileTypes: [{ name: 'zeta', fileNames: 'zeta.cfg' }] },
  ]
  try {
    applyPluginFileTypes(plugins)
    const options = overridableFileTypes()
    const withHint = options.filter(option => option.duplicateHint)
    // 显示名重名（大小写不敏感判重）时两条都要带来源提示，且插件类型说的是「来自插件 X」。
    assert.equal(withHint.length, 2)
    assert.ok(withHint.some(option => option.duplicateHint.includes('来自插件 P8')), '第一个插件的名字要出现在提示里')
    assert.ok(withHint.some(option => option.duplicateHint.includes('来自插件 P9')))
    assert.ok(options.some(option => option.label.includes('Zeta')), '目标类型仍能被列出')
  } finally {
    fileTypeManager.unregister('Zeta')
    fileTypeManager.unregister('zeta')
    resetPluginFileTypeContributions()
  }
})
