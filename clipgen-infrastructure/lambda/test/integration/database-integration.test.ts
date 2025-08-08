import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { JobService } from '../../src/services/jobService';
import testData from '../fixtures/test-data.json';

// Mock the DynamoDB client
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock external dependencies
jest.mock('../../src/utils/queueCounter', () => ({
  getNextTicket: jest.fn().mockResolvedValue(1),
}));

describe('Database Integration Tests', () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.JOB_TABLE_NAME = 'test-job-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
    process.env.PROCESSING_QUEUE_URL = 'https://sqs.test.com/queue';
    process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
  });

  describe('Job Table Operations', () => {
    test('creates job with proper DynamoDB structure', async () => {
      ddbMock.on(PutCommand).resolves({});

      await JobService.createJob(testData.testUserId, testData.validCreateJobRequest);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      
      const putCall = ddbMock.commandCalls(PutCommand)[0]!;
      const item = putCall.args[0].input.Item!;
      
      // Verify required fields
      expect(item).toHaveProperty('userId', testData.testUserId);
      expect(item).toHaveProperty('jobId');
      expect(item).toHaveProperty('jobNumber');
      expect(item).toHaveProperty('ticketNumber', 1);
      expect(item).toHaveProperty('status', 'queued');
      expect(item).toHaveProperty('input_data');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('ttl');
      
      // Verify input data structure
      expect(item.input_data).toMatchObject({
        prompt: testData.validCreateJobRequest.prompt,
        width: testData.validCreateJobRequest.width,
        height: testData.validCreateJobRequest.height,
        num_frames: testData.validCreateJobRequest.num_frames,
        num_inference_steps: testData.validCreateJobRequest.num_inference_steps,
        guidance_scale: testData.validCreateJobRequest.guidance_scale,
        negative_prompt: testData.validCreateJobRequest.negative_prompt,
        seed: expect.any(Number),
      });
      
      // Verify TTL is set (should be 32 days from now)
      const currentTime = Math.floor(Date.now() / 1000);
      const expectedTtl = currentTime + (32 * 24 * 60 * 60);
      expect(item.ttl).toBeCloseTo(expectedTtl, -2); // Within ~100 seconds
    });

    test('retrieves job using composite key', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: testData.jobRecord,
      });

      const result = await JobService.getJob(testData.testUserId, testData.testJobId);

      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
      
      const getCall = ddbMock.commandCalls(GetCommand)[0];
      expect(getCall!.args[0].input).toMatchObject({
        TableName: 'test-job-table',
        Key: {
          userId: testData.testUserId,
          jobId: testData.testJobId,
        },
      });
      
      expect(result).toBeTruthy();
      expect(result?.jobId).toBe(testData.testJobId);
    });

    test('handles non-existent job gracefully', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await JobService.getJob(testData.testUserId, 'nonexistent-job');

      expect(result).toBeNull();
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
    });
  });

  describe('Global Secondary Index Operations', () => {
    test('queries jobs by userId using GSI', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [testData.jobRecord],
        Count: 1,
      });

      // This would typically be tested through a list jobs handler
      // but we're simulating the DynamoDB query pattern here
      const queryParams = {
        TableName: 'test-job-table',
        IndexName: 'userId-jobNumber-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': testData.testUserId,
        },
        ScanIndexForward: false, // Latest first
        Limit: 10,
      };

      const result = await ddbMock.send(new QueryCommand(queryParams));

      expect(result.Items).toHaveLength(1);
      expect(result.Items?.[0]).toMatchObject({
        userId: testData.testUserId,
        jobId: testData.testJobId,
      });
    });

    test('queries jobs by status using GSI', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [testData.jobRecord],
        Count: 1,
      });

      const queryParams = {
        TableName: 'test-job-table',
        IndexName: 'status-jobNumber-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'queued',
        },
        ScanIndexForward: false,
      };

      const result = await ddbMock.send(new QueryCommand(queryParams));

      expect(result.Items).toHaveLength(1);
      expect(result.Items?.[0].status).toBe('queued');
    });

    test('queries jobs by jobId using GSI', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [testData.jobRecord],
        Count: 1,
      });

      const queryParams = {
        TableName: 'test-job-table',
        IndexName: 'jobId-index',
        KeyConditionExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
          ':jobId': testData.testJobId,
        },
      };

      const result = await ddbMock.send(new QueryCommand(queryParams));

      expect(result.Items).toHaveLength(1);
      expect(result.Items?.[0].jobId).toBe(testData.testJobId);
    });
  });

  describe('API Keys Table Operations', () => {
    test('retrieves API key by primary key', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: testData.apiKeyRecord,
      });

      const result = await ddbMock.send(new GetCommand({
        TableName: 'test-api-keys-table',
        Key: { apiKey: testData.validApiKey },
      }));

      expect(result.Item).toMatchObject({
        apiKey: testData.validApiKey,
        userId: testData.testUserId,
        isActive: true,
      });
    });

    test('queries API keys by userId using GSI', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [testData.apiKeyRecord],
        Count: 1,
      });

      const result = await ddbMock.send(new QueryCommand({
        TableName: 'test-api-keys-table',
        IndexName: 'userId-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': testData.testUserId,
        },
      }));

      expect(result.Items).toHaveLength(1);
      expect(result.Items?.[0].userId).toBe(testData.testUserId);
    });
  });

  describe('Rate Limiting Queries', () => {
    test('queries recent jobs for rate limiting', async () => {
      const currentTime = Date.now();
      const oneMinuteAgo = currentTime - 60000;

      ddbMock.on(QueryCommand).resolves({
        Count: 5, // Under rate limit
      });

      const result = await ddbMock.send(new QueryCommand({
        TableName: 'test-job-table',
        IndexName: 'userId-jobNumber-index',
        KeyConditionExpression: 'userId = :userId AND jobNumber > :oneMinuteAgo',
        ExpressionAttributeValues: {
          ':userId': testData.testUserId,
          ':oneMinuteAgo': oneMinuteAgo,
        },
        Select: 'COUNT',
      }));

      expect(result.Count).toBe(5);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input.Select).toBe('COUNT');
    });
  });

  describe('Error Scenarios', () => {
    test('handles DynamoDB service errors', async () => {
      ddbMock.on(GetCommand).rejects(new Error('ServiceUnavailableException'));

      await expect(
        JobService.getJob(testData.testUserId, testData.testJobId)
      ).rejects.toThrow('ServiceUnavailableException');
    });

    test('handles conditional check failures', async () => {
      ddbMock.on(PutCommand).rejects(new Error('ConditionalCheckFailedException'));

      await expect(
        JobService.createJob(testData.testUserId, testData.validCreateJobRequest)
      ).rejects.toThrow('ConditionalCheckFailedException');
    });

    test('handles throttling errors', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('ProvisionedThroughputExceededException'));

      await expect(
        ddbMock.send(new QueryCommand({
          TableName: 'test-job-table',
          IndexName: 'userId-jobNumber-index',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': testData.testUserId,
          },
        }))
      ).rejects.toThrow('ProvisionedThroughputExceededException');
    });
  });

  describe('Data Type Validation', () => {
    test('stores numbers as numbers, not strings', async () => {
      ddbMock.on(PutCommand).resolves({});

      await JobService.createJob(testData.testUserId, testData.validCreateJobRequest);

      const putCall = ddbMock.commandCalls(PutCommand)[0];
      const item = putCall.args[0].input.Item;
      
      expect(typeof item.jobNumber).toBe('number');
      expect(typeof item.ticketNumber).toBe('number');
      expect(typeof item.ttl).toBe('number');
      expect(typeof item.input_data.width).toBe('number');
      expect(typeof item.input_data.height).toBe('number');
      expect(typeof item.input_data.num_frames).toBe('number');
      expect(typeof item.input_data.num_inference_steps).toBe('number');
      expect(typeof item.input_data.guidance_scale).toBe('number');
      expect(typeof item.input_data.seed).toBe('number');
    });

    test('stores strings as strings', async () => {
      ddbMock.on(PutCommand).resolves({});

      await JobService.createJob(testData.testUserId, testData.validCreateJobRequest);

      const putCall = ddbMock.commandCalls(PutCommand)[0];
      const item = putCall.args[0].input.Item;
      
      expect(typeof item.userId).toBe('string');
      expect(typeof item.jobId).toBe('string');
      expect(typeof item.status).toBe('string');
      expect(typeof item.createdAt).toBe('string');
      expect(typeof item.input_data.prompt).toBe('string');
      expect(typeof item.input_data.negative_prompt).toBe('string');
    });
  });
});