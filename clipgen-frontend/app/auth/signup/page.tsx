'use server';

import Form from 'next/form';
import Link from 'next/link';
import { signUp } from '../actions';
import { redirectIfAuthenticated } from '../../lib/auth-check';
import SubmitButton from "@/app/auth/components/submit-button";

export default async function SignUpPage({searchParams}: {searchParams: Promise<{ error?: string }>}) {
    await redirectIfAuthenticated();
    const { error } = await searchParams;

    return <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900">Create account</h2>
                <p className="mt-2 text-gray-600">Join Clipgen today</p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {error}
                </div>
            )}

            <Form action={signUp} className="space-y-6">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                        Email
                    </label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />
                </div>

                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                        Password
                    </label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                        Must be at least 8 characters with uppercase, lowercase, and numbers
                    </p>
                </div>

                <div>
                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                        Confirm Password
                    </label>
                    <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        required
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />
                </div>

                <SubmitButton>Create account</SubmitButton>
            </Form>

            <div className="text-center">
                    <span className="text-sm text-gray-600">
                      Already have an account?{' '}
                        <Link href="/auth/signin" className="text-orange-500 hover:text-orange-400 transition-colors">
                        Sign in
                      </Link>
                    </span>
            </div>
        </div>
    </div>
}