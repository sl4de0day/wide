

#pragma once
#include <windows.h>
#include <string>

std::string HandleHostService(HWND hwnd, const std::string& method,
                              const std::string& paramsJson);
