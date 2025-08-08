import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DatabaseConstruct } from '../../lib/constructs/database';

describe('DatabaseConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
  });

  test('creates all required DynamoDB tables', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    // Should create 4 DynamoDB tables
    template.resourceCountIs('AWS::DynamoDB::Table', 4);
  });

  test('job table has correct configuration', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'speechface-jobs',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'jobId', KeyType: 'RANGE' }
      ],
      BillingMode: 'PAY_PER_REQUEST',
      StreamSpecification: {
        StreamViewType: 'NEW_AND_OLD_IMAGES'
      }
    });
  });

  test('job table has required GSIs', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    // Check for jobId-index GSI
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: [
        {
          IndexName: 'jobId-index',
          KeySchema: [
            { AttributeName: 'jobId', KeyType: 'HASH' }
          ]
        },
        {
          IndexName: 'userId-jobNumber-index',
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' },
            { AttributeName: 'jobNumber', KeyType: 'RANGE' }
          ]
        },
        {
          IndexName: 'status-jobNumber-index',
          KeySchema: [
            { AttributeName: 'status', KeyType: 'HASH' },
            { AttributeName: 'jobNumber', KeyType: 'RANGE' }
          ]
        }
      ]
    });
  });

  test('connection table has correct configuration', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'speechface-connections',
      KeySchema: [
        { AttributeName: 'connectionId', KeyType: 'HASH' }
      ],
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true
      }
    });
  });

  test('connection table has required GSIs', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'speechface-connections',
      GlobalSecondaryIndexes: [
        {
          IndexName: 'userId-index',
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' }
          ]
        },
        {
          IndexName: 'jobId-index',
          KeySchema: [
            { AttributeName: 'jobId', KeyType: 'HASH' }
          ]
        }
      ]
    });
  });

  test('api keys table has correct configuration', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'speechface-api-keys',
      KeySchema: [
        { AttributeName: 'apiKey', KeyType: 'HASH' }
      ],
      BillingMode: 'PAY_PER_REQUEST',
      GlobalSecondaryIndexes: [
        {
          IndexName: 'userId-index',
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' }
          ]
        }
      ]
    });
  });

  test('queue counter table has correct configuration', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'speechface-queue-counter',
      KeySchema: [
        { AttributeName: 'id', KeyType: 'HASH' }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    });
  });

  test('respects custom removal policy', () => {
    new DatabaseConstruct(stack, 'Database', {
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const template = Template.fromStack(stack);

    // All tables should have RETAIN policy
    const tables = template.findResources('AWS::DynamoDB::Table');
    Object.values(tables).forEach(table => {
      expect(table.DeletionPolicy).toBe('Retain');
    });
  });

  test('uses default DESTROY removal policy', () => {
    new DatabaseConstruct(stack, 'Database');

    const template = Template.fromStack(stack);

    // All tables should have DELETE policy (default)
    const tables = template.findResources('AWS::DynamoDB::Table');
    Object.values(tables).forEach(table => {
      expect(table.DeletionPolicy).toBe('Delete');
    });
  });
});