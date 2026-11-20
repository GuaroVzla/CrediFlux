/**
 * Cálculo de la firma visual en el navegador.
 *
 * Se importa sólo desde componentes cliente: usa canvas y createImageBitmap,
 * por lo que no debe incluirse en rutas API ni en componentes de servidor.
 */

import {
  VISUAL_SIGNATURE_ALGORITHM,
  VISUAL_SIGNATURE_VERSION,
} from './visual-signature.js';

const SAMPLE_WIDTH = 9;
const SAMPLE_HEIGHT = 8;

async function decodeImage(source) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source);
    } catch {
      // Algunos navegadores rechazan WebP/Android; se prueba la vía <img>.
    }
  }

  const objectUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Devuelve { algorithm, version, hash, width, height, aspectRatio } o null. */
export async function computeVisualSignature(source) {
  if (!source || typeof window === 'undefined') return null;

  let image = null;
  try {
    image = await decodeImage(source);
    const width = Number(image.width || image.naturalWidth || 0);
    const height = Number(image.height || image.naturalHeight || 0);
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;

    const gray = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    for (let index = 0; index < gray.length; index += 1) {
      const offset = index * 4;
      gray[index] = Math.round(
        pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114
      );
    }

    let bits = '';
    for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
      for (let x = 0; x < SAMPLE_WIDTH - 1; x += 1) {
        const offset = y * SAMPLE_WIDTH + x;
        bits += gray[offset] > gray[offset + 1] ? '1' : '0';
      }
    }

    let hash = '';
    for (let index = 0; index < bits.length; index += 4) {
      hash += parseInt(bits.slice(index, index + 4), 2).toString(16);
    }

    return {
      algorithm: VISUAL_SIGNATURE_ALGORITHM,
      version: VISUAL_SIGNATURE_VERSION,
      hash,
      width,
      height,
      aspectRatio: Number((width / height).toFixed(3)),
    };
  } catch (error) {
    console.warn('No se pudo calcular la firma visual:', error?.message || error);
    return null;
  } finally {
    if (image && typeof image.close === 'function') image.close();
  }
}
