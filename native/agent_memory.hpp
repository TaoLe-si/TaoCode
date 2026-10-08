#pragma once

#include "workspace.hpp"

namespace taocode::agent_memory {

Json list_project_memories();
Json read_project_memory_file(const std::string& workspace_id, const std::string& file_name);

}  // namespace taocode::agent_memory
