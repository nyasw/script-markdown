import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './config.js';

export class CatalogExporter {
  constructor(private configManager: ConfigManager) {}

  /**
   * Scans workspace/settings for syntax rules, directives, speakers, and sound assets,
   * then exports them into a clean available_param.yaml file.
   */
  public async exportCatalogYaml(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri.fsPath
      : (vscode.window.activeTextEditor ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath) : undefined);

    if (!rootPath) {
      vscode.window.showWarningMessage('保存先のワークスペースフォルダーが見つかりません。');
      return;
    }

    const mergedConfig = this.configManager.getMergedConfig();
    const config = vscode.workspace.getConfiguration('smd');

    // 0. Syntax Rules
    const syntaxRules = [
      {
        rule: "1台詞1行の原則",
        syntax: "話者名> セリフ本文",
        description: "1つのセリフは1行で記述し、上から下へ順番に評価・連続再生されます。",
        example: "ずんだもん> こんにちはなのだ！"
      },
      {
        rule: "一時的なスタイル切り替え",
        syntax: "話者名.スタイル名> セリフ本文",
        description: "声質（スタイル）を一時的に変更して発声させます。",
        example: "四国めたん.ツンツン> ごきげんよう、勘違いしないでほしいですわ！"
      },
      {
        rule: "ルビ表記（読み補正）",
        syntax: "[表記|よみ]",
        description: "テキスト表示は「表記」、VOICEVOX音声読上げは「よみ」で行われます。",
        example: "ずんだもん> [本気|マジ]で[応援|おうえん]するのだ！"
      },
      {
        rule: "インライン演出パラメータ上書き",
        syntax: "話者名> セリフ本文 .speed(1.2).pause_length(1.5)",
        description: "セリフ行の末尾に直付けすることで、その1行限定で話速や無音間隔、演出パラメータを一時変更します。",
        example: "四国めたん> チャイムが鳴りましたわ！.se('/chime.wav').pause_length(1.5)"
      },
      {
        rule: "プリセット宣言による一括規定値設定",
        syntax: "preset.all.speed(1.1) や preset.'話者名'.speed(1.2) preset.bgm preset.se",
        description: "ファイル上部に記述することで、それ以降に現れる全セリフまたは特定キャラの既定値を変更します。(見出し内での記述はスコープされる)",
        example: "preset.all.speed(1.1).pause_length(1.2)"
      },
      {
        rule: "画面表示テロップ行",
        syntax: "> テロップ文章",
        description: "画面字幕表示専用の行です。音声合成を行わず、演出やテロップ表示に使用します。",
        example: "> ※効果音とともに画面にタイトルを表示"
      },
      {
        rule: "コメント行",
        syntax: "// コメント または /* ブロックコメント */",
        description: "処理・音声読み上げから完全に無視される注釈行です。",
        example: "// ここから第2章のシナリオを開始"
      }
    ];

    // 1. Available Directives & Formats
    const directives = [
      {
        name: "speaker_dialogue",
        format: "話者名> セリフ本文",
        description: "基本セリフ発声（1台詞1行の原則）",
        example: "ずんだもん> こんにちはなのだ！"
      },
      {
        name: "speaker_style_dialogue",
        format: "話者名.スタイル名> セリフ本文",
        description: "一時的な声質・スタイル切り替え発声",
        example: "四国めたん.ツンツン> ごきげんよう！"
      },
      {
        name: "ruby",
        format: "[表記|読み]",
        description: "ルビ表記（画面表示は「表記」、VOICEVOX読みは「読み」）",
        example: "ずんだもん> [本気|マジ]で応援するのだ！"
      },
      {
        name: "telop",
        format: "> テロップ文章",
        description: "画面字幕・表示専用テロップ行（音声合成なし）",
        example: "> ※効果音とともに画面に字幕表示"
      },
      {
        name: "preset_all",
        format: "preset.all.speed(1.1).pitch(0.02)...",
        description: "全キャラクター全体の演出規定値の一括設定",
        example: "preset.all.speed(1.1).pause_length(1.2)"
      },
      {
        name: "preset_speaker",
        format: "preset.'話者名'.speed(1.2)...",
        description: "特定話者専用の演出規定値の設定",
        example: "preset.'ずんだもん'.speed(1.25)"
      },
      {
        name: "speed",
        format: ".speed(倍率)",
        description: "話速倍率 (0.5〜2.0)",
        example: "ずんだもん> 速く喋るのだ！.speed(1.3)"
      },
      {
        name: "pitch",
        format: ".pitch(数値)",
        description: "音高ピッチ (-0.15〜0.15)",
        example: "四国めたん> 声を高くしますわ！.pitch(0.04)"
      },
      {
        name: "intonation",
        format: ".intonation(倍率)",
        description: "抑揚倍率 (0.0〜2.0)",
        example: "ずんだもん> 感情豊かに喋るのだ！.intonation(1.2)"
      },
      {
        name: "volume",
        format: ".volume(倍率)",
        description: "音量倍率 (0.0〜2.0)",
        example: "四国めたん> 大きな声で！.volume(1.3)"
      },
      {
        name: "pause_length",
        format: ".pause_length(倍率)",
        description: "文中の「間」や読点の長さ倍率",
        example: "ずんだもん> タメを作るのだ！.pause_length(1.8)"
      },
      {
        name: "pre_silence",
        format: ".pre_silence(秒数)",
        description: "発音開始前の無音時間秒数",
        example: ".pre_silence(0.2)"
      },
      {
        name: "post_silence",
        format: ".post_silence(秒数)",
        description: "発音終了後の無音時間秒数",
        example: ".post_silence(0.3)"
      },
      {
        name: "bgm",
        format: ".bgm('ファイルパス', 音量)",
        description: "BGM再生・変更・空指定で停止",
        example: ".bgm('/bgm/cheerful.mp3')"
      },
      {
        name: "se",
        format: ".se('ファイルパス', 音量)",
        description: "SE (効果音) 再生（単独行またはインライン直付け）",
        example: ".se('/se/chime.wav')"
      },
      {
        name: "wait",
        format: ".wait(秒数)",
        description: "無音ウェイト待機",
        example: ".wait(1.5)"
      },
      {
        name: "font",
        format: ".font('フォント名')",
        description: "テキストフォント指定（演出用）**未実装**",
        example: ".font('Noto Sans')"
      },
      {
        name: "tatie",
        format: ".tatie('立ち絵グラフィック名')",
        description: "立ち絵グラフィック切り替え",
        example: ".tatie('笑顔') **未実装**"
      }
    ];

    // 2. Speakers & Styles
    const speakers = (mergedConfig.speakers || []).map((s: any) => ({
      name: s.name,
      styles: s.styles || ['ノーマル'],
      defaultStyle: s.defaultStyle || (s.styles ? s.styles[0] : 'ノーマル')
    }));

    // 3. Scan Available SE & BGM Files (without leading /se or /bgm)
    const validAudioExts = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac'];

    const scanDirectory = (dirPath: string): string[] => {
      const list: string[] = [];
      if (!dirPath || !fs.existsSync(dirPath)) return list;

      const walk = (currentDir: string, currentRel: string) => {
        try {
          const files = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const file of files) {
            const full = path.join(currentDir, file.name);
            const rel = path.join(currentRel, file.name);
            if (file.isDirectory()) {
              walk(full, rel);
            } else if (file.isFile()) {
              const ext = path.extname(file.name).toLowerCase();
              if (validAudioExts.includes(ext)) {
                list.push(`/${rel.replace(/\\/g, '/')}`);
              }
            }
          }
        } catch (e) {
          // ignore
        }
      };

      walk(dirPath, '');
      return list;
    };

    // Sound Effects Scan (no leading /se)
    const soundEffectsSet = new Set<string>();
    const customSeDir = config.get<string>('seDir', '');
    if (customSeDir) {
      scanDirectory(customSeDir).forEach(f => soundEffectsSet.add(f));
    }
    scanDirectory(path.join(rootPath, 'se')).forEach(f => soundEffectsSet.add(f));
    scanDirectory(path.join(rootPath, 'sounds')).forEach(f => soundEffectsSet.add(f));

    // BGM Scan (no leading /bgm)
    const bgmSet = new Set<string>();
    const customBgmDir = config.get<string>('bgmDir', '');
    if (customBgmDir) {
      scanDirectory(customBgmDir).forEach(f => bgmSet.add(f));
    }
    scanDirectory(path.join(rootPath, 'bgm')).forEach(f => bgmSet.add(f));
    scanDirectory(path.join(rootPath, 'music')).forEach(f => bgmSet.add(f));

    const outputData = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      syntaxRules,
      directives,
      speakers,
      soundEffects: Array.from(soundEffectsSet).sort(),
      bgmList: Array.from(bgmSet).sort()
    };

    const yamlContent = this.serializeToYaml(outputData);

    const targetYamlPath = path.join(rootPath, 'available_param.yaml');
    fs.writeFileSync(targetYamlPath, yamlContent, 'utf8');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetYamlPath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`使用可能なパラメータ・話者・素材一覧をYAML出力しました！: available_param.yaml`);
  }

  /**
   * Helper function to stringify catalog into clean human-readable YAML
   */
  private serializeToYaml(outputData: any): string {
    const formatYamlStr = (str: string): string => {
      if (!str) return '""';
      if (str.includes('\n') || str.includes(':') || str.includes('#')) {
        return `"${str.replace(/"/g, '\\"')}"`;
      }
      return `"${str}"`;
    };

    let yamlContent = `# ScriptMarkDown Available Parameters & Resources Catalog\n`;
    yamlContent += `version: "${outputData.version}"\n`;
    yamlContent += `generatedAt: "${outputData.generatedAt}"\n\n`;

    yamlContent += `# 0. Syntax Rules (基本記法ルール)\n`;
    yamlContent += `syntaxRules:\n`;
    for (const r of outputData.syntaxRules) {
      yamlContent += `  - rule: ${formatYamlStr(r.rule)}\n`;
      yamlContent += `    syntax: ${formatYamlStr(r.syntax)}\n`;
      yamlContent += `    description: ${formatYamlStr(r.description)}\n`;
      yamlContent += `    example: ${formatYamlStr(r.example)}\n`;
    }
    yamlContent += `\n`;

    yamlContent += `# 1. Directives & Formats (使用可能な書式・演出ディレクティブ)\n`;
    yamlContent += `directives:\n`;
    for (const d of outputData.directives) {
      yamlContent += `  - name: ${formatYamlStr(d.name)}\n`;
      yamlContent += `    format: ${formatYamlStr(d.format)}\n`;
      yamlContent += `    description: ${formatYamlStr(d.description)}\n`;
      yamlContent += `    example: ${formatYamlStr(d.example)}\n`;
    }
    yamlContent += `\n`;

    yamlContent += `# 2. Speakers & Styles (話者・スタイル一覧)\n`;
    yamlContent += `speakers:\n`;
    for (const s of outputData.speakers) {
      yamlContent += `  - name: ${formatYamlStr(s.name)}\n`;
      yamlContent += `    defaultStyle: ${formatYamlStr(s.defaultStyle)}\n`;
      const formattedStyles = s.styles.map((st: string) => formatYamlStr(st)).join(', ');
      yamlContent += `    styles: [${formattedStyles}]\n`;
    }
    yamlContent += `\n`;

    yamlContent += `# 3. Sound Effects (使用可能なSE音素材ファイル)\n`;
    yamlContent += `soundEffects:\n`;
    if (outputData.soundEffects.length === 0) {
      yamlContent += `  []\n`;
    } else {
      for (const sePath of outputData.soundEffects) {
        yamlContent += `  - ${formatYamlStr(sePath)}\n`;
      }
    }
    yamlContent += `\n`;

    yamlContent += `# 4. BGM (使用可能なBGM素材ファイル)\n`;
    yamlContent += `bgmList:\n`;
    if (outputData.bgmList.length === 0) {
      yamlContent += `  []\n`;
    } else {
      for (const bgmPath of outputData.bgmList) {
        yamlContent += `  - ${formatYamlStr(bgmPath)}\n`;
      }
    }

    return yamlContent;
  }
}
