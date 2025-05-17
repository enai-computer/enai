import type { Meta, StoryObj } from '@storybook/react';

import { IntentLine } from './intent-line';

const meta = {
  component: IntentLine,
} satisfies Meta<typeof IntentLine>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};