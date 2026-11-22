#  ApkStart   - 
#  :  →  PowerShell
#  :  4 , 

$ErrorActionPreference = 'Continue'
$root = 'D:\apkstart-dsh\apkstart'
#  package.json ,  -- . 
#  MSIX (0.5.2 → 0.5.2.0),  build/msix.js . 
$ver = '0.0.0.0'
try {
    #  -Encoding UTF8: Windows PowerShell 5.1  ANSI, 
    #  package.json  description,  ANSI  → ConvertFrom-Json . 
    $pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $ver = ('{0}.0' -f $pkg.version)
} catch {
    Write-Host '  [!]  package.json  version,  0.5.3.0 ' -ForegroundColor Yellow
    $ver = '0.5.3.0'
}
$msix = Join-Path $root ('dist\store\ApkStart_{0}_x64.msix' -f $ver)
$guide = Join-Path $root 'docs\store-upload-walkthrough.md'
$listing = Join-Path $root 'docs\store-listing.md'

Write-Host ''
Write-Host '  ApkStart ' -ForegroundColor Green
Write-Host '  ─────────────────────────────' -ForegroundColor DarkGray

if (-not (Test-Path $msix)) {
    Write-Host "  [!] : $msix" -ForegroundColor Red
    Write-Host '       node build/msix.js . ' -ForegroundColor DarkGray
} else {
    $mb = [math]::Round((Get-Item $msix).Length / 1MB, 1)
    Write-Host "  [1]   $mb MB" -ForegroundColor Cyan
    Write-Host '      , ' -ForegroundColor DarkGray
    Start-Process explorer.exe "/select,`"$msix`""
}

Write-Host '  [2] Partner Center(, )' -ForegroundColor Cyan
Start-Process 'https://partner.microsoft.com/dashboard/apps-and-games'

if (Test-Path $guide) {
    Write-Host '  [3] ()' -ForegroundColor Cyan
    Start-Process $guide
}

if (Test-Path $listing) {
    Write-Host '  [4] listing ( /  / )' -ForegroundColor Cyan
    Start-Process $listing
}

Write-Host ''
Write-Host '  :  →  →  listing → ' -ForegroundColor Yellow
Write-Host '  Privacy Policy: https://github.com/Abhi666-max/apkbolt/blob/main/docs/privacy.md' -ForegroundColor DarkGray
Write-Host ''
