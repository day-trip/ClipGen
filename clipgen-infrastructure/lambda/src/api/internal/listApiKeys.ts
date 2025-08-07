import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withCognitoAuth, errorResponse, successResponse, type CognitoValidatedEvent } from '../../utils/middleware';
import type {APIGatewayProxyResult} from "aws-lambda";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const listApiKeysHandler = async (event: CognitoValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const result = await ddbClient.send(new QueryCommand({
            TableName: process.env.API_KEYS_TABLE_NAME!,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': event.userId },
            ScanIndexForward: false, // Sort by most recent first
        }));

        const apiKeys = (result.Items || []).map(item => ({
            apiKey: item.apiKey,
            name: item.name,
            createdAt: item.createdAt,
            lastUsed: item.lastUsed,
            isActive: item.isActive
        }));

        return successResponse({ apiKeys });

    } catch (error) {
        console.error('List API keys error:', error);
        return errorResponse(500, 'Failed to list API keys');
    }
};

export const handler = withCognitoAuth(listApiKeysHandler);