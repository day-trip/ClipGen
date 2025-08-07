import type { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { withAuth, errorResponse, successResponse, type ValidatedEvent } from '../utils/middleware';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const listJobsHandler = async (event: ValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const limit = parseInt(event.queryStringParameters?.limit || '20');
        const cursor = event.queryStringParameters?.cursor;

        const queryParams: any = {
            TableName: process.env.JOB_TABLE_NAME!,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': event.userId },
            Limit: limit,
            ScanIndexForward: false // Most recent first
        };

        if (cursor) {
            try {
                queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
            } catch (cursorError) {
                return errorResponse(400, 'Invalid cursor parameter');
            }
        }

        const result = await ddbClient.send(new QueryCommand(queryParams));

        const jobs = (result.Items || []).map(job => ({
            jobId: job.jobId,
            status: job.status,
            queuePosition: null, // Skip calculation for list view
            videoUrl: null, // Skip URL generation for list view
            createdAt: job.createdAt,
            completedAt: job.completedAt || null
        }));

        let nextCursor = null;
        if (result.LastEvaluatedKey) {
            nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
        }

        return successResponse({
            jobs,
            nextCursor
        });

    } catch (error) {
        console.error('List jobs error:', error);
        return errorResponse(500, 'Failed to list jobs');
    }
};

export const handler = withAuth(listJobsHandler);