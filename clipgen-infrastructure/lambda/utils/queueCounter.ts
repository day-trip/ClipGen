import {DynamoDBDocumentClient, UpdateCommand} from '@aws-sdk/lib-dynamodb';

export async function getNextTicket(ddbClient: DynamoDBDocumentClient): Promise<number> {
    const result = await ddbClient.send(new UpdateCommand({
        TableName: process.env.QUEUE_COUNTER_TABLE_NAME!,
        Key: { id: 'tickets' }, // Single row for the counter
        UpdateExpression: 'ADD nextTicket :inc',
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'UPDATED_NEW'
    }));

    return result.Attributes!.nextTicket as number;
}

export async function incrementNowServing(ddbClient: DynamoDBDocumentClient): Promise<number> {
    const result = await ddbClient.send(new UpdateCommand({
        TableName: process.env.QUEUE_COUNTER_TABLE_NAME!,
        Key: { id: 'tickets' }, // Same row
        UpdateExpression: 'ADD nowServing :inc',
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'UPDATED_NEW'
    }));

    return result.Attributes!.nowServing as number;
}

export async function getCurrentCounters(ddbClient: DynamoDBDocumentClient): Promise<{ nextTicket: number; nowServing: number }> {
    const result = await ddbClient.send(new UpdateCommand({
        TableName: process.env.QUEUE_COUNTER_TABLE_NAME!,
        Key: { id: 'tickets' },
        UpdateExpression: 'SET #dummy = if_not_exists(#dummy, :zero)', // No-op update to ensure record exists
        ExpressionAttributeNames: { '#dummy': 'dummy' },
        ExpressionAttributeValues: { ':zero': 0 },
        ReturnValues: 'ALL_NEW'
    }));

    return {
        nextTicket: result.Attributes?.nextTicket || 0,
        nowServing: result.Attributes?.nowServing || 0
    };
}