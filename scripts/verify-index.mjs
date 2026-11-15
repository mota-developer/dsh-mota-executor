#!/usr/bin/env node
// Self-check for the published package and the format-1 plugin market index.
//
// Mirrors the essentials of @deepseek-ai/dsh-plugin-market-index (0.2.2-rc.3)
// without taking a runtime dependency. With --remote it also proves that the
// pinned git commit exists and that an npm-published version is present.

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv.includes('--remote');

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const DATA_ICON = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/;
const MAX_INLINE_ICON_BYTES = 32 * 1024;
const MAX_PUBLISH_TIMESTAMP = 100_000_000_000;

const problems = [];
const notes = [];
const bad = (where, why) => problems.push(`${where}: ${why}`);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function localized(where, value) {
  if (typeof value === 'string') {
    if (!value.trim()) bad(where, 'must not be blank');
    return;
  }
  if (!isObject(value)) {
    bad(where, 'must be a string or a language map');
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) bad(where, 'language map must not be empty');
  for (const key of keys) {
    if (!LANGUAGE_ID.test(key)) bad(`${where}.${key}`, 'invalid language id');
    if (typeof value[key] !== 'string' || !value[key].trim()) {
      bad(`${where}.${key}`, 'must be a non-blank string');
    }
  }
  if (!keys.includes('en')) bad(where, 'language map must include "en"');
}

function httpUrl(where, value, { canonical = false, segments = 0, query = false, fragment = true } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    bad(where, 'must be an absolute URL');
    return;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') bad(where, 'must use http or https');
  if (url.username || url.password) bad(where, 'must not carry credentials');
  if (canonical && url.href !== value) bad(where, 'must be the canonical URL (no trailing slash, no default port)');
  if (query && (url.search || url.hash)) bad(where, 'must not carry a query or fragment');
  if (!fragment && url.hash) bad(where, 'must not carry a fragment');
  if (segments > 0) {
    const count = url.pathname.split('/').filter(Boolean).length;
    if (count < segments) bad(where, `must have at least ${segments} path segments`);
  }
  return url;
}

function validRange(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.startsWith('workspace:')) return false;
  const clauses = value.split('||');
  return clauses.every((clause) => {
    const tokens = clause.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((token) => {
      if (token === '*' || token === 'x' || token === 'X') return true;
      const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(token);
      return Boolean(match);
    });
  });
}

function compareSemver(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  const core = (m) => [Number(m[1]), Number(m[2]), Number(m[3])];
  const [a0, a1, a2] = core(pa);
  const [b0, b1, b2] = core(pb);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  const pre = (m) => (m[4] ? m[4].split('.') : []);
  const aPre = pre(pa);
  const bPre = pre(pb);
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;
  const n = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < n; i += 1) {
    if (aPre[i] === undefined) return -1;
    if (bPre[i] === undefined) return 1;
    const an = /^\d+$/.test(aPre[i]);
    const bn = /^\d+$/.test(bPre[i]);
    if (an && bn) {
      const d = Number(aPre[i]) - Number(bPre[i]);
      if (d !== 0) return d;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (aPre[i] !== bPre[i]) {
      return aPre[i] < bPre[i] ? -1 : 1;
    }
  }
  return 0;
}

async function readJson(file) {
  let text;
  try {
    text = await readFile(path.join(root, file), 'utf8');
  } catch (error) {
    bad(file, `cannot be read (${error.code ?? error.message})`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    bad(file, `invalid JSON (${error.message})`);
    return null;
  }
}

async function main() {
  const pkg = await readJson('package.json');
  const index = await readJson('index.json');
  if (!pkg || !index) return finish();

  // ---- package -----------------------------------------------------------
  if (pkg.private === true) bad('package.json.private', 'must be absent or false to publish');
  if (typeof pkg.name !== 'string' || !PACKAGE_NAME.test(pkg.name)) bad('package.json.name', 'invalid npm package name');
  if (pkg.name.startsWith('@local/')) bad('package.json.name', 'scoped @local name cannot be published');
  if (typeof pkg.version !== 'string' || !SEMVER.test(pkg.version)) bad('package.json.version', 'must be an exact SemVer');

  const enginesDsh = pkg.engines?.dsh;
  if (typeof enginesDsh !== 'string') bad('package.json.engines.dsh', 'required for the plugin market');
  else if (!validRange(enginesDsh)) bad('package.json.engines.dsh', `not a valid range: ${enginesDsh}`);

  if (typeof pkg.repository?.url !== 'string') bad('package.json.repository.url', 'required');
  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('dsh-plugin')) {
    bad('package.json.keywords', 'must include "dsh-plugin"');
  }
  if (typeof pkg.license !== 'string' || !pkg.license) bad('package.json.license', 'required');
  for (const exported of ['./icon', './locale/*.json']) {
    if (!Object.hasOwn(pkg.exports ?? {}, exported)) bad(`package.json.exports["${exported}"]`, 'must be exported');
  }
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') bad('package.json.dsh.bundle.patch', 'must point at ./cordis.patch.yml');

  for (const entry of pkg.files ?? []) {
    try {
      await stat(path.join(root, entry));
    } catch {
      bad(`package.json.files["${entry}"]`, 'does not exist');
    }
  }

  // ---- bundle patch ------------------------------------------------------
  let patch = '';
  try {
    patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
  } catch {
    bad('cordis.patch.yml', 'cannot be read');
  }
  if (patch && !new RegExp(`name:\\s*['"]?${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?`).test(patch)) {
    bad('cordis.patch.yml', `insert name must equal the package name (${pkg.name})`);
  }

  // ---- display assets ----------------------------------------------------
  const locales = ['en', 'zh'];
  for (const language of locales) {
    const locale = await readJson(`locale/${language}.json`);
    if (!locale) continue;
    const meta = locale.meta;
    if (!isObject(meta)) {
      bad(`locale/${language}.json.meta`, 'required');
      continue;
    }
    for (const field of ['title', 'description']) {
      if (typeof meta[field] !== 'string' || !meta[field].trim()) bad(`locale/${language}.json.meta.${field}`, 'must be non-blank');
    }
    if (typeof meta.detail === 'string' && meta.detail) {
      try {
        await stat(path.join(root, meta.detail));
      } catch {
        bad(`locale/${language}.json.meta.detail`, `file not found: ${meta.detail}`);
      }
    }
  }
  try {
    const icon = await stat(path.join(root, 'icon.svg'));
    if (icon.size > 256 * 1024) bad('icon.svg', 'larger than 256 KiB');
  } catch {
    bad('icon.svg', 'missing');
  }

  // ---- index -------------------------------------------------------------
  if (index.format !== 1) {
    bad('index.json.format', 'must be exactly 1');
    return finish();
  }
  localized('index.json.title', index.title);
  if (index.description !== undefined) localized('index.json.description', index.description);

  const categories = index.metadata?.categories ?? {};
  const labels = index.metadata?.labels ?? {};
  const sortKeys = index.metadata?.sortKeys ?? {};
  for (const [id, entry] of Object.entries(categories)) {
    if (!id.trim()) bad('index.json.metadata.categories', 'empty id');
    if (!isObject(entry)) bad(`index.json.metadata.categories.${id}`, 'must be an object');
    else localized(`index.json.metadata.categories.${id}.title`, entry.title);
  }
  for (const [id, entry] of Object.entries(labels)) {
    if (!id.trim()) bad('index.json.metadata.labels', 'empty id');
    if (!isObject(entry)) bad(`index.json.metadata.labels.${id}`, 'must be an object');
    else localized(`index.json.metadata.labels.${id}.title`, entry.title);
  }
  for (const [id, entry] of Object.entries(sortKeys)) {
    if (!isObject(entry)) {
      bad(`index.json.metadata.sortKeys.${id}`, 'must be an object');
      continue;
    }
    localized(`index.json.metadata.sortKeys.${id}.title`, entry.title);
    if (entry.order !== 'asc' && entry.order !== 'desc') bad(`index.json.metadata.sortKeys.${id}.order`, 'must be asc or desc');
  }

  const plugins = Array.isArray(index.plugins) ? index.plugins : [];
  if (plugins.length === 0) bad('index.json.plugins', 'must contain at least one plugin');
  const names = new Set();
  for (const [i, plugin] of plugins.entries()) {
    const at = `index.json.plugins[${i}]`;
    if (!isObject(plugin)) {
      bad(at, 'must be an object');
      continue;
    }
    if (typeof plugin.name !== 'string' || !PACKAGE_NAME.test(plugin.name) || plugin.name.length > 214) {
      bad(`${at}.name`, 'invalid npm package name');
    } else if (names.has(plugin.name)) {
      bad(`${at}.name`, `duplicate plugin ${plugin.name}`);
    } else {
      names.add(plugin.name);
    }
    localized(`${at}.title`, plugin.title);
    if (plugin.description !== undefined) localized(`${at}.description`, plugin.description);
    if (plugin.icon !== undefined) {
      const data = typeof plugin.icon === 'string' ? DATA_ICON.exec(plugin.icon) : null;
      if (data) {
        const bytes = Math.floor((data[1].length * 3) / 4);
        if (bytes > MAX_INLINE_ICON_BYTES) bad(`${at}.icon`, 'inline icon larger than 32 KiB');
      } else if (typeof plugin.icon !== 'string') {
        bad(`${at}.icon`, 'must be a URL or data URL');
      }
    }
    if (plugin.author !== undefined && (typeof plugin.author !== 'string' || !plugin.author.trim())) {
      bad(`${at}.author`, 'must be a non-blank string');
    }
    if (plugin.homepage !== undefined) httpUrl(`${at}.homepage`, plugin.homepage);
    if (plugin.repository !== undefined) {
      if (!isObject(plugin.repository)) bad(`${at}.repository`, 'must be an object');
      else {
        httpUrl(`${at}.repository.url`, plugin.repository.url, { query: true, fragment: false });
        if (plugin.repository.directory !== undefined) {
          for (const segment of String(plugin.repository.directory).split('/')) {
            if (segment && !PATH_SEGMENT.test(segment)) bad(`${at}.repository.directory`, 'invalid path segment');
          }
        }
      }
    }

    const metadata = plugin.metadata ?? {};
    if (isObject(metadata)) {
      if (metadata.category !== undefined && !Object.hasOwn(categories, metadata.category)) {
        bad(`${at}.metadata.category`, `undeclared category ${metadata.category}`);
      }
      if (metadata.keywords !== undefined) {
        if (!Array.isArray(metadata.keywords) || !metadata.keywords.every((k) => typeof k === 'string' && k.trim())) {
          bad(`${at}.metadata.keywords`, 'must be an array of non-blank strings');
        }
      }
      if (metadata.labels !== undefined) {
        if (!Array.isArray(metadata.labels)) bad(`${at}.metadata.labels`, 'must be an array');
        else {
          const seen = new Set();
          for (const label of metadata.labels) {
            if (!Object.hasOwn(labels, label)) bad(`${at}.metadata.labels`, `undeclared label ${label}`);
            if (seen.has(label)) bad(`${at}.metadata.labels`, `duplicate label ${label}`);
            seen.add(label);
          }
        }
      }
      if (metadata.sortKeys !== undefined) {
        if (!isObject(metadata.sortKeys)) {
          bad(`${at}.metadata.sortKeys`, 'must be an object');
        } else {
          for (const key of Object.keys(metadata.sortKeys)) {
            if (!Object.hasOwn(sortKeys, key)) bad(`${at}.metadata.sortKeys`, `undeclared sort key ${key}`);
            const value = metadata.sortKeys[key];
            if (value !== null && !Number.isFinite(value)) bad(`${at}.metadata.sortKeys.${key}`, 'must be a finite number or null');
          }
        }
      }
    }

    const versions = Array.isArray(plugin.versions) ? plugin.versions : [];
    if (versions.length === 0) bad(`${at}.versions`, 'must not be empty');
    const seenVersions = new Set();
    let previous;
    for (const [j, version] of versions.entries()) {
      const vat = `${at}.versions[${j}]`;
      if (!isObject(version)) {
        bad(vat, 'must be an object');
        continue;
      }
      if (typeof version.version !== 'string' || !SEMVER.test(version.version)) {
        bad(`${vat}.version`, 'must be an exact SemVer');
      } else {
        if (seenVersions.has(version.version)) bad(`${vat}.version`, `duplicate version ${version.version}`);
        seenVersions.add(version.version);
        if (previous !== undefined && compareSemver(previous, version.version) <= 0) {
          notes.push(`${vat}.version: versions are not in descending SemVer order (${previous} -> ${version.version})`);
        }
        previous = version.version;
      }
      if (!Number.isInteger(version.publishTimestamp) || version.publishTimestamp < 0 || version.publishTimestamp >= MAX_PUBLISH_TIMESTAMP) {
        bad(`${vat}.publishTimestamp`, 'must be an integer timestamp in seconds');
      }
      const source = version.source;
      if (!isObject(source)) {
        bad(`${vat}.source`, 'must be an object');
      } else if (source.type === 'npm') {
        if (source.registry !== undefined) httpUrl(`${vat}.source.registry`, source.registry, { query: true, fragment: false });
      } else if (source.type === 'git') {
        const url = httpUrl(`${vat}.source.url`, source.url, { canonical: true, segments: 2, query: true, fragment: false });
        if (url && /\.(tgz|tar\.gz)$/.test(url.pathname)) bad(`${vat}.source.url`, 'must not be a tarball URL');
        if (typeof source.commit !== 'string' || !COMMIT.test(source.commit)) bad(`${vat}.source.commit`, 'must be 40 lowercase hex characters');
        if (source.path !== undefined) {
          for (const segment of String(source.path).split('/')) {
            if (segment && !PATH_SEGMENT.test(segment)) bad(`${vat}.source.path`, 'invalid path segment');
          }
        }
      } else {
        bad(`${vat}.source.type`, 'must be "npm" or "git"');
      }
      if (version.engines !== undefined) {
        if (!isObject(version.engines)) bad(`${vat}.engines`, 'must be an object');
        else if (version.engines.dsh !== undefined && !validRange(version.engines.dsh)) {
          bad(`${vat}.engines.dsh`, `not a valid range: ${version.engines.dsh}`);
        }
      }
    }
  }

  // ---- cross-check the package against its index entry -------------------
  const entry = plugins.find((plugin) => plugin?.name === pkg.name);
  if (!entry) {
    bad('index.json.plugins', `no entry for the package ${pkg.name}`);
  } else {
    const latest = entry.versions?.[0];
    if (latest?.version !== pkg.version) bad('index.json', `latest version ${latest?.version} does not match package.json ${pkg.version}`);
    if (enginesDsh !== undefined && latest?.engines?.dsh !== enginesDsh) {
      bad('index.json', `engines.dsh ${latest?.engines?.dsh} does not match package.json ${enginesDsh}`);
    }
    const repository = pkg.repository?.url?.replace(/^git\+/, '');
    if (repository && entry.repository?.url && entry.repository.url !== repository.replace(/\.git$/, '')) {
      notes.push(`index.json repository ${entry.repository.url} differs from package.json ${repository}`);
    }
  }

  await remoteCheck(plugins);
  finish();
}

async function remoteCheck(plugins) {
  if (!remote) return;
  for (const [i, plugin] of plugins.entries()) {
    for (const [j, version] of (plugin.versions ?? []).entries()) {
      const at = `index.json.plugins[${i}].versions[${j}]`;
      const source = version.source;
      if (source?.type === 'git') {
        const url = new URL(source.url);
        if (url.hostname !== 'github.com') {
          notes.push(`${at}: remote check skipped for non-GitHub git source`);
          continue;
        }
        const [owner, repo] = url.pathname.split('/').filter(Boolean);
        const api = `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, '')}/commits/${source.commit}`;
        const response = await fetch(api, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-mota-executor-verify' } });
        if (response.status !== 200) bad(at, `pinned commit ${source.commit} not found on GitHub (HTTP ${response.status})`);
        else notes.push(`${at}: commit ${source.commit.slice(0, 12)} verified on GitHub`);
      } else if (source?.type === 'npm') {
        const registry = source.registry ?? 'https://registry.npmjs.org';
        const response = await fetch(`${registry.replace(/\/$/, '')}/${plugin.name}`);
        if (response.status === 404) {
          notes.push(`${at}: ${plugin.name}@${version.version} not published on npm yet`);
          continue;
        }
        if (response.status !== 200) {
          bad(at, `npm registry returned HTTP ${response.status}`);
          continue;
        }
        const body = await response.json();
        if (!body.versions?.[version.version]) bad(at, `${plugin.name}@${version.version} is not on npm`);
        else notes.push(`${at}: ${plugin.name}@${version.version} verified on npm`);
      }
    }
  }
}

function finish() {
  if (notes.length > 0) {
    console.log('Notes:');
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nOK: package and index.json are consistent and match format 1.');
}

await main();
