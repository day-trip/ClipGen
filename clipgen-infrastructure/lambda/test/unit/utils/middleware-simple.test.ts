import { describe, test, expect } from 'bun:test';
import { errorResponse, successResponse } from '../../../src/utils/middleware';

describe('middleware utilities', () => {
  test('errorResponse creates proper error response', () => {
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

  test('successResponse creates proper success response with default status', () => {
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

  test('successResponse creates proper success response with custom status', () => {
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

  test('CORS headers are always included', () => {
    const errorResp = errorResponse(500, 'Server error');
    const successResp = successResponse({ data: 'test' });

    expect(errorResp.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(successResp.headers!['Access-Control-Allow-Origin']).toBe('*');
  });

  test('content type is always JSON', () => {
    const errorResp = errorResponse(400, 'Bad request');
    const successResp = successResponse({ data: 'test' });

    expect(errorResp.headers!['Content-Type']).toBe('application/json');
    expect(successResp.headers!['Content-Type']).toBe('application/json');
  });
});