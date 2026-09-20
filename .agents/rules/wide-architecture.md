# WIDE — Proje Mimarisi, Kod İlkeleri ve Sürüm Yayınlama Rehberi

## 1. Kod Standartları & Katı İlkeler
- **YORUM SATIRI YASAKTIR**: Projedeki kod dosyalarında (JS, TS, TSX, C++, RC vb.) kesinlikle `//` veya `/* */` yorum satırları bırakılmamalıdır. Temiz, self-documenting kod yazılmalıdır.
- **Yorum Temizleyici İstisnaları**: Yalnızca derleyici/güvenlik direktifleri (`wide-ignore[...]`, `wide-ignore-next-line[...]`, `eslint-disable-line`, `@ts-ignore`) korunmalıdır.
- **Doğrulama**: Herhangi bir değişiklikten sonra `npm run typecheck` ve `npm run test` (95 birim test + smoke testleri) 0 hata ile geçmelidir.

## 2. Otomatik Güncelleme (Auto-Update) Mimarisi
- **Mekanizma**: Wide açılışta (`useUpdate.getState().boot()`) ve her 6 saatte bir `https://api.github.com/repos/sl4de0day/wide/releases/latest` adresini kontrol eder.
- **Sürüm Kıyaslama**: `apps/backend/src/64-update.js` içindeki `compareVersions()` fonksiyonu GitHub tag'i ile `WIDE_VERSION` sabitini kıyaslar.
- **Varlık Doğrulama**: GitHub Release varlıkları arasından regex ile `Wide-Setup-*.exe` ve `SHA256SUMS` dosyaları bulunur. Kurulum dosyası `%TEMP%` dizinine indirilip SHA-256 hash doğrulaması yapılır.
- **Sessiz Güncelleme**: `native-host/src/main.cpp` üzerindeki `app:installUpdate` işleyicisi sidecar'ı durdurur, `Wide-Setup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL` komutuyla bağımsız kurulum başlatır ve eski pencereyi kapatır. Inno Setup (`installer/wide.iss`), dosyaları güncelledikten sonra `skipifnotsilent` ile yeni Wide'ı otomatik olarak başlatır.

## 3. Yeni Sürüm Yayınlama (Release) Süreci
Yeni bir sürüm yayınlanacağı zaman sırasıyla şu adımlar izlenir:
1. **Sürüm Numarasının Güncellenmesi (7 Dosya)**:
   - `package.json` (`version`)
   - `package-lock.json` (`version`)
   - `apps/renderer/package.json` (`version`)
   - `apps/renderer/package-lock.json` (`version`)
   - `apps/backend/src/64-update.js` (`const WIDE_VERSION = "..."`)
   - `installer/wide.iss` (`#define AppVersion "..."`)
   - `native-host/src/app.rc` (`FILEVERSION`, `PRODUCTVERSION`, `FileVersion`, `ProductVersion`)
2. **Backend Paketleme**:
   - `npm run build:backend` çalıştırılarak `out/main/index.js` yeni sürüm bilgisiyle derlenir.
3. **Release Notları**:
   - Kök dizindeki `RELEASE_NOTES.md` dosyası yeni sürümün yenilikleri ve düzeltmeleriyle güncellenir.
4. **Commit & Push**:
   - `git add -A`
   - `git commit -m "Wide <version>"`
   - `git push origin main`
5. **Tag & CI/CD Dağıtımı**:
   - `git tag v<version>`
   - `git push origin v<version>`
   - `.github/workflows/release.yml` GitHub Actions iş akışı otomatik olarak Windows üzerinde Inno Setup ile `Wide-Setup-<version>.exe` ve `SHA256SUMS` dosyalarını üretip `RELEASE_NOTES.md` içeriğiyle GitHub Releases üzerinde **Latest** olarak yayınlar.

## 4. Kritik Arayüz & Sistem Davranışları
- **Arayüz Zoom Kilidi & Yalnızca Editör Zoom'u**:
  - Wide arayüzü (başlık çubuğu, sekmeler, yan panel, durum çubuğu, terminal) web sitesi gibi zoomlanamaz.
  - `apps/renderer/src/App.tsx` içinde `capture: true` ve `passive: false` modundaki `wheel` dinleyicisi `Ctrl + Wheel` olaylarında `event.preventDefault()` çağırır.
  - Yalnızca fare imleci bir kod editörü (`.cm-editor`, `[data-code-editor]`) üzerindeyken editör font boyutu (`--editor-font-size`) dinamik olarak artırılır/azaltılır.
  - `native-host/src/main.cpp` içinde WebView2 `ZoomFactor` 1.0 değerine kilitlidir.
- **Pencere Odaklanması (Click-Through)**:
  - `main.cpp` içinde `WM_MOUSEACTIVATE`, `WM_SETFOCUS` ve `WM_ACTIVATE` mesajları yönetilerek terminal, kod editörü, browser görünümü ve DevTools arasında geçişlerde çift tık veya odak kaybı sorunu yaşanmaz.
- **Çoklu Panel Düzeni (Grid Splitting)**:
  - `1x2`, `2x1`, `2x2`, `1x3`, `3x1` ızgara düzenleri ve sekmelerin paneller arasında sürüklenip bırakılması desteklenir; paneller arası geçiş `F6` ve `Shift+F6` ile yapılır.
- **Çok Sekmeli Entegre Terminal**:
  - Çoklu eşzamanlı PTY sekmeleri (PowerShell, CMD, Git Bash, WSL) bağımsız süreçler olarak çalışır.
- **Çökme Raporlama (Crash Reporting)**:
  - Opt-in `CrashReportDialog`, beklenmeyen arka uç çökmelerinde `pending_crash.json` dosyasını tespit eder ve yalnızca kullanıcının onayıyla Supabase'e gönderir.
