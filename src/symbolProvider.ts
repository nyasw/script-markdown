import * as vscode from 'vscode';

export class SMDDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  public provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const rootSymbols: vscode.DocumentSymbol[] = [];
    const lineCount = document.lineCount;

    interface StackItem {
      level: number;
      symbol: vscode.DocumentSymbol;
    }

    const stack: StackItem[] = [];

    for (let i = 0; i < lineCount; i++) {
      const lineText = document.lineAt(i).text;
      const headingMatch = lineText.match(/^\s*(#{1,6})\s+(.*)$/);

      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim() || `Heading ${level}`;

        const startPos = new vscode.Position(i, 0);
        const endPos = new vscode.Position(i, lineText.length);
        const selectionRange = new vscode.Range(startPos, endPos);

        // Placeholder range until we know where this section ends
        const symbolRange = new vscode.Range(startPos, new vscode.Position(lineCount - 1, document.lineAt(lineCount - 1).text.length));

        const symbol = new vscode.DocumentSymbol(
          headingText,
          `H${level}`,
          vscode.SymbolKind.String,
          symbolRange,
          selectionRange
        );

        // Pop stack items that are at the same or deeper level
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          const popped = stack.pop()!;
          // Adjust popped symbol range to end right before current heading
          const poppedStartLine = popped.symbol.range.start.line;
          const poppedEndLine = Math.max(poppedStartLine, i - 1);
          const lastLineText = document.lineAt(poppedEndLine).text;
          popped.symbol.range = new vscode.Range(
            popped.symbol.range.start,
            new vscode.Position(poppedEndLine, lastLineText.length)
          );
        }

        if (stack.length === 0) {
          rootSymbols.push(symbol);
        } else {
          stack[stack.length - 1].symbol.children.push(symbol);
        }

        stack.push({ level, symbol });
      }
    }

    // Adjust ranges for remaining items in stack until end of document
    while (stack.length > 0) {
      const popped = stack.pop()!;
      const poppedStartLine = popped.symbol.range.start.line;
      const poppedEndLine = lineCount - 1;
      const lastLineText = document.lineAt(poppedEndLine).text;
      popped.symbol.range = new vscode.Range(
        popped.symbol.range.start,
        new vscode.Position(poppedEndLine, lastLineText.length)
      );
    }

    return rootSymbols;
  }
}

export function registerDocumentSymbolProvider(context: vscode.ExtensionContext): void {
  const provider = new SMDDocumentSymbolProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider('script-markdown', provider)
  );
}
