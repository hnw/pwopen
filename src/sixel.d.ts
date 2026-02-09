declare module 'sixel' {
  export function image2sixel(
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    maxColors?: number,
    backgroundSelect?: number,
  ): string;
}
