// Java 的运行/调试入口（IDEA `ApplicationConfiguration` + `JvmMainMethodSearcher` 的规则）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  hasMainMethod,
  javaClasspath,
  javaExecutable,
  javaRunArgs,
  javaRunCommand,
  mainClassFor,
  parseJavaSource,
  stripLiterals,
} from '../src/javaRun.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const MAIN_AND_HELPER = `package com.example;

public class Main {
    public static void main(String[] args) {
        System.out.println("hi");
    }
}

class Helper {
    void run() {}
}
`

test('注释与字符串字面量里的花括号不会打乱结构', () => {
  const stripped = stripLiterals('a{b} // {c}\n/* {d} */ "e{f}" \'{\'')
  assert.equal(stripped.length, 'a{b} // {c}\n/* {d} */ "e{f}" \'{\''.length, '抹掉内容但要保持长度')
  assert.ok(!stripped.includes('{c}') && !stripped.includes('{d}') && !stripped.includes('{f}'))
  assert.ok(stripped.includes('a{b}'), '真代码里的花括号留着')
})

test('解析 package 与顶层类型，嵌套类不算顶层', () => {
  const source = parseJavaSource(MAIN_AND_HELPER)
  assert.equal(source.packageName, 'com.example')
  assert.deepEqual(source.types, [{ name: 'Main', hasMain: true }, { name: 'Helper', hasMain: false }])

  const nested = parseJavaSource(`public class Outer {
    class Inner { void x() {} }
    String text = "{ not code }";
    public static void main(String... args) {}
}`)
  assert.deepEqual(nested.types, [{ name: 'Outer', hasMain: true }], '嵌套类不是顶层类型')
})

test('main 的三种参数写法都认（String[] / String args[] / String...）', () => {
  const forms = [
    'public static void main(String[] args) {}',
    'public static void main(String args[]) {}',
    'public static void main(String... args) {}',
    'static public void main(final String[] argv) {}',
  ]
  for (const form of forms)
    assert.equal(hasMainMethod(`public class A { ${form} }`), true, form)
  // 不是 main 的都不认
  const negatives = [
    'public static void main() {}',                     // 参数个数不对（Java 21 的实例 main 本仓不实现）
    'public static int main(String[] args) { return 0; }', // 返回类型不对
    'public void main(String[] args) {}',               // 不是 static
    'private static void main(String[] args) {}',       // 不是 public
    'public static void main(String args) {}',          // 参数不是数组
    'public static void notMain(String[] args) {}',     // 名字不对
  ]
  for (const form of negatives)
    assert.equal(hasMainMethod(`public class A { ${form} }`), false, form)
})

test('主类取全限定名：有 main 的优先，没有就退回第一个类型', () => {
  assert.equal(mainClassFor(MAIN_AND_HELPER, 'Main.java'), 'com.example.Main')
  const helperFirst = `package demo;
class Helper { void run() {} }
class Launcher { public static void main(String[] a) {} }`
  assert.equal(mainClassFor(helperFirst, 'Launcher.java'), 'demo.Launcher', '有 main 的类优先，与出现顺序无关')
  const noMain = `package demo;
class Only { void run() {} }`
  assert.equal(mainClassFor(noMain, 'Only.java'), 'demo.Only', '没有 main 也记下这个类（IDEA 同样如此，让 JVM 去报错）')
  assert.equal(mainClassFor('class Plain {}', 'Plain.java'), 'Plain', '默认包不带前缀')
  assert.equal(mainClassFor('// 空文件', 'Empty.java'), 'Empty', '一个类型都找不到时用文件名兜底')
})

test('启动命令：java -cp 输出目录+依赖 <主类全名>', () => {
  const command = javaRunCommand({
    mainClass: 'com.example.Main', outputPaths: ['out/production/demo'],
    classpath: ['lib/a.jar'], jdkHome: 'C:\\jdk-21',
  })
  assert.equal(command, '"C:\\jdk-21\\bin\\java.exe" -cp "out/production/demo;lib/a.jar" com.example.Main')
  // 没配 JDK 就退回 PATH 上的 java
  assert.ok(javaRunCommand({ mainClass: 'A', outputPaths: ['out'], classpath: [], jdkHome: '' }).startsWith('"java"'))
  // VM 选项插在 -cp 之前（IDEA 的 "VM options"）
  assert.match(javaRunCommand({ mainClass: 'A', outputPaths: ['out'], classpath: [], jdkHome: '', vmOptions: ['-Xmx512m'] }), /"java" -Xmx512m -cp/)
  assert.equal(javaRunCommand({ mainClass: '', outputPaths: ['out'], classpath: [], jdkHome: '' }), '', '没有主类就不给命令')
})

test('调试参数表：program 是 java 可执行文件，args 是 -cp 那串', () => {
  assert.deepEqual(javaRunArgs('com.example.Main', ['out/production/demo'], ['lib/a.jar']),
    ['-cp', 'out/production/demo;lib/a.jar', 'com.example.Main'])
  assert.equal(javaExecutable('D:\\Java21\\'), 'D:\\Java21\\bin\\java.exe', '结尾的斜杠要去掉')
  assert.equal(javaClasspath(['out'], []), 'out')
})

test('产物目录跟着构建工具走：Gradle 的几个目录整条进 classpath（回归：字符串被逐字符展开成 o;u;t;…）', () => {
  assert.equal(javaClasspath(['build/classes/java/main', 'build/resources/main'], []),
    'build/classes/java/main;build/resources/main')
  assert.equal(javaClasspath([], ['lib/a.jar']), 'lib/a.jar', '没有产物目录时也要能拼')
})

test('接线：运行当前上下文对 .java 走主类那条路', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /\.java\$\/i\.test\(tab\.path\)/, '要按扩展名分派')
  assert.match(actions, /mainClassFor/)
  assert.match(actions, /javaRunCommand/)
  assert.match(actions, /javaRunArgs/)
  const source = read('src/javaRun.ts')
  assert.match(source, /JvmMainMethodSearcher/, '源码依据要写在文件里')
})

test('JDK 路径的分隔符不会被拼混（探测结果是反斜杠那种，用户手输可能是正斜杠那种）', () => {
  const backslash = String.raw`D:\Java21`
  assert.equal(javaExecutable(backslash), String.raw`D:\Java21\bin\java.exe`)
  assert.equal(javaExecutable('D:/Java21'), 'D:/Java21/bin/java.exe')
  assert.equal(javaExecutable('  D:/Java21//  '), 'D:/Java21/bin/java.exe')
  assert.equal(javaExecutable(''), 'java')
  // 拼接结果里不该出现"一半反斜杠一半正斜杠"
  assert.ok(!javaExecutable('D:/Java21').includes('\\'))
})
