import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SMDWebAudioViewProvider } from './webAudioProvider.js';

export class AudioPlayer {
  private webAudioProvider: SMDWebAudioViewProvider | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentPlayingPath: string | null = null;
  private isCancelled: boolean = false;
  private isPlayingScript: boolean = false;
  private bgmMasterVolume: number = 1.0;
  private seMasterVolume: number = 1.0;

  constructor() {
    // Process exit handler: Kill all spawned audio processes if VS Code / Extension host is closing
    process.on('exit', () => this.killAllChildProcesses());
    process.on('SIGINT', () => this.killAllChildProcesses());
    process.on('SIGTERM', () => this.killAllChildProcesses());
  }

  public setWebAudioProvider(webAudioProvider: SMDWebAudioViewProvider): void {
    this.webAudioProvider = webAudioProvider;
  }

  public setBgmMasterVolume(vol: number): void {
    this.bgmMasterVolume = Math.min(Math.max(vol, 0.0), 2.0);
    if (this.webAudioProvider) {
      this.webAudioProvider.setBgmMasterVolume(this.bgmMasterVolume);
    }
  }

  public getBgmMasterVolume(): number {
    return this.bgmMasterVolume;
  }

  public setSeMasterVolume(vol: number): void {
    this.seMasterVolume = Math.min(Math.max(vol, 0.0), 2.0);
    if (this.webAudioProvider) {
      this.webAudioProvider.setSeMasterVolume(this.seMasterVolume);
    }
  }

  public getSeMasterVolume(): number {
    return this.seMasterVolume;
  }

  /**
   * Immediately SIGKILL all tracked child processes to prevent orphaned audio playback on window close
   */
  public killAllChildProcesses(): void {
    if (this.webAudioProvider) {
      this.webAudioProvider.stop();
    }
  }

  public cancel(): void {
    this.isCancelled = true;
    this.killAllChildProcesses();
  }

  public resetCancelState(): void {
    this.isCancelled = false;
  }

  public getCancelled(): boolean {
    return this.isCancelled;
  }

  public setIsPlayingScript(playing: boolean): void {
    this.isPlayingScript = playing;
  }

  public getIsPlayingScript(): boolean {
    return this.isPlayingScript;
  }

  private currentBgmPath: string | null = null;
  private currentBgmVolume: number = 1.0;

  /**
   * Play background music (BGM) endlessly or until manually stopped
   */
  public playBgm(absoluteFsPath: string, volume: number = 1.0): void {
    if (this.currentBgmPath === absoluteFsPath && Math.abs(this.currentBgmVolume - volume) < 0.001) {
      return;
    }

    this.currentBgmPath = absoluteFsPath;
    this.currentBgmVolume = volume;

    if (!absoluteFsPath || !fs.existsSync(absoluteFsPath)) {
      return;
    }

    if (this.webAudioProvider) {
      this.webAudioProvider.playBgm(absoluteFsPath, volume);
    }
  }

  public stopBgm(): void {
    this.currentBgmPath = null;
    if (this.webAudioProvider) {
      this.webAudioProvider.stopBgm();
    }
  }

  /**
   * Trailing Debounce: Plays audio preview ONLY after the user stops moving selection (key release / settled)
   */
  public playDebounced(filePath: string, delayMs: number = 180): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const resolved = this.resolvePath(filePath);
      if (resolved) {
        this.playDirect(resolved);
      }
    }, delayMs);
  }

  /**
   * Direct playback using Web Audio API
   */
  public playDirect(absoluteFsPath: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.stop();

    if (!absoluteFsPath || !fs.existsSync(absoluteFsPath)) {
      return;
    }

    if (this.webAudioProvider) {
      this.webAudioProvider.playVoice(absoluteFsPath);
    }
  }

  /**
   * Parallel playback for sound effects (SE) without stopping main voice
   */
  public playDirectParallel(absoluteFsPath: string, volume: number = 1.0): void {
    if (!absoluteFsPath || !fs.existsSync(absoluteFsPath)) {
      return;
    }

    if (this.webAudioProvider) {
      this.webAudioProvider.playSe(absoluteFsPath, volume);
    }
  }

  /**
   * Parallel playback with Promise resolution on completion using Web Audio API
   */
  public playDirectPromiseParallel(absoluteFsPath: string, volume: number = 1.0): Promise<void> {
    if (this.webAudioProvider) {
      return this.webAudioProvider.playSePromise(absoluteFsPath, volume);
    }
    return Promise.resolve();
  }

  /**
   * Play audio and return Promise that resolves when playback completes in Web Audio API
   */
  public async playDirectPromise(absoluteFsPath: string): Promise<void> {
    if (!absoluteFsPath || !fs.existsSync(absoluteFsPath)) {
      return;
    }

    if (this.webAudioProvider) {
      await this.webAudioProvider.playVoicePromise(absoluteFsPath);
    }
  }

  public play(filePath: string): void {
    const resolvedPath = this.resolvePath(filePath);
    if (resolvedPath) {
      this.playDirect(resolvedPath);
    }
  }

  /**
   * Stop main voice/effect process instantly
   */
  public stop(): void {
    if (this.webAudioProvider) {
      this.webAudioProvider.stop();
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.currentPlayingPath = null;
  }

  /**
   * Stop all audio processes including BGM and cancel continuous playback loop
   */
  public stopAll(): void {
    this.isCancelled = true;
    this.killAllChildProcesses();
  }

  private pathCacheMap = new Map<string, string | null>();

  public clearPathCache(): void {
    this.pathCacheMap.clear();
  }

  /**
   * Robustly resolves any given relative or absolute file path to an existing absolute file system path
   */
  public resolvePath(
    filePath: string,
    category?: 'se' | 'bgm' | 'tatie',
    docPresets?: any
  ): string | null {
    if (!filePath) {
      return null;
    }

    let cleanPath = filePath.trim();
    if ((cleanPath.startsWith("'") && cleanPath.endsWith("'")) || (cleanPath.startsWith('"') && cleanPath.endsWith('"'))) {
      cleanPath = cleanPath.slice(1, -1).trim();
    }

    const cacheKey = `${category || 'none'}:${cleanPath}:${docPresets?.sePreset?.seDir || ''}:${docPresets?.bgmPreset?.bgmDir || ''}:${docPresets?.tatiePreset?.tatieDir || ''}`;
    if (this.pathCacheMap.has(cacheKey)) {
      return this.pathCacheMap.get(cacheKey)!;
    }

    let resolvedResult: string | null = null;

    // 1. Direct absolute path check
    if (path.isAbsolute(cleanPath) && fs.existsSync(cleanPath)) {
      resolvedResult = cleanPath;
    } else {
      const relativeNoLeading = cleanPath.replace(/^[/\\]+/, '');

      // 2. Check inline preset.seDir / bgmDir / tatieDir if provided
      if (category && docPresets) {
        let inlineDir: string | undefined;
        if (category === 'se') inlineDir = docPresets.sePreset?.seDir;
        else if (category === 'bgm') inlineDir = docPresets.bgmPreset?.bgmDir;
        else if (category === 'tatie') inlineDir = docPresets.tatiePreset?.tatieDir || docPresets.globalPreset?.tatieDir;

        if (inlineDir) {
          const candidate = path.isAbsolute(inlineDir)
            ? path.join(inlineDir, relativeNoLeading)
            : (vscode.workspace.workspaceFolders ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, inlineDir, relativeNoLeading) : null);

          if (candidate && fs.existsSync(candidate)) {
            resolvedResult = candidate;
          }
        }
      }

      if (!resolvedResult) {
        // 3. Check VS Code settings (smd.seDir / smd.bgmDir / smd.tatieDir)
        const config = vscode.workspace.getConfiguration('smd');
        let settingDir: string | undefined;
        if (category === 'se') settingDir = config.get<string>('seDir');
        else if (category === 'bgm') settingDir = config.get<string>('bgmDir');
        else if (category === 'tatie') settingDir = config.get<string>('tatieDir');

        if (settingDir && settingDir.trim()) {
          const baseDir = settingDir.trim();
          const candidate = path.isAbsolute(baseDir)
            ? path.join(baseDir, relativeNoLeading)
            : (vscode.workspace.workspaceFolders ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, baseDir, relativeNoLeading) : null);

          if (candidate && fs.existsSync(candidate)) {
            resolvedResult = candidate;
          }
        }
      }
    }

    this.pathCacheMap.set(cacheKey, resolvedResult);
    return resolvedResult;
  }
}
