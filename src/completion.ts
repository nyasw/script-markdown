import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './config.js';
import { SpeakerUsageTracker } from './usageTracker.js';
import { AudioPlayer } from './audioPlayer.js';

interface ActiveSuggestItem {
  isFolder: boolean;
  fsPath?: string;
}

export const SMD_COMPLETION_SNIPPETS = {
  se: {
    label: '.se',
    insert: '.se("/$0")',
    detail: 'SE ディレクティブ (.se("/"))',
    doc: '独立行またはセリフ行末尾で効果音(SE)を再生'
  },
  bgm: {
    label: '.bgm',
    insert: '.bgm("/$0")',
    detail: 'BGM ディレクティブ (.bgm("/"))',
    doc: '独立行またはセリフ行末尾で背景音楽(BGM)を再生'
  },
  tatie: {
    label: '.tatie',
    insert: '.tatie("/$0")',
    detail: '立ち絵ディレクティブ (.tatie("/"))',
    doc: '独立行またはセリフ行末尾で立ち絵(画像)を指定'
  },
  wait: {
    label: '.wait',
    insert: '.wait(${1:1.0})',
    detail: 'ウエイト待機ディレクティブ (.wait(秒))',
    doc: '指定秒数待機'
  },
  telop: {
    label: '>',
    insert: '> ${1:画面テロップ文章}',
    detail: '画面表示テロップ行 (> テロップ)',
    doc: '画面字幕・テロップを出力。音声合成を行わず、.font() や .color() のパラメータ装飾が可能'
  },
  shebang: {
    label: '!',
    insert: '#!/usr/bin/env smd@1.0  --ScriptMarkDown--\n',
    detail: '#!/usr/bin/env smd@1.0  --ScriptMarkDown--',
    doc: 'ScriptMarkDown スクリプト言語標準シバンヘッダー (#!/usr/bin/env smd@1.0  --ScriptMarkDown--)'
  }
};

export function registerCompletionProvider(
  context: vscode.ExtensionContext, 
  configManager: ConfigManager,
  usageTracker: SpeakerUsageTracker,
  audioPlayer: AudioPlayer
): void {

  let activeCompletionItems: { relativePath: string; fsPath: string; isFolder: boolean }[] = [];
  let activeIndex: number = -1;
  let lastAudioLineNumber: number | null = null;

  // Listen to editor selection changes: stop BGM / SE playback when cursor leaves the current line!
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length > 0) {
        audioPlayer.stop();
        lastAudioLineNumber = null;
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      const editor = event.textEditor;
      if (!editor || editor.document.languageId !== 'script-markdown') {
        return;
      }

      // Do NOT stop audio if continuous script playback is active!
      if (audioPlayer.getIsPlayingScript()) {
        return;
      }

      const currentLine = editor.selection.active.line;

      // If cursor moved to a different line, stop lingering BGM / SE immediately!
      if (lastAudioLineNumber !== null && lastAudioLineNumber !== currentLine) {
        audioPlayer.stop();
      }

      lastAudioLineNumber = currentLine;
    })
  );

  // Arrow down / up key repeat throttle guard variables
  let lastKeyTime = 0;
  let isKeyHandling = false;
  const KEY_THROTTLE_MS = 30;

  context.subscriptions.push(
    vscode.commands.registerCommand('smd.triggerSuggestDelayed', () => {
      setTimeout(async () => {
        try {
          await vscode.commands.executeCommand('leaveSnippet');
        } catch (e) {
          // ignore if not in snippet mode
        }
        await vscode.commands.executeCommand('editor.action.triggerSuggest');
      }, 100);
    }),
    vscode.commands.registerCommand('smd.selectSpeakerAndSuggestStyle', (speakerName: string) => {
      if (speakerName) {
        usageTracker.recordUsage(speakerName);
      }
      setTimeout(async () => {
        await vscode.commands.executeCommand('editor.action.triggerSuggest');
      }, 100);
    }),
    // Arrow down key hook (Trailing Debounce: cursor moves at max speed, audio plays only on settled)
    vscode.commands.registerCommand('smd.suggestNextAudio', async () => {
      try {
        await vscode.commands.executeCommand('selectNextSuggestion');

        if (activeCompletionItems.length > 0) {
          activeIndex = (activeIndex + 1) % activeCompletionItems.length;
          const currentItem = activeCompletionItems[activeIndex];
          if (currentItem && !currentItem.isFolder && currentItem.fsPath) {
            audioPlayer.playDebounced(currentItem.fsPath, 180);
          }
        }
      } catch (e) {
        // ignore
      }
    }),
    // Arrow up key hook (Trailing Debounce: cursor moves at max speed, audio plays only on settled)
    vscode.commands.registerCommand('smd.suggestPrevAudio', async () => {
      try {
        await vscode.commands.executeCommand('selectPrevSuggestion');

        if (activeCompletionItems.length > 0) {
          activeIndex = (activeIndex - 1 + activeCompletionItems.length) % activeCompletionItems.length;
          const currentItem = activeCompletionItems[activeIndex];
          if (currentItem && !currentItem.isFolder && currentItem.fsPath) {
            audioPlayer.playDebounced(currentItem.fsPath, 180);
          }
        }
      } catch (e) {
        // ignore
      }
    })
  );

  const provider = vscode.languages.registerCompletionItemProvider(
    'script-markdown',
    {
      async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        const lineText = document.lineAt(position.line).text;
        const lineUntilPosition = lineText.substring(0, position.character);
        const config = configManager.getMergedConfig();
        const speakers = config.speakers || [];
        activeCompletionItems = [];
        activeIndex = -1;

        // 1. If line is a comment, disable completions
        if (/^\s*\/\//.test(lineUntilPosition) || /(?:^|\s)\/\//.test(lineUntilPosition)) {
          return [];
        }

        const items: vscode.CompletionItem[] = [];

        // 1.5. Pitch values completion when typing inside .pitch(...)
        if (/\.pitch\(\s*[^)]*$/i.test(lineUntilPosition)) {
          const pitchValues = [-0.08, -0.06, -0.04, -0.02, 0.0, 0.02, 0.04, 0.06, 0.08];
          for (let idx = 0; idx < pitchValues.length; idx++) {
            const val = pitchValues[idx];
            const formatted = val === 0 ? '0.0' : (val > 0 ? `${val.toFixed(2)}` : `${val.toFixed(2)}`);
            const item = new vscode.CompletionItem(formatted, vscode.CompletionItemKind.Value);
            item.insertText = formatted;
            item.detail = `音高 (pitch): ${formatted}`;
            item.documentation = `VOICEVOX 音高パラメータ (${formatted})`;
            item.sortText = `pitch_${idx.toString().padStart(2, '0')}`;
            if (val === 0) {
              item.preselect = true;
            }
            items.push(item);
          }
          return items;
        }

        const hasSpeakerDelimiter = lineUntilPosition.includes('>');

        // 2. Standalone se, bgm, or wait trigger (unified as Event with lightning icon)
        if (!hasSpeakerDelimiter) {
          const trimmed = lineUntilPosition.trim().toLowerCase();

          if (['s', 'se', '.s', '.se', '/s', '/se'].includes(trimmed)) {
            const startPos = position.translate(0, -lineUntilPosition.trim().length);
            const item = new vscode.CompletionItem(SMD_COMPLETION_SNIPPETS.se.label, vscode.CompletionItemKind.Event);
            item.insertText = new vscode.SnippetString(SMD_COMPLETION_SNIPPETS.se.insert);
            item.detail = SMD_COMPLETION_SNIPPETS.se.detail;
            item.documentation = SMD_COMPLETION_SNIPPETS.se.doc;
            item.range = new vscode.Range(startPos, position);
            item.filterText = `${lineUntilPosition.trim()} s se .s .se /s /se`;
            item.sortText = '00_se';
            item.preselect = true;
            item.command = {
              command: 'smd.triggerSuggestDelayed',
              title: 'Delayed Trigger Path Completion'
            };
            items.push(item);
          }

          if (['b', 'bg', 'bgm', '.b', '.bg', '.bgm', '/b', '/bg', '/bgm'].includes(trimmed)) {
            const startPos = position.translate(0, -lineUntilPosition.trim().length);
            const item = new vscode.CompletionItem(SMD_COMPLETION_SNIPPETS.bgm.label, vscode.CompletionItemKind.Event);
            item.insertText = new vscode.SnippetString(SMD_COMPLETION_SNIPPETS.bgm.insert);
            item.detail = SMD_COMPLETION_SNIPPETS.bgm.detail;
            item.documentation = SMD_COMPLETION_SNIPPETS.bgm.doc;
            item.range = new vscode.Range(startPos, position);
            item.filterText = `${lineUntilPosition.trim()} b bg bgm .b .bg .bgm /b /bg /bgm`;
            item.sortText = '00_bgm';
            item.preselect = true;
            item.command = {
              command: 'smd.triggerSuggestDelayed',
              title: 'Delayed Trigger Path Completion'
            };
            items.push(item);
          }

          if (['t', 'ta', 'tat', 'tati', 'tatie', '.t', '.ta', '.tat', '.tati', '.tatie', '/t', '/ta', '/tat', '/tati', '/tatie'].includes(trimmed)) {
            const startPos = position.translate(0, -lineUntilPosition.trim().length);
            const item = new vscode.CompletionItem(SMD_COMPLETION_SNIPPETS.tatie.label, vscode.CompletionItemKind.Event);
            item.insertText = new vscode.SnippetString(SMD_COMPLETION_SNIPPETS.tatie.insert);
            item.detail = SMD_COMPLETION_SNIPPETS.tatie.detail;
            item.documentation = SMD_COMPLETION_SNIPPETS.tatie.doc;
            item.range = new vscode.Range(startPos, position);
            item.filterText = `${lineUntilPosition.trim()} t ta tat tati tatie .t .ta .tat .tati .tatie /t /ta /tat /tati /tatie`;
            item.sortText = '00_tatie';
            item.preselect = true;
            item.command = {
              command: 'smd.triggerSuggestDelayed',
              title: 'Delayed Trigger Path Completion'
            };
            items.push(item);
          }

          if (['w', 'wa', 'wai', 'wait', '.w', '.wa', '.wai', '.wait', '/w', '/wa', '/wai', '/wait'].includes(trimmed)) {
            const startPos = position.translate(0, -lineUntilPosition.trim().length);
            const item = new vscode.CompletionItem(SMD_COMPLETION_SNIPPETS.wait.label, vscode.CompletionItemKind.Event);
            item.insertText = new vscode.SnippetString(SMD_COMPLETION_SNIPPETS.wait.insert);
            item.detail = SMD_COMPLETION_SNIPPETS.wait.detail;
            item.documentation = SMD_COMPLETION_SNIPPETS.wait.doc;
            item.range = new vscode.Range(startPos, position);
            item.filterText = `${lineUntilPosition.trim()} w wa wai wait .w .wa .wai .wait /w /wa /wai /wait`;
            item.sortText = '00_wait';
            item.preselect = true;
            items.push(item);
          }

          if (items.length > 0) {
            return items;
          }

          // Shebang Completion (Strictly restricted to line 0 at the start of document with ! or #!)
          if (position.line === 0 && (trimmed === '!' || trimmed === '#!')) {
            const startPos = position.translate(0, -lineUntilPosition.trim().length);
            const item = new vscode.CompletionItem(SMD_COMPLETION_SNIPPETS.shebang.label, vscode.CompletionItemKind.Snippet);
            item.insertText = new vscode.SnippetString(SMD_COMPLETION_SNIPPETS.shebang.insert);
            item.label = '! (Shebang Header)';
            item.detail = SMD_COMPLETION_SNIPPETS.shebang.detail;
            item.documentation = SMD_COMPLETION_SNIPPETS.shebang.doc;
            item.range = new vscode.Range(startPos, position);
            item.filterText = `${lineUntilPosition.trim()} ! #! smd env`;
            item.sortText = '00_shebang';
            item.preselect = true;
            return [item];
          }
        }

        // 3. Audio & Tatie File/Directory Path Completions (Only when cursor is inside an UNCLOSED quote: .se("... or .se('...)
        const pathMatch = lineUntilPosition.match(/\.(se|bgm|tatie)\(\s*(?:"([^"]*)|'([^']*))$/i);
        if (pathMatch) {
          const type = pathMatch[1].toLowerCase() as 'se' | 'bgm' | 'tatie';
          const typedPath = pathMatch[2] !== undefined ? pathMatch[2] : pathMatch[3];

          const currentDirPrefix = typedPath.endsWith('/') ? typedPath : typedPath.substring(0, typedPath.lastIndexOf('/') + 1);

          const subDirectories = new Set<string>();
          const currentLevelFiles: { relativePath: string; fsPath: string }[] = [];

          const addCandidateFile = (fullPath: string, displayRelPath: string) => {
            const relClean = displayRelPath.replace(/^[/\\]+/, '');
            const prefixClean = currentDirPrefix.replace(/^[/\\]+/, '');

            if (relClean.startsWith(prefixClean)) {
              const remainder = relClean.substring(prefixClean.length);
              const slashIndex = remainder.indexOf('/');
              if (slashIndex !== -1) {
                const dirName = remainder.substring(0, slashIndex);
                subDirectories.add(currentDirPrefix + dirName + '/');
              } else {
                currentLevelFiles.push({ relativePath: displayRelPath, fsPath: fullPath });
              }
            } else if (!prefixClean) {
              const slashIndex = relClean.indexOf('/');
              if (slashIndex !== -1) {
                subDirectories.add('/' + relClean.substring(0, slashIndex) + '/');
              } else {
                currentLevelFiles.push({ relativePath: displayRelPath, fsPath: fullPath });
              }
            }
          };

          // Scan Only Configured Directory (smd.seDir / smd.bgmDir / smd.tatieDir)
          const config = vscode.workspace.getConfiguration('smd');
          let settingDir: string | undefined;
          if (type === 'se') settingDir = config.get<string>('seDir');
          else if (type === 'bgm') settingDir = config.get<string>('bgmDir');
          else if (type === 'tatie') settingDir = config.get<string>('tatieDir');

          if (settingDir && settingDir.trim()) {
            const extBase = settingDir.trim();
            const extBaseAbs = path.isAbsolute(extBase)
              ? extBase
              : (vscode.workspace.workspaceFolders ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, extBase) : null);

            if (extBaseAbs && fs.existsSync(extBaseAbs)) {
              try {
                const scanExtDir = async (dirPath: string, basePrefix: string) => {
                  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
                  for (const entry of entries) {
                    const full = path.join(dirPath, entry.name);
                    const rel = path.join(basePrefix, entry.name).replace(/\\/g, '/');
                    if (entry.isDirectory()) {
                      await scanExtDir(full, rel);
                    } else if (entry.isFile()) {
                      const ext = path.extname(entry.name).toLowerCase();
                      const allowedExts = type === 'tatie'
                        ? ['.png', '.jpg', '.jpeg', '.webp', '.psd', '.svg']
                        : ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac'];
                      if (allowedExts.includes(ext)) {
                        addCandidateFile(full, '/' + rel);
                      }
                    }
                  }
                };
                await scanExtDir(extBaseAbs, '');
              } catch (err) {
                // Ignore read errors
              }
            }
          }

          // Clear and reset completion item tracker on each suggest trigger
          activeCompletionItems = [];
          activeIndex = 0;

          let sortOrder = 0;

          // Add Directory Completion Items (📁 Folder)
          const sortedDirs = Array.from(subDirectories).sort();
          for (const dirPath of sortedDirs) {
            activeCompletionItems.push({ relativePath: dirPath, fsPath: '', isFolder: true });

            const dirInsertText = dirPath.startsWith(currentDirPrefix) ? dirPath.substring(currentDirPrefix.length) : dirPath;
            const item = new vscode.CompletionItem(dirPath, vscode.CompletionItemKind.Folder);
            item.insertText = dirInsertText;
            item.filterText = `${dirPath} ${dirInsertText} ${dirPath.replace(/^\//, '')}`;
            item.detail = `Directory`;
            item.sortText = `!0_${(sortOrder++).toString().padStart(5, '0')}`;
            item.documentation = `Navigate into ${dirPath}`;
            
            item.command = {
              command: 'editor.action.triggerSuggest',
              title: 'Trigger Next Level Completion'
            };

            items.push(item);
          }

          // Add Audio File Completion Items (Audio File)
          const sortedFiles = currentLevelFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
          for (let fIdx = 0; fIdx < sortedFiles.length; fIdx++) {
            const fileObj = sortedFiles[fIdx];
            activeCompletionItems.push({ relativePath: fileObj.relativePath, fsPath: fileObj.fsPath, isFolder: false });

            const baseName = path.basename(fileObj.relativePath);
            const fileInsertText = fileObj.relativePath.startsWith(currentDirPrefix) ? fileObj.relativePath.substring(currentDirPrefix.length) : fileObj.relativePath;
            const item = new vscode.CompletionItem(fileObj.relativePath, vscode.CompletionItemKind.File);
            item.insertText = fileInsertText;
            item.filterText = `${fileObj.relativePath} ${baseName} ${fileInsertText} ${fileObj.relativePath.replace(/^\//, '')}`;
            item.detail = `Audio File (${type.toUpperCase()})`;
            item.sortText = `!1_${(sortOrder++).toString().padStart(5, '0')}`;

            item.documentation = new vscode.MarkdownString(`Audio File: \`${fileObj.fsPath}\`\n\n*Arrow keys navigation plays preview audio automatically!*`);

            items.push(item);
          }

          // Automatically play preview audio for the first highlighted item (index 0) if it is a file
          if (activeCompletionItems.length > 0) {
            activeIndex = 0;
            const firstItem = activeCompletionItems[0];
            if (!firstItem.isFolder && firstItem.fsPath) {
              audioPlayer.playDebounced(firstItem.fsPath, 80);
            }
          }

          return items;
        }

        // 0. Preset Directive Completion Hierarchy
        const trimmedLine = lineUntilPosition.trim();
        if (trimmedLine === 'preset' || lineUntilPosition.endsWith('preset')) {
          const presetSnippetItem = new vscode.CompletionItem('preset.', vscode.CompletionItemKind.Snippet);
          presetSnippetItem.insertText = new vscode.SnippetString('preset.$0');
          presetSnippetItem.detail = 'preset. ディレクティブ宣言';
          presetSnippetItem.documentation = 'Inserts preset. and triggers next level completion';
          presetSnippetItem.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
          items.push(presetSnippetItem);
          return items;
        }

        if (lineUntilPosition.trim().startsWith('preset.')) {
          // Step 1: Immediately after "preset." -> suggest "all", "bgm", "se", or "\"speakerName\""
          if (lineUntilPosition.endsWith('preset.')) {
            const allItem = new vscode.CompletionItem('all', vscode.CompletionItemKind.Keyword);
            allItem.detail = '全話者のデフォルトパラメータを設定';
            allItem.insertText = new vscode.SnippetString('all.');
            allItem.sortText = '00_all';
            allItem.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            items.push(allItem);

            const bgmPresetItem = new vscode.CompletionItem('bgm', vscode.CompletionItemKind.Keyword);
            bgmPresetItem.detail = 'BGMマスター音量を設定 (preset.bgm.bgmVol(0.5))';
            bgmPresetItem.insertText = new vscode.SnippetString('bgm.');
            bgmPresetItem.sortText = '01_bgm';
            bgmPresetItem.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            items.push(bgmPresetItem);

            const sePresetItem = new vscode.CompletionItem('se', vscode.CompletionItemKind.Keyword);
            sePresetItem.detail = 'SEマスター音量を設定 (preset.se.seVol(0.5))';
            sePresetItem.insertText = new vscode.SnippetString('se.');
            sePresetItem.sortText = '02_se';
            sePresetItem.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            items.push(sePresetItem);

            for (const sp of speakers) {
              const spItem = new vscode.CompletionItem(`"${sp.name}"`, vscode.CompletionItemKind.User);
              spItem.detail = `話者プリセット: ${sp.name}`;
              spItem.insertText = new vscode.SnippetString(`"${sp.name}".`);
              spItem.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
              items.push(spItem);
            }
            return items;
          }

          // Step 2-A: After "preset.bgm." -> suggest BGM volume methods
          if (/preset\.bgm\./i.test(lineUntilPosition)) {
            const bgmMethods = [
              { label: 'bgmVol', snippet: 'bgmVol(${1:0.5})', doc: 'BGMマスター音量 (0.0〜2.0)' },
              { label: 'vol', snippet: 'vol(${1:0.5})', doc: 'BGMマスター音量 (0.0〜2.0)' },
              { label: 'volume', snippet: 'volume(${1:0.5})', doc: 'BGMマスター音量 (0.0〜2.0)' }
            ];
            for (const m of bgmMethods) {
              const item = new vscode.CompletionItem(m.label, vscode.CompletionItemKind.Method);
              item.insertText = new vscode.SnippetString(m.snippet);
              item.detail = m.doc;
              items.push(item);
            }
            return items;
          }

          // Step 2-B: After "preset.se." -> suggest SE volume methods
          if (/preset\.se\./i.test(lineUntilPosition)) {
            const seMethods = [
              { label: 'seVol', snippet: 'seVol(${1:0.5})', doc: 'SEマスター音量 (0.0〜2.0)' },
              { label: 'vol', snippet: 'vol(${1:0.5})', doc: 'SEマスター音量 (0.0〜2.0)' },
              { label: 'volume', snippet: 'volume(${1:0.5})', doc: 'SEマスター音量 (0.0〜2.0)' }
            ];
            for (const m of seMethods) {
              const item = new vscode.CompletionItem(m.label, vscode.CompletionItemKind.Method);
              item.insertText = new vscode.SnippetString(m.snippet);
              item.detail = m.doc;
              items.push(item);
            }
            return items;
          }

          // Step 2-C: After "preset.all." or "preset.\"speaker\"." or chained methods -> suggest speaker options (.speed, .pitch, etc.)
          if (/preset\.(all|['"][^'"]+['"]|[^.\s]+)\./i.test(lineUntilPosition)) {
            const methods = [
              { label: 'speed', snippet: 'speed(${1:1.1})', doc: '話速倍率' },
              { label: 'pitch', snippet: 'pitch(${1:0.0})', doc: '音高' },
              { label: 'intonation', snippet: 'intonation(${1:1.0})', doc: '抑揚' },
              { label: 'volume', snippet: 'volume(${1:1.0})', doc: '音量' },
              { label: 'pause_length', snippet: 'pause_length(${1:1.0})', doc: '読点・文中の間の長さ倍率 (pauseLengthScale)' },
              { label: 'pre_silence', snippet: 'pre_silence(${1:0.1})', doc: '発音開始前の無音時間秒数 (prePhonemeLength)' },
              { label: 'post_silence', snippet: 'post_silence(${1:0.1})', doc: '発音終了後の無音時間秒数 (postPhonemeLength)' },
              { label: 'font', snippet: 'font("${1:Noto Sans}")', doc: 'フォント指定' },
              { label: 'tatie', snippet: 'tatie("${1:立ち絵名}")', doc: '立ち絵指定' }
            ];

            for (const m of methods) {
              const item = new vscode.CompletionItem(m.label, vscode.CompletionItemKind.Method);
              item.insertText = new vscode.SnippetString(m.snippet);
              item.detail = m.doc;
              items.push(item);
            }
            return items;
          }

          // Strict guard: Always return items for any preset. context so .se or .bgm NEVER bleed through!
          return items;
        }

        // 4. Dot (.) Directives
        if (lineUntilPosition.endsWith('.')) {
          const isLineStartDot = /^\s*\.$/.test(lineUntilPosition);

          if (isLineStartDot) {
            const dotRange = new vscode.Range(position.translate(0, -1), position);
            const directives = [
              { 
                label: SMD_COMPLETION_SNIPPETS.bgm.label, 
                insert: SMD_COMPLETION_SNIPPETS.bgm.insert, 
                doc: SMD_COMPLETION_SNIPPETS.bgm.doc 
              },
              { 
                label: SMD_COMPLETION_SNIPPETS.se.label, 
                insert: SMD_COMPLETION_SNIPPETS.se.insert, 
                doc: SMD_COMPLETION_SNIPPETS.se.doc 
              },
              { 
                label: SMD_COMPLETION_SNIPPETS.tatie.label, 
                insert: SMD_COMPLETION_SNIPPETS.tatie.insert, 
                doc: SMD_COMPLETION_SNIPPETS.tatie.doc 
              },
              { 
                label: SMD_COMPLETION_SNIPPETS.wait.label, 
                insert: SMD_COMPLETION_SNIPPETS.wait.insert, 
                doc: SMD_COMPLETION_SNIPPETS.wait.doc 
              }
            ];

            for (const d of directives) {
              const item = new vscode.CompletionItem(d.label, vscode.CompletionItemKind.Event);
              item.insertText = new vscode.SnippetString(d.insert);
              item.documentation = d.doc;
              item.range = dotRange;
              
              if (d.label === '.se' || d.label === '.bgm' || d.label === '.tatie') {
                item.command = {
                  command: 'smd.triggerSuggestDelayed',
                  title: 'Delayed Trigger Path Completion'
                };
              }

              items.push(item);
            }
            return items;
          }

          if (!hasSpeakerDelimiter) {
            const trimmedLine = lineUntilPosition.trim();
            const speakerMatch = trimmedLine.match(/^([^\s\.\>\/\[\]]+)\.$/);
            if (speakerMatch && config.speakers) {
              const speakerNameOrAlias = speakerMatch[1];
              const speaker = config.speakers.find(s => 
                s.name === speakerNameOrAlias || 
                s.id === speakerNameOrAlias || 
                s.aliases?.includes(speakerNameOrAlias)
              );

              if (speaker && speaker.styles) {
                const dotRange = new vscode.Range(position.translate(0, -1), position);
                const noStyleItem = new vscode.CompletionItem('(スタイルなし)', vscode.CompletionItemKind.EnumMember);
                noStyleItem.insertText = '> ';
                noStyleItem.range = dotRange;
                noStyleItem.filterText = '.(スタイルなし) .スタイルなし . (スタイルなし) スタイルなし default';
                noStyleItem.detail = `${speaker.name} (スタイル指定なし)`;
                noStyleItem.documentation = `Removes dot and completes as ${speaker.name}> `;
                noStyleItem.sortText = '!0000_0';
                noStyleItem.preselect = true;
                noStyleItem.command = {
                  command: 'smd.recordUsage',
                  title: 'Record Usage',
                  arguments: [speaker.name]
                };
                items.push(noStyleItem);

                for (let sIdx = 0; sIdx < speaker.styles.length; sIdx++) {
                  const style = speaker.styles[sIdx];
                  const styleItem = new vscode.CompletionItem(style, vscode.CompletionItemKind.Value);
                  styleItem.insertText = `${style}> `;
                  styleItem.filterText = `.${style} ${style}`;
                  styleItem.detail = `${speaker.name} Style: ${style}`;
                  styleItem.documentation = `Applies style ${style} to ${speaker.name}`;
                  styleItem.sortText = `!${(sIdx + 1).toString().padStart(4, '0')}`;
                  
                  styleItem.command = {
                    command: 'smd.recordUsage',
                    title: 'Record Usage',
                    arguments: [speaker.name]
                  };

                  items.push(styleItem);
                }
                return items;
              }
            }
            return [];
          } else {
            const dotRange = new vscode.Range(position.translate(0, -1), position);
            const parameters = [
              { 
                label: SMD_COMPLETION_SNIPPETS.bgm.label, 
                insert: SMD_COMPLETION_SNIPPETS.bgm.insert, 
                doc: SMD_COMPLETION_SNIPPETS.bgm.doc,
                kind: vscode.CompletionItemKind.Event,
                hasCommand: true
              },
              { 
                label: SMD_COMPLETION_SNIPPETS.se.label, 
                insert: SMD_COMPLETION_SNIPPETS.se.insert, 
                doc: SMD_COMPLETION_SNIPPETS.se.doc,
                kind: vscode.CompletionItemKind.Event,
                hasCommand: true
              },
              { 
                label: SMD_COMPLETION_SNIPPETS.tatie.label, 
                insert: SMD_COMPLETION_SNIPPETS.tatie.insert, 
                doc: SMD_COMPLETION_SNIPPETS.tatie.doc,
                kind: vscode.CompletionItemKind.Event,
                hasCommand: true
              },
              { 
                label: SMD_COMPLETION_SNIPPETS.wait.label, 
                insert: SMD_COMPLETION_SNIPPETS.wait.insert, 
                doc: SMD_COMPLETION_SNIPPETS.wait.doc,
                kind: vscode.CompletionItemKind.Event,
                hasCommand: false
              },
              { label: '.font', insert: '.font("${1:Noto Sans}")', doc: 'フォント指定装飾 (.font("Noto Sans"))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.color', insert: '.color("#${1:ffffff}")', doc: 'テキストカラー指定 (.color("#ffffff"))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.size', insert: '.size(${1:1.2})', doc: '文字サイズ倍率 (.size(1.2))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.speed', insert: '.speed(${1:1.0})', doc: '話速倍率 (.speed(1.0))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.pitch', insert: '.pitch(${1|0.0,-0.08,-0.06,-0.04,-0.02,0.02,0.04,0.06,0.08|})', doc: '音高 (.pitch(-0.08〜0.08))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.intonation', insert: '.intonation(${1:1.0})', doc: '抑揚 (.intonation(1.0))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.volume', insert: '.volume(${1:1.0})', doc: '音量 (.volume(1.0))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.bgmVol', insert: '.bgmVol(${1:0.5})', doc: 'BGMマスター音量 (.bgmVol(0.5))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.seVol', insert: '.seVol(${1:0.5})', doc: 'SEマスター音量 (.seVol(0.5))', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.pause_length', insert: '.pause_length(${1:1.0})', doc: '読点・文中の間の長さ倍率 (pauseLengthScale)', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.pre_silence', insert: '.pre_silence(${1:0.1})', doc: '発音開始前の無音時間秒数 (prePhonemeLength)', kind: vscode.CompletionItemKind.Method, hasCommand: false },
              { label: '.post_silence', insert: '.post_silence(${1:0.1})', doc: '発音終了後の無音時間秒数 (postPhonemeLength)', kind: vscode.CompletionItemKind.Method, hasCommand: false }
            ];

            for (const p of parameters) {
              const item = new vscode.CompletionItem(p.label, p.kind);
              item.insertText = new vscode.SnippetString(p.insert);
              item.documentation = p.doc;
              item.range = dotRange;
              if (p.hasCommand) {
                item.command = {
                  command: 'smd.triggerSuggestDelayed',
                  title: 'Delayed Trigger Path Completion'
                };
              }
              items.push(item);
            }
            return items;
          }
        }

        // 5. Speaker Suggestions (STRICTLY at line start or by slash '/')
        const isLineStart = /^\s*[\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]*$/.test(lineUntilPosition);
        const isSlashTrigger = lineUntilPosition.trim().startsWith('/') || lineUntilPosition.endsWith('/');

        if (!hasSpeakerDelimiter && config.speakers && (isLineStart || isSlashTrigger)) {
          const slashRange = lineUntilPosition.endsWith('/') ? new vscode.Range(position.translate(0, -1), position) : undefined;

          for (let spIdx = 0; spIdx < config.speakers.length; spIdx++) {
            const sp = config.speakers[spIdx];
            const spIndexStr = spIdx.toString().padStart(5, '0');

            const label = `${sp.name}.`;
            const baseItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.User);
            baseItem.insertText = `${sp.name}.`;
            baseItem.detail = `Speaker: ${sp.name}`;
            baseItem.documentation = `Inserts ${sp.name}. and triggers style completion`;

            if (slashRange) {
              baseItem.range = slashRange;
            }

            baseItem.command = {
              command: 'smd.selectSpeakerAndSuggestStyle',
              title: 'Trigger Style Suggestion',
              arguments: [sp.name]
            };

            const rawTerms = Array.from(new Set([sp.name, sp.id, ...(sp.aliases || [])])).sort((a, b) => a.length - b.length);
            let filterTerms: string[];
            if (isSlashTrigger) {
              const slashTerms = rawTerms.map(t => `/${t}`);
              filterTerms = [...slashTerms, ...rawTerms];
            } else {
              filterTerms = rawTerms;
            }

            baseItem.filterText = filterTerms.join(' ');
            baseItem.sortText = `00_${spIndexStr}_0`;
            items.push(baseItem);
          }
        }

        return items;
      }
    },
    '.', '/', "'", '"', '!', '#'
  );

  context.subscriptions.push(provider);
}
