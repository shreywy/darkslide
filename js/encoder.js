// Worker: turns a captured frame into a JPEG off the main thread, so fast interval
// runs don't stall the viewfinder.
const canvas = new OffscreenCanvas(1, 1);
const x = canvas.getContext('2d');

onmessage = async ({ data: { id, bmp, mirror, q } }) => {
  try {
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    x.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? bmp.width : 0, 0);
    x.drawImage(bmp, 0, 0);
    bmp.close();
    postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: q }) });
  } catch (e) {
    postMessage({ id, error: e.message });
  }
};
