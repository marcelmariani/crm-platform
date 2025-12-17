#!/usr/bin/env pwsh
# Script para deletar completamente a stack CloudFormation do ECS
# Uso: .\delete-ecs-stack.ps1

$CLUSTER = "whatsapp-communication-cluster"
$STACK_NAME = "whatsapp-communication-ecs"
$REGION = "us-east-1"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Deletando Stack CloudFormation" -ForegroundColor Yellow
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Stack:  $STACK_NAME" -ForegroundColor Green
Write-Host "Region: $REGION" -ForegroundColor Green
Write-Host ""

# Verificar se a stack existe
Write-Host "Verificando se a stack existe..." -ForegroundColor Yellow
$stackExists = aws cloudformation describe-stacks `
  --stack-name $STACK_NAME `
  --region $REGION `
  --query 'Stacks[0].StackStatus' `
  --output text 2>$null

if ($null -eq $stackExists -or $stackExists -eq "None") {
    Write-Host "❌ Stack não encontrada!" -ForegroundColor Red
    exit 1
}

Write-Host "Stack encontrada: $stackExists" -ForegroundColor Yellow
Write-Host ""

# Perguntar confirmação (2 vezes por segurança)
Write-Host "⚠️  ATENÇÃO: Esta operação é IRREVERSÍVEL!" -ForegroundColor Red
Write-Host "Serão deletados:" -ForegroundColor Red
Write-Host "  • ECS Cluster" -ForegroundColor White
Write-Host "  • ECS Service" -ForegroundColor White
Write-Host "  • Task Definition" -ForegroundColor White
Write-Host "  • Load Balancer" -ForegroundColor White
Write-Host "  • Target Group" -ForegroundColor White
Write-Host "  • Security Groups" -ForegroundColor White
Write-Host "  • IAM Roles" -ForegroundColor White
Write-Host ""

$confirm1 = Read-Host "Digite 'DELETAR' para confirmar"
if ($confirm1 -ne "DELETAR") {
    Write-Host "Operação cancelada." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Segunda confirmação (por segurança)" -ForegroundColor Yellow
$confirm2 = Read-Host "Digite 'SIM' para confirmar irreversivelmente"
if ($confirm2 -ne "SIM") {
    Write-Host "Operação cancelada." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Deletando stack..." -ForegroundColor Yellow
aws cloudformation delete-stack `
  --stack-name $STACK_NAME `
  --region $REGION

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao deletar stack!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Stack marcada para deleção. Aguardando conclusão..." -ForegroundColor Yellow
Write-Host "Isso pode levar 5-10 minutos..." -ForegroundColor Cyan

# Aguardar conclusão
$maxAttempts = 120  # 10 minutos (5 segundos * 120)
$attempt = 0

while ($attempt -lt $maxAttempts) {
    $attempt++
    Start-Sleep -Seconds 5
    
    $status = aws cloudformation describe-stacks `
      --stack-name $STACK_NAME `
      --region $REGION `
      --query 'Stacks[0].StackStatus' `
      --output text 2>$null
    
    if ($null -eq $status -or $status -eq "None") {
        # Stack foi deletada
        Write-Host ""
        Write-Host "=====================================" -ForegroundColor Cyan
        Write-Host "✅ STACK DELETADA COM SUCESSO!" -ForegroundColor Green
        Write-Host "=====================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "💰 Economia:" -ForegroundColor Green
        Write-Host "  • ECS Fargate: -\$30-50/mês" -ForegroundColor White
        Write-Host "  • Load Balancer: -\$16/mês" -ForegroundColor White
        Write-Host "  • Total: -\$46-66/mês economizados!" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Para reprovisionar quando quiser:" -ForegroundColor Cyan
        Write-Host "  1. Use GitHub Actions (recomendado)" -ForegroundColor White
        Write-Host "  2. Ou execute: .\infra\publish-and-scale.ps1" -ForegroundColor White
        Write-Host ""
        exit 0
    }
    
    if ($status -like "*DELETE_FAILED*") {
        Write-Host "❌ Erro ao deletar stack: $status" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Status: $status | Tentativa: $attempt/120" -ForegroundColor Yellow -NoNewline
    Write-Host "`r" -NoNewline
}

Write-Host ""
Write-Host "⚠️  Timeout aguardando deleção. Verifique o status no console AWS." -ForegroundColor Yellow
Write-Host "Link: https://us-east-1.console.aws.amazon.com/cloudformation/home" -ForegroundColor Cyan
