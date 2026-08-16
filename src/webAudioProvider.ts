import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Safety-net timeout only, in case the webview never posts back a completion message
// (e.g. it crashed). Not a normal playback cutoff, so it's generous on purpose.
const PLAYBACK_SAFETY_TIMEOUT_MS = 5 * 60 * 1000;

export class SMDWebAudioViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'smdAudioEngineView';

  private webviewView: vscode.WebviewView | null = null;
  private hasUserActivated: boolean = false;
  private isReady: boolean = false;
  private pendingResolves: Map<string, () => void> = new Map();
  private bgmMasterVolume: number = 1.0;
  private seMasterVolume: number = 1.0;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'READY') {
        this.isReady = true;
      } else if (message.type === 'START_PLAYBACK') {
        this.hasUserActivated = true;
        vscode.commands.executeCommand('smd.playScriptFromCurrentLine');
      } else if (message.type === 'ACTIVATED') {
        this.hasUserActivated = true;
      } else if (message.type === 'STOP_PLAYBACK') {
        vscode.commands.executeCommand('smd.stopAudio');
      } else if (message.type === 'VOICE_ENDED') {
        const reqId = message.reqId;
        if (reqId && this.pendingResolves.has(reqId)) {
          const resolve = this.pendingResolves.get(reqId)!;
          this.pendingResolves.delete(reqId);
          resolve();
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.webviewView = null;
      this.isReady = false;
      for (const [reqId, resolve] of this.pendingResolves.entries()) {
        resolve();
      }
      this.pendingResolves.clear();
    });
  }

  private async ensureWebviewView(): Promise<void> {
    if (!this.webviewView || !this.hasUserActivated) {
      try {
        if (!this.hasUserActivated) {
          // Focus panel so user sees the activate play button clearly
          await vscode.commands.executeCommand('smdAudioEngineView.focus');
        } else {
          await vscode.commands.executeCommand('smdAudioEngineView.show', true);
        }
        let waitCount = 0;
        while (!this.webviewView && waitCount < 20) {
          await new Promise(r => setTimeout(r, 50));
          waitCount++;
        }
      } catch (e) {
        // ignore
      }
    }
  }

  private warnPlaybackUnavailable(): void {
    vscode.window.showWarningMessage(
      'SMD Player パネルの準備ができていないため、音声を再生できませんでした。パネルを開いてからもう一度お試しください。'
    );
  }

  public async playVoicePromise(absoluteFsPath: string): Promise<void> {
    await this.ensureWebviewView();

    if (!fs.existsSync(absoluteFsPath)) {
      return;
    }
    if (!this.webviewView) {
      this.warnPlaybackUnavailable();
      return;
    }

    const buffer = fs.readFileSync(absoluteFsPath);
    const base64Data = buffer.toString('base64');
    const reqId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingResolves.has(reqId)) {
          this.pendingResolves.delete(reqId);
          resolve();
        }
      }, PLAYBACK_SAFETY_TIMEOUT_MS);

      this.pendingResolves.set(reqId, () => {
        clearTimeout(timer);
        resolve();
      });

      this.webviewView?.webview.postMessage({
        type: 'PLAY_VOICE',
        reqId,
        base64Data,
        mimeType: 'audio/wav'
      });
    });
  }

  public playVoice(absoluteFsPath: string): void {
    this.playVoicePromise(absoluteFsPath).catch(() => {});
  }

  public async playBgm(absoluteFsPath: string, volume: number = 1.0): Promise<void> {
    await this.ensureWebviewView();
    if (!fs.existsSync(absoluteFsPath)) {
      return;
    }
    if (!this.webviewView) {
      this.warnPlaybackUnavailable();
      return;
    }

    const buffer = fs.readFileSync(absoluteFsPath);
    const base64Data = buffer.toString('base64');
    const ext = path.extname(absoluteFsPath).toLowerCase();
    const mimeType = ext === '.mp3' ? 'audio/mp3' : 'audio/wav';

    this.webviewView.webview.postMessage({
      type: 'PLAY_BGM',
      absoluteFsPath,
      base64Data,
      mimeType,
      volume
    });
  }

  public stopBgm(): void {
    this.webviewView?.webview.postMessage({ type: 'STOP_BGM' });
  }

  public async playSe(absoluteFsPath: string, volume: number = 1.0): Promise<void> {
    await this.ensureWebviewView();
    if (!fs.existsSync(absoluteFsPath)) {
      return;
    }
    if (!this.webviewView) {
      this.warnPlaybackUnavailable();
      return;
    }

    const buffer = fs.readFileSync(absoluteFsPath);
    const base64Data = buffer.toString('base64');
    const ext = path.extname(absoluteFsPath).toLowerCase();
    const mimeType = ext === '.mp3' ? 'audio/mp3' : 'audio/wav';

    this.webviewView.webview.postMessage({
      type: 'PLAY_SE',
      base64Data,
      mimeType,
      volume: volume * this.seMasterVolume
    });
  }

  public async playSePromise(absoluteFsPath: string, volume: number = 1.0): Promise<void> {
    await this.ensureWebviewView();
    if (!fs.existsSync(absoluteFsPath)) {
      return;
    }
    if (!this.webviewView) {
      this.warnPlaybackUnavailable();
      return;
    }

    const buffer = fs.readFileSync(absoluteFsPath);
    const base64Data = buffer.toString('base64');
    const ext = path.extname(absoluteFsPath).toLowerCase();
    const mimeType = ext === '.mp3' ? 'audio/mp3' : 'audio/wav';
    const reqId = `se_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingResolves.has(reqId)) {
          this.pendingResolves.delete(reqId);
          resolve();
        }
      }, PLAYBACK_SAFETY_TIMEOUT_MS);

      this.pendingResolves.set(reqId, () => {
        clearTimeout(timer);
        resolve();
      });

      this.webviewView?.webview.postMessage({
        type: 'PLAY_SE',
        reqId,
        base64Data,
        mimeType,
        volume: volume * this.seMasterVolume
      });
    });
  }

  public stop(): void {
    for (const [reqId, resolve] of this.pendingResolves.entries()) {
      resolve();
    }
    this.pendingResolves.clear();
    this.webviewView?.webview.postMessage({ type: 'STOP_VOICE' });
  }

  public setBgmMasterVolume(volume: number): void {
    this.bgmMasterVolume = volume;
    this.webviewView?.webview.postMessage({ type: 'SET_BGM_MASTER_VOL', volume });
  }

  public setSeMasterVolume(volume: number): void {
    this.seMasterVolume = volume;
    this.webviewView?.webview.postMessage({ type: 'SET_SE_MASTER_VOL', volume });
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SMD Player</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-panel-background);
      padding: 10px 16px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      user-select: none;
      position: relative;
      overflow: hidden;
    }
    .btn {
      border: none;
      border-radius: 4px;
      padding: 6px 18px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn-play {
      background: #2e7d32;
      color: #ffffff;
    }
    .btn-play:hover {
      background: #388e3c;
    }
    .btn-stop {
      background: #c62828;
      color: #ffffff;
    }
    .btn-stop:hover {
      background: #d32f2f;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.92);
      color: #1e1e2e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      z-index: 99;
      box-sizing: border-box;
      padding: 4px 12px;
      transition: opacity 0.2s ease, visibility 0.2s ease;
      letter-spacing: 0.5px;
    }
    .overlay.hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="overlay" class="overlay">
    <span>🔊 クリックしてオーディオを有効化 (Click to Enable Audio)</span>
  </div>
  <div class="controls">
    <button id="playBtn" class="btn btn-play">▶ 再生</button>
    <button id="stopBtn" class="btn btn-stop">◼ 停止</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;

    async function tryAutoResume() {
      if (!audioCtx) {
        audioCtx = new AudioContext();
      }
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
          const buffer = audioCtx.createBuffer(1, 1, 22050);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.start(0);
        } catch(e) {}
      }
      if (audioCtx.state === 'running') {
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.add('hidden');
        vscode.postMessage({ type: 'ACTIVATED' });
      }
      return audioCtx;
    }

    async function getAudioContext() {
      const ctx = await tryAutoResume();
      if (ctx && ctx.state === 'running') {
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.add('hidden');
        vscode.postMessage({ type: 'ACTIVATED' });
      }
      return ctx;
    }

    async function unlockAudio() {
      const ctx = await tryAutoResume();
      if (ctx && ctx.state === 'running') {
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.add('hidden');
        vscode.postMessage({ type: 'ACTIVATED' });
      }
    }

    document.getElementById('overlay').addEventListener('click', unlockAudio);
    window.addEventListener('click', unlockAudio);

    document.getElementById('playBtn').addEventListener('click', async () => {
      await unlockAudio();
      vscode.postMessage({ type: 'START_PLAYBACK' });
    });

    document.getElementById('stopBtn').addEventListener('click', async () => {
      vscode.postMessage({ type: 'STOP_PLAYBACK' });
    });

    window.addEventListener('DOMContentLoaded', () => tryAutoResume());
    window.addEventListener('focus', () => tryAutoResume());
    window.addEventListener('mouseover', () => tryAutoResume());
    window.addEventListener('mousemove', () => tryAutoResume());
    window.addEventListener('keydown', () => tryAutoResume());

    let currentVoiceSource = null;
    let currentBgmSource = null;
    let currentBgmGain = null;
    let currentBgmPath = null;
    let currentBgmVolume = 1.0;
    let bgmMasterVol = 1.0;
    let seMasterVol = 1.0;
    const activeSources = new Set();

    function stopAllAudio() {
      for (const src of activeSources) {
        try {
          src.onended = null;
          src.stop(0);
          src.disconnect();
        } catch(e){}
      }
      activeSources.clear();
      currentVoiceSource = null;
      currentBgmSource = null;
      currentBgmGain = null;
      currentBgmPath = null;
    }

    function base64ToArrayBuffer(base64) {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    window.addEventListener('message', async (event) => {
      const msg = event.data;
      const ctx = await getAudioContext();

      if (msg.type === 'PLAY_VOICE') {
        if (currentVoiceSource) {
          try {
            activeSources.delete(currentVoiceSource);
            currentVoiceSource.onended = null;
            currentVoiceSource.stop(0);
            currentVoiceSource.disconnect();
          } catch(e){}
          currentVoiceSource = null;
        }

        try {
          const arrayBuf = base64ToArrayBuffer(msg.base64Data);
          const audioBuffer = await ctx.decodeAudioData(arrayBuf);
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          currentVoiceSource = source;
          activeSources.add(source);

          source.onended = () => {
            activeSources.delete(source);
            if (currentVoiceSource === source) {
              currentVoiceSource = null;
            }
            vscode.postMessage({ type: 'VOICE_ENDED', reqId: msg.reqId });
          };

          source.start(0);
        } catch(err) {
          console.error('WebAudio decode error:', err);
          vscode.postMessage({ type: 'VOICE_ENDED', reqId: msg.reqId });
        }
      } else if (msg.type === 'STOP_VOICE' || msg.type === 'STOP_ALL') {
        stopAllAudio();
      } else if (msg.type === 'PLAY_BGM') {
        currentBgmVolume = msg.volume !== undefined ? msg.volume : 1.0;
        const targetVol = currentBgmVolume * bgmMasterVol;

        if (currentBgmPath === msg.absoluteFsPath && currentBgmGain) {
          currentBgmGain.gain.setValueAtTime(targetVol, ctx.currentTime);
          return;
        }

        if (currentBgmSource) {
          try {
            activeSources.delete(currentBgmSource);
            currentBgmSource.onended = null;
            currentBgmSource.stop(0);
            currentBgmSource.disconnect();
          } catch(e){}
          currentBgmSource = null;
          currentBgmGain = null;
        }

        currentBgmPath = msg.absoluteFsPath;
        try {
          const arrayBuf = base64ToArrayBuffer(msg.base64Data);
          const audioBuffer = await ctx.decodeAudioData(arrayBuf);
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.loop = true;

          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(targetVol, ctx.currentTime);
          
          source.connect(gainNode);
          gainNode.connect(ctx.destination);

          currentBgmSource = source;
          currentBgmGain = gainNode;
          activeSources.add(source);
          source.start(0);
        } catch(err) {
          console.error('BGM decode error:', err);
        }
      } else if (msg.type === 'STOP_BGM') {
        if (currentBgmSource) {
          try {
            activeSources.delete(currentBgmSource);
            currentBgmSource.onended = null;
            currentBgmSource.stop(0);
            currentBgmSource.disconnect();
          } catch(e){}
          currentBgmSource = null;
          currentBgmGain = null;
          currentBgmPath = null;
        }
      } else if (msg.type === 'PLAY_SE') {
        try {
          const arrayBuf = base64ToArrayBuffer(msg.base64Data);
          const audioBuffer = await ctx.decodeAudioData(arrayBuf);
          
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;

          const gainNode = ctx.createGain();
          gainNode.gain.value = (msg.volume !== undefined ? msg.volume : 1.0) * seMasterVol;
          
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
          activeSources.add(source);

          if (msg.reqId) {
            source.onended = () => {
              activeSources.delete(source);
              vscode.postMessage({ type: 'VOICE_ENDED', reqId: msg.reqId });
            };
          } else {
            source.onended = () => {
              activeSources.delete(source);
            };
          }

          source.start(0);
        } catch(err) {
          console.error('SE decode error:', err);
          if (msg.reqId) {
            vscode.postMessage({ type: 'VOICE_ENDED', reqId: msg.reqId });
          }
        }
      } else if (msg.type === 'SET_BGM_MASTER_VOL') {
        bgmMasterVol = msg.volume;
        if (currentBgmGain) {
          currentBgmGain.gain.value = bgmMasterVol;
        }
      } else if (msg.type === 'SET_SE_MASTER_VOL') {
        seMasterVol = msg.volume;
      }
    });

    vscode.postMessage({ type: 'READY' });
  </script>
</body>
</html>`;
  }
}
