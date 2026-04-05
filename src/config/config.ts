import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Profile {
  name: string;
  program: string; // e.g., "claude", "aider --model ollama_chat/gemma3:1b"
}

export interface AppConfig {
  defaultProgram: string;
  autoYes: boolean;
  daemonPollInterval: number; // ms, default 1000
  useWorktree: boolean; // git worktreeで隔離するか（default: false）
  branchPrefix: string; // e.g., "username/"
  profiles: Profile[];
  maxInstances: number; // default 10
}

const DEFAULT_CONFIG: AppConfig = {
  defaultProgram: 'claude',
  autoYes: false,
  daemonPollInterval: 1000,
  useWorktree: false,
  branchPrefix: '',
  profiles: [
    { name: 'claude', program: 'claude' },
    { name: 'aider', program: 'aider' },
    { name: 'codex', program: 'codex' },
    { name: 'gemini', program: 'gemini' },
  ],
  maxInstances: 10,
};

export class Config {
  private config: AppConfig;
  private configPath: string;

  constructor() {
    const configDir = join(homedir(), '.wezterm-agent-manager');
    this.configPath = join(configDir, 'config.json');
    this.config = { ...DEFAULT_CONFIG, profiles: [...DEFAULT_CONFIG.profiles] };
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      this.config = { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      // File doesn't exist or is invalid — use defaults and persist them
      await this.save();
    }
  }

  async save(): Promise<void> {
    const dir = join(homedir(), '.wezterm-agent-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  get(): AppConfig {
    return this.config;
  }

  set(partial: Partial<AppConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
