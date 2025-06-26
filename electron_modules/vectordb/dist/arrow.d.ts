/// <reference types="node" />
import { Schema, Table as ArrowTable, Float } from 'apache-arrow';
import { type EmbeddingFunction } from './index';
export declare class VectorColumnOptions {
    /** Vector column type. */
    type: Float;
    constructor(values?: Partial<VectorColumnOptions>);
}
/** Options to control the makeArrowTable call. */
export declare class MakeArrowTableOptions {
    schema?: Schema;
    vectorColumns: Record<string, VectorColumnOptions>;
    /**
     * If true then string columns will be encoded with dictionary encoding
     *
     * Set this to true if your string columns tend to repeat the same values
     * often.  For more precise control use the `schema` property to specify the
     * data type for individual columns.
     *
     * If `schema` is provided then this property is ignored.
     */
    dictionaryEncodeStrings: boolean;
    constructor(values?: Partial<MakeArrowTableOptions>);
}
/**
 * An enhanced version of the {@link makeTable} function from Apache Arrow
 * that supports nested fields and embeddings columns.
 *
 * This function converts an array of Record<String, any> (row-major JS objects)
 * to an Arrow Table (a columnar structure)
 *
 * Note that it currently does not support nulls.
 *
 * If a schema is provided then it will be used to determine the resulting array
 * types.  Fields will also be reordered to fit the order defined by the schema.
 *
 * If a schema is not provided then the types will be inferred and the field order
 * will be controlled by the order of properties in the first record.
 *
 * If the input is empty then a schema must be provided to create an empty table.
 *
 * When a schema is not specified then data types will be inferred.  The inference
 * rules are as follows:
 *
 *  - boolean => Bool
 *  - number => Float64
 *  - String => Utf8
 *  - Buffer => Binary
 *  - Record<String, any> => Struct
 *  - Array<any> => List
 *
 * @param data input data
 * @param options options to control the makeArrowTable call.
 *
 * @example
 *
 * ```ts
 *
 * import { fromTableToBuffer, makeArrowTable } from "../arrow";
 * import { Field, FixedSizeList, Float16, Float32, Int32, Schema } from "apache-arrow";
 *
 * const schema = new Schema([
 *   new Field("a", new Int32()),
 *   new Field("b", new Float32()),
 *   new Field("c", new FixedSizeList(3, new Field("item", new Float16()))),
 *  ]);
 *  const table = makeArrowTable([
 *    { a: 1, b: 2, c: [1, 2, 3] },
 *    { a: 4, b: 5, c: [4, 5, 6] },
 *    { a: 7, b: 8, c: [7, 8, 9] },
 *  ], { schema });
 * ```
 *
 * By default it assumes that the column named `vector` is a vector column
 * and it will be converted into a fixed size list array of type float32.
 * The `vectorColumns` option can be used to support other vector column
 * names and data types.
 *
 * ```ts
 *
 * const schema = new Schema([
    new Field("a", new Float64()),
    new Field("b", new Float64()),
    new Field(
      "vector",
      new FixedSizeList(3, new Field("item", new Float32()))
    ),
  ]);
  const table = makeArrowTable([
    { a: 1, b: 2, vector: [1, 2, 3] },
    { a: 4, b: 5, vector: [4, 5, 6] },
    { a: 7, b: 8, vector: [7, 8, 9] },
  ]);
  assert.deepEqual(table.schema, schema);
 * ```
 *
 * You can specify the vector column types and names using the options as well
 *
 * ```typescript
 *
 * const schema = new Schema([
    new Field('a', new Float64()),
    new Field('b', new Float64()),
    new Field('vec1', new FixedSizeList(3, new Field('item', new Float16()))),
    new Field('vec2', new FixedSizeList(3, new Field('item', new Float16())))
  ]);
 * const table = makeArrowTable([
    { a: 1, b: 2, vec1: [1, 2, 3], vec2: [2, 4, 6] },
    { a: 4, b: 5, vec1: [4, 5, 6], vec2: [8, 10, 12] },
    { a: 7, b: 8, vec1: [7, 8, 9], vec2: [14, 16, 18] }
  ], {
    vectorColumns: {
      vec1: { type: new Float16() },
      vec2: { type: new Float16() }
    }
  }
 * assert.deepEqual(table.schema, schema)
 * ```
 */
export declare function makeArrowTable(data: Array<Record<string, any>>, options?: Partial<MakeArrowTableOptions>): ArrowTable;
/**
 * Create an empty Arrow table with the provided schema
 */
export declare function makeEmptyTable(schema: Schema): ArrowTable;
export declare function convertToTable<T>(data: Array<Record<string, unknown>>, embeddings?: EmbeddingFunction<T>, makeTableOptions?: Partial<MakeArrowTableOptions>): Promise<ArrowTable>;
/**
 * Serialize an Array of records into a buffer using the Arrow IPC File serialization
 *
 * This function will call `convertToTable` and pass on `embeddings` and `schema`
 *
 * `schema` is required if data is empty
 */
export declare function fromRecordsToBuffer<T>(data: Array<Record<string, unknown>>, embeddings?: EmbeddingFunction<T>, schema?: Schema): Promise<Buffer>;
/**
 * Serialize an Array of records into a buffer using the Arrow IPC Stream serialization
 *
 * This function will call `convertToTable` and pass on `embeddings` and `schema`
 *
 * `schema` is required if data is empty
 */
export declare function fromRecordsToStreamBuffer<T>(data: Array<Record<string, unknown>>, embeddings?: EmbeddingFunction<T>, schema?: Schema): Promise<Buffer>;
/**
 * Serialize an Arrow Table into a buffer using the Arrow IPC File serialization
 *
 * This function will apply `embeddings` to the table in a manner similar to
 * `convertToTable`.
 *
 * `schema` is required if the table is empty
 */
export declare function fromTableToBuffer<T>(table: ArrowTable, embeddings?: EmbeddingFunction<T>, schema?: Schema): Promise<Buffer>;
/**
 * Serialize an Arrow Table into a buffer using the Arrow IPC Stream serialization
 *
 * This function will apply `embeddings` to the table in a manner similar to
 * `convertToTable`.
 *
 * `schema` is required if the table is empty
 */
export declare function fromTableToStreamBuffer<T>(table: ArrowTable, embeddings?: EmbeddingFunction<T>, schema?: Schema): Promise<Buffer>;
export declare function createEmptyTable(schema: Schema): ArrowTable;
