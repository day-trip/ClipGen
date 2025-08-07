import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { importJWK, jwtVerify } from 'jose';
import { COGNITO_CONFIG } from './auth';

// Cache for Cognito public keys
let cognitoKeys: any = null;
let keysExpiry = 0;

async function getCognitoPublicKeys() {
    const now = Date.now();

    // Cache keys for 1 hour
    if (cognitoKeys && now < keysExpiry) {
        return cognitoKeys;
    }

    const response = await fetch(
        `https://cognito-idp.${COGNITO_CONFIG.region}.amazonaws.com/${COGNITO_CONFIG.userPoolId}/.well-known/jwks.json`
    );

    cognitoKeys = await response.json();
    keysExpiry = now + (60 * 60 * 1000); // 1 hour

    return cognitoKeys;
}

async function verifyJWT(token: string) {
    try {
        // Decode the JWT header to get the key ID (kid)
        const [headerB64] = token.split('.');
        const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

        const jwks = await getCognitoPublicKeys();
        const key = jwks.keys.find((k: any) => k.kid === header.kid);

        if (!key) {
            throw new Error('Key not found');
        }

        // Import the JWK key
        const cryptoKey = await importJWK(key, key.alg);

        // Verify the JWT
        const { payload } = await jwtVerify(token, cryptoKey, {
            issuer: `https://cognito-idp.${COGNITO_CONFIG.region}.amazonaws.com/${COGNITO_CONFIG.userPoolId}`,
            audience: COGNITO_CONFIG.clientId,
        });

        return payload;
    } catch (error) {
        console.error('JWT verification failed:', error);
        throw new Error('Invalid token');
    }
}

export async function getCurrentUser() {
    const cookieStore = await cookies();
    const idToken = cookieStore.get('id_token')?.value;

    if (!idToken) {
        throw new Error('No tokens found');
    }

    try {
        const payload = await verifyJWT(idToken);

        return {
            username: payload.email as string,
            email: payload.email as string,
            sub: payload.sub as string,
            // Add any other claims you need
        };
    } catch (error) {
        console.error('Token verification error:', error);
        throw new Error('Invalid token');
    }
}

export async function requireAuth() {
    try {
        return await getCurrentUser();
    } catch {
        redirect('/auth/signin');
    }
}

export async function redirectIfAuthenticated() {
    try {
        await getCurrentUser();
        redirect('/dashboard');
    } catch (error: any) {
        if (error.message === "NEXT_REDIRECT") {
            throw error;
        }

        // User not authenticated, continue
    }
}

// Helper function to get access token for API calls
export async function getAccessToken(): Promise<string | null> {
    const cookieStore = await cookies();
    return cookieStore.get('access_token')?.value || null;
}