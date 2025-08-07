'use server';

import Form from 'next/form';
import { verify } from '../actions';
import SubmitButton from "@/app/auth/components/submit-button";

export default async function VerifyPage({
                                             searchParams,
                                         }: {
    searchParams: Promise<{ email?: string; error?: string }>;
}) {
    const { email, error } = await searchParams;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-gray-900">Verify your email</h2>
                    <p className="mt-2 text-gray-600">
                        We sent a verification code to <strong>{email}</strong>
                    </p>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                        {error}
                    </div>
                )}

                <Form action={verify} className="space-y-6">
                    <input type="hidden" name="email" value={email} />

                    <div>
                        <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                            Verification Code
                        </label>
                        <input
                            id="code"
                            name="code"
                            type="text"
                            required
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                            placeholder="Enter 6-digit code"
                        />
                    </div>

                    <SubmitButton>Verify Email</SubmitButton>
                </Form>
            </div>
        </div>
    );
}