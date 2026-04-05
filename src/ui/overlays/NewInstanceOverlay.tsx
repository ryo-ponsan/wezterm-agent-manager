import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Profile } from '../../config/config.js';

interface Props {
  onSubmit: (title: string, program: string, repoPath: string, prompt?: string) => void;
  onCancel: () => void;
  profiles: Profile[];
  defaultDir: string;
  withPrompt?: boolean;
}

type Step = 'repo' | 'title' | 'profile' | 'prompt';

export function NewInstanceOverlay({ onSubmit, onCancel, profiles, defaultDir, withPrompt }: Props) {
  const [step, setStep] = useState<Step>('repo');
  const [repoPath, setRepoPath] = useState(defaultDir);
  const [title, setTitle] = useState('');
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [prompt, setPrompt] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (step === 'profile') {
      if (key.upArrow || input === 'k') {
        setSelectedProfile(prev => Math.max(0, prev - 1));
      }
      if (key.downArrow || input === 'j') {
        setSelectedProfile(prev => Math.min(profiles.length - 1, prev + 1));
      }
      if (key.return) {
        if (withPrompt) {
          setStep('prompt');
        } else {
          onSubmit(title, profiles[selectedProfile]!.name, repoPath);
        }
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      position="absolute"
      marginLeft={10}
      marginTop={5}
    >
      <Text bold color="cyan">New Instance</Text>
      <Text color="gray">{'─'.repeat(40)}</Text>

      {/* Step 1: Repository path */}
      {step === 'repo' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Repository path:</Text>
          <Box>
            <Text color="cyan">▸ </Text>
            <TextInput
              value={repoPath}
              onChange={setRepoPath}
              onSubmit={(value) => {
                if (value.trim()) {
                  setRepoPath(value.trim());
                  setStep('title');
                }
              }}
              placeholder={defaultDir}
            />
          </Box>
          <Box marginTop={1}><Text color="gray" dimColor>Enter to use default, or type a different repo path</Text></Box>
        </Box>
      )}

      {/* Step 2: Instance name */}
      {step === 'title' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" dimColor>Repo: {repoPath}</Text>
          <Text>Instance name:</Text>
          <Box>
            <Text color="cyan">▸ </Text>
            <TextInput
              value={title}
              onChange={setTitle}
              onSubmit={(value) => {
                if (value.trim()) {
                  setTitle(value.trim());
                  setStep('profile');
                }
              }}
              placeholder="e.g., fix-auth-bug"
            />
          </Box>
        </Box>
      )}

      {/* Step 3: Agent selection */}
      {step === 'profile' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" dimColor>Repo: {repoPath}</Text>
          <Text color="gray" dimColor>Name: {title}</Text>
          <Text>Select agent:</Text>
          {profiles.map((p, i) => (
            <Box key={p.name}>
              <Text color={i === selectedProfile ? 'cyan' : 'gray'}>
                {i === selectedProfile ? '▸ ' : '  '}
              </Text>
              <Text bold={i === selectedProfile} color={i === selectedProfile ? 'white' : 'gray'}>
                {p.name}
              </Text>
              <Text color="gray" dimColor> ({p.program})</Text>
            </Box>
          ))}
          <Box marginTop={1}><Text color="gray" dimColor>↑↓ select, Enter confirm, Esc cancel</Text></Box>
        </Box>
      )}

      {/* Step 4: Prompt (optional) */}
      {step === 'prompt' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" dimColor>Repo: {repoPath} | Name: {title}</Text>
          <Text>Initial prompt:</Text>
          <Box>
            <Text color="cyan">▸ </Text>
            <TextInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={(value) => {
                onSubmit(title, profiles[selectedProfile]!.name, repoPath, value || undefined);
              }}
              placeholder="Enter a prompt for the agent..."
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
