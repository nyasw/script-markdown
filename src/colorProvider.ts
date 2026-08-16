import * as vscode from 'vscode';

export function registerDocumentColorProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentColorProvider = {
    provideDocumentColors(document: vscode.TextDocument): vscode.ProviderResult<vscode.ColorInformation[]> {
      if (document.languageId !== 'script-markdown') {
        return [];
      }

      const colors: vscode.ColorInformation[] = [];
      const text = document.getText();
      // Match .color(#ffffff) or .color(#fff) or inline hex colors after .color(
      const regex = /\.color\(\s*(#[0-9a-fA-F]{3,8})\s*\)/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const hexStr = match[1];
        const hexStartPos = match.index + match[0].indexOf(hexStr);
        const startPos = document.positionAt(hexStartPos);
        const endPos = document.positionAt(hexStartPos + hexStr.length);
        const range = new vscode.Range(startPos, endPos);

        const parsedColor = parseHexColor(hexStr);
        if (parsedColor) {
          colors.push(new vscode.ColorInformation(range, parsedColor));
        }
      }

      return colors;
    },

    provideColorPresentations(color: vscode.Color): vscode.ProviderResult<vscode.ColorPresentation[]> {
      const r = Math.round(color.red * 255).toString(16).padStart(2, '0');
      const g = Math.round(color.green * 255).toString(16).padStart(2, '0');
      const b = Math.round(color.blue * 255).toString(16).padStart(2, '0');
      
      let hex = `#${r}${g}${b}`;
      if (color.alpha < 1) {
        const a = Math.round(color.alpha * 255).toString(16).padStart(2, '0');
        hex += a;
      }

      const presentation = new vscode.ColorPresentation(hex);
      return [presentation];
    }
  };

  context.subscriptions.push(
    vscode.languages.registerColorProvider(
      { language: 'script-markdown' },
      provider
    )
  );
}

function parseHexColor(hex: string): vscode.Color | null {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }

  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return new vscode.Color(r, g, b, 1);
  } else if (hex.length === 8) {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = parseInt(hex.substring(6, 8), 16) / 255;
    return new vscode.Color(r, g, b, a);
  }

  return null;
}
