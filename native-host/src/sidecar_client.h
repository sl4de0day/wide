

#pragma once
#include <windows.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

class SidecarClient {
 public:

  bool Start(HWND notifyHwnd, UINT notifyMsg, const std::wstring& nodeExe,
             const std::wstring& scriptPath, const std::wstring& fullCommand = L"");

  void Send(const std::string& jsonObject);
  std::vector<std::string> DrainIncoming();
  bool Running() const { return hProcess_ != nullptr; }
  void Stop();

 private:
  static DWORD WINAPI ReaderThunk(LPVOID self);
  static DWORD WINAPI WriterThunk(LPVOID self);
  void ReaderLoop();
  void WriterLoop();

  HANDLE hJob_ = nullptr;
  HANDLE hStdinWr_ = nullptr;
  HANDLE hStdoutRd_ = nullptr;
  HANDLE hProcess_ = nullptr;
  HANDLE hReaderThread_ = nullptr;
  HANDLE hWriterThread_ = nullptr;
  HWND notifyHwnd_ = nullptr;
  UINT notifyMsg_ = 0;

  std::mutex queueMutex_;
  std::deque<std::string> incoming_;
  std::string readBuf_;

  std::mutex writeMutex_;
  std::condition_variable writeCv_;
  std::deque<std::string> outgoing_;
  std::atomic<bool> stopping_{false};
};
