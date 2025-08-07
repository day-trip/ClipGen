import { NextRequest, NextResponse } from 'next/server';
import { refreshTokens } from '../actions';

export async function POST(request: NextRequest) {
    try {
        const success = await refreshTokens();
        
        if (success) {
            return NextResponse.json({ success: true });
        } else {
            return NextResponse.json({ success: false, error: 'Failed to refresh tokens' }, { status: 401 });
        }
    } catch (error) {
        console.error('Refresh route error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}