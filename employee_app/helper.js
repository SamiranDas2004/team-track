// helper.js
const { desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

// Directory to save screenshots
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir);
}

// Function to capture screenshot
async function takeScreenshot() {
  try {
    // Log to verify desktopCapturer
    console.log('desktopCapturer:', desktopCapturer);

    // Get  Get screen sources
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (!sources || sources.length === 0) {
      throw new Error('No screen sources available');
    }
    const screenSource = sources[0]; // Capture the primary screen

    // Create a video stream
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSource.id,
          maxWidth: 1920,
          maxHeight: 1080
        }
      }
    });

    // Create a video element to capture the frame
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();

    // Wait for the video to load
    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to data URL
      const dataURL = canvas.toDataURL('image/png');

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot-${timestamp}.png`;
      const filepath = path.join(screenshotDir, filename);

      // Save the screenshot
      const base64Data = dataURL.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(filepath, base64Data, 'base64');

      // Display the screenshot in the UI
      const screenshotContainer = document.getElementById('screenshotContainer');
      const img = document.createElement('img');
      img.src = dataURL;
      screenshotContainer.prepend(img);

      // Stop the stream
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    const screenshotStatus = document.getElementById('screenshotStatus');
    if (screenshotStatus) {
      screenshotStatus.textContent = 'Screenshot Capture: Error';
    }
  }
}

module.exports = { takeScreenshot };