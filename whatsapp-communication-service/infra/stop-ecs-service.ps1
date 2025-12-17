#!/usr/bin/env pwsh
# Script para parar o serviço ECS Fargate sem deletar configurações
# Uso: .\stop-ecs-service.ps1

$CLUSTER = "whatsapp-service-cluster"
$SERVICE = "whatsapp-communication-service"
$REGION = "us-east-1"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Parando ECS Service" -ForegroundColor Yellow
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Cluster: $CLUSTER" -ForegroundColor Green
Write-Host "Service: $SERVICE" -ForegroundColor Green
Write-Host "Region:  $REGION" -ForegroundColor Green
Write-Host ""

# Verificar status atual
Write-Host "Verificando status atual..." -ForegroundColor Yellow
$serviceInfo = aws ecs describe-services `
  --cluster $CLUSTER `
  --services $SERVICE `
  --region $REGION `
  --query 'services[0].[serviceName,runningCount,desiredCount]' `
  --output text

if ($null -eq $serviceInfo) {
    Write-Host "❌ Erro: Serviço não encontrado!" -ForegroundColor Red
    exit 1
}

Write-Host "Status atual:" -ForegroundColor Yellow
Write-Host $serviceInfo
Write-Host ""

# Perguntar confirmação
$confirm = Read-Host "Tem certeza que deseja parar o serviço? (s/n)"
if ($confirm -ne "s" -and $confirm -ne "S") {
    Write-Host "Operação cancelada." -ForegroundColor Yellow
    exit 0
}

# Reduzir para 0
Write-Host "Reduzindo desired count para 0..." -ForegroundColor Yellow
aws ecs update-service `
  --cluster $CLUSTER `
  --service $SERVICE `
  --desired-count 0 `
  --region $REGION | Out-Null

# Aguardar e verificar
Write-Host "Aguardando propagação..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Verificar novo status
$newStatus = aws ecs describe-services `
  --cluster $CLUSTER `
  --services $SERVICE `
  --region $REGION `
  --query 'services[0].[serviceName,runningCount,desiredCount]' `
  --output text

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "✅ SUCESSO!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Novo status:" -ForegroundColor Green
Write-Host $newStatus
Write-Host ""
Write-Host "💡 Observações:" -ForegroundColor Cyan
Write-Host "  • Nenhuma tarefa está rodando agora" -ForegroundColor White
Write-Host "  • Custo reduzido drasticamente (apenas ALB em standby)" -ForegroundColor White
Write-Host "  • Configuração mantida para futuro restart" -ForegroundColor White
Write-Host "  • Para reiniciar: aws ecs update-service --cluster $CLUSTER --service $SERVICE --desired-count 1 --region $REGION" -ForegroundColor White
Write-Host ""
