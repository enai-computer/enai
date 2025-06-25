export type Literal = string | number | boolean | null | Date | Literal[];
export declare function toSQL(value: Literal): string;
export declare class TTLCache {
    private readonly ttl;
    private readonly cache;
    /**
     * @param ttl Time to live in milliseconds
     */
    constructor(ttl: number);
    get(key: string): any | undefined;
    set(key: string, value: any): void;
    delete(key: string): void;
}
