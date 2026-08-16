import * as vscode from 'vscode';
import { ConfigManager } from './config.js';
import { SpeakerUsageTracker } from './usageTracker.js';
import { VoicevoxEngineClient } from './voicevoxEngine.js';
import { AudioPlayer } from './audioPlayer.js';
import { registerCommands } from './commands.js';
import { registerCompletionProvider } from './completion.js';
import { registerHoverProvider } from './hoverProvider.js';
import { SmdDiagnosticManager } from './diagnostics.js';
import { registerSemanticTokensProvider } from './semanticTokens.js';
import { SpeakerDecorationManager } from './decorations.js';
import { registerDocumentColorProvider } from './colorProvider.js';
import { registerAgentTools } from './agentTools.js';

import { registerFoldingProvider } from './foldingProvider.js';
import { registerDocumentSymbolProvider } from './symbolProvider.js';
import { registerStatusBarManager } from './statusBar.js';
import { SMDWebAudioViewProvider } from './webAudioProvider.js';

let globalAudioPlayer: AudioPlayer | null = null;

export function activate(context: vscode.ExtensionContext): void {
  console.log('ScriptMarkDown extension activated.');

  const configManager = new ConfigManager(context.extensionPath);
  const usageTracker = new SpeakerUsageTracker(context);
  const audioPlayer = new AudioPlayer();
  globalAudioPlayer = audioPlayer;
  const statusBarManager = registerStatusBarManager(context);

  try {
    const webAudioProvider = new SMDWebAudioViewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        SMDWebAudioViewProvider.viewType,
        webAudioProvider
      ),
      vscode.commands.registerCommand('smd.openAudioEngine', () => {
        vscode.commands.executeCommand('smdAudioEngineView.focus');
      })
    );
    audioPlayer.setWebAudioProvider(webAudioProvider);
  } catch (err) {
    console.error('Failed to initialize SMDWebAudioViewProvider:', err);
  }

  let engineClient: VoicevoxEngineClient | undefined;
  try {
    engineClient = new VoicevoxEngineClient(configManager);
  } catch (err) {
    console.error('Failed to initialize VoicevoxEngineClient:', err);
  }

  // Register commands
  registerCommands(context, configManager, usageTracker, engineClient, audioPlayer, statusBarManager);

  // Register completion item provider
  registerCompletionProvider(context, configManager, usageTracker, audioPlayer);

  // Register hover provider for audio preview
  registerHoverProvider(context, audioPlayer, engineClient);

  // Register diagnostics manager for missing SE, BGM, and Tatie files
  const diagnosticManager = new SmdDiagnosticManager(audioPlayer, engineClient);
  diagnosticManager.register(context);

  // Register code folding provider for headings (# ~ ######)
  registerFoldingProvider(context);

  // Register document symbol provider for breadcrumbs & outline view
  registerDocumentSymbolProvider(context);

  // Register speaker decoration manager for custom background/text colors & portrait icons
  const decorationManager = new SpeakerDecorationManager(configManager);
  let portraitMap = new Map<string, string>();

  if (engineClient) {
    engineClient.fetchAndCacheSpeakerPortraits().then(map => {
      portraitMap = map;
      decorationManager.setPortraitMap(portraitMap);
      decorationManager.updateDecorations(vscode.window.activeTextEditor);
    }).catch(err => {
      console.log('Failed to fetch speaker portraits:', err);
    });
  }

  decorationManager.updateDecorations(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      // 4. Stop continuous audio/BGM immediately when user switches or closes editor tab!
      audioPlayer.cancel();
      decorationManager.setPortraitMap(portraitMap);
      decorationManager.updateDecorations(editor);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
        decorationManager.updateDecorations(vscode.window.activeTextEditor);
      }
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      // 4. Kill all lingering audio/BGM processes immediately when the .smd document tab is closed!
      if (document.languageId === 'script-markdown') {
        audioPlayer.cancel();
      }
    }),
    { dispose: () => decorationManager.dispose() }
  );

  // Register document color provider for .color(#ffffff) color picker
  registerDocumentColorProvider(context);

  // Register VS Code Language Model AI Agent tools (smd-get-speakers, etc.)
  registerAgentTools(context, configManager, usageTracker, audioPlayer);


  // Register semantic tokens provider
  registerSemanticTokensProvider(context, configManager);
}

export function deactivate(): void {
  console.log('ScriptMarkDown extension deactivated.');
  if (globalAudioPlayer) {
    globalAudioPlayer.killAllChildProcesses();
  }
}
