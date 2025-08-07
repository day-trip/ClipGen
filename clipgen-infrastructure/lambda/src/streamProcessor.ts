import type {DynamoDBRecord, DynamoDBStreamEvent} from 'aws-lambda';
import {ApiGatewayManagementApiClient, PostToConnectionCommand} from '@aws-sdk/client-apigatewaymanagementapi';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DeleteCommand, DynamoDBDocumentClient, QueryCommand, ScanCommand} from '@aws-sdk/lib-dynamodb';
import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {incrementNowServing} from "./utils/queueCounter";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const apiGwClient = new ApiGatewayManagementApiClient({
    endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

export const handler = async (event: DynamoDBStreamEvent) => {
    console.log('Processing stream records:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        if (record.eventName === 'MODIFY' || record.eventName === 'INSERT') {
            await processJobUpdate(record);
        }
    }
};

async function processJobUpdate(record: DynamoDBRecord) {
    const newImage = record.dynamodb?.NewImage;
    const oldImage = record.dynamodb?.OldImage;
    if (!newImage) return;

    const userId = newImage.userId?.S;
    const jobId = newImage.jobId?.S;
    const newStatus = newImage.status?.S;
    const oldStatus = oldImage?.status?.S;

    if (!userId || !jobId || !newStatus) return;

    // When a job completes/fails, increment nowServing counter and broadcast to all clients
    if (oldStatus === 'processing' && (newStatus === 'completed' || newStatus === 'failed')) {
        const nowServing = await incrementNowServing(ddbClient);
        await broadcastNowServing(nowServing);
    }

    // Send job-specific update to the job owner
    const connections = await getActiveConnections(jobId);
    const messageData: any = {
        type: 'JOB_UPDATE',
        jobId,
        status: newStatus,
        // Include ticket number for client-side position calculation
        ticketNumber: newImage.ticketNumber?.N ? parseInt(newImage.ticketNumber.N) : null,
        timestamp: new Date().toISOString()
    };

    // Include additional data based on status
    if (newStatus === 'completed' && newImage.videoUrl?.S) {
        // Generate signed URL for the video
        const s3Url = newImage.videoUrl.S;
        const s3UrlMatch = s3Url.match(/^s3:\/\/([^\/]+)\/(.+)$/);
        if (s3UrlMatch) {
            const [, bucket, key] = s3UrlMatch;
            try {
                messageData.videoUrl = await getSignedUrl(s3Client, new GetObjectCommand({
                    Bucket: bucket, Key: key
                }), {expiresIn: 3600}); // 1 hour
            } catch (error) {
                console.error('Failed to generate signed URL:', error);
                messageData.videoUrl = s3Url; // Fallback to raw S3 URL
            }
        } else {
            messageData.videoUrl = s3Url; // Use as-is if not S3 format
        }
    } else if (newStatus === 'failed' && newImage.errorMessage?.S) {
        messageData.errorMessage = newImage.errorMessage.S;
    }

    const message = JSON.stringify(messageData);
    await Promise.allSettled(connections.map(connectionId => sendMessageToConnection(connectionId, message)));
}

async function broadcastNowServing(nowServing: number) {
    // Get ALL active connections (not just specific users)
    const connections = await getAllActiveConnections();

    const message = JSON.stringify({
        type: 'QUEUE_UPDATE',
        nowServing,
        timestamp: new Date().toISOString()
    });

    // Batch in groups of 10 (API Gateway limit)
    const batchPromises = [];
    for (let i = 0; i < connections.length; i += 10) {
        const batch = connections.slice(i, i + 10);
        batchPromises.push(Promise.allSettled(batch.map(conn => sendMessageToConnection(conn, message))));
    }

    // Wait for all batch promises to complete
    await Promise.allSettled(batchPromises);

    console.log(`Broadcasted nowServing=${nowServing} to ${connections.length} connections`);
}

async function getActiveConnections(jobId: string): Promise<string[]> {
    // Query connections table by userId (you'll need a GSI for this)
    const result = await ddbClient.send(new QueryCommand({
        TableName: process.env.CONNECTION_TABLE_NAME!,
        IndexName: 'jobId-index',
        KeyConditionExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {':jobId': jobId}
    }));

    return result.Items?.map(item => item.connectionId) || [];
}

async function getAllActiveConnections(): Promise<string[]> {
    // Scan all connections - this is efficient since connections are short-lived
    const result = await ddbClient.send(new ScanCommand({
        TableName: process.env.CONNECTION_TABLE_NAME!,
        ProjectionExpression: 'connectionId'
    }));

    return result.Items?.map(item => item.connectionId) || [];
}

async function sendMessageToConnection(connectionId: string, message: string) {
    try {
        await apiGwClient.send(new PostToConnectionCommand({
            ConnectionId: connectionId, Data: Buffer.from(message)
        }));
    } catch (error: any) {
        if (error.statusCode === 410) {
            // Connection is stale, remove it
            await removeConnection(connectionId);
        }
        console.error(`Failed to send message to ${connectionId}:`, error);
    }
}

async function removeConnection(connectionId: string) {
    await ddbClient.send(new DeleteCommand({
        TableName: process.env.CONNECTION_TABLE_NAME!, Key: {connectionId}
    }));
}