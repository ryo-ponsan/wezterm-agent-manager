import React from 'react';
import { Box, Text, useInput } from 'ink';
import { KEY_BINDINGS } from '../../keys/keys.js';

interface Props {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: Props) {
  useInput((input, key) => {
    if (key.escape || input === '?' || input === 'q') {
      onClose();
    }
  });

  const sections = [
    {
      title: 'Navigation',
      keys: [
        { key: '↑/k', desc: 'Move up' },
        { key: '↓/j', desc: 'Move down' },
        { key: 'Tab', desc: 'Switch tab (Preview/Diff/Terminal)' },
        { key: 'Shift+↑↓', desc: 'Scroll in diff view' },
      ],
    },
    {
      title: 'Instance Management',
      keys: [
        { key: 'n', desc: 'New instance' },
        { key: 'N', desc: 'New instance with prompt' },
        { key: 'D', desc: 'Kill (delete) instance' },
        { key: 'Enter/o', desc: 'Attach to instance (focus pane)' },
      ],
    },
    {
      title: 'Git Operations',
      keys: [
        { key: 'p', desc: 'Push branch to remote' },
        { key: 'c', desc: 'Checkout (commit & pause)' },
        { key: 'r', desc: 'Resume paused instance' },
      ],
    },
    {
      title: 'General',
      keys: [
        { key: '?', desc: 'Toggle this help' },
        { key: 'q', desc: 'Quit' },
      ],
    },
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      position="absolute"
      marginLeft={5}
      marginTop={2}
    >
      <Text bold color="yellow"> Help - Key Bindings</Text>
      <Text color="gray">{'─'.repeat(40)}</Text>

      {sections.map((section) => (
        <Box key={section.title} flexDirection="column" marginTop={1}>
          <Text bold color="cyan">{section.title}</Text>
          {section.keys.map((k) => (
            <Box key={k.key}>
              <Box width={16}>
                <Text color="yellow" bold>{k.key}</Text>
              </Box>
              <Text color="white">{k.desc}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1}><Text color="gray" dimColor>Press Esc or ? to close</Text></Box>
    </Box>
  );
}
