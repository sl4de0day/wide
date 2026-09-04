#define AppName "Wide"
#define AppVersion "0.35926"
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
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=yes
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "..\dist\wide\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\wide.exe"; IconFilename: "{app}\assets\wide.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\wide.exe"; IconFilename: "{app}\assets\wide.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\wide.exe"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
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
