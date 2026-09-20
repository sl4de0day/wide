include(FetchContent)

set(WEBVIEW2_VERSION "1.0.2903.40" CACHE STRING "Microsoft.Web.WebView2 version")
set(WIL_VERSION "1.0.240803.1" CACHE STRING "Microsoft.Windows.ImplementationLibrary version")

FetchContent_Declare(
  webview2
  URL "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}"
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_Declare(
  wil
  URL "https://www.nuget.org/api/v2/package/Microsoft.Windows.ImplementationLibrary/${WIL_VERSION}"
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(webview2 wil)

function(target_link_webview2 tgt)
  target_include_directories(${tgt} PRIVATE
    "${webview2_SOURCE_DIR}/build/native/include"
    "${wil_SOURCE_DIR}/include"
  )

  set(_arch "x64")
  target_link_libraries(${tgt} PRIVATE
    "${webview2_SOURCE_DIR}/build/native/${_arch}/WebView2LoaderStatic.lib"
    version ole32 oleaut32 shlwapi
  )
endfunction()
