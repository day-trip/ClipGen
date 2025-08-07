import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import {Construct} from 'constructs';
import {LogLevel, NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";

export interface ApiProps {
    jobTable: dynamodb.Table;
    apiKeysTable: dynamodb.Table;
    queueCounterTable: dynamodb.Table;
    mediaBucket: s3.Bucket;
    processingQueue: sqs.Queue;
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
}

export class ApiConstruct extends Construct {
    public readonly httpApi: apigatewayv2.HttpApi;
    public readonly createJobFunction: lambda.Function;
    public readonly getJobFunction: lambda.Function;
    public readonly listJobsFunction: lambda.Function;
    public readonly createApiKeyFunction: lambda.Function;
    public readonly listApiKeysFunction: lambda.Function;
    public readonly deleteApiKeyFunction: lambda.Function;
    public readonly listLogsFunction: lambda.Function;
    public readonly downloadVideoFunction: lambda.Function;
    public readonly internalCreateJobFunction: lambda.Function;
    public readonly internalGetJobFunction: lambda.Function;

    constructor(scope: Construct, id: string, props: ApiProps) {
        super(scope, id);

        // HTTP API
        this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
            apiName: 'clipgen-api', description: 'Clipgen video generation API', corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST, apigatewayv2.CorsHttpMethod.DELETE],
                allowHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
            },
        });

        // Lambda functions
        const commonEnv = {
            JOB_TABLE_NAME: props.jobTable.tableName,
            API_KEYS_TABLE_NAME: props.apiKeysTable.tableName,
            QUEUE_COUNTER_TABLE_NAME: props.queueCounterTable.tableName,
            MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
            PROCESSING_QUEUE_URL: props.processingQueue.queueUrl,
            USER_POOL_ID: props.userPool.userPoolId,
            COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        };

        this.createJobFunction = this.createLambdaFunction('CreateJob', 'createJob.handler', commonEnv);
        this.getJobFunction = this.createLambdaFunction('GetJob', 'getJob.handler', commonEnv);
        this.listJobsFunction = this.createLambdaFunction('ListJobs', 'listJobs.handler', commonEnv);
        this.createApiKeyFunction = this.createLambdaFunction('CreateApiKey', 'internal/createApiKey.handler', commonEnv);
        this.listApiKeysFunction = this.createLambdaFunction('ListApiKeys', 'internal/listApiKeys.handler', commonEnv);
        this.deleteApiKeyFunction = this.createLambdaFunction('DeleteApiKey', 'internal/deleteApiKey.handler', commonEnv);
        this.listLogsFunction = this.createLambdaFunction('ListLogs', 'internal/listLogs.handler', commonEnv);
        this.downloadVideoFunction = this.createLambdaFunction('DownloadVideo', 'internal/downloadVideo.handler', commonEnv);
        this.internalCreateJobFunction = this.createLambdaFunction('InternalCreateJob', 'internal/createJob.handler', commonEnv);
        this.internalGetJobFunction = this.createLambdaFunction('InternalGetJob', 'internal/getJob.handler', commonEnv);

        // Grant permissions
        props.jobTable.grantReadWriteData(this.createJobFunction);
        props.jobTable.grantReadData(this.getJobFunction);
        props.jobTable.grantReadData(this.listJobsFunction);
        props.apiKeysTable.grantReadData(this.createJobFunction);
        props.apiKeysTable.grantReadData(this.getJobFunction);
        props.apiKeysTable.grantReadData(this.listJobsFunction);
        props.apiKeysTable.grantReadWriteData(this.createApiKeyFunction);
        props.apiKeysTable.grantReadData(this.listApiKeysFunction);
        props.apiKeysTable.grantReadWriteData(this.deleteApiKeyFunction);
        props.jobTable.grantReadData(this.listLogsFunction);
        props.jobTable.grantReadData(this.downloadVideoFunction);
        props.jobTable.grantReadWriteData(this.internalCreateJobFunction);
        props.jobTable.grantReadData(this.internalGetJobFunction);
        props.mediaBucket.grantReadWrite(this.createJobFunction);
        props.mediaBucket.grantRead(this.getJobFunction);
        props.mediaBucket.grantRead(this.downloadVideoFunction);
        props.mediaBucket.grantRead(this.internalGetJobFunction);
        props.processingQueue.grantSendMessages(this.createJobFunction);
        props.processingQueue.grantSendMessages(this.internalCreateJobFunction);
        props.queueCounterTable.grantReadWriteData(this.createJobFunction);
        props.queueCounterTable.grantReadWriteData(this.internalCreateJobFunction);

        // Routes
        this.httpApi.addRoutes({
            path: '/jobs',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('CreateJobIntegration', this.createJobFunction),
        });

        this.httpApi.addRoutes({
            path: '/jobs',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('ListJobsIntegration', this.listJobsFunction),
        });

        this.httpApi.addRoutes({
            path: '/jobs/{jobId}',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('GetJobIntegration', this.getJobFunction),
        });

        // Internal API routes (protected by Cognito)
        this.httpApi.addRoutes({
            path: '/internal/api-keys',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('CreateApiKeyIntegration', this.createApiKeyFunction),
        });

        this.httpApi.addRoutes({
            path: '/internal/api-keys',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('ListApiKeysIntegration', this.listApiKeysFunction),
        });

        this.httpApi.addRoutes({
            path: '/internal/api-keys/{apiKey}',
            methods: [apigatewayv2.HttpMethod.DELETE],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('DeleteApiKeyIntegration', this.deleteApiKeyFunction),
        });

        this.httpApi.addRoutes({
            path: '/internal/logs',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('ListLogsIntegration', this.listLogsFunction),
        });

        this.httpApi.addRoutes({
            path: '/internal/download/{jobId}',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('DownloadVideoIntegration', this.downloadVideoFunction),
        });

        this.httpApi.addRoutes({
            path: '/internal/jobs',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('InternalCreateJobIntegration', this.internalCreateJobFunction),
        });

        this.httpApi.addRoutes({
            path: '/internal/jobs/{jobId}',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2_integrations.HttpLambdaIntegration('InternalGetJobIntegration', this.internalGetJobFunction),
        });
    }

    private createLambdaFunction(name: string, handler: string, environment: Record<string, string>): NodejsFunction {
        return new NodejsFunction(this, `${name}Function`, {
            functionName: `clipgen-${name.replace(/([A-Z])/g, '-$1').toLowerCase().substring(1)}`,
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: `lambda/src/api/${handler.split('.')[0]}.ts`, // Point to your TS source file
            handler: handler.split('.')[1] || 'handler', // Extract handler method name
            environment,
            timeout: cdk.Duration.seconds(name === 'CreateJob' ? 30 : 10),
            memorySize: name === 'CreateJob' ? 1024 : 512,
            bundling: {
                minify: true,
                sourceMap: true,
                target: 'es2020',
                logLevel: LogLevel.SILENT
            },
        });
    }
}