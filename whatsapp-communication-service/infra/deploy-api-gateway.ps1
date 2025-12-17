# Deploy API Gateway Stack
# Este script cria o API Gateway HTTP API que fornece HTTPS gratuito na frente do ALB do ECS

param(
    [string]$StackName = "whatsapp-communication-api-gateway",
    [string]$Region = "us-east-1",
    # Novo caminho após mover os arquivos de parâmetros para infra/
    [string]$ParamsFile = "infra/params-api-gateway.json"
)

$ErrorActionPreference = "Stop"

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Deploy API Gateway Stack" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Validar template
Write-Host "Validando template CloudFormation..." -ForegroundColor Yellow
aws cloudformation validate-template `
    --template-body file://infra/ecs/stack-api-gateway.yml `
    --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro na validação do template!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Template válido" -ForegroundColor Green
Write-Host ""

# Verificar se a stack já existe
Write-Host "Verificando se a stack já existe..." -ForegroundColor Yellow
$stackExists = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Stack já existe. Executando UPDATE..." -ForegroundColor Yellow
    $operation = "update-stack"
} else {
    Write-Host "Stack não existe. Executando CREATE..." -ForegroundColor Yellow
    $operation = "create-stack"
}

Write-Host ""

# Deploy da stack
Write-Host "Executando deploy da stack..." -ForegroundColor Yellow
Write-Host "Stack: $StackName" -ForegroundColor Cyan
Write-Host "Região: $Region" -ForegroundColor Cyan
Write-Host ""

aws cloudformation $operation `
    --stack-name $StackName `
    --template-body file://infra/ecs/stack-api-gateway.yml `
    --parameters file://$ParamsFile `
    --region $Region `
    --capabilities CAPABILITY_IAM

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro no deploy da stack!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Aguardando conclusão do deploy..." -ForegroundColor Yellow

if ($operation -eq "create-stack") {
    aws cloudformation wait stack-create-complete `
        --stack-name $StackName `
        --region $Region
} else {
    aws cloudformation wait stack-update-complete `
        --stack-name $StackName `
        --region $Region
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao aguardar conclusão da stack!" -ForegroundColor Red
    Write-Host "Verifique o console da AWS para mais detalhes." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Green
Write-Host "✓ Deploy concluído com sucesso!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""

# Obter outputs da stack
Write-Host "Outputs da stack:" -ForegroundColor Cyan
aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --query "Stacks[0].Outputs" `
    --output table

Write-Host ""
Write-Host "Use o endpoint HTTPS acima para acessar seu serviço!" -ForegroundColor Green
