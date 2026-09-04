#include "ipc.h"
#include "util.h"

#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shellapi.h>

#include <string>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace {

json ShowOpenDialog(HWND hwnd, const json& options) {
  json result = {{"canceled", true}, {"filePaths", json::array()}};

  bool pickFolders = false;
  bool multi = false;
  if (options.contains("properties") && options["properties"].is_array()) {
    for (auto& p : options["properties"]) {
      std::string s = p.get<std::string>();
      if (s == "openDirectory") pickFolders = true;
      if (s == "multiSelections") multi = true;
    }
  }

  IFileOpenDialog* dlg = nullptr;
  if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL,
                              IID_PPV_ARGS(&dlg))))
    return result;
  DWORD opts = 0;
  dlg->GetOptions(&opts);
  opts |= FOS_FORCEFILESYSTEM;
  if (pickFolders) opts |= FOS_PICKFOLDERS;
  if (multi) opts |= FOS_ALLOWMULTISELECT;
  dlg->SetOptions(opts);

  if (SUCCEEDED(dlg->Show(hwnd))) {
    IShellItem* item = nullptr;
    if (SUCCEEDED(dlg->GetResult(&item))) {
      PWSTR path = nullptr;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
        result["canceled"] = false;
        result["filePaths"] = json::array({WideToUtf8(std::wstring(path))});
        CoTaskMemFree(path);
      }
      item->Release();
    }
  }
  dlg->Release();
  return result;
}

json ShowItemInFolder(const std::wstring& path) {
  std::wstring args = L"/select,\"" + path + L"\"";
  ShellExecuteW(nullptr, L"open", L"explorer.exe", args.c_str(), nullptr,
                SW_SHOWNORMAL);
  return json(nullptr);
}

json OpenExternal(const std::wstring& url) {
  ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  return json(nullptr);
}

json TrashItem(const std::wstring& path) {
  std::wstring dn = path;
  dn.push_back(L'\0');
  dn.push_back(L'\0');
  SHFILEOPSTRUCTW op = {};
  op.wFunc = FO_DELETE;
  op.pFrom = dn.c_str();
  op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT;
  int rc = SHFileOperationW(&op);
  if (rc != 0) throw std::runtime_error("trash failed");
  return json(nullptr);
}

json SetTitle(HWND hwnd, const std::wstring& title) {
  SetWindowTextW(hwnd, title.c_str());
  return json(nullptr);
}

std::wstring PStr(const json& p, const char* key) {
  if (p.contains(key) && p[key].is_string())
    return Utf8ToWide(p[key].get<std::string>());
  return std::wstring();
}

}

std::string HandleHostService(HWND hwnd, const std::string& method,
                              const std::string& paramsJson) {
  json params;
  try {
    params = paramsJson.empty() ? json::object() : json::parse(paramsJson);
  } catch (...) {
    params = json::object();
  }

  json result = json(nullptr);
  if (method == "dialog:showOpenDialog") result = ShowOpenDialog(hwnd, params);
  else if (method == "shell:showItemInFolder") result = ShowItemInFolder(PStr(params, "path"));
  else if (method == "shell:openExternal") result = OpenExternal(PStr(params, "url"));
  else if (method == "shell:trashItem") result = TrashItem(PStr(params, "path"));
  else if (method == "window:setTitle") result = SetTitle(hwnd, PStr(params, "title"));

  return result.dump();
}
