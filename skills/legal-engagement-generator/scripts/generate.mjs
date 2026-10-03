#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validatePlan } from './schema.mjs';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const emit = x => process.stdout.write(JSON.stringify(x) + '\n');
function error(code) { const e = new Error(code); e.safeCode = code; return e; }
async function playwright() {
  if (process.env.PLAYWRIGHT_MODULE) {
    try { return await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href); }
    catch { throw error('playwright_unavailable'); }
  }
  try { return await import('playwright'); } catch {}
  const bundled = path.resolve(path.dirname(process.execPath), '..', 'node_modules', 'playwright', 'index.mjs');
  try { return await import(pathToFileURL(bundled).href); }
  catch { throw error('playwright_unavailable'); }
}
function browserPath(chromium) {
  const paths = process.env.BROWSER_EXECUTABLE ? [process.env.BROWSER_EXECUTABLE] : [
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')
  ];
  const found = paths.find(p => existsSync(p));
  if (!found) throw error('browser_unavailable');
  return found;
}
function pythonPath() {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE;
  const sibling = path.resolve(path.dirname(process.execPath), '..', '..', 'python', 'bin', 'python3');
  return existsSync(sibling) ? sibling : 'python3';
}

let browser, output, ownsOutput = false;
try {
  if (args.includes('--help')) {
    emit({usage: 'node generate.mjs --input plan.json --output-dir new-directory'});
    process.exitCode = 0;
  } else {
    if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output-dir') throw error('invalid_arguments');
    let plan;
    try { plan = JSON.parse(await fs.readFile(path.resolve(args[1]), 'utf8')); }
    catch { throw error('input_unreadable_or_invalid_json'); }
    const issues = validatePlan(plan);
    if (issues.length) {
      emit({status: 'invalid_input', issues});
      process.exitCode = 2;
    } else {
      output = path.resolve(args[3]);
      await fs.mkdir(path.dirname(output), {recursive: true});
      try { await fs.mkdir(output, {mode: 0o700}); ownsOutput = true; }
      catch { throw error('output_exists_or_unwritable'); }
      const { chromium } = await playwright();
      try { browser = await chromium.launch({headless: true, executablePath: browserPath(chromium)}); }
      catch (e) { throw error(e.safeCode || 'browser_launch_failed'); }
      const context = await browser.newContext({serviceWorkers: 'block'});
      await context.route(/^https?:\/\//i, route => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.goto(pathToFileURL(path.join(skill, 'assets', 'generator.html')).href, {waitUntil: 'domcontentloaded'});
      const generated = await page.evaluate(async plan => {
        try {
          window.engagementGenerator.apply(plan.data);
          const data = collectData();
          const errors = validateData(data);
          if (errors.length) return {status: 'validation_failed', issueCount: errors.length};
          const files = await buildFiles(data);
          const clients = data.clients;
          const packed = [];
          for (const f of files) {
            const bytes = new Uint8Array(await f.blob.arrayBuffer());
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
            packed.push({clientIndex: clients.findIndex(c => c.name === f.client), docType: f.docType, base64: btoa(binary)});
          }
          return {status: 'generated', files: packed, skippedCertificates: data.docs.includes('certificate') ? clients.filter(p => !p.certificateAllowed).length : 0};
        } catch { return {status: 'generator_failed'}; }
      }, plan);
      if (generated.status !== 'generated' || !generated.files.length) throw error(generated.status);
      await browser.close(); browser = null;
      const files = [];
      for (const f of generated.files) {
        const filename = `client-${String(f.clientIndex + 1).padStart(3, '0')}-${f.docType}.docx`;
        await fs.writeFile(path.join(output, filename), Buffer.from(f.base64, 'base64'), {mode: 0o600, flag: 'wx'});
        files.push({filename, docType: f.docType, clientIndex: f.clientIndex});
      }
      await fs.writeFile(path.join(output, 'source-plan.json'), JSON.stringify(plan, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
      const manifest = {schemaVersion: 1, fileCount: files.length, skippedCertificates: generated.skippedCertificates, files};
      await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
      const verification = spawnSync(pythonPath(), [path.join(skill, 'scripts', 'verify.py'), '--bundle', output], {encoding: 'utf8', timeout: 60000});
      if (verification.status !== 0) throw error('verification_failed');
      emit({status: 'generated', fileCount: files.length, skippedCertificates: generated.skippedCertificates, verification: 'passed'});
    }
  }
} catch (e) {
  if (ownsOutput) await fs.rm(output, {recursive: true, force: true}).catch(() => {});
  emit({status: 'failed', code: e.safeCode || 'local_generation_failed'});
  process.exitCode = 2;
} finally {
  if (browser) await browser.close().catch(() => {});
}
