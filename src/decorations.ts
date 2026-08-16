import * as vscode from 'vscode';
import { ConfigManager } from './config.js';

export class SpeakerDecorationManager {
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private portraitMap: Map<string, string> = new Map();
  private shebangDecorationType: vscode.TextEditorDecorationType | null = null;

  constructor(private configManager: ConfigManager) {}

  public setPortraitMap(portraitMap: Map<string, string>): void {
    this.portraitMap = portraitMap;
  }

  public updateDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== 'script-markdown') {
      return;
    }

    const config = this.configManager.getMergedConfig();
    const document = editor.document;
    const text = document.getText();
    const lines = text.split('\n');

    // Map of speaker name/id/alias -> Hex Color
    const colorMap = new Map<string, string>();
    if (config.speakers) {
      for (const sp of config.speakers) {
        if (sp.color) {
          colorMap.set(sp.name, sp.color);
          colorMap.set(sp.id, sp.color);
          if (sp.aliases) {
            sp.aliases.forEach((a: string) => colorMap.set(a, sp.color!));
          }
        }
      }
    }

    // Collect line indices contained within /* ... */ block comments
    const inBlockCommentLines = new Set<number>();
    const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
    let matchBlock: RegExpExecArray | null;

    while ((matchBlock = blockCommentRegex.exec(text)) !== null) {
      const startPos = document.positionAt(matchBlock.index);
      const endPos = document.positionAt(matchBlock.index + matchBlock[0].length);
      for (let l = startPos.line; l <= endPos.line; l++) {
        inBlockCommentLines.add(l);
      }
    }

    // Collect ranges per key (color + portrait)
    const rangesPerKey = new Map<string, { color?: string; portraitPath?: string; ranges: vscode.Range[] }>();

    for (let i = 0; i < lines.length; i++) {
      if (inBlockCommentLines.has(i)) {
        continue;
      }

      const line = lines[i];
      if (/^\s*\/\//.test(line) || /^\s*>/.test(line) || /^\s*#/.test(line) || /^\s*\./.test(line)) {
        continue;
      }

      const match = line.match(/^([^>\n]+)(>)/);
      if (match) {
        const rawSpeakerPart = match[1].trim();
        const speakerName = rawSpeakerPart.split('.')[0].trim();
        const hexColor = colorMap.get(speakerName) || colorMap.get(rawSpeakerPart);
        const portraitPath = this.portraitMap.get(rawSpeakerPart) || this.portraitMap.get(speakerName);

        const key = `${hexColor || 'default'}_${portraitPath || 'none'}`;
        if (!rangesPerKey.has(key)) {
          rangesPerKey.set(key, { color: hexColor, portraitPath, ranges: [] });
        }

        const startChar = line.indexOf(match[0]);
        if (startChar !== -1) {
          const range = new vscode.Range(i, startChar, i, startChar + match[0].length);
          rangesPerKey.get(key)!.ranges.push(range);
        }
      }
    }

    const showSpeakerIcons = vscode.workspace.getConfiguration('smd').get<boolean>('showSpeakerIcons', true);

    // Apply decoration types for each unique combination key
    for (const [key, item] of rangesPerKey.entries()) {
      if (!this.decorationTypes.has(key)) {
        const decOptions: vscode.DecorationRenderOptions = {
          fontWeight: 'bold'
        };

        if (item.color) {
          decOptions.color = item.color;
        }

        if (showSpeakerIcons && item.portraitPath) {
          decOptions.gutterIconPath = vscode.Uri.file(item.portraitPath);
          decOptions.gutterIconSize = 'contain';
        }

        const decType = vscode.window.createTextEditorDecorationType(decOptions);
        this.decorationTypes.set(key, decType);
      }

      const decType = this.decorationTypes.get(key)!;
      editor.setDecorations(decType, item.ranges);
    }

    // Clear unused decoration types in current editor
    for (const [key, decType] of this.decorationTypes.entries()) {
      if (!rangesPerKey.has(key)) {
        editor.setDecorations(decType, []);
      }
    }

    // Apply muted gray decoration for shebang header line (#!/...)
    if (!this.shebangDecorationType) {
      this.shebangDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#7f8c8d',
        fontStyle: 'italic',
        opacity: '0.65'
      });
    }

    const shebangRanges: vscode.Range[] = [];
    if (lines.length > 0 && lines[0].trim().startsWith('#!')) {
      shebangRanges.push(new vscode.Range(0, 0, 0, lines[0].length));
    }
    editor.setDecorations(this.shebangDecorationType, shebangRanges);
  }

  public dispose(): void {
    for (const decType of this.decorationTypes.values()) {
      decType.dispose();
    }
    this.decorationTypes.clear();
    if (this.shebangDecorationType) {
      this.shebangDecorationType.dispose();
      this.shebangDecorationType = null;
    }
  }
}

export function registerSpeakerDecorations(
  context: vscode.ExtensionContext, 
  configManager: ConfigManager,
  portraitMapProvider?: () => Map<string, string>
): SpeakerDecorationManager {
  const manager = new SpeakerDecorationManager(configManager);

  const update = () => {
    if (portraitMapProvider) {
      manager.setPortraitMap(portraitMapProvider());
    }
    manager.updateDecorations(vscode.window.activeTextEditor);
  };

  if (vscode.window.activeTextEditor) {
    update();
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => update()),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
        update();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('smd.showSpeakerIcons')) {
        manager.dispose();
        update();
      }
    }),
    { dispose: () => manager.dispose() }
  );

  return manager;
}
