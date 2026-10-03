/* Local integration: leave Word mutations and template bytes in generator.html. */
(function () {
  'use strict';
  var originalValidate = validateData;
  validateData = function (data) {
    var errors = originalValidate(data);
    if (data.docs.indexOf('authorization') >= 0 && data.authType !== '特别授权') {
      errors.push('当前模板正文包含特别授权事项，一般授权须使用另行审定的模板。');
    }
    if (data.docs.length === 1 && data.docs[0] === 'certificate' &&
        data.clients.length && data.clients.every(function (p) { return !p.certificateAllowed; })) {
      errors.push('所选自然人没有适用的主体身份证明模板，请选择其他文件。');
    }
    if (data.docs.indexOf('authorization') >= 0 && data.clients.some(function (p) {
      return p.partyType === '自然人' && p.idType !== '居民身份证';
    })) errors.push('当前授权模板的证件栏为身份证号；其他证件须使用对应模板。');
    return errors;
  };
  Array.from($('authType').options).forEach(function (option) {
    if (option.value === '一般授权') option.disabled = true;
  });
  $('authType').value = '特别授权';
  var note = document.createElement('span');
  note.className = 'field-note';
  note.textContent = '沿用模板特别授权条款，请核对具体权限。一般授权须使用另行审定的模板。';
  $('authType').parentElement.appendChild(note);
  form.setAttribute('autocomplete', 'off');
  window.engagementGenerator = Object.freeze({
    apply: function (data) {
      $('procedureType').value = data.procedureType;
      updateProcedure();
      $('branch').value = data.branch;
      updateBranch();
      var fields = ['authType', 'cause', 'caseNo', 'court', 'signDate', 'lawyer1', 'lawyer2', 'phone1',
        'phone2', 'email1', 'clientContact', 'clientPhone', 'clientEmail', 'feeMode', 'feeAmount',
        'feeRate', 'feeCap', 'taxMode', 'expenseMode', 'arbInstitution', 'arbSeat', 'conflictClient'];
      var defaults = {authType: '特别授权', feeMode: 'fixed', taxMode: 'included', expenseMode: 'client'};
      fields.forEach(function (key) {
        $(key).value = data[key] === undefined ? (defaults[key] || '') : String(data[key]).trim();
      });
      $('clientGenerationMode').value = 'separate';
      $('conflictWaiver').checked = data.conflictWaiver === true;
      Array.from(form.querySelectorAll('input[name="docs"]')).forEach(function (box) {
        box.checked = data.docs.indexOf(box.value) >= 0;
      });
      $('partiesContainer').replaceChildren();
      partyCounter = 0;
      data.parties.forEach(function (party) {
        var copy = {};
        Object.keys(party).forEach(function (key) {
          copy[key] = typeof party[key] === 'string' ? party[key].trim() : party[key];
        });
        createPartyCard(copy);
      });
      updatePartySummary();
      updateFeeFields();
      updateConflict();
      updateDocumentRequirements();
    }
  });
})();
