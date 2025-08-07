'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createApiKey } from '../actions';
import {PlusIcon, XMarkIcon} from "@heroicons/react/24/outline";
import { useFocusTrap, useEscapeKey, useBodyScrollLock } from '@/app/hooks/use-focus-trap';
import { useStatusAnnouncements } from '@/app/components/screen-reader-announcer';

function NameInput({inputValue, setInputValue, onSubmit, disabled}: {
    inputValue: string;
    setInputValue: (value: string) => void;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    disabled: boolean;
}) {
    return <div className="w-full relative">
        <input
            name="name"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    await onSubmit(e);
                }
            }}
            placeholder="e.g., Production, Development, Mobile App"
            className="w-full px-5 py-2.5 pr-14 ring-1 ring-[#e3d4bf] placeholder-[#c2b39f] focus:placeholder-[#e3d4bf] bg-white rounded-4xl resize-none focus:outline-none max-h-64 text-lg transition-all hide-scrollbar"
            maxLength={300}
            disabled={disabled}
        />
        <button
            type="submit"
            disabled={disabled || !inputValue.trim()}
            className="absolute bottom-1.5 right-1.5 p-2 rounded-full bg-orange-500 enabled:hover:bg-orange-400 disabled:bg-[#faf3ea] enabled:cursor-pointer transition-colors group focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            aria-label="Create API key"
        >
            <PlusIcon className="w-5 h-5 group-disabled:text-[#e3d4bf] text-white stroke-3"/>
        </button>
    </div>
}

export default function CreateApiKeyForm() {
    const [isCreating, setIsCreating] = useState(false);
    const [newKey, setNewKey] = useState<{ apiKey: string; name: string } | null>(null);
    const [name, setName] = useState('');
    const [copied, setCopied] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);

    // Focus management hooks
    const focusTrapRef = useFocusTrap<HTMLDivElement>({ isActive: isModalOpen });
    useEscapeKey(() => closeDialog(), isModalOpen);
    useBodyScrollLock(isModalOpen);

    // Screen reader announcements
    const { announceSuccess, announceError, announceLoading } = useStatusAnnouncements();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        announceLoading('Creating API key');

        try {
            const result = await createApiKey(name);
            if (result.success) {
                setNewKey(result.data);
                setName(''); // Clear the input
                setIsModalOpen(true);
                dialogRef.current?.showModal(); // Show the dialog
                announceSuccess(`API key "${result.data.name}" created successfully`);
            } else {
                announceError('Failed to create API key');
            }
        } finally {
            setIsCreating(false);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            announceSuccess('API key copied to clipboard');
            setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
        } catch (err) {
            console.error('Failed to copy text: ', err);
            announceError('Failed to copy API key');
        }
    };

    const closeDialog = () => {
        setIsModalOpen(false);
        dialogRef.current?.close();
        setNewKey(null);
        setCopied(false);
    };

    // Handle ESC key and backdrop click
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const handleClick = (e: MouseEvent) => {
            const rect = dialog.getBoundingClientRect();
            const isInDialog = (
                rect.top <= e.clientY &&
                e.clientY <= rect.top + rect.height &&
                rect.left <= e.clientX &&
                e.clientX <= rect.left + rect.width
            );
            if (!isInDialog) {
                closeDialog();
            }
        };

        dialog.addEventListener('click', handleClick);
        return () => dialog.removeEventListener('click', handleClick);
    }, []);

    return <>
        <div className="ring-1 ring-[#e3d4bf] p-5 rounded-2xl">
            <h2 className="text-2xl font-semibold text-gray-900 mb-5">Create a new API key</h2>

            <form onSubmit={handleSubmit}>
                <div>
                    <label htmlFor="name" className="block font-medium text-gray-700 mb-1.5">Key Name</label>
                    <NameInput
                        inputValue={name}
                        setInputValue={setName}
                        onSubmit={handleSubmit}
                        disabled={isCreating}
                    />
                    <p className="text-sm text-gray-500 mt-1.5">Choose a descriptive name to help you identify this key later.</p>
                </div>
            </form>
        </div>

        {/* Dialog for displaying the new API key */}
        <dialog
            ref={dialogRef}
            className="backdrop:bg-black backdrop:opacity-75 backdrop-blur-2xl bg-white rounded-lg shadow-2xl border-0 p-0 max-w-lg w-full m-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
        >
            <div ref={focusTrapRef} className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h3 id="modal-title" className="text-xl font-semibold text-gray-900">
                        API Key Created Successfully
                    </h3>
                    <button
                        onClick={closeDialog}
                        className="p-1 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1"
                        aria-label="Close dialog"
                    >
                        <XMarkIcon className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Warning */}
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800">
                        ⚠️ Make sure to copy your API key now. You won&#39;t be able to see it again.
                    </p>
                </div>

                {/* API Key Display */}
                {newKey && (
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">API Key for &#34;{newKey.name}&#34;</label>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 px-3 py-2 bg-gray-50 border rounded-lg font-mono text-sm break-all">
                                {newKey.apiKey}
                            </code>
                            <button
                                onClick={() => copyToClipboard(newKey.apiKey)}
                                className={`px-3 py-2 rounded-lg transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                    copied
                                        ? 'bg-green-100 text-green-700 border border-green-200 focus:ring-green-500'
                                        : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                                }`}
                                aria-label={copied ? 'API key copied to clipboard' : 'Copy API key to clipboard'}
                            >
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end">
                    <button
                        onClick={closeDialog}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1"
                        autoFocus
                    >
                        Done
                    </button>
                </div>
            </div>
        </dialog>
    </>
}
