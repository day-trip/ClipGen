import { requireAuth } from '../lib/auth-check';
import React from "react";
import Sidebar from "@/app/dashboard/components/sidebar";

export default async function DashboardLayout({children}: { children: React.ReactNode; }) {
    await requireAuth();

    return <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
            {children}
        </main>
    </div>
}