import React from 'react';
import { Box, Text } from 'ink';
import { Instance } from '../session/instance.js';

interface Props {
  activeTab: 'preview' | 'diff';
  previewText: string;
  diffText: string;
  height: number;
  scrollOffset: number;
  selected: Instance | null;
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return <Text color="green">{line}</Text>;
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return <Text color="red">{line}</Text>;
  }
  if (line.startsWith('@@')) {
    return <Text color="blue">{line}</Text>;
  }
  if (line.startsWith('diff ') || line.startsWith('index ')) {
    return <Text color="yellow" dimColor>{line}</Text>;
  }
  return <Text>{line}</Text>;
}

export function TabbedWindow({ activeTab, previewText, diffText, height, scrollOffset, selected }: Props) {
  const tabs = ['preview', 'diff'] as const;
  const contentHeight = Math.max(1, height - 3);

  const renderContent = () => {
    if (!selected) {
      return <Text color="gray">No instance selected</Text>;
    }

    if (selected.data.status === 'paused') {
      return (
        <Box flexDirection="column" alignItems="center" justifyContent="center" height={contentHeight}>
          <Text color="yellow">⏸ Session is paused</Text>
          <Text color="gray" dimColor>Press 'r' to resume</Text>
        </Box>
      );
    }

    switch (activeTab) {
      case 'preview': {
        const lines = previewText.split('\n');
        const visible = lines.slice(
          Math.max(0, lines.length - contentHeight),
          lines.length
        );
        return (
          <Box flexDirection="column">
            {visible.map((line, i) => (
              <Text key={i} wrap="truncate">{line}</Text>
            ))}
          </Box>
        );
      }

      case 'diff': {
        if (!diffText || diffText === '(no uncommitted changes)') {
          return <Text color="gray">No uncommitted changes</Text>;
        }
        const lines = diffText.split('\n');
        const start = Math.min(scrollOffset, Math.max(0, lines.length - contentHeight));
        const visible = lines.slice(start, start + contentHeight);
        return (
          <Box flexDirection="column">
            {visible.map((line, i) => (
              <DiffLine key={i} line={line} />
            ))}
          </Box>
        );
      }
    }
  };

  return (
    <Box flexDirection="column">
      {/* Tab bar */}
      <Box>
        {tabs.map((tab) => (
          <Box key={tab} marginRight={1}>
            <Text
              bold={activeTab === tab}
              color={activeTab === tab ? 'cyan' : 'gray'}
              underline={activeTab === tab}
            >
              {' '}{tab.charAt(0).toUpperCase() + tab.slice(1)}{' '}
            </Text>
          </Box>
        ))}
        <Text color="gray" dimColor> (Tab to switch)</Text>
      </Box>
      <Text color="gray">{'─'.repeat(50)}</Text>

      {/* Content */}
      <Box flexDirection="column" height={contentHeight} paddingX={1}>
        {renderContent()}
      </Box>
    </Box>
  );
}
