import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { collectTranslatableBlocks } from './markdown/blockCollector';
import {
  clearAllOfficialPreviewTranslations,
  clearOfficialPreviewTranslations,
  extendMarkdownItWithTranslations,
  setOfficialPreviewTranslations
} from './preview/officialPreviewTranslator';
import { isOpenableMarkdownResource } from './preview/resource';
import {
  createTranslationProvider,
  describeProviderError,
  getProviderLabel,
  normalizeProviderId,
  translationProviders
} from './translation/providerFactory';
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
    vscode.commands.registerCommand('markdownTranslator.selectProvider', async () => {
      await selectTranslationProvider(output);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration('markdownTranslator.provider')
        || event.affectsConfiguration('markdownTranslator.sourceLanguage')
        || event.affectsConfiguration('markdownTranslator.targetLanguage')
      ) {
        clearAllOfficialPreviewTranslations();
        translationStates.clear();
        await vscode.commands.executeCommand('markdown.api.reloadPlugins');
        output.appendLine('[config] cleared translations after Markdown Translator configuration changed.');
      }
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

async function translateOfficialPreview(
  resource: vscode.Uri | undefined,
  output: vscode.OutputChannel
): Promise<void> {
  const startedAt = Date.now();
  const runId = nextRunId;
  nextRunId += 1;
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

  const config = vscode.workspace.getConfiguration('markdownTranslator', document.uri);
  const debugLogging = config.get<boolean>('debugLogging', false);
  const providerId = normalizeProviderId(config.get<string>('provider', 'googleWeb'));
  const providerLabel = getProviderLabel(providerId);
  const blocks = collectTranslatableBlocks(document.getText());
  output.appendLine(`[translate#${runId}] document=${documentKey}`);
  output.appendLine(`[translate#${runId}] provider=${providerId} (${providerLabel})`);
  output.appendLine(`[translate#${runId}] collected ${blocks.length} translatable block(s).`);
  if (debugLogging) {
    output.appendLine(`[translate#${runId}] debug logging enabled.`);
    logBlocks(output, runId, blocks);
  }
  if (blocks.length === 0) {
    await vscode.window.showInformationMessage('没有可翻译的 Markdown 段落。');
    return;
  }

  activeTranslations.add(documentKey);
  translationStates.set(documentKey, 'running');
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `${providerLabel}: 翻译 ${blocks.length} 个 Markdown 段落`,
      cancellable: false
    }, async (progress) => {
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

      const provider = createTranslationProvider({
        providerId,
        deeplFree: {
          maxBatchCharacters: config.get<number>('deeplFree.maxBatchCharacters', 900),
          maxBatchTexts: config.get<number>('deeplFree.maxBatchTexts', 4),
          maxRetries: config.get<number>('deeplFree.maxRetries', 2),
          requestDelayMs: config.get<number>('deeplFree.requestDelayMs', 2000),
          retryDelayMs: config.get<number>('deeplFree.retryDelayMs', 10000)
        },
        log: debugLogging ? (message) => output.appendLine(`[provider#${runId}] ${message}`) : undefined,
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
      if (debugLogging) {
        logTranslations(output, runId, translations);
      }
      await vscode.commands.executeCommand('markdown.api.reloadPlugins');
      output.appendLine(`[translate#${runId}] refreshed official Markdown Preview in ${Date.now() - startedAt}ms.`);
    });
  } catch (error) {
    const config = document
      ? vscode.workspace.getConfiguration('markdownTranslator', document.uri)
      : vscode.workspace.getConfiguration('markdownTranslator');
    const providerId = normalizeProviderId(config.get<string>('provider', 'googleWeb'));
    const message = describeProviderError(error, getProviderLabel(providerId));
    translationStates.set(documentKey, 'failed');
    output.appendLine(`[translate#${runId}] failed: ${message}`);
    throw new Error(message);
  } finally {
    activeTranslations.delete(documentKey);
  }
}

async function selectTranslationProvider(output: vscode.OutputChannel): Promise<void> {
  const config = vscode.workspace.getConfiguration('markdownTranslator');
  const currentProviderId = normalizeProviderId(config.get<string>('provider', 'googleWeb'));
  const selected = await vscode.window.showQuickPick(
    translationProviders.map((provider) => ({
      label: provider.label,
      description: provider.id === currentProviderId ? '当前' : undefined,
      providerId: provider.id
    })),
    {
      placeHolder: '选择 Markdown Translator 翻译源'
    }
  );

  if (!selected) {
    return;
  }

  if (selected.providerId === currentProviderId) {
    return;
  }

  await config.update('provider', selected.providerId, vscode.ConfigurationTarget.Global);
  clearAllOfficialPreviewTranslations();
  translationStates.clear();
  await vscode.commands.executeCommand('markdown.api.reloadPlugins');
  output.appendLine(`[config] provider changed to ${selected.providerId}; cleared current translations.`);
  await vscode.window.showInformationMessage(`Markdown Translator: 已切换到 ${selected.label}`);
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

function logBlocks(
  output: vscode.OutputChannel,
  runId: number,
  blocks: ReturnType<typeof collectTranslatableBlocks>
): void {
  for (const block of blocks) {
    output.appendLine(`[translate#${runId}] block ${block.id} ${block.kind} chars=${block.text.length} text="${previewLogText(block.text)}"`);
  }
}

function logTranslations(
  output: vscode.OutputChannel,
  runId: number,
  translations: Array<{ id: string; translatedText: string }>
): void {
  for (const translation of translations) {
    output.appendLine(`[translate#${runId}] translation ${translation.id} chars=${translation.translatedText.length} text="${previewLogText(translation.translatedText)}"`);
  }
}

function previewLogText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
}
