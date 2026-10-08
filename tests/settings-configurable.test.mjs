// 设置页契约层（src/settingsConfigurable.ts）的测试 —— 逐条对着上游
// `com.intellij.openapi.options` 那一族的语义与调用顺序。
//
// 上游基准树：D:\Backup\Downloads\intellij-community-master\intellij-community-master
// （只读）。每条断言上方给出该断言守的那条上游规则的行号。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APPLICATION_CONFIGURABLE,
  BaseConfigurable,
  COMPOSITE_SYNC_DELAY_MS,
  CompositeSynchronizer,
  ConfigurableEP,
  ConfigurableWrapper,
  ConfigurationException,
  DEFAULT_CONFIGURATION_ERROR_TITLE,
  PROJECT_CONFIGURABLE,
  SettingsEditor,
  SettingsEditorConfigurable,
  applyConfigurable,
  applyModifiedConfigurables,
  compareConfigurables,
  disposeConfigurables,
  formatConfigurationError,
  getConfigurableId,
  isCheckboxModified,
  isFieldModified,
  isModifiedSafely,
  isSearchable,
  naturalCompare,
  resetConfigurables,
  safeDisplayName,
  searchableDelegate,
  shouldAutoReset,
  sortConfigurables,
  updateActionsFor,
  weightOf,
} from '../src/settingsConfigurable.ts'

/** 最小可用的 Configurable 假件；`id` 在时才算 SearchableConfigurable（ConfigurableWithId.java:17）。 */
function page(init = {}) {
  return { displayName: '页', isModified: () => false, apply: () => {}, ...init }
}

/** 什么都不造的 EP 宿主。 */
const NO_HOST = { instantiateConfigurable: () => null, instantiateProvider: () => null }

// ---------------------------------------------------------------------------
// ConfigurableEP —— 属性集与默认值
// ---------------------------------------------------------------------------

// ConfigurableEP.java:62/:68/:74-75/:127-129/:136-137/:144-145/:153-154/:169-170/:207-208/:238-239/:249-250/:261-262/:274-275/:277-278
test('ConfigurableEP 未写属性时全部落到上游默认值', () => {
  const ep = new ConfigurableEP({ instanceClass: 'a.B' })
  assert.equal(ep.displayName, null)
  assert.equal(ep.key, null)
  assert.equal(ep.bundle, null)
  assert.equal(ep.children, null)
  assert.equal(ep.childrenEPName, null)
  assert.equal(ep.dynamic, false)
  assert.equal(ep.parentId, null)
  assert.equal(ep.id, null)
  assert.equal(ep.groupId, null)
  assert.equal(ep.nonDefaultProject, false)
  assert.equal(ep.implementationClass, null)
  assert.equal(ep.providerClass, null)
  assert.equal(ep.treeRendererClass, null)
})

// ConfigurableEP.java:219-221 默认 true；:229-230 默认 0。
test('searchableInActions 默认 true、groupWeight 默认 0', () => {
  const ep = new ConfigurableEP({ instanceClass: 'a.B' })
  assert.equal(ep.searchableInActions, true)
  assert.equal(ep.groupWeight, 0)
  assert.equal(new ConfigurableEP({ searchableInActions: false, groupWeight: 140 }).groupWeight, 140)
})

// ConfigurableEP.java:306-320 的 createProducer：provider → instance → implementation，全空报错。
test('producerKind 的优先级是 provider → instance → implementation', () => {
  assert.equal(new ConfigurableEP({}).producerKind(), 'none')
  assert.equal(new ConfigurableEP({ implementationClass: 'i.I' }).producerKind(), 'implementation')
  assert.equal(new ConfigurableEP({ instanceClass: 'i.N', implementationClass: 'i.I' }).producerKind(), 'instance')
  assert.equal(new ConfigurableEP({ providerClass: 'p.P', instanceClass: 'i.N' }).producerKind(), 'provider')
})

// ConfigurableEP.java:389-391（canCreateElement）+ :468-471（ClassProducer 恒 true）
// + :429-432（ProviderProducer 转发）+ :319（没类名 = 造不出来）。
test('canCreateConfigurable：没写类名为假，provider 说了算', () => {
  assert.equal(new ConfigurableEP({}).canCreateConfigurable(), false)
  assert.equal(new ConfigurableEP({ instanceClass: 'i.N' }).canCreateConfigurable(), true)
  const ep = new ConfigurableEP({ providerClass: 'p.P' })
  assert.equal(ep.canCreateConfigurable({ createConfigurable: () => null, canCreateConfigurable: () => false }), false)
  assert.equal(ep.canCreateConfigurable({ createConfigurable: () => null }), true) // ConfigurableProvider.java:33-35 默认 true
})

// ConfigurableEP.java:77-104 的 getDisplayName：displayName → bundle+key → 类名回落。
test('getDisplayName：XML 名字优先，其次资源键，最后回落类名', () => {
  assert.equal(new ConfigurableEP({ displayName: '外观' }).getDisplayName(), '外观')
  const ep = new ConfigurableEP({ key: 'k', bundle: 'B', instanceClass: 'a.B' })
  assert.equal(ep.getDisplayName((bundle, key) => (bundle === 'B' && key === 'k' ? '解析名' : null)), '解析名')
  assert.equal(ep.getDisplayName(() => null), 'a.B')
  assert.equal(new ConfigurableEP({ instanceClass: 'a.B' }).getDisplayName(), 'a.B')
})

// ConfigurableEP.java:241-243 的 isAvailable。
test('isAvailable：nonDefaultProject 为真时模板项目里不可用', () => {
  assert.equal(new ConfigurableEP({}).isAvailable(true), true)
  assert.equal(new ConfigurableEP({ nonDefaultProject: true }).isAvailable(true), false)
  assert.equal(new ConfigurableEP({ nonDefaultProject: true }).isAvailable(false), true)
})

// ConfigurableEP.java:354-362（createConfigurable）+ :486-533（SafeProducerWrapper 吞异常）。
test('createConfigurable 按优先级问宿主，生产者抛错时返回 null', () => {
  const made = page()
  const host = {
    instantiateConfigurable: name => (name === 'i.N' ? made : null),
    instantiateProvider: () => ({ createConfigurable: () => made }),
  }
  assert.equal(new ConfigurableEP({ instanceClass: 'i.N' }).createConfigurable(host), made)
  assert.equal(new ConfigurableEP({ implementationClass: 'i.I' }).createConfigurable(host), null) // 宿主不认这个类名
  assert.equal(new ConfigurableEP({ providerClass: 'p.P' }).createConfigurable(host), made)
  assert.equal(new ConfigurableEP({}).createConfigurable(host), null)
  // provider 说不造 ⇒ null（:429-432）
  const reluctant = { ...host, instantiateProvider: () => ({ createConfigurable: () => made, canCreateConfigurable: () => false }) }
  assert.equal(new ConfigurableEP({ providerClass: 'p.P' }).createConfigurable(reluctant), null)
  // 宿主实例化时炸了 ⇒ 吞掉返回 null（:502-505）
  const broken = { ...host, instantiateConfigurable: () => { throw new Error('boom') } }
  assert.equal(new ConfigurableEP({ instanceClass: 'i.N' }).createConfigurable(broken), null)
})

// ConfigurableEP.java:331-335 的 instantiateConfigurableProvider。
test('instantiateConfigurableProvider：只有 provider 属性时才问宿主', () => {
  const provider = { createConfigurable: () => null }
  const host = { instantiateConfigurable: () => null, instantiateProvider: () => provider }
  assert.equal(new ConfigurableEP({ providerClass: 'p.P' }).instantiateConfigurableProvider(host), provider)
  assert.equal(new ConfigurableEP({ instanceClass: 'i.N' }).instantiateConfigurableProvider(host), null)
})

// ConfigurableEP.getConfigurableType — :399-401 + :435-437。
test('getConfigurableType：provider 时问 provider，其余为 null', () => {
  assert.equal(new ConfigurableEP({ instanceClass: 'i.N' }).getConfigurableType(), null)
  const typed = { createConfigurable: () => null, getConfigurableType: () => 'Type' }
  assert.equal(new ConfigurableEP({ providerClass: 'p.P' }).getConfigurableType(typed), 'Type')
})

// Configurable.java:134-137 —— 两个扩展点的名字必须逐字。
test('两个扩展点名字逐字对应上游', () => {
  assert.equal(APPLICATION_CONFIGURABLE, 'com.intellij.applicationConfigurable')
  assert.equal(PROJECT_CONFIGURABLE, 'com.intellij.projectConfigurable')
})

// ---------------------------------------------------------------------------
// ConfigurationException
// ---------------------------------------------------------------------------

// ConfigurationException.java:21-23/:29-33（构造）、:13 与 :110-112（默认标题）、
// :94-100（originator）、:106-108（shouldShowInDumbMode）、OptionsBundle.properties:2。
test('ConfigurationException 的默认标题与字段', () => {
  const error = new ConfigurationException('字体大小超出范围')
  assert.ok(error instanceof Error)
  assert.equal(error.title, DEFAULT_CONFIGURATION_ERROR_TITLE)
  assert.equal(DEFAULT_CONFIGURATION_ERROR_TITLE, 'Cannot Save Settings')
  assert.equal(error.message, '字体大小超出范围')
  assert.equal(error.originator, null)
  assert.equal(error.shouldShowInDumbMode, true)
  assert.equal(new ConfigurationException('m', '自定义标题').title, '自定义标题')
})

// ConfigurableEditor.java:285-290 —— 加粗标题 + 冒号 + 换行 + 消息。
test('formatConfigurationError 拼出上游那条内联错误', () => {
  const error = new ConfigurationException('字体大小超出范围', '无法保存设置')
  assert.equal(formatConfigurationError(error), '无法保存设置:\n字体大小超出范围')
})

// ---------------------------------------------------------------------------
// 三件套：isModified / apply / reset 的调用顺序
// ---------------------------------------------------------------------------

// ConfigurableEditor.java:241-248 —— Apply/Reset 的可用性只看 isModified；reset 后未脏就清错误。
test('updateActionsFor：Apply/Reset 可用性只由 isModified 决定', () => {
  const dirty = page({ isModified: () => true })
  const clean = page({ isModified: () => false })
  assert.deepEqual(updateActionsFor(null), { applyEnabled: false, resetEnabled: false, clearError: false })
  assert.deepEqual(updateActionsFor(dirty), { applyEnabled: true, resetEnabled: true, clearError: false })
  assert.deepEqual(updateActionsFor(clean), { applyEnabled: false, resetEnabled: false, clearError: false })
  assert.deepEqual(updateActionsFor(clean, true), { applyEnabled: false, resetEnabled: false, clearError: true })
})

// newEditor/SettingsEditor.java:675-685 —— isModified 抛错记日志并当「无法判断」。
test('isModifiedSafely：isModified 抛错时返回 null 而不是把对话框带崩', () => {
  assert.equal(isModifiedSafely(page({ isModified: () => true })), true)
  assert.equal(isModifiedSafely(page({ isModified: () => { throw new Error('x') } })), null)
})

// Configurable.java:333-335 两侧 trim；:357-359 勾选态。
test('isFieldModified 两侧 trim，isCheckboxModified 比勾选态', () => {
  assert.equal(isFieldModified(' 40 ', '40'), false)
  assert.equal(isFieldModified('41', '40'), true)
  assert.equal(isCheckboxModified(true, false), true)
  assert.equal(isCheckboxModified(false, false), false)
})

// ConfigurableEditor.java:328-339 的 static apply：只吞 ConfigurationException。
test('applyConfigurable：只吞 ConfigurationException，别的照抛', () => {
  assert.equal(applyConfigurable(null), null)
  assert.equal(applyConfigurable(page()), null)
  const caught = applyConfigurable(page({ apply: () => { throw new ConfigurationException('坏值', '错误') } }))
  assert.equal(caught.title, '错误')
  assert.throws(() => applyConfigurable(page({ apply: () => { throw new Error('真崩了') } })), /真崩了/)
})

// newEditor/SettingsEditor.java:280-322 —— 整轮 apply 的循环、出错选页、成功收 id。
test('整轮 apply：循环不因出错中断，有错时选中最先出错的那页', () => {
  const order = []
  const originator = page({ displayName: '真凶' })
  const clean = page({ displayName: '干净', apply: () => order.push('clean') })
  const failing = page({
    displayName: '出错',
    isModified: () => true,
    apply: () => {
      order.push('fail')
      const error = new ConfigurationException('值非法', '无法保存')
      error.originator = originator
      throw error
    },
  })
  const other = page({ displayName: '另一页', isModified: () => true, apply: () => order.push('other') })
  const result = applyModifiedConfigurables([clean, failing, other])
  assert.deepEqual(order, ['clean', 'fail', 'other'])
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].title, '无法保存')
  assert.equal(result.originator, originator) // :310-313
})

test('整轮 apply：全成功时把「值已写回」的 id 收进来', () => {
  let dirty = true
  const target = page({ id: 'editor.preferences.tabs', isModified: () => dirty, apply: () => { dirty = false } })
  const result = applyModifiedConfigurables([target])
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.modifiedIds, ['editor.preferences.tabs']) // :300-303
  assert.equal(result.originator, null)
})

// ConfigurableCardPanel.java:219-232（reset 吞异常）+ :184-202（dispose 吞异常）。
test('reset / dispose 逐页吞掉单页异常，不拦住其它页', () => {
  const calls = []
  const bad = page({
    reset: () => { throw new Error('reset 崩') },
    disposeUIResources: () => { throw new Error('dispose 崩') },
  })
  const good = page({
    reset: () => calls.push('reset'),
    disposeUIResources: () => calls.push('dispose'),
  })
  resetConfigurables([bad, good])
  disposeConfigurables([bad, good])
  assert.deepEqual(calls, ['reset', 'dispose'])
})

// ---------------------------------------------------------------------------
// id / 搜索
// ---------------------------------------------------------------------------

// ConfigurableVisitor.java:95-99（无 id 回落类名）+ ConfigurableWithId.java:17。
test('getConfigurableId：有 id 用它，没有回落类名', () => {
  assert.equal(getConfigurableId(page({ id: 'editor.preferences.tabs' })), 'editor.preferences.tabs')
  assert.equal(getConfigurableId(page()), 'Object')
  assert.equal(isSearchable(page({ id: 'x' })), true)
  assert.equal(isSearchable(page()), false)
})

// SearchableConfigurable.java:99-162 的 Delegate。
test('searchableDelegate 逐个转发，非搜索页回落类名与 true', () => {
  const ran = []
  const searchable = page({
    id: 'p',
    isModified: () => true,
    apply: () => ran.push('apply'),
    reset: () => ran.push('reset'),
    enableSearch: () => () => ran.push('search'),
  })
  const delegate = searchableDelegate(searchable)
  assert.equal(delegate.displayName, '页')
  assert.equal(delegate.id, 'p')
  assert.equal(delegate.isModified(), true)
  delegate.apply()
  delegate.reset()
  delegate.enableSearch('q')()
  assert.deepEqual(ran, ['apply', 'reset', 'search'])

  const plain = searchableDelegate(page())
  assert.equal(plain.id, 'Object') // :107-111
  assert.equal(plain.enableSearch('q'), null) // :113-118
  assert.equal(plain.isSearchableInActions(), true) // :121-126
})

// SearchUtil.kt:799-801 的 getDisplayNameSafely。
test('safeDisplayName：取名抛错时给空串', () => {
  const broken = { get displayName() { throw new Error('x') }, isModified: () => false, apply: () => {} }
  assert.equal(safeDisplayName(broken), '')
  assert.equal(safeDisplayName(page({ displayName: '外观' })), '外观')
})

// ---------------------------------------------------------------------------
// ConfigurableWrapper —— 惰性 + 释放后重造 + 子项
// ---------------------------------------------------------------------------

// ConfigurableWrapper.java:167-169（不触发构造）/ :171-189（惰性 + 缓存）/ :256-263（清缓存）。
test('ConfigurableWrapper 惰性造真身，释放后重造', () => {
  let built = 0
  const host = {
    instantiateProvider: () => null,
    instantiateConfigurable: () => {
      built += 1
      return page({ displayName: '真身', id: '真身.id' })
    },
  }
  const wrapper = new ConfigurableWrapper(new ConfigurableEP({ displayName: '包装', id: 'ep.id', instanceClass: 'a.B' }), host)
  assert.equal(wrapper.getRawConfigurable(), null)
  assert.equal(wrapper.displayName, '包装') // :201-219 XML 有名字就不实例化
  assert.equal(wrapper.id, 'ep.id') // :274-278 XML 有 id 就不实例化
  assert.equal(built, 0)
  wrapper.isModified() // :172-173 第一次访问才造
  assert.equal(built, 1)
  wrapper.isModified()
  assert.equal(built, 1) // 之后走缓存
  wrapper.disposeUIResources()
  assert.equal(wrapper.getRawConfigurable(), null)
  wrapper.isModified()
  assert.equal(built, 2)
})

// ConfigurableWrapper.java:314-318 / :330-339 —— 搜索能力只对真身是搜索页时透出。
test('ConfigurableWrapper 的搜索能力取决于真身', () => {
  const silent = new ConfigurableWrapper(
    new ConfigurableEP({ displayName: '无搜索', instanceClass: 'a.B' }),
    { instantiateProvider: () => null, instantiateConfigurable: () => page({ id: 'x' }) },
  )
  assert.equal(silent.enableSearch('q'), null)
  assert.equal(silent.isSearchableInActions(), true)

  const loud = new ConfigurableWrapper(
    new ConfigurableEP({ displayName: '有搜索', searchableInActions: false, instanceClass: 'a.B' }),
    { instantiateProvider: () => null, instantiateConfigurable: () => page({ id: 'x', enableSearch: () => () => 'ran' }) },
  )
  assert.equal(typeof loud.enableSearch('q'), 'function')
  assert.equal(loud.isSearchableInActions(), true) // 真身说了算（:332-337）
})

// ConfigurableWrapper.java:384-389（不可用子项不进树）+ :418-421（按权重排）。
test('CompositeWrapper 过滤不可用子项并按权重降序排', () => {
  const makeParent = () => new ConfigurableWrapper(new ConfigurableEP({
    displayName: '父',
    children: [
      new ConfigurableEP({ displayName: '低', groupWeight: 10 }),
      new ConfigurableEP({ displayName: '高', groupWeight: 70 }),
      new ConfigurableEP({ displayName: '模板项目才不可用', nonDefaultProject: true }),
    ],
  }), NO_HOST)
  assert.deepEqual(makeParent().getConfigurables(false).map(child => child.displayName), ['高', '低', '模板项目才不可用'])
  assert.deepEqual(makeParent().getConfigurables(true).map(child => child.displayName), ['高', '低'])
})

// Weighted.java:21-33（权重降序 + 同名自然序）+ ConfigurableWrapper.java:191-194。
test('compareConfigurables：权重降序，权重相同按自然序；非 Weighted 记 0', () => {
  const host = NO_HOST
  const wrapper = (name, groupWeight) => new ConfigurableWrapper(new ConfigurableEP({ displayName: name, groupWeight }), host)
  const items = [wrapper('外观', 70), wrapper('编辑器', 60), wrapper('工具', 10)]
  assert.deepEqual(sortConfigurables(items).map(item => item.displayName), ['外观', '编辑器', '工具'])
  assert.equal(weightOf(items[0]), 70)
  assert.equal(weightOf(page()), 0)
  assert.equal(compareConfigurables(wrapper('a', 0), wrapper('b', 5)) > 0, true)
  assert.equal(naturalCompare('item10', 'item9') > 0, true) // StringUtil.java:2691 自然序
})

// ---------------------------------------------------------------------------
// SettingsEditor —— 双向同步契约
// ---------------------------------------------------------------------------

/** 记录钩子调用顺序的假编辑器（三个 protected 钩子照 SettingsEditor.java:45/50/52）。 */
class FakeEditor extends SettingsEditor {
  constructor(factory) {
    super(factory)
    this.log = []
    this.state = null
  }
  resetEditorFrom(settings) {
    this.log.push('resetEditorFrom')
    this.state = settings
  }
  applyEditorTo(settings) {
    this.log.push('applyEditorTo')
    settings.value = this.state === null ? 0 : this.state.value
  }
  createEditor() {
    this.log.push('createEditor')
    return { kind: 'ui' }
  }
  disposeEditor() {
    this.log.push('disposeEditor')
  }
}

// SettingsEditor.java:19-20（先 getComponent 再 resetFrom）+ :109-114 + :116-126 + :173-180。
test('resetFrom：先保证组件存在，整段重置只在收尾派发一次变化', () => {
  const editor = new FakeEditor(() => ({ value: 0 }))
  const seen = []
  editor.addSettingsEditorListener(() => seen.push('changed'))
  const settings = { value: 1 }
  editor.resetFrom(settings)
  assert.deepEqual(editor.log, ['createEditor', 'resetEditorFrom']) // :111 组件先存在
  assert.deepEqual(seen, ['changed']) // :125 收尾派发
  assert.equal(editor.state, settings)
})

// SettingsEditor.java:116-126 的 bulkUpdate：期间抑制派发，嵌套只在最外层收尾一次。
test('bulkUpdate 期间抑制状态派发', () => {
  const editor = new FakeEditor(null)
  const seen = []
  editor.addSettingsEditorListener(() => seen.push('changed'))
  editor.bulkUpdate(() => {
    editor.bulkUpdate(() => {})
  })
  assert.deepEqual(seen, ['changed'])
})

// SettingsEditor.java:128-130 —— applyTo 直通，异常交给调用方。
test('applyTo 不吞异常', () => {
  const editor = new FakeEditor(null)
  editor.applyEditorTo = () => { throw new ConfigurationException('非法', '无法保存') }
  assert.throws(() => editor.applyTo({ value: 0 }), ConfigurationException)
})

// SettingsEditor.java:89-95 —— 有 owner 用 owner 的快照，否则用工厂造一份再 applyTo。
test('getSnapshot：有 owner 走 owner，否则用工厂造', () => {
  const editor = new FakeEditor(() => ({ value: 0 }))
  assert.deepEqual(editor.getSnapshot(), { value: 0 })
  assert.deepEqual(editor.log, ['applyEditorTo']) // :92-93
  const owned = { value: 9 }
  const owner = { getSnapshot: () => owned }
  editor.setOwner(owner)
  assert.equal(editor.getSnapshot(), owned)
  assert.equal(editor.getOwner(), owner)
  assert.throws(() => new FakeEditor(null).getSnapshot(), /no settings factory/)
})

// SettingsEditor.java:182-188 的两个默认值。
test('isSpecificallyModified / isReadyForApply 的默认值', () => {
  const editor = new FakeEditor(null)
  assert.equal(editor.isSpecificallyModified(), false)
  assert.equal(editor.isReadyForApply(), true)
})

// ---------------------------------------------------------------------------
// SettingsEditorConfigurable —— SettingsEditor 与 Configurable 之间的桥
// ---------------------------------------------------------------------------

/** 上游这个类本身是 abstract（SettingsEditorConfigurable.java:9），displayName 留给子类。 */
class PageConfigurable extends SettingsEditorConfigurable {
  constructor(editor, settings, name) {
    super(editor, settings)
    this.displayName = name
  }
}

// SettingsEditorConfigurable.java:17-23（监听折脏）+ :27-29 + :32-35 + :37-41 + :57-59。
test('SettingsEditorConfigurable：编辑器变化折成脏态，apply/reset 各自清脏', () => {
  const editor = new FakeEditor(() => ({ value: 0 }))
  const settings = { value: 3 }
  const bridge = new PageConfigurable(editor, settings, '编辑器')
  assert.equal(bridge.isModified(), false) // BaseConfigurable.java:9
  assert.equal(bridge.displayName, '编辑器')
  editor.fireEditorStateChanged()
  assert.equal(bridge.isModified(), true) // :17-23
  bridge.reset()
  assert.equal(bridge.isModified(), false) // :37-41
  assert.deepEqual(editor.log, ['createEditor', 'resetEditorFrom'])
  assert.equal(bridge.getSettings(), settings)
})

// SettingsEditorConfigurable.java:32-35 —— applyTo 抛错时 setModified(false) 不执行。
test('SettingsEditorConfigurable：apply 失败时脏态不落', () => {
  const editor = new FakeEditor(null)
  const bridge = new PageConfigurable(editor, { value: 0 }, '编辑器')
  editor.fireEditorStateChanged()
  assert.equal(bridge.isModified(), true)
  editor.applyEditorTo = () => { throw new ConfigurationException('非法', '无法保存') }
  assert.throws(() => bridge.apply(), ConfigurationException)
  assert.equal(bridge.isModified(), true)
})

test('SettingsEditorConfigurable：apply 成功后清脏', () => {
  const editor = new FakeEditor(null)
  const bridge = new PageConfigurable(editor, { value: 0 }, '编辑器')
  editor.fireEditorStateChanged()
  bridge.apply()
  assert.equal(bridge.isModified(), false)
})

// SettingsEditorConfigurable.java:43-50（摘监听 + 释放）+ :53-55（释放后再问就报错）。
test('SettingsEditorConfigurable：dispose 释放编辑器并让引用失效', () => {
  const editor = new FakeEditor(null)
  const bridge = new PageConfigurable(editor, { value: 0 }, '编辑器')
  bridge.disposeUIResources()
  assert.deepEqual(editor.log, ['disposeEditor'])
  assert.throws(() => bridge.getEditor(), /already disposed/)
})

// SettingsEditorConfigurable.java:27-29 —— createComponent 就是 editor.getComponent()。
test('SettingsEditorConfigurable：createComponent 转发到编辑器', () => {
  const editor = new FakeEditor(null)
  const bridge = new PageConfigurable(editor, { value: 0 }, '编辑器')
  assert.deepEqual(bridge.createComponent(), { kind: 'ui' })
  assert.deepEqual(editor.log, ['createEditor'])
})

// ---------------------------------------------------------------------------
// CompositeSettingsEditor 的同步
// ---------------------------------------------------------------------------

// CompositeSettingsEditor.java:125（300 ms）+ :128-144（只重置没变过的）。
test('CompositeSynchronizer：只重置没变过的编辑器，同步后清空变化集', () => {
  assert.equal(COMPOSITE_SYNC_DELAY_MS, 300)
  const changed = new FakeEditor(() => ({ value: 0 }))
  const other = new FakeEditor(() => ({ value: 0 }))
  const syncer = new CompositeSynchronizer([changed, other], () => ({ value: 7 }))
  syncer.handleStateChange(changed)
  assert.equal(syncer.pendingCount(), 1)
  syncer.sync()
  assert.deepEqual(changed.log, []) // 变化者不动
  assert.deepEqual(other.log, ['createEditor', 'resetEditorFrom']) // :132-136
  assert.equal(syncer.pendingCount(), 0) // :141
})

// CompositeSettingsEditor.java:113-115 —— 同步进行中再来的变化被忽略。
test('CompositeSynchronizer：同步期间的新变化被忽略', () => {
  const changed = new FakeEditor(() => ({ value: 0 }))
  const other = new FakeEditor(() => ({ value: 0 }))
  const syncer = new CompositeSynchronizer([changed, other], () => ({ value: 1 }))
  const original = other.resetEditorFrom.bind(other)
  other.resetEditorFrom = settings => {
    syncer.handleStateChange(other) // 同步中回调
    original(settings)
  }
  syncer.handleStateChange(changed)
  syncer.sync()
  assert.equal(syncer.pendingCount(), 0)
})

// ---------------------------------------------------------------------------
// NoAutomaticReset
// ---------------------------------------------------------------------------

// newEditor/SettingsEditor.java:715-729（窗口重获焦点时的自动重置）+ NoAutomaticReset.kt:16。
test('shouldAutoReset：只在「离开时干净、回来变脏」时重置，带标记的不重置', () => {
  assert.equal(shouldAutoReset(null, true, false), false) // :720 判断不了就不动
  assert.equal(shouldAutoReset(true, false, false), false) // :722 离开时就脏 ⇒ 不动
  assert.equal(shouldAutoReset(false, true, false), false)
  assert.equal(shouldAutoReset(true, true, false), true) // :723-725
  assert.equal(shouldAutoReset(true, true, true), false) // 标记接口
})

// ---------------------------------------------------------------------------
// BaseConfigurable
// ---------------------------------------------------------------------------

// BaseConfigurable.java:9-17 —— 脏态存字段，由子类 setModified 维护。
test('BaseConfigurable：脏态存字段、默认不脏', () => {
  class Probe extends BaseConfigurable {
    constructor() {
      super()
      this.displayName = '探针'
    }
    apply() {}
    mark(value) {
      this.setModified(value)
    }
  }
  const probe = new Probe()
  assert.equal(probe.isModified(), false)
  probe.mark(true)
  assert.equal(probe.isModified(), true)
  probe.mark(false)
  assert.equal(probe.isModified(), false)
})
