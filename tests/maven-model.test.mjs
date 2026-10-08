// Maven 侧工程模型的判据（`es/project-model` 判词第 ② 条）。
//
// 上游依据：`plugins/maven/src/main/java/org/jetbrains/idea/maven/project/MavenProject.kt:241-272`
// （mavenId/parentId/packaging/name）与 `plugins/maven/model/src/main/java/org/jetbrains/idea/maven/model/MavenId.java:24-48`。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mavenDependencyScopes, mavenIdText, mavenProjectInfoOf, mavenProjectNodes, parsePomModel,
  pomNeedsEvaluation, pomPaths, readMavenPoms,
} from '../src/mavenModel.ts'

const ROOT_POM = `<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>1.0.0</version>
  <packaging>pom</packaging>
  <name>Demo Parent</name>
  <modules>
    <module>app</module>
    <module>lib</module>
  </modules>
  <dependencies>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.9</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
      <optional>true</optional>
    </dependency>
  </dependencies>
</project>`

test('解析 pom 直接字段：坐标/名字/packaging/模块/依赖（MavenProject.kt:241-272）', () => {
  const pom = parsePomModel('pom.xml', ROOT_POM)
  assert.deepEqual(pom.id, { groupId: 'com.example', artifactId: 'demo', version: '1.0.0' })
  assert.equal(pom.name, 'Demo Parent')
  assert.equal(pom.packaging, 'pom')
  assert.equal(pom.directory, '')
  assert.deepEqual(pom.modules, ['app', 'lib'])
  assert.equal(pom.dependencies.length, 2)
  assert.equal(pom.dependencies[0].scope, 'compile', '缺省 scope 是 compile')
  assert.equal(pom.dependencies[1].scope, 'test')
  assert.equal(pom.dependencies[1].optional, true)
})

test('MavenId 串是 groupId:artifactId:version（MavenId.java:42-48）', () => {
  assert.equal(mavenIdText({ groupId: 'g', artifactId: 'a', version: '1' }), 'g:a:1')
})

test('父 POM 的坐标不被当成本工程坐标；继承来的 groupId 留空 + 标 needsEvaluation', () => {
  const child = `<project>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>demo</artifactId>
    <version>1.0.0</version>
  </parent>
  <artifactId>app</artifactId>
  <name>App</name>
</project>`
  const pom = parsePomModel('app/pom.xml', child)
  assert.equal(pom.id.groupId, '', 'groupI d继承自 parent，pom 里没直接写 ⇒ 留空不求值')
  assert.equal(pom.id.artifactId, 'app')
  assert.equal(pom.parentId.groupId, 'com.example')
  assert.equal(pom.parentId.artifactId, 'demo')
  assert.equal(pom.packaging, 'jar', '缺省打包是 jar')
  assert.equal(pomNeedsEvaluation(pom), true)
})

test('${...} 属性不展开，原样带出并登记 unresolved', () => {
  const pom = parsePomModel('pom.xml', `<project>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>\${revision}</version>
  <dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>\${dep.version}</version></dependency></dependencies>
</project>`)
  assert.equal(pom.id.version, '${revision}', '不猜属性值')
  assert.ok(pom.unresolved.includes('version'))
  assert.ok(pom.unresolved.includes('dependency.version'))
  assert.equal(pomNeedsEvaluation(pom), true)
})

test('注释里的字段不算（stripComments）', () => {
  const pom = parsePomModel('pom.xml', `<project>
  <!-- <artifactId>commented</artifactId> -->
  <artifactId>real</artifactId>
</project>`)
  assert.equal(pom.id.artifactId, 'real')
})

test('pomPaths 只挑 pom.xml（含子目录）', () => {
  assert.deepEqual(pomPaths(['src/a.java', 'pom.xml', 'app/pom.xml', 'notes/pom.md']), ['pom.xml', 'app/pom.xml'])
})

test('模块树：根 pom 是 :，子模块是 :目录（深度按层数）', () => {
  const nodes = mavenProjectNodes([
    parsePomModel('pom.xml', ROOT_POM),
    parsePomModel('app/pom.xml', '<project><artifactId>app</artifactId><name>App</name></project>'),
  ])
  assert.equal(nodes[0].path, ':')
  assert.equal(nodes[0].depth, 0)
  assert.equal(nodes[1].path, ':app')
  assert.equal(nodes[1].depth, 1)
  assert.equal(nodes[1].name, 'App')
})

test('依赖作用域按 scope 分组，optional 折成 constraint，版本原样带出', () => {
  const scopes = mavenDependencyScopes([parsePomModel('pom.xml', ROOT_POM)])
  const compile = scopes.find(scope => scope.configuration === 'compile')
  const test_ = scopes.find(scope => scope.configuration === 'test')
  assert.equal(compile.dependencies[0].name, 'org.slf4j:slf4j-api:2.0.9')
  assert.equal(compile.dependencies[0].resolved, '2.0.9')
  assert.equal(test_.dependencies[0].constraint, true, 'optional=true 折成 constraint 标记')
})

test('readMavenPoms 读不到的 pom 跳过，不编坐标', async () => {
  const poms = await readMavenPoms(['pom.xml', 'app/pom.xml'], path => path === 'pom.xml' ? ROOT_POM : null)
  assert.equal(poms.length, 1)
  assert.equal(poms[0].id.artifactId, 'demo')
})

test('readMavenPoms 读回调抛错也不崩（那一份跳过）', async () => {
  const poms = await readMavenPoms(['pom.xml'], () => { throw new Error('boom') })
  assert.deepEqual(poms, [])
})

test('mavenProjectInfoOf 走与 Gradle 同一条 ExternalProjectInfo 链（MAVEN_SYSTEM）', async () => {
  const { MAVEN_SYSTEM, externalProjectModules, externalProjectDependencyScopes } = await import('../src/externalSystemModel.ts')
  const poms = await readMavenPoms(['pom.xml', 'app/pom.xml'], path => path === 'pom.xml' ? ROOT_POM : '<project><artifactId>app</artifactId></project>')
  const info = mavenProjectInfoOf({ projectPath: '', poms, importedAt: 1000 })
  assert.equal(info.systemId, MAVEN_SYSTEM)
  assert.equal(info.lastSuccessfulImportTimestamp, 1000)
  assert.ok(info.structure, 'Maven 也建出 DataNode 结构树')
  const modules = externalProjectModules(info)
  assert.equal(modules.length, 2, '根 + 子模块')
  assert.equal(modules[0].id, ':')
  assert.equal(modules[1].id, ':app')
  const scopes = externalProjectDependencyScopes(info)
  assert.ok(scopes.some(scope => scope.configuration === 'test'))
})

test('mavenProjectInfoOf 失败时保留上一次成功的结构（与 Gradle 同一条语义）', async () => {
  const poms = await readMavenPoms(['pom.xml'], () => ROOT_POM)
  const ok = mavenProjectInfoOf({ projectPath: '', poms, importedAt: 1000 })
  const failed = mavenProjectInfoOf({ projectPath: '', poms: [], importedAt: 2000, error: 'mvn 退出码 1', previous: ok })
  assert.equal(failed.structure, ok.structure)
  assert.equal(failed.lastSuccessfulImportTimestamp, 1000)
  assert.equal(failed.lastImportTimestamp, 2000)
})