import type { StorybookConfig } from "@storybook/nextjs-vite";
import path from "path";

const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@storybook/addon-onboarding",
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-docs"
  ],
  "framework": {
    "name": "@storybook/nextjs-vite",
    "options": {}
  },
  "staticDirs": [
    "../public"
  ],
  "viteFinal": async (config) => {
    // Handle path aliases
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "../src"),
    };
    
    // Mock next/font modules for Storybook
    config.resolve.alias['next/font/local'] = path.resolve(__dirname, 'mocks/next-font.js');
    
    return config;
  }
};
export default config;