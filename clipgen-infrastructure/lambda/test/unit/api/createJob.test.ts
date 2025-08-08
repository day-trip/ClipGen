import { handler } from '../../../src/api/createJob';
import { createEventWithApiKey } from '../../fixtures/event-helpers';
import testData from '../../fixtures/test-data.json';
import type { ValidatedEvent } from '../../../src/utils/middleware';
import { beforeEach, describe, expect, test, mock } from 'bun:test';

// Mock dependencies using Bun's mock function
const mockCreateJob = mock(() => Promise.resolve({
  jobId: testData.testJobId,
  status: 'queued',
  ticketNumber: 1,
  createdAt: testData.jobRecord.createdAt,
}));

// Mock JobService
mock.module('../../../src/services/jobService', () => ({
  JobService: {
    createJob: mockCreateJob,
  },
}));

// Mock middleware to pass through
mock.module('../../../src/utils/middleware', () => ({
  withAuth: (handlerFn: any) => handlerFn,
  withRateLimiting: (handlerFn: any) => handlerFn,
  errorResponse: (statusCode: number, message: string) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: message })
  }),
  successResponse: (data: any, statusCode = 200) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  })
}));

describe.skip('createJob handler', () => {
  beforeEach(() => {
    mockCreateJob.mockClear();
    
    // Set up environment variables
    process.env.JOB_TABLE_NAME = 'test-job-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
    process.env.PROCESSING_QUEUE_URL = 'https://sqs.test.com/queue';
  });

  test('successfully creates job with valid request', async () => {
    // Mock JobService.createJob
    const mockResult = {
      jobId: testData.testJobId,
      status: 'queued',
      ticketNumber: 1,
      createdAt: testData.jobRecord.createdAt,
    };
    mockCreateJob.mockResolvedValue(mockResult);

    // Create test event
    const event = createEventWithApiKey(testData.validApiKey, {
      body: JSON.stringify(testData.validCreateJobRequest),
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    // Execute handler
    const result = await handler(event);

    // Verify response
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual(mockResult);

    // Verify JobService was called correctly
    expect(mockCreateJob).toHaveBeenCalledWith(
      testData.testUserId,
      testData.validCreateJobRequest
    );
  });

  test('returns 400 for invalid JSON body', async () => {
    const event = createEventWithApiKey(testData.validApiKey, {
      body: 'invalid json',
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid JSON in request body');
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  test('returns 400 for missing body', async () => {
    const event = createEventWithApiKey(testData.validApiKey, {
      body: null,
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid JSON in request body');
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  test('returns 400 when JobService throws validation error', async () => {
    const validationError = new Error('Validation failed: prompt is required');
    mockCreateJob.mockRejectedValue(validationError);

    const event = createEventWithApiKey(testData.validApiKey, {
      body: JSON.stringify(testData.invalidCreateJobRequest),
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Validation failed: prompt is required');
  });

  test('returns 400 when JobService throws general error', async () => {
    const error = new Error('Database connection failed');
    mockCreateJob.mockRejectedValue(error);

    const event = createEventWithApiKey(testData.validApiKey, {
      body: JSON.stringify(testData.validCreateJobRequest),
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Database connection failed');
  });

  test('returns 400 for non-Error exceptions', async () => {
    mockCreateJob.mockRejectedValue('String error');

    const event = createEventWithApiKey(testData.validApiKey, {
      body: JSON.stringify(testData.validCreateJobRequest),
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Failed to create job');
  });

  test('response includes CORS headers', async () => {
    const mockResult = {
      jobId: testData.testJobId,
      status: 'queued',
      ticketNumber: 1,
      createdAt: testData.jobRecord.createdAt,
    };
    mockCreateJob.mockResolvedValue(mockResult);

    const event = createEventWithApiKey(testData.validApiKey, {
      body: JSON.stringify(testData.validCreateJobRequest),
      httpMethod: 'POST',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
  });
});