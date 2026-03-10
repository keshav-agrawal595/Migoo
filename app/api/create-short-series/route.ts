import { db } from '@/config/db';
import { shortVideoSeries } from '@/config/schema';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { niche, language, voice, music, videoStyle, captionStyle, title, duration, platform, publishTime, userId } = body;

        // Validate required fields
        if (!niche || !language || !voice || !music || !videoStyle || !captionStyle || !title || !duration || !platform || !publishTime || !userId) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const seriesId = uuidv4();

        const [result] = await db.insert(shortVideoSeries).values({
            seriesId,
            userId,
            niche,
            language,
            voice,
            music,
            videoStyle,
            captionStyle,
            title,
            duration,
            platform,
            publishTime: new Date(publishTime),
            status: 'active',
        }).returning();

        return NextResponse.json({ success: true, seriesId: result.seriesId });
    } catch (error: any) {
        console.error('Error saving series:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
