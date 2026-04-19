# ui-builder

A Tooljet-style low-code UI builder that is **data-model first**.
Define your schema once and the server scaffolds a full CRUD application
(list / new / show / edit screens with state-machine transitions). The
React builder lets you keep editing the generated screens — drag
components on the canvas, edit props, wire transitions, and hit
**▶ Preview** to use the app for real against the same Go API.

```
ui-builder/
├── server/      # Go HTTP API, JSON-file storage, scaffold generator
└── ui/          # React + TypeScript builder + preview runtime
```

## Concepts

- **DataModel** — Rails-style schema (`name`, `fields[]`).
  Field types: `string | text | int | bool | date | ref`.
- **App** — UI metadata document. Contains:
  - `screens[]` — each screen owns absolutely-positioned `components`.
  - `transitions[]` — `{from, to, event}` edges. Each screen *is* a state.
  - `initialScreen` — the start state.
  - `stateVariables` — runtime variables (e.g. `selectedId`).
- **Component** — `{id, type, props, events}` where `events.onClick`
  declares an `EventAction` (`navigate | saveRecord | deleteRecord | setVar`).
- **Scaffold** — `POST /api/models/{name}/scaffold` produces an App with
  list / new / show / edit screens already wired.

Bindings use simple tokens, evaluated at runtime, never `eval`'d:

| Token         | Source                                 |
|---------------|----------------------------------------|
| `$state.x`    | runtime state variables / form values  |
| `$record.x`   | the record selected for show/edit      |
| `$row.x`      | the table row that fired the event     |

Form inputs use `bind="form.fieldName"` to read/write into `state.form`.
A `saveRecord` action then POSTs `state.form` to `/api/records/{model}`.

## Run it

In two terminals:

```sh
# 1. Go API on :8080
cd server
go run . -addr :8080 -data ./data

# 2. React builder on :5173 (proxies /api → :8080)
cd ui
npm install
npm run dev
```

Open http://localhost:5173, click **Models** → add a `Post` model
(`title:string`, `body:text`, `published:bool`), then **Scaffold app**.
The new app loads in the builder; press **▶ Preview** to use it.

## DDD Domain Builder

Click **Domain (DDD)** in the top bar to enter a full-screen ER editor.

The domain document has three node kinds, each represented as a draggable
node on an SVG canvas:

| Kind            | Header colour | Purpose                                   |
|-----------------|---------------|-------------------------------------------|
| 《Value Object》 | blue          | Immutable composite types and **IDs**     |
| 《Entity》      | green         | Has identity (an Identifier VO)           |
| 《Aggregate》   | dashed purple | Consistency boundary, wraps its members   |

Edges:
- **Solid arrow** — Entity → Entity reference (`one` / `many`)
- **Dashed line** — Entity uses a Value Object (identifier or attribute)

Click **→ Generate DataModels** to flatten the domain into the regular
DataModels collection (which can then be scaffolded into Apps via the
existing flow):

- Each Entity becomes a DataModel.
- Identifier VOs collapse to their underlying primitive
  (`UserId{value:string}` → field `id: string`).
- A regular VO attribute is expanded inline using `attr_subfield`
  naming (`total: Money` with `Money{amount,currency}` →
  `total_amount`, `total_currency`).
- Entity references become `ref` fields pointing at the target name.

So the full flow is **DDD model → DataModels → scaffolded App**.

## API

| Method | Path                                   | Purpose                       |
|-------:|----------------------------------------|-------------------------------|
| GET    | `/api/health`                          | liveness                      |
| GET    | `/api/models`                          | list data models              |
| POST   | `/api/models`                          | upsert one                    |
| DELETE | `/api/models/{name}`                   | delete model + its records    |
| POST   | `/api/models/{name}/scaffold`          | generate App from model       |
| GET    | `/api/apps`                            | list apps                     |
| GET    | `/api/apps/{id}`                       | get one                       |
| POST   | `/api/apps`                            | upsert one                    |
| DELETE | `/api/apps/{id}`                       | delete                        |
| GET    | `/api/records/{model}`                 | list records                  |
| POST   | `/api/records/{model}`                 | upsert `{id, values}`         |
| DELETE | `/api/records/{model}/{id}`            | delete one                    |
| GET    | `/api/domains`                         | list DDD domains              |
| POST   | `/api/domains`                         | upsert a domain               |
| GET    | `/api/domains/{id}`                    | get one                       |
| DELETE | `/api/domains/{id}`                    | delete                        |
| POST   | `/api/domains/{id}/scaffold`           | flatten domain → DataModels   |

Storage is three JSON files under `-data` (`models.json`, `apps.json`,
`records.json`) so there is no DB to provision.

## Layout

```
server/
  main.go
  internal/
    storage/      # JSON-file repo for models, apps, records
    api/          # http.ServeMux routes + CORS middleware
    scaffold/     # DataModel → App generator
ui/
  src/
    types.ts                 # shared shapes
    api.ts                   # fetch wrapper
    App.tsx                  # builder shell (top bar + 3 panels)
    components/
      Palette.tsx            # left-rail component list
      Canvas.tsx             # drag/resize design surface
      Properties.tsx         # right-rail prop + event editor
      ScreensPanel.tsx       # state machine editor
      ModelEditor.tsx        # data-model CRUD modal
      Preview.tsx            # runtime that interprets the metadata
      renderComponent.tsx    # one renderer shared by canvas + preview
      DomainBuilder.tsx      # full-screen DDD editor
      ERDiagram.tsx          # SVG ER-diagram (VO/Entity/Aggregate)
```
