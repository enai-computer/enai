import type { Meta, StoryObj } from '@storybook/react';
import { OpenInNotebookButton } from '../components/ui/open-in-notebook-button';

// Mock window.api for Storybook
if (typeof window !== 'undefined') {
  (window as Window & { api: any }).api = {
    getRecentlyViewedNotebooks: async (limit: number) => {
      // Simulate loading delay
      await new Promise(resolve => setTimeout(resolve, 500));
      return [
        { id: '1', title: 'Project Research' },
        { id: '2', title: 'Meeting Notes' },
        { id: '3', title: 'Ideas & Brainstorming' },
        { id: '4', title: 'Technical Documentation' },
        { id: '5', title: 'Personal Journal' },
      ].slice(0, limit);
    },
    composeNotebook: async ({ }: { title: string }) => {
      await new Promise(resolve => setTimeout(resolve, 300));
      return { notebookId: 'new-notebook-id' };
    },
    setIntent: async (intent: unknown) => {
      console.log('Setting intent:', intent);
    },
  };
}

const meta = {
  title: 'UI/OpenInNotebookButton',
  component: OpenInNotebookButton,
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'light',
    },
  },
  tags: ['autodocs'],
  argTypes: {
    url: {
      control: 'text',
      description: 'The URL to open in a notebook',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes',
    },
  },
} satisfies Meta<typeof OpenInNotebookButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    url: 'https://example.com',
  },
};

export const LongURL: Story = {
  args: {
    url: 'https://www.example.com/very/long/path/to/some/resource?with=query&params=true',
  },
};

export const WithCustomClass: Story = {
  args: {
    url: 'https://example.com',
    className: 'shadow-lg',
  },
};

export const DarkMode: Story = {
  args: {
    url: 'https://example.com',
  },
  parameters: {
    backgrounds: {
      default: 'dark',
    },
  },
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
};