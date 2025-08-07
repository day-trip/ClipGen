'use server';

import { callApiWithAuth } from '@/app/lib/auth';
import { sanitizePrompt, safeJsonStringify } from '@/app/lib/sanitize';
import {cookies} from "next/headers";

export async function createJob(params: {
    prompt: string;
    numFrames?: number;
    height?: number;
    width?: number;
    numInferenceSteps?: number;
    guidanceScale?: number;
    seed?: number;
    negativePrompt?: string;
}) {
    try {
        if (!params.prompt) {
            return { success: false, error: 'Prompt is required' };
        }

        // Sanitize the prompt to prevent XSS
        const sanitizedPrompt = sanitizePrompt(params.prompt);

        // Map frontend parameter names to backend expected names
        const requestBody: any = {
            prompt: sanitizedPrompt,
            ...(params.numFrames && { num_frames: params.numFrames }),
            ...(params.height && { height: params.height }),
            ...(params.width && { width: params.width }),
            ...(params.numInferenceSteps && { num_inference_steps: params.numInferenceSteps }),
            ...(params.guidanceScale && { guidance_scale: params.guidanceScale }),
            ...(params.seed && { seed: params.seed }),
            ...(params.negativePrompt && { negative_prompt: params.negativePrompt }),
        };

        const response = await callApiWithAuth('/internal/jobs', {
            method: 'POST',
            body: safeJsonStringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to create job');
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error: any) {
        console.error('Create job error:', error);
        return { success: false, error: error.message || 'Failed to create job' };
    }
}

export async function getWebSocketToken(): Promise<string | null> {
    try {
        const cookieStore = await cookies();
        const idToken = cookieStore.get('id_token')?.value;
        return idToken || null;
    } catch (error) {
        console.error('Failed to get WebSocket token:', error);
        return null;
    }
}