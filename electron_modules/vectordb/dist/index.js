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
exports.MetricType = exports.isWriteOptions = exports.DefaultWriteOptions = exports.WriteMode = exports.LocalTable = exports.LocalConnection = exports.connect = exports.makeArrowTable = exports.convertToTable = exports.OpenAIEmbeddingFunction = exports.Query = void 0;
const apache_arrow_1 = require("apache-arrow");
const arrow_1 = require("./arrow");
const remote_1 = require("./remote");
const query_1 = require("./query");
Object.defineProperty(exports, "Query", { enumerable: true, get: function () { return query_1.Query; } });
const embedding_function_1 = require("./embedding/embedding_function");
const util_1 = require("./util");
const { databaseNew, databaseTableNames, databaseOpenTable, databaseDropTable, tableCreate, tableAdd, tableCreateScalarIndex, tableCreateVectorIndex, tableCountRows, tableDelete, tableUpdate, tableMergeInsert, tableCleanupOldVersions, tableCompactFiles, tableListIndices, tableIndexStats, tableSchema, tableAddColumns, tableAlterColumns, tableDropColumns
// eslint-disable-next-line @typescript-eslint/no-var-requires
 } = require('../native.js');
var openai_1 = require("./embedding/openai");
Object.defineProperty(exports, "OpenAIEmbeddingFunction", { enumerable: true, get: function () { return openai_1.OpenAIEmbeddingFunction; } });
var arrow_2 = require("./arrow");
Object.defineProperty(exports, "convertToTable", { enumerable: true, get: function () { return arrow_2.convertToTable; } });
Object.defineProperty(exports, "makeArrowTable", { enumerable: true, get: function () { return arrow_2.makeArrowTable; } });
const defaultAwsRegion = 'us-west-2';
function getAwsArgs(opts) {
    const callArgs = [];
    const awsCredentials = opts.awsCredentials;
    if (awsCredentials !== undefined) {
        callArgs.push(awsCredentials.accessKeyId);
        callArgs.push(awsCredentials.secretKey);
        callArgs.push(awsCredentials.sessionToken);
    }
    else {
        callArgs.fill(undefined, 0, 3);
    }
    callArgs.push(opts.awsRegion);
    return callArgs;
}
async function connect(arg) {
    let opts;
    if (typeof arg === 'string') {
        opts = { uri: arg };
    }
    else {
        const keys = Object.keys(arg);
        if (keys.length === 1 && keys[0] === 'uri' && typeof arg.uri === 'string') {
            opts = { uri: arg.uri };
        }
        else {
            opts = Object.assign({
                uri: '',
                awsCredentials: undefined,
                awsRegion: defaultAwsRegion,
                apiKey: undefined,
                region: defaultAwsRegion
            }, arg);
        }
    }
    if (opts.uri.startsWith('db://')) {
        // Remote connection
        return new remote_1.RemoteConnection(opts);
    }
    const storageOptions = opts.storageOptions ?? {};
    if (opts.awsCredentials?.accessKeyId !== undefined) {
        storageOptions.aws_access_key_id = opts.awsCredentials.accessKeyId;
    }
    if (opts.awsCredentials?.secretKey !== undefined) {
        storageOptions.aws_secret_access_key = opts.awsCredentials.secretKey;
    }
    if (opts.awsCredentials?.sessionToken !== undefined) {
        storageOptions.aws_session_token = opts.awsCredentials.sessionToken;
    }
    if (opts.awsRegion !== undefined) {
        storageOptions.region = opts.awsRegion;
    }
    // It's a pain to pass a record to Rust, so we convert it to an array of key-value pairs
    const storageOptionsArr = Object.entries(storageOptions);
    const db = await databaseNew(opts.uri, storageOptionsArr, opts.readConsistencyInterval);
    return new LocalConnection(db, opts);
}
exports.connect = connect;
/**
 * A connection to a LanceDB database.
 */
class LocalConnection {
    constructor(db, options) {
        this._options = () => options;
        this._db = db;
    }
    get uri() {
        return this._options().uri;
    }
    /**
     * Get the names of all tables in the database.
     */
    async tableNames() {
        return databaseTableNames.call(this._db);
    }
    async openTable(name, embeddings) {
        const tbl = await databaseOpenTable.call(this._db, name);
        if (embeddings !== undefined) {
            return new LocalTable(tbl, name, this._options(), embeddings);
        }
        else {
            return new LocalTable(tbl, name, this._options());
        }
    }
    async createTable(name, data, optsOrEmbedding, opt) {
        if (typeof name === 'string') {
            let writeOptions = new DefaultWriteOptions();
            if (opt !== undefined && isWriteOptions(opt)) {
                writeOptions = opt;
            }
            else if (optsOrEmbedding !== undefined &&
                isWriteOptions(optsOrEmbedding)) {
                writeOptions = optsOrEmbedding;
            }
            let embeddings;
            if (optsOrEmbedding !== undefined &&
                (0, embedding_function_1.isEmbeddingFunction)(optsOrEmbedding)) {
                embeddings = optsOrEmbedding;
            }
            return await this.createTableImpl({
                name,
                data,
                embeddingFunction: embeddings,
                writeOptions
            });
        }
        return await this.createTableImpl(name);
    }
    async createTableImpl({ name, data, schema, embeddingFunction, writeOptions = new DefaultWriteOptions() }) {
        let buffer;
        function isEmpty(data) {
            if (data instanceof apache_arrow_1.Table) {
                return data.data.length === 0;
            }
            return data.length === 0;
        }
        if (data === undefined || isEmpty(data)) {
            if (schema === undefined) {
                throw new Error('Either data or schema needs to defined');
            }
            buffer = await (0, arrow_1.fromTableToBuffer)((0, arrow_1.createEmptyTable)(schema));
        }
        else if (data instanceof apache_arrow_1.Table) {
            buffer = await (0, arrow_1.fromTableToBuffer)(data, embeddingFunction, schema);
        }
        else {
            // data is Array<Record<...>>
            buffer = await (0, arrow_1.fromRecordsToBuffer)(data, embeddingFunction, schema);
        }
        const tbl = await tableCreate.call(this._db, name, buffer, writeOptions?.writeMode?.toString(), ...getAwsArgs(this._options()));
        if (embeddingFunction !== undefined) {
            return new LocalTable(tbl, name, this._options(), embeddingFunction);
        }
        else {
            return new LocalTable(tbl, name, this._options());
        }
    }
    /**
     * Drop an existing table.
     * @param name The name of the table to drop.
     */
    async dropTable(name) {
        await databaseDropTable.call(this._db, name);
    }
    withMiddleware(middleware) {
        return this;
    }
}
exports.LocalConnection = LocalConnection;
class LocalTable {
    constructor(tbl, name, options, embeddings) {
        this.where = this.filter;
        this._tbl = tbl;
        this._name = name;
        this._embeddings = embeddings;
        this._options = () => options;
        this._isElectron = this.checkElectron();
    }
    get name() {
        return this._name;
    }
    /**
     * Creates a search query to find the nearest neighbors of the given search term
     * @param query The query search term
     */
    search(query) {
        return new query_1.Query(query, this._tbl, this._embeddings);
    }
    /**
     * Creates a filter query to find all rows matching the specified criteria
     * @param value The filter criteria (like SQL where clause syntax)
     */
    filter(value) {
        return new query_1.Query(undefined, this._tbl, this._embeddings).filter(value);
    }
    /**
     * Insert records into this Table.
     *
     * @param data Records to be inserted into the Table
     * @return The number of rows added to the table
     */
    async add(data) {
        const schema = await this.schema;
        let tbl;
        if (data instanceof apache_arrow_1.Table) {
            tbl = data;
        }
        else {
            tbl = (0, arrow_1.makeArrowTable)(data, { schema });
        }
        return tableAdd
            .call(this._tbl, await (0, arrow_1.fromTableToBuffer)(tbl, this._embeddings, schema), WriteMode.Append.toString(), ...getAwsArgs(this._options()))
            .then((newTable) => {
            this._tbl = newTable;
        });
    }
    /**
     * Insert records into this Table, replacing its contents.
     *
     * @param data Records to be inserted into the Table
     * @return The number of rows added to the table
     */
    async overwrite(data) {
        let buffer;
        if (data instanceof apache_arrow_1.Table) {
            buffer = await (0, arrow_1.fromTableToBuffer)(data, this._embeddings);
        }
        else {
            buffer = await (0, arrow_1.fromRecordsToBuffer)(data, this._embeddings);
        }
        return tableAdd
            .call(this._tbl, buffer, WriteMode.Overwrite.toString(), ...getAwsArgs(this._options()))
            .then((newTable) => {
            this._tbl = newTable;
        });
    }
    /**
     * Create an ANN index on this Table vector index.
     *
     * @param indexParams The parameters of this Index, @see VectorIndexParams.
     */
    async createIndex(indexParams) {
        return tableCreateVectorIndex
            .call(this._tbl, indexParams)
            .then((newTable) => {
            this._tbl = newTable;
        });
    }
    async createScalarIndex(column, replace) {
        if (replace === undefined) {
            replace = true;
        }
        return tableCreateScalarIndex.call(this._tbl, column, replace);
    }
    /**
     * Returns the number of rows in this table.
     */
    async countRows(filter) {
        return tableCountRows.call(this._tbl, filter);
    }
    /**
     * Delete rows from this table.
     *
     * @param filter A filter in the same format used by a sql WHERE clause.
     */
    async delete(filter) {
        return tableDelete.call(this._tbl, filter).then((newTable) => {
            this._tbl = newTable;
        });
    }
    /**
     * Update rows in this table.
     *
     * @param args see {@link UpdateArgs} and {@link UpdateSqlArgs} for more details
     *
     * @returns
     */
    async update(args) {
        let filter;
        let updates;
        if ('valuesSql' in args) {
            filter = args.where ?? null;
            updates = args.valuesSql;
        }
        else {
            filter = args.where ?? null;
            updates = {};
            for (const [key, value] of Object.entries(args.values)) {
                updates[key] = (0, util_1.toSQL)(value);
            }
        }
        return tableUpdate
            .call(this._tbl, filter, updates)
            .then((newTable) => {
            this._tbl = newTable;
        });
    }
    async mergeInsert(on, data, args) {
        let whenMatchedUpdateAll = false;
        let whenMatchedUpdateAllFilt = null;
        if (args.whenMatchedUpdateAll !== undefined && args.whenMatchedUpdateAll !== null) {
            whenMatchedUpdateAll = true;
            if (args.whenMatchedUpdateAll !== true) {
                whenMatchedUpdateAllFilt = args.whenMatchedUpdateAll;
            }
        }
        const whenNotMatchedInsertAll = args.whenNotMatchedInsertAll ?? false;
        let whenNotMatchedBySourceDelete = false;
        let whenNotMatchedBySourceDeleteFilt = null;
        if (args.whenNotMatchedBySourceDelete !== undefined && args.whenNotMatchedBySourceDelete !== null) {
            whenNotMatchedBySourceDelete = true;
            if (args.whenNotMatchedBySourceDelete !== true) {
                whenNotMatchedBySourceDeleteFilt = args.whenNotMatchedBySourceDelete;
            }
        }
        const schema = await this.schema;
        let tbl;
        if (data instanceof apache_arrow_1.Table) {
            tbl = data;
        }
        else {
            tbl = (0, arrow_1.makeArrowTable)(data, { schema });
        }
        const buffer = await (0, arrow_1.fromTableToBuffer)(tbl, this._embeddings, schema);
        this._tbl = await tableMergeInsert.call(this._tbl, on, whenMatchedUpdateAll, whenMatchedUpdateAllFilt, whenNotMatchedInsertAll, whenNotMatchedBySourceDelete, whenNotMatchedBySourceDeleteFilt, buffer);
    }
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
    async cleanupOldVersions(olderThan, deleteUnverified) {
        return tableCleanupOldVersions
            .call(this._tbl, olderThan, deleteUnverified)
            .then((res) => {
            this._tbl = res.newTable;
            return res.metrics;
        });
    }
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
    async compactFiles(options) {
        const optionsArg = options ?? {};
        return tableCompactFiles
            .call(this._tbl, optionsArg)
            .then((res) => {
            this._tbl = res.newTable;
            return res.metrics;
        });
    }
    async listIndices() {
        return tableListIndices.call(this._tbl);
    }
    async indexStats(indexUuid) {
        return tableIndexStats.call(this._tbl, indexUuid);
    }
    get schema() {
        // empty table
        return this.getSchema();
    }
    async getSchema() {
        const buffer = await tableSchema.call(this._tbl, this._isElectron);
        const table = (0, apache_arrow_1.tableFromIPC)(buffer);
        return table.schema;
    }
    // See https://github.com/electron/electron/issues/2288
    checkElectron() {
        try {
            // eslint-disable-next-line no-prototype-builtins
            return (Object.prototype.hasOwnProperty.call(process?.versions, 'electron') ||
                navigator?.userAgent?.toLowerCase()?.includes(' electron'));
        }
        catch (e) {
            return false;
        }
    }
    async addColumns(newColumnTransforms) {
        return tableAddColumns.call(this._tbl, newColumnTransforms);
    }
    async alterColumns(columnAlterations) {
        return tableAlterColumns.call(this._tbl, columnAlterations);
    }
    async dropColumns(columnNames) {
        return tableDropColumns.call(this._tbl, columnNames);
    }
    withMiddleware(middleware) {
        return this;
    }
}
exports.LocalTable = LocalTable;
/**
 * Write mode for writing a table.
 */
var WriteMode;
(function (WriteMode) {
    /** Create a new {@link Table}. */
    WriteMode["Create"] = "create";
    /** Overwrite the existing {@link Table} if presented. */
    WriteMode["Overwrite"] = "overwrite";
    /** Append new data to the table. */
    WriteMode["Append"] = "append";
})(WriteMode || (exports.WriteMode = WriteMode = {}));
class DefaultWriteOptions {
    constructor() {
        this.writeMode = WriteMode.Create;
    }
}
exports.DefaultWriteOptions = DefaultWriteOptions;
function isWriteOptions(value) {
    return (Object.keys(value).length === 1 &&
        (value.writeMode === undefined || typeof value.writeMode === 'string'));
}
exports.isWriteOptions = isWriteOptions;
/**
 * Distance metrics type.
 */
var MetricType;
(function (MetricType) {
    /**
     * Euclidean distance
     */
    MetricType["L2"] = "l2";
    /**
     * Cosine distance
     */
    MetricType["Cosine"] = "cosine";
    /**
     * Dot product
     */
    MetricType["Dot"] = "dot";
})(MetricType || (exports.MetricType = MetricType = {}));
//# sourceMappingURL=index.js.map