# HTTP API

The browser calls the separate API at `NEXT_PUBLIC_API_BASE_URL`. JSON success bodies are returned directly; errors use `{ "error": { "code": "…", "message": "…" } }` with an appropriate HTTP status. Unexpected internal details and credentials are not returned. Use `credentials: 'include'` for session requests and an exact allowed `Origin` for mutations.

## Health and sessions

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /health` | — | Service health. |
| `POST /v1/auth/login` | `{username,password}` | `{user:{id,username}}` and signed session cookie. |
| `GET /v1/auth/me` | Session cookie | `{user:{id,username}}`; unauthenticated requests receive 401. |
| `POST /v1/auth/logout` | Session cookie | Session is revoked and cookie cleared. |

Administrators are created through `npm run admin:create`, not an unauthenticated HTTP registration route. Passwords are hashed with scrypt. Authorization is enforced by the API on every protected operation.

## Public content and CMS

| Method and path | Behavior |
| --- | --- |
| `GET /v1/news` | Array of published news records only. |
| `GET /v1/news/:slug` | Current published article; deleted/unpublished records return 404. |
| `GET /v1/events` | Array of public published events. |
| `GET /v1/events/:id` | Current public event by its stable ID. |
| `GET /v1/team` | Team members ordered by display order. |
| `GET /v1/admin/news`, `/events`, `/team` | Authenticated arrays, including drafts. |
| `POST /v1/admin/news`, `/events`, `/team` | Authenticated creation using the corresponding validated content fields. |
| `PATCH /v1/admin/:collection/:id` | Authenticated partial edit; `published` controls news/event visibility, and team `order` controls ordering. |
| `DELETE /v1/admin/:collection/:id` | Authenticated deletion. |

News has `id,title,slug,summary,content,imageUrl,published,createdAt,updatedAt`. Events have `id,title,description,location,startDate,endDate,imageUrl,published,createdAt,updatedAt`. Team members have `id,name,position,bio,photoUrl,order,socials,createdAt,updatedAt`. Nullable text/image/date fields are represented as `null`; `socials` is a string-to-URL object or `null`. Timestamps are ISO UTC strings. Article and event body text uses Markdown, not trusted HTML.

Changing static detail route membership requires a frontend rebuild. CMS operations do not pretend that a new static file already exists. An optional configured backend rebuild hook may request a deployment.

## Attachments and image uploads

`POST /v1/attachments/extract` receives raw bytes with the actual `Content-Type` and an encoded `x-file-name` header. It returns `{attachment:{id,name,mimeType,size,text?,dataUrl?}}`. The API validates actual bytes/MIME agreement, size, document format, and extracted text limits; malformed/unsupported content is rejected. The browser can pass bounded extracted text and validated image data with the conversation. Raw image base64 is not retained in local history.

`POST /v1/uploads` receives raw PNG, JPEG, or WebP bytes with `Content-Type` and `x-file-name`, and requires an administrator session and allowed origin. It returns `{url}` for configured persistent object storage. Missing storage configuration returns unavailable; the API does not pretend an ephemeral file is permanent storage.

## Chat streaming

`POST /v1/chat` accepts:

```json
{
  "persona": "daily",
  "effort": "normal",
  "messages": [{"role": "user", "content": "Bantu saya memahami rangkaian ini."}]
}
```

`persona` is `daily`, `report`, or `coding`; `effort` is `fast`, `normal`, or `think`. Messages may include validated attachment metadata/content. Normal requests cannot choose a provider URL, API key, or arbitrary model ID. The backend classifies the task and selects a compatible configured model/strategy adaptively.

The response is `text/event-stream`. Each frame has an `event:` name and JSON `data:`:

| Event | Data and meaning |
| --- | --- |
| `status` | `{message}` describes a step actually taking place. |
| `metadata` | Public model/strategy metadata; no private reasoning traces. |
| `tool` | Bounded tool activity/result summary. |
| `sources` | `{sources:[{id,title,url}]}` for actual source evidence. |
| `delta` | `{text}` appends answer text. |
| `done` | Completion marker including `status:"complete"`; only this makes the answer complete. |
| `cancelled` | Generation was cancelled; partial text remains incomplete. |
| `error` | Safe `{code,message}`; partial text is not promoted to completion. |

Disconnecting/aborting the browser request cancels upstream work where supported. Requests have bounded time, concurrency, context, output, tool calls, and orchestration steps. Fast minimizes unnecessary work; Normal adds justified tools/checks; Think can choose stronger compatible candidates and bounded planning/verification for complex tasks. No hidden scratchpad or chain of thought is sent to the browser. Tool-derived evidence is distinguished from generated explanation; unavailable search/provider configuration is reported honestly.

## Manual model test

`POST /v1/admin/ai/model-test` requires an administrator session, an allowed mutation origin, and `{modelId,prompt}`. It runs only after the operator explicitly presses **Test**, using the configured server-side Sumopod endpoint/key. It returns `{response,elapsedMs}` or a safe provider error, including elapsed time where available. The model ID is validated but is not subject to a separate model-enable workflow; the provider may reject unsupported account IDs. Keys and provider URLs cannot be supplied in this request.

Authentication, chat, uploads, and other sensitive actions are rate limited. Automated tests use mocked providers and never trigger live model tests.
