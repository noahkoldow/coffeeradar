param(
  [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot

Write-Host "[security-preflight] Running codebase checks..."

$issues = @()

$hasRg = $null -ne (Get-Command rg -ErrorAction SilentlyContinue)

function Find-Pattern {
  param(
    [string]$Pattern,
    [string[]]$Targets
  )

  if ($hasRg) {
    return rg --no-heading --line-number $Pattern @Targets 2>$null
  }

  $matches = @()
  foreach ($target in $Targets) {
    if (Test-Path $target) {
      $result = Select-String -Path $target -Pattern $Pattern -SimpleMatch -ErrorAction SilentlyContinue
      if ($result) {
        $matches += ($result | ForEach-Object { "{0}:{1}: {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() })
      }
    }
  }
  return $matches
}

# 1) Forbidden insecure voucher secret fallback
$voucherFallback = Find-Pattern -Pattern "dev_voucher_secret" -Targets @("functions/src/**/*.ts", "functions/lib/**/*.js")
if ($voucherFallback) {
  $issues += "Found insecure voucher secret fallback usage."
  Write-Host $voucherFallback
}

# 2) Client-side direct Gemini endpoint usage in screens/components
$directGeminiUi = Find-Pattern -Pattern "generateContent?key=" -Targets @("src/screens/**/*.ts", "src/screens/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx")
if ($directGeminiUi) {
  $issues += "Found direct Gemini key endpoint in UI-layer files (screens/components)."
  Write-Host $directGeminiUi
}

# 3) Public storage read rule for community ideas
$publicStorageRead = Find-Pattern -Pattern "allow read: if true;" -Targets @("storage.rules")
if ($publicStorageRead -and ($publicStorageRead -match "allow read: if true;")) {
  $issues += "Found public read rule in storage.rules community_ideas path."
  Write-Host $publicStorageRead
}

# 4) Legacy email-based admin rule
$emailAdminRule = @()
$emailAdminRule += Find-Pattern -Pattern "request.auth.token.email" -Targets @("firestore.rules", "storage.rules")
$emailAdminRule += Find-Pattern -Pattern "bitsapp.admin@gmail.com" -Targets @("firestore.rules", "storage.rules")
if ($emailAdminRule) {
  $issues += "Found email-based admin authorization logic in rules."
  Write-Host $emailAdminRule
}

if ($issues.Count -gt 0) {
  Write-Host "[security-preflight] FAILED" -ForegroundColor Red
  $issues | ForEach-Object { Write-Host "- $_" }
  exit 1
}

Write-Host "[security-preflight] PASS" -ForegroundColor Green
exit 0
