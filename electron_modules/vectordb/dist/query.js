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
exports.Query = void 0;
const apache_arrow_1 = require("apache-arrow");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { tableSearch } = require('../native.js');
/**
 * A builder for nearest neighbor queries for LanceDB.
 */
class Query {
    constructor(query, tbl, embeddings) {
        this.where = this.filter;
        this._tbl = tbl;
        this._query = query;
        this._limit = 10;
        this._nprobes = 20;
        this._refineFactor = undefined;
        this._select = undefined;
        this._filter = undefined;
        this._metricType = undefined;
        this._embeddings = embeddings;
        this._prefilter = false;
    }
    /***
       * Sets the number of results that will be returned
       * default value is 10
       * @param value number of results
       */
    limit(value) {
        this._limit = value;
        return this;
    }
    /**
       * Refine the results by reading extra elements and re-ranking them in memory.
       * @param value refine factor to use in this query.
       */
    refineFactor(value) {
        this._refineFactor = value;
        return this;
    }
    /**
       * The number of probes used. A higher number makes search more accurate but also slower.
       * @param value The number of probes used.
       */
    nprobes(value) {
        this._nprobes = value;
        return this;
    }
    /**
       * A filter statement to be applied to this query.
       * @param value A filter in the same format used by a sql WHERE clause.
       */
    filter(value) {
        this._filter = value;
        return this;
    }
    /** Return only the specified columns.
       *
       * @param value Only select the specified columns. If not specified, all columns will be returned.
       */
    select(value) {
        this._select = value;
        return this;
    }
    /**
       * The MetricType used for this Query.
       * @param value The metric to the. @see MetricType for the different options
       */
    metricType(value) {
        this._metricType = value;
        return this;
    }
    prefilter(value) {
        this._prefilter = value;
        return this;
    }
    /**
       * Execute the query and return the results as an Array of Objects
       */
    async execute() {
        if (this._query !== undefined) {
            if (this._embeddings !== undefined) {
                this._queryVector = (await this._embeddings.embed([this._query]))[0];
            }
            else {
                this._queryVector = this._query;
            }
        }
        const isElectron = this.isElectron();
        const buffer = await tableSearch.call(this._tbl, this, isElectron);
        const data = (0, apache_arrow_1.tableFromIPC)(buffer);
        return data.toArray().map((entry) => {
            const newObject = {};
            Object.keys(entry).forEach((key) => {
                if (entry[key] instanceof apache_arrow_1.Vector) {
                    // toJSON() returns f16 array correctly
                    newObject[key] = entry[key].toJSON();
                }
                else {
                    newObject[key] = entry[key];
                }
            });
            return newObject;
        });
    }
    // See https://github.com/electron/electron/issues/2288
    isElectron() {
        try {
            // eslint-disable-next-line no-prototype-builtins
            return (process?.versions?.hasOwnProperty('electron') || navigator?.userAgent?.toLowerCase()?.includes(' electron'));
        }
        catch (e) {
            return false;
        }
    }
}
exports.Query = Query;
//# sourceMappingURL=query.js.map