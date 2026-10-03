# 运行环境

独立本地填写仅需要 Python 3 与浏览器。也可以直接打开 `assets/generator.html`；Word 模板及 JSZip 已打包在文件中，案件生成不联网。

模型辅助 CLI 使用 Node 18+、Python 3.10+ 与 Playwright 的 Chromium 驱动。程序先查找当前环境的 Playwright 包，再查找当前 Node 运行时相邻的 `node_modules`。已通过客户端依赖工具发现的包可用 `PLAYWRIGHT_MODULE` 指向 `playwright/index.mjs`；Python 可用 `PYTHON_EXECUTABLE` 指定，浏览器可用 `BROWSER_EXECUTABLE` 指定。这些是程序路径，不能把案件字段放在环境变量里。

客户端有工作区依赖加载工具时优先使用它，别猜测其他电脑上的固定目录。程序优先用 Playwright 已安装的 Chromium；其次寻找本机 Chrome 或 Edge。无可用浏览器时返回 `browser_unavailable`，不会在生成期间下载依赖。

如果需要独立安装，从 Skill 目录运行：

    npm ci
    npx playwright install chromium

上述安装会联网下载公开软件包及浏览器，尚不读取案件文件。安装完成后 `generate.mjs` 不联网。

命令使用样例：

    node scripts/generate.mjs --input assets/example-plan.json --output-dir /path/to/local-work/run-01
    python3 scripts/verify.py --bundle /path/to/local-work/run-01

核验不依赖第三方 Python 包。为避免误覆盖，生成目录须为全新目录；输出失败会删除该次程序创建的目录，保留用户原始输入。

渲染最终 Word 时若中文消失或显示方框，先核对渲染器实际可见的中文字体。某些 macOS 打包渲染器需要明确的本地 Fontconfig 配置；用当前字体目录适配渲染环境，保持交付文书中的模板字体，不把替代字体的预览副本当成最终文件的版式证明。
