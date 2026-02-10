type SharpModule = typeof import('sharp');
type SixelModule = typeof import('sixel');

let warnedOnce = false;
let cachedDeps: { sharp: SharpModule; image2sixel: SixelModule['image2sixel'] } | null = null;
let loadingDeps: Promise<{ sharp: SharpModule; image2sixel: SixelModule['image2sixel'] }> | null =
  null;

async function loadSixelDeps(): Promise<{
  sharp: SharpModule;
  image2sixel: SixelModule['image2sixel'];
}> {
  if (cachedDeps) {
    return cachedDeps;
  }
  if (loadingDeps) {
    return loadingDeps;
  }

  const promise = (async () => {
    const sharpModule = (await import('sharp')) as unknown as SharpModule & {
      default?: SharpModule;
    };
    const sharp = sharpModule.default ?? sharpModule;
    const sixelModule = (await import('sixel')) as SixelModule;
    if (typeof sixelModule.image2sixel !== 'function') {
      throw new Error('image2sixel export not available');
    }

    cachedDeps = {
      sharp,
      image2sixel: sixelModule.image2sixel,
    };
    return cachedDeps;
  })();

  loadingDeps = promise;
  try {
    return await promise;
  } finally {
    if (loadingDeps === promise) {
      loadingDeps = null;
    }
  }
}

export async function renderSixel(image: Buffer): Promise<void> {
  try {
    const deps = await loadSixelDeps();
    const { data, info } = await deps
      .sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelData = new Uint8ClampedArray(data);
    const sixel = deps.image2sixel(pixelData, info.width, info.height, 256, 0);
    process.stdout.write(sixel);
    process.stdout.write('\n');
  } catch (error) {
    if (!warnedOnce) {
      console.warn(`[WARN] Failed to render Sixel preview: ${String(error)}`);
      warnedOnce = true;
    }
  }
}
