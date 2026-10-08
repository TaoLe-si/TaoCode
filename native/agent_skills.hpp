#pragma once

#include <string>

#include "workspace.hpp"

namespace taocode::agent_skills {

Json list(const std::string& workspace_path);
Json set_enabled(const std::string& workspace_path, const std::string& skill_id, bool enabled);
Json delete_skill(const std::string& workspace_path, const std::string& skill_id);
Json reveal_skill(const std::string& workspace_path, const std::string& skill_id);
Json build_prompt_context(const std::string& workspace_path, const std::string& prompt);

}  // namespace taocode::agent_skills
