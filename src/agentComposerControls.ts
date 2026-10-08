// Agent 聊天工具条的「思考档」与「模式/权限切换」—— ZCode 真源码的**纯逻辑**复刻（零 Vue / 零 DOM）。
//
// 上游是 React/TSX，本仓是 Vue 3 + WebView2，组件不可直搬；按本仓铁律只搬**决策与文案映射**，
// 组件里只做接线。每条规则/文案在注释里指到 .tools/ZCode 的 文件:行号，指不到的不做。
//
// 上游文件：
//   · packages/ui/src/chat-input-toolbar/thoughtLevelOptions.ts      （思考档表 + 循环）
//   · packages/ui/src/chat-input-toolbar/display.tsx                 （模式标签/图标/选择器）
//   · packages/ui/src/chat-input-toolbar/display-help.ts             （模式词条 id 表）
//   · packages/ui/src/v4/composer/V4ComposerModeControls.tsx         （权限单选 + Plan 勾选）
//   · packages/ui/src/v4/composer/toolbarShortcuts.ts                （select 循环 + 快捷键槽）
//   · packages/shared/src/zcode-agent-model-state.ts                 （模式目录真实取值）
//   · packages/shared/src/zcode-agent-policy.ts                      （provider 常量）
//   · packages/ui/src/i18n/locales/zh-CN.ts                          （中文原文）

// ── 类型 ────────────────────────────────────────────────────────────────

/** 模式目录条目。取值与 `zcode-agent-model-state.ts:15-36` 的 `ZCODE_AGENT_MODE_OPTIONS` 同形。 */
export interface AgentComposerModeInfo {
  id: string
  name: string
  description: string
}

/** 一个 select 选项的纯数据投影，对应 `ZCodeConfigOption` 的 `type/currentValue/options` 三字段。 */
export interface AgentComposerSelectOption {
  type: string
  currentValue: unknown
  options?: ReadonlyArray<{ value: string }>
}

/** 模式/思考档的词条引用：`{ value, name }`，对应 `ZCodeConfigSelectValue` 的最小子集。 */
export interface AgentComposerSelectValueRef {
  value: string
  name: string
}

/** 草稿配置：**只编辑草稿**，不向 Runtime 发切换命令（`V4ComposerModeControls.tsx:40`）。 */
export interface AgentComposerDraftConfig {
  mode: string
  planEnabled: boolean
}

// ── 思考档 · thoughtLevelOptions.ts ─────────────────────────────────────

/** 逐字照抄 `thoughtLevelOptions.ts:7-16`（顺序也一致）。 */
export const NO_THOUGHT_LEVEL_VALUES: ReadonlySet<string> = new Set([
  "disabled",
  "false",
  "no",
  "none",
  "nothink",
  "no-think",
  "no_think",
  "off",
]);

/** 逐字照抄 `thoughtLevelOptions.ts:18-40`：档位值 → 词条 id。 */
export const THOUGHT_LEVEL_LABEL_IDS: Readonly<Record<string, string>> = {
  disabled: "chat.toolbar.thoughtLevel.value.off",
  false: "chat.toolbar.thoughtLevel.value.off",
  no: "chat.toolbar.thoughtLevel.value.off",
  none: "chat.toolbar.thoughtLevel.value.off",
  nothink: "chat.toolbar.thoughtLevel.value.off",
  "no-think": "chat.toolbar.thoughtLevel.value.off",
  no_think: "chat.toolbar.thoughtLevel.value.off",
  off: "chat.toolbar.thoughtLevel.value.off",
  enable: "chat.toolbar.thoughtLevel.value.on",
  enabled: "chat.toolbar.thoughtLevel.value.on",
  on: "chat.toolbar.thoughtLevel.value.on",
  true: "chat.toolbar.thoughtLevel.value.on",
  low: "chat.toolbar.thoughtLevel.value.low",
  minimal: "chat.toolbar.thoughtLevel.value.minimal",
  medium: "chat.toolbar.thoughtLevel.value.medium",
  high: "chat.toolbar.thoughtLevel.value.high",
  "extra-high": "chat.toolbar.thoughtLevel.value.xhigh",
  extra_high: "chat.toolbar.thoughtLevel.value.xhigh",
  xhigh: "chat.toolbar.thoughtLevel.value.xhigh",
  max: "chat.toolbar.thoughtLevel.value.max",
  ultra: "chat.toolbar.thoughtLevel.value.ultra",
};

/** `thoughtLevelOptions.ts:42-44`：trim + 小写。 */
export function normalizeThoughtLevelText(value: string): string {
  return value.trim().toLowerCase();
}

/** `thoughtLevelOptions.ts:50-52`：档位值 → 词条 id；表里没有返回 undefined。 */
export function thoughtLevelLabelId(value: string): string | undefined {
  return THOUGHT_LEVEL_LABEL_IDS[normalizeThoughtLevelText(value)];
}

/** `thoughtLevelOptions.ts:54-56`：是否是「关闭思考」档（用 entry.value 判定）。 */
export function isNoThoughtLevel(entry: { value: string }): boolean {
  return NO_THOUGHT_LEVEL_VALUES.has(normalizeThoughtLevelText(entry.value));
}

/**
 * `thoughtLevelOptions.ts:58-72`：循环到下一档。
 * 配置已声明档位顺序，名称别名只用于展示、不改变顺序；`type !== "select"`、
 * 无 options 或 `options.length < 2` 时返回 null。
 */
export function getNextThoughtLevelValue(option: AgentComposerSelectOption): string | null {
  if (option.type !== "select" || !option.options || option.options.length < 2) {
    return null;
  }

  const entries = option.options;
  const currentValue = String(option.currentValue);
  const currentIndex = entries.findIndex((candidate) => candidate.value === currentValue);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % entries.length;

  return entries[nextIndex]?.value ?? null;
}

/**
 * `thoughtLevelOptions.ts:74-89` + `display.tsx:171-182`：档位值 → 展示文案。
 * 词条表命中就用表里的中文；否则回落到 provider 自己的档位名（`entry.name`）。
 * `Object.hasOwn` 守卫照抄源码 `:81`（`constructor` 这类原型键不能被当词条 id）。
 */
export function getThoughtLevelLabelText(value: string, entryName: string): string {
  const normalized = normalizeThoughtLevelText(value);
  const labelId = Object.hasOwn(THOUGHT_LEVEL_LABEL_IDS, normalized)
    ? THOUGHT_LEVEL_LABEL_IDS[normalized]
    : undefined;
  if (labelId) {
    return AGENT_THOUGHT_LEVEL_TEXT[labelId] ?? entryName;
  }
  return entryName;
}

// ── 模式 · shared 真实取值 + display-help.ts ────────────────────────────

/** `zcode-agent-policy.ts:5`：`ZCODE_AGENT_PROVIDER = "glm"`。 */
export const ZCODE_AGENT_PROVIDER = "glm";

/** 逐字照抄 `zcode-agent-model-state.ts:15-36`（id/name/description 一字不改）。 */
export const ZCODE_AGENT_MODE_OPTIONS: ReadonlyArray<AgentComposerModeInfo> = [
  {
    id: "build",
    name: "Ask before changes",
    description: "Ask before each file changes.",
  },
  {
    id: "edit",
    name: "Edit automatically",
    description: "Edit selected files or relevant workspace files automatically.",
  },
  {
    id: "plan",
    name: "Plan mode",
    description: "Inspect the code and present a plan before editing.",
  },
  {
    id: "yolo",
    name: "Full access",
    description: "Edit and run commands with fewer confirmations.",
  },
];

/** `zcode-agent-model-state.ts:53-55`：返回拷贝，调用方改不动目录。 */
export function getZCodeAgentAvailableModes(): AgentComposerModeInfo[] {
  return ZCODE_AGENT_MODE_OPTIONS.map((mode) => ({ ...mode }));
}

/** 逐字照抄 `display-help.ts:3-10`。 */
export const ZCODE_MODE_OPTION_LABEL_IDS: Readonly<Record<string, Record<string, string>>> = {
  glm: {
    build: "mode.label.glm.build",
    edit: "mode.label.glm.edit",
    plan: "mode.label.glm.plan",
    yolo: "mode.label.glm.yolo",
  },
};

/** 逐字照抄 `display-help.ts:12-19`。 */
export const ZCODE_MODE_OPTION_DESCRIPTION_IDS: Readonly<Record<string, Record<string, string>>> = {
  glm: {
    build: "mode.description.glm.build",
    edit: "mode.description.glm.edit",
    plan: "mode.description.glm.plan",
    yolo: "mode.description.glm.yolo",
  },
};

/** `display.tsx:149-158`：provider 缺席或该 value 无词条 → null。 */
export function getModeOptionLabelMessageId(
  provider: string | undefined,
  value: string,
): string | null {
  if (!provider) {
    return null;
  }
  return ZCODE_MODE_OPTION_LABEL_IDS[provider]?.[value] ?? null;
}

/** `display.tsx:160-169`：provider 缺席或该 value 无词条 → null。 */
export function getModeOptionDescriptionMessageId(
  provider: string | undefined,
  value: string,
): string | null {
  if (!provider) {
    return null;
  }
  return ZCODE_MODE_OPTION_DESCRIPTION_IDS[provider]?.[value] ?? null;
}

/** `display.tsx:136-147`：命中词条用中文，否则回落 `entry.name`。 */
export function getModeOptionDisplayLabel(
  provider: string | undefined,
  entry: AgentComposerSelectValueRef,
): string {
  const labelMessageId = getModeOptionLabelMessageId(provider, entry.value);
  if (!labelMessageId) {
    return entry.name;
  }
  return AGENT_MODE_TEXT[labelMessageId] ?? entry.name;
}

/**
 * `display.tsx:206-220` 的等价：模式值 → lucide 图标名（不是组件，保持零 Vue）。
 * 依据 `display.tsx:37-42` 的 import：`HandIcon`→`Hand`、`NotepadText`→`NotepadText`、
 * `ShieldAlertIcon`→`ShieldAlert`、`ShieldCheckIcon`→`ShieldCheck`。
 * 判定顺序照抄：先 `yolo`（`isHighPermissionModeValue`），再 build，再 plan，再
 * `^(auto|agent|autoEdit|edit)$/i`，最后回落 `Hand`。
 */
export function resolveModeOptionIconName(value: unknown): string {
  if (value === "yolo") {
    return "ShieldAlert";
  }
  if (typeof value === "string" && value.toLocaleLowerCase() === "build") {
    return "Hand";
  }
  if (typeof value === "string" && value.toLocaleLowerCase() === "plan") {
    return "NotepadText";
  }
  if (typeof value === "string" && /^(auto|agent|autoEdit|edit)$/i.test(value)) {
    return "ShieldCheck";
  }
  return "Hand";
}

// ── 权限单选 + Plan 独立勾选 · V4ComposerModeControls.tsx ────────────────

/** `V4ComposerModeControls.tsx:63`：`modes.filter(mode => mode.id !== "plan")` —— 三种权限。 */
export function getZCodeAgentPermissionModes(
  modes: ReadonlyArray<AgentComposerModeInfo> = getZCodeAgentAvailableModes(),
): AgentComposerModeInfo[] {
  return modes.filter((mode) => mode.id !== "plan");
}

/** `V4ComposerModeControls.tsx:67`：Plan 是独立项，从目录里单独取出。 */
export function getZCodeAgentPlanMode(
  modes: ReadonlyArray<AgentComposerModeInfo> = getZCodeAgentAvailableModes(),
): AgentComposerModeInfo | undefined {
  return modes.find((mode) => mode.id === "plan");
}

/** `V4ComposerModeControls.tsx:64`：当前单选命中的权限项；命不中 → undefined（`if (!selected) return null`，:97）。 */
export function resolveSelectedPermissionMode(
  mode: string,
  modes: ReadonlyArray<AgentComposerModeInfo> = getZCodeAgentAvailableModes(),
): AgentComposerModeInfo | undefined {
  return getZCodeAgentPermissionModes(modes).find((candidate) => candidate.id === mode);
}

/** `V4ComposerModeControls.tsx:77`：模式选项缺省值 `draftConfig?.mode ?? "build"`。 */
export const DEFAULT_AGENT_COMPOSER_DRAFT_MODE = "build";

/**
 * `V4ComposerModeControls.tsx:71-83` 的 modeOption 投影：currentValue = 草稿 mode，
 * options = 权限项（**不含 plan**，plan 走独立勾选）。
 */
export function buildPermissionModeOption(
  draft: AgentComposerDraftConfig,
  modes: ReadonlyArray<AgentComposerModeInfo> = getZCodeAgentAvailableModes(),
): AgentComposerSelectOption {
  return {
    type: "select",
    currentValue: draft.mode ?? DEFAULT_AGENT_COMPOSER_DRAFT_MODE,
    options: getZCodeAgentPermissionModes(modes).map((mode) => ({ value: mode.id, name: mode.name })),
  };
}

/**
 * `V4ComposerModeControls.tsx:84-87`：`getNextConfigSelectValue(modeOption)` 的下一档。
 * 快捷键的 `hasAnyOption: Boolean(selected)` 门控留在调用方（:89），本函数保持纯。
 */
export function getNextPermissionModeValue(
  draft: AgentComposerDraftConfig,
  modes: ReadonlyArray<AgentComposerModeInfo> = getZCodeAgentAvailableModes(),
): string | null {
  return getNextConfigSelectValue(buildPermissionModeOption(draft, modes));
}

/**
 * `V4ComposerModeControls.tsx:143-158` 的勾选项 + `:160` 单选组 + `:188-202` 标记移除，
 * 三条交互都只**编辑草稿**（:40 注释）。selection 取 `"plan"` / `"plan-off"` / 某个权限 id。
 */
export function applyAgentComposerModeSelection(
  draft: AgentComposerDraftConfig,
  selection: string,
): AgentComposerDraftConfig {
  if (selection === "plan") {
    return { mode: draft.mode, planEnabled: true };
  }
  if (selection === "plan-off") {
    return { mode: draft.mode, planEnabled: false };
  }
  return { mode: selection, planEnabled: draft.planEnabled };
}

// ── select 循环 + 快捷键槽 · toolbarShortcuts.ts ────────────────────────

/**
 * `toolbarShortcuts.ts:43-55`：select 选项的下一次循环取值。
 * 与 `getNextThoughtLevelValue` 只差守卫：这里 `options.length` 为 0 就返回 null（不要求 ≥2）。
 */
export function getNextConfigSelectValue(option: AgentComposerSelectOption): string | null {
  if (option.type !== "select" || !option.options?.length) {
    return null;
  }

  const currentValue = String(option.currentValue);
  const currentIndex = option.options.findIndex((candidate) => candidate.value === currentValue);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % option.options.length;

  return option.options[nextIndex]?.value ?? null;
}

/** `toolbarShortcuts.ts:27-40`：按 config category 解析工具条热键槽位。 */
export function getChatToolbarShortcutKey(category: string): string | null {
  switch (category) {
    case "model":
      return "m";
    case "mode":
      return "ctrlShiftM";
    case "thought_level":
      return "t";
    default:
      return null;
  }
}

// ── 中文原文 · zh-CN.ts ─────────────────────────────────────────────────

/** `zh-CN.ts:4548-4556` 的 `chat.toolbar.thoughtLevel.value.*` 中文原文。 */
export const AGENT_THOUGHT_LEVEL_TEXT: Readonly<Record<string, string>> = {
  "chat.toolbar.thoughtLevel.value.off": "关闭",
  "chat.toolbar.thoughtLevel.value.on": "开启",
  "chat.toolbar.thoughtLevel.value.minimal": "极低",
  "chat.toolbar.thoughtLevel.value.low": "低",
  "chat.toolbar.thoughtLevel.value.medium": "中",
  "chat.toolbar.thoughtLevel.value.high": "高",
  "chat.toolbar.thoughtLevel.value.xhigh": "极高",
  "chat.toolbar.thoughtLevel.value.max": "最高",
  "chat.toolbar.thoughtLevel.value.ultra": "极致",
};

/** `zh-CN.ts:5641-5649` 的 `mode.*` 中文原文（标签 + 描述）。 */
export const AGENT_MODE_TEXT: Readonly<Record<string, string>> = {
  "mode.plan": "计划",
  "mode.label.glm.build": "变更前确认",
  "mode.label.glm.edit": "自动编辑",
  "mode.label.glm.plan": "计划模式",
  "mode.label.glm.yolo": "完全访问",
  "mode.description.glm.build": "改文件前先问我。",
  "mode.description.glm.edit": "自动编辑文件。",
  "mode.description.glm.plan": "编辑前先出计划。",
  "mode.description.glm.yolo": "减少确认次数。",
};

/** 工具条标签/提示的中文原文（`zh-CN.ts` 逐条指到行号）。 */
export const AGENT_COMPOSER_TOOLBAR_TEXT: Readonly<Record<string, string>> = {
  "chat.toolbar.mode.label": "切换模式", // zh-CN.ts:4531
  "chat.plan.removeMarker": "关闭计划模式", // zh-CN.ts:174
  "chat.toolbar.thoughtLevel.label": "推理强度", // zh-CN.ts:4543
  "chat.toolbar.thoughtLevel.tooltip": "思考级别", // zh-CN.ts:4544
  "chat.toolbar.thoughtLevel.placeholder": "选择思考档位", // zh-CN.ts:4545
};

/** 词条 id → 中文原文；查不到返回 undefined（调用方原样回落）。 */
export function agentComposerText(messageId: string): string | undefined {
  return AGENT_COMPOSER_TOOLBAR_TEXT[messageId] ?? AGENT_THOUGHT_LEVEL_TEXT[messageId] ?? AGENT_MODE_TEXT[messageId];
}