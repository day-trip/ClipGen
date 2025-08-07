'use server';

import Form from 'next/form';
import Link from 'next/link';
import { forgotPassword } from '../actions';
import { redirectIfAuthenticated } from '../../lib/auth-check';
import SubmitButton from "@/app/auth/components/submit-button";

export default async function ForgotPasswordPage({
                                                     searchParams,
                                                 }: {
    searchParams: Promise<{ error?: string }>;
}) {
    await redirectIfAuthenticated();
    const { error } = await searchParams;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-gray-900">Reset password</h2>
                    <p className="mt-2 text-gray-600">
                        Enter your email and we&#39;ll send you a reset code
                    </p>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                        {error}
                    </div>
                )}

                <Form action={forgotPassword} className="space-y-6">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                            Email
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    <SubmitButton>Send reset code</SubmitButton>
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