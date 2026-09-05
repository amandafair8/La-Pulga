# La Pulga

Phone-first inventory and event management PWA backed by Supabase.

## Vercel deployment

1. Import this GitHub repository into Vercel.
2. Framework preset: Next.js.
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. Deploy.
5. In Supabase Authentication > URL Configuration, set the production Vercel URL as Site URL and add it to Redirect URLs.

## Supabase project

The production database/auth architecture already exists in Supabase. Do not run a second schema or create another Supabase project.
