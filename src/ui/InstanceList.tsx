import React from 'react';
import { Box, Text } from 'ink';
import path from 'node:path';
import { Instance } from '../session/instance.js';

interface Props {
  instances: Instance[];
  selectedIndex: number;
  height: number;
}

const AGENT_BADGES: Record<string, { badge: string; color: string }> = {
  claude: { badge: 'C', color: 'cyan' },
  aider:  { badge: 'A', color: 'green' },
  codex:  { badge: 'X', color: 'magenta' },
  gemini: { badge: 'G', color: 'yellow' },
  custom: { badge: '?', color: 'gray' },
};

function statusIndicator(status: string): { symbol: string; color: string; label: string } {
  switch (status) {
    case 'running':
      return { symbol: '⟳', color: 'green', label: 'working' };
    case 'ready':
      return { symbol: '✔', color: 'yellow', label: 'done' };
    case 'action_needed':
      return { symbol: '⚠', color: 'red', label: 'ACTION' };
    case 'loading':
      return { symbol: '◌', color: 'blue', label: 'starting' };
    case 'paused':
      return { symbol: '⏸', color: 'gray', label: 'paused' };
    default:
      return { symbol: '?', color: 'white', label: '' };
  }
}

export function InstanceList({ instances, selectedIndex, height }: Props) {
  if (instances.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="gray">No instances</Text>
        <Text color="gray" dimColor>Press 'n' to create one</Text>
      </Box>
    );
  }

  // Each card takes 4 lines (border top + title + info + border bottom)
  const cardHeight = 4;
  const visibleCount = Math.max(1, Math.floor(height / cardHeight));
  let startIdx = 0;
  if (selectedIndex >= startIdx + visibleCount) {
    startIdx = selectedIndex - visibleCount + 1;
  }
  if (selectedIndex < startIdx) {
    startIdx = selectedIndex;
  }
  const visible = instances.slice(startIdx, startIdx + visibleCount);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan"> Instances ({instances.length})</Text>
      {visible.map((inst, i) => {
        const realIndex = startIdx + i;
        const isSelected = realIndex === selectedIndex;
        const { symbol, color, label } = statusIndicator(inst.data.status);
        const diff = inst.data.diffStats;
        const borderColor = isSelected ? color : 'gray';

        return (
          <Box
            key={inst.data.id}
            flexDirection="column"
            borderStyle={isSelected ? 'bold' : 'single'}
            borderColor={borderColor}
            paddingX={1}
          >
            {/* Row 1: Agent badge + Status + Title */}
            <Box>
              {(() => {
                const ag = AGENT_BADGES[inst.data.program] ?? AGENT_BADGES.custom;
                return <Text color={ag.color} bold>[{ag.badge}]</Text>;
              })()}
              <Text color={color} bold> {symbol} </Text>
              <Text bold wrap="truncate">
                {inst.data.title}
              </Text>
            </Box>

            {/* Row 2: Status label + Repo */}
            <Box>
              <Text color={color} bold>[{label}]</Text>
              <Text color="gray"> </Text>
              <Text color="magenta" dimColor>{path.basename(inst.data.repoPath)}</Text>
              {diff && (
                <Text>
                  {' '}
                  <Text color="green">+{diff.added}</Text>
                  <Text color="red"> -{diff.removed}</Text>
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
