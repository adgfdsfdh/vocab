# Настройка Supabase (один раз)

Всё бесплатно: тариф **Free**. Карта не нужна. Ключи никому не отправляйте и в чат не вставляйте.

## 1. Создать проект
1. https://supabase.com/dashboard → **New project**.
2. Name: `vocab`. Database Password: придумайте и сохраните (приложению он не нужен).
3. Region: ближайший (например, **Central EU (Frankfurt)**). Plan: **Free**.
4. Галочки «Enable Data API» и «Enable automatic RLS» — оставить включёнными.
5. **Create new project**, подождать 1–2 минуты.

## 2. Создать таблицы (SQL-скрипт)
1. Слева **SQL Editor** → **New query**.
2. Откройте в проекте файл `supabase/migrations/0001_init.sql` (Блокнотом), выделите всё (Ctrl+A), скопируйте.
3. Вставьте в окно запроса → **Run**. Должно появиться «Success. No rows returned».
4. Проверка: слева **Table Editor** — есть таблицы `words` и `review_state`, у обеих значок RLS включён.

## 3. Вход по email
1. **Authentication → Sign In / Providers → Email** — должен быть включён (по умолчанию так).
2. «Allow new users to sign up» — пока **оставить включённым** (выключим после вашего первого входа).

## 4. Адрес сайта для ссылки из письма
**Authentication → URL Configuration**:
- Site URL: `http://localhost:5173/vocab/`
- Redirect URLs → **Add URL**: `http://localhost:5173/vocab/**` → Save.
- (В F08 добавим адрес на GitHub Pages.)

## 5. Шаблоны писем — ничего не делать
Supabase без своего почтового сервера (SMTP) не даёт менять текст писем. Это не нужно:
**«Set up SMTP» не нажимать**. Если ссылка из письма открывается не там, где нужно (другой браузер,
окно Windows-приложения), — скопируйте ссылку «Sign in» из письма (правый клик → «Копировать адрес ссылки»)
и вставьте её в приложении на вкладке «Аккаунт» в поле «Ссылка или код из письма».

## 6. Ключи → файл .env.local
1. В Supabase вверху кнопка **Connect** (или **Project Settings → API Keys**).
2. Скопируйте **Project URL** (вида `https://xxxx.supabase.co`).
3. Скопируйте **Publishable key** (`sb_publishable_...`) или, если показан старый вид, **anon public**.
   ⚠️ НЕ берите **secret** / **service_role** — он для приложения не нужен.
4. Откройте в папке проекта файл `.env.local` Блокнотом и вставьте после `=` без пробелов и кавычек:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```
5. Сохраните. Напишите Claude «готово».

## 7. После первого входа
**Authentication → Sign In / Providers** → выключить **Allow new users to sign up** → Save.
Так никто, кроме вас, не сможет зарегистрироваться.

## Полезно знать (бесплатный тариф)
- Встроенная почта Supabase отправляет лишь несколько писем в час. Если письмо не пришло — подождите
  и проверьте «Спам».
- Проект засыпает после ~7 дней без обращений. Разбудить: Dashboard → проект → **Restore**.
  Ежедневный бэкап (F11) будет обращаться к базе и не даст ему уснуть.
