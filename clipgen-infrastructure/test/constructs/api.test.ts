import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ApiConstruct } from '../../lib/constructs/api';

describe('ApiConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let mockProps: any;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');

    // Create mock dependencies
    const jobTable = new dynamodb.Table(stack, 'JobTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
    });

    const apiKeysTable = new dynamodb.Table(stack, 'ApiKeysTable', {
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
    });

    const queueCounterTable = new dynamodb.Table(stack, 'QueueCounterTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });

    const mediaBucket = new s3.Bucket(stack, 'MediaBucket');

    const processingQueue = new sqs.Queue(stack, 'ProcessingQueue');

    const userPool = new cognito.UserPool(stack, 'UserPool');
    const userPoolClient = new cognito.UserPoolClient(stack, 'UserPoolClient', {
      userPool,
    });

    mockProps = {
      jobTable,
      apiKeysTable,
      queueCounterTable,
      mediaBucket,
      processingQueue,
      userPool,
      userPoolClient,
    };
  });

  test('creates HTTP API with correct configuration', () => {
    new ApiConstruct(stack, 'Api', mockProps);

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'speechface-api',
      ProtocolType: 'HTTP',
      CorsConfiguration: {
        AllowOrigins: ['*'],
        AllowMethods: ['GET', 'POST', 'DELETE'],
        AllowHeaders: ['Content-Type', 'X-API-Key', 'Authorization']
      }
    });
  });

  test('creates all required Lambda functions', () => {
    new ApiConstruct(stack, 'Api', mockProps);

    const template = Template.fromStack(stack);

    // Should create 10 Lambda functions (including mocks)
    const functions = template.findResources('AWS::Lambda::Function');
    const functionNames = Object.values(functions)
      .map((fn: any) => fn.Properties?.FunctionName)
      .filter(name => name?.startsWith('speechface-'));

    expect(functionNames).toContain('speechface-create-job');
    expect(functionNames).toContain('speechface-get-job');
    expect(functionNames).toContain('speechface-list-jobs');
    expect(functionNames).toContain('speechface-create-api-key');
    expect(functionNames).toContain('speechface-list-api-keys');
    expect(functionNames).toContain('speechface-delete-api-key');
    expect(functionNames).toContain('speechface-list-logs');
    expect(functionNames).toContain('speechface-download-video');
    expect(functionNames).toContain('speechface-internal-create-job');
    expect(functionNames).toContain('speechface-internal-get-job');
  });

  test('creates correct API routes', () => {
    new ApiConstruct(stack, 'Api', mockProps);

    const template = Template.fromStack(stack);

    // Check for route configurations
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeKeys = Object.values(routes).map((route: any) => route.Properties?.RouteKey);

    expect(routeKeys).toContain('POST /jobs');
    expect(routeKeys).toContain('GET /jobs');
    expect(routeKeys).toContain('GET /jobs/{jobId}');
    expect(routeKeys).toContain('POST /internal/api-keys');
    expect(routeKeys).toContain('GET /internal/api-keys');
    expect(routeKeys).toContain('DELETE /internal/api-keys/{apiKey}');
    expect(routeKeys).toContain('GET /internal/logs');
    expect(routeKeys).toContain('POST /internal/download/{jobId}');
    expect(routeKeys).toContain('POST /internal/jobs');
    expect(routeKeys).toContain('GET /internal/jobs/{jobId}');
  });

  test('Lambda functions have environment variables set', () => {
    new ApiConstruct(stack, 'Api', mockProps);

    const template = Template.fromStack(stack);

    const functions = template.findResources('AWS::Lambda::Function');
    const speechfaceFunctions = Object.values(functions).filter(
      (fn: any) => fn.Properties?.FunctionName?.startsWith('speechface-')
    );
    
    // At least some functions should have environment variables
    const functionsWithEnvVars = speechfaceFunctions.filter(
      (fn: any) => fn.Properties?.Environment?.Variables
    );

    expect(functionsWithEnvVars.length).toBeGreaterThan(0);
  });

  test('Lambda functions are created with proper configuration', () => {
    new ApiConstruct(stack, 'Api', mockProps);

    const template = Template.fromStack(stack);

    // Check that Lambda functions exist with basic properties
    const functions = template.findResources('AWS::Lambda::Function');
    const speechfaceFunctions = Object.values(functions).filter(
      (fn: any) => fn.Properties?.FunctionName?.startsWith('speechface-')
    );

    expect(speechfaceFunctions.length).toBeGreaterThan(8);
    
    // All functions should have runtime specified
    speechfaceFunctions.forEach((fn: any) => {
      expect(fn.Properties?.Runtime).toBe('nodejs18.x');
    });
  });

  test('integrations are correctly configured', () => {
    new ApiConstruct(stack, 'Api', mockProps);

    const template = Template.fromStack(stack);

    // Should have integrations for each route
    const integrations = template.findResources('AWS::ApiGatewayV2::Integration');
    expect(Object.keys(integrations)).toHaveLength(10); // 10 routes = 10 integrations
  });
});