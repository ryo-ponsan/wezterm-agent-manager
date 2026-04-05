# wam - WezTerm Agent Manager

複数リポジトリにまたがるAIエージェント（Claude Code, Aider, Codex, Gemini）を1つのTUI画面で一元管理するツール。

Inspired by [claude-squad](https://github.com/smtg-ai/claude-squad). While claude-squad uses tmux, wam is built natively on WezTerm CLI — with cross-window agent discovery, multi-repo management, and Windows desktop notifications.

## インストール

```bash
cd wezterm-agent-manager
npm install
npm run build
npm link   # グローバルに wam コマンドを登録
```

## 起動

```bash
wam                # カレントディレクトリをデフォルトリポジトリとして起動
wam -d /path/to    # デフォルトリポジトリを指定して起動
```

起動すると全WezTermウィンドウから実行中のAgentを自動検出し、TUI画面に一覧表示する。

## 主な特徴

- **クロスウィンドウ検出** — 複数のWezTermウィンドウ/プロセスにまたがるAgentを自動発見
- **リアルタイムステータス** — 各Agentが作業中/完了/要対応かをアイコンで表示
- **Agent種別バッジ** — `[C]`laude / `[A]`ider / `[X]` Codex / `[G]`emini をカード上に表示
- **完了時刻** — Agentがdoneになった時刻を表示
- **デスクトップ通知** — Agent完了時やアクション要求時にWindows通知+通知音
- **プロンプト送信** — wamからAgentにプロンプトを直接送信（`>` キー）
- **アクション応答** — 選択肢/確認プロンプトにwamから回答（`>` キー + 矢印/数字）
- **Diff表示** — git diffをvim風スクロールで確認
- **マルチリポジトリ** — 異なるリポジトリのAgentを1画面で管理
- **ワンキー移動** — Enterで選択中Agentのウィンドウ/タブに即フォーカス
- **tmux不要** — WezTerm CLIネイティブ、Windowsで追加依存なし

## 画面構成

```
┌─ Instances (3) ───────────┬─ Preview  Diff ───────────────────────┐
│ ┏━━━━━━━━━━━━━━━━━━━━━━━┓ │                                       │
│ ┃ [C] ⟳ fix-login-bug   ┃ │  (選択中Agentの端末出力が              │
│ ┃ [working] my-webapp    ┃ │   リアルタイム表示される)               │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━┛ │                                       │
│ ┌───────────────────────┐ │                                       │
│ │ [C] ✔ add-api         │ │                                       │
│ │ [done] 19:16 backend  │ │                                       │
│ └───────────────────────┘ │                                       │
│ ┌───────────────────────┐ │                                       │
│ │ [X] ⚠ deploy-staging  │ │                                       │
│ │ [ACTION] infra         │ │                                       │
│ └───────────────────────┘ │                                       │
├───────────────────────────┴───────────────────────────────────────┤
│ ↑↓ Move  Tab Switch  n New  > Send  D Kill  ? Help  q Quit       │
└───────────────────────────────────────────────────────────────────┘
```

### インスタンスカード

各Agentはカード形式で表示される:

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ [C] ⟳ fix-login-bug        ┃  ← Agent種別 + ステータス + タスク名
┃ [working] my-webapp          ┃  ← ステータスラベル + リポジトリ名
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

- 選択中: 太枠 + ステータス色（緑/黄/赤）
- 非選択: 細枠 + グレー
- タスク名は常に太字白で表示

### Agent種別バッジ

| バッジ | Agent | 色 |
|--------|-------|----|
| `[C]` | Claude Code | シアン |
| `[A]` | Aider | 緑 |
| `[X]` | Codex | マゼンタ |
| `[G]` | Gemini | 黄 |
| `[?]` | カスタム | グレー |

### ステータスアイコン

| アイコン | 状態 | 意味 |
|----------|------|------|
| `⟳` (緑) [working] | 作業中 | Agentがコード生成/ツール実行中 |
| `✔` (黄) [done] 19:16 | 完了 | Agentが入力待ち + 完了時刻表示 |
| `⚠` (赤) [ACTION] | 要対応 | ユーザーの選択/許可が必要 |
| `◌` (青) [starting] | 起動中 | 初期化中 |
| `⏸` (灰) [paused] | 停止中 | 一時停止 |

### ステータス判定ロジック

ペーンのテキスト末尾を1.5秒ごとにチェックし、以下の優先順位で判定する:

1. **working**: `esc to interrupt` / `Running...` / スピナーアニメーション（ブライユ文字 `⠋⠙⠹` 等）
2. **action_needed**: 番号付き選択肢 (`❯ 1. Yes`) / 確認プロンプト (`Do you want to proceed?`, `y/n`)
3. **idle (done)**: `❯` プロンプト / `⏵⏵ accept edits` バー / シェルプロンプト
4. 完了報告 (`✻ Worked for 1m 44s`, `✻ Churned for 53s`) は idle 扱い

全パターンは `src/wezterm/patterns.ts` に一元管理されている。Agent側の仕様変更時はこのファイルのみ修正する。

### 通知

| イベント | 通知内容 |
|---------|---------|
| working → done | トースト通知 + 通知音（Agent名表示） |
| → action_needed | トースト通知 + 通知音（`⚠ ACTION: Agent名`） |

Windows: `System.Windows.Forms.NotifyIcon` によるバルーン通知 + `SystemSounds.Asterisk`

## キーバインド

### ナビゲーション

| キー | 操作 |
|------|------|
| `↑` / `k` | 前のインスタンスを選択 |
| `↓` / `j` | 次のインスタンスを選択 |
| `Tab` | 右パネルのタブ切替（Preview ↔ Diff） |

### Diffタブ内（vim風スクロール）

Diffタブ表示中は `j/k` がdiffスクロールに切り替わる:

| キー | 操作 |
|------|------|
| `j` / `↓` | 1行下スクロール |
| `k` / `↑` | 1行上スクロール |
| `d` | 半ページ下 |
| `u` | 半ページ上 |
| `g` | 先頭に移動 |
| `G` | 末尾に移動 |
| `Tab` | Previewタブに戻る（j/kがインスタンス選択に戻る） |

Diffは `git diff` + `git diff --cached`（未コミット変更）を表示。Diffタブ表示中のみ実行される。Agentがworking→doneに遷移した時にも自動取得される。

### インスタンス管理

| キー | 操作 |
|------|------|
| `n` | 新規インスタンス作成 |
| `N` | プロンプト付きで新規作成 |
| `Enter` / `o` | 選択中Agentのウィンドウ/タブにフォーカス移動 |
| `D` | インスタンスを削除（確認あり） |

### Agentとのやりとり

| キー | 状態 | 操作 |
|------|------|------|
| `>` | done / working | プロンプト入力オーバーレイを開き、テキストを送信 |
| `>` | ACTION | アクション応答モードに入る（下記参照） |

#### `>` プロンプト送信（done / working 時）

wamの画面からAgentにプロンプトを直接送信できる:

1. `>` を押すと入力オーバーレイが表示される
2. プロンプトを入力して Enter で送信
3. テキストがAgentのペーンに送られ、Enterも自動送信される
4. ステータスが自動的にworkingに切り替わる

#### `>` アクション応答（ACTION 時）

Agentが選択肢や確認プロンプトを表示している場合:

1. `>` を押すとアクション応答モードに入る
2. `↑` / `↓` で選択肢を移動（矢印キーがAgentに転送される）
3. `Enter` で確定
4. `1`〜`9` の数字キーで直接選択＋確定
5. `Esc` でキャンセル

### Git操作（useWorktree有効時）

| キー | 操作 |
|------|------|
| `c` | Checkout — 変更をcommitしてAgent停止。ブランチは保持 |
| `r` | Resume — 停止したAgentをブランチから再開 |
| `p` | Push — ブランチをリモートにpush |

### その他

| キー | 操作 |
|------|------|
| `?` | ヘルプ画面の表示 |
| `q` | wamを終了（Agentはバックグラウンドで生き続ける） |

## 自動検出の仕組み

wam起動時に、以下の手順で全WezTermウィンドウからAgentを自動検出する:

1. PowerShellで全 `wezterm-gui` プロセスのPIDを取得
2. 各PIDのUnixドメインソケット (`~/.local/share/wezterm/gui-sock-{PID}`) に接続
3. `wezterm cli list --format json` で全ペーンを列挙
4. 各ペーンのタイトルとテキスト内容をチェック:
   - タイトルに `claude`, `aider` 等が含まれる → 検出
   - テキスト末尾にAgent固有のUI要素がある → 検出（Claude Code: `╭─`, `❯`, `⏵⏵ accept` 等）

検出パターンは `src/wezterm/patterns.ts` の `AGENT_SIGNATURES` に定義されている。

## 新規インスタンス作成の流れ

`n` を押すと3ステップのウィザードが表示される:

1. **リポジトリパス**: 対象リポジトリのパスを入力（デフォルト: カレントディレクトリ）
2. **インスタンス名**: 名前を入力（例: `fix-auth-bug`）
3. **Agent選択**: claude / aider / codex / gemini から選択

`N` の場合は追加で初期プロンプトを入力できる。

## 複数リポジトリの一元管理

異なるリポジトリのAgentを1画面で管理できる:

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ [C] ⟳ fix-login-bug          ┃
┃ [working] my-webapp            ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┌──────────────────────────────┐
│ [C] ✔ add-api-endpoint       │
│ [done] 19:16 backend-api      │
└──────────────────────────────┘
┌──────────────────────────────┐
│ [X] ⟳ update-docs            │
│ [working] my-webapp           │
└──────────────────────────────┘
┌──────────────────────────────┐
│ [C] ⚠ deploy-staging         │
│ [ACTION] infra-repo           │
└──────────────────────────────┘
```

## 設定

設定ファイル: `~/.wezterm-agent-manager/config.json`

```json
{
  "defaultProgram": "claude",
  "autoYes": false,
  "daemonPollInterval": 1000,
  "useWorktree": false,
  "branchPrefix": "",
  "profiles": [
    { "name": "claude", "program": "claude" },
    { "name": "aider", "program": "aider" },
    { "name": "codex", "program": "codex" },
    { "name": "gemini", "program": "gemini" }
  ],
  "maxInstances": 10
}
```

### カスタムプロファイル

`profiles` にエントリを追加すると、Agent選択画面に表示される:

```json
{
  "profiles": [
    { "name": "claude", "program": "claude" },
    { "name": "claude-fast", "program": "claude --fast" },
    { "name": "aider-local", "program": "aider --model ollama_chat/gemma3:1b" }
  ]
}
```

### useWorktree（デフォルト: false）

`useWorktree: true` にすると、各インスタンスがgit worktreeで隔離ブランチに切り出される。同じリポジトリで複数Agentが同時にファイルを編集する場合に衝突を防げる。

通常は `false`（デフォルト）で十分。各Agentは指定リポジトリのディレクトリで直接起動する。

## パターン定義のカスタマイズ

`src/wezterm/patterns.ts` にAgent検出・ステータス判定の全パターンが集約されている:

```
patterns.ts
├── AGENT_SIGNATURES         — どのペーンがAgentか識別
├── WORKING_PATTERNS         — 確実にworking判定する文字列
├── COMPLETION_SUMMARY       — 完了報告（"Worked for", "Churned for"）
├── SPINNER_CHARS            — アニメスピナー文字セット（U+2800-28FF等）
├── ACTION_NEEDED_PATTERNS   — ユーザー操作が必要な選択肢/確認
├── IDLE_PATTERNS            — 入力待ち判定
├── isSpinnerLine()          — スピナー行の判定
├── isShellPrompt()          — 汎用シェルプロンプト検出
└── isUIChromeLine()         — wam自身のUI行を除外
```

Agent側のUI仕様が変更された場合は、このファイルのみ修正すればよい。

## データ保存先

| ファイル | 用途 |
|---------|------|
| `~/.wezterm-agent-manager/config.json` | 設定 |
| `~/.wezterm-agent-manager/instances.json` | インスタンス状態（起動時に再スキャンされる） |
| `~/.wezterm-agent-manager/worktrees/` | git worktreeの保存先（useWorktree有効時のみ） |

## 動作要件

- Node.js 18+
- WezTerm（`wezterm cli` がPATHで使えること）
- Git
- Windows 10/11（クロスウィンドウ検出・通知はWindows専用。macOS/Linuxではシングルウィンドウ+ベル音で動作）
