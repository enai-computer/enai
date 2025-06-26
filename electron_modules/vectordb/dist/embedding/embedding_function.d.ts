import { type Float } from 'apache-arrow';
/**
 * An embedding function that automatically creates vector representation for a given column.
 */
export interface EmbeddingFunction<T> {
    /**
     * The name of the column that will be used as input for the Embedding Function.
     */
    sourceColumn: string;
    /**
     * The data type of the embedding
     *
     * The embedding function should return `number`.  This will be converted into
     * an Arrow float array.  By default this will be Float32 but this property can
     * be used to control the conversion.
     */
    embeddingDataType?: Float;
    /**
     * The dimension of the embedding
     *
     * This is optional, normally this can be determined by looking at the results of
     * `embed`.  If this is not specified, and there is an attempt to apply the embedding
     * to an empty table, then that process will fail.
     */
    embeddingDimension?: number;
    /**
     * The name of the column that will contain the embedding
     *
     * By default this is "vector"
     */
    destColumn?: string;
    /**
     * Should the source column be excluded from the resulting table
     *
     * By default the source column is included.  Set this to true and
     * only the embedding will be stored.
     */
    excludeSource?: boolean;
    /**
     * Creates a vector representation for the given values.
     */
    embed: (data: T[]) => Promise<number[][]>;
}
export declare function isEmbeddingFunction<T>(value: any): value is EmbeddingFunction<T>;
