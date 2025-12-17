<#!
.SYNOPSIS
  Remove todos os GitHub Actions workflow runs de um repositório.

.DESCRIPTION
  Faz paginação na API REST do GitHub e deleta cada workflow run individualmente.
  Requer um Personal Access Token (PAT) ou variável de ambiente GITHUB_TOKEN com escopo 'repo'.

.PARAMETER Owner
  Organização ou usuário dono do repositório (ex: SmartIA-Systems).

.PARAMETER Repo
  Nome do repositório (ex: whatsapp-communication-service).

.PARAMETER Token
  Token pessoal (se omitido, tenta $Env:GITHUB_TOKEN).

.PARAMETER MaxPages
  Limite de páginas (100 runs por página). Use para lote parcial.

.PARAMETER Concurrency
  Número de deleções em paralelo (default 1). Valores maiores podem bater em rate limit.

.PARAMETER DelayBetweenDeletesMs
  Delay (ms) entre deleções para aliviar rate limiting (default 0).

.PARAMETER WhatIf
  Mostra o que seria deletado sem executar DELETE.

.PARAMETER Confirm
  Suprime prompt de confirmação se passado como $false.

.EXAMPLE
  ./cleanup-actions-runs.ps1 -Owner SmartIA-Systems -Repo whatsapp-communication-service -Token "ghp_xxx" -Confirm:$false

.EXAMPLE
  $Env:GITHUB_TOKEN = "ghp_xxx"; ./cleanup-actions-runs.ps1 -Owner SmartIA-Systems -Repo whatsapp-communication-service -Concurrency 3 -DelayBetweenDeletesMs 200 -Confirm:$false

.NOTES
  Não há endpoint para bulk delete; cada run é removido individualmente.
#>
[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param(
  [Parameter(Mandatory=$true)][string]$Owner,
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Token = $Env:GITHUB_TOKEN,
  [int]$MaxPages = 100,
  [int]$Concurrency = 1,
  [int]$DelayBetweenDeletesMs = 0,
  [switch]$WhatIf,
  [bool]$Confirm = $true
)

if (-not $Token) {
  Write-Error "Token não fornecido e variável de ambiente GITHUB_TOKEN ausente."; exit 1
}

$baseUrl = "https://api.github.com/repos/$Owner/$Repo/actions/runs"
$headers = @{ Authorization = "Bearer $Token"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }

function Get-AllWorkflowRuns {
  param([int]$MaxPages)
  $all = @()
  for ($page = 1; $page -le $MaxPages; $page++) {
    $url = "$baseUrl?per_page=100&page=$page"
    try {
      $resp = Invoke-RestMethod -Headers $headers -Uri $url -Method GET -ErrorAction Stop
    } catch {
      Write-Warning "Falha ao buscar página $page: $($_.Exception.Message)"; break
    }
    if (-not $resp.workflow_runs -or $resp.workflow_runs.Count -eq 0) { break }
    $all += $resp.workflow_runs
    if ($resp.workflow_runs.Count -lt 100) { break }
  }
  return $all
}

function Remove-WorkflowRun {
  param([long]$RunId)
  $deleteUrl = "$baseUrl/$RunId"
  if ($PSCmdlet.ShouldProcess("RunId $RunId", "DELETE")) {
    try {
      Invoke-RestMethod -Headers $headers -Uri $deleteUrl -Method DELETE -ErrorAction Stop | Out-Null
      return $true
    } catch {
      Write-Warning "Erro deletando $RunId: $($_.Exception.Message)"
      return $false
    }
  } else {
    return $false
  }
}

Write-Host "Coletando workflow runs do repositório $Owner/$Repo ..." -ForegroundColor Cyan
$runs = Get-AllWorkflowRuns -MaxPages $MaxPages
if (-not $runs -or $runs.Count -eq 0) {
  Write-Host "Nenhum run encontrado." -ForegroundColor Yellow
  exit 0
}

Write-Host "Total de runs encontrados: $($runs.Count)" -ForegroundColor Cyan

if ($WhatIf) {
  $runs | Select-Object id, status, head_branch, run_number | Format-Table
  Write-Host "WhatIf: Nenhuma deleção realizada." -ForegroundColor Yellow
  exit 0
}

if ($Confirm) {
  $answer = Read-Host "Confirmar deleção de $($runs.Count) runs? (y/N)"
  if ($answer.ToLower() -ne 'y') { Write-Host "Abortado."; exit 0 }
}

# Controle de paralelismo simples
if ($Concurrency -lt 1) { $Concurrency = 1 }

$queue = [System.Collections.Concurrent.ConcurrentQueue[long]]::new()
foreach ($r in $runs) { $queue.Enqueue([long]$r.id) }

$results = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
$tasks = @()
$scriptBlock = {
  param($q, $res, $delay)
  while ($true) {
    $ok = $q.TryDequeue([ref]$next)
    if (-not $ok) { break }
    $success = Remove-WorkflowRun -RunId $next
    $res.Add([pscustomobject]@{ Id=$next; Deleted=$success })
    if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
  }
}

for ($i=1; $i -le $Concurrency; $i++) {
  $tasks += [System.Threading.Tasks.Task]::Run({ & $scriptBlock $queue $results $DelayBetweenDeletesMs })
}

[System.Threading.Tasks.Task]::WaitAll($tasks)

$deleted = ($results | Where-Object Deleted).Count
$failed  = ($results | Where-Object { -not $_.Deleted }).Count
Write-Host "Concluído. Deletados: $deleted | Falhas: $failed" -ForegroundColor Green

# Recontagem
$remaining = (Get-AllWorkflowRuns -MaxPages 1).Count
Write-Host "Runs restantes (nova consulta): $remaining" -ForegroundColor Cyan

if ($failed -gt 0) {
  Write-Host "Alguns runs falharam na deleção. Execute novamente se necessário." -ForegroundColor Yellow
}
