import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validatePlan } from '../skills/legal-engagement-generator/scripts/schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'skills', 'legal-engagement-generator');
const base = JSON.parse(await fs.readFile(path.join(skill, 'assets', 'example-plan.json'), 'utf8'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'engagement-synthetic-'));
const clone = () => structuredClone(base);
let passed = 0, fileCount = 0;

async function run(key, plan, expected) {
  const input = path.join(temp, key + '.json');
  const output = path.join(temp, key);
  await fs.writeFile(input, JSON.stringify(plan), {mode: 0o600});
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts', 'generate.mjs'), '--input', input, '--output-dir', output], {encoding: 'utf8', timeout: 60000});
  assert.equal(r.status, 0, key + ': ' + r.stdout + r.stderr);
  const status = JSON.parse(r.stdout);
  assert.equal(status.fileCount, expected);
  assert.equal(status.verification, 'passed');
  for (const p of plan.data.parties) assert.ok(!r.stdout.includes(p.name), 'stdout identity exposure');
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, expected);
  for (const f of manifest.files) assert.match(f.filename, /^client-\d{3}-(agreement|authorization|certificate|letter)\.docx$/);
  const verification = JSON.parse(await fs.readFile(path.join(output, 'verification.json'), 'utf8'));
  assert.equal(verification.status, 'passed');
  assert.equal(verification.visualReview, 'not_performed');
  assert.equal(verification.modelReview, 'not_performed');
  const again = spawnSync(process.execPath, [path.join(skill, 'scripts', 'generate.mjs'), '--input', input, '--output-dir', output], {encoding: 'utf8'});
  assert.equal(again.status, 2);
  assert.equal(JSON.parse(again.stdout).code, 'output_exists_or_unwritable');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8')), manifest);
  passed++; fileCount += expected;
  console.log(JSON.stringify({scenario: key, passed: true, fileCount: expected}));
}

try {
  for (const [key, clientRole, otherRole] of [
    ['litigation_first_instance', 'first_plaintiff', 'first_defendant'],
    ['litigation_second_instance', 'appeal_appellee', 'appeal_appellant'],
    ['litigation_retrial', 'retrial_respondent', 'retrial_applicant'],
    ['enforcement', 'enforcement_respondent', 'enforcement_applicant'],
    ['arbitration_applicant', 'arbitration_applicant', 'arbitration_respondent'],
    ['arbitration_respondent', 'arbitration_respondent', 'arbitration_applicant']
  ]) {
    const p = clone(); p.data.procedureType = key;
    p.data.parties = p.data.parties.slice(0, 2);
    p.data.parties[0].role = clientRole; p.data.parties[1].role = otherRole;
    await run(key, p, 4);
  }
  const mixed = clone();
  mixed.data.parties.push({name: '虚构自然人丁', role: 'first_plaintiff', partyType: '自然人', isClient: true,
    clientAddress: '示例市虚构路4号', clientIdNo: '000000000000000000'});
  await run('mixed_selected_clients', mixed, 7);
  for (const [type, key] of [['execPartner', 'executive_partner'], ['delegate', 'delegate']]) {
    const p = clone(); p.data.docs = ['certificate'];
    Object.assign(p.data.parties[0], {partyType: type, repPosition: '执行事务合伙人', execPartnerName: '虚构合伙人机构'});
    await run(key, p, 1);
  }
  for (const fee of ['hourly', 'hybrid']) {
    const p = clone(); p.data.docs = ['agreement']; p.data.feeMode = fee;
    p.data.feeRate = '6'; p.data.feeCap = '100000'; p.data.branch = 'shanghai';
    await run(fee + '_agreement', p, 1);
  }
  const third = clone(); third.data.docs = ['authorization']; third.data.parties[0].role = 'first_third_party';
  third.data.parties = third.data.parties.slice(0, 2);
  delete third.data.feeAmount;
  await run('third_party_authorization_without_fee', third, 1);

  const bads = [];
  function bad(key, edit, code) { const p = clone(); edit(p); bads.push([key, p, code]); }
  bad('general_authority', p => p.data.authType = '一般授权', 'general_authorization_unsupported');
  bad('opposing_clients', p => p.data.parties[1].isClient = true, 'opposing_clients_unsupported');
  bad('draft', p => p.analysis.status = 'draft', 'not_ready');
  bad('invalid_date', p => p.data.signDate = '2026-02-30', 'invalid_date');
  bad('duplicate', p => p.data.parties[1].name = p.data.parties[0].name, 'duplicate_party');
  bad('unknown_field', p => p.data.customerSecret = 'never-echo-this', 'unknown_field');
  bad('ambiguous_selection', p => p.data.parties[0].isClient = 'true', 'boolean_required');
  bad('passport_label', p => Object.assign(p.data.parties[0], {partyType: '自然人', repName: '', repPosition: '', clientIdNo: 'TEST-ONLY', idType: '护照'}), 'unsupported_identity_label');
  bad('natural_certificate_only', p => {
    p.data.docs = ['certificate']; Object.assign(p.data.parties[0], {partyType: '自然人', repName: '', repPosition: '', clientIdNo: '000000000000000000'});
  }, 'no_applicable_certificate');
  bad('prototype_role', p => p.data.parties[0].role = 'toString', 'invalid_selection');
  bad('authority_source', p => delete p.analysis.authorizationBasis, 'authority_source_required');
  for (const [key, plan, code] of bads) {
    assert.ok(validatePlan(plan).some(i => i.code === code), key);
    const input = path.join(temp, key + '.json'), output = path.join(temp, key);
    await fs.writeFile(input, JSON.stringify(plan));
    const r = spawnSync(process.execPath, [path.join(skill, 'scripts', 'generate.mjs'), '--input', input, '--output-dir', output], {encoding: 'utf8'});
    assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).status, 'invalid_input');
    assert.ok(!r.stdout.includes('never-echo-this'));
    for (const p of plan.data.parties) assert.ok(!r.stdout.includes(p.name));
    await assert.rejects(fs.access(output));
    passed++;
  }
  console.log(JSON.stringify({passed: true, scenarios: passed, generatedDocuments: fileCount}));
} finally {
  await fs.rm(temp, {recursive: true, force: true});
}
