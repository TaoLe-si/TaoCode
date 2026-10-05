import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { parseStarterCommandLine, runApplicationStarter } from './applicationStarters.ts'
import { showStartupFailure } from './platformIdeStartupFailure.ts'

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
  // 界面挂不起来时不要留一片白窗：上游 `StartupErrorReporter.processException`
  // （platform/platform-impl/.../bootstrap/StartupErrorReporter.java:353-409）就是为这件事存在的，
  // 落点见 src/platformIdeStartupFailure.ts。
  try { createApp(App).mount('#app') } catch (error) { showStartupFailure(error) }
}
