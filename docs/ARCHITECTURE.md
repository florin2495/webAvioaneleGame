# Arhitectură

Copiată din Bingo: Route Handlers pe Vercel cu cheia service role, Supabase Postgres cu RLS fără policies,
Realtime Broadcast doar ca semnal de „refresh”, identitate prin token aleator în `localStorage`.

## Date (prefix `airplanes_`, ca să stea în același proiect Supabase cu Bingo)

| Tabel | Ce ține |
| --- | --- |
| `airplanes_rooms` | camera: cod, nume, parolă (scrypt), `planes_count`, `status`, `round`, host, câștigător |
| `airplanes_players` | membrii: `seat` 1/2 = jucători, `null` = spectator (max 4 membri). Index unic pe `(room_id, seat)` |
| `airplanes_boards` | avioanele ascunse ale unui jucător într-o rundă: `[{ head, dir }]` |
| `airplanes_moves` | lista ordonată a loviturilor rundei (`kind` rămâne `shot`; `guess` e istoric, nemaifolosit) |

## Decizii

1. **Tura nu e stocată, se recalculează.** `replay()` din [`src/lib/game.ts`](../src/lib/game.ts) parcurge `airplanes_moves`
   și scoate a cui e tura, câte avioane sunt doborâte și cine a câștigat.
   Orice mutare se inserează cu `seq = nr. mutări + 1`, iar `unique (room_id, round, seq)` face ca din două mutări
   concurente calculate din aceeași stare să treacă una singură.
2. **Avioanele adversarului nu pleacă niciodată spre client în timpul jocului**, nici la spectatori. Rezultatul
   loviturii îl calculează serverul. La final, `reveal` trimite ambele table tuturor.
3. **Notițele sunt doar pe client** (`src/lib/notes.ts`, localStorage): X-uri și avioane presupuse pe tabla adversarului.
   Nu ajung la server, deci nu pot fi folosite ca să afli ceva; la final clientul marchează cu X locurile notate care erau goale.
4. **Start automat**: când ambii jucători au dat „gata”, jocul pornește. Fiecare request de „ready” citește
   jucătorii după propria scriere, deci din doi jucători care dau ready simultan, cel puțin unul vede ambele ready.
5. **Plecare**: dacă un jucător pleacă (sau e scos) în timpul jocului, celălalt câștigă. Spectatorii vin și pleacă liber.
   În lobby, un spectator poate lua un loc liber (`/sit`).
6. **Expirare leneșă**: lobby/terminat după 10 minute fără nimeni cu pagina deschisă, joc în desfășurare după 30 de minute.
   Fiecare pagină deschisă face polling la `/state` (15 s), care împrospătează `last_activity_at`.

## API (toate sub `/api/rooms`)

| Metodă | Rută | Cine | Ce face |
| --- | --- | --- | --- |
| GET | `/api/rooms` | oricine | camerele deschise (lobby + în joc, pentru spectatori) |
| POST | `/api/rooms` | oricine | creează camera; creatorul e host și jucătorul 1 |
| POST | `/[code]/join` | oricine | loc liber în lobby, altfel spectator (`spectator: true` forțează) |
| GET | `/[code]/state` | membru | starea camerei + avioanele proprii + toate mutările |
| POST | `/[code]/board` | jucător, lobby, ne-gata | `{ planes }` sau `{ generate: true }` |
| POST | `/[code]/ready` | jucător, lobby | `{ ready }`; pornește jocul când ambii sunt gata |
| POST | `/[code]/settings` | host, lobby | `{ planesCount }`; resetează tablele și „gata” |
| POST | `/[code]/sit` | spectator, lobby | ia un loc liber |
| POST | `/[code]/shoot` | jucătorul la tură | `{ cell }` 0–99 |
| POST | `/[code]/new-round` | host, terminat | rundă nouă, înapoi în lobby |
| POST | `/[code]/leave` | membru | pleacă |
| POST | `/[code]/kick` | host | scoate un membru |
