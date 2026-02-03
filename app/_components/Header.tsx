"use client"
import { Button } from '@/components/ui/button';
import { UserButton, useUser } from '@clerk/nextjs'
import Image from 'next/image'
import Link from 'next/link'

function Header() {
    const { isSignedIn, isLoaded } = useUser();

    // Show loading state
    if (!isLoaded) {
        return (
            <div className='flex items-center justify-between p-4'>
                <div className='flex gap-2 items-center'>
                    <div className="w-20 h-20 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div className="w-10 h-10 bg-gray-200 rounded-full animate-pulse"></div>
            </div>
        )
    }

    return (
        <div className='flex items-center justify-between p-4 border-b shadow-sm bg-white'>
            {/* Left: Logo */}
            <div className='flex gap-2 items-center'>
                <Image src={'/logo.png'} alt='logo' width={75} height={75} />
            </div>

            {/* Center: Navigation */}
            <div className='flex gap-8 items-center'>
                <span className='text-lg hover:text-primary transition-colors cursor-pointer'>Home</span>
                <span className='text-lg hover:text-primary transition-colors cursor-pointer'>Price</span>
            </div>

            {/* Right: Auth Button */}
            <div className='flex items-center'>
                {isSignedIn ?
                    <UserButton afterSignOutUrl="/" /> :
                    <Link href="/sign-in">
                        <Button className="px-6 py-2 bg-primary hover:bg-primary/90">
                            Get Started
                        </Button>
                    </Link>
                }
            </div>
        </div>
    )
}

export default Header