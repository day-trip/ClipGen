import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withCognitoAuth, errorResponse, successResponse, type CognitoValidatedEvent } from '../../utils/middleware';
import type {APIGatewayProxyResult} from "aws-lambda";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const listLogsHandler = async (event: CognitoValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const limit = parseInt(event.queryStringParameters?.limit || '50');
        const cursor = event.queryStringParameters?.cursor;

        // Filter to last 30 days
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        const queryParams: any = {
            TableName: process.env.JOB_TABLE_NAME!,
            KeyConditionExpression: 'userId = :userId AND jobNumber > :thirtyDaysAgo',
            ExpressionAttributeValues: {
                ':userId': event.userId,
                ':thirtyDaysAgo': thirtyDaysAgo
            },
            Limit: limit,
            ScanIndexForward: false, // Most recent first
            IndexName: 'userId-jobNumber-index'
        };

        if (cursor) {
            try {
                queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
            } catch (cursorError) {
                return errorResponse(400, 'Invalid cursor parameter');
            }
        }

        const result = await ddbClient.send(new QueryCommand(queryParams));

        const logs = (result.Items || []).map(job => {
            // Calculate duration if completed
            let duration = null;
            if (job.status === 'completed' && job.completedAt && job.createdAt) {
                const start = new Date(job.createdAt).getTime();
                const end = job.completedAt * 1000; // completedAt is Unix timestamp
                duration = Math.round((end - start) / 1000); // Duration in seconds
            }

            return {
                jobId: job.jobId,
                status: job.status,
                prompt: job.input_data?.prompt || 'No prompt',
                createdAt: job.createdAt,
                completedAt: job.completedAt || null,
                duration, // in seconds
                hasVideo: job.status === 'completed' && !!job.videoUrl
            };
        });

        let nextCursor = null;
        if (result.LastEvaluatedKey) {
            nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
        }

        return successResponse({
            logs,
            nextCursor
        });

    } catch (error) {
        console.error('List logs error:', error);
        return errorResponse(500, 'Failed to list logs');
    }
};

export const handler = withCognitoAuth(listLogsHandler);