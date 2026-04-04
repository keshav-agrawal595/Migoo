import { db } from '@/config/db';
import { shortVideoAssets } from '@/config/schema';
import { eq } from 'drizzle-orm';

async function run() {
    const result = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, 'vid_1775291323116_xuhq5p'));
    console.log("SCENE VIDEO URLS:", JSON.stringify(result[0].sceneVideoUrls, null, 2));
}

run();
