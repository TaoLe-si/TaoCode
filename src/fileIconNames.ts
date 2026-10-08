// **文件图标名的解析**（`com.intellij.fileIconProvider` 的呈现那一半）。
//
// 上游 `FileIconProvider.getIcon(file, flags, project)` 返回一个 `javax.swing.Icon`；本仓没有 `Icon`，
// 第三方插件在本仓挂 provider 时给的是**图标名**（`src/ideViewExtensionPoints.ts` 的
// `FileIconProviderContribution`）。这一层只做「图标名 → 本仓用得上的东西」的翻译：
//   · 名字命中 lucide 图标表 ⇒ 交给模板 `<component :is>`；
//   · 是内建的两个合成图标名（`libraries` / `scratches`）⇒ 调用方自己那几个分支画，不在这里吞；
//   · 其余名字（上游 `Icon` 无法在 DOM 里复现、或第三方自造）⇒ null，调用方**落回既有图标表**
//     （不画假图标，也不因为一个坏名字把整行图标位空掉）。
//
// 纯函数，无 DOM / 无 vue 运行时，便于 `node --test` 直测。判断只认「名字在不在表里」。
import {
  Archive, BookOpen, Box, Bug, Coffee, Database, FileCode2, FileJson, FileText, Folder, FolderOpen,
  Globe, Image, Key, Map, Package, Palette, Puzzle, Ruler, Settings2, Shield, Terminal, Wrench,
} from 'lucide-vue-next'
import type { Component } from 'vue'

/**
 * 图标名 → lucide 组件。名字口径是**本仓自定**的一小张表（上游 `Icon` 是图片资源，名字对不上）：
 * 取 IDEA 常见文件图标的语义（归档 / 图片 / 配置 / 终端 …）而不是上游的资源路径。
 * 表里没名字就返回 null（调用方退内建图标），不抛错。
 */
export const FILE_ICON_COMPONENTS: Record<string, Component> = {
  archive: Archive, book: BookOpen, box: Box, bug: Bug, coffee: Coffee, database: Database,
  file: FileText, fileCode: FileCode2, fileJson: FileJson, folder: Folder, folderOpen: FolderOpen,
  globe: Globe, image: Image, key: Key, map: Map, package: Package, palette: Palette, puzzle: Puzzle,
  ruler: Ruler, settings: Settings2, shield: Shield, terminal: Terminal, wrench: Wrench,
}

/** 内建的两个合成根图标名（画法在组件里，不在本表里）。 */
export const SYNTHETIC_ICON_NAMES: readonly string[] = ['libraries', 'scratches']

/**
 * 解析一个 provider 给的图标名。命中已知图标名返回组件；内建合成名 / 空 / 认不出来返回 null
 * （调用方按「没有自定义图标」处理）。
 */
export function fileIconComponent(name: string | null | undefined): Component | null {
  if (!name || SYNTHETIC_ICON_NAMES.includes(name)) return null
  return FILE_ICON_COMPONENTS[name] ?? null
}

/** 名字在不在表里（诊断/判据用；不对内建合成名给 true —— 那两档不归这张表）。 */
export function isKnownFileIconName(name: string): boolean {
  return name in FILE_ICON_COMPONENTS
}
