$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "创建 Python 虚拟环境失败，退出码：$LASTEXITCODE" }
}
& '.\.venv\Scripts\python.exe' '.\scripts\check_version.py'
if ($LASTEXITCODE -ne 0) { throw "应用版本号不一致，退出码：$LASTEXITCODE" }
& '.\.venv\Scripts\python.exe' -m pip install -e '.[dev]'
if ($LASTEXITCODE -ne 0) { throw "安装 Python 依赖失败，退出码：$LASTEXITCODE" }

npm ci
if ($LASTEXITCODE -ne 0) { throw "安装前端依赖失败，退出码：$LASTEXITCODE" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "构建前端失败，退出码：$LASTEXITCODE" }
npm test
if ($LASTEXITCODE -ne 0) { throw "前端测试失败，退出码：$LASTEXITCODE" }
& '.\.venv\Scripts\python.exe' -m pytest
if ($LASTEXITCODE -ne 0) { throw "后端测试失败，退出码：$LASTEXITCODE" }
& '.\.venv\Scripts\python.exe' '.\scripts\build_icon.py'
if ($LASTEXITCODE -ne 0) { throw "生成应用图标失败，退出码：$LASTEXITCODE" }
& '.\.venv\Scripts\python.exe' -m PyInstaller --noconfirm --clean bitty.spec
if ($LASTEXITCODE -ne 0) { throw "构建 Windows 应用失败，退出码：$LASTEXITCODE" }

$releaseDirectory = Join-Path $projectRoot 'dist\Bitty-Note'
$releaseDocuments = @(
    'LICENSE',
    'CHANGELOG.md',
    'PRIVACY.md',
    'CODE_SIGNING_POLICY.md',
    'THIRD_PARTY_NOTICES.md'
)
foreach ($document in $releaseDocuments) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $document) -Destination $releaseDirectory
}

Write-Host 'Build completed: dist\Bitty-Note\Bitty-Note.exe'
