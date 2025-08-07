'use client';

import React, {useEffect, useState} from 'react';
import {AdjustmentsVerticalIcon, ArrowUpIcon, DocumentArrowDownIcon} from "@heroicons/react/24/outline";
import useWebSocket from 'react-use-websocket';
import { createJobValidationSchema, formatValidationErrors } from '@/app/lib/validation';
import { useToast } from '@/app/components/ui/toast';
import {downloadVideo} from "@/app/dashboard/logs/actions";
import { ErrorBoundary, PlaygroundErrorFallback } from '@/app/components/error-boundary';
import { useStatusAnnouncements } from '@/app/components/screen-reader-announcer';
import {useAutoResize} from "@/app/hooks/use-auto-resize";
import {getWebSocketToken, createJob} from "@/app/dashboard/playground/actions";

interface GenerationParams {
    numFrames: number;
    height: number;
    width: number;
    numInferenceSteps: number;
    guidanceScale: number;
    seed?: number;
    negativePrompt?: string;
}

// Base job interface
interface BaseJob {
    id: string;
    prompt: string;
    timestamp: Date;
    params: GenerationParams;
}

// Job state interfaces
interface PendingJob extends BaseJob {
    status: 'pending';
}

interface QueuedJob extends BaseJob {
    status: 'queued';
    jobId: string;
    ticketNumber: number;
    queuePosition?: number;
}

interface GeneratingJob extends BaseJob {
    status: 'generating';
    jobId: string;
    ticketNumber: number;
}

interface CompletedJob extends BaseJob {
    status: 'completed';
    jobId: string;
    ticketNumber: number;
    videoUrl: string;
}

interface ErrorJob extends BaseJob {
    status: 'error';
    jobId?: string;
    ticketNumber?: number;
    errorMessage: string;
    canRetry?: boolean;
    retryCount?: number;
}

// Union type for all job states
type Job = PendingJob | QueuedJob | GeneratingJob | CompletedJob | ErrorJob;

function UserMessage({job}: { job: Job }) {
    return <div className="flex justify-end">
        <div className="max-w-2xl bg-[#f5eadc] text-black rounded-2xl px-4 py-3">
            <p className="text-lg">{job.prompt}</p>
        </div>
    </div>
}

function AssistantMessage({ job, onDownload, onRetry }: { job: Job, onDownload: (jobId: string) => void, onRetry?: (job: Job) => void }) {
    const getStatusContent = () => {
        switch (job.status) {
            case 'pending':
                return {
                    text: 'Creating your job...',
                    showLoading: true
                };
            case 'queued':
                return {
                    text: job.queuePosition
                        ? `You are #${job.queuePosition} in line`
                        : 'Your request is queued...',
                    showLoading: true
                };
            case 'generating':
                return {
                    text: 'Your video is being generated right now',
                    showLoading: true
                };
            case 'completed':
                return {
                    text: 'Video generated successfully!',
                    showLoading: false
                };
            case 'error':
                return {
                    text: `Error: ${job.errorMessage}`,
                    showLoading: false,
                    showError: true
                };
        }
    };

    const statusContent = getStatusContent();

    return <div className="flex justify-start">
        <div className={`max-w-2xl rounded-2xl px-6 py-4 ${
            statusContent.showError
                ? 'bg-red-50 border border-red-200'
                : 'bg-white border border-gray-200'
        }`}>
            {statusContent.showLoading && <LoadingDots/>}
            <p className={`text-sm mb-3 ${
                statusContent.showError ? 'text-red-700' : 'text-gray-700'
            }`}>
                {statusContent.text}
            </p>

            {job.status === 'completed' && (
                <VideoResult videoUrl={job.videoUrl} jobId={job.jobId} onDownload={onDownload} />
            )}

            {job.status === 'error' && job.canRetry && onRetry && (
                <div className="mt-3 space-y-2">
                    <button
                        onClick={() => onRetry(job)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
                        aria-label={`Retry job: ${job.prompt}`}
                    >
                        Try Again
                    </button>
                    {job.retryCount && job.retryCount > 0 && (
                        <p className="text-xs text-red-600">
                            Retry attempt {job.retryCount}/3
                        </p>
                    )}
                </div>
            )}
        </div>
    </div>
}

function JobMessages({ job, onDownload, onRetry }: { job: Job, onDownload: (jobId: string) => void, onRetry?: (job: Job) => void }) {
    return (
        <div className="space-y-6">
            <UserMessage job={job} />
            <AssistantMessage job={job} onDownload={onDownload} onRetry={onRetry} />
        </div>
    );
}

function LoadingDots() {
    return <div className="flex items-center gap-1">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
    </div>
}

function VideoResult({ videoUrl, jobId, onDownload }: { videoUrl: string, jobId: string, onDownload: (jobId: string) => void }) {
    const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const { showToast } = useToast();

    const fetchPresignedUrl = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const result = await downloadVideo(jobId);
            if (result.success) {
                setPresignedUrl(result.data.downloadUrl);
                setError(null);
            } else {
                const errorMessage = result.error || 'Failed to get video URL';
                setError(errorMessage);
                console.error("Failed to get presigned URL", errorMessage);
                showToast(errorMessage, 'error');
            }
        } catch (error) {
            const errorMessage = 'Error loading video';
            setError(errorMessage);
            console.error("Error fetching presigned URL", error);
            showToast(errorMessage, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPresignedUrl();
    }, [jobId]);

    const handleRetry = () => {
        if (retryCount < 3) {
            setRetryCount(prev => prev + 1);
            fetchPresignedUrl();
        }
    };

    return (
        <div className="">
            <div className="aspect-video bg-gray-200 rounded-lg mb-3 overflow-hidden">
                {isLoading ? (
                    <div className="w-full h-full flex flex-col items-center justify-center">
                        <LoadingDots />
                        <p className="text-sm text-gray-600 mt-2">Loading video...</p>
                    </div>
                ) : presignedUrl ? (
                    <video
                        src={presignedUrl}
                        controls
                        className="w-full h-full object-cover rounded-lg"
                        poster=""
                        onError={() => {
                            setError('Video failed to load');
                            showToast('Video failed to load', 'error');
                        }}
                    >
                        Your browser does not support the video tag.
                    </video>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-red-500 p-4 text-center">
                        <p className="text-sm mb-3">{error || 'Could not load video'}</p>
                        {retryCount < 3 && (
                            <button
                                onClick={handleRetry}
                                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                            >
                                Retry ({retryCount}/3)
                            </button>
                        )}
                    </div>
                )}
            </div>
            <button
                onClick={() => onDownload(jobId)}
                disabled={!presignedUrl}
                className={`inline-flex items-center gap-2 text-sm font-medium ${
                    presignedUrl
                        ? 'text-blue-600 hover:text-blue-500'
                        : 'text-gray-400 cursor-not-allowed'
                }`}
                aria-label={`Download video for job ${jobId}`}
            >
                <DocumentArrowDownIcon className="w-4 h-4" /> Download Video
            </button>
        </div>
    );
}

function EmptyState() {
    return <div className="h-full flex flex-col justify-center items-center text-center">
        <h3 className="text-2xl font-semibold text-gray-900 mb-4">Ready to create amazing videos</h3>
        <p className="text-lg text-gray-500 max-w-md mx-auto">
            Describe the video you want to generate and I&#39;ll create it for you. You can refine and iterate on
            your ideas.
        </p>
    </div>
}

function parseInt(value: string): number {
    return value.length ? window.parseInt(value) : 0;
}

function ParametersSidebar({params, onParamsChange}: { params: GenerationParams; onParamsChange: (key: keyof GenerationParams, value: any) => void}) {
    return <div className="w-80 flex flex-col h-full border-l border-l-[#c2b39f]">
        <div className="px-6 py-4 border-b border-b-[#c2b39f]">
            <h3 className="text-xl font-semibold text-gray-800">Parameters</h3>
        </div>

        <div className="flex-1 px-4 py-6">
            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Frames</label>
                    <input
                        type="number"
                        value={params.numFrames}
                        onChange={(e) => onParamsChange('numFrames', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent"
                        min="1"
                        max="100"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Width</label>
                        <input
                            type="number"
                            value={params.width}
                            onChange={(e) => onParamsChange('width', parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent"
                            step="8"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Height</label>
                        <input
                            type="number"
                            value={params.height}
                            onChange={(e) => onParamsChange('height', parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent"
                            step="8"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Inference Steps</label>
                    <input
                        type="number"
                        value={params.numInferenceSteps}
                        onChange={(e) => onParamsChange('numInferenceSteps', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent"
                        min="1"
                        max="100"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Guidance Scale</label>
                    <input
                        type="number"
                        value={params.guidanceScale}
                        onChange={(e) => onParamsChange('guidanceScale', parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent"
                        step="0.1"
                        min="0"
                        max="20"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Seed (optional)</label>
                    <input
                        type="number"
                        value={params.seed || ''}
                        onChange={(e) => onParamsChange('seed', e.target.value ? parseInt(e.target.value) : undefined)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent"
                        placeholder="Random"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Negative Prompt</label>
                    <textarea
                        value={params.negativePrompt}
                        onChange={(e) => onParamsChange('negativePrompt', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-[1px] focus:ring-orange-400 focus:border-transparent resize-none"
                        placeholder="What you don't want in the video..."
                        rows={3}
                    />
                </div>
            </div>
        </div>
    </div>
}

function ChatInput({inputValue, setInputValue, onSubmit, disabled}: {
    inputValue: string;
    setInputValue: (value: string) => void;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    disabled: boolean;
}) {
    const textareaRef = useAutoResize(inputValue);

    return <div className="px-6 pt-4 pb-12">
        <div className="max-w-3xl mx-auto relative">
            <textarea
                name="prompt"
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={async (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        await onSubmit(e);
                    }
                }}
                placeholder="Describe the video you want to create"
                className="w-full px-5 py-3 pr-14 border border-none shadow-xl hover:shadow-none focus:shadow-none ring-[#e3d4bf] hover:ring-1 focus:ring-1 placeholder-[#c2b39f] focus:placeholder-[#e3d4bf] bg-white rounded-4xl resize-none focus:outline-none max-h-64 text-xl transition-all hide-scrollbar"
                rows={1}
                maxLength={300}
                disabled={disabled}
            />
            <button
                onClick={onSubmit}
                disabled={disabled || !inputValue.trim()}
                className="absolute bottom-4 right-2 p-2 rounded-full bg-orange-500 enabled:hover:bg-orange-400 disabled:bg-[#faf3ea] enabled:cursor-pointer transition-colors group">
                <ArrowUpIcon className="w-5 h-5 group-disabled:text-[#e3d4bf] text-white stroke-3"/>
            </button>
        </div>
    </div>
}

export default function PlaygroundPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showParams, setShowParams] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const { showToast } = useToast();
    const { announceJobStatus, announceError, announceSuccess, announceLoading } = useStatusAnnouncements();

    const [wsToken, setWsToken] = useState<string | null>(null);
    const [nowServing, setNowServing] = useState<number>(0);

    const [params, setParams] = useState<GenerationParams>({
        numFrames: 25,
        height: 480,
        width: 848,
        numInferenceSteps: 64,
        guidanceScale: 6.0,
        seed: undefined,
        negativePrompt: '',
    });

    // Get the current active job (last job that's not completed or errored)
    const activeJob = jobs.find(job => job.status !== 'completed' && job.status !== 'error') || null;

    // Get WebSocket token
    useEffect(() => {
        const getToken = async () => {
            try {
                const token = await getWebSocketToken();
                setWsToken(token);
            } catch (error) {
                console.error('Failed to get WebSocket token:', error);
            }
        };
        getToken();
    }, []);

    // WebSocket connection
    const socketUrl = activeJob?.status !== 'pending' && activeJob && 'jobId' in activeJob && wsToken
        ? `${process.env.NEXT_PUBLIC_WS_URL}?token=${encodeURIComponent(wsToken)}&jobId=${encodeURIComponent(activeJob.jobId)}`
        : null;

    const { lastMessage } = useWebSocket(socketUrl, {
        onOpen: () => {
            console.log(`WebSocket connected for job ${activeJob && 'jobId' in activeJob ? activeJob.jobId : 'unknown'}`);
            setConnectionError(null);
        },
        onClose: () => {
            console.log(`WebSocket disconnected`);
        },
        onError: (error) => {
            console.error('WebSocket error:', error);
            setConnectionError('Connection lost. Attempting to reconnect...');
        },
        shouldReconnect: () => true,
        reconnectAttempts: 5,
        reconnectInterval: (attemptNumber) => {
            const interval = Math.min(Math.pow(2, attemptNumber) * 1000, 30000);
            setConnectionError(`Reconnecting in ${interval/1000}s... (attempt ${attemptNumber}/5)`);
            return interval;
        },
        onReconnectStop: () => {
            setConnectionError('Unable to reconnect. Some features may not work properly.');
            showToast('Connection lost. Please refresh the page if issues persist.', 'warning');
        },
    });

    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        try {
            const wsMessage = JSON.parse(lastMessage.data);
            console.log('WebSocket message received:', wsMessage);

            if (wsMessage.type === 'QUEUE_UPDATE') {
                setNowServing(wsMessage.nowServing);

                // Update queue position for queued jobs
                setJobs(prevJobs => prevJobs.map(job => {
                    if (job.status === 'queued' && job.ticketNumber) {
                        return {
                            ...job,
                            queuePosition: Math.max(0, job.ticketNumber - wsMessage.nowServing)
                        };
                    }
                    return job;
                }));
            } else if (wsMessage.type === 'JOB_UPDATE' || wsMessage.type === 'JOB_STATUS') {
                const jobId = wsMessage.jobId;

                setJobs(prevJobs => prevJobs.map(job => {
                    if ('jobId' in job && job.jobId === jobId) {
                        if (wsMessage.status === 'completed') {
                            announceSuccess('Video generation completed');
                            return {
                                ...job,
                                status: 'completed',
                                videoUrl: wsMessage.videoUrl
                            } as CompletedJob;
                        } else if (wsMessage.status === 'failed') {
                            announceError('Video generation failed');
                            return {
                                ...job,
                                status: 'error',
                                errorMessage: wsMessage.errorMessage || 'Job failed'
                            } as ErrorJob;
                        } else if (wsMessage.status === 'queued') {
                            const position = nowServing > 0 ? Math.max(0, wsMessage.ticketNumber - nowServing) : undefined;
                            announceJobStatus('Job queued', position ? `Position ${position} in queue` : undefined);
                            return {
                                ...job,
                                status: 'queued',
                                ticketNumber: wsMessage.ticketNumber,
                                queuePosition: position
                            } as QueuedJob;
                        } else if (wsMessage.status === 'processing') {
                            announceJobStatus('Video generation started');
                            return {
                                ...job,
                                status: 'generating'
                            } as GeneratingJob;
                        }
                    }
                    return job;
                }));

                // Clear generating flag when job completes or fails
                if (wsMessage.status === 'completed' || wsMessage.status === 'failed') {
                    setIsGenerating(false);
                }
            }
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    }, [lastMessage, nowServing]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || isGenerating) return;

        // Frontend validation
        const validationData = {
            prompt: inputValue.trim(),
            numFrames: params.numFrames,
            height: params.height,
            width: params.width,
            numInferenceSteps: params.numInferenceSteps,
            guidanceScale: params.guidanceScale,
            seed: params.seed,
            negativePrompt: params.negativePrompt,
        };

        const validation = createJobValidationSchema.safeParse(validationData);
        if (!validation.success) {
            const errors = formatValidationErrors(validation.error);
            showToast(errors.join(', '), 'error');
            return;
        }

        // Create pending job
        const newJob: PendingJob = {
            id: `job-${Date.now()}`,
            prompt: inputValue.trim(),
            timestamp: new Date(),
            params: { ...params },
            status: 'pending'
        };

        setJobs(prev => [...prev, newJob]);

        const originalPrompt = inputValue;
        setInputValue('');
        setIsGenerating(true);
        announceLoading('Creating video job');

        try {
            const result = await createJob({
                prompt: newJob.prompt,
                numFrames: params.numFrames,
                height: params.height,
                width: params.width,
                numInferenceSteps: params.numInferenceSteps,
                guidanceScale: params.guidanceScale,
                seed: params.seed,
                negativePrompt: params.negativePrompt,
            });

            if (result.success && result.data) {
                // Update job to queued state
                setJobs(prevJobs => prevJobs.map(job =>
                    job.id === newJob.id
                        ? {
                            ...job,
                            status: 'queued',
                            jobId: result.data.jobId,
                            ticketNumber: result.data.ticketNumber,
                            queuePosition: nowServing > 0 ? Math.max(0, result.data.ticketNumber - nowServing) : undefined
                        } as QueuedJob
                        : job
                ));
            } else {
                // Update job to error state with retry capability
                const errorMessage = result.error || 'Failed to create job';
                setJobs(prevJobs => prevJobs.map(job =>
                    job.id === newJob.id
                        ? {
                            ...job,
                            status: 'error',
                            errorMessage,
                            canRetry: true,
                            retryCount: 0
                        } as ErrorJob
                        : job
                ));
                showToast(errorMessage, 'error');
                setInputValue(originalPrompt);
                setIsGenerating(false);
            }
        } catch (error: any) {
            console.error('Job creation error:', error);

            const errorMessage = error.message || 'Failed to create job';
            setJobs(prevJobs => prevJobs.map(job =>
                job.id === newJob.id
                    ? {
                        ...job,
                        status: 'error',
                        errorMessage,
                        canRetry: true,
                        retryCount: 0
                    } as ErrorJob
                    : job
            ));
            showToast(errorMessage, 'error');
            setInputValue(originalPrompt);
            setIsGenerating(false);
        }
    };

    const handleParamsChange = (key: keyof GenerationParams, value: any) => {
        setParams(prev => ({...prev, [key]: value}));
    };

    const handleRetry = async (job: Job) => {
        if (job.status !== 'error' || !job.canRetry || isGenerating) return;

        const currentRetryCount = (job.retryCount || 0) + 1;
        if (currentRetryCount > 3) {
            showToast('Maximum retry attempts reached', 'error');
            return;
        }

        // Update job to pending state with retry count
        setJobs(prevJobs => prevJobs.map(j =>
            j.id === job.id
                ? {
                    ...job,
                    status: 'pending',
                    retryCount: currentRetryCount
                } as PendingJob
                : j
        ));

        setIsGenerating(true);
        showToast(`Retrying... (${currentRetryCount}/3)`, 'info');

        try {
            const result = await createJob({
                prompt: job.prompt,
                numFrames: job.params.numFrames,
                height: job.params.height,
                width: job.params.width,
                numInferenceSteps: job.params.numInferenceSteps,
                guidanceScale: job.params.guidanceScale,
                seed: job.params.seed,
                negativePrompt: job.params.negativePrompt,
            });

            if (result.success && result.data) {
                // Update job to queued state
                setJobs(prevJobs => prevJobs.map(j =>
                    j.id === job.id
                        ? {
                            ...j,
                            status: 'queued',
                            jobId: result.data.jobId,
                            ticketNumber: result.data.ticketNumber,
                            queuePosition: nowServing > 0 ? Math.max(0, result.data.ticketNumber - nowServing) : undefined
                        } as QueuedJob
                        : j
                ));
            } else {
                // Update job back to error state
                const errorMessage = result.error || 'Retry failed';
                setJobs(prevJobs => prevJobs.map(j =>
                    j.id === job.id
                        ? {
                            ...j,
                            status: 'error',
                            errorMessage,
                            canRetry: currentRetryCount < 3,
                            retryCount: currentRetryCount
                        } as ErrorJob
                        : j
                ));
                showToast(errorMessage, 'error');
                setIsGenerating(false);
            }
        } catch (error: any) {
            console.error('Retry error:', error);
            const errorMessage = error.message || 'Retry failed';
            setJobs(prevJobs => prevJobs.map(j =>
                j.id === job.id
                    ? {
                        ...j,
                        status: 'error',
                        errorMessage,
                        canRetry: currentRetryCount < 3,
                        retryCount: currentRetryCount
                    } as ErrorJob
                    : j
            ));
            showToast(errorMessage, 'error');
            setIsGenerating(false);
        }
    };

    const handleDownload = async (jobId: string) => {
        try {
            const result = await downloadVideo(jobId);
            if (result.success) {
                window.open(result.data.downloadUrl, '_blank');
            } else {
                showToast(result.error || 'Failed to get download link', 'error');
            }
        } catch (error) {
            showToast('An unexpected error occurred.', 'error');
        }
    };

    return (
        <ErrorBoundary fallback={PlaygroundErrorFallback}>
            <div className="flex h-screen">
                {/* Main Content Area */}
                <div className="flex-1 flex flex-col pt-12">
                    {/* Messages Container */}
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        <div className="max-w-4xl mx-auto space-y-6 h-full">
                            {jobs.length === 0 ? <EmptyState/> : (
                                <>
                                    {connectionError && (
                                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                                            <p className="text-sm text-yellow-700">{connectionError}</p>
                                        </div>
                                    )}
                                    {jobs.map((job) => (
                                        <JobMessages key={job.id} job={job} onDownload={handleDownload} onRetry={handleRetry} />
                                    ))}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Input Area */}
                    <ChatInput
                        inputValue={inputValue}
                        setInputValue={setInputValue}
                        onSubmit={handleSubmit}
                        disabled={isGenerating}
                    />
                </div>

                {/* Parameters Sidebar */}
                {showParams && (
                    <ParametersSidebar
                        params={params}
                        onParamsChange={handleParamsChange}
                    />
                )}

                {/* Floating Toggle Button */}
                <button
                    onClick={() => setShowParams(!showParams)}
                    className={`fixed top-8 right-6 z-10 p-3 bg-white hover:bg-[#f5eadc] border border-[#c2b39f] rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2`}
                    aria-label={showParams ? 'Hide parameters' : 'Show parameters'}
                >
                    <AdjustmentsVerticalIcon className="w-6 h-6"/>
                </button>
            </div>
        </ErrorBoundary>
    );
}
