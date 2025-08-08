import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MessagingConstruct } from '../../lib/constructs/messaging';

describe('MessagingConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
  });

  test('creates both processing queue and dead letter queue', () => {
    new MessagingConstruct(stack, 'Messaging');

    const template = Template.fromStack(stack);

    // Should create 2 SQS queues
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  test('processing queue has correct default configuration', () => {
    new MessagingConstruct(stack, 'Messaging');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'clipgen-processing',
      VisibilityTimeout: 600, // 10 minutes
      ReceiveMessageWaitTimeSeconds: 20,
      MessageRetentionPeriod: 604800 // 7 days in seconds
    });
  });

  test('dead letter queue has correct default configuration', () => {
    new MessagingConstruct(stack, 'Messaging');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'clipgen-processing-dlq',
      MessageRetentionPeriod: 1209600 // 14 days in seconds
    });
  });

  test('processing queue has dead letter queue configured', () => {
    new MessagingConstruct(stack, 'Messaging');

    const template = Template.fromStack(stack);

    // Find the processing queue and check its redrive policy
    const queues = template.findResources('AWS::SQS::Queue');
    const processingQueue = Object.values(queues).find(
      queue => queue.Properties?.QueueName === 'clipgen-processing'
    );

    expect(processingQueue).toBeDefined();
    expect(processingQueue?.Properties?.RedrivePolicy).toBeDefined();
    expect(processingQueue?.Properties?.RedrivePolicy?.maxReceiveCount).toBe(3);
  });

  test('respects custom visibility timeout', () => {
    new MessagingConstruct(stack, 'Messaging', {
      visibilityTimeout: cdk.Duration.minutes(15)
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'clipgen-processing',
      VisibilityTimeout: 900 // 15 minutes
    });
  });

  test('respects custom max receive count', () => {
    new MessagingConstruct(stack, 'Messaging', {
      maxReceiveCount: 5
    });

    const template = Template.fromStack(stack);

    const queues = template.findResources('AWS::SQS::Queue');
    const processingQueue = Object.values(queues).find(
      queue => queue.Properties?.QueueName === 'clipgen-processing'
    );

    expect(processingQueue?.Properties?.RedrivePolicy?.maxReceiveCount).toBe(5);
  });

  test('respects custom retention period', () => {
    new MessagingConstruct(stack, 'Messaging', {
      retentionPeriod: cdk.Duration.days(10)
    });

    const template = Template.fromStack(stack);

    // Both queues should use the custom retention period
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'clipgen-processing',
      MessageRetentionPeriod: 864000 // 10 days in seconds
    });

    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'clipgen-processing-dlq',
      MessageRetentionPeriod: 864000 // 10 days in seconds
    });
  });

  test('dead letter queue is referenced correctly in processing queue', () => {
    new MessagingConstruct(stack, 'Messaging');

    const template = Template.fromStack(stack);

    // Processing queue should reference the DLQ
    const queues = template.findResources('AWS::SQS::Queue');
    const processingQueue = Object.values(queues).find(
      queue => queue.Properties?.QueueName === 'clipgen-processing'
    );

    expect(processingQueue?.Properties?.RedrivePolicy?.deadLetterTargetArn).toBeDefined();
  });
});