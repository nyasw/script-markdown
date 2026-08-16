import * as vscode from 'vscode';
import { AudioPlayer } from './audioPlayer.js';
import { VoicevoxEngineClient } from './voicevoxEngine.js';

export class SmdDiagnosticManager {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(
    private audioPlayer: AudioPlayer,
    private engineClient?: VoicevoxEngineClient
  ) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('script-markdown');
  }

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.diagnosticCollection);

    // Initial update for active editor when opening
    if (vscode.window.activeTextEditor) {
      this.updateDiagnostics(vscode.window.activeTextEditor.document);
    }

    // Run diagnostics ONLY when opening a document or switching active editor tabs!
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.updateDiagnostics(doc)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.diagnosticCollection.delete(doc.uri)),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDiagnostics(editor.document);
        }
      })
    );
  }

  public extractDirectivePaths(line: string, directiveName: string): string[] {
    const paths: string[] = [];
    // Regex matches .directive("...") or .directive('...') handling escaped quotes and internal quotes
    const regex = new RegExp(`\\.${directiveName}\\s*\\(\\s*(?:"([^"]+)"|'((?:\\\\[']|[^'])+)')`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      let extracted = match[1] ?? match[2];
      if (extracted) {
        extracted = extracted.replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
        paths.push(extracted);
      }
    }

    return paths;
  }

  public updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== 'script-markdown') {
      return;
    }

    const smdParser = this.engineClient?.getSmdParser();
    if (!smdParser) {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const parsedLines = smdParser.parseFullDocument(document);

    for (const item of parsedLines) {
      if (item.isComment) {
        continue;
      }

      const rawLine = item.rawLine;
      const lineIdx = item.lineIdx;
      const docPresets = item.docPresets;

      // 1. Check .se('...') or .se("...")
      const sePaths = this.extractDirectivePaths(rawLine, 'se');
      for (const rawPath of sePaths) {
        const resolved = this.audioPlayer.resolvePath(rawPath, 'se', docPresets);
        if (!resolved) {
          const range = this.findRangeForSubstring(document, lineIdx, rawPath);
          const diag = new vscode.Diagnostic(
            range,
            `SEファイルが見つかりません: ${rawPath}`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.code = 'smd-se-not-found';
          diagnostics.push(diag);
        }
      }

      // 2. Check .bgm('...') or .bgm("...")
      const bgmPaths = this.extractDirectivePaths(rawLine, 'bgm');
      for (const rawPath of bgmPaths) {
        const resolved = this.audioPlayer.resolvePath(rawPath, 'bgm', docPresets);
        if (!resolved) {
          const range = this.findRangeForSubstring(document, lineIdx, rawPath);
          const diag = new vscode.Diagnostic(
            range,
            `BGMファイルが見つかりません: ${rawPath}`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.code = 'smd-bgm-not-found';
          diagnostics.push(diag);
        }
      }

      // 3. Check .tatie('...') or .tatie("...")
      const tatiePaths = this.extractDirectivePaths(rawLine, 'tatie');
      for (const rawPath of tatiePaths) {
        const resolved = this.audioPlayer.resolvePath(rawPath, 'tatie', docPresets);
        if (!resolved) {
          const range = this.findRangeForSubstring(document, lineIdx, rawPath);
          const diag = new vscode.Diagnostic(
            range,
            `立ち絵ファイルが見つかりません: ${rawPath}`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.code = 'smd-tatie-not-found';
          diagnostics.push(diag);
        }
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private findRangeForSubstring(document: vscode.TextDocument, lineIdx: number, subStr: string): vscode.Range {
    const lineText = document.lineAt(lineIdx).text;
    const startChar = lineText.indexOf(subStr);
    if (startChar !== -1) {
      return new vscode.Range(lineIdx, startChar, lineIdx, startChar + subStr.length);
    }
    return document.lineAt(lineIdx).range;
  }
}
