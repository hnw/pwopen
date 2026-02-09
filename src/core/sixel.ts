import sharp from 'sharp';
import { image2sixel } from 'sixel';

let warnedOnce = false;

export async function renderSixel(image: Buffer): Promise<void> {
  try {
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelData = new Uint8ClampedArray(data);
    const sixel = image2sixel(pixelData, info.width, info.height, 256, 0);
    process.stdout.write(sixel);
    process.stdout.write('\n');
  } catch (error) {
    if (!warnedOnce) {
      console.warn(`[WARN] Failed to render Sixel preview: ${String(error)}`);
      warnedOnce = true;
    }
  }
}
