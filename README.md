# kanada-auth-gateway

Node.js-бэкенд аутентификации и WebSocket-шлюза перед iRidium-сервером. Хранит пользователей, сессии и 2FA в собственной Postgres-БД (изолированной от iRidium) и проксирует браузерный WebSocket-трафик к апстриму iRidium, применяя scope-based контроль доступа к устройствам.

## Возможности

- **Аутентификация**: логин/пароль (argon2), сессии на подписанных cookie, CSRF-защита для мутирующих запросов.
- **2FA (TOTP)**: подключение через QR-код, коды восстановления, сброс администратором.
- **Роли и scope-доступ**: роли `admin`/`user`; для обычных пользователей можно ограничить доступ к конкретным scope (комнатам/зонам устройств).
- **Админка**: CRUD пользователей, смена роли/активности, выдача scope-доступа, сброс 2FA — все методы через `/admin/*`.
- **WebSocket-шлюз** (`/ws`): проксирует команды браузера к iRidium-серверу и обратно, с фильтрацией сообщений по scope, троттлингом команд (`setDevice`) и rate-limit входящих сообщений.
- **Аудит-лог**: логирование значимых событий (WS-команды, отказы по scope и т.д.) в БД.

## Стек

Express 5, TypeScript (ESM, `NodeNext`), PostgreSQL (`pg`), `ws`, `argon2`, `otplib`, `helmet`, `express-rate-limit`.

## Структура проекта

```
src/
  app.ts                 # сборка Express-приложения (middleware, роуты)
  server.ts              # точка входа: HTTP-сервер + WS-шлюз
  config/env.ts           # чтение и валидация переменных окружения
  routes/                 # auth.routes, admin.routes, health.routes
  services/                # бизнес-логика (login, сессии, 2FA, админ-операции)
  services/wsGateway/      # WebSocket-шлюз к iRidium: апстрим, троттлинг, scope-фильтр
  repositories/            # доступ к БД (users, sessions, audit log, scopes...)
  middleware/               # requireAuth, requireAdmin, requireCsrf, rate limiter
  db/migrations/             # SQL-миграции (схема auth.*)
scripts/
  migrate.ts               # применение миграций
  create-user.ts            # создание пользователя из CLI
```

## Быстрый старт (разработка)

1. Поднять Postgres для разработки:

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Скопировать `.env.example` в `.env` и заполнить значения (см. описание переменных ниже).

3. Установить зависимости и применить миграции:

   ```bash
   npm install
   npm run migrate
   ```

4. Создать первого администратора:

   ```bash
   npm run create-user -- admin "пароль-от-12-символов" admin
   ```

5. Запустить сервер в режиме разработки (с автоперезапуском):

   ```bash
   npm run dev
   ```

Сервер поднимется на `http://localhost:3001` (или на порту из `PORT`).

## Переменные окружения

Полный список с описанием — в [.env.example](.env.example). Кратко:

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | строка подключения к Postgres |
| `PORT` | порт, на котором слушает Node |
| `TRUST_PROXY_HOPS` | число реверс-прокси хопов перед Node (влияет на `req.ip` в rate-limit и аудит-логе) |
| `COOKIE_SECRET` | секрет для подписи сессионных cookie |
| `WEB_CLIENT_ORIGIN` | разрешённый Origin для CORS и проверки WS-апгрейда |
| `TOTP_ENCRYPTION_KEY` | 32-байтный hex-ключ шифрования TOTP-секретов at rest (AES-256-GCM) |
| `RATE_LIMIT`, `RATE_LIMIT_WINDOW_MS` | лимит попыток логина/2FA с одного IP |
| `IRIDI_SERVER` | адрес апстрим-сервера iRidium для WS-моста |
| `NODE_ENV` | `development` / `production` |

`TOTP_ENCRYPTION_KEY` (32 байта в hex) сгенерировать так:

```bash
openssl rand -hex 32
```

`COOKIE_SECRET` — произвольная длинная случайная строка (не обязательно hex), например:

```bash
openssl rand -base64 48
```

## Скрипты npm

| Команда | Описание |
| --- | --- |
| `npm run dev` | запуск в режиме разработки (`tsx watch`) |
| `npm run build` | компиляция TypeScript в `dist/` |
| `npm start` | запуск собранного проекта (`dist/src/server.js`) |
| `npm run migrate` | применение SQL-миграций из `src/db/migrations` |
| `npm run create-user -- <username> <password> [admin\|user]` | создание пользователя |
| `npm run typecheck` | проверка типов без сборки |

## API

Базовые пути: `/health`, `/auth`, `/admin` (только для аутентифицированных администраторов).

### `/auth`

| Метод и путь | Описание |
| --- | --- |
| `POST /auth/login` | логин по username/password |
| `POST /auth/2fa/verify` | подтверждение TOTP-кодом при логине |
| `POST /auth/2fa/recovery` | подтверждение кодом восстановления |
| `POST /auth/2fa/setup` | начало настройки 2FA (генерация секрета/QR) — требует сессию |
| `POST /auth/2fa/confirm` | подтверждение и включение 2FA — требует сессию |
| `POST /auth/logout` | завершение сессии — требует сессию + CSRF |
| `GET /auth/session` | информация о текущей сессии |

### `/admin` (роль `admin`)

| Метод и путь | Описание |
| --- | --- |
| `GET /admin/users` | список пользователей |
| `POST /admin/users` | создание пользователя |
| `PATCH /admin/users/:id` | изменение роли/активности/scope-ограничения |
| `DELETE /admin/users/:id` | удаление пользователя |
| `PUT /admin/users/:id/scopes` | назначение списка scope-доступа |
| `POST /admin/users/:id/2fa/reset` | сброс 2FA пользователя |

Мутирующие запросы, кроме `/auth/login` и `/auth/2fa/*` (которые идут до выдачи сессии), защищены CSRF-токеном (`requireCsrf`).

### WebSocket `/ws`

Мост между браузером и апстрим-сервером iRidium. При апгрейде проверяются `Origin` (защита от cross-site WebSocket hijacking) и сессионная cookie. Для scope-ограниченных пользователей входящие и исходящие сообщения фильтруются по доступным scope; команды `setDevice` троттлятся, входящий поток ограничен rate-limit'ом на соединение.

## Деплой

`Dockerfile` — многостадийная сборка (зависимости → `tsc` → рантайм на `node:24-alpine`). `docker-compose.prod.yml` поднимает собранный образ, миграции применяются отдельным шагом.

Деплой в прод выполняется через GitHub Actions (`.github/workflows/deploy.yml`, запускается вручную): сборка и публикация образа в GHCR, затем по SSH — `docker compose pull`, применение миграций и `up -d` на целевом хосте.
