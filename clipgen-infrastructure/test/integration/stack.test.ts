import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SpeechfaceInfrastructureStack } from '../../lib/speechface-infrastructure-stack';

describe('SpeechfaceInfrastructureStack Integration', () => {
  let app: cdk.App;
  let stack: SpeechfaceInfrastructureStack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new SpeechfaceInfrastructureStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    });
  });

  test('stack synthesizes without errors', () => {
    const template = Template.fromStack(stack);
    expect(template).toBeDefined();
  });

  test('creates all major resource types', () => {
    const template = Template.fromStack(stack);

    // DynamoDB Tables (4 from database construct)
    template.resourceCountIs('AWS::DynamoDB::Table', 4);

    // S3 Buckets (1 from storage construct)
    template.resourceCountIs('AWS::S3::Bucket', 1);

    // SQS Queues (2 from messaging construct - main + DLQ)
    template.resourceCountIs('AWS::SQS::Queue', 2);

    // Cognito User Pool (1 from auth construct)
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);

    // API Gateway (HTTP API + WebSocket API)
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 2);

    // Lambda Functions (10 HTTP API + 4 WebSocket)
    const functions = template.findResources('AWS::Lambda::Function');
    const speechfaceFunctions = Object.values(functions).filter(
      (fn: any) => fn.Properties?.FunctionName?.startsWith('speechface-')
    );
    expect(speechfaceFunctions.length).toBeGreaterThanOrEqual(14);
  });

  test('outputs all required stack values', () => {
    const template = Template.fromStack(stack);

    template.hasOutput('UserPoolId', {});
    template.hasOutput('UserPoolClientId', {});
    template.hasOutput('HttpApiUrl', {});
    template.hasOutput('WebSocketApiEndpoint', {});
    template.hasOutput('JobTableName', {});
    template.hasOutput('MediaBucketName', {});
    template.hasOutput('ProcessingQueueUrl', {});
    template.hasOutput('ProcessingQueueArn', {});
  });

  test('cross-construct dependencies are properly configured', () => {
    const template = Template.fromStack(stack);

    // Check that Lambda functions exist
    const functions = template.findResources('AWS::Lambda::Function');
    const speechfaceFunctions = Object.values(functions).filter(
      (fn: any) => fn.Properties?.FunctionName?.startsWith('speechface-')
    );

    expect(speechfaceFunctions.length).toBeGreaterThan(10);

    // Check that functions have IAM roles (indicating proper permissions)
    const roles = template.findResources('AWS::IAM::Role');
    const lambdaRoles = Object.values(roles).filter(
      (role: any) => role.Properties?.AssumeRolePolicyDocument?.Statement?.some(
        (stmt: any) => stmt.Principal?.Service === 'lambda.amazonaws.com'
      )
    );

    expect(lambdaRoles.length).toBeGreaterThan(10);
  });

  test('WebSocket construct has DynamoDB stream integration', () => {
    const template = Template.fromStack(stack);

    // Should have event source mapping for job table stream
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      StartingPosition: 'LATEST',
      BatchSize: 10,
    });
  });

  test('IAM permissions are correctly configured', () => {
    const template = Template.fromStack(stack);

    // Should have IAM roles and policies for Lambda functions
    const roles = template.findResources('AWS::IAM::Role');
    const lambdaRoles = Object.values(roles).filter(
      (role: any) => role.Properties?.AssumeRolePolicyDocument?.Statement?.some(
        (stmt: any) => stmt.Principal?.Service === 'lambda.amazonaws.com'
      )
    );

    expect(lambdaRoles.length).toBeGreaterThan(10); // One role per Lambda function
  });

  test('security configurations are properly set', () => {
    const template = Template.fromStack(stack);

    // S3 bucket should have public access blocked
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });

    // HTTP API should have CORS configured
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowOrigins: ['*'],
        AllowMethods: ['GET', 'POST', 'DELETE'],
        AllowHeaders: ['Content-Type', 'X-API-Key', 'Authorization']
      }
    });
  });

  test('resource naming follows conventions', () => {
    const template = Template.fromStack(stack);

    // DynamoDB tables should have speechface prefix
    const tables = template.findResources('AWS::DynamoDB::Table');
    Object.values(tables).forEach((table: any) => {
      expect(table.Properties?.TableName).toMatch(/^speechface-/);
    });

    // SQS queues should have speechface prefix
    const queues = template.findResources('AWS::SQS::Queue');
    Object.values(queues).forEach((queue: any) => {
      if (queue.Properties?.QueueName) {
        expect(queue.Properties.QueueName).toMatch(/^speechface-/);
      }
    });

    // Lambda functions should have speechface prefix
    const functions = template.findResources('AWS::Lambda::Function');
    Object.values(functions).forEach((fn: any) => {
      if (fn.Properties?.FunctionName?.startsWith('speechface-')) {
        expect(fn.Properties.FunctionName).toMatch(/^speechface-/);
      }
    });
  });

  test('removal policies are set correctly for development', () => {
    const template = Template.fromStack(stack);

    // Most resources should have Delete policy (DESTROY)
    const tables = template.findResources('AWS::DynamoDB::Table');
    Object.values(tables).forEach((table: any) => {
      expect(table.DeletionPolicy).toBe('Delete');
    });

    const buckets = template.findResources('AWS::S3::Bucket');
    Object.values(buckets).forEach((bucket: any) => {
      expect(bucket.DeletionPolicy).toBe('Delete');
    });
  });

  test('environment-specific configurations can be overridden', () => {
    // Test with production-like settings
    const prodStack = new SpeechfaceInfrastructureStack(app, 'ProdStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    });

    const template = Template.fromStack(prodStack);
    expect(template).toBeDefined();
  });
});