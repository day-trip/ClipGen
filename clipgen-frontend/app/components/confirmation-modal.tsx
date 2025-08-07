'use client';

import React, { useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useFocusTrap, useEscapeKey, useBodyScrollLock } from '@/app/hooks/use-focus-trap';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    isLoading?: boolean;
}

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',
    isLoading = false
}: ConfirmationModalProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Focus management
    const focusTrapRef = useFocusTrap<HTMLDivElement>({ isActive: isOpen });
    useEscapeKey(onClose, isOpen && !isProcessing);
    useBodyScrollLock(isOpen);

    const handleConfirm = async () => {
        if (isProcessing) return;
        
        setIsProcessing(true);
        try {
            await onConfirm();
            onClose();
        } catch (error) {
            console.error('Confirmation action failed:', error);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClose = () => {
        if (isProcessing) return;
        onClose();
    };

    if (!isOpen) return null;

    const variantStyles = {
        danger: {
            icon: 'text-red-600',
            confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
            border: 'border-red-200'
        },
        warning: {
            icon: 'text-amber-600',
            confirmButton: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
            border: 'border-amber-200'
        },
        info: {
            icon: 'text-blue-600',
            confirmButton: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
            border: 'border-blue-200'
        }
    };

    const styles = variantStyles[variant];

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                <div
                    className="fixed inset-0 bg-[#faf3ea]/75 bg-opacity transition-opacity"
                    onClick={handleClose}
                />
                
                <div
                    ref={focusTrapRef}
                    className={`relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6 ring-1 ring-[#e3d4bf]`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="modal-title"
                    aria-describedby="modal-description"
                >
                    <div className="sm:flex sm:items-start">
                        <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10`}>
                            <ExclamationTriangleIcon 
                                className={`h-6 w-6 ${styles.icon}`}
                                aria-hidden="true"
                            />
                        </div>
                        <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                            <h3 
                                id="modal-title"
                                className="text-base font-semibold leading-6 text-gray-900"
                            >
                                {title}
                            </h3>
                            <div className="mt-2">
                                <p id="modal-description" className="text-sm text-gray-500">
                                    {message}
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse gap-3">
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={isProcessing || isLoading}
                            className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed ${styles.confirmButton}`}
                        >
                            {isProcessing || isLoading ? 'Processing...' : confirmText}
                        </button>
                        
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isProcessing}
                            className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 sm:mt-0 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {cancelText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Hook for easier usage
export function useConfirmationModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [modalProps, setModalProps] = useState<Omit<ConfirmationModalProps, 'isOpen' | 'onClose'>>({
        onConfirm: () => {},
        title: '',
        message: ''
    });

    const showConfirmation = (props: Omit<ConfirmationModalProps, 'isOpen' | 'onClose'>) => {
        setModalProps(props);
        setIsOpen(true);
        return new Promise<boolean>((resolve) => {
            const originalOnConfirm = props.onConfirm;
            setModalProps({
                ...props,
                onConfirm: async () => {
                    await originalOnConfirm();
                    resolve(true);
                }
            });
        });
    };

    const closeModal = () => {
        setIsOpen(false);
    };

    const ConfirmationModalComponent = () => (
        <ConfirmationModal
            {...modalProps}
            isOpen={isOpen}
            onClose={closeModal}
        />
    );

    return {
        showConfirmation,
        ConfirmationModal: ConfirmationModalComponent
    };
}