// 项目级路径与实例目录模型的判据（`src/projectDirectories.ts`）。
//
// 上游依据：`P3PathsEx.kt:16-46`（PER_PROJECT_FOLDER + 目录名_pathHash）、
// `PerProjectInstancePaths.kt:18-96`（PER_PROJECT_SUFFIX + 去根相对路径、log 在 system 之下的分支）、
// `BaseProjectDirectoriesImpl.kt:26`（内容根的去重根集）、`ProjectNameProvider`（默认名 = 目录名）。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  PER_PROJECT_FOLDER, PER_PROJECT_SUFFIX, normalizeProjectPath, projectDirectoryName, defaultProjectName,
  javaStringHashCode, toHexString, projectLocationHash, perProjectP3Paths, joinProjectPath,
  projectPathWithoutRoot, perProjectInstancePath, perProjectLogDir, baseProjectDirectories,
} = await import('../src/projectDirectories.ts')

test('路径归一与目录名：反斜杠、重复/末尾分隔符、盘符根', () => {
  assert.equal(normalizeProjectPath('C:\\work\\demo\\'), 'C:/work/demo')
  assert.equal(normalizeProjectPath('C:\\work//demo'), 'C:/work/demo')
  assert.equal(projectDirectoryName('C:/work/demo/'), 'demo')
  assert.equal(projectDirectoryName('C:/'), 'C:')
  assert.equal(projectDirectoryName('/'), '')
  assert.equal(defaultProjectName('C:/work/demo'), 'demo')
  assert.equal(defaultProjectName('C:/'), 'C:', '目录名取不到就退回路径')
})

test('Java 字符串 hash 与 toHexString：与 JVM 结果逐位一致', () => {
  // 用 JDK 算过的值核对（String.hashCode 的 31 进制算法 + Integer.toHexString 的无符号十六进制）。
  assert.equal(javaStringHashCode(''), 0)
  assert.equal(javaStringHashCode('a'), 97)
  assert.equal(javaStringHashCode('abc'), 96354)
  assert.equal(javaStringHashCode('C:/work/demo'), -685844887)
  assert.equal(toHexString(96354), '17862')
  assert.equal(toHexString(1703977198), '6590a0ee')
  assert.equal(toHexString(-1), 'ffffffff')
  assert.equal(toHexString(0), '0')
})

test('P3PathsEx：目录名_pathHash，四类目录同 hash，plugins 全局', () => {
  const project = 'C:/work/demo'
  const hash = projectLocationHash(project)
  assert.equal(hash, 'demo_d71ed669')
  const paths = perProjectP3Paths(project, {
    configDir: 'C:/Users/u/.taocode/config',
    systemDir: 'C:/Users/u/.taocode/system',
    logDir: 'C:/Users/u/.taocode/log',
    pluginsDir: 'C:/Users/u/.taocode/plugins',
  })
  assert.equal(paths.locationHash, hash)
  assert.equal(paths.configDir, `C:/Users/u/.taocode/config/${PER_PROJECT_FOLDER}/${hash}`)
  assert.equal(paths.systemDir, `C:/Users/u/.taocode/system/${PER_PROJECT_FOLDER}/${hash}`)
  assert.equal(paths.logDir, `C:/Users/u/.taocode/log/${PER_PROJECT_FOLDER}/${hash}`)
  assert.equal(paths.pluginsDir, 'C:/Users/u/.taocode/plugins', '插件目录不按项目分家')
  // 同一路径 → 同一套目录（可复算）；不同路径 → 不同 hash。
  assert.deepEqual(perProjectP3Paths(project, {
    configDir: 'C:/c', systemDir: 'C:/s', logDir: 'C:/l', pluginsDir: 'C:/p',
  }).configDir, 'C:/c/INTERNAL_P3_FOLDER/demo_d71ed669')
  assert.notEqual(projectLocationHash('C:/work/other'), hash)
  assert.equal(joinProjectPath('C:/a/', '/b'), 'C:/a/b')
  assert.equal(joinProjectPath('', 'b'), 'b')
})

test('PerProjectInstancePaths：去掉根的相对路径 + log 在 system 之下的分支', () => {
  assert.equal(projectPathWithoutRoot('/home/u/demo'), 'home/u/demo')
  assert.equal(projectPathWithoutRoot('C:/work/demo'), 'work/demo')
  assert.equal(projectPathWithoutRoot('relative/demo'), 'relative/demo')
  assert.equal(perProjectInstancePath('C:/base', 'C:/work/demo'), `C:/base/${PER_PROJECT_SUFFIX}/work/demo`)
  assert.equal(perProjectInstancePath('C:/base', '/home/u/demo'), `C:/base/${PER_PROJECT_SUFFIX}/home/u/demo`)
  // log 在 system 之下：先算新的 system，再把相对部分接上。
  const nested = perProjectLogDir('C:/work/demo', { systemDir: 'C:/sys', logDir: 'C:/sys/log' })
  assert.equal(nested, `C:/sys/${PER_PROJECT_SUFFIX}/work/demo/log`)
  // log 不在 system 之下：各自算。
  const separate = perProjectLogDir('C:/work/demo', { systemDir: 'C:/sys', logDir: 'C:/logs' })
  assert.equal(separate, `C:/logs/${PER_PROJECT_SUFFIX}/work/demo`)
})

test('BaseProjectDirectories：去掉被祖先覆盖的根，保序去重', () => {
  assert.deepEqual(baseProjectDirectories(['C:/p/src', 'C:/p', 'C:/p/src/main', 'C:/q']), ['C:/p', 'C:/q'])
  assert.deepEqual(baseProjectDirectories(['C:/p/', 'C:/p']), ['C:/p'])
  assert.deepEqual(baseProjectDirectories([]), [])
})
