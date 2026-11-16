# Продолжение работы: плагин `opencode-config-editor` для OpenCode Desktop

> Файл-памятка для следующих сессий. Здесь всё, что нужно, чтобы продолжить без повторной разведки.
> ВАЖНО: в этом файле и вообще в репозитории НИКОГДА не хранить API-ключи.
> ВНУТРЕННИЙ ФАЙЛ: содержит факты о машине разработки (пути, версии). В публичную документацию
> не входит; при выкладке репозитория можно удалить или оставить — путей к ключам здесь нет.

## Статус

- [x] Разведка окружения и API (см. факты ниже)
- [x] Согласован план с пользователем (2 скоупа: глобальный + проектный конфиг)
- [x] Реализация кода (src/gui.tsx + src/gui/*)
- [x] Сборка (vite build → dist/gui-experimental.cjs, 187KB)
- [x] Подключение в глобальный конфиг (`plugins` → путь к папке плагина, абсолютный)
- [x] Проверка загрузки: `/api/plugin` показывает id `opencode-config-editor`, source local, features.gui=true, status active
- [x] Фиксы первого запуска (см. «Известные решения», п.1–3)
- [x] Свёрнутые секции (см. «Известные решения», п.4)
- [x] Кроссплатформенность (см. «Известные решения», п.9): глобальный путь на Windows —
      `%APPDATA%\opencode\opencode.json` (фолбэк `~/.config/opencode`), README-секция
      «Перенос на другие машины» (способы, что не переносится, схема для 3+ машин, чек-лист)
- [x] Фикс «залипшей» ошибки валидации (см. «Известные решения», п.10):
      seq-защита от гонки IPC-ответов, дебаунс 300мс при вводе, автоперевалидация после
      refetch/changed/смены скоупа (createEffect на version+scope), reset не нужен —
      validateFile перезапускает проверку нового файла; черновик raw имеет приоритет над файлом
- [x] ИСТИННАЯ причина «залипшей» ошибки (21:48, см. «Известные решения», п.11): регулярка
      формата "model" в validate.ts была строже схемы — не пускала слэши в id модели, а у
      RouterAI id содержит "/" (routerai/z-ai/glm-5.3-flash). Приведена к паттерну схемы,
      текст ошибки уточнён (ru+en). Гонки из п.10 — реальные, но не причина этого симптома.
- [x] Подсветка JSON-редактора (21:56, см. «Известные решения», п.12): CodeMirror 6
      (@codemirror/lang-json + lineNumbers + history), тема на переменных --v2-* с Nord-цветами
      токенов; бандл 857KB (был 548KB). RawEditor переписан императивно (onMount/onCleanup),
      внешние изменения — через dispatch с filter:false.
- [x] Панель в сессии (22:0x, см. «Известные решения», п.13): вкладка «Конфиг» в боковой панели
      (Panel, width 520), пункт в «+»-меню (session.panel), команда «Открыть здесь» (mod+shift+c).
      Тот же SettingsView; решает проблему «нет открытой сессии» — в панели сессия всегда смонтирована.
- [x] Скролл панели (см. п.13, «СКРОЛЛ»): обёртка height:100% + overflow-y:auto + contain.
- [x] Кнопка «Только подключённые (N)» в «Моделях провайдера» (см. «Известные решения», п.14):
      фильтр каталога до моделей текущего конфига, combined с поиском, лимит поиска снимается (Infinity).
- [x] Фикс «воскрешения» модели после Сохранить (см. «Известные решения», п.15): тумблер/дефолт/
      создать конфиг теперь очищают rawDraft после записи (общий writeRaw); программные dispatch
      CodeMirror больше не создают черновик (фильтр по Transaction.userEvent); editBase() — черновик
      как база правки только если он валидный JSON, иначе файл.
- [x] Убран дубль валидации: ValidationPanel рендерился и в RawEditor, и в секции «Валидация» —
      остался только в секции (см. п.16).
- [x] Автономность (см. п.17): разбор бандла (вшито всё кроме app-модулей), страховка
      globalThis.require для ajv-кодогенерации в main.ts, README-раздел «Автономность и зависимости».
- [x] Документация обезличена для публикации (22:5x): в README нет машинных путей (/Users/ilya →
      /path/to/…), добавлена секция «Публикация репозитория (GitHub)»; в CONTINUATION пути остались
      только в «Фактах окружения» (внутренний файл, пометка в шапке).
- [x] Мультипровайдерность с откатом (23:1x, см. п.18): селектор провайдеров из конфига
      (>1 провайдера), активный провайдер = выбор → options → первый; флаг MULTI_PROVIDER=false
      откатывает к одному провайдеру.
- [x] Рендер-крэш «пустое место» (23:3x–23:4x, см. п.19): КОРЕНЬ — TDZ (configProviderIds memo
      создан раньше current, host-Solid считает memo жадно → memo undefined → o().length падает).
      Фикс: перенос блока после current + normalizeValidation + ErrorBoundary со стеком
      (Electron пишет 1 строку → стек в одну строку через " | "). После rebuild 23:42 — логи чистые.
- [ ] ПРОВЕРКА В UI: плагин отрисовался (панель + настройки); с одним провайдером всё как было;
      добавить второго провайдера в JSON → селектор появился, тумблеры пишут выбранному; ошибка
      валидации — один раз; тумблер → Сохранить не воскресает; фильтр «Только подключённые»;
      панель: скролл, скоуп «Проект», Cmd+Shift+C
- [x] README.md (написан; см. ниже)
- [ ] Опционально: публикация в npm (см. README, секция «Публикация»)

## Что делает плагин (ТЗ, согласовано)

GUI-часть (без server-части) для OpenCode Desktop. Страница в Settings «Config Editor»:

1. **Селектор скоупа**: «Глобальный» (`~/.config/opencode/opencode.json`) или «Конфиг проекта»
   (`<проект>/opencode.json`, `<проект>/.opencode/opencode.json`). Проектный доступен только когда открыта
   сессия (`ctx.sessions.current()?.directory`); если файла нет — кнопка «Создать конфиг проекта»
   (пишет `{"$schema": "https://opencode.ai/config.json"}`).
2. **Список моделей провайдера `routerai`**: каталог тянется из `GET https://routerai.ru/api/v1/models`
   (OpenAI-совместимый, ~606 моделей, ключ из глобального конфига). Поиск с релевантностью
   (токены по id/имени/вендору). Чекбокс: отмечено = модель в конфиге выбранного скоупа.
   Клик добавляет/удаляет запись в `provider.<id>.models` (или `providers.<id>.models` для V2-формы).
3. **«Сделать по умолчанию»**: пишет `model: "<providerID>/<modelID>"` в выбранный файл.
4. **Raw-редактор**: textarea с сырым JSON, «Сохранить» с валидацией, панель ошибок (ru).
5. **Валидация**: ajv по схеме `https://opencode.ai/config.json` (скачать и забандлить) + кастомные правила:
   формат `model` (`provider/model[#variant]`), существование провайдера/модели, `enabled_providers`,
   резолвимость `{file:...}`-ссылок, предупреждение о литеральном API-ключе в проектном конфиге,
   провайдер из проектного конфига, отсутствующий в мердже global+project.
6. **Безопасность**: атомарная запись (tmp+rename), `.bak`-бэкап рядом, ключи не логировать.
   OpenCode подхватывает правки конфига без перезапуска (watch).

Плагин-опции (`options` в записи plugins): `providerID` (default `"routerai"`),
`catalogURL` (default `"https://routerai.ru/api/v1/models"`).

Идентификаторы: plugin id = `config-editor`; settings page id = `config-editor`; команда `open`
(публикуется как `config-editor.open`); IPC-токен `config-editor.fs`.

## Ключевые факты окружения (проверено, не предполагается!)

- Система: macOS arm64. **НЕТ** node, npm, bun, deno в PATH → установить bun:
  `curl -fsSL https://bun.sh/install | bash` (бинарник в `~/.bun/bin/bun`); добавлять `export PATH="$HOME/.bun/bin:$PATH"`.
- OpenCode CLI 1.19.5 (в `~/.opencode/bin/opencode`), **Desktop app 2.3.0**, Electron 44 (Chrome 152).
  Desktop app: `/Applications/OpenCode.app`, свои плагины резервируют id'ы.
- Фоновый сервис: `~/.local/state/opencode/service.json` → `{url, pid, password}`.
  Авторизация на HTTP API: **Basic**, user `opencode`, пароль = `password` из service.json
  (curl `-u "opencode:$PASS"`). `Bearer` НЕ работает.
- Глобальный конфиг: `~/.config/opencode/opencode.json` — **V1-форма** (`provider` ед.ч., `npm`,
  `options.apiKey = "{file:…}"` на файл ключа), 2 модели routerai:
  `z-ai/glm-5.3-flash` (default), `~deepseek/deepseek-v4-flash-latest`. Также есть
  `enabled_providers: ["routerai"]`. Ключ лежит в `~/.config/routerai-agent/credentials`
  (на машине разработки; в документацию/репозиторий не выносить).
- В `~/.config/opencode/node_modules` стоит `@opencode-ai/plugin@1.19.5` (старое имя V1-пакета).
  Для GUI-плагинов по докам нужен npm-пакет **`@opencode/plugin`** (V2) — проверить `bun add @opencode/plugin`.
- Рабочая директория плагина: `~/Projects/opencode_config_plugin` (на машине разработки).
- Пользователь отвечает по-русски; интерфейс app `lang=ru` → i18n: en + ru.

## HTTP API фонового сервера (проверено curl'ом)

- `GET /api/config?directory=...` → массив `Config.Entry` (`{type:"document"|"directory", path, info?}`) —
  какие конфиги загружены для локации. У пользователя: document `~/.config/opencode/opencode.json` + directory-записи.
- `GET /api/model` → `{location, data:[Model.Info]}` (только модели настроенных провайдеров).
  `GET /api/provider` → список провайдеров.
- `PATCH /api/experimental/config` — только `{shell}` (для конфига в целом бесполезен).
- `POST /api/experimental/fs/write?path=...` (body octet-stream) — запись файла (создаёт parents).
  `GET /api/fs/read/*` — чтение. Может быть ограничено локацией — GUI-плагин читает/пишет через main-процесс (fs), НЕ через эти эндпоинты.
- `GET /api/plugin`, `GET /api/plugin/gui` — статус загруженных плагинов (для проверки загрузки).
- Каталог RouterAI: `GET https://routerai.ru/api/v1/models` с `Authorization: Bearer <ключ>` →
  `{data:[{id,...}]}`, 606 моделей (проверено).

## Знание по GUI-плагинам (из https://opencode.ai/docs/build/plugins и /build/plugins/gui)

- Части пакета: server (`.|./server`), TUI (`./tui`), **GUI (`./gui-experimental`)**, RPC (`./rpc`).
  GUI-only пакет: id = package.json `name` (или имя локальной папки без name).
  Локальная папка БЕЗ `name`/`exports`: ищет файлы в корне — `gui-experimental.cjs` (или `.js`).
- `package.json` exports: `"./gui-experimental": "./dist/gui-experimental.cjs"`.
- GUI-файл: `export default Plugin.define({ os?, stores?, i18n, setup(ctx), main(ctx) })`.
  **Один файл выполняется в двух процессах**: `setup` — в каждом окне (Solid), `main` — в Electron main.
  В окне electron/Node = инертные заглушки; в main solid-js = заглушки. Код держать внутри setup/main!
- Сборка: vite-пресет `import { gui } from "@opencode/plugin/gui/vite"` → `vite build` → один CJS-бандл,
  динамические import'ы инлайнятся. Entry по умолчанию `src/gui.tsx`, outFile `dist/gui-experimental.cjs`.
  devDependencies: `vite`, `vite-plugin-solid`, `solid-js` (+ `electron`, `@types/node` для main).
- **Shared modules** (предоставляет хост, НЕ бандлить): `effect`, `@opencode/plugin/gui`,
  `@opencode/plugin/gui/main`, `@opencode/plugin/rpc`, `@opencode/schema/rpc`, `@opencode/client`,
  `@opencode/client/effect`; окна: `solid-js`, `solid-js/web`, `solid-js/store`, `@opencode/client/solid`,
  `@opencode/plugin/gui/{file,review,browser}`; main: `electron`, `node:*`.
  Пресет фейлит сборку на других `effect/*`, `solid-js/*`, `@opencode/*`. Всё остальное (напр. ajv) бандлится.
- IPC main↔окно: `Ipc.define({ id, state?, methods: {name: {input?, output?}}, events? })` со схемами `effect`:
  ```ts
  import { Schema } from "effect"; import { Ipc } from "@opencode/plugin/gui"
  export const Fs = Ipc.define({ id: "config-editor.fs",
    methods: { read: { input: Schema.Struct({path: Schema.String}), output: Schema.Struct({content: Schema.String}) } },
    events: { changed: Schema.Struct({path: Schema.String}) } })
  ```
  main: `const p = ctx.provide(Fs, { state: (w)=>..., read: (input, caller) => ... })`;
  push: `p.changed(window?)`, `p.emit("changed", data, window?)`.
  Окно: `const fs = ctx.main(Fs)`; `await fs.read({path}, {signal})`; `fs.on("changed", cb)`;
  `fs.state()` — если объявлен state.
- Токены должны иметь id = plugin id или `<id>.<name>` — иначе `ctx.provide`/`ctx.main` бросают.
- Контекст окна: `ctx.t(key)`, `ctx.stores.*`, `ctx.add(Command|Panel|SettingsPage|Slot|Style|MenuItem|...,
  item-factory)`, `ctx.sessions.current()` (`.directory`, `.server.id`), `ctx.layout.settings(pageId?)`,
  `ctx.ui.*` (Button, TextInput, Select, Switch, Loader, SettingsLayout/Section/Row, Dialog, Markdown, Code…),
  `ctx.system.openExternal/copy`, `ctx.desktop?.pick`, `ctx.locale`, `usePlugin<typeof definition>()` в компонентах.
- `Command`: `{id, title, keywords?, group?, section?, bind?, slash?, enabled?, run}`; `run` может вернуть `false`
  для отклонения кейбинда. Публикуется как `<plugin id>.<command id>`.
- `SettingsPage`: `{id, icon?, title (getter для i18n), entries?: SettingEntry[], render(input)}`; внутри
  рендерить `ctx.ui.SettingsLayout > SettingsSection > SettingsRow` (стиль хоста + поиск по entries).
- `Style`: `ctx.add(Style, cssString)` (импорт `?inline`).
- Реактивность: `createKeyed`, `createLatest` из `@opencode/plugin/gui`; `createSignal/createStore` из solid-js.
- Регистрации в `setup` — верхний уровень (синхронно); cleanup — вернуть функцию.
- Загрузка: локальная папка через `plugins: ["/abs/path"]` в **глобальном** `opencode.json(c)` (desktop читает
  только его, НЕ cli.json). Опции: `{ "package": "/path", "options": {...} }`.
  Перезагрузка GUI при каждом rebuild (`vite build --watch`), смена options тоже перезагружает.
  Settings > Extensions > Plugins — статус, переключатель GUI.
- Ограничения id: не пересекаться с ids встроенных плагинов app, не в namespace `opencode`.
- Экспериментальное API — может меняться между релизами.

## Валидация

- Схема: скачать `https://opencode.ai/config.json` в `src/schema/config.schema.json`, импорт JSON в validate.ts,
  ajv (зависимость, бандлится). Формат `model`: `^[^/#]+/[^#]+(#[^#]+)?$`.
- Свои правила — см. ТЗ. Мердж для проверок: global ← project (project поверх).

## Порядок продолжения (если сессия прервалась)

**Актуальное состояние** — см. «Статус» выше. Плагин написан, собран и загружен.

### Команды разработки

```sh
export PATH="$HOME/.bun/bin:$PATH"   # bun 1.4.4 установлен через официальный инсталлятор
cd <путь к репозиторию плагина>      # рабочая директория — см. «Факты окружения» ниже
bun run typecheck   # tsc --noEmit
bun run build       # vite build → dist/gui-experimental.cjs
bun run watch       # пересборка при изменениях; GUI плагина перезагружается в окнах сам
```

### Известные решения в коде (не «переулучшать» без нужды)

1. **ajv**: схема OpenCode — draft 2020-12 → использовать `Ajv2020` из `ajv/dist/2020` (дефолтный
   экспорт ajv — draft-07, падает с `no schema with key .../draft/2020-12/schema`) + `ajv-formats`.
   Схема ссылается на `https://models.dev/model-schema.json#/$defs/Model` — скачана в
   `src/schema/model-schema.json`, регистрируется `ajv.addSchema(...)`.
2. **IPC id** обязан начинаться с plugin id: токен — `opencode-config-editor.fs` (не `config-editor.fs`),
   иначе `ctx.main`/`ctx.provide` бросают (`provides only its own Ipcs`).
3. `createLatest` не имеет `refetch` → сигнал `version` в source (settings.tsx).
   IPC-методы без input требуют вызов с `{}`: `fs.catalog({})`, `fs.loadCatalog({})`.
   Каталог держится в main (`state.catalog`), окно тянет снапшот `fs.catalog({})`,
   обновление — `refreshCatalog(true)` / `onMount`. Push не использован (state в Ipc не объявлен).
4. **Свёрнутые секции** (запрошено пользователем: все 3 свёрнуты по умолчанию): порядок секций —
   Файл конфига → JSON целиком → Валидация → Модели. Локальный компонент `Collapsible`:
   `ui.SettingsSection` + кликабельный заголовок (role=button, aria-expanded), иконка `chevron-down`,
   поворот классом `config-editor-chevron-closed` через `ctx.add(Style, …)` — `ui.Icon`
   поддерживает ТОЛЬКО `class`, не `style`. Сводки в свёрнутом виде (ключи i18n `*.summary`):
   путь файла / статус валидации (цвет через `--v2-error-fg`/`--v2-success-fg`) / «В конфиге: X из Y».
   Валидация автораспахивается при ошибках (`createEffect`), никогда не авто-сворачивается.
   Состояние — store `ui`: `rawOpen`/`validationOpen`/`modelsOpen` (Schema.Struct расширен), дефолт `false`.
5. Поиск моделей — клиентский (в окне); валидация — в main (нужен existsSync для `{file:...}`);
   mergedRaw передаётся из окна.
6. `watch` в main — `fs.watchFile` (poll 1с); ставится при каждом `read()`.
7. id плагина — `opencode-config-editor` (из package.json `name`, т.к. server-части нет).
8. Иконка страницы: `settings-gear` (валидируйте IconName по `icon-name.d.ts` при смене).
9. **Кроссплатформенность**: `os: ["macos","windows","linux"]`; глобальный конфиг — функция
   `globalConfigPath()` в main.ts: Windows → `%APPDATA%\opencode\opencode.json` (если есть/пусто),
   иначе `~/.config/opencode/opencode.json`; macOS/Linux → `~/.config/opencode/opencode.json`.
   В README — секция «Перенос на другие машины (Linux, Windows)»: способы переноса (папка/git/npm),
   что не переносится (абсолютные пути, ключ), рекомендуемая схема с `{env:ROUTERAI_API_KEY}`,
   чек-лист. Ключ НЕ хранить в репозитории и проектном конфиге.
10. **Валидация без «залипания»** (баг: ошибка исчезала из файла, но панель показывала её дальше):
    - `validationSeq` — монотонный счётчик; `applyValidation` игнорирует устаревшие IPC-ответы
      (для проектного скоупа каждый запрос сначала читает глобальный файл → ответы приходят не по порядку);
    - ввод в raw — через `validateDraftSoon` (дебаунс 300мс);
    - `validateFile()` перечитывает состояние файла после `refetch`/`changed`/смены скоупа
      (createEffect на `version()+scope`); если в raw есть незакрытый черновик (`rawDraft`), он имеет
      приоритет — панель показывает статус черновика, а не файла;
    `validateNow` возвращает результат только если он актуален (seq совпал); `save`/`toggleModel`/
      `makeDefault` ветвятся по `result && !result.valid` — устаревший undefined не блокирует запись,
      свежая проверка уже обновила панель.
13. **Панель в сессии** (решает «нет открытой сессии — только глобальный конфиг»): в window.tsx
    зарегистрированы через `ctx.add`:
    - `Panel` (id `config`, region `side`, width 520): `list` возвращает вкладку только если
      `input.open.includes("config")`; объект вкладки кэшируется в переменной модуля (`configTab`),
      чтобы смена сессии не пересоздавала label. `render: () => <SettingsView />`.
    - `MenuItem` (`menu: "session.panel"`, icon `settings-gear`) — пункт «Редактор конфига»
      в «+»-меню боковой панели: `ctx.layout.open(\`${ctx.id}:config\`, session)`.
    - `Command` (`open-panel`, bind `mod+shift+c`) — та же opening-логика через `ctx.sessions.current()`.
    Ключ панели — `\`${plugin id}:config\``. Внутри панели `ctx.sessions.current()` всегда смонтирован,
    поэтому проектный скоуп доступен. Store'ы общие со страницей настроек (draft, свёрнутость, скоуп).
    На узких экранах (<768px) хост сам показывает мобильное представление панели.
    **СКРОЛЛ**: хост НЕ скроллит содержимое панели — `Panel.render` обязан обернуть контент в
    `<div style={{height:"100%", "overflow-y":"auto", "overscroll-behavior":"contain"}}>`,
    иначе контент обрезается по высоте региона (SettingsLayout скроллит только в диалоге настроек).
14. **Фильтр «Только подключённые»**: сигнал `onlyEnabled` (НЕ в store — временный, как query);
    `filtered()` = search(...) с лимитом Infinity при активном фильтре (иначе 200), затем
    `.filter(m => configModelIds().has(m.id))` — комбинируется с поисковым запросом. Кнопка
    `ui.Button` variant contrast/ghost-muted + aria-pressed, текст `filter.enabled` с count.
    Пустой результат при фильтре — отдельный ключ `search.empty.enabled`. Модели в конфиге,
    отсутствующие в каталоге, фильтром не показываются (сводка «X из Y» выявляет расхождение).
15. **Черновик raw-редактора (rawDraft)** — главный источник бага «воскрешения» старого конфига:
    - черновик создаётся ТОЛЬКО действиями пользователя: в CodeMirror `updateListener` фильтрует
      транзакции по `Transaction.userEvent` (печать/вставка/undo); программный `dispatch` (синхронизация
      с диском, формат) черновик НЕ создаёт — раньше он оставался от любого состояния и «Сохранить»
      записывал устаревший текст поверх нового файла;
    - после ЛЮБОЙ записи через плагин черновик очищается: общий помощник `writeRaw(path, raw)`
      (validate-pretty → fs.write → savedAt → rawDraft="" → refetch) используют `save`, `toggleModel`,
      `makeDefault`, `createProjectConfig`; тумблер и «дефолт» правят базу из `editBase()` —
      черновик, ЕСЛИ он валидный JSON (иначе файл на диске), чтобы правка не падала на сломанном черновике;
    - при пустом черновике «Сохранить» пишет содержимое файла — ничего не воскресает.
16. **ValidationPanel рендерится ОДИН раз — в секции «Валидация»** (не внутри RawEditor: исторический
    дубль убран 22:3x). Сводка секции видна в свёрнутом виде; при ошибках секция автораспахивается (п.4).
17. **Автономность бандла**: вшито всё (CodeMirror, ajv+formats, схемы, UI); внешнее — только то,
    что предоставляет приложение (`@opencode/plugin/gui`, `effect`, `solid-js` — vite-пресет ЗАПРЕЩАЕТ
    их вшивать, сборка падает) и node:-билтины. Для работы нужны только `dist/` + `package.json`;
    node_modules (~300MB) — только для сборки. СТРАХОВКА: ajv-кодогенерация вставляет
    `require("ajv/dist/runtime/…")` в генерируемый `new Function`-код для некоторых ключевых слов
    схем — main.ts публикует `createRequire(__filename)` в `globalThis.require` (обёрнуто в try,
    no-op если глобальный require уже есть). Для текущей схемы путь не выполняется (проверено
    тестами: formats/ucs2length/equal/$data не генерируют require).
18. **Мультипровайдерность С ОТКАТОМ** (23:1x): флаг `const MULTI_PROVIDER = true` в начале
    settings.tsx — поставить `false`, чтобы вернуть прежнее поведение (провайдер только из
    options.providerID, без селектора). Что добавлено:
    - `configProviderIds()` — провайдеры из текущего файла (providers/provider, V1+V2);
    - `activeProviderId()` — приоритет: выбор пользователя (`pickedProvider`, сигнал) →
      options.providerID → первый из файла; вне MULTI_PROVIDER просто options;
    - селектор `ui.Select` в секции «Модели» показывается ТОЛЬКО когда провайдеров >1
      (с одним — прежний вид, ничего не меняется в UX);
    - тумблер/дефолт/configModelIds пишут и читают `activeProviderId()`;
    - createEffect сбрасывает выбор, если провайдер исчез из файла;
    - провайдеров 0 → подсказка `section.models.provider.none`;
    - примечание `section.models.provider.catalogNote`: каталог ОДИН (из options), модели
      провайдера, которого в каталоге нет, не показываются — добавлять через «JSON целиком»;
    - валидатор НЕ менялся (он провайдеро-независим, проверяет всех);
    - дефолты (routerai) сохранены в options-фолбэках — это стартовое значение, не жёсткая привязка.
19. **Рендер-крэш после мультипровайдерности (23:3x) и фикс**: симптом — «пустое место вместо
    плагина» (и в панели, и на settings-странице), в renderer.log только
    `TypeError: Cannot read properties of undefined (reading 'length')` БЕЗ stack (host логирует
    только message падения плагина). Два уровня защиты:
    - **Гварды**: `normalizeValidation()` в settings.tsx — единственная точка приёма результата
      IPC `validate`: если `issues` не массив (host не enforcing'ит output-схему IPC) → `[]`,
      `valid` только при `=== true`; `validationSummary()`/`ValidationPanel` дополнительно
      проверяют `Array.isArray(v.issues)`. Главный подозреваемый крэша был именно
      `v.issues.length` в `validationSummary()` — он вызывается **жадно** как `summary={…}`
      даже у свёрнутой секции.
    - **ErrorBoundary**: `guarded()` в window.tsx оборачивает `<SettingsView/>` и в панели,
      и на settings-странице. При падении: видимый fallback («Плагин не смог отрисоваться» +
      кнопка «Повторить») вместо пустоты, `console.error("config-editor render crash", err)`
      пишет СТЕК в renderer.log (у window-контекста плагина нет `ctx.log` — он только у main).
    - После rebuild: перезагрузка плагина 23:27:48 прошла без ошибок в логах.
    - НА БУДУЩЕЕ: если снова «пустое место» — смотреть renderer.log на «config-editor render
      crash»: теперь стек будет.
    - **КОРЕНЬ (23:4x, найден через стек)**: ErrorBoundary + однострочный стек
      (`stack.replace(/\n/g, " | ")` — Electron пишет только первую строку записи) показали
      точное место: `get when(){return o().length>0}` — это `<Show when={configProviderIds().length>0}>`.
      `configProviderIds` был `undefined` из-за **TDZ**: memo объявлен ВЫШЕ по коду (строка ~93),
      чем `current` (строка ~167), которого он читает. Host-версия Solid вычисляет memo ЖАДНО при
      создании, ошибка TDZ глотается — memo навсегда undefined. Раньше memo создавались после своих
      зависимостей, поэтому работало. ФИКС: блок multi-provider перенесён ПОСЛЕ объявления `current`
      (после `fs.on("changed")`); плюс `typeof providers === "object"` гвард в memo.
      ПРАВИЛО: в settings.tsx createMemo/createEffect создавать только после объявлений того,
      что они читают.
20. **Совместимость с версиями OpenCode (23:5x)**: гарантированно — Desktop **2.3.0** (на ней всё
      разработано/проверено; SDK `@opencode/plugin` 2.3.0 версионируется синхронно с приложением).
      2.3.x — должно работать; ≤2.2 — нет (GUI API появилось позже); новее — не проверено
      (экспериментальное API, host сам предоставляет solid-js в рантайм — поведение host-внутренностей
      может меняться, что и вскрыл TDZ-крэш из п.19). Смягчения уже в коде: ErrorBoundary (видимый
      фолбэк + стек в renderer.log вместо пустоты), подключение путём (мгновенный откат из конфига).
      В README добавлена секция «Совместимость» (таблица + порядок действий после обновления:
      проверить рендер → стек в логе → `bun update @opencode/plugin` + rebuild → доступ к host API
      сосредоточен в window.tsx/settings.tsx). ПРИ ПОЯВЛЕНИИ НОВЫХ ВЕРСИЙ: обновить таблицу после
      реальной проверки, не заранее.
21. **ОПУБЛИКОВАНО на GitHub (17.11)**: https://github.com/igrlskv/opencode-config-editor —
    HTTPS-remote `origin`, пуш с PAT (Keychain помнит). 3 коммита: 138cd6c initial → d5f1017
    docs:совместимость → c08f868 chore:.gitignore. Локальная папка осталась
    `~/Projects/opencode_config_plugin` (имя не совпадает с репо — не важно). В README машинных
    путей нет; CONTINUATION.md — внутренний файл (пометка в шапке), машинные пути в нём оставлены
    сознательно. ДАЛЬНЕЙШИЕ ПУШИ: просто `git push`.
22. **.gitignore починен (17.11, c08f868)**: bun-init шаблон имел сломанные паттерны (`_.log` вместо
    `*.log`, coverage-report никогда не матчился — `*` превратились в `_`); добавлены .vscode,
    Thumbs.db/Desktop.ini (Windows), ._* (macOS resource forks); dist/node_modules игнорируются
    (пересборка после clone — задокументирована в README); проверено `git check-ignore` + тест *.log.
    БЭКЛОГ: (а) проверить мультипровайдерность в UI при появлении второго провайдера (чек-лист
    в «Проверка в UI»); (б) каталоги на каждого провайдера (сейчас catalogURL один — модели
    провайдера, которых нет в каталоге, не показываются в списке); (в) npm-публикация; (г) при
    обновлении OpenCode — чек рендера (см. п.20).
11. **Формат поля "model"** — id модели МОЖЕТ содержать "/" (RouterAI: `z-ai/glm-5.3-flash`,
    итого `routerai/z-ai/glm-5.3-flash`). Регулярка в validate.ts обязана совпадать с паттерном
    схемы (`^[^/#]+\/[^#]+(?:#[^#]+)?$`): без слэшей только сегмент провайдера. Симптом нарушения —
    «вечно валидная» ошибка формата, которую пользователь не может исправить.
12. **Raw-редактор — CodeMirror 6**: зависимости `codemirror`, `@codemirror/lang-json`,
    `@codemirror/{view,state,commands,language}`, `@lezer/highlight`. Статические расширения —
    в модуле (`editorExtensions`): `json()`, `lineNumbers()`, `history()`, keymap,
    `EditorView.lineWrapping`, тема (`editorTheme` — прозрачный фон, высота 320px, resize
    через CSS) и `HighlightStyle` (Nord-палитра: property #88c0d0, string #a3be8c, number
    #b48ead, bool/null #81a1c1). В Solid — императивно: `onMount` создаёт `EditorView`,
    `updateListener` → `onInput` (draft-стор + `validateDraftSoon`); внешние изменения
    (Форматировать/Обновить/смена скоупа) — `createEffect` сравнивает `showRaw()` с doc и
    делает `dispatch({changes, filter:false})` (не сбрасывает undo). `onCleanup` — `destroy()`.
    Бандл ~857KB (CodeMirror + lezer-парсер JSON).

### Проверка в UI (что попросить пользователя сделать)

1. Открыть/перезапустить окно OpenCode Desktop (при работающем окне новый GUI подхватывается по rebuild —
   но после самого первого подключения лучше переоткрыть Settings).
2. Settings → в левом наве появится «Config Editor» (иконка шестерёнки). Также ⌘⇧P → «Открыть редактор конфига».
3. Проверить: переключение Глобальный/Проект (проект — при открытой сессии), поиск «glm», «deepseek»,
   тумблер модели → файл меняется, «Сделать по умолчанию», raw-редактор: сломать JSON → ошибки,
   Сохранить с ошибками блокируется, Format работает, .bak появляется.
4. Логи: `~/.local/share/opencode/log/opencode.log` (role=server — загрузка плагина),
   десктоп-лог plugin'а — `ctx.log.write` в main пишет в лог app (`~/Library/Logs/OpenCode/` или как в доках).

### Публикация в npm (опционально)

1. package.json: убрать `"private": true`, версию поднять, `files: ["dist"]` уже есть.
2. `bun run build && npm publish` (или `bun publish`).
3. У пользователю тогда: `"plugins": ["opencode-config-editor"]`.
4. Помнить: GUI API экспериментальный; при выходе новых версий OpenCode проверять
   breaking changes в `@opencode/plugin/gui`.

## Структура

```
<репозиторий плагина>/
├── CONTINUATION.md      # этот файл
├── README.md            # документация (ru)
├── package.json         # name: opencode-config-editor, exports: {"./gui-experimental": "./dist/gui-experimental.cjs"}
├── vite.config.ts       # plugins: [gui()]
├── tsconfig.json
└── src/
    ├── gui.tsx          # export default Plugin.define({...definition, setup, main})
    └── gui/
        ├── definition.ts   # i18n en/ru, (stores при необходимости)
        ├── contract.ts     # Ipc.define: fs методы + события
        ├── main.ts         # node:fs (атомарная запись, .bak), fetch каталога, watch, resolve {file:...}
        ├── validate.ts     # ajv + кастомные правила
        ├── search.ts       # скоринг поиска
        ├── schema/config.schema.json  # скачанная схема
        ├── window.tsx      # setup: SettingsPage + Command
        └── settings.tsx    # UI (селектор скоупа, список моделей, raw, ошибки)
```
