#define AppName "Wide"
#define AppVersion "0.55926"
#define AppPublisher "sl4de"
#define AppRepo "https://github.com/sl4de0day/wide"

[Setup]
AppId={{8F2A1C7E-3D5B-4A9E-B6C2-0D1E2F3A4B5C}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppRepo}
AppSupportURL={#AppRepo}/issues
AppUpdatesURL={#AppRepo}/releases
DefaultDirName={localappdata}\Programs\Wide
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=Wide-Setup-{#AppVersion}
SetupIconFile=..\native-host\assets\wide.ico
UninstallDisplayIcon={app}\wide.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
ShowLanguageDialog=yes
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=yes
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[CustomMessages]
english.DesktopIcon=Create a desktop shortcut
english.ShortcutsGroup=Additional shortcuts:
english.LaunchApp=Launch Wide
english.WideLocale=en
turkish.DesktopIcon=Masaüstü kısayolu oluştur
turkish.ShortcutsGroup=Ek kısayollar:
turkish.LaunchApp=Wide'ı başlat
turkish.WideLocale=tr
spanish.DesktopIcon=Crear un acceso directo en el escritorio
spanish.ShortcutsGroup=Accesos directos adicionales:
spanish.LaunchApp=Iniciar Wide
spanish.WideLocale=es
german.DesktopIcon=Verknüpfung auf dem Desktop erstellen
german.ShortcutsGroup=Zusätzliche Verknüpfungen:
german.LaunchApp=Wide starten
german.WideLocale=de
french.DesktopIcon=Créer un raccourci sur le Bureau
french.ShortcutsGroup=Raccourcis supplémentaires :
french.LaunchApp=Lancer Wide
french.WideLocale=fr
italian.DesktopIcon=Crea un collegamento sul desktop
italian.ShortcutsGroup=Collegamenti aggiuntivi:
italian.LaunchApp=Avvia Wide
italian.WideLocale=it
japanese.DesktopIcon=デスクトップにショートカットを作成する
japanese.ShortcutsGroup=追加のショートカット:
japanese.LaunchApp=Wide を起動する
japanese.WideLocale=ja
korean.DesktopIcon=바탕 화면에 바로 가기 만들기
korean.ShortcutsGroup=추가 바로 가기:
korean.LaunchApp=Wide 실행
korean.WideLocale=ko

[INI]
Filename: "{app}\wide.ini"; Section: "Setup"; Key: "Language"; String: "{cm:WideLocale}"

[UninstallDelete]
Type: files; Name: "{app}\wide.ini"

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; GroupDescription: "{cm:ShortcutsGroup}"

[Files]
Source: "..\dist\wide\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\wide.exe"; IconFilename: "{app}\assets\wide.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\wide.exe"; IconFilename: "{app}\assets\wide.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\wide.exe"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\wide.exe"; Flags: nowait runasoriginaluser skipifnotsilent

[Code]
function WebView2Installed(): Boolean;
var
  pv: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv) or
    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', pv);
  if Result then
    Result := (pv <> '') and (pv <> '0.0.0.0');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  code: Integer;
begin
  if CurStep = ssInstall then
  begin
    if not WebView2Installed() then
    begin
      ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
      Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, code);
    end;
  end;
end;
