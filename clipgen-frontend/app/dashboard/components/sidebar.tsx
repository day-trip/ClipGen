'use client';

import {ArrowRightStartOnRectangleIcon, BookOpenIcon, DocumentTextIcon, KeyIcon} from '@heroicons/react/24/outline';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import Image from "next/image";
import {signOut} from "@/app/auth/actions";

const navigation = [
    {
        name: 'Playground',
        href: '/dashboard/playground',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-6V7a2 2 0 00-2-2H5a2 2 0 00-2 2v3m0 0V19a2 2 0 002 2h14a2 2 0 002-2v-9M7 7h10"/>
            </svg>
        )
    },
    {
        name: 'API Access',
        href: '/dashboard/api-keys',
        icon: <KeyIcon className="text-current w-5 h-5"/>
    },
    {
        name: 'Documentation',
        href: '/docs',
        icon: <BookOpenIcon className="text-current w-5 h-5"/>
    },
    {
        name: 'Request Logs',
        href: '/dashboard/logs',
        icon: <DocumentTextIcon className="text-current w-5 h-5"/>
    }
];

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="w-48 flex flex-col h-full border-r border-r-[#c2b39f]">
            {/* Logo/Brand */}
            <div className="px-6 py-4 border-b border-b-[#c2b39f]">
                <div className="flex items-center">
                    <Image
                        aria-hidden
                        src="/logo.png"
                        alt="VoltagePark Logo"
                        width={25}
                        height={25}
                    />
                    <h1 className="ms-3 text-2xl font-semibold text-black">Clipgen</h1>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 py-6">
                <ul className="space-y-1">
                    {navigation.map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                        return <li key={item.name}>
                            <Link
                                href={item.href}
                                className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 text-black ${isActive ? 'bg-[#e3d4bf]' : ' hover:bg-[#f5eadc]'}`}>
                                <span className={`mr-3 transition-colors ${isActive ? 'text-orange-400' : 'text-gray-500'}`}>{item.icon}</span>
                                {item.name}
                            </Link>
                        </li>
                    })}
                </ul>
            </nav>

            {/* Sign out */}
            <form action={signOut} className="p-4 border-t border-gray-800">
                <button
                    type="submit"
                    className="w-full group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 text-black hover:bg-[#f5eadc]"
                    aria-label="Sign out of your account"
                >
                    <ArrowRightStartOnRectangleIcon className="w-5 h-5 mr-3"/>
                    Sign out
                </button>
            </form>
        </div>
    );
}