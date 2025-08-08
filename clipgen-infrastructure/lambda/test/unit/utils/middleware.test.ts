import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createEventWithApiKey, createEventWithCognitoAuth, createMockEvent } from '../../fixtures/event-helpers';
import testData from '../../fixtures/test-data.json';

// Mock the DynamoDB client
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock external dependencies
const mockVerify = mock(() => {});
const mockJwksClient = mock(() => ({
  getSigningKey: mock((kid: string, callback: any) => {
    callback(null, { getPublicKey: () => 'mock-public-key' });
  })
}));

const mockApiKeySchema = mock(() => ({ success: true, data: testData.validApiKey }));

mock.module('jsonwebtoken', () => ({
  verify: mockVerify,
}));

mock.module('jwks-rsa', () => ({
  JwksClient: mockJwksClient,
}));

mock.module('../../../src/types/schemas', () => ({
  apiKeySchema: {
    safeParse: mockApiKeySchema,
  },
}));

// Set up environment variables before importing middleware
process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
process.env.JOB_TABLE_NAME = 'test-job-table';
process.env.USER_POOL_ID = 'us-east-1_TESTPOOL';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.AWS_REGION = 'us-east-1';

// Import middleware after setting up mocks and env vars
import {
  withAuth,
  withRateLimiting,
  withCognitoAuth,
  errorResponse,
  successResponse,
  type ValidatedEvent
} from '../../../src/utils/middleware';

describe('Middleware', () => {
  beforeEach(() => {
    ddbMock.reset();
    mockVerify.mockClear();
    mockJwksClient.mockClear();
    mockApiKeySchema.mockClear();
  });

  describe('errorResponse', () => {
    test('creates proper error response', () => {
      const response = errorResponse(400, 'Test error message');

      expect(response).toEqual({
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Test error message' })
      });
    });
  });

  describe('successResponse', () => {
    test('creates proper success response with default status code', () => {
      const data = { message: 'Success' };
      const response = successResponse(data);

      expect(response).toEqual({
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
      });
    });

    test('creates proper success response with custom status code', () => {
      const data = { id: '123' };
      const response = successResponse(data, 201);

      expect(response).toEqual({
        statusCode: 201,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
      });
    });
  });

  describe('withAuth', () => {
    const mockHandler = mock(() => Promise.resolve(successResponse({ message: 'Success' })));

    beforeEach(() => {
      mockHandler.mockClear();
    });

    test('successfully authenticates valid API key', async () => {
      // Mock API key schema validation
      mockApiKeySchema.mockReturnValue({ success: true, data: testData.validApiKey });
      
      // Mock active API key in database
      ddbMock.on(GetCommand).resolves({
        Item: testData.apiKeyRecord
      });

      mockHandler.mockResolvedValue(successResponse({ message: 'Success' }));

      const event = createEventWithApiKey(testData.validApiKey);
      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(200);
      expect(mockHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: testData.testUserId,
            apiKey: testData.validApiKey,
          })
      );
    });

    test('rejects missing API key', async () => {
      const event = createMockEvent();
      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('API key is required. Include X-API-Key header.');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('rejects invalid API key format', async () => {
      // Mock API key schema validation failure
      mockApiKeySchema.mockReturnValue({ success: false, error: new Error('Invalid format') });
      
      const event = createEventWithApiKey(testData.invalidApiKey);
      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Invalid API key format');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('rejects non-existent API key', async () => {
      // Mock API key schema validation success
      mockApiKeySchema.mockReturnValue({ success: true, data: testData.validApiKey });
      
      ddbMock.on(GetCommand).resolves({});

      const event = createEventWithApiKey(testData.validApiKey);
      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Invalid or inactive API key');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('rejects inactive API key', async () => {
      // Mock API key schema validation success
      mockApiKeySchema.mockReturnValue({ success: true, data: testData.validApiKey });
      
      ddbMock.on(GetCommand).resolves({
        Item: testData.inactiveApiKeyRecord
      });

      const event = createEventWithApiKey(testData.validApiKey);
      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Invalid or inactive API key');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('handles database errors', async () => {
      // Mock API key schema validation success
      mockApiKeySchema.mockReturnValue({ success: true, data: testData.validApiKey });
      
      ddbMock.on(GetCommand).rejects(new Error('Database error'));

      const event = createEventWithApiKey(testData.validApiKey);
      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Internal server error');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('handles case-insensitive API key header', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: testData.apiKeyRecord
      });

      mockHandler.mockResolvedValue(successResponse({ message: 'Success' }));

      // Test lowercase header
      const event = createMockEvent({
        headers: { 'x-api-key': testData.validApiKey }
      });

      const wrappedHandler = withAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(200);
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('withRateLimiting', () => {
    const mockHandler = mock(() => Promise.resolve(successResponse({ message: 'Success' })));
    const mockValidatedEvent: ValidatedEvent = {
      ...createMockEvent(),
      userId: testData.testUserId,
      apiKey: testData.validApiKey,
    };

    beforeEach(() => {
      mockHandler.mockClear();
    });

    test('allows request when under rate limit', async () => {
      // Mock query returning few recent jobs
      ddbMock.on(QueryCommand).resolves({
        Count: 5
      });

      mockHandler.mockResolvedValue(successResponse({ message: 'Success' }));

      const wrappedHandler = withRateLimiting(mockHandler);
      const result = await wrappedHandler(mockValidatedEvent);

      expect(result.statusCode).toBe(200);
      expect(mockHandler).toHaveBeenCalledWith(mockValidatedEvent);
    });

    test('rejects request when over rate limit', async () => {
      // Mock query returning many recent jobs
      ddbMock.on(QueryCommand).resolves({
        Count: 15
      });

      const wrappedHandler = withRateLimiting(mockHandler);
      const result = await wrappedHandler(mockValidatedEvent);

      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body).error).toBe('Rate limit exceeded. Try again in 60 seconds.');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('queries correct time window', async () => {
      const currentTime = Date.now();
      const oneMinuteAgo = currentTime - 60000;

      // Mock Date.now to return consistent value
      const originalDateNow = Date.now;
      Date.now = () => currentTime;

      ddbMock.on(QueryCommand).resolves({ Count: 0 });
      mockHandler.mockResolvedValue(successResponse({ message: 'Success' }));

      const wrappedHandler = withRateLimiting(mockHandler);
      await wrappedHandler(mockValidatedEvent);

      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0]!;
      expect(queryCall.args[0].input.ExpressionAttributeValues).toEqual({
        ':userId': testData.testUserId,
        ':oneMinuteAgo': oneMinuteAgo,
      });

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    test('handles database errors', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('Database error'));

      const wrappedHandler = withRateLimiting(mockHandler);

      // Should still call the handler if rate limit check fails
      await expect(wrappedHandler(mockValidatedEvent)).rejects.toThrow('Database error');
    });
  });

  describe.skip('withCognitoAuth', () => {
    const mockHandler = mock(() => Promise.resolve(successResponse({ message: 'Success' })));

    beforeEach(() => {
      mockHandler.mockClear();

      // Reset JwksClient mock
      mockJwksClient.mockImplementation(() => ({
        getSigningKey: mock((kid: string, callback: any) => {
          callback(null, { getPublicKey: () => 'mock-public-key' });
        })
      }));
    });

    test('successfully authenticates valid JWT token', async () => {
      mockVerify.mockImplementation((token, key, options, callback: any) => {
        callback(null, testData.cognitoJwtPayload);
      });

      mockHandler.mockResolvedValue(successResponse({ message: 'Success' }));

      // Create a valid JWT token format (header.payload.signature)
      const mockJwtHeader = Buffer.from(JSON.stringify({ kid: 'test-key-id' })).toString('base64url');
      const mockJwtPayload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
      const mockJwtSignature = 'mock-signature';
      const mockJwtToken = `${mockJwtHeader}.${mockJwtPayload}.${mockJwtSignature}`;
      
      const event = createEventWithCognitoAuth(mockJwtToken);
      const wrappedHandler = withCognitoAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(200);
      expect(mockHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: testData.cognitoJwtPayload.sub,
            cognitoSub: testData.cognitoJwtPayload.sub,
            email: testData.cognitoJwtPayload.email,
            username: testData.cognitoJwtPayload['cognito:username'],
          })
      );
    });

    test('rejects missing Authorization header', async () => {
      const event = createMockEvent();
      const wrappedHandler = withCognitoAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Bearer token required in Authorization header');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('rejects invalid Bearer token format', async () => {
      const event = createMockEvent({
        headers: { Authorization: 'Invalid token' }
      });

      const wrappedHandler = withCognitoAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Bearer token required in Authorization header');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('rejects invalid JWT token', async () => {
      mockVerify.mockImplementation((token, key, options, callback: any) => {
        callback(new Error('Invalid token'), null);
      });

      // Create a valid JWT token format for parsing but will fail verification
      const mockJwtHeader = Buffer.from(JSON.stringify({ kid: 'test-key-id' })).toString('base64url');
      const mockJwtPayload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
      const mockJwtSignature = 'invalid-signature';
      const mockJwtToken = `${mockJwtHeader}.${mockJwtPayload}.${mockJwtSignature}`;
      
      const event = createEventWithCognitoAuth(mockJwtToken);
      const wrappedHandler = withCognitoAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Invalid or expired token');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('handles JWKS errors', async () => {
      mockJwksClient.mockImplementation(() => ({
        getSigningKey: mock((kid: string, callback: any) => {
          callback(new Error('JWKS error'), null);
        })
      }));

      // Create a valid JWT token format for parsing
      const mockJwtHeader = Buffer.from(JSON.stringify({ kid: 'test-key-id' })).toString('base64url');
      const mockJwtPayload = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
      const mockJwtSignature = 'mock-signature';
      const mockJwtToken = `${mockJwtHeader}.${mockJwtPayload}.${mockJwtSignature}`;
      
      const event = createEventWithCognitoAuth(mockJwtToken);
      const wrappedHandler = withCognitoAuth(mockHandler);
      const result = await wrappedHandler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Invalid or expired token');
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
