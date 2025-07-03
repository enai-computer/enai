import { vi } from 'vitest';

/**
 * Creates a mock logger with all standard methods.
 * Use this instead of mocking the logger module in each test file.
 */
export const createMockLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
});

/**
 * Default mock logger instance
 */
export const mockLogger = createMockLogger();

/**
 * Module mock for logger
 * Usage: vi.mock('../../utils/logger', () => mockLoggerModule)
 */
export const mockLoggerModule = {
  default: mockLogger,
  logger: mockLogger,
};