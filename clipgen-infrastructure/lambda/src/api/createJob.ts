import type { APIGatewayProxyResult } from 'aws-lambda';
import {withAuth, errorResponse, successResponse, type ValidatedEvent, withRateLimiting} from '../utils/middleware';
import { JobService } from '../services/jobService';

const createJobHandler = async (event: ValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Parse JSON body with error handling
        let requestData;
        try {
            requestData = JSON.parse(event.body || '{}');
        } catch (parseError) {
            return errorResponse(400, 'Invalid JSON in request body');
        }

        const result = await JobService.createJob(event.userId, requestData);
        return successResponse(result, 201);

    } catch (error) {
        console.error('Create job error:', error);
        const message = error instanceof Error ? error.message : 'Failed to create job';
        return errorResponse(400, message);
    }
};


export const handler = withAuth(withRateLimiting(createJobHandler));