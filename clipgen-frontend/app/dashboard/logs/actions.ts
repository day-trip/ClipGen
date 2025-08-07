'use server';

import { callApiWithAuth } from '@/app/lib/auth';

export async function getLogs(cursor?: string) {
    try {
        const params = new URLSearchParams();
        if (cursor) params.append('cursor', cursor);

        const endpoint = `/internal/logs${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await callApiWithAuth(endpoint);

        if (!response.ok) {
            throw new Error('Failed to fetch logs');
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error: any) {
        console.error('Get logs error:', error);
        return { success: false, error: error.message || 'Failed to fetch logs' };
    }
}

export async function downloadVideo(jobId: string) {
    try {
        const response = await callApiWithAuth(`/internal/download/${jobId}`, {
            method: 'POST',
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to generate download URL');
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error: any) {
        console.error('Download video error:', error);
        return { success: false, error: error.message || 'Failed to generate download URL' };
    }
}