import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SMDConfig } from './types.js';

export class ConfigManager {
  private defaultPresetsPath: string;

  constructor(private extensionPath: string) {
    this.defaultPresetsPath = path.join(extensionPath, 'presets.json');
  }

  /**
   * Reads default presets.json bundled with the extension
   */
  public getDefaultPresets(): SMDConfig {
    try {
      if (fs.existsSync(this.defaultPresetsPath)) {
        const raw = fs.readFileSync(this.defaultPresetsPath, 'utf8');
        return JSON.parse(raw) as SMDConfig;
      }
    } catch (err) {
      console.error('Failed to read default presets.json:', err);
    }
    return {};
  }

  /**
   * Reads settings from VS Code settings.json (smd.shortcuts, smd.speakers)
   */
  public getVscodeSettingsConfig(): SMDConfig {
    const config = vscode.workspace.getConfiguration('smd');
    const settingsShortcuts = config.get<Record<string, string>>('shortcuts');
    const settingsSpeakers = config.get<any[]>('speakers');

    const result: SMDConfig = {};
    if (settingsShortcuts && Object.keys(settingsShortcuts).length > 0) {
      result.shortcuts = settingsShortcuts;
    }
    if (settingsSpeakers && settingsSpeakers.length > 0) {
      result.speakers = settingsSpeakers;
    }
    return result;
  }

  /**
   * Merges default presets with VS Code settings.json (User & Workspace settings.json)
   */
  public getMergedConfig(): SMDConfig {
    const defaults = this.getDefaultPresets();
    const vscodeSettings = this.getVscodeSettingsConfig();

    const mergedShortcuts = {
      ...(defaults.shortcuts || {}),
      ...(vscodeSettings.shortcuts || {})
    };

    const baseSpeakers = [...(defaults.speakers || [])];

    if (vscodeSettings.speakers) {
      for (const sp of vscodeSettings.speakers) {
        const idx = baseSpeakers.findIndex(t => t.id === sp.id || t.name === sp.name);
        if (idx !== -1) {
          baseSpeakers[idx] = { ...baseSpeakers[idx], ...sp };
        } else {
          baseSpeakers.push(sp);
        }
      }
    }

    return {
      version: defaults.version || '1.0',
      shortcuts: mergedShortcuts,
      speakers: baseSpeakers
    };
  }
}
