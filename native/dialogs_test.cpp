// Offline self-test for the generic file dialogs' **pure** part: 过滤器串解析。
//
// 真正的 `IFileOpenDialog` / `IFileSaveDialog` 要窗口与用户交互，测不了；
// 但"过滤器串 → {名称, 通配符} 列表"这一步错了，同样会让对话框列出错误的文件类型
// （导入设置时选了非归档、或导出时看不到 .zip），所以它是必须钉住的那一半。
#include "dialogs.hpp"

#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using taocode::dialogs::parse_file_filters;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

std::string render(const std::vector<std::pair<std::string, std::string>>& filters) {
    std::string out;
    for (const auto& filter : filters) {
        if (!out.empty()) out += " / ";
        out += filter.first + "=" + filter.second;
    }
    return out;
}

int failures = 0;

void run(const std::string& name, const std::function<void()>& body) {
    try {
        body();
        std::cout << "ok   " << name << '\n';
    } catch (const std::exception& error) {
        ++failures;
        std::cout << "FAIL " << name << ": " << error.what() << '\n';
    }
}

}  // namespace

int main() {
    run("成对的过滤器被解析出来", [] {
        const auto filters = parse_file_filters("设置归档|*.zip|所有文件|*.*");
        check(filters.size() == 2, "两组");
        check(render(filters) == "设置归档=*.zip / 所有文件=*.*", "名称与通配符按顺序成对");
    });

    run("单个过滤器也能用（导入设置就是这一种）", [] {
        const auto filters = parse_file_filters("设置归档 (*.zip)|*.zip");
        check(filters.size() == 1, "一组");
        check(filters[0].second == "*.zip", "通配符带扩展名");
    });

    run("落单/空片段被忽略，不至于造出列不出文件的过滤器", [] {
        // 名称没有配对的通配符 ⇒ 丢掉这一段
        check(parse_file_filters("设置归档|*.zip|只说了名字").size() == 1, "落单片段丢掉");
        check(parse_file_filters("|*.zip").size() == 0 || parse_file_filters("|*.zip").size() == 1, "空名称的空片段被跳过");
        check(render(parse_file_filters("|*.zip")) == "所有文件=*.*", "一个合法过滤器都没有时给兜底");
        check(render(parse_file_filters("名称|")) == "所有文件=*.*", "空通配符同样不算过滤器");
    });

    run("空串给兜底（否则对话框里文件类型列表是空的）", [] {
        check(render(parse_file_filters("")) == "所有文件=*.*", "空串 → 所有文件");
        check(render(parse_file_filters("|||")) == "所有文件=*.*", "全是分隔符 → 所有文件");
    });

    run("多扩展名与中文名称都原样保留", [] {
        const auto filters = parse_file_filters("图片 (*.png, *.jpg)|*.png;*.jpg;*.jpeg|文本|*.txt");
        check(filters.size() == 2, "两组");
        check(filters[0].first == "图片 (*.png, *.jpg)", "名称里的括号逗号不动");
        check(filters[0].second == "*.png;*.jpg;*.jpeg", "分号分隔的多扩展名不动");
        check(filters[1].first == "文本", "中文名称保留");
    });

    std::cout << (failures == 0 ? "dialogs: all checks passed\n" : "dialogs: failures\n");
    return failures == 0 ? 0 : 1;
}
