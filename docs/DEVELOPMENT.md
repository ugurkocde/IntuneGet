# Development Guide

This guide covers setting up a local development environment for IntuneGet.

## Prerequisites

- Node.js 20 or later
- npm, pnpm, or yarn
- Git
- A code editor (VS Code recommended)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/ugurkocde/IntuneGet-Website.git
cd IntuneGet-Website

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Setup

### Minimum Configuration

For basic development, you need:

```env
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Azure AD (required for auth)
NEXT_PUBLIC_AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret

# Application URL
NEXT_PUBLIC_URL=http://localhost:3000
```

### Development-Specific Settings

```env
# Skip pipeline for faster iteration
# GITHUB_PAT=  # Leave empty to disable pipeline

# Password protect during development
SITE_PASSWORD=dev123
```

### Using a Shared Development Database

If your team has a shared development Supabase instance:

1. Get credentials from your team lead
2. Use a unique `user_id` prefix in testing to avoid conflicts

## Project Structure

```
IntuneGet-Website/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── dashboard/         # Main application
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   └── ...               # Feature components
├── contexts/              # React contexts
├── hooks/                 # Custom React hooks
├── lib/                   # Utility functions
│   ├── supabase/         # Supabase client
│   └── ...
├── public/               # Static assets
├── supabase/             # Supabase migrations
│   └── migrations/
├── docs/                 # Documentation
└── .github/              # GitHub Actions
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Code Style

### TypeScript

- Use TypeScript strict mode
- Define types for all props and state
- Avoid `any` type

```typescript
// Good
interface DeploymentProps {
  appId: string;
  tenantId: string;
}

// Avoid
function deploy(props: any) { ... }
```

### Components

- Use functional components with hooks
- Keep components focused and small
- Extract reusable logic to custom hooks

```typescript
// Good - focused component
function DeployButton({ appId, onDeploy }: DeployButtonProps) {
  return (
    <Button onClick={() => onDeploy(appId)}>
      Deploy
    </Button>
  );
}

// Avoid - doing too much
function AppCard({ app }) {
  // Don't include data fetching, complex state, and rendering all in one
}
```

### File Naming

- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts`
- API routes: `route.ts` (Next.js convention)

## Testing Locally

### Without Azure AD

For UI development without authentication:

1. Comment out auth checks temporarily
2. Use mock data
3. Remember to restore before committing

### Without GitHub Actions

To test deployment UI without the pipeline:

1. Create mock deployment records in Supabase
2. Update status manually to simulate pipeline progress
3. Use Supabase Studio for quick edits

### With Full Stack

1. Set up all environment variables
2. Create an Azure AD app registration (use localhost redirect)
3. Fork the repo for GitHub Actions
4. Test the complete flow

## Debugging

### VS Code Configuration

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug",
      "type": "node-terminal",
      "request": "launch",
      "command": "npm run dev"
    }
  ]
}
```

### Common Issues

**"Module not found" errors:**
```bash
# Clear cache and reinstall
rm -rf node_modules .next
npm install
```

**TypeScript errors after pulling:**
```bash
# Regenerate types
npm run build
```

**Supabase connection issues:**
- Check `.env.local` has correct values
- Verify project isn't paused
- Check network connectivity

## Making Changes

### Adding a New Component

1. Create component file in `components/`
2. Export from component
3. Import where needed
4. Add to any required providers

### Adding an API Route

1. Create folder in `app/api/`
2. Create `route.ts` with handlers
3. Use proper HTTP methods
4. Handle errors appropriately

```typescript
// app/api/example/route.ts
export async function GET(request: Request) {
  try {
    // ... implementation
    return Response.json({ data });
  } catch (error) {
    return Response.json({ error: 'Failed' }, { status: 500 });
  }
}
```

### Database Changes

1. Create a new migration file in `supabase/migrations/`
2. Use descriptive name: `20240115_add_column_name.sql`
3. Test locally
4. Submit with your PR

## Pull Request Guidelines

1. Create a feature branch
2. Make focused, incremental changes
3. Write clear commit messages
4. Update documentation if needed
5. Ensure `npm run lint` passes
6. Ensure `npm run build` succeeds
7. Submit PR with description of changes

## Getting Help

- Check existing [GitHub Issues](https://github.com/ugurkocde/IntuneGet-Website/issues)
- Review documentation in `/docs`
- Ask in GitHub Discussions
