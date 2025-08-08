import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthConstruct } from '../../lib/constructs/auth';

describe('AuthConstruct', () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack');
  });

  test('creates user pool with correct configuration', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'speechface-users',
      AutoVerifiedAttributes: ['email'],
      UsernameAttributes: ['email'],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireUppercase: true
        }
      }
    });
  });

  test('creates user pool client with correct configuration', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: [
        'ALLOW_USER_PASSWORD_AUTH',
        'ALLOW_USER_SRP_AUTH',
        'ALLOW_REFRESH_TOKEN_AUTH'
      ],
      GenerateSecret: false
    });
  });

  test('user pool allows self sign up', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: false
      }
    });
  });

  test('respects custom removal policy RETAIN', () => {
    new AuthConstruct(stack, 'Auth', {
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const template = Template.fromStack(stack);

    const userPools = template.findResources('AWS::Cognito::UserPool');
    Object.values(userPools).forEach(pool => {
      expect(pool.DeletionPolicy).toBe('Retain');
    });
  });

  test('uses default DESTROY removal policy', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    const userPools = template.findResources('AWS::Cognito::UserPool');
    Object.values(userPools).forEach(pool => {
      expect(pool.DeletionPolicy).toBe('Delete');
    });
  });

  test('user pool client references user pool correctly', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    // User pool client should reference the user pool
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const client = Object.values(clients)[0];
    
    expect(client.Properties.UserPoolId).toBeDefined();
    expect(client.Properties.UserPoolId.Ref).toBeDefined();
  });

  test('creates exactly one user pool and one client', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  test('email verification is configured', () => {
    new AuthConstruct(stack, 'Auth');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AutoVerifiedAttributes: ['email']
    });
  });
});