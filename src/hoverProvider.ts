import * as vscode from 'vscode';
import { AudioPlayer } from './audioPlayer.js';
import { VoicevoxEngineClient } from './voicevoxEngine.js';
import { SE_DIRECTIVE_MATCH_REGEX } from './directiveRegex.js';

export function registerHoverProvider(
  context: vscode.ExtensionContext,
  audioPlayer: AudioPlayer,
  engineClient?: VoicevoxEngineClient
): void {
  const hoverProvider: vscode.HoverProvider = {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
      const lineText = document.lineAt(position.line).text.trim();
      if (!lineText) {
        return null;
      }

      // 1. Hover on .se('...') line
      const seMatch = lineText.match(SE_DIRECTIVE_MATCH_REGEX);
      if (seMatch) {
        const rawPath = (seMatch[1] ?? seMatch[2]).replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
        const smdParser = engineClient?.getSmdParser();
        const docPresets = smdParser ? smdParser.parseDocumentPresets(document, position.line) : undefined;
        const resolvedPath = audioPlayer.resolvePath(rawPath, 'se', docPresets);
        const contents = new vscode.MarkdownString();
        contents.isTrusted = true;

        contents.appendMarkdown(`### 🔊 ScriptMarkDown Audio Preview: **SE (効果音)**\n\n`);
        contents.appendMarkdown(`- **ファイルパス**: \`${rawPath}\`\n`);
        if (resolvedPath) {
          contents.appendMarkdown(`- **状態**: 実在が確認されました\n\n`);

          const playUri = vscode.Uri.parse(`command:smd.playAudio?${encodeURIComponent(JSON.stringify([resolvedPath]))}`);
          const stopUri = vscode.Uri.parse(`command:smd.stopAudio`);
          const revealUri = vscode.Uri.parse(`command:smd.revealInFinder?${encodeURIComponent(JSON.stringify([resolvedPath]))}`);

          contents.appendMarkdown(`[▶ 音声を試聴する](${playUri}) &nbsp;|&nbsp; [■ 停止する](${stopUri}) &nbsp;|&nbsp; [📁 Finderで参照](${revealUri})\n`);
        } else {
          contents.appendMarkdown(`- **状態**: ⚠️ ファイルが見つかりません\n`);
        }

        return new vscode.Hover(contents);
      }

      // 2. Hover on .bgm('...') line
      const bgmMatch = lineText.match(/\.bgm\(\s*(?:"([^"]+)"|'((?:\\[']|[^'])+)')(?:\s*,\s*([0-9.]+))?\s*\)/i);
      if (bgmMatch) {
        const rawPath = (bgmMatch[1] ?? bgmMatch[2]).replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
        const smdParser = engineClient?.getSmdParser();
        const docPresets = smdParser ? smdParser.parseDocumentPresets(document, position.line) : undefined;
        const resolvedPath = audioPlayer.resolvePath(rawPath, 'bgm', docPresets);
        const volume = bgmMatch[3] ? parseFloat(bgmMatch[3]) : 1.0;

        const contents = new vscode.MarkdownString();
        contents.isTrusted = true;

        contents.appendMarkdown(`### 🎵 ScriptMarkDown Audio Preview: **BGM**\n\n`);
        contents.appendMarkdown(`- **ファイルパス**: \`${rawPath}\`\n`);
        contents.appendMarkdown(`- **指定音量**: \`${volume}\`\n`);

        if (resolvedPath) {
          contents.appendMarkdown(`- **状態**: 実在が確認されました\n\n`);

          const playUri = vscode.Uri.parse(`command:smd.playAudio?${encodeURIComponent(JSON.stringify([resolvedPath, volume, true]))}`);
          const stopUri = vscode.Uri.parse(`command:smd.stopAudio`);
          const revealUri = vscode.Uri.parse(`command:smd.revealInFinder?${encodeURIComponent(JSON.stringify([resolvedPath]))}`);

          contents.appendMarkdown(`[▶ BGMを試聴する](${playUri}) &nbsp;|&nbsp; [■ 停止する](${stopUri}) &nbsp;|&nbsp; [📁 Finderで参照](${revealUri})\n`);
        } else {
          contents.appendMarkdown(`- **状態**: ⚠️ ファイルが見つかりません\n`);
        }

        return new vscode.Hover(contents);
      }

      // 3. Hover on .tatie('...') line
      const tatieMatch = lineText.match(/\.tatie\(\s*(?:"([^"]+)"|'((?:\\[']|[^'])+)')\s*\)/i);
      if (tatieMatch) {
        const rawPath = (tatieMatch[1] ?? tatieMatch[2]).replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
        const smdParser = engineClient?.getSmdParser();
        const docPresets = smdParser ? smdParser.parseDocumentPresets(document, position.line) : undefined;
        const resolvedPath = audioPlayer.resolvePath(rawPath, 'tatie', docPresets);

        const contents = new vscode.MarkdownString();
        contents.isTrusted = true;

        contents.appendMarkdown(`### 🖼️ ScriptMarkDown Character Preview: **立ち絵 (Tatie)**\n\n`);
        contents.appendMarkdown(`- **ファイルパス**: \`${rawPath}\`\n`);

        if (resolvedPath) {
          contents.appendMarkdown(`- **状態**: 実在が確認されました\n\n`);
          const revealUri = vscode.Uri.parse(`command:smd.revealInFinder?${encodeURIComponent(JSON.stringify([resolvedPath]))}`);
          contents.appendMarkdown(`[📁 Finderで参照](${revealUri})\n`);
        } else {
          contents.appendMarkdown(`- **状態**: ⚠️ ファイルが見つかりません\n`);
        }

        return new vscode.Hover(contents);
      }

      // 4. Hover on Dialogue line (Voicevox Engine Voice Preview)
      if (lineText.includes('>') && !lineText.startsWith('.')) {
        const smdParser = engineClient?.getSmdParser();
        const docPresets = smdParser ? smdParser.parseDocumentPresets(document, position.line) : undefined;
        const parsedVoice = smdParser ? smdParser.parseLineForVoice(lineText, docPresets) : null;

        const contents = new vscode.MarkdownString();
        contents.isTrusted = true;

        contents.appendMarkdown(`### 🗣️ ScriptMarkDown Dialogue Voice Preview\n\n`);
        contents.appendMarkdown(`カーソル行のセリフ音声（VOICEVOX Engine リアルタイム音声合成）を試聴できます。\n\n`);

        const voiceUri = vscode.Uri.parse(`command:smd.playCurrentLineVoice`);
        contents.appendMarkdown(`[▶ このセリフを試聴する (Shift+Enter)](${voiceUri})`);

        if (parsedVoice?.tatie) {
          const resolvedTatie = audioPlayer.resolvePath(parsedVoice.tatie, 'tatie', docPresets);
          if (resolvedTatie) {
            const revealTatieUri = vscode.Uri.parse(`command:smd.revealInFinder?${encodeURIComponent(JSON.stringify([resolvedTatie]))}`);
            contents.appendMarkdown(` &nbsp;|&nbsp; [🖼️ 立ち絵をFinderで参照](${revealTatieUri})`);
          }
        }

        contents.appendMarkdown(`\n`);
        return new vscode.Hover(contents);
      }

      return null;
    }
  };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'script-markdown' }, hoverProvider)
  );

  // Register helper commands for hover card actions
  context.subscriptions.push(
    vscode.commands.registerCommand('smd.playAudio', (filePath: string, volume?: number, isBgm?: boolean) => {
      if (filePath) {
        if (isBgm) {
          audioPlayer.playBgm(filePath, volume || 0.3);
        } else {
          audioPlayer.playDirect(filePath);
        }
      }
    }),
    vscode.commands.registerCommand('smd.stopAudio', () => {
      audioPlayer.cancel();
      audioPlayer.stopAll();
    }),
    vscode.commands.registerCommand('smd.revealInFinder', (filePath: string) => {
      if (filePath) {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
      }
    })
  );
}
