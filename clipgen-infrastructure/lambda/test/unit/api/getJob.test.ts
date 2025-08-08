import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { createEventWithApiKey } from '../../fixtures/event-helpers';
import testData from '../../fixtures/test-data.json';
import type { ValidatedEvent } from '../../../src/utils/middleware';

// Mock dependencies using Bun's mock function
const mockGetJob = mock(() => Promise.resolve(null));

// Mock JobService
mock.module('../../../src/services/jobService', () => ({
  JobService: {
    getJob: mockGetJob,
  },
}));

// Mock middleware to pass through
mock.module('../../../src/utils/middleware', () => ({
  withAuth: (handlerFn: any) => handlerFn,
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

// Import handler after mocks are set up
import { handler } from '../../../src/api/getJob';

describe.skip('getJob handler', () => {
  beforeEach(() => {
    mockGetJob.mockClear();

    // Set up environment variables
    process.env.JOB_TABLE_NAME = 'test-job-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
  });

  test('successfully retrieves existing job', async () => {
    const mockJob = {
      jobId: testData.testJobId,
      status: 'queued',
      prompt: testData.jobRecord.input_data.prompt,
      createdAt: testData.jobRecord.createdAt,
      ticketNumber: testData.jobRecord.ticketNumber,
    };
    mockGetJob.mockResolvedValue(mockJob);

    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: testData.testJobId },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(mockJob);
    expect(mockGetJob).toHaveBeenCalledWith(
        testData.testUserId,
        testData.testJobId,
        { includeSignedUrl: true }
    );
  });

  test('returns 404 for non-existent job', async () => {
    mockGetJob.mockResolvedValue(null);

    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: 'nonexistent-job' },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBe('Job not found');
  });

  test('returns 400 for missing jobId parameter', async () => {
    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: null,
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Job ID is required');
    expect(mockGetJob).not.toHaveBeenCalled();
  });

  test('returns 400 for empty jobId parameter', async () => {
    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: '' },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Job ID is required');
    expect(mockGetJob).not.toHaveBeenCalled();
  });

  test('returns 500 when JobService throws error', async () => {
    const error = new Error('Database connection failed');
    mockGetJob.mockRejectedValue(error);

    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: testData.testJobId },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Database connection failed');
  });

  test('returns 500 for non-Error exceptions', async () => {
    mockGetJob.mockRejectedValue('String error');

    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: testData.testJobId },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Failed to retrieve job');
  });

  test('calls JobService with includeSignedUrl=true for public API', async () => {
    const mockJob = {
      jobId: testData.testJobId,
      status: 'completed',
      prompt: testData.completedJobRecord.input_data.prompt,
      createdAt: testData.completedJobRecord.createdAt,
      completedAt: testData.completedJobRecord.completedAt,
      videoUrl: 'https://signed-url.amazonaws.com/video.mp4',
      ticketNumber: testData.completedJobRecord.ticketNumber,
    };
    mockGetJob.mockResolvedValue(mockJob);

    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: testData.testJobId },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockGetJob).toHaveBeenCalledWith(
        testData.testUserId,
        testData.testJobId,
        { includeSignedUrl: true }
    );
  });

  test('response includes CORS headers', async () => {
    const mockJob = {
      jobId: testData.testJobId,
      status: 'queued',
      prompt: testData.jobRecord.input_data.prompt,
      createdAt: testData.jobRecord.createdAt,
      ticketNumber: testData.jobRecord.ticketNumber,
    };
    mockGetJob.mockResolvedValue(mockJob);

    const event = createEventWithApiKey(testData.validApiKey, {
      pathParameters: { jobId: testData.testJobId },
      httpMethod: 'GET',
    }) as ValidatedEvent;
    event.userId = testData.testUserId;

    const result = await handler(event);

    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
  });
});