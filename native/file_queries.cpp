#include "file_queries.hpp"

#include "workspace.hpp"

namespace taocode {

bool dispatch_file_query(const std::string& method, const Json& params, Workspace& workspace, Json& result) {
    // 按名字比较就够：这一组只有七条，而且**故意不并进 main.cpp 的哈希分派表**（那张表是
    // `Method` union 的机检锚点，见 docs/native-dispatch.md；这里少一条 case 就少一次对齐成本）。
    const auto text = [&params](const char* key) { return params.at(key).get<std::string>(); };
    if (method == "file.readOnly") {
        result = workspace.set_read_only(text("path"), params.value("readOnly", true));
        return true;
    }
    if (method == "file.lineSeparators") {
        result = workspace.convert_line_separators(text("path"), text("separator"), text("content"), text("expectedVersion"));
        return true;
    }
    if (method == "file.readBinary") {
        result = workspace.read_binary(text("path"), params.value("limit", std::size_t{1024 * 1024}));
        return true;
    }
    // Safe delete: "is anything still referring to this?" answered by a real
    // workspace scan (file + line + preview), so the confirm dialog can show
    // the same rows IDEA's Safe Delete dialog would.
    if (method == "file.usages") {
        result = workspace.usages_of(text("path"), params.value("symbol", std::string()));
        return true;
    }
    if (method == "file.reveal") {
        result = workspace.reveal(text("path"));
        return true;
    }
    // RevealFileAction for absolute paths: the welcome screen has no workspace yet
    // (welcomeScreen/projectActions/RevealProjectDirAction.kt:25-33).
    if (method == "shell.reveal") {
        result = reveal_absolute(text("path"));
        return true;
    }
    // LSP `documentLink.target` 与控制台输出里的 URL：交给系统默认处理器打开。
    // `open_external` 会**拒绝没有协议前缀的字符串** —— 那是一个安全边界，见 workspace.cpp。
    if (method == "shell.openUrl") {
        result = open_external(text("url"));
        return true;
    }
    return false;
}

}  // namespace taocode
