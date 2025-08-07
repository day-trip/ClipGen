import { DynamoDBDocumentClient, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withCognitoAuth, errorResponse, successResponse, type CognitoValidatedEvent } from '../../utils/middleware';
import type {APIGatewayProxyResult} from "aws-lambda";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const deleteApiKeyHandler = async (event: CognitoValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const apiKeyToDelete = event.pathParameters?.apiKey;

        if (!apiKeyToDelete) {
            return errorResponse(400, 'API key is required');
        }

        // First, verify this API key belongs to the user
        const existing = await ddbClient.send(new GetCommand({
            TableName: process.env.API_KEYS_TABLE_NAME!,
            Key: { apiKey: apiKeyToDelete }
        }));

        if (!existing.Item) {
            return errorResponse(404, 'API key not found');
        }

        if (existing.Item.userId !== event.userId) {
            return errorResponse(403, 'Not authorized to delete this API key');
        }

        // Delete the API key
        await ddbClient.send(new DeleteCommand({
            TableName: process.env.API_KEYS_TABLE_NAME!,
            Key: { apiKey: apiKeyToDelete }
        }));

        return successResponse({ message: 'API key deleted successfully' });

    } catch (error) {
        console.error('Delete API key error:', error);
        return errorResponse(500, 'Failed to delete API key');
    }
};

export const handler = withCognitoAuth(deleteApiKeyHandler);