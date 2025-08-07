// Basic XSS protection utilities
// Note: For production, consider using a more robust library like DOMPurify

/**
 * Escape HTML characters to prevent XSS attacks
 * @param unsafe - The unsafe string to escape
 * @returns The HTML-escaped string
 */
export function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\//g, "&#x2F;");
}

/**
 * Sanitize user input by removing potentially dangerous characters
 * @param input - The input string to sanitize
 * @returns The sanitized string
 */
export function sanitizeInput(input: string): string {
    if (typeof input !== 'string') return '';
    
    // Remove null characters and control characters except newlines and tabs
    return input
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim();
}

/**
 * Validate and sanitize a prompt string
 * @param prompt - The prompt to sanitize
 * @param maxLength - Maximum allowed length (default: 1000)
 * @returns Sanitized prompt or throws error if invalid
 */
export function sanitizePrompt(prompt: string, maxLength: number = 1000): string {
    if (typeof prompt !== 'string') {
        throw new Error('Prompt must be a string');
    }
    
    const sanitized = sanitizeInput(prompt);
    
    if (sanitized.length === 0) {
        throw new Error('Prompt cannot be empty');
    }
    
    if (sanitized.length > maxLength) {
        throw new Error(`Prompt must be ${maxLength} characters or less`);
    }
    
    // Check for potential script injection attempts
    const dangerousPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /data:text\/html/gi,
        /vbscript:/gi
    ];
    
    for (const pattern of dangerousPatterns) {
        if (pattern.test(sanitized)) {
            throw new Error('Invalid characters detected in prompt');
        }
    }
    
    return sanitized;
}

/**
 * Sanitize an API key name
 * @param name - The API key name to sanitize
 * @returns Sanitized name or throws error if invalid
 */
export function sanitizeApiKeyName(name: string): string {
    if (typeof name !== 'string') {
        throw new Error('API key name must be a string');
    }
    
    const sanitized = sanitizeInput(name);
    
    if (sanitized.length === 0) {
        throw new Error('API key name cannot be empty');
    }
    
    if (sanitized.length > 100) {
        throw new Error('API key name must be 100 characters or less');
    }
    
    // Only allow alphanumeric characters, spaces, hyphens, and underscores
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(sanitized)) {
        throw new Error('API key name contains invalid characters');
    }
    
    return sanitized;
}

/**
 * Sanitize a job ID parameter
 * @param jobId - The job ID to sanitize
 * @returns Sanitized job ID or throws error if invalid
 */
export function sanitizeJobId(jobId: string): string {
    if (typeof jobId !== 'string') {
        throw new Error('Job ID must be a string');
    }
    
    const sanitized = sanitizeInput(jobId).replace(/\s/g, '');
    
    if (sanitized.length === 0) {
        throw new Error('Job ID cannot be empty');
    }
    
    // Assume UUIDs or similar alphanumeric IDs with hyphens
    if (!/^[a-zA-Z0-9\-_]+$/.test(sanitized)) {
        throw new Error('Invalid job ID format');
    }
    
    return sanitized;
}

/**
 * Safe JSON stringify that prevents prototype pollution
 * @param obj - Object to stringify
 * @returns JSON string
 */
export function safeJsonStringify(obj: any): string {
    return JSON.stringify(obj, (key, value) => {
        // Remove potentially dangerous properties
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
        }
        return value;
    });
}