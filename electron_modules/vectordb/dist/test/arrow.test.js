"use strict";
// Copyright 2024 Lance Developers.
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
const mocha_1 = require("mocha");
const chai_1 = require("chai");
const chaiAsPromised = require("chai-as-promised");
const arrow_1 = require("../arrow");
const apache_arrow_1 = require("apache-arrow");
const apache_arrow_old_1 = require("apache-arrow-old");
(0, chai_1.use)(chaiAsPromised);
function sampleRecords() {
    return [
        {
            binary: Buffer.alloc(5),
            boolean: false,
            number: 7,
            string: 'hello',
            struct: { x: 0, y: 0 },
            list: ['anime', 'action', 'comedy']
        }
    ];
}
// Helper method to verify various ways to create a table
async function checkTableCreation(tableCreationMethod) {
    const records = sampleRecords();
    const recordsReversed = [{
            list: ['anime', 'action', 'comedy'],
            struct: { x: 0, y: 0 },
            string: 'hello',
            number: 7,
            boolean: false,
            binary: Buffer.alloc(5)
        }];
    const schema = new apache_arrow_1.Schema([
        new apache_arrow_1.Field('binary', new apache_arrow_1.Binary(), false),
        new apache_arrow_1.Field('boolean', new apache_arrow_1.Bool(), false),
        new apache_arrow_1.Field('number', new apache_arrow_1.Float64(), false),
        new apache_arrow_1.Field('string', new apache_arrow_1.Utf8(), false),
        new apache_arrow_1.Field('struct', new apache_arrow_1.Struct([
            new apache_arrow_1.Field('x', new apache_arrow_1.Float64(), false),
            new apache_arrow_1.Field('y', new apache_arrow_1.Float64(), false)
        ])),
        new apache_arrow_1.Field('list', new apache_arrow_1.List(new apache_arrow_1.Field('item', new apache_arrow_1.Utf8(), false)), false)
    ]);
    const table = await tableCreationMethod(records, recordsReversed, schema);
    schema.fields.forEach((field, idx) => {
        const actualField = table.schema.fields[idx];
        chai_1.assert.isFalse(actualField.nullable);
        chai_1.assert.equal(table.getChild(field.name)?.type.toString(), field.type.toString());
        chai_1.assert.equal(table.getChildAt(idx)?.type.toString(), field.type.toString());
    });
}
(0, mocha_1.describe)('The function makeArrowTable', function () {
    it('will use data types from a provided schema instead of inference', async function () {
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('a', new apache_arrow_1.Int32()),
            new apache_arrow_1.Field('b', new apache_arrow_1.Float32()),
            new apache_arrow_1.Field('c', new apache_arrow_1.FixedSizeList(3, new apache_arrow_1.Field('item', new apache_arrow_1.Float16()))),
            new apache_arrow_1.Field('d', new apache_arrow_1.Int64())
        ]);
        const table = (0, arrow_1.makeArrowTable)([
            { a: 1, b: 2, c: [1, 2, 3], d: 9 },
            { a: 4, b: 5, c: [4, 5, 6], d: 10 },
            { a: 7, b: 8, c: [7, 8, 9], d: null }
        ], { schema });
        const buf = await (0, arrow_1.fromTableToBuffer)(table);
        chai_1.assert.isAbove(buf.byteLength, 0);
        const actual = (0, apache_arrow_1.tableFromIPC)(buf);
        chai_1.assert.equal(actual.numRows, 3);
        const actualSchema = actual.schema;
        chai_1.assert.deepEqual(actualSchema, schema);
    });
    it('will assume the column `vector` is FixedSizeList<Float32> by default', async function () {
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('a', new apache_arrow_1.Float64()),
            new apache_arrow_1.Field('b', new apache_arrow_1.Float64()),
            new apache_arrow_1.Field('vector', new apache_arrow_1.FixedSizeList(3, new apache_arrow_1.Field('item', new apache_arrow_1.Float32(), true)))
        ]);
        const table = (0, arrow_1.makeArrowTable)([
            { a: 1, b: 2, vector: [1, 2, 3] },
            { a: 4, b: 5, vector: [4, 5, 6] },
            { a: 7, b: 8, vector: [7, 8, 9] }
        ]);
        const buf = await (0, arrow_1.fromTableToBuffer)(table);
        chai_1.assert.isAbove(buf.byteLength, 0);
        const actual = (0, apache_arrow_1.tableFromIPC)(buf);
        chai_1.assert.equal(actual.numRows, 3);
        const actualSchema = actual.schema;
        chai_1.assert.deepEqual(actualSchema, schema);
    });
    it('can support multiple vector columns', async function () {
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('a', new apache_arrow_1.Float64()),
            new apache_arrow_1.Field('b', new apache_arrow_1.Float64()),
            new apache_arrow_1.Field('vec1', new apache_arrow_1.FixedSizeList(3, new apache_arrow_1.Field('item', new apache_arrow_1.Float16(), true))),
            new apache_arrow_1.Field('vec2', new apache_arrow_1.FixedSizeList(3, new apache_arrow_1.Field('item', new apache_arrow_1.Float16(), true)))
        ]);
        const table = (0, arrow_1.makeArrowTable)([
            { a: 1, b: 2, vec1: [1, 2, 3], vec2: [2, 4, 6] },
            { a: 4, b: 5, vec1: [4, 5, 6], vec2: [8, 10, 12] },
            { a: 7, b: 8, vec1: [7, 8, 9], vec2: [14, 16, 18] }
        ], {
            vectorColumns: {
                vec1: { type: new apache_arrow_1.Float16() },
                vec2: { type: new apache_arrow_1.Float16() }
            }
        });
        const buf = await (0, arrow_1.fromTableToBuffer)(table);
        chai_1.assert.isAbove(buf.byteLength, 0);
        const actual = (0, apache_arrow_1.tableFromIPC)(buf);
        chai_1.assert.equal(actual.numRows, 3);
        const actualSchema = actual.schema;
        chai_1.assert.deepEqual(actualSchema, schema);
    });
    it('will allow different vector column types', async function () {
        const table = (0, arrow_1.makeArrowTable)([
            { fp16: [1], fp32: [1], fp64: [1] }
        ], {
            vectorColumns: {
                fp16: { type: new apache_arrow_1.Float16() },
                fp32: { type: new apache_arrow_1.Float32() },
                fp64: { type: new apache_arrow_1.Float64() }
            }
        });
        chai_1.assert.equal(table.getChild('fp16')?.type.children[0].type.toString(), new apache_arrow_1.Float16().toString());
        chai_1.assert.equal(table.getChild('fp32')?.type.children[0].type.toString(), new apache_arrow_1.Float32().toString());
        chai_1.assert.equal(table.getChild('fp64')?.type.children[0].type.toString(), new apache_arrow_1.Float64().toString());
    });
    it('will use dictionary encoded strings if asked', async function () {
        const table = (0, arrow_1.makeArrowTable)([{ str: 'hello' }]);
        chai_1.assert.isTrue(apache_arrow_1.DataType.isUtf8(table.getChild('str')?.type));
        const tableWithDict = (0, arrow_1.makeArrowTable)([{ str: 'hello' }], { dictionaryEncodeStrings: true });
        chai_1.assert.isTrue(apache_arrow_1.DataType.isDictionary(tableWithDict.getChild('str')?.type));
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('str', new apache_arrow_1.Dictionary(new apache_arrow_1.Utf8(), new apache_arrow_1.Int32()))
        ]);
        const tableWithDict2 = (0, arrow_1.makeArrowTable)([{ str: 'hello' }], { schema });
        chai_1.assert.isTrue(apache_arrow_1.DataType.isDictionary(tableWithDict2.getChild('str')?.type));
    });
    it('will infer data types correctly', async function () {
        await checkTableCreation(async (records) => (0, arrow_1.makeArrowTable)(records));
    });
    it('will allow a schema to be provided', async function () {
        await checkTableCreation(async (records, _, schema) => (0, arrow_1.makeArrowTable)(records, { schema }));
    });
    it('will use the field order of any provided schema', async function () {
        await checkTableCreation(async (_, recordsReversed, schema) => (0, arrow_1.makeArrowTable)(recordsReversed, { schema }));
    });
    it('will make an empty table', async function () {
        await checkTableCreation(async (_, __, schema) => (0, arrow_1.makeArrowTable)([], { schema }));
    });
});
class DummyEmbedding {
    constructor() {
        this.sourceColumn = 'string';
        this.embeddingDimension = 2;
        this.embeddingDataType = new apache_arrow_1.Float16();
    }
    async embed(data) {
        return data.map(() => [0.0, 0.0]);
    }
}
class DummyEmbeddingWithNoDimension {
    constructor() {
        this.sourceColumn = 'string';
    }
    async embed(data) {
        return data.map(() => [0.0, 0.0]);
    }
}
(0, mocha_1.describe)('convertToTable', function () {
    it('will infer data types correctly', async function () {
        await checkTableCreation(async (records) => await (0, arrow_1.convertToTable)(records));
    });
    it('will allow a schema to be provided', async function () {
        await checkTableCreation(async (records, _, schema) => await (0, arrow_1.convertToTable)(records, undefined, { schema }));
    });
    it('will use the field order of any provided schema', async function () {
        await checkTableCreation(async (_, recordsReversed, schema) => await (0, arrow_1.convertToTable)(recordsReversed, undefined, { schema }));
    });
    it('will make an empty table', async function () {
        await checkTableCreation(async (_, __, schema) => await (0, arrow_1.convertToTable)([], undefined, { schema }));
    });
    it('will apply embeddings', async function () {
        const records = sampleRecords();
        const table = await (0, arrow_1.convertToTable)(records, new DummyEmbedding());
        chai_1.assert.isTrue(apache_arrow_1.DataType.isFixedSizeList(table.getChild('vector')?.type));
        chai_1.assert.equal(table.getChild('vector')?.type.children[0].type.toString(), new apache_arrow_1.Float16().toString());
    });
    it('will fail if missing the embedding source column', async function () {
        return await (0, chai_1.expect)((0, arrow_1.convertToTable)([{ id: 1 }], new DummyEmbedding())).to.be.rejectedWith("'string' was not present");
    });
    it('use embeddingDimension if embedding missing from table', async function () {
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('string', new apache_arrow_1.Utf8(), false)
        ]);
        // Simulate getting an empty Arrow table (minus embedding) from some other source
        // In other words, we aren't starting with records
        const table = (0, arrow_1.makeEmptyTable)(schema);
        // If the embedding specifies the dimension we are fine
        await (0, arrow_1.fromTableToBuffer)(table, new DummyEmbedding());
        // We can also supply a schema and should be ok
        const schemaWithEmbedding = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('string', new apache_arrow_1.Utf8(), false),
            new apache_arrow_1.Field('vector', new apache_arrow_1.FixedSizeList(2, new apache_arrow_1.Field('item', new apache_arrow_1.Float16(), false)), false)
        ]);
        await (0, arrow_1.fromTableToBuffer)(table, new DummyEmbeddingWithNoDimension(), schemaWithEmbedding);
        // Otherwise we will get an error
        return await (0, chai_1.expect)((0, arrow_1.fromTableToBuffer)(table, new DummyEmbeddingWithNoDimension())).to.be.rejectedWith('does not specify `embeddingDimension`');
    });
    it('will apply embeddings to an empty table', async function () {
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('string', new apache_arrow_1.Utf8(), false),
            new apache_arrow_1.Field('vector', new apache_arrow_1.FixedSizeList(2, new apache_arrow_1.Field('item', new apache_arrow_1.Float16(), false)), false)
        ]);
        const table = await (0, arrow_1.convertToTable)([], new DummyEmbedding(), { schema });
        chai_1.assert.isTrue(apache_arrow_1.DataType.isFixedSizeList(table.getChild('vector')?.type));
        chai_1.assert.equal(table.getChild('vector')?.type.children[0].type.toString(), new apache_arrow_1.Float16().toString());
    });
    it('will complain if embeddings present but schema missing embedding column', async function () {
        const schema = new apache_arrow_1.Schema([
            new apache_arrow_1.Field('string', new apache_arrow_1.Utf8(), false)
        ]);
        return await (0, chai_1.expect)((0, arrow_1.convertToTable)([], new DummyEmbedding(), { schema })).to.be.rejectedWith('column vector was missing');
    });
    it('will provide a nice error if run twice', async function () {
        const records = sampleRecords();
        const table = await (0, arrow_1.convertToTable)(records, new DummyEmbedding());
        // fromTableToBuffer will try and apply the embeddings again
        return await (0, chai_1.expect)((0, arrow_1.fromTableToBuffer)(table, new DummyEmbedding())).to.be.rejectedWith('already existed');
    });
});
(0, mocha_1.describe)('makeEmptyTable', function () {
    it('will make an empty table', async function () {
        await checkTableCreation(async (_, __, schema) => (0, arrow_1.makeEmptyTable)(schema));
    });
});
(0, mocha_1.describe)('when using two versions of arrow', function () {
    it('can still import data', async function () {
        const schema = new apache_arrow_old_1.Schema([
            new apache_arrow_old_1.Field('id', new apache_arrow_old_1.Int32()),
            new apache_arrow_old_1.Field('vector', new apache_arrow_old_1.FixedSizeList(1024, new apache_arrow_old_1.Field("item", new apache_arrow_old_1.Float32(), true))),
            new apache_arrow_old_1.Field('struct', new apache_arrow_old_1.Struct([
                new apache_arrow_old_1.Field('nested', new apache_arrow_old_1.Dictionary(new apache_arrow_old_1.Utf8(), new apache_arrow_old_1.Int32(), 1, true)),
                new apache_arrow_old_1.Field('ts_with_tz', new apache_arrow_old_1.TimestampNanosecond("some_tz")),
                new apache_arrow_old_1.Field('ts_no_tz', new apache_arrow_old_1.TimestampNanosecond(null))
            ]))
        ]);
        // We use arrow version 13 to emulate a "foreign arrow" and this version doesn't have metadataVersion
        // In theory, this wouldn't matter.  We don't rely on that property.  However, it causes deepEqual to
        // fail so we patch it back in
        schema.metadataVersion = apache_arrow_1.MetadataVersion.V5;
        const table = (0, arrow_1.makeArrowTable)([], { schema });
        const buf = await (0, arrow_1.fromTableToBuffer)(table);
        chai_1.assert.isAbove(buf.byteLength, 0);
        const actual = (0, apache_arrow_1.tableFromIPC)(buf);
        const actualSchema = actual.schema;
        chai_1.assert.deepEqual(actualSchema, schema);
    });
});
//# sourceMappingURL=arrow.test.js.map