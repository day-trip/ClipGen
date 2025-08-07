import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {cookies} from "next/headers";

export const cognitoClient = new CognitoIdentityProviderClient({
    region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
});

export const COGNITO_CONFIG = {
    userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
    clientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
    region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
};

export async function callApiWithAuth(endpoint: string, options: RequestInit = {}) {
    const cookieStore = await cookies();
    const idToken = cookieStore.get('id_token')?.value;

    if (!idToken) {
        throw new Error('Not authenticated');
    }

    // Make the API call
    const response = await fetch(`${process.env.API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
    });

    // If unauthorized, we can't refresh here - throw error for redirect
    if (response.status === 401) {
        throw new Error('Token expired - please sign in again');
    }

    return response;
}