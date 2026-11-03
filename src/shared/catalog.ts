import type {
  ProductDefinition,
  ProductKind,
  ParameterSpec,
  Design,
} from "./types";
const p = (
  key: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  step: number,
  value: number,
  description: string,
): ParameterSpec => ({
  key,
  label,
  unit,
  min,
  max,
  step,
  default: value,
  description,
});
export const CATALOG: ProductDefinition[] = [
  {
    kind: "turntable",
    name: "Motorized turntable",
    category: "Motion & photography",
    description: "A smooth stage for showing every side.",
    story:
      "Make a rotating platform that fits your product, then follow its drive and assembly through every change.",
    accent: "#B74C60",
    parameters: [
      p(
        "diameter",
        "Platter diameter",
        "mm",
        120,
        400,
        10,
        220,
        "Sizes the platter, base and support pattern.",
      ),
      p(
        "height",
        "Base height",
        "mm",
        180,
        220,
        5,
        180,
        "Height of the open support frame around the drive.",
      ),
      p(
        "shaftDiameter",
        "Drive shaft",
        "mm",
        8,
        8,
        1,
        8,
        "Fixed 8 mm supported spindle for two 608 bearings.",
      ),
      p(
        "rpm",
        "Rotation speed",
        "rpm",
        1,
        20,
        1,
        6,
        "Sets the motion and controller target.",
      ),
      p(
        "payload",
        "Product mass",
        "kg",
        0.1,
        5,
        0.1,
        1,
        "An estimate for reviewing drive torque; not a load rating.",
      ),
    ],
  },
  {
    kind: "slider",
    name: "Modular camera slider",
    category: "Motion & photography",
    description: "Plan a camera move, down to the millimetre.",
    story:
      "Adjust the travel and camera clearance while rails, belt and end stops stay connected.",
    accent: "#5C7B8D",
    parameters: [
      p(
        "travel",
        "Camera travel",
        "mm",
        150,
        1000,
        25,
        500,
        "Updates rails, belt length and end positions.",
      ),
      p(
        "speed",
        "Travel speed",
        "mm/s",
        5,
        150,
        5,
        35,
        "Sets the carriage motion.",
      ),
      p(
        "railSpacing",
        "Rail spacing",
        "mm",
        60,
        180,
        5,
        100,
        "Sets carriage width and end support spacing.",
      ),
      p(
        "cameraWidth",
        "Camera footprint",
        "mm",
        30,
        150,
        5,
        75,
        "Checks the camera fits the carriage.",
      ),
    ],
  },
  {
    kind: "conveyor",
    name: "Tabletop sorting conveyor",
    category: "Automation",
    description: "See sensing become a physical response.",
    story:
      "Move a sensor and watch the delay, mounting bracket and sorter position update together.",
    accent: "#AB8244",
    parameters: [
      p(
        "length",
        "Conveyor length",
        "mm",
        250,
        900,
        25,
        500,
        "Sizes frame and belt.",
      ),
      p(
        "beltWidth",
        "Belt width",
        "mm",
        70,
        200,
        10,
        120,
        "Changes rollers and frame width.",
      ),
      p(
        "speed",
        "Belt speed",
        "mm/s",
        10,
        150,
        5,
        50,
        "Changes transit time to the diverter.",
      ),
      p(
        "sensorPosition",
        "Sensor position",
        "mm",
        30,
        780,
        10,
        200,
        "Distance from the belt entrance.",
      ),
    ],
  },
  {
    kind: "lamp",
    name: "Articulated task lamp",
    category: "Everyday objects",
    description: "Put light exactly where your work needs it.",
    story:
      "Explore reach and angle, then inspect the base, joints and cable allowance.",
    accent: "#D2B95F",
    parameters: [
      p(
        "reach",
        "Arm reach",
        "mm",
        150,
        550,
        25,
        300,
        "Updates both links and cable allowance.",
      ),
      p(
        "baseDiameter",
        "Base diameter",
        "mm",
        100,
        250,
        10,
        160,
        "Changes the support footprint.",
      ),
      p("angle", "Joint angle", "°", 15, 80, 5, 45, "Sets the arm pose."),
      p(
        "brightness",
        "Light level",
        "%",
        0,
        100,
        5,
        70,
        "Sets the low-voltage LED control.",
      ),
    ],
  },
  {
    kind: "planter",
    name: "Self-watering planter",
    category: "Everyday objects",
    description: "A little system that keeps growing.",
    story:
      "Add a pot and trace the change through the reservoir, tubing and watering schedule.",
    accent: "#528265",
    parameters: [
      p(
        "pots",
        "Number of pots",
        "",
        1,
        5,
        1,
        3,
        "Adds pots, outlets and support positions.",
      ),
      p(
        "potDiameter",
        "Pot diameter",
        "mm",
        60,
        150,
        10,
        90,
        "Sets each cup and its clearance.",
      ),
      p(
        "reservoirHeight",
        "Reservoir height",
        "mm",
        40,
        120,
        10,
        70,
        "Changes the approximate usable water volume.",
      ),
      p(
        "waterMinutes",
        "Watering time",
        "min",
        1,
        20,
        1,
        3,
        "Illustrative daily pump schedule; calibrate for your plants.",
      ),
    ],
  },
  {
    kind: "holder",
    name: "Adjustable work holder",
    category: "Workshop tools",
    description: "Hold the awkward thing comfortably.",
    story:
      "Try a workpiece fit, change the jaws and inspect screw travel and pivot clearance.",
    accent: "#8B718E",
    parameters: [
      p(
        "jawWidth",
        "Jaw width",
        "mm",
        50,
        160,
        10,
        90,
        "Sizes both jaw faces and slide guides.",
      ),
      p(
        "opening",
        "Jaw opening",
        "mm",
        10,
        250,
        10,
        80,
        "Changes the guide and lead screw length.",
      ),
      p(
        "screwDiameter",
        "Lead screw diameter",
        "mm",
        6,
        16,
        1,
        10,
        "Updates the nut bore and handle hub.",
      ),
      p(
        "angle",
        "Work angle",
        "°",
        -40,
        40,
        5,
        0,
        "Sets the holder pivot angle.",
      ),
    ],
  },
];
export const CUSTOM_PRODUCT: ProductDefinition = {
  kind: "custom",
  name: "New design",
  category: "Your designs",
  description: "Build a new assembly from simple forms.",
  story:
    "Describe a new arrangement of boxes, cylinders and tubes. Review dimensions before building.",
  accent: "#7B858E",
  parameters: [
    p(
      "scale",
      "Overall scale",
      "×",
      0.25,
      3,
      0.05,
      1,
      "Scales the complete primitive assembly.",
    ),
  ],
};
export const catalog = CATALOG;
export function getProduct(kind: ProductKind): ProductDefinition {
  const product =
    kind === "custom" ? CUSTOM_PRODUCT : CATALOG.find((p) => p.kind === kind);
  if (!product) throw new Error("Unknown product");
  return product;
}
export function defaultParams(kind: ProductKind): Record<string, number> {
  return Object.fromEntries(
    getProduct(kind).parameters.map((p) => [p.key, p.default]),
  );
}

// Unversioned saved designs retain their original parameter and geometry contract.
export function productForDesign(d: Design): ProductDefinition {
  const current = getProduct(d.kind);
  if (d.kind !== "turntable" || d.mechanismVersion === 2) return current;
  return {
    ...current,
    parameters: current.parameters.map((p) =>
      p.key === "height"
        ? { ...p, min: 35, max: 100, default: 55 }
        : p.key === "shaftDiameter"
          ? {
              ...p,
              min: 5,
              max: 20,
              default: 8,
              description: "Legacy conceptual shaft and hub.",
            }
          : p,
    ),
  };
}
