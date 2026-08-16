# Changelog

All notable changes to the "ScriptMarkDown" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-08-16

初回リリース。

### Added

- `.smd` 用の言語定義・シンタックスハイライト・折りたたみ・スニペット
- VOICEVOX Engine と連携したリアルタイム音声再生（Shift+Enterでの単行再生、連続再生）
- 話者名・スタイル名・SE/BGM/立ち絵パスのインテリセンス補完
- `.se()` / `.bgm()` 行のホバー試聴プレビュー
- 存在しないSE/BGM/立ち絵ファイルを検出するDiagnostics
- 話者アイコン付きガター装飾・行ハイライト
- ステータスバーでの再生状況表示
- `smd.shortcuts` / `smd.speakers` によるsettings.jsonでのカスタマイズ
- `available_param.yaml` エクスポート機能（使用可能な書式・話者・SE/BGM一覧の出力）
- VS Code Language Model Tool APIを通じたAIエージェント連携（話者一覧取得・台本バリデーション）
