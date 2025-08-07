'use server';

import { callApiWithAuth } from '@/app/lib/auth';
import { revalidatePath } from 'next/cache';
import { sanitizeApiKeyName, safeJsonStringify } from '@/app/lib/sanitize';

export async function createApiKey(name: string) {
    try {
        // Sanitize the API key name
        const sanitizedName = sanitizeApiKeyName(name);

        const response = await callApiWithAuth('/internal/api-keys', {
            method: 'POST',
            body: safeJsonStringify({ name: sanitizedName }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to create API key');
        }

        const data = await response.json();

        // Revalidate the page to show updated list
        revalidatePath('/dashboard/api-keys');

        return { success: true, data };
    } catch (error: any) {
        console.error('Create API key error:', error);
        return { success: false, error: error.message || 'Failed to create API key' };
    }
}

export async function getApiKeys() {
    try {
        const response = await callApiWithAuth('/internal/api-keys');

        if (!response.ok) {
            throw new Error('Failed to fetch API keys');
        }

        const data = await response.json();
        return data.apiKeys || [];
    } catch (error) {
        console.error('Get API keys error:', error);
        return [];
    }
}

export async function deleteApiKey(apiKeyId: string) {
    try {
        const response = await callApiWithAuth(`/internal/api-keys/${apiKeyId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to delete API key');
        }

        // Revalidate the page to show updated list
        revalidatePath('/dashboard/api-keys');

        return { success: true };
    } catch (error: any) {
        console.error('Delete API key error:', error);
        return { success: false, error: error.message || 'Failed to delete API key' };
    }
}