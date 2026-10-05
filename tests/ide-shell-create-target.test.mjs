// 按包名/带分隔符的路径新建目录（`src/ideShellCreateTarget.ts`）：
// `CreateDirectoryOrPackageHandler` 的错误/警告两级 + `DirectoryUtil.createSubdirectories`
// 的遍历，与 `CreatePackageHandler` 那条 `.` 分隔链。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CREATE_BUNDLE, DIRECTORY_DELIMITERS, PACKAGE_DELIMITER,
  createTargetCanClose, createTargetCheck, packageInitialText, packageInputCheck, packageRootPath,
  tokenizeWithDelimiters,
} from '../src/ideShellCreateTarget.ts'

/** 一棵小树：`dirs` 是目录集合，`files` 是文件集合（两者都按「父路径/名」判定）。 */
function fsOf(options = {}) {
  const dirs = new Set(options.dirs ?? [])
  const files = new Set(options.files ?? [])
  const ignored = new Set(options.ignored ?? [])
  const typed = new Set(options.typed ?? [])
  return {
    userHome: options.userHome === undefined ? '~home' : options.userHome,
    parentOf: path => {
      const index = path.lastIndexOf('/')
      return index < 0 ? null : path.slice(0, index)
    },
    findChild: (dirPath, name) => {
      const full = dirPath ? `${dirPath}/${name}` : name
      if (files.has(full)) return { isDirectory: false }
      if (dirs.has(full)) return { isDirectory: true }
      return null
    },
    isFileIgnored: name => ignored.has(name),
    isFileTypeBound: name => typed.has(name),
  }
}

const isJavaIdentifier = token => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)

test('StringTokenizer 语义：分隔符集合里的每个字符都切，且空段被跳过', () => {
  assert.deepEqual(tokenizeWithDelimiters('a/b/c', '/'), ['a', 'b', 'c'])
  assert.deepEqual(tokenizeWithDelimiters('a\\b', DIRECTORY_DELIMITERS), ['a', 'b'])
  assert.deepEqual(tokenizeWithDelimiters('a//b', DIRECTORY_DELIMITERS), ['a', 'b'], '空段被跳过，不是 ["a","","b"]')
  assert.deepEqual(tokenizeWithDelimiters('.a..b.', PACKAGE_DELIMITER), ['a', 'b'], '首尾点与连续点都跳过')
  assert.deepEqual(tokenizeWithDelimiters('...', PACKAGE_DELIMITER), [], '全是分隔符 ⇒ 没有 token')
})

test('新建目录：逐级推导出要建哪几级，中间层已存在不算错', () => {
  const result = createTargetCheck({
    input: 'src/main/java/com/demo', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS,
    fs: fsOf({ dirs: ['src', 'src/main', 'src/main/java'] }),
  })
  assert.equal(result.error, null)
  assert.equal(result.warning, null)
  assert.deepEqual(result.created, ['com', 'demo'], '只报要新建的那两级，已存在的不重复建')
  assert.equal(result.path, 'src/main/java/com/demo')
})

test('新建目录：最后一段已存在才报「已存在同名目录」，中间段已存在放行', () => {
  const middle = createTargetCheck({
    input: 'src/main', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS,
    fs: fsOf({ dirs: ['src'] }),
  })
  assert.equal(middle.error, null)
  assert.deepEqual(middle.created, ['main'])

  const last = createTargetCheck({
    input: 'src/main', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS,
    fs: fsOf({ dirs: ['src', 'src/main'] }),
  })
  assert.equal(last.error, CREATE_BUNDLE.directoryAlreadyExists('main'))
  assert.deepEqual(last.created, [], '报错时不给「要建什么」，免得调用方照着建')
})

test('新建目录：撞上同名文件一律致命（不分位置）', () => {
  for (const input of ['src', 'src/main']) {
    const result = createTargetCheck({
      input, basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS,
      fs: fsOf({ files: ['src'] }),
    })
    assert.equal(result.error, CREATE_BUNDLE.fileAlreadyExists('src'), input)
  }
})

test('走位：~ 只在首个 token 生效并跳到用户主目录，.. 往上一级，. 原地不动', () => {
  const home = createTargetCheck({
    input: '~/notes/today', basePath: 'src', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(home.error, null)
  assert.equal(home.path, '~home/notes/today')
  assert.deepEqual(home.created, ['notes', 'today'])

  const up = createTargetCheck({
    input: '../shared', basePath: 'src/main', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(up.path, 'src/shared')
  assert.deepEqual(up.created, ['shared'], '.. 只是走位，不建目录')

  const same = createTargetCheck({
    input: './here', basePath: 'src', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(same.path, 'src/here')

  // `~` 不在首位就当普通目录名（上游 `:86` 的 firstToken 门）。
  const midTilde = createTargetCheck({
    input: 'a/~/b', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(midTilde.path, 'a/~/b')
  assert.deepEqual(midTilde.created, ['a', '~', 'b'])
})

test('走位失败的两条：用户主目录找不到、.. 走到盘根', () => {
  const noHome = createTargetCheck({
    input: '~/x', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf({ userHome: null }),
  })
  assert.equal(noHome.error, CREATE_BUNDLE.userHomeNotFound)

  const atRoot = createTargetCheck({
    input: '../x', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  // 上游报的是 `vFile.getPresentableUrl() + File.separatorChar + ".."`（:96），
  // 即「当前目录 + 分隔符 + ..」，盘根在工作区模型里就是空串。
  assert.equal(atRoot.error, CREATE_BUNDLE.invalidDirectory('/..'))
})

test('末段是 . 或 .. 直接判非法目录名（上游 :82-84）', () => {
  const dots = createTargetCheck({
    input: 'a/..', basePath: 'src', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(dots.error, CREATE_BUNDLE.invalidDirectoryName('..'))
})

test('警告级：被忽略的名字、以及建目录时名字里的点', () => {
  const ignored = createTargetCheck({
    input: '.git', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf({ ignored: ['.git'] }),
  })
  // 「.git」只有一个分隔符段，没有分隔符出现在输入里 ⇒ 先命中 ignored 那一档。
  assert.equal(ignored.warning, CREATE_BUNDLE.ignoredDirectoryName('.git'))
  assert.equal(ignored.error, null, '警告不禁用创建')

  const dot = createTargetCheck({
    input: 'my.dir', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(dot.warning, CREATE_BUNDLE.directoryWithDot)

  // 有分隔符时那就不是「把点当普通字符」的场景了。
  const nested = createTargetCheck({
    input: 'a/my.dir', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf(),
  })
  assert.equal(nested.warning, null)
})

test('建包：逐段查包名合法性，且上游把它放在 warningText 那个口（只写文案、不拦）', () => {
  const bad = createTargetCheck({
    input: 'com.9demo', basePath: '', isDirectory: false, delimiters: PACKAGE_DELIMITER,
    fs: fsOf(), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(bad.error, null, '上游 checkForWarnings:126-128 不 return，只写文案')
  assert.equal(bad.warning, CREATE_BUNDLE.invalidPackageName)
  assert.deepEqual(bad.created, ['com', '9demo'])
})

test('canClose：空串不放行；单段与多段的门槛不同', () => {
  const base = { basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf() }
  assert.equal(createTargetCanClose({ ...base, input: '' }).proceed, false)

  const ok = createTargetCanClose({ ...base, input: 'a/b' })
  assert.equal(ok.proceed, true)
  assert.deepEqual(ok.paths, ['a', 'b'])

  const bad = createTargetCanClose({ ...base, input: 'a/..' })
  assert.equal(bad.proceed, false)
  assert.deepEqual(bad.paths, [])
})

test('canClose：名字恰好一个点且绑定了文件类型 ⇒ 该问「建文件吗」（注册表开关关着时不问）', () => {
  const input = { input: 'notes.txt', basePath: '', isDirectory: true, delimiters: DIRECTORY_DELIMITERS, fs: fsOf({ typed: ['notes.txt'] }) }
  assert.equal(createTargetCanClose(input).askCreateFile, false, '注册表 ide.suggest.file... 关着 ⇒ 不问')
  assert.equal(createTargetCanClose(input, { suggestFileInstead: true }).askCreateFile, true)
  assert.equal(
    createTargetCanClose({ ...input, fs: fsOf({ typed: ['a.b.c'] }) }, { suggestFileInstead: true }).askCreateFile,
    false, '两个点不是「像文件名」',
  )
})

// ——— CreatePackageHandler ———

test('包根：只要父目录还是包就继续上溯（getPackageRoot:127-138）', () => {
  const tree = new Set(['', 'src', 'src/main', 'src/main/java'])
  const isPackageDir = path => tree.has(path)
  assert.equal(packageRootPath('src/main/java/com', path => path === '' ? null : path.slice(0, path.lastIndexOf('/')), isPackageDir), 'src')
  assert.equal(packageRootPath('src', path => null, isPackageDir), 'src', '父目录不是包就停')
  assert.equal(packageRootPath('', path => null, isPackageDir), '')
})

test('输入框预填文本：当前目录就是包根时为空，否则补一个尾点（buildInitialText:118-125）', () => {
  assert.equal(packageInitialText('src/main/java', 'src/main/java'), '')
  assert.equal(packageInitialText('src/main/java', 'src/main/java/com/demo'), 'com.demo.')
})

test('包名输入：空串与未改动的预填文本都放行', () => {
  const ok = packageInputCheck({
    input: 'com.demo.', packageRootPath: 'src/main/java', initialText: 'com.demo.',
    fs: fsOf(), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(ok.accepted, true)
  assert.equal(ok.errorText, null)
})

test('包名输入：尾点与空段是「格式错」并拦住（split 保留空段，StringTokenizer 那条没有这道）', () => {
  const trailing = packageInputCheck({
    input: 'com.', packageRootPath: 'src', initialText: '', fs: fsOf(), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(trailing.accepted, false)
  assert.equal(trailing.errorText, CREATE_BUNDLE.invalidPackageNameFormat)

  for (const input of ['com..demo', '.com', 'com.demo.']) {
    const result = packageInputCheck({
      input, packageRootPath: 'src', initialText: '', fs: fsOf(), isValidPackageName: isJavaIdentifier,
    })
    assert.equal(result.accepted, false, input)
    assert.equal(result.errorText, CREATE_BUNDLE.invalidPackageNameFormat, input)
  }
})

test('包名输入：逐级下钻，撞上同名文件致命；最后一级已存在报「已存在同名包」', () => {
  const fileClash = packageInputCheck({
    input: 'com.demo', packageRootPath: 'src', initialText: '',
    fs: fsOf({ dirs: ['src/com'], files: ['src/com/demo'] }), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(fileClash.accepted, false)
  assert.equal(fileClash.errorText, CREATE_BUNDLE.fileAlreadyExists('demo'))

  const exists = packageInputCheck({
    input: 'com.demo', packageRootPath: 'src', initialText: '',
    fs: fsOf({ dirs: ['src/com', 'src/com/demo'] }), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(exists.accepted, false)
  assert.equal(exists.errorText, CREATE_BUNDLE.packageAlreadyExists('demo'))
})

test('包名输入：非法包名只写 errorText、不拦（上游 :66-72 不 return，:80 返回 true）', () => {
  const result = packageInputCheck({
    input: 'com.9demo', packageRootPath: 'src', initialText: '',
    fs: fsOf(), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(result.accepted, true, '上游 checkInput 仍然返回 true')
  assert.equal(result.errorText, CREATE_BUNDLE.invalidPackageName)

  // 被忽略的名字同理，而且**后者覆盖前者**（上游 :70-72 顺序赋值）。
  const both = packageInputCheck({
    input: 'com.9demo', packageRootPath: 'src', initialText: '',
    fs: fsOf({ ignored: ['9demo'] }), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(both.errorText, CREATE_BUNDLE.ignoredPackageName('9demo'))
})

test('包名输入：全都不存在时给出要建的包路径', () => {
  const result = packageInputCheck({
    input: 'com.demo', packageRootPath: 'src/main/java', initialText: '',
    fs: fsOf({ dirs: ['src/main/java'] }), isValidPackageName: isJavaIdentifier,
  })
  assert.equal(result.accepted, true)
  assert.equal(result.errorText, null)
  assert.equal(result.path, 'src/main/java/com/demo')
})
