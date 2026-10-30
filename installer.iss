; ==============================================================================
; HR FLOW — Inno Setup Script for Windows Installer
; Compiles into a single standalone installer: HRFlow_Setup.exe
; ZERO ADMINISTRATOR PRIVILEGES REQUIRED (Installs to LocalAppData like Discord/VS Code)
; ==============================================================================

#define MyAppName "HR Flow"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "HR Flow Core Team"
#define MyAppExeName "HRFlow.vbs"

[Setup]
AppId={{E58F6A1A-82B1-4A2B-9C1D-89C942D8E09B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\HRFlow
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=HRFlow_Setup_v{#MyAppVersion}
SetupIconFile=frontend\img\hrflow.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; ZERO ADMIN PASSWORD: Runs strictly at user level
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "HRFlow.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "desktop_app.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "requirements.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "WorkFlow\*"; DestDir: "{app}\WorkFlow"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; IconFilename: "{app}\frontend\img\hrflow.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; IconFilename: "{app}\frontend\img\hrflow.ico"; Tasks: desktopicon

[Run]
Filename: "wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

