import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import {Construct} from 'constructs';

export interface DatabaseProps {
    removalPolicy?: cdk.RemovalPolicy;
}

export class DatabaseConstruct extends Construct {
    public readonly jobTable: dynamodb.Table;
    public readonly connectionTable: dynamodb.Table;
    public readonly apiKeysTable: dynamodb.Table;
    public readonly queueCounterTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props: DatabaseProps = {}) {
        super(scope, id);

        const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

        // Job tracking table
        this.jobTable = new dynamodb.Table(this, 'JobTable', {
            tableName: 'clipgen-jobs',
            partitionKey: {name: 'userId', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'jobId', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });

        // Job table GSIs
        this.jobTable.addGlobalSecondaryIndex({
            indexName: 'jobId-index', partitionKey: {name: 'jobId', type: dynamodb.AttributeType.STRING},
        });

        this.jobTable.addGlobalSecondaryIndex({
            indexName: 'userId-jobNumber-index',
            partitionKey: {name: 'userId', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'jobNumber', type: dynamodb.AttributeType.NUMBER},
        });

        this.jobTable.addGlobalSecondaryIndex({
            indexName: 'status-jobNumber-index',
            partitionKey: {name: 'status', type: dynamodb.AttributeType.STRING},
            sortKey: {name: 'jobNumber', type: dynamodb.AttributeType.NUMBER},
        });

        // WebSocket connections table
        this.connectionTable = new dynamodb.Table(this, 'ConnectionTable', {
            tableName: 'clipgen-connections',
            partitionKey: {name: 'connectionId', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'ttl',
            removalPolicy,
        });

        // Connection table GSIs
        this.connectionTable.addGlobalSecondaryIndex({
            indexName: 'userId-index', partitionKey: {name: 'userId', type: dynamodb.AttributeType.STRING},
        });

        this.connectionTable.addGlobalSecondaryIndex({
            indexName: 'jobId-index', partitionKey: {name: 'jobId', type: dynamodb.AttributeType.STRING},
        });

        // API keys table
        this.apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
            tableName: 'clipgen-api-keys',
            partitionKey: {name: 'apiKey', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        // API keys GSI for querying by userId
        this.apiKeysTable.addGlobalSecondaryIndex({
            indexName: 'userId-index', partitionKey: {name: 'userId', type: dynamodb.AttributeType.STRING},
        });

        // Queue counter table for "take a number" system
        this.queueCounterTable = new dynamodb.Table(this, 'QueueCounterTable', {
            tableName: 'clipgen-queue-counter',
            partitionKey: {name: 'id', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
    }
}