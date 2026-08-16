import * as vscode from 'vscode';
import { ConfigManager } from './config.js';
import { SpeakerUsageTracker } from './usageTracker.js';
import { AudioPlayer } from './audioPlayer.js';

export function registerAgentTools(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
  usageTracker: SpeakerUsageTracker,
  audioPlayer: AudioPlayer
): void {
  const lm = (vscode as any).lm;
  if (!lm || typeof lm.registerTool !== 'function') {
    console.log('VS Code Language Model Tool API is not supported in this version. Skipping agent tools registration.');
    return;
  }

  try {
    // Tool 1: smd-get-speakers
    context.subscriptions.push(
      lm.registerTool('smd-get-speakers', {
        async invoke(options: any, token: vscode.CancellationToken) {
          const config = configManager.getMergedConfig();
          const speakers = config.speakers || [];
          
          const result = speakers.map((sp: any) => ({
            name: sp.name,
            id: sp.id,
            styles: sp.styles || ['ノーマル'],
            aliases: sp.aliases || [],
            usageCount: usageTracker.getUsageCount(sp.name)
          }));

          return new (vscode as any).LanguageModelToolResult([
            new (vscode as any).LanguageModelTextPart(JSON.stringify(result, null, 2))
          ]);
        }
      })
    );

    // Tool 2: smd-validate
    context.subscriptions.push(
      lm.registerTool('smd-validate', {
        async invoke(options: any, token: vscode.CancellationToken) {
          const scriptText = options.input?.scriptText || '';
          const lines = scriptText.split('\n');
          const config = configManager.getMergedConfig();
          const speakers = config.speakers || [];
          const validNames = new Set<string>();

          for (const sp of speakers) {
            validNames.add(sp.name);
            validNames.add(sp.id);
            if (sp.aliases) {
              sp.aliases.forEach((a: string) => validNames.add(a));
            }
          }

          const issues: Array<{ line: number; message: string; severity: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//') || line.startsWith('>') || line.startsWith('#') || line.startsWith('.')) {
              continue;
            }

            const match = line.match(/^([^>\n]+)>(.+)$/);
            if (!match) {
              issues.push({
                line: i + 1,
                message: 'セリフ行の構文が無効です。"話者名> セリフ" の形式で記述してください。',
                severity: 'warning'
              });
              continue;
            }

            const rawSpeakerPart = match[1].trim();
            const speakerName = rawSpeakerPart.split('.')[0].trim();

            if (!validNames.has(speakerName)) {
              issues.push({
                line: i + 1,
                message: `未定義の話し手 "${speakerName}" が検出されました。presets.json に登録されている話者名を使用してください。`,
                severity: 'error'
              });
            }
          }

          return new (vscode as any).LanguageModelToolResult([
            new (vscode as any).LanguageModelTextPart(JSON.stringify({
              isValid: issues.length === 0,
              totalIssues: issues.length,
              issues
            }, null, 2))
          ]);
        }
      })
    );

    // Tool 3: smd-play-preview
    context.subscriptions.push(
      lm.registerTool('smd-play-preview', {
        async invoke(options: any, token: vscode.CancellationToken) {
          const audioPath = options.input?.audioPath || '';
          if (!audioPath) {
            return new (vscode as any).LanguageModelToolResult([
              new (vscode as any).LanguageModelTextPart('Error: audioPath parameter is required.')
            ]);
          }

          const resolved = audioPlayer.resolvePath(audioPath);
          if (resolved) {
            audioPlayer.playDirect(resolved);
            return new (vscode as any).LanguageModelToolResult([
              new (vscode as any).LanguageModelTextPart(`Playing audio preview for: ${audioPath}`)
            ]);
          } else {
            return new (vscode as any).LanguageModelToolResult([
              new (vscode as any).LanguageModelTextPart(`Error: Audio file not found at path: ${audioPath}`)
            ]);
          }
        }
      })
    );

    console.log('Successfully registered ScriptMarkDown LM Agent Tools (smd-get-speakers, smd-validate, smd-play-preview).');
  } catch (err) {
    console.error('Failed to register LM Agent Tools:', err);
  }
}
