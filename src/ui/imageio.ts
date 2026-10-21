import { rgbaToGray } from '../core/image';
import type { Bitmap, GrayImage } from '../core/types';

export interface LoadedImage {
  /** The picture, scaled down to at most `maxDim` on its longest side. */
  canvas: HTMLCanvasElement;
  gray: GrayImage;
}

/** Decodes an image file (honouring EXIF rotation) into a canvas and a grayscale copy. */
export async function loadImageFile(file: Blob, maxDim: number): Promise<LoadedImage> {
  let source: ImageBitmap;
  try {
    source = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This browser can't open that image. Try a JPEG or PNG (on iPhone, sharing or exporting the photo usually converts it).",
    );
  }
  const scale = Math.min(1, maxDim / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, gray: rgbaToGray(data, canvas.width, canvas.height) };
}

/** Renders a bitmap as dark ink on a transparent canvas. */
export function bitmapToCanvas(b: Bitmap, color = '#1d2433'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = b.width;
  canvas.height = b.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(b.width, b.height);
  const n = parseInt(color.slice(1), 16);
  for (let i = 0; i < b.data.length; i += 1) {
    if (!b.data[i]) continue;
    img.data[i * 4] = (n >> 16) & 255;
    img.data[i * 4 + 1] = (n >> 8) & 255;
    img.data[i * 4 + 2] = n & 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
