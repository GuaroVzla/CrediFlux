#!/usr/bin/env node
/**
 * Backfill de firmas visuales (dHash 9x8) en receipt_patterns.extra.
 *
 * Seguridad:
 *  - Por defecto es DRY-RUN. Sólo escribe con --apply.
 *  - Antes de escribir guarda un backup completo de las filas en reports/backups/.
 *  - Nunca imprime claves ni URLs firmadas; sólo conteos y nombres de banco.
 *
 * Uso:
 *   node scripts/backfill-pattern-signatures.mjs
 *   node scripts/backfill-pattern-signatures.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  VISUAL_SIGNATURE_ALGORITHM,
  VISUAL_SIGNATURE_VERSION,
} from '../shared/lib/visual-signature.js';

const APPLY = process.argv.includes('--apply');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));
loadEnvFile(path.join(process.cwd(), '.env'));

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const sharpModule = await import('sharp');
const sharp = sharpModule.default || sharpModule;
const { resolveUploadUrl } = await import('../server/services/uploads.js');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

async function signatureFromBuffer(buffer) {
  const metadata = await sharp(buffer).metadata();
  const { data, info } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill', kernel: 'lanczos3' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (data.length < 9 * 8) {
    throw new Error(`Buffer de muestra inesperado (${data.length} bytes)`);
  }

  const gray = data;
  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const offset = y * 9 + x;
      bits += gray[offset] > gray[offset + 1] ? '1' : '0';
    }
  }

  let hash = '';
  for (let index = 0; index < bits.length; index += 4) {
    hash += parseInt(bits.slice(index, index + 4), 2).toString(16);
  }

  const width = Number(metadata.width || info.width || 0);
  const height = Number(metadata.height || info.height || 0);

  return {
    algorithm: VISUAL_SIGNATURE_ALGORITHM,
    version: VISUAL_SIGNATURE_VERSION,
    hash,
    width: width || null,
    height: height || null,
    aspectRatio: width && height ? Number((width / height).toFixed(3)) : null,
  };
}

async function fetchPatternImage(row) {
  const reference = String(row.image_url || '');
  if (!reference) return null;

  if (reference.startsWith('supabase://')) {
    const signedUrl = await resolveUploadUrl(reference, 300);
    const response = await fetch(signedUrl);
    if (!response.ok) throw new Error(`Storage HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  if (reference.startsWith('/uploads/')) {
    const localPath = path.join(process.cwd(), 'public', reference.replace(/^\//, ''));
    return fs.readFileSync(localPath);
  }

  if (/^https?:\/\//.test(reference)) {
    const response = await fetch(reference);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  return null;
}

const { data: rows, error: readError } = await supabase
  .from('receipt_patterns')
  .select('id, bank_name, extra, image_url, image_key, image_mime, is_active, created_at')
  .order('created_at', { ascending: false });

if (readError) {
  console.error('No se pudieron leer los patrones:', readError.message);
  process.exit(1);
}

const patterns = rows || [];
let backupPath = null;

if (APPLY) {
  const backupDir = path.join(process.cwd(), 'reports', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  backupPath = path.join(backupDir, `pattern-signatures-before-${Date.now()}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ createdAt: new Date().toISOString(), count: patterns.length, rows: patterns }, null, 2)
  );
}

let updated = 0;
let skipped = 0;
let failed = 0;

for (const row of patterns) {
  const existing = row.extra?.visualSignature;
  if (existing) {
    skipped += 1;
    console.log(`omitido  ${row.bank_name} (ya tiene firma)`);
    continue;
  }

  try {
    const buffer = await fetchPatternImage(row);
    if (!buffer) {
      skipped += 1;
      console.log(`omitido  ${row.bank_name} (sin imagen resoluble)`);
      continue;
    }

    const visualSignature = await signatureFromBuffer(buffer);
    if (APPLY) {
      const extra = { ...(row.extra || {}), visualSignature };
      const { error: updateError } = await supabase
        .from('receipt_patterns')
        .update({ extra })
        .eq('id', row.id);
      if (updateError) throw updateError;
    }

    updated += 1;
    console.log(`${APPLY ? 'actualizado' : 'simulado  '} ${row.bank_name} hash=${visualSignature.hash}`);
  } catch (error) {
    failed += 1;
    console.warn(`fallido   ${row.bank_name}: ${error?.message || error}`);
  }
}

let withSignature = 'n/a';
if (APPLY) {
  const { data: verifyRows, error: verifyError } = await supabase
    .from('receipt_patterns')
    .select('id, extra');
  if (!verifyError) {
    withSignature = (verifyRows || []).filter((row) => row.extra?.visualSignature).length;
  }
}

console.log('\n=== BACKFILL FIRMAS VISUALES ===');
console.log(`modo=${APPLY ? 'apply' : 'dry-run'} destino=receipt_patterns.extra.visualSignature`);
console.log(`filas=${patterns.length} actualizadas/simuladas=${updated} omitidas=${skipped} fallidas=${failed}`);
console.log(`firmas tras la corrida=${withSignature}`);
if (backupPath) console.log(`backup=${backupPath}`);
console.log('================================');
