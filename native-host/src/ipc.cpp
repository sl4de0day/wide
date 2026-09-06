#include "ipc.h"
#include "util.h"

#include <windows.h>
#include <dpapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shellapi.h>

#include <string>
#include <vector>

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

std::string ToBase64(const BYTE* data, DWORD size) {
  DWORD chars = 0;
  if (!CryptBinaryToStringA(data, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr,
                            &chars)) {
    return std::string();
  }
  std::string out(chars, 0);
  if (!CryptBinaryToStringA(data, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, out.data(),
                            &chars)) {
    return std::string();
  }
  out.resize(chars);
  while (!out.empty() && (out.back() == 0 || out.back() == 10 || out.back() == 13)) {
    out.pop_back();
  }
  return out;
}

std::vector<BYTE> FromBase64(const std::string& text) {
  DWORD size = 0;
  if (text.empty() ||
      !CryptStringToBinaryA(text.c_str(), (DWORD)text.size(), CRYPT_STRING_BASE64, nullptr, &size,
                            nullptr, nullptr)) {
    return {};
  }
  std::vector<BYTE> out(size);
  if (!CryptStringToBinaryA(text.c_str(), (DWORD)text.size(), CRYPT_STRING_BASE64, out.data(),
                            &size, nullptr, nullptr)) {
    return {};
  }
  out.resize(size);
  return out;
}

json ProtectData(const std::string& base64In, bool protect) {
  std::vector<BYTE> input = FromBase64(base64In);
  if (input.empty()) return json{{"ok", false}};

  DATA_BLOB in = {(DWORD)input.size(), input.data()};
  DATA_BLOB out = {};
  const BOOL ok = protect ? CryptProtectData(&in, L"Wide", nullptr, nullptr, nullptr,
                                             CRYPTPROTECT_UI_FORBIDDEN, &out)
                          : CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr,
                                               CRYPTPROTECT_UI_FORBIDDEN, &out);
  if (!ok) return json{{"ok", false}};

  std::string encoded = ToBase64(out.pbData, out.cbData);
  SecureZeroMemory(out.pbData, out.cbData);
  LocalFree(out.pbData);
  if (encoded.empty()) return json{{"ok", false}};
  return json{{"ok", true}, {"data", encoded}};
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
  else if (method == "crypto:protect") {
    result = ProtectData(params.value("data", std::string()), true);
  }
  else if (method == "crypto:unprotect") {
    result = ProtectData(params.value("data", std::string()), false);
  }

  return result.dump();
}
