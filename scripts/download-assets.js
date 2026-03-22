import fs from 'fs';
import path from 'path';

async function downloadAvatarClips() {
    console.log('📥 Running pre-render asset download script...');
    
    const propsPath = path.join(process.cwd(), 'tmp', 'props.json');
    if (!fs.existsSync(propsPath)) {
        console.error('❌ props.json not found in tmp/');
        process.exit(1);
    }

    const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
    const tmpDir = path.join(process.cwd(), 'public', 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    let modified = false;

    if (props.avatarClipData && Array.isArray(props.avatarClipData)) {
        for (let i = 0; i < props.avatarClipData.length; i++) {
            const clip = props.avatarClipData[i];
            if (clip && clip.url && clip.url.startsWith('http')) {
                try {
                    // Extract a unique identifier or scene index
                    const localName = `avatar_scene_${i}.webm`;
                    const localPath = path.join(tmpDir, localName);
                    
                    console.log(`  Downloading ${clip.url} to ${localPath}...`);
                    const response = await fetch(clip.url);
                    
                    if (response.ok) {
                        const buffer = Buffer.from(await response.arrayBuffer());
                        fs.writeFileSync(localPath, buffer);
                        
                        // Use relative URL for Remotion to serve statically
                        const fileUrl = `/tmp/${localName}`;
                        props.avatarClipData[i] = { ...clip, url: fileUrl };
                        modified = true;
                        
                        console.log(`  ✅ Downloaded scene ${i + 1}: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
                    } else {
                        console.error(`  ❌ Failed to download! Status: ${response.status}`);
                    }
                } catch (err) {
                    console.error(`  ⚠️ Failed to download avatar clip ${i + 1}:`, err);
                }
            }
        }
    }

    if (modified) {
        fs.writeFileSync(propsPath, JSON.stringify(props));
        console.log('✅ props.json updated with local paths');
    } else {
        console.log('⏭️ No avatar clips to download or no changes needed.');
    }
}

downloadAvatarClips().catch(err => {
    console.error('Fatal error in download-assets.js:', err);
    process.exit(1);
});
