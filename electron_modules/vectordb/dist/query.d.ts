import { type EmbeddingFunction } from './embedding/embedding_function';
import { type MetricType } from '.';
/**
 * A builder for nearest neighbor queries for LanceDB.
 */
export declare class Query<T = number[]> {
    private readonly _query?;
    private readonly _tbl?;
    private _queryVector?;
    private _limit?;
    private _refineFactor?;
    private _nprobes;
    private _select?;
    private _filter?;
    private _metricType?;
    private _prefilter;
    protected readonly _embeddings?: EmbeddingFunction<T>;
    constructor(query?: T, tbl?: any, embeddings?: EmbeddingFunction<T>);
    /***
       * Sets the number of results that will be returned
       * default value is 10
       * @param value number of results
       */
    limit(value: number): Query<T>;
    /**
       * Refine the results by reading extra elements and re-ranking them in memory.
       * @param value refine factor to use in this query.
       */
    refineFactor(value: number): Query<T>;
    /**
       * The number of probes used. A higher number makes search more accurate but also slower.
       * @param value The number of probes used.
       */
    nprobes(value: number): Query<T>;
    /**
       * A filter statement to be applied to this query.
       * @param value A filter in the same format used by a sql WHERE clause.
       */
    filter(value: string): Query<T>;
    where: (value: string) => Query<T>;
    /** Return only the specified columns.
       *
       * @param value Only select the specified columns. If not specified, all columns will be returned.
       */
    select(value: string[]): Query<T>;
    /**
       * The MetricType used for this Query.
       * @param value The metric to the. @see MetricType for the different options
       */
    metricType(value: MetricType): Query<T>;
    prefilter(value: boolean): Query<T>;
    /**
       * Execute the query and return the results as an Array of Objects
       */
    execute<T = Record<string, unknown>>(): Promise<T[]>;
    private isElectron;
}
