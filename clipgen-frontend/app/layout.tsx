import type {Metadata} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import "./globals.css";
import "@/app/lib/auth";
import React from "react";
import { ToastProvider } from "@/app/components/ui/toast";
import { ErrorBoundary } from "@/app/components/error-boundary";
import { ScreenReaderAnnouncerProvider } from "@/app/components/screen-reader-announcer";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Clipgen",
    description: "Generate short video clips from your text prompts",
};

export default function RootLayout({children}: Readonly<{ children: React.ReactNode; }>) {
    return (
        <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ErrorBoundary>
            <ScreenReaderAnnouncerProvider>
                <ToastProvider>
                    {children}
                </ToastProvider>
            </ScreenReaderAnnouncerProvider>
        </ErrorBoundary>
        </body>
        </html>
    );
}