import { Schema } from "apache-arrow";
/**
 * Convert something schemaLike into a Schema instance
 *
 * This method is often needed even when the caller is using a Schema
 * instance because they might be using a different instance of apache-arrow
 * than lancedb is using.
 */
export declare function sanitizeSchema(schemaLike: unknown): Schema;
