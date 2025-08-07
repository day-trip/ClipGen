import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {DynamoDBDocumentClient, GetCommand, QueryCommand} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { apiKeySchema } from '../types/schemas';
import { verify } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Enhanced event type with validated data
export interface ValidatedEvent<T = any> extends APIGatewayProxyEvent {
    validatedData: T;
    userId: string;
    apiKey: string;
}

// Cognito validated event
export interface CognitoValidatedEvent extends APIGatewayProxyEvent {
    userId: string;
    cognitoSub: string;
    email?: string;
    username?: string;
}

// Standard error responses
export const errorResponse = (statusCode: number, message: string): APIGatewayProxyResult => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ error: message })
});

export const successResponse = (data: any, statusCode = 200): APIGatewayProxyResult => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(data)
});

// Auth middleware
export const withAuth = (handler: (event: ValidatedEvent) => Promise<APIGatewayProxyResult>) => {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        try {
            // Extract API key from header
            const apiKey = event.headers['x-api-key'] || event.headers['X-API-Key'];

            if (!apiKey) {
                return errorResponse(401, 'API key is required. Include X-API-Key header.');
            }

            // Validate API key format
            const validatedApiKey = apiKeySchema.safeParse(apiKey);
            if (!validatedApiKey.success) {
                return errorResponse(401, 'Invalid API key format');
            }

            // Check if API key exists and is active
            const result = await ddbClient.send(new GetCommand({
                TableName: process.env.API_KEYS_TABLE_NAME!,
                Key: { apiKey: validatedApiKey.data }
            }));

            if (!result.Item || !result.Item.isActive) {
                return errorResponse(401, 'Invalid or inactive API key');
            }

            const userId = result.Item.userId;

            // Attach validated data to event
            const validatedEvent = event as ValidatedEvent;
            validatedEvent.userId = userId;
            validatedEvent.apiKey = validatedApiKey.data;

            return await handler(validatedEvent);

        } catch (error) {
            console.error('Auth middleware error:', error);
            return errorResponse(500, 'Internal server error');
        }
    };
};

export const withRateLimiting = (handler: (event: ValidatedEvent) => Promise<APIGatewayProxyResult>) => {
    return async (event: ValidatedEvent): Promise<APIGatewayProxyResult> => {
        const oneMinuteAgo = Date.now() - 60000;

        const recentJobs = await ddbClient.send(new QueryCommand({
            TableName: process.env.JOB_TABLE_NAME!,
            IndexName: 'userId-jobNumber-index',
            KeyConditionExpression: 'userId = :userId AND jobNumber > :oneMinuteAgo',
            ExpressionAttributeValues: {
                ':userId': event.userId,
                ':oneMinuteAgo': oneMinuteAgo
            },
            Select: 'COUNT'
        }));

        if ((recentJobs.Count || 0) >= 10) {
            return errorResponse(429, 'Rate limit exceeded. Try again in 60 seconds.');
        }

        return await handler(event);
    };
};

// JWKS client for Cognito public keys
const jwksClient = new JwksClient({
    jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 1000 * 60 * 60 * 24, // 24 hours
});

// Cognito JWT authentication middleware
export const withCognitoAuth = (handler: (event: CognitoValidatedEvent) => Promise<APIGatewayProxyResult>) => {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        try {
            const authHeader = event.headers.authorization || event.headers.Authorization;

            console.log('Auth header:', authHeader ? 'Bearer present' : 'Missing');
            console.log('Environment vars check:', {
                userPoolId: process.env.USER_POOL_ID,
                clientId: process.env.COGNITO_CLIENT_ID,
                region: process.env.AWS_REGION
            });

            if (!authHeader?.startsWith('Bearer ')) {
                return errorResponse(401, 'Bearer token required in Authorization header');
            }

            const token = authHeader.substring(7);

            // Get the signing key first
            const tokenHeader = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString());
            const signingKey = await new Promise<string>((resolve, reject) => {
                jwksClient.getSigningKey(tokenHeader.kid, (err, key) => {
                    if (err) {
                        console.error('JWKS error:', err);
                        reject(err);
                    } else {
                        resolve(key!.getPublicKey());
                    }
                });
            });

            // Verify JWT token against Cognito using callback pattern
            const decoded = await new Promise<any>((resolve, reject) => {
                verify(token, signingKey, {
                    algorithms: ['RS256'],
                    issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}`,
                    audience: process.env.COGNITO_CLIENT_ID,
                }, (err: any, decoded: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(decoded);
                    }
                });
            });

            console.log('Token verified successfully for user:', decoded.sub);

            // Attach user info to event
            const validatedEvent = event as CognitoValidatedEvent;
            validatedEvent.userId = decoded.sub;
            validatedEvent.cognitoSub = decoded.sub;
            validatedEvent.email = decoded.email;
            validatedEvent.username = decoded['cognito:username'];

            return await handler(validatedEvent);

        } catch (error) {
            console.error('Cognito auth error details:', {
                error: error instanceof Error ? error.message : error,
                name: error instanceof Error ? error.name : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
            });
            return errorResponse(401, 'Invalid or expired token');
        }
    };
};