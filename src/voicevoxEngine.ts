import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ConfigManager } from './config.js';
import { SmdParser, ParsedLineVoiceParams } from './smdParser.js';

export class VoicevoxEngineClient {
  private cacheDir: string;
  private smdParser: SmdParser;

  constructor(
    private configManager: ConfigManager
  ) {
    this.cacheDir = path.join(os.tmpdir(), 'smd-voice-cache');
    this.smdParser = new SmdParser(configManager);
    this.initCacheDir();
  }

  public getSmdParser(): SmdParser {
    return this.smdParser;
  }

  private initCacheDir(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      } else {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.wav')) {
            try {
              fs.unlinkSync(path.join(this.cacheDir, file));
            } catch (e) {
              // ignore locked files
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to initialize voice cache dir:', e);
    }
  }

  public getEngineUrl(): string {
    const config = vscode.workspace.getConfiguration('smd');
    return config.get<string>('engineUrl', 'http://localhost:50021').replace(/\/+$/, '');
  }

  /**
   * Delegate style_id resolution to SmdParser
   */
  public resolveStyleId(speakerNameOrAlias: string, styleName?: string): number {
    return this.smdParser.resolveStyleId(speakerNameOrAlias, styleName);
  }

  /**
   * Synthesize WAV and return temporary file path without playing automatically
   */
  public async synthesizeToWavPath(params: ParsedLineVoiceParams): Promise<string | null> {
    const engineUrl = this.getEngineUrl();
    const styleId = this.smdParser.resolveStyleId(params.speakerNameOrAlias, params.styleName);

    try {
      const queryUrl = `${engineUrl}/audio_query?text=${encodeURIComponent(params.text)}&speaker=${styleId}`;
      const queryRes = await fetch(queryUrl, { method: 'POST' });

      if (!queryRes.ok) {
        return null;
      }

      const audioQuery = await queryRes.json() as any;

      if (params.speed !== undefined) {
        audioQuery.speedScale = params.speed;
      }
      if (params.pitch !== undefined) {
        audioQuery.pitchScale = params.pitch;
      }
      if (params.intonation !== undefined) {
        audioQuery.intonationScale = params.intonation;
      }
      if (params.volume !== undefined) {
        audioQuery.volumeScale = params.volume;
      }
      if (params.pauseLength !== undefined) {
        audioQuery.pauseLengthScale = params.pauseLength;
      }
      if (params.preSilence !== undefined) {
        audioQuery.prePhonemeLength = params.preSilence;
      }
      if (params.postSilence !== undefined) {
        audioQuery.postPhonemeLength = params.postSilence;
      }

      const synthesisUrl = `${engineUrl}/synthesis?speaker=${styleId}`;
      const synthRes = await fetch(synthesisUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioQuery)
      });

      if (!synthRes.ok) {
        return null;
      }

      const arrayBuffer = await synthRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const tempWavPath = path.join(this.cacheDir, `voice_${Date.now()}_${Math.random()}.wav`);
      fs.writeFileSync(tempWavPath, buffer);
      return tempWavPath;
    } catch (err: any) {
      return null;
    }
  }

  /**
   * Show a consistent connection-failure error, used by every playback entry point in commands.ts
   * so the user is always told the actual engine URL that failed, not a generic message.
   */
  public notifyConnectionFailure(): void {
    const engineUrl = this.getEngineUrl();
    vscode.window.showErrorMessage(`VOICEVOX Engine に接続できませんでした (${engineUrl})。Engineが起動しているか確認してください。`);
  }

  /**
   * Fetch speaker portraits (Base64) from VOICEVOX Engine API at file open/startup,
   * store in JSON / tmp files, and return Map of speaker name/id -> portrait PNG file path.
   */
  public async fetchAndCacheSpeakerPortraits(): Promise<Map<string, string>> {
    const portraitMap = new Map<string, string>();
    const portraitDir = path.join(os.tmpdir(), 'smd-speaker-portraits');

    try {
      if (!fs.existsSync(portraitDir)) {
        fs.mkdirSync(portraitDir, { recursive: true });
      }
    } catch (e) {
      console.error('Failed to create portrait cache directory:', e);
    }

    const engineUrl = this.getEngineUrl();
    const config = this.configManager.getMergedConfig();
    const speakers = config.speakers || [];

    try {
      const res = await fetch(`${engineUrl}/speakers`);
      if (res.ok) {
        const rawSpeakers = await res.json() as any[];
        for (const spObj of rawSpeakers) {
          const uuid = spObj.speaker_uuid;
          const name = spObj.name;
          if (uuid) {
            try {
              const infoRes = await fetch(`${engineUrl}/speaker_info?speaker_uuid=${encodeURIComponent(uuid)}`);
              if (infoRes.ok) {
                const infoData = await infoRes.json() as any;
                const defaultIconBase64 = (infoData.style_infos && infoData.style_infos[0]?.icon) || infoData.icon || infoData.portrait;

                if (defaultIconBase64) {
                  const base64Clean = defaultIconBase64.replace(/^data:image\/\w+;base64,/, '');
                  const imgBuffer = Buffer.from(base64Clean, 'base64');
                  const safeName = name.replace(/[\/\\?%*:|"<>]/g, '_');
                  const targetPngPath = path.join(portraitDir, `${safeName}.png`);

                  fs.writeFileSync(targetPngPath, imgBuffer);

                  portraitMap.set(name, targetPngPath);
                  if (spObj.name) portraitMap.set(spObj.name, targetPngPath);
                  
                  // Also match with config speaker id/aliases
                  const matchConfigSp = speakers.find(s => s.name === name || s.id === name || s.aliases?.includes(name));
                  if (matchConfigSp) {
                    portraitMap.set(matchConfigSp.id, targetPngPath);
                    matchConfigSp.aliases?.forEach(a => portraitMap.set(a, targetPngPath));
                  }
                }

                // Cache style-specific icons if available
                if (infoData.style_infos && Array.isArray(infoData.style_infos)) {
                  for (const styleInfo of infoData.style_infos) {
                    if (styleInfo.icon) {
                      const matchSp = rawSpeakers.find((s: any) => s.speaker_uuid === uuid);
                      const matchStyleObj = matchSp?.styles?.find((st: any) => st.id === styleInfo.id);
                      if (matchStyleObj) {
                        const styleName = matchStyleObj.name;
                        const styleIconClean = styleInfo.icon.replace(/^data:image\/\w+;base64,/, '');
                        const styleImgBuffer = Buffer.from(styleIconClean, 'base64');
                        const styleSafeName = `${name}_${styleName}`.replace(/[\/\\?%*:|"<>]/g, '_');
                        const styleTargetPngPath = path.join(portraitDir, `${styleSafeName}.png`);

                        fs.writeFileSync(styleTargetPngPath, styleImgBuffer);
                        portraitMap.set(`${name}.${styleName}`, styleTargetPngPath);
                      }
                    }
                  }
                }
              }
            } catch (err) {
              // Ignore individual speaker_info fetch errors
            }
          }
        }
      }
    } catch (err) {
      console.log('VOICEVOX Engine not reachable for portraits, checking fallback cache.');
    }

    return portraitMap;
  }
}
