# Avioanele

Jocul clasic de avioane, în doi, pe telefon. Încă doi prieteni pot intra ca spectatori, și în timpul jocului.
Același stil și aceeași arhitectură ca [Bingo](https://github.com/florin2495/webBingoGame): Next.js pe Vercel, Supabase pentru date și Realtime.

## Reguli

```
 ■
■■■
 ■
■■■
```

- Tabla e 10×10. Fiecare își ascunde avioanele (2–4, implicit 3; host-ul alege în lobby), rotite în orice direcție.
- Două avioane nu au voie să se atingă, nici pe colț.
- Pe rând, tragi într-o celulă de pe tabla adversarului: apă, lovit sau cap.
- Dacă nimerești un avion, mai tragi o dată, cât timp nimerești.
- Cap nimerit = avionul cade pe loc. Trăgătorul trebuie apoi să ghicească forma lui (încotro arată capul):
  ghicit = avionul apare pe tablă și mai trage; greșit = tura trece. Avionul rămâne doborât oricum.
- Ultimul avion doborât câștigă direct, fără ghicit.
- Nimic nu te oprește să tragi lângă un avion găsit. Doar celulele deja cunoscute sunt blocate.
- Sus e tabla ta (cu loviturile adversarului), jos e tabla adversarului, unde tragi.
- Spectatorii văd loviturile pe ambele table. Avioanele se văd abia la final, ca un spectator să nu-i poată sufla nimic unui jucător.
- Runda 1 o începe jucătorul 1, runda 2 jucătorul 2, și tot așa.

## Setup

1. În Supabase (același proiect ca Bingo, merge): **SQL Editor → New query**, lipești tot [`supabase/schema.sql`](supabase/schema.sql), Run.
   Tabelele au prefixul `airplanes_`, deci nu ating tabelele Bingo.
2. `.env.local` (vezi [`.env.example`](.env.example)), cu aceleași chei ca la Bingo.
3. `npm install`, apoi `npm run dev`.

## Deploy (Vercel)

1. Import repo-ul `florin2495/webAvioaneleGame` în Vercel (framework: Next.js, setările implicite).
2. **Settings → Environment Variables**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Fără domeniu propriu: jocul e servit la `games.hailatat.icu/airplanes` (`basePath: "/airplanes"`), prin rewrite din hub (`florin2495/hailataticu-hub`) către `web-avioanele-game.vercel.app/airplanes`.

## Teste

```bash
npm test
npx tsc --noEmit
npx eslint src
npx next build
```

Detalii tehnice: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
