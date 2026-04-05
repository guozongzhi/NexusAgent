/**
 * Zod Schema → JSON Schema 转换器（精简版）
 * 用于将 Zod 定义转换为 OpenAI function calling 所需的 JSON Schema 格式
 */
import { z } from 'zod';

/**
 * 将 Zod Schema 转换为 JSON Schema 对象
 * 仅支持 Agent 系统常用的类型子集
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertZodType(schema);
}

function convertZodType(schema: z.ZodType): Record<string, unknown> {
  // 解包 ZodOptional / ZodDefault
  if (schema instanceof z.ZodOptional) {
    return convertZodType(schema._def.innerType as z.ZodType);
  }
  if (schema instanceof z.ZodDefault) {
    return convertZodType(schema._def.innerType as z.ZodType);
  }

  // ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convertZodType(value);
      // 非 optional 字段加入 required
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    const result: Record<string, unknown> = {
      type: 'object',
      properties,
    };
    if (required.length > 0) result['required'] = required;
    result['additionalProperties'] = false;
    return result;
  }

  // ZodString
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    if (schema.description) result['description'] = schema.description;
    return result;
  }

  // ZodNumber
  if (schema instanceof z.ZodNumber) {
    const result: Record<string, unknown> = { type: 'number' };
    if (schema.description) result['description'] = schema.description;
    return result;
  }

  // ZodBoolean
  if (schema instanceof z.ZodBoolean) {
    const result: Record<string, unknown> = { type: 'boolean' };
    if (schema.description) result['description'] = schema.description;
    return result;
  }

  // ZodArray
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convertZodType(schema._def.type as z.ZodType),
    };
  }

  // ZodEnum
  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema._def.values as string[],
    };
  }

  // ZodLiteral
  if (schema instanceof z.ZodLiteral) {
    return {
      type: typeof schema._def.value === 'string' ? 'string' : 'number',
      const: schema._def.value,
    };
  }

  // ZodUnion
  if (schema instanceof z.ZodUnion) {
    const options = (schema._def.options as z.ZodType[]).map(convertZodType);
    return { oneOf: options };
  }

  // 兜底
  return { type: 'string' };
}
