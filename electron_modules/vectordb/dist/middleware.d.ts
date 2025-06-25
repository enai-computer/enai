/**
 * Middleware for Remote LanceDB Connection or Table
 */
export interface HttpMiddleware {
    /**
     * A callback that can be used to instrument the behavior of http requests to remote
     * tables. It can be used to add headers, modify the request, or even short-circuit
     * the request and return a response without making the request to the remote endpoint.
     * It can also be used to modify the response from the remote endpoint.
     *
     * @param {RemoteResponse} res - Request to the remote endpoint
     * @param {onRemoteRequestNext} next - Callback to advance the middleware chain
     */
    onRemoteRequest(req: RemoteRequest, next: (req: RemoteRequest) => Promise<RemoteResponse>): Promise<RemoteResponse>;
}
export declare enum Method {
    GET = 0,
    POST = 1
}
/**
 * A LanceDB Remote HTTP Request
 */
export interface RemoteRequest {
    uri: string;
    method: Method;
    headers: Map<string, string>;
    params?: Map<string, string>;
    body?: any;
}
/**
 * A LanceDB Remote HTTP Response
 */
export interface RemoteResponse {
    status: number;
    statusText: string;
    headers: Map<string, string>;
    body: () => Promise<any>;
}
