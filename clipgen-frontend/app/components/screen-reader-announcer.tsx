'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

interface AnnouncerContextType {
    announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const AnnouncerContext = createContext<AnnouncerContextType | null>(null);

interface AnnouncementItem {
    id: string;
    message: string;
    priority: 'polite' | 'assertive';
    timestamp: number;
}

export function ScreenReaderAnnouncerProvider({ children }: { children: React.ReactNode }) {
    const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
    const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

    const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
        const id = Math.random().toString(36).substr(2, 9);
        const announcement: AnnouncementItem = {
            id,
            message,
            priority,
            timestamp: Date.now()
        };

        setAnnouncements(prev => [...prev, announcement]);

        // Clear the announcement after it's been read
        const timeout = setTimeout(() => {
            setAnnouncements(prev => prev.filter(a => a.id !== id));
            timeoutRefs.current.delete(id);
        }, 3000); // Keep for 3 seconds to ensure it's read

        timeoutRefs.current.set(id, timeout);
    }, []);

    useEffect(() => {
        // Cleanup timeouts on unmount
        return () => {
            timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
            timeoutRefs.current.clear();
        };
    }, []);

    return (
        <AnnouncerContext.Provider value={{ announce }}>
            {children}
            
            {/* Screen reader announcement regions */}
            <div className="sr-only">
                {announcements.map(announcement => (
                    <div
                        key={announcement.id}
                        role="status"
                        aria-live={announcement.priority}
                        aria-atomic="true"
                    >
                        {announcement.message}
                    </div>
                ))}
            </div>
        </AnnouncerContext.Provider>
    );
}

export function useScreenReaderAnnouncer() {
    const context = useContext(AnnouncerContext);
    if (!context) {
        throw new Error('useScreenReaderAnnouncer must be used within ScreenReaderAnnouncerProvider');
    }
    return context;
}

// Higher-order hook for common announcements
export function useStatusAnnouncements() {
    const { announce } = useScreenReaderAnnouncer();

    return {
        announceSuccess: (message: string) => announce(`Success: ${message}`, 'polite'),
        announceError: (message: string) => announce(`Error: ${message}`, 'assertive'),
        announceWarning: (message: string) => announce(`Warning: ${message}`, 'polite'),
        announceInfo: (message: string) => announce(message, 'polite'),
        announceJobStatus: (status: string, details?: string) => {
            const message = details ? `${status}: ${details}` : status;
            announce(message, 'polite');
        },
        announceLoading: (action: string) => announce(`${action}, please wait`, 'polite'),
        announceCompleted: (action: string) => announce(`${action} completed`, 'polite'),
    };
}