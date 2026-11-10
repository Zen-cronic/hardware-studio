import { describe, expect, it } from "vitest";
import { normalizeSpokenNumbers as n } from "../src/shared/spoken-numbers";

describe("spoken measurements", () => {
  it("turns number words and unit words into digits and short units", () => {
    expect(n("make this six millimetres thick")).toBe("make this 6 mm thick");
    expect(n("Make the hole eight millimeters")).toBe("Make the hole 8 mm");
    expect(n("make these arms six mil thick")).toBe("make these arms 6 mm thick");
    expect(n("make it twelve point five millimetres wide")).toBe("make it 12.5 mm wide");
    expect(n("point five millimetres thicker")).toBe("0.5 mm thicker");
    expect(n("six and a half millimetres")).toBe("6.5 mm");
    expect(n("twenty-four millimeters long")).toBe("24 mm long");
    expect(n("two hundred and forty millimetres wide")).toBe("240 mm wide");
    expect(n("make the base three centimetres taller")).toBe("make the base 3 cm taller");
    expect(n("set it to twenty")).toBe("set it to 20");
    expect(n("make hole three bigger")).toBe("make hole 3 bigger");
  });

  it("keeps digits, keeps punctuation, and normalises unit words after digits", () => {
    expect(n("make this 6 millimetres thick.")).toBe("make this 6 mm thick.");
    expect(n("Make this 6 mm thick")).toBe("Make this 6 mm thick");
    expect(n("make it six millimetres.")).toBe("make it 6 mm.");
    expect(n("6 point 5 mm")).toBe("6.5 mm");
    expect(n("make this 40 x 20 x 30 mm")).toBe("make this 40 x 20 x 30 mm");
  });

  it("leaves words that are not measurements", () => {
    expect(n("this one")).toBe("this one");
    expect(n("the left one")).toBe("the left one");
    expect(n("make one of the arms stiffer")).toBe("make one of the arms stiffer");
    expect(n("make the two front arms stiffer")).toBe("make the two front arms stiffer");
    expect(n("Make room for a bigger camera")).toBe("Make room for a bigger camera");
    expect(n("make the mil spec part")).toBe("make the mil spec part");
  });
});
