<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1sPWVSUEOyDJEE2bLAEA-lOrSB9yQQqiP

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set keys in `.env.local`:
   `VITE_NVIDIA_API_KEY=your_nvidia_api_key`
   `VITE_SUPABASE_URL=https://zcuvlpgtodiropcbneox.supabase.co`
   `VITE_SUPABASE_ANON_KEY=your_supabase_anon_key`
3. Create this table in Supabase SQL editor:
   ```sql
   create table if not exists public.portfolio_state (
     id integer primary key,
     investments jsonb not null default '[]'::jsonb,
     profile jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );
   ```
4. Run the app:
   `npm run dev`
