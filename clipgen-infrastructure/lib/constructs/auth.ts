import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthProps {
    removalPolicy?: cdk.RemovalPolicy;
}

export class AuthConstruct extends Construct {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;

    constructor(scope: Construct, id: string, props: AuthProps = {}) {
        super(scope, id);

        const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

        this.userPool = new cognito.UserPool(this, 'UserPool', {
            userPoolName: 'clipgen-users',
            selfSignUpEnabled: true,
            signInAliases: {email: true},
            autoVerify: {email: true},
            standardAttributes: {
                email: {required: true, mutable: true}
            },
            passwordPolicy: {
                minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true,
            },
            removalPolicy, // For dev
        });

        this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
            userPool: this.userPool,
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            // oAuth: {
            //     flows: {authorizationCodeGrant: true},
            //     scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
            //     callbackUrls: ['http://localhost:3000/auth/callback', 'https://yourdomain.com/auth/callback'],
            //     logoutUrls: ['http://localhost:3000', 'https://yourdomain.com'],
            // },
            generateSecret: false, // For web apps
        });

        // const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
        //     userPool,
        //     clientId: 'YOUR_GOOGLE_CLIENT_ID',
        //     clientSecretValue: SecretValue.unsafePlainText('YOUR_GOOGLE_CLIENT_SECRET'),
        //     scopes: ['email', 'profile'],
        //     attributeMapping: {
        //         email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        //         givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        //         familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        //     },
        // });

        // this.userPoolClient.node.addDependency(googleProvider);
    }
}