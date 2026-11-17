#!/usr/bin/env node
/**
 * Diagnóstico y reparación del proyecto en Vercel.
 *
 * Uso:
 *   $env:VERCEL_TOKEN = "..."            # https://vercel.com/account/tokens
 *   node scripts/vercel-setup.mjs        # solo diagnóstico (no cambia nada)
 *   node scripts/vercel-setup.mjs --apply
 *
 * --apply hace, en este orden:
 *   1. framework = nextjs, node 22.x, rootDirectory = ".", build/install commands.
 *   2. Carga NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *      SUPABASE_SERVICE_ROLE_KEY y SETTINGS_ENCRYPTION_KEY (de .env.local)
 *      en production, preview y development.
 *   3. Redeploy del último deployment a producción.
 *
 * No usa dependencias externas: fetch nativo de Node 20+.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const API = 'https://api.vercel.com';
const APPLY = process.argv.includes('--apply');
const TOKEN = process.env.VERCEL_TOKEN || '';

function loadEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SETTINGS_ENCRYPTION_KEY',
];

function die(message) {
  console.error(`\n[error] ${message}`);
  process.exit(1);
}

async function api(pathname, init = {}) {
  const res = await fetch(API + pathname, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON (p. ej. logs) */
  }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body : body?.error?.message || JSON.stringify(body);
    throw new Error(`${init.method || 'GET'} ${pathname} -> ${res.status}: ${detail}`);
  }
  return body;
}

async function findProject() {
  const { projects = [] } = await api('/v9/projects?limit=100');
  const wanted = (process.argv.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const match = projects.find((p) => {
    if (wanted) return p.name === wanted || p.id === wanted;
    const aliases = (p.alias || []).map((a) => String(a).toLowerCase());
    return (
      String(p.name).toLowerCase().includes('crediflux') ||
      aliases.some((a) => a.includes('crediflux'))
    );
  });
  return { project: match, projects };
}

async function showBuildLog(deploymentId) {
  try {
    const events = await api(
      `/v3/deployments/${deploymentId}/events?direction=backward&limit=300`
    );
    const lines = (Array.isArray(events) ? events : [])
      .filter((e) => e && typeof e.text === 'string')
      .map((e) => e.text);
    console.log('\n--- últimos logs del build ---');
    console.log(lines.slice(-40).join(''));
  } catch (error) {
    console.log(`(no se pudieron leer los logs: ${error.message})`);
  }
}

async function main() {
  if (!TOKEN) die('Falta VERCEL_TOKEN. Créalo en https://vercel.com/account/tokens');

  const me = await api('/v2/user');
  console.log(`Cuenta Vercel: ${me.user?.username || me.user?.email || 'desconocida'}`);

  const { project, projects } = await findProject();
  if (!project) {
    console.log(`\nProyectos visibles (${projects.length}):`);
    for (const p of projects) {
      console.log(` - ${p.name}  (${p.id})  framework=${p.framework || 'n/d'}`);
    }
    die(
      'No hay ningún proyecto "crediflux" en esta cuenta. ' +
        'El dominio crediflux.vercel.app pertenece a otra cuenta/proyecto: ' +
        'hace falta crear un proyecto nuevo o iniciar sesión con la cuenta correcta.'
    );
  }

  const detail = await api(`/v9/projects/${project.id}`);
  console.log(`\nProyecto: ${detail.name} (${detail.id})`);
  console.log(`  framework:      ${detail.framework ?? 'n/d'}`);
  console.log(`  nodeVersion:    ${detail.nodeVersion ?? 'n/d'}`);
  console.log(`  rootDirectory:  ${detail.rootDirectory ?? '(raíz)'}`);
  console.log(`  buildCommand:   ${detail.buildCommand ?? '(por defecto)'}`);
  console.log(`  installCommand: ${detail.installCommand ?? '(por defecto)'}`);
  console.log(`  repo:           ${
    detail.link
      ? `${detail.link.type}:${detail.link.org}/${detail.link.repo} (rama ${detail.link.productionBranch || 'n/d'})`
      : 'SIN VINCULAR'
  }`);
  console.log(`  dominios:       ${(detail.alias || []).join(', ') || '(ninguno)'}`);

  const envs = await api(`/v9/projects/${project.id}/env`);
  const present = new Set((envs.envs || []).map((e) => e.key));
  console.log('\nVariables de entorno:');
  for (const key of ENV_VARS) {
    console.log(`  ${present.has(key) ? 'OK  ' : 'FALTA'} ${key}`);
  }

  const { deployments = [] } = await api(
    `/v6/deployments?projectId=${project.id}&limit=5`
  );
  console.log('\nÚltimos deployments:');
  for (const d of deployments) {
    const when = new Date(d.created).toISOString().replace('T', ' ').slice(0, 16);
    console.log(
      `  ${when}  ${d.url}  estado=${d.readyState || d.state}  target=${d.target || 'preview'}`
    );
  }

  const failing = deployments.find(
    (d) => ['ERROR', 'ERROR_CANCELED'].includes(d.readyState || d.state)
  );
  const latest = deployments[0];
  if (failing && failing.id === latest?.id) await showBuildLog(failing.id);

  if (!APPLY) {
    console.log('\nDiagnóstico terminado. Nada modificado.');
    console.log('Ejecuta con --apply para corregir configuración, variables y redeploy.');
    return;
  }

  console.log('\n[apply] Ajustando configuración del proyecto...');
  await api(`/v9/projects/${project.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      framework: 'nextjs',
      nodeVersion: '22.x',
      rootDirectory: '.',
      buildCommand: 'npm run build',
      installCommand: 'npm install',
    }),
  });

  console.log('[apply] Cargando variables de entorno...');
  for (const key of ENV_VARS) {
    const value = process.env[key];
    if (!value) {
      console.log(`  omitida ${key} (no está en .env.local)`);
      continue;
    }
    await api(`/v10/projects/${project.id}/env?upsert=true`, {
      method: 'POST',
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production', 'preview', 'development'],
      }),
    });
    console.log(`  OK ${key}`);
  }

  if (!latest) {
    console.log('\n[apply] No hay deployments que redesplegar: haz un push a main.');
    return;
  }

  console.log(`[apply] Redesplegando ${latest.url} a producción...`);
  const created = await api('/v13/deployments', {
    method: 'POST',
    body: JSON.stringify({
      name: project.name,
      deploymentId: latest.uid || latest.id,
      target: 'production',
      withCache: false,
    }),
  });
  console.log(`  nuevo deployment: ${created.url || created.id}`);
  console.log('\nSigue el build en https://vercel.com/dashboard y luego valida:');
  console.log('  https://<dominio>/api/health -> { ok: true, supabaseConfigured: true }');
}

main().catch((error) => die(error.message));
