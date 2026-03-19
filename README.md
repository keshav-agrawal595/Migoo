# 🎬 Migoo — AI-Powered Educational Video Course Generator

> Automatically generate structured educational video courses with AI-driven layouts, narration, slides, and captions.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Clerk](https://img.shields.io/badge/Auth-Clerk-purple?logo=clerk)](https://clerk.dev/)
[![Drizzle](https://img.shields.io/badge/ORM-Drizzle-green)](https://orm.drizzle.team/)
[![Tested with Vitest](https://img.shields.io/badge/tested%20with-vitest-yellow?logo=vitest)](https://vitest.dev/)

## 📖 Overview

Migoo is a full-stack AI-powered platform that automates the creation of educational video courses. Users provide a topic, and the platform:

1. **Generates course structure** — AI creates a multi-chapter course layout with subtopics
2. **Creates slide content** — Each chapter gets rich HTML presentation slides
3. **Produces narration** — Text-to-speech generates natural audio for each slide
4. **Adds captions** — Speech-to-text creates synchronized caption data
5. **Generates images** — AI creates relevant visual assets for slides
6. **Renders videos** — Compiles everything into video format using Remotion

Additionally, Migoo supports **AI Short Video Generation** for creating viral short-form content.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ Auth UI  │  │ Course Pages │  │ Short Video Generator      │ │
│  │ (Clerk)  │  │ Create/View  │  │ Niche→Script→Audio→Video   │ │
│  └──────────┘  └──────────────┘  └────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                    API Layer (Next.js Route Handlers)             │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ /api/course     │  │ /api/generate-*  │  │ /api/user      │  │
│  │ CRUD operations │  │ AI generation    │  │ Auth + Profile │  │
│  └────────────────┘  └──────────────────┘  └────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Security: Zod validation · Rate limiting · Auth guards     │ │
│  │          Security headers · CORS · Typed responses         │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                     Background Jobs (Inngest)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Short Video Pipeline: Script→Voice→Captions→Images→Render │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                     Data & External Services                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Neon DB  │  │ Vercel   │  │ Sarvam   │  │ OpenRouter /  │  │
│  │ (Postgres)│  │ Blob     │  │ TTS/STT  │  │ Gemini AI     │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────────────────────────────────────────┐ │
│  │ RunwayML │  │ Leonardo AI (fallback image generation)      │ │
│  └──────────┘  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## ✨ Features

### Course Generation
- **AI Course Layout** — Generates 8-15 chapter course structures with subtopics
- **Slide Generation** — Rich HTML slides with embedded images and narration
- **Text-to-Speech** — Natural narration via Sarvam AI (multi-language support)
- **Captions** — Word-level timestamp captions for accessibility
- **Thumbnail Generation** — Auto-generated course thumbnails

### Short Video Generation
- **7-Step Pipeline** — Script → Voice → Captions → Images → Video via Inngest
- **Multi-Provider Images** — RunwayML with Leonardo AI fallback
- **Customizable** — Voice, music, caption style, video style, and platform targeting
- **Force Stop** — Cancel generation mid-pipeline

### Security & Quality
- **Authentication** — Clerk-based auth with protected routes
- **Input Validation** — Zod schemas on all API endpoints
- **Rate Limiting** — Per-IP rate limiting on API routes (60 req/min)
- **Security Headers** — HSTS, CSP, X-Frame-Options, XSS protection
- **Type Safety** — Full TypeScript with typed API responses

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5 |
| **Auth** | Clerk |
| **Database** | Neon (Serverless PostgreSQL) |
| **ORM** | Drizzle ORM |
| **Styling** | Tailwind CSS v4 |
| **UI Components** | Radix UI, shadcn/ui |
| **AI / LLM** | OpenRouter, Google Gemini |
| **TTS / STT** | Sarvam AI |
| **Image Gen** | RunwayML, Leonardo AI |
| **Video** | Remotion |
| **Storage** | Vercel Blob |
| **Background Jobs** | Inngest |
| **Testing** | Vitest |
| **Validation** | Zod |

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- Accounts for: Clerk, Neon, Sarvam AI, OpenRouter

### Installation

```bash
# Clone the repository
git clone https://github.com/keshav-agrawal595/Migoo.git
cd Migoo

# Install dependencies
npm install --legacy-peer-deps

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys (see Environment Variables section)

# Push database schema
npx drizzle-kit push

# Start development server
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk publishable key |
| `CLERK_SECRET_KEY` | ✅ | Clerk secret key |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key for LLM access |
| `SARVAM_API_KEY` | ✅ | Sarvam AI key for TTS/STT |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob storage token |
| `RUNWAY_API_KEY` | ✅ | RunwayML image generation |
| `LEONARDO_API_KEY` | ✅ | Leonardo AI (fallback images) |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest webhook signing key |

## 🗄️ Database Schema

The application uses 6 tables managed by Drizzle ORM:

| Table | Purpose |
|-------|---------|
| `users` | User profiles (email, name, credits) |
| `courses` | Course metadata and AI-generated layouts |
| `course_images` | Generated images for course slides |
| `chapter_content_slides` | Slide content with audio, captions, HTML |
| `short_video_series` | Short video series configuration |
| `short_video_assets` | Generated video assets (script, audio, images) |

Run migrations:
```bash
npx drizzle-kit push
npx drizzle-kit studio  # Visual DB browser
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

Test suites cover:
- **Validation schemas** — Input validation for all API endpoints
- **Rate limiting** — Window-based rate limit enforcement
- **API helpers** — Response formatting and security headers
- **Environment config** — Env variable validation

## 📡 API Reference

See [docs/API.md](docs/API.md) for complete API documentation.

### Quick Reference

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/user` | POST | ✅ | Create/fetch user profile |
| `/api/course` | GET | ✅ | List courses or get specific course |
| `/api/generate-course-layout` | POST | ✅ | Generate AI course structure |
| `/api/generate-video-content` | POST | ✅ | Generate slides + audio + captions |
| `/api/create-short-series` | POST | ✅ | Create short video series |
| `/api/generate-thumbnail` | POST | ✅ | Generate course thumbnail |

## 📦 Project Structure

```
├── app/
│   ├── api/                    # API route handlers
│   │   ├── course/             # Course CRUD
│   │   ├── generate-course-layout/  # AI course generation
│   │   ├── generate-video-content/  # Slide + audio generation
│   │   ├── create-short-series/     # Short video creation
│   │   └── user/               # User management
│   ├── (auth)/                 # Auth pages (Clerk)
│   ├── (routes)/               # App pages
│   └── short-generator/        # Short video UI
├── config/
│   ├── schema.tsx              # Drizzle database schema
│   ├── db.tsx                  # Database connection
│   ├── openrouter.ts           # OpenRouter AI client
│   ├── gemini.ts               # Gemini AI client
│   └── sarvam.ts               # Sarvam TTS/STT client
├── lib/
│   ├── api-helpers.ts          # Typed API responses + security headers
│   ├── validations.ts          # Zod validation schemas
│   ├── rate-limit.ts           # Rate limiting middleware
│   ├── env.ts                  # Environment validation
│   ├── runway.ts               # RunwayML integration
│   ├── leonardo.ts             # Leonardo AI integration
│   └── blob.ts                 # Vercel Blob utilities
├── inngest/                    # Background job definitions
├── components/                 # React UI components
├── remotion/                   # Video rendering config
├── __tests__/                  # Test suites
├── middleware.ts               # Auth + rate limiting middleware
└── docs/                       # Documentation
```

## 🚢 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables
4. Deploy

### Environment Setup
```bash
# Production build
npm run build

# Start production server
npm start
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

This project is part of an educational assessment.

---

Built with ❤️ by **Team T4** — Parmeet Singh
