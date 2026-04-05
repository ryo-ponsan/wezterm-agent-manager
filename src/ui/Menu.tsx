import React from 'react';
import { Box, Text } from 'ink';
import { getMenuKeys, type MenuState } from '../keys/keys.js';

interface Props {
  state: MenuState;
}

export function Menu({ state }: Props) {
  const keys = getMenuKeys(state);

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {keys.map((kb, i) => (
        <Box key={kb.action} marginRight={2}>
          <Text color="yellow" bold>{kb.key}</Text>
          <Text color="gray"> {kb.description}</Text>
        </Box>
      ))}
      <Box flexGrow={1} />
      <Text color="gray" dimColor>wam v0.1.0</Text>
    </Box>
  );
}
