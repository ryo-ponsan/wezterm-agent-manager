export interface KeyBinding {
  key: string;
  description: string;
  action: string;
}

/** Menu state determines which keys are shown. */
export type MenuState = 'default' | 'empty' | 'new_instance' | 'prompt';

export const KEY_BINDINGS: Record<string, KeyBinding> = {
  // Navigation
  moveUp: { key: 'up', description: '↑ Move up', action: 'moveUp' },
  moveDown: { key: 'down', description: '↓ Move down', action: 'moveDown' },

  // Tabs
  nextTab: { key: 'tab', description: 'Tab Switch tab', action: 'nextTab' },

  // Instance management
  newInstance: { key: 'n', description: 'n New instance', action: 'newInstance' },
  newWithPrompt: { key: 'N', description: 'N New with prompt', action: 'newWithPrompt' },
  killInstance: { key: 'D', description: 'D Kill instance', action: 'killInstance' },
  attachInstance: { key: 'return', description: '↵ Attach', action: 'attachInstance' },

  // Git
  pushBranch: { key: 'p', description: 'p Push', action: 'pushBranch' },
  pauseInstance: { key: 'c', description: 'c Checkout (pause)', action: 'pauseInstance' },
  resumeInstance: { key: 'r', description: 'r Resume', action: 'resumeInstance' },

  // UI
  showHelp: { key: '?', description: '? Help', action: 'showHelp' },
  quit: { key: 'q', description: 'q Quit', action: 'quit' },
};

/** Get the key bindings to display in the menu based on the current state. */
export function getMenuKeys(state: MenuState): KeyBinding[] {
  switch (state) {
    case 'empty':
      return [
        KEY_BINDINGS.newInstance,
        KEY_BINDINGS.newWithPrompt,
        KEY_BINDINGS.showHelp,
        KEY_BINDINGS.quit,
      ];

    case 'new_instance':
      return [
        KEY_BINDINGS.moveUp,
        KEY_BINDINGS.moveDown,
        KEY_BINDINGS.attachInstance,
        KEY_BINDINGS.quit,
      ];

    case 'prompt':
      // Minimal keys while typing a prompt
      return [
        KEY_BINDINGS.quit,
      ];

    case 'default':
    default:
      return [
        KEY_BINDINGS.moveUp,
        KEY_BINDINGS.moveDown,
        KEY_BINDINGS.nextTab,
        KEY_BINDINGS.newInstance,
        KEY_BINDINGS.newWithPrompt,
        KEY_BINDINGS.killInstance,
        KEY_BINDINGS.attachInstance,
        KEY_BINDINGS.pushBranch,
        KEY_BINDINGS.pauseInstance,
        KEY_BINDINGS.resumeInstance,
        KEY_BINDINGS.showHelp,
        KEY_BINDINGS.quit,
      ];
  }
}
