cmake_minimum_required(VERSION 3.21)
project(wide_host LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT WIN32)
  message(FATAL_ERROR "wide_host is Windows-only (Win32 + WebView2).")
endif()

if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  add_compile_options(/utf-8 /W4 /permissive-)
endif()

include(FetchContent)
FetchContent_Declare(
  nlohmann_json
  URL "https://github.com/nlohmann/json/releases/download/v3.11.3/include.zip"
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

add_executable(wide_host WIN32
  src/main.cpp
  src/ipc.cpp
  src/sidecar_client.cpp
  src/app.rc
)

target_include_directories(wide_host PRIVATE
  src
  "${nlohmann_json_SOURCE_DIR}/single_include"
)

target_link_libraries(wide_host PRIVATE
  user32 gdi32 gdiplus shell32 dwmapi ole32 shlwapi crypt32
)

target_compile_definitions(wide_host PRIVATE UNICODE _UNICODE)

include(cmake/webview2.cmake)
target_link_webview2(wide_host)

set_target_properties(wide_host PROPERTIES
  OUTPUT_NAME "wide"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
