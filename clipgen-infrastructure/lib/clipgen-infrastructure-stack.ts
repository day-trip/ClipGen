import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {DatabaseConstruct} from './constructs/database';
import {StorageConstruct} from './constructs/storage';
import {MessagingConstruct} from './constructs/messaging';
import {ApiConstruct} from './constructs/api';
import {AuthConstruct} from './constructs/auth';

export class ClipgenInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Core infrastructure components
    const database = new DatabaseConstruct(this, 'Database', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    });

    const storage = new StorageConstruct(this, 'Storage', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    });

    const messaging = new MessagingConstruct(this, 'Messaging', {
      visibilityTimeout: cdk.Duration.minutes(10), // Long enough for video processing
      maxReceiveCount: 3, retentionPeriod: cdk.Duration.days(7),
    });

    // Authentication (Cognito)
    const auth = new AuthConstruct(this, 'Auth', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    });

    // todo: ws

    // HTTP API (depends on all components)
    const api = new ApiConstruct(this, 'Api', {
      jobTable: database.jobTable,
      apiKeysTable: database.apiKeysTable,
      queueCounterTable: database.queueCounterTable,
      mediaBucket: storage.mediaBucket,
      processingQueue: messaging.processingQueue,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
    });


    // Output the values you'll need
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: auth.userPool.userPoolId, exportName: 'ClipgenUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId, exportName: 'ClipgenUserPoolClientId',
    });

    // Stack outputs for external reference
    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: api.httpApi.url!,
      exportName: 'ClipgenHttpApiUrl',
      description: 'HTTP API endpoint for job management',
    });

    // todo: ws outputs

    new cdk.CfnOutput(this, 'JobTableName', {
      value: database.jobTable.tableName,
      exportName: 'ClipgenJobTableName',
      description: 'DynamoDB table for job tracking',
    });

    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: storage.mediaBucket.bucketName,
      exportName: 'ClipgenMediaBucketName',
      description: 'S3 bucket for audio/video files',
    });

    new cdk.CfnOutput(this, 'ProcessingQueueUrl', {
      value: messaging.processingQueue.queueUrl,
      exportName: 'ClipgenProcessingQueueUrl',
      description: 'SQS queue for processing jobs',
    });

    new cdk.CfnOutput(this, 'ProcessingQueueArn', {
      value: messaging.processingQueue.queueArn,
      exportName: 'ClipgenProcessingQueueArn',
      description: 'SQS queue ARN for Kubernetes KEDA scaling',
    });
  }
}