"use client"
import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { UserDetailContext } from '@/context/UserDetailContext';
import { useUser } from '@clerk/nextjs';

function Provider({ children }: { children: React.ReactNode }) {
    const { isSignedIn, isLoaded } = useUser();
    const [userDetail, setUserDetail] = useState(null);

    useEffect(() => {
        const CreateNewUser = async () => {
            if (isLoaded && isSignedIn) {
                try {
                    const result = await axios.post('/api/user', {});
                    console.log(result.data);
                    setUserDetail(result.data);
                } catch (error) {
                    console.error('Error creating user:', error);
                }
            }
        }

        CreateNewUser();
    }, [isSignedIn, isLoaded]);

    return (
        <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
            <div className='max-w-7xl mx-auto min-h-screen'>
                {children}
            </div>
        </UserDetailContext.Provider>
    )
}

export default Provider