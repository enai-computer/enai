import { type EmbeddingFunction } from '../index';
export declare class OpenAIEmbeddingFunction implements EmbeddingFunction<string> {
    private readonly _openai;
    private readonly _modelName;
    constructor(sourceColumn: string, openAIKey: string, modelName?: string);
    embed(data: string[]): Promise<number[][]>;
    sourceColumn: string;
}
