"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfDocumentSchema = exports.PdfMetadataSchema = void 0;
const zod_1 = require("zod");
/**
 * Schema for PDF metadata from pdf-parse
 */
exports.PdfMetadataSchema = zod_1.z.object({
    info: zod_1.z.object({
        Title: zod_1.z.string().optional(),
        Author: zod_1.z.string().optional(),
        Subject: zod_1.z.string().optional(),
        Keywords: zod_1.z.string().optional(),
        Creator: zod_1.z.string().optional(),
        Producer: zod_1.z.string().optional(),
        CreationDate: zod_1.z.string().optional(),
        ModDate: zod_1.z.string().optional()
    }).optional(),
    metadata: zod_1.z.any().optional(), // pdf-parse can return various metadata formats
    numpages: zod_1.z.number().optional(),
    numrender: zod_1.z.number().optional(),
    version: zod_1.z.string().optional()
}).passthrough(); // Allow additional fields
/**
 * Schema for parsed PDF document
 */
exports.PdfDocumentSchema = zod_1.z.object({
    pageContent: zod_1.z.string(),
    metadata: exports.PdfMetadataSchema.optional()
});
//# sourceMappingURL=pdfSchemas.js.map