export interface SpeakerPreset {
  id: string;
  name: string;
  aliases?: string[];
  styles?: string[];
  styleIds?: number[];
  defaultStyle?: string;
  color?: string;
  portraitBase64?: string;
}

export interface SMDConfig {
  version?: string;
  shortcuts?: Record<string, string>;
  speakers?: SpeakerPreset[];
}
