import type { Preview } from '@storybook/react'

// Mock window.api for components that use Electron IPC
if (typeof window !== 'undefined') {
  (window as any).api = {
    setIntent: () => {},
    // Add other API methods as needed
  };
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
};

export default preview;