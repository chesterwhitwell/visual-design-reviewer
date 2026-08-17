import { z } from "zod";

export const APPLICATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const ApplicationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(APPLICATION_ID_PATTERN, "must be a stable application identifier");

export const NonEmptyTextSchema = z.string().trim().min(1).max(20_000);
export const ShortTextSchema = z.string().trim().min(1).max(240);
export const NullableTextSchema = z.string().trim().min(1).max(20_000).nullable();
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const Sha256DigestSchema = z.string().regex(SHA256_PATTERN);
export const NonNegativeOrderSchema = z.number().int().min(0);
export const PositiveVersionSchema = z.number().int().positive();

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export const SignificanceSchema = z.enum(["minor", "moderate", "major"]);
export const ImageMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type JsonValue =
  | z.infer<typeof JsonPrimitiveSchema>
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

export function deepFreeze<Value>(value: Value): DeepReadonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value as DeepReadonly<Value>;
}

export function addDuplicateIssues(
  values: readonly string[] | readonly number[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  description: string,
): void {
  const firstIndex = new Map<string | number, number>();

  values.forEach((value, index) => {
    const earlier = firstIndex.get(value);
    if (earlier === undefined) {
      firstIndex.set(value, index);
      return;
    }

    context.addIssue({
      code: "custom",
      message: `${description} must be unique (also used at index ${earlier})`,
      path: [...path, index],
    });
  });
}

export function addContiguousOrderIssues(
  values: readonly number[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  description: string,
): void {
  const sorted = [...values].sort((left, right) => left - right);
  const valid = sorted.every((value, index) => value === index);

  if (!valid) {
    context.addIssue({
      code: "custom",
      message: `${description} must be contiguous and start at 0`,
      path,
    });
  }
}

export type ApplicationId = z.infer<typeof ApplicationIdSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Significance = z.infer<typeof SignificanceSchema>;
export type ImageMimeType = z.infer<typeof ImageMimeTypeSchema>;
