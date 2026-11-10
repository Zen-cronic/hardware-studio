// Speech recognisers may write measurements as words: "six millimetres", "eight point five mil".
// The local parsers read digits and short units, so spoken requests are normalised first:
// "make this six millimetres thick" -> "make this 6 mm thick". Words that are not a
// measurement ("this one", "the two arms") are left alone.

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DIGIT: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const UNIT: Record<string, string> = {
  mm: "mm", millimetre: "mm", millimetres: "mm", millimeter: "mm", millimeters: "mm", mil: "mm", mils: "mm", mill: "mm", mills: "mm",
  cm: "cm", centimetre: "cm", centimetres: "cm", centimeter: "cm", centimeters: "cm",
};
// Length units after a number word make it a measurement. Kilos, newtons, degrees and plain
// counts ("at one end", "two kilos") stay as words, so the local rules never read them as millimetres.
const LENGTH = new Set([...Object.keys(UNIT), "inch", "inches"]);
// Between the sides of a size: "forty by twenty by thirty millimetres".
const BY = new Set(["by", "x"]);
// "this hole eight" means a size for the pointed hole, not hole number eight.
const DEICTIC = new Set(["this", "that", "the"]);

const bare = (token: string) => token.toLowerCase().replace(/^[^\w%]+|[^\w%]+$/g, "");

/** Reads a number starting at tokens[i]; returns its digits and the index after it. */
function readNumber(tokens: string[], i: number): { value: string; end: number; words: boolean } | null {
  let j = i, n: number | null = null, digits: string | null = null, words = false;
  const t = (k: number) => bare(tokens[k] || "");
  if (/^\d+(\.\d+)?$/.test(t(j))) { digits = t(j); j++; }
  else if (SMALL[t(j)] !== undefined) { n = SMALL[t(j)]; j++; words = true; }
  else if (TENS[t(j)] !== undefined) { n = TENS[t(j)]; j++; words = true; if (SMALL[t(j)] !== undefined && SMALL[t(j)] > 0 && SMALL[t(j)] < 10) { n += SMALL[t(j)]; j++; } }
  else if (t(j) === "point" && (DIGIT[t(j + 1)] !== undefined || /^\d+$/.test(t(j + 1)))) { n = 0; words = true; }
  else return null;
  if (n !== null && n > 0 && n < 10 && t(j) === "hundred") {
    n *= 100; j++;
    if (t(j) === "and" && (SMALL[t(j + 1)] !== undefined || TENS[t(j + 1)] !== undefined)) j++;
    if (TENS[t(j)] !== undefined) { n += TENS[t(j)]; j++; if (SMALL[t(j)] !== undefined && SMALL[t(j)] > 0 && SMALL[t(j)] < 10) { n += SMALL[t(j)]; j++; } }
    else if (SMALL[t(j)] !== undefined) { n += SMALL[t(j)]; j++; }
  }
  let whole = digits ?? String(n), decimals = "";
  if (t(j) === "point" && (DIGIT[t(j + 1)] !== undefined || /^\d+$/.test(t(j + 1)))) {
    j++; words = true;
    while (DIGIT[t(j)] !== undefined || /^\d+$/.test(t(j))) { decimals += DIGIT[t(j)] ?? t(j); j++; }
  } else if (t(j) === "and" && t(j + 1) === "a" && t(j + 2) === "half") { decimals = "5"; j += 3; words = true; }
  if (whole.includes(".") && decimals) return null;
  return { value: decimals ? `${whole}.${decimals}` : whole, end: j, words };
}

/** Whether the number ending at tokens[end] is a length: a length unit follows, directly or after "by"/"x" and more sides. */
function measured(tokens: string[], end: number): boolean {
  const after = bare(tokens[end] || "");
  if (LENGTH.has(after)) return true;
  if (!BY.has(after)) return false;
  const next = readNumber(tokens, end + 1);
  return !!next && measured(tokens, next.end);
}

/** "hole three" with no unit after it names a hole; "this hole eight" does not. */
function holeNumber(tokens: string[], i: number): boolean {
  const before = bare(tokens[i - 1] || ""), hole = before === "number" ? i - 2 : i - 1;
  return bare(tokens[hole] || "") === "hole" && !DEICTIC.has(bare(tokens[hole - 1] || ""));
}

/**
 * Digits for spoken measurements, and "mm"/"cm" for spoken millimetre and centimetre units.
 * Number words become digits only before a length unit ("six millimetres") or as a hole number
 * ("hole three"). Typed digits are kept exactly as written, with any sign, leading point or Ø.
 */
export function normalizeSpokenNumbers(text: string): string {
  // "twenty-five" reads as two words; a hyphen elsewhere is kept.
  const tokens = text.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/gi, "$1 $2").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const number = readNumber(tokens, i);
    if (number && (!number.words || measured(tokens, number.end) || holeNumber(tokens, i))) {
      const after = bare(tokens[number.end] || "");
      const trailing = (tokens[number.end - 1] || "").match(/[^\w%]+$/)?.[0] || "";
      // A typed number is kept as written: "-20", ".8", "Ø8" and "0.8" keep their sign, point and mark.
      if (!number.words && number.end === i + 1) out.push(tokens[i]);
      else out.push((tokens[i].match(/^[^\w%]+/)?.[0] || "") + number.value + trailing);
      i = number.end;
      // The unit right after a number becomes its short form, keeping its punctuation.
      const unit = UNIT[after];
      if (unit && !trailing) { out.push(unit + ((tokens[i] || "").match(/[^\w%]+$/)?.[0] || "")); i++; }
      continue;
    }
    out.push(tokens[i]);
    i++;
  }
  return out.join(" ");
}
