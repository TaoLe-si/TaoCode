// 文件模板编目与加载（`src/fileTemplateRegistry.ts`）：五个类别与目录前缀、`.ft`/`.html`
// 文件名规则、两份方案目录、`#parse` 只认 Includes、插件内置只读、宿主内建 kind 单列。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DESCRIPTION_FILE_EXTENSION, FILE_TEMPLATE_CATEGORIES, FILE_TEMPLATES_DIR, HOST_FILE_TEMPLATE_KINDS,
  TEMPLATE_FILE_EXTENSION, categoryInfo, entriesByCategory, fileTemplatesState, isTemplateEditable,
  mergeEntries, resolveInclude, schemeDirs, splitTemplateFileName, templateDescriptionFileName,
  templateEditBlockReason, templateFileName, templateQName, templatesDirFor,
} from '../src/fileTemplateRegistry.ts'

test('五个类别与目录前缀照抄 FileTemplatesLoader.kt:146-152 / FileTemplateManager.java:22-26', () => {
  assert.equal(FILE_TEMPLATES_DIR, 'fileTemplates')
  assert.equal(TEMPLATE_FILE_EXTENSION, 'ft')
  assert.equal(DESCRIPTION_FILE_EXTENSION, 'html')
  assert.deepEqual(FILE_TEMPLATE_CATEGORIES.map(info => info.name), ['Default', 'Internal', 'Includes', 'Code', 'J2EE'])
  assert.deepEqual(FILE_TEMPLATE_CATEGORIES.map(info => info.dir), ['', 'internal', 'includes', 'code', 'j2ee'])
  assert.equal(templatesDirFor('Default'), 'fileTemplates')
  assert.equal(templatesDirFor('Includes'), 'fileTemplates/includes')
  assert.equal(templatesDirFor('J2EE'), 'fileTemplates/j2ee')
  assert.equal(categoryInfo('Internal').readOnly, true, 'FileTemplatesLoader.kt:163 传 isInternal')
  assert.equal(categoryInfo('Includes').includable, true, 'VelocityWrapper.java:82 走 getPattern')
})

test('qname / 文件名 / 描述文件名（FTManager.java:47、FileTemplatesLoader.kt:128-135,279-288）', () => {
  assert.equal(templateQName('Class', 'java'), 'Class.java')
  assert.equal(templateQName('Dockerfile', ''), 'Dockerfile')
  assert.equal(templateFileName('Class', 'java'), 'Class.java.ft')
  assert.equal(templateFileName('Dockerfile', ''), 'Dockerfile.ft')
  assert.equal(templateDescriptionFileName('Class', 'java'), 'Class.java.html')
  assert.deepEqual(splitTemplateFileName('Class.java.ft'), { name: 'Class', extension: 'java' })
  assert.deepEqual(splitTemplateFileName('internal/Record.java.ft'), { name: 'Record', extension: 'java' })
  assert.deepEqual(splitTemplateFileName('Dockerfile.ft'), { name: 'Dockerfile', extension: '' }, '无扩展名整体当名字')
  assert.deepEqual(splitTemplateFileName('Dockerfile'), { name: 'Dockerfile', extension: '' }, '没带 .ft 也认')
})

test('#parse 只认 Includes 类别（VelocityWrapper.java:82 → getPattern → patternsManager）', () => {
  const entries = [
    { name: 'File Header', extension: 'java', category: 'Default', content: 'wrong lane' },
    { name: 'File Header', extension: 'java', category: 'Includes', content: '// right\n' },
  ]
  assert.equal(resolveInclude(entries, 'File Header.java'), '// right\n')
  assert.equal(resolveInclude([{ ...entries[0] }], 'File Header.java'), undefined, 'Default 类别不算可包含')
  assert.equal(resolveInclude(entries, 'Nope.java'), undefined)
})

test('只读判定与原因：Internal 类别 + 插件内置（PluginBundledTemplate.java:9-11）', () => {
  const plain = { name: 'A', extension: 'java', category: 'Default', content: '' }
  const internal = { ...plain, category: 'Internal' }
  const bundled = { ...plain, bundled: 'com.example.plugin' }
  assert.equal(isTemplateEditable(plain), true)
  assert.equal(isTemplateEditable(internal), false)
  assert.equal(isTemplateEditable(bundled), false)
  assert.match(templateEditBlockReason(internal), /Internal 类别由 IDE 提供/)
  assert.match(templateEditBlockReason(bundled), /com\.example\.plugin/)
  assert.equal(templateEditBlockReason(plain), null)
})

test('用户模板覆盖同名内置（mergeFileTemplates 的同一条规则）', () => {
  const bundled = [
    { name: 'Class', extension: 'java', category: 'Internal', content: 'bundled' },
    { name: 'Enum', extension: 'java', category: 'Internal', content: 'bundled enum' },
  ]
  const merged = mergeEntries(bundled, [{ id: 'u1', name: 'Class', extension: 'java', content: 'mine' }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].content, 'mine')
  assert.equal(merged[1].content, 'bundled enum')
  assert.equal(resolveInclude(merged, 'Class.java'), undefined, '用户模板落在 Default，不能被 #parse')
})

test('两份方案目录（FileTemplatesLoader.kt:139-144、FileTemplatesScheme.java:16-26）', () => {
  const dirs = schemeDirs('D:/proj')
  assert.deepEqual(dirs.map(item => item.scope), ['default', 'project'])
  assert.equal(dirs[0].dir, '<配置目录>/fileTemplates')
  assert.equal(dirs[1].dir, 'D:/proj/fileTemplates')
  assert.equal(schemeDirs(null)[1].dir, '<工程目录>/fileTemplates')
})

test('持久化：localStorage 按方案分键，非法条目被丢弃，容量有上限', () => {
  const store = {}
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value },
  }
  try {
    const state = fileTemplatesState('project', 'D:\\proj')
    assert.deepEqual(state.templates.value, [])
    assert.equal(state.submit({ id: 'a', name: 'Note', extension: 'md', content: '# ${NAME}' }), null)
    assert.equal(state.templates.value.length, 1)
    // 反斜杠工程路径归一化后与正斜杠同键（FileTemplatesLoader 用 Path 比较，不区分分隔符）
    assert.deepEqual(fileTemplatesState('project', 'D:/proj').templates.value.length, 1)
    assert.deepEqual(fileTemplatesState('default', null).templates.value, [], '两个方案分键')
    assert.equal(state.submit({ id: 'b', name: '', extension: 'md', content: 'x' }), '模板名不能为空。')
    // 写坏一条再读：非法条目被过滤掉
    store[Object.keys(store)[0]] = JSON.stringify([
      { id: 'ok', name: 'Fine', extension: 'md', content: 'x' },
      { id: 'bad', name: '', extension: 'md', content: 'x' },
      'not an object',
    ])
    assert.equal(fileTemplatesState('project', 'D:/proj').templates.value.length, 1)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})

test('按类别分组并按 qname 排序，空类别不出现', () => {
  const entries = [
    { name: 'Zed', extension: 'java', category: 'Default', content: '' },
    { name: 'Alpha', extension: 'java', category: 'Default', content: '' },
    { name: 'Class', extension: 'java', category: 'Internal', content: '' },
  ]
  const groups = entriesByCategory(entries)
  assert.deepEqual(groups.map(group => group.category), ['Default', 'Internal'])
  assert.deepEqual(groups[0].entries.map(entry => entry.name), ['Alpha', 'Zed'])
})

test('宿主内建 kind 与上游 native 的 16 个 template_kind 对齐（native/workspace.cpp:998-1079）', () => {
  const kinds = HOST_FILE_TEMPLATE_KINDS.map(item => item.kind)
  assert.equal(kinds.length, 16)
  assert.equal(new Set(kinds).size, 16, '不重复')
  for (const expected of ['java-class', 'java-annotation', 'kotlin-data', 'typescript-enum', 'vue-component', 'react-component', 'html-file', 'markdown-file']) {
    assert.ok(kinds.includes(expected), `${expected} 应当在内建表里`)
  }
  assert.ok(HOST_FILE_TEMPLATE_KINDS.every(item => item.label && item.extension))
})
