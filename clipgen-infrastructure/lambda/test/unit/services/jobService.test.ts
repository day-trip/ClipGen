import { test, expect, describe, beforeEach, beforeAll, mock } from 'bun:test';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import testData from '../../fixtures/test-data.json';

// Mock the clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);
const s3Mock = mockClient(S3Client);

// Mock functions
const mockGetSignedUrl = mock(() => Promise.resolve('https://signed-url.amazonaws.com/video.mp4'));
const mockGetNextTicket = mock(() => Promise.resolve(1));
const mockCreateJobSchemaParse = mock(() => ({ success: true, data: testData.validCreateJobRequest }));
const mockFormatValidationErrors = mock(() => 'Validation failed');

// Mock external modules
mock.module('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

mock.module('../../../src/utils/queueCounter', () => ({
  getNextTicket: mockGetNextTicket,
}));

mock.module('../../../src/types/schemas', () => ({
  createJobSchema: {
    safeParse: mockCreateJobSchemaParse,
  },
  formatValidationErrors: mockFormatValidationErrors,
}));

// Use dynamic import to avoid conflicts
let JobService: any;

describe.skip('JobService', () => {
  beforeAll(async () => {
    // Import JobService after mocks are established  
    const module = await import('../../../src/services/jobService');
    JobService = module.JobService;
  });

  beforeEach(() => {
    // Reset all mocks
    ddbMock.reset();
    sqsMock.reset();
    s3Mock.reset();
    mockGetSignedUrl.mockClear();
    mockGetNextTicket.mockClear();
    mockCreateJobSchemaParse.mockClear();
    mockFormatValidationErrors.mockClear();

    // Set up environment variables
    process.env.JOB_TABLE_NAME = 'test-job-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
    process.env.PROCESSING_QUEUE_URL = 'https://sqs.test.com/queue';
    process.env.MEDIA_BUCKET_NAME = 'test-media-bucket';
  });

  describe('createJob', () => {
    test('successfully creates job with valid data', async () => {
      // Mock validation success
      mockCreateJobSchemaParse.mockReturnValueOnce({
        success: true,
        data: testData.validCreateJobRequest,
      });

      // Mock getNextTicket
      mockGetNextTicket.mockResolvedValue(1);

      // Mock DynamoDB put
      ddbMock.on(PutCommand).resolves({});

      // Mock SQS send
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      const result = await JobService.createJob(testData.testUserId, testData.validCreateJobRequest);

      // Verify result structure
      expect(result).toMatchObject({
        jobId: expect.stringMatching(/^job_/),
        status: 'queued',
        ticketNumber: 1,
        createdAt: expect.any(String),
      });

      // Verify DynamoDB was called
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0]!;
      expect(putCall.args[0].input.TableName).toBe('test-job-table');
      expect(putCall.args[0].input.Item).toMatchObject({
        userId: testData.testUserId,
        jobId: expect.stringMatching(/^job_/),
        status: 'queued',
        input_data: testData.validCreateJobRequest,
      });

      // Verify SQS was called
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0]!;
      expect(sqsCall.args[0].input.QueueUrl).toBe('https://sqs.test.com/queue');
    });

    test('throws error for invalid data', async () => {
      const validationError = {
        success: false,
        error: { issues: [{ message: 'prompt is required' }] },
      };
      mockCreateJobSchemaParse.mockReturnValueOnce(validationError);
      mockFormatValidationErrors.mockReturnValue('Validation failed: prompt is required');

      await expect(
          JobService.createJob(testData.testUserId, testData.invalidCreateJobRequest)
      ).rejects.toThrow('Validation failed: prompt is required');

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });

    test('uses default values for optional parameters', async () => {
      const minimalRequest = { prompt: 'Test prompt' };

      mockCreateJobSchemaParse.mockReturnValueOnce({
        success: true,
        data: minimalRequest,
      });
      mockGetNextTicket.mockResolvedValue(2);
      ddbMock.on(PutCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      await JobService.createJob(testData.testUserId, minimalRequest);

      const putCall = ddbMock.commandCalls(PutCommand)[0]!;
      expect(putCall.args[0].input.Item!.input_data).toMatchObject({
        prompt: 'Test prompt',
        width: 848,
        height: 480,
        num_frames: 25,
        num_inference_steps: 64,
        guidance_scale: 6.0,
        negative_prompt: '',
        seed: expect.any(Number),
      });
    });
  });

  describe('getJob', () => {
    test('successfully retrieves existing job', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: testData.jobRecord,
      });

      const result = await JobService.getJob(testData.testUserId, testData.testJobId);

      expect(result).toEqual({
        jobId: testData.testJobId,
        status: 'queued',
        prompt: testData.jobRecord.input_data.prompt,
        createdAt: testData.jobRecord.createdAt,
        completedAt: undefined,
        videoUrl: null,
        ticketNumber: testData.jobRecord.ticketNumber,
        errorMessage: undefined,
      });

      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
      const getCall = ddbMock.commandCalls(GetCommand)[0];
      expect(getCall!.args[0].input.Key).toEqual({
        userId: testData.testUserId,
        jobId: testData.testJobId,
      });
    });

    test('returns null for non-existent job', async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await JobService.getJob(testData.testUserId, 'nonexistent-job');

      expect(result).toBeNull();
    });

    test('generates signed URL for completed job with includeSignedUrl=true', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: testData.completedJobRecord,
      });

      mockGetSignedUrl.mockResolvedValue('https://signed-url.amazonaws.com/video.mp4');

      const result = await JobService.getJob(testData.testUserId, testData.testJobId, {
        includeSignedUrl: true,
      });

      expect(result?.videoUrl).toBe('https://signed-url.amazonaws.com/video.mp4');
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    test('returns S3 URL for completed job without includeSignedUrl', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: testData.completedJobRecord,
      });

      const result = await JobService.getJob(testData.testUserId, testData.testJobId);

      expect(result?.videoUrl).toBe('s3://test-bucket/videos/job_abcdef1234567890abcdef1234567890ab.mp4');
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    test('handles legacy outputKey field', async () => {
      const legacyJobRecord = {
        ...testData.completedJobRecord,
        videoUrl: undefined,
        outputKey: 'videos/legacy-job.mp4',
        status: 'completed'
      };

      ddbMock.on(GetCommand).resolves({
        Item: legacyJobRecord,
      });

      const result = await JobService.getJob(testData.testUserId, testData.testJobId);

      expect(result?.videoUrl).toBe(null);
    });

    test('handles job without video URL', async () => {
      const incompleteJob = {
        ...testData.jobRecord,
        status: 'processing',
      };

      ddbMock.on(GetCommand).resolves({
        Item: incompleteJob,
      });

      const result = await JobService.getJob(testData.testUserId, testData.testJobId);

      expect(result?.videoUrl).toBeNull();
    });
  });
});
