'use client';

import React, { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ToastProps {
    message: string;
    type?: 'error' | 'success' | 'warning' | 'info';
    duration?: number;
    onClose: () => void;
}

export function Toast({ message, type = 'error', duration = 5000, onClose }: ToastProps) {
    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [duration, onClose]);

    const bgColors = {
        error: 'bg-red-50 border-red-200 text-red-800',
        success: 'bg-green-50 border-green-200 text-green-800',
        warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
        info: 'bg-blue-50 border-blue-200 text-blue-800'
    };

    return (
        <div className={`fixed top-4 right-4 z-50 max-w-md p-4 border rounded-lg shadow-lg ${bgColors[type]} animate-slide-in`}>
            <div className="flex items-start justify-between">
                <p className="text-sm font-medium pr-2">{message}</p>
                <button
                    onClick={onClose}
                    className="flex-shrink-0 ml-2 hover:opacity-70 transition-opacity"
                    aria-label="Close notification"
                >
                    <XMarkIcon className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

interface ToastContextType {
    showToast: (message: string, type?: 'error' | 'success' | 'warning' | 'info') => void;
}

const ToastContext = React.createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'error' | 'success' | 'warning' | 'info' }>>([]);

    const showToast = (message: string, type: 'error' | 'success' | 'warning' | 'info' = 'error') => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts(prev => [...prev, { id, message, type }]);
    };

    const removeToast = (id: string) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    };

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = React.useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
}