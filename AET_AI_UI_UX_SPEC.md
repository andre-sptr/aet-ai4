# AET AI — Modern Hybrid Workspace

## Design decision
- Direction: Modern Hybrid Workspace.
- Theme: Light mode only.
- Product identity: retain AET AI wordmark and blue/navy identity.
- Reference roles: ChatGPT for workspace/navigation conventions, Claude for reading comfort and open assistant responses, Gemini for composer and capability controls.
- Implementation boundary: presentation and local interaction only. Preserve API payloads, stream protocol, persona identifiers, effort values, attachment extraction, localStorage schema, and existing conversation operations.

## Product experience goals
1. Make the chat feel like a focused AI workspace rather than a generic form.
2. Keep navigation and conversation history easy to scan.
3. Make long AI answers comfortable to read and inspect.
4. Keep the composer discoverable, compact, and usable with keyboard or touch.
5. Make the same experience work on desktop, tablet, and mobile without hiding core actions.

## Information architecture

### Desktop shell
- Left navigation rail: 276px expanded; 76px collapsed.
- Main workspace: flexible remaining width, full viewport height.
- Topbar: persona identity at left; new chat, history, rename, and delete actions at right.
- Conversation canvas: centered reading column, maximum width 860px.
- Composer: centered, maximum width 800px, anchored at the bottom of the workspace.

### Sidebar content order
1. AET AI brand and collapse control.
2. Primary “Percakapan baru” action.
3. Active workspace/persona identity.
4. Conversation search.
5. History grouped into “Hari ini”, “Kemarin”, and “Sebelumnya”.
6. Links to Beranda and Berita AET, plus an explicit local-storage note.

### Mobile shell
- Sidebar becomes a left-side drawer, opened by a menu button in the topbar.
- Drawer closes via close button, backdrop, conversation selection, or Escape.
- Main chat and composer remain full-width; the desktop collapse control is hidden.

## Visual system

| Role | Value |
|---|---|
| Primary blue | `#2563EB` |
| Strong blue | `#1D4ED8` |
| Deep navy / primary text | `#14243D` |
| Secondary text | `#718198` |
| Sidebar surface | `#F7F9FC` |
| Main surface | `#FFFFFF` |
| Border | `#E7EDF5` |
| Selected surface | `#E9F0FF` |
| Typography | Existing local Plus Jakarta Sans variable |
| Icon system | Existing Lucide React dependency |

Use restrained blue for active navigation, primary actions, focus, and assistant identity. Keep neutral surfaces white and cool gray. No dark theme, gradients, glass effects, or decorative background art.

## Component specifications

### Sidebar
- Brand remains a home action.
- New conversation is the single prominent navigation action.
- Active persona is a selected workspace row with a distinct icon container.
- Search is an icon-led input with a visible focus state.
- History entries use compact text rows, active-state marker, ellipsis-safe titles, and date grouping.
- Collapsed desktop sidebar preserves the new-chat affordance and active workspace marker.
- Local-only persistence is stated explicitly to avoid implying cloud sync.

### Topbar
- Persona icon, persona title, and a restrained AET AI descriptor.
- New conversation, history, rename, and delete remain available.
- Desktop sidebar collapse control lives in the topbar as well as the expanded rail.
- Mobile exposes a menu control and keeps the most important conversation actions reachable.

### Empty state
- Persona-specific headline remains factual and is not replaced with generic marketing copy.
- Small Sparkles mark establishes AI identity without a large hero illustration.
- Three existing prompt suggestions remain actionable and preserve their original text.
- Greeting sits below a subtle divider.

### Messages
- User messages are right-aligned, softly surfaced, and visually distinct from assistant output.
- Assistant responses remain open-layout (not enclosed in a large bubble) for reading comfort.
- Replace initial-letter avatars with consistent user and assistant icons.
- Preserve Markdown, math, tables, code blocks, attachments, citations/sources, incomplete-state notices, copy, and edit controls.

### Composer
- Anchored at bottom with a centered maximum width.
- Rounded but restrained surface, clear focus ring, and multiline text input.
- Preserve file attachment, camera capture, keyboard shortcut, Fast/Normal/Think selector, send, and stop behavior.
- Keep upload, generation status, errors, retry, edit mode, and attachment previews visible around the composer.
- Preserve the existing Enter-to-send and Shift+Enter-newline behavior.

### Dialogs
- Preserve existing history, rename, delete-confirmation, and image-preview dialogs.
- Keep keyboard focus handling and clear action hierarchy.

## Rich response presentation
- Assistant output uses an open reading layout with a restrained author label and a readable 14px desktop measure.
- Markdown hierarchy differentiates H1–H4, paragraphs, lists, emphasis, blockquotes, links, dividers, and inline code.
- GitHub Flavored Markdown tables are placed in a keyboard-focusable horizontal scroll region with clear header, row, and hover states.
- Task-list checkboxes remain display-only and disabled; rendering must not create editable task state.
- Math uses KaTeX with horizontal overflow containment. Mermaid diagrams retain their source disclosure and zoom behavior.
- Fenced code blocks show the language, line numbers for longer snippets, copy feedback, and a collapse affordance for snippets longer than 18 lines.
- Tool-provided sources are rendered as a numbered reference list with title, hostname, and a safe external-link action. Existing source payloads remain `{ title, url }`; no citation metadata is fabricated.
- External links continue to use the existing safe URL allowlist and open with `noopener noreferrer`.

## Responsive behavior
- Above 1100px: full desktop shell and expanded sidebar.
- 761–1100px: narrower sidebar and reduced reading gutters.
- 760px and below: drawer navigation, one-column prompt suggestions, compact topbar, safe-area-aware composer.
- 390px and below: compress secondary topbar labels and composer controls without removing core actions.

## Interaction and state requirements
- Sidebar collapse state is presentation-only and does not alter conversation data.
- Mobile drawer state is ephemeral and closes on Escape, backdrop, close button, new conversation, or conversation selection.
- Conversation grouping derives from each conversation's existing `updatedAt` value; no storage migration is required.
- History selection, rename, delete, and creation continue to use existing conversation helpers.
- Streaming and request cancellation remain unchanged.

## Explicit non-goals for this UI pass
- No backend/API changes.
- No cloud conversation sync or account-level history claims.
- No new model/provider settings.
- No new share-link capability.
- No changes to persona IDs, model effort values, attachment limits, or localStorage version.
- No dark mode.

## Verification checklist
- [ ] TypeScript check.
- [ ] Existing chat and conversation-history tests.
- [ ] Desktop view at 1440px and tablet view at 1024px.
- [ ] Mobile drawer and composer at 390px and 320px.
- [ ] Keyboard: Tab, Enter, Shift+Enter, Escape.
- [ ] Markdown headings, GFM tables/task lists, KaTeX, Mermaid, safe links, source references, and code copy/collapse.
- [ ] Existing upload, streaming, stop, retry, edit, rename, delete, and history persistence.
