# wam - WezTerm Agent Manager

複数リポジトリにまたがるAIエージェント（Claude Code, Aider, Codex, Gemini）を1つのTUI画面で一元管理するツール。

[claude-squad](https://github.com/smtg-ai/claude-squad)（tmux版）のWezTerm対応版。Windowsネイティブで動作する。

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

起動するとTUI画面が表示される。左にインスタンス一覧、右にプレビュー/Diff/ターミナル。

## 画面構成

```
┌── Instances (3) ──────┬── Preview  Diff  Terminal ─────────────┐
│                       │                                         │
│ ▸ ● fix-login-bug    │  (選択中Agentの端末出力がリアルタイム表示) │
│   my-webapp | Ꮧ ...  │                                         │
│                       │                                         │
│   ◉ add-api          │                                         │
│   backend | Ꮧ ...    │                                         │
│                       │                                         │
│   ⏸ update-docs      │                                         │
│   my-webapp | Ꮧ ...  │                                         │
│                       │                                         │
├───────────────────────┴─────────────────────────────────────────┤
│ ↑↓ Move  Tab Switch  n New  D Kill  c Pause  r Resume  q Quit  │
└─────────────────────────────────────────────────────────────────┘
```

### ステータスアイコン

| アイコン | 状態 | 意味 |
|----------|------|------|
| `●` (緑) | running | Agentが実行中 |
| `◉` (黄) | ready | Agentが入力待ち（プロンプト表示中） |
| `◌` (青) | loading | 起動中 |
| `⏸` (灰) | paused | 一時停止中（ブランチは保持） |

## キーバインド

### ナビゲーション

| キー | 操作 |
|------|------|
| `↑` / `k` | 前のインスタンスを選択 |
| `↓` / `j` | 次のインスタンスを選択 |
| `Tab` | 右パネルのタブ切替（Preview → Diff → Terminal） |
| `Shift+↑` / `Shift+↓` | Diffビューのスクロール |

### インスタンス管理

| キー | 操作 |
|------|------|
| `n` | 新規インスタンス作成 |
| `N` | プロンプト付きで新規作成 |
| `Enter` / `o` | 選択中AgentのWezTermタブにフォーカス移動 |
| `D` | インスタンスを削除（確認あり） |

### Git操作

| キー | 操作 | 詳細 |
|------|------|------|
| `c` | **Checkout（一時停止）** | 下記参照 |
| `r` | **Resume（再開）** | 下記参照 |
| `p` | **Push** | 下記参照 |

### その他

| キー | 操作 |
|------|------|
| `?` | ヘルプ画面の表示 |
| `q` | wamを終了（Agentはバックグラウンドで生き続ける） |

## Git操作の詳細

### `c` - Checkout（一時停止）

Agentの作業を安全に中断して、リソースを解放する。

**実行される処理:**

1. Agentのworktree内の全変更を自動コミット（`git add -A` + `git commit`）
2. git worktreeをディスクから削除（ブランチは残る）
3. Agentが動いているWezTermペインを閉じる
4. ステータスが `⏸ paused` になる

**使いどころ:**

- Agentの作業を一旦止めて、後で続きをやりたい時
- PCのメモリ/CPU使用を抑えたい時（ペインとworktreeが解放される）
- 長時間放置するインスタンスの整理

**重要:** ブランチと変更は保持される。`r` でいつでも再開可能。

### `r` - Resume（再開）

一時停止したインスタンスを復活させる。

**実行される処理:**

1. 保存されたブランチからgit worktreeを再作成
2. 新しいWezTermペインでAgentを起動（同じコマンド）
3. ステータスが `● running` に戻る

**注意:** Agentは新しいプロセスとして起動するため、以前の会話コンテキストは失われる。ただしコードの変更はブランチに保持されているので、Agentは差分を見て作業を理解できる。

### `p` - Push

Agentが作業したブランチをリモートリポジトリにpushする。

**実行される処理:**

1. `git push --set-upstream origin wam/<instance-name>` を実行

**使いどころ:**

- Agentの作業結果からPull Requestを作成したい時
- 別のマシンやチームメンバーと変更を共有したい時
- バックアップとしてリモートに保存したい時

### `D` - Kill（削除）

インスタンスを完全に削除する。

**実行される処理:**

1. WezTermペインを終了
2. git worktreeを削除
3. ブランチを削除（wamが作成したブランチのみ。既存ブランチは残す）
4. 管理データから削除

**注意:** この操作は元に戻せない。pushしていない変更は失われる。

## インスタンスのライフサイクル

```
n(新規作成)
    ↓
● running ←──────────────────┐
    │                         │
    ├── Enter → Agentのタブに移動（wamのタブに戻れば管理画面）
    │                         │
    ├── p → ブランチをpush     │
    │                         │
    ├── c(一時停止)            │
    │       ↓                 │
    │   ⏸ paused              │
    │       │                 │
    │       ├── r(再開) ──────┘
    │       │
    │       └── D(削除) → 完全削除
    │
    └── D(削除) → 完全削除
```

## 新規インスタンス作成の流れ

`n` を押すと4ステップのウィザードが表示される:

1. **リポジトリパス**: 対象リポジトリのパスを入力（デフォルト: カレントディレクトリ）
2. **インスタンス名**: 名前を入力（例: `fix-auth-bug`）
3. **Agent選択**: claude / aider / codex / gemini から選択
4. **（Nの場合のみ）初期プロンプト**: Agentに送る最初の指示を入力

作成されると:
- WezTermの新しいタブで、指定リポジトリのディレクトリにてAgentが起動する
- `useWorktree: true` の場合のみ、`wam/<instance-name>` ブランチが作成されgit worktreeで隔離される

## 複数リポジトリの一元管理

wamの最大の特徴は、異なるリポジトリのAgentを1画面で管理できること。

```
▸ ● fix-login-bug
    my-webapp | Ꮧ wam/fix-login-bug  +15 -3      ← リポジトリA
  ◉ add-api-endpoint
    backend-api | Ꮧ wam/add-api-endpoint  +42 -0  ← リポジトリB
  ● update-docs
    my-webapp | Ꮧ wam/update-docs  +8 -2          ← リポジトリA（別タスク）
  ⏸ refactor-db
    data-service | Ꮧ wam/refactor-db               ← リポジトリC（一時停止）
```

各インスタンスはリポジトリ名とブランチ名で識別できる。

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

## データ保存先

| ファイル | 用途 |
|---------|------|
| `~/.wezterm-agent-manager/config.json` | 設定 |
| `~/.wezterm-agent-manager/instances.json` | インスタンス状態の永続化 |
| `~/.wezterm-agent-manager/worktrees/` | git worktreeの保存先 |

## 動作要件

- Node.js 18+
- WezTerm（`wezterm cli` がPATHで使えること）
- Git
