import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { put, del } from '@vercel/blob';

/**
 * Abstracción de almacenamiento de archivos.
 *
 * Prioridad de proveedores:
 *   1. Supabase Storage (bucket privado `receipts`) -- persistente y con más
 *      espacio que Vercel Blob. Requiere NEXT_PUBLIC_SUPABASE_URL y
 *      SUPABASE_SERVICE_ROLE_KEY (ya presentes en el proyecto).
 *   2. Vercel Blob -- compatible con despliegues sin service_role.
 *   3. FS local -- solo desarrollo.
 *
 * Los objetos se guardan bajo `{userId}/{folder}/{filename}` para coincidir
 * con las políticas RLS del bucket `receipts` (primer segmento = auth.uid()).
 * En la base de datos se persiste una referencia `supabase://bucket/path`
 * que se convierte en URL firmada al leer, ya que el bucket es privado.
 */

const SUPABASE_BUCKET = process.env.SUPABASE_RECEIPTS_BUCKET || 'receipts';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días

let _supabaseStorageClient = null;

function getSupabaseStorageClient() {
  if (_supabaseStorageClient) return _supabaseStorageClient;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) return null;
  _supabaseStorageClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return _supabaseStorageClient;
}

function isSupabaseStorageEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isBlobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Extrae { bucket, path } de una referencia `supabase://bucket/object/path`. */
function parseSupabaseReference(reference) {
  if (!reference) return null;
  const match = String(reference).match(/^supabase:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], path: match[2] };
}

/**
 * Guarda un archivo y devuelve { url, key, storage, bucket, path }.
 * `url` es una referencia `supabase://...` cuando se usa Supabase Storage;
 * las rutas API la convierten en URL firmada antes de enviarla al cliente.
 */
export async function saveUpload(buffer, { filename, folder = 'uploads', contentType, userId } = {}) {
  const safeFolder = String(folder || 'uploads').replace(/[^a-zA-Z0-9/_-]/g, '');
  const safeName = String(filename || `file_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ownerSegment = String(userId || 'shared').replace(/[^a-zA-Z0-9_-]/g, '') || 'shared';
  const keyPath = `${ownerSegment}/${safeFolder}/${safeName}`.replace(/\/+/g, '/');

  // 1) Supabase Storage (proveedor preferido)
  const supabase = getSupabaseStorageClient();
  if (supabase) {
    try {
      const { error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(keyPath, buffer, {
          contentType: contentType || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false,
        });
      if (error) throw error;
      return {
        url: `supabase://${SUPABASE_BUCKET}/${keyPath}`,
        key: keyPath,
        bucket: SUPABASE_BUCKET,
        path: keyPath,
        storage: 'supabase',
      };
    } catch (error) {
      // No romper el flujo: se intenta el siguiente proveedor.
      console.warn('Supabase Storage no pudo guardar el comprobante:', error?.message || error);
    }
  }

  // 2) Vercel Blob (compatibilidad con despliegues sin service_role)
  const blobKeyPath = `${safeFolder}/${safeName}`.replace(/\/+/g, '/');
  if (isBlobEnabled()) {
    try {
      const blob = await put(blobKeyPath, buffer, {
        access: 'public',
        contentType: contentType || undefined,
        addRandomSuffix: false,
      });
      return {
        url: blob.url,
        key: blob.pathname || blobKeyPath,
        storage: 'blob',
      };
    } catch (error) {
      console.warn('Vercel Blob no pudo guardar el comprobante:', error?.message || error);
    }
  }

  // 3) Fallback local (solo desarrollo; Vercel tiene FS de solo lectura)
  const dir = path.join(process.cwd(), 'public', safeFolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, buffer);
  const localUrl = `/${safeFolder}/${safeName}`.replace(/\/+/g, '/');
  return { url: localUrl, key: blobKeyPath, storage: 'local' };
}

/**
 * Convierte una referencia guardada en BD en una URL que el navegador puede abrir.
 * Las URL de Blob/local se devuelven tal cual; las referencias `supabase://`
 * se transforman en URL firmadas porque el bucket `receipts` es privado.
 */
export async function resolveUploadUrl(reference, expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  if (!reference) return reference;
  const parsed = parseSupabaseReference(reference);
  if (!parsed) return reference;

  const supabase = getSupabaseStorageClient();
  if (!supabase) return reference;

  try {
    const { data, error } = await supabase.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, expiresIn);
    if (error) throw error;
    return data?.signedUrl || reference;
  } catch (error) {
    console.warn('No se pudo generar la URL firmada del comprobante:', error?.message || error);
    return reference;
  }
}

/**
 * Resuelve varias referencias conservando el orden. Agrupa por bucket para
 * hacer una sola llamada `createSignedUrls` por bucket en lugar de una por
 * archivo (evita decenas de round-trips al listar transacciones).
 */
export async function resolveUploadUrls(values, expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  const list = values || [];
  const result = [...list];
  const supabase = getSupabaseStorageClient();
  if (!supabase) return result;

  const groups = new Map(); // bucket -> [{ index, path }]
  list.forEach((value, index) => {
    const parsed = parseSupabaseReference(value);
    if (!parsed) return;
    if (!groups.has(parsed.bucket)) groups.set(parsed.bucket, []);
    groups.get(parsed.bucket).push({ index, path: parsed.path });
  });

  await Promise.all(
    Array.from(groups.entries()).map(async ([bucket, items]) => {
      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrls(items.map((item) => item.path), expiresIn);
        if (error) throw error;
        items.forEach((item, i) => {
          const signedUrl = data?.[i]?.signedUrl;
          if (signedUrl) result[item.index] = signedUrl;
        });
      } catch (error) {
        console.warn('No se pudieron generar las URLs firmadas de comprobantes:', error?.message || error);
      }
    })
  );

  return result;
}

export async function deleteUpload({ key, url } = {}) {
  if (!key && !url) return { deleted: false };

  const parsed = parseSupabaseReference(url) || parseSupabaseReference(key);
  const supabase = getSupabaseStorageClient();

  if (supabase && (parsed || isSupabaseStorageEnabled())) {
    try {
      const bucket = parsed?.bucket || SUPABASE_BUCKET;
      const objectPath = parsed?.path || String(key || '').replace(/^\/+/, '');
      if (objectPath) {
        const { error } = await supabase.storage.from(bucket).remove([objectPath]);
        if (!error) return { deleted: true, storage: 'supabase' };
      }
    } catch (e) {
      // best-effort
    }
  }

  // Blob (compatibilidad)
  try {
    if (isBlobEnabled() && (String(url || '').includes('blob.vercel-storage.com') || (key && !parsed))) {
      await del(url || key);
      return { deleted: true, storage: 'blob' };
    }
  } catch (e) {
    // best-effort
  }

  // Intento local
  try {
    const localPath = url && String(url).startsWith('/')
      ? path.join(process.cwd(), 'public', String(url))
      : null;
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      return { deleted: true, storage: 'local' };
    }
  } catch (e) {}
  return { deleted: false };
}

export function storageInfo() {
  if (isSupabaseStorageEnabled()) {
    return {
      persistent: true,
      provider: 'supabase-storage',
      bucket: SUPABASE_BUCKET,
    };
  }
  if (isBlobEnabled()) {
    return { persistent: true, provider: 'vercel-blob' };
  }
  return { persistent: false, provider: 'local-fs' };
}
