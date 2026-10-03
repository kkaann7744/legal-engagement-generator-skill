#!/usr/bin/env python3
"""Verify generated DOCX bundles locally; return counts/codes, never case text."""
import argparse
import hashlib
import json
import os
import re
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SIDES = {
    'first_plaintiff': 'A', 'first_defendant': 'B', 'first_third_party': 'T',
    'appeal_appellant': 'A', 'appeal_appellee': 'B', 'appeal_original_third_party': 'T',
    'retrial_applicant': 'A', 'retrial_respondent': 'B', 'retrial_other': 'T',
    'enforcement_applicant': 'A', 'enforcement_respondent': 'B',
    'arbitration_applicant': 'A', 'arbitration_respondent': 'B'
}
PROCEDURES = {'litigation_first_instance': '一审', 'litigation_second_instance': '二审',
              'litigation_retrial': '再审', 'enforcement': '执行',
              'arbitration_applicant': '仲裁', 'arbitration_respondent': '仲裁'}
DOCS = ('agreement', 'authorization', 'certificate', 'letter')


def read_docx(path):
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None:
            raise ValueError('corrupt_zip')
        if '[Content_Types].xml' not in z.namelist():
            raise ValueError('missing_content_types')
        root = ET.fromstring(z.read('word/document.xml'))
        texts = [''.join(t.text or '' for t in p.iter(W + 't'))
                 for p in root.iter(W + 'p')]
    return root, texts, '\n'.join(texts)


def verify_bundle(bundle):
    issues = []

    def add(code, filename=None):
        issues.append({'code': code, **({'filename': filename} if filename else {})})

    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    plan = json.loads((bundle / 'source-plan.json').read_text(encoding='utf-8'))
    data = plan['data']
    if plan.get('schemaVersion') != 1 or manifest.get('schemaVersion') != 1:
        add('unsupported_version')
    if plan['analysis'].get('status') != 'ready' or plan['analysis'].get('unresolved') != []:
        add('plan_not_ready')
    clients = [p for p in data['parties'] if p['isClient']]
    expected = {(i, t) for i, c in enumerate(clients) for t in data['docs']
                if not (t == 'certificate' and c['partyType'] == '自然人')}
    files = manifest['files']
    actual = {(f['clientIndex'], f['docType']) for f in files}
    if not expected or actual != expected or len(files) != len(expected) or manifest['fileCount'] != len(files):
        add('output_set_mismatch')
    if manifest.get('skippedCertificates') != (sum(p['partyType'] == '自然人' for p in clients) if 'certificate' in data['docs'] else 0):
        add('skipped_certificate_count_mismatch')
    if 'authorization' in data['docs'] and (data['authType'] != '特别授权' or not plan['analysis'].get('authorizationBasis')):
        add('unsupported_authorization')
    entries = []
    seen = set()
    for f in files:
        i, kind = f['clientIndex'], f['docType']
        # Never trust manifest paths, even when independently rechecking a package.
        if type(i) is not int or i < 0 or i >= len(clients) or kind not in DOCS:
            add('invalid_manifest_entry')
            continue
        name = f'client-{i + 1:03d}-{kind}.docx'
        if f['filename'] != name or name in seen:
            add('invalid_or_duplicate_filename')
            continue
        seen.add(name)
        path = bundle / name
        if path.is_symlink() or not path.is_file():
            add('document_missing', name)
            continue
        try:
            root, paras, text = read_docx(path)
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError):
            add('invalid_docx', name)
            continue
        before = len(issues)
        c = clients[i]
        if c['name'].strip() not in text:
            add('client_missing', name)
        if any(marker in text for marker in ('内部注', '注意事项', '填入公司名称', '若签约方为')):
            add('internal_template_marker', name)
        if root.findall('.//' + W + 'highlight'):
            add('template_highlight_remaining', name)
        if kind in ('agreement', 'authorization', 'letter'):
            opponents = [p for p in data['parties'] if not p['isClient'] and SIDES[p['role']] != SIDES[c['role']]]
            if any(p['name'].strip() not in text for p in opponents):
                add('opposing_party_missing', name)
        client_lines = [p.replace(' ', '').strip() for p in paras if p.replace(' ', '').startswith(('甲方：', '委托人：'))]
        if kind in ('agreement', 'authorization') and not any(c['name'].strip() in p for p in client_lines):
            add('client_signature_or_title_missing', name)
        others = [p for p in data['parties'] if p['name'] != c['name']]
        if any(p['name'].strip() in line for p in others for line in client_lines):
            add('other_party_as_client', name)
        if kind in ('authorization', 'letter') and data['lawyer1'].strip() not in text:
            add('lawyer_missing', name)
        if kind == 'letter' and data['court'].strip() not in text:
            add('forum_missing', name)
        procedure = data['procedureType']
        if kind == 'authorization':
            expected_procedure = ('争议仲裁案中，作为委托人的代理人' if procedure.startswith('arbitration')
                                  else f"作为委托人{PROCEDURES[procedure]}程序的代理人")
            if expected_procedure not in text:
                add('procedure_missing', name)
        if kind == 'agreement':
            scope = {'enforcement': '强制执行', 'litigation_retrial': '审判监督'}.get(procedure, PROCEDURES[procedure])
            if f'本案的{scope}程序' not in text:
                add('procedure_missing', name)
        if kind == 'letter' and f"参加本案的{PROCEDURES[procedure]}法律程序" not in text:
            add('procedure_missing', name)
        if kind == 'authorization' and '代理权限为特别授权' not in text:
            add('authority_label_missing', name)
        if kind == 'authorization' and c['partyType'] == '自然人' and c['clientIdNo'].strip() not in text:
            add('natural_identity_missing', name)
        if kind in ('authorization', 'certificate') and c['partyType'] != '自然人' and c['repName'].strip() not in text:
            add('representative_missing', name)
        if kind == 'certificate' and c['partyType'] == '自然人':
            add('natural_certificate_unsupported', name)
        if not data.get('caseNo') and '案号：无' in text:
            add('empty_case_number_misrepresented', name)
        day = date.fromisoformat(data['signDate'])
        stamp = f'{day.year}年{day.month}月{day.day}日'
        if stamp not in re.sub(r'\s+', '', text):
            add('signature_date_missing', name)
        entries.append({'filename': name, 'passed': len(issues) == before,
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    actual_names = {p.name for p in bundle.glob('*.docx')}
    if actual_names != seen:
        add('unlisted_document')
    return {'status': 'passed' if not issues else 'failed', 'fileCount': len(files),
            'visualReview': 'not_performed', 'modelReview': 'not_performed',
            'issues': issues, 'files': entries}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True)
    args = parser.parse_args()
    bundle = Path(args.bundle).resolve()
    try:
        for name in ('manifest.json', 'source-plan.json'):
            if (bundle / name).is_symlink():
                raise ValueError('symlink_input')
        result = verify_bundle(bundle)
        report = bundle / 'verification.json'
        if report.is_symlink():
            raise ValueError('symlink_report')
        # Reports contain only neutral filenames, hashes and issue codes.
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        fd = os.open(report, flags, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        print(json.dumps({'status': result['status'], 'fileCount': result['fileCount'], 'issueCount': len(result['issues'])}))
        return 0 if result['status'] == 'passed' else 2
    except Exception:
        print(json.dumps({'status': 'failed', 'code': 'bundle_invalid_or_unreadable'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
