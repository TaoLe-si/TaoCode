// Smith-Waterman 模糊匹配（`src/fuzzyMatch.ts`）—— 判据直接对着上游的分值语义写。
//
// 上游：`platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/fuzzyMatching/`
// 的 `SmithWatermanAlgorithm.kt` / `ScoringParameters.kt` / `AlignmentMatrix.kt`，
// 文件侧的封装是 `platform/searchEverywhere/backend/src/providers/filesFuzzy/SmithWatermanMatcher.kt`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SCORING_PARAMETERS, FUZZY_FILES_MIN_SCORE, MAX_FUZZY_WEIGHT, fuzzyMatch, fuzzyMatchFileName, fuzzyMatchPath, fuzzyWeight, passesFuzzyThreshold } from '../src/fuzzyMatch.ts'

test('权重与阈值常量就是上游那两个数（SeFuzzyFileSearchItem.MAX_FUZZY_WEIGHT / 注册表默认值）', () => {
  assert.equal(MAX_FUZZY_WEIGHT, 9999)
  assert.equal(FUZZY_FILES_MIN_SCORE, 6500)
  assert.ok(FUZZY_FILES_MIN_SCORE < MAX_FUZZY_WEIGHT, '阈值压在词首命中的 10000 之下')
})

test('不命中就是 0：模式不是子序列、模式比目标长、空串', () => {
  assert.equal(fuzzyMatch('xyz', 'GotoClassFile.kt').score, 0)
  assert.equal(fuzzyMatch('aaaaaaaaaa', 'abc').score, 0)
  assert.equal(fuzzyMatch('', 'abc').score, 0)
  assert.equal(fuzzyMatch('a', '').score, 0)
})

test('大小写不敏感的子序列命中，并回出命中下标', () => {
  const result = fuzzyMatch('gcf', 'GotoClassFile.kt')
  assert.ok(result.score > 0)
  assert.deepEqual(result.indices, [0, 4, 9], 'G-o-t-o-C-l-a-s-s-F：g=0、c=4、f=9')
})

test('连续命中比散开命中分高（consecutiveBonus 6）', () => {
  const contiguous = fuzzyMatch('class', 'GotoClassFile.kt')
  const scattered = fuzzyMatch('cls', 'GotoClassFile.kt')
  assert.ok(contiguous.score > scattered.score, `${contiguous.score} 应当大于 ${scattered.score}`)
})

test('首字符、驼峰、分隔符三种花红各有用（分值来自 ScoringParameters 默认值）', () => {
  const params = DEFAULT_SCORING_PARAMETERS
  assert.equal(params.matchScore, 16)
  assert.equal(params.firstCharBonus, 8)
  assert.equal(params.consecutiveBonus, 6)
  assert.equal(params.camelCaseBonus, 7)
  assert.equal(params.separatorBonus, 8)
  assert.equal(params.gapPenalty, -1)
  // 同一个字母命中在词首（大写）比命中在词中多驼峰那 7 分。
  const atBoundary = fuzzyMatch('f', 'ClassFile.kt')
  const insideWord = fuzzyMatch('l', 'ClassFile.kt')
  assert.ok(atBoundary.score >= insideWord.score + 7, `词首 ${atBoundary.score} 至少比词中 ${insideWord.score} 多 7`)
  // 分隔符之后同样有花红：`/` 后的 `m`（24 = 16 + 8）比词中的 `c`、`n`（各 16）高。
  const afterSeparator = fuzzyMatch('m', 'src/main/App.kt')
  const insideWord2 = fuzzyMatch('c', 'src/main/App.kt')
  assert.equal(afterSeparator.score, 24, '`/` 之后的 m 命中拿 16 + separatorBonus 8')
  assert.ok(afterSeparator.score > insideWord2.score)
})

test('归一化落在 0..1，且更短的目标更占优', () => {
  const short = fuzzyMatch('gcf', 'GotoClassFile.kt')
  const long = fuzzyMatch('gcf', 'GotoClassFileWithAVeryLongSuffixName.kt')
  assert.ok(short.normalized > 0 && short.normalized <= 1)
  assert.ok(long.normalized > 0 && long.normalized <= 1)
  assert.ok(short.normalized >= long.normalized, '同样命中时短名字的归一分不该更低')
})

test('文件名匹配：模式带扩展名时按扩展名过滤，且比的是去掉扩展名的名字', () => {
  assert.equal(fuzzyMatchFileName('gcf', 'GotoClassFile.kt')?.score, fuzzyMatch('gcf', 'GotoClassFile').score)
  assert.equal(fuzzyMatchFileName('app.kt', 'App.kt')?.score, fuzzyMatch('app', 'App').score)
  assert.equal(fuzzyMatchFileName('app.java', 'App.kt'), null, '扩展名对不上就不算命中')
  assert.equal(fuzzyMatchFileName('zzz', 'App.kt'), null)
})

test('路径匹配：文件名强命中就用文件名，弱命中才看整条路径（阈值 0.7）', () => {
  const byName = fuzzyMatchPath('app', 'src/main/App.kt')
  assert.equal(byName?.score, fuzzyMatch('app', 'App').score, '文件名命中够强时用文件名那一档')
  assert.deepEqual(byName?.indices, [0, 1, 2], '高亮下标是文件名里的下标，不是整条路径里的')
  const byPath = fuzzyMatchPath('srcmain', 'src/main/App.kt')
  assert.ok((byPath?.score ?? 0) > 0, '文件名档弱时应当退到整条路径上匹配')
  assert.equal(fuzzyMatchPath('zzz', 'src/main/App.kt'), null, '两档都没命中就是 null')
})

test('局部对齐会捞出"部分命中"，靠阈值滤掉（上游注册表键 search.everywhere.fuzzy.files.min.score=6500）', () => {
  // `nothing` 不是 `src/main/App.kt` 的子序列，但本地对齐仍能捞出 `i`+`n` 两个字符（分数为正）。
  // 这就是上游为什么要在 provider 里加一道 minScore 阈值，而不是只判"有没有命中"。
  const partial = fuzzyMatch('nothing', 'src/main/App.kt')
  assert.ok(partial.score > 0, '部分命中分数为正')
  assert.ok(partial.normalized < 0.65, `归一分 ${partial.normalized} 落在 0.65 以下`)
  assert.equal(passesFuzzyThreshold(partial.normalized), false, '所以过不了阈值')
  assert.equal(passesFuzzyThreshold(fuzzyMatch('app', 'src/main/App.kt').normalized), true)
  assert.equal(fuzzyWeight(0.9991176470588236), 9990, '权重 = 归一分 * 9999 取整（截断不是四舍五入）')
})
