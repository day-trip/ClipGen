import type { APIGatewayProxyResult } from 'aws-lambda';
import { withAuth, errorResponse, successResponse, type ValidatedEvent } from '../utils/middleware';
import { JobService } from '../services/jobService';

const getJobHandler = async (event: ValidatedEvent): Promise<APIGatewayProxyResult> => {
    try {
        const jobId = event.pathParameters?.jobId;
        if (!jobId) {
            return errorResponse(400, 'Job ID is required');
        }

        const job = await JobService.getJob(event.userId, jobId, { includeSignedUrl: true });

        if (!job) {
            return errorResponse(404, 'Job not found');
        }

        return successResponse({
            jobId: job.jobId,
            status: job.status,
            queuePosition: job.queuePosition || null,
            videoUrl: job.videoUrl,
            createdAt: job.createdAt,
            completedAt: job.completedAt || null
        });

    } catch (error) {
        console.error('Get job error:', error);
        return errorResponse(500, 'Failed to retrieve job');
    }
};

export const handler = withAuth(getJobHandler);