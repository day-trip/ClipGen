import type { APIGatewayProxyEvent } from 'aws-lambda';

export function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'testapi',
      authorizer: {},
      httpMethod: 'GET',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'Custom User Agent String',
        userArn: null,
        clientCert: null
      },
      path: '/',
      protocol: 'HTTP/1.1',
      requestId: 'test-request-id',
      requestTime: '09/Apr/2015:12:34:56 +0000',
      requestTimeEpoch: 1428582896000,
      resourceId: 'test-resource',
      resourcePath: '/',
      stage: 'test',
    },
    resource: '/',
    ...overrides,
  };
}

export function createEventWithApiKey(apiKey: string, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return createMockEvent({
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    ...overrides,
  });
}

export function createEventWithCognitoAuth(token: string, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return createMockEvent({
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...overrides,
  });
}

export function createPostEvent(body: any, overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return createMockEvent({
    httpMethod: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    ...overrides,
  });
}