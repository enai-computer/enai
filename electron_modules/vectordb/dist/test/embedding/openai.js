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
const mocha_1 = require("mocha");
const chai_1 = require("chai");
const openai_1 = require("../../embedding/openai");
const embedding_function_1 = require("../../embedding/embedding_function");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpenAIApi = require('openai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stub } = require('sinon');
(0, mocha_1.describe)('OpenAPIEmbeddings', function () {
    const stubValue = {
        data: [
            {
                embedding: Array(1536).fill(1.0)
            },
            {
                embedding: Array(1536).fill(2.0)
            }
        ]
    };
    (0, mocha_1.describe)('#embed', function () {
        it('should create vector embeddings', async function () {
            const openAIStub = stub(OpenAIApi.Embeddings.prototype, 'create').returns(stubValue);
            const f = new openai_1.OpenAIEmbeddingFunction('text', 'sk-key');
            const vectors = await f.embed(['abc', 'def']);
            chai_1.assert.isTrue(openAIStub.calledOnce);
            chai_1.assert.equal(vectors.length, 2);
            chai_1.assert.deepEqual(vectors[0], stubValue.data[0].embedding);
            chai_1.assert.deepEqual(vectors[1], stubValue.data[1].embedding);
        });
    });
    (0, mocha_1.describe)('isEmbeddingFunction', function () {
        it('should match the isEmbeddingFunction guard', function () {
            chai_1.assert.isTrue((0, embedding_function_1.isEmbeddingFunction)(new openai_1.OpenAIEmbeddingFunction('text', 'sk-key')));
        });
    });
});
//# sourceMappingURL=openai.js.map