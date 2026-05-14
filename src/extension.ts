import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { collectTranslatableBlocks } from './markdown/blockCollector';
import {
  clearOfficialPreviewTranslations,
  extendMarkdownItWithTranslations,
  setOfficialPreviewTranslations
} from './preview/officialPreviewTranslator';
import { isOpenableMarkdownResource } from './preview/resource';
import { GoogleWebProvider, TranslationProviderError } from './translation/googleWebProvider';
import { runProviderSpike } from './translation/providerSpike';
import { getTranslateAction, TranslationState } from './translation/state';
import { createProgressReporter, translateBlocks } from './translation/translationOrchestrator';

export type MarkdownTranslatorExtensionApi = {
  extendMarkdownIt(markdown: MarkdownIt): MarkdownIt;
};

const activeTranslations = new Set<string>();
const progressiveRefreshIntervalMs = 800;
let nextRunId = 1;

const translationStates = new Map<string, TranslationState>();

export function activate(context: vscode.ExtensionContext): MarkdownTranslatorExtensionApi {
  const output = vscode.window.createOutputChannel('Markdown Translator');
  output.appendLine('Markdown Translator activated.');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownTranslator.translatePreview', async (resource?: vscode.Uri) => {
      try {
        await translateOfficialPreview(resource, output);
      } catch (error) {
        const message = error instanceof Error ? error.message : '翻译失败';
        output.appendLine(`Translate preview failed: ${message}`);
        await vscode.window.showErrorMessage(`Markdown Translator: ${message}`);
      }
    }),
    vscode.commands.registerCommand('markdownTranslator.clearPreviewTranslations', async (resource?: vscode.Uri) => {
      await clearPreviewTranslations(resource, output);
    }),
    vscode.commands.registerCommand('markdownTranslator.runProviderSpike', async () => {
      await runSpikeCommand(output);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'markdown') {
        clearOfficialPreviewTranslations(event.document.uri);
        translationStates.delete(event.document.uri.toString());
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId === 'markdown') {
        clearOfficialPreviewTranslations(document.uri);
        translationStates.delete(document.uri.toString());
      }
    })
  );

  return {
    extendMarkdownIt
  };
}

export function deactivate() {
  // No persistent resources.
}

export function extendMarkdownIt(markdown: MarkdownIt): MarkdownIt {
  return extendMarkdownItWithTranslations(markdown);
}

async function runSpikeCommand(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selectedText = editor?.document.getText(editor.selection).trim();
  const text = selectedText || 'Night gathers, and now my watch begins.';
  const config = vscode.workspace.getConfiguration('markdownTranslator');
  const sourceLanguage = config.get<string>('sourceLanguage', 'en');
  const targetLanguage = config.get<string>('targetLanguage', 'zh-CN');

  output.show(true);
  output.appendLine(`Running Google Web provider spike: ${sourceLanguage} -> ${targetLanguage}`);
  output.appendLine(`Input: ${text}`);

  const results = await runProviderSpike({ sourceLanguage, targetLanguage, text });
  for (const result of results) {
    if (result.ok) {
      output.appendLine(`[${result.candidate}] OK: ${result.translatedText}`);
    } else {
      output.appendLine(`[${result.candidate}] ${result.errorCode}: ${result.message}`);
    }
  }
}

async function translateOfficialPreview(
  resource: vscode.Uri | undefined,
  output: vscode.OutputChannel
): Promise<void> {
  const startedAt = Date.now();
  const runId = nextRunId;
  nextRunId += 1;
  output.show(true);
  output.appendLine('');
  output.appendLine(`[translate#${runId}] command received. resource=${resource?.toString() ?? 'none'}`);

  const document = await resolveMarkdownDocument(resource);
  if (!document) {
    output.appendLine(`[translate#${runId}] no markdown document resolved.`);
    await vscode.window.showWarningMessage('请先打开一个 Markdown 文件或官方 Markdown Preview。');
    return;
  }

  const documentKey = document.uri.toString();
  const state = translationStates.get(documentKey);
  if (activeTranslations.has(documentKey) || getTranslateAction(state) === 'noop') {
    const reason = state === 'translated' ? 'already translated' : 'already running';
    output.appendLine(`[translate#${runId}] noop reason: ${reason} for ${documentKey}.`);
    return;
  }

  const blocks = collectTranslatableBlocks(document.getText());
  output.appendLine(`[translate#${runId}] document=${documentKey}`);
  output.appendLine(`[translate#${runId}] collected ${blocks.length} translatable block(s).`);
  if (blocks.length === 0) {
    await vscode.window.showInformationMessage('没有可翻译的 Markdown 段落。');
    return;
  }

  activeTranslations.add(documentKey);
  translationStates.set(documentKey, 'running');
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `翻译 ${blocks.length} 个 Markdown 段落`,
      cancellable: false
    }, async (progress) => {
      const config = vscode.workspace.getConfiguration('markdownTranslator', document.uri);
      const sourceLanguage = config.get<string>('sourceLanguage', 'auto');
      const targetLanguage = config.get<string>('targetLanguage', 'zh-CN');
      output.appendLine(`[translate#${runId}] language ${sourceLanguage} -> ${targetLanguage}`);
      let lastCompleted = 0;
      let lastPreviewRefreshAt = 0;
      const progressReporter = createProgressReporter(blocks, async (batchProgress) => {
        setOfficialPreviewTranslations(document.uri, batchProgress.translations);
        output.appendLine(`[translate#${runId}] progressive render ${batchProgress.completed}/${batchProgress.total} unique text(s).`);
        progress.report({
          increment: batchProgress.total > 0
            ? ((batchProgress.completed - lastCompleted) / batchProgress.total) * 100
            : 0,
          message: `${batchProgress.completed}/${batchProgress.total}`
        });
        lastCompleted = batchProgress.completed;
        const now = Date.now();
        if (
          batchProgress.completed === batchProgress.total
          || now - lastPreviewRefreshAt >= progressiveRefreshIntervalMs
        ) {
          lastPreviewRefreshAt = now;
          await vscode.commands.executeCommand('markdown.api.reloadPlugins');
        }
      });

      const provider = new GoogleWebProvider({
        candidate: 'mobile',
        log: (message) => output.appendLine(`[provider#${runId}] ${message}`),
        onBatchComplete: progressReporter.handleProviderProgress
      });
      const translations = await translateBlocks({
        provider,
        sourceLanguage,
        targetLanguage,
        blocks
      });

      setOfficialPreviewTranslations(document.uri, translations);
      translationStates.set(documentKey, 'translated');
      output.appendLine(`[translate#${runId}] stored ${translations.length} translation(s).`);
      await vscode.commands.executeCommand('markdown.api.reloadPlugins');
      output.appendLine(`[translate#${runId}] refreshed official Markdown Preview in ${Date.now() - startedAt}ms.`);
    });
  } catch (error) {
    const message = describeTranslationError(error);
    translationStates.set(documentKey, 'failed');
    output.appendLine(`[translate#${runId}] failed: ${message}`);
    throw new Error(message);
  } finally {
    activeTranslations.delete(documentKey);
  }
}

async function resolveMarkdownDocument(resource: vscode.Uri | undefined): Promise<vscode.TextDocument | undefined> {
  if (resource && isOpenableMarkdownResource(resource)) {
    const document = await vscode.workspace.openTextDocument(resource);
    return document.languageId === 'markdown' ? document : undefined;
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.languageId === 'markdown') {
    return activeDocument;
  }

  await vscode.commands.executeCommand('markdown.showSource');
  const sourceDocument = vscode.window.activeTextEditor?.document;
  return sourceDocument?.languageId === 'markdown' ? sourceDocument : undefined;
}

async function clearPreviewTranslations(
  resource: vscode.Uri | undefined,
  output: vscode.OutputChannel
): Promise<void> {
  const document = await resolveMarkdownDocument(resource);
  if (!document) {
    await vscode.window.showWarningMessage('请先打开一个 Markdown 文件或官方 Markdown Preview。');
    return;
  }

  clearOfficialPreviewTranslations(document.uri);
  translationStates.delete(document.uri.toString());
  await vscode.commands.executeCommand('markdown.api.reloadPlugins');
  output.appendLine(`[clear] cleared translations for ${document.uri.toString()}`);
}

function describeTranslationError(error: unknown): string {
  if (error instanceof TranslationProviderError) {
    if (error.code === 'RATE_LIMIT') {
      return 'Google Web 请求过快或被限流，请稍后再试。';
    }
    if (error.code === 'NETWORK') {
      return 'Google Web 请求失败，请检查网络连接。';
    }
    if (error.code === 'PARSE') {
      return 'Google Web 返回结构无法解析，可能是页面结构变化。';
    }
    return `Google Web 返回 HTTP ${error.status ?? '错误'}。`;
  }

  return error instanceof Error ? error.message : '翻译失败';
}
