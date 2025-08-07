'use client';

import React, { useState } from 'react';
import {deleteApiKey} from "@/app/dashboard/api-keys/actions";
import { ConfirmationModal } from '@/app/components/confirmation-modal';
import { useStatusAnnouncements } from '@/app/components/screen-reader-announcer';

export default function DeleteApiKeyButton({ apiKey }: { apiKey: string }) {
    const [showModal, setShowModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { announceSuccess, announceError, announceLoading } = useStatusAnnouncements();

    const handleDelete = async () => {
        setIsDeleting(true);
        announceLoading('Deleting API key');

        try {
            const result = await deleteApiKey(apiKey);
            if (result.success) {
                announceSuccess('API key deleted successfully');
            } else {
                announceError('Failed to delete API key');
            }
        } catch (error) {
            announceError('Failed to delete API key');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setShowModal(true)}
                className="text-red-600 hover:text-red-700 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 rounded px-1"
                aria-label={`Delete API key ${apiKey.substring(0, 8)}...`}
            >
                Delete
            </button>

            <ConfirmationModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onConfirm={handleDelete}
                title="Delete API Key"
                message="Are you sure you want to delete this API key? This action cannot be undone and any applications using this key will lose access immediately."
                confirmText="Delete Key"
                cancelText="Cancel"
                variant="danger"
                isLoading={isDeleting}
            />
        </>
    );
}