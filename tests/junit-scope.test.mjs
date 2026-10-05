// exec/junit：按包 / 按目录的运行范围。
// 上游对照：plugins/junit/.../AbstractAllInPackageConfigurationProducer.java:24-51
// （`data.PACKAGE_NAME = 限定名`、`TEST_OBJECT = TEST_PACKAGE`，见 :48-49）、
// AbstractAllInDirectoryConfigurationProducer.java、TestsPattern.java:120-122（类解析不出来时
// 把模式原样交给运行器这条退路）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as patterns from '../src/junitPatterns.ts'
import { readFileSync } from 'node:fs'
import { packagePattern, parseTestPattern, testPatternSelector } from '../src/junitPatterns.ts'

test('packagePattern：包名 → 类名通配（与 testPatternSelector 的类名形状同源）', () => {
  assert.equal(packagePattern('com.foo'), 'com.foo.**.*Test')
  // 目录写法喂进来也折算成包名形状（面板按 `/` 分流，但函数本身不自相矛盾）。
  assert.equal(packagePattern('com/foo/'), 'com.foo.**.*Test')
  assert.equal(packagePattern(''), '**.*Test')
  assert.equal(packagePattern('   '), '**.*Test')
})

test('directoryPattern 已删：目录不是包，把 / 换成点会合成出 `src.test.java.**.*Test` 这种假包名', () => {
  assert.equal(patterns.directoryPattern, undefined,
    '上游的目录生产者收集的是范围内的**类列表**（AbstractAllInDirectoryConfigurationProducer），本仓由发现索引承担')
})

test('范围内有类时交出去的是类名列表，不是合成模式（上游存 PACKAGE_NAME 后由运行器解析）', () => {
  const classes = ['com.foo.MathTest', 'com.foo.BarTest', 'com.foo.MathTest']
  assert.equal(testPatternSelector([...new Set(classes)].sort()), 'com.foo.BarTest,com.foo.MathTest')
  // 通配模式仍然原样交给运行器（TestsPattern.getFilters:120-122）。
  assert.equal(testPatternSelector(['com.foo.*']), 'com.foo.*')
  assert.equal(parseTestPattern('com.foo.*').wildcard, true)
})

test('接线：面板有包/目录这一档，范围空了会明说而不是偷偷跑全部', () => {
  const source = readFileSync(new URL('../src/components/TestRunnerPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /scopeText/, '面板没有范围输入')
  assert.match(source, /scopeIsDirectory/, '面板没有按目录/包分流')
  assert.match(source, /packagePattern/, '面板没有用包名退路的过滤器')
  assert.match(source, /没有发现测试/, '范围内没有测试时没有明说')
  assert.match(source, /aria-label="包或目录范围"/, '范围输入没有无障碍标签')
})
