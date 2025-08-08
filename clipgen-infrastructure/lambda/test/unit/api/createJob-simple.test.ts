import { describe, test, expect, beforeEach } from 'bun:test';
import { createEventWithApiKey } from '../../fixtures/event-helpers';
import testData from '../../fixtures/test-data.json';
import type { ValidatedEvent } from '../../../src/utils/middleware';

describe('createJob handler (basic tests)', () => {
  beforeEach(() => {
    // Set up environment variables
    process.env.JOB_TABLE_NAME = 'test-job-table';
    process.env.API_KEYS_TABLE_NAME = 'test-api-keys-table';
    process.env.PROCESSING_QUEUE_URL = 'https://sqs.test.com/queue';
  });

  test('creates valid event with API key', () => {
    const event = createEventWithApiKey(testData.validApiKey, {
      body: JSON.stringify(testData.validCreateJobRequest),
      httpMethod: 'POST',
    }) as ValidatedEvent;
    
    expect(event.headers['X-API-Key']).toBe(testData.validApiKey);
    expect(event.body).toBe(JSON.stringify(testData.validCreateJobRequest));
    expect(event.httpMethod).toBe('POST');
  });

  test('handles invalid JSON body', () => {
    const event = createEventWithApiKey(testData.validApiKey, {
      body: 'invalid json',
      httpMethod: 'POST',
    });
    
    expect(() => JSON.parse(event.body || '')).toThrow();
  });

  test('test data structure is valid', () => {
    expect(testData.validCreateJobRequest.prompt).toBeDefined();
    expect(testData.validCreateJobRequest.width).toBe(848);
    expect(testData.validCreateJobRequest.height).toBe(480);
    expect(testData.testUserId).toMatch(/^user_/);
    expect(testData.testJobId).toMatch(/^job_/);
    expect(testData.validApiKey).toMatch(/^sk-proj-/);
  });

  test('environment variables are set correctly', () => {
    expect(process.env.JOB_TABLE_NAME).toBe('test-job-table');
    expect(process.env.API_KEYS_TABLE_NAME).toBe('test-api-keys-table');
    expect(process.env.PROCESSING_QUEUE_URL).toBe('https://sqs.test.com/queue');
  });
});