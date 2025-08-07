import type { APIGatewayProxyResult } from 'aws-lambda';
import {withCognitoAuth, errorResponse, successResponse, type CognitoValidatedEvent} from '../../utils/middleware';
import { JobService } from '../../services/jobService';

const getJobHandler = async (event: CognitoValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const jobId = event.pathParameters?.jobId;

        if (!jobId) {
            return errorResponse(400, 'Job ID is required');
        }

        const job = await JobService.getJob(event.userId, jobId);

        if (!job) {
            return errorResponse(404, 'Job not found');
        }

        return successResponse({
            jobId: job.jobId,
            status: job.status,
            prompt: job.prompt,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
            videoUrl: job.videoUrl,
            errorMessage: job.errorMessage
        });

    } catch (error) {
        console.error('Get job error:', error);
        return errorResponse(500, 'Failed to get job');
    }
};

export const handler = withCognitoAuth(getJobHandler);