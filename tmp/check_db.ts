import { db } from './config/db';
import { shortVideoAssets } from './config/schema';
import { desc } from 'drizzle-orm';

async function run() {
  try {
    const assets = await db.select().from(shortVideoAssets).orderBy(desc(shortVideoAssets.createdAt)).limit(1);
    console.log(JSON.stringify(assets, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
