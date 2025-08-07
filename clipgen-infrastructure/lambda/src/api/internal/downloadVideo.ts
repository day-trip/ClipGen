import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { withCognitoAuth, errorResponse, successResponse, type CognitoValidatedEvent } from '../../utils/middleware';
import type {APIGatewayProxyResult} from "aws-lambda";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const downloadVideoHandler = async (event: CognitoValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const jobId = event.pathParameters?.jobId;
        if (!jobId) {
            return errorResponse(400, 'Job ID is required');
        }

        // Get job from DynamoDB to verify ownership and get video URL
        const result = await ddbClient.send(new GetCommand({
            TableName: process.env.JOB_TABLE_NAME!,
            Key: { userId: event.userId, jobId }
        }));

        if (!result.Item) {
            return errorResponse(404, 'Job not found');
        }

        const job = result.Item;

        if (job.status !== 'completed') {
            return errorResponse(400, 'Job is not completed');
        }

        if (!job.videoUrl) {
            return errorResponse(404, 'Video not available');
        }

        // Parse S3 URL (format: s3://bucket/key) to extract bucket and key
        const s3UrlMatch = job.videoUrl.match(/^s3:\/\/([^\/]+)\/(.+)$/);
        if (!s3UrlMatch) {
            return errorResponse(500, 'Invalid video URL format');
        }

        const [, bucket, key] = s3UrlMatch;

        // Generate signed URL valid for 15 minutes
        const downloadUrl = await getSignedUrl(s3Client, new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseContentDisposition: `attachment; filename="${jobId}.mp4"`
        }), { expiresIn: 900 }); // 15 minutes

        return successResponse({
            downloadUrl,
            expiresIn: 900
        });

    } catch (error) {
        console.error('Download video error:', error);
        return errorResponse(500, 'Failed to generate download URL');
    }
};

export const handler = withCognitoAuth(downloadVideoHandler);