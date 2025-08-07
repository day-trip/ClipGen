import type {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';
import {DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand} from '@aws-sdk/lib-dynamodb';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import { verify } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// TTL constant for 32 days (for request logs retention)
const TTL_SECONDS = 32 * 24 * 60 * 60; // 32 days

// JWKS client for Cognito public keys (same as HTTP middleware)
const jwksClient = new JwksClient({
    jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 1000 * 60 * 60 * 24, // 24 hours
});

export const connectHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId!;
    const apiKey = event.headers?.['x-api-key'] || event.queryStringParameters?.apiKey;
    const token = event.headers?.['authorization'] || event.queryStringParameters?.token;
    const jobId = event.queryStringParameters?.jobId;

    if ((!apiKey && !token) || !jobId) {
        return {statusCode: 400, body: 'Missing authentication (apiKey or token) or jobId'};
    }

    try {
        let userId: string;

        if (apiKey) {
            // API Key authentication
            const apiKeyResult = await ddbClient.send(new GetCommand({
                TableName: process.env.API_KEYS_TABLE_NAME!, Key: {apiKey}
            }));

            if (!apiKeyResult.Item) {
                return {statusCode: 401, body: 'Invalid API key'};
            }

            userId = apiKeyResult.Item.userId;
        } else {
            // JWT Token authentication using the same pattern as HTTP API
            const cleanToken = token!.startsWith('Bearer ') ? token!.replace('Bearer ', '') : token!;

            // Get the signing key first (same pattern as HTTP middleware)
            const tokenHeader = JSON.parse(Buffer.from(cleanToken.split('.')[0]!, 'base64url').toString());

            const signingKey = await new Promise<string>((resolve, reject) => {
                jwksClient.getSigningKey(tokenHeader.kid, (err, key) => {
                    if (err) {
                        console.error('JWKS error:', err);
                        reject(err);
                    } else if (!key) {
                        console.error('No key returned from JWKS');
                        reject(new Error('No signing key found'));
                    } else {
                        resolve(key.getPublicKey());
                    }
                });
            });

            const decoded = await new Promise<any>((resolve, reject) => {
                verify(cleanToken, signingKey, {
                    algorithms: ['RS256'],
                    issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}`,
                    audience: process.env.COGNITO_CLIENT_ID,
                }, (err, decoded) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(decoded);
                    }
                });
            });

            userId = decoded.sub;
        }

        // Verify job belongs to this user
        const jobResult = await ddbClient.send(new GetCommand({
            TableName: process.env.JOB_TABLE_NAME!, Key: {userId, jobId}
        }));

        if (!jobResult.Item) {
            return {statusCode: 403, body: 'Job not found'};
        }

        // Store connection
        await ddbClient.send(new PutCommand({
            TableName: process.env.CONNECTION_TABLE_NAME!, Item: {
                connectionId,
                userId,
                jobId,
                connectedAt: new Date().toISOString(),
                ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS
            }
        }));

        // WebSocket connection successful
        return {
            statusCode: 200,
            body: 'Connected'
        };

    } catch (error) {
        console.error('Connect handler error:', error);
        return {statusCode: 500, body: 'Internal server error'};
    }
};

export const disconnectHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const connectionId = event.requestContext.connectionId!;

    console.log(`WebSocket disconnect: ${connectionId}`);

    // Remove connection from DynamoDB
    await ddbClient.send(new DeleteCommand({
        TableName: process.env.CONNECTION_TABLE_NAME!, Key: {connectionId}
    }));

    return {statusCode: 200, body: 'Disconnected'};
};

export const messageHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // No need for clients to send commands over WS
    // Leaving here for future extensibility

    const connectionId = event.requestContext.connectionId!;
    console.log(`WebSocket message from ${connectionId}!`);
    return {statusCode: 200, body: 'Message received'};
};