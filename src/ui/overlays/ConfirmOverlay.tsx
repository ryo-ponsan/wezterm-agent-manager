import React from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmOverlay({ message, onConfirm, onCancel }: Props) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    }
    if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={2}
      paddingY={1}
      position="absolute"
      marginLeft={15}
      marginTop={8}
    >
      <Text bold color="red">Confirm</Text>
      <Text color="gray">{'─'.repeat(30)}</Text>
      <Box marginTop={1}><Text>{message}</Text></Box>
      <Box marginTop={1}>
        <Text color="green" bold>[y]</Text>
        <Text> Yes  </Text>
        <Text color="red" bold>[n]</Text>
        <Text> No</Text>
      </Box>
    </Box>
  );
}
