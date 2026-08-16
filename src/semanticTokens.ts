import * as vscode from 'vscode';
import { ConfigManager } from './config.js';

// Standard token types recognized by VS Code color themes without white-out:
// Index 0: 'type' (Green / Emerald / Blue in standard themes)
// Index 1: 'keyword' (Purple / Magenta / Red in standard themes)
// Index 2: 'number' (Yellow / Orange / Gold in standard themes - keeps yellow for Tsumugi!)
// Index 3: 'string' (Brown / Red / Orange in standard themes)
// Index 4: 'function' (Yellow / Gold / Cyan in standard themes)
const tokenTypes = ['type', 'keyword', 'number', 'string', 'function'];
const tokenModifiers = ['declaration', 'definition'];
export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

export function registerSemanticTokensProvider(context: vscode.ExtensionContext, configManager: ConfigManager): void {
  const provider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
      const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
      const text = document.getText();
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || /^\s*>/.test(line) || /^\s*#/.test(line) || /^\s*\./.test(line)) {
          continue;
        }

        const match = line.match(/^([^>\n]+)(>)/);
        if (match) {
          const rawSpeakerPart = match[1];
          const speakerName = rawSpeakerPart.split('.')[0].trim();
          let typeIndex = 4; // 'function' (default speaker color)

          if (speakerName === 'ずんだもん' || speakerName === 'zunda' || speakerName.includes('ずんだ')) {
            typeIndex = 0; // 'type' (Zundamon: Green/Cyan)
          } else if (speakerName === '四国めたん' || speakerName === 'metan' || speakerName.includes('めたん')) {
            typeIndex = 1; // 'keyword' (Shikoku Metan: Red/Purple)
          } else if (speakerName === '春日部つむぎ' || speakerName === 'tsumugi' || speakerName.includes('つむぎ')) {
            typeIndex = 2; // 'number' (Kasukabe Tsumugi: Vibrant Yellow/Gold!)
          } else {
            let hash = 0;
            for (let c = 0; c < speakerName.length; c++) {
              hash = (hash + speakerName.charCodeAt(c)) % tokenTypes.length;
            }
            typeIndex = hash;
          }

          const startChar = line.indexOf(rawSpeakerPart);
          if (startChar !== -1) {
            tokensBuilder.push(i, startChar, rawSpeakerPart.length, typeIndex, 0);
          }
        }
      }

      return tokensBuilder.build();
    }
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: 'script-markdown' },
      provider,
      legend
    )
  );
}
