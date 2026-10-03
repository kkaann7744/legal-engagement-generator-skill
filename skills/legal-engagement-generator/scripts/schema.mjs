export const ROLES = {
  litigation_first_instance: {first_plaintiff: 'A', first_defendant: 'B', first_third_party: 'T'},
  litigation_second_instance: {appeal_appellant: 'A', appeal_appellee: 'B', appeal_original_third_party: 'T'},
  litigation_retrial: {retrial_applicant: 'A', retrial_respondent: 'B', retrial_other: 'T'},
  enforcement: {enforcement_applicant: 'A', enforcement_respondent: 'B'},
  arbitration_applicant: {arbitration_applicant: 'A', arbitration_respondent: 'B'},
  arbitration_respondent: {arbitration_applicant: 'A', arbitration_respondent: 'B'}
};
const DOCS = ['agreement', 'authorization', 'certificate', 'letter'];
const BRANCHES = ['beijing', 'shanghai', 'shenzhen', 'haikou', 'wuhan', 'hangzhou'];
const TYPES = ['法人', '非法人组织', '自然人', 'execPartner', 'delegate'];
const STRINGS = ['procedureType', 'branch', 'authType', 'clientGenerationMode', 'cause', 'caseNo', 'court',
  'signDate', 'lawyer1', 'lawyer2', 'phone1', 'phone2', 'email1', 'clientContact', 'clientPhone',
  'clientEmail', 'feeMode', 'feeAmount', 'feeRate', 'feeCap', 'taxMode', 'expenseMode', 'arbInstitution',
  'arbSeat', 'conflictClient'];
const PARTY_STRINGS = ['name', 'role', 'partyType', 'clientAddress', 'mailingAddress', 'creditCode',
  'idType', 'clientIdNo', 'repName', 'repPosition', 'execPartnerName', 'signerName', 'signerTitle',
  'contactName', 'contactPhone', 'contactEmail', 'originalRole'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const decimal = v => typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v));
export function validatePlan(plan) {
  const issues = [];
  const add = (field, code) => issues.push({field, code});
  if (!plain(plan)) return [{field: 'plan', code: 'object_required'}];
  for (const k of Object.keys(plan)) if (!['schemaVersion', 'analysis', 'data'].includes(k)) add('plan', 'unknown_field');
  if (plan.schemaVersion !== 1) add('schemaVersion', 'unsupported_version');
  if (!plain(plan.analysis)) add('analysis', 'object_required');
  else {
    if (plan.analysis.status !== 'ready') add('analysis.status', 'not_ready');
    if (!Array.isArray(plan.analysis.unresolved) || plan.analysis.unresolved.length) add('analysis.unresolved', 'unresolved');
    if (!plain(plan.analysis.sources) || !Object.keys(plan.analysis.sources).length ||
        Object.values(plan.analysis.sources).some(v => !nonempty(v))) add('analysis.sources', 'sources_required');
  }
  if (!plain(plan.data)) return [...issues, {field: 'data', code: 'object_required'}];
  const d = plan.data;
  for (const k of Object.keys(d)) if (![...STRINGS, 'docs', 'parties', 'conflictWaiver'].includes(k)) add('data', 'unknown_field');
  for (const k of STRINGS) if (k in d && typeof d[k] !== 'string') add('data.' + k, 'string_required');
  if ('conflictWaiver' in d && typeof d.conflictWaiver !== 'boolean') add('data.conflictWaiver', 'boolean_required');
  const docs = Array.isArray(d.docs) ? d.docs : [];
  if (!docs.length || docs.some(v => !DOCS.includes(v)) || new Set(docs).size !== docs.length) add('data.docs', 'invalid_selection');
  const roleMap = Object.hasOwn(ROLES, d.procedureType) ? ROLES[d.procedureType] : {};
  if (!Object.hasOwn(ROLES, d.procedureType)) add('data.procedureType', 'invalid_selection');
  if (!BRANCHES.includes(d.branch)) add('data.branch', 'invalid_selection');
  if (d.clientGenerationMode !== undefined && d.clientGenerationMode !== 'separate') add('data.clientGenerationMode', 'unsupported_mode');
  for (const k of ['cause', 'court', 'lawyer1', 'signDate']) if (!nonempty(d[k])) add('data.' + k, 'required');
  if (nonempty(d.signDate)) {
    const date = new Date(d.signDate + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.signDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== d.signDate) add('data.signDate', 'invalid_date');
  }
  if (docs.includes('authorization')) {
    if (d.authType !== '特别授权') add('data.authType', 'general_authorization_unsupported');
    if (!nonempty(plan.analysis?.authorizationBasis)) add('analysis.authorizationBasis', 'authority_source_required');
  }
  const parties = Array.isArray(d.parties) ? d.parties : [];
  if (parties.length < 2) add('data.parties', 'at_least_two_required');
  const names = new Set();
  parties.forEach((p, i) => {
    const at = 'data.parties.' + i;
    if (!plain(p)) { add(at, 'object_required'); return; }
    for (const k of Object.keys(p)) if (![...PARTY_STRINGS, 'isClient'].includes(k)) add(at, 'unknown_field');
    for (const k of PARTY_STRINGS) if (k in p && typeof p[k] !== 'string') add(at + '.' + k, 'string_required');
    for (const k of ['name', 'role', 'partyType']) if (!nonempty(p[k])) add(at + '.' + k, 'required');
    if (typeof p.isClient !== 'boolean') add(at + '.isClient', 'boolean_required');
    if (!TYPES.includes(p.partyType)) add(at + '.partyType', 'invalid_selection');
    if (!Object.hasOwn(roleMap, p.role)) add(at + '.role', 'invalid_selection');
    if (nonempty(p.name)) {
      if (names.has(p.name.trim())) add(at + '.name', 'duplicate_party');
      names.add(p.name.trim());
    }
    if (p.isClient === true) {
      if (!nonempty(p.clientAddress)) add(at + '.clientAddress', 'required');
      if (p.partyType === '自然人') {
        if (!nonempty(p.clientIdNo)) add(at + '.clientIdNo', 'required');
        if (docs.includes('authorization') && nonempty(p.idType) && p.idType !== '居民身份证') add(at + '.idType', 'unsupported_identity_label');
        for (const k of ['repName', 'repPosition', 'execPartnerName', 'creditCode']) if (nonempty(p[k])) add(at + '.' + k, 'wrong_party_type');
      } else {
        for (const k of ['repName', 'repPosition']) if (!nonempty(p[k])) add(at + '.' + k, 'required');
        if (nonempty(p.clientIdNo)) add(at + '.clientIdNo', 'wrong_party_type');
        if (p.partyType === 'delegate' && !nonempty(p.execPartnerName)) add(at + '.execPartnerName', 'required');
      }
    }
  });
  const clients = parties.filter(p => plain(p) && p.isClient === true);
  if (!clients.length) add('data.parties', 'client_required');
  const sides = new Set(clients.map(p => roleMap[p.role]));
  if (sides.size > 1) add('data.parties', 'opposing_clients_unsupported');
  if (typeof d.procedureType === 'string' && d.procedureType.startsWith('arbitration') && clients.some(p => p.role !== d.procedureType)) add('data.parties', 'arbitration_client_role_mismatch');
  clients.forEach(p => {
    const side = roleMap[p.role];
    if (!parties.some(q => plain(q) && !q.isClient && roleMap[q.role] !== side)) add('data.parties', 'opposing_party_required');
  });
  if (docs.length === 1 && docs[0] === 'certificate' && clients.length && clients.every(p => p.partyType === '自然人')) add('data.docs', 'no_applicable_certificate');
  if (docs.includes('agreement')) {
    for (const k of ['arbInstitution', 'arbSeat']) if (!nonempty(d[k])) add('data.' + k, 'required');
    if (!['fixed', 'hybrid', 'hourly'].includes(d.feeMode)) add('data.feeMode', 'invalid_selection');
    if (!decimal(d.feeAmount) || Number(d.feeAmount) <= 0) add('data.feeAmount', 'positive_decimal_required');
    if (!['included', 'excluded'].includes(d.taxMode)) add('data.taxMode', 'invalid_selection');
    if (!['client', 'firm'].includes(d.expenseMode)) add('data.expenseMode', 'invalid_selection');
    if (d.feeMode === 'hybrid') {
      if (!decimal(d.feeRate) || Number(d.feeRate) > 100) add('data.feeRate', 'invalid_percentage');
      if (sides.has('T')) add('data.feeMode', 'third_party_hybrid_unsupported');
    }
    if (d.feeMode === 'hourly' && nonempty(d.feeCap) && (!decimal(d.feeCap) || Number(d.feeCap) <= 0)) add('data.feeCap', 'positive_decimal_required');
    if (d.conflictWaiver && !nonempty(d.conflictClient)) add('data.conflictClient', 'required');
  }
  return issues;
}
