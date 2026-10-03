# 委托手续制作 Skill

基于当前离线委托手续工具和内置汉坤 Word 模板。提供独立本地填写，以及模型整理信息、本地生成、结构核验和模型复核两种入口。

Skill 位于 [`skills/legal-engagement-generator`](skills/legal-engagement-generator)，安装后调用名为 `$legal-engagement-generator`。本地填写可直接打开 Skill 中的 `assets/generator.html`，无需模型读取客户材料。模型辅助 CLI 的格式、依赖和保密边界见该目录的 [`SKILL.md`](skills/legal-engagement-generator/SKILL.md)。

支持一审、二审、再审、执行及仲裁双方，为选中的同方客户分别生成协议、特别授权委托书、适用的主体身份证明和所函。当前授权条款沿用模板，已阻止只改标签的一般授权输出；逐项授权和自定义模板需要另行接入已审定模板。

本仓库保留现有汉坤 Word 模板、分所资料及账户配置。使用时应按实际委托核对模板、收费条款和收款信息；这些资源不构成对外代理权限或律师事务所的官方发布。实际案件文件不在仓库内，样例和自动核验材料全部为虚构数据。第三方组件保留原有许可，未为事务所模板另行授予通用开源许可。

## 安装与使用

在 Codex 中输入：

> 请使用 skill-installer，从 https://github.com/kkaann7744/legal-engagement-generator-skill 的 skills/legal-engagement-generator 目录安装这个 Skill。

也可以下载仓库，将 `skills/legal-engagement-generator` 文件夹放到 `~/.codex/skills/` 下。安装后重新打开 Codex 或新建对话，让 Skill 出现在技能列表中。

两种调用示例：

> $legal-engagement-generator 打开本地委托手续工具，由我自己填写。

> $legal-engagement-generator 根据我指定的材料整理案件信息，并为选中的客户制作委托手续。

独立网页填写无需安装 Node.js 或 Python。模型辅助生成需要 Node.js 18+、Python 3.10+ 和 Playwright；准备依赖的具体方式见 [`runtime.md`](skills/legal-engagement-generator/references/runtime.md)。

模型辅助模式会接触用户提供的材料；本地生成不能消除已经提交给模型的信息。信息流和保存位置的说明见 [`privacy.md`](skills/legal-engagement-generator/references/privacy.md)。

## 核验

运行核验：

    python3 tests/test_verify.py
    node tests/smoke.mjs

第二条会在系统临时目录生成虚构案件文书并检查各程序、客户选择、自然人跳过以及失败输入；不会读取工作目录中的实际案件。当前版本已通过 11 项独立结构核验测试、23 项生成场景检查，以及虚构样例成品的版式检查。
