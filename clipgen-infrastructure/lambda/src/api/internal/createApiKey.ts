import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { withCognitoAuth, errorResponse, successResponse, type CognitoValidatedEvent } from '../../utils/middleware';
import { z } from 'zod';
import type {APIGatewayProxyResult} from "aws-lambda";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const createApiKeySchema = z.object({
    name: z.string().min(1).max(50),
});

const createApiKeyHandler = async (event: CognitoValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const body = JSON.parse(event.body || '{}');
        const validation = createApiKeySchema.safeParse(body);

        if (!validation.success) {
            return errorResponse(400, validation.error.issues[0]!.message);
        }

        const { name } = validation.data;

        // Check if user has too many keys (limit to 5)
        const existingKeys = await ddbClient.send(new QueryCommand({
            TableName: process.env.API_KEYS_TABLE_NAME!,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': event.userId },
            Select: 'COUNT'
        }));

        if ((existingKeys.Count || 0) >= 5) {
            return errorResponse(400, 'Maximum of 5 API keys allowed');
        }

        const apiKey = `sk-${uuidv4().replace(/-/g, '')}`;
        const now = new Date().toISOString();

        await ddbClient.send(new PutCommand({
            TableName: process.env.API_KEYS_TABLE_NAME!,
            Item: {
                apiKey,
                userId: event.userId,
                name,
                createdAt: now,
                lastUsed: null,
                isActive: true,
            }
        }));

        return successResponse({
            apiKey,
            name,
            createdAt: now,
            lastUsed: null,
            isActive: true
        }, 201);

    } catch (error) {
        console.error('Create API key error:', error);
        return errorResponse(500, 'Failed to create API key');
    }
};

export const handler = withCognitoAuth(createApiKeyHandler);