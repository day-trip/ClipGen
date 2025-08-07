import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {Construct} from 'constructs';

export interface StorageProps {
    removalPolicy?: cdk.RemovalPolicy;
    lifecycleRules?: s3.LifecycleRule[];
}

export class StorageConstruct extends Construct {
    public readonly mediaBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: StorageProps = {}) {
        super(scope, id);

        const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

        this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
            bucketName: 'clipgen-media',
            versioned: false,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy,
            autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
            lifecycleRules: props.lifecycleRules ?? [{
                id: 'DeleteIncompleteMultipartUploads', abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
            }, {
                id: 'DeleteOldFiles', expiration: cdk.Duration.days(32),
            },],
        });
    }
}