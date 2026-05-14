# Markdown Translator

[English](./README.md) | [中文](./README.zh-CN.md)

用于在 VSCode Desktop 里阅读 Markdown 的双语翻译插件。

## MVP 行为

- 增强 VSCode 内置 Markdown Preview，不修改源 `.md` 文件。
- 在官方 Markdown Preview 编辑器标题栏增加翻译按钮。
- 在每个原文块下方插入译文，使用引用样式展示。
- 支持无需 API Key 的 Google Web 和 DeepL Free 翻译。
- 支持配置源语言和目标语言。

## 技术路线

项目使用 VSCode 官方 Markdown Preview 作为渲染载体。

1. 用户打开内置 Markdown Preview。
2. `Markdown Translator: Translate Preview` 命令显示在预览编辑器标题栏。
3. 命令解析源 Markdown 文档，包括从预览标题栏按钮触发时的 `webview-panel:` 场景。
4. 扩展宿主使用 `markdown-it` 收集可翻译的 Markdown block。
5. 当前选中的 provider 负责翻译这些 block。Google Web 使用 mobile `/m` 端点；DeepL Free 使用 DeepL web JSON-RPC 端点。
6. 结果按文档 URI 缓存在当前会话的内存中。
7. `markdown.markdownItPlugins` 贡献点在官方 Markdown 渲染过程中注入译文 DOM。
8. 每个完成的批次都会更新内存中的翻译结果，并调用 `markdown.api.reloadPlugins`，因此长文档可以渐进渲染译文。

这条路线保持源文档不变，同时避免维护自定义 Preview Webview。

## 交互规则

- 文档没有译文时，点击翻译按钮会开始翻译。
- 文档正在翻译时，再次点击翻译按钮不执行任何操作。
- 文档已经翻译完成时，再次点击翻译按钮不执行任何操作。
- 翻译失败后，再次点击翻译按钮会重试。
- 清除译文后，再次点击翻译按钮会重新翻译。

## 命令

- `Markdown Translator: Translate Preview`
  - 翻译当前 Markdown 文档并刷新官方 Markdown Preview。
- `Markdown Translator: Clear Preview Translations`
  - 清除当前 Markdown Preview 的内存译文，并刷新官方预览。
- `Markdown Translator: Select Translation Provider`
  - 在 `Google Web` 和 `DeepL Free` 之间切换，并清除当前内存译文。

## 配置

- `markdownTranslator.sourceLanguage`
  - 默认值：`auto`
- `markdownTranslator.targetLanguage`
  - 默认值：`zh-CN`
- `markdownTranslator.provider`
  - 默认值：`googleWeb`
  - 可选值：`googleWeb`、`deeplFree`
- `markdownTranslator.debugLogging`
  - 默认值：`false`
  - 仅在排查问题时设为 `true`。开启后会把 block 收集、provider 批处理、fallback 行为和最终译文映射写入 `Markdown Translator` Output。
- `markdownTranslator.deeplFree.requestDelayMs`
  - 默认值：`2000`
  - DeepL Free 翻译长文档出现限流时，优先调大这个值。
- `markdownTranslator.deeplFree.retryDelayMs`
  - 默认值：`10000`
- `markdownTranslator.deeplFree.maxBatchTexts`
  - 默认值：`4`
- `markdownTranslator.deeplFree.maxBatchCharacters`
  - 默认值：`900`

## 开发

```bash
npm install
npm test
npm run typecheck
npm run compile
npm run host
```

`npm run host` 会编译插件，并以 `/tmp/markdown-translator-smoke` 作为测试工作区打开 VSCode Extension Development Host 窗口。

## 本地 VSIX 安装

构建本地 VSIX 包：

```bash
npm run package
```

安装到 VSCode：

```bash
code --install-extension markdown-translator-0.0.1.vsix
```

如果已经安装过同版本，可以强制覆盖：

```bash
code --install-extension markdown-translator-0.0.1.vsix --force
```

也可以通过 VSCode UI 安装：

1. 打开 Extensions。
2. 打开 `...` 菜单。
3. 选择 `Install from VSIX...`。
4. 选择 `markdown-translator-0.0.1.vsix`。

安装后打开 Markdown 文件，执行 `Markdown: Open Preview to the Side`，然后使用预览标题栏里的 Markdown Translator 按钮。

## 当前说明

当前范围：

- 翻译标题、段落、列表项和引用块。
- 跳过 fenced code block、行内代码、公式、YAML front matter、HTML block 和表格。
- 可通过命令面板在 Google Web 与 DeepL Free 之间切换。
- 使用稳定 marker 批量请求 Google Web mobile 翻译，批次完成后渐进渲染；如果批量结果无法安全拆分，则回退到逐块请求。
- 通过 DeepL web JSON-RPC 端点小批量请求 DeepL Free 翻译，并支持配置请求间隔与限流重试间隔。
- 翻译时用占位符保护行内代码，翻译完成后恢复。
- 阻止同一文档的并发翻译任务。
- 翻译状态保存在有上限的内存中，并在 Markdown 文档变更或关闭时清理。
- 只保留当前 VSCode 会话内的内存翻译状态。
- 详细诊断日志默认关闭；遇到漏翻译或错位时可开启 `markdownTranslator.debugLogging` 后复现并复制日志。
- Google Web 域名和重试策略暂时保持内部实现，不开放配置。

下一步路线：

1. 将本地 VSIX 安装到日常使用的 VSCode 中，用真实 Markdown 文档验收。
2. 用真实长文档继续调整 Google Web `/m` 的批量大小和限流处理。
