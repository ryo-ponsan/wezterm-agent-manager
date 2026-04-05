import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  agentTitle: string;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export function SendPromptOverlay({ agentTitle, onSubmit, onCancel }: Props) {
  const [prompt, setPrompt] = useState('');

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      position="absolute"
      marginLeft={10}
      marginTop={5}
    >
      <Text bold color="green">Send Prompt</Text>
      <Text color="gray">{'─'.repeat(40)}</Text>
      <Box marginTop={1}>
        <Text color="gray" dimColor>To: </Text>
        <Text bold>{agentTitle}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="green">❯ </Text>
        <TextInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={(value) => {
            if (value.trim()) {
              onSubmit(value.trim());
            }
          }}
          placeholder="Enter prompt..."
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>Enter: send  Esc: cancel</Text>
      </Box>
    </Box>
  );
}
