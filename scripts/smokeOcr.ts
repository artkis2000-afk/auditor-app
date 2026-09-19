/**
 * LIVE smoke-тест OCR-пайплайна (PHASE 4.6b.1). Запускается ТОЛЬКО вручную и ТОЛЬКО с
 * реальными локальными credentials в окружении. Не создаёт публичных эндпоинтов, не коммитит
 * секреты/изображения. Использует реальный Gemini (fake-провайдер запрещён) и реальный Firebase.
 *
 * Запуск:
 *   npm run smoke:ocr -- путь/к/накладной.jpg
 * (env берётся из .env в корне проекта или из переменных окружения; см. .env.example)
 *
 * Печатает ТОЛЬКО безопасное summary: без base64, без raw-ответа Gemini, без секретов/service account.
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { loadFirebaseEnv } from '../server/db/env.js';
import { AdminFirestoreGateway } from '../server/db/adminFirestoreGateway.js';
import { createFirebaseStorageGateway } from '../server/storage/index.js';
import {
  createServiceContext,
  InvoiceService,
  OcrService,
  AuditService,
  type Actor,
} from '../server/services/index.js';
import {
  loadAiConfig,
  createGeminiOcrProvider,
  PassthroughImagePreprocessor,
  ThrowingOcrProvider,
  OcrError,
} from '../server/ai/index.js';

/** Минимальная загрузка .env (без зависимостей): не переопределяет уже заданные переменные. */
function loadDotEnv(path = '.env'): void {
  try {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* .env не обязателен */
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function die(msg: string): never {
  console.error(`[smoke:ocr] ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();

  const imagePath = process.argv[2];
  if (!imagePath) die('Укажите путь к изображению: npm run smoke:ocr -- путь/к/накладной.jpg');
  if (!existsSync(imagePath)) die(`Файл не найден: ${imagePath}`);

  const ai = loadAiConfig();
  if (!ai.geminiApiKey) {
    die('GEMINI_API_KEY не задан — LIVE-тест требует реальный ключ (fake OCR запрещён).');
  }

  // Реальные адаптеры (единый Admin app для Firestore и Storage).
  const env = loadFirebaseEnv();
  const gateway = new AdminFirestoreGateway(env);
  const imageStore = createFirebaseStorageGateway(env);
  const ctx = createServiceContext(gateway);
  const invoices = new InvoiceService(ctx);
  const ocrDeps = {
    primary: createGeminiOcrProvider({ apiKey: ai.geminiApiKey, model: ai.geminiModel }),
    preprocessor: new PassthroughImagePreprocessor(),
    imageStore,
    // fallback НЕ задаём — production-семантика (сбой Gemini → ошибка, не фейк).
  };
  const actor: Actor = { id: 'smoke-user', username: 'smoke', role: 'admin' };

  console.log('[smoke:ocr] Модель Gemini:', ai.geminiModel);
  console.log('[smoke:ocr] Файл:', basename(imagePath));

  // --- 1. Upload → Storage → Firestore (processing) ---
  const bytes = readFileSync(imagePath);
  const contentType = MIME_BY_EXT[extname(imagePath).toLowerCase()] ?? 'image/jpeg';
  const base64 = bytes.toString('base64');
  const uploaded = await invoices.createFromUpload({ name: basename(imagePath), type: contentType, base64 }, actor, imageStore);
  console.log('\n=== UPLOAD ===');
  console.log('invoiceId       :', uploaded.invoiceId);
  console.log('status          :', uploaded.status);

  const afterUpload = await ctx.repositories.invoices.getById(uploaded.invoiceId);
  const storageKey = afterUpload?.imagePath ?? '';
  const stored = await imageStore.get(storageKey);
  console.log('imagePath (key) :', storageKey);
  console.log('key is storage  :', !storageKey.startsWith('data:'));
  console.log('object in bucket:', stored.data.length > 0, `(${stored.data.length} bytes, ${stored.contentType})`);
  console.log('base64 в Firestore:', storageKey.startsWith('data:') ? 'ДА (ПРОБЛЕМА)' : 'нет');

  // --- 2. OCR (реальный Gemini) ---
  console.log('\n=== OCR #1 (real Gemini) ===');
  const outcome1 = await invoicesOcr(ctx, ocrDeps, uploaded.invoiceId, actor);
  await printOcrSummary(ctx, uploaded.invoiceId, outcome1);

  // --- 3. Повторный OCR (проверка KI-18: storage key переживает первый OCR) ---
  console.log('\n=== OCR #2 (повторный) ===');
  const items1 = await ctx.repositories.invoiceItems.listByInvoice(uploaded.invoiceId);
  const outcome2 = await invoicesOcr(ctx, ocrDeps, uploaded.invoiceId, actor);
  const items2 = await ctx.repositories.invoiceItems.listByInvoice(uploaded.invoiceId);
  const afterOcr2 = await ctx.repositories.invoices.getById(uploaded.invoiceId);
  await printOcrSummary(ctx, uploaded.invoiceId, outcome2);
  console.log('storage key сохранён:', afterOcr2?.imagePath === storageKey);
  console.log('items заменены      :', items1.map((i) => i.id).join() !== items2.map((i) => i.id).join());

  // --- 4. (Опционально) controlled failure: SMOKE_FAIL_TEST=1 ---
  if (process.env.SMOKE_FAIL_TEST === '1') {
    console.log('\n=== FAIL TEST (provider failure, без fallback) ===');
    const failUp = await invoices.createFromUpload(
      { name: basename(imagePath), type: contentType, base64 },
      actor,
      imageStore,
    );
    const failDeps = {
      primary: new ThrowingOcrProvider('smoke: forced provider failure'),
      preprocessor: new PassthroughImagePreprocessor(),
      imageStore,
    };
    try {
      await new OcrService(ctx, failDeps).processInvoice(failUp.invoiceId, actor);
      console.log('ОШИБКА ОЖИДАЛАСЬ, но не случилась (ПРОБЛЕМА)');
    } catch (err) {
      console.log('throw OcrError  :', err instanceof OcrError);
    }
    const failInv = await ctx.repositories.invoices.getById(failUp.invoiceId);
    const failItems = await ctx.repositories.invoiceItems.listByInvoice(failUp.invoiceId);
    console.log('invoiceId       :', failUp.invoiceId);
    console.log('status          :', failInv?.status, '(ожидается draft)');
    console.log('ocrError        :', failInv?.ocrError ?? '(нет)');
    console.log('ocrFallback     :', failInv?.ocrFallback, '(ожидается false)');
    console.log('items count     :', failItems.length, '(ожидается 0 — без фейка)');
    console.log('cleanup (fail)  : invoiceId', failUp.invoiceId, '| key', failInv?.imagePath);
  }

  // --- Cleanup: НЕ выполняем автоматически ---
  console.log('\n=== CLEANUP (вручную, автоматически НЕ удаляем) ===');
  console.log('Созданная накладная :', uploaded.invoiceId);
  console.log('Storage key         :', storageKey);
  console.log('Чтобы убрать тестовые данные — удалите вручную invoice/items/audit в Firestore');
  console.log('и объект в Storage (gsutil rm gs://<bucket>/' + storageKey + ') или через консоль Firebase.');

  console.log('\n[smoke:ocr] Готово.');
}

async function invoicesOcr(
  ctx: ReturnType<typeof createServiceContext>,
  deps: ConstructorParameters<typeof OcrService>[1],
  invoiceId: string,
  actor: Actor,
) {
  return new OcrService(ctx, deps).processInvoice(invoiceId, actor);
}

async function printOcrSummary(
  ctx: ReturnType<typeof createServiceContext>,
  invoiceId: string,
  outcome: { status: string; itemsCount: number; fallback: boolean },
): Promise<void> {
  const inv = await ctx.repositories.invoices.getById(invoiceId);
  const items = await ctx.repositories.invoiceItems.listByInvoice(invoiceId);
  const audit = (await new AuditService(ctx).list()).filter((l) => l.entityId === invoiceId && l.action === 'invoice_ocr');
  console.log('final status    :', inv?.status);
  console.log('ocrFallback     :', inv?.ocrFallback);
  console.log('ocrError        :', inv?.ocrError ?? '(нет)');
  console.log('supplier        :', inv?.supplierName ?? '(нет)');
  console.log('recognizedDate  :', inv?.recognizedDate);
  console.log('totalSum        :', inv?.totalSum);
  console.log('itemsCount      :', outcome.itemsCount);
  console.log('audit invoice_ocr:', audit.length > 0);
  console.log(
    'first items     :',
    items.slice(0, 5).map((i) => `${i.rawName}${i.vehicleId ? ` [${i.vehicleId}]` : ''}`),
  );
}

main().catch((err) => {
  // Не раскрываем стек/внутренние детали/секреты — только тип и краткое сообщение.
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[smoke:ocr] ОШИБКА:', msg);
  process.exit(1);
});
