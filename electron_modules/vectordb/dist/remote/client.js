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
exports.HttpLancedbClient = void 0;
const axios_1 = require("axios");
const apache_arrow_1 = require("apache-arrow");
const middleware_1 = require("../middleware");
/**
 * Invoke the middleware chain and at the end call the remote endpoint
 */
async function callWithMiddlewares(req, middlewares, opts) {
    async function call(i, req) {
        // if we have reached the end of the middleware chain, make the request
        if (i > middlewares.length) {
            const headers = Object.fromEntries(req.headers.entries());
            const params = Object.fromEntries(req.params?.entries() ?? []);
            const timeout = 10000;
            let res;
            if (req.method === middleware_1.Method.POST) {
                res = await axios_1.default.post(req.uri, req.body, {
                    headers,
                    params,
                    timeout,
                    responseType: opts?.responseType
                });
            }
            else {
                res = await axios_1.default.get(req.uri, {
                    headers,
                    params,
                    timeout
                });
            }
            return toLanceRes(res);
        }
        // call next middleware in chain
        return await middlewares[i - 1].onRemoteRequest(req, async (req) => {
            return await call(i + 1, req);
        });
    }
    return await call(1, req);
}
/**
 * Marshall the library response into a LanceDB response
 */
function toLanceRes(res) {
    const headers = new Map();
    for (const h in res.headers) {
        headers.set(h, res.headers[h]);
    }
    return {
        status: res.status,
        statusText: res.statusText,
        headers,
        body: async () => {
            return res.data;
        }
    };
}
async function decodeErrorData(res, responseType) {
    const errorData = await res.body();
    if (responseType === 'arraybuffer') {
        return new TextDecoder().decode(errorData);
    }
    else {
        if (typeof errorData === 'object') {
            return JSON.stringify(errorData);
        }
        return errorData;
    }
}
class HttpLancedbClient {
    constructor(url, apiKey, _dbName) {
        this._dbName = _dbName;
        this._url = url;
        this._apiKey = () => apiKey;
        this._middlewares = [];
    }
    get uri() {
        return this._url;
    }
    async search(tableName, vector, k, nprobes, prefilter, refineFactor, columns, filter) {
        const result = await this.post(`/v1/table/${tableName}/query/`, {
            vector,
            k,
            nprobes,
            refineFactor,
            columns,
            filter,
            prefilter
        }, undefined, undefined, 'arraybuffer');
        const table = (0, apache_arrow_1.tableFromIPC)(await result.body());
        return table;
    }
    /**
     * Sent GET request.
     */
    async get(path, params) {
        const req = {
            uri: `${this._url}${path}`,
            method: middleware_1.Method.GET,
            headers: new Map(Object.entries({
                'Content-Type': 'application/json',
                'x-api-key': this._apiKey(),
                ...(this._dbName !== undefined ? { 'x-lancedb-database': this._dbName } : {})
            })),
            params: new Map(Object.entries(params ?? {}))
        };
        let response;
        try {
            response = await callWithMiddlewares(req, this._middlewares);
            return response;
        }
        catch (err) {
            console.error('error: ', err);
            if (err.response === undefined) {
                throw new Error(`Network Error: ${err.message}`);
            }
            response = toLanceRes(err.response);
        }
        if (response.status !== 200) {
            const errorData = await decodeErrorData(response);
            throw new Error(`Server Error, status: ${response.status}, ` +
                `message: ${response.statusText}: ${errorData}`);
        }
        return response;
    }
    /**
     * Sent POST request.
     */
    async post(path, data, params, content, responseType) {
        const req = {
            uri: `${this._url}${path}`,
            method: middleware_1.Method.POST,
            headers: new Map(Object.entries({
                'Content-Type': content ?? 'application/json',
                'x-api-key': this._apiKey(),
                ...(this._dbName !== undefined ? { 'x-lancedb-database': this._dbName } : {})
            })),
            params: new Map(Object.entries(params ?? {})),
            body: data
        };
        let response;
        try {
            response = await callWithMiddlewares(req, this._middlewares, { responseType });
            // return response
        }
        catch (err) {
            console.error('error: ', err);
            if (err.response === undefined) {
                throw new Error(`Network Error: ${err.message}`);
            }
            response = toLanceRes(err.response);
        }
        if (response.status !== 200) {
            const errorData = await decodeErrorData(response, responseType);
            throw new Error(`Server Error, status: ${response.status}, ` +
                `message: ${response.statusText}: ${errorData}`);
        }
        return response;
    }
    /**
     * Instrument this client with middleware
     * @param mw - The middleware that instruments the client
     * @returns - an instance of this client instrumented with the middleware
     */
    withMiddleware(mw) {
        const wrapped = this.clone();
        wrapped._middlewares.push(mw);
        return wrapped;
    }
    /**
     * Make a clone of this client
     */
    clone() {
        const clone = new HttpLancedbClient(this._url, this._apiKey(), this._dbName);
        for (const mw of this._middlewares) {
            clone._middlewares.push(mw);
        }
        return clone;
    }
}
exports.HttpLancedbClient = HttpLancedbClient;
//# sourceMappingURL=client.js.map