import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {Construct} from 'constructs';

export interface WebSocketProps {
    jobTable: dynamodb.Table;
    connectionTable: dynamodb.Table;
    apiKeysTable: dynamodb.Table;
    queueCounterTable: dynamodb.Table;
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
}

export class WebSocketConstruct extends Construct {
    public readonly webSocketApi: apigatewayv2.WebSocketApi;
    public readonly webSocketEndpoint: string;
    public readonly streamProcessor: NodejsFunction;

    constructor(scope: Construct, id: string, props: WebSocketProps) {
        super(scope, id);

        // WebSocket API
        this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
            apiName: 'clipgen-websocket', description: 'Real-time job status updates',
        });

        // Stream processor for DynamoDB updates
        this.streamProcessor = new NodejsFunction(this, 'StreamProcessor', {
            functionName: 'clipgen-stream-processor',
            entry: 'lambda/src/streamProcessor.ts',
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(30),
            bundling: {
                minify: false, sourceMap: false, target: 'es2020',
            },
        });

        // WebSocket handlers
        const connectHandler = this.createWebSocketHandler('Connect', 'connectHandler');
        const disconnectHandler = this.createWebSocketHandler('Disconnect', 'disconnectHandler');
        const messageHandler = this.createWebSocketHandler('Message', 'messageHandler');

        // Grant permissions
        props.jobTable.grantStreamRead(this.streamProcessor);
        props.jobTable.grantReadData(this.streamProcessor); // Need to read job data and query indexes
        props.connectionTable.grantReadWriteData(this.streamProcessor);
        props.connectionTable.grantReadWriteData(connectHandler);
        props.connectionTable.grantReadWriteData(disconnectHandler);
        props.connectionTable.grantReadWriteData(messageHandler);
        props.jobTable.grantReadData(connectHandler);
        props.apiKeysTable.grantReadData(connectHandler);
        props.queueCounterTable.grantReadWriteData(this.streamProcessor);
        this.webSocketApi.grantManageConnections(this.streamProcessor);

        // WebSocket routes
        this.webSocketApi.addRoute('$connect', {
            integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
        });

        this.webSocketApi.addRoute('$disconnect', {
            integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
        });

        this.webSocketApi.addRoute('$default', {
            integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('MessageIntegration', messageHandler),
        });

        // Stage
        const wsStage = new apigatewayv2.WebSocketStage(this, 'WSStage', {
            webSocketApi: this.webSocketApi, stageName: 'prod', autoDeploy: true,
        });

        this.webSocketEndpoint = `wss://${this.webSocketApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${wsStage.stageName}`;

        // Environment variables
        const commonEnv = {
            CONNECTION_TABLE_NAME: props.connectionTable.tableName,
            JOB_TABLE_NAME: props.jobTable.tableName,
            API_KEYS_TABLE_NAME: props.apiKeysTable.tableName,
            QUEUE_COUNTER_TABLE_NAME: props.queueCounterTable.tableName,
            WEBSOCKET_API_ENDPOINT: `https://${this.webSocketApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${wsStage.stageName}`,
            USER_POOL_ID: props.userPool.userPoolId,
            COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        };

        Object.entries(commonEnv).forEach(([key, value]) => {
            this.streamProcessor.addEnvironment(key, value);
            connectHandler.addEnvironment(key, value);
            disconnectHandler.addEnvironment(key, value);
            messageHandler.addEnvironment(key, value);
        });

        // DynamoDB stream connection
        new lambda.EventSourceMapping(this, 'JobTableStreamMapping', {
            target: this.streamProcessor,
            eventSourceArn: props.jobTable.tableStreamArn!,
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 10,
            maxBatchingWindow: cdk.Duration.seconds(5),
        });
    }

    private createWebSocketHandler(name: string, handler: string): NodejsFunction {
        return new NodejsFunction(this, `WS${name}Handler`, {
            functionName: `clipgen-ws-${name.toLowerCase()}`,
            entry: 'lambda/src/websocketHandlers.ts',
            handler,
            runtime: lambda.Runtime.NODEJS_18_X,
            bundling: {
                minify: false, sourceMap: false, target: 'es2020',
            },
        });
    }
}