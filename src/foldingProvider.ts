import * as vscode from 'vscode';

export class SMDFoldingRangeProvider implements vscode.FoldingRangeProvider {
  public provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    const foldingRanges: vscode.FoldingRange[] = [];
    const lineCount = document.lineCount;

    interface HeadingInfo {
      level: number;
      line: number;
    }

    const headingStack: HeadingInfo[] = [];

    for (let i = 0; i < lineCount; i++) {
      const lineText = document.lineAt(i).text;
      const headingMatch = lineText.match(/^\s*(#{1,6})\s+(.*)$/);

      if (headingMatch) {
        const level = headingMatch[1].length;

        // Close all previous headings in the stack that have a level >= current level
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          const top = headingStack.pop()!;
          const endLine = i - 1;
          if (endLine > top.line) {
            foldingRanges.push(new vscode.FoldingRange(top.line, endLine, vscode.FoldingRangeKind.Region));
          }
        }

        headingStack.push({ level, line: i });
      }
    }

    // Close any remaining open headings until end of file
    while (headingStack.length > 0) {
      const top = headingStack.pop()!;
      const endLine = lineCount - 1;
      if (endLine > top.line) {
        foldingRanges.push(new vscode.FoldingRange(top.line, endLine, vscode.FoldingRangeKind.Region));
      }
    }

    return foldingRanges;
  }
}

export function registerFoldingProvider(context: vscode.ExtensionContext): void {
  const provider = new SMDFoldingRangeProvider();
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider('script-markdown', provider)
  );
}
