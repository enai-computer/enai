import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { IntentLine } from './intent-line';

const meta = {
  component: IntentLine,
  parameters: {
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#fdfdfc' }, // step-1 color
        { name: 'dark', value: '#111110' },
      ],
    },
  },
} satisfies Meta<typeof IntentLine>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AsUsedInApp: Story = {
  args: {
    placeholder: "What would you like to find, organize, or do?",
    className: "w-full text-lg md:text-lg text-step-12 bg-transparent border-0 border-b-[1.5px] border-step-12/30 focus:ring-0 focus:border-step-12/50 placeholder:text-step-12 placeholder:opacity-100 placeholder:transition-opacity placeholder:duration-[1500ms]"
  },
};