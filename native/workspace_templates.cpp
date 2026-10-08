// 「新建文件时写进空文件的那段初始正文」——`Workspace::create` 的 `template_kind` 那一张表
// （2026-10-08 从 native/workspace.cpp 整段搬出：那个文件当时 1400 行、上限 1385，只剩 16 行
// 余量）。这一族只做一件事：按文件名取基名，拼出 java / kotlin / typescript / vue / react /
// html / markdown 的骨架。它不读工作区状态、不做路径校验、不碰文件句柄 —— 把正文写进刚创建的
// 空文件仍是 workspace.cpp 里原来那段 WriteFile 循环，搬出来的只是正文本身。
//
// 搬动时**实现一个字没改**：下面从 `const auto dot` 到最后一个分支的收尾，与 workspace.cpp 里
// 原来的逐字相同（唯一差别是原来那一行 `const auto filename = path.filename().string();` 现在由
// 调用方求值后作为参数传进来）。声明见 native/workspace_detail.hpp，定义只有本文件这一份。

#include "workspace.hpp"
#include "workspace_detail.hpp"

#include <string>

namespace taocode {
namespace detail {

std::string file_template_content(const std::string& template_kind, const std::string& filename) {
    const auto dot = filename.find_last_of('.');
    const auto base_name = dot == std::string::npos ? filename : filename.substr(0, dot);
    std::string content;
    if (template_kind == "java-class") {
        content = "public class " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "java-interface") {
        content = "public interface " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "java-enum") {
        content = "public enum " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "java-record") {
        content = "public record " + base_name + "() {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "java-annotation") {
        content = "import java.lang.annotation.*;\n\n"
                  "@Retention(RetentionPolicy.RUNTIME)\n"
                  "@Target(ElementType.TYPE)\n"
                  "public @interface " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "kotlin-class") {
        content = "class " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "kotlin-object") {
        content = "object " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "kotlin-interface") {
        content = "interface " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "kotlin-data") {
        content = "data class " + base_name + "(\n"
                  "    \n"
                  ")\n";
    } else if (template_kind == "typescript-class") {
        content = "export class " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "typescript-interface") {
        content = "export interface " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "typescript-enum") {
        content = "export enum " + base_name + " {\n"
                  "    \n"
                  "}\n";
    } else if (template_kind == "vue-component") {
        content = "<template>\n"
                  "  <div>\n"
                  "    \n"
                  "  </div>\n"
                  "</template>\n\n"
                  "<script setup lang=\"ts\">\n"
                  "</script>\n\n"
                  "<style scoped>\n"
                  "</style>\n";
    } else if (template_kind == "react-component") {
        content = "export function " + base_name + "() {\n"
                  "  return (\n"
                  "    <div>\n"
                  "      \n"
                  "    </div>\n"
                  "  )\n"
                  "}\n";
    } else if (template_kind == "html-file") {
        content = "<!DOCTYPE html>\n"
                  "<html lang=\"zh-CN\">\n"
                  "<head>\n"
                  "    <meta charset=\"UTF-8\">\n"
                  "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                  "    <title>" + base_name + "</title>\n"
                  "</head>\n"
                  "<body>\n"
                  "    \n"
                  "</body>\n"
                  "</html>\n";
    } else if (template_kind == "markdown-file") {
        content = "# " + base_name + "\n\n";
    }
    return content;
}

}  // namespace detail
}  // namespace taocode
