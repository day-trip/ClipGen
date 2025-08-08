import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { handler as createJobHandler } from '../../src/api/createJob';
import { handler as getJobHandler } from '../../src/api/getJob';
import { handler as listJobsHandler } from '../../src/api/listJobs';
import { createEventWithApiKey } from '../fixtures/event-helpers';
import testData from '../fixtures/test-data.json';
import type { ValidatedEvent } from '../../src/utils/middleware';

// Mock the clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

// Mock external dependencies
const mockGetNextTicket = mock(() => Promise.resolve(1));
const mockApiKeySchema = mock(() => ({ success: true, data: testData.validApiKey }));
const mockCreateJobSchema = mock(() => ({ success: true, data: testData.validCreateJobRequest }));

mock.module('../../src/utils/queueCounter', () => ({
  getNextTicket: mockGetNextTicket,
}));

mock.module('../../src/types/schemas', () => ({
  apiKeySchema: {
    safeParse: mockApiKeySchema,
  },
  createJobSchema: {
    safeParse: mockCreateJobSchema,
  },
  formatValidationErrors: mock(() => 'Validation failed'),
}));

describe('API Integration Tests', () => {
  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
    mockGetNextTicket.mockClear();
    mockApiKeySchema.mockClear();
    mockCreateJobSchema.mockClear();

    // Set up environment variables
    process.env.JOB_TABLE_NAME = 'test-job-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
    process.env.PROCESSING_QUEUE_URL = 'https://sqs.test.com/queue';
    process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
    
    // Set up default mock returns
    mockApiKeySchema.mockReturnValue({ success: true, data: testData.validApiKey });
    mockCreateJobSchema.mockReturnValue({ success: true, data: testData.validCreateJobRequest });
    mockGetNextTicket.mockResolvedValue(1);
    
    // Default rate limiting mock - allows requests (Count < 10)
    ddbMock.on(QueryCommand).resolves({ Count: 0 });
  });

  describe('Create Job -> Get Job Flow', () => {
    test('end-to-end job creation and retrieval', async () => {
      // Mock authentication and rate limiting
      ddbMock.on(GetCommand).callsFake((input) => {
        if (input.TableName === 'test-api-keys-table') {
          return { Item: testData.apiKeyRecord };
        }
        if (input.TableName === 'test-job-table') {
          return { Item: testData.jobRecord };
        }
        return {};
      });

      // Mock job creation
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      // 1. Create job
      const createEvent = createEventWithApiKey(testData.validApiKey, {
        body: JSON.stringify(testData.validCreateJobRequest),
        httpMethod: 'POST',
      }) as ValidatedEvent;
      createEvent.userId = testData.testUserId;

      const createResult = await createJobHandler(createEvent);

      expect(createResult.statusCode).toBe(201);
      const createResponseBody = JSON.parse(createResult.body);
      expect(createResponseBody).toMatchObject({
        jobId: expect.stringMatching(/^job_/),
        status: 'queued',
        ticketNumber: 1,
        createdAt: expect.any(String),
      });

      // 2. Get the created job
      const getEvent = createEventWithApiKey(testData.validApiKey, {
        pathParameters: { jobId: testData.testJobId },
        httpMethod: 'GET',
      }) as ValidatedEvent;
      getEvent.userId = testData.testUserId;

      const getResult = await getJobHandler(getEvent);

      expect(getResult.statusCode).toBe(200);
      const getResponseBody = JSON.parse(getResult.body);
      expect(getResponseBody).toMatchObject({
        jobId: testData.testJobId,
        status: 'queued',
        createdAt: testData.jobRecord.createdAt,
        queuePosition: null,
        videoUrl: null,
        completedAt: null
      });

      // Verify database interactions
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(3); // Create auth + Get auth + Get job data
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
    });
  });

  describe('Authentication Flow', () => {
    test('rejects requests with invalid API key across all endpoints', async () => {
      ddbMock.on(GetCommand).resolves({}); // No API key found

      const endpoints = [
        {
          handler: createJobHandler,
          event: createEventWithApiKey('invalid-key', {
            body: JSON.stringify(testData.validCreateJobRequest),
            httpMethod: 'POST',
          }),
        },
        {
          handler: getJobHandler,
          event: createEventWithApiKey('invalid-key', {
            pathParameters: { jobId: testData.testJobId },
            httpMethod: 'GET',
          }),
        },
        {
          handler: listJobsHandler,
          event: createEventWithApiKey('invalid-key', {
            httpMethod: 'GET',
          }),
        },
      ];

      for (const { handler, event } of endpoints) {
        const result = await handler(event as ValidatedEvent);
        expect(result.statusCode).toBe(401);
        expect(JSON.parse(result.body).error).toBe('Invalid or inactive API key');
      }
    });

    test('successfully authenticates valid API key across all endpoints', async () => {
      // Mock authentication success
      ddbMock.on(GetCommand).callsFake((input) => {
        if (input.TableName === 'test-api-keys-table') {
          return { Item: testData.apiKeyRecord };
        }
        if (input.TableName === 'test-job-table') {
          return { Item: testData.jobRecord };
        }
        return {};
      });

      // Mock additional dependencies
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [testData.jobRecord], Count: 1 });
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      const endpoints = [
        {
          handler: createJobHandler,
          event: createEventWithApiKey(testData.validApiKey, {
            body: JSON.stringify(testData.validCreateJobRequest),
            httpMethod: 'POST',
          }) as ValidatedEvent,
        },
        {
          handler: getJobHandler,
          event: createEventWithApiKey(testData.validApiKey, {
            pathParameters: { jobId: testData.testJobId },
            httpMethod: 'GET',
          }) as ValidatedEvent,
        },
        {
          handler: listJobsHandler,
          event: createEventWithApiKey(testData.validApiKey, {
            httpMethod: 'GET',
          }) as ValidatedEvent,
        },
      ];

      for (const { handler, event } of endpoints) {
        event.userId = testData.testUserId;
        const result = await handler(event);
        expect(result.statusCode).not.toBe(401);
        expect(result.statusCode).not.toBe(403);
      }
    });
  });

  describe('Rate Limiting Flow', () => {
    test('enforces rate limiting on job creation', async () => {
      // Mock authentication success
      ddbMock.on(GetCommand).callsFake((input) => {
        if (input.TableName === 'test-api-keys-table') {
          return { Item: testData.apiKeyRecord };
        }
        return {};
      });

      // Mock rate limit exceeded (>10 jobs in last minute)
      ddbMock.on(QueryCommand).resolves({ Count: 15 });

      const createEvent = createEventWithApiKey(testData.validApiKey, {
        body: JSON.stringify(testData.validCreateJobRequest),
        httpMethod: 'POST',
      }) as ValidatedEvent;
      createEvent.userId = testData.testUserId;

      const result = await createJobHandler(createEvent);

      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body).error).toBe('Rate limit exceeded. Try again in 60 seconds.');

      // Should not have attempted to create the job
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });
  });

  describe('Error Handling Flow', () => {
    test('handles database connection errors gracefully', async () => {
      // Mock authentication success
      ddbMock.on(GetCommand).callsFake((input) => {
        if (input.TableName === 'test-api-keys-table') {
          return { Item: testData.apiKeyRecord };
        }
        // Simulate database error for job retrieval
        throw new Error('DynamoDB connection failed');
      });

      const getEvent = createEventWithApiKey(testData.validApiKey, {
        pathParameters: { jobId: testData.testJobId },
        httpMethod: 'GET',
      }) as ValidatedEvent;
      getEvent.userId = testData.testUserId;

      const result = await getJobHandler(getEvent);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Failed to retrieve job');
    });

    test('handles validation errors in job creation', async () => {
      // Mock authentication success
      ddbMock.on(GetCommand).resolves({ Item: testData.apiKeyRecord });
      
      // Mock validation failure for this test
      mockCreateJobSchema.mockReturnValueOnce({ 
        success: false, 
        error: { message: 'Validation failed: Invalid width' }
      });

      const createEvent = createEventWithApiKey(testData.validApiKey, {
        body: JSON.stringify(testData.invalidCreateJobRequest),
        httpMethod: 'POST',
      }) as ValidatedEvent;
      createEvent.userId = testData.testUserId;

      const result = await createJobHandler(createEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('Validation');

      // Should not have attempted to create the job
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });
  });

  describe('Cross-Endpoint Data Consistency', () => {
    test('created job appears in list jobs endpoint', async () => {
      // Mock authentication
      ddbMock.on(GetCommand).resolves({ Item: testData.apiKeyRecord });

      // Mock job creation
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      // Mock list jobs query
      ddbMock.on(QueryCommand).resolves({
        Items: [testData.jobRecord],
        Count: 1,
      });

      // 1. Create job
      const createEvent = createEventWithApiKey(testData.validApiKey, {
        body: JSON.stringify(testData.validCreateJobRequest),
        httpMethod: 'POST',
      }) as ValidatedEvent;
      createEvent.userId = testData.testUserId;

      const createResult = await createJobHandler(createEvent);
      expect(createResult.statusCode).toBe(201);

      // 2. List jobs should include the created job
      const listEvent = createEventWithApiKey(testData.validApiKey, {
        httpMethod: 'GET',
      }) as ValidatedEvent;
      listEvent.userId = testData.testUserId;

      const listResult = await listJobsHandler(listEvent);

      expect(listResult.statusCode).toBe(200);
      const listResponseBody = JSON.parse(listResult.body);
      expect(listResponseBody.jobs).toHaveLength(1);
      expect(listResponseBody.jobs[0]).toMatchObject({
        jobId: testData.testJobId,
        status: 'queued',
        createdAt: testData.jobRecord.createdAt,
        queuePosition: null,
        videoUrl: null,
        completedAt: null
      });
    });
  });
});
