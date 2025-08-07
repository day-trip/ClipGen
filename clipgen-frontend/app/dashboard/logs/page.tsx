import { requireAuth } from '../../lib/auth-check';
import LogsList from './components/logs-list';
import { getLogs } from './actions';
import { Suspense } from 'react';
import { LogItemSkeleton } from '@/app/components/loading-spinner';

async function LogsContent({ cursor }: { cursor?: string }) {
    const result = await getLogs(cursor);
    const logs = result.success ? result.data.logs : [];
    const nextCursor = result.success ? result.data.nextCursor : null;

    return <LogsList logs={logs} nextCursor={nextCursor} />;
}

export default async function LogsPage({
                                           searchParams,
                                       }: {
    searchParams: Promise<{ cursor?: string }>;
}) {
    await requireAuth();
    const { cursor } = await searchParams;

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Request Logs</h1>
                <p className="text-gray-600">
                    View your job history from the last 30 days.
                </p>
            </div>

            <Suspense fallback={
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <LogItemSkeleton key={i} />
                        ))}
                        </tbody>
                    </table>
                </div>
            }>
                <LogsContent cursor={cursor} />
            </Suspense>
        </div>
    );
}