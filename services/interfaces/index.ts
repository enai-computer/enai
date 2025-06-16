import Database from 'better-sqlite3';
import { ChromaClient } from 'chromadb';

/**
 * Base interface for all services
 */
export interface IService {
  /**
   * Initialize the service during application bootstrap
   */
  initialize(): Promise<void>;

  /**
   * Cleanup resources during application shutdown
   */
  cleanup(): Promise<void>;

  /**
   * Check if the service is healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Common dependencies that many services need
 */
export interface BaseServiceDependencies {
  db: Database.Database;
}

/**
 * Dependencies for services that need vector storage
 */
export interface VectorServiceDependencies extends BaseServiceDependencies {
  chromaClient: ChromaClient;
}

/**
 * Configuration for service initialization
 */
export interface ServiceConfig {
  /**
   * Whether to run service initialization in parallel
   */
  parallel?: boolean;

  /**
   * Timeout for service initialization in milliseconds
   */
  initTimeout?: number;

  /**
   * Whether to continue if a service fails to initialize
   */
  continueOnError?: boolean;
}

/**
 * Service metadata for registration
 */
export interface ServiceMetadata {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
}

/**
 * Service instance with metadata
 */
export interface ServiceInstance<T extends IService = IService> {
  service: T;
  metadata: ServiceMetadata;
}

/**
 * Type for service constructors
 */
export type ServiceConstructor<T extends IService = IService, D = any> = new (deps: D) => T;

/**
 * Service factory function type
 */
export type ServiceFactory<T extends IService = IService, D = any> = (deps: D) => T;

/**
 * Health check result for a service
 */
export interface ServiceHealthResult {
  service: string;
  healthy: boolean;
  message?: string;
  details?: any;
  timestamp: Date;
}

/**
 * Result of service initialization
 */
export interface ServiceInitResult {
  service: string;
  success: boolean;
  error?: Error;
  duration: number;
}