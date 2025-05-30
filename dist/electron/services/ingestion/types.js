"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UrlJobDataSchema = exports.PdfJobDataSchema = exports.StructuredErrorSchema = exports.WorkerProgressSchema = exports.ErrorCategory = void 0;
exports.isPdfJobData = isPdfJobData;
exports.isUrlJobData = isUrlJobData;
exports.getPdfJobData = getPdfJobData;
exports.getUrlJobData = getUrlJobData;
const zod_1 = require("zod");
var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["NETWORK"] = "network";
    ErrorCategory["STORAGE"] = "storage";
    ErrorCategory["PARSING"] = "parsing";
    ErrorCategory["AI_PROCESSING"] = "ai_processing";
    ErrorCategory["PERMISSION"] = "permission";
    ErrorCategory["RESOURCE"] = "resource";
    ErrorCategory["UNKNOWN"] = "unknown";
})(ErrorCategory || (exports.ErrorCategory = ErrorCategory = {}));
// Zod schemas for validation
exports.WorkerProgressSchema = zod_1.z.object({
    stage: zod_1.z.string(),
    percent: zod_1.z.number().min(0).max(100),
    message: zod_1.z.string()
});
exports.StructuredErrorSchema = zod_1.z.object({
    type: zod_1.z.string(),
    message: zod_1.z.string(),
    category: zod_1.z.nativeEnum(ErrorCategory).optional(),
    context: zod_1.z.record(zod_1.z.any()).optional(),
    stack: zod_1.z.string().optional(),
    timestamp: zod_1.z.string().datetime()
});
// Job-specific data schemas
exports.PdfJobDataSchema = zod_1.z.object({
    filePath: zod_1.z.string(),
    fileName: zod_1.z.string(),
    fileSize: zod_1.z.number().optional(),
    notebookId: zod_1.z.string().optional()
});
exports.UrlJobDataSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    relatedObjectId: zod_1.z.string().optional(),
    notebookId: zod_1.z.string().optional()
});
// Type guards for job-specific data
function isPdfJobData(data) {
    return exports.PdfJobDataSchema.safeParse(data).success;
}
function isUrlJobData(data) {
    return exports.UrlJobDataSchema.safeParse(data).success;
}
// Safe accessors for job-specific data
function getPdfJobData(jobSpecificData) {
    if (!jobSpecificData)
        return {};
    const result = exports.PdfJobDataSchema.partial().safeParse(jobSpecificData);
    return result.success ? result.data : {};
}
function getUrlJobData(jobSpecificData) {
    if (!jobSpecificData)
        return {};
    const result = exports.UrlJobDataSchema.partial().safeParse(jobSpecificData);
    return result.success ? result.data : {};
}
//# sourceMappingURL=types.js.map