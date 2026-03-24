# Recompensapp

Proyecto listo para deploy como sitio estatico.

## Variables

Usa `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://gzptxigymwcvijejvbjm.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_nMh5ZL67YV2nkGod5DdHLw_YYaHKcvn
NEXT_PUBLIC_MP_PUBLIC_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Comandos

```bash
npm run build
npm run dev
```

## Deploy

- Vercel: importa la carpeta y deja `npm run build` como build command con `dist` como output.
- Netlify: `npm run build` y publish directory `dist`.
- Antes de usar la app con datos reales, ejecuta `recompensapp_supabase_schema.sql` en el SQL Editor de tu proyecto Supabase.
