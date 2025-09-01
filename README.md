# RA Labs Event Manager (NestJS)

Server-side event management API built with NestJS and TypeScript.

## Technology

- Node.js + TypeScript
- NestJS (modular architecture, dependency injection)
- PostgreSQL (psql) + TypeORM
- Docker (for running local PostgreSQL DB)
- Jest (unit tests) + Supertest for HTTP e2e tests

## Run locally

- Prerequisites: Node.js 18+, Docker
- Install dependencies: `npm install`
- Start the dev server: `npm run dev`
- App runs at: http://localhost:3000 (unless configured otherwise)
- Stop DB when done: `npm run db:down`

## Run Tests
- Run unit tests: `npm run test:unit`
- Run e2e tests: `npm run test:e2e`
- Run both: -`npm run test`
- Coverage: `npm run test:cov`
