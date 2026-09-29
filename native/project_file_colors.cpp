#include "project_file_colors.hpp"
#include <algorithm>
#include <array>
#include <limits>
#include <exception>
#include <utility>
#include "text.hpp"
#include "settings_schema.hpp"
#include "fsops.hpp"

#include <objbase.h>
#include <xmllite.h>
#include <shlwapi.h>
#include <wrl/client.h>
#include <optional>

namespace taocode {
namespace {
using Microsoft::WRL::ComPtr;
constexpr std::size_t xml_limit = 16 * 1024 * 1024;
struct Layer {
    const wchar_t* file;
    const wchar_t* component;
    const char* key;
};
// FileColorModelStorageManager.kt:28-38; FileColorConfiguration.java:50-60.
constexpr Layer layers[] = {
    {L"workspace.xml", L"FileColors", "localFileColors"},
    {L"fileColors.xml", L"SharedFileColors", "fileColors"}
};

void xml_check(HRESULT status) {
    if (FAILED(status))
        fail("FILE_COLORS_XML_ERROR", "Cannot process file-color XML (HRESULT " +
             std::to_string(static_cast<unsigned long>(status)) + "); original files were kept unless a partial write is reported.");
}

std::wstring attribute(IXmlReader* reader, const wchar_t* name, bool required = false) {
    const auto status = reader->MoveToAttributeByName(name, nullptr);
    xml_check(status);
    if (status == S_FALSE) {
        if (required) fail("FILE_COLORS_XML_ERROR", "A fileColor entry is missing scope or color.");
        return {};
    }
    const wchar_t* text = nullptr;
    UINT length = 0;
    xml_check(reader->GetValue(&text, &length));
    std::wstring result(text, length);
    xml_check(reader->MoveToElement());
    return result;
}

void emit_component(IXmlWriter* writer, const Layer& layer, const Json& rules) {
    xml_check(writer->WriteStartElement(nullptr, L"component", nullptr));
    xml_check(writer->WriteAttributeString(nullptr, L"name", nullptr, layer.component));
    for (const auto& rule : rules) {
        const auto scope = wide(rule.at("scope").get_ref<const std::string&>());
        const auto color = wide(rule.at("color").get_ref<const std::string&>());
        xml_check(writer->WriteStartElement(nullptr, L"fileColor", nullptr));
        xml_check(writer->WriteAttributeString(nullptr, L"scope", nullptr, scope.c_str()));
        xml_check(writer->WriteAttributeString(nullptr, L"color", nullptr, color.c_str()));
        xml_check(writer->WriteEndElement());
    }
    xml_check(writer->WriteEndElement());
}

struct Document {
    Handle original;
    bool exists = false;
    Json rules = Json::array();
    std::string input;
    std::string output;
};

Document load(const fs::path& path, const Layer& layer, const Json* replacement,
              bool directory_exists = true, bool migration_only = false) {
    Document document;
    if (directory_exists) document.original = Handle(CreateFileW(api_path(path).c_str(), GENERIC_READ,
        FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    std::string bytes;
    if (!document.original) {
        const auto error = directory_exists ? GetLastError() : ERROR_PATH_NOT_FOUND;
        if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
            win_error("Cannot open file-color XML", error);
        bytes = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project version=\"4\"></project>\n";
    } else {
        document.exists = true;
        if (migration_only) replacement = nullptr;
        const auto info = file_info(document.original.get());
        reject_reparse(info);
        if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(document.original.get()) != FILE_TYPE_DISK)
            fail("FILE_COLORS_XML_ERROR", "File-color XML is not a regular file.");
        LARGE_INTEGER size{};
        if (!GetFileSizeEx(document.original.get(), &size)) win_error("Cannot inspect file-color XML");
        if (size.QuadPart < 0 || size.QuadPart > static_cast<LONGLONG>(xml_limit))
            fail("FILE_COLORS_XML_ERROR", "File-color XML exceeds the 16 MiB safety limit.");
        std::array<char, 65536> buffer{};
        for (;;) {
            DWORD count = 0;
            if (!ReadFile(document.original.get(), buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr))
                win_error("Cannot read file-color XML");
            if (!count) break;
            if (count > xml_limit - bytes.size()) fail("FILE_COLORS_XML_ERROR", "File-color XML exceeds 16 MiB.");
            bytes.append(buffer.data(), count);
        }
    }
    if (document.exists) document.input = bytes;
    ComPtr<IStream> input;
    input.Attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(bytes.data()), static_cast<UINT>(bytes.size())));
    if (!input) fail("IO_ERROR", "Cannot allocate XML input stream.");
    ComPtr<IXmlReader> reader;
    xml_check(CreateXmlReader(__uuidof(IXmlReader), reinterpret_cast<void**>(reader.GetAddressOf()), nullptr));
    // No DTDs, no external entity resolver, bounded nesting. Fail closed on any parser error.
    xml_check(reader->SetProperty(XmlReaderProperty_DtdProcessing, DtdProcessing_Prohibit));
    xml_check(reader->SetProperty(XmlReaderProperty_XmlResolver, 0));
    xml_check(reader->SetProperty(XmlReaderProperty_MaxElementDepth, 128));
    xml_check(reader->SetInput(input.Get()));
    ComPtr<IStream> output;
    ComPtr<IXmlWriter> writer;
    if (replacement) {
        xml_check(CreateStreamOnHGlobal(nullptr, TRUE, &output));
        xml_check(CreateXmlWriter(__uuidof(IXmlWriter), reinterpret_cast<void**>(writer.GetAddressOf()), nullptr));
        xml_check(writer->SetOutput(output.Get()));
    }
    bool root_seen = false, component_seen = false, in_component = false;
    XmlNodeType type{};
    HRESULT status;
    while ((status = reader->Read(&type)) == S_OK) {
        UINT depth = 0;
        xml_check(reader->GetDepth(&depth));
        const wchar_t* local = nullptr;
        const wchar_t* ns = nullptr;
        UINT length = 0, ns_length = 0;
        xml_check(reader->GetLocalName(&local, &length));
        xml_check(reader->GetNamespaceUri(&ns, &ns_length));
        const std::wstring_view name(local, length);
        if (type == XmlNodeType_Element && depth == 0) {
            if (root_seen || name != L"project" || ns_length)
                fail("FILE_COLORS_XML_ERROR", "Expected one unnamespaced project XML root.");
            root_seen = true;
            if (reader->IsEmptyElement() && writer) {
                // Expand a self-closing project without discarding its attributes.
                xml_check(writer->WriteStartElement(nullptr, L"project", nullptr));
                xml_check(writer->WriteAttributes(reader.Get(), FALSE));
                emit_component(writer.Get(), layer, *replacement);
                xml_check(writer->WriteEndElement());
                continue;
            }
        }
        if (type == XmlNodeType_Element && depth == 1 && name == L"component" && !ns_length &&
            attribute(reader.Get(), L"name") == layer.component) {
            if (component_seen) fail("FILE_COLORS_XML_ERROR", "Duplicate file-color XML components are ambiguous.");
            component_seen = true;
            in_component = !reader->IsEmptyElement();
            if (writer) emit_component(writer.Get(), layer, *replacement);
            continue;
        }
        if (in_component) {
            if (type == XmlNodeType_Element && depth == 2 && name == L"fileColor" && !ns_length) {
                document.rules.push_back({{"scope", utf8(attribute(reader.Get(), L"scope", true))},
                                          {"color", utf8(attribute(reader.Get(), L"color", true))}});
            }
            // XmlLite reports EndElement depth one greater than its start tag.
            if (type == XmlNodeType_EndElement && depth == 2) in_component = false;
            continue;
        }
        if (writer) {
            if (type == XmlNodeType_EndElement && depth == 1 && !component_seen)
                emit_component(writer.Get(), layer, *replacement);
            // Preserve all other components, attributes, text, comments and PIs.
            // XML lexical formatting/encoding may normalize; unrelated DOM content does not change.
            xml_check(writer->WriteNodeShallow(reader.Get(), FALSE));
        }
    }
    xml_check(status);
    if (!root_seen) fail("FILE_COLORS_XML_ERROR", "File-color XML is empty or has no project root.");
    if (writer) {
        xml_check(writer->Flush());
        STATSTG stat{};
        xml_check(output->Stat(&stat, STATFLAG_NONAME));
        if (stat.cbSize.QuadPart > xml_limit) fail("FILE_COLORS_XML_ERROR", "Updated XML exceeds 16 MiB.");
        LARGE_INTEGER start{};
        xml_check(output->Seek(start, STREAM_SEEK_SET, nullptr));
        document.output.resize(static_cast<std::size_t>(stat.cbSize.QuadPart));
        ULONG read = 0;
        xml_check(output->Read(document.output.data(), static_cast<ULONG>(document.output.size()), &read));
        if (read != document.output.size()) fail("IO_ERROR", "Incomplete XML serialization.");
    }
    return document;
}
} // namespace

void read_project_file_colors(const fs::path& root, Json& settings) {
    auto parent = pin_directory(absolute_path(root, true) / L".idea", Missing::allow);
    if (!parent.exists) return;
    for (const auto& layer : layers) {
        auto document = load(parent.path / layer.file, layer, nullptr);
        if (document.exists) settings[layer.key] = std::move(document.rules);
    }
}

void save_project_settings_layers(const fs::path& root, const Json& legacy, const Json& patch,
                                  const std::function<void()>& save_application) {
    const auto idea = absolute_path(root, true) / L".idea";
    auto parent = pin_directory(idea, Missing::allow);
    std::array<Document, 2> documents;
    std::array<bool, 2> pending{};
    // Parse BOTH files before any publication. Legacy data never modifies an existing XML file.
    for (std::size_t i = 0; i < 2; ++i) {
        const auto& layer = layers[i];
        const Json* rules = patch.contains(layer.key) ? &patch.at(layer.key) :
                            legacy.contains(layer.key) ? &legacy.at(layer.key) : nullptr;
        documents[i] = load(parent.path / layer.file, layer, rules, parent.exists, !patch.contains(layer.key));
        pending[i] = rules && (patch.contains(layer.key) || (!documents[i].exists && !rules->empty()));
    }
    if (!pending[0] && !pending[1]) {
        save_application();
        return;
    }
    if (!parent.exists) parent = pin_directory(idea, Missing::create);
    std::array<std::optional<OwnedObject>, 2> staged, backups;
    std::array<fs::path, 2> targets;
    std::array<bool, 2> published{};
    // Stage new XML AND exact-byte rollback copies. An unrelated workspace
    // component must survive even if a later file or the application save fails.
    for (std::size_t i = 0; i < 2; ++i) if (pending[i]) {
        targets[i] = parent.path / layers[i].file;
        staged[i].emplace(temporary_object(parent.path, false));
        write_and_flush(staged[i]->handle.get(), documents[i].output);
        if (documents[i].exists) {
            backups[i].emplace(temporary_object(parent.path, false));
            write_and_flush(backups[i]->handle.get(), documents[i].input);
        }
    }
    // Detect ordinary sharing/ACL failures in either layer BEFORE changing one.
    // Release our own read handles so the DELETE probe doesn't conflict with them.
    for (std::size_t i = 0; i < 2; ++i) if (pending[i]) {
        documents[i].original.reset();
        if (documents[i].exists) {
            Handle reservation(CreateFileW(api_path(targets[i]).c_str(), DELETE,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
            if (!reservation) win_error("Cannot replace file-color XML");
            reject_reparse(file_info(reservation.get()));
        } else {
            require_absent(targets[i]);
        }
    }
    try {
        for (std::size_t i = 0; i < 2; ++i) if (pending[i]) {
            rename_handle(staged[i]->handle.get(), targets[i], documents[i].exists);
            staged[i]->cleanup = false;
            published[i] = true;
        }
        // The application candidate was staged before entering this function.
        // Keep rollback copies until its final atomic replacement succeeds.
        save_application();
    } catch (...) {
        const auto original_error = std::current_exception();
        std::string recovery;
        for (std::size_t i = 2; i-- > 0;) if (published[i]) {
            try {
                if (backups[i]) {
                    staged[i]->handle.reset();
                    rename_handle(backups[i]->handle.get(), targets[i], true);
                    backups[i]->cleanup = false;
                } else {
                    FILE_DISPOSITION_INFO disposition{TRUE};
                    if (!SetFileInformationByHandle(staged[i]->handle.get(), FileDispositionInfo,
                                                   &disposition, sizeof(disposition)))
                        win_error("Cannot roll back newly created file-color XML");
                    staged[i]->handle.reset();
                }
            } catch (...) {
                // Never delete the only surviving original on rollback failure.
                if (backups[i]) {
                    backups[i]->cleanup = false;
                    recovery += " Original XML retained at " + utf8_path(backups[i]->path) + ".";
                } else {
                    recovery += " Newly created XML remains at " + utf8_path(targets[i]) + ".";
                }
            }
        }
        if (!recovery.empty())
            fail("PROJECT_SETTINGS_PARTIAL_WRITE", "Saving failed and XML rollback was incomplete; reload before retrying." + recovery);
        std::rethrow_exception(original_error);
    }
}

} // namespace taocode

