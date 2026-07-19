#!/bin/bash
# Deploy Infrastructure Script
# Usage: ./deploy-infrastructure.sh <environment> [region]

set -e

ENVIRONMENT=${1:-staging}
REGION=${2:-us-east-1}
STACK_PREFIX="baton"

echo "========================================"
echo "Deploying Baton Infrastructure"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "========================================"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    echo "Error: Environment must be development, staging, or production"
    exit 1
fi

# Deploy DynamoDB tables
echo ""
echo ">>> Deploying DynamoDB tables..."
aws cloudformation deploy \
    --template-file dynamodb.yml \
    --stack-name "${STACK_PREFIX}-dynamodb-${ENVIRONMENT}" \
    --parameter-overrides Environment=$ENVIRONMENT \
    --capabilities CAPABILITY_IAM \
    --region $REGION \
    --no-fail-on-empty-changeset

echo "DynamoDB stack deployed successfully"

# Deploy SQS queues
echo ""
echo ">>> Deploying SQS queues..."
aws cloudformation deploy \
    --template-file sqs.yml \
    --stack-name "${STACK_PREFIX}-sqs-${ENVIRONMENT}" \
    --parameter-overrides Environment=$ENVIRONMENT \
    --capabilities CAPABILITY_IAM \
    --region $REGION \
    --no-fail-on-empty-changeset

echo "SQS stack deployed successfully"

# Deploy Secrets Manager
echo ""
echo ">>> Deploying Secrets Manager..."
aws cloudformation deploy \
    --template-file secrets.yml \
    --stack-name "${STACK_PREFIX}-secrets-${ENVIRONMENT}" \
    --parameter-overrides Environment=$ENVIRONMENT \
    --capabilities CAPABILITY_IAM \
    --region $REGION \
    --no-fail-on-empty-changeset

echo "Secrets stack deployed successfully"

# Get Secrets ARN for IAM stack
SECRETS_ARN=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_PREFIX}-secrets-${ENVIRONMENT}" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiCredentialsSecretArn'].OutputValue" \
    --output text \
    --region $REGION)

# Deploy IAM roles
echo ""
echo ">>> Deploying IAM roles..."
aws cloudformation deploy \
    --template-file iam.yml \
    --stack-name "${STACK_PREFIX}-iam-${ENVIRONMENT}" \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        DynamoDBStackName="${STACK_PREFIX}-dynamodb-${ENVIRONMENT}" \
        SQSStackName="${STACK_PREFIX}-sqs-${ENVIRONMENT}" \
        SecretsManagerSecretArn=$SECRETS_ARN \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION \
    --no-fail-on-empty-changeset

echo "IAM stack deployed successfully"

echo ""
echo "========================================"
echo "Infrastructure deployment complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Update the secrets in AWS Secrets Manager with actual values"
echo "2. Create ECR repositories:"
echo "   aws ecr create-repository --repository-name baton-api --region $REGION"
echo "   aws ecr create-repository --repository-name baton-front --region $REGION"
echo "3. Build and push Docker images"
echo "4. Deploy to EKS via ArgoCD or Helm"
echo ""

# Show important outputs
echo "Important stack outputs:"
echo ""
echo "Secrets ARN (update with actual credentials):"
echo $SECRETS_ARN
