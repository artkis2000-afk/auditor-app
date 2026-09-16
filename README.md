# ФУРЫ ЗАПЧАСТИ

Система аудита закупок автозапчастей для грузового автопарка: распознавание накладных (Gemini OCR), сопоставление номенклатуры, автоматическое выявление аномалий (повторные закупки раньше срока износа, завышение цен, отклонение от рынка), учёт по машинам/узлам/колёсам, склад, финансы, аудит с откатом.

Самостоятельное (standalone) приложение — не зависит от среды Google AI Studio. Внешние сервисы: Firebase Firestore (БД) и Google Gemini (AI). Построено на основе reverse engineering исходного приложения (см. `docs/`), с функциональной эквивалентностью первой версии.

## Стек
- Frontend: React 19 + Vite + Tailwind + Recharts
- Backend: Node + Express + TypeScript (один процесс отдаёт API и SPA)
- БД: Firebase Firestore (за слоем репозиториев)
- AI: Google Gemini (`@google/genai`) + Jimp (предобработка)
- Валидация: Zod (единый источник схем/типов для web и server)
- Тесты: Vitest

## Архитектура (кратко)
```
shared/   — Zod-схемы, DTO, enums (единый контракт)
domain/   — чистая бизнес-логика (matching, placement, anomaly, finance) без I/O
server/   — routes → services → repositories(Firestore) + auth + ai
web/      — React SPA
```

## Команды
```bash
npm install       # установка зависимостей
npm run typecheck # проверка типов
npm test          # unit-тесты
# добавляются по мере реализации фаз:
# npm run dev     # dev-сервер (PHASE 4.7/4.8)
# npm run build   # production-сборка (PHASE 4.7/4.8)
# npm run start   # запуск production (PHASE 4.7/4.8)
```

## Статус реализации (по фазам)
- [x] PHASE 4.1 — shared (Zod-схемы, DTO, enums)
- [ ] PHASE 4.2 — domain (matching → placement → anomaly → finance)
- [ ] PHASE 4.3 — repositories / db (Firestore)
- [ ] PHASE 4.4 — services
- [ ] PHASE 4.5 — authentication
- [ ] PHASE 4.6 — OCR / Gemini
- [ ] PHASE 4.7 — API routes
- [ ] PHASE 4.8 — web
- [ ] PHASE 4.9 — integration

## Требования окружения
- Node.js 20+ (проверено на v24.21.0, npm 11.19.0)

Конфигурация — в `.env` (шаблон: `.env.example`). Секреты в код не помещаются.
