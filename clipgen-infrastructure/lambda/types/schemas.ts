import { z } from 'zod';

// Create job request validation
export const createJobSchema = z.object({
    prompt: z.string({error: "Prompt must be a string"})
        .min(1, "Prompt cannot be empty")
        .max(1000, "Prompt must be 1000 characters or less")
        .refine(
            (val) => val.trim().length > 0,
            "Prompt cannot be only whitespace"
        ),

    height: z.number({error: "Height must be a number"})
        .int("Height must be an integer")
        .min(256, "Height must be at least 256 pixels")
        .max(1216, "Height must be at most 1216 pixels") // Mochi max resolution
        .refine(
            (val) => val % 16 === 0, // Mochi uses 16-pixel alignment
            "Height must be divisible by 16"
        )
        .optional(),

    width: z.number({error: "Width must be a number"})
        .int("Width must be an integer")
        .min(256, "Width must be at least 256 pixels")
        .max(1216, "Width must be at most 1216 pixels") // Mochi max resolution
        .refine(
            (val) => val % 16 === 0, // Mochi uses 16-pixel alignment
            "Width must be divisible by 16"
        )
        .optional(),

    num_frames: z.number({error: "Number of frames must be a number"})
        .int("Number of frames must be an integer")
        .min(1, "Must generate at least 1 frame")
        .max(163, "Cannot generate more than 163 frames") // Mochi default max
        .refine(
            (val) => (val - 1) % 6 === 0, // Mochi constraint: (frames-1) % 6 == 0
            "Number of frames must follow Mochi pattern: (frames-1) must be divisible by 6 (e.g., 1, 7, 13, 19, 25, 31...)"
        )
        .optional(),

    num_inference_steps: z.number({error: "Number of inference steps must be a number"})
        .int("Number of inference steps must be an integer")
        .min(1, "Must have at least 1 inference step")
        .max(100, "Cannot exceed 100 inference steps")
        .optional(),

    guidance_scale: z.number({error: "Guidance scale must be a number"})
        .min(0.1, "Guidance scale must be at least 0.1")
        .max(20.0, "Guidance scale cannot exceed 20.0")
        .optional(),

    seed: z.number({error: "Seed must be a number"})
        .int("Seed must be an integer")
        .min(0, "Seed must be non-negative")
        .max(2147483647, "Seed must be less than 2^31")
        .optional(),

    negative_prompt: z.string({error: "Negative prompt must be a string"})
        .max(500, "Negative prompt must be 500 characters or less")
        .optional()
}).refine(
    (data) => {
        // Mochi aspect ratio constraints (based on 848x480 default)
        if (data.height && data.width) {
            const aspectRatio = data.width / data.height;
            return aspectRatio >= 0.5 && aspectRatio <= 2.5; // More restrictive for video
        }
        return true;
    },
    {
        message: "Aspect ratio (width/height) must be between 0.5 and 2.5 for optimal video generation",
        path: ["width", "height"]
    }
);

// List jobs query params
export const listJobsSchema = z.object({
    limit: z.coerce.number()
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(100, 'Limit cannot exceed 100')
        .default(20),
    cursor: z.string().optional()
});

// Get job path params
export const getJobSchema = z.object({
    jobId: z.string()
        .min(1, 'Job ID is required')
        .regex(/^job_[a-zA-Z0-9]+$/, 'Invalid job ID format')
});

// API key validation
export const apiKeySchema = z.string()
    .min(32, 'Invalid API key format')
    .max(64, 'Invalid API key format')
    .regex(/^sk-[a-zA-Z0-9]+$/, 'API key must start with sk- and contain only alphanumeric characters');

// Response types
export type CreateJobRequest = z.infer<typeof createJobSchema>;
export type ListJobsQuery = z.infer<typeof listJobsSchema>;
export type GetJobParams = z.infer<typeof getJobSchema>;

export function formatValidationErrors(error: z.ZodError): string {
    return error.issues
        .map(err => {
            if (err.path.length > 0) {
                return `${err.path.join('.')}: ${err.message}`;
            }
            return err.message;
        })
        .join('; ');
}