import { type Schema, Table as ArrowTable } from 'apache-arrow';
import type { EmbeddingFunction } from './embedding/embedding_function';
import { Query } from './query';
import { type Literal } from './util';
import { type HttpMiddleware } from './middleware';
export { Query };
export type { EmbeddingFunction };
export { OpenAIEmbeddingFunction } from './embedding/openai';
export { convertToTable, makeArrowTable, type MakeArrowTableOptions } from './arrow';
export interface AwsCredentials {
    accessKeyId: string;
    secretKey: string;
    sessionToken?: string;
}
export interface ConnectionOptions {
    /**
     * LanceDB database URI.
     *
     * - `/path/to/database` - local database
     * - `s3://bucket/path/to/database` or `gs://bucket/path/to/database` - database on cloud storage
     * - `db://host:port` - remote database (LanceDB cloud)
     */
    uri: string;
    /** User provided AWS crednetials.
     *
     * If not provided, LanceDB will use the default credentials provider chain.
     *
     * @deprecated Pass `aws_access_key_id`, `aws_secret_access_key`, and `aws_session_token`
     * through `storageOptions` instead.
     */
    awsCredentials?: AwsCredentials;
    /** AWS region to connect to. Default is {@link defaultAwsRegion}
     *
     * @deprecated Pass `region` through `storageOptions` instead.
     */
    awsRegion?: string;
    /**
     * User provided options for object storage. For example, S3 credentials or request timeouts.
     *
     * The various options are described at https://lancedb.github.io/lancedb/guides/storage/
     */
    storageOptions?: Record<string, string>;
    /**
     * API key for the remote connections
     *
     * Can also be passed by setting environment variable `LANCEDB_API_KEY`
     */
    apiKey?: string;
    /** Region to connect */
    region?: string;
    /**
     * Override the host URL for the remote connection.
     *
     * This is useful for local testing.
     */
    hostOverride?: string;
    /**
     * (For LanceDB OSS only): The interval, in seconds, at which to check for
     * updates to the table from other processes. If None, then consistency is not
     * checked. For performance reasons, this is the default. For strong
     * consistency, set this to zero seconds. Then every read will check for
     * updates from other processes. As a compromise, you can set this to a
     * non-zero value for eventual consistency. If more than that interval
     * has passed since the last check, then the table will be checked for updates.
     * Note: this consistency only applies to read operations. Write operations are
     * always consistent.
     */
    readConsistencyInterval?: number;
}
export interface CreateTableOptions<T> {
    name: string;
    data?: Array<Record<string, unknown>> | ArrowTable | undefined;
    schema?: Schema | undefined;
    embeddingFunction?: EmbeddingFunction<T> | undefined;
    writeOptions?: WriteOptions | undefined;
}
/**
 * Connect to a LanceDB instance at the given URI.
 *
 * Accepted formats:
 *
 * - `/path/to/database` - local database
 * - `s3://bucket/path/to/database` or `gs://bucket/path/to/database` - database on cloud storage
 * - `db://host:port` - remote database (LanceDB cloud)
 *
 * @param uri The uri of the database. If the database uri starts with `db://` then it connects to a remote database.
 *
 * @see {@link ConnectionOptions} for more details on the URI format.
 */
export declare function connect(uri: string): Promise<Connection>;
/**
 * Connect to a LanceDB instance with connection options.
 *
 * @param opts The {@link ConnectionOptions} to use when connecting to the database.
 */
export declare function connect(opts: Partial<ConnectionOptions>): Promise<Connection>;
/**
 * A LanceDB Connection that allows you to open tables and create new ones.
 *
 * Connection could be local against filesystem or remote against a server.
 */
export interface Connection {
    uri: string;
    tableNames(): Promise<string[]>;
    /**
     * Open a table in the database.
     *
     * @param name The name of the table.
     * @param embeddings An embedding function to use on this table
     */
    openTable<T>(name: string, embeddings?: EmbeddingFunction<T>): Promise<Table<T>>;
    /**
     * Creates a new Table, optionally initializing it with new data.
     *
     * @param {string} name - The name of the table.
     * @param data - Array of Records to be inserted into the table
     * @param schema - An Arrow Schema that describe this table columns
     * @param {EmbeddingFunction} embeddings - An embedding function to use on this table
     * @param {WriteOptions} writeOptions - The write options to use when creating the table.
     */
    createTable<T>({ name, data, schema, embeddingFunction, writeOptions }: CreateTableOptions<T>): Promise<Table<T>>;
    /**
     * Creates a new Table and initialize it with new data.
     *
     * @param {string} name - The name of the table.
     * @param data - Non-empty Array of Records to be inserted into the table
     */
    createTable(name: string, data: Array<Record<string, unknown>> | ArrowTable): Promise<Table>;
    /**
     * Creates a new Table and initialize it with new data.
     *
     * @param {string} name - The name of the table.
     * @param data - Non-empty Array of Records to be inserted into the table
     * @param {WriteOptions} options - The write options to use when creating the table.
     */
    createTable(name: string, data: Array<Record<string, unknown>> | ArrowTable, options: WriteOptions): Promise<Table>;
    /**
     * Creates a new Table and initialize it with new data.
     *
     * @param {string} name - The name of the table.
     * @param data - Non-empty Array of Records to be inserted into the table
     * @param {EmbeddingFunction} embeddings - An embedding function to use on this table
     */
    createTable<T>(name: string, data: Array<Record<string, unknown>> | ArrowTable, embeddings: EmbeddingFunction<T>): Promise<Table<T>>;
    /**
     * Creates a new Table and initialize it with new data.
     *
     * @param {string} name - The name of the table.
     * @param data - Non-empty Array of Records to be inserted into the table
     * @param {EmbeddingFunction} embeddings - An embedding function to use on this table
     * @param {WriteOptions} options - The write options to use when creating the table.
     */
    createTable<T>(name: string, data: Array<Record<string, unknown>> | ArrowTable, embeddings: EmbeddingFunction<T>, options: WriteOptions): Promise<Table<T>>;
    /**
     * Drop an existing table.
     * @param name The name of the table to drop.
     */
    dropTable(name: string): Promise<void>;
    /**
     * Instrument the behavior of this Connection with middleware.
     *
     * The middleware will be called in the order they are added.
     *
     * Currently this functionality is only supported for remote Connections.
     *
     * @param {HttpMiddleware} - Middleware which will instrument the Connection.
     * @returns - this Connection instrumented by the passed middleware
     */
    withMiddleware(middleware: HttpMiddleware): Connection;
}
/**
 * A LanceDB Table is the collection of Records. Each Record has one or more vector fields.
 */
export interface Table<T = number[]> {
    name: string;
    /**
     * Creates a search query to find the nearest neighbors of the given search term
     * @param query The query search term
     */
    search: (query: T) => Query<T>;
    /**
     * Insert records into this Table.
     *
     * @param data Records to be inserted into the Table
     * @return The number of rows added to the table
     */
    add: (data: Array<Record<string, unknown>> | ArrowTable) => Promise<number>;
    /**
     * Insert records into this Table, replacing its contents.
     *
     * @param data Records to be inserted into the Table
     * @return The number of rows added to the table
     */
    overwrite: (data: Array<Record<string, unknown>> | ArrowTable) => Promise<number>;
    /**
     * Create an ANN index on this Table vector index.
     *
     * @param indexParams The parameters of this Index, @see VectorIndexParams.
     */
    createIndex: (indexParams: VectorIndexParams) => Promise<any>;
    /**
     * Create a scalar index on this Table for the given column
     *
     * @param column The column to index
     * @param replace If false, fail if an index already exists on the column
     * it is always set to true for remote connections
     *
     * Scalar indices, like vector indices, can be used to speed up scans.  A scalar
     * index can speed up scans that contain filter expressions on the indexed column.
     * For example, the following scan will be faster if the column `my_col` has
     * a scalar index:
     *
     * ```ts
     * const con = await lancedb.connect('./.lancedb');
     * const table = await con.openTable('images');
     * const results = await table.where('my_col = 7').execute();
     * ```
     *
     * Scalar indices can also speed up scans containing a vector search and a
     * prefilter:
     *
     * ```ts
     * const con = await lancedb.connect('././lancedb');
     * const table = await con.openTable('images');
     * const results = await table.search([1.0, 2.0]).where('my_col != 7').prefilter(true);
     * ```
     *
     * Scalar indices can only speed up scans for basic filters using
     * equality, comparison, range (e.g. `my_col BETWEEN 0 AND 100`), and set
     * membership (e.g. `my_col IN (0, 1, 2)`)
     *
     * Scalar indices can be used if the filter contains multiple indexed columns and
     * the filter criteria are AND'd or OR'd together
     * (e.g. `my_col < 0 AND other_col> 100`)
     *
     * Scalar indices may be used if the filter contains non-indexed columns but,
     * depending on the structure of the filter, they may not be usable.  For example,
     * if the column `not_indexed` does not have a scalar index then the filter
     * `my_col = 0 OR not_indexed = 1` will not be able to use any scalar index on
     * `my_col`.
     *
     * @examples
     *
     * ```ts
     * const con = await lancedb.connect('././lancedb')
     * const table = await con.openTable('images')
     * await table.createScalarIndex('my_col')
     * ```
     */
    createScalarIndex: (column: string, replace?: boolean) => Promise<void>;
    /**
     * Returns the number of rows in this table.
     */
    countRows: (filter?: string) => Promise<number>;
    /**
     * Delete rows from this table.
     *
     * This can be used to delete a single row, many rows, all rows, or
     * sometimes no rows (if your predicate matches nothing).
     *
     * @param filter  A filter in the same format used by a sql WHERE clause. The
     *                filter must not be empty.
     *
     * @examples
     *
     * ```ts
     * const con = await lancedb.connect("./.lancedb")
     * const data = [
     *    {id: 1, vector: [1, 2]},
     *    {id: 2, vector: [3, 4]},
     *    {id: 3, vector: [5, 6]},
     * ];
     * const tbl = await con.createTable("my_table", data)
     * await tbl.delete("id = 2")
     * await tbl.countRows() // Returns 2
     * ```
     *
     * If you have a list of values to delete, you can combine them into a
     * stringified list and use the `IN` operator:
     *
     * ```ts
     * const to_remove = [1, 5];
     * await tbl.delete(`id IN (${to_remove.join(",")})`)
     * await tbl.countRows() // Returns 1
     * ```
     */
    delete: (filter: string) => Promise<void>;
    /**
     * Update rows in this table.
     *
     * This can be used to update a single row, many rows, all rows, or
     * sometimes no rows (if your predicate matches nothing).
     *
     * @param args see {@link UpdateArgs} and {@link UpdateSqlArgs} for more details
     *
     * @examples
     *
     * ```ts
     * const con = await lancedb.connect("./.lancedb")
     * const data = [
     *    {id: 1, vector: [3, 3], name: 'Ye'},
     *    {id: 2, vector: [4, 4], name: 'Mike'},
     * ];
     * const tbl = await con.createTable("my_table", data)
     *
     * await tbl.update({
     *   where: "id = 2",
     *   values: { vector: [2, 2], name: "Michael" },
     * })
     *
     * let results = await tbl.search([1, 1]).execute();
     * // Returns [
     * //   {id: 2, vector: [2, 2], name: 'Michael'}
     * //   {id: 1, vector: [3, 3], name: 'Ye'}
     * // ]
     * ```
     *
     */
    update: (args: UpdateArgs | UpdateSqlArgs) => Promise<void>;
    /**
     * Runs a "merge insert" operation on the table
     *
     * This operation can add rows, update rows, and remove rows all in a single
     * transaction. It is a very generic tool that can be used to create
     * behaviors like "insert if not exists", "update or insert (i.e. upsert)",
     * or even replace a portion of existing data with new data (e.g. replace
     * all data where month="january")
     *
     * The merge insert operation works by combining new data from a
     * **source table** with existing data in a **target table** by using a
     * join.  There are three categories of records.
     *
     * "Matched" records are records that exist in both the source table and
     * the target table. "Not matched" records exist only in the source table
     * (e.g. these are new data) "Not matched by source" records exist only
     * in the target table (this is old data)
     *
     * The MergeInsertArgs can be used to customize what should happen for
     * each category of data.
     *
     * Please note that the data may appear to be reordered as part of this
     * operation.  This is because updated rows will be deleted from the
     * dataset and then reinserted at the end with the new values.
     *
     * @param on a column to join on.  This is how records from the source
     *           table and target table are matched.
     * @param data the new data to insert
     * @param args parameters controlling how the operation should behave
     */
    mergeInsert: (on: string, data: Array<Record<string, unknown>> | ArrowTable, args: MergeInsertArgs) => Promise<void>;
    /**
     * List the indicies on this table.
     */
    listIndices: () => Promise<VectorIndex[]>;
    /**
     * Get statistics about an index.
     */
    indexStats: (indexUuid: string) => Promise<IndexStats>;
    filter(value: string): Query<T>;
    schema: Promise<Schema>;
    /**
     * Add new columns with defined values.
     *
     * @param newColumnTransforms pairs of column names and the SQL expression to use
     *                            to calculate the value of the new column. These
     *                            expressions will be evaluated for each row in the
     *                            table, and can reference existing columns in the table.
     */
    addColumns(newColumnTransforms: Array<{
        name: string;
        valueSql: string;
    }>): Promise<void>;
    /**
     * Alter the name or nullability of columns.
     *
     * @param columnAlterations One or more alterations to apply to columns.
     */
    alterColumns(columnAlterations: ColumnAlteration[]): Promise<void>;
    /**
     * Drop one or more columns from the dataset
     *
     * This is a metadata-only operation and does not remove the data from the
     * underlying storage. In order to remove the data, you must subsequently
     * call ``compact_files`` to rewrite the data without the removed columns and
     * then call ``cleanup_files`` to remove the old files.
     *
     * @param columnNames The names of the columns to drop. These can be nested
     *                    column references (e.g. "a.b.c") or top-level column
     *                    names (e.g. "a").
     */
    dropColumns(columnNames: string[]): Promise<void>;
    /**
     * Instrument the behavior of this Table with middleware.
     *
     * The middleware will be called in the order they are added.
     *
     * Currently this functionality is only supported for remote tables.
     *
     * @param {HttpMiddleware} - Middleware which will instrument the Table.
     * @returns - this Table instrumented by the passed middleware
     */
    withMiddleware(middleware: HttpMiddleware): Table<T>;
}
/**
 * A definition of a column alteration. The alteration changes the column at
 * `path` to have the new name `name`, to be nullable if `nullable` is true,
 * and to have the data type `data_type`. At least one of `rename` or `nullable`
 * must be provided.
 */
export interface ColumnAlteration {
    /**
     * The path to the column to alter. This is a dot-separated path to the column.
     * If it is a top-level column then it is just the name of the column. If it is
     * a nested column then it is the path to the column, e.g. "a.b.c" for a column
     * `c` nested inside a column `b` nested inside a column `a`.
     */
    path: string;
    rename?: string;
    /**
     * Set the new nullability. Note that a nullable column cannot be made non-nullable.
     */
    nullable?: boolean;
}
export interface UpdateArgs {
    /**
     * A filter in the same format used by a sql WHERE clause. The filter may be empty,
     * in which case all rows will be updated.
     */
    where?: string;
    /**
     * A key-value map of updates. The keys are the column names, and the values are the
     * new values to set
     */
    values: Record<string, Literal>;
}
export interface UpdateSqlArgs {
    /**
     * A filter in the same format used by a sql WHERE clause. The filter may be empty,
     * in which case all rows will be updated.
     */
    where?: string;
    /**
     * A key-value map of updates. The keys are the column names, and the values are the
     * new values to set as SQL expressions.
     */
    valuesSql: Record<string, string>;
}
export interface MergeInsertArgs {
    /**
     * If true then rows that exist in both the source table (new data) and
     * the target table (old data) will be updated, replacing the old row
     * with the corresponding matching row.
     *
     * If there are multiple matches then the behavior is undefined.
     * Currently this causes multiple copies of the row to be created
     * but that behavior is subject to change.
     *
     * Optionally, a filter can be specified.  This should be an SQL
     * filter where fields with the prefix "target." refer to fields
     * in the target table (old data) and fields with the prefix
     * "source." refer to fields in the source table (new data).  For
     * example, the filter "target.lastUpdated < source.lastUpdated" will
     * only update matched rows when the incoming `lastUpdated` value is
     * newer.
     *
     * Rows that do not match the filter will not be updated.  Rows that
     * do not match the filter do become "not matched" rows.
     */
    whenMatchedUpdateAll?: string | boolean;
    /**
     * If true then rows that exist only in the source table (new data)
     * will be inserted into the target table.
     */
    whenNotMatchedInsertAll?: boolean;
    /**
     * If true then rows that exist only in the target table (old data)
     * will be deleted.
     *
     * If this is a string then it will be treated as an SQL filter and
     * only rows that both do not match any row in the source table and
     * match the given filter will be deleted.
     *
     * This can be used to replace a selection of existing data with
     * new data.
     */
    whenNotMatchedBySourceDelete?: string | boolean;
}
export interface VectorIndex {
    columns: string[];
    name: string;
    uuid: string;
}
export interface IndexStats {
    numIndexedRows: number | null;
    numUnindexedRows: number | null;
}
/**
 * A connection to a LanceDB database.
 */
export declare class LocalConnection implements Connection {
    private readonly _options;
    private readonly _db;
    constructor(db: any, options: ConnectionOptions);
    get uri(): string;
    /**
     * Get the names of all tables in the database.
     */
    tableNames(): Promise<string[]>;
    /**
     * Open a table in the database.
     *
     * @param name The name of the table.
     */
    openTable(name: string): Promise<Table>;
    /**
     * Open a table in the database.
     *
     * @param name The name of the table.
     * @param embeddings An embedding function to use on this Table
     */
    openTable<T>(name: string, embeddings: EmbeddingFunction<T>): Promise<Table<T>>;
    openTable<T>(name: string, embeddings?: EmbeddingFunction<T>): Promise<Table<T>>;
    createTable<T>(name: string | CreateTableOptions<T>, data?: Array<Record<string, unknown>> | ArrowTable, optsOrEmbedding?: WriteOptions | EmbeddingFunction<T>, opt?: WriteOptions): Promise<Table<T>>;
    private createTableImpl;
    /**
     * Drop an existing table.
     * @param name The name of the table to drop.
     */
    dropTable(name: string): Promise<void>;
    withMiddleware(middleware: HttpMiddleware): Connection;
}
export declare class LocalTable<T = number[]> implements Table<T> {
    private _tbl;
    private readonly _name;
    private readonly _isElectron;
    private readonly _embeddings?;
    private readonly _options;
    constructor(tbl: any, name: string, options: ConnectionOptions);
    /**
     * @param tbl
     * @param name
     * @param options
     * @param embeddings An embedding function to use when interacting with this table
     */
    constructor(tbl: any, name: string, options: ConnectionOptions, embeddings: EmbeddingFunction<T>);
    get name(): string;
    /**
     * Creates a search query to find the nearest neighbors of the given search term
     * @param query The query search term
     */
    search(query: T): Query<T>;
    /**
     * Creates a filter query to find all rows matching the specified criteria
     * @param value The filter criteria (like SQL where clause syntax)
     */
    filter(value: string): Query<T>;
    where: (value: string) => Query<T>;
    /**
     * Insert records into this Table.
     *
     * @param data Records to be inserted into the Table
     * @return The number of rows added to the table
     */
    add(data: Array<Record<string, unknown>> | ArrowTable): Promise<number>;
    /**
     * Insert records into this Table, replacing its contents.
     *
     * @param data Records to be inserted into the Table
     * @return The number of rows added to the table
     */
    overwrite(data: Array<Record<string, unknown>> | ArrowTable): Promise<number>;
    /**
     * Create an ANN index on this Table vector index.
     *
     * @param indexParams The parameters of this Index, @see VectorIndexParams.
     */
    createIndex(indexParams: VectorIndexParams): Promise<any>;
    createScalarIndex(column: string, replace?: boolean): Promise<void>;
    /**
     * Returns the number of rows in this table.
     */
    countRows(filter?: string): Promise<number>;
    /**
     * Delete rows from this table.
     *
     * @param filter A filter in the same format used by a sql WHERE clause.
     */
    delete(filter: string): Promise<void>;
    /**
     * Update rows in this table.
     *
     * @param args see {@link UpdateArgs} and {@link UpdateSqlArgs} for more details
     *
     * @returns
     */
    update(args: UpdateArgs | UpdateSqlArgs): Promise<void>;
    mergeInsert(on: string, data: Array<Record<string, unknown>> | ArrowTable, args: MergeInsertArgs): Promise<void>;
    /**
     * Clean up old versions of the table, freeing disk space.
     *
     * @param olderThan The minimum age in minutes of the versions to delete. If not
     *                  provided, defaults to two weeks.
     * @param deleteUnverified Because they may be part of an in-progress
     *                  transaction, uncommitted files newer than 7 days old are
     *                  not deleted by default. This means that failed transactions
     *                  can leave around data that takes up disk space for up to
     *                  7 days. You can override this safety mechanism by setting
     *                 this option to `true`, only if you promise there are no
     *                 in progress writes while you run this operation. Failure to
     *                 uphold this promise can lead to corrupted tables.
     * @returns
     */
    cleanupOldVersions(olderThan?: number, deleteUnverified?: boolean): Promise<CleanupStats>;
    /**
     * Run the compaction process on the table.
     *
     * This can be run after making several small appends to optimize the table
     * for faster reads.
     *
     * @param options Advanced options configuring compaction. In most cases, you
     *               can omit this arguments, as the default options are sensible
     *               for most tables.
     * @returns Metrics about the compaction operation.
     */
    compactFiles(options?: CompactionOptions): Promise<CompactionMetrics>;
    listIndices(): Promise<VectorIndex[]>;
    indexStats(indexUuid: string): Promise<IndexStats>;
    get schema(): Promise<Schema>;
    private getSchema;
    private checkElectron;
    addColumns(newColumnTransforms: Array<{
        name: string;
        valueSql: string;
    }>): Promise<void>;
    alterColumns(columnAlterations: ColumnAlteration[]): Promise<void>;
    dropColumns(columnNames: string[]): Promise<void>;
    withMiddleware(middleware: HttpMiddleware): Table<T>;
}
export interface CleanupStats {
    /**
     * The number of bytes removed from disk.
     */
    bytesRemoved: number;
    /**
     * The number of old table versions removed.
     */
    oldVersions: number;
}
export interface CompactionOptions {
    /**
     * The number of rows per fragment to target. Fragments that have fewer rows
     * will be compacted into adjacent fragments to produce larger fragments.
     * Defaults to 1024 * 1024.
     */
    targetRowsPerFragment?: number;
    /**
     * The maximum number of rows per group. Defaults to 1024.
     */
    maxRowsPerGroup?: number;
    /**
     * If true, fragments that have rows that are deleted may be compacted to
     * remove the deleted rows. This can improve the performance of queries.
     * Default is true.
     */
    materializeDeletions?: boolean;
    /**
     * A number between 0 and 1, representing the proportion of rows that must be
     * marked deleted before a fragment is a candidate for compaction to remove
     * the deleted rows. Default is 10%.
     */
    materializeDeletionsThreshold?: number;
    /**
     * The number of threads to use for compaction. If not provided, defaults to
     * the number of cores on the machine.
     */
    numThreads?: number;
}
export interface CompactionMetrics {
    /**
     * The number of fragments that were removed.
     */
    fragmentsRemoved: number;
    /**
     * The number of new fragments that were created.
     */
    fragmentsAdded: number;
    /**
     * The number of files that were removed. Each fragment may have more than one
     * file.
     */
    filesRemoved: number;
    /**
     * The number of files added. This is typically equal to the number of
     * fragments added.
     */
    filesAdded: number;
}
export interface IvfPQIndexConfig {
    /**
     * The column to be indexed
     */
    column?: string;
    /**
     * A unique name for the index
     */
    index_name?: string;
    /**
     * Metric type, L2 or Cosine
     */
    metric_type?: MetricType;
    /**
     * The number of partitions this index
     */
    num_partitions?: number;
    /**
     * The max number of iterations for kmeans training.
     */
    max_iters?: number;
    /**
     * Train as optimized product quantization.
     */
    use_opq?: boolean;
    /**
     * Number of subvectors to build PQ code
     */
    num_sub_vectors?: number;
    /**
     * The number of bits to present one PQ centroid.
     */
    num_bits?: number;
    /**
     * Max number of iterations to train OPQ, if `use_opq` is true.
     */
    max_opq_iters?: number;
    /**
     * Replace an existing index with the same name if it exists.
     */
    replace?: boolean;
    /**
     * Cache size of the index
     */
    index_cache_size?: number;
    type: 'ivf_pq';
}
export type VectorIndexParams = IvfPQIndexConfig;
/**
 * Write mode for writing a table.
 */
export declare enum WriteMode {
    /** Create a new {@link Table}. */
    Create = "create",
    /** Overwrite the existing {@link Table} if presented. */
    Overwrite = "overwrite",
    /** Append new data to the table. */
    Append = "append"
}
/**
 * Write options when creating a Table.
 */
export interface WriteOptions {
    /** A {@link WriteMode} to use on this operation */
    writeMode?: WriteMode;
}
export declare class DefaultWriteOptions implements WriteOptions {
    writeMode: WriteMode;
}
export declare function isWriteOptions(value: any): value is WriteOptions;
/**
 * Distance metrics type.
 */
export declare enum MetricType {
    /**
     * Euclidean distance
     */
    L2 = "l2",
    /**
     * Cosine distance
     */
    Cosine = "cosine",
    /**
     * Dot product
     */
    Dot = "dot"
}
