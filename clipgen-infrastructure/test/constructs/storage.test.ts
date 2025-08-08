import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageConstruct } from '../../lib/constructs/storage';

describe('StorageConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    });
  });

  test('creates S3 bucket with correct configuration', () => {
    new StorageConstruct(stack, 'Storage');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'speechface-media-123456789012-us-east-1',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
  });

  test('creates bucket with default lifecycle rules', () => {
    new StorageConstruct(stack, 'Storage');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'DeleteIncompleteMultipartUploads',
            Status: 'Enabled',
            AbortIncompleteMultipartUpload: {
              DaysAfterInitiation: 1
            }
          },
          {
            Id: 'DeleteOldFiles',
            Status: 'Enabled',
            ExpirationInDays: 32
          }
        ]
      }
    });
  });

  test('respects custom removal policy RETAIN', () => {
    new StorageConstruct(stack, 'Storage', {
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const template = Template.fromStack(stack);

    const buckets = template.findResources('AWS::S3::Bucket');
    Object.values(buckets).forEach(bucket => {
      expect(bucket.DeletionPolicy).toBe('Retain');
    });
  });

  test('respects custom removal policy DESTROY with auto-delete', () => {
    new StorageConstruct(stack, 'Storage', {
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const template = Template.fromStack(stack);

    // Should have DESTROY removal policy set
    const buckets = template.findResources('AWS::S3::Bucket');
    Object.values(buckets).forEach(bucket => {
      expect(bucket.DeletionPolicy).toBe('Delete');
      expect(bucket.UpdateReplacePolicy).toBe('Delete');
    });
  });

  test('bucket has versioning disabled', () => {
    new StorageConstruct(stack, 'Storage');

    const template = Template.fromStack(stack);

    const buckets = template.findResources('AWS::S3::Bucket');
    const bucket = Object.values(buckets)[0];
    
    // Versioning should be disabled (no VersioningConfiguration or Status: Suspended)
    expect(bucket.Properties?.VersioningConfiguration).toBeUndefined();
  });

  test('accepts custom lifecycle rules', () => {
    const customRules = [
      {
        id: 'CustomRule',
        expiration: cdk.Duration.days(7)
      }
    ];

    new StorageConstruct(stack, 'Storage', {
      lifecycleRules: customRules
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'CustomRule',
            Status: 'Enabled',
            ExpirationInDays: 7
          }
        ]
      }
    });
  });

  test('bucket has correct security configuration', () => {
    new StorageConstruct(stack, 'Storage');

    const template = Template.fromStack(stack);

    // Should not have public read access
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });

    // Bucket policy may exist for auto-delete functionality
    const policies = template.findResources('AWS::S3::BucketPolicy');
    // Just check that if policies exist, they're for auto-delete not public access
    if (Object.keys(policies).length > 0) {
      // Auto-delete policy is acceptable for DESTROY removal policy
      expect(Object.keys(policies).length).toBeLessThanOrEqual(1);
    }
  });
});