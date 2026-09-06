

#include <windows.h>
#include <dwmapi.h>
#include <shlobj.h>
#include <shellapi.h>
#include <objidl.h>
#include <gdiplus.h>
#include <wrl.h>
#include <wil/com.h>
#include <WebView2.h>

#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include <WebView2EnvironmentOptions.h>

#include <nlohmann/json.hpp>

#include "ipc.h"
#include "sidecar_client.h"
#include "util.h"

using namespace Microsoft::WRL;
namespace fs = std::filesystem;
using json = nlohmann::json;

#define WM_APP_SIDECAR (WM_APP + 1)

#define WM_APP_REMOTE_APPLY (WM_APP + 2)
#define WM_APP_INSTALL_UPDATE (WM_APP + 3)

namespace {

constexpr wchar_t kWindowClass[] = L"WideHostWindow";
constexpr wchar_t kWindowTitle[] = L"Wide";
constexpr wchar_t kVirtualHost[] = L"app.local";

constexpr int IDI_APPICON = 101;

constexpr int kInitialWidth = 1440;
constexpr int kInitialHeight = 900;
constexpr int kMinWidth = 720;
constexpr int kMinHeight = 480;

constexpr COLORREF kBackground = RGB(0x3b, 0x42, 0x52);

wil::com_ptr<ICoreWebView2Controller> g_controller;
wil::com_ptr<ICoreWebView2> g_webview;
SidecarClient g_sidecar;
HWND g_mainWindow = nullptr;

std::wstring g_pendingOpenPath;

constexpr ULONG_PTR kOpenPathCopyTag = 0x57494400;

bool g_currentlyRemote = false;
std::wstring g_pendingInstaller;
constexpr int kBackendMaxRestarts = 3;
constexpr ULONGLONG kBackendRestartWindowMs = 60000;
int g_backendRestarts = 0;
ULONGLONG g_backendRestartWindow = 0;
bool g_sidecarSpoke = false;
bool g_remoteFellBack = false;

wil::com_ptr<ICoreWebView2Environment> g_env;

struct BrowserTab {
  wil::com_ptr<ICoreWebView2Controller> controller;
  wil::com_ptr<ICoreWebView2> view;
  bool ready = false;
  bool creating = false;
  std::wstring pendingUrl;
};
constexpr UINT_PTR kBrowserEnvRetryTimer = 1;
constexpr int kBrowserEnvMaxRetries = 8;
constexpr UINT kBrowserEnvRetryDelayMs = 400;

wil::com_ptr<ICoreWebView2Environment> g_browserEnv;
bool g_browserEnvReady = false;
bool g_browserEnvCreating = false;
unsigned g_browserEnvGeneration = 0;
int g_browserEnvRetries = 0;

std::vector<std::function<void(bool)>> g_browserEnvWaiters;
std::map<std::wstring, BrowserTab> g_tabs;
std::wstring g_activeTab;

HWND g_browserHost = nullptr;
long g_bpX = 0, g_bpY = 0, g_bpW = 0, g_bpH = 0;
UINT g_bpDpi = 0;
bool g_browserVisible = false;
bool g_browserHasBounds = false;

int g_browserProxyPort = 0;

int g_browserDebugPort = 0;

bool g_browserFullscreen = false;

wil::com_ptr<ICoreWebView2Controller> g_devtoolsController;
wil::com_ptr<ICoreWebView2> g_devtoolsView;
HWND g_devtoolsHost = nullptr;
long g_dtX = 0, g_dtY = 0, g_dtW = 0, g_dtH = 0;
UINT g_dtDpi = 0;
bool g_devtoolsVisible = false;
bool g_devtoolsHasBounds = false;
bool g_devtoolsCreating = false;
std::wstring g_devtoolsPendingUrl;

void DestroySplash();

std::vector<wil::com_ptr<ICoreWebView2DevToolsProtocolEventReceiver>> g_cdpReceivers;
int g_cdpTarget = 1;
bool g_cdpWired = false;

void CdpSend(int id, const json& params) {
  std::string method = params.value("method", std::string());
  json p = params.contains("params") ? params["params"] : json::object();
  if (!g_webview || method.empty()) {
    g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
    return;
  }
  g_webview->CallDevToolsProtocolMethod(
      Utf8ToWide(method).c_str(), Utf8ToWide(p.dump()).c_str(),
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [id](HRESULT ec, LPCWSTR resultJson) -> HRESULT {
            json rep = {{"t", "hostReply"}, {"id", id}};
            if (SUCCEEDED(ec) && resultJson) {
              try { rep["result"] = json::parse(WideToUtf8(resultJson)); }
              catch (...) { rep["result"] = json(nullptr); }
            } else {
              rep["error"] = "cdp call failed";
            }
            g_sidecar.Send(rep.dump());
            return S_OK;
          })
          .Get());
}

void CdpAttach(int targetId) {
  g_cdpTarget = targetId;
  if (g_cdpWired || !g_webview) return;
  g_cdpWired = true;
  const char* events[] = {"Runtime.consoleAPICalled", "Runtime.exceptionThrown",
                          "Log.entryAdded",           "Overlay.inspectNodeRequested",
                          "DOM.documentUpdated",       "Page.frameNavigated"};
  for (auto* ev : events) {
    wil::com_ptr<ICoreWebView2DevToolsProtocolEventReceiver> recv;
    if (SUCCEEDED(g_webview->GetDevToolsProtocolEventReceiver(
            Utf8ToWide(ev).c_str(), &recv)) &&
        recv) {
      std::string evName = ev;
      EventRegistrationToken tok;
      recv->add_DevToolsProtocolEventReceived(
          Callback<ICoreWebView2DevToolsProtocolEventReceivedEventHandler>(
              [evName](ICoreWebView2*,
                       ICoreWebView2DevToolsProtocolEventReceivedEventArgs* args)
                  -> HRESULT {
                wil::unique_cotaskmem_string p;
                args->get_ParameterObjectAsJson(&p);
                json ev = {{"t", "cdpEvent"},
                           {"targetId", g_cdpTarget},
                           {"method", evName}};
                try { ev["params"] = p ? json::parse(WideToUtf8(p.get())) : json::object(); }
                catch (...) { ev["params"] = json::object(); }
                g_sidecar.Send(ev.dump());
                return S_OK;
              })
              .Get(),
          &tok);
      g_cdpReceivers.push_back(recv);
    }
  }
}

void WebviewEval(int id, const json& params) {
  std::string code = params.value("code", std::string());
  if (!g_webview) {
    g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
    return;
  }
  g_webview->ExecuteScript(
      Utf8ToWide(code).c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [id](HRESULT ec, LPCWSTR resultJson) -> HRESULT {
            json rep = {{"t", "hostReply"}, {"id", id}};
            if (SUCCEEDED(ec) && resultJson) {
              try { rep["result"] = json::parse(WideToUtf8(resultJson)); }
              catch (...) { rep["result"] = json(nullptr); }
            } else {
              rep["error"] = "eval failed";
            }
            g_sidecar.Send(rep.dump());
            return S_OK;
          })
          .Get());
}

void BrowserEmit(const json& payload) {
  if (!g_webview) return;
  json message = {{"type", "event"}, {"channel", "browser:event"}, {"payload", payload}};
  g_webview->PostWebMessageAsJson(Utf8ToWide(message.dump()).c_str());
}

void HostEmitOpenPath(const std::wstring& path) {
  if (!g_webview || path.empty()) return;
  json message = {{"type", "event"},
                  {"channel", "host:openPath"},
                  {"payload", {{"path", WideToUtf8(path)}}}};
  g_webview->PostWebMessageAsJson(Utf8ToWide(message.dump()).c_str());
}

bool RegWriteString(const std::wstring& subkey, const wchar_t* name, const std::wstring& value) {
  HKEY key = nullptr;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &key,
                      nullptr) != ERROR_SUCCESS) {
    return false;
  }
  LONG r = RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()),
                          static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
  RegCloseKey(key);
  return r == ERROR_SUCCESS;
}

void RegisterShellIntegration() {
  wchar_t exe[MAX_PATH * 2] = {};
  if (GetModuleFileNameW(nullptr, exe, MAX_PATH * 2) == 0) return;
  const std::wstring exePath(exe);

  {
    HKEY key = nullptr;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\Applications\\wide.exe", 0, KEY_READ,
                      &key) == ERROR_SUCCESS) {
      wchar_t stored[MAX_PATH * 2] = {};
      DWORD size = sizeof(stored);
      DWORD type = 0;
      LONG got = RegQueryValueExW(key, L"WideRegisteredPath", nullptr, &type,
                                  reinterpret_cast<BYTE*>(stored), &size);
      RegCloseKey(key);
      if (got == ERROR_SUCCESS && type == REG_SZ && exePath == stored) return;
    }
  }

  const std::wstring quotedFile = L"\"" + exePath + L"\" \"%1\"";
  const std::wstring quotedDir = L"\"" + exePath + L"\" \"%V\"";

  RegWriteString(L"Software\\Classes\\Applications\\wide.exe", L"FriendlyAppName", L"Wide");
  RegWriteString(L"Software\\Classes\\Applications\\wide.exe\\shell\\open\\command", nullptr, quotedFile);

  for (const wchar_t* base : {L"Software\\Classes\\Directory\\shell\\OpenWithWide",
                              L"Software\\Classes\\Directory\\Background\\shell\\OpenWithWide",
                              L"Software\\Classes\\*\\shell\\OpenWithWide"}) {
    const std::wstring root(base);
    const bool background = root.find(L"Background") != std::wstring::npos;
    const bool file = root.find(L"\\*\\") != std::wstring::npos;
    RegWriteString(root, nullptr, L"Open with Wide");
    RegWriteString(root, L"Icon", L"\"" + exePath + L"\"");
    RegWriteString(root + L"\\command", nullptr, (background || !file) ? quotedDir : quotedFile);
  }

  RegWriteString(L"Software\\Classes\\Applications\\wide.exe", L"WideRegisteredPath", exePath);
}

std::wstring ParseLaunchPath() {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) return L"";
  std::wstring found;
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && argv[i][0] != L'-' && argv[i][0] != L'/') {
      found = argv[i];
      break;
    }
  }
  LocalFree(argv);
  if (found.empty()) return L"";
  wchar_t full[MAX_PATH * 2] = {};
  DWORD n = GetFullPathNameW(found.c_str(), MAX_PATH * 2, full, nullptr);
  return (n > 0 && n < MAX_PATH * 2) ? std::wstring(full) : found;
}

void BrowserEmitState(const std::wstring& tabId) {
  auto it = g_tabs.find(tabId);
  if (it == g_tabs.end() || !it->second.view) return;
  ICoreWebView2* view = it->second.view.get();
  wil::unique_cotaskmem_string uri;
  view->get_Source(&uri);
  wil::unique_cotaskmem_string title;
  view->get_DocumentTitle(&title);
  BOOL back = FALSE, forward = FALSE;
  view->get_CanGoBack(&back);
  view->get_CanGoForward(&forward);
  BrowserEmit({{"tabId", WideToUtf8(tabId)},
               {"url", uri ? WideToUtf8(uri.get()) : std::string()},
               {"title", title ? WideToUtf8(title.get()) : std::string()},
               {"canGoBack", back == TRUE},
               {"canGoForward", forward == TRUE}});
}

void BrowserWireEvents(const std::wstring& tabId) {
  auto it = g_tabs.find(tabId);
  if (it == g_tabs.end() || !it->second.view) return;
  ICoreWebView2* view = it->second.view.get();
  EventRegistrationToken tok;
  view->add_SourceChanged(
      Callback<ICoreWebView2SourceChangedEventHandler>(
          [tabId](ICoreWebView2*, ICoreWebView2SourceChangedEventArgs*) -> HRESULT {
            BrowserEmitState(tabId);
            return S_OK;
          })
          .Get(),
      &tok);
  view->add_HistoryChanged(
      Callback<ICoreWebView2HistoryChangedEventHandler>(
          [tabId](ICoreWebView2*, IUnknown*) -> HRESULT {
            BrowserEmitState(tabId);
            return S_OK;
          })
          .Get(),
      &tok);
  view->add_DocumentTitleChanged(
      Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
          [tabId](ICoreWebView2*, IUnknown*) -> HRESULT {
            BrowserEmitState(tabId);
            return S_OK;
          })
          .Get(),
      &tok);
  view->add_NavigationStarting(
      Callback<ICoreWebView2NavigationStartingEventHandler>(
          [tabId](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs*) -> HRESULT {
            BrowserEmit({{"tabId", WideToUtf8(tabId)}, {"loading", true}});
            return S_OK;
          })
          .Get(),
      &tok);
  view->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [tabId](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs*) -> HRESULT {
            BrowserEmit({{"tabId", WideToUtf8(tabId)}, {"loading", false}});
            BrowserEmitState(tabId);
            return S_OK;
          })
          .Get(),
      &tok);

  view->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [tabId](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string uri;
            auto t = g_tabs.find(tabId);
            if (SUCCEEDED(args->get_Uri(&uri)) && uri && t != g_tabs.end() && t->second.view) {
              t->second.view->Navigate(uri.get());
            }
            args->put_Handled(TRUE);
            return S_OK;
          })
          .Get(),
      &tok);

  wil::com_ptr<ICoreWebView2_15> wv15;
  if (SUCCEEDED(view->QueryInterface(IID_PPV_ARGS(&wv15))) && wv15) {
    wv15->add_FaviconChanged(
        Callback<ICoreWebView2FaviconChangedEventHandler>(
            [tabId](ICoreWebView2* sender, IUnknown*) -> HRESULT {
              wil::com_ptr<ICoreWebView2_15> s15;
              if (SUCCEEDED(sender->QueryInterface(IID_PPV_ARGS(&s15))) && s15) {
                wil::unique_cotaskmem_string fav;
                if (SUCCEEDED(s15->get_FaviconUri(&fav)) && fav) {
                  BrowserEmit({{"tabId", WideToUtf8(tabId)}, {"favicon", WideToUtf8(fav.get())}});
                }
              }
              return S_OK;
            })
            .Get(),
        &tok);
  }

  wil::com_ptr<ICoreWebView2_4> wv4;
  if (SUCCEEDED(view->QueryInterface(IID_PPV_ARGS(&wv4))) && wv4) {
    wv4->add_DownloadStarting(
        Callback<ICoreWebView2DownloadStartingEventHandler>(
            [tabId](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
              wil::com_ptr<ICoreWebView2DownloadOperation> op;
              if (SUCCEEDED(args->get_DownloadOperation(&op)) && op) {
                wil::unique_cotaskmem_string uri, path;
                op->get_Uri(&uri);
                op->get_ResultFilePath(&path);
                BrowserEmit({{"tabId", WideToUtf8(tabId)},
                             {"download",
                              {{"url", uri ? WideToUtf8(uri.get()) : std::string()},
                               {"path", path ? WideToUtf8(path.get()) : std::string()}}}});
              }
              return S_OK;
            })
            .Get(),
        &tok);
  }
}

std::wstring BrowserUserDataFolder() {
  PWSTR base = nullptr;
  std::wstring folder;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &base)) && base) {
    folder = (fs::path(base) / L"wide" / L"Browser").wstring();
    CoTaskMemFree(base);
  } else {
    wchar_t tmp[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, tmp);
    folder = (fs::path(tmp) / L"wide-browser").wstring();
  }
  std::error_code ec;
  fs::create_directories(folder, ec);
  return folder;
}

void BrowserConfigure(const std::wstring& tabId) {
  auto it = g_tabs.find(tabId);
  if (it == g_tabs.end() || !it->second.view) return;
  BrowserTab& tab = it->second;
  wil::com_ptr<ICoreWebView2Settings> settings;
  if (SUCCEEDED(tab.view->get_Settings(&settings)) && settings) {
    settings->put_AreDevToolsEnabled(TRUE);
    settings->put_AreDefaultContextMenusEnabled(TRUE);
    settings->put_IsStatusBarEnabled(TRUE);
  }
  if (tab.controller) {
    EventRegistrationToken tok;
    tab.controller->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
            [tabId](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
              COREWEBVIEW2_KEY_EVENT_KIND kind;
              UINT key = 0;
              args->get_KeyEventKind(&kind);
              args->get_VirtualKey(&key);
              const bool down = kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN ||
                                kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
              if (key == VK_F12 && down) {

                BrowserEmit(json{{"tabId", WideToUtf8(tabId)}, {"devtoolsToggle", true}});
                args->put_Handled(TRUE);
              } else if (key == VK_ESCAPE && down && g_browserFullscreen) {

                BrowserEmit(json{{"tabId", WideToUtf8(tabId)}, {"exitFullscreen", true}});
                args->put_Handled(TRUE);
              }
              return S_OK;
            })
            .Get(),
        &tok);
  }
}

void BrowserAcceptProxyCert(const std::wstring& tabId) {
  auto it = g_tabs.find(tabId);
  if (it == g_tabs.end() || !it->second.view) return;
  wil::com_ptr<ICoreWebView2_14> wv14;
  if (SUCCEEDED(it->second.view->QueryInterface(IID_PPV_ARGS(&wv14))) && wv14) {
    EventRegistrationToken tok;
    wv14->add_ServerCertificateErrorDetected(
        Callback<ICoreWebView2ServerCertificateErrorDetectedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2ServerCertificateErrorDetectedEventArgs* args) -> HRESULT {
              wil::com_ptr<ICoreWebView2Certificate> cert;
              if (SUCCEEDED(args->get_ServerCertificate(&cert)) && cert) {
                LPWSTR issuer = nullptr;
                if (SUCCEEDED(cert->get_Issuer(&issuer)) && issuer) {
                  const bool ours =
                      std::wstring(issuer).find(L"Wide Proxy CA") != std::wstring::npos;
                  CoTaskMemFree(issuer);
                  if (ours) {
                    args->put_Action(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW);
                    return S_OK;
                  }
                }
              }
              args->put_Action(COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_DEFAULT);
              return S_OK;
            })
            .Get(),
        &tok);
  }
}

void BrowserNavigate(HWND hwnd, const std::wstring& tabId, const std::wstring& url);
void ApplyBrowserPlacement();
void BrowserActivate(const std::wstring& tabId);
void RebuildBrowserTabs(HWND hwnd);

void ScheduleBrowserEnvRetry(HWND hwnd) {
  if (g_browserEnvRetries >= kBrowserEnvMaxRetries) {
    BrowserEmit(json{{"tabId", std::string()}, {"envFailed", true}});
    return;
  }
  ++g_browserEnvRetries;
  UINT delay = kBrowserEnvRetryDelayMs;
  for (int i = 1; i < g_browserEnvRetries && delay < 6000; ++i) delay *= 2;
  SetTimer(hwnd, kBrowserEnvRetryTimer, delay, nullptr);
}

void RetryPendingBrowserTabs(HWND hwnd) {
  std::vector<std::pair<std::wstring, std::wstring>> pending;
  for (auto& entry : g_tabs) {
    if (entry.second.ready || entry.second.creating) continue;
    if (!entry.second.pendingUrl.empty()) pending.emplace_back(entry.first, entry.second.pendingUrl);
  }
  for (auto& entry : pending) BrowserNavigate(hwnd, entry.first, entry.second);
}

LRESULT CALLBACK BrowserHostProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_SETFOCUS) {
    if (h == g_devtoolsHost && g_devtoolsController) {
      g_devtoolsController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
      return 0;
    }
    auto it = g_tabs.find(g_activeTab);
    if (it != g_tabs.end() && it->second.controller) {
      it->second.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
      return 0;
    }
  }
  return DefWindowProcW(h, m, w, l);
}

void EnsureBrowserEnv(HWND hwnd, std::function<void(bool)> then) {

  if (!g_browserHost) {
    static bool registered = false;
    if (!registered) {
      WNDCLASSW wc = {};
      wc.lpfnWndProc = BrowserHostProc;
      wc.hInstance = GetModuleHandleW(nullptr);
      wc.lpszClassName = L"WideBrowserHost";
      RegisterClassW(&wc);
      registered = true;
    }
    g_browserHost = CreateWindowExW(0, L"WideBrowserHost", L"", WS_CHILD | WS_CLIPSIBLINGS,
                                    0, 0, 0, 0, hwnd, nullptr,
                                    GetModuleHandleW(nullptr), nullptr);
  }

  if (g_browserEnvReady) { if (then) then(true); return; }
  if (then) g_browserEnvWaiters.push_back(then);
  if (g_browserEnvCreating) return;
  g_browserEnvCreating = true;
  const unsigned generation = g_browserEnvGeneration;

  wil::com_ptr<ICoreWebView2EnvironmentOptions> options;
  if (g_browserDebugPort > 0 || g_browserProxyPort > 0) {
    auto opts = Make<CoreWebView2EnvironmentOptions>();
    std::wstring arg;
    if (g_browserDebugPort > 0) {
      arg += L"--remote-debugging-port=" + std::to_wstring(g_browserDebugPort);
      arg += L" --remote-allow-origins=http://127.0.0.1:" + std::to_wstring(g_browserDebugPort);
    }
    if (g_browserProxyPort > 0) {
      if (!arg.empty()) arg += L" ";
      arg += L"--proxy-server=127.0.0.1:" + std::to_wstring(g_browserProxyPort);
      arg += L" --proxy-bypass-list=<-loopback>";
    }
    opts->put_AdditionalBrowserArguments(arg.c_str());
    options = opts;
  }
  CreateCoreWebView2EnvironmentWithOptions(
      nullptr, BrowserUserDataFolder().c_str(), options.get(),
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [hwnd, generation](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
            if (generation != g_browserEnvGeneration) return S_OK;
            g_browserEnvCreating = false;
            if (FAILED(result) || !env) {
              auto failed = std::move(g_browserEnvWaiters);
              g_browserEnvWaiters.clear();
              for (auto& w : failed) if (w) w(false);
              ScheduleBrowserEnvRetry(hwnd);
              return result;
            }
            g_browserEnv = env;
            g_browserEnvReady = true;
            g_browserEnvRetries = 0;
            auto waiters = std::move(g_browserEnvWaiters);
            g_browserEnvWaiters.clear();
            for (auto& w : waiters) if (w) w(true);
            return S_OK;
          })
          .Get());
}

void EnsureBrowserTab(HWND hwnd, const std::wstring& tabId, std::function<void()> then) {
  if (tabId.empty()) return;
  BrowserTab& tab = g_tabs[tabId];
  if (tab.ready) { if (then) then(); return; }
  if (tab.creating) return;
  tab.creating = true;

  EnsureBrowserEnv(hwnd, [tabId, then](bool envOk) {
    auto it = g_tabs.find(tabId);
    if (it == g_tabs.end()) return;
    if (!envOk || !g_browserEnv) { it->second.creating = false; return; }
    if (it->second.ready) { it->second.creating = false; if (then) then(); return; }

    const bool hasProxy = g_browserProxyPort > 0;
    const unsigned generation = g_browserEnvGeneration;
    g_browserEnv->CreateCoreWebView2Controller(
        g_browserHost,
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [tabId, then, hasProxy, generation](HRESULT r, ICoreWebView2Controller* controller) -> HRESULT {
              if (generation != g_browserEnvGeneration) {
                if (controller) controller->Close();
                return S_OK;
              }
              auto it = g_tabs.find(tabId);
              if (it == g_tabs.end()) {
                if (controller) controller->Close();
                return r;
              }
              BrowserTab& tab = it->second;
              if (FAILED(r) || !controller) { tab.creating = false; return r; }
              tab.controller = controller;
              tab.controller->get_CoreWebView2(&tab.view);
              wil::com_ptr<ICoreWebView2Controller2> c2;
              if (SUCCEEDED(controller->QueryInterface(IID_PPV_ARGS(&c2))) && c2) {
                COREWEBVIEW2_COLOR bg = {255, 255, 255, 255};
                c2->put_DefaultBackgroundColor(bg);
              }
              tab.controller->put_IsVisible(FALSE);
              BrowserWireEvents(tabId);
              BrowserConfigure(tabId);
              if (hasProxy) BrowserAcceptProxyCert(tabId);
              tab.ready = true;
              tab.creating = false;

              ApplyBrowserPlacement();
              if (then) then();

              if (!tab.pendingUrl.empty()) {
                std::wstring url = tab.pendingUrl;
                tab.pendingUrl.clear();
                tab.view->Navigate(url.c_str());
              }
              return S_OK;
            })
            .Get());
  });
}

void RebuildBrowserTabs(HWND hwnd) {

  std::vector<std::pair<std::wstring, std::wstring>> reopen;
  for (auto& entry : g_tabs) {
    std::wstring url;
    if (entry.second.view) {
      wil::unique_cotaskmem_string uri;
      if (SUCCEEDED(entry.second.view->get_Source(&uri)) && uri) url = uri.get();
    }
    if (url.empty()) url = entry.second.pendingUrl;
    reopen.emplace_back(entry.first, url);
  }
  const std::wstring wasActive = g_activeTab;

  for (auto& entry : g_tabs) {
    if (entry.second.controller) entry.second.controller->Close();
  }
  g_tabs.clear();
  ++g_browserEnvGeneration;
  g_browserEnv.reset();
  g_browserEnvReady = false;
  g_browserEnvCreating = false;
  g_browserEnvRetries = 0;
  g_browserEnvWaiters.clear();

  for (auto& entry : reopen) {
    if (entry.second.empty() || entry.second == L"about:blank") continue;
    BrowserNavigate(hwnd, entry.first, entry.second);
  }
  g_activeTab = wasActive;
  BrowserActivate(wasActive);
}

void BrowserSetProxy(HWND hwnd, int port) {
  if (g_browserProxyPort == port) return;
  g_browserProxyPort = port;
  RebuildBrowserTabs(hwnd);
}

void BrowserSetDebugPort(HWND hwnd, int port) {
  if (g_browserDebugPort == port) return;
  g_browserDebugPort = port;
  RebuildBrowserTabs(hwnd);
}

void BrowserNavigate(HWND hwnd, const std::wstring& tabId, const std::wstring& url) {
  if (tabId.empty() || url.empty()) return;
  BrowserTab& tab = g_tabs[tabId];
  if (tab.ready && tab.view) {
    tab.view->Navigate(url.c_str());
    return;
  }
  tab.pendingUrl = url;
  EnsureBrowserTab(hwnd, tabId, nullptr);
}

UINT HostDpi() {
  UINT dpi = g_mainWindow ? GetDpiForWindow(g_mainWindow) : 0;
  return dpi ? dpi : 96;
}

void ApplyBrowserPlacement() {
  if (!g_browserHasBounds) return;
  if (g_browserHost) {

    SetWindowPos(g_browserHost, HWND_TOP, g_bpX, g_bpY, g_bpW, g_bpH,
                 g_browserVisible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
  }

  for (auto& entry : g_tabs) {
    if (!entry.second.controller) continue;
    if (entry.first == g_activeTab) {
      RECT rc = {0, 0, g_bpW, g_bpH};
      entry.second.controller->put_Bounds(rc);
      entry.second.controller->put_IsVisible(g_browserVisible ? TRUE : FALSE);
    } else {
      entry.second.controller->put_IsVisible(FALSE);
    }
  }
}

void BrowserActivate(const std::wstring& tabId) {
  g_activeTab = tabId;
  ApplyBrowserPlacement();
  auto it = g_tabs.find(tabId);
  if (it != g_tabs.end() && it->second.controller && g_browserVisible) {
    it->second.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
  }
}

void BrowserPlace(const std::wstring& tabId, long x, long y, long w, long h, bool visible) {
  if (!tabId.empty()) g_activeTab = tabId;

  g_bpX = x;
  g_bpY = y;
  g_bpW = w;
  g_bpH = h;
  g_bpDpi = HostDpi();
  g_browserVisible = visible;
  g_browserHasBounds = true;
  ApplyBrowserPlacement();
}

void BrowserCloseTab(const std::wstring& tabId) {
  auto it = g_tabs.find(tabId);
  if (it == g_tabs.end()) return;
  if (it->second.controller) it->second.controller->Close();
  const bool wasActive = (tabId == g_activeTab);
  g_tabs.erase(it);
  if (wasActive) {
    g_activeTab = g_tabs.empty() ? std::wstring() : g_tabs.begin()->first;
    ApplyBrowserPlacement();
  }
}

void ApplyDevtoolsPlacement() {
  if (!g_devtoolsHasBounds) return;
  if (g_devtoolsHost) {
    SetWindowPos(g_devtoolsHost, HWND_TOP, g_dtX, g_dtY, g_dtW, g_dtH,
                 g_devtoolsVisible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
  }
  if (g_devtoolsController) {
    RECT rc = {0, 0, g_dtW, g_dtH};
    g_devtoolsController->put_Bounds(rc);
    g_devtoolsController->put_IsVisible(g_devtoolsVisible ? TRUE : FALSE);
  }
}

void DevtoolsPlace(long x, long y, long w, long h, bool visible) {
  g_dtX = x;
  g_dtY = y;
  g_dtW = w;
  g_dtH = h;
  g_dtDpi = HostDpi();
  g_devtoolsVisible = visible;
  g_devtoolsHasBounds = true;
  ApplyDevtoolsPlacement();
}

void RescaleNativePanes(UINT dpi) {
  if (!dpi) return;
  if (g_browserHasBounds && g_bpDpi && g_bpDpi != dpi) {
    g_bpX = MulDiv(g_bpX, dpi, g_bpDpi);
    g_bpY = MulDiv(g_bpY, dpi, g_bpDpi);
    g_bpW = MulDiv(g_bpW, dpi, g_bpDpi);
    g_bpH = MulDiv(g_bpH, dpi, g_bpDpi);
    g_bpDpi = dpi;
    ApplyBrowserPlacement();
  }
  if (g_devtoolsHasBounds && g_dtDpi && g_dtDpi != dpi) {
    g_dtX = MulDiv(g_dtX, dpi, g_dtDpi);
    g_dtY = MulDiv(g_dtY, dpi, g_dtDpi);
    g_dtW = MulDiv(g_dtW, dpi, g_dtDpi);
    g_dtH = MulDiv(g_dtH, dpi, g_dtDpi);
    g_dtDpi = dpi;
    ApplyDevtoolsPlacement();
  }
}

void DevtoolsClose() {
  g_devtoolsVisible = false;
  g_devtoolsPendingUrl.clear();
  if (g_devtoolsController) g_devtoolsController->put_IsVisible(FALSE);
  if (g_devtoolsHost) ShowWindow(g_devtoolsHost, SW_HIDE);
}

void DevtoolsOpen(HWND hwnd, const std::wstring& url) {
  if (url.empty()) { DevtoolsClose(); return; }
  if (!g_env) return;
  if (!g_devtoolsHost) {

    g_devtoolsHost = CreateWindowExW(0, L"WideBrowserHost", L"", WS_CHILD | WS_CLIPSIBLINGS,
                                     0, 0, 0, 0, hwnd, nullptr, GetModuleHandleW(nullptr), nullptr);
  }
  if (g_devtoolsController) {
    if (g_devtoolsView) g_devtoolsView->Navigate(url.c_str());
    ApplyDevtoolsPlacement();
    return;
  }
  g_devtoolsPendingUrl = url;
  if (g_devtoolsCreating) return;
  g_devtoolsCreating = true;
  g_env->CreateCoreWebView2Controller(
      g_devtoolsHost,
      Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [](HRESULT r, ICoreWebView2Controller* controller) -> HRESULT {
            g_devtoolsCreating = false;
            if (FAILED(r) || !controller) { g_devtoolsPendingUrl.clear(); return r; }
            if (g_devtoolsController) { controller->Close(); return S_OK; }
            g_devtoolsController = controller;
            g_devtoolsController->get_CoreWebView2(&g_devtoolsView);
            ApplyDevtoolsPlacement();
            const std::wstring target = g_devtoolsPendingUrl;
            g_devtoolsPendingUrl.clear();
            if (g_devtoolsView && !target.empty()) g_devtoolsView->Navigate(target.c_str());
            return S_OK;
          })
          .Get());
}

std::wstring ResolveNodeExe() {
  wchar_t exePath[MAX_PATH] = {};
  GetModuleFileNameW(nullptr, exePath, MAX_PATH);
  fs::path exeDir = fs::path(exePath).parent_path();
  std::error_code ec;
  if (fs::exists(exeDir / L"node.exe", ec)) return (exeDir / L"node.exe").wstring();
  const wchar_t* known = L"C:\\Program Files\\nodejs\\node.exe";
  if (fs::exists(known, ec)) return known;
  return L"node.exe";
}

std::wstring ResolveSidecarScript() {
  wchar_t exePath[MAX_PATH] = {};
  GetModuleFileNameW(nullptr, exePath, MAX_PATH);
  fs::path exeDir = fs::path(exePath).parent_path();
  std::error_code ec;
  if (fs::exists(exeDir / L"sidecar" / L"sidecar.cjs", ec))
    return (exeDir / L"sidecar" / L"sidecar.cjs").wstring();
  fs::path cur = exeDir;
  for (int i = 0; i < 8; ++i) {
    fs::path cand = cur / L"sidecar" / L"sidecar.cjs";
    if (fs::exists(cand, ec)) return cand.wstring();
    if (!cur.has_parent_path()) break;
    cur = cur.parent_path();
  }
  return std::wstring();
}

json ReadRemoteConfig();
void WriteRemoteConfig(const json& cfg);

void BrowserCdp(int id, const std::wstring& tabId, const std::string& method, const std::string& paramsJson) {
  auto it = g_tabs.find(tabId);
  if (method.empty() || it == g_tabs.end() || !it->second.view) {
    g_sidecar.Send(json{{"t", "hostReply"},
                        {"id", id},
                        {"error", "That browser tab is not ready for DevTools calls."}}
                       .dump());
    return;
  }
  it->second.view->CallDevToolsProtocolMethod(
      Utf8ToWide(method).c_str(), Utf8ToWide(paramsJson.empty() ? std::string("{}") : paramsJson).c_str(),
      Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
          [id](HRESULT ec, LPCWSTR resultJson) -> HRESULT {
            json rep = {{"t", "hostReply"}, {"id", id}};
            if (SUCCEEDED(ec) && resultJson) {
              try { rep["result"] = json::parse(WideToUtf8(resultJson)); }
              catch (...) { rep["result"] = json(nullptr); }
            } else {
              rep["error"] = "cdp call failed";
            }
            g_sidecar.Send(rep.dump());
            return S_OK;
          })
          .Get());
}

void ProcessSidecarLine(HWND hwnd, const std::string& line) {

  if (line.compare(0, 8, "{\"type\":") == 0) {
    if (g_webview) g_webview->PostWebMessageAsJson(Utf8ToWide(line).c_str());
    return;
  }

  json msg;
  try { msg = json::parse(line); } catch (...) { return; }
  std::string t = msg.value("t", std::string());

  if (t == "host") {
    int id = msg.value("id", 0);
    std::string method = msg.value("channel", msg.value("method", std::string()));
    json params = msg.contains("params") ? msg["params"] : json::object();

    if (method == "cdp:send") { CdpSend(id, params); return; }
    if (method == "webview:eval") { WebviewEval(id, params); return; }
    if (method == "cdp:attach") {
      CdpAttach(params.value("targetId", 1));
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
      return;
    }
    if (method == "cdp:detach") {
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
      return;
    }

    if (method == "browser:navigate") {
      BrowserNavigate(hwnd, Utf8ToWide(params.value("tabId", std::string())),
                      Utf8ToWide(params.value("url", std::string())));
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
      return;
    }

    if (method == "browser:cdp") {
      BrowserCdp(id, Utf8ToWide(params.value("tabId", std::string())), params.value("method", std::string()),
                 params.contains("params") ? params["params"].dump() : std::string("{}"));
      return;
    }

    if (method == "browser:debug") {
      BrowserSetDebugPort(hwnd, params.value("port", 0));
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
      return;
    }
    if (method == "browser:proxy") {
      BrowserSetProxy(hwnd, params.value("port", 0));
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
      return;
    }

    if (method == "browser:setRemotePort") {
      const int asked = params.value("port", 0);
      if (g_browserDebugPort == 0 && asked > 0) {
        g_browserDebugPort = asked;
        if (g_browserEnvReady || g_browserEnvCreating) RebuildBrowserTabs(hwnd);
      }
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", {{"port", g_browserDebugPort}}}}.dump());
      return;
    }

    if (method == "browser:devtools") {
      DevtoolsOpen(hwnd, Utf8ToWide(params.value("url", std::string())));
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", nullptr}}.dump());
      return;
    }

    if (method == "app:installUpdate") {
      std::wstring installer = Utf8ToWide(params.value("path", std::string()));
      std::error_code ec;
      const bool ok = !installer.empty() && fs::exists(installer, ec) && !ec;
      if (ok) g_pendingInstaller = installer;
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", {{"ok", ok}}}}.dump());
      if (ok) PostMessage(hwnd, WM_APP_INSTALL_UPDATE, 0, 0);
      return;
    }
    if (method == "remote:get") {

      json cfg = ReadRemoteConfig();
      cfg["currentlyRemote"] = g_currentlyRemote;
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", cfg}}.dump());
      return;
    }
    if (method == "remote:set") {
      WriteRemoteConfig(params);
      g_sidecar.Send(json{{"t", "hostReply"}, {"id", id}, {"result", ReadRemoteConfig()}}.dump());

      PostMessage(hwnd, WM_APP_REMOTE_APPLY, 0, 0);
      return;
    }

    json reply = {{"t", "hostReply"}, {"id", id}};
    try {
      std::string res = HandleHostService(hwnd, method, params.dump());
      reply["result"] = res.empty() ? json(nullptr) : json::parse(res);
    } catch (const std::exception& e) {
      reply["error"] = e.what();
    } catch (...) {
      reply["error"] = "host service failed";
    }
    g_sidecar.Send(reply.dump());
  }
}

std::wstring ResolveRendererDir() {
  wchar_t exePath[MAX_PATH] = {};
  GetModuleFileNameW(nullptr, exePath, MAX_PATH);
  fs::path exeDir = fs::path(exePath).parent_path();

  auto hasIndex = [](const fs::path& p) {
    std::error_code ec;
    return fs::exists(p / L"index.html", ec);
  };

  if (hasIndex(exeDir / L"ui")) return (exeDir / L"ui").wstring();
  if (hasIndex(exeDir / L"out" / L"renderer"))
    return (exeDir / L"out" / L"renderer").wstring();

  fs::path cur = exeDir;
  for (int i = 0; i < 8; ++i) {
    if (hasIndex(cur / L"out" / L"renderer"))
      return (cur / L"out" / L"renderer").wstring();
    if (hasIndex(cur / L"ui")) return (cur / L"ui").wstring();
    if (!cur.has_parent_path()) break;
    cur = cur.parent_path();
  }

  return (exeDir / L"ui").wstring();
}

std::wstring ResolveAssetPath(const wchar_t* name) {
  wchar_t exePath[MAX_PATH] = {};
  GetModuleFileNameW(nullptr, exePath, MAX_PATH);
  fs::path exeDir = fs::path(exePath).parent_path();
  std::error_code ec;
  if (fs::exists(exeDir / L"assets" / name, ec))
    return (exeDir / L"assets" / name).wstring();
  fs::path cur = exeDir;
  for (int i = 0; i < 8; ++i) {
    fs::path cand = cur / L"native-host" / L"assets" / name;
    if (fs::exists(cand, ec)) return cand.wstring();
    cand = cur / L"assets" / name;
    if (fs::exists(cand, ec)) return cand.wstring();
    if (!cur.has_parent_path()) break;
    cur = cur.parent_path();
  }
  return std::wstring();
}

std::string LoadAsset(const wchar_t* name) {
  std::wstring path = ResolveAssetPath(name);
  if (path.empty()) return std::string();
  std::ifstream f(path, std::ios::binary);
  if (!f) return std::string();
  return std::string((std::istreambuf_iterator<char>(f)),
                     std::istreambuf_iterator<char>());
}

void InjectScript(const std::string& code) {
  if (code.empty() || !g_webview) return;
  g_webview->AddScriptToExecuteOnDocumentCreated(
      Utf8ToWide(code).c_str(),
      Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
          [](HRESULT, LPCWSTR) -> HRESULT { return S_OK; })
          .Get());
}

std::wstring UserDataFolder() {
  PWSTR local = nullptr;
  std::wstring base;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) {
    base = local;
    CoTaskMemFree(local);
  } else {
    wchar_t tmp[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, tmp);
    base = tmp;
  }
  fs::path folder = fs::path(base) / L"wide" / L"WebView2";
  std::error_code ec;
  fs::create_directories(folder, ec);
  return folder.wstring();
}

std::wstring RemoteConfigPath() {
  PWSTR local = nullptr;
  std::wstring base;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) {
    base = local;
    CoTaskMemFree(local);
  } else {
    wchar_t tmp[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, tmp);
    base = tmp;
  }
  fs::path folder = fs::path(base) / L"wide";
  std::error_code ec;
  fs::create_directories(folder, ec);
  return (folder / L"remote.json").wstring();
}

json ReadRemoteConfig() {
  std::ifstream f(RemoteConfigPath(), std::ios::binary);
  if (!f) return json::object();
  std::string text((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  try {
    json j = json::parse(text);
    if (j.is_object()) return j;
  } catch (...) {
  }
  return json::object();
}

void WriteRemoteConfig(const json& cfg) {
  std::ofstream f(RemoteConfigPath(), std::ios::binary | std::ios::trunc);
  if (f) f << cfg.dump(2);
}

bool IsSafeRemoteHost(const std::string& value) {
  if (value.empty() || value.size() > 255 || value.front() == '-') return false;
  bool seenAt = false;
  for (char c : value) {
    if (c == '@') {
      if (seenAt) return false;
      seenAt = true;
      continue;
    }
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                    (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
    if (!ok) return false;
  }
  return true;
}

bool IsSafeRemoteCommand(const std::string& value) {
  if (value.empty() || value.size() > 255 || value.front() == '-') return false;
  for (char c : value) {
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                    (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_' || c == '/';
    if (!ok) return false;
  }
  return true;
}

bool IsSafeRemotePath(const std::string& value) {
  if (value.empty() || value.size() > 4096) return false;
  for (unsigned char c : value) {
    if (c < 0x20 || c == 0x27 || c == 0x5C || c == 0x22) return false;
  }
  return true;
}

std::wstring BuildRemoteCommand() {
  json cfg = ReadRemoteConfig();
  if (!cfg.value("enabled", false)) return std::wstring();
  std::string host = cfg.value("host", std::string());
  std::string remotePath = cfg.value("remotePath", std::string());
  std::string nodeCmd = cfg.value("node", std::string("node"));
  if (host.empty() || remotePath.empty()) return std::wstring();
  if (!IsSafeRemoteHost(host) || !IsSafeRemoteCommand(nodeCmd) || !IsSafeRemotePath(remotePath)) {
    return std::wstring();
  }

  while (!remotePath.empty() && (remotePath.back() == '/' || remotePath.back() == '\\'))
    remotePath.pop_back();

  const std::wstring quote(1, L'"');
  std::wstring cmd = L"ssh.exe -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -- ";
  cmd += quote + Utf8ToWide(host) + quote;
  cmd += L" ";
  cmd += quote + Utf8ToWide(nodeCmd) + quote;
  cmd += L" '";
  cmd += Utf8ToWide(remotePath);
  cmd += L"/sidecar/sidecar.cjs'";
  return cmd;
}

void ResizeWebViewToClient(HWND hwnd) {
  if (!g_controller) return;
  RECT rc;
  GetClientRect(hwnd, &rc);
  g_controller->put_Bounds(rc);
}

void ConfigureWebView(HWND hwnd) {
  if (!g_webview) return;

  wil::com_ptr<ICoreWebView2Settings> settings;
  if (SUCCEEDED(g_webview->get_Settings(&settings))) {
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    wil::com_ptr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings->QueryInterface(IID_PPV_ARGS(&settings3))) && settings3) {
      settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
    }
  }

  wil::com_ptr<ICoreWebView2_13> wv13;
  if (SUCCEEDED(g_webview->QueryInterface(IID_PPV_ARGS(&wv13))) && wv13) {
    wil::com_ptr<ICoreWebView2Profile> profile;
    if (SUCCEEDED(wv13->get_Profile(&profile)) && profile)
      profile->put_PreferredColorScheme(COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);
  }

  if (auto wv3 = g_webview.try_query<ICoreWebView2_3>()) {
    std::wstring rendererDir = ResolveRendererDir();
    wv3->SetVirtualHostNameToFolderMapping(
        kVirtualHost, rendererDir.c_str(),
        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
  }

  InjectScript(LoadAsset(L"engine-preview.js"));
  InjectScript(LoadAsset(L"preload-shim.js"));
  InjectScript(LoadAsset(L"titlebar.js"));

  EventRegistrationToken msgToken;
  g_webview->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [hwnd](ICoreWebView2*,
             ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            wil::unique_cotaskmem_string raw;
            if (FAILED(args->get_WebMessageAsJson(&raw)) || !raw) return S_OK;
            json m;
            try { m = json::parse(WideToUtf8(raw.get())); } catch (...) { return S_OK; }
            std::string type = m.value("type", std::string());
            if (type == "host-cmd") {
              std::string c = m.value("cmd", std::string());
              if (c == "drag") { ReleaseCapture(); SendMessage(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0); }
              else if (c == "minimize") ShowWindow(hwnd, SW_MINIMIZE);
              else if (c == "maximize") ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
              else if (c == "close") PostMessage(hwnd, WM_CLOSE, 0, 0);

              else if (c == "browser-place") {
                BrowserPlace(Utf8ToWide(m.value("tabId", std::string())),
                             m.value("x", 0L), m.value("y", 0L), m.value("w", 0L),
                             m.value("h", 0L), m.value("visible", false));
              }
              else if (c == "browser-activate") {
                BrowserActivate(Utf8ToWide(m.value("tabId", std::string())));
              }
              else if (c == "devtools-place") {
                DevtoolsPlace(m.value("x", 0L), m.value("y", 0L), m.value("w", 0L),
                              m.value("h", 0L), m.value("visible", false));
              }
              else if (c == "browser-fullscreen") {
                g_browserFullscreen = m.value("on", false);
              }

              else if (c == "browser-back" || c == "browser-forward" ||
                       c == "browser-reload" || c == "browser-stop") {
                auto it = g_tabs.find(Utf8ToWide(m.value("tabId", std::string())));
                if (it != g_tabs.end() && it->second.view) {
                  ICoreWebView2* v = it->second.view.get();
                  if (c == "browser-back") v->GoBack();
                  else if (c == "browser-forward") v->GoForward();
                  else if (c == "browser-reload") v->Reload();
                  else v->Stop();
                }
              }
              else if (c == "browser-close") {
                BrowserCloseTab(Utf8ToWide(m.value("tabId", std::string())));
              }

              else if (c == "consume-open-path") {
                if (!g_pendingOpenPath.empty()) {
                  HostEmitOpenPath(g_pendingOpenPath);
                  g_pendingOpenPath.clear();
                }
              }
              return S_OK;
            }
            if (type == "invoke") {
              json fwd = {{"t", "invoke"},
                          {"id", m.value("replyId", 0)},
                          {"channel", m.value("channel", std::string())},
                          {"args", m.contains("args") ? m["args"] : json::array()}};
              g_sidecar.Send(fwd.dump());
            }
            return S_OK;
          })
          .Get(),
      &msgToken);

  EventRegistrationToken token;
  g_webview->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args)
              -> HRESULT {
            wil::unique_cotaskmem_string uri;
            if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
              ShellExecuteW(nullptr, L"open", uri.get(), nullptr, nullptr,
                            SW_SHOWNORMAL);
            }
            args->put_Handled(TRUE);
            return S_OK;
          })
          .Get(),
      &token);

  bool verifyTheme = GetEnvironmentVariableW(L"WIDE_VERIFY_THEME", nullptr, 0) > 0;
  EventRegistrationToken navShowTok;
  g_webview->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [hwnd](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs*)
              -> HRESULT {

            ShowWindow(hwnd, SW_MAXIMIZE);
            SetForegroundWindow(hwnd);
            DestroySplash();
            return S_OK;
          })
          .Get(),
      &navShowTok);

  if (verifyTheme) {
    EventRegistrationToken navTok;
    g_webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [](ICoreWebView2* wv, ICoreWebView2NavigationCompletedEventArgs*)
                -> HRESULT {
              const wchar_t* probe =
                  L"(function(){var s=getComputedStyle(document.documentElement);"
                  L"return JSON.stringify({"
                  L"keyword:s.getPropertyValue('--syn-keyword').trim(),"
                  L"type:s.getPropertyValue('--syn-type').trim(),"
                  L"string:s.getPropertyValue('--syn-string').trim(),"
                  L"comment:s.getPropertyValue('--syn-comment').trim(),"
                  L"bg:s.getPropertyValue('--mono-800').trim()});})()";
              wv->ExecuteScript(
                  probe,
                  Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                      [](HRESULT, LPCWSTR result) -> HRESULT {
                        wchar_t tmp[MAX_PATH] = {};
                        GetTempPathW(MAX_PATH, tmp);
                        std::wstring path =
                            std::wstring(tmp) + L"hc_theme_probe.json";
                        std::ofstream f(path, std::ios::binary);
                        if (f && result) f << WideToUtf8(result);
                        return S_OK;
                      })
                      .Get());
              return S_OK;
            })
            .Get(),
        &navTok);
  }

  if (GetEnvironmentVariableW(L"WIDE_VERIFY_FS", nullptr, 0) > 0) {
    EventRegistrationToken fsTok;
    g_webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [](ICoreWebView2* wv, ICoreWebView2NavigationCompletedEventArgs*)
                -> HRESULT {
              json p;
              p["expression"] =
                  "(async()=>{try{"
                  "await new Promise(function(r){setTimeout(r,1500);});"
                  "var btns=document.querySelectorAll('button');"
                  "for(var i=0;i<btns.length;i++){var tt=(btns[i].getAttribute('title')||'')+' '+(btns[i].textContent||'');"
                  "if(tt.indexOf('obside-website')>=0){btns[i].click();break;}}"
                  "await new Promise(function(r){setTimeout(r,4500);});"

                  "var f=document.querySelectorAll('button');"
                  "for(var i=0;i<f.length;i++){if(((f[i].textContent||'').trim())==='vite.config.ts'){f[i].click();break;}}"
                  "await new Promise(function(r){setTimeout(r,2500);});"
                  "var cm=document.querySelector('.cm-editor');"
                  "var lines=document.querySelectorAll('.cm-line').length;"
                  "var kw=document.querySelector('.cm-line span');"
                  "return JSON.stringify({"
                  "activityButtons:document.querySelectorAll('nav[aria-label=\"Tools\"] button').length,"
                  "editorMounted:!!cm,codeLines:lines,"
                  "firstTokenColor:kw?getComputedStyle(kw).color:'none'});"
                  "}catch(e){return 'THREW:'+(e&&e.message);}})()";
              p["awaitPromise"] = true;
              p["returnByValue"] = true;
              wv->CallDevToolsProtocolMethod(
                  L"Runtime.evaluate", Utf8ToWide(p.dump()).c_str(),
                  Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                      [](HRESULT, LPCWSTR resultJson) -> HRESULT {
                        wchar_t tmp[MAX_PATH] = {};
                        GetTempPathW(MAX_PATH, tmp);
                        std::wstring path = std::wstring(tmp) + L"hc_fs_probe.json";
                        std::ofstream f(path, std::ios::binary);
                        if (f && resultJson) f << WideToUtf8(resultJson);
                        return S_OK;
                      })
                      .Get());
              return S_OK;
            })
            .Get(),
        &fsTok);
  }

  g_webview->Navigate(L"https://app.local/index.html");
}

void InitWebView(HWND hwnd) {
  std::wstring userData = UserDataFolder();
  CreateCoreWebView2EnvironmentWithOptions(
      nullptr, userData.c_str(), nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [hwnd](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
            if (FAILED(result) || !env) return result;
            g_env = env;
            env->CreateCoreWebView2Controller(
                hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [hwnd](HRESULT r, ICoreWebView2Controller* controller)
                        -> HRESULT {
                      if (FAILED(r) || !controller) return r;
                      g_controller = controller;
                      g_controller->get_CoreWebView2(&g_webview);

                      wil::com_ptr<ICoreWebView2Controller2> controller2;
                      if (SUCCEEDED(controller->QueryInterface(
                              IID_PPV_ARGS(&controller2))) &&
                          controller2) {
                        COREWEBVIEW2_COLOR bg = {255, GetRValue(kBackground),
                                                 GetGValue(kBackground),
                                                 GetBValue(kBackground)};
                        controller2->put_DefaultBackgroundColor(bg);
                      }
                      g_controller->put_IsVisible(TRUE);
                      ResizeWebViewToClient(hwnd);
                      ConfigureWebView(hwnd);

                      std::wstring remoteCmd = BuildRemoteCommand();
                      g_currentlyRemote = !remoteCmd.empty();
                      g_sidecar.Start(hwnd, WM_APP_SIDECAR, ResolveNodeExe(),
                                      ResolveSidecarScript(), remoteCmd);
                      return S_OK;
                    })
                    .Get());
            return S_OK;
          })
          .Get());
}

HWND g_splash = nullptr;

ULONG_PTR g_gdiplusToken = 0;

bool PaintSplashLogo(HWND h, int size) {
  using namespace Gdiplus;

  std::wstring logoPath = ResolveAssetPath(L"wide-logo.png");
  if (logoPath.empty()) return false;

  Bitmap source(logoPath.c_str());
  if (source.GetLastStatus() != Ok) return false;

  BITMAPINFO info = {};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = size;
  info.bmiHeader.biHeight = -size;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;

  HDC screen = GetDC(nullptr);
  void* bits = nullptr;
  HBITMAP dib =
      CreateDIBSection(screen, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
  if (!dib || !bits) {
    if (dib) DeleteObject(dib);
    ReleaseDC(nullptr, screen);
    return false;
  }
  ZeroMemory(bits, static_cast<size_t>(size) * static_cast<size_t>(size) * 4);

  {
    Bitmap target(size, size, size * 4, PixelFormat32bppPARGB,
                  static_cast<BYTE*>(bits));
    Graphics graphics(&target);
    graphics.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    graphics.SetPixelOffsetMode(PixelOffsetModeHalf);
    graphics.SetSmoothingMode(SmoothingModeAntiAlias);
    graphics.Clear(Color(0, 0, 0, 0));
    graphics.DrawImage(&source, 0, 0, size, size);
  }

  HDC mem = CreateCompatibleDC(screen);
  HGDIOBJ previous = SelectObject(mem, dib);

  RECT wr;
  GetWindowRect(h, &wr);
  POINT topLeft = {wr.left, wr.top};
  SIZE extent = {size, size};
  POINT origin = {0, 0};
  BLENDFUNCTION blend = {};
  blend.BlendOp = AC_SRC_OVER;
  blend.SourceConstantAlpha = 255;
  blend.AlphaFormat = AC_SRC_ALPHA;

  BOOL ok = UpdateLayeredWindow(h, screen, &topLeft, &extent, mem, &origin, 0,
                                &blend, ULW_ALPHA);

  SelectObject(mem, previous);
  DeleteDC(mem);
  DeleteObject(dib);
  ReleaseDC(nullptr, screen);
  return ok != FALSE;
}

LRESULT CALLBACK SplashProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  return DefWindowProc(h, m, w, l);
}

void CreateSplash(HINSTANCE hi) {
  Gdiplus::GdiplusStartupInput startup;
  if (Gdiplus::GdiplusStartup(&g_gdiplusToken, &startup, nullptr) !=
      Gdiplus::Ok) {
    g_gdiplusToken = 0;
    return;
  }

  WNDCLASSW wc = {};
  wc.lpfnWndProc = SplashProc;
  wc.hInstance = hi;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = nullptr;
  wc.lpszClassName = L"WideSplash";
  RegisterClassW(&wc);

  UINT dpi = GetDpiForSystem();
  int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
  int size = MulDiv(438, dpi, 96);

  g_splash = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                             L"WideSplash", L"", WS_POPUP, (sw - size) / 2,
                             (sh - size) / 2, size, size, nullptr, nullptr, hi,
                             nullptr);
  if (!g_splash) return;

  if (!PaintSplashLogo(g_splash, size)) {
    DestroyWindow(g_splash);
    g_splash = nullptr;
    return;
  }

  ShowWindow(g_splash, SW_SHOWNOACTIVATE);
}

void DestroySplash() {
  if (g_splash) {
    DestroyWindow(g_splash);
    g_splash = nullptr;
  }
  if (g_gdiplusToken) {
    Gdiplus::GdiplusShutdown(g_gdiplusToken);
    g_gdiplusToken = 0;
  }
}

void ResetBrowserForSidecarRestart(HWND hwnd) {
  KillTimer(hwnd, kBrowserEnvRetryTimer);
  std::vector<std::pair<std::wstring, std::wstring>> reopen;
  for (auto& entry : g_tabs) {
    std::wstring url;
    if (entry.second.view) {
      wil::unique_cotaskmem_string uri;
      if (SUCCEEDED(entry.second.view->get_Source(&uri)) && uri) url = uri.get();
    }
    if (url.empty()) url = entry.second.pendingUrl;
    reopen.emplace_back(entry.first, url);
  }
  const std::wstring wasActive = g_activeTab;
  for (auto& entry : g_tabs) {
    if (entry.second.controller) entry.second.controller->Close();
  }
  g_tabs.clear();
  g_activeTab.clear();
  ++g_browserEnvGeneration;
  g_browserEnv.reset();
  g_browserEnvReady = false;
  g_browserEnvCreating = false;
  g_browserEnvRetries = 0;
  g_browserEnvWaiters.clear();
  g_browserProxyPort = 0;
  g_browserDebugPort = 0;
  g_browserFullscreen = false;
  g_browserVisible = false;
  g_bpDpi = 0;
  g_dtDpi = 0;
  g_devtoolsHasBounds = false;
  if (g_browserHost) ShowWindow(g_browserHost, SW_HIDE);
  DevtoolsClose();

  for (auto& entry : reopen) {
    if (entry.second.empty() || entry.second == L"about:blank") continue;
    BrowserNavigate(hwnd, entry.first, entry.second);
  }
  g_activeTab = wasActive;
  BrowserActivate(wasActive);
}

void RestartSidecar(HWND hwnd) {
  g_sidecar.Stop();
  ResetBrowserForSidecarRestart(hwnd);
  std::wstring remoteCmd = BuildRemoteCommand();
  g_currentlyRemote = !remoteCmd.empty();
  g_sidecarSpoke = false;
  g_sidecar.Start(hwnd, WM_APP_SIDECAR, ResolveNodeExe(), ResolveSidecarScript(), remoteCmd);
  if (g_webview) g_webview->Reload();
}

void BackendEmit(const char* state, int attempt) {
  if (!g_webview) return;
  json message = {{"type", "event"},
                  {"channel", "host:backend"},
                  {"payload", {{"state", state}, {"attempt", attempt}}}};
  g_webview->PostWebMessageAsJson(Utf8ToWide(message.dump()).c_str());
}

void OnSidecarExit(HWND hwnd) {
  if (g_currentlyRemote && !g_sidecarSpoke && !g_remoteFellBack) {
    g_remoteFellBack = true;
    g_sidecar.Stop();
    ResetBrowserForSidecarRestart(hwnd);
    g_currentlyRemote = false;
    g_sidecar.Start(hwnd, WM_APP_SIDECAR, ResolveNodeExe(), ResolveSidecarScript(), L"");
    if (g_webview) g_webview->Navigate(L"https://app.local/index.html?remoteFallback=1");
    return;
  }

  const ULONGLONG now = GetTickCount64();
  if (now - g_backendRestartWindow > kBackendRestartWindowMs) {
    g_backendRestartWindow = now;
    g_backendRestarts = 0;
  }
  if (g_backendRestarts >= kBackendMaxRestarts) {
    BackendEmit("down", g_backendRestarts);
    return;
  }
  ++g_backendRestarts;

  g_sidecar.Stop();
  ResetBrowserForSidecarRestart(hwnd);
  std::wstring remoteCmd = BuildRemoteCommand();
  g_currentlyRemote = !remoteCmd.empty();
  g_sidecarSpoke = false;
  const bool started =
      g_sidecar.Start(hwnd, WM_APP_SIDECAR, ResolveNodeExe(), ResolveSidecarScript(), remoteCmd);
  BackendEmit(started ? "restarted" : "down", g_backendRestarts);
}

void ApplyRemoteChange(HWND hwnd) {
  bool wantRemote = !BuildRemoteCommand().empty();
  if (wantRemote || g_currentlyRemote) {
    g_remoteFellBack = false;
    RestartSidecar(hwnd);
  }
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  switch (msg) {
    case WM_APP_SIDECAR: {
      if (wparam == 1) {
        OnSidecarExit(hwnd);
        return 0;
      }
      g_sidecarSpoke = true;
      for (auto& line : g_sidecar.DrainIncoming()) ProcessSidecarLine(hwnd, line);
      return 0;
    }
    case WM_APP_REMOTE_APPLY: {
      ApplyRemoteChange(hwnd);
      return 0;
    }
    case WM_APP_INSTALL_UPDATE: {
      if (g_pendingInstaller.empty()) return 0;
      std::wstring installer = g_pendingInstaller;
      g_pendingInstaller.clear();

      g_sidecar.Stop();

      std::wstring cmd = L"\"" + installer +
                         L"\" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL";
      std::wstring mutableCmd = cmd;
      STARTUPINFOW si = {};
      si.cb = sizeof(si);
      PROCESS_INFORMATION pi = {};
      if (CreateProcessW(nullptr, mutableCmd.data(), nullptr, nullptr, FALSE,
                         CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW, nullptr, nullptr, &si,
                         &pi)) {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
      }
      DestroyWindow(hwnd);
      return 0;
    }
    case WM_TIMER: {
      if (wparam != kBrowserEnvRetryTimer) return DefWindowProc(hwnd, msg, wparam, lparam);
      KillTimer(hwnd, kBrowserEnvRetryTimer);
      RetryPendingBrowserTabs(hwnd);
      return 0;
    }
    case WM_COPYDATA: {

      auto* cds = reinterpret_cast<COPYDATASTRUCT*>(lparam);
      if (cds && cds->dwData == kOpenPathCopyTag && cds->lpData && cds->cbData >= sizeof(wchar_t)) {
        std::wstring path(reinterpret_cast<const wchar_t*>(cds->lpData),
                          cds->cbData / sizeof(wchar_t));

        while (!path.empty() && path.back() == L'\0') path.pop_back();
        HostEmitOpenPath(path);
      }
      return TRUE;
    }
    case WM_NCCALCSIZE: {

      if (wparam == FALSE) return DefWindowProc(hwnd, msg, wparam, lparam);
      auto* p = reinterpret_cast<NCCALCSIZE_PARAMS*>(lparam);
      RECT win = p->rgrc[0];
      DefWindowProc(hwnd, WM_NCCALCSIZE, wparam, lparam);
      if (IsZoomed(hwnd)) {

        UINT dpi = GetDpiForWindow(hwnd);
        if (!dpi) dpi = 96;
        const int border = GetSystemMetricsForDpi(SM_CYFRAME, dpi) +
                           GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
        p->rgrc[0].top = win.top + border;
      } else {
        p->rgrc[0].top = win.top;
      }
      return 0;
    }
    case WM_SIZE:
      ResizeWebViewToClient(hwnd);
      return 0;
    case WM_GETMINMAXINFO: {
      UINT d = GetDpiForWindow(hwnd);
      if (!d) d = 96;
      auto* mmi = reinterpret_cast<MINMAXINFO*>(lparam);
      mmi->ptMinTrackSize.x = MulDiv(kMinWidth, d, 96);
      mmi->ptMinTrackSize.y = MulDiv(kMinHeight, d, 96);
      return 0;
    }
    case WM_DPICHANGED: {
      RECT* r = reinterpret_cast<RECT*>(lparam);
      SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left,
                   r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      RescaleNativePanes(HIWORD(wparam));
      return 0;
    }
    case WM_ERASEBKGND: {
      HDC hdc = reinterpret_cast<HDC>(wparam);
      RECT rc;
      GetClientRect(hwnd, &rc);
      HBRUSH brush = CreateSolidBrush(kBackground);
      FillRect(hdc, &rc, brush);
      DeleteObject(brush);
      return 1;
    }
    case WM_DESTROY:
      g_sidecar.Stop();
      for (auto& entry : g_tabs) {
        if (entry.second.controller) entry.second.controller->Close();
      }
      g_tabs.clear();
      g_browserEnv.reset();
      g_webview.reset();
      g_controller.reset();
      g_env.reset();
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProc(hwnd, msg, wparam, lparam);
  }
}

}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, PWSTR, int nCmdShow) {

  std::wstring launchPath = ParseLaunchPath();
  HANDLE instanceMutex = CreateMutexW(nullptr, TRUE, L"Local\\Wide.SingleInstance");
  if (instanceMutex && GetLastError() == ERROR_ALREADY_EXISTS) {
    HWND existing = FindWindowW(kWindowClass, nullptr);
    if (existing) {

      if (!launchPath.empty()) {
        COPYDATASTRUCT cds = {};
        cds.dwData = kOpenPathCopyTag;
        cds.cbData = static_cast<DWORD>((launchPath.size() + 1) * sizeof(wchar_t));
        cds.lpData = const_cast<wchar_t*>(launchPath.c_str());
        SendMessageW(existing, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&cds));
      }
      if (IsIconic(existing)) ShowWindow(existing, SW_RESTORE);
      SetForegroundWindow(existing);
    }
    return 0;
  }

  g_pendingOpenPath = launchPath;
  RegisterShellIntegration();

  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  CreateSplash(hInstance);

  WNDCLASSEX wc = {};
  wc.cbSize = sizeof(wc);
  wc.style = CS_HREDRAW | CS_VREDRAW;
  wc.lpfnWndProc = WndProc;
  wc.hInstance = hInstance;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = CreateSolidBrush(kBackground);
  wc.lpszClassName = kWindowClass;

  wc.hIcon = static_cast<HICON>(LoadImage(hInstance, MAKEINTRESOURCE(IDI_APPICON), IMAGE_ICON,
                                          GetSystemMetrics(SM_CXICON),
                                          GetSystemMetrics(SM_CYICON), 0));
  wc.hIconSm = static_cast<HICON>(LoadImage(hInstance, MAKEINTRESOURCE(IDI_APPICON), IMAGE_ICON,
                                            GetSystemMetrics(SM_CXSMICON),
                                            GetSystemMetrics(SM_CYSMICON), 0));
  RegisterClassEx(&wc);

  UINT dpi = GetDpiForSystem();
  int winW = MulDiv(kInitialWidth, dpi, 96);
  int winH = MulDiv(kInitialHeight, dpi, 96);
  int screenW = GetSystemMetrics(SM_CXSCREEN);
  int screenH = GetSystemMetrics(SM_CYSCREEN);
  int x = (screenW - winW) / 2;
  int y = (screenH - winH) / 2;

  HWND hwnd = CreateWindowEx(
      0, kWindowClass, kWindowTitle, WS_OVERLAPPEDWINDOW,
      x, y, winW, winH,
      nullptr, nullptr, hInstance, nullptr);
  if (!hwnd) return 1;
  g_mainWindow = hwnd;

  BOOL dark = TRUE;
  DwmSetWindowAttribute(hwnd,  20, &dark,
                        sizeof(dark));

  SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
               SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
                   SWP_NOACTIVATE);
  (void)nCmdShow;

  InitWebView(hwnd);

  MSG msg;
  while (GetMessage(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }
  CoUninitialize();
  return static_cast<int>(msg.wParam);
}
