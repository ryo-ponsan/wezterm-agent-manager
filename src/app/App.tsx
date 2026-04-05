import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { InstanceList } from '../ui/InstanceList.js';
import { TabbedWindow } from '../ui/TabbedWindow.js';
import { Menu } from '../ui/Menu.js';
import { NewInstanceOverlay } from '../ui/overlays/NewInstanceOverlay.js';
import { HelpOverlay } from '../ui/overlays/HelpOverlay.js';
import { ConfirmOverlay } from '../ui/overlays/ConfirmOverlay.js';
import { SendPromptOverlay } from '../ui/overlays/SendPromptOverlay.js';
import { Instance } from '../session/instance.js';
import { Storage } from '../session/storage.js';
import { WezTermClient } from '../wezterm/client.js';
import { GitWorktree, getRepoDiff } from '../session/git.js';
import { Config } from '../config/config.js';
import type { MenuState } from '../keys/keys.js';

/**
 * Send a desktop notification with status, title, and repo name.
 * Clicking the notification brings the wam WezTerm window to the foreground.
 */
/** PID of the wezterm-gui process running wam, cached at startup. */
let wamWeztermPid: number | null = null;

/** Detect which wezterm-gui PID owns the pane wam is running in. */
function detectWamPid(): void {
  if (process.platform !== 'win32') return;
  const paneId = process.env.WEZTERM_PANE;
  if (!paneId) return;

  // Check each wezterm-gui socket to find which one has our pane
  execFile('powershell.exe', [
    '-NoProfile', '-Command',
    'Get-Process wezterm-gui -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id',
  ], (err, stdout) => {
    if (err || !stdout.trim()) return;
    const pids = stdout.trim().split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

    // Try each PID's socket to find one that lists our pane
    const home = (process.env.USERPROFILE ?? '').replace(/\\/g, '/');
    for (const pid of pids) {
      const sock = `${home}/.local/share/wezterm/gui-sock-${pid}`;
      execFile('wezterm', ['cli', 'list', '--format', 'json'], {
        env: { ...process.env, WEZTERM_UNIX_SOCKET: sock },
      }, (e, out) => {
        if (e || !out.trim()) return;
        try {
          const entries = JSON.parse(out.trim());
          if (entries.some((entry: any) => entry.pane_id === parseInt(paneId, 10))) {
            wamWeztermPid = pid;
          }
        } catch { /* ignore */ }
      });
    }
  });
}

function sendNotification(status: string, agentTitle: string, repoName: string): void {
  const statusLabel = status === 'action_needed' ? '⚠ ACTION NEEDED' : '✔ Done';
  const body = `${agentTitle}\n${repoName}`;

  if (process.platform === 'win32') {
    // On click: bring wam's WezTerm window to front + activate wam's pane
    const paneId = process.env.WEZTERM_PANE;
    const focusParts: string[] = [];

    if (wamWeztermPid) {
      focusParts.push(`
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WamFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }';
        $p = Get-Process -Id ${wamWeztermPid} -ErrorAction SilentlyContinue;
        if ($p -and $p.MainWindowHandle -ne 0) {
          if ([WamFocus]::IsIconic($p.MainWindowHandle)) { [WamFocus]::ShowWindow($p.MainWindowHandle, 9) };
          [WamFocus]::SetForegroundWindow($p.MainWindowHandle)
        }`);
    }

    if (paneId) {
      // Also activate wam's pane so user lands directly on the wam TUI
      const home = (process.env.USERPROFILE ?? '').replace(/\\/g, '/');
      const sock = wamWeztermPid ? `${home}/.local/share/wezterm/gui-sock-${wamWeztermPid}` : '';
      const envPart = sock ? `$env:WEZTERM_UNIX_SOCKET='${sock}';` : '';
      focusParts.push(`${envPart} wezterm cli activate-pane --pane-id ${paneId}`);
    }

    const focusScript = focusParts.join('; ');

    const script = `
      [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
      $notify = New-Object System.Windows.Forms.NotifyIcon;
      $notify.Icon = [System.Drawing.SystemIcons]::Information;
      $notify.Visible = $true;
      $notify.BalloonTipTitle = 'wam - ${statusLabel.replace(/'/g, "''")}';
      $notify.BalloonTipText = '${body.replace(/'/g, "''")}';
      $notify.BalloonTipIcon = '${status === "action_needed" ? "Warning" : "Info"}';
      ${focusScript ? `Register-ObjectEvent $notify BalloonTipClicked -Action { ${focusScript} } | Out-Null;` : ''}
      $notify.ShowBalloonTip(5000);
      [System.Media.SystemSounds]::Asterisk.Play();
      Start-Sleep -Seconds 6;
      $notify.Dispose();
    `;
    execFile('powershell.exe', ['-NoProfile', '-Command', script], () => {});
  } else {
    // macOS / Linux: terminal bell
    process.stdout.write('\x07');
  }
}

export interface AppProps {
  defaultDir: string;
}

type OverlayType = 'none' | 'new_instance' | 'new_with_prompt' | 'help' | 'confirm_kill' | 'send_prompt' | 'action_respond';

export function App({ defaultDir }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;

  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'preview' | 'diff'>('preview');
  const [overlay, setOverlay] = useState<OverlayType>('none');
  const [previewText, setPreviewText] = useState('');
  const [diffText, setDiffText] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);

  const storage = React.useRef(new Storage()).current;
  const wezterm = React.useRef(new WezTermClient()).current;
  const config = React.useRef(new Config()).current;

  // On startup: discover all running agents fresh each time.
  // We do NOT restore from instances.json because pane IDs change
  // between WezTerm restarts, leading to stale/duplicate entries.
  // Instead, we scan all WezTerm windows every launch.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await config.load();

      // Detect our own pane so we can exclude it from discovery
      try {
        const paneVar = process.env.WEZTERM_PANE;
        if (paneVar) {
          wezterm.selfPaneId = parseInt(paneVar, 10);
        }
      } catch { /* ignore */ }

      // Detect which wezterm-gui process owns wam (for notification click-to-focus)
      detectWamPid();

      // Discover all agent panes across all WezTerm windows
      try {
        const discovered = await wezterm.discoverAllWindows();
        if (cancelled) return;

        const freshInstances: Instance[] = [];
        for (const pane of discovered) {
          const socket = pane.pid ? wezterm.socketPathForPid(pane.pid) : null;
          const cwd = decodeURIComponent(pane.cwd);
          const inst = Instance.create(
            pane.title,
            pane.program as any,
            cwd,
            pane.program,
          );
          inst.setPaneId(pane.paneId);
          inst.data.weztermSocket = socket;

          // Detect initial activity state
          try {
            const activity = await wezterm.detectActivity(pane.paneId, socket ?? undefined);
            inst.setStatus(activity === 'idle' ? 'ready' : 'running');
          } catch {
            inst.setStatus('running');
          }
          freshInstances.push(inst);
        }

        if (!cancelled) {
          setInstances(freshInstances);
          await storage.save(freshInstances.map(i => i.toJSON()));
        }
      } catch {
        // Discovery failed — start with empty list
        setInstances([]);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Periodic refresh: update ALL instance statuses + selected preview
  useEffect(() => {
    const interval = setInterval(async () => {
      let stateChanged = false;

      // Update status for ALL instances (not just selected)
      for (const inst of instances) {
        if (inst.data.paneId === null || inst.data.paneId < 0) continue;
        if (inst.data.status === 'paused' || inst.data.status === 'loading') continue;

        const sock = inst.data.weztermSocket ?? undefined;
        try {
          const activity = await wezterm.detectActivity(inst.data.paneId, sock);
          const prevStatus = inst.data.status;

          if (activity === 'action_needed' && prevStatus !== 'action_needed') {
            inst.setStatus('action_needed');
            stateChanged = true;
            sendNotification('action_needed', inst.data.title, path.basename(inst.data.repoPath));
          } else if (activity === 'idle' && prevStatus !== 'ready') {
            inst.setStatus('ready');
            stateChanged = true;
            if (prevStatus === 'running') {
              sendNotification('ready', inst.data.title, path.basename(inst.data.repoPath));
              // Pre-fetch diff on completion so it's ready when user switches tab
              try {
                if (inst.data.worktreePath) {
                  const wt = await GitWorktree.fromExisting(inst.data.worktreePath);
                  const diff = await wt.getDiff();
                  inst.setDiffStats({ added: diff.added, removed: diff.removed, files: diff.files });
                  if (inst === instances[selectedIndex]) setDiffText(diff.content);
                } else if (inst.data.repoPath) {
                  const diff = await getRepoDiff(inst.data.repoPath);
                  inst.setDiffStats({ added: diff.added, removed: diff.removed, files: diff.files });
                  if (inst === instances[selectedIndex]) setDiffText(diff.content);
                }
              } catch { /* ignore */ }
            }
          } else if (activity === 'working' && prevStatus !== 'running') {
            inst.setStatus('running');
            stateChanged = true;
          }
        } catch {
          // Pane may have died
        }
      }

      // Update preview for selected instance
      const selected = instances[selectedIndex];
      if (selected && selected.data.paneId !== null && selected.data.paneId >= 0) {
        const sock = selected.data.weztermSocket ?? undefined;
        try {
          const text = await wezterm.getText(selected.data.paneId, sock);
          setPreviewText(text);
        } catch { /* ignore */ }
      }

      // Update diff only when diff tab is active
      if (selected && activeTab === 'diff') {
        try {
          let diff;
          if (selected.data.worktreePath) {
            // Worktree mode: diff against base commit
            const wt = await GitWorktree.fromExisting(selected.data.worktreePath);
            diff = await wt.getDiff();
          } else if (selected.data.repoPath) {
            // Normal mode: unstaged + staged changes
            diff = await getRepoDiff(selected.data.repoPath);
          }
          if (diff) {
            setDiffText(diff.content);
            selected.setDiffStats({
              added: diff.added,
              removed: diff.removed,
              files: diff.files,
            });
          }
        } catch { /* ignore */ }
      }

      // Always trigger re-render to keep UI fresh (instances are mutated in-place)
      setInstances(prev => [...prev]);
      await storage.save(instances.map(i => i.toJSON()));
    }, 1500);

    return () => clearInterval(interval);
  }, [instances, selectedIndex, activeTab]);

  const getMenuState = useCallback((): MenuState => {
    if (instances.length === 0) return 'empty';
    const selected = instances[selectedIndex];
    if (!selected) return 'empty';
    return 'default';
  }, [instances, selectedIndex]);

  // Handle creating a new instance
  // Each instance carries its own repoPath — not bound to a single working dir
  const handleNewInstance = useCallback(async (title: string, program: string, repoPath: string, prompt?: string) => {
    setOverlay('none');

    const appConfig = config.get();
    const profile = appConfig.profiles.find(p => p.name === program);
    const command = profile?.program ?? program;

    const inst = Instance.create(title, program as any, repoPath, command);
    let cwd = repoPath;

    // Optionally create git worktree for branch isolation
    if (appConfig.useWorktree) {
      try {
        const wt = await GitWorktree.create(repoPath, title.replace(/\s+/g, '-').toLowerCase());
        inst.data.branch = wt.info.branchName;
        inst.data.worktreePath = wt.info.worktreePath;
        cwd = wt.info.worktreePath;
      } catch {
        // Not a git repo or worktree failed — continue without
      }
    }

    // Build spawn command
    let spawnCmd = command;
    if (prompt) {
      if (program === 'claude') {
        spawnCmd = `${command} "${prompt.replace(/"/g, '\\"')}"`;
      }
    }

    try {
      const paneId = await wezterm.spawn(spawnCmd, cwd);
      inst.setPaneId(paneId);
      inst.setStatus('running');

      // If there's a prompt and the program isn't claude, send it after spawn
      if (prompt && program !== 'claude') {
        setTimeout(async () => {
          await wezterm.sendText(paneId, prompt + '\n');
        }, 2000);
      }
    } catch {
      inst.setStatus('paused');
    }

    setInstances(prev => [...prev, inst]);
    setSelectedIndex(instances.length);
    await storage.upsert(inst.toJSON());
  }, [instances.length]);

  // Handle killing an instance
  const handleKillInstance = useCallback(async () => {
    setOverlay('none');
    const selected = instances[selectedIndex];
    if (!selected) return;

    if (selected.data.paneId !== null && selected.data.paneId >= 0) {
      await wezterm.killPane(selected.data.paneId);
    }

    // Cleanup worktree only if it was used
    if (selected.data.worktreePath) {
      try {
        const wt = await GitWorktree.fromExisting(selected.data.worktreePath);
        await wt.cleanup();
      } catch { /* ignore */ }
    }

    await storage.remove(selected.data.id);
    setInstances(prev => prev.filter((_, i) => i !== selectedIndex));
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  }, [instances, selectedIndex]);

  // Handle pause — stop the agent pane (and optionally save worktree)
  const handlePause = useCallback(async () => {
    const selected = instances[selectedIndex];
    if (!selected || selected.data.status === 'paused') return;

    // Git worktree cleanup only when worktree mode is active
    if (selected.data.worktreePath) {
      try {
        const wt = await GitWorktree.fromExisting(selected.data.worktreePath);
        await wt.pause();
      } catch { /* ignore */ }
    }

    if (selected.data.paneId !== null && selected.data.paneId >= 0) {
      await wezterm.killPane(selected.data.paneId);
    }

    selected.setStatus('paused');
    selected.setPaneId(-1);
    setInstances([...instances]);
    await storage.upsert(selected.toJSON());
  }, [instances, selectedIndex]);

  // Handle resume — restart the agent in a new pane
  const handleResume = useCallback(async () => {
    const selected = instances[selectedIndex];
    if (!selected || selected.data.status !== 'paused') return;

    const appConfig = config.get();
    const profile = appConfig.profiles.find(p => p.name === selected.data.program);
    const command = profile?.program ?? selected.data.programCommand;

    // Resume worktree if it was used
    if (selected.data.worktreePath) {
      try {
        const wt = await GitWorktree.fromExisting(selected.data.worktreePath);
        await wt.resume();
      } catch { /* ignore */ }
    }

    const cwd = selected.data.worktreePath || selected.data.repoPath;
    try {
      const paneId = await wezterm.spawn(command, cwd);
      selected.setPaneId(paneId);
      selected.setStatus('running');
    } catch {
      // Failed to spawn
    }

    setInstances([...instances]);
    await storage.upsert(selected.toJSON());
  }, [instances, selectedIndex]);

  // Handle push
  const handlePush = useCallback(async () => {
    const selected = instances[selectedIndex];
    if (!selected || !selected.data.worktreePath) return;

    try {
      const wt = await GitWorktree.fromExisting(selected.data.worktreePath);
      await wt.push();
    } catch { /* ignore */ }
  }, [instances, selectedIndex]);

  // Handle attach (focus on the WezTerm pane)
  const handleAttach = useCallback(async () => {
    const selected = instances[selectedIndex];
    if (!selected || selected.data.paneId === null || selected.data.paneId < 0) return;
    const sock = selected.data.weztermSocket ?? undefined;
    await wezterm.activatePane(selected.data.paneId, sock);
  }, [instances, selectedIndex]);

  // Handle sending a prompt to the selected agent
  const handleSendPrompt = useCallback(async (prompt: string) => {
    setOverlay('none');
    const selected = instances[selectedIndex];
    if (!selected || selected.data.paneId === null || selected.data.paneId < 0) return;
    const sock = selected.data.weztermSocket ?? undefined;
    // Send the prompt text, then send Enter separately
    await wezterm.sendText(selected.data.paneId, prompt, sock);
    await wezterm.tapEnter(selected.data.paneId, sock);
    // Agent will start working after receiving the prompt
    selected.setStatus('running');
    setInstances(prev => [...prev]);
  }, [instances, selectedIndex]);

  const contentHeight = rows - 5;

  // Key input handling
  useInput((input, key) => {
    // Action respond mode: forward keys to the agent's pane
    if (overlay === 'action_respond') {
      const sel = instances[selectedIndex];
      if (!sel || sel.data.paneId === null || sel.data.paneId < 0) {
        setOverlay('none');
        return;
      }
      const sock = sel.data.weztermSocket ?? undefined;

      if (key.escape) {
        setOverlay('none');
        return;
      }
      if (key.upArrow) {
        wezterm.sendText(sel.data.paneId, '\x1b[A', sock); // Arrow Up
        return;
      }
      if (key.downArrow) {
        wezterm.sendText(sel.data.paneId, '\x1b[B', sock); // Arrow Down
        return;
      }
      if (key.return) {
        wezterm.tapEnter(sel.data.paneId, sock);
        setOverlay('none');
        sel.setStatus('running');
        setInstances(prev => [...prev]);
        return;
      }
      // Number keys: send directly (for "1. Yes" style choices)
      if (/^[0-9]$/.test(input)) {
        wezterm.sendText(sel.data.paneId, input, sock);
        wezterm.tapEnter(sel.data.paneId, sock);
        setOverlay('none');
        sel.setStatus('running');
        setInstances(prev => [...prev]);
        return;
      }
      return;
    }

    if (overlay !== 'none') {
      if (key.escape) setOverlay('none');
      return;
    }

    // When diff tab is active, j/k scroll the diff instead of instance list
    if (activeTab === 'diff') {
      const diffLineCount = diffText.split('\n').length;

      if (input === 'j' || key.downArrow) {
        setScrollOffset(prev => Math.min(prev + 1, Math.max(0, diffLineCount - contentHeight)));
        return;
      }
      if (input === 'k' || key.upArrow) {
        setScrollOffset(prev => Math.max(0, prev - 1));
        return;
      }
      // d = half page down, u = half page up
      if (input === 'd') {
        const half = Math.floor(contentHeight / 2);
        setScrollOffset(prev => Math.min(prev + half, Math.max(0, diffLineCount - contentHeight)));
        return;
      }
      if (input === 'u') {
        const half = Math.floor(contentHeight / 2);
        setScrollOffset(prev => Math.max(0, prev - half));
        return;
      }
      // g = top, G = bottom
      if (input === 'g') {
        setScrollOffset(0);
        return;
      }
      if (input === 'G') {
        setScrollOffset(Math.max(0, diffLineCount - contentHeight));
        return;
      }
    }

    // Navigation (preview tab or no diff)
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      setScrollOffset(0);
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(instances.length - 1, prev + 1));
      setScrollOffset(0);
    }

    // Tab switching
    if (key.tab) {
      setActiveTab(prev => {
        return prev === 'preview' ? 'diff' : 'preview';
      });
      setScrollOffset(0);
    }

    // Actions
    if (input === 'n') setOverlay('new_instance');
    if (input === 'N') setOverlay('new_with_prompt');
    if (input === 'D') setOverlay('confirm_kill');
    if (input === '>') {
      const sel = instances[selectedIndex];
      if (sel && sel.data.paneId !== null && sel.data.paneId >= 0) {
        if (sel.data.status === 'action_needed') {
          setOverlay('action_respond');
        } else {
          setOverlay('send_prompt');
        }
      }
    }
    if (input === 'p') handlePush();
    if (input === 'c') handlePause();
    if (input === 'r') handleResume();
    if (input === '?') setOverlay('help');
    if (input === 'q') exit();
    if (key.return || input === 'o') handleAttach();
  });

  const selected = instances[selectedIndex] ?? null;
  const layoutHeight = rows - 3;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box flexDirection="row" height={layoutHeight}>
        {/* Left panel: instance list */}
        <Box width={Math.floor(cols * 0.3)} flexDirection="column" borderStyle="single" borderColor="gray">
          <InstanceList
            instances={instances}
            selectedIndex={selectedIndex}
            height={layoutHeight - 2}
          />
        </Box>

        {/* Right panel: tabbed window */}
        <Box width={Math.floor(cols * 0.7)} flexDirection="column" borderStyle="single" borderColor="cyan">
          <TabbedWindow
            activeTab={activeTab}
            previewText={previewText}
            diffText={diffText}
            height={layoutHeight - 2}
            scrollOffset={scrollOffset}
            selected={selected}
          />
        </Box>
      </Box>

      {/* Bottom menu */}
      <Menu state={getMenuState()} />

      {/* Overlays */}
      {(overlay === 'new_instance' || overlay === 'new_with_prompt') && (
        <NewInstanceOverlay
          onSubmit={handleNewInstance}
          onCancel={() => setOverlay('none')}
          profiles={config.get().profiles}
          defaultDir={defaultDir}
          withPrompt={overlay === 'new_with_prompt'}
        />
      )}
      {overlay === 'help' && (
        <HelpOverlay onClose={() => setOverlay('none')} />
      )}
      {overlay === 'confirm_kill' && (
        <ConfirmOverlay
          message={`Kill instance "${selected?.data.title}"?`}
          onConfirm={handleKillInstance}
          onCancel={() => setOverlay('none')}
        />
      )}
      {overlay === 'send_prompt' && selected && (
        <SendPromptOverlay
          agentTitle={selected.data.title}
          onSubmit={handleSendPrompt}
          onCancel={() => setOverlay('none')}
        />
      )}
      {overlay === 'action_respond' && selected && (
        <Box
          flexDirection="column"
          borderStyle="double"
          borderColor="red"
          paddingX={2}
          paddingY={1}
          position="absolute"
          marginLeft={10}
          marginTop={5}
        >
          <Text bold color="red">⚠ Action Response</Text>
          <Text color="gray">{'─'.repeat(30)}</Text>
          <Box marginTop={1}><Text bold>{selected.data.title}</Text></Box>
          <Box marginTop={1} flexDirection="column">
            <Text>  <Text color="yellow">↑↓</Text>  move selection</Text>
            <Text>  <Text color="yellow">Enter</Text>  confirm</Text>
            <Text>  <Text color="yellow">1-9</Text>  select by number</Text>
            <Text>  <Text color="yellow">Esc</Text>  cancel</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
