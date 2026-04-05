/**
 * Agent detection and activity patterns.
 *
 * All heuristics for identifying which agent is running in a pane
 * and whether it is working / idle / action_needed live here.
 *
 * When an agent's UI changes upstream, update ONLY this file.
 */

// ────────────────────────────────────────────────────────────
// 1. Agent identification — used to discover agent panes
// ────────────────────────────────────────────────────────────

export interface AgentSignature {
  /** Internal program name stored in InstanceData */
  program: string;
  /** Patterns matched against the last ~30 lines of pane text */
  contentPatterns: RegExp[];
}

/**
 * Signatures used to decide whether a WezTerm pane is running a
 * known AI agent.  Checked against pane title first (simple
 * substring), then against pane text content.
 */
export const AGENT_SIGNATURES: AgentSignature[] = [
  {
    program: "claude",
    contentPatterns: [
      /╭─/,                      // Claude Code box-drawing border
      /╰─/,
      /❯\s*$/m,                  // Claude Code input prompt
      /\bClaude Code\b/,
      /Type a message/,
      /⏵⏵\s*accept/,             // "accept edits" bar
      /✻\s*(Thinking|Churned)/,  // Claude Code spinner (static form)
    ],
  },
  {
    program: "aider",
    contentPatterns: [/Aider v\d/, /aider>/],
  },
  {
    program: "codex",
    contentPatterns: [/Codex CLI/, /codex>/],
  },
  {
    program: "gemini",
    contentPatterns: [/Gemini \d/, /gemini>/],
  },
];

// ────────────────────────────────────────────────────────────
// 2. Activity detection — working / idle / action_needed
// ────────────────────────────────────────────────────────────

/** Characters used as animated spinners (braille dots + common symbols) */
export const SPINNER_CHARS = /[\u2800-\u28FF✻●◐◑◒◓]/;

/**
 * Lines that START with a spinner char + "Worked for" / "Churned for"
 * are completion summaries, NOT active work.
 */
export const COMPLETION_SUMMARY = /^\s*[\u2800-\u28FF✻●◐◑◒◓]\s+(Worked|Churned)\s+for\s/i;

/**
 * Definitive "working" indicators.
 * If ANY of these match a line the agent is busy — no further checks needed.
 */
export const WORKING_PATTERNS: RegExp[] = [
  /esc to interrupt/i,                    // Claude Code: processing
  /^\s*(Running…|⎿\s+Running)/i,         // Claude Code: tool execution
  /^\s*Thinking\.\.\./i,                  // Aider: thinking
];

/**
 * A spinner char at the start of a line followed by text = active work,
 * UNLESS the line matches COMPLETION_SUMMARY.
 */
export function isSpinnerLine(line: string): boolean {
  const m = line.match(/^\s*(.)\s+\S/);
  return m !== null && SPINNER_CHARS.test(m[1]);
}

/**
 * "Action needed" patterns — the agent is blocked and waiting for the
 * user to make a choice or grant permission.
 */
export const ACTION_NEEDED_PATTERNS: RegExp[] = [
  /^\s*❯?\s*\d+\.\s+/i,                                     // Numbered choice: "❯ 1. Yes"
  /\b(Do you want to|proceed\?|Allow|permission|trust|approve|accept\?)\b/i,
  /\b(y\/n|Y\/N|\[y\/N\]|\[Y\/n\])\b/,                      // y/n prompt
];

/**
 * "Idle" patterns — the agent finished and is waiting for the next prompt.
 */
export const IDLE_PATTERNS: RegExp[] = [
  /^\s*❯/,                   // Claude Code prompt
  /⏵⏵\s*accept/i,           // Claude Code "accept edits" bar
  /^\s*aider>\s*$/i,         // Aider prompt
];

/**
 * Generic shell prompt at end of line (fallback idle detection).
 * Only matches short lines to avoid false positives on long output.
 */
export function isShellPrompt(line: string): boolean {
  return /[$>%#]\s*$/.test(line) && line.trim().length < 80;
}

// ────────────────────────────────────────────────────────────
// 3. Line filtering — exclude wam's own UI from analysis
// ────────────────────────────────────────────────────────────

/** Lines starting with box-drawing "│" are inside wam / nested UI — skip. */
export function isUIChromeLine(line: string): boolean {
  return line.trimStart().startsWith("│");
}

/** Number of tail lines to inspect for activity detection. */
export const ACTIVITY_TAIL_LINES = 8;

/** Number of tail lines to inspect for agent identification. */
export const IDENTIFY_TAIL_LINES = 30;
