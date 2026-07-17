const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32Secret(encoded: string): string {
	let buffer = 0;
	let bitCount = 0;
	const bytes: number[] = [];

	for (const character of encoded.replace(/=+$/, "").toUpperCase()) {
		const value = BASE32_ALPHABET.indexOf(character);
		if (value < 0) throw new Error("Invalid Base32 TOTP secret");
		buffer = (buffer << 5) | value;
		bitCount += 5;
		while (bitCount >= 8) {
			bitCount -= 8;
			bytes.push((buffer >> bitCount) & 0xff);
			buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
		}
	}

	return new TextDecoder().decode(Uint8Array.from(bytes));
}

export async function generateTotpCode(
	secret: string,
	now = Date.now(),
): Promise<string> {
	const counter = Math.floor(now / 1000 / 30);
	const counterBytes = new ArrayBuffer(8);
	const counterView = new DataView(counterBytes);
	counterView.setUint32(0, Math.floor(counter / 2 ** 32));
	counterView.setUint32(4, counter >>> 0);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const digest = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, counterBytes),
	);
	const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
	const binary =
		(((digest[offset] ?? 0) & 0x7f) << 24) |
		((digest[offset + 1] ?? 0) << 16) |
		((digest[offset + 2] ?? 0) << 8) |
		(digest[offset + 3] ?? 0);
	return String(binary % 1_000_000).padStart(6, "0");
}
