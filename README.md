# KABi Performance Management System v67.21.0

## Deployment — Pure Static (Zero Server Dependencies)

KABi is a **single self-contained HTML file**. All data lives in localStorage.
No database, no serverless functions, no blob storage, no API routes needed.

### Vercel (Recommended)
1. Create a new Vercel project
2. Upload this folder (index.html + vercel.json)
3. Deploy — that's it

The `vercel.json` ensures:
- No serverless functions are created
- No Blob storage is used
- No Edge functions
- Zero "Advanced Operations" usage
- Only static file serving (unlimited on free tier)

### Alternative: GitHub Pages
1. Push to a GitHub repo
2. Enable GitHub Pages in Settings
3. Set source to main branch / root

### Alternative: Local
Just open `index.html` in any browser. Everything works offline.

### Data Persistence
All data stored in browser localStorage:
- Employee evaluations
- KPI submissions
- Passwords
- Settings
- AI API key (if configured)

⚠️ localStorage is per-browser, per-device. Clearing browser data resets everything.
