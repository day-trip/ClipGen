'use server';

import {
    AuthFlowType,
    ConfirmForgotPasswordCommand,
    ConfirmSignUpCommand,
    ForgotPasswordCommand,
    InitiateAuthCommand,
    SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {COGNITO_CONFIG, cognitoClient} from '../lib/auth';
import {redirect} from 'next/navigation';
import {cookies} from "next/headers";

async function setAuthCookies(accessToken: string, idToken: string, refreshToken: string) {
    const cookieStore = await cookies();

    // Set secure, httpOnly cookies
    cookieStore.set('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour
        path: '/',
    });

    cookieStore.set('id_token', idToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour
        path: '/',
    });

    cookieStore.set('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/',
    });
}

export async function signIn(formData: FormData) {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
        const command = new InitiateAuthCommand({
            AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
            ClientId: COGNITO_CONFIG.clientId,
            AuthParameters: {
                USERNAME: email,
                PASSWORD: password,
            },
        });

        const response = await cognitoClient.send(command);

        if (response.AuthenticationResult) {
            const {AccessToken, IdToken, RefreshToken} = response.AuthenticationResult;
            await setAuthCookies(AccessToken!, IdToken!, RefreshToken!);
            redirect('/dashboard');
        }

        if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            // Handle new password required
            redirect(`/auth/new-password?session=${response.Session}&email=${encodeURIComponent(email)}`);
        }

    } catch (error: any) {
        if (error.message === "NEXT_REDIRECT") {
            throw error;
        }

        console.error('Sign in error:', error);

        if (error.name === 'UserNotConfirmedException') {
            redirect(`/auth/verify?email=${encodeURIComponent(email)}`);
        }

        redirect(`/auth/signin?error=${encodeURIComponent(error.message || 'Sign in failed')}`);
    }
}

export async function signUp(formData: FormData) {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
        const command = new SignUpCommand({
            ClientId: COGNITO_CONFIG.clientId,
            Username: email,
            Password: password,
            UserAttributes: [
                {
                    Name: 'email',
                    Value: email,
                },
            ],
        });

        await cognitoClient.send(command);
        redirect(`/auth/verify?email=${encodeURIComponent(email)}`);

    } catch (error: any) {
        if (error.message === "NEXT_REDIRECT") {
            throw error;
        }

        console.error('Sign up error:', error);
        redirect(`/auth/signup?error=${encodeURIComponent(error.message || 'Sign up failed')}`);
    }
}

export async function verify(formData: FormData) {
    const email = formData.get('email') as string;
    const code = formData.get('code') as string;

    try {
        const command = new ConfirmSignUpCommand({
            ClientId: COGNITO_CONFIG.clientId,
            Username: email,
            ConfirmationCode: code,
        });

        await cognitoClient.send(command);

        // Auto sign in after verification
        const password = formData.get('password') as string;
        if (password) {
            const signInCommand = new InitiateAuthCommand({
                AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
                ClientId: COGNITO_CONFIG.clientId,
                AuthParameters: {
                    USERNAME: email,
                    PASSWORD: password,
                },
            });

            const response = await cognitoClient.send(signInCommand);
            if (response.AuthenticationResult) {
                const {AccessToken, IdToken, RefreshToken} = response.AuthenticationResult;
                await setAuthCookies(AccessToken!, IdToken!, RefreshToken!);
            }
        }

        redirect('/dashboard');

    } catch (error: any) {
        if (error.message === "NEXT_REDIRECT") {
            throw error;
        }

        console.error('Verification error:', error);
        redirect(`/auth/verify?email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`);
    }
}

export async function forgotPassword(formData: FormData) {
    const email = formData.get('email') as string;

    try {
        const command = new ForgotPasswordCommand({
            ClientId: COGNITO_CONFIG.clientId,
            Username: email,
        });

        await cognitoClient.send(command);
        redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);

    } catch (error: any) {
        if (error.message === "NEXT_REDIRECT") {
            throw error;
        }

        console.error('Forgot password error:', error);
        redirect(`/auth/forgot-password?error=${encodeURIComponent(error.message)}`);
    }
}

export async function resetPassword(formData: FormData) {
    const email = formData.get('email') as string;
    const code = formData.get('code') as string;
    const newPassword = formData.get('newPassword') as string;

    try {
        const command = new ConfirmForgotPasswordCommand({
            ClientId: COGNITO_CONFIG.clientId,
            Username: email,
            ConfirmationCode: code,
            Password: newPassword,
        });

        await cognitoClient.send(command);
        redirect('/auth/signin?message=Password reset successful');

    } catch (error: any) {
        if (error.message === "NEXT_REDIRECT") {
            throw error;
        }

        console.error('Reset password error:', error);
        redirect(`/auth/reset-password?email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`);
    }
}

export async function refreshTokens(): Promise<boolean> {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

    if (!refreshToken) {
        return false;
    }

    try {
        const command = new InitiateAuthCommand({
            AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
            ClientId: COGNITO_CONFIG.clientId,
            AuthParameters: {
                REFRESH_TOKEN: refreshToken,
            },
        });

        const response = await cognitoClient.send(command);

        if (response.AuthenticationResult) {
            const { AccessToken, IdToken } = response.AuthenticationResult;

            // Update tokens (refresh token usually stays the same)
            await setAuthCookies(
                AccessToken!,
                IdToken!,
                response.AuthenticationResult.RefreshToken || refreshToken
            );

            return true;
        }

        return false;
    } catch (error) {
        console.error('Token refresh failed:', error);
        return false;
    }
}

export async function signOut() {
    const cookieStore = await cookies();

    // Clear all auth cookies
    cookieStore.delete('access_token');
    cookieStore.delete('id_token');
    cookieStore.delete('refresh_token');

    redirect('/auth/signin');
}