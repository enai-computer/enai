import { type EmbeddingFunction, type Table, type VectorIndexParams, type Connection, type ConnectionOptions, type CreateTableOptions, type VectorIndex, type WriteOptions, type IndexStats, type UpdateArgs, type UpdateSqlArgs, type MergeInsertArgs, type ColumnAlteration } from '../index';
import { Query } from '../query';
import { Table as ArrowTable } from 'apache-arrow';
import { HttpLancedbClient } from './client';
import { type HttpMiddleware } from '../middleware';
/**
 * Remote connection.
 */
export declare class RemoteConnection implements Connection {
    private _client;
    private readonly _dbName;
    private readonly _tableCache;
    constructor(opts: ConnectionOptions);
    get uri(): string;
    tableNames(pageToken?: string, limit?: number): Promise<string[]>;
    openTable(name: string): Promise<Table>;
    openTable<T>(name: string, embeddings: EmbeddingFunction<T>): Promise<Table<T>>;
    createTable<T>(nameOrOpts: string | CreateTableOptions<T>, data?: Array<Record<string, unknown>> | ArrowTable, optsOrEmbedding?: WriteOptions | EmbeddingFunction<T>, opt?: WriteOptions): Promise<Table<T>>;
    dropTable(name: string): Promise<void>;
    withMiddleware(middleware: HttpMiddleware): Connection;
    private clone;
}
export declare class RemoteQuery<T = number[]> extends Query<T> {
    private readonly _client;
    private readonly _name;
    constructor(query: T, _client: HttpLancedbClient, _name: string, embeddings?: EmbeddingFunction<T>);
    execute<T = Record<string, unknown>>(): Promise<T[]>;
}
export declare class RemoteTable<T = number[]> implements Table<T> {
    private _client;
    private readonly _embeddings?;
    private readonly _name;
    constructor(client: HttpLancedbClient, name: string);
    constructor(client: HttpLancedbClient, name: string, embeddings: EmbeddingFunction<T>);
    get name(): string;
    get schema(): Promise<any>;
    search(query: T): Query<T>;
    filter(where: string): Query<T>;
    mergeInsert(on: string, data: Array<Record<string, unknown>> | ArrowTable, args: MergeInsertArgs): Promise<void>;
    add(data: Array<Record<string, unknown>> | ArrowTable): Promise<number>;
    overwrite(data: Array<Record<string, unknown>> | ArrowTable): Promise<number>;
    createIndex(indexParams: VectorIndexParams): Promise<void>;
    createScalarIndex(column: string): Promise<void>;
    countRows(filter?: string): Promise<number>;
    delete(filter: string): Promise<void>;
    update(args: UpdateArgs | UpdateSqlArgs): Promise<void>;
    listIndices(): Promise<VectorIndex[]>;
    indexStats(indexUuid: string): Promise<IndexStats>;
    addColumns(newColumnTransforms: Array<{
        name: string;
        valueSql: string;
    }>): Promise<void>;
    alterColumns(columnAlterations: ColumnAlteration[]): Promise<void>;
    dropColumns(columnNames: string[]): Promise<void>;
    withMiddleware(middleware: HttpMiddleware): Table<T>;
    private clone;
}
