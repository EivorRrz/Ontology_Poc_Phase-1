# PowerShell script to install dependencies with Puppeteer download skipped
# This avoids SSL certificate issues when Puppeteer tries to download Chromium

Write-Host "Installing dependencies with PUPPETEER_SKIP_DOWNLOAD=true..." -ForegroundColor Green
$env:PUPPETEER_SKIP_DOWNLOAD = "true"
npm install --legacy-peer-deps

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nInstallation completed successfully!" -ForegroundColor Green
    Write-Host "Note: Puppeteer Chromium download was skipped to avoid SSL certificate issues." -ForegroundColor Yellow
} else {
    Write-Host "`nInstallation failed. Please check the error messages above." -ForegroundColor Red
    exit $LASTEXITCODE
}

