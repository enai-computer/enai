import { z } from 'zod';

/**
 * Schema for PDF metadata from pdf-parse
 */
export const PdfMetadataSchema = z.object({
  info: z.object({
    Title: z.string().optional(),
    Author: z.string().optional(),
    Subject: z.string().optional(),
    Keywords: z.string().optional(),
    Creator: z.string().optional(),
    Producer: z.string().optional(),
    CreationDate: z.string().optional(),
    ModDate: z.string().optional()
  }).optional(),
  metadata: z.any().optional(), // pdf-parse can return various metadata formats
  numpages: z.number().optional(),
  numrender: z.number().optional(),
  version: z.string().optional()
}).passthrough(); // Allow additional fields

/**
 * Schema for parsed PDF document
 */
export const PdfDocumentSchema = z.object({
  pageContent: z.string(),
  metadata: PdfMetadataSchema.optional()
});

export type PdfMetadata = z.infer<typeof PdfMetadataSchema>;
export type PdfDocument = z.infer<typeof PdfDocumentSchema>;