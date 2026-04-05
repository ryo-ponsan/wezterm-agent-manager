import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export interface WorktreeInfo {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  isPreExisting: boolean;
}

export interface DiffStats {
  added: number;
  removed: number;
  files: number;
  content: string;
}

const WORKTREE_BASE = path.join(os.homedir(), '.wezterm-agent-manager', 'worktrees');

/**
 * Normalize a path for git on Windows: convert backslashes to forward slashes.
 */
function gitPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export class GitWorktree {
  private _info: WorktreeInfo;
  private repoGit: SimpleGit;
  private worktreeGit: SimpleGit;

  private constructor(info: WorktreeInfo) {
    this._info = info;
    this.repoGit = simpleGit(info.repoPath);
    this.worktreeGit = simpleGit(info.worktreePath);
  }

  get info(): WorktreeInfo {
    return { ...this._info };
  }

  /**
   * Create a new worktree from the current HEAD of repoPath.
   * Branch name follows the pattern: wam/<name>
   */
  static async create(repoPath: string, name: string): Promise<GitWorktree> {
    const resolvedRepo = path.resolve(repoPath);
    const git = simpleGit(resolvedRepo);

    const branchName = `wam/${name}`;
    const worktreePath = path.join(WORKTREE_BASE, name);

    // Ensure the worktrees base directory exists
    await fs.mkdir(WORKTREE_BASE, { recursive: true });

    // Get current HEAD commit
    const baseCommit = (await git.revparse(['HEAD'])).trim();

    // Check if branch already exists
    const branchSummary = await git.branchLocal();
    const isPreExisting = branchSummary.all.includes(branchName);

    if (isPreExisting) {
      // Worktree from existing branch
      await git.raw(['worktree', 'add', gitPath(worktreePath), branchName]);
    } else {
      // Create new branch at current HEAD
      await git.raw(['worktree', 'add', '-b', branchName, gitPath(worktreePath), 'HEAD']);
    }

    const info: WorktreeInfo = {
      repoPath: resolvedRepo,
      worktreePath,
      branchName,
      baseCommit,
      isPreExisting,
    };

    return new GitWorktree(info);
  }

  /**
   * Create a worktree from an existing branch.
   * The name is derived from the branch name (stripping wam/ prefix if present).
   */
  static async createFromBranch(repoPath: string, branchName: string): Promise<GitWorktree> {
    const resolvedRepo = path.resolve(repoPath);
    const git = simpleGit(resolvedRepo);

    // Derive worktree directory name from branch
    const dirName = branchName.startsWith('wam/') ? branchName.slice(4) : branchName;
    const worktreePath = path.join(WORKTREE_BASE, dirName);

    // Ensure the worktrees base directory exists
    await fs.mkdir(WORKTREE_BASE, { recursive: true });

    // Verify branch exists
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(branchName)) {
      throw new Error(`Branch '${branchName}' does not exist in ${resolvedRepo}`);
    }

    // Get the branch tip as the base commit
    const baseCommit = (await git.revparse([branchName])).trim();

    // Create worktree from existing branch
    await git.raw(['worktree', 'add', gitPath(worktreePath), branchName]);

    const info: WorktreeInfo = {
      repoPath: resolvedRepo,
      worktreePath,
      branchName,
      baseCommit,
      isPreExisting: true,
    };

    return new GitWorktree(info);
  }

  /**
   * Reconstruct a GitWorktree instance from previously saved info.
   * Does not create anything on disk -- use this for deserialization.
   */
  static fromInfo(info: WorktreeInfo): GitWorktree {
    return new GitWorktree(info);
  }

  /**
   * Reconstruct from worktree path on disk (for use by App when it only has the path).
   * Reads .git file in the worktree to determine the repo path and branch.
   */
  static async fromExisting(worktreePath: string): Promise<GitWorktree> {
    const git = simpleGit(worktreePath);
    const topLevel = (await git.revparse(['--show-toplevel'])).trim();
    const branchName = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

    // Try to determine the main repo path from the worktree's .git file
    let repoPath = topLevel;
    try {
      const gitFileContent = await fs.readFile(path.join(worktreePath, '.git'), 'utf-8');
      const match = gitFileContent.match(/gitdir:\s*(.+)/);
      if (match) {
        // The gitdir points to .git/worktrees/<name> in the main repo
        const gitdir = path.resolve(worktreePath, match[1].trim());
        repoPath = path.resolve(gitdir, '..', '..', '..');
      }
    } catch {
      // Not a worktree or .git is a directory — use topLevel
    }

    const baseCommit = (await git.revparse(['HEAD'])).trim();

    return new GitWorktree({
      repoPath,
      worktreePath: path.resolve(worktreePath),
      branchName,
      baseCommit,
      isPreExisting: false,
    });
  }

  /**
   * Get diff stats between the base commit and the current working state.
   */
  async getDiff(): Promise<DiffStats> {
    const { baseCommit } = this._info;

    // Stage everything so we see untracked files in the diff
    // Use diff against base commit including unstaged and untracked
    const content = await this.worktreeGit.diff([baseCommit, '--stat-count=9999']);
    const fullDiff = await this.worktreeGit.diff([baseCommit]);

    let added = 0;
    let removed = 0;
    let files = 0;

    // Parse --stat output for counts
    const statLines = content.trim().split('\n');
    for (const line of statLines) {
      // Match lines like: " file.ts | 10 +++---"
      const match = line.match(/\|\s+(\d+)\s+(\+*)(-*)/);
      if (match) {
        files++;
        added += match[2].length;
        removed += match[3].length;
      }
    }

    // If stat parsing didn't yield useful numbers, fall back to diffSummary
    if (files === 0) {
      const summary = await this.worktreeGit.diffSummary([baseCommit]);
      added = summary.insertions;
      removed = summary.deletions;
      files = summary.changed;
    }

    return { added, removed, files, content: fullDiff };
  }

  /**
   * Stage and commit all changes in the worktree.
   */
  async commitChanges(message?: string): Promise<void> {
    // Stage all changes including untracked files
    await this.worktreeGit.add(['-A']);

    // Check if there is anything to commit
    const status = await this.worktreeGit.status();
    if (status.isClean()) {
      return;
    }

    const commitMsg = message ?? `wam: auto-commit changes`;
    await this.worktreeGit.commit(commitMsg);
  }

  /**
   * Push the worktree branch to origin.
   */
  async push(): Promise<void> {
    await this.worktreeGit.push('origin', this._info.branchName, ['--set-upstream']);
  }

  /**
   * Pause: commit any uncommitted changes, then remove the worktree but keep the branch.
   */
  async pause(): Promise<void> {
    // Commit any pending changes
    await this.commitChanges('wam: auto-save before pause');

    // Remove the worktree (keep the branch)
    await this.repoGit.raw(['worktree', 'remove', gitPath(this._info.worktreePath), '--force']);

    // Clean up the directory if it still exists
    try {
      await fs.rm(this._info.worktreePath, { recursive: true, force: true });
    } catch {
      // Directory may already be gone
    }
  }

  /**
   * Resume: recreate the worktree from the saved branch.
   */
  async resume(): Promise<void> {
    await fs.mkdir(WORKTREE_BASE, { recursive: true });

    // Prune stale worktree references
    await this.repoGit.raw(['worktree', 'prune']);

    // Recreate worktree from the existing branch
    await this.repoGit.raw([
      'worktree', 'add',
      gitPath(this._info.worktreePath),
      this._info.branchName,
    ]);

    // Re-initialize the worktree git instance
    this.worktreeGit = simpleGit(this._info.worktreePath);
  }

  /**
   * Cleanup: remove the worktree and delete the branch (unless it was pre-existing).
   */
  async cleanup(): Promise<void> {
    // Try to remove the worktree via git
    try {
      await this.repoGit.raw(['worktree', 'remove', gitPath(this._info.worktreePath), '--force']);
    } catch {
      // Worktree may already be removed
    }

    // Ensure directory is gone
    try {
      await fs.rm(this._info.worktreePath, { recursive: true, force: true });
    } catch {
      // Already gone
    }

    // Prune worktree references
    await this.repoGit.raw(['worktree', 'prune']);

    // Delete the branch only if we created it
    if (!this._info.isPreExisting) {
      try {
        await this.repoGit.branch(['-D', this._info.branchName]);
      } catch {
        // Branch may already be gone
      }
    }
  }
}

/**
 * Get diff for a plain repository (no worktree).
 * Combines unstaged + staged changes.
 */
export async function getRepoDiff(repoPath: string): Promise<DiffStats> {
  const git = simpleGit(repoPath);

  // unstaged + staged combined
  const unstaged = await git.diff();
  const staged = await git.diff(['--cached']);

  const fullDiff = [staged, unstaged].filter(Boolean).join('\n');

  // Get summary for counts
  const summary = await git.diffSummary();
  const stagedSummary = await git.diffSummary(['--cached']);

  return {
    added: summary.insertions + stagedSummary.insertions,
    removed: summary.deletions + stagedSummary.deletions,
    files: summary.changed + stagedSummary.changed,
    content: fullDiff || '(no uncommitted changes)',
  };
}
