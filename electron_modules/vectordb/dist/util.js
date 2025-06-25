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
exports.TTLCache = exports.toSQL = void 0;
function toSQL(value) {
    if (typeof value === 'string') {
        return `'${value}'`;
    }
    if (typeof value === 'number') {
        return value.toString();
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (value === null) {
        return 'NULL';
    }
    if (value instanceof Date) {
        return `'${value.toISOString()}'`;
    }
    if (Array.isArray(value)) {
        return `[${value.map(toSQL).join(', ')}]`;
    }
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Unsupported value type: ${typeof value} value: (${value})`);
}
exports.toSQL = toSQL;
class TTLCache {
    /**
     * @param ttl Time to live in milliseconds
     */
    constructor(ttl) {
        this.ttl = ttl;
        this.cache = new Map();
    }
    get(key) {
        const entry = this.cache.get(key);
        if (entry === undefined) {
            return undefined;
        }
        if (entry.expires < Date.now()) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }
    set(key, value) {
        this.cache.set(key, { value, expires: Date.now() + this.ttl });
    }
    delete(key) {
        this.cache.delete(key);
    }
}
exports.TTLCache = TTLCache;
//# sourceMappingURL=util.js.map