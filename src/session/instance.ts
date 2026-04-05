export type InstanceStatus = 'running' | 'ready' | 'action_needed' | 'loading' | 'paused';
export type ProgramType = 'claude' | 'aider' | 'codex' | 'gemini' | 'custom';

export interface InstanceData {
  id: string;
  title: string;
  program: ProgramType;
  programCommand: string;
  status: InstanceStatus;
  branch: string;
  repoPath: string;
  worktreePath: string;
  paneId: number | null;
  weztermSocket: string | null; // Socket path for cross-process WezTerm access
  autoYes: boolean;
  diffStats: { added: number; removed: number; files: number } | null;
  doneAt: string | null;  // ISO timestamp when agent last became done/idle
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_COMMANDS: Record<ProgramType, string> = {
  claude: 'claude',
  aider: 'aider',
  codex: 'codex',
  gemini: 'gemini',
  custom: '',
};

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

export class Instance {
  data: InstanceData;

  constructor(data: InstanceData) {
    this.data = data;
  }

  static create(
    title: string,
    program: ProgramType,
    repoPath: string,
    command?: string,
  ): Instance {
    const now = new Date().toISOString();
    const data: InstanceData = {
      id: generateId(),
      title,
      program,
      programCommand: command ?? DEFAULT_COMMANDS[program],
      status: 'loading',
      branch: '',
      repoPath,
      worktreePath: '',
      paneId: null,
      weztermSocket: null,
      autoYes: false,
      diffStats: null,
      doneAt: null,
      createdAt: now,
      updatedAt: now,
    };
    return new Instance(data);
  }

  toJSON(): InstanceData {
    return { ...this.data };
  }

  static fromJSON(data: InstanceData): Instance {
    return new Instance(data);
  }

  setStatus(status: InstanceStatus): void {
    this.data.status = status;
    this.data.updatedAt = new Date().toISOString();
    if (status === 'ready') {
      this.data.doneAt = new Date().toISOString();
    }
  }

  setPaneId(paneId: number): void {
    this.data.paneId = paneId;
    this.data.updatedAt = new Date().toISOString();
  }

  setDiffStats(stats: { added: number; removed: number; files: number }): void {
    this.data.diffStats = stats;
    this.data.updatedAt = new Date().toISOString();
  }
}
