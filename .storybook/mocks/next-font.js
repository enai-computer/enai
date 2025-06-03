// Mock for next/font/local in Storybook
export default function localFont(config) {
  return {
    className: '',
    style: {},
    variable: config.variable || '--font-mock',
  };
}