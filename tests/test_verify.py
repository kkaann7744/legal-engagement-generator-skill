#!/usr/bin/env python3
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

SKILL = Path(__file__).resolve().parents[1] / 'skills' / 'legal-engagement-generator'
spec = importlib.util.spec_from_file_location('bundle_verify', SKILL / 'scripts' / 'verify.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class BundleVerification(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bundle = Path(self.temp.name)
        self.plan = json.loads((SKILL / 'assets' / 'example-plan.json').read_text())
        self.plan['data']['docs'] = ['authorization']
        self.name = 'client-001-authorization.docx'
        self.manifest = {'schemaVersion': 1, 'fileCount': 1, 'skippedCertificates': 0,
                         'files': [{'filename': self.name, 'docType': 'authorization', 'clientIndex': 0}]}
        self.paras = ['委 托 人：虚构客户甲有限公司', '虚构对方乙有限公司 买卖合同纠纷 作为委托人一审程序的代理人',
                      '测试律师甲 测试代表甲 代理权限为特别授权', '委托人：虚构客户甲有限公司（盖章）', '2026年10月2日']
        self.write()

    def tearDown(self):
        self.temp.cleanup()

    def write(self):
        (self.bundle / 'source-plan.json').write_text(json.dumps(self.plan, ensure_ascii=False))
        (self.bundle / 'manifest.json').write_text(json.dumps(self.manifest))
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        xml += ''.join('<w:p><w:r><w:t>' + escape(t) + '</w:t></w:r></w:p>' for t in self.paras)
        xml += '</w:body></w:document>'
        with zipfile.ZipFile(self.bundle / self.name, 'w') as z:
            z.writestr('[Content_Types].xml', '<Types/>')
            z.writestr('word/document.xml', xml)

    def codes(self):
        return {i['code'] for i in verify.verify_bundle(self.bundle)['issues']}

    def test_valid_bundle(self):
        result = verify.verify_bundle(self.bundle)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['visualReview'], 'not_performed')

    def test_wrong_client(self):
        self.paras = [p.replace('虚构客户甲有限公司', '错误主体') for p in self.paras]
        self.write()
        self.assertIn('client_missing', self.codes())

    def test_other_party_as_client(self):
        self.paras.append('委托人：虚构同方丙有限公司')
        self.write()
        self.assertIn('other_party_as_client', self.codes())

    def test_missing_date(self):
        self.paras.pop()
        self.write()
        self.assertIn('signature_date_missing', self.codes())

    def test_bad_zip(self):
        (self.bundle / self.name).write_bytes(b'bad ZIP')
        self.assertIn('invalid_docx', self.codes())

    def test_path_traversal(self):
        self.manifest['files'][0]['filename'] = '../private-secret.docx'
        self.write()
        result = verify.verify_bundle(self.bundle)
        self.assertIn('invalid_or_duplicate_filename', {i['code'] for i in result['issues']})
        self.assertNotIn('private-secret', json.dumps(result))

    def test_unlisted_file(self):
        (self.bundle / 'unexpected.docx').write_bytes(b'not allowed')
        self.assertIn('unlisted_document', self.codes())

    def test_general_authority_rejected(self):
        self.plan['data']['authType'] = '一般授权'
        self.write()
        self.assertIn('unsupported_authorization', self.codes())

    def test_internal_note(self):
        self.paras.append('内部注：供内部参考')
        self.write()
        self.assertIn('internal_template_marker', self.codes())

    def test_missing_opponent(self):
        self.paras[1] = '买卖合同纠纷 作为委托人一审程序的代理人'
        self.write()
        self.assertIn('opposing_party_missing', self.codes())

    def test_wrong_procedure_despite_incidental_word(self):
        self.paras[1] = '虚构对方乙有限公司 买卖合同纠纷 一审判决 作为委托人二审程序的代理人'
        self.write()
        self.assertIn('procedure_missing', self.codes())


if __name__ == '__main__':
    unittest.main()
