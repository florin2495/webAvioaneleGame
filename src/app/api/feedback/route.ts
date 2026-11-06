import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import pkg from "../../../../package.json";

// Table owned by the hub repo (florin2495/hailataticu-hub); this game only inserts.
const GAME_SLUG = "airplanes";

// POST /api/feedback - a player's note about a problem or an improvement.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    // Honeypot: bots fill the hidden field; pretend success without storing anything.
    if (typeof body.website === "string" && body.website.trim() !== "") return { ok: true };

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 1 || message.length > 1000) fail(400, "Mesajul trebuie să aibă 1-1000 de caractere.");
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    if (nickname.length > 40) fail(400, "Nickname-ul poate avea cel mult 40 de caractere.");

    const { error } = await db()
      .from("hub_feedback")
      .insert({
        game: GAME_SLUG,
        message,
        nickname: nickname || null,
        app_version: (process.env.NEXT_PUBLIC_APP_VERSION ?? pkg.version).slice(0, 20),
      });
    if (error) throw error;
    return { ok: true };
  });
}
