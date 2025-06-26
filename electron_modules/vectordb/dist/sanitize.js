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
exports.sanitizeSchema = void 0;
// The utilities in this file help sanitize data from the user's arrow
// library into the types expected by vectordb's arrow library.  Node
// generally allows for mulitple versions of the same library (and sometimes
// even multiple copies of the same version) to be installed at the same
// time.  However, arrow-js uses instanceof which expected that the input
// comes from the exact same library instance.  This is not always the case
// and so we must sanitize the input to ensure that it is compatible.
const apache_arrow_1 = require("apache-arrow");
function sanitizeMetadata(metadataLike) {
    if (metadataLike === undefined || metadataLike === null) {
        return undefined;
    }
    if (!(metadataLike instanceof Map)) {
        throw Error("Expected metadata, if present, to be a Map<string, string>");
    }
    for (const item of metadataLike) {
        if (!(typeof item[0] === "string" || !(typeof item[1] === "string"))) {
            throw Error("Expected metadata, if present, to be a Map<string, string> but it had non-string keys or values");
        }
    }
    return metadataLike;
}
function sanitizeInt(typeLike) {
    if (!("bitWidth" in typeLike) ||
        typeof typeLike.bitWidth !== "number" ||
        !("isSigned" in typeLike) ||
        typeof typeLike.isSigned !== "boolean") {
        throw Error("Expected an Int Type to have a `bitWidth` and `isSigned` property");
    }
    return new apache_arrow_1.Int(typeLike.isSigned, typeLike.bitWidth);
}
function sanitizeFloat(typeLike) {
    if (!("precision" in typeLike) || typeof typeLike.precision !== "number") {
        throw Error("Expected a Float Type to have a `precision` property");
    }
    return new apache_arrow_1.Float(typeLike.precision);
}
function sanitizeDecimal(typeLike) {
    if (!("scale" in typeLike) ||
        typeof typeLike.scale !== "number" ||
        !("precision" in typeLike) ||
        typeof typeLike.precision !== "number" ||
        !("bitWidth" in typeLike) ||
        typeof typeLike.bitWidth !== "number") {
        throw Error("Expected a Decimal Type to have `scale`, `precision`, and `bitWidth` properties");
    }
    return new apache_arrow_1.Decimal(typeLike.scale, typeLike.precision, typeLike.bitWidth);
}
function sanitizeDate(typeLike) {
    if (!("unit" in typeLike) || typeof typeLike.unit !== "number") {
        throw Error("Expected a Date type to have a `unit` property");
    }
    return new apache_arrow_1.Date_(typeLike.unit);
}
function sanitizeTime(typeLike) {
    if (!("unit" in typeLike) ||
        typeof typeLike.unit !== "number" ||
        !("bitWidth" in typeLike) ||
        typeof typeLike.bitWidth !== "number") {
        throw Error("Expected a Time type to have `unit` and `bitWidth` properties");
    }
    return new apache_arrow_1.Time(typeLike.unit, typeLike.bitWidth);
}
function sanitizeTimestamp(typeLike) {
    if (!("unit" in typeLike) || typeof typeLike.unit !== "number") {
        throw Error("Expected a Timestamp type to have a `unit` property");
    }
    let timezone = null;
    if ("timezone" in typeLike && typeof typeLike.timezone === "string") {
        timezone = typeLike.timezone;
    }
    return new apache_arrow_1.Timestamp(typeLike.unit, timezone);
}
function sanitizeTypedTimestamp(typeLike, Datatype) {
    let timezone = null;
    if ("timezone" in typeLike && typeof typeLike.timezone === "string") {
        timezone = typeLike.timezone;
    }
    return new Datatype(timezone);
}
function sanitizeInterval(typeLike) {
    if (!("unit" in typeLike) || typeof typeLike.unit !== "number") {
        throw Error("Expected an Interval type to have a `unit` property");
    }
    return new apache_arrow_1.Interval(typeLike.unit);
}
function sanitizeList(typeLike) {
    if (!("children" in typeLike) || !Array.isArray(typeLike.children)) {
        throw Error("Expected a List type to have an array-like `children` property");
    }
    if (typeLike.children.length !== 1) {
        throw Error("Expected a List type to have exactly one child");
    }
    return new apache_arrow_1.List(sanitizeField(typeLike.children[0]));
}
function sanitizeStruct(typeLike) {
    if (!("children" in typeLike) || !Array.isArray(typeLike.children)) {
        throw Error("Expected a Struct type to have an array-like `children` property");
    }
    return new apache_arrow_1.Struct(typeLike.children.map((child) => sanitizeField(child)));
}
function sanitizeUnion(typeLike) {
    if (!("typeIds" in typeLike) ||
        !("mode" in typeLike) ||
        typeof typeLike.mode !== "number") {
        throw Error("Expected a Union type to have `typeIds` and `mode` properties");
    }
    if (!("children" in typeLike) || !Array.isArray(typeLike.children)) {
        throw Error("Expected a Union type to have an array-like `children` property");
    }
    return new apache_arrow_1.Union(typeLike.mode, typeLike.typeIds, typeLike.children.map((child) => sanitizeField(child)));
}
function sanitizeTypedUnion(typeLike, UnionType) {
    if (!("typeIds" in typeLike)) {
        throw Error("Expected a DenseUnion/SparseUnion type to have a `typeIds` property");
    }
    if (!("children" in typeLike) || !Array.isArray(typeLike.children)) {
        throw Error("Expected a DenseUnion/SparseUnion type to have an array-like `children` property");
    }
    return new UnionType(typeLike.typeIds, typeLike.children.map((child) => sanitizeField(child)));
}
function sanitizeFixedSizeBinary(typeLike) {
    if (!("byteWidth" in typeLike) || typeof typeLike.byteWidth !== "number") {
        throw Error("Expected a FixedSizeBinary type to have a `byteWidth` property");
    }
    return new apache_arrow_1.FixedSizeBinary(typeLike.byteWidth);
}
function sanitizeFixedSizeList(typeLike) {
    if (!("listSize" in typeLike) || typeof typeLike.listSize !== "number") {
        throw Error("Expected a FixedSizeList type to have a `listSize` property");
    }
    if (!("children" in typeLike) || !Array.isArray(typeLike.children)) {
        throw Error("Expected a FixedSizeList type to have an array-like `children` property");
    }
    if (typeLike.children.length !== 1) {
        throw Error("Expected a FixedSizeList type to have exactly one child");
    }
    return new apache_arrow_1.FixedSizeList(typeLike.listSize, sanitizeField(typeLike.children[0]));
}
function sanitizeMap(typeLike) {
    if (!("children" in typeLike) || !Array.isArray(typeLike.children)) {
        throw Error("Expected a Map type to have an array-like `children` property");
    }
    if (!("keysSorted" in typeLike) || typeof typeLike.keysSorted !== "boolean") {
        throw Error("Expected a Map type to have a `keysSorted` property");
    }
    return new apache_arrow_1.Map_(typeLike.children.map((field) => sanitizeField(field)), typeLike.keysSorted);
}
function sanitizeDuration(typeLike) {
    if (!("unit" in typeLike) || typeof typeLike.unit !== "number") {
        throw Error("Expected a Duration type to have a `unit` property");
    }
    return new apache_arrow_1.Duration(typeLike.unit);
}
function sanitizeDictionary(typeLike) {
    if (!("id" in typeLike) || typeof typeLike.id !== "number") {
        throw Error("Expected a Dictionary type to have an `id` property");
    }
    if (!("indices" in typeLike) || typeof typeLike.indices !== "object") {
        throw Error("Expected a Dictionary type to have an `indices` property");
    }
    if (!("dictionary" in typeLike) || typeof typeLike.dictionary !== "object") {
        throw Error("Expected a Dictionary type to have an `dictionary` property");
    }
    if (!("isOrdered" in typeLike) || typeof typeLike.isOrdered !== "boolean") {
        throw Error("Expected a Dictionary type to have an `isOrdered` property");
    }
    return new apache_arrow_1.Dictionary(sanitizeType(typeLike.dictionary), sanitizeType(typeLike.indices), typeLike.id, typeLike.isOrdered);
}
function sanitizeType(typeLike) {
    if (typeof typeLike !== "object" || typeLike === null) {
        throw Error("Expected a Type but object was null/undefined");
    }
    if (!("typeId" in typeLike) || !(typeof typeLike.typeId !== "function")) {
        throw Error("Expected a Type to have a typeId function");
    }
    let typeId;
    if (typeof typeLike.typeId === "function") {
        typeId = typeLike.typeId();
    }
    else if (typeof typeLike.typeId === "number") {
        typeId = typeLike.typeId;
    }
    else {
        throw Error("Type's typeId property was not a function or number");
    }
    switch (typeId) {
        case apache_arrow_1.Type.NONE:
            throw Error("Received a Type with a typeId of NONE");
        case apache_arrow_1.Type.Null:
            return new apache_arrow_1.Null();
        case apache_arrow_1.Type.Int:
            return sanitizeInt(typeLike);
        case apache_arrow_1.Type.Float:
            return sanitizeFloat(typeLike);
        case apache_arrow_1.Type.Binary:
            return new apache_arrow_1.Binary();
        case apache_arrow_1.Type.Utf8:
            return new apache_arrow_1.Utf8();
        case apache_arrow_1.Type.Bool:
            return new apache_arrow_1.Bool();
        case apache_arrow_1.Type.Decimal:
            return sanitizeDecimal(typeLike);
        case apache_arrow_1.Type.Date:
            return sanitizeDate(typeLike);
        case apache_arrow_1.Type.Time:
            return sanitizeTime(typeLike);
        case apache_arrow_1.Type.Timestamp:
            return sanitizeTimestamp(typeLike);
        case apache_arrow_1.Type.Interval:
            return sanitizeInterval(typeLike);
        case apache_arrow_1.Type.List:
            return sanitizeList(typeLike);
        case apache_arrow_1.Type.Struct:
            return sanitizeStruct(typeLike);
        case apache_arrow_1.Type.Union:
            return sanitizeUnion(typeLike);
        case apache_arrow_1.Type.FixedSizeBinary:
            return sanitizeFixedSizeBinary(typeLike);
        case apache_arrow_1.Type.FixedSizeList:
            return sanitizeFixedSizeList(typeLike);
        case apache_arrow_1.Type.Map:
            return sanitizeMap(typeLike);
        case apache_arrow_1.Type.Duration:
            return sanitizeDuration(typeLike);
        case apache_arrow_1.Type.Dictionary:
            return sanitizeDictionary(typeLike);
        case apache_arrow_1.Type.Int8:
            return new apache_arrow_1.Int8();
        case apache_arrow_1.Type.Int16:
            return new apache_arrow_1.Int16();
        case apache_arrow_1.Type.Int32:
            return new apache_arrow_1.Int32();
        case apache_arrow_1.Type.Int64:
            return new apache_arrow_1.Int64();
        case apache_arrow_1.Type.Uint8:
            return new apache_arrow_1.Uint8();
        case apache_arrow_1.Type.Uint16:
            return new apache_arrow_1.Uint16();
        case apache_arrow_1.Type.Uint32:
            return new apache_arrow_1.Uint32();
        case apache_arrow_1.Type.Uint64:
            return new apache_arrow_1.Uint64();
        case apache_arrow_1.Type.Float16:
            return new apache_arrow_1.Float16();
        case apache_arrow_1.Type.Float32:
            return new apache_arrow_1.Float32();
        case apache_arrow_1.Type.Float64:
            return new apache_arrow_1.Float64();
        case apache_arrow_1.Type.DateMillisecond:
            return new apache_arrow_1.DateMillisecond();
        case apache_arrow_1.Type.DateDay:
            return new apache_arrow_1.DateDay();
        case apache_arrow_1.Type.TimeNanosecond:
            return new apache_arrow_1.TimeNanosecond();
        case apache_arrow_1.Type.TimeMicrosecond:
            return new apache_arrow_1.TimeMicrosecond();
        case apache_arrow_1.Type.TimeMillisecond:
            return new apache_arrow_1.TimeMillisecond();
        case apache_arrow_1.Type.TimeSecond:
            return new apache_arrow_1.TimeSecond();
        case apache_arrow_1.Type.TimestampNanosecond:
            return sanitizeTypedTimestamp(typeLike, apache_arrow_1.TimestampNanosecond);
        case apache_arrow_1.Type.TimestampMicrosecond:
            return sanitizeTypedTimestamp(typeLike, apache_arrow_1.TimestampMicrosecond);
        case apache_arrow_1.Type.TimestampMillisecond:
            return sanitizeTypedTimestamp(typeLike, apache_arrow_1.TimestampMillisecond);
        case apache_arrow_1.Type.TimestampSecond:
            return sanitizeTypedTimestamp(typeLike, apache_arrow_1.TimestampSecond);
        case apache_arrow_1.Type.DenseUnion:
            return sanitizeTypedUnion(typeLike, apache_arrow_1.DenseUnion);
        case apache_arrow_1.Type.SparseUnion:
            return sanitizeTypedUnion(typeLike, apache_arrow_1.SparseUnion);
        case apache_arrow_1.Type.IntervalDayTime:
            return new apache_arrow_1.IntervalDayTime();
        case apache_arrow_1.Type.IntervalYearMonth:
            return new apache_arrow_1.IntervalYearMonth();
        case apache_arrow_1.Type.DurationNanosecond:
            return new apache_arrow_1.DurationNanosecond();
        case apache_arrow_1.Type.DurationMicrosecond:
            return new apache_arrow_1.DurationMicrosecond();
        case apache_arrow_1.Type.DurationMillisecond:
            return new apache_arrow_1.DurationMillisecond();
        case apache_arrow_1.Type.DurationSecond:
            return new apache_arrow_1.DurationSecond();
    }
}
function sanitizeField(fieldLike) {
    if (fieldLike instanceof apache_arrow_1.Field) {
        return fieldLike;
    }
    if (typeof fieldLike !== "object" || fieldLike === null) {
        throw Error("Expected a Field but object was null/undefined");
    }
    if (!("type" in fieldLike) ||
        !("name" in fieldLike) ||
        !("nullable" in fieldLike)) {
        throw Error("The field passed in is missing a `type`/`name`/`nullable` property");
    }
    const type = sanitizeType(fieldLike.type);
    const name = fieldLike.name;
    if (!(typeof name === "string")) {
        throw Error("The field passed in had a non-string `name` property");
    }
    const nullable = fieldLike.nullable;
    if (!(typeof nullable === "boolean")) {
        throw Error("The field passed in had a non-boolean `nullable` property");
    }
    let metadata;
    if ("metadata" in fieldLike) {
        metadata = sanitizeMetadata(fieldLike.metadata);
    }
    return new apache_arrow_1.Field(name, type, nullable, metadata);
}
/**
 * Convert something schemaLike into a Schema instance
 *
 * This method is often needed even when the caller is using a Schema
 * instance because they might be using a different instance of apache-arrow
 * than lancedb is using.
 */
function sanitizeSchema(schemaLike) {
    if (schemaLike instanceof apache_arrow_1.Schema) {
        return schemaLike;
    }
    if (typeof schemaLike !== "object" || schemaLike === null) {
        throw Error("Expected a Schema but object was null/undefined");
    }
    if (!("fields" in schemaLike)) {
        throw Error("The schema passed in does not appear to be a schema (no 'fields' property)");
    }
    let metadata;
    if ("metadata" in schemaLike) {
        metadata = sanitizeMetadata(schemaLike.metadata);
    }
    if (!Array.isArray(schemaLike.fields)) {
        throw Error("The schema passed in had a 'fields' property but it was not an array");
    }
    const sanitizedFields = schemaLike.fields.map((field) => sanitizeField(field));
    return new apache_arrow_1.Schema(sanitizedFields, metadata);
}
exports.sanitizeSchema = sanitizeSchema;
//# sourceMappingURL=sanitize.js.map