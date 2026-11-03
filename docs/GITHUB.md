# Публикация на GitHub Pages (один раз)

Всё бесплатно: публичный репозиторий + GitHub Pages + GitHub Actions.
Код будет виден всем, **ваши слова — нет** (они в Supabase под входом).

## 1. Создать пустой репозиторий
1. https://github.com → справа вверху **+** → **New repository**.
2. Repository name: `vocab`. Видимость: **Public**.
3. Галочки «Add a README», «.gitignore», «license» — **не ставить** (репозиторий должен быть пустым).
4. **Create repository**.

## 2. Ключи Supabase для сборки
В репозитории: **Settings → Secrets and variables → Actions → New repository secret**. Создать два секрета
(значения — из вашего файла `.env.local`, те же самые):
- Name `VITE_SUPABASE_URL`, Secret: ваш Project URL.
- Name `VITE_SUPABASE_ANON_KEY`, Secret: ваш publishable key (`sb_publishable_…`).

⚠️ Секретный ключ (`sb_secret_…` / service_role) сюда **не** добавлять.

## 3. Включить Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## 4. Сообщить Claude ваш логин GitHub
Логин виден в адресе профиля: `https://github.com/<логин>`. Claude отправит код (`git push`);
при первой отправке Windows откроет окно входа в GitHub — войдите сами.

## 5. После публикации — адрес в Supabase
Supabase → **Authentication → URL Configuration**:
- Site URL: `https://<логин>.github.io/vocab/`
- Redirect URLs → **Add URL**: `https://<логин>.github.io/vocab/**` (адрес localhost оставить).

## 6. Установить приложение
- **Планшет (Chrome):** открыть `https://<логин>.github.io/vocab/` → меню ⋮ → **Установить приложение**
  (или «Добавить на главный экран») → войти по ссылке из письма (открыть письмо на планшете).
  Плавающее окно: «Недавние приложения» → зажать карточку словаря → **Плавающее окно**.
- **ПК (Chrome/Edge):** открыть адрес → значок «Установить» справа в адресной строке.
