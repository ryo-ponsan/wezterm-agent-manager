import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AGENT_SIGNATURES,
  WORKING_PATTERNS,
  ACTION_NEEDED_PATTERNS,
  IDLE_PATTERNS,
  COMPLETION_SUMMARY,
  SPINNER_CHARS,
  isSpinnerLine,
  isShellPrompt,
  isUIChromeLine,
  ACTIVITY_TAIL_LINES,
  IDENTIFY_TAIL_LINES,
} from "./patterns.js";

const execFileAsync = promisify(execFile);

export interface PaneInfo {
  paneId: number;
  title: string;
  cwd: string;
}

/** Shape returned by `wezterm cli list --format json`. */
interface WezTermListEntry {
  pane_id: number;
  tab_id: number;
  tab_title: string;
  window_id: number;
  workspace: string;
  title: string;
  cwd: string;
  cursor_x: number;
  cursor_y: number;
  cursor_shape: string;
  cursor_visibility: string;
  is_active: boolean;
  is_zoomed: boolean;
  tty_name: string;
}

/** Agent activity status detected from pane content. */
export type AgentActivity = "working" | "idle" | "action_needed" | "unknown";

/**
 * Resolves the path to the wezterm executable.
 * Checks PATH first, then falls back to common Windows install locations.
 */
async function resolveWeztermBin(): Promise<string> {
  // Try bare name first (relies on PATH)
  try {
    await execFileAsync("wezterm", ["cli", "list", "--format", "json"]);
    return "wezterm";
  } catch {
    // Not on PATH – try common locations
  }

  const candidates = [
    "C:\\Program Files\\WezTerm\\wezterm.exe",
    "C:\\Program Files (x86)\\WezTerm\\wezterm.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Programs\\WezTerm\\wezterm.exe`,
    `${process.env.USERPROFILE ?? ""}\\.cargo\\bin\\wezterm.exe`,
  ];

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      // Try next
    }
  }

  // Fall back to bare name and let the caller handle the error
  return "wezterm";
}

export class WezTermClient {
  private bin: string | null = null;

  /** Pane ID where wam itself is running — exclude from discovery. */
  selfPaneId: number | null = null;

  /** Lazily resolve the wezterm binary path once. */
  private async getBin(): Promise<string> {
    if (this.bin === null) {
      this.bin = await resolveWeztermBin();
    }
    return this.bin;
  }

  /** Run a wezterm CLI command and return stdout. */
  private async run(args: string[], socket?: string): Promise<string> {
    const bin = await this.getBin();
    const env = socket
      ? { ...process.env, WEZTERM_UNIX_SOCKET: socket }
      : undefined;
    try {
      const { stdout } = await execFileAsync(bin, ["cli", ...args], { env });
      return stdout.trim();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      throw new Error(`wezterm cli ${args[0]} failed: ${message}`);
    }
  }

  /**
   * Spawn a new pane running `command` in the given working directory.
   *
   * By default the pane is created as a split in the current tab.
   * Pass `newWindow: true` to open it in a new window instead.
   *
   * Returns the numeric pane_id assigned by WezTerm.
   */
  async spawn(
    command: string,
    cwd: string,
    newWindow = false,
  ): Promise<number> {
    const args: string[] = ["spawn", "--cwd", cwd];

    if (newWindow) {
      args.push("--new-window");
    }

    // Launch the command via shell so that --cwd is respected.
    // On Windows, cmd /c ignores the wezterm --cwd flag, so we
    // explicitly cd first. PowerShell handles cwd correctly.
    args.push("--");

    if (process.platform === "win32") {
      // Use pwsh/powershell to cd into the directory then run the command
      args.push(
        "powershell.exe",
        "-NoProfile",
        "-Command",
        `Set-Location '${cwd.replace(/'/g, "''")}'; ${command}`,
      );
    } else {
      args.push("bash", "-c", `cd '${cwd.replace(/'/g, "'\\''")}' && exec ${command}`);
    }

    // wezterm cli spawn prints the new pane_id on stdout
    const stdout = await this.run(args);
    const paneId = parseInt(stdout, 10);
    if (Number.isNaN(paneId)) {
      throw new Error(`spawn did not return a valid pane_id: ${stdout}`);
    }
    return paneId;
  }

  /**
   * Retrieve the current text content of a pane (the visible viewport).
   */
  async getText(paneId: number, socket?: string): Promise<string> {
    return this.run(["get-text", "--pane-id", String(paneId)], socket);
  }

  /**
   * Send text to a pane. The text is delivered as if typed.
   * Use `\r` or `\n` to send Enter.
   */
  async sendText(paneId: number, text: string, socket?: string): Promise<void> {
    await this.run([
      "send-text",
      "--pane-id",
      String(paneId),
      "--no-paste",
      "--",
      text,
    ], socket);
  }

  /**
   * List all panes whose title starts with the `wam_` prefix.
   */
  async listPanes(): Promise<PaneInfo[]> {
    const raw = await this.run(["list", "--format", "json"]);
    if (!raw) return [];

    let entries: WezTermListEntry[];
    try {
      entries = JSON.parse(raw) as WezTermListEntry[];
    } catch {
      throw new Error(`Failed to parse wezterm pane list: ${raw}`);
    }

    return entries
      .filter((e) => e.title.startsWith("wam_"))
      .map((e) => ({
        paneId: e.pane_id,
        title: e.title,
        cwd: e.cwd,
      }));
  }

  /**
   * Kill / close a pane.
   *
   * Tries `wezterm cli kill-pane` first. If the subcommand is not
   * available, falls back to sending `exit\r` to the pane.
   */
  async killPane(paneId: number): Promise<void> {
    try {
      await this.run(["kill-pane", "--pane-id", String(paneId)]);
    } catch {
      // Fallback: send 'exit' command
      try {
        await this.sendText(paneId, "exit\r");
      } catch {
        // Pane may already be dead – ignore
      }
    }
  }

  /**
   * Activate (focus) a pane and bring its WezTerm window to the foreground.
   */
  async activatePane(paneId: number, socket?: string): Promise<void> {
    await this.run(["activate-pane", "--pane-id", String(paneId)], socket);

    // On Windows, also bring the WezTerm window to the foreground
    if (process.platform === "win32") {
      if (socket) {
        const pidMatch = socket.match(/gui-sock-(\d+)$/);
        if (pidMatch) {
          await this.bringWindowToFront(parseInt(pidMatch[1], 10));
        }
      } else {
        // Bring the current WezTerm window (find via pane list)
        try {
          const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-Command",
            "Get-Process wezterm-gui -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id",
          ]);
          const pid = parseInt(stdout.trim(), 10);
          if (!Number.isNaN(pid)) {
            await this.bringWindowToFront(pid);
          }
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Bring a window to the foreground by its process ID (Windows only).
   */
  private async bringWindowToFront(pid: number): Promise<void> {
    try {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); }'; $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { if ([Win]::IsIconic($p.MainWindowHandle)) { [Win]::ShowWindow($p.MainWindowHandle, 9) }; [Win]::SetForegroundWindow($p.MainWindowHandle) }`,
      ]);
    } catch {
      // Best-effort — ignore errors
    }
  }

  /**
   * Check whether a pane is still alive by looking for it in the pane list.
   */
  async isPaneAlive(paneId: number, socket?: string): Promise<boolean> {
    const raw = await this.run(["list", "--format", "json"], socket);
    if (!raw) return false;

    let entries: WezTermListEntry[];
    try {
      entries = JSON.parse(raw) as WezTermListEntry[];
    } catch {
      return false;
    }

    return entries.some((e) => e.pane_id === paneId);
  }

  /**
   * Detect the activity status of an agent running in a pane.
   *
   * All pattern definitions live in ./patterns.ts — edit that file
   * when agent UIs change upstream.
   */
  async detectActivity(paneId: number, socket?: string): Promise<AgentActivity> {
    const text = await this.getText(paneId, socket);
    const tail = text
      .split("\n")
      .slice(-ACTIVITY_TAIL_LINES)
      .filter((l) => !isUIChromeLine(l))
      .map((l) => l.trimEnd());

    // 1. Definitive WORKING — highest priority
    if (tail.some((l) => WORKING_PATTERNS.some((p) => p.test(l)))) {
      return "working";
    }

    // 2. Spinner detection (animated braille / ✻)
    const hasCompletionSummary = tail.some((l) => COMPLETION_SUMMARY.test(l));
    const hasSpinner = !hasCompletionSummary && tail.some(isSpinnerLine);

    if (hasSpinner) {
      const lastSpinnerIdx = tail.findLastIndex(isSpinnerLine);
      const lastPromptIdx = tail.findLastIndex((l) => /^\s*❯/.test(l));
      if (lastPromptIdx > lastSpinnerIdx) {
        return "idle";
      }
      return "working";
    }

    // 3. ACTION NEEDED — blocked on user choice / permission
    if (tail.some((l) => ACTION_NEEDED_PATTERNS.some((p) => p.test(l)))) {
      return "action_needed";
    }

    // 4. IDLE — waiting for next prompt
    if (tail.some((l) => IDLE_PATTERNS.some((p) => p.test(l)))) {
      return "idle";
    }
    if (tail.some(isShellPrompt)) {
      return "idle";
    }

    return "unknown";
  }

  /**
   * Backwards-compatible wrapper.
   */
  async hasPrompt(paneId: number, socket?: string): Promise<boolean> {
    const activity = await this.detectActivity(paneId, socket);
    return activity === "idle";
  }

  /**
   * Send an Enter keypress to a pane.
   */
  async tapEnter(paneId: number, socket?: string): Promise<void> {
    await this.sendText(paneId, "\r", socket);
  }

  /**
   * Discover all WezTerm panes that appear to be running an agent process.
   *
   * Checks both the pane title AND the pane text content for known agent
   * signatures. This catches agents regardless of how they were launched.
   */
  async discoverAgentPanes(): Promise<
    Array<PaneInfo & { program: string }>
  > {
    const raw = await this.run(["list", "--format", "json"]);
    if (!raw) return [];

    let entries: WezTermListEntry[];
    try {
      entries = JSON.parse(raw) as WezTermListEntry[];
    } catch {
      return [];
    }

    const results: Array<PaneInfo & { program: string }> = [];

    for (const entry of entries) {
      // First check title
      const titleLower = entry.title.toLowerCase();
      let matched = false;

      for (const agent of AGENT_SIGNATURES) {
        if (titleLower.includes(agent.program)) {
          results.push({
            paneId: entry.pane_id,
            title: entry.title,
            cwd: this.cleanCwd(entry.cwd),
            program: agent.program,
          });
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // If title didn't match, check pane text content
      try {
        const text = await this.getText(entry.pane_id);
        // Only check last ~30 lines for performance
        const tail = text.split("\n").slice(-IDENTIFY_TAIL_LINES).join("\n");

        for (const agent of AGENT_SIGNATURES) {
          if (agent.contentPatterns.some((p) => p.test(tail))) {
            results.push({
              paneId: entry.pane_id,
              title: entry.title,
              cwd: this.cleanCwd(entry.cwd),
              program: agent.program,
            });
            break;
          }
        }
      } catch {
        // Can't read pane text — skip
      }
    }

    return results;
  }

  /** Strip file:/// prefix and decode URL-encoded chars from cwd. */
  private cleanCwd(cwd: string): string {
    const stripped = cwd.replace(/^file:\/\/\//, "").replace(/\/$/, "");
    try {
      return decodeURIComponent(stripped);
    } catch {
      return stripped;
    }
  }

  /**
   * On Windows, discover agent panes across ALL WezTerm processes,
   * not just the one this CLI is connected to.
   *
   * Uses `wezterm cli --prefer-mux --class <pid>` style connection
   * when possible, otherwise falls back to reading window titles
   * from all wezterm-gui processes via PowerShell.
   */
  async discoverAllWindows(): Promise<
    Array<PaneInfo & { program: string; pid: number }>
  > {
    if (process.platform !== "win32") {
      // On non-Windows, a single mux server usually covers everything
      const panes = await this.discoverAgentPanes();
      return panes.map((p) => ({ ...p, pid: 0 }));
    }

    // Get all wezterm-gui PIDs via PowerShell
    let pids: number[];
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Get-Process wezterm-gui -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id",
      ]);
      pids = stdout
        .trim()
        .split(/\r?\n/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
    } catch {
      // Fallback to just the current connection
      const panes = await this.discoverAgentPanes();
      return panes.map((p) => ({ ...p, pid: 0 }));
    }

    const allResults: Array<PaneInfo & { program: string; pid: number }> = [];
    // Key by pid:pane_id since different processes can have same pane_id
    const seen = new Set<string>();

    for (const pid of pids) {
      const socket = this.socketPathForPid(pid);
      try {
        const bin = await this.getBin();
        const { stdout: raw } = await execFileAsync(bin, [
          "cli",
          "list",
          "--format",
          "json",
        ], { env: { ...process.env, WEZTERM_UNIX_SOCKET: socket } });

        if (!raw.trim()) continue;

        const entries = JSON.parse(raw.trim()) as WezTermListEntry[];
        for (const entry of entries) {
          const key = `${pid}:${entry.pane_id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // Skip wam's own pane
          if (this.selfPaneId !== null && entry.pane_id === this.selfPaneId) continue;

          // Check title first
          const titleLower = entry.title.toLowerCase();
          let matched = false;
          for (const agent of AGENT_SIGNATURES) {
            if (titleLower.includes(agent.program)) {
              allResults.push({
                paneId: entry.pane_id,
                title: entry.title,
                cwd: this.cleanCwd(entry.cwd),
                program: agent.program,
                pid,
              });
              matched = true;
              break;
            }
          }
          if (matched) continue;

          // Check pane content
          try {
            const { stdout: text } = await execFileAsync(bin, [
              "cli",
              "get-text",
              "--pane-id",
              String(entry.pane_id),
            ], { env: { ...process.env, WEZTERM_UNIX_SOCKET: socket } });

            const tail = text.split("\n").slice(-IDENTIFY_TAIL_LINES).join("\n");
            for (const agent of AGENT_SIGNATURES) {
              if (agent.contentPatterns.some((p) => p.test(tail))) {
                allResults.push({
                  paneId: entry.pane_id,
                  title: entry.title,
                  cwd: this.cleanCwd(entry.cwd),
                  program: agent.program,
                  pid,
                });
                break;
              }
            }
          } catch {
            // Can't read text, skip
          }
        }
      } catch {
        // Can't connect to this PID's socket, skip
      }
    }

    return allResults;
  }

  /** Guess the Unix domain socket path for a WezTerm process by PID. */
  socketPathForPid(pid: number): string {
    // WezTerm stores sockets at ~/.local/share/wezterm/
    // Use forward slashes — Node on Windows handles them fine and
    // wezterm cli also accepts them via WEZTERM_UNIX_SOCKET.
    const home = (process.env.USERPROFILE ?? process.env.HOME ?? "").replace(/\\/g, "/");
    return `${home}/.local/share/wezterm/gui-sock-${pid}`;
  }
}
