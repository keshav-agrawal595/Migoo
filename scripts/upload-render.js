const { put } = require('@vercel/blob');
const fs = require('fs');
const path = require('path');

async function upload() {
  const filePath = path.join(process.cwd(), 'out/video.mp4');
  const videoId = process.env.VIDEO_ID;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const webhookUrl = process.env.WEBHOOK_URL;

  if (!videoId) {
    console.error('Missing VIDEO_ID');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error('Rendered file not found:', filePath);
    // Notify failure via webhook
    if (webhookUrl) {
      await notifyWebhook(webhookUrl, videoId, null, 'failed');
    }
    process.exit(1);
  }

  console.log('Uploading video to Vercel Blob...');
  const fileBuffer = fs.readFileSync(filePath);

  try {
    const blob = await put(`shorts/final/${videoId}.mp4`, fileBuffer, {
      access: 'public',
      token: token,
      contentType: 'video/mp4',
    });

    console.log('Video uploaded successfully:', blob.url);

    // Notify the application backend via webhook
    if (webhookUrl) {
      await notifyWebhook(webhookUrl, videoId, blob.url, 'completed');
    }

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Upload failed:', error);
    // Notify failure via webhook
    if (webhookUrl) {
      await notifyWebhook(webhookUrl, videoId, null, 'failed');
    }
    process.exit(1);
  }
}

async function notifyWebhook(webhookUrl, videoId, videoUrl, status) {
  try {
    console.log(`Calling webhook: ${webhookUrl} (status: ${status})`);
    const response = await fetch(webhookUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, videoUrl, status }),
    });

    if (response.ok) {
      console.log('Webhook notified successfully');
    } else {
      console.error('Webhook notification failed:', await response.text());
    }
  } catch (err) {
    console.error('Webhook call error:', err);
  }
}

upload();
