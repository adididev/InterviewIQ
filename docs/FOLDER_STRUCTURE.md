# Phase 3 — Folder Structure

Clean, layered architecture. Dependencies point **inward**: UI → services → agents → lib.
No business logic ever lives in a React component.

```
interviewiq/
├── docs/                        Architecture & design docs
├── prisma/
│   ├── schema.prisma            Data model (Phase 2)
│   └── seed.ts                  Demo user + seed data
├── docker-compose.yml           PostgreSQL 16 + pgvector
├── src/
│   ├── middleware.ts            Edge JWT guard for protected routes
│   │
│   ├── app/                     ── Next.js App Router (routes + pages) ──
│   │   ├── (marketing)/         Public landing page
│   │   ├── (auth)/              login / signup
│   │   ├── (app)/               Authenticated shell
│   │   │   ├── dashboard/
│   │   │   ├── resume/
│   │   │   ├── interview/[id]/  Live voice interview
│   │   │   ├── report/[id]/
│   │   │   ├── history/
│   │   │   └── profile/
│   │   ├── api/                 ── REST API (route handlers) ──
│   │   │   ├── auth/            register · login · logout · me
│   │   │   ├── resume/          upload · get
│   │   │   ├── interview/       start · turn · end · [id]
│   │   │   ├── report/[id]/
│   │   │   ├── history/
│   │   │   ├── dashboard/
│   │   │   ├── profile/
│   │   │   └── voice/           token (Deepgram) · tts (Cartesia)
│   │   ├── globals.css
│   │   └── layout.tsx
│   │
│   ├── components/              ── Presentation only (dumb components) ──
│   │   ├── ui/                  shadcn/ui primitives
│   │   ├── landing/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── interview/           mic button, waveform, timer, topic pill
│   │   ├── report/              radar, timeline, score cards
│   │   └── providers/           theme, toast, auth context
│   │
│   ├── services/                ── Business logic (framework-agnostic) ──
│   │   ├── auth.service.ts
│   │   ├── resume.service.ts
│   │   ├── interview.service.ts
│   │   ├── report.service.ts
│   │   └── analytics.service.ts
│   │
│   ├── agents/                  ── The conversation engine (LangGraph) ──
│   │   ├── graph.ts             StateGraph wiring the nodes
│   │   ├── state.ts             InterviewState annotation
│   │   ├── nodes/
│   │   │   ├── memory.node.ts       loads history + resume context
│   │   │   ├── evaluator.node.ts    scores the last answer (never talks)
│   │   │   ├── planner.node.ts      decides continue/follow-up/challenge/move/end
│   │   │   └── interviewer.node.ts  speaks (never scores)
│   │   └── prompts/             versioned system prompts per agent
│   │
│   ├── lib/                     ── Infrastructure adapters ──
│   │   ├── env.ts              validated environment (zod)
│   │   ├── db.ts              Prisma singleton
│   │   ├── utils.ts           cn() + shared UI helpers
│   │   ├── auth/               jwt (jose) · password (bcrypt) · session
│   │   ├── llm/                groq client + JSON-mode helpers
│   │   ├── embeddings/         fastembed (bge-small-en-v1.5)
│   │   ├── voice/              deepgram + cartesia server adapters
│   │   └── http.ts            api response helpers + error mapping
│   │
│   ├── hooks/                   ── Client React hooks ──
│   │   ├── useVoiceInterview.ts  orchestrates STT → engine → TTS
│   │   ├── useSpeechToText.ts    Deepgram + browser fallback
│   │   ├── useTextToSpeech.ts    Cartesia + browser fallback
│   │   └── useAuth.ts
│   │
│   ├── types/                   Shared domain types (single source of truth)
│   └── utils/                   Pure helpers (scoring math, formatting)
```

## Why this shape
- **`services/` is pure business logic** — callable from API routes today, from a
  queue/worker tomorrow. No `NextRequest` leaks in.
- **`agents/` is isolated** — the LangGraph engine has one entry (`runInterviewTurn`)
  and knows nothing about HTTP or React.
- **`lib/` holds every external boundary** (DB, LLM, voice, embeddings) behind a thin
  adapter, so providers can be swapped (that's exactly how the voice fallbacks work).
