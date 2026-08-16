import * as vscode from 'vscode';

export class SMDStatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.name = 'ScriptMarkDown Status';
  }

  public showSynthesizing(speakerName?: string): void {
    const speakerText = speakerName ? ` (${speakerName})` : '';
    this.statusBarItem.text = `$(sync~spin) VOICEVOX 音声生成中${speakerText}...`;
    this.statusBarItem.tooltip = 'VOICEVOX Engine で音声を合成しています';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.show();
  }

  public showPlaying(speakerName?: string): void {
    const speakerText = speakerName ? ` (${speakerName})` : '';
    this.statusBarItem.text = `$(play-circle) 音声再生中${speakerText}`;
    this.statusBarItem.tooltip = 'VOICEVOX 音声を再生しています';
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  public clear(): void {
    this.statusBarItem.text = '';
    this.statusBarItem.hide();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}

export function registerStatusBarManager(context: vscode.ExtensionContext): SMDStatusBarManager {
  const manager = new SMDStatusBarManager();
  context.subscriptions.push({ dispose: () => manager.dispose() });
  return manager;
}
