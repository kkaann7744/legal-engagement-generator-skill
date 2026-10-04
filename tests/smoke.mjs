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

function tamper(bundle, kind, before, after, expected) {
  const script = `
import sys, io, zipfile, importlib.util
from pathlib import Path
from xml.etree import ElementTree as ET
spec = importlib.util.spec_from_file_location('verify', sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
bundle = Path(sys.argv[2]); doc = bundle / ('client-001-' + sys.argv[3] + '.docx')
original = doc.read_bytes()
try:
    stream = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(stream, 'w') as target:
        for item in source.infolist():
            content = source.read(item.filename)
            if item.filename == 'word/document.xml':
                root = ET.fromstring(content); changed = False
                ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
                for paragraph in root.iter(ns + 'p'):
                    runs = list(paragraph.iter(ns + 't'))
                    text = ''.join(run.text or '' for run in runs)
                    if sys.argv[4] in text:
                        runs[0].text = text.replace(sys.argv[4], sys.argv[5])
                        for run in runs[1:]: run.text = ''
                        changed = True
                assert changed, 'mutation target missing'
                content = ET.tostring(root, encoding='utf-8', xml_declaration=True)
            target.writestr(item, content)
    doc.write_bytes(stream.getvalue())
    issues = {i['code'] for i in mod.verify_bundle(bundle)['issues']}
    assert sys.argv[6] in issues, repr(issues)
finally:
    doc.write_bytes(original)
`;
  const r = spawnSync(process.env.PYTHON_EXECUTABLE || 'python3', ['-c', script,
    path.join(skill, 'scripts', 'verify.py'), bundle, kind, before, after, expected], {encoding: 'utf8'});
  assert.equal(r.status, 0, expected + ': ' + r.stderr);
  passed++;
}

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
  return output;
}

try {
  const preflightInput = path.join(temp, 'preflight.json');
  await fs.writeFile(preflightInput, JSON.stringify(base));
  const beforePreflight = await fs.readdir(temp);
  const preflight = spawnSync(process.execPath, [path.join(skill, 'scripts', 'generate.mjs'), '--check-only', '--input', preflightInput],
    {encoding: 'utf8', env: {...process.env, PLAYWRIGHT_MODULE: '/missing-playwright', PYTHON_EXECUTABLE: '/missing-python'}});
  assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);
  assert.equal(JSON.parse(preflight.stdout).fileCount, 4);
  assert.equal(JSON.parse(preflight.stdout).clientCount, 1);
  assert.deepEqual(await fs.readdir(temp), beforePreflight);
  for (const p of base.data.parties) assert.ok(!preflight.stdout.includes(p.name));
  passed++;
  const hourlyCheck = clone(); hourlyCheck.data.feeMode = 'hourly';
  await fs.writeFile(preflightInput, JSON.stringify(hourlyCheck));
  const warningCheck = spawnSync(process.execPath, [path.join(skill, 'scripts', 'generate.mjs'), '--input', preflightInput, '--check-only'], {encoding: 'utf8'});
  assert.equal(warningCheck.status, 0);
  assert.equal(JSON.parse(warningCheck.stdout).warnings[0].code, 'hourly_cap_defaults_to_advance');
  passed++;
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
    p.data.lawyer2 = '测试律师乙';
    if (key === 'litigation_first_instance') p.data.caseNo = '（2026）示例字第1号';
    const bundle = await run(key, p, 4);
    if (key === 'litigation_first_instance') {
      tamper(bundle, 'authorization', '测试律师乙', '未指定律师', 'second_lawyer_missing');
      tamper(bundle, 'agreement', '30,000.00', '30,001.00', 'fee_amount_mismatch');
      tamper(bundle, 'agreement', '（含税，下同）', '（不含税，下同）', 'tax_mode_mismatch');
      tamper(bundle, 'agreement', '均由甲方另行承担', '均由乙方承担', 'expense_mode_mismatch');
      tamper(bundle, 'agreement', '示例仲裁委员会', '错误仲裁委员会', 'agreement_dispute_clause_mismatch');
      tamper(bundle, 'letter', '（2026）示例字第1号', '错误案号', 'case_number_missing');
    }
  }
  const mixed = clone();
  mixed.data.parties.push({name: '虚构自然人丁', role: 'first_plaintiff', partyType: '自然人', isClient: true,
    clientAddress: '示例市虚构路4号', clientIdNo: '000000000000000000'});
  await run('mixed_selected_clients', mixed, 7);
  const alternative = clone();
  Object.assign(alternative.data, {docs: ['agreement'], taxMode: 'excluded', expenseMode: 'firm',
    conflictWaiver: true, conflictClient: '虚构关联客户戊'});
  const alternateBundle = await run('agreement_options', alternative, 1);
  tamper(alternateBundle, 'agreement', '虚构关联客户戊', '其他主体', 'conflict_waiver_mismatch');
  for (const [type, key] of [['execPartner', 'executive_partner'], ['delegate', 'delegate']]) {
    const p = clone(); p.data.docs = ['certificate'];
    Object.assign(p.data.parties[0], {partyType: type, repPosition: '执行事务合伙人', execPartnerName: '虚构合伙人机构'});
    await run(key, p, 1);
  }
  for (const fee of ['hourly', 'hybrid']) {
    const p = clone(); p.data.docs = ['agreement']; p.data.feeMode = fee;
    p.data.feeRate = '6'; p.data.feeCap = '100000'; p.data.branch = 'shanghai';
    const bundle = await run(fee + '_agreement', p, 1);
    if (fee === 'hourly') tamper(bundle, 'agreement', '100,000.00', '10,000.00', 'fee_cap_mismatch');
    else tamper(bundle, 'agreement', '6.00%', '7.00%', 'fee_rate_mismatch');
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
  bad('amount_rounding', p => p.data.feeAmount = '100.001', 'unsupported_precision');
  bad('rate_rounding', p => {p.data.feeMode = 'hybrid'; p.data.feeRate = '6.001';}, 'unsupported_precision');
  bad('cap_rounding', p => {p.data.feeMode = 'hourly'; p.data.feeCap = '100.001';}, 'unsupported_precision');
  bad('orphan_party', p => p.data.parties.push(null), 'object_required');
  for (const [key, plan, code] of bads) {
    assert.ok(validatePlan(plan).some(i => i.code === code), key);
    const input = path.join(temp, key + '.json'), output = path.join(temp, key);
    await fs.writeFile(input, JSON.stringify(plan));
    const r = spawnSync(process.execPath, [path.join(skill, 'scripts', 'generate.mjs'), '--input', input, '--output-dir', output], {encoding: 'utf8'});
    assert.equal(r.status, 2); assert.equal(JSON.parse(r.stdout).status, 'invalid_input');
    assert.ok(JSON.parse(r.stdout).issues.every(i => typeof i.message === 'string'));
    assert.ok(!r.stdout.includes('never-echo-this'));
    for (const p of plan.data.parties.filter(Boolean)) assert.ok(!r.stdout.includes(p.name));
    await assert.rejects(fs.access(output));
    passed++;
  }
  console.log(JSON.stringify({passed: true, scenarios: passed, generatedDocuments: fileCount}));
} finally {
  await fs.rm(temp, {recursive: true, force: true});
}
