# Changelog

All notable changes to Markdown Translator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-05-18

### Fixed

- Regenerated the extension icon with a clean transparent rounded edge so it no longer shows white fringe artifacts in VSCode's dark Extensions view.

## [1.0.1] - 2026-05-18

### Changed

- Replaced placeholder pixel-font icon with a system-font rendered icon (deep blue gradient background, rounded corners, antialiased "MT" wordmark) for a more polished Marketplace appearance.

## [1.0.0] - 2026-05-18

### Added

- Bilingual Markdown preview via VSCode's official Markdown Preview (`markdown.markdownItPlugins` contribution point) — source document is never modified.
- Translate button in the official Markdown Preview editor title bar.
- **Google Web** translation provider using the mobile `/m` endpoint — no API key required.
- **DeepL Free** translation provider using the DeepL web JSON-RPC endpoint — no API key required.
- Batch translation for Google Web with stable markers; progressive rendering as batches complete; per-block fallback if a batch result cannot be safely split.
- Small-batch DeepL Free requests with configurable request delay, retry delay, retry count, max batch texts, and max batch characters.
- Inline code placeholder protection: inline code is shielded before translation and restored after.
- `Markdown Translator: Translate Preview` command — translates the active Markdown document and refreshes the official preview.
- `Markdown Translator: Clear Preview Translations` command — clears in-memory translations for the current document and refreshes the preview.
- `Markdown Translator: Select Translation Provider` command — switches between Google Web and DeepL Free from the command palette.
- `markdownTranslator.sourceLanguage` setting (default: `auto`).
- `markdownTranslator.targetLanguage` setting (default: `zh-CN`).
- `markdownTranslator.provider` setting (default: `googleWeb`; options: `googleWeb`, `deeplFree`).
- `markdownTranslator.debugLogging` setting — detailed diagnostics for block collection, provider batching, and translation mapping written to the `Markdown Translator` output channel.
- DeepL Free rate-limit settings: `requestDelayMs`, `retryDelayMs`, `maxRetries`, `maxBatchTexts`, `maxBatchCharacters`.

### Changed

- Translation state is scoped to the current VSCode session; cleared on document change or close.
- DeepL Free rate-limit errors fail fast by default (no silent retry loop); clicking translate again continues from the last incomplete block.

### Fixed

- Preview cancellation guard: stale translations started before a cancel are discarded on arrival.
- Shell-variable alignment fix for Google Web batch splitting (prevents misaligned bilingual blocks on documents containing `$VAR` patterns).
- DeepL Free request spacing aligned to web client rules to reduce spurious rate-limit responses.
