"use strict";
// Copyright 2023 Lance Developers.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyTable = exports.fromTableToStreamBuffer = exports.fromTableToBuffer = exports.fromRecordsToStreamBuffer = exports.fromRecordsToBuffer = exports.convertToTable = exports.makeEmptyTable = exports.makeArrowTable = exports.MakeArrowTableOptions = exports.VectorColumnOptions = void 0;
const apache_arrow_1 = require("apache-arrow");
const sanitize_1 = require("./sanitize");
/*
 * Options to control how a column should be converted to a vector array
 */
class VectorColumnOptions {
    constructor(values) {
        /** Vector column type. */
        this.type = new apache_arrow_1.Float32();
        Object.assign(this, values);
    }
}
exports.VectorColumnOptions = VectorColumnOptions;
/** Options to control the makeArrowTable call. */
class MakeArrowTableOptions {
    constructor(values) {
        /*
         * Mapping from vector column name to expected type
         *
         * Lance expects vector columns to be fixed size list arrays (i.e. tensors)
         * However, `makeArrowTable` will not infer this by default (it creates
         * variable size list arrays).  This field can be used to indicate that a column
         * should be treated as a vector column and converted to a fixed size list.
         *
         * The keys should be the names of the vector columns.  The value specifies the
         * expected data type of the vector columns.
         *
         * If `schema` is provided then this field is ignored.
         *
         * By default, the column named "vector" will be assumed to be a float32
         * vector column.
         */
        this.vectorColumns = {
            vector: new VectorColumnOptions()
        };
        /**
         * If true then string columns will be encoded with dictionary encoding
         *
         * Set this to true if your string columns tend to repeat the same values
         * often.  For more precise control use the `schema` property to specify the
         * data type for individual columns.
         *
         * If `schema` is provided then this property is ignored.
         */
        this.dictionaryEncodeStrings = false;
        Object.assign(this, values);
    }
}
exports.MakeArrowTableOptions = MakeArrowTableOptions;
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
function makeArrowTable(data, options) {
    if (data.length === 0 && (options?.schema === undefined || options?.schema === null)) {
        throw new Error('At least one record or a schema needs to be provided');
    }
    const opt = new MakeArrowTableOptions(options !== undefined ? options : {});
    if (opt.schema !== undefined && opt.schema !== null) {
        opt.schema = (0, sanitize_1.sanitizeSchema)(opt.schema);
    }
    const columns = {};
    // TODO: sample dataset to find missing columns
    // Prefer the field ordering of the schema, if present
    const columnNames = ((opt.schema) != null) ? opt.schema.names : Object.keys(data[0]);
    for (const colName of columnNames) {
        if (data.length !== 0 && !Object.prototype.hasOwnProperty.call(data[0], colName)) {
            // The field is present in the schema, but not in the data, skip it
            continue;
        }
        // Extract a single column from the records (transpose from row-major to col-major)
        let values = data.map((datum) => datum[colName]);
        // By default (type === undefined) arrow will infer the type from the JS type
        let type;
        if (opt.schema !== undefined) {
            // If there is a schema provided, then use that for the type instead
            type = opt.schema?.fields.filter((f) => f.name === colName)[0]?.type;
            if (apache_arrow_1.DataType.isInt(type) && type.bitWidth === 64) {
                // wrap in BigInt to avoid bug: https://github.com/apache/arrow/issues/40051
                values = values.map((v) => {
                    if (v === null) {
                        return v;
                    }
                    return BigInt(v);
                });
            }
        }
        else {
            // Otherwise, check to see if this column is one of the vector columns
            // defined by opt.vectorColumns and, if so, use the fixed size list type
            const vectorColumnOptions = opt.vectorColumns[colName];
            if (vectorColumnOptions !== undefined) {
                type = newVectorType(values[0].length, vectorColumnOptions.type);
            }
        }
        try {
            // Convert an Array of JS values to an arrow vector
            columns[colName] = makeVector(values, type, opt.dictionaryEncodeStrings);
        }
        catch (error) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            throw Error(`Could not convert column "${colName}" to Arrow: ${error}`);
        }
    }
    if (opt.schema != null) {
        // `new ArrowTable(columns)` infers a schema which may sometimes have
        // incorrect nullability (it assumes nullable=true if there are 0 rows)
        //
        // `new ArrowTable(schema, columns)` will also fail because it will create a
        // batch with an inferred schema and then complain that the batch schema
        // does not match the provided schema.
        //
        // To work around this we first create a table with the wrong schema and
        // then patch the schema of the batches so we can use
        // `new ArrowTable(schema, batches)` which does not do any schema inference
        const firstTable = new apache_arrow_1.Table(columns);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const batchesFixed = firstTable.batches.map(batch => new apache_arrow_1.RecordBatch(opt.schema, batch.data));
        return new apache_arrow_1.Table(opt.schema, batchesFixed);
    }
    else {
        return new apache_arrow_1.Table(columns);
    }
}
exports.makeArrowTable = makeArrowTable;
/**
 * Create an empty Arrow table with the provided schema
 */
function makeEmptyTable(schema) {
    return makeArrowTable([], { schema });
}
exports.makeEmptyTable = makeEmptyTable;
// Helper function to convert Array<Array<any>> to a variable sized list array
function makeListVector(lists) {
    if (lists.length === 0 || lists[0].length === 0) {
        throw Error('Cannot infer list vector from empty array or empty list');
    }
    const sampleList = lists[0];
    let inferredType;
    try {
        const sampleVector = makeVector(sampleList);
        inferredType = sampleVector.type;
    }
    catch (error) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw Error(`Cannot infer list vector.  Cannot infer inner type: ${error}`);
    }
    const listBuilder = (0, apache_arrow_1.makeBuilder)({
        type: new apache_arrow_1.List(new apache_arrow_1.Field('item', inferredType, true))
    });
    for (const list of lists) {
        listBuilder.append(list);
    }
    return listBuilder.finish().toVector();
}
// Helper function to convert an Array of JS values to an Arrow Vector
function makeVector(values, type, stringAsDictionary) {
    if (type !== undefined) {
        // No need for inference, let Arrow create it
        return (0, apache_arrow_1.vectorFromArray)(values, type);
    }
    if (values.length === 0) {
        throw Error('makeVector requires at least one value or the type must be specfied');
    }
    const sampleValue = values.find(val => val !== null && val !== undefined);
    if (sampleValue === undefined) {
        throw Error('makeVector cannot infer the type if all values are null or undefined');
    }
    if (Array.isArray(sampleValue)) {
        // Default Arrow inference doesn't handle list types
        return makeListVector(values);
    }
    else if (Buffer.isBuffer(sampleValue)) {
        // Default Arrow inference doesn't handle Buffer
        return (0, apache_arrow_1.vectorFromArray)(values, new apache_arrow_1.Binary());
    }
    else if (!(stringAsDictionary ?? false) && (typeof sampleValue === 'string' || sampleValue instanceof String)) {
        // If the type is string then don't use Arrow's default inference unless dictionaries are requested
        // because it will always use dictionary encoding for strings
        return (0, apache_arrow_1.vectorFromArray)(values, new apache_arrow_1.Utf8());
    }
    else {
        // Convert a JS array of values to an arrow vector
        return (0, apache_arrow_1.vectorFromArray)(values);
    }
}
async function applyEmbeddings(table, embeddings, schema) {
    if (embeddings == null) {
        return table;
    }
    if (schema !== undefined && schema !== null) {
        schema = (0, sanitize_1.sanitizeSchema)(schema);
    }
    // Convert from ArrowTable to Record<String, Vector>
    const colEntries = [...Array(table.numCols).keys()].map((_, idx) => {
        const name = table.schema.fields[idx].name;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const vec = table.getChildAt(idx);
        return [name, vec];
    });
    const newColumns = Object.fromEntries(colEntries);
    const sourceColumn = newColumns[embeddings.sourceColumn];
    const destColumn = embeddings.destColumn ?? 'vector';
    const innerDestType = embeddings.embeddingDataType ?? new apache_arrow_1.Float32();
    if (sourceColumn === undefined) {
        throw new Error(`Cannot apply embedding function because the source column '${embeddings.sourceColumn}' was not present in the data`);
    }
    if (table.numRows === 0) {
        if (Object.prototype.hasOwnProperty.call(newColumns, destColumn)) {
            // We have an empty table and it already has the embedding column so no work needs to be done
            // Note: we don't return an error like we did below because this is a common occurrence.  For example,
            // if we call convertToTable with 0 records and a schema that includes the embedding
            return table;
        }
        if (embeddings.embeddingDimension !== undefined) {
            const destType = newVectorType(embeddings.embeddingDimension, innerDestType);
            newColumns[destColumn] = makeVector([], destType);
        }
        else if (schema != null) {
            const destField = schema.fields.find(f => f.name === destColumn);
            if (destField != null) {
                newColumns[destColumn] = makeVector([], destField.type);
            }
            else {
                throw new Error(`Attempt to apply embeddings to an empty table failed because schema was missing embedding column '${destColumn}'`);
            }
        }
        else {
            throw new Error('Attempt to apply embeddings to an empty table when the embeddings function does not specify `embeddingDimension`');
        }
    }
    else {
        if (Object.prototype.hasOwnProperty.call(newColumns, destColumn)) {
            throw new Error(`Attempt to apply embeddings to table failed because column ${destColumn} already existed`);
        }
        if (table.batches.length > 1) {
            throw new Error('Internal error: `makeArrowTable` unexpectedly created a table with more than one batch');
        }
        const values = sourceColumn.toArray();
        const vectors = await embeddings.embed(values);
        if (vectors.length !== values.length) {
            throw new Error('Embedding function did not return an embedding for each input element');
        }
        const destType = newVectorType(vectors[0].length, innerDestType);
        newColumns[destColumn] = makeVector(vectors, destType);
    }
    const newTable = new apache_arrow_1.Table(newColumns);
    if (schema != null) {
        if (schema.fields.find(f => f.name === destColumn) === undefined) {
            throw new Error(`When using embedding functions and specifying a schema the schema should include the embedding column but the column ${destColumn} was missing`);
        }
        return alignTable(newTable, schema);
    }
    return newTable;
}
/*
 * Convert an Array of records into an Arrow Table, optionally applying an
 * embeddings function to it.
 *
 * This function calls `makeArrowTable` first to create the Arrow Table.
 * Any provided `makeTableOptions` (e.g. a schema) will be passed on to
 * that call.
 *
 * The embedding function will be passed a column of values (based on the
 * `sourceColumn` of the embedding function) and expects to receive back
 * number[][] which will be converted into a fixed size list column.  By
 * default this will be a fixed size list of Float32 but that can be
 * customized by the `embeddingDataType` property of the embedding function.
 *
 * If a schema is provided in `makeTableOptions` then it should include the
 * embedding columns.  If no schema is provded then embedding columns will
 * be placed at the end of the table, after all of the input columns.
 */
async function convertToTable(data, embeddings, makeTableOptions) {
    const table = makeArrowTable(data, makeTableOptions);
    return await applyEmbeddings(table, embeddings, makeTableOptions?.schema);
}
exports.convertToTable = convertToTable;
// Creates the Arrow Type for a Vector column with dimension `dim`
function newVectorType(dim, innerType) {
    // Somewhere we always default to have the elements nullable, so we need to set it to true
    // otherwise we often get schema mismatches because the stored data always has schema with nullable elements
    const children = new apache_arrow_1.Field('item', innerType, true);
    return new apache_arrow_1.FixedSizeList(dim, children);
}
/**
 * Serialize an Array of records into a buffer using the Arrow IPC File serialization
 *
 * This function will call `convertToTable` and pass on `embeddings` and `schema`
 *
 * `schema` is required if data is empty
 */
async function fromRecordsToBuffer(data, embeddings, schema) {
    if (schema !== undefined && schema !== null) {
        schema = (0, sanitize_1.sanitizeSchema)(schema);
    }
    const table = await convertToTable(data, embeddings, { schema });
    const writer = apache_arrow_1.RecordBatchFileWriter.writeAll(table);
    return Buffer.from(await writer.toUint8Array());
}
exports.fromRecordsToBuffer = fromRecordsToBuffer;
/**
 * Serialize an Array of records into a buffer using the Arrow IPC Stream serialization
 *
 * This function will call `convertToTable` and pass on `embeddings` and `schema`
 *
 * `schema` is required if data is empty
 */
async function fromRecordsToStreamBuffer(data, embeddings, schema) {
    if (schema !== null && schema !== undefined) {
        schema = (0, sanitize_1.sanitizeSchema)(schema);
    }
    const table = await convertToTable(data, embeddings, { schema });
    const writer = apache_arrow_1.RecordBatchStreamWriter.writeAll(table);
    return Buffer.from(await writer.toUint8Array());
}
exports.fromRecordsToStreamBuffer = fromRecordsToStreamBuffer;
/**
 * Serialize an Arrow Table into a buffer using the Arrow IPC File serialization
 *
 * This function will apply `embeddings` to the table in a manner similar to
 * `convertToTable`.
 *
 * `schema` is required if the table is empty
 */
async function fromTableToBuffer(table, embeddings, schema) {
    if (schema !== null && schema !== undefined) {
        schema = (0, sanitize_1.sanitizeSchema)(schema);
    }
    const tableWithEmbeddings = await applyEmbeddings(table, embeddings, schema);
    const writer = apache_arrow_1.RecordBatchFileWriter.writeAll(tableWithEmbeddings);
    return Buffer.from(await writer.toUint8Array());
}
exports.fromTableToBuffer = fromTableToBuffer;
/**
 * Serialize an Arrow Table into a buffer using the Arrow IPC Stream serialization
 *
 * This function will apply `embeddings` to the table in a manner similar to
 * `convertToTable`.
 *
 * `schema` is required if the table is empty
 */
async function fromTableToStreamBuffer(table, embeddings, schema) {
    if (schema !== null && schema !== undefined) {
        schema = (0, sanitize_1.sanitizeSchema)(schema);
    }
    const tableWithEmbeddings = await applyEmbeddings(table, embeddings, schema);
    const writer = apache_arrow_1.RecordBatchStreamWriter.writeAll(tableWithEmbeddings);
    return Buffer.from(await writer.toUint8Array());
}
exports.fromTableToStreamBuffer = fromTableToStreamBuffer;
function alignBatch(batch, schema) {
    const alignedChildren = [];
    for (const field of schema.fields) {
        const indexInBatch = batch.schema.fields?.findIndex((f) => f.name === field.name);
        if (indexInBatch < 0) {
            throw new Error(`The column ${field.name} was not found in the Arrow Table`);
        }
        alignedChildren.push(batch.data.children[indexInBatch]);
    }
    const newData = (0, apache_arrow_1.makeData)({
        type: new apache_arrow_1.Struct(schema.fields),
        length: batch.numRows,
        nullCount: batch.nullCount,
        children: alignedChildren
    });
    return new apache_arrow_1.RecordBatch(schema, newData);
}
function alignTable(table, schema) {
    const alignedBatches = table.batches.map((batch) => alignBatch(batch, schema));
    return new apache_arrow_1.Table(schema, alignedBatches);
}
// Creates an empty Arrow Table
function createEmptyTable(schema) {
    return new apache_arrow_1.Table((0, sanitize_1.sanitizeSchema)(schema));
}
exports.createEmptyTable = createEmptyTable;
//# sourceMappingURL=arrow.js.map