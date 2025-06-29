import { z } from 'zod';
import { IngestionJob } from '../../models/IngestionJobModel';

// Worker interface
export interface IIngestionWorker {
  execute(job: IngestionJob): Promise<void>;
}

// Progress information
export interface WorkerProgressInfo {
  stage: string;
  percent: number;
  message: string;
}

// Error classification
export interface ErrorClassification {
  isTransient: boolean;
  category: ErrorCategory;
  retryable: boolean;
  retryDelay?: number;
}

export enum ErrorCategory {
  NETWORK = 'network',
  STORAGE = 'storage',
  PARSING = 'parsing',
  AI_PROCESSING = 'ai_processing',
  PERMISSION = 'permission',
  RESOURCE = 'resource',
  UNKNOWN = 'unknown'
}

// Zod schemas for validation
export const WorkerProgressSchema = z.object({
  stage: z.string(),
  percent: z.number().min(0).max(100),
  message: z.string()
});

export const StructuredErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  category: z.nativeEnum(ErrorCategory).optional(),
  context: z.record(z.any()).optional(),
  stack: z.string().optional(),
  timestamp: z.string().datetime()
});

export type StructuredError = z.infer<typeof StructuredErrorSchema>;

// Job-specific data schemas
export const PdfJobDataSchema = z.object({
  filePath: z.string(),
  fileName: z.string(),
  fileSize: z.number().optional(),
  notebookId: z.string().optional()
});

export const UrlJobDataSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  relatedObjectId: z.string().optional(),
  objectId: z.string().optional(), // For reusing existing objects (WOM to LOM transition)
  fromWom: z.boolean().optional(), // Flag for WOM to LOM transitions
  notebookId: z.string().optional()
});

export const GmailJobDataSchema = z.object({
  userId: z.string(),
  syncType: z.string().optional()
});

export type PdfJobData = z.infer<typeof PdfJobDataSchema>;
export type UrlJobData = z.infer<typeof UrlJobDataSchema>;
export type GmailJobData = z.infer<typeof GmailJobDataSchema>;

// Type guards for job-specific data
export function isPdfJobData(data: any): data is PdfJobData {
  return PdfJobDataSchema.safeParse(data).success;
}

export function isUrlJobData(data: any): data is UrlJobData {
  return UrlJobDataSchema.safeParse(data).success;
}

export function isGmailJobData(data: any): data is GmailJobData {
  return GmailJobDataSchema.safeParse(data).success;
}

// Safe accessors for job-specific data
export function getPdfJobData(jobSpecificData: any): Partial<PdfJobData> {
  if (!jobSpecificData) return {};
  const result = PdfJobDataSchema.partial().safeParse(jobSpecificData);
  return result.success ? result.data : {};
}

export function getUrlJobData(jobSpecificData: any): Partial<UrlJobData> {
  if (!jobSpecificData) return {};
  const result = UrlJobDataSchema.partial().safeParse(jobSpecificData);
  return result.success ? result.data : {};
}

export function getGmailJobData(jobSpecificData: any): Partial<GmailJobData> {
  if (!jobSpecificData) return {};
  const result = GmailJobDataSchema.partial().safeParse(jobSpecificData);
  return result.success ? result.data : {};
}