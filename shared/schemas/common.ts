import { z } from 'zod';

/**
 * Общие примитивы схем.
 * Даты хранятся строками (как в исходной системе): ISO datetime и 'YYYY-MM-DD'
 * либо иные форматы в исторических данных — поэтому валидируем как строку без жёсткого формата
 * (compatibility-first: не отвергаем существующие документы).
 */
export const idSchema = z.string().min(1);
export const isoDateTimeSchema = z.string();
export const dateStringSchema = z.string();
