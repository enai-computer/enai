import { type ResponseType } from 'axios';
import { type Table as ArrowTable } from 'apache-arrow';
import { type RemoteResponse, type RemoteRequest } from '../middleware';
interface HttpLancedbClientMiddleware {
    onRemoteRequest(req: RemoteRequest, next: (req: RemoteRequest) => Promise<RemoteResponse>): Promise<RemoteResponse>;
}
export declare class HttpLancedbClient {
    private readonly _dbName?;
    private readonly _url;
    private readonly _apiKey;
    private readonly _middlewares;
    constructor(url: string, apiKey: string, _dbName?: string | undefined);
    get uri(): string;
    search(tableName: string, vector: number[], k: number, nprobes: number, prefilter: boolean, refineFactor?: number, columns?: string[], filter?: string): Promise<ArrowTable<any>>;
    /**
     * Sent GET request.
     */
    get(path: string, params?: Record<string, string>): Promise<RemoteResponse>;
    /**
     * Sent POST request.
     */
    post(path: string, data?: any, params?: Record<string, string>, content?: string | undefined, responseType?: ResponseType | undefined): Promise<RemoteResponse>;
    /**
     * Instrument this client with middleware
     * @param mw - The middleware that instruments the client
     * @returns - an instance of this client instrumented with the middleware
     */
    withMiddleware(mw: HttpLancedbClientMiddleware): HttpLancedbClient;
    /**
     * Make a clone of this client
     */
    private clone;
}
export {};
