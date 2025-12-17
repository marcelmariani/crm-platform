# Publishes Docker image to ECR and scales ECS service to DesiredCount=1
param(
    [string]$Region = "us-east-1",
    [string]$AccountId,
    [string]$RepoName = "whatsapp-communication-service",
    [string]$StackName = "whatsapp-communication-ecs",
    [int]$DesiredCount = 1,
    [int]$ContainerPort = 3000,
    [string]$VpcId = "vpc-0f323895693ae6286",
    [string]$PublicSubnets = "subnet-05e017be984834212,subnet-06c5fbaf371845d79",
    [string]$PrivateSubnets = "subnet-05e017be984834212,subnet-06c5fbaf371845d79"
)

if (-not $AccountId) {
    Write-Host "Detecting AWS Account ID..." -ForegroundColor Cyan
    $AccountId = (aws sts get-caller-identity --query Account --output text)
}

$Registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"

Write-Host "Logging into ECR: $Registry" -ForegroundColor Cyan
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Registry
if ($LASTEXITCODE -ne 0) { throw "Failed to login to ECR" }

Write-Host "Building Docker image: $RepoName:latest" -ForegroundColor Cyan
docker build -t $RepoName:latest .
if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }

$FullImage = "$Registry/$RepoName:latest"
Write-Host "Tagging image -> $FullImage" -ForegroundColor Cyan
docker tag "$RepoName:latest" "$FullImage"
if ($LASTEXITCODE -ne 0) { throw "Docker tag failed" }

Write-Host "Pushing image to ECR" -ForegroundColor Cyan
docker push "$FullImage"
if ($LASTEXITCODE -ne 0) { throw "Docker push failed" }

Write-Host "Scaling ECS Service via CloudFormation to DesiredCount=$DesiredCount" -ForegroundColor Cyan
aws cloudformation deploy `
  --stack-name $StackName `
  --region $Region `
  --template-file infra/ecs/stack.yml `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    VpcId=$VpcId `
    PublicSubnets=$PublicSubnets `
    PrivateSubnets=$PrivateSubnets `
    ECRRepoName=$RepoName `
    ContainerPort=$ContainerPort `
    DesiredCount=$DesiredCount
if ($LASTEXITCODE -ne 0) { throw "CloudFormation deploy failed" }

Write-Host "Fetching stack outputs" -ForegroundColor Cyan
$outputs = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs"
Write-Output $outputs

Write-Host "Done." -ForegroundColor Green
