'use client';

import { useState } from 'react';
import { downloadVideo } from '../actions';
import Link from 'next/link';

interface Log {
    jobId: string;
    status: string;
    prompt: string;
    createdAt: string;
    completedAt: number | null;
    duration: number | null;
    hasVideo: boolean;
}

export default function LogsList({ logs, nextCursor }: { logs: Log[]; nextCursor: string | null }) {
    const [downloadingJobs, setDownloadingJobs] = useState<Set<string>>(new Set());

    const handleDownload = async (jobId: string) => {
        if (downloadingJobs.has(jobId)) return;

        setDownloadingJobs(prev => new Set(prev).add(jobId));

        try {
            const result = await downloadVideo(jobId);

            if (result.success) {
                // Open download URL in new window/tab
                window.open(result.data.downloadUrl, '_blank');
            } else {
                alert(`Failed to download: ${result.error}`);
            }
        } catch (error) {
            alert('Download failed. Please try again.');
        } finally {
            setDownloadingJobs(prev => {
                const next = new Set(prev);
                next.delete(jobId);
                return next;
            });
        }
    };

    const formatDuration = (seconds: number | null) => {
        if (!seconds) return 'N/A';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-100 text-green-700';
            case 'processing': return 'bg-blue-100 text-blue-700';
            case 'queued': return 'bg-yellow-100 text-yellow-700';
            case 'failed': return 'bg-red-100 text-red-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    if (logs.length === 0) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <div className="text-gray-400 mb-4">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Request Logs</h3>
                <p className="text-gray-500">You haven't created any jobs in the last 30 days.</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Job ID
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Prompt
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Duration
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                        </th>
                    </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                    {logs.map((log) => (
                        <tr key={log.jobId} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {new Date(log.createdAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                                {log.jobId.replace('job_', '')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(log.status)}`}>
                                        {log.status}
                                    </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                                <div className="truncate" title={log.prompt}>
                                    {log.prompt}
                                </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatDuration(log.duration)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {log.hasVideo ? (
                                    <button
                                        onClick={() => handleDownload(log.jobId)}
                                        disabled={downloadingJobs.has(log.jobId)}
                                        className="inline-flex items-center text-blue-600 hover:text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {downloadingJobs.has(log.jobId) ? (
                                            <>
                                                <svg className="animate-spin -ml-1 mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                Preparing...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                                Download
                                            </>
                                        )}
                                    </button>
                                ) : (
                                    <span className="text-gray-400">No video</span>
                                )}
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            {nextCursor && (
                <div className="bg-gray-50 px-6 py-3 flex justify-center">
                    <Link
                        href={`/dashboard/logs?cursor=${encodeURIComponent(nextCursor)}`}
                        className="text-blue-600 hover:text-blue-500 text-sm font-medium"
                    >
                        Load More
                    </Link>
                </div>
            )}
        </div>
    );
}