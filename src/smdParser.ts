import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './config.js';
import { SE_DIRECTIVE_MATCH_REGEX } from './directiveRegex.js';

export interface ParsedLineVoiceParams {
  speakerNameOrAlias: string;
  styleName?: string;
  text: string;
  isTelop?: boolean;
  speed?: number;
  pitch?: number;
  intonation?: number;
  volume?: number;
  pauseLength?: number;
  preSilence?: number;
  postSilence?: number;
  wait?: number;
  sePath?: string;
  font?: string;
  tatie?: string;
  size?: number | string;
  color?: string;
  bgm?: string;
  bgmVol?: number;
  seVol?: number;
}

export interface PresetParams {
  speed?: number;
  pitch?: number;
  intonation?: number;
  volume?: number;
  font?: string;
  tatie?: string;
  size?: number | string;
  color?: string;
  bgm?: string;
  bgmVol?: number;
  seVol?: number;
  pauseLength?: number;
  preSilence?: number;
  postSilence?: number;
  wait?: number;
  seDir?: string;
  bgmDir?: string;
  tatieDir?: string;
}

export interface DocumentPresets {
  globalPreset: PresetParams;
  speakerPresets: Map<string, PresetParams>;
  bgmPreset: PresetParams;
  sePreset: PresetParams;
  tatiePreset: PresetParams;
}

export interface ParsedDocumentLine {
  lineIdx: number;
  rawLine: string;
  cleanedLine: string;
  isComment: boolean;
  isHeader: boolean;
  isPreset: boolean;
  isDirective: boolean;
  isTelop: boolean;
  parsedVoice?: ParsedLineVoiceParams | null;
  docPresets: DocumentPresets;
}

export class SmdParser {
  constructor(private configManager: ConfigManager) {}

  /**
   * Helper to parse chained parameter methods from a string fragment:
   * e.g. ".speed(1.2).pitch(0.05).pause_length(1.5).font("Noto").tatie("A")"
   */
  public parseChainedMethods(fragment: string): { params: PresetParams; cleanedFragment: string } {
    const params: PresetParams = {};
    let cleanedFragment = fragment;

    const speedMatch = cleanedFragment.match(/\.speed\(\s*([0-9.]+)\s*\)/i);
    if (speedMatch) {
      params.speed = parseFloat(speedMatch[1]);
      cleanedFragment = cleanedFragment.replace(speedMatch[0], '');
    }

    const pitchMatch = cleanedFragment.match(/\.pitch\(\s*([0-9.-]+)\s*\)/i);
    if (pitchMatch) {
      params.pitch = parseFloat(pitchMatch[1]);
      cleanedFragment = cleanedFragment.replace(pitchMatch[0], '');
    }

    const intonationMatch = cleanedFragment.match(/\.intonation\(\s*([0-9.]+)\s*\)/i);
    if (intonationMatch) {
      params.intonation = parseFloat(intonationMatch[1]);
      cleanedFragment = cleanedFragment.replace(intonationMatch[0], '');
    }

    const volumeMatch = cleanedFragment.match(/\.volume\(\s*([0-9.]+)\s*\)/i);
    if (volumeMatch) {
      params.volume = parseFloat(volumeMatch[1]);
      cleanedFragment = cleanedFragment.replace(volumeMatch[0], '');
    }

    const pauseLengthMatch = cleanedFragment.match(/\.(?:pause_length|pauselength)\(\s*([0-9.]+)\s*\)/i);
    if (pauseLengthMatch) {
      params.pauseLength = parseFloat(pauseLengthMatch[1]);
      cleanedFragment = cleanedFragment.replace(pauseLengthMatch[0], '');
    }

    const preSilenceMatch = cleanedFragment.match(/\.(?:pre_silence|presilence)\(\s*([0-9.]+)\s*\)/i);
    if (preSilenceMatch) {
      params.preSilence = parseFloat(preSilenceMatch[1]);
      cleanedFragment = cleanedFragment.replace(preSilenceMatch[0], '');
    }

    const postSilenceMatch = cleanedFragment.match(/\.(?:post_silence|postsilence)\(\s*([0-9.]+)\s*\)/i);
    if (postSilenceMatch) {
      params.postSilence = parseFloat(postSilenceMatch[1]);
      cleanedFragment = cleanedFragment.replace(postSilenceMatch[0], '');
    }

    const fontMatch = cleanedFragment.match(/\.font\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (fontMatch) {
      params.font = fontMatch[2];
      cleanedFragment = cleanedFragment.replace(fontMatch[0], '');
    }

    const tatieMatch = cleanedFragment.match(/\.tatie\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (tatieMatch) {
      params.tatie = tatieMatch[2];
      cleanedFragment = cleanedFragment.replace(tatieMatch[0], '');
    }

    const sizeMatch = cleanedFragment.match(/\.size\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (sizeMatch) {
      params.size = sizeMatch[2];
      cleanedFragment = cleanedFragment.replace(sizeMatch[0], '');
    }

    const colorMatch = cleanedFragment.match(/\.color\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (colorMatch) {
      params.color = colorMatch[2];
      cleanedFragment = cleanedFragment.replace(colorMatch[0], '');
    }

    const bgmMatch = cleanedFragment.match(/\.bgm\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (bgmMatch) {
      params.bgm = bgmMatch[2];
      cleanedFragment = cleanedFragment.replace(bgmMatch[0], '');
    }

    const bgmVolMatch = cleanedFragment.match(/\.(?:bgmVol|bgm_vol)\(\s*([0-9.]+)\s*\)/i);
    if (bgmVolMatch) {
      params.bgmVol = parseFloat(bgmVolMatch[1]);
      cleanedFragment = cleanedFragment.replace(bgmVolMatch[0], '');
    }

    const seVolMatch = cleanedFragment.match(/\.(?:seVol|se_vol)\(\s*([0-9.]+)\s*\)/i);
    if (seVolMatch) {
      params.seVol = parseFloat(seVolMatch[1]);
      cleanedFragment = cleanedFragment.replace(seVolMatch[0], '');
    }

    const seDirMatch = cleanedFragment.match(/\.(?:seDir|se_dir)\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (seDirMatch) {
      params.seDir = seDirMatch[2];
      cleanedFragment = cleanedFragment.replace(seDirMatch[0], '');
    }

    const bgmDirMatch = cleanedFragment.match(/\.(?:bgmDir|bgm_dir)\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (bgmDirMatch) {
      params.bgmDir = bgmDirMatch[2];
      cleanedFragment = cleanedFragment.replace(bgmDirMatch[0], '');
    }

    const tatieDirMatch = cleanedFragment.match(/\.(?:tatieDir|tatie_dir)\(\s*(['"]?)(.*?)\1\s*\)/i);
    if (tatieDirMatch) {
      params.tatieDir = tatieDirMatch[2];
      cleanedFragment = cleanedFragment.replace(tatieDirMatch[0], '');
    }

    return { params, cleanedFragment };
  }

  /**
   * Helper to compute heading ancestry stack for a line in document.
   * Returns array of heading line indices representing the chain of enclosing headers.
   */
  public getHeadingAncestry(document: vscode.TextDocument, targetLineIdx: number): { line: number; level: number }[] {
    const stack: { line: number; level: number }[] = [];
    const limit = Math.min(targetLineIdx, document.lineCount - 1);

    for (let i = 0; i <= limit; i++) {
      const text = document.lineAt(i).text;
      const match = text.match(/^\s*(#{1,6})\s+/);
      if (match) {
        const level = match[1].length;
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }
        stack.push({ line: i, level });
      }
    }

    return stack;
  }

  /**
   * Scans document from line 0 up to currentLineIdx for document-level preset declarations.
   * Presets at root level (before any heading) act globally.
   * Presets inside headings are scoped to that heading hierarchy and expire when moving out of scope.
   */
  public parseDocumentPresets(document: vscode.TextDocument, currentLineIdx: number): DocumentPresets {
    const globalPreset: PresetParams = {};
    const speakerPresets = new Map<string, PresetParams>();
    const bgmPreset: PresetParams = {};
    const sePreset: PresetParams = {};
    const tatiePreset: PresetParams = {};

    const targetLine = Math.min(currentLineIdx, document.lineCount - 1);
    const targetAncestry = this.getHeadingAncestry(document, targetLine);

    for (let i = 0; i <= targetLine; i++) {
      const lineText = document.lineAt(i).text.trim();
      if (!lineText.startsWith('preset.')) {
        continue;
      }

      const presetAncestry = this.getHeadingAncestry(document, i);

      // Strict hierarchy scope check:
      // A preset is in scope if it's top-level global (presetAncestry.length === 0),
      // OR if presetAncestry is an exact prefix of targetAncestry!
      let isInScope = false;
      if (presetAncestry.length === 0) {
        isInScope = true;
      } else if (presetAncestry.length <= targetAncestry.length) {
        isInScope = presetAncestry.every((p, idx) => p.line === targetAncestry[idx].line);
      }

      if (!isInScope) {
        continue;
      }

      // Regex matches preset.all or preset.'話者' or preset."話者" or preset.話者 followed by chained methods
      const match = lineText.match(/^preset\.(all|bgm|se|tatie|seDir|se_dir|bgmDir|bgm_dir|tatieDir|tatie_dir|['"][^'"]+['"]|[^.\s]+)(.+)$/i);
      if (match) {
        let rawTarget = match[1].trim();
        const chainedPart = match[2].trim();

        // Strip surrounding quotes from speaker name if present
        if ((rawTarget.startsWith("'") && rawTarget.endsWith("'")) || (rawTarget.startsWith('"') && rawTarget.endsWith('"'))) {
          rawTarget = rawTarget.slice(1, -1).trim();
        }

        const { params } = this.parseChainedMethods(chainedPart);

        const targetLower = rawTarget.toLowerCase();
        if (targetLower === 'all') {
          Object.assign(globalPreset, params);
        } else if (targetLower === 'bgm') {
          Object.assign(bgmPreset, params);
        } else if (targetLower === 'se') {
          Object.assign(sePreset, params);
        } else if (targetLower === 'tatie') {
          Object.assign(tatiePreset, params);
        } else if (targetLower === 'sedir' || targetLower === 'se_dir') {
          Object.assign(sePreset, params);
        } else if (targetLower === 'bgmdir' || targetLower === 'bgm_dir') {
          Object.assign(bgmPreset, params);
        } else if (targetLower === 'tatiedir' || targetLower === 'tatie_dir') {
          Object.assign(tatiePreset, params);
        } else {
          const searchKey = rawTarget.toLowerCase();
          const existing = speakerPresets.get(searchKey) || {};
          speakerPresets.set(searchKey, Object.assign({}, existing, params));
        }
      }
    }

    return { globalPreset, speakerPresets, bgmPreset, sePreset, tatiePreset };
  }

  /**
   * Helper to replace multi-line block comments with spaces/empty lines from document text,
   * preserving exact line numbers and column alignment.
   */
  public stripBlockComments(fullText: string): string {
    return fullText.replace(/\/\*[\s\S]*?\*\//g, (match) => {
      return match.split('\n').map(line => ' '.repeat(line.length)).join('\n');
    });
  }

  /**
   * Parses the entire document in one pass with block comments stripped into empty spaces,
   * returning structured information for each line to eliminate duplicated parsing logic.
   */
  public parseFullDocument(document: vscode.TextDocument): ParsedDocumentLine[] {
    const fullText = document.getText();
    const strippedText = this.stripBlockComments(fullText);
    const lines = strippedText.split('\n');

    const parsedLines: ParsedDocumentLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      let rawLine = document.lineAt(i).text;
      let cleanedLine = lines[i];

      // Strip inline // comment from cleanedLine
      if (cleanedLine.includes('//')) {
        const commentIdx = cleanedLine.indexOf('//');
        cleanedLine = cleanedLine.substring(0, commentIdx);
      }

      const trimmedClean = cleanedLine.trim();
      const trimmedRaw = rawLine.trim();

      const isComment = !trimmedClean || trimmedRaw.startsWith('//') || trimmedRaw.startsWith('/*') || trimmedRaw.startsWith('#!');
      const isHeader = trimmedClean.startsWith('#');
      const isPreset = trimmedClean.startsWith('preset.');
      const isDirective = trimmedClean.startsWith('.') && !trimmedClean.includes('>');

      const docPresets = this.parseDocumentPresets(document, i);
      let isTelop = false;
      let parsedVoice: ParsedLineVoiceParams | null = null;

      if (!isComment && !isHeader && !isPreset && !isDirective && trimmedClean.includes('>')) {
        parsedVoice = this.parseLineForVoice(cleanedLine, docPresets);
        if (parsedVoice?.isTelop) {
          isTelop = true;
        }
      }

      parsedLines.push({
        lineIdx: i,
        rawLine,
        cleanedLine,
        isComment,
        isHeader,
        isPreset,
        isDirective,
        isTelop,
        parsedVoice,
        docPresets
      });
    }

    return parsedLines;
  }

  /**
   * Parses line text for speaker name, style, speech text, Voicevox parameters (with chained methods & preset cascading),
   * inline .se() paths, cleaning ruby brackets [表記|読み], and removing \n escape codes.
   */
  public parseLineForVoice(
    line: string,
    documentPresets?: DocumentPresets,
    options?: { preserveRuby?: boolean }
  ): ParsedLineVoiceParams | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('#') || trimmed.startsWith('.')) {
      return null;
    }

    let isTelop = false;
    let rawSpeakerPart = '';
    let rawTextPart = '';

    if (trimmed.startsWith('>')) {
      const telopContent = trimmed.substring(1).trim();
      if (!telopContent) return null;
      isTelop = true;
      rawSpeakerPart = '';
      rawTextPart = telopContent;
    } else {
      const match = trimmed.match(/^([^>\n]+)>(.+)$/);
      if (!match) {
        return null;
      }
      rawSpeakerPart = match[1].trim();
      rawTextPart = match[2].trim();
    }

    if (rawTextPart.includes('//')) {
      rawTextPart = rawTextPart.split('//')[0].trim();
    }

    const firstDotIdx = rawSpeakerPart.indexOf('.');
    let speakerNameOrAlias: string;
    let styleName: string | undefined;

    if (firstDotIdx !== -1) {
      speakerNameOrAlias = rawSpeakerPart.substring(0, firstDotIdx).trim();
      styleName = rawSpeakerPart.substring(firstDotIdx + 1).trim();
    } else {
      speakerNameOrAlias = rawSpeakerPart.trim();
    }

    // Parse inline SE directive (.se('/se/chime.wav') or .se("/se/Pop.wav", 0.1))
    let sePath: string | undefined;
    let inlineSeVol: number | undefined;
    const seMatch = rawTextPart.match(SE_DIRECTIVE_MATCH_REGEX);
    if (seMatch) {
      sePath = (seMatch[1] ?? seMatch[2]).replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
      if (seMatch[3]) {
        inlineSeVol = parseFloat(seMatch[3]);
      }
      rawTextPart = rawTextPart.replace(seMatch[0], '');
    }

    // Parse inline chained parameters from end of dialogue line
    const { params: inlineParams, cleanedFragment } = this.parseChainedMethods(rawTextPart);
    rawTextPart = cleanedFragment;

    // Resolve cascading presets: Inline Line Directives > Speaker Presets > Global All Presets
    const globalParams = documentPresets?.globalPreset || {};
    const speakerKey = speakerNameOrAlias.toLowerCase();
    const speakerParams = documentPresets?.speakerPresets.get(speakerKey) || {};

    const speed = inlineParams.speed ?? speakerParams.speed ?? globalParams.speed;
    const pitch = inlineParams.pitch ?? speakerParams.pitch ?? globalParams.pitch;
    const intonation = inlineParams.intonation ?? speakerParams.intonation ?? globalParams.intonation;
    const volume = inlineParams.volume ?? speakerParams.volume ?? globalParams.volume;
    const pauseLength = inlineParams.pauseLength ?? speakerParams.pauseLength ?? globalParams.pauseLength;
    const preSilence = inlineParams.preSilence ?? speakerParams.preSilence ?? globalParams.preSilence;
    const postSilence = inlineParams.postSilence ?? speakerParams.postSilence ?? globalParams.postSilence;
    const wait = inlineParams.wait ?? speakerParams.wait ?? globalParams.wait;
    const font = inlineParams.font ?? speakerParams.font ?? globalParams.font;
    const tatie = inlineParams.tatie ?? speakerParams.tatie ?? globalParams.tatie;
    const size = inlineParams.size ?? speakerParams.size ?? globalParams.size;
    const color = inlineParams.color ?? speakerParams.color ?? globalParams.color;
    const bgm = inlineParams.bgm ?? speakerParams.bgm ?? globalParams.bgm;
    const bgmVol = inlineParams.bgmVol ?? speakerParams.bgmVol ?? globalParams.bgmVol ?? documentPresets?.bgmPreset.bgmVol;
    const seVol = inlineParams.seVol ?? inlineSeVol ?? speakerParams.seVol ?? globalParams.seVol ?? documentPresets?.sePreset.seVol;

    // Clean up remaining directives from text
    rawTextPart = rawTextPart.replace(/\.?(bgm|bgmVol|bgm_vol|seVol|se_vol|font|tatie|size|color|pause_length|pauselength|pre_silence|presilence|post_silence|postsilence|wait)\s*[\(（][^)\)]*[\)）]/gi, '').trim();

    // 1. Remove \n or \N escape sequences so VOICEVOX never reads "backslash n"
    rawTextPart = rawTextPart.replace(/\\[nN]/g, '');

    // 2. Clean ruby brackets [表記|読み] -> 読み, unless preserveRuby option is enabled
    if (!options?.preserveRuby) {
      rawTextPart = rawTextPart.replace(/\s*\[[^\|\]]+\|([^\]]+)\]\s*/g, '$1');
    }

    rawTextPart = rawTextPart.trim();

    if (!rawTextPart) {
      return null;
    }

    return {
      speakerNameOrAlias,
      styleName,
      text: rawTextPart,
      isTelop,
      speed,
      pitch,
      intonation,
      volume,
      pauseLength,
      preSilence,
      postSilence,
      wait,
      sePath,
      font,
      tatie,
      size,
      color,
      bgm,
      bgmVol,
      seVol
    };
  }

  /**
   * Resolves given relative/short path to absolute file system path using presets or settings.
   */
  public resolveAbsolutePath(rawPath: string, category: 'se' | 'bgm' | 'tatie', docPresets: DocumentPresets): string {
    if (!rawPath) return rawPath;
    let clean = rawPath.trim();
    if ((clean.startsWith("'") && clean.endsWith("'")) || (clean.startsWith('"') && clean.endsWith('"'))) {
      clean = clean.slice(1, -1).trim();
    }

    if (path.isAbsolute(clean) && fs.existsSync(clean)) {
      return clean.replace(/\\/g, '/');
    }

    const rel = clean.replace(/^[/\\]+/, '');

    // 1. Check inline preset.seDir / bgmDir / tatieDir
    let inlineDir: string | undefined;
    if (category === 'se') inlineDir = docPresets.sePreset?.seDir;
    else if (category === 'bgm') inlineDir = docPresets.bgmPreset?.bgmDir;
    else if (category === 'tatie') inlineDir = docPresets.tatiePreset?.tatieDir || docPresets.globalPreset?.tatieDir;

    if (inlineDir) {
      const candidate = path.isAbsolute(inlineDir)
        ? path.join(inlineDir, rel)
        : (vscode.workspace.workspaceFolders ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, inlineDir, rel) : null);
      if (candidate && fs.existsSync(candidate)) {
        return candidate.replace(/\\/g, '/');
      }
    }

    // 2. Check VS Code settings (smd.seDir / smd.bgmDir / smd.tatieDir)
    const config = vscode.workspace.getConfiguration('smd');
    let settingDir: string | undefined;
    if (category === 'se') settingDir = config.get<string>('seDir');
    else if (category === 'bgm') settingDir = config.get<string>('bgmDir');
    else if (category === 'tatie') settingDir = config.get<string>('tatieDir');

    if (settingDir && settingDir.trim()) {
      const baseDir = settingDir.trim();
      const candidate = path.isAbsolute(baseDir)
        ? path.join(baseDir, rel)
        : (vscode.workspace.workspaceFolders ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, baseDir, rel) : null);
      if (candidate && fs.existsSync(candidate)) {
        return candidate.replace(/\\/g, '/');
      }
    }

    return clean;
  }

  /**
   * Bakes dialogue lines within the specified [startLine, endLine] range,
   * while evaluating all preceding document-level & heading-level presets from line 0 up to line i using the full document context.
   */
  public bakeDocument(
    document: vscode.TextDocument,
    startLine: number = 0,
    endLine: number = document.lineCount - 1,
    options: { preserveRuby?: boolean } = { preserveRuby: true }
  ): string {
    const fromLine = Math.max(0, Math.min(startLine, document.lineCount - 1));
    const toLine = Math.max(fromLine, Math.min(endLine, document.lineCount - 1));

    // Extract text range and strip block comments into empty lines
    const sliceLines: string[] = [];
    for (let i = fromLine; i <= toLine; i++) {
      sliceLines.push(document.lineAt(i).text);
    }
    const rawText = sliceLines.join('\n');
    const cleanedText = this.stripBlockComments(rawText);
    const lines = cleanedText.split('\n');

    const resultLines: string[] = [];

    // Check if line 0 has a shebang declaration (e.g. #!/usr/bin/env smd@1.0  --ScriptMarkDown--)
    const firstLineText = document.lineCount > 0 ? document.lineAt(0).text.trim() : '';
    if (fromLine > 0 && firstLineText.startsWith('#!')) {
      resultLines.push(document.lineAt(0).text);
    }

    for (let idx = 0; idx < lines.length; idx++) {
      const lineIdx = fromLine + idx;
      let rawLine = lines[idx];

      // Replace inline // comments with empty spaces
      if (rawLine.includes('//')) {
        const commentIdx = rawLine.indexOf('//');
        rawLine = rawLine.substring(0, commentIdx);
      }

      const trimmed = rawLine.trim();

      // Empty lines or comments -> keep as blank line
      if (!trimmed) {
        resultLines.push('');
        continue;
      }

      // Headers (including shebang #!)
      if (trimmed.startsWith('#')) {
        resultLines.push(rawLine);
        continue;
      }

      // If it's a pure preset. line, keep it as reference
      if (trimmed.startsWith('preset.')) {
        resultLines.push(rawLine);
        continue;
      }

      // Dialogue or Telop line
      if (trimmed.includes('>') && !trimmed.startsWith('.')) {
        const docPresets = this.parseDocumentPresets(document, lineIdx);
        const parsed = this.parseLineForVoice(rawLine, docPresets, options);

        if (parsed) {
          let lineStr = parsed.isTelop
            ? `> ${parsed.text}`
            : `${parsed.speakerNameOrAlias}${parsed.styleName ? '.' + parsed.styleName : ''}>${parsed.text}`;

          // Append chained methods for all resolved parameters
          if (parsed.speed !== undefined) lineStr += ` .speed(${parsed.speed})`;
          if (parsed.pitch !== undefined) lineStr += ` .pitch(${parsed.pitch})`;
          if (parsed.intonation !== undefined) lineStr += ` .intonation(${parsed.intonation})`;
          if (parsed.volume !== undefined) lineStr += ` .volume(${parsed.volume})`;
          if (parsed.pauseLength !== undefined) lineStr += ` .pauseLength(${parsed.pauseLength})`;
          if (parsed.preSilence !== undefined) lineStr += ` .preSilence(${parsed.preSilence})`;
          if (parsed.postSilence !== undefined) lineStr += ` .postSilence(${parsed.postSilence})`;
          if (parsed.tatie) {
            const absTatie = this.resolveAbsolutePath(parsed.tatie, 'tatie', docPresets);
            lineStr += ` .tatie("${absTatie}")`;
          }
          if (parsed.font) lineStr += ` .font("${parsed.font}")`;
          if (parsed.size !== undefined) lineStr += ` .size("${parsed.size}")`;
          if (parsed.color) lineStr += ` .color("${parsed.color}")`;

          // Only append .bgm / .bgmVol if bgm is explicitly specified on this line or in inlineParams
          if (parsed.bgm) {
            const absBgm = this.resolveAbsolutePath(parsed.bgm, 'bgm', docPresets);
            lineStr += ` .bgm("${absBgm}")`;
            if (parsed.bgmVol !== undefined) lineStr += ` .bgmVol(${parsed.bgmVol})`;
          } else if (rawLine.includes('bgmVol') || rawLine.includes('bgm_vol')) {
            if (parsed.bgmVol !== undefined) lineStr += ` .bgmVol(${parsed.bgmVol})`;
          }

          // Only append .se / .seVol if sePath is explicitly specified on this line or in inlineParams
          if (parsed.sePath) {
            const absSe = this.resolveAbsolutePath(parsed.sePath, 'se', docPresets);
            lineStr += ` .se("${absSe}")`;
            if (parsed.seVol !== undefined) lineStr += ` .seVol(${parsed.seVol})`;
          } else if (rawLine.includes('seVol') || rawLine.includes('se_vol')) {
            if (parsed.seVol !== undefined) lineStr += ` .seVol(${parsed.seVol})`;
          }

          if (parsed.wait !== undefined) lineStr += ` .wait(${parsed.wait})`;

          resultLines.push(lineStr);
        } else {
          resultLines.push('');
        }
      } else {
        // Directives like .se(), .bgm(), .wait()
        const docPresets = this.parseDocumentPresets(document, lineIdx);
        let outputLine = rawLine;

        if (trimmed.includes('.se(')) {
          const { params } = this.parseChainedMethods(trimmed);
          const seMatch = trimmed.match(/\.se\(\s*(["'])(.*?)\1/);
          if (seMatch) {
            const absPath = this.resolveAbsolutePath(seMatch[2], 'se', docPresets);
            outputLine = outputLine.replace(seMatch[0], `.se("${absPath}")`);
          }
          const effectiveSeVol = params.seVol ?? docPresets.sePreset.seVol;
          if (effectiveSeVol !== undefined && !trimmed.includes('seVol') && !trimmed.match(/\.se\([^)]*,\s*[0-9.]+\)/)) {
            outputLine += ` .seVol(${effectiveSeVol})`;
          }
        } else if (trimmed.includes('.bgm(')) {
          const { params } = this.parseChainedMethods(trimmed);
          const bgmMatch = trimmed.match(/\.bgm\(\s*(["'])(.*?)\1/);
          if (bgmMatch) {
            const absPath = this.resolveAbsolutePath(bgmMatch[2], 'bgm', docPresets);
            outputLine = outputLine.replace(bgmMatch[0], `.bgm("${absPath}")`);
          }
          const effectiveBgmVol = params.bgmVol ?? docPresets.bgmPreset.bgmVol;
          if (effectiveBgmVol !== undefined && !trimmed.includes('bgmVol') && !trimmed.match(/\.bgm\([^)]*,\s*[0-9.]+\)/)) {
            outputLine += ` .bgmVol(${effectiveBgmVol})`;
          }
        }

        resultLines.push(outputLine);
      }
    }

    return resultLines.join('\n');
  }

  /**
   * Resolves speaker style_id accurately from presets.json or workspace .smdconfig.json
   */
  public resolveStyleId(speakerNameOrAlias: string, styleName?: string): number {
    const config = this.configManager.getMergedConfig();
    const speakers = config.speakers || [];

    const searchTarget = speakerNameOrAlias.trim().toLowerCase();

    // Find matching speaker by exact name, ID, or aliases
    const speaker = speakers.find((s: any) => 
      s.name?.toLowerCase() === searchTarget || 
      s.id?.toLowerCase() === searchTarget || 
      s.aliases?.some((a: string) => a.toLowerCase() === searchTarget || searchTarget.includes(a.toLowerCase()))
    );

    if (speaker && speaker.styleIds && speaker.styleIds.length > 0) {
      if (styleName && speaker.styles) {
        const targetStyle = styleName.trim().toLowerCase();
        const styleIdx = speaker.styles.findIndex((st: string) => st.toLowerCase() === targetStyle || st.toLowerCase().includes(targetStyle));
        if (styleIdx !== -1 && speaker.styleIds[styleIdx] !== undefined) {
          return speaker.styleIds[styleIdx];
        }
      }
      return speaker.styleIds[0];
    }

    // Default fallback to 3 (Zundamon Normal) if completely unknown
    return 3;
  }

  /**
   * Exports parsed script document to VOICEVOX GUI Text File Format (.txt):
   * e.g. "四国めたん,こんにちは" or "ずんだもん(あまあま),ボクなのだ"
   */
  public exportToVoicevoxTxt(document: vscode.TextDocument): string {
    const resultLines: string[] = [];
    const parsedLines = this.parseFullDocument(document);
    const config = this.configManager.getMergedConfig();
    const speakers = config.speakers || [];

    for (const item of parsedLines) {
      if (item.isComment || item.isHeader || item.isPreset || item.isDirective || item.isTelop) {
        continue;
      }

      const parsed = item.parsedVoice;
      if (!parsed || !parsed.text.trim()) {
        continue;
      }

      // Resolve speaker official name & style
      const searchTarget = parsed.speakerNameOrAlias.trim().toLowerCase();
      const speaker = speakers.find((s: any) => 
        s.name?.toLowerCase() === searchTarget || 
        s.id?.toLowerCase() === searchTarget || 
        s.aliases?.some((a: string) => a.toLowerCase() === searchTarget || searchTarget.includes(a.toLowerCase()))
      );

      const officialSpeakerName = speaker ? speaker.name : parsed.speakerNameOrAlias;
      const effectiveStyle = parsed.styleName || (speaker ? speaker.defaultStyle : undefined);

      let header = officialSpeakerName;
      if (effectiveStyle) {
        header = `${officialSpeakerName}(${effectiveStyle})`;
      }

      // Clean up text for VOICEVOX (.txt)
      let cleanText = parsed.text;
      // Remove any backslash n/N escapes
      cleanText = cleanText.replace(/\\[nN]/g, ' ');
      // Replace ruby [表記|読み] -> 読み
      cleanText = cleanText.replace(/\s*\[[^\|\]]+\|([^\]]+)\]\s*/g, '$1');
      // Strip any remaining directive calls
      cleanText = cleanText.replace(/\.?(bgm|bgmVol|bgm_vol|seVol|se_vol|font|tatie|size|color|pause_length|pauselength|pre_silence|presilence|post_silence|postsilence|wait|se)\s*[\(（][^)\)]*[\)）]/gi, '').trim();

      if (cleanText) {
        resultLines.push(`${header},${cleanText}`);
      }
    }

    return resultLines.join('\n');
  }
}
