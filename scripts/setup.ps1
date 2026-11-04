# Checks the tools needed to work on hypear-baseline (Windows) and offers to
# install the missing ones with winget. Every install asks for confirmation
# first, and winget shows its own prompts (package agreements, UAC).
# Nothing is downloaded or changed without that confirmation.
#
#   powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts/setup.ps1 [-CheckOnly]
#
# -CheckOnly reports what is missing and the command to install it, without
# installing anything. It is also used automatically when there is no
# keyboard to answer the prompts (for example, when run by another program).
#
# To add a tool, add a line to $tools.
#   Name    - shown in the output
#   Id      - winget package id (find one with: winget search <name>)
#   Command - a command the tool provides, used to check if it's already installed
#   Purpose - why this repository needs it

param([switch]$CheckOnly)

$ErrorActionPreference = "Stop"
$MinNodeMajor = 20

$tools = @(
    @{ Name = "Git";        Id = "Git.Git";           Command = "git";      Purpose = "version control; Git Bash runs the shell syntax check" },
    @{ Name = "Node.js";    Id = "OpenJS.NodeJS.LTS"; Command = "node";     Purpose = "runs scripts/*.mjs and the tests" },
    @{ Name = "Make";       Id = "ezwinports.make";   Command = "make";     Purpose = "runs the Makefile targets" },
    @{ Name = "GitHub CLI"; Id = "GitHub.cli";        Command = "gh";       Purpose = "creates GitHub releases (scripts/release.mjs)" },
    @{ Name = "Gitleaks";   Id = "Gitleaks.Gitleaks"; Command = "gitleaks"; Purpose = "secret scanning in the deterministic review" }
)

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Confirm-Install($tool) {
    $answer = Read-Host "Install $($tool.Name) with 'winget install --id $($tool.Id) --exact'? [y/N]"
    return $answer -match '^(y|yes)$'
}

if (-not $CheckOnly -and [Console]::IsInputRedirected) {
    Write-Host "No keyboard input available; checking only." -ForegroundColor Yellow
    $CheckOnly = $true
}
if (-not $CheckOnly -and -not (Test-Command winget)) {
    Write-Host "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again." -ForegroundColor Red
    exit 1
}

$problems = 0
$installed = 0
Write-Host "`n== Tools ==" -ForegroundColor Cyan
foreach ($tool in $tools) {
    if (Test-Command $tool.Command) {
        Write-Host "[ok]      $($tool.Name)"
        continue
    }
    Write-Host "[missing] $($tool.Name): $($tool.Purpose)" -ForegroundColor Yellow
    if ($CheckOnly -or -not (Confirm-Install $tool)) {
        Write-Host "          Install with: winget install --id $($tool.Id) --exact"
        $problems++
        continue
    }
    winget install --id $tool.Id --exact
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install $($tool.Name) (winget exit code $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
    $installed++
}

if ($installed -gt 0) {
    # Installers update PATH for new terminals only; checking now would report
    # the new tools as missing.
    Write-Host "`nInstalled $installed tool(s). Open a new terminal and run this again to finish the checks." -ForegroundColor Green
    exit 0
}

Write-Host "`n== Configuration ==" -ForegroundColor Cyan
if (Test-Command node) {
    $major = [int]((node --version).TrimStart("v").Split(".")[0])
    if ($major -lt $MinNodeMajor) {
        Write-Host "[fail]    Node.js $major is older than $MinNodeMajor. Run: winget upgrade --id OpenJS.NodeJS.LTS --exact" -ForegroundColor Red
        $problems++
    } else {
        Write-Host "[ok]      Node.js $major"
    }
}
if (Test-Command gh) {
    gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "[ok]      GitHub CLI signed in" }
    else { Write-Host "[action]  GitHub CLI is not signed in. Run: gh auth login (needed only for releases)" -ForegroundColor Yellow }
}
if (Test-Command git) {
    $email = git config --global user.email
    if ($email -like "*@users.noreply.github.com") { Write-Host "[ok]      git commit email is a GitHub noreply address" }
    else { Write-Host "[action]  git user.email is '$email'. This repository is public; use your GitHub noreply address." -ForegroundColor Yellow }
}

if ($problems -gt 0) {
    Write-Host "`n$problems problem(s); see the messages above." -ForegroundColor Red
    exit 1
}
Write-Host "`nAll set." -ForegroundColor Green
