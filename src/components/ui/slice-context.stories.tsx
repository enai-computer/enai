import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SliceContext } from './slice-context';

const meta = {
  component: SliceContext,
} satisfies Meta<typeof SliceContext>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};