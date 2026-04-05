import React from 'react';
import { Box, Text } from 'ink';
import path from 'node:path';
import { Instance } from '../session/instance.js';

interface Props {
  instances: Instance[];
  selectedIndex: number;
  height: number;
}

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

  // Scrolling window
  const visibleCount = Math.max(1, height);
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
      <Text color="gray">{'─'.repeat(28)}</Text>
      {visible.map((inst, i) => {
        const realIndex = startIdx + i;
        const isSelected = realIndex === selectedIndex;
        const { symbol, color, label } = statusIndicator(inst.data.status);
        const diff = inst.data.diffStats;

        return (
          <Box key={inst.data.id} flexDirection="column">
            <Box>
              <Text color={isSelected ? 'cyan' : 'white'}>
                {isSelected ? '▸ ' : '  '}
              </Text>
              <Text color={color}>{symbol} </Text>
              <Text bold={isSelected} color={isSelected ? 'white' : 'gray'}>
                {inst.data.title}
              </Text>
              <Text color={color} dimColor> [{label}]</Text>
            </Box>
            <Box marginLeft={4}>
              <Text color="magenta" dimColor>{path.basename(inst.data.repoPath)}</Text>
              <Text color="gray" dimColor> | </Text>
              <Text color="blue" dimColor>Ꮧ {inst.data.branch || 'no branch'}</Text>
              {diff && (
                <Text>
                  {' '}
                  <Text color="green">+{diff.added}</Text>
                  <Text color="red"> -{diff.removed}</Text>
                </Text>
              )}
            </Box>
            {inst.data.autoYes && (
              <Box marginLeft={4}>
                <Text color="magenta" dimColor>[auto-yes]</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
