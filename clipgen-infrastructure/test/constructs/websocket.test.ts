import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { WebSocketConstruct } from '../../lib/constructs/websocket';

describe('WebSocketConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let mockProps: any;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack', {
      env: { region: 'us-east-1' }
    });

    // Create mock dependencies
    const jobTable = new dynamodb.Table(stack, 'JobTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    const connectionTable = new dynamodb.Table(stack, 'ConnectionTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
    });

    const apiKeysTable = new dynamodb.Table(stack, 'ApiKeysTable', {
      partitionKey: { name: 'apiKey', type: dynamodb.AttributeType.STRING },
    });

    const queueCounterTable = new dynamodb.Table(stack, 'QueueCounterTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });

    const userPool = new cognito.UserPool(stack, 'UserPool');
    const userPoolClient = new cognito.UserPoolClient(stack, 'UserPoolClient', {
      userPool,
    });

    mockProps = {
      jobTable,
      connectionTable,
      apiKeysTable,
      queueCounterTable,
      userPool,
      userPoolClient,
    };
  });

  test('creates WebSocket API with correct configuration', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'clipgen-websocket',
      ProtocolType: 'WEBSOCKET'
    });
  });

  test('creates WebSocket stage with auto-deploy', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'prod',
      AutoDeploy: true
    });
  });

  test('creates all WebSocket handler functions', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    const functions = template.findResources('AWS::Lambda::Function');
    const functionNames = Object.values(functions)
      .map((fn: any) => fn.Properties?.FunctionName)
      .filter(name => name?.startsWith('clipgen-'));

    expect(functionNames).toContain('clipgen-ws-connect');
    expect(functionNames).toContain('clipgen-ws-disconnect');
    expect(functionNames).toContain('clipgen-ws-message');
    expect(functionNames).toContain('clipgen-stream-processor');
  });

  test('creates WebSocket routes', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeKeys = Object.values(routes).map((route: any) => route.Properties?.RouteKey);

    expect(routeKeys).toContain('$connect');
    expect(routeKeys).toContain('$disconnect');
    expect(routeKeys).toContain('$default');
  });

  test('creates DynamoDB stream event source mapping', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      StartingPosition: 'LATEST',
      BatchSize: 10,
      MaximumBatchingWindowInSeconds: 5
    });
  });

  test('stream processor has correct configuration', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    const functions = template.findResources('AWS::Lambda::Function');
    const streamProcessor = Object.values(functions).find(
      (fn: any) => fn.Properties?.FunctionName === 'clipgen-stream-processor'
    );

    expect(streamProcessor?.Properties?.Timeout).toBe(30);
    expect(streamProcessor?.Properties?.Runtime).toBe('nodejs18.x');
  });

  test('WebSocket handlers have correct entry points', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    const functions = template.findResources('AWS::Lambda::Function');
    
    // All WebSocket handlers should have code entries
    const wsHandlers = Object.values(functions).filter(
      (fn: any) => fn.Properties?.FunctionName?.startsWith('clipgen-ws-')
    );

    wsHandlers.forEach((handler: any) => {
      expect(handler.Properties?.Code?.S3Key).toBeDefined();
    });
  });

  test('functions have required environment variables', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    const functions = template.findResources('AWS::Lambda::Function');
    
    Object.values(functions).forEach((fn: any) => {
      if (fn.Properties?.FunctionName?.startsWith('clipgen-')) {
        const envVars = fn.Properties.Environment?.Variables;
        expect(envVars).toBeDefined();
        expect(envVars).toHaveProperty('CONNECTION_TABLE_NAME');
        expect(envVars).toHaveProperty('JOB_TABLE_NAME');
        expect(envVars).toHaveProperty('API_KEYS_TABLE_NAME');
        expect(envVars).toHaveProperty('QUEUE_COUNTER_TABLE_NAME');
        expect(envVars).toHaveProperty('WEBSOCKET_API_ENDPOINT');
        expect(envVars).toHaveProperty('USER_POOL_ID');
        expect(envVars).toHaveProperty('COGNITO_CLIENT_ID');
      }
    });
  });

  test('WebSocket endpoint is correctly formatted', () => {
    const construct = new WebSocketConstruct(stack, 'WebSocket', mockProps);

    expect(construct.webSocketEndpoint).toMatch(/^wss:\/\/.+\.execute-api\.us-east-1\.amazonaws\.com\/prod$/);
  });

  test('creates correct IAM roles for DynamoDB access', () => {
    new WebSocketConstruct(stack, 'WebSocket', mockProps);

    const template = Template.fromStack(stack);

    // Should create IAM policies for DynamoDB access
    const policies = template.findResources('AWS::IAM::Policy');
    
    // Check that there are policies for DynamoDB operations
    const dynamoDbPolicies = Object.values(policies).filter((policy: any) => 
      JSON.stringify(policy.Properties?.PolicyDocument).includes('dynamodb:')
    );

    expect(dynamoDbPolicies.length).toBeGreaterThan(0);
  });
});