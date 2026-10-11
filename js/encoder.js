// Worker: turns an ImageBitmap into a JPEG off the main thread. Used in Chromium,
// where main-thread toBlob stalls while the viewfinder runs.
const canvas = new OffscreenCanvas(1, 1);
const x = canvas.getContext('2d');

onmessage = async ({ data: { id, bmp, q } }) => {
  try {
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    x.drawImage(bmp, 0, 0);
    bmp.close();
    postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: q }) });
  } catch (e) {
    postMessage({ id, error: e.message });
  }
};
