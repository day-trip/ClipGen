'use server';

import Form from 'next/form';
import Link from 'next/link';
import {signIn} from '../actions';
import {redirectIfAuthenticated} from '../../lib/auth-check';
import SubmitButton from "@/app/auth/components/submit-button";

export default async function SignInPage({
                                             searchParams,
                                         }: {
    searchParams: Promise<{ error?: string; message?: string }>;
}) {
    await redirectIfAuthenticated();

    const {error, message} = await searchParams;

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="max-w-md w-full space-y-8 p-8 bg-white ring-1 ring-[#e3d4bf] rounded-lg shadow">
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-gray-900">Sign in</h2>
                    <p className="mt-2 text-gray-600">to your Mochi account</p>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                        {error}
                    </div>
                )}

                {message && (
                    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
                        {message}
                    </div>
                )}

                <Form action={signIn} className="space-y-6">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                            Email
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            className="mt-1 block w-full px-3 py-2 border border-[#e3d4bf] rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
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
                            className="mt-1 block w-full px-3 py-2 border border-[#e3d4bf] rounded-md focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                        />
                    </div>

                    <SubmitButton>Sign in</SubmitButton>
                </Form>

                {/*<div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-300"/>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-white text-gray-500">Or continue with</span>
                    </div>
                </div>


                <a href="/auth/google" // You'll handle this with a route handler
                   className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                >
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                        <path fill="#4285F4"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05"
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Google
                </a>*/}

                <div className="text-center space-y-2">
                    <Link href="/auth/forgot-password" className="text-sm text-orange-400 hover:text-orange-300 transition-colors">
                        Forgot your password?
                    </Link>
                    <div className="text-sm text-gray-600">
                        Don&#39;t have an account?{' '}
                        <Link href="/auth/signup" className="text-orange-400 hover:text-orange-300 transition-colors">
                            Sign up
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}