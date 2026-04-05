import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { InstanceList } from '../ui/InstanceList.js';
import { TabbedWindow } from '../ui/TabbedWindow.js';
import { Menu } from '../ui/Menu.js';
import { NewInstanceOverlay } from '../ui/overlays/NewInstanceOverlay.js';
import { HelpOverlay } from '../ui/overlays/HelpOverlay.js';
import { ConfirmOverlay } from '../ui/overlays/ConfirmOverlay.js';
import { Instance } from '../session/instance.js';
import { Storage } from '../session/storage.js';
import { WezTermClient } from '../wezterm/client.js';
import { GitWorktree } from '../session/git.js';
import { Config } from '../config/config.js';
import type { MenuState } from '../keys/keys.js';

export interface AppProps {
  defaultDir: string;
}

type OverlayType = 'none' | 'new_instance' | 'new_with_prompt' | 'help' | 'confirm_kill';

export function App({ defaultDir }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;

  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'preview' | 'diff' | 'terminal'>('preview');
  const [overlay, setOverlay] = useState<OverlayType>('none');
  const [previewText, setPreviewText] = useState('');
  const [diffText, setDiffText] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);

  const storage = React.useRef(new Storage()).current;
  const wezterm = React.useRef(new WezTermClient()).current;
  const config = React.useRef(new Config()).current;

  // Phase 1: Load saved instances immediately (fast)
  useEffect(() => {
    (async () => {
      await config.load();

      // Detect our own pane so we can exclude it from discovery
      try {
        const paneVar = process.env.WEZTERM_PANE;
        if (paneVar) {
          wezterm.selfPaneId = parseInt(paneVar, 10);
        }
      } catch { /* ignore */ }
      const savedData = await storage.load();
      const loaded: Instance[] = [];

      for (const data of savedData) {
        loaded.push(Instance.fromJSON(data));
      }

      setInstances(loaded);
    })();
  }, []);

  // Phase 2: Auto-discover agents in background (slow — hits all WezTerm processes)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Small delay to let the TUI render first
      await new Promise(r => setTimeout(r, 500));
      if (cancelled) return;

      try {
        const discovered = await wezterm.discoverAllWindows();
        if (cancelled) return;

        setInstances(prev => {
          const trackedPaneIds = new Set(
            prev.filter(i => i.data.paneId !== null && i.data.paneId >= 0)
              .map(i => `${i.data.weztermSocket ?? 'default'}:${i.data.paneId}`)
          );

          const newInstances: Instance[] = [];
          for (const pane of discovered) {
            const socket = pane.pid ? wezterm.socketPathForPid(pane.pid) : null;
            const key = pane.pid ? `${socket}:${pane.paneId}` : `default:${pane.paneId}`;
            if (trackedPaneIds.has(key)) continue;

            const cwd = decodeURIComponent(pane.cwd);
            const inst = Instance.create(
              pane.title,
              pane.program as any,
              cwd,
              pane.program,
            );
            inst.setPaneId(pane.paneId);
            inst.data.weztermSocket = socket;
            inst.setStatus('running');
            newInstances.push(inst);
          }

          if (newInstances.length === 0) return prev;
          const merged = [...prev, ...newInstances];
          storage.save(merged.map(i => i.toJSON()));
          return merged;
        });
      } catch {
        // Discovery failed — not critical, just skip
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Periodic refresh: update preview, diff stats
  useEffect(() => {
    const interval = setInterval(async () => {
      const selected = instances[selectedIndex];
      if (!selected) return;

      if (selected.data.paneId !== null && selected.data.paneId >= 0) {
        const sock = selected.data.weztermSocket ?? undefined;
        try {
          const text = await wezterm.getText(selected.data.paneId, sock);
          setPreviewText(text);

          const hasPrompt = await wezterm.hasPrompt(selected.data.paneId, sock);
          if (hasPrompt && selected.data.status === 'running') {
            selected.setStatus('ready');
          } else if (!hasPrompt && selected.data.status === 'ready') {
            selected.setStatus('running');
          }
        } catch {
          // Pane may have died
        }
      }

      // Update diff if on diff tab
      if (activeTab === 'diff' && selected.data.worktreePath) {
        try {
          const wt = await GitWorktree.fromExisting(selected.data.worktreePath);
          const diff = await wt.getDiff();
          setDiffText(diff.content);
          selected.setDiffStats({
            added: diff.added,
            removed: diff.removed,
            files: diff.files,
          });
        } catch {
          // Git error
        }
      }

      // Persist state
      await storage.save(instances.map(i => i.toJSON()));
    }, 1000);

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

  // Key input handling
  useInput((input, key) => {
    if (overlay !== 'none') {
      if (key.escape) setOverlay('none');
      return;
    }

    // Navigation
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
        if (prev === 'preview') return 'diff';
        if (prev === 'diff') return 'terminal';
        return 'preview';
      });
      setScrollOffset(0);
    }

    // Scroll in diff view
    if (key.shift && key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    }
    if (key.shift && key.downArrow) {
      setScrollOffset(prev => prev + 1);
    }

    // Actions
    if (input === 'n') setOverlay('new_instance');
    if (input === 'N') setOverlay('new_with_prompt');
    if (input === 'D') setOverlay('confirm_kill');
    if (input === 'p') handlePush();
    if (input === 'c') handlePause();
    if (input === 'r') handleResume();
    if (input === '?') setOverlay('help');
    if (input === 'q') exit();
    if (key.return || input === 'o') handleAttach();
  });

  const selected = instances[selectedIndex] ?? null;
  const contentHeight = rows - 3;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box flexDirection="row" height={contentHeight}>
        {/* Left panel: instance list */}
        <Box width={Math.floor(cols * 0.3)} flexDirection="column" borderStyle="single" borderColor="gray">
          <InstanceList
            instances={instances}
            selectedIndex={selectedIndex}
            height={contentHeight - 2}
          />
        </Box>

        {/* Right panel: tabbed window */}
        <Box width={Math.floor(cols * 0.7)} flexDirection="column" borderStyle="single" borderColor="cyan">
          <TabbedWindow
            activeTab={activeTab}
            previewText={previewText}
            diffText={diffText}
            height={contentHeight - 2}
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
    </Box>
  );
}
