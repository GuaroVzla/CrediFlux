import fs from 'fs';
import path from 'path';
import { put, del } from '@vercel/blob';

/**
 * Abstracción de almacenamiento de archivos.
 * - Producción/Vercel: Vercel Blob (persistente) cuando BLOB_READ_WRITE_TOKEN está definido.
 * - Desarrollo local: sistema de archivos en public/ (solo local, no persistente en Vercel).
 */

function isBlobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function saveUpload(buffer, { filename, folder = 'uploads', contentType } = {}) {
  const safeFolder = String(folder || 'uploads').replace(/[^a-zA-Z0-9/_-]/g, '');
  const safeName = String(filename || `file_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const keyPath = `${safeFolder}/${safeName}`.replace(/\/+/g, '/');

  if (isBlobEnabled()) {
    const blob = await put(keyPath, buffer, {
      access: 'public',
      contentType: contentType || undefined,
      addRandomSuffix: false,
    });
    return {
      url: blob.url,
      key: blob.pathname || keyPath,
      storage: 'blob',
    };
  }

  // Fallback local (desarrollo)
  const dir = path.join(process.cwd(), 'public', safeFolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, buffer);
  const url = `/${safeFolder}/${safeName}`.replace(/\/+/g, '/');
  return { url, key: keyPath, storage: 'local' };
}

export async function deleteUpload({ key, url } = {}) {
  if (!key && !url) return { deleted: false };
  try {
    if (isBlobEnabled() && (url?.includes('blob.vercel-storage.com') || key)) {
      await del(url || key);
      return { deleted: true, storage: 'blob' };
    }
  } catch (e) {
    // best-effort
  }

  // Intento local
  try {
    const localPath = url && url.startsWith('/') ? path.join(process.cwd(), 'public', url) : null;
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      return { deleted: true, storage: 'local' };
    }
  } catch (e) {}
  return { deleted: false };
}

export function storageInfo() {
  return {
    persistent: isBlobEnabled(),
    provider: isBlobEnabled() ? 'vercel-blob' : 'local-fs',
  };
}
