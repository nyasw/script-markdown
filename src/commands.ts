import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './config.js';
import { SpeakerUsageTracker } from './usageTracker.js';
import { VoicevoxEngineClient } from './voicevoxEngine.js';
import { SmdParser, ParsedLineVoiceParams } from './smdParser.js';
import { AudioPlayer } from './audioPlayer.js';
import { CatalogExporter } from './catalogExporter.js';

import { SMDStatusBarManager } from './statusBar.js';

// Helper to create playing decoration type (vivid & prominent)
function getPlayingDecorationType(): vscode.TextEditorDecorationType {
  const config = vscode.workspace.getConfiguration('smd');
  const color = config.get<string>('playingHighlightColor', 'rgba(46, 204, 113, 0.45)');
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: color,
    borderWidth: '0 0 0 5px',
    borderColor: '#2ecc71',
    borderStyle: 'solid',
    isWholeLine: true,
    overviewRulerColor: '#2ecc71',
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });
}

// Helper to create synthesizing decoration type (subtle & discrete)
function getSynthesizingDecorationType(): vscode.TextEditorDecorationType {
  const config = vscode.workspace.getConfiguration('smd');
  const color = config.get<string>('synthesizingHighlightColor', 'rgba(150, 150, 150, 0.12)');
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: color,
    borderWidth: '0 0 0 3px',
    borderColor: 'rgba(150, 150, 150, 0.35)',
    borderStyle: 'solid',
    isWholeLine: true,
    overviewRulerColor: 'rgba(150, 150, 150, 0.35)',
    overviewRulerLane: vscode.OverviewRulerLane.Left
  });
}

let playingLineDecorationType = getPlayingDecorationType();
let synthesizingLineDecorationType = getSynthesizingDecorationType();

let globalPlaybackRunId = 0;

export function registerCommands(
  context: vscode.ExtensionContext, 
  configManager: ConfigManager,
  usageTracker: SpeakerUsageTracker,
  engineClient?: VoicevoxEngineClient,
  audioPlayer?: AudioPlayer,
  statusBarManager?: SMDStatusBarManager
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('smd.playingHighlightColor') || e.affectsConfiguration('smd.synthesizingHighlightColor')) {
        playingLineDecorationType.dispose();
        synthesizingLineDecorationType.dispose();
        playingLineDecorationType = getPlayingDecorationType();
        synthesizingLineDecorationType = getSynthesizingDecorationType();
      }
    })
  );
  const insertSpeaker = async (numKey: string) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const config = configManager.getMergedConfig();
    let targetText = config.shortcuts?.[numKey];
    if (!targetText) {
      vscode.window.showWarningMessage(`No speaker shortcut defined for key ${numKey}`);
      return;
    }

    if (!targetText.endsWith(' ')) {
      targetText += ' ';
    }

    const speakerName = targetText.split('.')[0].replace('>', '').trim();
    if (speakerName) {
      usageTracker.recordUsage(speakerName);
    }

    await editor.edit(editBuilder => {
      for (const selection of editor.selections) {
        const line = editor.document.lineAt(selection.start.line);
        const lineText = line.text;
        const match = lineText.match(/^([^>\n]+>\s*)/);

        if (match) {
          const range = new vscode.Range(
            new vscode.Position(selection.start.line, 0),
            new vscode.Position(selection.start.line, match[0].length)
          );
          editBuilder.replace(range, targetText);
        } else {
          editBuilder.insert(new vscode.Position(selection.start.line, 0), targetText);
        }
      }
    });
  };

  for (let i = 1; i <= 9; i++) {
    const numKey = i.toString();
    context.subscriptions.push(
      vscode.commands.registerCommand(`smd.insertSpeaker${numKey}`, () => insertSpeaker(numKey))
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('smd.recordUsage', (speakerName: string) => {
      if (speakerName) {
        usageTracker.recordUsage(speakerName);
      }
    })
  );

  // Command: Play current line on Shift+Enter (Supports dialogue, .se, and .bgm lines with quotes inside)
  context.subscriptions.push(
    vscode.commands.registerCommand('smd.playCurrentLineVoice', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !engineClient || !audioPlayer) {
        return;
      }

      const position = editor.selection.active;
      const lineText = editor.document.lineAt(position.line).text.trim();

      const smdParser = engineClient.getSmdParser();
      const documentPresets = smdParser.parseDocumentPresets(editor.document, position.line);

      // 1. Dialogue or Telop line (Top priority for lines containing '>')
      if (lineText.includes('>') && !lineText.startsWith('.')) {
        const parsed = smdParser.parseLineForVoice(lineText, documentPresets);
        if (parsed) {
          if (parsed.isTelop) {
            statusBarManager?.showPlaying('テロップ');
            editor.setDecorations(playingLineDecorationType, [editor.document.lineAt(position.line).range]);
            setTimeout(() => {
              editor.setDecorations(playingLineDecorationType, []);
              statusBarManager?.clear();
            }, 1000);
            return;
          }

          editor.setDecorations(synthesizingLineDecorationType, [editor.document.lineAt(position.line).range]);

          const tempWavPath = await engineClient.synthesizeToWavPath(parsed);
          editor.setDecorations(synthesizingLineDecorationType, []);

          if (tempWavPath) {
            statusBarManager?.showPlaying(parsed.speakerNameOrAlias);
            editor.setDecorations(playingLineDecorationType, [editor.document.lineAt(position.line).range]);

            audioPlayer.playDirect(tempWavPath);

            if (parsed.sePath) {
              const resolvedSe = audioPlayer.resolvePath(parsed.sePath, 'se', documentPresets);
              if (resolvedSe) {
                const seVolume = parsed.seVol !== undefined ? parsed.seVol : 1.0;
                audioPlayer.playDirectParallel(resolvedSe, seVolume);
              }
            }

            // Keep playing highlight for a moment
            setTimeout(() => {
              editor.setDecorations(playingLineDecorationType, []);
              statusBarManager?.clear();
            }, 1200);
          } else {
            statusBarManager?.clear();
            engineClient.notifyConnectionFailure();
          }
          return;
        }
      }

      // 2. Pure .se('...') line
      const seMatch = lineText.match(/\.se\(\s*(["'])(.*?)\1(?:\s*,\s*([0-9.]+))?\s*\)/);
      if (lineText.startsWith('.se(') && seMatch) {
        const rawPath = seMatch[2];
        const resolvedSe = audioPlayer.resolvePath(rawPath, 'se', documentPresets);
        if (resolvedSe) {
          const vol = seMatch[3] ? parseFloat(seMatch[3]) : 1.0;
          audioPlayer.playDirectParallel(resolvedSe, vol);
          return;
        } else {
          vscode.window.showWarningMessage(`SEファイルが見つかりません: ${rawPath}`);
          return;
        }
      }

      // 3. Pure .bgm('...') line
      const bgmMatch = lineText.match(/\.bgm\(\s*(["']?)(.*?)\1(?:\s*,\s*([0-9.]+))?\s*\)/);
      if (lineText.startsWith('.bgm(') && bgmMatch) {
        const rawPath = bgmMatch[2].trim();
        const volume = bgmMatch[3] ? parseFloat(bgmMatch[3]) : 1.0;
        const resolvedBgm = audioPlayer.resolvePath(rawPath, 'bgm', documentPresets);
        if (resolvedBgm) {
          audioPlayer.playBgm(resolvedBgm, volume);
          return;
        } else if (rawPath) {
          vscode.window.showWarningMessage(`BGMファイルが見つかりません: ${rawPath}`);
          return;
        }
      }

      // 4. Standalone .bgmVol or preset.*.bgmVol line
      if (lineText.includes('bgmVol') || lineText.includes('bgm_vol')) {
        const volMatch = lineText.match(/\.(?:bgmVol|bgm_vol)\(\s*([0-9.]+)\s*\)/i);
        if (volMatch) {
          const vol = parseFloat(volMatch[1]);
          audioPlayer.setBgmMasterVolume(vol);
          vscode.window.showInformationMessage(`BGMマスター音量を ${vol} に設定しました。`);
          return;
        }
      }

      // 5. Standalone .seVol or preset.*.seVol line
      if (lineText.includes('seVol') || lineText.includes('se_vol')) {
        const volMatch = lineText.match(/\.(?:seVol|se_vol)\(\s*([0-9.]+)\s*\)/i);
        if (volMatch) {
          const vol = parseFloat(volMatch[1]);
          audioPlayer.setSeMasterVolume(vol);
          vscode.window.showInformationMessage(`SEマスター音量を ${vol} に設定しました。`);
          return;
        }
      }

      vscode.window.showInformationMessage('カーソル行が再生可能なセリフ・SE・BGM行ではありません。');
    })
  );

  // Command: Continuous playback with PIPELINE PRE-SYNTHESIS 3-lines lookahead & INSTANT RESET PROTECTION
  context.subscriptions.push(
    vscode.commands.registerCommand('smd.playScriptFromCurrentLine', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !engineClient || !audioPlayer) {
        return;
      }

      // 1. Instant Reset & Run Lock: Increment session ID and kill previous running tasks
      const thisRunId = ++globalPlaybackRunId;
      audioPlayer.cancel();
      editor.setDecorations(playingLineDecorationType, []);
      editor.setDecorations(synthesizingLineDecorationType, []);
      await new Promise(r => setTimeout(r, 100)); // Pause to let preceding loop exit gracefully

      if (thisRunId !== globalPlaybackRunId) {
        return; // Preempted by a newer play command run
      }

      // 2. Reset clean state for new playback run
      audioPlayer.resetCancelState();
      audioPlayer.setIsPlayingScript(true);

      const document = editor.document;
      const selection = editor.selection;
      
      const isRangeSelected = !selection.isEmpty && selection.start.line !== selection.end.line;
      const startLine = selection.start.line;
      const endLine = isRangeSelected ? selection.end.line : document.lineCount - 1;

      // Pre-synthesis Promise cache map & ready synth lines set for visual highlights
      const preSynthesizedMap = new Map<number, Promise<string | null>>();
      const readySynthesizedLines = new Set<number>();
      let currentPlayingLineIdx = -1;
      let hasNotifiedSynthesisFailure = false;

      const updatePreSynthDecorations = () => {
        const ranges: vscode.Range[] = [];
        for (const lineIdx of readySynthesizedLines) {
          if (lineIdx > currentPlayingLineIdx) {
            ranges.push(document.lineAt(lineIdx).range);
          }
        }
        editor.setDecorations(synthesizingLineDecorationType, ranges);
      };

      // Helper function to check and apply BGM/SE volume directives in line.
      // .volume() is the speaker/voice volume method exclusively; BGM only responds to
      // bgmVol()/bgm_vol() and SE only to seVol()/se_vol() — never the bare .vol()/.volume()
      // alias, since dialogue and .se()/.bgm() are commonly chained on the same line.
      const checkAndApplyVolumeDirectives = (textStr: string) => {
        const bgmVolMatch = textStr.match(/\.(?:bgmVol|bgm_vol)\(\s*([0-9.]+)\s*\)/i);
        if (bgmVolMatch) {
          audioPlayer.setBgmMasterVolume(parseFloat(bgmVolMatch[1]));
        }

        const seVolMatch = textStr.match(/\.(?:seVol|se_vol)\(\s*([0-9.]+)\s*\)/i);
        if (seVolMatch) {
          audioPlayer.setSeMasterVolume(parseFloat(seVolMatch[1]));
        }
      };

      // Evaluate initial document preset BGM/SE volume once at startLine
      // (preset.all is included since .bgmVol()/.seVol() are also valid there, not just on preset.bgm/preset.se)
      for (let i = 0; i <= startLine; i++) {
        const lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('preset.bgm') || lineText.startsWith('preset.se') || lineText.startsWith('preset.all')) {
          checkAndApplyVolumeDirectives(lineText);
        }
      }

      // Helper function to execute wait if present in text
      const executeWaitIfAny = async (textStr: string) => {
        const waitMatch = textStr.match(/\.?wait\s*[\(（]\s*([0-9.]+)\s*(s|sec|ms)?\s*[\)）]/i);
        if (waitMatch) {
          let sec = parseFloat(waitMatch[1]);
          const unit = waitMatch[2] ? waitMatch[2].toLowerCase() : 's';
          if (unit === 'ms') {
            sec = sec / 1000;
          }
          const waitMs = Math.min(Math.max(sec * 1000, 50), 60000);
          statusBarManager?.showPlaying(`Wait (${sec}s)`);
          let elapsed = 0;
          while (elapsed < waitMs && !audioPlayer.getCancelled() && thisRunId === globalPlaybackRunId) {
            await new Promise(r => setTimeout(r, 50));
            elapsed += 50;
          }
        }
      };

      const smdParser = engineClient.getSmdParser();
      const parsedDoc = smdParser.parseFullDocument(document);
      const parsedDocMap = new Map(parsedDoc.map(item => [item.lineIdx, item]));

      // Helper function to trigger pre-synthesis for a line if it's a dialogue line
      const triggerPreSynthesis = (lineIdx: number): boolean => {
        if (lineIdx > endLine || audioPlayer.getCancelled()) {
          return false;
        }
        const item = parsedDocMap.get(lineIdx);
        if (item && !item.isComment && item.parsedVoice && !item.isTelop) {
          if (!preSynthesizedMap.has(lineIdx)) {
            const promise = engineClient.synthesizeToWavPath(item.parsedVoice).then((wavPath) => {
              if (wavPath && !audioPlayer.getCancelled()) {
                readySynthesizedLines.add(lineIdx);
                updatePreSynthDecorations();
              }
              return wavPath;
            });
            preSynthesizedMap.set(lineIdx, promise);
          }
          return true;
        }
        return false;
      };

      // Always pre-trigger the first 3 dialogue lines immediately!
      let preSynthesizedCount = 0;
      for (let i = startLine; i <= endLine && preSynthesizedCount < 3; i++) {
        if (triggerPreSynthesis(i)) {
          preSynthesizedCount++;
        }
      }

      try {
        for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
          if (thisRunId !== globalPlaybackRunId || audioPlayer.getCancelled()) {
            break;
          }

          currentPlayingLineIdx = lineIdx;
          readySynthesizedLines.delete(lineIdx);

          const item = parsedDocMap.get(lineIdx);
          if (!item || item.isComment) {
            continue; // Completely skip block comments and line comments!
          }

          const currentDocPresets = item.docPresets;
          if (currentDocPresets.bgmPreset.bgmVol !== undefined) {
            audioPlayer.setBgmMasterVolume(currentDocPresets.bgmPreset.bgmVol);
          }
          if (currentDocPresets.sePreset.seVol !== undefined) {
            audioPlayer.setSeMasterVolume(currentDocPresets.sePreset.seVol);
          }

          // Maintain 3-lines lookahead pre-synthesis buffer ahead of current line
          let lookAheadCount = 0;
          for (let lookAheadIdx = lineIdx + 1; lookAheadIdx <= endLine && lookAheadCount < 3; lookAheadIdx++) {
            if (triggerPreSynthesis(lookAheadIdx)) {
              lookAheadCount++;
            }
          }

          updatePreSynthDecorations();

          const line = document.lineAt(lineIdx);
          editor.setDecorations(playingLineDecorationType, [line.range]);
          editor.revealRange(line.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

          // 1. Telop line
          if (item.isTelop) {
            statusBarManager?.showPlaying('テロップ');
            if (item.parsedVoice?.wait && item.parsedVoice.wait > 0) {
              await executeWaitIfAny(item.rawLine);
            } else {
              await new Promise(r => setTimeout(r, 200));
            }
            continue;
          }

          // 2. Dialogue line (Uses 3-lines pre-synthesized WAV buffer)
          if (item.parsedVoice) {
            const parsed = item.parsedVoice;
            let wavPromise = preSynthesizedMap.get(lineIdx);
            if (!wavPromise) {
              statusBarManager?.showSynthesizing(parsed.speakerNameOrAlias);
              wavPromise = engineClient.synthesizeToWavPath(parsed);
            }

            const tempWavPath = await wavPromise;
            updatePreSynthDecorations();
            if (audioPlayer.getCancelled()) break;

            if (tempWavPath) {
              statusBarManager?.showPlaying(parsed.speakerNameOrAlias);
              editor.setDecorations(playingLineDecorationType, [line.range]);

              const promises: Promise<void>[] = [];
              promises.push(audioPlayer.playDirectPromise(tempWavPath));

              if (parsed.sePath) {
                const resolvedSe = audioPlayer.resolvePath(parsed.sePath, 'se', currentDocPresets);
                if (resolvedSe) {
                  const seVolume = parsed.seVol !== undefined ? parsed.seVol : 1.0;
                  promises.push(audioPlayer.playDirectPromiseParallel(resolvedSe, seVolume));
                }
              }

              await Promise.all(promises);

              if (parsed.wait && parsed.wait > 0) {
                const waitMs = Math.min(Math.max(parsed.wait * 1000, 50), 60000);
                let elapsed = 0;
                while (elapsed < waitMs && !audioPlayer.getCancelled() && thisRunId === globalPlaybackRunId) {
                  await new Promise(r => setTimeout(r, 50));
                  elapsed += 50;
                }
              }
            } else {
              // Synthesis failed (e.g. VOICEVOX Engine unreachable). Notify once per playback
              // session instead of silently skipping every remaining dialogue line, and stop
              // the run since further lines will fail for the same reason.
              statusBarManager?.clear();
              if (!hasNotifiedSynthesisFailure) {
                hasNotifiedSynthesisFailure = true;
                engineClient.notifyConnectionFailure();
              }
              break;
            }
            continue;
          }

          // 3. Standalone directives (.se, .bgm, .wait)
          const text = item.cleanedLine.trim();
          if (text.includes('.se(')) {
            checkAndApplyVolumeDirectives(text);
            const seMatch = text.match(/\.se\(\s*(["']?)(.*?)\1(?:\s*,\s*([0-9.]+))?\s*\)/);
            if (seMatch) {
              const rawPath = seMatch[2].trim();
              let vol = seMatch[3] ? parseFloat(seMatch[3]) : 1.0;
              const inlineVolMatch = text.match(/\.(?:seVol|se_vol)\(\s*([0-9.]+)\s*\)/i);
              if (inlineVolMatch) {
                vol = parseFloat(inlineVolMatch[1]);
              }
              const resolvedSe = audioPlayer.resolvePath(rawPath, 'se', currentDocPresets);
              if (resolvedSe) {
                statusBarManager?.showPlaying('SE');
                await audioPlayer.playDirectPromiseParallel(resolvedSe, vol);
              } else if (rawPath) {
                vscode.window.showWarningMessage(`SEファイルが見つかりません: ${rawPath}`);
              }
            }
            await executeWaitIfAny(text);
          }
          // 3. Pure or chained .bgm(...) line
          else if (text.includes('.bgm(')) {
            checkAndApplyVolumeDirectives(text);
            const bgmMatch = text.match(/\.bgm\(\s*(["']?)(.*?)\1(?:\s*,\s*([0-9.]+))?\s*\)/);
            if (bgmMatch) {
              const rawPath = bgmMatch[2].trim();
              let volume = bgmMatch[3] ? parseFloat(bgmMatch[3]) : 1.0;
              const inlineVolMatch = text.match(/\.(?:bgmVol|bgm_vol)\(\s*([0-9.]+)\s*\)/i);
              if (inlineVolMatch) {
                volume = parseFloat(inlineVolMatch[1]);
              }

              if (!rawPath) {
                // Empty path: .bgm('') or .bgm() -> Stop BGM!
                audioPlayer.stopBgm();
              } else {
                const resolvedBgm = audioPlayer.resolvePath(rawPath, 'bgm', currentDocPresets);
                if (resolvedBgm) {
                  audioPlayer.playBgm(resolvedBgm, volume);
                  await new Promise(r => setTimeout(r, 100));
                } else {
                  vscode.window.showWarningMessage(`BGMファイルが見つかりません: ${rawPath}`);
                }
              }
            }
            await executeWaitIfAny(text);
          }
          // 4. Pure .wait(...) line
          else if (text.startsWith('.wait(') || text.match(/^\.?wait\s*[\(（]/i)) {
            await executeWaitIfAny(text);
          }
          // 5. Standalone or preset volume directive line (.bgmVol, .seVol, preset.bgm.vol, etc.)
          else if (text.includes('bgmVol') || text.includes('bgm_vol') || text.includes('seVol') || text.includes('se_vol') || text.includes('preset.bgm') || text.includes('preset.se')) {
            checkAndApplyVolumeDirectives(text);
            await executeWaitIfAny(text);
          }
        }
      } finally {
        audioPlayer.setIsPlayingScript(false);
        editor.setDecorations(synthesizingLineDecorationType, []);
        editor.setDecorations(playingLineDecorationType, []);
        audioPlayer.stopBgm();
        preSynthesizedMap.clear();
        statusBarManager?.clear();
      }
    }),
    vscode.commands.registerCommand('smd.toggleSpeakerIcons', async () => {
      const config = vscode.workspace.getConfiguration('smd');
      const current = config.get<boolean>('showSpeakerIcons', true);
      const updated = !current;
      await config.update('showSpeakerIcons', updated, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }),
    vscode.commands.registerCommand('smd.bakeAndCopyText', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !engineClient) {
        vscode.window.showWarningMessage('アクティブなエディタまたは音声エンジンクライアントが見つかりません。');
        return;
      }

      const selection = editor.selection;
      const hasSelection = !selection.isEmpty;
      const startLine = hasSelection ? selection.start.line : 0;
      const endLine = hasSelection ? selection.end.line : editor.document.lineCount - 1;

      const smdParser = engineClient.getSmdParser();
      const bakedText = smdParser.bakeDocument(editor.document, startLine, endLine, { preserveRuby: true });
      await vscode.env.clipboard.writeText(bakedText);

      const msg = hasSelection
        ? `選択範囲 (${startLine + 1}〜${endLine + 1} 行目) のベイク済みSMDテキストをクリップボードにコピーしました！`
        : 'プリセットとスコープをベイクしたSMDテキスト（全体）をクリップボードにコピーしました！';
      vscode.window.showInformationMessage(msg);
    }),
    vscode.commands.registerCommand('smd.exportToVoicevoxTxt', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !engineClient) {
        vscode.window.showWarningMessage('アクティブなエディタまたは音声エンジンクライアントが見つかりません。');
        return;
      }

      const smdParser = engineClient.getSmdParser();
      const txtContent = smdParser.exportToVoicevoxTxt(editor.document);

      if (!txtContent.trim()) {
        vscode.window.showWarningMessage('エクスポート可能なセリフ行が見つかりませんでした。');
        return;
      }

      let defaultUri: vscode.Uri | undefined;
      const currentFilePath = editor.document.uri.fsPath;
      if (currentFilePath) {
        const dir = path.dirname(currentFilePath);
        const baseName = path.basename(currentFilePath, path.extname(currentFilePath));
        defaultUri = vscode.Uri.file(path.join(dir, `${baseName}.txt`));
      }

      const targetUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'VOICEVOX Text File': ['txt'], 'All Files': ['*'] },
        title: 'VOICEVOX用テキストファイル (.txt) へエクスポート'
      });

      if (!targetUri) {
        return;
      }

      fs.writeFileSync(targetUri.fsPath, txtContent, 'utf8');
      const doc = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`VOICEVOX用テキストファイル (.txt) にエクスポートしました！: ${path.basename(targetUri.fsPath)}`);
    }),
    vscode.commands.registerCommand('smd.setupWorkspaceSettings', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('ワークスペースフォルダーが開かれていません。');
        return;
      }

      const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
      const settingsPath = path.join(vscodeDir, 'settings.json');

      if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
      }

      let settingsJson: any = {};
      if (fs.existsSync(settingsPath)) {
        try {
          const raw = fs.readFileSync(settingsPath, 'utf8');
          settingsJson = JSON.parse(raw);
        } catch (e) {
          // ignore parse errors
        }
      }

      if (!settingsJson['smd.shortcuts']) {
        settingsJson['smd.shortcuts'] = {
          "1": "四国めたん> ",
          "2": "ずんだもん> "
        };
      }

      if (!settingsJson['smd.speakers']) {
        settingsJson['smd.speakers'] = [
          {
            id: "custom_speaker_example",
            name: "オリジナルキャラ",
            aliases: ["オリジナルキャラ", "オリキャラ"],
            styles: ["ノーマル"],
            styleIds: [0],
            defaultStyle: "ノーマル",
            color: "#ff007f"
          }
        ];
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settingsJson, null, 2), 'utf8');
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(settingsPath));
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('ワークスペース設定 (.vscode/settings.json) に ScriptMarkDown 設定を作成・追加しました！');
    }),
    vscode.commands.registerCommand('smd.exportAvailableParams', async () => {
      const exporter = new CatalogExporter(configManager);
      await exporter.exportCatalogYaml();
    })
  );
}
