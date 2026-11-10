import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three";
import { projectBox, projectParts, projectPoint } from "../src/lib/projection";
import { replyLines, shortSentences, speakable } from "../src/lib/voiceAgent";

function camera() {
  const c = new PerspectiveCamera(50, 2, 0.1, 5000);
  c.position.set(0, 0, 400); c.lookAt(0, 0, 0); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
}

describe("screen projection for the assistant circle", () => {
  it("maps the view centre to the canvas centre and keeps right/up on screen right/up", () => {
    const c = camera();
    const centre = projectPoint(new Vector3(0, 0, 0), c, 800, 400);
    expect(centre.x).toBeCloseTo(400, 6); expect(centre.y).toBeCloseTo(200, 6); expect(centre.visible).toBe(true);
    const right = projectPoint(new Vector3(50, 0, 0), c, 800, 400), up = projectPoint(new Vector3(0, 50, 0), c, 800, 400);
    expect(right.x).toBeGreaterThan(400); expect(up.y).toBeLessThan(200);
  });

  it("reports a point behind the camera as not visible", () => {
    expect(projectPoint(new Vector3(0, 0, 900), camera(), 800, 400).visible).toBe(false);
  });

  it("returns a box rectangle that contains its projected centre", () => {
    const box = new Box3(new Vector3(-40, -10, -10), new Vector3(60, 10, 10));
    const hit = projectBox(box, camera(), 800, 400)!;
    expect(hit.x).toBeGreaterThan(hit.rect.left); expect(hit.x).toBeLessThan(hit.rect.right);
    expect(hit.y).toBeGreaterThan(hit.rect.top); expect(hit.y).toBeLessThan(hit.rect.bottom);
    expect(projectBox(new Box3(), camera(), 800, 400)).toBeNull();
  });

  it("projects only the tagged part and uses a feature anchor in the part's own frame", () => {
    const scene = new Scene(), material = new MeshBasicMaterial();
    const arm = new Mesh(new BoxGeometry(100, 4, 14), material);
    arm.position.set(80, 0, 0); arm.rotation.set(0, -Math.PI / 4, 0); arm.userData.partId = "arm";
    const other = new Mesh(new BoxGeometry(20, 20, 20), material);
    other.position.set(-150, 0, 0); other.userData.partId = "other";
    scene.add(arm, other);
    const c = camera();
    const whole = projectParts(scene, c, 800, 400, ["arm"])!;
    const armOnly = projectBox(new Box3().setFromObject(arm), c, 800, 400)!;
    expect(whole.x).toBeCloseTo(armOnly.x, 6); expect(whole.rect).toEqual(armOnly.rect);
    // The tip anchor (local +X 40 mm) lands inside the arm's rectangle, away from its centre.
    const tip = projectParts(scene, c, 800, 400, ["arm"], new Vector3(40, 0, 0))!;
    const expected = projectPoint(arm.localToWorld(new Vector3(40, 0, 0)), c, 800, 400);
    expect(tip.x).toBeCloseTo(expected.x, 6); expect(tip.y).toBeCloseTo(expected.y, 6);
    expect(tip.x).toBeGreaterThan(whole.x);
    expect(tip.x).toBeLessThanOrEqual(whole.rect.right); expect(tip.x).toBeGreaterThanOrEqual(whole.rect.left);
    expect(projectParts(scene, c, 800, 400, ["missing"])).toBeNull();
  });
});

describe("spoken replies", () => {
  it("reads symbols as words and keeps sentences short", () => {
    expect(speakable("Arm, front right · Ø3.2 mm hole 1 → 6 mm")).toBe("Arm, front right, diameter 3.2 millimetres hole 1 to 6 millimetres");
    const long = "This makes the arm thicker so it bends less under the motor thrust, keeps every hole where it was, and leaves the plates, the battery and the camera exactly as they are today in the design.";
    const lines = shortSentences(long, 3, 80);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every(line => line.length <= 81)).toBe(true);
  });

  it("says units in full for speech only; the screen keeps short forms", () => {
    expect(speakable("Under the same 1 kgf (9.8 N) load it bends 70% less: 22.3 MPa, 0.5 kg payload, 3 cm"))
      .toBe("Under the same 1 kilogram-force (9.8 newtons) load it bends 70 percent less: 22.3 megapascals, 0.5 kilograms payload, 3 centimetres");
    expect(shortSentences("All 4 arms go from 4 mm to 6 mm thick. Check it.")).toEqual(["All 4 arms go from 4 mm to 6 mm thick.", "Check it."]);
  });

  it("speaks the explanation then the questions, at most four lines", () => {
    expect(replyLines({ explanation: "I can change that. It needs a size.", questions: ["What thickness should the arm be?", "Which arm?"] }))
      .toEqual(["I can change that.", "It needs a size.", "What thickness should the arm be?", "Which arm?"]);
  });
});
