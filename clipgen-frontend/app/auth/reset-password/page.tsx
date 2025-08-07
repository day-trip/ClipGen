'use server';

import Form from 'next/form';
import Link from 'next/link';
import { resetPassword } from '../actions';
import { redirectIfAuthenticated } from '../../lib/auth-check';
import SubmitButton from "@/app/auth/components/submit-button";

export default async function ResetPasswordPage({
                                                    searchParams,
                                                }: {
    searchParams: Promise<{ email?: string; error?: string }>;
}) {
    await redirectIfAuthenticated();
    const { email, error } = await searchParams;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-gray-900">Create new password</h2>
                    <p className="mt-2 text-gray-600">
                        Enter the code we sent to <strong>{email}</strong>
                    </p>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                        {error}
                    </div>
                )}

                <Form action={resetPassword} className="space-y-6">
                    <input type="hidden" name="email" value={email} />

                    <div>
                        <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                            Reset Code
                        </label>
                        <input
                            id="code"
                            name="code"
                            type="text"
                            required
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Enter 6-digit code"
                        />
                    </div>

                    <div>
                        <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                            New Password
                        </label>
                        <input
                            id="newPassword"
                            name="newPassword"
                            type="password"
                            required
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            Must be at least 8 characters with uppercase, lowercase, and numbers
                        </p>
                    </div>

                    <SubmitButton>Reset password</SubmitButton>
                </Form>

                <div className="text-center">
                    <Link href="/auth/signin" className="text-sm text-blue-600 hover:text-blue-500">
                        Back to sign in
                    </Link>
                </div>
            </div>
        </div>
    );
}