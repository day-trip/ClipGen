'use client';

import { useEffect, useRef } from 'react';

interface UseFocusTrapOptions {
    isActive: boolean;
    restoreFocus?: boolean;
}

/**
 * Custom hook for managing focus trapping in modals and dialogs
 * @param options Configuration options for focus trapping
 * @returns Ref to attach to the container element
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>({
                                                                      isActive,
                                                                      restoreFocus = true
                                                                  }: UseFocusTrapOptions) {
    const containerRef = useRef<T>(null);
    const previousActiveElementRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!isActive || !containerRef.current) return;

        const container = containerRef.current;

        // Store the previously focused element
        if (restoreFocus) {
            previousActiveElementRef.current = document.activeElement as HTMLElement;
        }

        // Get all focusable elements within the container
        const getFocusableElements = () => {
            const focusableSelectors = [
                'button:not([disabled])',
                'input:not([disabled])',
                'textarea:not([disabled])',
                'select:not([disabled])',
                'a[href]',
                '[tabindex]:not([tabindex="-1"])',
                '[contenteditable="true"]'
            ].join(', ');

            return Array.from(container.querySelectorAll(focusableSelectors)) as HTMLElement[];
        };

        const focusableElements = getFocusableElements();

        if (focusableElements.length === 0) return;

        // Focus the first focusable element
        focusableElements[0].focus();

        const handleTabKey = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;

            const currentFocusableElements = getFocusableElements();
            const firstElement = currentFocusableElements[0];
            const lastElement = currentFocusableElements[currentFocusableElements.length - 1];

            if (event.shiftKey) {
                // Shift + Tab: move focus to previous element
                if (document.activeElement === firstElement) {
                    event.preventDefault();
                    lastElement.focus();
                }
            } else {
                // Tab: move focus to next element
                if (document.activeElement === lastElement) {
                    event.preventDefault();
                    firstElement.focus();
                }
            }
        };

        // Add event listener to trap focus
        container.addEventListener('keydown', handleTabKey);

        // Cleanup function
        return () => {
            container.removeEventListener('keydown', handleTabKey);

            // Restore focus to the previously active element
            if (restoreFocus && previousActiveElementRef.current) {
                previousActiveElementRef.current.focus();
            }
        };
    }, [isActive, restoreFocus]);

    return containerRef;
}

/**
 * Custom hook for managing escape key handling
 * @param callback Function to call when escape is pressed
 * @param isActive Whether the escape handler should be active
 */
export function useEscapeKey(callback: () => void, isActive: boolean = true) {
    useEffect(() => {
        if (!isActive) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                callback();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [callback, isActive]);
}

/**
 * Custom hook for managing body scroll lock (useful for modals)
 * @param isLocked Whether the body scroll should be locked
 */
export function useBodyScrollLock(isLocked: boolean) {
    useEffect(() => {
        if (!isLocked) return;

        const originalStyle = window.getComputedStyle(document.body).overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalStyle;
        };
    }, [isLocked]);
}