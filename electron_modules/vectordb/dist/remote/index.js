"use strict";
// Copyright 2023 LanceDB Developers.
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
exports.RemoteTable = exports.RemoteQuery = exports.RemoteConnection = void 0;
const index_1 = require("../index");
const query_1 = require("../query");
const apache_arrow_1 = require("apache-arrow");
const client_1 = require("./client");
const embedding_function_1 = require("../embedding/embedding_function");
const arrow_1 = require("../arrow");
const util_1 = require("../util");
/**
 * Remote connection.
 */
class RemoteConnection {
    constructor(opts) {
        this._tableCache = new util_1.TTLCache(300000);
        if (!opts.uri.startsWith('db://')) {
            throw new Error(`Invalid remote DB URI: ${opts.uri}`);
        }
        if (opts.apiKey == null || opts.apiKey === '') {
            opts = Object.assign({}, opts, { apiKey: process.env.LANCEDB_API_KEY });
        }
        if (opts.apiKey === undefined || opts.region === undefined) {
            throw new Error('API key and region are must be passed for remote connections. ' +
                'API key can also be set through LANCEDB_API_KEY env variable.');
        }
        this._dbName = opts.uri.slice('db://'.length);
        let server;
        if (opts.hostOverride === undefined) {
            server = `https://${this._dbName}.${opts.region}.api.lancedb.com`;
        }
        else {
            server = opts.hostOverride;
        }
        this._client = new client_1.HttpLancedbClient(server, opts.apiKey, opts.hostOverride === undefined ? undefined : this._dbName);
    }
    get uri() {
        // add the lancedb+ prefix back
        return 'db://' + this._client.uri;
    }
    async tableNames(pageToken = '', limit = 10) {
        const response = await this._client.get('/v1/table/', {
            limit: `${limit}`,
            page_token: pageToken
        });
        const body = await response.body();
        for (const table of body.tables) {
            this._tableCache.set(table, true);
        }
        return body.tables;
    }
    async openTable(name, embeddings) {
        // check if the table exists
        if (this._tableCache.get(name) === undefined) {
            await this._client.post(`/v1/table/${encodeURIComponent(name)}/describe/`);
            this._tableCache.set(name, true);
        }
        if (embeddings !== undefined) {
            return new RemoteTable(this._client, name, embeddings);
        }
        else {
            return new RemoteTable(this._client, name);
        }
    }
    async createTable(nameOrOpts, data, optsOrEmbedding, opt) {
        // Logic copied from LocatlConnection, refactor these to a base class + connectionImpl pattern
        let schema;
        let embeddings;
        let tableName;
        if (typeof nameOrOpts === 'string') {
            if (optsOrEmbedding !== undefined &&
                (0, embedding_function_1.isEmbeddingFunction)(optsOrEmbedding)) {
                embeddings = optsOrEmbedding;
            }
            tableName = nameOrOpts;
        }
        else {
            schema = nameOrOpts.schema;
            embeddings = nameOrOpts.embeddingFunction;
            tableName = nameOrOpts.name;
            if (data === undefined) {
                data = nameOrOpts.data;
            }
        }
        let buffer;
        function isEmpty(data) {
            if (data instanceof apache_arrow_1.Table) {
                return data.numRows === 0;
            }
            return data.length === 0;
        }
        if (data === undefined || isEmpty(data)) {
            if (schema === undefined) {
                throw new Error('Either data or schema needs to defined');
            }
            buffer = await (0, arrow_1.fromTableToStreamBuffer)((0, arrow_1.createEmptyTable)(schema));
        }
        else if (data instanceof apache_arrow_1.Table) {
            buffer = await (0, arrow_1.fromTableToStreamBuffer)(data, embeddings);
        }
        else {
            // data is Array<Record<...>>
            buffer = await (0, arrow_1.fromRecordsToStreamBuffer)(data, embeddings);
        }
        const res = await this._client.post(`/v1/table/${encodeURIComponent(tableName)}/create/`, buffer, undefined, 'application/vnd.apache.arrow.stream');
        if (res.status !== 200) {
            throw new Error(`Server Error, status: ${res.status}, ` +
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `message: ${res.statusText}: ${await res.body()}`);
        }
        this._tableCache.set(tableName, true);
        if (embeddings === undefined) {
            return new RemoteTable(this._client, tableName);
        }
        else {
            return new RemoteTable(this._client, tableName, embeddings);
        }
    }
    async dropTable(name) {
        await this._client.post(`/v1/table/${encodeURIComponent(name)}/drop/`);
        this._tableCache.delete(name);
    }
    withMiddleware(middleware) {
        const wrapped = this.clone();
        wrapped._client = wrapped._client.withMiddleware(middleware);
        return wrapped;
    }
    clone() {
        const clone = Object.create(RemoteConnection.prototype);
        return Object.assign(clone, this);
    }
}
exports.RemoteConnection = RemoteConnection;
class RemoteQuery extends query_1.Query {
    constructor(query, _client, _name, embeddings) {
        super(query, undefined, embeddings);
        this._client = _client;
        this._name = _name;
    }
    // TODO: refactor this to a base class + queryImpl pattern
    async execute() {
        const embeddings = this._embeddings;
        const query = this._query;
        let queryVector;
        if (embeddings !== undefined) {
            queryVector = (await embeddings.embed([query]))[0];
        }
        else {
            queryVector = query;
        }
        const data = await this._client.search(this._name, queryVector, this._limit, this._nprobes, this._prefilter, this._refineFactor, this._select, this._filter);
        return data.toArray().map((entry) => {
            const newObject = {};
            Object.keys(entry).forEach((key) => {
                if (entry[key] instanceof apache_arrow_1.Vector) {
                    newObject[key] = entry[key].toArray();
                }
                else {
                    newObject[key] = entry[key];
                }
            });
            return newObject;
        });
    }
}
exports.RemoteQuery = RemoteQuery;
// we are using extend until we have next next version release
// Table and Connection has both been refactored to interfaces
class RemoteTable {
    constructor(client, name, embeddings) {
        this._client = client;
        this._name = name;
        this._embeddings = embeddings;
    }
    get name() {
        return this._name;
    }
    get schema() {
        return this._client
            .post(`/v1/table/${encodeURIComponent(this._name)}/describe/`)
            .then(async (res) => {
            if (res.status !== 200) {
                throw new Error(`Server Error, status: ${res.status}, ` +
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    `message: ${res.statusText}: ${await res.body()}`);
            }
            return (await res.body())?.schema;
        });
    }
    search(query) {
        return new RemoteQuery(query, this._client, encodeURIComponent(this._name)); //, this._embeddings_new)
    }
    filter(where) {
        throw new Error('Not implemented');
    }
    async mergeInsert(on, data, args) {
        let tbl;
        if (data instanceof apache_arrow_1.Table) {
            tbl = data;
        }
        else {
            tbl = (0, index_1.makeArrowTable)(data, await this.schema);
        }
        const queryParams = {
            on
        };
        if (args.whenMatchedUpdateAll !== false && args.whenMatchedUpdateAll !== null && args.whenMatchedUpdateAll !== undefined) {
            queryParams.when_matched_update_all = 'true';
            if (typeof args.whenMatchedUpdateAll === 'string') {
                queryParams.when_matched_update_all_filt = args.whenMatchedUpdateAll;
            }
        }
        else {
            queryParams.when_matched_update_all = 'false';
        }
        if (args.whenNotMatchedInsertAll ?? false) {
            queryParams.when_not_matched_insert_all = 'true';
        }
        else {
            queryParams.when_not_matched_insert_all = 'false';
        }
        if (args.whenNotMatchedBySourceDelete !== false && args.whenNotMatchedBySourceDelete !== null && args.whenNotMatchedBySourceDelete !== undefined) {
            queryParams.when_not_matched_by_source_delete = 'true';
            if (typeof args.whenNotMatchedBySourceDelete === 'string') {
                queryParams.when_not_matched_by_source_delete_filt = args.whenNotMatchedBySourceDelete;
            }
        }
        else {
            queryParams.when_not_matched_by_source_delete = 'false';
        }
        const buffer = await (0, arrow_1.fromTableToStreamBuffer)(tbl, this._embeddings);
        const res = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/merge_insert/`, buffer, queryParams, 'application/vnd.apache.arrow.stream');
        if (res.status !== 200) {
            throw new Error(`Server Error, status: ${res.status}, ` +
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `message: ${res.statusText}: ${await res.body()}`);
        }
    }
    async add(data) {
        let tbl;
        if (data instanceof apache_arrow_1.Table) {
            tbl = data;
        }
        else {
            tbl = (0, index_1.makeArrowTable)(data, await this.schema);
        }
        const buffer = await (0, arrow_1.fromTableToStreamBuffer)(tbl, this._embeddings);
        const res = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/insert/`, buffer, {
            mode: 'append'
        }, 'application/vnd.apache.arrow.stream');
        if (res.status !== 200) {
            throw new Error(`Server Error, status: ${res.status}, ` +
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `message: ${res.statusText}: ${await res.body()}`);
        }
        return tbl.numRows;
    }
    async overwrite(data) {
        let tbl;
        if (data instanceof apache_arrow_1.Table) {
            tbl = data;
        }
        else {
            tbl = (0, index_1.makeArrowTable)(data);
        }
        const buffer = await (0, arrow_1.fromTableToStreamBuffer)(tbl, this._embeddings);
        const res = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/insert/`, buffer, {
            mode: 'overwrite'
        }, 'application/vnd.apache.arrow.stream');
        if (res.status !== 200) {
            throw new Error(`Server Error, status: ${res.status}, ` +
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `message: ${res.statusText}: ${await res.body()}`);
        }
        return tbl.numRows;
    }
    async createIndex(indexParams) {
        const unsupportedParams = [
            'index_name',
            'num_partitions',
            'max_iters',
            'use_opq',
            'num_sub_vectors',
            'num_bits',
            'max_opq_iters',
            'replace'
        ];
        for (const param of unsupportedParams) {
            // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (indexParams[param]) {
                throw new Error(`${param} is not supported for remote connections`);
            }
        }
        const column = indexParams.column ?? 'vector';
        const indexType = 'vector';
        const metricType = indexParams.metric_type ?? 'L2';
        const indexCacheSize = indexParams.index_cache_size ?? null;
        const data = {
            column,
            index_type: indexType,
            metric_type: metricType,
            index_cache_size: indexCacheSize
        };
        const res = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/create_index/`, data);
        if (res.status !== 200) {
            throw new Error(`Server Error, status: ${res.status}, ` +
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `message: ${res.statusText}: ${await res.body()}`);
        }
    }
    async createScalarIndex(column) {
        const indexType = 'scalar';
        const data = {
            column,
            index_type: indexType,
            replace: true
        };
        const res = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/create_scalar_index/`, data);
        if (res.status !== 200) {
            throw new Error(`Server Error, status: ${res.status}, ` +
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `message: ${res.statusText}: ${await res.body()}`);
        }
    }
    async countRows(filter) {
        const result = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/count_rows/`, {
            predicate: filter
        });
        return (await result.body());
    }
    async delete(filter) {
        await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/delete/`, {
            predicate: filter
        });
    }
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
        await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/update/`, {
            predicate: filter,
            updates: Object.entries(updates).map(([key, value]) => [key, value])
        });
    }
    async listIndices() {
        const results = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/index/list/`);
        return (await results.body()).indexes?.map((index) => ({
            columns: index.columns,
            name: index.index_name,
            uuid: index.index_uuid
        }));
    }
    async indexStats(indexUuid) {
        const results = await this._client.post(`/v1/table/${encodeURIComponent(this._name)}/index/${indexUuid}/stats/`);
        const body = await results.body();
        return {
            numIndexedRows: body?.num_indexed_rows,
            numUnindexedRows: body?.num_unindexed_rows
        };
    }
    async addColumns(newColumnTransforms) {
        throw new Error('Add columns is not yet supported in LanceDB Cloud.');
    }
    async alterColumns(columnAlterations) {
        throw new Error('Alter columns is not yet supported in LanceDB Cloud.');
    }
    async dropColumns(columnNames) {
        throw new Error('Drop columns is not yet supported in LanceDB Cloud.');
    }
    withMiddleware(middleware) {
        const wrapped = this.clone();
        wrapped._client = wrapped._client.withMiddleware(middleware);
        return wrapped;
    }
    clone() {
        const clone = Object.create(RemoteTable.prototype);
        return Object.assign(clone, this);
    }
}
exports.RemoteTable = RemoteTable;
//# sourceMappingURL=index.js.map