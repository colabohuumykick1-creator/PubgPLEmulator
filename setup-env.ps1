$ErrorActionPreference = "Stop"

$project = $PSScriptRoot
$envPath = Join-Path $project ".env"
$gitignorePath = Join-Path $project ".gitignore"
$clientId = "1553023930791366787"
$guildId = "1476865931429810197"

Set-Location -LiteralPath $project

function Stop-Setup {
    param([string]$Message)

    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Test-DiscordBotToken {
    param([string]$Token)

    try {
        $response = Invoke-RestMethod `
            -Uri "https://discord.com/api/v10/users/@me" `
            -Headers @{ Authorization = "Bot $Token" } `
            -Method Get
    }
    catch {
        Stop-Setup "Discord odrzucil token. Zresetuj Bot Token, skopiuj go do schowka i uruchom ten skrypt ponownie."
    }

    if ($response.bot -ne $true) {
        Stop-Setup "W schowku nie ma tokenu konta bota."
    }

    if ([string]$response.id -ne $clientId) {
        Stop-Setup "Token nalezy do innej aplikacji Discord niz CLIENT_ID skonfigurowany dla tego projektu."
    }

    return $response
}

Write-Host ""
Write-Host "PubgPLEMULATOR - bezpieczna konfiguracja tokenu" -ForegroundColor Cyan
Write-Host ""

try {
    $clipboardText = [string](Get-Clipboard -Raw)
}
catch {
    Stop-Setup "Nie udalo sie odczytac schowka."
}

$token = $clipboardText.Trim()

if ([string]::IsNullOrWhiteSpace($token)) {
    Stop-Setup "Schowek jest pusty. Skopiuj swiezy Bot Token i uruchom skrypt ponownie."
}

if ($token -match "\s" -or $token -match "[\x00-\x1F\x7F]") {
    Stop-Setup "Token zawiera spacje, nowa linie albo znak sterujacy."
}

if ($token.StartsWith("Bot ", [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Setup "Skopiuj sam Bot Token, bez prefiksu 'Bot '."
}

if ($token -match "^(token|your[_ -]?token|bot[_ -]?token|wklej|paste|\*+)$") {
    Stop-Setup "Schowek zawiera placeholder zamiast Bot Tokena."
}

Write-Host "Sprawdzam token bez zapisywania go na dysku..." -ForegroundColor Cyan
$bot = Test-DiscordBotToken -Token $token

if (-not (Test-Path -LiteralPath $gitignorePath)) {
    [System.IO.File]::WriteAllText($gitignorePath, "", (New-Object System.Text.UTF8Encoding($false)))
}

$gitignore = @(Get-Content -LiteralPath $gitignorePath -ErrorAction SilentlyContinue)

if ($gitignore -notcontains ".env") {
    Add-Content -LiteralPath $gitignorePath -Value ".env"
}

$envContent = @(
    "DISCORD_TOKEN=$token"
    "CLIENT_ID=$clientId"
    "GUILD_ID=$guildId"
    "AUTO_SETUP=false"
) -join "`r`n"
$envContent += "`r`n"

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, $envContent, $utf8WithoutBom)

$savedTokenLine = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^DISCORD_TOKEN=' } |
    Select-Object -First 1
$savedToken = $savedTokenLine.Substring("DISCORD_TOKEN=".Length).Trim()

if ($savedToken -cne $token) {
    Stop-Setup "Kontrola zapisu .env nie powiodla sie. Bot nie zostanie uruchomiony."
}

Write-Host "Sprawdzam token odczytany z nowego pliku .env..." -ForegroundColor Cyan
$null = Test-DiscordBotToken -Token $savedToken

try {
    # Windows PowerShell 5.1 odrzuca pusty tekst, dlatego nadpisujemy sekret
    # pojedynczym bezpiecznym znakiem zamiast zatrzymywać uruchomienie.
    Set-Clipboard -Value " "
}
catch {
    Write-Host "Nie udalo sie wyczyscic schowka; wyczysc go recznie." -ForegroundColor Yellow
}
Remove-Variable clipboardText, token, savedToken, savedTokenLine -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Token jest poprawny, pasuje do aplikacji i zostal zapisany w .env bez BOM." -ForegroundColor Green
Write-Host "Bot: $($bot.username)"
Write-Host ".env jest ignorowany przez Git. Schowek zostal wyczyszczony." -ForegroundColor Green
Write-Host ""
Write-Host "Uruchamiam PubgPLEMULATOR..." -ForegroundColor Cyan

npm start
