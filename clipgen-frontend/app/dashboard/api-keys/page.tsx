import { requireAuth } from '../../lib/auth-check';
import CreateApiKeyForm from './components/create-api-key-form';
import {getApiKeys} from "@/app/dashboard/api-keys/actions";
import DeleteApiKeyButton from './components/delete-api-key-button';
import React, { Suspense } from "react";
import { ApiKeyItemSkeleton } from '@/app/components/loading-spinner';

async function ApiKeysList() {
    const apiKeys = await getApiKeys();

    if (apiKeys.length === 0) {
        return <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <div className="text-gray-400 mb-4">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No API Keys</h3>
            <p className="text-gray-500">Create your first API key to start using the Clipgen API.</p>
        </div>
    }

    return <div className="px-5">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Your API Keys</h2>

        <div className="divide-y divide-gray-200">
            {apiKeys.map((key: any) => (
                <div key={key.apiKey} className="py-4 flex items-center justify-between">
                    <div className="flex-1">
                        <div className="flex items-center gap-3">
                            <h3 className="font-medium text-gray-900">{key.name}</h3>
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                key.isActive
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-700'
                            }`}>
                                    {key.isActive ? 'Active' : 'Inactive'}
                                </span>
                        </div>

                        <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
                            <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                            {key.lastUsed && (
                                <span>Last used {new Date(key.lastUsed).toLocaleDateString()}</span>
                            )}
                        </div>

                        <div className="mt-2">
                            <code className="text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded">
                                {key.apiKey.substring(0, 8)}...{key.apiKey.substring(key.apiKey.length - 4)}
                            </code>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <DeleteApiKeyButton apiKey={key.apiKey} />
                    </div>
                </div>
            ))}
        </div>
    </div>
}

export default async function ApiKeysPage() {
    await requireAuth();

    return <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">API Access</h1>
            <p className="text-gray-600">
                Manage your API keys to authenticate requests to the Clipgen API.
            </p>
        </div>

        <div className="grid gap-12">
            <CreateApiKeyForm />
            <Suspense fallback={
                <div className="px-5">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-2">Your API Keys</h2>
                    <div className="divide-y divide-gray-200">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <ApiKeyItemSkeleton key={i} />
                        ))}
                    </div>
                </div>
            }>
                <ApiKeysList/>
            </Suspense>
        </div>
    </div>
}