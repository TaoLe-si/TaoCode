// IDEA expui 图标的渲染件 —— 把 `./ideaIconData.ts` 里那份**逐字节副本**画成一个 `<svg>`。
//
// 为什么是 `.ts` 而不是 `.vue`：`src/toolWindowMeta.ts`（纯逻辑模块，被 12 个测试直接
// `import`）要引用这里的组件，而 Node 的原生 TS 装载器**不会解析 `.vue`** —— 一旦链上出现
// `.vue`，`tests/tool-window-registry.test.mjs` 这类直接 import 注册表的测试会在加载期
// `ERR_MODULE_NOT_FOUND`。用 `h('svg', …)` 渲染就没有这个约束（Vue 的组件本来就可以是
// 一个带 `render` 的普通对象）。
//
// 为什么不用 lucide：lucide 是 24 格描边图，与 IDEA 的 16/20 格双形态不是同一套形状
// （依据与反例见 `ideaIconData.ts` 的文件头）。工具窗口条那 11 个图标在 IDEA 里**每个都有两份**
// —— `project.svg`（16 格细描边）与 `project@20x20.svg`（20 格实心手绘），
// 上游 `loadIconCustomVersion`（`customIconUtil.kt:44-62`）按目标尺寸去取对应的那一份。
// 所以这个组件也照同一条规则选表：`size >= 20` 取 20 格那份，否则取 16 格。
//
// 配色不在这里：上游写死的 `#6C707E` / `#CED0D6` 已被生成器换成 `currentColor`，
// 于是 `color` 由调用方的主题变量决定（`--secondary` / `--accent` …），明暗两套主题自动生效。
//
// 尺寸也不在这里拍：`size` 必须来自 `src/uiIcons.ts` 的角色阶梯（调用点写 `:size` 取
// 那一档，例如 rail 档 = 20），与 lucide 图标走同一个调用形状 —— 这样两条图标通道
// 在模板里长得一样，替换是逐处的。
import { h, type Component, type PropType } from 'vue'
import { IDEA_ICON_16, IDEA_ICON_20, IDEA_ICON_STATUS } from './ideaIconData.ts'

/**
 * 一个 IDEA 图标组件。`name` 是 `ideaIconData.ts` 两张表的键（如 `project` / `vcs`）。
 *
 * 子元素走 `innerHTML`（`h('svg', { innerHTML })`）—— 内容是**生成物**，不含任何用户输入，
 * 这是把上游那几条 `<path>` 字面量搬进 DOM 的唯一直接办法。`v-html` 那条安全规则在
 * 模板场景下同理（内容不是数据）。
 */
export const IdeaIcon: Component = {
  name: 'IdeaIcon',
  props: {
    name: { type: String, required: true },
    /** 边长（px）。`>= 20` 时取上游的 `@20x20` 变体，否则取 16 格那一份。 */
    size: { type: Number as PropType<number>, default: 16 },
    /**
     * `true` 时从**语义色表**（`IDEA_ICON_STATUS`）取图 —— 那一族（error/warning/info/success…）
     * 的配色由调用方的 `color` 决定（`currentColor`），与单色表不是同一批上游文件。
     */
    status: { type: Boolean, default: false },
  },
  setup(props) {
    return () => {
      const shape = props.status
        ? IDEA_ICON_STATUS[props.name]
        : props.size >= 20
          ? IDEA_ICON_20[props.name] ?? IDEA_ICON_16[props.name]
          : IDEA_ICON_16[props.name]
      if (!shape) return null
      return h('svg', {
        class: 'idea-icon',
        viewBox: shape.viewBox,
        width: props.size,
        height: props.size,
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
        innerHTML: shape.body.join(''),
      })
    }
  },
}

/**
 * 生成一个薄壳：固定图标名，只透传 `size`。
 *
 * 为什么要包一层：本仓所有图标位置都是 `<component :is="icons[id]" :size="…" />`
 * 这个调用形状（`src/components/ToolStripe.vue:200`、`ContentComboLabel.vue:161/175`、
 * `src/App.vue:2336` 的状态栏弹层）。lucide 的组件接受 `size`；`IdeaIcon` 需要的是
 * `name` + `size` 两个参数，所以这里给每个名字生成一个**只差一个名字**的薄壳，
 * 让两条通道在模板里长得完全一样 —— 替换是逐处的，不需要改任何调用点。
 */
export function ideaIconComponent(name: string): Component {
  return {
    name: `IdeaIcon_${name}`,
    props: { size: { type: Number as PropType<number>, default: 16 } },
    setup: props => () => h(IdeaIcon, { name, size: props.size }),
  }
}

/**
 * 与 `ideaIconComponent` 同形，但取的是**语义色表**（`IDEA_ICON_STATUS`）。
 *
 * 那一族（error / warning / info / success / bookmark / breakpoint）的上游文件在
 * `expui/status|gutter|breakpoints` 下，配色写死成语义色（已被生成器换成 `currentColor`）——
 * 与单色表的取表路径不同，所以薄壳也要分开生成，免得 `success` 这种名字去单色表里找不到、
 * 静默画空。
 */
export function ideaStatusIconComponent(name: string): Component {
  return {
    name: `IdeaStatusIcon_${name}`,
    props: { size: { type: Number as PropType<number>, default: 16 } },
    setup: props => () => h(IdeaIcon, { name, size: props.size, status: true }),
  }
}