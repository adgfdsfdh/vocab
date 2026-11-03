# Журнал прогресса

Новая запись — сверху. Каждая сессия добавляет одну запись по шаблону.

## Шаблон

```
## ГГГГ-ММ-ДД — Fxx: <название>
**Статус функции:** todo | in_progress | done | blocked
**Что сделано:**
- ...
**Доказательства проверки:**
- `bash init.sh` → PASS/FAIL (кратко вывод)
- тесты: N прошло / M всего
- ручная проверка: ...
**Что сломано / известные проблемы:**
- ...
**Что сделать руками (пользователю):**
- ...
**Следующий шаг:**
- ...
```

---

## 2026-11-03 — F01: Каркас Vite + React + TS + PWA + Vitest
**Статус функции:** done
**Что сделано:**
- package.json со скриптами dev, build, preview, typecheck, test, icons.
- Vite 8 + React 19 + TypeScript (strict) + vite-plugin-pwa 2 + Vitest 5 (jsdom, Testing Library).
- vite.config.ts: base = `/vocab/` (переопределяется переменной BASE_PATH), манифест PWA на русском.
- Минимальный экран App, smoke-тест src/App.test.tsx.
- Иконки public/icon-192.png и icon-512.png (генератор scripts/make-icons.mjs), favicon.svg.
- .env.example с пустыми VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
- .claude/launch.json для локального предпросмотра сборки.
**Доказательства проверки:**
- `bash init.sh` → PASS (secrets, install, typecheck, test, build).
- тесты: 1 прошло / 1 всего.
- dist/ содержит manifest.webmanifest, sw.js, icon-192.png, icon-512.png.
- Манифест: name «Словарь — английские слова», lang=ru, display=standalone, start_url/scope=/vocab/.
- В dist/index.html все пути начинаются с /vocab/.
- Проверка типов ловит ошибки: специально сломанный файл → typecheck FAIL (файл удалён).
- `npm run preview` → http://localhost:4173/vocab/ открывается, service worker «activated», scope /vocab/.
**Что сломано / известные проблемы:**
- npm предупреждает об устаревшем glob@11 во вложенной зависимости dev-инструментов — на приложение не влияет.
- Если репозиторий на GitHub будет называться не `vocab`, нужно задать BASE_PATH в F08.
**Что сделать руками (пользователю):**
- По желанию: `npm run build`, затем `npm run preview` и открыть http://localhost:4173/vocab/.
**Следующий шаг:**
- F02: перевод через MyMemory API.

## 2026-11-03 — Харнесс проекта
**Статус функции:** — (код приложения ещё не начат)
**Что сделано:**
- Созданы CLAUDE.md, feature_list.json (F01–F11, все `todo`), claude-progress.md, init.sh, .gitignore.
- git init, первый коммит.
**Доказательства проверки:**
- `bash init.sh` → сообщает, что package.json ещё нет, проверки пропущены (ожидаемо до F01).
**Что сломано / известные проблемы:**
- Нет.
**Что сделать руками (пользователю):**
- Ничего на этом шаге.
**Следующий шаг:**
- F01: каркас Vite + React + TS + PWA + Vitest.

## Напоминания
- [ ] После первой регистрации в Supabase (F04): отключить новые регистрации —
      Authentication → Sign In / Providers → «Allow new users to sign up» = off.
