import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Page } from './Page';

const meta = {
  component: Page,
} satisfies Meta<typeof Page>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};