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

        // Grant permissions
        props.jobTable.grantReadWriteData(this.createJobFunction);
        props.jobTable.grantReadData(this.getJobFunction);
        props.jobTable.grantReadData(this.listJobsFunction);
        props.apiKeysTable.grantReadData(this.createJobFunction);
        props.apiKeysTable.grantReadData(this.getJobFunction);
        props.apiKeysTable.grantReadData(this.listJobsFunction);
        props.mediaBucket.grantReadWrite(this.createJobFunction);
        props.mediaBucket.grantRead(this.getJobFunction);
        props.processingQueue.grantSendMessages(this.createJobFunction);
        props.queueCounterTable.grantReadWriteData(this.createJobFunction);

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