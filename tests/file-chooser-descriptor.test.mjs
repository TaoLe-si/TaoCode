// 文件/目录选择的描述件（`src/fileChooserDescriptor.ts`）：上游 `FileChooserDescriptor` /
// `FileChooserDescriptorFactory` 落到宿主 `dialog.pickFile` / `dialog.pickDirectory` 上的那部分语义。
// 覆盖：工厂预设、扩展名过滤折算与复核、根约束的边界、取消不算失败、不合格选择必须报错。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseHostMethod, chooseWithDescriptor, describeDescriptor, fileExtensionOf, hostFilterSpec, isUnderRoots,
  matchesExtensionFilter, multiDirsDescriptor, selectionProblem, singleDirDescriptor, singleFileDescriptor,
  singleFileDescriptorOfExtension, singleFileOrDirDescriptor, withExtensionFilter, withRoots, withTitle,
} from '../src/fileChooserDescriptor.ts'

test('工厂预设的 chooseFiles/chooseFolders/chooseMultiple 与上游一致', () => {
  const file = singleFileDescriptor()
  assert.deepEqual([file.chooseFiles, file.chooseFolders, file.chooseMultiple], [true, false, false])
  const dir = singleDirDescriptor()
  assert.deepEqual([dir.chooseFiles, dir.chooseFolders, dir.chooseMultiple], [false, true, false])
  const both = singleFileOrDirDescriptor()
  assert.deepEqual([both.chooseFiles, both.chooseFolders, both.chooseMultiple], [true, true, false])
  const multi = multiDirsDescriptor()
  assert.deepEqual([multi.chooseFiles, multi.chooseFolders, multi.chooseMultiple], [false, true, true])
  assert.equal(chooseHostMethod(file), 'dialog.pickFile')
  assert.equal(chooseHostMethod(dir), 'dialog.pickDirectory')
  assert.equal(chooseHostMethod(both), 'dialog.pickFile', '文件与目录都可选时优先文件对话框')
  assert.throws(() => chooseHostMethod({ ...file, chooseFiles: false }), /没有声明可选的类型/)
})

test('withExtensionFilter 归一化扩展名（去点、小写），单扩展名预设生成标签', () => {
  const descriptor = withExtensionFilter(singleFileDescriptor(), '插件包', ['.ZIP', 'Jar', ''])
  assert.deepEqual(descriptor.extensionFilter, { label: '插件包', extensions: ['zip', 'jar'] })
  assert.deepEqual(singleFileDescriptorOfExtension('.zip').extensionFilter, { label: 'ZIP 文件', extensions: ['zip'] })
  assert.equal(withExtensionFilter(singleFileDescriptor(), '空', []).extensionFilter, null)
  const untouched = singleFileDescriptor()
  withExtensionFilter(untouched, 'x', ['zip'])
  assert.equal(untouched.extensionFilter, null, 'with* 返回新对象，不改原描述件')
})

test('宿主过滤串与原生 parse_file_filters 的格式一致', () => {
  const descriptor = withExtensionFilter(singleFileDescriptor(), '插件包', ['zip', 'jar'])
  assert.equal(hostFilterSpec(descriptor), '插件包 (*.zip;*.jar)|*.zip;*.jar|所有文件 (*.*)|*.*')
  assert.equal(hostFilterSpec(singleFileDescriptor()), '所有文件 (*.*)|*.*')
  assert.equal(hostFilterSpec(withExtensionFilter(singleFileDescriptor(), 'a|b', ['x'])), 'a/b (*.x)|*.x|所有文件 (*.*)|*.*')
})

test('扩展名判定：大小写不敏感、前导点不算扩展名、末点不算', () => {
  assert.equal(fileExtensionOf('D:/work/Plugin.ZIP'), 'zip')
  assert.equal(fileExtensionOf('D:/work/.gitignore'), '')
  assert.equal(fileExtensionOf('D:/work/archive.'), '')
  assert.equal(fileExtensionOf('D:/work/noext'), '')
  const descriptor = withExtensionFilter(singleFileDescriptor(), '归档', ['zip'])
  assert.ok(matchesExtensionFilter(descriptor, 'D:/x/a.JaR') === false)
  assert.ok(matchesExtensionFilter(descriptor, 'D:/x/a.ZIP'))
  assert.ok(matchesExtensionFilter(singleFileDescriptor(), 'D:/x/anything'))
})

test('根约束的边界：/work 不包含 /workshop', () => {
  assert.ok(isUnderRoots('D:/work/sub/a.ts', ['D:/work']))
  assert.ok(isUnderRoots('D:/work', ['D:/work']))
  assert.ok(isUnderRoots('D:\\work\\sub', ['D:/work']), '反斜杠路径按 / 归一')
  assert.ok(!isUnderRoots('D:/workshop/a.ts', ['D:/work']))
  assert.ok(isUnderRoots('D:/anywhere', []), '空 roots 不限制')
})

test('selectionProblem：类型、扩展名与根约束各有明确拒绝原因', () => {
  const descriptor = withExtensionFilter(withRoots(singleFileDescriptor(), ['D:/work']), '插件包', ['zip'])
  assert.equal(selectionProblem(descriptor, 'D:/work/plugin.zip', 'file'), null)
  assert.match(selectionProblem(descriptor, 'D:/work/plugin.jar', 'file'), /不符合「插件包」过滤/)
  assert.match(selectionProblem(descriptor, 'D:/other/plugin.zip', 'file'), /不在限定范围/)
  assert.match(selectionProblem(descriptor, 'D:/work/sub', 'directory'), /只能选文件/)
  assert.match(selectionProblem(descriptor, '', 'file'), /没有选择任何路径/)
  assert.match(selectionProblem(singleDirDescriptor(), 'D:/work/a.txt', 'file'), /只能选目录/)
})

test('chooseWithDescriptor：取消返回 null，选错文件抛错，目录走目录方法', async () => {
  const calls = []
  const host = {
    pickFile: async params => {
      calls.push(['file', params])
      if (params.title === '取消') return null
      return params.title === '错误' ? 'D:/x/plugin.jar' : 'D:/x/plugin.zip'
    },
    pickDirectory: async params => { calls.push(['dir', params]); return 'D:/x/dir' },
  }
  const archive = withTitle(withExtensionFilter(singleFileDescriptor(), '插件包', ['zip']), '选择插件包')
  await assert.rejects(chooseWithDescriptor(host, withTitle(archive, '错误')), /不符合「插件包」过滤/)
  assert.deepEqual(calls[0][1], { title: '错误', filters: '插件包 (*.zip)|*.zip|所有文件 (*.*)|*.*', initial: '' })
  assert.equal(await chooseWithDescriptor(host, withTitle(archive, '取消')), null)
  assert.equal(await chooseWithDescriptor(host, withTitle(singleDirDescriptor(), '选择目录')), 'D:/x/dir')
  assert.deepEqual(calls.at(-1)[0], 'dir')
  const passed = await chooseWithDescriptor(host, withTitle(archive, '重选'), 'D:/start')
  assert.equal(passed, 'D:/x/plugin.zip')
  assert.equal(calls.at(-1)[1].initial, 'D:/start')
})

test('describeDescriptor 汇总可选类型、多选与过滤', () => {
  const descriptor = withExtensionFilter(multiDirsDescriptor(), '目录', [])
  assert.equal(describeDescriptor(descriptor), '选择目录（可多选）：选择目录，可多选')
  assert.match(describeDescriptor(withExtensionFilter(singleFileDescriptor(), '插件包', ['zip', 'jar'])), /过滤 \*\.zip\/\*\.jar/)
})
