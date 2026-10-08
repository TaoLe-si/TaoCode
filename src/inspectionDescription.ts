// 检查器的**描述富文档**（上游 `platform/lang-impl/src/com/intellij/codeInspection/actions/
// InspectionDescriptionDocumentationProvider.java` 一族）—— 纯函数，零 Vue、零 DOM。
//
// 上游做两件事：
//   ① `InspectionDescriptionDocumentationProvider.generateDoc(element, originalElement)`
//      （`:20-32`）：把 `InspectionElement` 的检查器**显示名**与它 `loadDescription()`
//      读到的 HTML 描述拼成快速文档的 definition/content 两段（`DocumentationMarkup.DEFINITION_START`
//      + `CONTENT_START`）。用户按住 Ctrl+Q 看检查器说明，看到的就是这一段；
//   ② `InspectionNodeInfo.stripUIRefsFromInspectionDescription(description)`
//      （`platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionNodeInfo.java:130-136`）：
//      描述 HTML 里 `<!-- tooltip end -->` 之后是**只给设置界面看**的 UI 引用（预览控件、锚点），
//      快速文档里要整段切掉 —— 那半截在文档里是没意义的标记。
//
// 本仓现状：问题面板的行菜单有「操作」（抑制/快速修复/高亮级别/忽略/纯文本/复制描述），
// 但没有「这个检查器是什么」的那一份说明 —— 行上只有 `source`（检查器短名）与 `code`。
// 本文件补两件本仓架构下能兑现的事：
//   · `stripInspectionDescription`：把 `<!-- tooltip end -->` 之后的 UI 引用切掉（上游 :130-136 的
//     逐字等价物，含"没有标记就原样返回"这条）；
//   · `inspectionDescriptionFor(source, code)`：给一个检查器身份**本地**取一段说明。
//     本仓的检查器分两类：语言服务给的（`source` 是 eslint/tsc/… 的规则名，本仓拿不到它的
//     HTML 描述，如实返回 null）与**本地内置**的（`src/junitInspections.ts` 的那批，
//     每条消息里都写着它对应的上游检查类短名）—— 后者这里按短名给一段说明。
//
// 判据：`tests/inspection-description.test.mjs`。

/** 一段检查器描述（上游 definition + content 两段的最小形状）。 */
export interface InspectionDescription {
  /** 显示名（上游 `toolWrapper.getDisplayName()`）。 */
  displayName: string
  /** 正文（HTML 或纯文本；上游把 `loadDescription()` 的结果放这里）。 */
  content: string
}

/**
 * 切掉 `<!-- tooltip end -->` 之后的 UI 引用（上游 `InspectionNodeInfo.java:130-136` 逐字等价）。
 * 没有那个标记时**原样返回**（上游那一支就是 `return description;`）。
 */
export function stripInspectionDescription(description: string): string {
  const end = description.indexOf('<!-- tooltip end -->')
  return end >= 0 ? description.slice(0, end) : description
}

/**
 * 本地内置检查器的说明表 —— 键是**上游检查类短名**（`src/junitInspections.ts` 的每条
 * `message` 末尾括号里写的那一个），值是显示名 + 一段说明。
 *
 * 说明文字的口径：`displayName` 取上游检查类的**人类可读名**（与问题面板「来源」列显示的短名不同，
 * 后者是类名）；正文写清「这条规则在什么情况下报、怎么修」—— 与上游 `loadDescription()` 读的
 * `inspectionDescriptions/<shortName>.html` 同一用途（那批 HTML 本仓不打包，所以这里按同样用途
 * 写成本地文案，不是抄某一份 HTML 的原文）。
 */
export const LOCAL_INSPECTION_DESCRIPTIONS: Readonly<Record<string, InspectionDescription>> = {
  MisorderedAssertEqualsArgumentsInspection: {
    displayName: '断言实参顺序颠倒',
    content: '`assertEquals` 的期望值应放在第一个参数：字面量/常量在前、变量在后。'
      + '颠倒时失败消息会把实际值说成期望值，读起来正好相反。把两个字面量与变量的位置换回来即可。',
  },
  JUnit3StyleTestMethodInJUnit4ClassInspection: {
    displayName: 'JUnit 4 类里的 JUnit 3 风格测试方法',
    content: '`public void testXxx()` 这种命名约定在 JUnit 4/5 里不会被识别为测试：'
      + 'JUnit 4 靠 `@Test`、JUnit 5 靠 `@Test`（`org.junit.jupiter.api.Test`）。'
      + '给方法补上对应注解，或者改用参数化/动态测试。',
  },
  UseOfObsoleteAssertInspection: {
    displayName: '使用了过时的 JUnit 3 断言',
    content: '`junit.framework.*` 与 `junit.framework.Assert` 是 JUnit 3 的 API，'
      + '在 JUnit 4/5 工程里应改用 `org.junit.Assert` 或 `org.junit.jupiter.api.Assertions`。',
  },
  JUnit4ConverterInspection: {
    displayName: 'JUnit 3 TestCase 应迁移到 JUnit 4/5',
    content: '继承 `junit.framework.TestCase` 是 JUnit 3 的写法。'
      + '迁移到 JUnit 4/5 时去掉继承、把 `setUp`/`tearDown` 换成 `@Before`/`@After`（或 `@BeforeEach`/`@AfterEach`）、'
      + '给测试方法补 `@Test`。',
  },
  JUnitIgnoredTestInspection: {
    displayName: '被忽略的测试没有说明原因',
    content: '`@Ignore` / `@Disabled` 应该带上原因字符串：'
      + '一个没有理由的跳过在几个月后没人知道该不该恢复。补上原因，或者直接删掉这个测试。',
  },
  ParameterizedParametersStaticCollectionInspection: {
    displayName: '@Parameters 数据提供者必须是静态方法',
    content: 'JUnit 4 的 `@Parameters` 由框架在实例化之前调用，'
      + '所以提供数据的方法必须是 `public static`。改成静态方法即可。',
  },
  // 上游显示名与问题描述：`plugins/junit/resources/messages/JUnitBundle.properties:107-108`
  // （`JUnit 3 'super.tearDown()' is not called from 'finally' block` / `<code>#ref()</code> is not
  // called from 'finally' block`）。正文按本仓口径写清「什么情况报、怎么修」。
  JUnit3SuperTearDownInspection: {
    displayName: "JUnit 3 的 super.tearDown() 没有从 finally 里调用",
    content: '`tearDown` 里除了调用 `super.tearDown()` 还做了别的事时，'
      + '前面一旦抛异常，基类的清理整段被跳过（`finally` 里调用才保证执行）。'
      + '把 `super.tearDown()` 放进 `finally` 块。',
  },
}

/**
 * 给一条诊断取检查器说明。
 *
 * `source` 是 LSP `Diagnostic.source`（检查器名），`code` 是诊断码 —— 上游按 `InspectionElement`
 * 取（那是结果树里的一个节点），本仓按这两个字段近似：先在本地内置表里按**短名**查
 * （`source` 或 `code` 命中即算），查不到返回 `null`（**不编**一段通用说明 —— 上游查不到也是 null，
 * `generateDoc` 那一支就是 `return null`）。
 */
export function inspectionDescriptionFor(source?: string | null, code?: string | number | null): InspectionDescription | null {
  const candidates = [source, typeof code === 'string' ? code : code === undefined || code === null ? null : String(code)]
  for (const candidate of candidates) {
    if (!candidate) continue
    // 本地内置表按上游检查类**短名**索引；诊断的 source/code 可能是完整类名或带包名，取末段比一次。
    const short = candidate.slice(candidate.lastIndexOf('.') + 1)
    const found = LOCAL_INSPECTION_DESCRIPTIONS[candidate] ?? LOCAL_INSPECTION_DESCRIPTIONS[short]
    if (found) return found
  }
  return null
}

/** 一条诊断能不能出「检查器说明」入口（上游 `generateDoc` 返回 null 时动作不可见）。 */
export function hasInspectionDescription(source?: string | null, code?: string | number | null): boolean {
  return inspectionDescriptionFor(source, code) !== null
}
