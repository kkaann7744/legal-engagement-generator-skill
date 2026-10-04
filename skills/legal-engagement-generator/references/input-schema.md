# 参数格式

使用 UTF-8 JSON。顶层只允许 `schemaVersion`、`analysis`、`data`。完整虚构样例见 [../assets/example-plan.json](../assets/example-plan.json)。

`schemaVersion` 固定为 1。`analysis.status` 为 `ready` 才能生成；`draft` 表示整理尚未完成。`unresolved` 必须是数组，ready 时必须为空。`sources` 用字段路径映射至材料文件及页码、条款或明确用户指令；它是模型核对的线索，不是程序证明字段正确的依据。生成授权书时 `authorizationBasis` 必须说明采用内置特别授权条款的来源，不能伪造用户确认。

`data` 使用下列字段。生成器只接受已知字段，避免拼写错误被静默忽略。字符串不要传数组或数字；费用保留十进制字符串；金额和比例最多两位小数，当前数值上限为 999999999999.99，不自动舍入超出精度的值。

| 字段 | 规则 |
|---|---|
| docs | 非空且不重复，从 agreement、authorization、certificate、letter 中选 |
| procedureType | 下表中的程序键 |
| branch | beijing、shanghai、shenzhen、haikou、wuhan、hangzhou |
| authType | 生成授权书时必须为“特别授权”；当前模板不支持一般授权 |
| clientGenerationMode | 只支持 separate，可省略 |
| cause、court、lawyer1 | 当前工具公共必填项；court 表示本案法院或仲裁机构 |
| signDate | 必须是有效 YYYY-MM-DD 日期，不自动使用运行当天 |
| caseNo | 可选；空值不写成“案号：无” |
| lawyer2、phone1、phone2、email1 | 可选；未填第二名律师不生成第二名律师栏 |
| clientContact、clientPhone、clientEmail | 可选；设置后覆盖各客户自己的联络信息 |
| parties | 至少两名当事人；每名当事人必须明确 isClient 布尔值 |
| feeMode | 生成 agreement 时必填：fixed、hybrid、hourly |
| feeAmount | 生成 agreement 时必填：固定费用、前期固定费用或小时制预付金额，须大于零 |
| feeRate | hybrid 时必填，0 至 100；仅为输入范围校验，不证明约定合法 |
| feeCap | hourly 可选，填写时须大于零；空值沿用 feeAmount 作为封顶，并在生成前检查及生成结果中发出警告；须核对实际约定 |
| taxMode、expenseMode | agreement 时必填：included/excluded、client/firm；沿用模板税费写法 |
| arbInstitution、arbSeat | agreement 时必填；是委托协议的争议解决信息，不等同于本案仲裁机构 |
| conflictWaiver | 可选布尔值，缺省 false；必须来自实际约定 |
| conflictClient | conflictWaiver 为 true 且生成协议时必填 |

程序键和各当事人可用角色：

| procedureType | roles |
|---|---|
| litigation_first_instance | first_plaintiff、first_defendant、first_third_party |
| litigation_second_instance | appeal_appellant、appeal_appellee、appeal_original_third_party |
| litigation_retrial | retrial_applicant、retrial_respondent、retrial_other |
| enforcement | enforcement_applicant、enforcement_respondent |
| arbitration_applicant | arbitration_applicant、arbitration_respondent；客户必须为 applicant |
| arbitration_respondent | arbitration_applicant、arbitration_respondent；客户必须为 respondent |

每个 party 允许这些字段：`name`、`role`、`partyType`、`isClient`、`clientAddress`、`mailingAddress`、`creditCode`、`idType`、`clientIdNo`、`repName`、`repPosition`、`execPartnerName`、`signerName`、`signerTitle`、`contactName`、`contactPhone`、`contactEmail`、`originalRole`。partyType 从“法人”“非法人组织”“自然人”“execPartner”“delegate”中选，前三项同页面文字，后两项分别表示执行事务合伙人和委派代表。

客户必须有 `clientAddress`。自然人客户必须有 `clientIdNo`；其组织代表人、职务、合伙人、统一社会信用代码字段应为空，身份证明文件会跳过。当前授权模板固定使用“身份证号”标签，自然人生成授权书仅支持居民身份证，其他证件需使用对应模板。组织客户必须有 `repName` 和 `repPosition`，delegate 客户还须 `execPartnerName`；不要把自然人身份证号遗留到组织字段。非客户只要求名称、角色、类型和 isClient。

`signerName` 等可选字段的默认规则沿用工具：自然人的签署人默认为本人，组织默认为代表人；通讯地址默认采用住所，联络人默认采用签署人。若实际签署或联络安排不同，明确输入，不据默认值断言事实。客户间不同的计费或授权口径需要拆为不同参数包。

只提供拼音缩写、检索结果或 OCR 猜测不够确认名称及身份。先核对当前来源，再将 ready 参数交给程序。
