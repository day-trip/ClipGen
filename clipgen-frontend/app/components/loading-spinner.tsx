'use client';

import React from 'react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
    const sizeClasses = {
        sm: 'w-4 h-4',
        md: 'w-8 h-8',
        lg: 'w-12 h-12'
    };

    return (
        <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-orange-600 ${sizeClasses[size]} ${className}`} />
    );
}

interface LoadingStateProps {
    message?: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export function LoadingState({ message = 'Loading...', size = 'md', className = '' }: LoadingStateProps) {
    return (
        <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
            <LoadingSpinner size={size} className="mb-4" />
            <p className="text-gray-600 text-sm">{message}</p>
        </div>
    );
}

interface PageLoadingProps {
    message?: string;
}

export function PageLoading({ message = 'Loading...' }: PageLoadingProps) {
    return (
        <div className="min-h-[400px] flex items-center justify-center">
            <LoadingState message={message} size="lg" />
        </div>
    );
}

// Skeleton loaders for different content types
export function ApiKeyItemSkeleton() {
    return (
        <div className="py-4 flex items-center justify-between animate-pulse">
            <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                    <div className="h-5 bg-gray-200 rounded w-32"></div>
                    <div className="h-5 bg-gray-200 rounded w-16"></div>
                </div>
                <div className="flex items-center gap-4 mb-2">
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                </div>
                <div className="h-6 bg-gray-200 rounded w-40"></div>
            </div>
            <div className="w-8 h-8 bg-gray-200 rounded"></div>
        </div>
    );
}

export function LogItemSkeleton() {
    return (
        <tr className="animate-pulse">
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 bg-gray-200 rounded w-32"></div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 bg-gray-200 rounded w-16"></div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="h-4 bg-gray-200 rounded w-12"></div>
            </td>
        </tr>
    );
}