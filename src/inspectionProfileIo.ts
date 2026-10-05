// 检查配置档的落盘与读取 —— 上游 `InspectionProfileManager.INSPECTION_DIR`（"inspection"，
// `platform/analysis-impl/.../profile/codeInspection/InspectionProfileManager.java:20`）的工程级目录。
//
// 上游把**工程级** profile 写在工程目录里，真实样本就是上游工程自己的：
//   · `.idea/inspectionProfiles/idea_default.xml`         —— 一份 profile（`<profile version="1.0">` + `myName`）；
//   · `.idea/inspectionProfiles/idea_fatal_errors.xml`    —— 同上 + `is_locked="true"`；
//   · `.idea/inspectionProfiles/profiles_settings.xml`    —— 根 profile 选择（`PROJECT_PROFILE`）。
// 本仓照这个形状落盘，只是配置目录用本仓自己的 `.taocode/`（与插件本地仓库 `.taocode/plugins` 同族，
// 上游是 `.idea/` —— 那是 IDEA 的工程配置目录，本仓没有等价目录）。
//
// 通道：`file.create` / `file.write` / `file.read`（`src/bridge.ts:109` 的 Method 清单，
// 语义见 `native/main.cpp:985-990`（create）与 `:971-983`（write，要带 expectedVersion 的 CAS 写））。
// **不用** `app.writeExportFiles` —— 那条通道只放行 `.html`/`.htm`（`native/export_file.cpp`），
// 写不出 `.xml`。
//
// 依赖经 deps 注入（与 `src/workspaceInspection.ts` 同一套约定）：这样 `node --test` 能直接 import
// 本模块测纯逻辑，不必起桥。
import {
  currentProfileName, exportProfileSettingsXml, exportProfileXml, importProfileSettingsXml, importProfileXml,
  profileNames, selectProfile, DEFAULT_PROFILE_NAME,
} from './inspectionProfile.ts'

/** 工程级 profile 目录（工作区相对；上游是 `.idea/inspectionProfiles/`）。 */
export const PROFILE_DIR = '.taocode/inspectionProfiles'
/** 根 profile 选择那份的文件名（上游 `profiles_settings.xml`）。 */
export const PROFILE_SETTINGS_FILE = `${PROFILE_DIR}/profiles_settings.xml`

/** 一份 profile 的文件名（`<name>.xml`；上游同形，见 `.idea/inspectionProfiles/idea_default.xml`）。 */
export function profileFileName(name: string): string {
  return `${PROFILE_DIR}/${name}.xml`
}

export interface ProfileDiskDeps {
  /** `file.create`：建目录/文件（`{ path, directory? }`），已存在不报错。 */
  create: (path: string, directory?: boolean) => Promise<unknown>
  /** `file.read`：`{ path }` → `{ path, content, version }`。 */
  read: (path: string) => Promise<{ content?: string; version?: string }>
  /** `file.write`：`{ path, content, expectedVersion }`（CAS；新建文件的 expectedVersion 用空串）。 */
  write: (path: string, content: string, expectedVersion: string) => Promise<unknown>
  /** 工作区里的 `.xml` 清单（`workspace.files` → `{ path }[]`），用来发现已存在的 profile。 */
  list: () => Promise<Array<{ path: string }>>
}

export interface LoadProjectProfileOutcome {
  /** 读到的 profile 名（新导入的档）。 */
  loaded: string[]
  /** 切过去的根 profile 名（没读到 `profiles_settings.xml` 就是当前档）。 */
  root: string
  /** 逐条失败原因（坏 XML 不打空整批）。 */
  errors: string[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 目录里现有的 profile 文件名 → 档名（`.taocode/inspectionProfiles/<name>.xml` → `<name>`）。 */
export function profileNameFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized.startsWith(`${PROFILE_DIR}/`)) return null
  const base = normalized.slice(PROFILE_DIR.length + 1)
  if (!base.endsWith('.xml') || base.includes('/')) return null
  const name = base.slice(0, -'.xml'.length)
  return name || null
}

/**
 * 把工作区里的工程级 profile 读进配置档集合（上游 `InspectionProjectProfileManager` 在打开工程时
 * 读 `.idea/inspectionProfiles/` 那一遍的等价物）。
 *
 * 逐条坏文件只记一条 error、继续读下一条（不整批丢弃）—— 上游 `InspectionProfileSchemesModel.reset`
 * 对损坏的档也是逐个 `filter(Objects::nonNull)` 掉，不让一个坏档炸掉整张清单。
 */
export async function loadProjectProfiles(deps: ProfileDiskDeps): Promise<LoadProjectProfileOutcome> {
  const loaded: string[] = []
  const errors: string[] = []
  let files: Array<{ path: string }> = []
  try {
    files = await deps.list()
  } catch (error) {
    return { loaded, root: currentProfileName(), errors: [`读取 ${PROFILE_DIR} 失败：${messageOf(error)}`] }
  }
  for (const file of files) {
    const fallback = profileNameFromPath(file.path)
    if (fallback === null || fallback === 'profiles_settings') continue
    try {
      const doc = await deps.read(file.path)
      const name = importProfileXml(doc.content ?? '', { fallbackName: fallback })
      if (name) loaded.push(name)
      else errors.push(`${file.path}：没有 <profile> 元素`)
    } catch (error) {
      errors.push(`${file.path}：${messageOf(error)}`)
    }
  }
  let root = currentProfileName()
  try {
    const settings = await deps.read(PROFILE_SETTINGS_FILE)
    if (settings.content && importProfileSettingsXml(settings.content)) root = currentProfileName()
  } catch {
    // 没有 profiles_settings.xml 是常态（只用默认档），读不到就沿用当前档，不报错。
  }
  return { loaded, root, errors }
}

/**
 * 把当前选中的 profile 写进工程目录（上游 profile 编辑器的「Export to project」那一步的等价物）。
 * 落两份：profile 本体 + 根 profile 选择，形状照 `profiles_settings.xml`。
 * 写盘失败不回滚内存里的配置（上游导出失败也是只提示，profile 本身没丢）。
 */
export async function saveCurrentProfileToProject(deps: ProfileDiskDeps, name: string = currentProfileName()): Promise<{ path: string; bytes: number }> {
  const path = profileFileName(name)
  await deps.create(PROFILE_DIR, true)
  let version = ''
  try {
    const existing = await deps.read(path)
    version = existing.version ?? ''
  } catch {
    // 目标还没有：expectedVersion 用空串，等于「新建」。
  }
  const content = exportProfileXml(name)
  await deps.create(path)
  await deps.write(path, content, version)
  await deps.write(PROFILE_SETTINGS_FILE, exportProfileSettingsXml(name), await currentVersion(deps, PROFILE_SETTINGS_FILE))
  return { path, bytes: content.length }
}

async function currentVersion(deps: ProfileDiskDeps, path: string): Promise<string> {
  try {
    return (await deps.read(path)).version ?? ''
  } catch {
    return ''
  }
}

/** 切换 profile 并把选择落到工程目录（上游 `setRootProfile` 只改内存，落盘由 `profiles_settings.xml` 承担）。 */
export async function selectProfileOnDisk(deps: ProfileDiskDeps, name: string): Promise<boolean> {
  if (!profileNames().includes(name) || !selectProfile(name)) return false
  await deps.create(PROFILE_DIR, true)
  await deps.write(PROFILE_SETTINGS_FILE, exportProfileSettingsXml(name), await currentVersion(deps, PROFILE_SETTINGS_FILE))
  return true
}

export { DEFAULT_PROFILE_NAME }
