import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { parseStarterCommandLine, runApplicationStarter } from './applicationStarters.ts'
import { showStartupFailure } from './platformIdeStartupFailure.ts'
import { loadIgnoredPatterns } from './fileTypeIgnoredList.ts'

// 浏览器预览的「命令行」：真实 argv 在宿主 `native/main.cpp` 里、当前没有透出到前端的通道，
// 所以 `?command=<名字>&args=...` 是 `ApplicationStarter` 的入口替身（如
// `list-commands`、`generateEnvironmentKeysFile`）。跑启动命令时不挂 App，只把输出文本
// 放进页面；没有 command 参数时行为与以前完全一样。
const starterCommand = parseStarterCommandLine(window.location.search)
if (starterCommand) {
  void runApplicationStarter(starterCommand.command, starterCommand.args).then(result => {
    const output = document.createElement('pre')
    output.id = 'starter-output'
    output.textContent = result.error ? `${result.error}\n` : result.output
    document.body.appendChild(output)
  })
} else {
  // 「忽略的文件与目录」要在任何界面挂起来之前灌进文件类型注册表：上游那张表是
  // `FileTypeManagerImpl` 的组件字段（`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:165`
  // `new IgnoredPatternSet(DEFAULT_IGNORED)`，默认表同文件 `:142`），存过的那份在 loadState
  // 里直接 `ignoredPatterns.setIgnoreMasks(...)`（同文件 `:1236-1238`），不是某个设置页的副作用。
  // 订正（2026-10-06 复核 docs/wiring-requests-2026-10-06-bucket15.md W3）：原写「:1363-1364」，
  // 那几行实际是 `setFileTypes` 里的 `readHashBangs`，指不到忽略清单 ⇒ 坐标改成 :165 + :1236-1238。
  // 另一处订正：请求给的代码是 `applyIgnoredPatterns(loadIgnoredPatterns())`，但
  // `loadIgnoredPatterns()` 自己已经 `applyToManager`（src/fileTypeIgnoredList.ts:226-230），
  // 再套一层只会多写一次 localStorage ⇒ 只调 loadIgnoredPatterns()。
  loadIgnoredPatterns()
  // 界面挂不起来时不要留一片白窗：上游 `StartupErrorReporter.processException`
  // （platform/platform-impl/.../bootstrap/StartupErrorReporter.java:353-409）就是为这件事存在的，
  // 落点见 src/platformIdeStartupFailure.ts。
  try { createApp(App).mount('#app') } catch (error) { showStartupFailure(error) }
}
