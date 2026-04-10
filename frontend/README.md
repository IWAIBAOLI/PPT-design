# PPT Factory Frontend

This is the Next.js frontend for the PPT Factory workflow.

## Storage Modes

The app now supports two storage modes:

- Local mode (default): no Supabase configuration required, but users must choose a writable project save folder before they can start generating files. Projects, pipeline history, and generated file metadata are stored under `<your-project-folder>/.local-store/`.
- Supabase mode (optional): enabled automatically when both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.

## Environment Variables

Copy `frontend/.env.local.example` to `frontend/.env.local` if you want to add optional configuration.

Optional variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `USE_SUPABASE_STORAGE=true`
- `ANTHROPIC_API_KEY`

If `USE_SUPABASE_STORAGE` is not set to `true`, the app runs in local storage mode and the UI will require a project folder setup step even if Supabase variables exist locally.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Validation

```bash
npx next build --webpack
```

Webpack build is currently the most reliable validation path in this repo.
