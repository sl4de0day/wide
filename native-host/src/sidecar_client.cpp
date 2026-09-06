#include "sidecar_client.h"

#include <string>

namespace {
constexpr DWORD kGracefulExitMs = 3000;
}

bool SidecarClient::Start(HWND notifyHwnd, UINT notifyMsg,
                          const std::wstring& nodeExe,
                          const std::wstring& scriptPath,
                          const std::wstring& fullCommand) {
  notifyHwnd_ = notifyHwnd;
  notifyMsg_ = notifyMsg;

  SECURITY_ATTRIBUTES sa = {};
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;

  constexpr DWORD kPipeBytes = 1u << 20;
  HANDLE stdinRd = nullptr, stdinWr = nullptr;
  HANDLE stdoutRd = nullptr, stdoutWr = nullptr;
  if (!CreatePipe(&stdinRd, &stdinWr, &sa, kPipeBytes)) return false;
  if (!CreatePipe(&stdoutRd, &stdoutWr, &sa, kPipeBytes)) return false;

  SetHandleInformation(stdinWr, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stdoutRd, HANDLE_FLAG_INHERIT, 0);

  std::wstring cmd = fullCommand.empty()
                         ? (L"\"" + nodeExe + L"\" \"" + scriptPath + L"\"")
                         : fullCommand;
  std::wstring mutableCmd = cmd;

  STARTUPINFOW si = {};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = stdinRd;
  si.hStdOutput = stdoutWr;
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

  if (!hJob_) {
    hJob_ = CreateJobObjectW(nullptr, nullptr);
    if (hJob_) {
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (!SetInformationJobObject(hJob_, JobObjectExtendedLimitInformation, &limits,
                                   sizeof(limits))) {
        CloseHandle(hJob_);
        hJob_ = nullptr;
      }
    }
  }

  PROCESS_INFORMATION pi = {};
  BOOL ok = CreateProcessW(nullptr, mutableCmd.data(), nullptr, nullptr, TRUE,
                           CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &si, &pi);

  CloseHandle(stdinRd);
  CloseHandle(stdoutWr);
  if (!ok) {
    CloseHandle(stdinWr);
    CloseHandle(stdoutRd);
    return false;
  }
  if (hJob_) AssignProcessToJobObject(hJob_, pi.hProcess);
  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);
  hProcess_ = pi.hProcess;
  hStdinWr_ = stdinWr;
  hStdoutRd_ = stdoutRd;

  hReaderThread_ = CreateThread(nullptr, 0, ReaderThunk, this, 0, nullptr);
  hWriterThread_ = CreateThread(nullptr, 0, WriterThunk, this, 0, nullptr);
  return true;
}

void SidecarClient::Send(const std::string& jsonObject) {
  if (!hStdinWr_) return;
  {
    std::lock_guard<std::mutex> lock(writeMutex_);
    outgoing_.push_back(jsonObject);
    outgoing_.back().push_back('\n');
  }
  writeCv_.notify_one();
}

DWORD WINAPI SidecarClient::WriterThunk(LPVOID self) {
  reinterpret_cast<SidecarClient*>(self)->WriterLoop();
  return 0;
}

void SidecarClient::WriterLoop() {
  for (;;) {
    std::string line;
    {
      std::unique_lock<std::mutex> lock(writeMutex_);
      writeCv_.wait(lock, [this] { return stopping_ || !outgoing_.empty(); });
      if (stopping_ && outgoing_.empty()) return;
      line = std::move(outgoing_.front());
      outgoing_.pop_front();
    }

    size_t at = 0;
    while (at < line.size()) {
      DWORD written = 0;
      if (!WriteFile(hStdinWr_, line.data() + at, (DWORD)(line.size() - at), &written, nullptr) ||
          written == 0) {
        return;
      }
      at += written;
    }
  }
}

std::vector<std::string> SidecarClient::DrainIncoming() {
  std::vector<std::string> out;
  std::lock_guard<std::mutex> lock(queueMutex_);
  while (!incoming_.empty()) {
    out.push_back(std::move(incoming_.front()));
    incoming_.pop_front();
  }
  return out;
}

DWORD WINAPI SidecarClient::ReaderThunk(LPVOID self) {
  reinterpret_cast<SidecarClient*>(self)->ReaderLoop();
  return 0;
}

void SidecarClient::ReaderLoop() {

  std::vector<char> buf(64 * 1024);

  size_t scanned = 0;
  size_t consumed = 0;

  for (;;) {
    DWORD read = 0;
    if (!ReadFile(hStdoutRd_, buf.data(), (DWORD)buf.size(), &read, nullptr) || read == 0) {

      if (!stopping_ && notifyHwnd_) PostMessage(notifyHwnd_, notifyMsg_, 1, 0);
      break;
    }
    readBuf_.append(buf.data(), read);

    bool queued = false;
    for (;;) {
      const size_t pos = readBuf_.find('\n', scanned);
      if (pos == std::string::npos) {

        scanned = readBuf_.size();
        break;
      }
      size_t end = pos;
      if (end > consumed && readBuf_[end - 1] == '\r') --end;
      if (end > consumed) {
        std::string line = readBuf_.substr(consumed, end - consumed);
        std::lock_guard<std::mutex> lock(queueMutex_);
        incoming_.push_back(std::move(line));
        queued = true;
      }
      consumed = pos + 1;
      scanned = consumed;
    }

    if (consumed > 0 && (consumed >= readBuf_.size() || consumed > (1u << 20))) {
      readBuf_.erase(0, consumed);
      scanned -= consumed;
      consumed = 0;
    }

    if (queued && notifyHwnd_) PostMessage(notifyHwnd_, notifyMsg_, 0, 0);
  }
}

void SidecarClient::Stop() {

  stopping_ = true;
  writeCv_.notify_all();
  if (hWriterThread_) {
    WaitForSingleObject(hWriterThread_, 1000);
    CloseHandle(hWriterThread_);
    hWriterThread_ = nullptr;
  }
  if (hProcess_) {
    if (hStdinWr_) { CloseHandle(hStdinWr_); hStdinWr_ = nullptr; }
    if (WaitForSingleObject(hProcess_, kGracefulExitMs) != WAIT_OBJECT_0) {
      TerminateProcess(hProcess_, 0);
    }
    CloseHandle(hProcess_);
    hProcess_ = nullptr;
  }
  if (hJob_) {
    CloseHandle(hJob_);
    hJob_ = nullptr;
  }
  if (hStdinWr_) { CloseHandle(hStdinWr_); hStdinWr_ = nullptr; }
  if (hStdoutRd_) { CloseHandle(hStdoutRd_); hStdoutRd_ = nullptr; }
  if (hReaderThread_) {
    WaitForSingleObject(hReaderThread_, 1000);
    CloseHandle(hReaderThread_);
    hReaderThread_ = nullptr;
  }
}
